import { moduleMeta } from '@/api/local-service'
import {
  ENV_POST,
  FIXED_FIELDS,
  STAGE,
  STATUS,
  postOfDevice,
} from '@/data/cems/constants'
import {
  appendAuditLog,
  cemsRows,
  findStandard,
  listAuditLog,
  listStandards,
  listWarnings,
  saveCemsRows,
  saveStandards,
  saveWarnings,
} from '@/data/cems/store'
import type {
  AdjustSummary,
  AuditEntry,
  CemsRow,
  CollectInput,
  FieldChange,
  OperatorContext,
  RecalcItem,
  RegisterInput,
  ServiceResult,
  WarningRow,
} from '@/data/cems/types'

export { listAuditLog, listStandards, listWarnings }
export { ensureCemsV2 } from '@/data/cems/store'

export const CEMS_FIELDS = [
  '监测编号', '监测因子', '采集设备', '归属岗位', '排放限值',
  '实测值', '折算值', '采集时间', '审核人员', '超标结论',
  '审定人员', '审定时间', '审定限值', '审定结论', '重算次数',
]

/** 归属岗位可改的字段；其余一律视为固化字段，连归属岗位自己也不能在记录上直接动。 */
const EDITABLE_FIELDS = ['实测值', '折算值', '采集时间']

// ---------- 基础工具 ----------

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function now(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 从「30 mg/m³」「76.4」这类文本里取出数值，取不出就返回 null。 */
export function parseNumber(text: string | number): number | null {
  if (typeof text === 'number') {
    return Number.isFinite(text) ? text : null
  }
  const matched = String(text).match(/-?\d+(\.\d+)?/)
  if (!matched) {
    return null
  }
  const value = Number(matched[0])
  return Number.isFinite(value) ? value : null
}

function limitText(factor: string): string {
  const standard = findStandard(factor)
  return standard ? `${standard.限值} ${standard.单位}` : ''
}

function evaluate(valueText: string | number, limit: string | number): '' | '达标' | '超标' {
  const value = parseNumber(valueText)
  const bound = parseNumber(limit)
  if (value === null || bound === null) {
    return ''
  }
  return value > bound ? '超标' : '达标'
}

function diffFields(before: CemsRow, patch: Record<string, string>): FieldChange[] {
  return Object.entries(patch)
    .filter(([field, to]) => String(before[field] ?? '') !== String(to ?? ''))
    .map(([field, to]) => ({ field, from: String(before[field] ?? ''), to: String(to ?? '') }))
}

function persist(rows: CemsRow[]): void {
  saveCemsRows(rows)
}

// ---------- 超标结论回写环保监控预警台账 ----------

function syncWarning(row: CemsRow): void {
  const warnings = listWarnings()
  const index = warnings.findIndex((item) => item.来源记录 === row.监测编号)
  const existing = index >= 0 ? warnings[index] : undefined
  const time = now()

  let target: { state: WarningRow['预警状态']; limit: string } | null = null
  if (row.status === STATUS.collected && row.超标结论 === '超标') {
    target = { state: '预警中', limit: row.排放限值 }
  } else if (row.锁定 && row.审定结论 === '超标') {
    target = { state: '已审定确认', limit: row.审定限值 || row.排放限值 }
  }

  if (target) {
    const confirmed = target.state === '已审定确认'
    if (existing) {
      const payload: WarningRow = {
        ...existing,
        监控指标: row.监测因子,
        限值要求: target.limit,
        实测值: row.实测值,
        达标判定: '超标',
        预警状态: target.state,
        更新时间: time,
        审定时间: confirmed ? row.审定时间 : '',
        解除时间: confirmed ? '' : existing.解除时间,
        status: '未达标',
        pending: target.state === '预警中',
        abnormal: true,
      }
      saveWarnings(warnings.map((item) => (item === existing ? payload : item)))
      return
    }
    const nextId = Math.max(...warnings.map((w) => Number(w.id) || 0), 1000) + 1
    const payload: WarningRow = {
      id: nextId,
      status: '未达标',
      pending: target.state === '预警中',
      abnormal: true,
      监控编号: `WARN-${nextId}`,
      监控指标: row.监测因子,
      限值要求: target.limit,
      实测值: row.实测值,
      达标判定: '超标',
      来源记录: row.监测编号,
      预警状态: target.state,
      回写时间: time,
      更新时间: time,
      解除时间: '',
      审定时间: confirmed ? row.审定时间 : '',
    }
    saveWarnings([...warnings, payload])
    return
  }

  // 记录转达标或审定达标：挂着的预警解除，已审定确认的保留不动。
  if (existing && existing.预警状态 === '预警中') {
    const resolved: WarningRow = {
      ...existing,
      实测值: row.实测值,
      限值要求: row.锁定 ? row.审定限值 || existing.限值要求 : row.排放限值,
      预警状态: '已解除',
      更新时间: time,
      解除时间: time,
      status: '已达标',
      pending: false,
      abnormal: false,
    }
    saveWarnings(warnings.map((item, i) => (i === index ? resolved : item)))
  }
}

// ---------- 改动留痕 ----------

type LogInput = {
  ctx: OperatorContext
  action: string
  allowed: boolean
  stage: string
  detail: string
  target?: Pick<CemsRow, 'id' | '监测编号'> | null
  targetCode?: string
  changes?: FieldChange[]
}

function trace(input: LogInput): AuditEntry {
  return appendAuditLog({
    time: now(),
    post: input.ctx.post,
    operator: input.ctx.operator,
    action: input.action,
    targetId: input.target?.id ?? null,
    targetCode: input.target?.监测编号 ?? input.targetCode ?? '',
    stage: input.stage,
    allowed: input.allowed,
    detail: input.detail,
    changes: input.changes ?? [],
  })
}

function deny<T = undefined>(input: LogInput): ServiceResult<T> {
  trace(input)
  return { ok: false, stage: input.stage, message: `【${input.stage}】${input.detail}` }
}

// ---------- 守卫：按顺序卡，打回时明确卡在哪一步 ----------

function guardRow(
  row: CemsRow,
  ctx: OperatorContext,
  action: string,
  changes: FieldChange[],
): ServiceResult | null {
  // 1. 审定整份锁定，本岗位也不能再改
  if (row.锁定) {
    return deny({
      ctx,
      action,
      allowed: false,
      stage: STAGE.lock,
      detail: `监测记录 ${row.监测编号} 已于 ${row.审定时间} 审定（${row.审定结论}），记录整份锁定，任何岗位均不可再改。`,
      target: row,
      changes,
    })
  }
  // 2. 归属岗位校验：只认采集设备所在的岗位
  if (ctx.post !== row.归属岗位) {
    return deny({
      ctx,
      action,
      allowed: false,
      stage: STAGE.ownership,
      detail: `监测记录 ${row.监测编号} 由采集设备 ${row.采集设备} 归属「${row.归属岗位}」，当前岗位「${ctx.post}」无权改动，改动已打回。`,
      target: row,
      changes,
    })
  }
  return null
}

// ---------- 查询 ----------

export function listCems(filters: Record<string, string> = {}): CemsRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  const rows = cemsRows()
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => {
      if (field === '状态') {
        return row.status === value
      }
      return String(row[field] ?? '').includes(value.trim())
    }),
  )
}

export type CemsStat = { label: string; value: number }

export function cemsStats(): CemsStat[] {
  const rows = cemsRows()
  return [
    { label: '待采集', value: rows.filter((r) => r.status === STATUS.pending).length },
    { label: '已采集待审', value: rows.filter((r) => r.status === STATUS.collected).length },
    {
      label: '超标预警中',
      value: rows.filter((r) => r.status === STATUS.collected && r.超标结论 === '超标').length,
    },
    { label: '已审定（锁定）', value: rows.filter((r) => r.status === STATUS.approved).length },
    { label: '被打回尝试', value: listAuditLog().filter((item) => !item.allowed).length },
  ]
}

/** 页面用：这条记录当前岗位能不能编辑，固化字段是否只读。 */
export function canEditRow(row: CemsRow, ctx: OperatorContext): boolean {
  return !row.锁定 && ctx.post === row.归属岗位
}

export function isFixedField(field: string): boolean {
  return FIXED_FIELDS.includes(field) || field === '排放限值'
}

// ---------- 登记 ----------

export function registerCems(input: RegisterInput, ctx: OperatorContext): ServiceResult<CemsRow> {
  const code = input.监测编号.trim()
  const action = '登记监测记录'

  if (!code || !input.监测因子 || !input.采集设备) {
    return { ok: false, stage: '表单校验', message: '【表单校验】监测编号、监测因子、采集设备为必填项。' }
  }

  // 同一条监测编号不允许重复登记
  const rows = cemsRows()
  if (rows.some((row) => row.监测编号 === code)) {
    return deny({
      ctx,
      action,
      allowed: false,
      stage: STAGE.duplicate,
      detail: `监测编号 ${code} 已登记，同一监测编号不允许重复登记。`,
      targetCode: code,
    })
  }

  const ownerPost = postOfDevice(input.采集设备)
  if (ctx.post !== ownerPost) {
    return deny({
      ctx,
      action,
      allowed: false,
      stage: STAGE.ownership,
      detail: `采集设备 ${input.采集设备} 归属「${ownerPost}」，当前岗位「${ctx.post}」不能以该设备登记记录。`,
      targetCode: code,
    })
  }

  const value = input.实测值.trim()
  const collected = value !== ''
  const limit = limitText(input.监测因子)
  const conclusion = collected ? evaluate(value, limit) : ''
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const row: CemsRow = {
    id,
    status: collected ? STATUS.collected : STATUS.pending,
    pending: !collected,
    abnormal: conclusion === '超标',
    监测编号: code,
    监测因子: input.监测因子,
    采集设备: input.采集设备,
    归属岗位: ownerPost,
    排放限值: limit,
    实测值: collected ? value : '',
    折算值: input.折算值.trim(),
    采集时间: input.采集时间 || now(),
    审核人员: '',
    超标结论: conclusion,
    审定人员: '',
    审定时间: '',
    审定限值: '',
    审定结论: '',
    重算次数: 0,
    锁定: false,
  }
  persist([...rows, row])
  if (conclusion === '超标') {
    syncWarning(row)
  }
  trace({
    ctx,
    action,
    allowed: true,
    stage: STAGE.allow,
    detail: `监测记录 ${code} 登记成功，归属岗位「${ownerPost}」，当前状态「${row.status}」。`,
    target: row,
  })
  return { ok: true, message: `监测记录 ${code} 登记成功，归属「${ownerPost}」。`, data: row }
}

// ---------- 提交采集 ----------

export function collectCems(id: number, input: CollectInput, ctx: OperatorContext): ServiceResult {
  const action = '提交采集'
  const rows = cemsRows()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: '没有找到该监测记录' }
  }
  const row = rows[index]

  if (row.status !== STATUS.pending) {
    return deny({
      ctx,
      action,
      allowed: false,
      stage: '状态流转',
      detail: `监测记录 ${row.监测编号} 当前为「${row.status}」，只有待采集记录可以提交采集。`,
      target: row,
    })
  }
  const blocked = guardRow(row, ctx, action, [])
  if (blocked) {
    return blocked
  }
  const value = input.实测值.trim()
  if (parseNumber(value) === null) {
    return { ok: false, stage: '表单校验', message: '【表单校验】实测值必须是数值。' }
  }

  const updated: CemsRow = {
    ...row,
    status: STATUS.collected,
    pending: true,
    实测值: value,
    折算值: input.折算值.trim(),
    采集时间: input.采集时间 || now(),
    排放限值: row.排放限值 || limitText(row.监测因子),
  }
  updated.超标结论 = evaluate(updated.实测值, updated.排放限值)
  updated.abnormal = updated.超标结论 === '超标'
  rows[index] = updated
  persist(rows)
  syncWarning(updated)
  trace({
    ctx,
    action,
    allowed: true,
    stage: STAGE.allow,
    detail: `监测记录 ${updated.监测编号} 采集完成，按限值 ${updated.排放限值} 判定「${updated.超标结论}」。`,
    target: updated,
    changes: [
      { field: '实测值', from: '', to: value },
      { field: '超标结论', from: '', to: updated.超标结论 },
    ],
  })
  return { ok: true, message: `采集成功，超标判定：${updated.超标结论}` }
}

// ---------- 编辑字段（归属岗位校验 + 固化字段保护都在这里） ----------

export function updateCemsFields(
  id: number,
  patch: Record<string, string>,
  ctx: OperatorContext,
): ServiceResult {
  const action = '编辑监测字段'
  const rows = cemsRows()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: '没有找到该监测记录' }
  }
  const row = rows[index]
  const changes = diffFields(row, patch)
  if (changes.length === 0) {
    return { ok: false, stage: '表单校验', message: '【表单校验】没有检测到字段变化。' }
  }

  const blocked = guardRow(row, ctx, action, changes)
  if (blocked) {
    return blocked
  }

  // 3. 固化字段保护：监测因子/排放限值/监测编号/采集设备/归属岗位改不得
  const touchedFixed = changes.filter((item) => isFixedField(item.field))
  if (touchedFixed.length) {
    return deny({
      ctx,
      action,
      allowed: false,
      stage: STAGE.fixedField,
      detail: `字段 ${touchedFixed.map((c) => `「${c.field}」`).join('、')} 为固化字段，任何岗位均不得在记录上修改（排放限值请走限值标准调整并触发重算），改动已打回。`,
      target: row,
      changes: touchedFixed,
    })
  }
  const illegal = changes.filter((item) => !EDITABLE_FIELDS.includes(item.field))
  if (illegal.length) {
    return deny({
      ctx,
      action,
      allowed: false,
      stage: STAGE.fixedField,
      detail: `字段 ${illegal.map((c) => `「${c.field}」`).join('、')} 不在可编辑范围内，改动已打回。`,
      target: row,
      changes: illegal,
    })
  }
  if (row.status === STATUS.collected && changes.some((c) => c.field === '实测值')) {
    const nextValue = changes.find((c) => c.field === '实测值')?.to ?? ''
    if (parseNumber(nextValue) === null) {
      return { ok: false, stage: '表单校验', message: '【表单校验】已采集记录的实测值必须是数值，不能清空。' }
    }
  }

  const updated: CemsRow = { ...row }
  for (const change of changes) {
    ;(updated as unknown as Record<string, string>)[change.field] = change.to
  }
  // 已采集记录改了实测值，按当前记录限值重新判定并同步预警台账
  if (row.status === STATUS.collected && changes.some((c) => c.field === '实测值')) {
    const before = updated.超标结论
    updated.超标结论 = evaluate(updated.实测值, updated.排放限值)
    updated.abnormal = updated.超标结论 === '超标'
    if (before !== updated.超标结论) {
      changes.push({ field: '超标结论', from: before, to: updated.超标结论 })
    }
  }
  rows[index] = updated
  persist(rows)
  syncWarning(updated)
  trace({
    ctx,
    action,
    allowed: true,
    stage: STAGE.allow,
    detail: `监测记录 ${updated.监测编号} 的 ${changes.map((c) => `「${c.field}」`).join('、')} 已更新。`,
    target: updated,
    changes,
  })
  return { ok: true, message: '修改已保存' }
}

// ---------- 审定：审定完整份锁定 ----------

export function approveCems(id: number, ctx: OperatorContext): ServiceResult {
  const action = '审定记录'
  const rows = cemsRows()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: '没有找到该监测记录' }
  }
  const row = rows[index]

  if (ctx.post !== ENV_POST) {
    return deny({
      ctx,
      action,
      allowed: false,
      stage: '审定权限',
      detail: `监测记录审定仅由「${ENV_POST}」执行，当前岗位「${ctx.post}」的审定操作已打回。`,
      target: row,
    })
  }
  if (row.锁定) {
    return deny({
      ctx,
      action,
      allowed: false,
      stage: STAGE.lock,
      detail: `监测记录 ${row.监测编号} 已审定锁定，不能重复审定。`,
      target: row,
    })
  }
  if (row.status !== STATUS.collected) {
    return deny({
      ctx,
      action,
      allowed: false,
      stage: '状态流转',
      detail: `监测记录 ${row.监测编号} 当前为「${row.status}」，只有已采集记录可以审定。`,
      target: row,
    })
  }

  const time = now()
  const updated: CemsRow = {
    ...row,
    status: STATUS.approved,
    pending: false,
    abnormal: row.超标结论 === '超标',
    审核人员: ctx.operator,
    审定人员: ctx.operator,
    审定时间: time,
    审定限值: row.排放限值,
    审定结论: row.超标结论,
    锁定: true,
  }
  rows[index] = updated
  persist(rows)
  syncWarning(updated)
  trace({
    ctx,
    action,
    allowed: true,
    stage: STAGE.allow,
    detail: `监测记录 ${updated.监测编号} 已审定，结论「${updated.审定结论}」，按限值 ${updated.审定限值} 快照保留并整份锁定。`,
    target: updated,
  })
  return { ok: true, message: `已审定（${updated.审定结论}），记录已锁定` }
}

// ---------- 排放限值调整：未审定记录按新限值重算，审定记录维持原结论 ----------

export function adjustStandard(
  factor: string,
  newLimit: number,
  ctx: OperatorContext,
): ServiceResult<AdjustSummary> {
  const action = '调整排放限值'
  if (ctx.post !== ENV_POST) {
    return deny({
      ctx,
      action,
      allowed: false,
      stage: STAGE.standard,
      detail: `排放限值标准仅由「${ENV_POST}」维护，当前岗位「${ctx.post}」的调整已打回。`,
      targetCode: factor,
    })
  }
  if (!Number.isFinite(newLimit) || newLimit <= 0) {
    return { ok: false, stage: '表单校验', message: '【表单校验】新限值必须是大于 0 的数值。' }
  }

  const standards = listStandards()
  const standard = standards.find((item) => item.因子 === factor)
  if (!standard) {
    return { ok: false, stage: STAGE.standard, message: `【${STAGE.standard}】因子「${factor}」未在限值标准中登记。` }
  }
  const oldLimitText = `${standard.限值} ${standard.单位}`
  const newLimitText = `${newLimit} ${standard.单位}`
  if (standard.限值 === newLimit) {
    return { ok: false, stage: STAGE.standard, message: '【限值标准维护】新限值与现行限值相同，无需调整。' }
  }

  const time = now()
  saveStandards(
    standards.map((item) =>
      item.因子 === factor ? { ...item, 限值: newLimit, 更新时间: time, 更新人: ctx.operator } : item,
    ),
  )

  const rows = cemsRows()
  const recalced: RecalcItem[] = []
  let lockedSkipped = 0
  let pendingUpdated = 0

  rows.forEach((row, index) => {
    if (row.监测因子 !== factor) {
      return
    }
    // 已审定记录维持当时的限值与结论，不参与重算，兼容既有记录
    if (row.锁定) {
      lockedSkipped += 1
      return
    }
    if (row.status === STATUS.pending) {
      rows[index] = { ...row, 排放限值: newLimitText }
      pendingUpdated += 1
      return
    }

    const oldConclusion = row.超标结论
    const updated: CemsRow = {
      ...row,
      排放限值: newLimitText,
      重算次数: Number(row.重算次数 || 0) + 1,
    }
    updated.超标结论 = evaluate(updated.实测值, newLimitText)
    updated.abnormal = updated.超标结论 === '超标'
    rows[index] = updated
    recalced.push({
      targetCode: row.监测编号,
      oldLimit: oldLimitText,
      newLimit: newLimitText,
      oldConclusion,
      newConclusion: updated.超标结论,
    })
    const changes: FieldChange[] = [
      { field: '排放限值', from: oldLimitText, to: newLimitText },
      { field: '超标结论', from: oldConclusion, to: updated.超标结论 },
    ]
    syncWarning(updated)
    trace({
      ctx,
      action: '限值重算',
      allowed: true,
      stage: STAGE.allow,
      detail:
        oldConclusion === updated.超标结论
          ? `记录 ${row.监测编号} 按新限值重算，结论仍为「${updated.超标结论}」。`
          : `记录 ${row.监测编号} 按新限值重算，结论由「${oldConclusion}」变为「${updated.超标结论}」，预警台账已同步。`,
      target: updated,
      changes,
    })
  })
  persist(rows)

  const summary: AdjustSummary = { factor, newLimit, recalced, lockedSkipped, pendingUpdated }
  trace({
    ctx,
    action,
    allowed: true,
    stage: STAGE.allow,
    detail:
      `「${factor}」排放限值由 ${oldLimitText} 调整为 ${newLimitText}：` +
      `重算已采集记录 ${recalced.length} 条（结论翻转 ${recalced.filter((r) => r.oldConclusion !== r.newConclusion).length} 条），` +
      `待采集记录同步限值 ${pendingUpdated} 条，已审定记录维持原结论 ${lockedSkipped} 条。`,
    targetCode: factor,
  })
  return {
    ok: true,
    message: `限值已调整：重算 ${recalced.length} 条，${lockedSkipped} 条审定记录保持原结论。`,
    data: summary,
  }
}

// ---------- 导出（沿用通用 CSV 导出，字段换成归属控制后的列） ----------

export function ensureCemsMeta(): void {
  // 通用模块元数据仍是旧列，导出前同步为新字段，页面其余逻辑不受影响。
  const meta = moduleMeta('cems')
  meta.fields = CEMS_FIELDS
  meta.statuses = [STATUS.pending, STATUS.collected, STATUS.approved]
}
