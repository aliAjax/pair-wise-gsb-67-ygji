import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { seedAudit, seedDefects, seedEquipment, seedPlant, seedTraces } from '../data/seed'
import type {
  AcceptanceDefect,
  AcceptanceItem,
  AuditEntry,
  Certificate,
  DefectRevisionView,
  EquipmentNode,
  MergeQueueItem,
  OfflineCertificate,
  OfflineDefect,
  OfflineItem,
  OfflinePackage,
  PackageRecord,
  PartyReply,
  Plant,
  SigningRecord,
  TraceEntry
} from '../types/domain'

const STORAGE_KEY = 'gsb67:grid-acceptance'
let idSeed = 30
const closedStatuses = ['已关闭', '带条件通过']
const now = () => new Date().toISOString()
const isOpen = (status: string) => !closedStatuses.includes(status)

type ApplyResult = {
  ok: boolean
  status: MergeQueueItem['status']
  action: MergeQueueItem['action']
  reason: string
  basisChanged?: boolean
  keptEvidence?: string
}

export const useAcceptanceStore = defineStore('acceptance', () => {
  const plant = ref<Plant>(structuredClone(seedPlant))
  const equipment = ref<EquipmentNode[]>(structuredClone(seedEquipment))
  const defects = ref<AcceptanceDefect[]>(structuredClone(seedDefects))
  const audit = ref<AuditEntry[]>(structuredClone(seedAudit))
  const traces = ref<TraceEntry[]>(structuredClone(seedTraces))
  const packages = ref<PackageRecord[]>([])
  const mergeQueue = ref<MergeQueueItem[]>([])
  const signings = ref<SigningRecord[]>([])
  const selectedEquipmentId = ref(equipment.value[0].id)
  const keyword = ref('')
  const hydrated = ref(false)

  const selectedEquipment = computed(() => equipment.value.find((item) => item.id === selectedEquipmentId.value))
  const activeSigning = computed(() => signings.value.find((item) => item.status === '有效'))
  const pendingMergeCount = computed(() => mergeQueue.value.filter((item) => item.action === '待确认冲突' || item.action === '待重试').length)
  const stats = computed(() => {
    const items = equipment.value.flatMap((item) => item.items)
    return {
      total: items.length,
      passed: items.filter((item) => item.status === '合格').length,
      failed: items.filter((item) => item.status === '不合格' || item.status === '待复验').length,
      openDefects: defects.value.filter((item) => isOpen(item.status)).length
    }
  })
  const preflight = computed(() => {
    const blocking: string[] = []
    const items = equipment.value.flatMap((item) => item.items)
    if (plant.value.status === '已签署') blocking.push('当前版本已签署；依据变化后须重新签署')
    if (items.some((item) => item.status === '待检查')) blocking.push('仍有验收项未检查')
    if (items.some((item) => item.status === '不合格' || item.status === '待复验')) blocking.push('存在不合格或待复验项')
    if (defects.value.some((item) => isOpen(item.status))) blocking.push('存在未闭环缺陷')
    if (equipment.value.flatMap((item) => item.certificates).some((item) => !item.verified)) blocking.push('存在未核验证书')
    const expired = equipment.value.flatMap((item) => item.certificates).some((item) => item.expiresAt < plant.value.commissioningDate)
    if (expired) blocking.push('证书在并网日期前失效')
    if (pendingMergeCount.value) blocking.push(`离线包仍有${pendingMergeCount.value}个未确认/失败项`)
    return { allowed: blocking.length === 0, blocking }
  })

  function hydrate() {
    if (!import.meta.client || hydrated.value) return
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const stored = JSON.parse(raw)
        plant.value = stored.plant
        equipment.value = stored.equipment
        defects.value = stored.defects
        audit.value = stored.audit ?? structuredClone(seedAudit)
        traces.value = stored.traces ?? structuredClone(seedTraces)
        packages.value = stored.packages ?? []
        mergeQueue.value = stored.mergeQueue ?? []
        signings.value = stored.signings ?? []
      }
    } catch {
      // Seed data is kept when browser storage is corrupt.
    }
    hydrated.value = true
  }

  function persist() {
    if (!import.meta.client) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      plant: plant.value,
      equipment: equipment.value,
      defects: defects.value,
      audit: audit.value,
      traces: traces.value,
      packages: packages.value,
      mergeQueue: mergeQueue.value,
      signings: signings.value
    }))
  }

  function nextId(prefix: string) {
    idSeed += 1
    return `${prefix}-${Date.now().toString(36)}-${idSeed}`
  }

  function log(entityId: string, action: string, operator: string, detail: string, extra: Partial<AuditEntry> = {}) {
    audit.value.unshift({ id: nextId('AUD'), entityId, action, operator, detail, createdAt: now(), ...extra })
  }

  function addTrace(entry: Omit<TraceEntry, 'id' | 'createdAt'> & { createdAt?: string }) {
    traces.value.unshift({ id: nextId('TRC'), createdAt: now(), ...entry })
  }

  function invalidateSigning(reason: string, entityId: string) {
    const signing = activeSigning.value
    if (!signing) return
    signing.status = '已失效'
    signing.invalidatedAt = now()
    signing.invalidReason = reason
    plant.value.status = '待复核'
    equipment.value.forEach((node) => { if (node.status === '已验收') node.status = '验收中' })
    log(plant.value.id, '签署版本失效', '系统', `V${signing.version}失效：${reason}`, { entityId })
    addTrace({
      entityType: '签署版本', entityId: `SGN-V${signing.version}`, source: '系统',
      action: '签署依据变化', result: `原签署版本V${signing.version}失效，电站退回待复核`,
      evidence: reason, operator: '系统'
    })
  }

  function updateItem(equipmentId: string, itemId: string, patch: Partial<AcceptanceItem>) {
    const node = equipment.value.find((item) => item.id === equipmentId)
    const item = node?.items.find((value) => value.id === itemId)
    if (!node || !item || !patch.status) return
    const beforeStatus = item.status
    const nextRevision = (item.revision ?? item.version) + 1
    Object.assign(item, {
      status: patch.status,
      measured: patch.measured ?? '',
      evidence: patch.evidence ?? '',
      condition: patch.condition ?? item.condition,
      version: nextRevision,
      revision: nextRevision,
      updatedAt: now()
    })
    log(equipmentId, '更新验收项', '当前用户', `${item.id}状态由${beforeStatus}更新为${item.status}`, { equipmentId, itemId, revision: nextRevision })
    addTrace({
      entityType: '验收项', entityId: item.id, equipmentId, itemId, revision: nextRevision, source: '站内',
      action: `状态：${beforeStatus} → ${item.status}`, result: item.measured, evidence: item.evidence, operator: '当前用户'
    })
    if (beforeStatus !== item.status) invalidateSigning(`验收项${item.id}状态由${beforeStatus}变为${item.status}`, item.id)
    persist()
  }

  function touchDefect(defect: AcceptanceDefect) {
    const nextRevision = (defect.revision ?? defect.version) + 1
    defect.revision = nextRevision
    defect.version = nextRevision
    defect.stationRevision = nextRevision
    defect.updatedAt = now()
    return nextRevision
  }

  function latestStationEvidence(defect: AcceptanceDefect) {
    return [...defect.replies]
      .filter((item) => item.source !== '离线包')
      .sort((a, b) => b.repliedAt.localeCompare(a.repliedAt))[0]?.evidence ?? defect.decisionNote
  }

  function latestStationRetest(defect: AcceptanceDefect) {
    return [...defect.retests]
      .filter((item) => item.source !== '离线包')
      .sort((a, b) => b.testedAt.localeCompare(a.testedAt))[0]
  }

  function pushDefectRevisionView(defect: AcceptanceDefect, view: DefectRevisionView) {
    if (!defect.revisionViews) defect.revisionViews = []
    const duplicate = defect.revisionViews.some((item) => item.source === view.source && item.revision === view.revision && item.retestNo === view.retestNo)
    if (!duplicate) defect.revisionViews.unshift(view)
  }

  function stationRevisionView(defect: AcceptanceDefect, revision: number, action: string): DefectRevisionView {
    const retest = latestStationRetest(defect)
    return {
      source: '站内', revision, owner: defect.owner, status: defect.status,
      evidence: latestStationEvidence(defect), retestNo: retest?.retestNo ?? '',
      note: `${action}${defect.decisionNote ? `：${defect.decisionNote}` : ''}`,
      testedAt: retest?.testedAt, collectedAt: defect.updatedAt
    }
  }

  function assignDefect(id: string, owner: string) {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return
    const wasOpen = isOpen(defect.status)
    defect.owner = owner
    defect.status = '整改中'
    const revision = touchDefect(defect)
    pushDefectRevisionView(defect, stationRevisionView(defect, revision, '责任方调整'))
    log(id, '分派缺陷', '验收负责人', `责任方调整为${owner}`, { defectId: id, revision })
    addTrace({ entityType: '缺陷', entityId: id, defectId: id, equipmentId: defect.equipmentId, itemId: defect.itemId, revision, source: '站内', action: '分派责任方', result: owner, owner, operator: '验收负责人' })
    if (wasOpen) invalidateSigning(`未关闭缺陷${id}责任方/状态发生变化`, id)
    persist()
  }

  function addReply(id: string, reply: PartyReply) {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect || !reply.content || !reply.evidence) return { ok: false, message: '回复内容和证据均不能为空' }
    const wasOpen = isOpen(defect.status)
    const stationReply = { ...reply, source: '站内' as const }
    if (!defect.replies.some((item) => item.party === reply.party && item.owner === reply.owner && item.repliedAt === reply.repliedAt && item.content === reply.content)) defect.replies.unshift(stationReply)
    defect.status = '待联合复验'
    const revision = touchDefect(defect)
    pushDefectRevisionView(defect, { source: '站内', revision, owner: reply.owner, evidence: reply.evidence, retestNo: '', status: defect.status, note: reply.content, repliedAt: reply.repliedAt })
    log(id, `${reply.party}提交处理说明`, reply.owner, reply.content, { defectId: id, revision })
    addTrace({ entityType: '缺陷', entityId: id, defectId: id, equipmentId: defect.equipmentId, itemId: defect.itemId, revision, source: '站内', action: `${reply.party}提交回复`, result: reply.content, evidence: reply.evidence, owner: reply.owner, operator: reply.owner })
    if (wasOpen) invalidateSigning(`未关闭缺陷${id}新增处理回复`, id)
    persist()
    return { ok: true, message: '已提交处理说明并进入联合复验' }
  }

  function addRetest(id: string, result: string, passed: boolean) {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect || !result) return { ok: false, message: '复验结果不能为空' }
    const wasOpen = isOpen(defect.status)
    const round = defect.retests.length + 1
    const retestNo = `ST-RT-${new Date().toISOString().slice(0, 10).slice(5).replace('-', '')}-${String(round).padStart(2, '0')}`
    defect.retests.unshift({ round, passed, result, tester: '联合验收组', testedAt: now(), retestNo, source: '站内' })
    defect.status = passed ? '已关闭' : '整改中'
    const revision = touchDefect(defect)
    pushDefectRevisionView(defect, stationRevisionView(defect, revision, `站内复测${passed ? '通过' : '未通过'}`))
    log(id, '执行站内联合复验', '联合验收组', `${retestNo}：${result}`, { defectId: id, revision })
    addTrace({ entityType: '缺陷', entityId: id, defectId: id, equipmentId: defect.equipmentId, itemId: defect.itemId, revision, source: '站内', action: passed ? '站内复测通过并关闭' : '站内复测未通过', result, retestNo, operator: '联合验收组' })
    if (wasOpen) invalidateSigning(`未关闭缺陷${id}形成复测结论`, id)
    persist()
    return { ok: true, message: passed ? '站内复测通过，缺陷已关闭' : '复测未通过，返回整改' }
  }

  function decideDefect(id: string, status: '已关闭' | '带条件通过' | '整改中', note: string) {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return { ok: false, message: '缺陷不存在' }
    if (status === '已关闭' && !defect.retests.some((item) => item.passed && item.source !== '离线包')) return { ok: false, message: '没有合格的站内复测记录，厂家自测不能关闭缺陷' }
    if (status === '带条件通过' && !note.trim()) return { ok: false, message: '带条件通过必须说明限制条件' }
    const wasOpen = isOpen(defect.status)
    defect.status = status
    defect.decisionNote = note
    const revision = touchDefect(defect)
    pushDefectRevisionView(defect, stationRevisionView(defect, revision, '验收判定'))
    log(id, `验收决定：${status}`, '验收负责人', note || '完成整改闭环', { defectId: id, revision })
    addTrace({ entityType: '缺陷', entityId: id, defectId: id, equipmentId: defect.equipmentId, itemId: defect.itemId, revision, source: '站内', action: `验收决定：${status}`, result: note || '完成整改闭环', evidence: latestStationEvidence(defect), retestNo: latestStationRetest(defect)?.retestNo, operator: '验收负责人' })
    if (wasOpen) invalidateSigning(`未关闭缺陷${id}发生验收判定变化`, id)
    persist()
    return { ok: true, message: `缺陷已更新为${status}` }
  }

  function signOff() {
    if (!preflight.value.allowed) return { ok: false, message: preflight.value.blocking.join('；') }
    const signedAt = now()
    if (signings.value.some((item) => item.status === '有效')) {
      return { ok: false, message: '当前签署版本仍有效，不能重复签署' }
    }
    if (signings.value.length && plant.value.status !== '已签署') plant.value.version += 1
    const record: SigningRecord = { id: `SGN-V${plant.value.version}`, version: plant.value.version, signedAt, signer: '验收负责人陆川', status: '有效' }
    signings.value.unshift(record)
    plant.value.status = '已签署'
    equipment.value.forEach((node) => { node.status = '已验收' })
    log(plant.value.id, '签署交付版本', '验收负责人陆川', `锁定V${plant.value.version}并生成交付包`, { revision: plant.value.version })
    addTrace({ entityType: '签署版本', entityId: record.id, revision: plant.value.version, source: '站内', action: '签署并锁定交付版本', result: `V${plant.value.version}有效`, operator: record.signer, createdAt: signedAt })
    persist()
    return { ok: true, message: '签署完成，交付版本已锁定' }
  }

  function quickCompleteForDemo() {
    const timestamp = now()
    equipment.value.forEach((node) => {
      node.items.forEach((item) => {
        if (item.status !== '合格') {
          const before = item.status
          const revision = (item.revision ?? item.version) + 1
          Object.assign(item, {
            status: '合格' as const,
            measured: item.measured || '演示复核满足验收标准',
            evidence: item.evidence || '站内复核记录.pdf',
            version: revision,
            revision,
            updatedAt: timestamp
          })
          addTrace({ entityType: '验收项', entityId: item.id, equipmentId: node.id, itemId: item.id, revision, source: '站内', action: `状态：${before} → 合格`, result: item.measured, evidence: item.evidence, operator: '陆川' })
        }
      })
      node.certificates.forEach((certificate) => { certificate.verified = true })
      node.status = '验收中'
    })
    defects.value.forEach((defect) => {
      if (isOpen(defect.status)) {
        const round = defect.retests.length + 1
        const retestNo = `ST-RT-DEMO-${defect.id.slice(-2)}`
        defect.retests.unshift({ round, passed: true, result: '演示数据：站内联合复测满足关闭条件', tester: '联合验收组', testedAt: timestamp, retestNo, source: '站内' })
        defect.status = '已关闭'
        defect.decisionNote = '站内复测通过，作为关闭依据'
        const revision = touchDefect(defect)
        pushDefectRevisionView(defect, stationRevisionView(defect, revision, '演示站内复测'))
        addTrace({ entityType: '缺陷', entityId: defect.id, defectId: defect.id, equipmentId: defect.equipmentId, itemId: defect.itemId, revision, source: '站内', action: '站内复测通过并关闭', result: defect.decisionNote, retestNo, operator: '陆川' })
      }
    })
    log(plant.value.id, '生成演示可签署状态', '陆川', '补齐站内复核、证书核验和复测关闭记录')
    persist()
  }

  function countChanges(payload: OfflinePackage['changes']) {
    return (payload.items?.length ?? 0) + (payload.certificates?.length ?? 0) + (payload.defects?.length ?? 0)
  }

  function importOfflinePackage(input: OfflinePackage) {
    if (!input?.packageId || !input.collectedAt || typeof input.defectRevision !== 'number' || !input.changes) {
      return { ok: false, message: '离线包缺少采集时间、缺陷修订号或变更明细' }
    }
    if (packages.value.some((item) => item.id === input.packageId)) {
      const duplicate = packages.value.find((item) => item.id === input.packageId)
      log(input.packageId, '拒收重复离线包', '系统', `采集时间${input.collectedAt}，重复包只入库一次`, { packageId: input.packageId })
      return { ok: false, duplicate: true, message: `重复包已入库：${input.packageId}（${duplicate?.status}），不重复合并` }
    }

    const record: PackageRecord = {
      id: input.packageId,
      collectedAt: input.collectedAt,
      defectRevision: input.defectRevision,
      manufacturer: input.manufacturer || '设备厂家',
      status: '合并中',
      receivedAt: now(),
      changeCount: countChanges(input.changes),
      successCount: 0,
      failureCount: 0,
      conflictCount: 0,
      failureReasons: []
    }
    packages.value.unshift(record)

    const makeQueue = (type: MergeQueueItem['type'], entityId: string, revision: number, payload: MergeQueueItem['payload'], equipmentId?: string): MergeQueueItem => ({
      id: nextId('MQ'), packageId: input.packageId, collectedAt: input.collectedAt, type, entityId, equipmentId,
      revision, status: '待确认', action: '待合并', reason: '', payload, createdAt: now()
    })

    input.changes.items?.forEach((change) => {
      const { equipmentId, ...item } = change
      mergeQueue.value.unshift(makeQueue('验收项', item.id, item.revision, item, equipmentId))
    })
    input.changes.certificates?.forEach((change) => {
      const { equipmentId, ...certificate } = change
      mergeQueue.value.unshift(makeQueue('证书', certificate.id, certificate.revision, certificate, equipmentId))
    })
    input.changes.defects?.forEach((defect) => {
      mergeQueue.value.unshift(makeQueue('缺陷', defect.id, defect.revision, defect, defect.equipmentId))
    })

    const basisChanged = processPackage(input.packageId)
    log(input.packageId, '接收入库离线包', input.manufacturer || '设备厂家', `采集时间${input.collectedAt}，缺陷修订号R${input.defectRevision}`, { packageId: input.packageId, revision: input.defectRevision })
    if (basisChanged) invalidateSigning(`离线包${input.packageId}更新了验收依据`, input.packageId)
    persist()
    const refreshed = packages.value.find((item) => item.id === input.packageId)
    return {
      ok: refreshed?.status !== '待合并',
      message: `${input.packageId}处理完成：${refreshed?.successCount ?? 0}项成功，${refreshed?.conflictCount ?? 0}项保留双版，${refreshed?.failureCount ?? 0}项可重试`
    }
  }

  function processPackage(packageId: string) {
    let basisChanged = false
    mergeQueue.value.filter((item) => item.packageId === packageId && item.action !== '已忽略').forEach((item) => {
      const result = applyQueueItem(item)
      item.status = result.status
      item.action = result.action
      item.reason = result.reason
      item.keptEvidence = result.keptEvidence
      item.updatedAt = now()
      if (result.basisChanged) basisChanged = true
    })
    refreshPackageStatus(packageId)
    return basisChanged
  }

  function refreshPackageStatus(packageId: string) {
    const record = packages.value.find((item) => item.id === packageId)
    const items = mergeQueue.value.filter((item) => item.packageId === packageId && item.action !== '已忽略')
    if (!record) return
    const succeeded = items.filter((item) => ['已采用', '已保留双版', '已保留站内'].includes(item.status)).length
    const failed = items.filter((item) => item.status === '失败').length
    const conflicts = items.filter((item) => item.action === '待确认冲突').length
    record.successCount = succeeded
    record.failureCount = failed
    record.conflictCount = conflicts
    record.failureReasons = items.filter((item) => item.status === '失败' || item.action === '待确认冲突').map((item) => `${item.entityId}：${item.reason}`)
    record.mergedAt = now()
    if (succeeded === 0 && (failed > 0 || conflicts > 0)) record.status = '待合并'
    else if (failed > 0 || conflicts > 0) record.status = '部分成功'
    else record.status = '已合并'
  }

  function applyQueueItem(item: MergeQueueItem): ApplyResult {
    if (item.type === '验收项') return applyItemChange(item)
    if (item.type === '证书') return applyCertificateChange(item)
    return applyDefectChange(item)
  }

  function applyItemChange(queue: MergeQueueItem, force = false): ApplyResult {
    const change = queue.payload as OfflineItem
    const node = equipment.value.find((item) => item.id === queue.equipmentId)
    const local = node?.items.find((value) => value.id === change.id)
    if (!node || !local) return failedResult(queue, `未找到设备${queue.equipmentId}下的验收项${change.id}`)
    const localRevision = local.revision ?? local.version
    if (!force) {
      if (change.revision <= localRevision) return failedResult(queue, `离线修订号R${change.revision}不高于站内R${localRevision}`)
      const stationChangedAfterCollect = Boolean(local.updatedAt && local.updatedAt > change.collectedAt)
      if (stationChangedAfterCollect) return conflictResult(queue, `站内于${local.updatedAt}更新，离线包采集于${change.collectedAt}，两边均已修改`, `${local.evidence} / ${change.evidence ?? ''}`)
    }
    const beforeStatus = local.status
    const nextRevision = Math.max(change.revision, localRevision + 1)
    Object.assign(local, {
      standard: change.standard ?? local.standard,
      method: change.method ?? local.method,
      condition: change.condition ?? local.condition,
      status: change.status,
      measured: change.measured ?? local.measured,
      evidence: change.evidence ?? local.evidence,
      version: nextRevision,
      revision: nextRevision,
      vendorRevision: change.revision,
      collectedAt: change.collectedAt,
      updatedAt: undefined
    })
    traceMerged('验收项', local.id, queue, `状态：${beforeStatus} → ${change.status}`, local.measured, local.evidence)
    addTrace({ entityType: '修订', entityId: `${local.id}:vendor-R${change.revision}`, equipmentId: node.id, itemId: local.id, packageId: queue.packageId, revision: change.revision, source: '离线包', action: '离线修订已并入站内版本', result: `当前R${nextRevision}`, evidence: local.evidence, operator: queue.packageId })
    return { ok: true, status: '已采用', action: '待合并', reason: '', basisChanged: beforeStatus !== change.status, keptEvidence: local.evidence }
  }

  function applyCertificateChange(queue: MergeQueueItem): ApplyResult {
    const change = queue.payload as OfflineCertificate
    const node = equipment.value.find((item) => item.id === queue.equipmentId)
    const local = node?.certificates.find((value) => value.id === change.id)
    if (!node || !local) return failedResult(queue, `未找到设备${queue.equipmentId}下的证书${change.id}`)
    const localRevision = local.revision ?? local.version
    if (change.revision <= localRevision) return failedResult(queue, `离线证书修订号R${change.revision}不高于站内R${localRevision}`)
    const beforeExpiry = local.expiresAt
    const beforeVerified = local.verified
    Object.assign(local, {
      name: change.name ?? local.name,
      issuer: change.issuer ?? local.issuer,
      expiresAt: change.expiresAt,
      verified: change.verified ?? local.verified,
      version: change.revision,
      revision: change.revision,
      collectedAt: change.collectedAt
    })
    traceMerged('证书', local.id, queue, `有效期：${beforeExpiry} → ${change.expiresAt}`, `签发方${local.issuer}`, local.name)
    return { ok: true, status: '已采用', action: '待合并', reason: '', basisChanged: beforeExpiry !== change.expiresAt || beforeVerified !== local.verified, keptEvidence: local.name }
  }

  function applyDefectChange(queue: MergeQueueItem): ApplyResult {
    const change = queue.payload as OfflineDefect
    const defect = defects.value.find((item) => item.id === change.id)
    if (!defect) return failedResult(queue, `站内不存在缺陷${change.id}，证据已保留在未确认项中`, (change.replies?.[0]?.evidence) ?? '')

    const localRevision = defect.revision ?? defect.version
    if (change.revision <= localRevision) return failedResult(queue, `离线缺陷修订号R${change.revision}不高于站内R${localRevision}`)
    const vendorBase = defect.vendorRevision ?? 0
    const vendorChanged = change.revision > vendorBase
    const stationChangedAfterCollect = Boolean(defect.updatedAt && defect.updatedAt > change.collectedAt)
    const wasOpen = isOpen(defect.status)
    if (vendorChanged && stationChangedAfterCollect) return keepBothDefectVersions(defect, change, queue, wasOpen)
    return adoptDefectChange(defect, change, queue, wasOpen)
  }

  function vendorView(change: OfflineDefect, queue: MergeQueueItem): DefectRevisionView {
    const reply = [...(change.replies ?? [])].sort((a, b) => b.repliedAt.localeCompare(a.repliedAt))[0]
    const retest = [...(change.retests ?? [])].sort((a, b) => b.testedAt.localeCompare(a.testedAt))[0]
    return {
      source: '离线包', revision: change.revision, owner: change.owner ?? '设备厂家',
      evidence: reply?.evidence ?? '', retestNo: retest?.retestNo ?? '',
      status: change.status ?? '待联合复验', note: change.decisionNote ?? reply?.content,
      collectedAt: change.collectedAt, repliedAt: reply?.repliedAt, testedAt: retest?.testedAt, packageId: queue.packageId
    }
  }

  function keepBothDefectVersions(defect: AcceptanceDefect, change: OfflineDefect, queue: MergeQueueItem, wasOpen: boolean): ApplyResult {
    const localRevision = defect.revision ?? defect.version
    defect.vendorRevision = change.revision
    defect.conflictWithPackageId = queue.packageId
    mergeVendorReplies(defect, change, queue.packageId)
    mergeVendorRetests(defect, change, queue.packageId)
    const station = stationRevisionView(defect, localRevision, '站内修订')
    const vendor = vendorView(change, queue)
    defect.revisionViews = [vendor, station, ...(defect.revisionViews ?? []).filter((item) => !(item.source === '站内' && item.revision === localRevision) && !(item.source === '离线包' && item.revision === change.revision))]
    traceMerged('缺陷', defect.id, queue, '两边均已修改，保留站内/离线两版', change.decisionNote ?? '', vendor.evidence)
    addTrace({ entityType: '修订', entityId: `${defect.id}:R${localRevision}/R${change.revision}`, defectId: defect.id, equipmentId: defect.equipmentId, itemId: defect.itemId, packageId: queue.packageId, revision: change.revision, source: '系统', action: '检测到双方修订', result: `站内R${localRevision}、离线R${change.revision}同时保留`, evidence: `${station.evidence} / ${vendor.evidence}`, retestNo: vendor.retestNo, owner: `${defect.owner} / ${vendor.owner}`, operator: '系统' })
    return { ok: true, status: '已保留双版', action: '待确认冲突', reason: `站内R${localRevision}与离线R${change.revision}均已修改，需确认采用哪一版`, basisChanged: wasOpen, keptEvidence: `${station.evidence} / ${vendor.evidence}` }
  }

  function adoptDefectChange(defect: AcceptanceDefect, change: OfflineDefect, queue: MergeQueueItem, wasOpen: boolean, force = false): ApplyResult {
    if (!force && change.revision <= (defect.revision ?? defect.version)) return failedResult(queue, `离线缺陷修订号R${change.revision}不高于站内R${defect.revision ?? defect.version}`)
    const beforeStatus = defect.status
    const localRevision = defect.revision ?? defect.version
    const nextRevision = force ? Math.max(change.revision, localRevision + 1) : change.revision
    const stationPassed = latestStationRetest(defect)?.passed === true
    mergeVendorReplies(defect, change, queue.packageId)
    mergeVendorRetests(defect, change, queue.packageId)
    if (change.equipmentId) defect.equipmentId = change.equipmentId
    if (change.itemId) defect.itemId = change.itemId
    if (change.title) defect.title = change.title
    if (change.owner) defect.owner = change.owner
    if (change.decisionNote !== undefined) defect.decisionNote = change.decisionNote
    if (stationPassed || (defect.status === '已关闭' && change.status === '已关闭')) defect.status = '已关闭'
    else defect.status = change.status ?? defect.status
    defect.version = nextRevision
    defect.revision = nextRevision
    defect.vendorRevision = change.revision
    defect.collectedAt = change.collectedAt
    defect.conflictWithPackageId = undefined
    const view = vendorView(change, queue)
    view.status = defect.status
    pushDefectRevisionView(defect, view)
    traceMerged('缺陷', defect.id, queue, stationPassed ? '采用离线证据，但站内复测结论仍作为关闭依据' : '采用离线修订', change.decisionNote ?? '', view.evidence)
    if (force) addTrace({ entityType: '修订', entityId: `${defect.id}:vendor-R${change.revision}`, defectId: defect.id, equipmentId: defect.equipmentId, itemId: defect.itemId, packageId: queue.packageId, revision: change.revision, source: '离线包', action: '离线修订已并入站内版本', result: `当前R${nextRevision}`, evidence: view.evidence, retestNo: view.retestNo, owner: view.owner, operator: queue.packageId })
    return { ok: true, status: '已采用', action: '待合并', reason: '', basisChanged: wasOpen || beforeStatus !== defect.status, keptEvidence: view.evidence }
  }

  function mergeVendorReplies(defect: AcceptanceDefect, change: OfflineDefect, packageId: string) {
    ;[...(change.replies ?? [])].sort((a, b) => a.repliedAt.localeCompare(b.repliedAt)).forEach((reply) => {
      if (!defect.replies.some((item) => item.party === reply.party && item.owner === reply.owner && item.repliedAt === reply.repliedAt && item.content === reply.content)) {
        defect.replies.unshift({ ...reply, source: '离线包', packageId })
      }
    })
  }

  function mergeVendorRetests(defect: AcceptanceDefect, change: OfflineDefect, packageId: string) {
    ;[...(change.retests ?? [])].sort((a, b) => a.testedAt.localeCompare(b.testedAt)).forEach((retest) => {
      if (!defect.retests.some((item) => item.retestNo === retest.retestNo)) {
        defect.retests.unshift({ ...retest, round: defect.retests.length + 1, source: '离线包', packageId })
      }
    })
  }

  function conflictResult(queue: MergeQueueItem, reason: string, keptEvidence = ''): ApplyResult {
    addTrace({
      entityType: queue.type === '验收项' ? '验收项' : queue.type === '证书' ? '证书' : '缺陷',
      entityId: queue.entityId, equipmentId: queue.equipmentId, packageId: queue.packageId, revision: queue.revision,
      source: '系统', action: '检测到双方修订', result: reason, evidence: keptEvidence, operator: '系统'
    })
    return { ok: false, status: '失败', action: '待确认冲突', reason, keptEvidence }
  }

  function failedResult(queue: MergeQueueItem, reason: string, keptEvidence = ''): ApplyResult {
    addTrace({
      entityType: queue.type === '验收项' ? '验收项' : queue.type === '证书' ? '证书' : '缺陷',
      entityId: queue.entityId, equipmentId: queue.equipmentId, packageId: queue.packageId, revision: queue.revision,
      source: '系统', action: '离线合并失败', result: reason, evidence: keptEvidence, operator: '系统'
    })
    return { ok: false, status: '失败', action: '待重试', reason, keptEvidence }
  }

  function traceMerged(entityType: TraceEntry['entityType'], entityId: string, queue: MergeQueueItem, action: string, result: string, evidence: string) {
    addTrace({
      entityType, entityId, equipmentId: queue.equipmentId, defectId: entityType === '缺陷' ? entityId : undefined,
      itemId: entityType === '验收项' ? entityId : undefined, packageId: queue.packageId, revision: queue.revision,
      source: '离线包', action, result, evidence, operator: queue.packageId
    })
  }

  function retryMerge(queueId: string) {
    const item = mergeQueue.value.find((queue) => queue.id === queueId)
    if (!item || item.action !== '待重试') return { ok: false, message: '只有失败的未确认项可以重试' }
    const result = applyQueueItem(item)
    item.status = result.status
    item.action = result.action
    item.reason = result.reason
    item.keptEvidence = result.keptEvidence
    item.updatedAt = now()
    refreshPackageStatus(item.packageId)
    if (result.basisChanged) invalidateSigning(`离线包${item.packageId}重试合并更新了验收依据`, item.packageId)
    log(item.packageId, '重试离线合并项', '验收负责人', `${item.entityId}：${result.status}`, { packageId: item.packageId })
    persist()
    return { ok: result.ok, message: result.ok ? '重试成功，原回复和证据已保留' : result.reason }
  }

  function resolveMerge(queueId: string, decision: 'vendor' | 'station') {
    const item = mergeQueue.value.find((queue) => queue.id === queueId)
    if (!item || item.action !== '待确认冲突') return { ok: false, message: '该未确认项当前不需要裁决' }
    let result: ApplyResult
    if (item.type === '缺陷') {
      const defect = defects.value.find((value) => value.id === item.entityId)
      const change = item.payload as OfflineDefect
      if (!defect) return retryMerge(queueId)
      if (decision === 'vendor') result = adoptDefectChange(defect, change, item, isOpen(defect.status), true)
      else {
        item.status = '已保留站内'
        item.action = '待合并'
        item.reason = '已保留站内版本，离线修订仅存于修订视图'
        item.updatedAt = now()
        defect.conflictWithPackageId = undefined
        addTrace({ entityType: '修订', entityId: `${defect.id}:R${change.revision}`, defectId: defect.id, equipmentId: defect.equipmentId, itemId: defect.itemId, packageId: item.packageId, revision: change.revision, source: '站内', action: '保留站内修订', result: item.reason, evidence: latestStationEvidence(defect), retestNo: latestStationRetest(defect)?.retestNo, owner: defect.owner, operator: '验收负责人' })
        result = { ok: true, ...item, basisChanged: isOpen(defect.status) }
      }
    } else if (item.type === '验收项') {
      const change = item.payload as OfflineItem
      const node = equipment.value.find((value) => value.id === item.equipmentId)
      const local = node?.items.find((value) => value.id === item.entityId)
      if (!node || !local) return retryMerge(queueId)
      if (decision === 'vendor') result = applyItemChange(item, true)
      else {
        item.status = '已保留站内'
        item.action = '待合并'
        item.reason = '已保留站内验收项状态'
        item.updatedAt = now()
        addTrace({ entityType: '验收项', entityId: local.id, equipmentId: node.id, itemId: local.id, packageId: item.packageId, revision: local.revision ?? local.version, source: '站内', action: '保留站内修订', result: local.status, evidence: local.evidence, operator: '验收负责人' })
        result = { ok: true, ...item, basisChanged: false }
      }
    } else {
      result = applyCertificateChange(item)
    }
    if (decision === 'vendor' && result.ok) {
      item.status = result.status
      item.action = result.action
      item.reason = result.reason
      item.keptEvidence = result.keptEvidence
      item.updatedAt = now()
    }
    refreshPackageStatus(item.packageId)
    if (result.basisChanged) invalidateSigning(`离线包${item.packageId}裁决后验收依据发生变化`, item.packageId)
    log(item.packageId, '裁决离线冲突', '验收负责人', `${item.entityId}采用${decision === 'vendor' ? '离线版' : '站内版'}`, { packageId: item.packageId })
    persist()
    return { ok: true, message: decision === 'vendor' ? '已采用离线版本' : '已保留站内版本' }
  }

  function ignoreMerge(queueId: string) {
    const item = mergeQueue.value.find((queue) => queue.id === queueId)
    if (!item || item.action !== '待重试') return { ok: false, message: '只有失败项可以暂不处理' }
    item.action = '已忽略'
    item.status = '失败'
    item.reason = `${item.reason}；已暂不处理，证据仍保留`
    item.updatedAt = now()
    refreshPackageStatus(item.packageId)
    persist()
    return { ok: true, message: '未确认项已保留证据并暂不处理' }
  }

  function reset() {
    plant.value = structuredClone(seedPlant)
    equipment.value = structuredClone(seedEquipment)
    defects.value = structuredClone(seedDefects)
    audit.value = structuredClone(seedAudit)
    traces.value = structuredClone(seedTraces)
    packages.value = []
    mergeQueue.value = []
    signings.value = []
    persist()
  }

  return {
    plant, equipment, defects, audit, traces, packages, mergeQueue, signings,
    selectedEquipmentId, keyword, hydrated, selectedEquipment, stats, preflight, activeSigning, pendingMergeCount,
    hydrate, updateItem, assignDefect, addReply, addRetest, decideDefect, signOff, quickCompleteForDemo,
    importOfflinePackage, retryMerge, resolveMerge, ignoreMerge, reset
  }
})
