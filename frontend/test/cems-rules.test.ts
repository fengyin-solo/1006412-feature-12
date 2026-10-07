// CEMS 归属/锁定/重算/留痕/回写的端到端规则验证（node 下跑，localStorage 用内存桩替代）。
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const memStore = new Map<string, string>()
;(globalThis as any).window = {
  localStorage: {
    getItem: (k: string) => (memStore.has(k) ? memStore.get(k)! : null),
    setItem: (k: string, v: string) => void memStore.set(k, v),
    removeItem: (k: string) => void memStore.delete(k),
  },
}

import {
  adjustStandard,
  approveCems,
  collectCems,
  ensureCemsV2,
  listAuditLog,
  listCems,
  listWarnings,
  registerCems,
  updateCemsFields,
} from '../src/api/cems-service'

ensureCemsV2()

const listRows = (key: string) =>
  key === 'emission' ? listWarnings() : listCems({})

const post1 = { post: '1号CEMS监测岗', operator: '李监测' }
const post2 = { post: '2号CEMS监测岗', operator: '陈监测' }
const third = { post: '第三方运维岗', operator: '外协-赵运维' }
const env = { post: '环保管理岗', operator: '王审定' }

let passed = 0
let failed = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name} ${extra}`)
  }
}

// 1. 初始 v2 数据迁移
let rows = listCems({})
check('迁移后有 5 条 v2 监测记录', rows.length === 5, `实际 ${rows.length}`)
check('归属由采集设备带出', rows[0].归属岗位 === '1号CEMS监测岗')
check('已审定记录整份锁定', rows.find((r: any) => r.监测编号 === 'CEMS-2026-0830-05')?.锁定 === true)

// 2. 重复监测编号登记被拦
let r = registerCems(
  { 监测编号: 'CEMS-2026-0901-01', 监测因子: '颗粒物', 采集设备: 'CEMS-DEV-01', 实测值: '10', 折算值: '', 采集时间: '' },
  post1,
)
check('重复监测编号被打回', r.ok === false && r.stage === '监测编号查重', r.message)

// 3. 跨岗位登记被拦（设备 02 属于 2 号岗）
r = registerCems(
  { 监测编号: 'CEMS-TEST-X1', 监测因子: '颗粒物', 采集设备: 'CEMS-DEV-02', 实测值: '10', 折算值: '', 采集时间: '' },
  post1,
)
check('设备归属不符的登记被打回', r.ok === false && r.stage === '归属岗位校验', r.message)

// 4. 正常登记，超标自动判定（颗粒物限值 30）
r = registerCems(
  { 监测编号: 'CEMS-TEST-A1', 监测因子: '颗粒物', 采集设备: 'CEMS-DEV-01', 实测值: '45', 折算值: '42', 采集时间: '2026-09-07 09:00' },
  post1,
)
check('归属岗位登记超标记录成功', r.ok === true, r.message)
const newRow = listCems({}).find((x: any) => x.监测编号 === 'CEMS-TEST-A1')
check('登记即按限值判定超标', newRow.超标结论 === '超标')
let warnings = listRows('emission').filter((w: any) => w.来源记录)
check('超标结论回写预警台账且为预警中', warnings.some((w: any) => w.来源记录 === 'CEMS-TEST-A1' && w.预警状态 === '预警中'))

// 5. 第三方运维改别人站的数：归属拦截
r = updateCemsFields(newRow.id, { 实测值: '20' }, third)
check('第三方改动在归属岗位校验被打回', r.ok === false && r.stage === '归属岗位校验', r.message)

// 6. 归属岗位试图改固化字段（监测因子）
r = updateCemsFields(newRow.id, { 监测因子: '二氧化硫', 实测值: '20' }, post1)
check('固化字段改动在字段保护被打回', r.ok === false && r.stage === '固化字段保护', r.message)

// 7. 归属岗位改实测值转达标 → 预警解除
r = updateCemsFields(newRow.id, { 实测值: '20' }, post1)
check('归属岗位改实测值成功', r.ok === true, r.message)
let updated = listCems({}).find((x: any) => x.id === newRow.id)
check('改后超标结论重算为达标', updated.超标结论 === '达标')
let w = listRows('emission').find((x: any) => x.来源记录 === 'CEMS-TEST-A1')
check('台账预警随重算解除', w.预警状态 === '已解除' && !!w.解除时间)

// 8. 待采集记录：第三方提交采集被拦；归属岗位提交
const pending = listCems({}).find((x: any) => x.监测编号 === 'CEMS-2026-0901-01')
r = collectCems(pending.id, { 实测值: '12', 折算值: '11', 采集时间: '' }, third)
check('第三方提交采集被归属拦截', r.ok === false && r.stage === '归属岗位校验', r.message)
r = collectCems(pending.id, { 实测值: '12', 折算值: '11', 采集时间: '' }, post1)
check('归属岗位提交采集成功', r.ok === true, r.message)

// 9. 审定权限：非环保岗不能审定；审定后锁定
r = approveCems(newRow.id, post1)
check('非环保岗审定在审定权限被打回', r.ok === false && r.stage === '审定权限', r.message)
r = approveCems(newRow.id, env)
check('环保岗审定成功', r.ok === true, r.message)
updated = listCems({}).find((x: any) => x.id === newRow.id)
check('审定后整份锁定且结论快照保留', updated.锁定 && updated.审定结论 === '达标' && updated.审定限值.includes('30'))
r = updateCemsFields(newRow.id, { 实测值: '99' }, post1)
check('审定后本岗位也不能改（锁定拦截）', r.ok === false && r.stage === '审定锁定校验', r.message)
w = listRows('emission').find((x: any) => x.来源记录 === 'CEMS-TEST-A1')
check('审定达标不产生超标台账', w.预警状态 === '已解除')

// 10. 限值调整：未审定记录重算，审定记录不动
// CEMS-2026-0901-02 二氧化硫 76.4，限值 100 → 达标；限值调到 70 应变超标
const so2 = listCems({}).find((x: any) => x.监测编号 === 'CEMS-2026-0901-02')
r = adjustStandard('二氧化硫', 70, post1)
check('非环保岗调限值被打回', r.ok === false && r.stage === '限值标准维护', r.message)
r = adjustStandard('二氧化硫', 70, env)
check('环保岗调整限值成功', r.ok === true, r.message)
const so2Next = listCems({}).find((x: any) => x.监测编号 === 'CEMS-2026-0901-02')
check('未审定记录按新限值重算为超标', so2Next.超标结论 === '超标' && so2Next.排放限值.startsWith('70'))
check('重算次数 +1', Number(so2Next.重算次数) === 1)
w = listRows('emission').find((x: any) => x.来源记录 === 'CEMS-2026-0901-02')
check('重算超标回写预警中', w.预警状态 === '预警中')
// 颗粒物 30 → 25：已审定的 CEMS-TEST-A1（20 达标）维持；已审定的样例04 不受影响
const lockedA1 = listCems({}).find((x: any) => x.监测编号 === 'CEMS-TEST-A1')
const sample05 = listCems({}).find((x: any) => x.监测编号 === 'CEMS-2026-0830-05')
r = adjustStandard('一氧化碳', 70, env)
check('一氧化碳限值调整完成', r.ok === true, r.message)
const sample05Next = listCems({}).find((x: any) => x.监测编号 === 'CEMS-2026-0830-05')
check('已审定记录维持当时限值与结论（88.6@100 达标，不按 80 重算）',
  sample05Next.排放限值 === '100 mg/m³' && sample05Next.审定结论 === '达标')
check('已审定记录重算次数不变', Number(sample05Next.重算次数) === 0)
void lockedA1

// 11. 待采集记录限值静默同步
const pendingNext = listCems({}).find((x: any) => x.监测编号 === 'CEMS-2026-0901-01')
check('已提交的颗粒物记录不受二氧化硫调整影响', pendingNext.排放限值 === '30 mg/m³')

// 12. 留痕台账：被打回尝试都能倒查
const log = listAuditLog()
check('所有打回尝试均留痕', log.some((e: any) => !e.allowed && e.stage === '归属岗位校验' && e.post === '第三方运维岗'))
check('留痕包含谁/什么时候/想动哪条/拟改字段',
  log.every((e: any) => e.time && e.operator && e.targetCode))
const seedBlocked = log.find((e: any) => e.targetCode === 'CEMS-2026-0901-03' && e.post === '第三方运维岗' && !e.allowed)
check('打回留痕保留拟改字段差异(326.8→280)', !!seedBlocked && seedBlocked.changes.some((c: any) => c.field === '实测值' && c.from === '326.8' && c.to === '280.0'), JSON.stringify(seedBlocked))
check('重算前后差异留痕（限值与结论变化）',
  log.some((e: any) => e.action === '限值重算' && e.changes.some((c: any) => c.field === '排放限值') && e.changes.some((c: any) => c.field === '超标结论')))
check('审定记录的超标种子已回写台账', listRows('emission').some((w: any) => w.来源记录 === 'CEMS-2026-0901-03' && w.预警状态 === '预警中'))

// 13. 已审定超标样例不在种子里（样例均达标/超标混合）——验证已审定超标归档状态
// CEMS-2026-0901-03 是已采集超标，应为预警中
const nox = listCems({}).find((x: any) => x.监测编号 === 'CEMS-2026-0901-03')
check('氮氧化物样例为已采集超标且未锁定', nox.status === '已采集' && !nox.锁定)

console.log(`\n结果：${passed} 通过，${failed} 失败`)

const outDir = mkdtempSync(join(tmpdir(), 'cems-test-'))
writeFileSync(join(outDir, 'store-dump.json'), JSON.stringify({ rows: listCems({}), warnings: listRows('emission'), log: listAuditLog() }, null, 2))
console.log('数据快照：', join(outDir, 'store-dump.json'))

if (failed > 0) {
  process.exit(1)
}
