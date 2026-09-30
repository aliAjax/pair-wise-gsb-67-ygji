<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import Toast from 'primevue/toast'
import { useAcceptanceStore } from './stores/acceptance'

const route = useRoute()
const store = useAcceptanceStore()
const title = computed(() =>
  route.path.startsWith('/packages') ? '离线包接收与逐条合并'
  : route.path.startsWith('/equipment') ? '设备树与验收项'
  : route.path.startsWith('/defects') ? '缺陷闭环处置'
  : route.path.startsWith('/audit') ? '签署版本与审计追溯'
  : '并网验收总览')
onMounted(() => store.hydrate())
</script>

<template>
  <div class="app-shell">
    <aside>
      <div class="brand"><b>光</b><div><strong>并网验收工作台</strong><small>设备、测试、证书、离线包与缺陷闭环</small></div></div>
      <nav>
        <NuxtLink to="/"><span>验收总览</span><small>{{ store.stats.total }}项</small></NuxtLink>
        <NuxtLink to="/packages"><span>离线包合并</span><small>{{ store.stats.pendingMerge }}待处理{{ store.stats.failedMerge ? ` · ${store.stats.failedMerge}失败` : '' }}</small></NuxtLink>
        <NuxtLink to="/equipment"><span>设备与测试</span><small>设备树</small></NuxtLink>
        <NuxtLink to="/defects"><span>缺陷闭环</span><small>{{ store.stats.openDefects }}项未闭</small></NuxtLink>
        <NuxtLink to="/audit"><span>签署与审计</span><small>V{{ store.plant.version }}</small></NuxtLink>
      </nav>
      <div class="aside-state">
        <span>当前电站状态</span>
        <strong :class="{ danger: store.plant.status === '待复核' }">{{ store.plant.status }}</strong>
        <small v-if="store.activeSignVersion">有效签署 V{{ store.activeSignVersion.version }}</small>
        <small v-else-if="store.plant.status === '待复核'">原签署版本已失效，待复核</small>
        <small v-else>尚无有效签署版本</small>
        <small>{{ store.plant.name }}</small>
      </div>
    </aside>
    <main>
      <header class="top">
        <div><span>电站工程中心 / 验收与交付</span><h1>{{ title }}</h1></div>
        <div class="top-user"><small>验收负责人</small><strong>陆川</strong></div>
      </header>
      <div v-if="store.plant.status === '待复核'" class="reopen-banner">
        <i class="pi pi-exclamation-triangle"></i>
        原签署版本已失效，电站已退回待复核：证书有效期、验收项状态或未关闭缺陷的签署依据发生变化，请重新检查后再次签署。
      </div>
      <NuxtPage />
    </main>
    <Toast position="top-center" />
  </div>
</template>
