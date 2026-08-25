const { app, BrowserWindow, ipcMain } = require('electron')
const { spawn } = require('child_process')
const http = require('http')
const path = require('path')
const fs = require('fs')

const PORT = 3080
const BASE_URL = `http://127.0.0.1:${PORT}`
const READY_TIMEOUT_MS = 120_000
const LOG_FILE = path.join(app.getPath('logs'), 'dsh-box.log')

function log(msg) {
  try {
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`)
  } catch {}
}

let splash = null
let mainWin = null
let serverProc = null
let quitting = false

function progress(pct, label) {
  if (splash && !splash.isDestroyed()) {
    splash.webContents.send('dsh:progress', { pct, label })
  }
}

function harnessRoot() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'harness')
  return path.join(app.getAppPath(), 'resources', 'harness')
}

function harnessEntry() {
  // pnpm deploy 产物根目录即 @deepseek-ai/dsh 包本体
  return path.join(harnessRoot(), 'lib', 'bin.js')
}

function probeHealthy() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 1500 }, (res) => {
      res.resume()
      resolve(res.statusCode >= 200 && res.statusCode < 500)
    })
    req.on('timeout', () => { req.destroy(); resolve(false) })
    req.on('error', () => resolve(false))
  })
}

function waitForReady(deadline) {
  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (await probeHealthy()) return resolve(true)
      if (Date.now() > deadline) return reject(new Error('服务启动超时'))
      setTimeout(tick, 500)
    }
    tick()
  })
}

function nodeBinary() {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'runtime')
    : null
  if (base) {
    const p = path.join(base, 'node')
    if (fs.existsSync(p)) return p
  }
  return null // 回退到 ELECTRON_RUN_AS_NODE（开发模式，机器上有 node）
}

function startServer() {
  const entry = harnessEntry()
  log(`启动内核: ${entry}`)
  if (!fs.existsSync(entry)) throw new Error(`未找到 Harness 内核: ${entry}`)
  const nodeBin = nodeBinary()
  const useRealNode = !!nodeBin
  serverProc = spawn(nodeBin || process.execPath, [entry, 'web'], {
    cwd: harnessRoot(),
    env: useRealNode
      ? { ...process.env }
      : { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let recent = ''
  serverProc.stdout.on('data', (d) => { recent = (recent + d).slice(-4000) })
  serverProc.stderr.on('data', (d) => {
    recent = (recent + d).slice(-4000)
    const s = d.toString()
    if (/Error|error|EADDR/.test(s)) log(`内核stderr: ${s.slice(0, 300)}`)
  })
  serverProc.on('exit', (code, signal) => {
    serverProc = null
    log(`内核退出 code=${code} sig=${signal} 最近输出: ${recent.slice(-600)}`)
    if (!quitting && code && code !== 0 && mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.executeJavaScript(
        `document.title='DSH 内核已退出(${code})'`,
      ).catch(() => {})
    }
  })
  return { proc: serverProc, getLog: () => recent }
}

function createSplash() {
  splash = new BrowserWindow({
    width: 460,
    height: 300,
    frame: false,
    resizable: false,
    fullscreenable: false,
    backgroundColor: '#050507',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  splash.loadFile(path.join(__dirname, 'splash.html'))
  splash.once('ready-to-show', () => splash.show())
}

function createMain() {
  mainWin = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    title: 'DeepSeek Harness',
    backgroundColor: '#0b0b0f',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWin.loadURL(BASE_URL)
  mainWin.once('ready-to-show', () => {
    mainWin.show()
    if (splash && !splash.isDestroyed()) splash.destroy()
  })
  mainWin.on('closed', () => { mainWin = null })
}

async function bootstrap() {
  log('bootstrap 开始')
  progress(8, '准备内核…')
  try {
    const alreadyUp = await probeHealthy()
    if (!alreadyUp) {
      progress(20, '启动 DeepSeek Harness 内核…')
      startServer()
      log(`内核进程已拉起 pid=${serverProc.pid}`)
      let p = 20
      const poll = setInterval(() => {
        p = Math.min(p + 3, 78)
        progress(p, '初始化智能体运行时…')
      }, 900)
      try {
        await waitForReady(Date.now() + READY_TIMEOUT_MS)
      } catch (err) {
        clearInterval(poll)
        progress(0, err.message + '（查看日志: ~/Library/Logs/dsh-box）')
        return
      }
      clearInterval(poll)
    } else {
      progress(55, '检测到运行中的 Harness，直接接入…')
    }
    progress(92, '加载聊天界面…')
    createMain()
  } catch (err) {
    progress(0, String(err.message || err))
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWin && !mainWin.isDestroyed()) {
      if (mainWin.isMinimized()) mainWin.restore()
      mainWin.focus()
    } else {
      createMain()
    }
  })

  app.whenReady().then(() => {
    log('app ready，创建启动窗口')
    createSplash()
    bootstrap()
  })

  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', () => {
    quitting = true
    if (serverProc) {
      try { serverProc.kill('SIGTERM') } catch {}
    }
  })
}
