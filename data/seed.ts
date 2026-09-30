import type { AcceptanceDefect, AuditEntry, DefectRevision, EquipmentNode, MergeTask, OfflinePackage, Plant, SignVersion } from '../types/domain'
import { buildMergeTasks, checksumOf } from '../services/merge'

export const seedPlant: Plant = {
  id: 'PV-2609-NW', name: '西北沙岭一期 120MW光伏电站', gridPoint: '沙岭110kV升压站', capacity: '120 MWp', commissioningDate: '2026-10-08', status: '待复核', version: 7
}

export const seedSignVersions: SignVersion[] = [
  {
    version: 7, signedAt: '2026-09-29T18:40:00', signedBy: '陆川', basis: '18项验收项全部合格或带复验通过，2项缺陷已闭环，证书均在有效期内', status: '已失效',
    invalidatedAt: '2026-09-30T08:05:00', invalidReason: '站内登记第1轮复测发现有载调压档位仍有1档偏差（AD-260929-01 R5），关闭依据变化'
  },
  {
    version: 6, signedAt: '2026-09-28T19:10:00', signedBy: '陆川', basis: '首轮验收结论，缺陷允许整改后复验', status: '已失效',
    invalidatedAt: '2026-09-29T10:20:00', invalidReason: '逆变器效率复测98.27%未达标，验收项IT-I2转为待复验'
  }
]

export const seedEquipment: EquipmentNode[] = [
  {
    id: 'EQ-GRID', parentId: null, name: '110kV并网点', type: '并网点', code: 'GRID-110', status: '验收中',
    items: [
      { id: 'IT-G1', standard: '保护定值与调度单一致', method: '逐项比对定值单与装置报文', condition: '并网点开关合位，通信正常', status: '合格', measured: '18/18项一致', evidence: '定值核对记录.pdf', version: 2 },
      { id: 'IT-G2', standard: '故障录波可正确触发', method: '模拟保护启动', condition: '录波装置已对时', status: '待复验', measured: '触发成功，时标偏差28ms', evidence: '录波触发截图.png', version: 2 }
    ],
    certificates: [{ id: 'C-G1', name: '继电保护装置检验报告', issuer: '省电科院', expiresAt: '2027-09-20', version: 1, verified: true }]
  },
  {
    id: 'EQ-TR1', parentId: 'EQ-GRID', name: '1号主变压器', type: '变压器', code: 'TR-01', status: '验收中',
    items: [
      { id: 'IT-T1', standard: '绝缘电阻不低于出厂值70%', method: '2500V绝缘电阻表测量', condition: '绕组温度25±5℃，湿度低于80%', status: '合格', measured: '高压对地 12.8GΩ', evidence: '绝缘测试原始记录.xlsx', version: 1 },
      { id: 'IT-T2', standard: '有载调压档位与监控一致', method: '远方/就地逐档操作', condition: '变压器空载', status: '不合格', measured: '第7档监控显示第8档', evidence: '档位差异照片.jpg', version: 2 }
    ],
    certificates: [{ id: 'C-T1', name: '主变出厂试验报告', issuer: '特变电工', expiresAt: '2031-04-10', version: 1, verified: true }]
  },
  {
    id: 'EQ-AR1', parentId: 'EQ-TR1', name: '1号方阵', type: '方阵', code: 'ARRAY-01', status: '待验收',
    items: [{ id: 'IT-A1', standard: '接地连续性符合设计', method: '微欧计抽测30处', condition: '汇流箱断电', status: '合格', measured: '抽测12处 ≤0.2Ω', evidence: '接地连续性记录(站内).pdf', version: 2 }], certificates: []
  },
  {
    id: 'EQ-INV11', parentId: 'EQ-AR1', name: '1-1号逆变器', type: '逆变器', code: 'INV-1-1', status: '验收中',
    items: [
      { id: 'IT-I1', standard: '通信点表与SCADA一致', method: '逐点置数核对', condition: '调度数据网连通', status: '合格', measured: '126/126点一致', evidence: '点表核对记录.xlsx', version: 3 },
      { id: 'IT-I2', standard: '额定功率下转换效率不低于98.5%', method: '功率分析仪连续测量30分钟', condition: '辐照度≥700W/m²，功率稳定', status: '待复验', measured: '98.3%', evidence: '效率测试曲线.csv', version: 2 }
    ],
    certificates: [{ id: 'C-I1', name: '逆变器低电压穿越证书', issuer: '中国电科院', expiresAt: '2028-06-30', version: 2, verified: true }]
  },
  {
    id: 'EQ-CB111', parentId: 'EQ-INV11', name: '1-1-1汇流箱', type: '汇流箱', code: 'CB-1-1-1', status: '待验收',
    items: [{ id: 'IT-C1', standard: '组串极性及开路电压正常', method: '逐路测量并核对设计', condition: '辐照度300-800W/m²', status: '待检查', measured: '', evidence: '', version: 1 }], certificates: []
  }
]

function revision(value: Omit<DefectRevision, 'changedAt'> & { changedAt?: string }): DefectRevision {
  return { changedAt: '', ...value }
}

export const seedDefects: AcceptanceDefect[] = [
  {
    id: 'AD-260929-01', equipmentId: 'EQ-TR1', itemId: 'IT-T2', title: '有载调压第7档监控档位不一致', severity: '重大', status: '整改中', owner: '设备厂家（王新）', dueDate: '2026-09-30', version: 5, decisionNote: '厂家更换变送器后站内首轮复测仍有1档偏差，继续整改',
    stationRevision: 5, vendorRevision: 4,
    lastStationChangeAt: '2026-09-30T08:05:00', lastVendorChangeAt: '2026-09-29T14:20:00',
    replies: [
      { party: '设备厂家', owner: '王新', content: '档位变送器输出线性偏差，已更换并重新校准，厂家台体复测17档全对。', evidence: '更换记录与校准报告.pdf', repliedAt: '2026-09-29T14:20:00', source: '离线包', revision: 4, retestRef: 'RT-AD-260929-01-F1', packageId: 'PKG-260929-D' },
      { party: '运维单位', owner: '联合验收组', content: '站内现场复测：第3、7档监控与就地一致，第11档仍有1档偏差，不能关闭。', evidence: '站内复测记录单-RT-AD-260929-01-1.pdf', repliedAt: '2026-09-30T08:05:00', source: '站内', revision: 5, retestRef: 'RT-AD-260929-01-1' }
    ],
    retests: [{ round: 1, passed: false, result: '第11档监控仍有1档偏差，未通过', tester: '联合验收组', testedAt: '2026-09-30T08:05:00' }],
    revisions: [
      revision({ revision: 1, source: '站内', party: '验收负责人', operator: '陆川', status: '待分派', content: '逐档操作发现第7档监控显示第8档，开单', evidence: ['档位差异照片.jpg'], retestRef: '—' }),
      revision({ revision: 2, source: '站内', party: '验收负责人', operator: '陆川', status: '整改中', content: '重大缺陷分派设备厂家，限期24小时', evidence: [], retestRef: '—' }),
      revision({ revision: 3, source: '离线包', party: '设备厂家', operator: '王新', status: '整改中', content: '初步判断为变送器接线松动，紧固后台体仍有偏差', evidence: ['厂家自查记录.docx'], retestRef: '—', packageId: 'PKG-260928-B' }),
      revision({ revision: 4, source: '离线包', party: '设备厂家', operator: '王新', status: '待联合复验', content: '更换档位变送器并重新校准，厂家复测17档全部正确', evidence: ['更换记录与校准报告.pdf'], retestRef: 'RT-AD-260929-01-F1', packageId: 'PKG-260929-D' }),
      revision({ revision: 5, source: '站内', party: '联合验收组', operator: '联合验收组', status: '整改中', content: '站内现场复测第11档仍有1档偏差，关闭依据不成立，退回整改', evidence: ['站内复测记录单-RT-AD-260929-01-1.pdf'], retestRef: 'RT-AD-260929-01-1' })
    ]
  },
  {
    id: 'AD-260929-02', equipmentId: 'EQ-INV11', itemId: 'IT-I2', title: '逆变器效率低于合同保证值', severity: '一般', status: '待联合复验', owner: '设备厂家（赵晶）', dueDate: '2026-10-02', version: 3, decisionNote: '',
    stationRevision: 3, vendorRevision: 3,
    lastStationChangeAt: '2026-09-28T17:10:00', lastVendorChangeAt: '2026-09-29T16:05:00',
    replies: [
      { party: '设备厂家', owner: '赵晶', content: '已更新控制固件，在相同测试条件下复测效率98.62%。', evidence: '固件版本记录与复测曲线.zip', repliedAt: '2026-09-29T16:05:00', source: '离线包', revision: 3, retestRef: 'RT-AD-260929-02-F1', packageId: 'PKG-260929-D' },
      { party: '运维单位', owner: '罗宇', content: '复测条件满足，建议联合见证。', evidence: '测试条件确认单.pdf', repliedAt: '2026-09-29T16:30:00', source: '站内', revision: 3, retestRef: '—' }
    ],
    retests: [{ round: 1, passed: false, result: '效率98.27%，未达到98.5%', tester: '联合验收组', testedAt: '2026-09-28T17:10:00' }],
    revisions: [
      revision({ revision: 1, source: '站内', party: '验收负责人', operator: '陆川', status: '整改中', content: '30分钟连续测量效率98.3%，低于98.5%保证值，开单', evidence: ['效率测试曲线.csv'], retestRef: '—' }),
      revision({ revision: 2, source: '站内', party: '联合验收组', operator: '联合验收组', status: '整改中', content: '第1轮联合复测效率98.27%，未通过', evidence: ['复测记录-轮1.pdf'], retestRef: 'RT-AD-260929-02-1' }),
      revision({ revision: 3, source: '离线包', party: '设备厂家', operator: '赵晶', status: '待联合复验', content: '更新MPPT控制固件V3.7，相同辐照条件复测效率98.62%，申请联合见证', evidence: ['固件版本记录与复测曲线.zip'], retestRef: 'RT-AD-260929-02-F1', packageId: 'PKG-260929-D' })
    ]
  }
]

// 给修订流水补稳定时间戳
seedDefects[0].revisions[0].changedAt = '2026-09-28T09:40:00'
seedDefects[0].revisions[1].changedAt = '2026-09-28T10:05:00'
seedDefects[0].revisions[2].changedAt = '2026-09-28T17:40:00'
seedDefects[0].revisions[3].changedAt = '2026-09-29T14:20:00'
seedDefects[0].revisions[4].changedAt = '2026-09-30T08:05:00'
seedDefects[1].revisions[0].changedAt = '2026-09-27T16:20:00'
seedDefects[1].revisions[1].changedAt = '2026-09-28T17:10:00'
seedDefects[1].revisions[2].changedAt = '2026-09-29T16:05:00'

export const seedAudit: AuditEntry[] = [
  { id: 'A-1', category: '计划', entityId: 'PV-2609-NW', action: '创建验收计划', operator: '陆川', detail: '建立5类设备树与18项验收要求', createdAt: '2026-09-25T08:30:00' },
  { id: 'A-2', category: '签署', entityId: 'PV-2609-NW', action: '签署交付版本V6', operator: '陆川', detail: '首轮验收结论锁定，允许缺陷整改复验', createdAt: '2026-09-28T19:10:00' },
  { id: 'A-3', category: '签署', entityId: 'PV-2609-NW', action: 'V6失效，电站退回待复核', operator: '系统', detail: 'AD-260929-02第1轮复测98.27%未达标，IT-I2转为待复验', createdAt: '2026-09-29T10:20:00' },
  { id: 'A-4', category: '离线包', entityId: 'PKG-260929-D', action: '离线包合并完成', operator: '验收组', detail: '厂家采集包（缺陷修订号R4）2项缺陷修订并入', createdAt: '2026-09-29T17:00:00' },
  { id: 'A-5', category: '签署', entityId: 'PV-2609-NW', action: '签署交付版本V7', operator: '陆川', detail: '依据厂家复测材料重新签署', createdAt: '2026-09-29T18:40:00' },
  { id: 'A-6', category: '缺陷', entityId: 'AD-260929-01', equipmentId: 'EQ-TR1', revision: 5, action: '站内复测未通过', operator: '联合验收组', detail: '第11档仍有1档偏差，V7失效退回整改，复测编号RT-AD-260929-01-1', createdAt: '2026-09-30T08:05:00' },
  { id: 'A-7', category: '签署', entityId: 'PV-2609-NW', action: 'V7失效，电站退回待复核', operator: '系统', detail: '未关闭缺陷AD-260929-01关闭依据发生变化', createdAt: '2026-09-30T08:05:00' }
]

/* ---------- 离线包 ---------- */

export function buildSeedPackages(): { packages: OfflinePackage[]; tasks: MergeTask[] } {
  const pending: OfflinePackage = {
    packageId: 'PKG-260930-A',
    vendorName: '特变电工/逆变器厂家现场服务组',
    collectedAt: '2026-09-30T07:30:00',
    defectRevision: 5,
    checksum: '',
    note: '并网前厂家回站前最后一份离线采集包：档位二次整改、接地补测、证书换发，另带1项方阵新缺陷。',
    status: '已接收待合并',
    receivedAt: '2026-09-30T09:12:00',
    items: [
      { id: 'IT-A1', equipmentId: 'EQ-AR1', status: '不合格', measured: '抽测30处，第17处0.6Ω超限', evidence: '厂家接地抽测记录30点.pdf', revision: 3 },
      { id: 'IT-A2', equipmentId: 'EQ-AR1', status: '合格', measured: '新增：支架等电位连接电阻0.08Ω', evidence: '等电位测试报告.pdf', revision: 1 }
    ],
    certificates: [
      { id: 'C-I1', equipmentId: 'EQ-INV11', name: '逆变器低电压穿越证书', issuer: '中国电科院', expiresAt: '2026-10-05', verified: true, revision: 3 }
    ],
    defects: [
      { id: 'AD-260929-01', equipmentId: 'EQ-TR1', itemId: 'IT-T2', title: '有载调压第7档监控档位不一致', severity: '重大', owner: '设备厂家（王新）', party: '设备厂家', revision: 5, changedAt: '2026-09-30T07:20:00', content: '第11档偏差为监控侧系数配置错误，已下装配置并整机17档复测合格，申请关闭。', evidence: '配置下装记录与17档复测曲线.pdf', retestRef: 'RT-AD-260929-01-F2' },
      { id: 'AD-260929-02', equipmentId: 'EQ-INV11', itemId: 'IT-I2', title: '逆变器效率低于合同保证值', severity: '一般', owner: '设备厂家（赵晶）', party: '设备厂家', revision: 4, changedAt: '2026-09-30T07:10:00', content: '固件V3.7在两个辐照区间复测效率98.61%/98.65%，附原始数据。', evidence: '双区间效率原始数据.zip', retestRef: 'RT-AD-260929-02-F2' },
      { id: 'AD-260930-03', equipmentId: 'EQ-AR1', itemId: 'IT-A2', title: '方阵支架等电位连接缺少验收记录', severity: '一般', owner: '建设单位（马工）', party: '建设单位', revision: 1, changedAt: '2026-09-30T07:35:00', content: '随包补测等电位连接，数据合格，请站内建单并安排复测。', evidence: '等电位测试报告.pdf', retestRef: '—' }
    ]
  }
  pending.checksum = checksumOf(pending)

  const merged: OfflinePackage = {
    packageId: 'PKG-260929-D',
    vendorName: '特变电工/逆变器厂家现场服务组',
    collectedAt: '2026-09-29T15:40:00',
    defectRevision: 4,
    checksum: '',
    note: '缺陷整改离线包：变送器更换校准、逆变器固件升级复测。',
    status: '已合并',
    receivedAt: '2026-09-29T16:40:00',
    items: [],
    certificates: [],
    defects: [
      { id: 'AD-260929-01', equipmentId: 'EQ-TR1', itemId: 'IT-T2', title: '有载调压第7档监控档位不一致', severity: '重大', owner: '设备厂家（王新）', party: '设备厂家', revision: 4, changedAt: '2026-09-29T14:20:00', content: '更换档位变送器并重新校准，厂家复测17档全部正确', evidence: '更换记录与校准报告.pdf', retestRef: 'RT-AD-260929-01-F1' },
      { id: 'AD-260929-02', equipmentId: 'EQ-INV11', itemId: 'IT-I2', title: '逆变器效率低于合同保证值', severity: '一般', owner: '设备厂家（赵晶）', party: '设备厂家', revision: 3, changedAt: '2026-09-29T16:05:00', content: '更新MPPT控制固件V3.7，复测效率98.62%', evidence: '固件版本记录与复测曲线.zip', retestRef: 'RT-AD-260929-02-F1' }
    ]
  }
  merged.checksum = checksumOf(merged)

  const tasks = buildMergeTasks(pending, seedEquipment, seedDefects)
  return { packages: [pending, merged], tasks }
}
