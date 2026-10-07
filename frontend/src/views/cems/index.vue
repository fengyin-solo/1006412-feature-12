<template>
  <section class="page cems-page" data-module="cems">
    <header class="page-head">
      <div>
        <h2>在线排放监测管理</h2>
        <p class="page-desc">
          监测记录只认采集设备所在的岗位；监测因子、排放限值对其他岗位只读；审定后整份锁定；
          限值调整只重算未审定记录；超标结论自动回写环保监控预警台账。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openRegister">登记排放监测记录</button>
        <button class="btn" type="button" @click="exportRows">导出清单</button>
      </div>
    </header>

    <!-- 当前岗位身份：换岗位即可验证跨岗位改动被打回 -->
    <div class="identity-bar">
      <label class="identity-item">
        <span>当前岗位</span>
        <select :value="store.post" @change="switchPost(($event.target as HTMLSelectElement).value)">
          <option v-for="post in allPosts" :key="post" :value="post">{{ post }}</option>
        </select>
      </label>
      <label class="identity-item">
        <span>操作人</span>
        <input :value="store.operator" @change="setOperator(($event.target as HTMLSelectElement).value)" />
      </label>
      <span class="identity-tip">所有改动尝试（含被打回的）都会记进留痕台账，可按岗位/操作人倒查。</span>
    </div>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value" :class="{ alert: item.label.includes('超标') && item.value > 0 }">{{ item.value }}</strong>
      </article>
    </div>

    <nav class="tab-bar">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab"
        :class="{ active: activeTab === tab.key }"
        type="button"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </nav>

    <p v-if="message" class="result-banner" :class="messageOk ? 'ok' : 'error-text'">{{ message }}</p>

    <!-- 监测记录 -->
    <div v-show="activeTab === 'records'">
      <p class="status-legend">
        <span v-for="item in statusSummary" :key="item.status" class="legend-item">
          {{ item.status }}：{{ item.count }}
        </span>
      </p>

      <form class="filter-bar" @submit.prevent="reload">
        <label class="filter-item">
          <span>监测编号</span>
          <input v-model="filters.监测编号" placeholder="按监测编号检索" />
        </label>
        <label class="filter-item">
          <span>监测因子</span>
          <input v-model="filters.监测因子" placeholder="按监测因子检索" />
        </label>
        <label class="filter-item">
          <span>归属岗位</span>
          <select v-model="filters.归属岗位">
            <option value="">全部</option>
            <option v-for="post in cemsPosts" :key="post" :value="post">{{ post }}</option>
          </select>
        </label>
        <label class="filter-item">
          <span>状态</span>
          <select v-model="filters.状态">
            <option value="">全部</option>
            <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
          </select>
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      </form>

      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>锁定</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="String(row.id)" :class="{ locked: row.锁定 }">
            <td v-for="column in columns" :key="column">{{ row[column] === '' ? '—' : row[column] }}</td>
            <td>
              <span v-if="row.锁定" class="tag tag-lock">已锁定</span>
              <span v-else class="tag tag-open">可改</span>
            </td>
            <td class="row-actions">
              <button v-if="row.status === '待采集'" class="link" type="button" @click="openCollect(row)">提交采集</button>
              <button v-if="row.status === '已采集'" class="link" type="button" @click="openEdit(row)">编辑</button>
              <button v-if="row.status === '已采集'" class="link approve" type="button" @click="approve(row)">审定</button>
              <button v-if="Number(row.重算次数) > 0" class="link diff" type="button" @click="openDiff(row)">重算差异</button>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 2" class="empty-state">暂无符合条件的监测记录</td>
          </tr>
        </tbody>
      </table>
      <footer class="page-foot"><span>共 {{ rows.length }} 条监测记录</span></footer>
    </div>

    <!-- 环保监控预警台账（超标结论回写） -->
    <div v-show="activeTab === 'warnings'">
      <p class="page-desc">监测记录判定为超标的，自动回写到这里（同一份数据也展示在「环保指标监控」模块）。</p>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in warningColumns" :key="column">{{ column }}</th>
            <th>台账状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in warnings" :key="String(row.id)" :class="{ resolved: row.预警状态 === '已解除' }">
            <td v-for="column in warningColumns" :key="column">{{ row[column] || '—' }}</td>
            <td>
              <span class="tag" :class="warningTagClass(row.预警状态)">{{ row.预警状态 }}</span>
            </td>
          </tr>
          <tr v-if="!warnings.length">
            <td :colspan="warningColumns.length + 1" class="empty-state">暂无超标预警回写记录</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 改动留痕 -->
    <div v-show="activeTab === 'log'">
      <form class="filter-bar" @submit.prevent="reloadLog">
        <label class="filter-item">
          <span>监测编号</span>
          <input v-model="logFilters.code" placeholder="按监测编号检索" />
        </label>
        <label class="filter-item">
          <span>岗位</span>
          <select v-model="logFilters.post">
            <option value="">全部岗位</option>
            <option v-for="post in allPosts" :key="post" :value="post">{{ post }}</option>
          </select>
        </label>
        <label class="filter-item">
          <span>结果</span>
          <select v-model="logFilters.result">
            <option value="">全部</option>
            <option value="blocked">仅被打回</option>
            <option value="allowed">仅已放行</option>
          </select>
        </label>
        <button class="btn" type="submit">查询</button>
      </form>
      <table class="data-table">
        <thead>
          <tr><th>时间</th><th>岗位</th><th>操作人</th><th>动作</th><th>对象</th><th>卡在哪一步 / 结果</th><th>拟改字段</th><th>说明</th></tr>
        </thead>
        <tbody>
          <tr v-for="item in logRows" :key="item.id" :class="{ blocked: !item.allowed }">
            <td class="nowrap">{{ item.time }}</td>
            <td>{{ item.post }}</td>
            <td>{{ item.operator }}</td>
            <td>{{ item.action }}</td>
            <td class="nowrap">{{ item.targetCode || '—' }}</td>
            <td>
              <span class="tag" :class="item.allowed ? 'tag-ok' : 'tag-block'">
                {{ item.allowed ? '已放行' : '打回' }} · {{ item.stage }}
              </span>
            </td>
            <td>
              <span v-if="!item.changes.length">—</span>
              <ul v-else class="change-list">
                <li v-for="change in item.changes" :key="change.field">
                  {{ change.field }}：{{ change.from || '空' }} → {{ change.to || '空' }}
                </li>
              </ul>
            </td>
            <td class="detail-cell">{{ item.detail }}</td>
          </tr>
          <tr v-if="!logRows.length">
            <td colspan="8" class="empty-state">暂无留痕记录</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 限值标准 -->
    <div v-show="activeTab === 'standards'">
      <table class="data-table">
        <thead>
          <tr><th>监测因子</th><th>现行限值</th><th>单位</th><th>最近更新时间</th><th>更新人</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="item in standards" :key="item.因子">
            <td>{{ item.因子 }}</td>
            <td>{{ item.限值 }}</td>
            <td>{{ item.单位 }}</td>
            <td>{{ item.更新时间 }}</td>
            <td>{{ item.更新人 }}</td>
            <td><button class="link" type="button" @click="standardsOpen = true">维护限值</button></td>
          </tr>
        </tbody>
      </table>
    </div>

    <RecordModal
      :open="modalOpen"
      :mode="modalMode"
      :row="activeRow"
      :ctx="ctx"
      :standards="standards"
      @close="modalOpen = false"
      @submit="handleModalSubmit"
    />
    <StandardsModal
      :open="standardsOpen"
      :standards="standards"
      :ctx="ctx"
      @close="standardsOpen = false"
      @adjust="handleAdjust"
    />

    <!-- 重算前后差异 -->
    <div v-if="diffRow" class="modal-mask" @click.self="diffRow = null">
      <section class="modal">
        <header class="modal-head">
          <h3>重算差异 · {{ diffRow.监测编号 }}</h3>
          <button class="btn ghost" type="button" @click="diffRow = null">关闭</button>
        </header>
        <p class="modal-hint">
          排放限值调整后自动重算，共重算 {{ diffRow.重算次数 }} 次。以下为留痕台账里该记录的重算明细。
        </p>
        <table class="data-table">
          <thead><tr><th>重算时间</th><th>限值变化</th><th>结论变化</th><th>操作人</th></tr></thead>
          <tbody>
            <tr v-for="item in diffEntries" :key="item.id">
              <td class="nowrap">{{ item.time }}</td>
              <td>
                <template v-for="change in item.changes.filter((c) => c.field === '排放限值')" :key="change.field">
                  {{ change.from }} → {{ change.to }}
                </template>
              </td>
              <td>
                <template v-for="change in item.changes.filter((c) => c.field === '超标结论')" :key="change.field">
                  <span :class="change.to === '超标' ? 'error-text' : 'ok-text'">{{ change.from || '空' }} → {{ change.to }}</span>
                </template>
              </td>
              <td>{{ item.post }} · {{ item.operator }}</td>
            </tr>
            <tr v-if="!diffEntries.length">
              <td colspan="4" class="empty-state">未找到该记录的重算留痕</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { downloadEntries, moduleMeta } from '@/api/local-service'
import {
  adjustStandard,
  approveCems,
  cemsStats,
  collectCems,
  ensureCemsMeta,
  listAuditLog,
  listCems,
  listStandards,
  listWarnings,
  registerCems,
  updateCemsFields,
} from '@/api/cems-service'
import { ALL_POSTS, CEMS_POSTS, STATUS } from '@/data/cems/constants'
import { ensureCemsV2 } from '@/data/cems/store'
import type {
  AdjustSummary,
  AuditEntry,
  CemsRow,
  OperatorContext,
  RegisterInput,
  StandardRow,
  WarningRow,
} from '@/data/cems/types'
import { useSessionStore } from '@/stores/session'
import RecordModal from './RecordModal.vue'
import StandardsModal from './StandardsModal.vue'

const store = useSessionStore()
const allPosts = ALL_POSTS
const cemsPosts = CEMS_POSTS

const columns = [
  '监测编号', '监测因子', '采集设备', '归属岗位', '排放限值',
  '实测值', '折算值', '采集时间', '超标结论', '重算次数', '状态',
]
const warningColumns = ['监控编号', '监控指标', '限值要求', '实测值', '达标判定', '来源记录', '回写时间', '更新时间']
const statuses = [STATUS.pending, STATUS.collected, STATUS.approved]
const tabs = [
  { key: 'records', label: '监测记录' },
  { key: 'warnings', label: '环保预警台账' },
  { key: 'log', label: '改动留痕' },
  { key: 'standards', label: '限值标准' },
] as const

const activeTab = ref<(typeof tabs)[number]['key']>('records')
const rows = ref<CemsRow[]>([])
const warnings = ref<WarningRow[]>([])
const logRows = ref<AuditEntry[]>([])
const standards = ref<StandardRow[]>([])
const stats = ref(cemsStats())

const filters = reactive<Record<string, string>>({ 监测编号: '', 监测因子: '', 归属岗位: '', 状态: '' })
const logFilters = reactive({ code: '', post: '', result: '' })

const message = ref('')
const messageOk = ref(true)
const modalOpen = ref(false)
const modalMode = ref<'register' | 'collect' | 'edit'>('register')
const activeRow = ref<CemsRow | null>(null)
const standardsOpen = ref(false)
const diffRow = ref<CemsRow | null>(null)

const ctx = computed<OperatorContext>(() => ({ post: store.post, operator: store.operator }))

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => row.status === status).length,
  })),
)

const diffEntries = computed(() =>
  logRows.value.filter((item) => item.action === '限值重算' && item.targetCode === diffRow.value?.监测编号),
)

function switchPost(post: string) {
  store.setPost(post)
}
function setOperator(name: string) {
  store.setOperator(name)
}

function flash(ok: boolean, text: string) {
  messageOk.value = ok
  message.value = text
}

function reload() {
  rows.value = listCems(filters)
  warnings.value = listWarnings()
  logRows.value = listAuditLog()
  standards.value = listStandards()
  stats.value = cemsStats()
}

function reloadLog() {
  logRows.value = listAuditLog().filter((item) => {
    if (logFilters.code && !item.targetCode.includes(logFilters.code.trim())) {
      return false
    }
    if (logFilters.post && item.post !== logFilters.post) {
      return false
    }
    if (logFilters.result === 'blocked' && item.allowed) {
      return false
    }
    if (logFilters.result === 'allowed' && !item.allowed) {
      return false
    }
    return true
  })
}

function resetFilters() {
  filters.监测编号 = ''
  filters.监测因子 = ''
  filters.归属岗位 = ''
  filters.状态 = ''
  reload()
}

function openRegister() {
  modalMode.value = 'register'
  activeRow.value = null
  modalOpen.value = true
}

function openCollect(row: CemsRow) {
  modalMode.value = 'collect'
  activeRow.value = row
  modalOpen.value = true
}

function openEdit(row: CemsRow) {
  modalMode.value = 'edit'
  activeRow.value = row
  modalOpen.value = true
}

function warningTagClass(state: WarningRow['预警状态']): string {
  if (state === '预警中') {
    return 'tag-block'
  }
  if (state === '已解除') {
    return 'tag-ok'
  }
  return 'tag-lock'
}

function handleModalSubmit(payload: RegisterInput) {
  let result
  if (modalMode.value === 'register') {
    result = registerCems(payload, ctx.value)
  } else if (modalMode.value === 'collect' && activeRow.value) {
    result = collectCems(Number(activeRow.value.id), payload, ctx.value)
  } else if (activeRow.value) {
    result = updateCemsFields(
      Number(activeRow.value.id),
      { 实测值: payload.实测值, 折算值: payload.折算值, 采集时间: payload.采集时间 },
      ctx.value,
    )
  }
  if (result?.ok) {
    modalOpen.value = false
    flash(true, result.message)
  } else if (result) {
    // 被打回也要保留弹窗，让操作人看到卡在哪一步；留痕已在服务层落账。
    flash(false, result.message)
  }
  reload()
}

function approve(row: CemsRow) {
  const result = approveCems(Number(row.id), ctx.value)
  flash(result.ok, result.message)
  reload()
}

function handleAdjust(factor: string, limit: number) {
  const result = adjustStandard(factor, limit, ctx.value)
  if (result.ok && result.data) {
    showAdjustSummary(result.data)
  } else {
    flash(false, result.message)
  }
  reload()
}

function showAdjustSummary(summary: AdjustSummary) {
  const flipped = summary.recalced.filter((item) => item.oldConclusion !== item.newConclusion)
  const lines = flipped.map(
    (item) => `${item.targetCode}：${item.oldLimit}→${item.newLimit}，结论 ${item.oldConclusion || '空'}→${item.newConclusion}`,
  )
  const base = `${resultMessage(summary)}，结论翻转 ${flipped.length} 条`
  flash(true, lines.length ? `${base}；${lines.join('；')}` : base)
}

function resultMessage(summary: AdjustSummary): string {
  return `限值已调整，重算 ${summary.recalced.length} 条，审定记录 ${summary.lockedSkipped} 条维持原结论`
}

function openDiff(row: CemsRow) {
  logRows.value = listAuditLog()
  diffRow.value = row
}

function exportRows() {
  ensureCemsMeta()
  const meta = moduleMeta('cems')
  downloadEntries(meta.key)
}

onMounted(() => {
  ensureCemsV2()
  ensureCemsMeta()
  reload()
})
</script>

<style scoped>
.cems-page .identity-bar {
  display: flex;
  align-items: flex-end;
  gap: 14px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
}
.identity-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  color: var(--muted);
}
.identity-item select,
.identity-item input {
  min-width: 150px;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.identity-tip {
  margin-left: auto;
  font-size: 12px;
  color: var(--muted);
}
.stat-value.alert {
  color: #b42318;
}
.tab-bar {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}
.tab {
  border: 1px solid var(--border);
  background: #fff;
  border-radius: 6px 6px 0 0;
  padding: 6px 14px;
  cursor: pointer;
  font-size: 13px;
}
.tab.active {
  background: var(--brand);
  border-color: var(--brand);
  color: #fff;
}
.result-banner {
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 13px;
}
.result-banner.ok {
  background: #ecfdf3;
  color: #027a48;
  border: 1px solid #abefc6;
}
.tag {
  display: inline-block;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
  white-space: nowrap;
}
.tag-lock {
  background: #f2f4f7;
  color: #475467;
}
.tag-open {
  background: #eef4ff;
  color: #1f6feb;
}
.tag-block {
  background: #fef3f2;
  color: #b42318;
}
.tag-ok {
  background: #ecfdf3;
  color: #027a48;
}
tr.locked {
  background: #fafbfc;
  color: #667085;
}
tr.blocked {
  background: #fff8f7;
}
tr.resolved {
  color: #667085;
}
.change-list {
  margin: 0;
  padding-left: 16px;
}
.change-list li {
  font-size: 12px;
}
.detail-cell {
  max-width: 320px;
  font-size: 12px;
  color: #475467;
}
.nowrap {
  white-space: nowrap;
}
.ok-text {
  color: #027a48;
}
.link.approve {
  color: #b54708;
}
.link.diff {
  color: #6941c6;
}
</style>
