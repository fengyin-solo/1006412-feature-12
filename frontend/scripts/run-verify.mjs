/**
 * 打包并运行 CEMS 业务规则端到端验证（esbuild 走 JS API，绕开平台二进制 PATH 问题）。
 * 用法：node scripts/run-verify.mjs
 */
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

await build({
  entryPoints: [join(root, 'scripts/verify-cems.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  inject: [join(root, 'scripts/localStorage-shim.ts')],
  outfile: join(root, 'scripts/.verify-build.cjs'),
  logLevel: 'warning',
})

await import(join(root, 'scripts/.verify-build.cjs'))
