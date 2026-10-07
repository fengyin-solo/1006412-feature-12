/**
 * 在线排放监测（CEMS）业务域：归属岗位、编辑管控、审定锁定、限值重算、预警台账回写。
 *
 * 设计约束（对应业务要求）：
 * 1. 每条记录归属「采集它的那台设备所在的岗位」，归属写死在记录上，随登记产生。
 * 2. 监测因子、排放限值等固定字段对非归属岗位只读；非归属岗位提交的改动一律在服务层打回。
 * 3. 审定（已审核）的记录整份锁定，归属岗位本人也不能再改、不能重算。
 * 4. 监测编号全表唯一，重复登记在「唯一校验」步骤打回。
 * 5. 所有被挡下的尝试都写拦截留痕：谁、什么时候、想动哪一条、卡在哪一步。
 * 6. 限值调整后，已采集但未审定的记录按新限值重算超标预警，保留重算前后差异；
 *    已审定记录按当时结论保留，兼容既有记录。
 * 7. 超标结论回写到环保监控（emission）的预警台账。
 *
 * 本文件不引用 Vue，页面组件不做业务判断，统一从 @/api/cems-service 调用。
 */

import { listRows, readJSON, saveRows, writeJSON } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

export const CEMS_KEY = 'cems'
export const EMISSION_KEY = 'emission'

// ---------------------------------------------------------------------------
// 岗位与设备：设备固定挂在岗位上，记录归属 = 采集设备的岗位，登记时定死。
// ---------------------------------------------------------------------------

export type PostDef = {
  code: string
  name: string
  /** 该岗位负责的 CEMS 采集设备编号；第三方运维不拥有任何采集设备。 */
  devices: string[]
  /** 限值调整入口只对厂内岗位开放。 */
  canTuneLimit: boolean
  note: string
}

export const POSTS: PostDef[] = [
  {
    code: 'fluegas-post',
    name: '烟气净化岗',
    devices: ['CEMS-A', 'CEMS-B'],
    canTuneLimit: true,
    note: '1、2 号焚烧线烟气在线监测设备',
  },
  {
    code: 'stack-post',
    name: '总排口值守岗',
    devices: ['CEMS-C'],
    canTuneLimit: true,
    note: '总排口在线监测设备',
  },
  {
    code: 'third-party',
    name: '第三方运维',
    devices: [],
    canTuneLimit: false,
    note: '外部运维单位，只做现场维护，不拥有监测记录',
  },
]

export const POST_BY_CODE: Map<string, PostDef> = new Map(POSTS.map((p) => [p.code, p]))

/** 设备编号 -> 所属岗位：归属判定就认这张表。 */
export const POST_BY_DEVICE: Map<string, PostDef> = POSTS.reduce((map, post) => {
  for (const device of post.devices) {
    map.set(device, post)
  }
  return map
}, new Map<string, PostDef>())

export function postOf(deviceCode: string): PostDef | undefined {
  return POST_BY_DEVICE.get(String(deviceCode ?? '').trim())
}

export function postName(code: string): string {
  return POST_BY_CODE.get(code)?.name ?? code
}

// ---------------------------------------------------------------------------
// 监测因子与现行排放限值（mg/m³，干基标态）。限值可调整，调整留版本。
// ---------------------------------------------------------------------------

export type FactorLimit = {
  factor: string
  unit: string
  limit: number
  /** 版本号，每次限值调整 +1。 */
  version: number
  updatedAt: string
  updatedBy: string
  postCode: string
}

const DEFAULT_FACTOR_LIMITS: Array<Omit<FactorLimit, 'version' | 'updatedAt' | 'updatedBy' | 'postCode'>> = [
  { factor: '颗粒物', unit: 'mg/m³', limit: 20 },
  { factor: '二氧化硫', unit: 'mg/m³', limit: 80 },
  { factor: '氮氧化物', unit: 'mg/m³', limit: 250 },
  { factor: '氯化氢', unit: 'mg/m³', limit: 50 },
  { factor: '一氧化碳', unit: 'mg/m³', limit: 80 },
]

const LIMITS_STORE = 'waste-to-energy-plant:cems-limits'

export function currentLimits(): FactorLimit[] {
  const seeded: FactorLimit[] = DEFAULT_FACTOR_LIMITS.map((item) => ({
    ...item,
    version: 1,
    updatedAt: '2026-08-31 09:00',
    updatedBy: '系统初始化',
    postCode: 'fluegas-post',
  }))
  return readJSON<FactorLimit[]>(LIMITS_STORE, seeded)
}

function saveLimits(limits: FactorLimit[]): void {
  writeJSON(LIMITS_STORE, limits)
}

export function limitOf(factor: string): FactorLimit | undefined {
  return currentLimits().find((item) => item.factor === factor)
}

// ---------------------------------------------------------------------------
// 状态与字段
// ---------------------------------------------------------------------------

export const CEMS_STATUS = {
  waiting: '待采集',
  collected: '已采集',
  warning: '超标预警',
  approved: '已审核',
} as const

/** 审定后进入的终态：整份记录锁住。 */
export const LOCKED_STATUS = CEMS_STATUS.approved
export const LOCKED_STATUSES: string[] = [LOCKED_STATUS]

/** 对非归属岗位只读、任何情况下都不允许跨岗位改动的「定死字段」。 */
export const FIXED_FIELDS = ['监测编号', '监测因子', '排放限值', '采集设备', '归属岗位'] as const

/** 可编辑的实测信息字段（只有归属岗位、且记录未锁定时可改）。 */
export const EDITABLE_FIELDS = ['实测值', '折算值', '采集时间', '审核人员'] as const

export type CemsRow = EntryRow & {
  监测编号: string
  监测因子: string
  实测值: string
  排放限值: string
  折算值: string
  采集时间: string
  审核人员: string
  采集设备: string
  归属岗位: string
  限值版本: number
  超标判定: string
}

// ---------------------------------------------------------------------------
// 操作者（当前会话岗位）
// ---------------------------------------------------------------------------

export type Actor = {
  postCode: string
  operator: string
}

export function actorName(actor: Actor): string {
  return `${postName(actor.postCode)}·${actor.operator || '未署名'}`
}

function nowStamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ---------------------------------------------------------------------------
// 拦截留痕：被挡下的改动尝试，谁/什么时候/想动哪一条/卡在哪一步，都能倒查。
// ---------------------------------------------------------------------------

export type DenyLog = {
  id: number
  time: string
  actor: string
  postCode: string
  attempt: string
  target: string
  step: string
  reason: string
}

const DENY_STORE = 'waste-to-energy-plant:cems-deny-logs'

export function listDenyLogs(): DenyLog[] {
  return readJSON<DenyLog[]>(DENY_STORE, [])
}

function recordDeny(
  actor: Actor,
  attempt: string,
  target: string,
  step: string,
  reason: string,
): void {
  const logs = listDenyLogs()
  const next: DenyLog = {
    id: logs.reduce((max, log) => Math.max(max, log.id), 0) + 1,
    time: nowStamp(),
    actor: actor.operator || '未署名',
    postCode: actor.postCode,
    attempt,
    target,
    step,
    reason,
  }
  writeJSON(DENY_STORE, [next, ...logs])
}

// ---------------------------------------------------------------------------
// 限值重算差异：限值调整时对未审定记录重算，保留前后差异。
// ---------------------------------------------------------------------------

export type RecalcDiff = {
  id: number
  batchId: number
  time: string
  monitorNo: string
  factor: string
  device: string
  oldLimit: number
  newLimit: number
  oldConclusion: string
  newConclusion: string
  changed: boolean
  reason: string
}

export type LimitChangeResult = {
  ok: boolean
  message: string
  step?: string
  batchId?: number
  factor?: string
  oldLimit?: number
  newLimit?: number
  recalculated?: number
  diffs?: RecalcDiff[]
}

const RECALC_STORE = 'waste-to-energy-plant:cems-recalc-diffs'
const BATCH_STORE = 'waste-to-energy-plant:cems-recalc-batch-seq'

export function listRecalcDiffs(): RecalcDiff[] {
  return readJSON<RecalcDiff[]>(RECALC_STORE, [])
}

function nextBatchId(): number {
  const seq = readJSON<number>(BATCH_STORE, 0)
  writeJSON(BATCH_STORE, seq + 1)
  return seq + 1
}

// ---------------------------------------------------------------------------
// 服务返回：比通用 ActionResult 多一个 step，打回时明确指出卡在哪一步。
// ---------------------------------------------------------------------------

export type CemsResult = {
  ok: boolean
  message: string
  /** 被挡在哪一步，如「归属校验 / 锁定校验 / 唯一校验 / 权限校验」。 */
  step?: string
  data?: CemsRow
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function asNumber(value: string): number {
  const n = Number(String(value ?? '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : NaN
}

function judge(value: number, limit: number): string {
  if (!Number.isFinite(value)) {
    return '待采集'
  }
  return value > limit ? '超标' : '达标'
}

export function isLocked(row: CemsRow): boolean {
  return LOCKED_STATUSES.includes(String(row.status))
}

function isOwner(row: CemsRow, actor: Actor): boolean {
  return String(row.归属岗位) === actor.postCode
}

export function editableFieldSet(row: CemsRow, actor: Actor): Set<string> {
  if (isLocked(row) || !isOwner(row, actor)) {
    return new Set()
  }
  return new Set<string>(EDITABLE_FIELDS)
}

function findByNo(rows: CemsRow[], monitorNo: string): CemsRow | undefined {
  const no = String(monitorNo ?? '').trim()
  return rows.find((r) => String(r.监测编号).trim() === no)
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

// ---------------------------------------------------------------------------
// 环保监控预警台账回写
// ---------------------------------------------------------------------------

function syncWarningLedger(row: CemsRow): void {
  const ledger = listRows(EMISSION_KEY) as EntryRow[]
  const factorLimit = limitOf(row.监测因子)
  const limitText = factorLimit ? `${factorLimit.limit}${factorLimit.unit}` : String(row.排放限值 ?? '')
  const warningNo = `WARN-${String(row.监测编号)}`
  const index = ledger.findIndex(
    (item) => String(item.监控编号) === warningNo || String(item.来源监测编号 ?? '') === String(row.监测编号),
  )
  const overLimit = String(row.超标判定) === '超标'
  const payload: EntryRow = {
    id: index >= 0 ? ledger[index].id : nextId(ledger),
    监控编号: warningNo,
    监控指标: row.监测因子,
    限值要求: limitText,
    实测值: row.实测值,
    达标判定: overLimit ? '未达标' : '达标',
    监控日期: String(row.采集时间 ?? '').slice(0, 10) || nowStamp().slice(0, 10),
    监控人员: `CEMS ${row.采集设备} 自动回写`,
    监控状态: overLimit ? '超标预警' : '预警解除',
    来源监测编号: row.监测编号,
    来源采集设备: row.采集设备,
    回写时间: nowStamp(),
    status: overLimit ? '超标预警' : '预警解除',
    pending: overLimit,
    abnormal: overLimit,
  }
  if (index >= 0) {
    ledger[index] = { ...ledger[index], ...payload }
  } else {
    ledger.push(payload)
  }
  saveRows(EMISSION_KEY, ledger)
}

// ---------------------------------------------------------------------------
// 登记：归属岗位由采集设备定死；监测编号全表唯一，重复在唯一校验步打回。
// ---------------------------------------------------------------------------

export type RegisterInput = {
  monitorNo: string
  factor: string
  device: string
  measured: string
  converted: string
  collectedAt: string
}

export function registerCems(input: RegisterInput, actor: Actor): CemsResult {
  const target = `监测编号 ${input.monitorNo || '（空）'}`
  const deviceOwner = postOf(input.device)

  // 步骤 1：归属校验——采集设备必须挂在当前岗位名下。第三方运维没有设备。
  if (!deviceOwner) {
    const reason = `采集设备「${input.device || '未填'}」没有登记到任何岗位`
    recordDeny(actor, '登记排放监测记录', target, '归属校验', reason)
    return { ok: false, step: '归属校验', message: `已打回：${reason}（归属校验）` }
  }
  if (deviceOwner.code !== actor.postCode) {
    const reason = `采集设备「${input.device}」归属${deviceOwner.name}，${postName(actor.postCode)}不得用它登记记录`
    recordDeny(actor, '登记排放监测记录', target, '归属校验', reason)
    return { ok: false, step: '归属校验', message: `已打回：${reason}（归属校验）` }
  }

  // 步骤 2：唯一校验——同一条监测编号不允许重复登记。
  const rows = listRows(CEMS_KEY) as CemsRow[]
  if (findByNo(rows, input.monitorNo)) {
    const reason = `监测编号「${input.monitorNo}」已存在，同一条监测编号不允许重复登记`
    recordDeny(actor, '登记排放监测记录', target, '唯一校验', reason)
    return { ok: false, step: '唯一校验', message: `已打回：${reason}（唯一校验）` }
  }

  const factorLimit = limitOf(input.factor)
  const measured = asNumber(input.measured)
  const conclusion = factorLimit ? judge(measured, factorLimit.limit) : '待采集'
  const overLimit = conclusion === '超标'
  const row: CemsRow = {
    id: nextId(rows),
    status: overLimit ? CEMS_STATUS.warning : CEMS_STATUS.collected,
    pending: true,
    abnormal: overLimit,
    监测编号: input.monitorNo.trim(),
    监测因子: input.factor,
    实测值: input.measured.trim(),
    排放限值: factorLimit ? `${factorLimit.limit}${factorLimit.unit}` : '',
    折算值: input.converted.trim(),
    采集时间: input.collectedAt.trim(),
    审核人员: '',
    采集设备: input.device,
    归属岗位: deviceOwner.code,
    限值版本: factorLimit?.version ?? 1,
    超标判定: conclusion,
  }
  rows.push(row)
  saveRows(CEMS_KEY, rows)
  if (overLimit) {
    syncWarningLedger(row)
  }
  return {
    ok: true,
    data: row,
    message: overLimit
      ? `登记成功：归属${deviceOwner.name}（设备 ${input.device}），实测值超过排放限值，已生成超标预警并回写环保监控预警台账`
      : `登记成功：归属${deviceOwner.name}（设备 ${input.device}），判定达标`,
  }
}

// ---------------------------------------------------------------------------
// 编辑：非归属岗位改动固定字段/任何字段都打回；审定后整份锁定，本人也不能改。
// ---------------------------------------------------------------------------

export type EditInput = Partial<Record<(typeof EDITABLE_FIELDS)[number] | (typeof FIXED_FIELDS)[number], string>>

export function updateCems(monitorNo: string, patch: EditInput, actor: Actor): CemsResult {
  const target = `监测编号 ${monitorNo}`
  const rows = listRows(CEMS_KEY) as CemsRow[]
  const row = findByNo(rows, monitorNo)
  if (!row) {
    recordDeny(actor, '编辑排放监测记录', target, '记录校验', '记录不存在')
    return { ok: false, step: '记录校验', message: `已打回：没有找到监测编号「${monitorNo}」（记录校验）` }
  }

  // 步骤 1：锁定校验——审定完的记录整份锁住，本岗位也不能再改。
  if (isLocked(row)) {
    const reason = '记录已审定，整份记录已锁定，归属岗位本人也不能再改'
    recordDeny(actor, '编辑排放监测记录', target, '锁定校验', reason)
    return { ok: false, step: '锁定校验', message: `已打回：${reason}（锁定校验）` }
  }

  // 步骤 2：归属校验——只认采集设备所在的岗位，第三方运维和别的岗位一律挡下。
  if (!isOwner(row, actor)) {
    const reason = `该记录归属${postName(row.归属岗位)}（设备 ${row.采集设备}），${postName(actor.postCode)}无权改动`
    recordDeny(actor, '编辑排放监测记录', target, '归属校验', reason)
    return { ok: false, step: '归属校验', message: `已打回：${reason}（归属校验）` }
  }

  // 步骤 3：字段级只读校验——监测因子、排放限值等定死字段对任何改动都只读。
  const touchedFixed = (Object.keys(patch) as Array<keyof EditInput>).filter(
    (field) =>
      (FIXED_FIELDS as readonly string[]).includes(field) &&
      String(patch[field] ?? '') !== String(row[field] ?? ''),
  )
  if (touchedFixed.length > 0) {
    const reason = `字段「${touchedFixed.join('、')}」为定死只读字段，不允许修改`
    recordDeny(actor, `编辑字段 ${touchedFixed.join('、')}`, target, '字段只读校验', reason)
    return { ok: false, step: '字段只读校验', message: `已打回：${reason}（字段只读校验）` }
  }

  const index = rows.findIndex((item) => String(item.监测编号) === String(monitorNo))
  const updated: CemsRow = { ...row }
  for (const field of EDITABLE_FIELDS) {
    if (patch[field] !== undefined) {
      updated[field] = String(patch[field])
    }
  }

  // 实测信息变化后按记录登记时锁定的限值版本重新判定（限值版本不动，等限值调整统一重算）。
  const factorLimit = limitOf(row.监测因子)
  const limitValue = factorLimit?.limit ?? asNumber(row.排放限值)
  const conclusion = judge(asNumber(updated.实测值), limitValue)
  updated.超标判定 = conclusion
  updated.abnormal = conclusion === '超标'
  // 已采集记录随实测值变化在「已采集 / 超标预警」间联动；待采集记录由提交采集动作转入。
  if (String(row.status) !== CEMS_STATUS.waiting) {
    updated.status = conclusion === '超标' ? CEMS_STATUS.warning : CEMS_STATUS.collected
  }
  rows[index] = updated
  saveRows(CEMS_KEY, rows)
  if (conclusion === '超标' || row.超标判定 === '超标') {
    // 结论翻转（达标↔超标）都同步刷新台账预警。
    syncWarningLedger(updated)
  }
  return { ok: true, data: updated, message: `修改成功（归属岗位内编辑），当前判定：${conclusion}` }
}

// ---------------------------------------------------------------------------
// 提交采集：待采集 -> 已采集/超标预警
// ---------------------------------------------------------------------------

export function submitCollect(monitorNo: string, measured: string, actor: Actor): CemsResult {
  const target = `监测编号 ${monitorNo}`
  const rows = listRows(CEMS_KEY) as CemsRow[]
  const row = findByNo(rows, monitorNo)
  if (!row) {
    recordDeny(actor, '提交采集', target, '记录校验', '记录不存在')
    return { ok: false, step: '记录校验', message: `已打回：没有找到监测编号「${monitorNo}」（记录校验）` }
  }
  if (isLocked(row)) {
    recordDeny(actor, '提交采集', target, '锁定校验', '已审定记录锁定')
    return { ok: false, step: '锁定校验', message: '已打回：记录已审定锁定（锁定校验）' }
  }
  if (!isOwner(row, actor)) {
    const reason = `记录归属${postName(row.归属岗位)}，${postName(actor.postCode)}不能提交采集`
    recordDeny(actor, '提交采集', target, '归属校验', reason)
    return { ok: false, step: '归属校验', message: `已打回：${reason}（归属校验）` }
  }
  const index = rows.findIndex((item) => String(item.监测编号) === String(monitorNo))
  const factorLimit = limitOf(row.监测因子)
  const limitValue = factorLimit?.limit ?? asNumber(row.排放限值)
  const conclusion = judge(asNumber(measured), limitValue)
  const updated: CemsRow = {
    ...row,
    实测值: String(measured),
    超标判定: conclusion,
    status: conclusion === '超标' ? CEMS_STATUS.warning : CEMS_STATUS.collected,
    pending: true,
    abnormal: conclusion === '超标',
  }
  rows[index] = updated
  saveRows(CEMS_KEY, rows)
  if (conclusion === '超标') {
    syncWarningLedger(updated)
  }
  return {
    ok: true,
    data: updated,
    message:
      conclusion === '超标'
        ? '采集成功：实测值超标，已生成超标预警并回写环保监控预警台账'
        : '采集成功：判定达标',
  }
}

// ---------------------------------------------------------------------------
// 审定：归属岗位审定后整份锁定；锁定的记录限值重算也绕开。
// ---------------------------------------------------------------------------

export function approveCems(monitorNo: string, reviewer: string, actor: Actor): CemsResult {
  const target = `监测编号 ${monitorNo}`
  const rows = listRows(CEMS_KEY) as CemsRow[]
  const row = findByNo(rows, monitorNo)
  if (!row) {
    recordDeny(actor, '审定记录', target, '记录校验', '记录不存在')
    return { ok: false, step: '记录校验', message: `已打回：没有找到监测编号「${monitorNo}」（记录校验）` }
  }
  if (isLocked(row)) {
    recordDeny(actor, '审定记录', target, '锁定校验', '记录已审定')
    return { ok: false, step: '锁定校验', message: '已打回：记录已审定，不能重复审定（锁定校验）' }
  }
  if (!isOwner(row, actor)) {
    const reason = `记录归属${postName(row.归属岗位)}，${postName(actor.postCode)}不能审定`
    recordDeny(actor, '审定记录', target, '归属校验', reason)
    return { ok: false, step: '归属校验', message: `已打回：${reason}（归属校验）` }
  }
  if (String(row.status) === CEMS_STATUS.waiting) {
    recordDeny(actor, '审定记录', target, '状态校验', '记录尚未采集，不能审定')
    return { ok: false, step: '状态校验', message: '已打回：记录尚未采集，不能审定（状态校验）' }
  }

  const index = rows.findIndex((item) => String(item.监测编号) === String(monitorNo))
  const updated: CemsRow = {
    ...row,
    status: CEMS_STATUS.approved,
    pending: false,
    审核人员: reviewer.trim() || actor.operator || postName(actor.postCode),
  }
  rows[index] = updated
  saveRows(CEMS_KEY, rows)
  // 审定结论同样回写台账：审定为超标的记录，台账保持超标预警结论。
  if (updated.超标判定 === '超标') {
    syncWarningLedger(updated)
  }
  return { ok: true, data: updated, message: `审定完成：记录整份锁定，此后任何岗位（含本岗位）均不可再改` }
}

// ---------------------------------------------------------------------------
// 限值调整：未审定记录按新限值重算并保留差异；已审定记录按当时结论保留。
// ---------------------------------------------------------------------------

export function adjustFactorLimit(factor: string, newLimit: number, actor: Actor): LimitChangeResult {
  const post = POST_BY_CODE.get(actor.postCode)
  if (!post || !post.canTuneLimit) {
    recordDeny(
      actor,
      `调整限值 ${factor}`,
      `监测因子 ${factor}`,
      '权限校验',
      `${postName(actor.postCode)}没有限值调整权限`,
    )
    return {
      ok: false,
      step: '权限校验',
      message: `已打回：${postName(actor.postCode)}没有限值调整权限（权限校验）`,
    }
  }
  if (!Number.isFinite(newLimit) || newLimit <= 0) {
    recordDeny(actor, `调整限值 ${factor}`, `监测因子 ${factor}`, '参数校验', '新限值必须为正数')
    return { ok: false, step: '参数校验', message: '已打回：新限值必须为正数（参数校验）' }
  }

  const limits = currentLimits()
  const current = limits.find((item) => item.factor === factor)
  if (!current) {
    recordDeny(actor, `调整限值 ${factor}`, `监测因子 ${factor}`, '参数校验', '监测因子不存在')
    return { ok: false, step: '参数校验', message: `已打回：监测因子「${factor}」不存在（参数校验）` }
  }
  if (current.limit === newLimit) {
    return { ok: false, step: '参数校验', message: '新限值与现行限值一致，无需调整' }
  }

  const oldLimit = current.limit
  const updatedLimit: FactorLimit = {
    ...current,
    limit: newLimit,
    version: current.version + 1,
    updatedAt: nowStamp(),
    updatedBy: actorName(actor),
    postCode: actor.postCode,
  }
  saveLimits(limits.map((item) => (item.factor === factor ? updatedLimit : item)))

  // 只重算已采集但还没审定的记录（含超标预警中的）；已审定记录按当时结论保留，不动。
  const rows = listRows(CEMS_KEY) as CemsRow[]
  const batchId = nextBatchId()
  const diffs: RecalcDiff[] = []
  rows.forEach((row, index) => {
    if (row.监测因子 !== factor) {
      return
    }
    const beforeConclusion = String(row.超标判定)
    if (isLocked(row)) {
      // 兼容既有记录：审定过的仍按当时结论，仅补一条差异说明，数值与状态都不改。
      diffs.push({
        id: 0,
        batchId,
        time: nowStamp(),
        monitorNo: row.监测编号,
        factor,
        device: row.采集设备,
        oldLimit,
        newLimit,
        oldConclusion: beforeConclusion,
        newConclusion: `${beforeConclusion}（审定保留）`,
        changed: false,
        reason: '记录已审定，按审定当时结论保留，不参与重算',
      })
      return
    }
    if (String(row.status) === CEMS_STATUS.waiting) {
      return
    }
    const measured = asNumber(row.实测值)
    const afterConclusion = judge(measured, newLimit)
    const changed = beforeConclusion !== afterConclusion
    const updated: CemsRow = {
      ...row,
      排放限值: `${newLimit}${updatedLimit.unit}`,
      限值版本: updatedLimit.version,
      超标判定: afterConclusion,
      status: afterConclusion === '超标' ? CEMS_STATUS.warning : CEMS_STATUS.collected,
      abnormal: afterConclusion === '超标',
      pending: true,
    }
    rows[index] = updated
    diffs.push({
      id: 0,
      batchId,
      time: nowStamp(),
      monitorNo: row.监测编号,
      factor,
      device: row.采集设备,
      oldLimit,
      newLimit,
      oldConclusion: beforeConclusion,
      newConclusion: afterConclusion,
      changed,
      reason: changed ? '新限值导致超标结论翻转，已回写预警台账' : '结论未变，台账同步刷新',
    })
    syncWarningLedger(updated)
  })
  saveRows(CEMS_KEY, rows)

  const stored = listRecalcDiffs()
  let seq = stored.reduce((max, d) => Math.max(max, d.id), 0)
  for (const diff of diffs) {
    seq += 1
    diff.id = seq
  }
  writeJSON(RECALC_STORE, [...diffs, ...stored])

  const touched = diffs.length
  const flipped = diffs.filter((d) => d.changed).length
  return {
    ok: true,
    batchId,
    factor,
    oldLimit,
    newLimit,
    recalculated: touched,
    diffs,
    message:
      `「${factor}」限值 ${oldLimit} → ${newLimit}${updatedLimit.unit}：` +
      `共比对 ${touched} 条未审定记录，${flipped} 条超标结论翻转，差异已留存；已审定记录按当时结论保留。`,
  }
}

// ---------------------------------------------------------------------------
// 既有数据兼容：把仓库初始版 cems 占位数据补成带归属/限值的完整结构。
// 已审定的旧记录保持当时结论并直接锁定。
// ---------------------------------------------------------------------------

let migrated = false

const PLACEHOLDER_FACTORS = ['颗粒物', '二氧化硫', '氮氧化物', '氯化氢', '一氧化碳']

export function ensureCemsMigrated(): void {
  if (migrated) {
    return
  }
  migrated = true
  const rows = listRows(CEMS_KEY) as CemsRow[]
  if (rows.length === 0 || rows.every((row) => row.归属岗位 !== undefined)) {
    return
  }
  const limits = currentLimits()
  const devices = ['CEMS-A', 'CEMS-B', 'CEMS-C']
  rows.forEach((row, index) => {
    const factor = PLACEHOLDER_FACTORS[index % PLACEHOLDER_FACTORS.length]
    const device = devices[index % devices.length]
    const owner = postOf(device) ?? POSTS[0]
    const limit = limits.find((item) => item.factor === factor)
    const measured = row.status === CEMS_STATUS.waiting ? '' : String(18 + index * 3)
    const locked = String(row.status) === CEMS_STATUS.approved
    row.监测因子 = factor
    row.实测值 = measured
    row.排放限值 = limit ? `${limit.limit}${limit.unit}` : row.排放限值
    row.折算值 = measured
    row.采集设备 = device
    row.归属岗位 = owner.code
    row.限值版本 = limit?.version ?? 1
    row.超标判定 = locked
      ? asNumber(measured) > (limit?.limit ?? Infinity)
        ? '超标'
        : '达标'
      : judge(asNumber(measured), limit?.limit ?? Infinity)
    if (locked) {
      row.审核人员 = row.审核人员 || '历史审定人'
      row.pending = false
    }
  })
  saveRows(CEMS_KEY, rows)
}
