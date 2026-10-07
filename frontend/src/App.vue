<template>
  <div class="app-shell">
    <aside class="app-side">
      <h1 class="app-title">生活垃圾焚烧发电厂运行管理平台</h1>
      <nav class="nav-list">
        <RouterLink v-for="item in navItems" :key="item.path" :to="item.path" class="nav-item">
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>
    <main class="app-main">
      <header class="app-head">
        <span class="head-desc">面向垃圾进厂计量、垃圾池管理、焚烧炉与余热锅炉运行、汽轮发电机组、烟气净化与在线排放监测、飞灰固化与炉渣处理、渗滤液处理、设备点检检修与值班交接的一体化生活垃圾焚烧发电厂运行管理工作台。</span>
        <div class="head-session">
          <label class="session-item">
            <span>当前岗位</span>
            <select :value="store.postCode" @change="onPostChange">
              <option v-for="post in posts" :key="post.code" :value="post.code">
                {{ post.name }}{{ post.devices.length ? `（${post.devices.join('、')}）` : '（无采集设备）' }}
              </option>
            </select>
          </label>
          <label class="session-item">
            <span>操作人</span>
            <input :value="store.operator" @change="onOperatorChange" />
          </label>
          <span class="head-user">{{ store.shiftLabel }}</span>
        </div>
      </header>
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { POSTS } from '@/data/cems'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const posts = POSTS

function onPostChange(event: Event) {
  store.setPost((event.target as HTMLSelectElement).value)
}

function onOperatorChange(event: Event) {
  store.setOperator((event.target as HTMLInputElement).value)
}

const navItems = [{ label: "运营概览", path: "/" }, { label: "垃圾进厂计量", path: "/weighbridge" }, { label: "垃圾池管理", path: "/pit" }, { label: "焚烧炉运行", path: "/incinerator" }, { label: "余热锅炉运行", path: "/boiler" }, { label: "汽轮发电机组", path: "/turbine" }, { label: "烟气净化运行", path: "/fluegas" }, { label: "在线排放监测", path: "/cems" }, { label: "飞灰固化处置", path: "/flyash" }, { label: "炉渣处理", path: "/slag" }, { label: "渗滤液处理", path: "/leachate" }, { label: "设备点检", path: "/equipcheck" }, { label: "设备检修管理", path: "/overhaul" }, { label: "备件台账管理", path: "/spare" }, { label: "发电量统计", path: "/powerstat" }, { label: "环保指标监控", path: "/emission" }, { label: "值班交接班", path: "/shift" }, { label: "应急预案管理", path: "/safetyplan" }, { label: "安全培训管理", path: "/training" }]
</script>

<style scoped>
.head-session {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  white-space: nowrap;
}
.session-item {
  display: flex;
  flex-direction: column;
  font-size: 11px;
  color: var(--muted);
  gap: 2px;
}
.session-item select,
.session-item input {
  font-size: 12px;
  padding: 3px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
}
</style>
