#!/usr/bin/env node
/**
 * 将 DSH-box 自带的两个自定义 LLM 插件（deepseek-web / ollama）
 * 接线到 deepseek-harness 源码仓库。幂等：重复执行无副作用。
 *
 * 用法: node scripts/apply-wiring.mjs [harness 源码目录]
 */
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const root = process.argv[2] || process.cwd()
const repo = path.resolve(root)
const vendor = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'vendor')

function exists(p) { return fs.existsSync(p) }

// 1. 解压插件源码
execSync(`tar -xzf "${path.join(vendor, 'custom-llm-plugins.tgz')}" -C "${repo}"`)

// 2. 尝试 git apply 补丁；失败则走手动接线
try {
  execSync('git apply --3way patches/local-wiring.patch', { cwd: repo, stdio: 'pipe' })
  console.log('wiring: git apply 成功')
} catch {
  console.log('wiring: 补丁冲突，使用手动接线')

  // cordis.patch.yml 追加插件注册
  const patchYml = path.join(repo, 'packages/bundle/base/cordis.patch.yml')
  let yml = fs.readFileSync(patchYml, 'utf8')
  if (!yml.includes('id: llm-ollama')) {
    yml += `
    # The web-edition DeepSeek adapter (chat.deepseek.com).
    - id: llm-deepseek-web
      name: '@deepseek-ai/dsh-llm-deepseek-web'

    # The local Ollama adapter (default http://localhost:11434).
    - id: llm-ollama
      name: '@deepseek-ai/dsh-llm-ollama'
`
    fs.writeFileSync(patchYml, yml)
  }

  // tsconfig.host.json 加入构建路径
  const tsHost = path.join(repo, 'tsconfig.host.json')
  let ts = fs.readFileSync(tsHost, 'utf8')
  if (!ts.includes('llm/llm-ollama')) {
    ts = ts.replace(
      '{ "path": "./packages/llm/llm-deepseek" },',
      '{ "path": "./packages/llm/llm-deepseek" },\n    { "path": "./packages/llm/llm-deepseek-web" },\n    { "path": "./packages/llm/llm-ollama" },',
    )
    fs.writeFileSync(tsHost, ts)
  }

  // bundle package.json 注入依赖
  const bundlePkg = path.join(repo, 'packages/bundle/base/package.json')
  const pkg = JSON.parse(fs.readFileSync(bundlePkg, 'utf8'))
  for (const key of ['@deepseek-ai/dsh-llm-deepseek-web', '@deepseek-ai/dsh-llm-ollama']) {
    const sections = ['dependencies', 'devDependencies', 'optionalDependencies']
    let found = false
    for (const s of sections) {
      if (pkg[s] && pkg[s][key] !== undefined) { found = true; break }
    }
    if (!found) (pkg.dependencies ||= {})[key] = 'workspace:^'
  }
  fs.writeFileSync(bundlePkg, JSON.stringify(pkg, null, 2) + '\n')
}

console.log('wiring: 完成（llm-deepseek-web + llm-ollama 已接线）')
