#!/usr/bin/env node
/**
 * 静态全量补齐 pnpm deploy 产物的缺失包。
 *
 * 原理：fixup 的运行时探测只能覆盖启动路径；会话挂载（preset mount）时才
 * 触发的深层依赖会漏网。这里改为静态遍历源仓库隐藏 hoist 层的全部包，
 * 将部署树中缺失或悬空（符号链接指向树外）的一律真实拷贝——解引用到
 * 源仓库内的真实路径、排除内部 node_modules（防循环），确保任意懒加载
 * 路径可解析。
 *
 * 用法: node scripts/fill-harness.mjs [源仓库] [部署目录]
 */
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const SRC = path.resolve(args[0] || path.join(process.env.HOME || process.env.USERPROFILE, 'deepseek-harness'))
const DEST = path.resolve(args[1] || path.join(__dirname, '..', 'resources', 'harness'))

const SRC_HOIST = path.join(SRC, 'node_modules', '.pnpm', 'node_modules')
const DEST_HOIST = path.join(DEST, 'node_modules', '.pnpm', 'node_modules')
const SKIP = new Set(['node_modules', 'tests', 'src'])

/** 枚举 hoist 层的全部包：顶层普通名 + @scope 容器内的一层 */
function* iterPackages(dir) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const ent of entries) {
    const p = path.join(dir, ent.name)
    if (ent.name.startsWith('@') && ent.isDirectory()) {
      let subs
      try { subs = fs.readdirSync(p, { withFileTypes: true }) } catch { continue }
      for (const s of subs) yield { rel: `${ent.name}/${s.name}`, p: path.join(p, s.name) }
    } else {
      yield { rel: ent.name, p }
    }
  }
}

let added = 0

for (const { rel, p: srcP } of iterPackages(SRC_HOIST)) {
  const destP = path.join(DEST_HOIST, ...rel.split('/'))

  // 已可用？真实目录，或符号链接且目标落在部署树内部且存在
  let ok = false
  let st
  try { st = fs.lstatSync(destP) } catch {}
  if (st) {
    if (!st.isSymbolicLink()) ok = st.isDirectory()
    else {
      try {
        const target = path.resolve(path.dirname(destP), fs.readlinkSync(destP))
        ok = target.startsWith(DEST + path.sep) && fs.existsSync(target)
      } catch { ok = false }
    }
  }
  if (ok) continue

  // 解析源条目真实路径（hoist 条目多为指向仓库内 packages/ 的相对链接）
  let from = srcP
  try {
    if (fs.lstatSync(srcP).isSymbolicLink()) {
      const t = fs.realpathSync(srcP)
      if (t.startsWith(SRC)) from = t
    }
  } catch {}
  let stt
  try { stt = fs.statSync(from) } catch { continue }
  if (!stt.isDirectory()) continue

  const tmp = `${destP}.tmp`
  fs.rmSync(destP, { recursive: true, force: true })
  fs.rmSync(tmp, { recursive: true, force: true })
  try {
    fs.cpSync(from, tmp, {
      recursive: true,
      dereference: true,
      filter: (s) => !SKIP.has(path.basename(s)) && !s.endsWith('.tsbuildinfo'),
    })
  } catch (e) {
    console.log(`  ! 拷贝失败 ${rel}: ${e.message}`)
    fs.rmSync(tmp, { recursive: true, force: true })
    continue
  }
  fs.rmSync(destP, { recursive: true, force: true })
  fs.renameSync(tmp, destP)
  added++
  console.log(`  + ${rel}`)
}

console.log(`== 静态补齐完成：新增/修复 ${added} 个包 ==`)
