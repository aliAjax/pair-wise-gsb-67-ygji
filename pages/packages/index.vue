<script setup lang="ts">
import { computed, ref } from 'vue'
import Button from 'primevue/button'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Dialog from 'primevue/dialog'
import Tag from 'primevue/tag'
import Textarea from 'primevue/textarea'
import { useToast } from 'primevue/usetoast'
import { useAcceptanceStore } from '../../stores/acceptance'
import { buildFollowupPackage, duplicateOf, tamperedOf } from '../../services/samplePackages'
import type { MergeTask, OfflinePackage } from '../../types/domain'

const store = useAcceptanceStore()
const toast = useToast()
const selectedPackageId = ref(store.packages[0]?.packageId ?? '')
const detail = ref<MergeTask | null>(null)
const uploadVisible = ref(false)
const rawText = ref('')

const selectedPackage = computed(() => store.packages.find((item) => item.packageId === selectedPackageId.value) ?? null)
const taskRows = computed(() => store.mergeTasks.filter((item) => item.packageId === selectedPackageId.value))

function packageSeverity(status: string) {
  return status === '已合并' ? 'success' : status === '部分失败' ? 'danger' : 'warn'
}
function taskSeverity(status: string) {
  return status === '已合并' ? 'success' : status === '合并失败' ? 'danger' : status === '冲突待裁决' ? 'warning' : 'info'
}
function fmt(value: string) { return value ? value.replace('T', ' ').slice(0, 16) : '—' }

function receive(pkg: OfflinePackage) {
  const result = store.ingestPackage(structuredClone(pkg))
  toast.add({ severity: result.ok ? 'success' : result.message.includes('校验') ? 'error' : 'warn', summary: result.message, life: 3500 })
  if (result.ok) selectedPackageId.value = pkg.packageId
}
function loadDuplicate() { const pkg = store.packages.find((item) => item.packageId === 'PKG-260930-A'); if (pkg) receive(duplicateOf(pkg)) }
function loadTampered() { const pkg = store.packages.find((item) => item.packageId === 'PKG-260930-A'); if (pkg) receive(tamperedOf(pkg)) }
function loadFollowup() { receive(buildFollowupPackage()) }
function importRaw() {
  try {
    const parsed = JSON.parse(rawText.value) as OfflinePackage
    receive(parsed)
    uploadVisible.value = false
  } catch {
    toast.add({ severity: 'error', summary: '离线包解析失败，请检查JSON格式', life: 3000 })
  }
}
function onFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  file.text().then((text) => { rawText.value = text; importRaw() }).catch(() => toast.add({ severity: 'error', summary: '文件读取失败', life: 2500 }))
}

function openTask(task: MergeTask) { detail.value = task }
function decide(side: '站内' | '离线包') {
  if (!detail.value) return
  const result = store.resolveTask(detail.value.id, side)
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 3200 })
  if (result.ok) detail.value = null
}
function apply(task: MergeTask) {
  const result = store.resolveTask(task.id)
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 3200 })
}
function retry(task: MergeTask) {
  const result = store.retryTask(task.id)
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 3200 })
}
function applyAll() {
  if (!selectedPackage.value) return
  const result = store.resolvePackage(selectedPackage.value.packageId)
  toast.add({ severity: 'success', summary: result.message, life: 3500 })
}
</script>

<template>
  <section class="page">
    <div class="section-head">
      <div><h2>离线包合并</h2><p>厂家回站离线包按采集时间与缺陷修订号逐条并入；重复包只入库一次，校验和不符整包拒收。</p></div>
      <div class="head-actions">
        <Button label="载入示例：重复包" severity="secondary" outlined size="small" @click="loadDuplicate" />
        <Button label="载入示例：篡改包" severity="secondary" outlined size="small" @click="loadTampered" />
        <Button label="载入示例：新离线包" outlined size="small" @click="loadFollowup" />
        <Button label="导入离线包文件" size="small" @click="uploadVisible = true" />
      </div>
    </div>

    <div class="package-grid">
      <article v-for="pkg in store.packages" :key="pkg.packageId" :class="{ active: pkg.packageId === selectedPackageId }" @click="selectedPackageId = pkg.packageId">
        <div class="pkg-top"><strong>{{ pkg.packageId }}</strong><Tag :value="pkg.status" :severity="packageSeverity(pkg.status)" /></div>
        <p>{{ pkg.note }}</p>
        <dl>
          <div><dt>采集时间</dt><dd>{{ fmt(pkg.collectedAt) }}</dd></div>
          <div><dt>缺陷修订号</dt><dd>R{{ pkg.defectRevision }}</dd></div>
          <div><dt>厂家</dt><dd>{{ pkg.vendorName }}</dd></div>
          <div><dt>接收时间</dt><dd>{{ fmt(pkg.receivedAt) }}</dd></div>
        </dl>
        <small>校验和 {{ pkg.checksum }} · 验收项{{ pkg.items.length }} / 证书{{ pkg.certificates.length }} / 缺陷{{ pkg.defects.length }}</small>
      </article>
    </div>

    <template v-if="selectedPackage">
      <div class="toolbar">
        <strong>{{ selectedPackage.packageId }} 合并条目（{{ taskRows.length }}）</strong>
        <span class="grow" />
        <Button label="一键并入全部待确认项（失败项自动重试）" size="small" @click="applyAll" />
      </div>
      <DataTable :value="taskRows" dataKey="id" size="small" stripedRows>
        <Column field="id" header="任务号" style="width:90px" />
        <Column field="entityType" header="类型" style="width:80px" />
        <Column field="title" header="条目" />
        <Column header="站内"><template #body="{ data }"><Tag v-if="data.station" :value="`R${data.station.revision} · ${data.station.status}`" severity="secondary" /><span v-else class="muted">无记录</span></template></Column>
        <Column header="离线包"><template #body="{ data }"><Tag v-if="data.vendor" :value="`R${data.vendor.revision} · ${data.vendor.status}`" /><span v-else class="muted">无记录</span></template></Column>
        <Column field="reason" header="判定" />
        <Column header="状态" style="width:120px"><template #body="{ data }"><Tag :value="data.status" :severity="taskSeverity(data.status)" /></template></Column>
        <Column header="" style="width:230px">
          <template #body="{ data }">
            <Button v-if="data.status === '已合并'" label="查看" text size="small" @click="openTask(data)" />
            <template v-else>
              <Button label="对比/裁决" text size="small" @click="openTask(data)" />
              <Button v-if="data.status === '合并失败'" label="重试" severity="warning" text size="small" @click="retry(data)" />
              <Button v-else-if="!data.conflict" label="并入" severity="success" text size="small" @click="apply(data)" />
            </template>
          </template>
        </Column>
      </DataTable>
    </template>

    <Dialog :visible="!!detail" header="合并条目双侧对比" modal :style="{ width: '820px' }" @update:visible="(value: boolean) => { if (!value) detail = null }">
      <div v-if="detail" class="compare">
        <p class="compare-reason">{{ detail.reason }} <small>尝试 {{ detail.attempts }} 次 · {{ detail.lastError }}</small></p>
        <div class="compare-cols">
          <section class="side station">
            <header><Tag value="站内记录" severity="secondary" /><strong v-if="detail.station">R{{ detail.station.revision }}</strong><span v-else>无记录</span></header>
            <template v-if="detail.station">
              <p><b>状态</b>{{ detail.station.status }}</p>
              <p><b>责任方</b>{{ detail.station.owner }}</p>
              <p v-if="detail.station.measured"><b>实测</b>{{ detail.station.measured }}</p>
              <p v-if="detail.station.expiresAt"><b>有效期至</b>{{ detail.station.expiresAt }}</p>
              <p v-if="detail.station.content"><b>说明</b>{{ detail.station.content }}</p>
              <p v-if="detail.station.evidence.length"><b>证据</b><span v-for="(e, i) in detail.station.evidence" :key="i">{{ e }}</span></p>
              <p v-if="detail.station.retestRef"><b>复测编号</b>{{ detail.station.retestRef }}</p>
              <p class="muted">最近变动 {{ fmt(detail.station.changedAt) }}</p>
            </template>
          </section>
          <section class="side vendor">
            <header><Tag value="离线包" /><strong v-if="detail.vendor">R{{ detail.vendor.revision }}</strong><span v-else>无记录</span></header>
            <template v-if="detail.vendor">
              <p><b>状态</b>{{ detail.vendor.status }}</p>
              <p><b>责任方</b>{{ detail.vendor.owner }}</p>
              <p v-if="detail.vendor.measured"><b>实测</b>{{ detail.vendor.measured }}</p>
              <p v-if="detail.vendor.expiresAt"><b>有效期至</b>{{ detail.vendor.expiresAt }}</p>
              <p v-if="detail.vendor.content"><b>说明</b>{{ detail.vendor.content }}</p>
              <p v-if="detail.vendor.evidence.length"><b>证据</b><span v-for="(e, i) in detail.vendor.evidence" :key="i">{{ e }}</span></p>
              <p v-if="detail.vendor.retestRef"><b>复测编号</b>{{ detail.vendor.retestRef }}</p>
              <p class="muted">采集时间 {{ fmt(detail.vendor.changedAt) }}</p>
            </template>
          </section>
        </div>
        <p class="close-note" v-if="detail.entityType === '缺陷'">同一缺陷两边都动过时两版均保留；厂家复测只进入待联合复验，<b>缺陷关闭仍以站内复测结论为唯一依据</b>。</p>
      </div>
      <template #footer>
        <template v-if="detail && detail.status !== '已合并'">
          <Button v-if="detail.status === '合并失败'" label="重试该失败项" severity="warning" @click="retry(detail); detail = store.mergeTasks.find(t => t.id === detail?.id) ?? null" />
          <template v-else>
            <Button v-if="detail.conflict" label="裁决：以站内版为准（两版留存）" severity="secondary" @click="decide('站内')" />
            <Button :label="detail.conflict ? '裁决：以离线包为准（两版留存）' : '确认并入（回复与证据保留）'" :severity="detail.conflict ? 'info' : 'success'" @click="decide('离线包')" />
          </template>
        </template>
        <Button label="关闭" text severity="secondary" @click="detail = null" />
      </template>
    </Dialog>

    <Dialog v-model:visible="uploadVisible" header="导入厂家离线包" modal :style="{ width: '640px' }">
      <label class="file-pick">
        <input type="file" accept=".json,application/json" @change="onFile" />
        <Button as="span" label="选择离线包JSON文件" severity="secondary" outlined size="small" />
      </label>
      <p class="muted" style="margin:10px 0 6px">或粘贴离线包内容：</p>
      <Textarea v-model="rawText" rows="8" style="width:100%" placeholder='{"packageId":"PKG-...","collectedAt":"...","defectRevision":...,"checksum":"ck-..."}' />
      <template #footer><Button label="取消" text severity="secondary" @click="uploadVisible = false" /><Button label="校验并接收" @click="importRaw" /></template>
    </Dialog>
  </section>
</template>
