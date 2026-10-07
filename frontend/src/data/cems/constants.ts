import type { CemsRow, StandardRow } from './types'

/** 岗位：每条监测记录只认采集它的那台设备所在的岗位，跨岗位改动一律打回。 */
export const CEMS_POSTS = ['1号CEMS监测岗', '2号CEMS监测岗'] as const
export const THIRD_PARTY_POST = '第三方运维岗'
export const ENV_POST = '环保管理岗'

/** 可在平台上操作的全部岗位，用于切换当前身份验证归属拦截。 */
export const ALL_POSTS = [...CEMS_POSTS, THIRD_PARTY_POST, ENV_POST]

/** 采集设备台账：设备 → 岗位，归属从设备上带出来，登记时不能手填岗位。 */
export const CEMS_DEVICES: { code: string; name: string; post: string }[] = [
  { code: 'CEMS-DEV-01', name: '1号烟气在线监测仪', post: '1号CEMS监测岗' },
  { code: 'CEMS-DEV-02', name: '2号烟气在线监测仪', post: '2号CEMS监测岗' },
]

export function postOfDevice(deviceCode: string): string {
  return CEMS_DEVICES.find((item) => item.code === deviceCode)?.post ?? ''
}

/** 监测因子、排放限值这些是改不得的固化字段：非归属岗位只读，归属岗位也不允许从记录上直接改。 */
export const FIXED_FIELDS = ['监测编号', '监测因子', '采集设备', '归属岗位']
/** 审定后仍保留结论的快照字段。 */
export const LOCK_FIELDS = ['排放限值', '实测值', '折算值', '采集时间', '审核人员']

/** 拦截发生的环节（留痕的 stage），按守卫执行顺序排列。 */
export const STAGE = {
  duplicate: '监测编号查重',
  ownership: '归属岗位校验',
  fixedField: '固化字段保护',
  lock: '审定锁定校验',
  allow: '完成',
  standard: '限值标准维护',
} as const

export const STATUS = {
  pending: '待采集',
  collected: '已采集',
  approved: '已审定',
} as const

/** 初始排放限值标准（单位随因子），调整后只影响已采集未审定的记录。 */
export const SEED_STANDARDS: StandardRow[] = [
  { 因子: '颗粒物', 限值: 30, 单位: 'mg/m³', 更新时间: '2026-08-01 09:00', 更新人: '环保管理岗' },
  { 因子: '二氧化硫', 限值: 100, 单位: 'mg/m³', 更新时间: '2026-08-01 09:00', 更新人: '环保管理岗' },
  { 因子: '氮氧化物', 限值: 300, 单位: 'mg/m³', 更新时间: '2026-08-01 09:00', 更新人: '环保管理岗' },
  { 因子: '氯化氢', 限值: 60, 单位: 'mg/m³', 更新时间: '2026-08-01 09:00', 更新人: '环保管理岗' },
  { 因子: '一氧化碳', 限值: 80, 单位: 'mg/m³', 更新时间: '2026-08-01 09:00', 更新人: '环保管理岗' },
]

function base(id: number, patch: Partial<CemsRow>): CemsRow {
  return {
    id,
    status: STATUS.pending,
    pending: true,
    abnormal: false,
    监测编号: '',
    监测因子: '',
    采集设备: '',
    归属岗位: '',
    排放限值: '',
    实测值: '',
    折算值: '',
    采集时间: '',
    审核人员: '',
    超标结论: '',
    审定人员: '',
    审定时间: '',
    审定限值: '',
    审定结论: '',
    重算次数: 0,
    锁定: false,
    ...patch,
  }
}

/** v2 示例：覆盖待采集 / 已采集达标 / 已采集超标 / 已审定达标 / 已审定超标（按旧限值审定）几种情形。 */
export const SEED_CEMS: CemsRow[] = [
  base(1, {
    status: STATUS.pending,
    pending: true,
    监测编号: 'CEMS-2026-0901-01',
    监测因子: '颗粒物',
    采集设备: 'CEMS-DEV-01',
    归属岗位: '1号CEMS监测岗',
    排放限值: '30 mg/m³',
    采集时间: '2026-09-01 08:00',
  }),
  base(2, {
    status: STATUS.collected,
    pending: true,
    监测编号: 'CEMS-2026-0901-02',
    监测因子: '二氧化硫',
    采集设备: 'CEMS-DEV-01',
    归属岗位: '1号CEMS监测岗',
    排放限值: '100 mg/m³',
    实测值: '76.4',
    折算值: '72.1',
    采集时间: '2026-09-01 08:05',
    超标结论: '达标',
  }),
  base(3, {
    status: STATUS.collected,
    pending: true,
    abnormal: true,
    监测编号: 'CEMS-2026-0901-03',
    监测因子: '氮氧化物',
    采集设备: 'CEMS-DEV-02',
    归属岗位: '2号CEMS监测岗',
    排放限值: '300 mg/m³',
    实测值: '326.8',
    折算值: '318.5',
    采集时间: '2026-09-01 08:10',
    超标结论: '超标',
  }),
  base(4, {
    status: STATUS.approved,
    pending: false,
    监测编号: 'CEMS-2026-0830-04',
    监测因子: '氯化氢',
    采集设备: 'CEMS-DEV-01',
    归属岗位: '1号CEMS监测岗',
    排放限值: '60 mg/m³',
    实测值: '42.3',
    折算值: '40.0',
    采集时间: '2026-08-30 14:00',
    审核人员: '王审定',
    超标结论: '达标',
    审定人员: '王审定',
    审定时间: '2026-08-30 16:00',
    审定限值: '60 mg/m³',
    审定结论: '达标',
    锁定: true,
  }),
  base(5, {
    status: STATUS.approved,
    pending: false,
    abnormal: true,
    监测编号: 'CEMS-2026-0830-05',
    监测因子: '一氧化碳',
    采集设备: 'CEMS-DEV-02',
    归属岗位: '2号CEMS监测岗',
    // 按当时 100 的限值（88 达标）；现行限值 80，若误重算会变成超标——用来验证审定记录不重算。
    排放限值: '100 mg/m³',
    实测值: '88.6',
    折算值: '85.2',
    采集时间: '2026-08-30 14:10',
    审核人员: '王审定',
    超标结论: '达标',
    审定人员: '王审定',
    审定时间: '2026-08-30 16:10',
    审定限值: '100 mg/m³',
    审定结论: '达标',
    锁定: true,
  }),
]
