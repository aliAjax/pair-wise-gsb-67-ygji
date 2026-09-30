<script setup lang="ts">
import { computed, ref } from 'vue'
import Button from 'primevue/button'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import InputText from 'primevue/inputtext'
import Tag from 'primevue/tag'
import Textarea from 'primevue/textarea'
import { useToast } from 'primevue/usetoast'
import { useAcceptanceStore } from '../../stores/acceptance'
import { samplePackages } from '../../data/offlineSamples'
import type { MergeQueueItem, OfflinePackage, TraceEntry } from '../../types/domain'

const store = useAcceptanceStore()
const toast = useToast()
const traceKeyword = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const pendingText = ref(JSON.stringify(samplePackages[1], null, 2))

const packageSeverity = (status: string) => status === '已合并' ? 'success' : status === '部分成功' ? 'warn' : status === '待合并' ? 'danger' : 'secondary'
const actionSeverity = (action: string) => action === '待重试' ? 'danger' : action === '待确认冲突' ? 'warn' : 'success'
const queueRows = computed(() => store.mergeQueue.filter((item) => !store.keyword || `${item.packageId} ${item.entityId} ${item.type} ${item.reason} ${item.keptEvidence ?? ''}`.includes(store.keyword)))
const traceRows = computed<TraceEntry[]>(() => store.traces.filter((item) => {
  const path = `${item.entityType} ${item.entityId} ${item.equipmentId ?? ''} ${item.itemId ?? ''} ${item.defectId ?? ''} ${item.packageId ?? ''} ${item.action} ${item.result} ${item.evidence ?? ''} ${item.retestNo ?? ''} ${item.owner ?? ''} R${item.revision ?? ''}`
  return !traceKeyword.value || path.includes(traceKeyword.value)
}))

function receive(input: OfflinePackage) {
  const result = store.importOfflinePackage(input)
  toast.add({ severity: result.ok ? 'success' : result.duplicate ? 'warn' : 'error', summary: result.message, life: 3600 })
}

function loadSample(index: number) {
  receive(structuredClone(samplePackages[index]))
}

function openFilePicker() {
  fileInput.value?.click()
}

function handleFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result))
      receive(Array.isArray(parsed) ? parsed[0] : parsed.package ?? parsed)
    } catch (error) {
      toast.add({ severity: 'error', summary: '离线包解析失败', detail: error instanceof Error ? error.message : 'JSON格式不正确', life: 4000 })
    } finally {
      if (fileInput.value) fileInput.value.value = ''
    }
  }
  reader.readAsText(file)
}

function importText() {
  try {
    const parsed = JSON.parse(pendingText.value)
    receive(Array.isArray(parsed) ? parsed[0] : parsed.package ?? parsed)
  } catch (error) {
    toast.add({ severity: 'error', summary: '离线包解析失败', detail: error instanceof Error ? error.message : 'JSON格式不正确', life: 4000 })
  }
}

function retry(item: MergeQueueItem) {
  const result = store.retryMerge(item.id)
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 3000 })
}
function resolve(item: MergeQueueItem, decision: 'vendor' | 'station') {
  const result = store.resolveMerge(item.id, decision)
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 3000 })
}
function ignore(item: MergeQueueItem) {
  const result = store.ignoreMerge(item.id)
  toast.add({ severity: result.ok ? 'warn' : 'error', summary: result.message, life: 3000 })
}
function payloadSummary(item: MergeQueueItem) {
  const payload = item.payload as unknown as Record<string, unknown>
  return [payload.status, payload.expiresAt, payload.measured, payload.decisionNote].filter(Boolean).join(' · ')
}
function openTrace(item: TraceEntry) {
  if (item.equipmentId && item.itemId) return navigateTo(`/equipment/${item.equipmentId}`)
  if (item.defectId) return navigateTo('/defects')
}
</script>

<template>
  <section class="page merge-page">
    <div class="merge-hero">
      <div>
        <span>离线包合并与签署依据复核</span>
        <h2>厂家离线包回站合并</h2>
        <p>按包号去重入库；记录采集时间和缺陷修订号。双方均修改时保留两版，站内复测结论仍是关闭依据。</p>
      </div>
      <div class="merge-actions">
        <input ref="fileInput" type="file" accept="application/json,.json" hidden @change="handleFile" />
        <Button label="导入离线包JSON" @click="openFilePicker" />
        <Button label="载入样例A：依据更新" severity="secondary" outlined @click="loadSample(0)" />
        <Button label="载入样例B：失败可重试" severity="secondary" outlined @click="loadSample(1)" />
      </div>
    </div>

    <div class="metrics merge-metrics">
      <article><span>已入库离线包</span><strong>{{ store.packages.length }}</strong><small>重复包只入库一次</small></article>
      <article><span>待确认/失败项</span><strong>{{ store.pendingMergeCount }}</strong><small>成功回复和证据保留</small></article>
      <article><span>当前签署状态</span><strong>{{ store.activeSigning ? `V${store.plant.version}有效` : '未锁定' }}</strong><small>{{ store.plant.status }}</small></article>
      <article><span>判定轨迹</span><strong>{{ store.traces.length }}</strong><small>设备/缺陷/修订可追溯</small></article>
    </div>

    <div class="section-head">
      <div><h2>离线包记录</h2><p>每份包的采集时间、缺陷修订号、合并结果和失败原因。</p></div>
      <InputText v-model="store.keyword" placeholder="搜索包、设备、缺陷或失败原因" />
    </div>
    <DataTable :value="store.packages" dataKey="id" size="small" stripedRows>
      <Column field="id" header="离线包号" />
      <Column field="collectedAt" header="采集时间"><template #body="{ data }">{{ data.collectedAt.replace('T', ' ').slice(0, 16) }}</template></Column>
      <Column field="defectRevision" header="缺陷修订号"><template #body="{ data }">R{{ data.defectRevision }}</template></Column>
      <Column field="manufacturer" header="来源/厂家" />
      <Column header="结果"><template #body="{ data }"><Tag :value="data.status" :severity="packageSeverity(data.status)" /></template></Column>
      <Column header="成功/冲突/失败"><template #body="{ data }">{{ data.successCount }} / {{ data.conflictCount }} / {{ data.failureCount }}</template></Column>
      <Column header="未确认原因"><template #body="{ data }">{{ data.failureReasons.join('；') || '—' }}</template></Column>
    </DataTable>

    <div class="section-head offline-head"><div><h2>未确认项与冲突队列</h2><p>合并失败不丢失已成功项；失败项可从这里重试。冲突裁决只影响判定采用，不删除证据。</p></div></div>
    <DataTable :value="queueRows" dataKey="id" size="small">
      <Column field="packageId" header="包号" style="width:150px" />
      <Column field="type" header="类型" style="width:80px" />
      <Column field="entityId" header="设备/缺陷/证书" />
      <Column header="修订"><template #body="{ data }">R{{ data.revision }}</template></Column>
      <Column header="待处理动作"><template #body="{ data }"><Tag :value="data.action" :severity="actionSeverity(data.action)" /></template></Column>
      <Column header="离线内容/原因"><template #body="{ data }"><strong>{{ payloadSummary(data) }}</strong><small>{{ data.reason }}</small><small v-if="data.keptEvidence">保留证据：{{ data.keptEvidence }}</small></template></Column>
      <Column header="操作" style="width:270px">
        <template #body="{ data }">
          <Button v-if="data.action === '待重试'" label="重试" size="small" @click="retry(data)" />
          <Button v-if="data.action === '待重试'" label="暂不处理" size="small" severity="secondary" text @click="ignore(data)" />
          <template v-if="data.action === '待确认冲突'">
            <Button label="采用离线版" size="small" @click="resolve(data, 'vendor')" />
            <Button label="保留站内版" size="small" severity="secondary" text @click="resolve(data, 'station')" />
          </template>
          <Tag v-if="!['待重试', '待确认冲突'].includes(data.action)" :value="data.status" severity="success" />
        </template>
      </Column>
    </DataTable>
    <p v-if="!queueRows.length" class="empty-state">暂无未确认项。导入离线包后，失败项和双方修订会显示在这里。</p>

    <div class="revision-panel">
      <div><h3>双版缺陷修订视图</h3><p>同一缺陷两边都动过时，同时列出责任方、证据、复测编号和修订号；厂家自测不能替代站内关闭结论。</p></div>
      <div v-for="defect in store.defects.filter((item) => item.revisionViews?.length)" :key="defect.id" class="revision-card">
        <strong>{{ defect.id }} · {{ defect.title }} <Tag :value="defect.status" :severity="defect.status === '已关闭' ? 'success' : 'warn'" /></strong>
        <div class="revision-grid">
          <article v-for="view in defect.revisionViews" :key="`${view.source}-${view.revision}-${view.retestNo}`">
            <Tag :value="view.source" :severity="view.source === '站内' ? 'success' : 'info'" />
            <b>R{{ view.revision }} · {{ view.owner }}</b>
            <p>{{ view.note }}</p>
            <small>证据：{{ view.evidence || '—' }}</small>
            <small>复测编号：{{ view.retestNo || '—' }} · {{ view.status }}</small>
          </article>
        </div>
      </div>
    </div>

    <div class="manual-package">
      <div><h3>离线包文本复核</h3><p>可粘贴厂家交付的JSON内容，校验通过后入库；同一 packageId 重复提交会被拒收。</p></div>
      <Textarea v-model="pendingText" rows="8" />
      <Button label="解析并合并文本包" outlined @click="importText" />
    </div>

    <div class="section-head trace-head">
      <div><h2>沿设备、缺陷和修订追溯每次判定</h2><p>输入设备、验收项、缺陷、包号、复测编号或责任方，可重开页面后继续追查。</p></div>
      <InputText v-model="traceKeyword" placeholder="搜索设备/缺陷/修订/复测编号/证据" />
    </div>
    <DataTable :value="traceRows" dataKey="id" size="small" stripedRows>
      <Column field="createdAt" header="时间"><template #body="{ data }">{{ data.createdAt.replace('T', ' ').slice(0, 16) }}</template></Column>
      <Column field="entityType" header="对象" />
      <Column field="entityId" header="编号" />
      <Column header="链路"><template #body="{ data }"><small>{{ data.equipmentId || '—' }} / {{ data.itemId || data.defectId || '—' }} / {{ data.packageId || '—' }}</small></template></Column>
      <Column header="修订/来源"><template #body="{ data }"><Tag :value="`${data.source}${data.revision ? ` R${data.revision}` : ''}`" :severity="data.source === '站内' ? 'success' : data.source === '离线包' ? 'info' : 'secondary'" /></template></Column>
      <Column field="action" header="判定/动作" />
      <Column field="result" header="结果" />
      <Column header="证据与复测"><template #body="{ data }"><small>{{ data.evidence || '—' }}</small><small v-if="data.retestNo">复测：{{ data.retestNo }}</small></template></Column>
      <Column header=""><template #body="{ data }"><Button v-if="data.equipmentId || data.defectId" label="打开" text size="small" @click="openTrace(data)" /></template></Column>
    </DataTable>
  </section>
</template>
