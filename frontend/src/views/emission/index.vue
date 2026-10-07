<template>
  <section class="page" data-module="emission">
    <header class="page-head">
      <div>
        <h2>环保指标监控管理</h2>
        <p class="page-desc">维护环保监控记录，围绕监控编号、监控指标、限值要求、实测值做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记环保监控记录</button>
        <button class="btn" type="button" @click="exportRows">导出环保指标监控清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <section class="warning-ledger">
      <h3>超标预警台账（在线排放监测回写）</h3>
      <p class="page-desc">监测记录审定前判定超标即回写预警，重算转达标自动解除；审定超标的以「已审定确认」归档。</p>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in warningColumns" :key="column">{{ column }}</th>
            <th>台账状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in warningRows" :key="String(row.id)">
            <td v-for="column in warningColumns" :key="column">{{ row[column] || '—' }}</td>
            <td>{{ row.预警状态 }}</td>
          </tr>
          <tr v-if="!warningRows.length">
            <td :colspan="warningColumns.length + 1" class="empty-state">暂无由在线排放监测回写的超标预警</td>
          </tr>
        </tbody>
      </table>
    </section>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无环保指标监控数据，可先登记环保监控记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条环保指标监控记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { ensureCemsV2, listWarnings } from '@/data/cems/store'
import type { EntryRow } from '@/data/types'
import type { WarningRow } from '@/data/cems/types'

const meta = moduleMeta('emission')
const columns = ["监控编号", "监控指标", "限值要求", "实测值", "达标判定", "监控日期", "监控人员", "监控状态"]
const warningColumns = ["监控编号", "监控指标", "限值要求", "实测值", "达标判定", "来源记录", "回写时间", "更新时间", "解除时间", "审定时间"]
const actions = ["提交监控", "判定达标", "标记未达标"]
const statuses = ["待监控", "监控中", "已达标", "未达标"]
const stats = [{"label": "待监控指标", "value": 0}, {"label": "已达标指标", "value": 0}, {"label": "未达标指标", "value": 0}]

const rows = ref<EntryRow[]>([])
const warningRows = ref<WarningRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '环保监控记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    ensureCemsV2()
    warningRows.value = listWarnings()
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '环保指标监控列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.warning-ledger {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 14px;
}
.warning-ledger h3 {
  margin: 0 0 4px;
  font-size: 14px;
}
</style>
