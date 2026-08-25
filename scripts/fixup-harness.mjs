#!/usr/bin/env node
/**
 * 收敛式修复 pnpm deploy 产物缺失包（跨平台）。
 * 反复启动内核探测：遇到 ERR_MODULE_NOT_FOUND 就从源仓库解析真实路径、
 * 解引用拷贝该包（排除其内部 node_modules），直到服务可启动。
 *
 * 用法: node scripts/fixup-harness.mjs [源仓库] [部署目录] [--port N]
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import url from 'node:url'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const PORT = Number(process.argv.find((a) => a.startsWith('--port='))?.split('=')[1] || 3080)
const SRC = path.resolve(args[0] || path.join(process.env.HOME || process.env.USERPROFILE, 'deepseek-harness'))
const DEST = path.resolve(args[1] || path.join(__dirname, '..', 'resources', 'harness'))
const MAX_ROUNDS = 80

const HOIST_SRC = path.join(SRC, 'node_modules', '.pnpm', 'node_modules')

function log(msg) { console.log(msg) }

function copyPkg(rel) {
  let from = path.join(HOIST_SRC, rel)
  if (!fs.existsSync(from)) from = path.join(SRC, 'node_modules', rel)
  if (!fs.existsSync(from)) {
    // 悬空符号链接：尝试解析其指向的真实路径
    const link = path.join(HOIST_SRC, rel)
    if (fs.lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink?.()) {
      try {
        from = fs.realpathSync(link)
      } catch {}
    }
  }
  if (!fs.existsSync(from)) {
    console.log(`  ! 源中不存在 ${rel}`)
    return false
  }
  if (fs.statSync(from).isFile()) return false
  const tmp = path.join(HOIST_DEST, `${rel}.tmp`)
  fs.rmSync(path.join(HOIST_DEST, rel), { recursive: true, force: true })
  fs.rmSync(tmp, { recursive: true, force: true })
  fs.cpSync(from, tmp, {
    recursive: true,
    dereference: true,
    verbatimSymlinks: false,
    filter: (s) => {
      const base = path.basename(s)
      return base !== 'node_modules' && base !== 'tests' && base !== 'src' && !base.endsWith('.tsbuildinfo')
    },
  })
  if (!fs.existsSync(path.join(tmp, 'package.json'))) {
    console.log(`  ! 拷贝不完整：${rel}`)
    return false
  }
  fs.renameSync(tmp, path.join(HOIST_DEST, rel))
  console.log(`  + 补 ${rel} (← ${from})`)
  return true
}

// 注意：HOIST_DEST 在 DEST 内；拷贝目标目录固定为部署树的隐藏 hoist 层
const HOIST_DEST = path.join(DEST, 'node_modules', '.pnpm', 'node_modules')

function probeOnce() {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    const child = spawn(process.execPath, ['lib/bin.js', 'web'], {
      cwd: DEST,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    let done = false
    const finish = (ok) => {
      if (done) return
      done = true
      try { child.kill() } catch {}
      setTimeout(() => resolve({ ok, out: stdout + stderr }), 300)
    }
    const t0 = Date.now()
    const tick = () => {
      if (done) return
      const req = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 1200 }, (res) => {
        res.resume()
        if (res.statusCode >= 200 && res.statusCode < 500) return finish(true)
        req.destroy()
      })
      req.on('error', () => {})
      req.on('timeout', () => req.destroy())
      if (Date.now() - t0 > 25_000 || child.exitCode !== null) {
        // 多给一点时间收集错误输出
        setTimeout(() => finish(false), 800)
        return
      }
      setTimeout(tick, 500)
    }
    setTimeout(tick, 1500)
  })
}

for (let round = 1; round <= MAX_ROUNDS; round++) {
  const { ok, out } = await probeOnce()
  if (ok) {
    log(`== 修复完成，服务可正常启动（第 ${round} 轮）==`)
    process.exit(0)
  }
  const misses = [...new Set(
    (out.match(/Cannot find package '[^']+'/g) || []).map(
      (m) => m.replace("Cannot find package '", '').replace(/'$/, ''),
    ),
  )]
  if (misses.length === 0) {
    log('== 非缺包错误，最后日志：==')
    log(out.slice(-800))
    process.exit(2)
  }
  let copied = 0
  for (let miss of misses) {
    // 兼容绝对路径形态：…/.pnpm/node_modules/@scope/name/index.js
    const marker = `.pnpm${path.sep}node_modules${path.sep}`
    const idx = miss.indexOf(marker)
    if (idx >= 0) {
      const rest = miss.slice(idx + marker.length).split(/[\\/]/)
      miss = rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0]
    }
    if (miss.includes('/')) {
      // 相对形式 @scope/name
      const seg = miss.split('/')
      if (seg[0].startsWith('@')) miss = seg.slice(0, 2).join('/')
      else miss = seg[0]
    }
    log(`[round ${round}] 缺失: ${miss}`)
    if (copyPkg(miss)) copied++
  }
  if (copied === 0) {
    log('== 无可补包，退出 ==')
    process.exit(3)
  }
}
log('== 超过最大轮数仍失败 ==')
process.exit(4)
