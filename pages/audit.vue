<script setup lang="ts">
import { computed, ref } from 'vue'
import Button from 'primevue/button'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import Tag from 'primevue/tag'
import { useToast } from 'primevue/usetoast'
import { useAcceptanceStore } from '../stores/acceptance'

const store = useAcceptanceStore()
const toast = useToast()
const keyword = ref('')
const category = ref<string>('全部')
const traceEquipment = ref<string>('全部')
const traceDefect = ref<string>('全部')
const traceRevision = ref('')
const traceRevisionNumber = computed(() => {
  const value = Number(traceRevision.value)
  return traceRevision.value && Number.isInteger(value) ? value : null
})

const categories = ['全部', '计划', '设备', '证书', '缺陷', '离线包', '签署']
const fmt = (value?: string) => value ? value.replace('T', ' ').slice(0, 16) : '—'
const categorySeverity = (value: string) =><any>({ 签署: 'warn', 离线包: 'info', 缺陷: 'danger', 证书: 'secondary', 设备: 'secondary', 计划: 'secondary' }[value] ?? 'secondary')

const rows = computed(() => store.audit.filter((item) => {
  if (category.value !== '全部' && item.category !== category.value) return false
  if (traceEquipment.value !== '全部' && item.equipmentId !== traceEquipment.value) return false
  if (traceDefect.value !== '全部' && item.entityId !== traceDefect.value) return false
  if (traceRevisionNumber.value && item.revision !== traceRevisionNumber.value) return false
  if (keyword.value && !`${item.entityId} ${item.action} ${item.operator} ${item.detail} ${item.packageId ?? ''} ${item.revision ?? ''}`.includes(keyword.value)) return false
  return true
}))

const sign = () => {
  const result = store.signOff()
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.ok ? '签署完成' : '完整性校验未通过', detail: result.message, life: 4000 })
}
const recheck = () => {
  const result = store.registerRecheck()
  toast.add({ severity: 'success', summary: result.message, life: 2500 })
}
const exportPackage = () => {
  const payload = { plant: store.plant, signVersions: store.signVersions, equipment: store.equipment, defects: store.defects, packages: store.packages, mergeTasks: store.mergeTasks, audit: store.audit, preflight: store.preflight }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = '光伏并网验收交付包.json'; anchor.click(); URL.revokeObjectURL(url)
}
const clearTrace = () => { traceEquipment.value = '全部'; traceDefect.value = '全部'; traceRevision.value = '' }
</script>

<template>
  <section class="page">
    <div :class="['preflight-panel', { recheck: store.plant.status === '待复核' }]">
      <div>
        <span>电站状态 · 当前版本 V{{ store.plant.version }}</span>
        <strong>{{ store.plant.status === '已签署' && store.activeSignVersion ? `交付版本V${store.activeSignVersion.version}有效` : store.plant.status === '待复核' ? '原签署版本已失效，电站退回待复核' : '验收进行中' }}</strong>
        <p v-if="store.plant.status === '待复核'">证书有效期、验收项状态或未关闭缺陷依据发生变化，请重新检查后再次签署。</p>
        <template v-else>
          <p v-if="!store.preflight.allowed" v-for="item in store.preflight.blocking" :key="item">{{ item }}</p>
          <p v-else>并网前完整性校验全部满足。</p>
        </template>
      </div>
      <div class="preflight-actions">
        <Button label="导出交付包" outlined @click="exportPackage" />
        <Button v-if="store.plant.status === '待复核'" label="登记重新检查" severity="warning" outlined @click="recheck" />
        <Button label="签署并锁定新版本" :disabled="!store.preflight.allowed" @click="sign" />
      </div>
    </div>

    <div class="version-list">
      <article v-for="ver of store.signVersions" :key="ver.version" :class="{ invalid: ver.status === '已失效' }">
        <header><strong>V{{ ver.version }}</strong><Tag :value="ver.status" :severity="ver.status === '有效' ? 'success' : 'danger'" /><small>{{ fmt(ver.signedAt) }} · {{ ver.signedBy }}</small></header>
        <p>{{ ver.basis }}</p>
        <div v-if="ver.status === '已失效'" class="invalid-reason"><i class="pi pi-info-circle"></i>{{ fmt(ver.invalidatedAt) }} 失效：{{ ver.invalidReason }}</div>
      </article>
    </div>

    <div class="section-head">
      <div><h2>判定与合并审计</h2><p>重开页面可沿设备、缺陷和修订号查清每一次判定、合并与签署。</p></div>
    </div>
    <div class="trace-bar">
      <InputText v-model="keyword" placeholder="搜索动作、操作人、包号或证据" />
      <Select v-model="category" :options="categories" />
      <Select v-model="traceEquipment" :options="['全部', ...store.equipment.map(item => item.id)]" />
      <Select v-model="traceDefect" :options="['全部', ...store.defects.map(item => item.id)]" />
      <InputText v-model="traceRevision" type="number" placeholder="修订号 R" style="max-width:110px" />
      <Button label="清除追溯条件" text severity="secondary" @click="clearTrace" />
    </div>
    <DataTable :value="rows" dataKey="id" size="small" stripedRows>
      <Column field="createdAt" header="时间" style="width:140px"><template #body="{ data }">{{ fmt(data.createdAt) }}</template></Column>
      <Column field="category" header="类别" style="width:90px"><template #body="{ data }"><Tag :value="data.category" :severity="categorySeverity(data.category)" /></template></Column>
      <Column field="entityId" header="实体" style="width:150px" />
      <Column header="设备/修订" style="width:170px"><template #body="{ data }"><small>{{ data.equipmentId || '—' }}<em v-if="data.revision"> · R{{ data.revision }}</em><span v-if="data.packageId"> · {{ data.packageId }}</span></small></template></Column>
      <Column field="action" header="动作" />
      <Column field="operator" header="操作人" style="width:120px" />
      <Column field="detail" header="说明" />
    </DataTable>
  </section>
</template>
