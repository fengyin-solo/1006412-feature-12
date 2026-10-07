/** 在线排放监测（CEMS）领域模型：归属控制、审定锁定、限值重算、改动留痕都围绕这些结构。 */
import type { EntryRow } from '@/data/types'

/** 排放监测记录。归属岗位由采集设备决定，记录一旦审定即整份锁定。 */
export interface CemsRow extends EntryRow {
  监测编号: string
  监测因子: string
  采集设备: string
  归属岗位: string
  排放限值: string
  实测值: string
  折算值: string
  采集时间: string
  审核人员: string
  超标结论: '' | '达标' | '超标'
  审定人员: string
  审定时间: string
  审定限值: string
  审定结论: '' | '达标' | '超标'
  重算次数: number
  锁定: boolean
}

/** 限值标准：按监测因子维护，调整后对未审定记录触发重算。 */
export interface StandardRow {
  因子: string
  限值: number
  单位: string
  更新时间: string
  更新人: string
}

/** 改动尝试留痕：不管放行还是打回都记一条，谁、什么时候、想动哪一条都能倒查。 */
export interface FieldChange {
  field: string
  from: string
  to: string
}

export interface AuditEntry {
  id: number
  time: string
  post: string
  operator: string
  action: string
  targetId: number | null
  targetCode: string
  /** 卡在哪一步：归属岗位校验 / 固化字段保护 / 审定锁定 …… 放行记「完成」。 */
  stage: string
  allowed: boolean
  detail: string
  changes: FieldChange[]
}

/** 回写到环保监控预警台账的行（存放在 emission 模块数据里）。 */
export interface WarningRow extends EntryRow {
  监控编号: string
  监控指标: string
  限值要求: string
  实测值: string
  达标判定: string
  来源记录: string
  预警状态: '预警中' | '已解除' | '已审定确认'
  回写时间: string
  更新时间: string
  解除时间: string
  审定时间: string
}

export interface OperatorContext {
  post: string
  operator: string
}

export interface ServiceResult<T = undefined> {
  ok: boolean
  message: string
  /** 打回发生的环节，页面上原样展示「卡在哪一步」。 */
  stage?: string
  data?: T
}

export interface RegisterInput {
  监测编号: string
  监测因子: string
  采集设备: string
  实测值: string
  折算值: string
  采集时间: string
}

export interface CollectInput {
  实测值: string
  折算值: string
  采集时间: string
}

export interface RecalcItem {
  targetCode: string
  oldLimit: string
  newLimit: string
  oldConclusion: '' | '达标' | '超标'
  newConclusion: '' | '达标' | '超标'
}

export interface AdjustSummary {
  factor: string
  newLimit: number
  recalced: RecalcItem[]
  lockedSkipped: number
  pendingUpdated: number
}
