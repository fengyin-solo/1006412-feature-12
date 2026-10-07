/** CEMS 业务规则端到端验证：用内存 localStorage 模拟浏览器，跑归属/锁定/唯一/留痕/重算/台账链路。 */
import {
  POSTS,
  adjustFactorLimit,
  approveCems,
  currentLimits,
  ensureCemsMigrated,
  listDenyLogs,
  listRecalcDiffs,
  postName,
  registerCems,
  updateCems,
} from '../src/data/cems'
import { listRows } from '../src/data/local-store'

let passed = 0
let failed = 0

function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name} ${detail}`)
  }
}

const fluegas = { postCode: 'fluegas-post', operator: '赵净化' }
const stack = { postCode: 'stack-post', operator: '钱排口' }
const thirdParty = { postCode: 'third-party', operator: '孙运维' }

function find(no: string) {
  return (listRows('cems') as any[]).find((r) => r.监测编号 === no)
}

console.log('1. 登记归属定死：设备挂岗位，第三方运维没有设备')
const r1 = registerCems(
  { monitorNo: 'CEMS-T1', factor: '颗粒物', device: 'CEMS-A', measured: '10', converted: '9.8', collectedAt: '2026-10-07 10:00' },
  fluegas,
)
check('烟气净化岗用 CEMS-A 登记成功', r1.ok, r1.message)
check('归属岗位写死为 fluegas-post', find('CEMS-T1')?.归属岗位 === 'fluegas-post')
check('登记时锁定限值版本 v1', find('CEMS-T1')?.限值版本 === 1)

const r2 = registerCems(
  { monitorNo: 'CEMS-T2', factor: '颗粒物', device: 'CEMS-A', measured: '10', converted: '', collectedAt: '' },
  stack,
)
check('别的岗位拿别人设备登记 → 卡在归属校验', !r2.ok && r2.step === '归属校验', r2.message)

const r3 = registerCems(
  { monitorNo: 'CEMS-T3', factor: '颗粒物', device: 'CEMS-C', measured: '10', converted: '', collectedAt: '' },
  thirdParty,
)
check('第三方运维登记 → 卡在归属校验', !r3.ok && r3.step === '归属校验', r3.message)

console.log('2. 监测编号唯一：重复登记在唯一校验打回')
const dup = registerCems(
  { monitorNo: 'CEMS-T1', factor: '颗粒物', device: 'CEMS-A', measured: '10', converted: '', collectedAt: '' },
  fluegas,
)
check('重复监测编号 → 卡在唯一校验', !dup.ok && dup.step === '唯一校验', dup.message)

console.log('3. 超标自动预警并回写环保监控预警台账')
const over = registerCems(
  { monitorNo: 'CEMS-T4', factor: '颗粒物', device: 'CEMS-B', measured: '25', converted: '94', collectedAt: '2026-10-07 11:00' },
  fluegas,
)
check('实测值 25 > 限值 20 → 登记成功且超标预警', over.ok && find('CEMS-T4')?.status === '超标预警')
const warnRow = (listRows('emission') as any[]).find((r) => r.监控编号 === 'WARN-CEMS-T4')
check('预警台账出现 WARN-CEMS-T4', !!warnRow)
check('台账判定为未达标/超标预警', warnRow?.达标判定 === '未达标' && warnRow?.监控状态 === '超标预警')

console.log('4. 非归属岗位编辑一律打回，固定字段只读')
const e1 = updateCems('CEMS-T4', { 实测值: '10' }, stack)
check('总排口岗改烟气岗记录 → 卡在归属校验', !e1.ok && e1.step === '归属校验')
const e2 = updateCems('CEMS-T4', { 实测值: '10' }, thirdParty)
check('第三方运维改动 → 卡在归属校验', !e2.ok && e2.step === '归属校验')
const e3 = updateCems('CEMS-T1', { 监测因子: '氮氧化物' }, fluegas)
check('归属岗改监测因子 → 卡在字段只读校验', !e3.ok && e3.step === '字段只读校验', e3.message)
const e4 = updateCems('CEMS-T1', { 排放限值: '1mg/m³' }, fluegas)
check('归属岗改排放限值 → 卡在字段只读校验', !e4.ok && e4.step === '字段只读校验')
const e5 = updateCems('CEMS-T1', { 实测值: '12.5', 折算值: '12.0' }, fluegas)
check('归属岗改实测信息 → 成功', e5.ok && find('CEMS-T1')?.实测值 === '12.5')

console.log('5. 审定后整份锁定，本岗位也不能改')
const ap = approveCems('CEMS-T1', '李审定', fluegas)
check('归属岗审定成功', ap.ok && find('CEMS-T1')?.status === '已审核')
check('审定记录 pending=false', find('CEMS-T1')?.pending === false)
const e6 = updateCems('CEMS-T1', { 实测值: '999' }, fluegas)
check('审定后归属岗本人再改 → 卡在锁定校验', !e6.ok && e6.step === '锁定校验', e6.message)
const ap2 = approveCems('CEMS-T1', '李审定', fluegas)
check('重复审定 → 卡在锁定校验', !ap2.ok && ap2.step === '锁定校验')

console.log('6. 限值调整：未审定记录重算并留差异，已审定记录保留')
// CEMS-T4 颗粒物 25（超 20）放宽到 30 → 翻转达标；同因子下 CEMS-T1 已审定，须保留
const adj1 = adjustFactorLimit('颗粒物', 30, fluegas)
check('限值放宽 20→30 成功', adj1.ok && adj1.newLimit === 30, adj1.message)
check('CEMS-T4 重算后翻转为达标、状态回已采集', find('CEMS-T4')?.超标判定 === '达标' && find('CEMS-T4')?.status === '已采集')
const t4Diff = listRecalcDiffs().find((d) => d.monitorNo === 'CEMS-T4' && d.batchId === adj1.batchId)
check('差异记录保留前后结论（超标→达标，已翻转）', t4Diff?.oldConclusion === '超标' && t4Diff?.newConclusion === '达标' && t4Diff.changed)
const t1Diff = listRecalcDiffs().find((d) => d.monitorNo === 'CEMS-T1' && d.batchId === adj1.batchId)
check('已审定记录不重算，差异标注「审定保留」', t4Diff && t1Diff && !t1Diff.changed && t1Diff.newConclusion.includes('审定保留'))
check('已审定记录数值/状态未动', find('CEMS-T1')?.实测值 === '12.5' && find('CEMS-T1')?.status === '已审核')
const warnAfter = (listRows('emission') as any[]).find((r) => r.监控编号 === 'WARN-CEMS-T4')
check('翻转达标后台账预警同步解除（同一条更新而非重复新增）', warnAfter?.监控状态 === '预警解除')
check('限值版本升到 v2 并挂到重算记录', find('CEMS-T4')?.限值版本 === 2)
check('现行限值表为新版本', currentLimits().find((l) => l.factor === '颗粒物')?.version === 2)

console.log('7. 第三方运维调限值被权限校验挡下')
const adj2 = adjustFactorLimit('颗粒物', '30' as unknown as number, thirdParty)
check('第三方调限值 → 卡在权限校验', !adj2.ok && adj2.step === '权限校验', adj2.message)

console.log('8. 被挡下的尝试全部留痕，可倒查')
const logs = listDenyLogs()
check('留痕条数 >= 7（归属2 + 唯一1 + 跨岗编辑2 + 固定字段2 + 锁定2 + 权限1）', logs.length >= 7, `实际 ${logs.length}`)
const crossLog = logs.find((l) => l.target.includes('CEMS-T4') && l.step === '归属校验' && l.postCode === 'stack-post')
check('留痕含「谁(钱排口/总排口岗)/时间/动哪条(CEMS-T4)/卡在哪步」', !!crossLog && crossLog.actor === '钱排口' && !!crossLog.time)
check('留痕覆盖锁定校验', logs.some((l) => l.step === '锁定校验'))
check('留痕覆盖唯一校验', logs.some((l) => l.step === '唯一校验'))
check('留痕覆盖权限校验', logs.some((l) => l.step === '权限校验'))

console.log('9. 既有数据迁移兼容（占位数据补齐归属字段，已审定记录直接锁定）')
const cems = listRows('cems') as any[]
check('旧数据全部补齐归属岗位与采集设备', cems.every((r) => r.归属岗位 && r.采集设备))
check('旧的已审核记录 CEMS-2026-0828-01 保持锁定', find('CEMS-2026-0828-01')?.status === '已审核')

console.log(`\n${POSTS.map((p) => `${p.name}: ${postName(p.code)}`).join(' / ')}`)
console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) {
  process.exit(1)
}
