import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { buildSeedPackages, seedAudit, seedDefects, seedEquipment, seedPlant, seedSignVersions } from '../data/seed'
import { buildMergeTasks, checksumOf, findItem, mergedDefectStatus } from '../services/merge'
import type {
  AcceptanceDefect,
  AcceptanceItem,
  AuditCategory,
  AuditEntry,
  DefectRevision,
  EquipmentNode,
  MergeTask,
  OfflinePackage,
  PartyReply,
  Plant,
  SignVersion
} from '../types/domain'

const STORAGE_KEY = 'gsb67:grid-acceptance'
const SCHEMA = 2
let idSeed = 30
let logSeq = 0

type ConflictDecision = '站内' | '离线包'

export const useAcceptanceStore = defineStore('acceptance', () => {
  const seed = buildSeedPackages()
  const plant = ref<Plant>(structuredClone(seedPlant))
  const equipment = ref<EquipmentNode[]>(structuredClone(seedEquipment))
  const defects = ref<AcceptanceDefect[]>(structuredClone(seedDefects))
  const audit = ref<AuditEntry[]>(structuredClone(seedAudit))
  const packages = ref<OfflinePackage[]>(structuredClone(seed.packages))
  const mergeTasks = ref<MergeTask[]>(structuredClone(seed.tasks))
  const signVersions = ref<SignVersion[]>(structuredClone(seedSignVersions))
  const selectedEquipmentId = ref(equipment.value[0].id)
  const keyword = ref('')
  const hydrated = ref(false)

  const selectedEquipment = computed(() => equipment.value.find((item) => item.id === selectedEquipmentId.value))
  const stats = computed(() => {
    const items = equipment.value.flatMap((item) => item.items)
    return {
      total: items.length,
      passed: items.filter((item) => item.status === '合格').length,
      failed: items.filter((item) => item.status === '不合格' || item.status === '待复验').length,
      openDefects: defects.value.filter((item) => !['已关闭', '带条件通过'].includes(item.status)).length,
      pendingMerge: mergeTasks.value.filter((item) => item.status !== '已合并').length,
      failedMerge: mergeTasks.value.filter((item) => item.status === '合并失败').length
    }
  })
  const activeSignVersion = computed(() => signVersions.value.find((item) => item.status === '有效'))
  const preflight = computed(() => {
    const blocking: string[] = []
    const items = equipment.value.flatMap((item) => item.items)
    if (items.some((item) => item.status === '待检查')) blocking.push('仍有验收项未检查')
    if (items.some((item) => item.status === '不合格' || item.status === '待复验')) blocking.push('存在不合格或待复验项')
    if (defects.value.some((item) => !['已关闭', '带条件通过'].includes(item.status))) blocking.push('存在未闭环缺陷')
    if (mergeTasks.value.some((item) => item.status !== '已合并')) blocking.push('离线包仍有未完成合并的条目')
    if (equipment.value.flatMap((item) => item.certificates).some((item) => !item.verified)) blocking.push('存在未核验证书')
    const expired = equipment.value.flatMap((item) => item.certificates).some((item) => item.expiresAt < plant.value.commissioningDate)
    if (expired) blocking.push('证书在并网日期前失效')
    return { allowed: blocking.length === 0, blocking }
  })

  function hydrate() {
    if (!import.meta.client || hydrated.value) return
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const stored = JSON.parse(raw)
        if (stored.schema === SCHEMA) {
          plant.value = stored.plant
          equipment.value = stored.equipment
          defects.value = stored.defects
          audit.value = stored.audit
          packages.value = stored.packages
          mergeTasks.value = stored.mergeTasks
          signVersions.value = stored.signVersions
        }
      }
    } catch {
      // 存储损坏或旧版本时保留内置种子数据。
    }
    hydrated.value = true
  }

  function persist() {
    if (!import.meta.client) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      schema: SCHEMA, plant: plant.value, equipment: equipment.value, defects: defects.value,
      audit: audit.value, packages: packages.value, mergeTasks: mergeTasks.value, signVersions: signVersions.value
    }))
  }

  function log(category: AuditCategory, entityId: string, action: string, operator: string, detail: string, extra: { equipmentId?: string; packageId?: string; revision?: number } = {}) {
    logSeq += 1
    audit.value.unshift({ id: `AUD-${Date.now()}-${logSeq}-${idSeed++}`, category, entityId, action, operator, detail, createdAt: new Date().toISOString(), ...extra })
  }

  /** 依据变化即令当前有效签署版本失效，电站退回待复核 */
  function invalidateSignVersion(reasons: string[]) {
    if (!reasons.length) return
    const active = signVersions.value.find((item) => item.status === '有效')
    if (!active) return
    active.status = '已失效'
    active.invalidatedAt = new Date().toISOString()
    active.invalidReason = reasons.join('；')
    plant.value.status = '待复核'
    log('签署', plant.value.id, `V${active.version}失效，电站退回待复核`, '系统', active.invalidReason)
  }

  /* ---------- 站内日常操作 ---------- */

  function updateItem(equipmentId: string, itemId: string, patch: Partial<AcceptanceItem>) {
    const node = equipment.value.find((value) => value.id === equipmentId)
    const item = node?.items.find((value) => value.id === itemId)
    if (!item) return
    const before = `${item.status}|${item.measured}|${item.evidence}`
    Object.assign(item, patch, { version: item.version + 1 })
    log('设备', itemId, '更新验收项', '当前用户', `${item.id}状态更新为${item.status}`, { equipmentId })
    if (before !== `${item.status}|${item.measured}|${item.evidence}`) {
      invalidateSignVersion([`验收项${itemId}状态/证据发生变化（现为${item.status}）`])
    }
    persist()
  }

  function assignDefect(id: string, owner: string) {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return
    defect.owner = owner
    defect.status = '整改中'
    appendStationRevision(defect, '验收负责人', owner, '整改中', `责任方调整为${owner}`, [], '—')
    log('缺陷', id, '分派缺陷', '验收负责人', `责任方调整为${owner}`, { equipmentId: defect.equipmentId, revision: defect.stationRevision })
    invalidateSignVersion([`未关闭缺陷${id}责任方发生变化`])
    persist()
  }

  function addReply(id: string, reply: PartyReply) {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect || !reply.content || !reply.evidence) return { ok: false, message: '回复内容和证据均不能为空' }
    const enriched: PartyReply = { ...reply, source: '站内', revision: defect.stationRevision + 1, repliedAt: new Date().toISOString() }
    defect.replies.unshift(enriched)
    defect.status = '待联合复验'
    appendStationRevision(defect, reply.party, reply.owner, '待联合复验', reply.content, [reply.evidence], '—')
    log('缺陷', id, `${reply.party}提交处理说明`, reply.owner, reply.content, { equipmentId: defect.equipmentId, revision: defect.stationRevision })
    invalidateSignVersion([`未关闭缺陷${id}新增责任方回复与证据`])
    persist()
    return { ok: true, message: '已提交处理说明并进入联合复验' }
  }

  /** 站内复测结论是缺陷关闭的唯一依据 */
  function addRetest(id: string, result: string, passed: boolean) {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect || !result.trim()) return { ok: false, message: '复测结果不能为空' }
    const round = defect.retests.length + 1
    const ref = `RT-${id}-${round}`
    defect.retests.unshift({ round, passed, result, tester: '联合验收组', testedAt: new Date().toISOString() })
    defect.status = passed ? '已关闭' : '整改中'
    appendStationRevision(defect, '联合验收组', '联合验收组', defect.status, `站内第${round}轮复测：${result}`, result ? [`站内复测记录单-${ref}.pdf`] : [], ref)
    log('缺陷', id, '执行站内联合复测', '联合验收组', `${result}（复测编号${ref}）`, { equipmentId: defect.equipmentId, revision: defect.stationRevision })
    invalidateSignVersion([`未关闭缺陷${id}站内复测结论变化（${passed ? '通过关闭' : '未通过退回整改'}）`])
    persist()
    return { ok: true, message: passed ? '复测通过，缺陷已关闭' : '复测未通过，退回整改' }
  }

  function decideDefect(id: string, status: '已关闭' | '带条件通过' | '整改中', note: string) {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return { ok: false, message: '缺陷不存在' }
    if (status === '已关闭' && !defect.retests.some((item) => item.passed)) return { ok: false, message: '没有合格的站内复测记录，不能关闭' }
    if (status === '带条件通过' && !note.trim()) return { ok: false, message: '带条件通过必须说明限制条件' }
    defect.status = status
    defect.decisionNote = note
    appendStationRevision(defect, '验收负责人', '陆川', status, note || '验收负责人更新判定', [], '—')
    log('缺陷', id, `验收决定：${status}`, '验收负责人', note || '完成整改闭环', { equipmentId: defect.equipmentId, revision: defect.stationRevision })
    invalidateSignVersion([`未关闭缺陷${id}验收判定发生变化（${status}）`])
    persist()
    return { ok: true, message: `缺陷已更新为${status}` }
  }

  function appendStationRevision(defect: AcceptanceDefect, party: DefectRevision['party'], operator: string, status: DefectRevision['status'], content: string, evidence: string[], retestRef: string) {
    defect.stationRevision += 1
    defect.lastStationChangeAt = new Date().toISOString()
    defect.version = Math.max(defect.stationRevision, defect.vendorRevision)
    defect.revisions.push({ revision: defect.stationRevision, source: '站内', party, operator, status, content, evidence, retestRef, changedAt: defect.lastStationChangeAt })
  }

  /* ---------- 离线包接收与去重 ---------- */

  function ingestPackage(payload: OfflinePackage) {
    if (!payload.packageId || !payload.collectedAt || typeof payload.defectRevision !== 'number') {
      return { ok: false, message: '离线包缺少包号、采集时间或缺陷修订号' }
    }
    const recomputed = checksumOf(payload)
    if (payload.checksum !== recomputed) {
      log('离线包', payload.packageId, '离线包拒收', '验收组', `校验和不一致（包内${payload.checksum}，重算${recomputed}），疑似篡改或传输损坏`, { packageId: payload.packageId })
      persist()
      return { ok: false, message: `校验和不一致，整包拒收（应为${recomputed}）` }
    }
    if (packages.value.some((item) => item.checksum === payload.checksum || item.packageId === payload.packageId)) {
      log('离线包', payload.packageId, '重复离线包忽略', '验收组', '相同包号或校验和的离线包只入库一次', { packageId: payload.packageId })
      persist()
      return { ok: false, message: '重复离线包，只入库一次' }
    }
    const tasks = buildMergeTasks(payload, equipment.value, defects.value)
    const status = tasks.some((item) => item.status === '合并失败') ? '部分失败' : '已接收待合并'
    const stored: OfflinePackage = { ...payload, status, receivedAt: new Date().toISOString() }
    packages.value.unshift(stored)
    mergeTasks.value.unshift(...tasks)
    log('离线包', payload.packageId, '接收到站离线包', '验收组', `采集时间${payload.collectedAt.replace('T', ' ').slice(0, 16)}，缺陷修订号R${payload.defectRevision}，拆出${tasks.length}条待处理`, { packageId: payload.packageId })
    persist()
    return { ok: true, message: `离线包已接收并拆出${tasks.length}条合并任务`, tasks }
  }

  /* ---------- 合并执行与重试 ---------- */

  /** 失败项重试：引用依赖补齐后可从失败处继续，已成功的回复和证据不受影响 */
  function retryTask(taskId: string) {
    const task = mergeTasks.value.find((item) => item.id === taskId)
    if (!task || task.status !== '合并失败') return { ok: false, message: '该任务不在失败状态' }
    task.attempts += 1
    if (task.entityType === '缺陷') {
      const item = findItem(equipment.value, task.equipmentId, referencedItemId(task))
      if (item) {
        task.status = '待确认'
        task.reason = `重试成功：引用的验收项已入库（第${task.attempts}次重试）`
        task.lastError = ''
        log('离线包', task.packageId, '失败项重试', '验收组', `${task.title}依赖补齐，重新进入待确认`, { packageId: task.packageId })
        persist()
        return { ok: true, message: '依赖已补齐，可继续合并' }
      }
    }
    task.lastError = '引用的设备或验收项仍不存在，请先并入对应条目'
    log('离线包', task.packageId, '失败项重试未成功', '验收组', `${task.title}：${task.lastError}`, { packageId: task.packageId })
    persist()
    return { ok: false, message: task.lastError }
  }

  function referencedItemId(task: MergeTask): string {
    const pkg = packages.value.find((item) => item.packageId === task.packageId)
    return pkg?.defects.find((item) => item.id === task.entityId)?.itemId ?? ''
  }

  function resolveTask(taskId: string, decision?: ConflictDecision) {
    const task = mergeTasks.value.find((item) => item.id === taskId)
    if (!task || task.status === '已合并') return { ok: false, message: '任务已处理' }
    if (task.status === '合并失败') return { ok: false, message: '请先重试该失败项' }
    if (task.conflict && decision !== '站内' && decision !== '离线包') return { ok: false, message: '双方都改动过，请选择以哪一版为当前判定（两版都会保留）' }

    const pkg = packages.value.find((item) => item.packageId === task.packageId)
    if (!pkg) return { ok: false, message: '离线包不存在' }
    const basisChanges: string[] = []

    if (task.entityType === '验收项') {
      const payload = pkg.items.find((item) => item.id === task.entityId && item.equipmentId === task.equipmentId)!
      const node = equipment.value.find((item) => item.id === task.equipmentId)!
      let item = node.items.find((value) => value.id === payload.id)
      if (!item) {
        item = { id: payload.id, standard: '（离线包新增，标准待站内补录）', method: '', condition: '', status: payload.status, measured: payload.measured, evidence: payload.evidence, version: payload.revision }
        node.items.push(item)
        basisChanges.push(`离线包新增验收项${payload.id}，状态${payload.status}`)
      } else if (!task.conflict || decision === '离线包') {
        const before = item.status
        Object.assign(item, { status: payload.status, measured: payload.measured, evidence: payload.evidence, version: payload.revision })
        if (before !== payload.status) basisChanges.push(`验收项${payload.id}状态由${before}变为${payload.status}`)
      }
      log('设备', payload.id, '并入离线包验收项', '验收组', task.conflict ? `双方改动冲突，裁决以${decision}版为当前判定，两版均已留存` : task.reason, { equipmentId: node.id, packageId: pkg.packageId, revision: payload.revision })
    }

    if (task.entityType === '证书') {
      const payload = pkg.certificates.find((item) => item.id === task.entityId && item.equipmentId === task.equipmentId)!
      const node = equipment.value.find((item) => item.id === task.equipmentId)!
      let cert = node.certificates.find((value) => value.id === payload.id)
      if (!cert) {
        cert = { id: payload.id, name: payload.name, issuer: payload.issuer, expiresAt: payload.expiresAt, version: payload.revision, verified: payload.verified }
        node.certificates.push(cert)
        basisChanges.push(`新增证书${payload.name}，有效期至${payload.expiresAt}`)
      } else if (!task.conflict || decision === '离线包') {
        if (cert.expiresAt !== payload.expiresAt) basisChanges.push(`证书${payload.name}有效期由${cert.expiresAt}变为${payload.expiresAt}`)
        if (cert.verified !== payload.verified) basisChanges.push(`证书${payload.name}核验状态变化`)
        Object.assign(cert, { expiresAt: payload.expiresAt, verified: payload.verified, version: payload.revision })
      }
      log('证书', payload.id, '并入离线包证书', '验收组', `有效期至${payload.expiresAt}，${payload.verified ? '已核验' : '待核验'}`, { equipmentId: node.id, packageId: pkg.packageId, revision: payload.revision })
    }

    if (task.entityType === '缺陷') {
      const payload = pkg.defects.find((item) => item.id === task.entityId)!
      let defect = defects.value.find((item) => item.id === payload.id)
      if (!defect) {
        defect = {
          id: payload.id, equipmentId: payload.equipmentId, itemId: payload.itemId, title: payload.title, severity: payload.severity,
          status: '待分派', owner: payload.owner, dueDate: '', replies: [], retests: [], decisionNote: '',
          version: 0, stationRevision: 0, vendorRevision: 0, lastStationChangeAt: '', lastVendorChangeAt: '', revisions: []
        }
        defects.value.push(defect)
      }
      // 厂家回复、证据和复测编号始终追加保留，成功的回复和证据不丢
      defect.replies.unshift({ party: payload.party, owner: payload.owner.replace(/^.*（|）$/g, ''), content: payload.content, evidence: payload.evidence, repliedAt: payload.changedAt, source: '离线包', revision: payload.revision, retestRef: payload.retestRef, packageId: pkg.packageId })
      const keepStation = task.conflict && decision === '站内'
      const nextStatus = keepStation ? defect.status : mergedDefectStatus(defect.status, payload.retestRef)
      defect.revisions.push({ revision: payload.revision, source: '离线包', party: payload.party, operator: payload.owner.replace(/^.*（|）$/g, ''), status: nextStatus, content: payload.content, evidence: [payload.evidence], retestRef: payload.retestRef, packageId: pkg.packageId, changedAt: payload.changedAt })
      defect.vendorRevision = Math.max(defect.vendorRevision, payload.revision)
      defect.lastVendorChangeAt = payload.changedAt
      defect.version = Math.max(defect.stationRevision, defect.vendorRevision)
      if (!keepStation) {
        defect.status = nextStatus
        if (payload.retestRef && payload.retestRef !== '—' && defect.status !== '已关闭') {
          basisChanges.push(`未关闭缺陷${payload.id}厂家复测${payload.retestRef}待站内复测关闭`)
        }
      }
      log('缺陷', payload.id, task.conflict ? '双方改动冲突合并' : '并入离线包缺陷修订', '验收组', task.conflict ? `站内R${defect.stationRevision}与厂家R${payload.revision}两版均保留，裁决以${decision}版为当前判定；关闭仍以站内复测为准` : `并入厂家R${payload.revision}：${payload.content}（复测编号${payload.retestRef}）`, { equipmentId: payload.equipmentId, packageId: pkg.packageId, revision: payload.revision })
    }

    task.status = '已合并'
    task.resolvedAt = new Date().toISOString()
    refreshPackageStatus(pkg.packageId)
    invalidateSignVersion(basisChanges)
    persist()
    return { ok: true, message: task.conflict ? `已按${decision}版裁决，两版均保留` : '合并成功，回复与证据已留存' }
  }

  /** 一键并入所有无冲突待确认项（失败项需先重试，冲突项需人工裁决） */
  function resolvePackage(packageId: string) {
    let applied = 0
    let guard = 0
    // 先按 验收项→证书→缺陷 顺序，保证新增验收项先入库，失败缺陷重试即可成功
    while (guard < 20) {
      guard += 1
      const ready = mergeTasks.value.filter((item) => item.packageId === packageId && item.status === '待确认')
        .sort((a, b) => ({ 验收项: 0, 证书: 1, 缺陷: 2 }[a.entityType] - { 验收项: 0, 证书: 1, 缺陷: 2 }[b.entityType]))
      if (!ready.length) break
      for (const task of ready) resolveTask(task.id)
      applied += ready.length
      const failed = mergeTasks.value.filter((item) => item.packageId === packageId && item.status === '合并失败')
      for (const task of failed) retryTask(task.id)
    }
    persist()
    return { applied, message: `已并入${applied}条；冲突与仍失败条目请逐条处理` }
  }

  function refreshPackageStatus(packageId: string) {
    const pkg = packages.value.find((item) => item.packageId === packageId)
    if (!pkg) return
    const tasks = mergeTasks.value.filter((item) => item.packageId === packageId)
    if (tasks.some((item) => item.status === '合并失败')) pkg.status = '部分失败'
    else if (tasks.some((item) => item.status !== '已合并')) pkg.status = '已接收待合并'
    else pkg.status = '已合并'
  }

  /* ---------- 签署 ---------- */

  function signOff() {
    if (!preflight.value.allowed) return { ok: false, message: preflight.value.blocking.join('；') }
    const version = plant.value.version + 1
    const basis = `${stats.value.total}项验收项全部合格，${defects.value.length}项缺陷均已闭环，证书均在并网日期后有效`
    signVersions.value.unshift({ version, signedAt: new Date().toISOString(), signedBy: '陆川', basis, status: '有效' })
    plant.value.status = '已签署'
    plant.value.version = version
    equipment.value.forEach((node) => { node.status = '已验收' })
    log('签署', plant.value.id, `签署交付版本V${version}`, '验收负责人陆川', `锁定V${version}并生成交付包`, { revision: version })
    persist()
    return { ok: true, message: `签署完成，交付版本V${version}已锁定` }
  }

  function registerRecheck() {
    log('签署', plant.value.id, '退回后重新检查', '验收组', '电站处于待复核状态，验收组按最新依据重新检查验收项与缺陷')
    persist()
    return { ok: true, message: '已登记重新检查' }
  }

  function auditTrail(filters: { equipmentId?: string; defectId?: string; revision?: number }) {
    return audit.value.filter((entry) => {
      if (filters.equipmentId && entry.equipmentId !== filters.equipmentId) return false
      if (filters.defectId && entry.entityId !== filters.defectId) return false
      if (filters.revision && entry.revision !== filters.revision) return false
      return true
    })
  }

  function reset() {
    const fresh = buildSeedPackages()
    plant.value = structuredClone(seedPlant)
    equipment.value = structuredClone(seedEquipment)
    defects.value = structuredClone(seedDefects)
    audit.value = structuredClone(seedAudit)
    packages.value = structuredClone(fresh.packages)
    mergeTasks.value = structuredClone(fresh.tasks)
    signVersions.value = structuredClone(seedSignVersions)
    persist()
  }

  return {
    plant, equipment, defects, audit, packages, mergeTasks, signVersions,
    selectedEquipmentId, keyword, hydrated,
    selectedEquipment, stats, preflight, activeSignVersion,
    hydrate, auditTrail,
    updateItem, assignDefect, addReply, addRetest, decideDefect,
    ingestPackage, retryTask, resolveTask, resolvePackage,
    signOff, registerRecheck, reset
  }
})
