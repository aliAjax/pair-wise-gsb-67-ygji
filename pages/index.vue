<script setup lang="ts">
import { computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import Button from 'primevue/button'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import InputText from 'primevue/inputtext'
import { useAcceptanceStore } from '../stores/acceptance'
import { loadEquipmentSnapshot } from '../services/api'

const store = useAcceptanceStore()
const { isFetching } = useQuery({ queryKey: ['equipment-snapshot'], queryFn: () => loadEquipmentSnapshot(store.equipment), staleTime: 60000 })
const rows = computed(() => store.equipment.filter((node) => {
  const items = node.items.map((item) => `${item.id} ${item.standard} ${item.status}`).join(' ')
  return !store.keyword || `${node.id} ${node.name} ${node.code} ${node.type} ${items}`.includes(store.keyword)
}))
const navigate = (id: string) => navigateTo(`/equipment/${id}`)
const fmt = (value?: string) => value ? value.replace('T', ' ').slice(0, 16) : '—'
</script>

<template>
  <section class="page">
    <div class="metrics">
      <article><span>验收项</span><strong>{{ store.stats.total }}</strong><small>按设备树逐项检查</small></article>
      <article><span>已合格</span><strong>{{ store.stats.passed }}</strong><small>测试条件与证据齐全</small></article>
      <article><span>不合格或待复验</span><strong>{{ store.stats.failed }}</strong><small>不可直接签署</small></article>
      <article><span>未闭环缺陷</span><strong>{{ store.stats.openDefects }}</strong><small>站内复测才能关闭</small></article>
      <article><span>离线包待合并</span><strong :class="{ warn: store.stats.failedMerge }">{{ store.stats.pendingMerge }}</strong><small>{{ store.stats.failedMerge }}条失败可重试</small></article>
    </div>

    <div v-if="store.plant.status === '待复核'" class="overview-banner">
      <div><strong>电站处于待复核</strong><p>最近失效：{{ store.signVersions[0]?.invalidReason }}</p></div>
      <Button label="去处理离线包合并" @click="navigateTo('/packages')" />
    </div>

    <div class="toolbar">
      <InputText v-model="store.keyword" placeholder="搜索设备、编号、验收项或状态" />
      <span>{{ isFetching ? '正在同步' : '设备快照已加载' }}</span>
      <span class="grow" />
      <Button label="恢复演示数据" severity="secondary" outlined @click="store.reset" />
    </div>

    <div class="split-panels">
      <DataTable :value="rows" dataKey="id" size="small" stripedRows>
        <Column field="id" header="设备节点" />
        <Column field="name" header="名称" />
        <Column field="type" header="类型" />
        <Column header="验收项">
          <template #body="{ data }">{{ data.items.filter((item: any) => item.status === '合格').length }} / {{ data.items.length }} 合格</template>
        </Column>
        <Column header="证书">
          <template #body="{ data }">{{ data.certificates.length }}份 · {{ data.certificates.filter((item: any) => !item.verified).length }}份待核</template>
        </Column>
        <Column header="状态"><template #body="{ data }"><Tag :value="data.status" :severity="data.status === '已验收' ? 'success' : data.status === '验收中' ? 'warn' : 'secondary'" /></template></Column>
        <Column header=""><template #body="{ data }"><Button label="打开" text @click="navigate(data.id)" /></template></Column>
      </DataTable>

      <aside class="side-panel">
        <h3>签署版本</h3>
        <div v-for="ver of store.signVersions" :key="ver.version" class="ver-row">
          <Tag :value="`V${ver.version} ${ver.status}`" :severity="ver.status === '有效' ? 'success' : 'danger'" />
          <small>{{ fmt(ver.signedAt) }}</small>
          <p v-if="ver.status === '已失效'">{{ ver.invalidReason }}</p>
        </div>
        <h3>最近接收离线包</h3>
        <div v-for="pkg of store.packages.slice(0, 3)" :key="pkg.packageId" class="pkg-row" @click="navigateTo('/packages')">
          <strong>{{ pkg.packageId }}</strong>
          <small>采集 {{ fmt(pkg.collectedAt) }} · 缺陷R{{ pkg.defectRevision }}</small>
          <Tag :value="pkg.status" :severity="pkg.status === '已合并' ? 'success' : pkg.status === '部分失败' ? 'danger' : 'warn'" />
        </div>
      </aside>
    </div>
  </section>
</template>
