const path = require('path')
const fs = require('fs')
const { execSync } = require('child_process')

// electron-builder 默认忽略 node_modules，而 DSH-box 的内核部署树
// 恰恰依赖完整的 pnpm node_modules 结构（含符号链接）。
// 因此打包后用 rsync 原样同步（保留符号链接与权限）。
// 同时拷贝系统 node 二进制：内核含原生模块，Electron-as-Node 的
// ABI 与其不兼容，必须用真实 node 运行。
exports.default = async function (context) {
  const projectRoot = path.resolve(__dirname, '..')
  const src = path.join(projectRoot, 'resources', 'harness')
  const appName = `${context.packager.appInfo.productFilename}.app`
  const contents = path.join(context.appOutDir, appName, 'Contents')
  const dest = path.join(contents, 'Resources', 'harness')
  execSync(`rsync -a --delete "${src}/" "${dest}/"`, { stdio: 'inherit' })

  const nodeBin = execSync('command -v node').toString().trim()
  const runtimeDir = path.join(contents, 'Resources', 'runtime')
  fs.mkdirSync(runtimeDir, { recursive: true })
  fs.copyFileSync(nodeBin, path.join(runtimeDir, 'node'))
  fs.chmodSync(path.join(runtimeDir, 'node'), 0o755)
  console.log(`[afterpack] harness 已同步 + node(${nodeBin}) 已内置 (${appName})`)
}
