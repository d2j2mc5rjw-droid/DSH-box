#!/usr/bin/env node
/**
 * 硬化部署树：消除一切指向树外的符号链接，保证自包含。
 *
 * 1. 遍历整棵树；凡 realpath 不落在 DEST 内的符号链接一律删除
 *    （pnpm 内部相对链接保留）。
 * 2. 对删除后缺失的 @deepseek-ai 包，从源仓库真实路径解引用补拷。
 *
 * 用法: node scripts/harden-harness.mjs [源仓库] [部署目录]
 */
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const SRC = path.resolve(args[0] || path.join(process.env.HOME || process.env.USERPROFILE, 'deepseek-harness'))
const DEST = path.resolve(args[1] || path.join(__dirname, '..', 'resources', 'harness'))

let purged = 0
const escapedNames = new Set()

/** 若为指向树外的符号链接则删除，返回 true 表示已处理 */
function purgeIfEscape(p) {
  let st
  try { st = fs.lstatSync(p) } catch { return false }
  if (!st.isSymbolicLink()) return false
  try {
    const target = path.resolve(path.dirname(p), fs.readlinkSync(p))
    if (!target.startsWith(DEST + path.sep)) {
      // 记录被删链接的包名，便于后续补拷到 hoist 层
      const relLink = fs.readlinkSync(p)
      const segs = relLink.split('/')
      const lastScoped = []
      for (let i = segs.length - 1; i >= 0; i--) {
        if (segs[i].startsWith('@')) { lastScoped.push(`${segs[i]}/${segs[i + 1]}`); break }
      }
      if (lastScoped[0]) escapedNames.add(lastScoped[0])
      else if (segs.length) escapedNames.add(segs[segs.length - 1])
      fs.unlinkSync(p)
      purged++
      return true
    }
  } catch { }
  return false
}

function* walk(dir, skipDirs = new Set()) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (skipDirs.has(e.name)) continue
      yield* walk(p, skipDirs)
    } else {
      yield { p, ent: e }
    }
  }
}

// ---- 第一遍：清逃逸链接 ----
for (const { p, ent } of walk(DEST)) {
  if (!ent.isDirectory() && purgeIfEscape(p)) continue
}
console.log(`== 清除树外符号链接 ${purged} 个 ==`)

// ---- 第二遍：被删链接若属于包入口（目录级），从源仓库真实路径补回真实内容 ----
const SRC_HOIST = path.join(SRC, 'node_modules', '.pnpm', 'node_modules')
function* iterHoistPackages(dir) {
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

const SKIP = new Set(['node_modules', 'tests', 'src'])
function realCopyFromSrc(rel, destP) {
  // 源侧优先取 hoist 真实路径，其次仓库内 vendor/packages
  const candidates = [
    path.join(SRC_HOIST, rel),
    path.join(SRC, 'node_modules', rel),
  ]
  for (const cand of candidates) {
    let from = cand
    try {
      if (fs.lstatSync(cand).isSymbolicLink()) {
        const t = fs.realpathSync(cand)
        if (t.startsWith(SRC)) from = t
      }
    } catch { }
    let st
    try { st = fs.statSync(from) } catch { continue }
    if (!st.isDirectory()) continue
    const tmp = `${destP}.tmp`
    fs.rmSync(tmp, { recursive: true, force: true })
    try {
      fs.cpSync(from, tmp, {
        recursive: true,
        dereference: true,
        filter: (s) => !SKIP.has(path.basename(s)) && !s.endsWith('.tsbuildinfo'),
      })
    } catch { continue }
    if (!fs.existsSync(path.join(tmp, 'package.json'))) {
      fs.rmSync(tmp, { recursive: true, force: true })
      continue
    }
    fs.rmSync(destP, { recursive: true, force: true })
    fs.renameSync(tmp, destP)
    return true
  }
  return false
}

// 检查每个包目录：package.json 存在？不存在（可能被第一遍删了入口链接）→ 补真实拷贝
let refilled = 0
for (const { rel, p } of iterHoistPackages(path.join(DEST, 'node_modules', '.pnpm', 'node_modules'))) {
  const pkgJson = path.join(p, 'package.json')
  if (fs.existsSync(pkgJson)) continue
  if (realCopyFromSrc(rel, p)) {
    refilled++
    console.log(`  + refill ${rel}`)
  }
}
console.log(`== 补回 ${refilled} 个包 ==`)

// ---- 第三遍：逃逸链接涉及的包若 hoist 层没有，补拷到 hoist 层 ----
const HOIST = path.join(DEST, 'node_modules', '.pnpm', 'node_modules')
let extra = 0
for (const name of escapedNames) {
  const destP = path.join(HOIST, name)
  let ok = false
  try { ok = fs.readdirSync(destP).length > 0 } catch { }
  if (ok) continue
  if (realCopyFromSrc(name, destP)) {
    extra++
    console.log(`  + hoist 补 ${name}`)
  }
}
console.log(`== hoist 层额外补 ${extra} 个 ==`)

// ---- 第四遍：顶层 @deepseek-ai 镜像补全（profile heal 只认顶层）----
// dsh 的 profile fallback 会把安装锚点 node_modules 里的包软链到
// ~/.dsh/profiles/node_modules；deploy 后顶层往往只有部分包，
// 这里按源仓库清单把缺的补成真实目录。
const DEST_TOP = path.join(DEST, 'node_modules', '@deepseek-ai')
const SRC_TOP = path.join(SRC, 'node_modules', '@deepseek-ai')
let topped = 0
for (const { rel, p } of iterHoistPackages(SRC_TOP)) {
  const destP = path.join(DEST_TOP, ...rel.split('/'))
  let ok = false
  let st
  try { st = fs.lstatSync(destP) } catch { }
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
  let from = p
  try {
    if (fs.lstatSync(p).isSymbolicLink()) {
      const t = fs.realpathSync(p)
      if (t.startsWith(SRC)) from = t
    }
  } catch { }
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
  } catch { continue }
  if (!fs.existsSync(path.join(tmp, 'package.json'))) {
    fs.rmSync(tmp, { recursive: true, force: true })
    continue
  }
  fs.rmSync(destP, { recursive: true, force: true })
  fs.renameSync(tmp, destP)
  topped++
}
console.log(`== 顶层 @deepseek-ai 补齐 ${topped} 个 ==`)
