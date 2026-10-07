/**
 * 在线排放监测（CEMS）页面读写入口。
 * 业务判定全部在 @/data/cems，本层只做列表读取、筛选、导出与会话透传。
 */
import {
  POSTS,
  adjustFactorLimit,
  approveCems,
  currentLimits,
  editableFieldSet,
  ensureCemsMigrated,
  listDenyLogs,
  listRecalcDiffs,
  postName,
  registerCems,
  submitCollect,
  updateCems,
} from '@/data/cems'
import { listRows } from '@/data/local-store'
import type {
  Actor,
  CemsResult,
  CemsRow,
  DenyLog,
  FactorLimit,
  LimitChangeResult,
  RecalcDiff,
  RegisterInput,
} from '@/data/cems'
import type { EntryRow } from '@/data/types'

export {
  POSTS,
  CEMS_STATUS,
  EDITABLE_FIELDS,
  FIXED_FIELDS,
  editableFieldSet,
  isLocked,
  postName,
} from '@/data/cems'

export function listCems(filters: Record<string, string> = {}): CemsRow[] {
  ensureCemsMigrated()
  const rows = listRows('cems') as CemsRow[]
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function register(input: RegisterInput, actor: Actor): CemsResult {
  ensureCemsMigrated()
  return registerCems(input, actor)
}

export function edit(
  monitorNo: string,
  patch: Record<string, string>,
  actor: Actor,
): CemsResult {
  ensureCemsMigrated()
  return updateCems(monitorNo, patch, actor)
}

export function collect(monitorNo: string, measured: string, actor: Actor): CemsResult {
  ensureCemsMigrated()
  return submitCollect(monitorNo, measured, actor)
}

export function approve(monitorNo: string, reviewer: string, actor: Actor): CemsResult {
  ensureCemsMigrated()
  return approveCems(monitorNo, reviewer, actor)
}

export function limits(): FactorLimit[] {
  return currentLimits()
}

export function adjustLimit(factor: string, newLimit: number, actor: Actor): LimitChangeResult {
  ensureCemsMigrated()
  return adjustFactorLimit(factor, newLimit, actor)
}

export function denyLogs(): DenyLog[] {
  return listDenyLogs()
}

export function recalcDiffs(): RecalcDiff[] {
  return listRecalcDiffs()
}

export function warningLedger(): EntryRow[] {
  return listRows('emission').filter(
    (row) => String(row.监控编号 ?? '').startsWith('WARN-') || row.来源监测编号 !== undefined,
  )
}

export function exportCemsCsv(): { filename: string; content: string } {
  const header = [
    '监测编号',
    '监测因子',
    '实测值',
    '排放限值',
    '折算值',
    '采集设备',
    '归属岗位',
    '限值版本',
    '超标判定',
    '采集时间',
    '审核人员',
    '当前状态',
  ]
  const lines = [header.join(',')]
  for (const row of listCems()) {
    lines.push(
      [
        row.监测编号,
        row.监测因子,
        row.实测值,
        row.排放限值,
        row.折算值,
        row.采集设备,
        postName(String(row.归属岗位)),
        row.限值版本,
        row.超标判定,
        row.采集时间,
        row.审核人员,
        row.status,
      ].join(','),
    )
  }
  return { filename: '在线排放监测-清单.csv', content: `﻿${lines.join('\n')}` }
}
