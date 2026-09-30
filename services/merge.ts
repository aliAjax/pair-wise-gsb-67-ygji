import type {
  AcceptanceDefect,
  Certificate,
  DefectStatus,
  EquipmentNode,
  MergeSideView,
  MergeTask,
  OfflinePackage,
  PackageCertificatePayload,
  PackageDefectPayload,
  PackageItemPayload
} from '../types/domain'

/** 稳定序列化：对象键排序，保证同一离线包内容得到同一校验和 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

/** FNV-1a 32位，离线包完整性校验，篡改即整包拒收 */
export function checksumOf(pkg: Pick<OfflinePackage, 'items' | 'certificates' | 'defects'>): string {
  const text = stableStringify({ items: pkg.items, certificates: pkg.certificates, defects: pkg.defects })
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `ck-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function findEquipment(equipment: EquipmentNode[], equipmentId: string): EquipmentNode | undefined {
  return equipment.find((node) => node.id === equipmentId)
}

export function findItem(equipment: EquipmentNode[], equipmentId: string, itemId: string) {
  return findEquipment(equipment, equipmentId)?.items.find((item) => item.id === itemId) ?? null
}

export function findCert(equipment: EquipmentNode[], equipmentId: string, certId: string): Certificate | null {
  return findEquipment(equipment, equipmentId)?.certificates.find((cert) => cert.id === certId) ?? null
}

export function stationViewForItem(equipment: EquipmentNode[], payload: PackageItemPayload): MergeSideView | null {
  const item = findItem(equipment, payload.equipmentId, payload.id)
  if (!item) return null
  return {
    source: '站内', revision: item.version, status: item.status, owner: '联合验收组',
    measured: item.measured, evidence: item.evidence ? [item.evidence] : [], changedAt: ''
  }
}

export function vendorViewForItem(payload: PackageItemPayload): MergeSideView {
  return {
    source: '离线包', revision: payload.revision, status: payload.status, owner: '设备厂家',
    measured: payload.measured, evidence: payload.evidence ? [payload.evidence] : [], changedAt: ''
  }
}

export function stationViewForCert(equipment: EquipmentNode[], payload: PackageCertificatePayload): MergeSideView | null {
  const cert = findCert(equipment, payload.equipmentId, payload.id)
  if (!cert) return null
  return {
    source: '站内', revision: cert.version, status: cert.verified ? '已核验' : '待核验', owner: cert.issuer,
    expiresAt: cert.expiresAt, verified: cert.verified, evidence: [], changedAt: ''
  }
}

export function vendorViewForCert(payload: PackageCertificatePayload): MergeSideView {
  return {
    source: '离线包', revision: payload.revision, status: payload.verified ? '已核验' : '待核验', owner: payload.issuer,
    expiresAt: payload.expiresAt, verified: payload.verified, evidence: [], changedAt: ''
  }
}

export function stationViewForDefect(defect: AcceptanceDefect): MergeSideView {
  const latest = [...defect.revisions].filter((item) => item.source === '站内').sort((a, b) => b.revision - a.revision)[0]
  return {
    source: '站内',
    revision: defect.stationRevision,
    status: defect.status,
    owner: defect.owner,
    content: latest?.content ?? '',
    evidence: latest?.evidence ?? [],
    retestRef: latest?.retestRef === '—' ? undefined : latest?.retestRef,
    changedAt: defect.lastStationChangeAt
  }
}

export function vendorViewForDefect(payload: PackageDefectPayload): MergeSideView {
  return {
    source: '离线包',
    revision: payload.revision,
    status: '厂家复测合格（待站内确认）',
    owner: payload.party,
    content: payload.content,
    evidence: payload.evidence ? [payload.evidence] : [],
    retestRef: payload.retestRef === '—' ? undefined : payload.retestRef,
    changedAt: payload.changedAt
  }
}

let taskSeq = 0

function makeTask(partial: Omit<MergeTask, 'id' | 'attempts' | 'lastError' | 'createdAt'>): MergeTask {
  taskSeq += 1
  return { ...partial, id: `MT-${String(taskSeq).padStart(3, '0')}`, attempts: 0, lastError: '', createdAt: new Date().toISOString() }
}

/**
 * 离线包逐条预检，生成合并任务：
 * - 修订号新于站内且站内未再改动：待确认，可直接并入
 * - 两边都动过：冲突待裁决，两版都保留
 * - 引用的设备/验收项尚不存在：合并失败，依赖补齐后可从失败项重试
 * - 内容与修订号均无变化：无变化，不生成任务
 */
export function buildMergeTasks(pkg: OfflinePackage, equipment: EquipmentNode[], defects: AcceptanceDefect[]): MergeTask[] {
  const tasks: MergeTask[] = []

  for (const payload of pkg.items) {
    const node = findEquipment(equipment, payload.equipmentId)
    if (!node) {
      tasks.push(makeTask({ packageId: pkg.packageId, entityType: '验收项', entityId: payload.id, equipmentId: payload.equipmentId, title: `验收项 ${payload.id}`, status: '合并失败', conflict: false, reason: '引用的设备台账不存在', station: null, vendor: vendorViewForItem(payload) }))
      continue
    }
    const item = node.items.find((value) => value.id === payload.id)
    if (!item) {
      tasks.push(makeTask({ packageId: pkg.packageId, entityType: '验收项', entityId: payload.id, equipmentId: node.id, title: `新增验收项 ${payload.id}（${node.name}）`, status: '待确认', conflict: false, reason: '站内尚无该验收项，将随包新增入库', station: null, vendor: vendorViewForItem(payload) }))
      continue
    }
    const station = stationViewForItem(equipment, payload)
    const vendor = vendorViewForItem(payload)
    const same = item.status === payload.status && item.measured === payload.measured && item.evidence === payload.evidence
    if (payload.revision < item.version) {
      tasks.push(makeTask({ packageId: pkg.packageId, entityType: '验收项', entityId: payload.id, equipmentId: node.id, title: `验收项 ${item.id} · ${item.standard}`, status: '冲突待裁决', conflict: true, reason: `离线包修订号${payload.revision}落后于站内V${item.version}，以站内新版为准或人工裁决`, station, vendor }))
    } else if (payload.revision === item.version && !same) {
      tasks.push(makeTask({ packageId: pkg.packageId, entityType: '验收项', entityId: payload.id, equipmentId: node.id, title: `验收项 ${item.id} · ${item.standard}`, status: '冲突待裁决', conflict: true, reason: '同修订号内容不一致，需人工核对证据', station, vendor }))
    } else if (!same) {
      tasks.push(makeTask({ packageId: pkg.packageId, entityType: '验收项', entityId: payload.id, equipmentId: node.id, title: `验收项 ${item.id} · ${item.standard}`, status: '待确认', conflict: false, reason: `厂家修订号${payload.revision}新于站内V${item.version}，采集后站内未改动，可直接并入`, station, vendor }))
    }
  }

  for (const payload of pkg.certificates) {
    const node = findEquipment(equipment, payload.equipmentId)
    const cert = findCert(equipment, payload.equipmentId, payload.id)
    if (!node) {
      tasks.push(makeTask({ packageId: pkg.packageId, entityType: '证书', entityId: payload.id, equipmentId: payload.equipmentId, title: `证书 ${payload.id}`, status: '合并失败', conflict: false, reason: '引用的设备台账不存在', station: null, vendor: vendorViewForCert(payload) }))
      continue
    }
    if (!cert) {
      tasks.push(makeTask({ packageId: pkg.packageId, entityType: '证书', entityId: payload.id, equipmentId: node.id, title: `新增证书 ${payload.name}`, status: '待确认', conflict: false, reason: '站内尚无该证书，将随包登记', station: null, vendor: vendorViewForCert(payload) }))
      continue
    }
    const station = stationViewForCert(equipment, payload)
    const vendor = vendorViewForCert(payload)
    const same = cert.expiresAt === payload.expiresAt && cert.verified === payload.verified
    if (payload.revision < cert.version) {
      tasks.push(makeTask({ packageId: pkg.packageId, entityType: '证书', entityId: cert.id, equipmentId: node.id, title: `证书 ${cert.name}`, status: '冲突待裁决', conflict: true, reason: `离线包修订号${payload.revision}落后于站内V${cert.version}`, station, vendor }))
    } else if (!same) {
      tasks.push(makeTask({ packageId: pkg.packageId, entityType: '证书', entityId: cert.id, equipmentId: node.id, title: `证书 ${cert.name}`, status: '待确认', conflict: false, reason: `证书有效期或核验状态变化（修订号${payload.revision}），并入后原签署版本将失效`, station, vendor }))
    }
  }

  for (const payload of pkg.defects) {
    const defect = defects.find((value) => value.id === payload.id)
    if (!defect) {
      const item = findItem(equipment, payload.equipmentId, payload.itemId)
      if (!item) {
        tasks.push(makeTask({ packageId: pkg.packageId, entityType: '缺陷', entityId: payload.id, equipmentId: payload.equipmentId, title: `新增缺陷 ${payload.id} · ${payload.title}`, status: '合并失败', conflict: false, reason: `引用的验收项 ${payload.itemId} 尚未入库，请先并入该验收项后重试`, station: null, vendor: vendorViewForDefect(payload) }))
      } else {
        tasks.push(makeTask({ packageId: pkg.packageId, entityType: '缺陷', entityId: payload.id, equipmentId: payload.equipmentId, title: `新增缺陷 ${payload.id} · ${payload.title}`, status: '待确认', conflict: false, reason: '站内尚无该缺陷，将随包建单', station: null, vendor: vendorViewForDefect(payload) }))
      }
      continue
    }
    const station = stationViewForDefect(defect)
    const vendor = vendorViewForDefect(payload)
    if (payload.revision <= defect.vendorRevision) {
      continue // 该修订已并入过，无变化
    }
    const stationMoved = !!defect.lastVendorChangeAt && defect.lastStationChangeAt > defect.lastVendorChangeAt
    if (stationMoved) {
      tasks.push(makeTask({ packageId: pkg.packageId, entityType: '缺陷', entityId: defect.id, equipmentId: defect.equipmentId, title: `缺陷 ${defect.id} · ${defect.title}`, status: '冲突待裁决', conflict: true, reason: `厂家基于修订号${defect.vendorRevision}提交R${payload.revision}期间，站内已产生R${defect.stationRevision}新判定，两版均保留`, station, vendor }))
    } else {
      tasks.push(makeTask({ packageId: pkg.packageId, entityType: '缺陷', entityId: defect.id, equipmentId: defect.equipmentId, title: `缺陷 ${defect.id} · ${defect.title}`, status: '待确认', conflict: false, reason: `厂家缺陷修订号R${payload.revision}新于站内已并入R${defect.vendorRevision}，站内未再改动`, station, vendor }))
    }
  }

  return tasks
}

/** 合并后缺陷目标状态：厂家复测合格只进入待联合复验，关闭仍以站内复测为唯一依据 */
export function mergedDefectStatus(current: DefectStatus, retestRef: string): DefectStatus {
  if (current === '已关闭') return '已关闭'
  if (retestRef && retestRef !== '—') return '待联合复验'
  return current === '待分派' ? '整改中' : current
}
