import { listRows, saveRows } from '@/data/local-store'
import type { AuditEntry, CemsRow, StandardRow, WarningRow } from './types'
import { SEED_CEMS, SEED_STANDARDS, STATUS } from './constants'

// 限值标准与改动留痕各占一个 localStorage 键；监测记录与预警台账仍走通用数据层，
// 这样环保指标监控页面能直接看到回写进来的超标预警。
const STANDARDS_KEY = 'waste-to-energy-plant:cems-standards'
const LOG_KEY = 'waste-to-energy-plant:cems-audit-log'
const MIGRATION_KEY = 'waste-to-energy-plant:cems-v2'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined' || !window.localStorage) {
    return clone(fallback)
  }
  const raw = window.localStorage.getItem(key)
  if (!raw) {
    // 首次读取就把种子落盘，否则紧接着的追加写入会丢掉种子。
    window.localStorage.setItem(key, JSON.stringify(fallback))
    return clone(fallback)
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    window.localStorage.setItem(key, JSON.stringify(fallback))
    return clone(fallback)
  }
}
function writeJson(key: string, value: unknown): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(key, JSON.stringify(value))
  }
}

// ---- 排放监测记录（含旧版示例数据一次性迁移） ----

export function cemsRows(): CemsRow[] {
  return listRows('cems') as CemsRow[]
}

export function saveCemsRows(rows: CemsRow[]): void {
  saveRows('cems', rows)
}

function seedWarnings(): void {
  // 已审定/已采集的超标结论首次进入 v2 时回写预警台账；按来源记录做幂等。
  const warnings = listRows('emission') as WarningRow[]
  const linked = new Set(warnings.map((row) => row.来源记录))
  let nextId = warnings.reduce((max, row) => Math.max(max, Number(row.id) || 0), 1000)
  const additions: WarningRow[] = []
  for (const row of cemsRows()) {
    if ((row.超标结论 === '超标' || row.审定结论 === '超标') && !linked.has(row.监测编号)) {
      nextId += 1
      const active = row.status === STATUS.collected
      additions.push({
        id: nextId,
        status: active ? '未达标' : '已达标',
        pending: active,
        abnormal: true,
        监控编号: `WARN-${nextId}`,
        监控指标: row.监测因子,
        限值要求: row.排放限值,
        实测值: row.实测值,
        达标判定: '超标',
        来源记录: row.监测编号,
        预警状态: active ? '预警中' : '已审定确认',
        回写时间: row.采集时间,
        更新时间: row.审定时间,
        解除时间: '',
        审定时间: row.审定时间,
      })
    }
  }
  if (additions.length) {
    saveRows('emission', [...warnings, ...additions])
  }
}

/** 旧版 cems 示例数据没有归属/锁定字段，首次进入时整体换成 v2 结构；只迁移一次。 */
export function ensureCemsV2(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    if (window.localStorage.getItem(MIGRATION_KEY) === '2') {
      return
    }
    saveCemsRows(clone(SEED_CEMS))
    window.localStorage.setItem(MIGRATION_KEY, '2')
  } else {
    saveCemsRows(clone(SEED_CEMS))
  }
  seedWarnings()
}

// ---- 限值标准 ----

export function listStandards(): StandardRow[] {
  return readJson<StandardRow[]>(STANDARDS_KEY, clone(SEED_STANDARDS))
}

export function saveStandards(rows: StandardRow[]): void {
  writeJson(STANDARDS_KEY, rows)
}

export function findStandard(factor: string): StandardRow | undefined {
  return listStandards().find((item) => item.因子 === factor)
}

// ---- 改动留痕 ----

const SEED_LOG: AuditEntry[] = [
  {
    id: 1,
    time: '2026-09-01 09:12',
    post: '第三方运维岗',
    operator: '外协-赵运维',
    action: '编辑排放监测记录',
    targetId: 3,
    targetCode: 'CEMS-2026-0901-03',
    stage: '归属岗位校验',
    allowed: false,
    detail: '该记录归属「2号CEMS监测岗」（采集设备 CEMS-DEV-02），第三方运维岗无权改动，改动已打回。',
    changes: [
      { field: '实测值', from: '326.8', to: '280.0' },
    ],
  },
]

export function listAuditLog(): AuditEntry[] {
  return readJson<AuditEntry[]>(LOG_KEY, clone(SEED_LOG))
}

export function appendAuditLog(
  entry: Omit<AuditEntry, 'id'>,
): AuditEntry {
  const rows = listAuditLog()
  const id = rows.reduce((max, item) => Math.max(max, item.id), 0) + 1
  const saved = { ...entry, id }
  writeJson(LOG_KEY, [saved, ...rows])
  return saved
}

// ---- 环保监控预警台账（写在通用 emission 数据里） ----

export function listWarnings(): WarningRow[] {
  return listRows('emission') as WarningRow[]
}

export function saveWarnings(rows: WarningRow[]): void {
  saveRows('emission', rows)
}
