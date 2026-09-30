<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import Button from 'primevue/button'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import Tag from 'primevue/tag'
import Textarea from 'primevue/textarea'
import { useToast } from 'primevue/usetoast'
import { useAcceptanceStore } from '../stores/acceptance'
import type { AcceptanceDefect, PartyReply } from '../types/domain'

const store = useAcceptanceStore()
const toast = useToast()
const selected = ref<AcceptanceDefect | null>(null)
const replyVisible = ref(false)
const retestVisible = ref(false)
const reply = reactive<PartyReply>({ party: '设备厂家', owner: '', content: '', evidence: '', repliedAt: new Date().toISOString() })
const retest = reactive({ result: '', passed: true, note: '' })
const rows = computed(() => store.defects.filter((item) => !store.keyword || `${item.id} ${item.title} ${item.owner} ${item.status}`.includes(store.keyword)))
const equipmentName = (id: string) => store.equipment.find((item) => item.id === id)?.name ?? id
function open(defect: AcceptanceDefect) {
  selected.value = store.defects.find((item) => item.id === defect.id) ?? defect
}
const timeline = computed(() => selected.value ? [...selected.value.revisions].sort((a, b) => b.revision - a.revision || (a.source < b.source ? 1 : -1)) : [])
function fmt(value: string) { return value ? value.replace('T', ' ').slice(0, 16) : '—' }
function submitReply() {
  if (!selected.value) return
  const result = store.addReply(selected.value.id, { ...reply, repliedAt: new Date().toISOString() })
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 2500 })
  if (result.ok) replyVisible.value = false
}
function submitRetest() {
  if (!selected.value || !retest.result) return
  const result = store.addRetest(selected.value.id, retest.result, retest.passed)
  toast.add({ severity: result.ok ? 'success' : 'warn', summary: result.message ?? '', life: 3000 })
  retestVisible.value = false
}
function decide(status: '已关闭' | '带条件通过' | '整改中') {
  if (!selected.value) return
  const result = store.decideDefect(selected.value.id, status, retest.note)
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 3000 })
}
</script>

<template>
  <section class="page">
    <div class="section-head"><div><h2>缺陷闭环处置</h2><p>站内修订与厂家离线包修订沿修订号并行留痕；厂家复测只作为证据，站内复测结论才是关闭依据。</p></div><InputText v-model="store.keyword" placeholder="搜索缺陷、责任方或状态" /></div>
    <DataTable :value="rows" dataKey="id" size="small" selectionMode="single" @rowSelect="(event: any) => open(event.data)">
      <Column field="id" header="编号" />
      <Column field="title" header="缺陷" />
      <Column header="设备"><template #body="{ data }">{{ equipmentName(data.equipmentId) }}</template></Column>
      <Column field="severity" header="严重度"><template #body="{ data }"><Tag :value="data.severity" :severity="data.severity === '重大' ? 'danger' : 'warn'" /></template></Column>
      <Column field="owner" header="责任方" />
      <Column field="dueDate" header="截止" />
      <Column header="状态"><template #body="{ data }"><Tag :value="data.status" :severity="data.status === '已关闭' ? 'success' : data.status === '带条件通过' ? 'info' : 'warn'" /></template></Column>
      <Column header="修订号" style="width:150px"><template #body="{ data }"><small>站内 R{{ data.stationRevision }} / 厂家 R{{ data.vendorRevision }}</small></template></Column>
    </DataTable>
    <div v-if="selected" class="detail-panel">
      <div class="detail-title">
        <div><span>{{ selected.id }} · {{ equipmentName(selected.equipmentId) }} · {{ selected.itemId }}</span><h3>{{ selected.title }}</h3></div>
        <div><Button label="多方回复" outlined @click="replyVisible = true" /><Button label="站内联合复测" @click="retestVisible = true" /></div>
      </div>

      <h4 class="sub-title">责任方回复与证据</h4>
      <div class="reply-list">
        <article v-for="item in selected.replies" :key="`${item.repliedAt}-${item.source}-${item.evidence}`">
          <Tag :value="item.party" :severity="item.source === '站内' ? 'secondary' : 'info'" />
          <strong>{{ item.owner }}</strong>
          <p>{{ item.content }}</p>
          <div class="reply-meta">
            <Tag :value="item.source === '站内' ? `站内 R${item.revision}` : `离线包 R${item.revision}`" :severity="item.source === '站内' ? 'secondary' : 'warn'" />
            <span>{{ item.evidence }}</span>
            <span v-if="item.retestRef">复测编号 {{ item.retestRef }}</span>
            <span v-if="item.packageId">{{ item.packageId }}</span>
            <small>{{ fmt(item.repliedAt) }}</small>
          </div>
        </article>
      </div>

      <h4 class="sub-title">判定时间线（沿修订号追溯每次判定）</h4>
      <div class="timeline">
        <div v-for="rev in timeline" :key="`${rev.source}-${rev.revision}-${rev.changedAt}`" :class="['tl-item', rev.source === '站内' ? 'station' : 'vendor']">
          <div class="tl-badge"><Tag :value="rev.source" :severity="rev.source === '站内' ? 'secondary' : 'warn'" /><strong>R{{ rev.revision }}</strong></div>
          <div class="tl-body">
            <div class="tl-head"><Tag :value="rev.status" severity="info" /><b>{{ rev.party }} · {{ rev.operator }}</b><small>{{ fmt(rev.changedAt) }}</small><Tag v-if="rev.packageId" :value="rev.packageId" severity="secondary" /></div>
            <p>{{ rev.content }}</p>
            <div class="tl-evidence"><span v-for="(e, i) in rev.evidence" :key="i"><i class="pi pi-paperclip"></i>{{ e }}</span><em v-if="rev.retestRef !== '—'">复测编号 {{ rev.retestRef }}</em></div>
          </div>
        </div>
      </div>

      <div class="decision-band"><Textarea v-model="retest.note" rows="2" placeholder="验收决定说明，带条件接受时必须填写限制条件" /><Button label="通过并关闭（须有合格站内复测）" @click="decide('已关闭')" /><Button label="带条件接受" severity="secondary" outlined @click="decide('带条件通过')" /><Button label="退回整改" severity="danger" outlined @click="decide('整改中')" /></div>
    </div>
    <Dialog v-model:visible="replyVisible" header="提交多方处理说明" modal :style="{ width: '580px' }">
      <div class="edit-grid">
        <label>责任方<Select v-model="reply.party" :options="['建设单位', '设备厂家', '运维单位']" /></label>
        <label>回复人<InputText v-model="reply.owner" /></label>
        <label>处理说明<Textarea v-model="reply.content" rows="4" /></label>
        <label>证据附件<InputText v-model="reply.evidence" placeholder="整改记录或报告名称" /></label>
      </div>
      <template #footer><Button label="取消" text severity="secondary" @click="replyVisible = false" /><Button label="提交并进入复验" @click="submitReply" /></template>
    </Dialog>
    <Dialog v-model:visible="retestVisible" header="登记站内联合复测（关闭依据）" modal :style="{ width: '520px' }">
      <div class="edit-grid"><label>复测结果<Textarea v-model="retest.result" rows="4" /></label><label>结论<Select v-model="retest.passed" :options="[{ label: '通过并关闭缺陷', value: true }, { label: '不通过，退回整改', value: false }]" /></label></div>
      <template #footer><Button label="取消" text severity="secondary" @click="retestVisible = false" /><Button label="提交复测轮次" @click="submitRetest" /></template>
    </Dialog>
  </section>
</template>
