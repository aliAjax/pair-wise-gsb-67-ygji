import type { OfflinePackage } from '../types/domain'

export const samplePackages: OfflinePackage[] = [
  {
    packageId: 'PKG-20260930-A',
    collectedAt: '2026-09-30T08:30:00',
    defectRevision: 3,
    manufacturer: '设备厂家驻场组',
    changes: {
      items: [
        {
          equipmentId: 'EQ-INV11', id: 'IT-I2', status: '合格', measured: '固件V4.2复测30分钟，效率98.62%',
          evidence: '厂家效率复测曲线-98.62%.csv', revision: 3, collectedAt: '2026-09-30T08:10:00'
        }
      ],
      certificates: [
        {
          equipmentId: 'EQ-INV11', id: 'C-I1', name: '逆变器低电压穿越证书', issuer: '中国电科院',
          expiresAt: '2029-06-30', verified: true, revision: 3, collectedAt: '2026-09-30T08:05:00'
        }
      ],
      defects: [
        {
          id: 'AD-260929-02', equipmentId: 'EQ-INV11', itemId: 'IT-I2', owner: '设备厂家', status: '待联合复验',
          decisionNote: '固件已更新，等待站内联合复测关闭', revision: 4, collectedAt: '2026-09-30T08:15:00',
          replies: [{
            party: '设备厂家', owner: '赵晶', content: '控制固件V4.2复测效率98.62%，证据包已随离线包带回。',
            evidence: '固件V4.2记录与效率曲线.zip', repliedAt: '2026-09-30T08:12:00'
          }],
          retests: [{
            retestNo: 'VRT-RT-0930-02', passed: true, result: '厂家自测效率98.62%，曲线完整',
            tester: '厂家质量员周岚', testedAt: '2026-09-30T08:10:00'
          }]
        }
      ]
    }
  },
  {
    packageId: 'PKG-20260930-B',
    collectedAt: '2026-09-30T10:45:00',
    defectRevision: 4,
    manufacturer: '设备厂家驻场组',
    changes: {
      defects: [
        {
          id: 'AD-260929-01', equipmentId: 'EQ-TR1', itemId: 'IT-T2', owner: '设备厂家', status: '待联合复验',
          decisionNote: '变送器更换后厂家校准合格，请站内复测第7档', revision: 5, collectedAt: '2026-09-30T10:20:00',
          replies: [{
            party: '设备厂家', owner: '王新', content: '更换档位变送器并完成就地17档全行程校准。',
            evidence: '变送器更换单与17档校准记录.pdf', repliedAt: '2026-09-30T10:10:00'
          }],
          retests: [{
            retestNo: 'TR-RT-0930-01', passed: true, result: '厂家就地核对17档，第7档显示一致',
            tester: '厂家调试员郑凯', testedAt: '2026-09-30T10:15:00'
          }]
        },
        {
          id: 'AD-MISSING-99', revision: 2, collectedAt: '2026-09-30T10:25:00',
          replies: [{
            party: '设备厂家', owner: '待匹配', content: '离线包中的未确认缺陷，重试前不覆盖站内数据。',
            evidence: '未确认缺陷证据.xlsx', repliedAt: '2026-09-30T10:24:00'
          }]
        }
      ]
    }
  }
]
