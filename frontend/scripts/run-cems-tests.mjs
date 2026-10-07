// 打包 CEMS 服务层与规则用例并在 node 内存环境下运行（无需浏览器）。
import { build } from 'esbuild'
import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outfile = resolve(root, 'test/run.cjs')
const alias = { '@': resolve(root, 'src') }

await build({
  entryPoints: [resolve(root, 'test/cems-rules.test.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile,
  alias,
  logLevel: 'silent',
})

try {
  process.exitCode = 0
  await import(outfile)
} finally {
  rmSync(outfile, { force: true })
}
