#!/usr/bin/env node
/**
 * 静态解析校验：遍历部署树内所有包的 lib 目录下的 .js 文件，
 * 提取裸导入说明符并模拟 Node 解析，报告树内不可解析的包。
 * 用法: node scripts/check-resolve.mjs [部署目录]
 */
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const DEST = path.resolve(argsGet(1) || path.join(__dirname, '..', 'resources', 'harness'))
const NM = path.join(DEST, 'node_modules')

function argsGet(i) { return process.argv.slice(2)[i] || null }

function* walkJs(dir) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'tests' || e.name === '.bin') continue
      yield* walkJs(p)
    } else if (e.name.endsWith('.js')) yield p
  }
}

const BUILTINS = new Set(['fs', 'path', 'crypto', 'os', 'util', 'url', 'net', 'http', 'https', 'zlib', 'stream', 'events', 'buffer', 'child_process', 'module', 'process', 'timers', 'async_hooks', 'assert', 'readline', 'tls', 'dns', 'worker_threads', 'v8', 'vm', 'inspector', 'string_decoder', 'sys', 'constants'])
const SPEC_RE = /(?:import\s[^'"]*?|export\s[^'"]*?from\s|require\()\s*['"]([^'"./][^'"]*)['"]/g

function tryResolve(spec, fromFile) {
  const parts = spec.split('/')
  const base = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]
  // 从文件所在目录逐级向上找 node_modules/<base>
  let dir = path.dirname(fromFile)
  for (;;) {
    const cand = path.join(dir, 'node_modules', base)
    if (fs.existsSync(cand)) {
      // 目标存在即可（入口细节交给 node；目录非空判定）
      try { if (fs.readdirSync(cand).length > 0) return true } catch { }
      return false
    }
    const parent = path.dirname(dir)
    if (parent === dir) return false
    dir = parent
  }
}

const failures = new Map()
for (const file of walkJs(NM)) {
  let src
  try { src = fs.readFileSync(file, 'utf8') } catch { continue }
  if (!src.includes('@deepseek-ai/')) continue
  for (const m of src.matchAll(SPEC_RE)) {
    const spec = m[1]
    if (!spec.startsWith('@deepseek-ai/')) continue
    if (/[^/@\w.-]/.test(spec)) continue
    const base = spec.split('/').slice(0, 2).join('/')
    if (tryResolve(base === spec ? spec : base, file)) continue
    if (!failures.has(base)) failures.set(base, new Set())
    failures.get(base).add(path.relative(DEST, file))
  }
}

if (failures.size === 0) {
  console.log('== 全部裸导入均可解析 ==')
  process.exit(0)
}
console.log(`== ${failures.size} 个包不可解析 ==`)
for (const [name, locs] of failures) {
  console.log(`MISSING ${name}  (${locs.size} 处引用，如 ${[...locs][0].slice(0, 90)})`)
}
process.exit(1)
