<script setup lang="ts">
import { computed, ref } from 'vue'
import Button from 'primevue/button'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import InputText from 'primevue/inputtext'
import Tag from 'primevue/tag'
import { useToast } from 'primevue/usetoast'
import { useAcceptanceStore } from '../stores/acceptance'

const store = useAcceptanceStore()
const toast = useToast()
const keyword = ref('')
const rows = computed(() => store.audit.filter((item) => !keyword.value || `${item.entityId} ${item.action} ${item.operator} ${item.detail} ${item.packageId ?? ''}`.includes(keyword.value)))
const sign = () => {
  const result = store.signOff()
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.ok ? '签署完成' : '完整性校验未通过', detail: result.message, life: 4500 })
}
const quickComplete = () => {
  store.quickCompleteForDemo()
  toast.add({ severity: 'success', summary: '已生成演示可签署状态', detail: '站内复测和复核记录已补齐，可再次签署', life: 3000 })
}
const exportPackage = () => {
  const payload = { plant: store.plant, equipment: store.equipment, defects: store.defects, packages: store.packages, mergeQueue: store.mergeQueue, signings: store.signings, traces: store.traces, audit: store.audit, preflight: store.preflight }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `光伏并网验收交付包-V${store.plant.version}.json`; anchor.click(); URL.revokeObjectURL(url)
}
</script>

<template>
  <section class="page">
    <div class="preflight-panel">
      <div><span>并网前完整性校验</span><strong>{{ store.preflight.allowed ? '全部条件满足' : `${store.preflight.blocking.length}项阻断` }}</strong><p v-for="item in store.preflight.blocking" :key="item">{{ item }}</p></div>
      <div class="sign-actions"><Button label="导出交付包" outlined @click="exportPackage" /><Button label="生成演示可签署状态" severity="secondary" text @click="quickComplete" /><Button label="签署并锁定版本" @click="sign" /></div>
    </div>

    <div class="section-head"><div><h2>签署版本</h2><p>证书有效期、验收项状态或未关闭缺陷变化后，当前有效签署版本自动失效并退回待复核。</p></div></div>
    <DataTable :value="store.signings" dataKey="id" size="small" class="signing-table">
      <Column field="id" header="版本" />
      <Column field="signedAt" header="签署时间"><template #body="{ data }">{{ data.signedAt.replace('T', ' ').slice(0, 16) }}</template></Column>
      <Column field="signer" header="签署人" />
      <Column header="状态"><template #body="{ data }"><Tag :value="data.status" :severity="data.status === '有效' ? 'success' : 'danger'" /></template></Column>
      <Column header="失效依据"><template #body="{ data }">{{ data.invalidReason || '—' }}<small v-if="data.invalidatedAt"> · {{ data.invalidatedAt.replace('T', ' ').slice(0, 16) }}</small></template></Column>
    </DataTable>
    <p v-if="!store.signings.length" class="empty-state">尚无签署版本；当前数据V{{ store.plant.version }}通过完整性校验后可签署锁定。</p>

    <div class="section-head audit-head"><div><h2>验收审计</h2><p>当前交付版本 V{{ store.plant.version }} · {{ store.plant.status }}</p></div><InputText v-model="keyword" placeholder="搜索实体、动作、包号或操作人" /></div>
    <DataTable :value="rows" dataKey="id" size="small">
      <Column field="createdAt" header="时间"><template #body="{ data }">{{ data.createdAt.replace('T', ' ').slice(0, 16) }}</template></Column>
      <Column field="entityId" header="实体" />
      <Column field="action" header="动作"><template #body="{ data }"><Tag :value="data.action" /></template></Column>
      <Column field="operator" header="操作人" />
      <Column field="detail" header="说明" />
      <Column header="关联"><template #body="{ data }">{{ data.equipmentId || data.defectId || data.itemId || data.packageId || '—' }}<template v-if="data.revision"> · R{{ data.revision }}</template></template></Column>
    </DataTable>
  </section>
</template>
