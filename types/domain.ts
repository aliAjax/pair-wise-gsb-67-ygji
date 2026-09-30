export type InspectionStatus = '待检查' | '合格' | '不合格' | '待复验'
export type DefectStatus = '待分派' | '整改中' | '待联合复验' | '已关闭' | '带条件通过'
export type Party = '建设单位' | '设备厂家' | '运维单位'
export type RevisionSource = '站内' | '离线包'
export type MergeEntityType = '验收项' | '证书' | '缺陷'
export type MergeTaskStatus = '待确认' | '冲突待裁决' | '已合并' | '合并失败'
export type OfflinePackageStatus = '已接收待合并' | '部分失败' | '已合并'
export type AuditCategory = '计划' | '设备' | '证书' | '缺陷' | '离线包' | '签署'

export interface AcceptanceItem {
  id: string
  standard: string
  method: string
  condition: string
  status: InspectionStatus
  measured: string
  evidence: string
  version: number
}

export interface Certificate {
  id: string
  name: string
  issuer: string
  expiresAt: string
  version: number
  verified: boolean
}

export interface EquipmentNode {
  id: string
  parentId: string | null
  name: string
  type: '并网点' | '变压器' | '方阵' | '逆变器' | '汇流箱'
  code: string
  status: '待验收' | '验收中' | '已验收'
  items: AcceptanceItem[]
  certificates: Certificate[]
}

export interface PartyReply {
  party: Party
  owner: string
  content: string
  evidence: string
  repliedAt: string
  source?: RevisionSource
  revision?: number
  retestRef?: string
  packageId?: string
}

/** 缺陷修订流水：站内与离线包两侧的每次判定都沿修订号留痕 */
export interface DefectRevision {
  revision: number
  source: RevisionSource
  party: Party | '联合验收组' | '验收负责人'
  operator: string
  status: DefectStatus
  content: string
  evidence: string[]
  /** 复测编号，如 RT-AD-260929-01-2；非复测轮次为 “—” */
  retestRef: string
  packageId?: string
  changedAt: string
}

export interface AcceptanceDefect {
  id: string
  equipmentId: string
  itemId: string
  title: string
  severity: '一般' | '重大'
  status: DefectStatus
  owner: string
  dueDate: string
  replies: PartyReply[]
  retests: Array<{ round: number; passed: boolean; result: string; tester: string; testedAt: string }>
  decisionNote: string
  version: number
  /** 站内已记录到的修订号 */
  stationRevision: number
  /** 厂家离线包已并入的缺陷修订号 */
  vendorRevision: number
  lastStationChangeAt: string
  lastVendorChangeAt: string
  revisions: DefectRevision[]
}

export interface Plant {
  id: string
  name: string
  gridPoint: string
  capacity: string
  commissioningDate: string
  status: '验收中' | '待复核' | '已签署'
  version: number
}

/** 签署版本：依据（证书有效期、验收项状态、未关闭缺陷）一变即失效 */
export interface SignVersion {
  version: number
  signedAt: string
  signedBy: string
  basis: string
  status: '有效' | '已失效'
  invalidatedAt?: string
  invalidReason?: string
}

export interface AuditEntry {
  id: string
  category: AuditCategory
  entityId: string
  equipmentId?: string
  packageId?: string
  revision?: number
  action: string
  operator: string
  detail: string
  createdAt: string
}

/* ---------- 离线包与合并 ---------- */

export interface PackageItemPayload {
  id: string
  equipmentId: string
  status: InspectionStatus
  measured: string
  evidence: string
  revision: number
}

export interface PackageCertificatePayload {
  id: string
  equipmentId: string
  name: string
  issuer: string
  expiresAt: string
  verified: boolean
  revision: number
}

export interface PackageDefectPayload {
  id: string
  equipmentId: string
  itemId: string
  title: string
  severity: '一般' | '重大'
  owner: string
  party: Party
  revision: number
  changedAt: string
  content: string
  evidence: string
  retestRef: string
}

export interface OfflinePackage {
  packageId: string
  vendorName: string
  collectedAt: string
  /** 厂家缺陷修订号，整包单调 */
  defectRevision: number
  checksum: string
  note: string
  status: OfflinePackageStatus
  receivedAt: string
  items: PackageItemPayload[]
  certificates: PackageCertificatePayload[]
  defects: PackageDefectPayload[]
}

export interface MergeSideView {
  source: RevisionSource
  revision: number
  status: string
  owner: string
  party?: string
  content?: string
  measured?: string
  expiresAt?: string
  verified?: boolean
  evidence: string[]
  retestRef?: string
  changedAt: string
}

export interface MergeTask {
  id: string
  packageId: string
  entityType: MergeEntityType
  entityId: string
  equipmentId: string
  title: string
  status: MergeTaskStatus
  conflict: boolean
  reason: string
  station: MergeSideView | null
  vendor: MergeSideView | null
  attempts: number
  lastError: string
  createdAt: string
  resolvedAt?: string
}
