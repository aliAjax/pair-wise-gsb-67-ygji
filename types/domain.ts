export type InspectionStatus = '待检查' | '合格' | '不合格' | '待复验'
export type DefectStatus = '待分派' | '整改中' | '待联合复验' | '已关闭' | '带条件通过'
export type Party = '建设单位' | '设备厂家' | '运维单位'
export type MergeSource = '站内' | '离线包'
export type PackageStatus = '待合并' | '合并中' | '部分成功' | '已合并' | '重复包'

export interface AcceptanceItem {
  id: string
  standard: string
  method: string
  condition: string
  status: InspectionStatus
  measured: string
  evidence: string
  version: number
  revision?: number
  collectedAt?: string
  updatedAt?: string
}

export interface Certificate {
  id: string
  name: string
  issuer: string
  expiresAt: string
  version: number
  verified: boolean
  revision?: number
  collectedAt?: string
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
  source?: MergeSource
  packageId?: string
}

export interface DefectRetest {
  round: number
  passed: boolean
  result: string
  tester: string
  testedAt: string
  retestNo?: string
  source?: MergeSource
  packageId?: string
}

export interface DefectRevisionView {
  source: MergeSource
  revision: number
  owner: string
  evidence: string
  retestNo: string
  status: DefectStatus
  note?: string
  collectedAt?: string
  repliedAt?: string
  testedAt?: string
  packageId?: string
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
  retests: DefectRetest[]
  decisionNote: string
  version: number
  revision?: number
  collectedAt?: string
  updatedAt?: string
  stationRevision?: number
  vendorRevision?: number
  conflictWithPackageId?: string
  revisionViews?: DefectRevisionView[]
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

export interface AuditEntry {
  id: string
  entityId: string
  action: string
  operator: string
  detail: string
  createdAt: string
  equipmentId?: string
  itemId?: string
  defectId?: string
  packageId?: string
  revision?: number
  source?: MergeSource
}

export interface OfflineItem {
  id: string
  status: InspectionStatus
  measured?: string
  evidence?: string
  condition?: string
  method?: string
  standard?: string
  revision: number
  collectedAt: string
}

export interface OfflineCertificate {
  id: string
  name?: string
  issuer?: string
  expiresAt: string
  verified?: boolean
  revision: number
  collectedAt: string
}

export interface OfflineReply {
  party: Party
  owner: string
  content: string
  evidence: string
  repliedAt: string
}

export interface OfflineRetest {
  retestNo: string
  passed: boolean
  result: string
  tester: string
  testedAt: string
}

export interface OfflineDefect {
  id: string
  equipmentId?: string
  itemId?: string
  title?: string
  owner?: string
  status?: DefectStatus
  decisionNote?: string
  revision: number
  collectedAt: string
  replies?: OfflineReply[]
  retests?: OfflineRetest[]
}

export interface OfflinePackage {
  packageId: string
  collectedAt: string
  defectRevision: number
  manufacturer: string
  changes: {
    items?: Array<{ equipmentId: string } & OfflineItem>
    certificates?: Array<{ equipmentId: string } & OfflineCertificate>
    defects?: OfflineDefect[]
  }
}

export interface PackageRecord {
  id: string
  collectedAt: string
  defectRevision: number
  manufacturer: string
  status: PackageStatus
  receivedAt: string
  mergedAt?: string
  duplicateOf?: string
  changeCount: number
  successCount: number
  failureCount: number
  conflictCount: number
  failureReasons: string[]
}

export type MergeQueueStatus = '待确认' | '已采用' | '已保留双版' | '已保留站内' | '失败'

export interface MergeQueueItem {
  id: string
  packageId: string
  collectedAt: string
  type: '验收项' | '证书' | '缺陷'
  entityId: string
  equipmentId?: string
  revision: number
  status: MergeQueueStatus
  action: '待合并' | '待确认冲突' | '待重试' | '已忽略'
  reason: string
  payload: OfflineItem | OfflineCertificate | OfflineDefect
  keptEvidence?: string
  createdAt: string
  updatedAt?: string
}

export interface TraceEntry {
  id: string
  entityType: '设备' | '验收项' | '证书' | '缺陷' | '修订' | '签署版本' | '离线包'
  entityId: string
  equipmentId?: string
  itemId?: string
  defectId?: string
  packageId?: string
  revision?: number
  source: MergeSource | '系统'
  action: string
  result: string
  evidence?: string
  retestNo?: string
  owner?: string
  operator: string
  createdAt: string
}

export interface SigningRecord {
  id: string
  version: number
  signedAt: string
  signer: string
  status: '有效' | '已失效' | '待复核'
  invalidatedAt?: string
  invalidReason?: string
}
