import { checksumOf } from './merge'
import type { OfflinePackage } from '../types/domain'

/** 与已接收包完全相同：应被去重，只入库一次 */
export function duplicateOf(pkg: OfflinePackage): OfflinePackage {
  return structuredClone({ ...pkg, receivedAt: new Date().toISOString() })
}

/** 内容被改动但校验和未重算：应整包拒收 */
export function tamperedOf(pkg: OfflinePackage): OfflinePackage {
  const clone = structuredClone(pkg)
  clone.packageId = `${pkg.packageId}-X`
  clone.note = `${pkg.note}（回站途中被私自修改）`
  const firstItem = clone.items[0]
  if (firstItem) firstItem.measured = `${firstItem.measured}（已篡改）`
  const firstDefect = clone.defects[0]
  if (firstDefect) firstDefect.content = `${firstDefect.content}（已篡改）`
  // checksum 保持原值，制造校验失败
  return clone
}

/** 一份新的厂家离线包：汇流箱补测 + 继保证书换发 */
export function buildFollowupPackage(): OfflinePackage {
  const pkg: OfflinePackage = {
    packageId: 'PKG-260930-B',
    vendorName: '特变电工/逆变器厂家现场服务组',
    collectedAt: '2026-09-30T10:05:00',
    defectRevision: 6,
    checksum: '',
    note: '汇流箱极性补测与继保证书换发离线包。',
    status: '已接收待合并',
    receivedAt: '',
    items: [
      { id: 'IT-C1', equipmentId: 'EQ-CB111', status: '合格', measured: '16路极性正确，开路电压偏差≤1.2%', evidence: '汇流箱逐路测量记录.pdf', revision: 2 }
    ],
    certificates: [
      { id: 'C-G1', equipmentId: 'EQ-GRID', name: '继电保护装置检验报告', issuer: '省电科院', expiresAt: '2028-09-20', verified: true, revision: 2 }
    ],
    defects: []
  }
  return { ...pkg, checksum: checksumOf(pkg) }
}
