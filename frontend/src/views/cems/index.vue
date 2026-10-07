<template>
  <section class="page cems-page" data-module="cems">
    <header class="page-head">
      <div>
        <h2>在线排放监测管理</h2>
        <p class="page-desc">
          每条监测记录只认采集设备所在岗位：监测因子、排放限值等固定字段对别的岗位只读，
          非归属岗位改动一律打回；审定后整份锁定，本岗位也不能再改。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openRegister">登记排放监测记录</button>
        <button class="btn" type="button" @click="exportRows">导出清单</button>
      </div>
    </header>

    <div class="post-bar">
      <div class="post-bar-main">
        <span class="post-tag">当前岗位</span>
        <strong>{{ currentPostName }}</strong>
        <span v-if="currentPost.devices.length" class="post-devices">
          负责采集设备：{{ currentPost.devices.join('、') }}
        </span>
        <span v-else class="post-devices warn">无归属采集设备（第三方运维，只能查看）</span>
      </div>
      <div class="post-bar-tip">
        只有记录归属岗位可编辑实测信息；固定字段任何岗位都只读；审定记录整份锁定。
      </div>
    </div>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value" :class="item.danger ? 'danger' : ''">{{ item.value }}</strong>
      </article>
    </div>

    <nav class="tab-bar">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-btn"
        :class="{ active: activeTab === tab.key }"
        type="button"
        @click="switchTab(tab.key)"
      >
        {{ tab.label }}
        <em v-if="tab.badge" class="tab-badge">{{ tab.badge }}</em>
      </button>
    </nav>

    <!-- ============================ 监测记录 ============================ -->
    <div v-if="activeTab === 'records'">
      <p class="status-legend">
        <span v-for="item in statusSummary" :key="item.status" class="legend-item">
          {{ item.status }}：{{ item.count }}
        </span>
      </p>

      <form class="filter-bar" @submit.prevent="reload">
        <label class="filter-item">
          <span>监测编号</span>
          <input v-model="filters['监测编号']" placeholder="按监测编号检索" />
        </label>
        <label class="filter-item">
          <span>监测因子</span>
          <input v-model="filters['监测因子']" placeholder="按监测因子检索" />
        </label>
        <label class="filter-item">
          <span>归属岗位</span>
          <input v-model="postFilter" placeholder="岗位名称" />
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      </form>

      <table class="data-table">
        <thead>
          <tr>
            <th>监测编号</th>
            <th>监测因子</th>
            <th>实测值</th>
            <th>排放限值</th>
            <th>折算值</th>
            <th>采集设备</th>
            <th>归属岗位</th>
            <th>限值版本</th>
            <th>超标判定</th>
            <th>采集时间</th>
            <th>审核人员</th>
            <th>当前状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in filteredRows" :key="String(row.id)" :class="{ locked: row.status === '已审核' }">
            <td>{{ row.监测编号 }}</td>
            <td>{{ row.监测因子 }}</td>
            <td :class="{ 'cell-danger': row.超标判定 === '超标' }">{{ row.实测值 || '—' }}</td>
            <td>{{ row.排放限值 }}</td>
            <td>{{ row.折算值 || '—' }}</td>
            <td>{{ row.采集设备 }}</td>
            <td>{{ postName(String(row.归属岗位)) }}</td>
            <td>v{{ row.限值版本 }}</td>
            <td :class="{ 'cell-danger': row.超标判定 === '超标' }">{{ row.超标判定 }}</td>
            <td>{{ row.采集时间 }}</td>
            <td>{{ row.审核人员 || '—' }}</td>
            <td>
              <span :class="['status-pill', statusClass(row.status)]">{{ row.status }}</span>
            </td>
            <td class="row-actions">
              <button class="link" type="button" @click="openEdit(row)">编辑</button>
              <button
                v-if="row.status !== '已审核' && row.status !== '待采集'"
                class="link"
                type="button"
                @click="openApprove(row)"
              >
                审定
              </button>
              <button
                v-if="row.status === '待采集'"
                class="link"
                type="button"
                @click="openCollect(row)"
              >
                提交采集
              </button>
            </td>
          </tr>
          <tr v-if="!filteredRows.length">
            <td colspan="13" class="empty-state">暂无符合条件的排放监测记录</td>
          </tr>
        </tbody>
      </table>
      <footer class="page-foot">
        <span>共 {{ filteredRows.length }} 条记录</span>
      </footer>
    </div>

    <!-- ============================ 排放限值 ============================ -->
    <div v-else-if="activeTab === 'limits'">
      <div class="inline-note">
        限值调整后，已采集但<strong>未审定</strong>的记录会按新限值自动重算超标预警并保留前后差异；
        已审定记录按审定当时的结论保留，不参与重算。限值调整仅厂内岗位可操作。
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>监测因子</th>
            <th>现行限值</th>
            <th>单位</th>
            <th>版本</th>
            <th>最近调整时间</th>
            <th>最近调整人</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in limitRows" :key="item.factor">
            <td>{{ item.factor }}</td>
            <td>{{ item.limit }}</td>
            <td>{{ item.unit }}</td>
            <td>v{{ item.version }}</td>
            <td>{{ item.updatedAt }}</td>
            <td>{{ item.updatedBy }}</td>
            <td>
              <button class="link" type="button" @click="openLimit(item)">调整限值</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ============================ 拦截留痕 ============================ -->
    <div v-else-if="activeTab === 'denylogs'">
      <div class="inline-note">
        所有被挡下的改动尝试都在这里留痕：谁、什么时间、想动哪一条、卡在哪一步，可逐条倒查。
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>操作人</th>
            <th>所在岗位</th>
            <th>尝试动作</th>
            <th>目标记录</th>
            <th>卡在哪一步</th>
            <th>打回原因</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="log in denyRows" :key="log.id">
            <td>{{ log.time }}</td>
            <td>{{ log.actor }}</td>
            <td>{{ postName(log.postCode) }}</td>
            <td>{{ log.attempt }}</td>
            <td>{{ log.target }}</td>
            <td><span class="step-pill">{{ log.step }}</span></td>
            <td class="deny-reason">{{ log.reason }}</td>
          </tr>
          <tr v-if="!denyRows.length">
            <td colspan="7" class="empty-state">暂无被拦截的改动尝试</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ============================ 重算差异 ============================ -->
    <div v-else-if="activeTab === 'diffs'">
      <div class="inline-note">
        限值调整触发的重算明细：重算前后限值、超标结论是否翻转、已审定记录为何保留，全部留档。
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>批次</th>
            <th>时间</th>
            <th>监测编号</th>
            <th>监测因子</th>
            <th>采集设备</th>
            <th>原限值</th>
            <th>新限值</th>
            <th>重算前结论</th>
            <th>重算后结论</th>
            <th>结论是否翻转</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="diff in diffRows" :key="diff.id" :class="{ kept: !diff.changed && diff.newConclusion.includes('保留') }">
            <td>#{{ diff.batchId }}</td>
            <td>{{ diff.time }}</td>
            <td>{{ diff.monitorNo }}</td>
            <td>{{ diff.factor }}</td>
            <td>{{ diff.device }}</td>
            <td>{{ diff.oldLimit }}</td>
            <td>{{ diff.newLimit }}</td>
            <td>{{ diff.oldConclusion }}</td>
            <td :class="{ 'cell-danger': diff.newConclusion === '超标' }">{{ diff.newConclusion }}</td>
            <td>
              <span v-if="diff.changed" class="flip-pill">已翻转</span>
              <span v-else>未变</span>
            </td>
            <td class="deny-reason">{{ diff.reason }}</td>
          </tr>
          <tr v-if="!diffRows.length">
            <td colspan="11" class="empty-state">暂无重算记录，调整一次排放限值后这里会出现差异明细</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ============================ 预警台账回写 ============================ -->
    <div v-else-if="activeTab === 'ledger'">
      <div class="inline-note">
        超标结论自动回写到环保监控预警台账（监控编号 WARN- 开头），结论翻转时同步解除或重新预警。
        完整台账可在左侧「环保指标监控」查看。
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>预警编号</th>
            <th>来源监测编号</th>
            <th>来源设备</th>
            <th>监控指标</th>
            <th>限值要求</th>
            <th>实测值</th>
            <th>达标判定</th>
            <th>台账状态</th>
            <th>回写时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in ledgerRows" :key="String(row.id)">
            <td>{{ row.监控编号 }}</td>
            <td>{{ row.来源监测编号 }}</td>
            <td>{{ row.来源采集设备 }}</td>
            <td>{{ row.监控指标 }}</td>
            <td>{{ row.限值要求 }}</td>
            <td :class="{ 'cell-danger': row.达标判定 === '未达标' }">{{ row.实测值 }}</td>
            <td>{{ row.达标判定 }}</td>
            <td><span class="status-pill" :class="row.监控状态 === '超标预警' ? 'st-warning' : 'st-ok'">{{ row.监控状态 }}</span></td>
            <td>{{ row.回写时间 }}</td>
          </tr>
          <tr v-if="!ledgerRows.length">
            <td colspan="9" class="empty-state">暂无预警台账回写记录</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ====================== 登记弹窗 ====================== -->
    <div v-if="registerOpen" class="modal-mask" @click.self="registerOpen = false">
      <div class="modal">
        <h3>登记排放监测记录</h3>
        <p class="modal-sub">归属规则：只能选用当前岗位名下的采集设备，归属岗位随设备定死。</p>
        <div class="form-grid">
          <label>
            <span>监测编号 *</span>
            <input v-model="registerForm.monitorNo" placeholder="如 CEMS-2026-0903-02" />
          </label>
          <label>
            <span>监测因子 *</span>
            <select v-model="registerForm.factor">
              <option value="" disabled>请选择</option>
              <option v-for="item in limitRows" :key="item.factor" :value="item.factor">{{ item.factor }}</option>
            </select>
          </label>
          <label>
            <span>采集设备 *</span>
            <select v-model="registerForm.device">
              <option value="" disabled>请选择</option>
              <option v-for="d in currentPost.devices" :key="d" :value="d">{{ d }}</option>
            </select>
          </label>
          <label>
            <span>实测值</span>
            <input v-model="registerForm.measured" placeholder="数字，留空为待采集" />
          </label>
          <label>
            <span>折算值</span>
            <input v-model="registerForm.converted" />
          </label>
          <label>
            <span>采集时间</span>
            <input v-model="registerForm.collectedAt" placeholder="YYYY-MM-DD HH:mm" />
          </label>
        </div>
        <p v-if="!currentPost.devices.length" class="form-warn">
          当前岗位（{{ currentPostName }}）名下没有采集设备，提交会在「归属校验」被打回并留痕。
        </p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="registerOpen = false">取消</button>
          <button class="btn primary" type="button" @click="submitRegister">提交登记</button>
        </div>
      </div>
    </div>

    <!-- ====================== 编辑弹窗 ====================== -->
    <div v-if="editOpen && editingRow" class="modal-mask" @click.self="editOpen = false">
      <div class="modal">
        <h3>编辑排放监测记录</h3>
        <p class="modal-sub">
          归属：{{ postName(String(editingRow.归属岗位)) }} · 设备 {{ editingRow.采集设备 }}
          <template v-if="editingRow.status === '已审核'">
            ｜<strong class="lock-note">记录已审定，整份锁定</strong>
          </template>
          <template v-else-if="!ownerOf(editingRow)">
            ｜<strong class="lock-note">非归属岗位，固定字段只读且提交会被打回</strong>
          </template>
        </p>
        <div class="form-grid">
          <label v-for="field in fixedColumns" :key="field">
            <span>{{ field }}（只读）</span>
            <input :value="String(editingRow[field] ?? '')" disabled />
          </label>
          <label v-for="field in editableColumns" :key="field">
            <span>{{ field }}</span>
            <input
              :value="String(editingRow[field] ?? '')"
              :disabled="!canEditField(editingRow, field)"
              :class="{ readonly: !canEditField(editingRow, field) }"
              @input="onEditInput(field, ($event.target as HTMLInputElement).value)"
            />
          </label>
        </div>
        <div class="modal-actions">
          <button class="btn" type="button" @click="editOpen = false">取消</button>
          <button class="btn primary" type="button" @click="submitEdit">提交改动</button>
        </div>
      </div>
    </div>

    <!-- ====================== 审定弹窗 ====================== -->
    <div v-if="approveOpen && editingRow" class="modal-mask" @click.self="approveOpen = false">
      <div class="modal modal-sm">
        <h3>审定排放监测记录</h3>
        <p class="modal-sub">审定后整份记录锁定，本岗位也不能再改；限值重算也不会改动它。</p>
        <div class="form-grid">
          <label>
            <span>监测编号</span>
            <input :value="editingRow.监测编号" disabled />
          </label>
          <label>
            <span>审定结论</span>
            <input :value="editingRow.超标判定" disabled />
          </label>
          <label>
            <span>审定人</span>
            <input v-model="reviewer" placeholder="审定人姓名" />
          </label>
        </div>
        <div class="modal-actions">
          <button class="btn" type="button" @click="approveOpen = false">取消</button>
          <button class="btn primary" type="button" @click="submitApprove">确认审定并锁定</button>
        </div>
      </div>
    </div>

    <!-- ====================== 采集弹窗 ====================== -->
    <div v-if="collectOpen && editingRow" class="modal-mask" @click.self="collectOpen = false">
      <div class="modal modal-sm">
        <h3>提交采集</h3>
        <div class="form-grid">
          <label>
            <span>监测编号</span>
            <input :value="editingRow.监测编号" disabled />
          </label>
          <label>
            <span>实测值</span>
            <input v-model="collectValue" placeholder="数字" />
          </label>
        </div>
        <div class="modal-actions">
          <button class="btn" type="button" @click="collectOpen = false">取消</button>
          <button class="btn primary" type="button" @click="submitCollectValue">提交采集</button>
        </div>
      </div>
    </div>

    <!-- ====================== 限值调整弹窗 ====================== -->
    <div v-if="limitOpen && editingLimit" class="modal-mask" @click.self="limitOpen = false">
      <div class="modal modal-sm">
        <h3>调整排放限值 · {{ editingLimit.factor }}</h3>
        <p class="modal-sub">
          现行限值 {{ editingLimit.limit }}{{ editingLimit.unit }}（v{{ editingLimit.version }}）。
          保存后未审定记录立即重算，差异留档。
        </p>
        <div class="form-grid">
          <label>
            <span>新限值（{{ editingLimit.unit }}）</span>
            <input v-model="newLimitValue" type="number" step="0.1" />
          </label>
        </div>
        <div class="modal-actions">
          <button class="btn" type="button" @click="limitOpen = false">取消</button>
          <button class="btn primary" type="button" @click="submitLimit">保存并重算</button>
        </div>
      </div>
    </div>

    <!-- ====================== 全局消息条 ====================== -->
    <transition name="toast">
      <div v-if="toast" class="toast" :class="toast.ok ? 'ok' : 'fail'" @click="toast = null">
        <strong>{{ toast.ok ? '操作成功' : `已打回${toast.step ? `（${toast.step}）` : ''}` }}</strong>
        <span>{{ toast.message }}</span>
      </div>
    </transition>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  POSTS,
  approve,
  collect,
  denyLogs,
  edit,
  editableFieldSet,
  exportCemsCsv,
  limits,
  listCems,
  postName,
  recalcDiffs,
  register,
  warningLedger,
  adjustLimit,
  EDITABLE_FIELDS,
  FIXED_FIELDS,
} from '@/api/cems-service'
import type { CemsRow, FactorLimit } from '@/data/cems'
import type { RegisterInput } from '@/data/cems'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()

const currentPost = computed(
  () => POSTS.find((p) => p.code === session.postCode) ?? POSTS[0],
)
const currentPostName = computed(() => currentPost.value.name)
const actor = computed(() => ({ postCode: session.postCode, operator: session.operator }))

type TabKey = 'records' | 'limits' | 'denylogs' | 'diffs' | 'ledger'
const activeTab = ref<TabKey>('records')

const rows = ref<CemsRow[]>([])
const limitRows = ref<FactorLimit[]>([])
const denyRows = ref(denyLogs())
const diffRows = ref(recalcDiffs())
const ledgerRows = ref(warningLedger())

const filters = reactive<Record<string, string>>({ 监测编号: '', 监测因子: '' })
const postFilter = ref('')

const fixedColumns = [...FIXED_FIELDS]
const editableColumns = [...EDITABLE_FIELDS]

const filteredRows = computed(() => {
  const keyword = postFilter.value.trim()
  if (!keyword) {
    return rows.value
  }
  return rows.value.filter((row) => postName(String(row.归属岗位)).includes(keyword))
})

// 模板里 v-for 直接用 filteredRows，保持 rows 为全量。

const statusSummary = computed(() =>
  ['待采集', '已采集', '超标预警', '已审核'].map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => [
  { label: '记录总数', value: rows.value.length, danger: false },
  { label: '待审定', value: rows.value.filter((r) => r.status === '已采集').length, danger: false },
  {
    label: '超标预警',
    value: rows.value.filter((r) => r.超标判定 === '超标' && r.status !== '已审核').length,
    danger: true,
  },
  { label: '已审定锁定', value: rows.value.filter((r) => r.status === '已审核').length, danger: false },
])

const tabs = computed(() => [
  { key: 'records' as TabKey, label: '监测记录', badge: 0 },
  { key: 'limits' as TabKey, label: '排放限值', badge: 0 },
  { key: 'diffs' as TabKey, label: '重算差异', badge: diffRows.value.length },
  { key: 'denylogs' as TabKey, label: '拦截留痕', badge: denyRows.value.length },
  { key: 'ledger' as TabKey, label: '预警台账', badge: ledgerRows.value.length },
])

const toast = ref<{ ok: boolean; message: string; step?: string } | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | undefined
function showToast(ok: boolean, message: string, step?: string) {
  toast.value = { ok, message, step }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toast.value = null
  }, 5200)
}

function statusClass(status: string): string {
  if (status === '超标预警') {
    return 'st-warning'
  }
  if (status === '已审核') {
    return 'st-locked'
  }
  if (status === '待采集') {
    return 'st-idle'
  }
  return 'st-ok'
}

function ownerOf(row: CemsRow): boolean {
  return String(row.归属岗位) === session.postCode
}

function canEditField(row: CemsRow, field: string): boolean {
  return editableFieldSet(row, actor.value).has(field)
}

// ---------------- 登记 ----------------
const registerOpen = ref(false)
const registerForm = reactive<RegisterInput>({
  monitorNo: '',
  factor: '',
  device: '',
  measured: '',
  converted: '',
  collectedAt: '',
})

function openRegister() {
  Object.assign(registerForm, {
    monitorNo: '',
    factor: limitRows.value[0]?.factor ?? '',
    device: currentPost.value.devices[0] ?? '',
    measured: '',
    converted: '',
    collectedAt: '',
  })
  registerOpen.value = true
}

function submitRegister() {
  if (!registerForm.collectedAt) {
    registerForm.collectedAt = new Date().toISOString().slice(0, 16)
  }
  const result = register({ ...registerForm }, actor.value)
  showToast(result.ok, result.message, result.step)
  if (result.ok) {
    registerOpen.value = false
    reload()
  } else {
    refreshAux()
  }
}

// ---------------- 编辑 ----------------
const editOpen = ref(false)
const editingRow = ref<CemsRow | null>(null)
const editPatch = reactive<Record<string, string>>({})

function openEdit(row: CemsRow) {
  editingRow.value = row
  Object.keys(editPatch).forEach((key) => delete editPatch[key])
  editOpen.value = true
}

function onEditInput(field: string, value: string) {
  editPatch[field] = value
}

function submitEdit() {
  if (!editingRow.value) {
    return
  }
  // 固定字段也随表单一并提交，服务层会在「字段只读校验 / 归属校验 / 锁定校验」处打回，
  // 这样即使从页面或脚本直接调 API，跨岗位改动一样进不来、且每次尝试都留痕。
  const payload: Record<string, string> = { ...editPatch }
  for (const field of fixedColumns) {
    payload[field] = String(editingRow.value[field] ?? '')
  }
  const result = edit(editingRow.value.监测编号, payload, actor.value)
  showToast(result.ok, result.message, result.step)
  if (result.ok) {
    editOpen.value = false
    reload()
  } else {
    refreshAux()
  }
}

// ---------------- 审定 ----------------
const approveOpen = ref(false)
const reviewer = ref('')

function openApprove(row: CemsRow) {
  editingRow.value = row
  reviewer.value = session.operator
  approveOpen.value = true
}

function submitApprove() {
  if (!editingRow.value) {
    return
  }
  const result = approve(editingRow.value.监测编号, reviewer.value, actor.value)
  showToast(result.ok, result.message, result.step)
  if (result.ok) {
    approveOpen.value = false
    reload()
  } else {
    refreshAux()
  }
}

// ---------------- 采集 ----------------
const collectOpen = ref(false)
const collectValue = ref('')

function openCollect(row: CemsRow) {
  editingRow.value = row
  collectValue.value = ''
  collectOpen.value = true
}

function submitCollectValue() {
  if (!editingRow.value) {
    return
  }
  const result = collect(editingRow.value.监测编号, collectValue.value, actor.value)
  showToast(result.ok, result.message, result.step)
  if (result.ok) {
    collectOpen.value = false
    reload()
  } else {
    refreshAux()
  }
}

// ---------------- 限值调整 ----------------
const limitOpen = ref(false)
const editingLimit = ref<FactorLimit | null>(null)
const newLimitValue = ref('')

function openLimit(item: FactorLimit) {
  editingLimit.value = item
  newLimitValue.value = String(item.limit)
  limitOpen.value = true
}

function submitLimit() {
  if (!editingLimit.value) {
    return
  }
  const result = adjustLimit(
    editingLimit.value.factor,
    Number(newLimitValue.value),
    actor.value,
  )
  showToast(result.ok, result.message, result.step)
  if (result.ok) {
    limitOpen.value = false
  }
  reload()
  refreshAux()
}

// ---------------- 通用 ----------------
function resetFilters() {
  filters.监测编号 = ''
  filters.监测因子 = ''
  postFilter.value = ''
  reload()
}

function switchTab(key: TabKey) {
  activeTab.value = key
  refreshAux()
}

function refreshAux() {
  denyRows.value = denyLogs()
  diffRows.value = recalcDiffs()
  ledgerRows.value = warningLedger()
  limitRows.value = limits()
}

function exportRows() {
  const { filename, content } = exportCemsCsv()
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

function reload() {
  rows.value = listCems(filters)
  limitRows.value = limits()
  refreshAux()
}

onMounted(reload)
</script>

<style scoped>
.cems-page {
  position: relative;
}
.post-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  background: #eef4ff;
  border: 1px solid #c6d8fb;
  border-radius: 8px;
  padding: 10px 14px;
  margin-bottom: 12px;
  font-size: 13px;
}
.post-bar-main {
  display: flex;
  align-items: center;
  gap: 10px;
}
.post-tag {
  background: var(--brand);
  color: #fff;
  border-radius: 4px;
  padding: 1px 8px;
  font-size: 12px;
}
.post-devices {
  color: var(--muted);
}
.post-devices.warn {
  color: #b42318;
}
.post-bar-tip {
  color: var(--muted);
  font-size: 12px;
}
.tab-bar {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 12px;
}
.tab-btn {
  border: none;
  background: none;
  padding: 8px 14px;
  cursor: pointer;
  font-size: 13px;
  color: var(--muted);
  border-bottom: 2px solid transparent;
}
.tab-btn.active {
  color: var(--brand);
  border-bottom-color: var(--brand);
  font-weight: 600;
}
.tab-badge {
  font-style: normal;
  background: #e2e8f0;
  border-radius: 999px;
  padding: 0 7px;
  font-size: 11px;
  margin-left: 4px;
}
.tab-btn.active .tab-badge {
  background: #dbe7fe;
  color: var(--brand);
}
.stat-value.danger {
  color: #b42318;
}
.cell-danger {
  color: #b42318;
  font-weight: 600;
}
tr.locked td {
  background: #f8fafc;
  color: #64748b;
}
tr.kept td {
  background: #f8fafc;
}
.status-pill {
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
}
.st-warning {
  background: #fee4e2;
  color: #b42318;
}
.st-locked {
  background: #e2e8f0;
  color: #475569;
}
.st-ok {
  background: #dcfae6;
  color: #067647;
}
.st-idle {
  background: #fef0c7;
  color: #b54708;
}
.step-pill {
  background: #fee4e2;
  color: #b42318;
  border-radius: 4px;
  padding: 1px 8px;
  font-size: 12px;
}
.flip-pill {
  background: #fef0c7;
  color: #b54708;
  border-radius: 4px;
  padding: 1px 8px;
  font-size: 12px;
}
.deny-reason {
  color: #475569;
}
.inline-note {
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 12px;
  color: #92400e;
  margin-bottom: 10px;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.modal {
  background: #fff;
  border-radius: 10px;
  padding: 20px 22px;
  width: 640px;
  max-width: 92vw;
  max-height: 86vh;
  overflow: auto;
}
.modal-sm {
  width: 420px;
}
.modal h3 {
  margin: 0 0 4px;
}
.modal-sub {
  color: var(--muted);
  font-size: 12px;
  margin: 0 0 14px;
}
.lock-note {
  color: #b42318;
}
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 14px;
}
.form-grid label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
}
.form-grid input,
.form-grid select {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 13px;
}
.form-grid input:disabled,
.form-grid input.readonly {
  background: #f1f5f9;
  color: #64748b;
}
.form-warn {
  color: #b42318;
  font-size: 12px;
  margin: 12px 0 0;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
}
.toast {
  position: fixed;
  right: 24px;
  bottom: 24px;
  width: 380px;
  max-width: 90vw;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.18);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  cursor: pointer;
  z-index: 60;
  border-left: 4px solid var(--brand);
}
.toast.ok {
  border-left-color: #12b76a;
}
.toast.fail {
  border-left-color: #d92d20;
}
.toast span {
  color: #475569;
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
