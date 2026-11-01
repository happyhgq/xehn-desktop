import { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, shell } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { Engine } from './engine/engine'
import { sleep } from './engine/util'
import type { Settings } from '../shared/types'

const isSmoke = process.argv.includes('--smoke')
const iconPath = app.isPackaged
  ? join(process.resourcesPath, 'resources', 'icon.png')
  : join(__dirname, '../../resources/icon.png')

let win: BrowserWindow | null = null
let tray: Tray | null = null
let engine: Engine | null = null
let quitting = false
let shutdownComplete = false
let readyPromise: Promise<void> | null = null

function homeDir(): string {
  return process.env.XEHN_DESKTOP_HOME || app.getPath('userData')
}

function coreCandidates(): string[] {
  return [
    join(homeDir(), 'core', 'mihomo.exe'),
    app.isPackaged
      ? join(process.resourcesPath, 'resources', 'core', 'mihomo.exe')
      : join(__dirname, '../../resources/core/mihomo.exe'),
    join(app.getAppPath(), 'resources', 'core', 'mihomo.exe')
  ]
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 1000,
    minHeight: 680,
    show: false,
    backgroundColor: '#070b12',
    autoHideMenuBar: true,
    title: 'XEHN Desktop',
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  window.once('ready-to-show', () => {
    window.show()
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.on('close', (event) => {
    if (quitting) return
    if (engine?.getSettings().closeToTray) {
      event.preventDefault()
      window.hide()
    }
  })

  window.on('closed', () => {
    win = null
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    void window.loadURL(devUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return window
}

function buildTrayMenu(): void {
  if (!tray) return
  const connected = engine?.getStatus().state === 'connected'
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主界面', click: () => showWindow() },
      { type: 'separator' },
      {
        label: '连接',
        enabled: !connected,
        click: () => {
          engine?.connect().catch(() => undefined)
        }
      },
      {
        label: '断开',
        enabled: connected,
        click: () => {
          engine?.disconnect().catch(() => undefined)
        }
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
}

function createTray(): void {
  const image = nativeImage.createFromPath(iconPath)
  if (image.isEmpty()) return
  tray = new Tray(image.resize({ width: 16, height: 16 }))
  tray.setToolTip('XEHN Desktop')
  tray.on('click', () => showWindow())
  buildTrayMenu()
}

function showWindow(): void {
  if (!win) {
    win = createWindow()
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function registerIpc(): void {
  const whenReady = async (): Promise<Engine> => {
    if (!readyPromise) throw new Error('引擎尚未初始化')
    await readyPromise
    return engine!
  }

  ipcMain.handle('app:bootstrap', async () => (await whenReady()).getBootstrap())

  ipcMain.handle('settings:update', async (_e, patch: Partial<Settings>) => {
    const eng = await whenReady()
    const settings = await eng.updateSettings(patch)
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin, path: process.execPath })
    }
    return settings
  })

  ipcMain.handle('engine:connect', async (_e, endpoint?: string) => (await whenReady()).connect(endpoint))
  ipcMain.handle('engine:disconnect', async () => (await whenReady()).disconnect())
  ipcMain.handle('engine:scan', async (_e, deep: boolean) => (await whenReady()).scan(Boolean(deep)))
  ipcMain.handle('engine:scan-cancel', async () => (await whenReady()).cancelScan())
  ipcMain.handle('engine:logs', async () => (await whenReady()).getLogs())
  ipcMain.handle('engine:nodes', async () => (await whenReady()).getNodes())
  ipcMain.handle('account:register', async (_e, fresh: boolean) => (await whenReady()).register(Boolean(fresh)))
  ipcMain.handle('core:update', async () => (await whenReady()).updateCore())
  ipcMain.handle('core:check', async () => (await whenReady()).checkCoreUpdate())

  ipcMain.handle('diag:connections', async () => (await whenReady()).getConnections())
  ipcMain.handle('diag:speed', async () =>
    (await whenReady()).speedTest((progress) => {
      try {
        win?.webContents.send('diag:speed-progress', progress)
      } catch {
        // window is gone
      }
    })
  )
  ipcMain.handle('diag:quality', async () =>
    (await whenReady()).qualityTest((progress) => {
      try {
        win?.webContents.send('diag:quality-progress', progress)
      } catch {
        // window is gone
      }
    })
  )
  ipcMain.handle('diag:export', async () => {
    const file = await (await whenReady()).exportDiagnostics()
    shell.showItemInFolder(file)
    return file
  })

  ipcMain.handle('geoip:status', async () => (await whenReady()).getGeoipStatus())
  ipcMain.handle('geoip:download', async () => (await whenReady()).downloadGeoip())
  ipcMain.handle('geoip:open', async () => {
    const dir = await (await whenReady()).openGeoipDir()
    await shell.openPath(dir)
    return dir
  })

  ipcMain.handle('shell:open-data', async () => {
    await shell.openPath(homeDir())
  })
  ipcMain.handle('shell:open-external', async (_e, url: string) => {
    if (typeof url === 'string' && url.startsWith('https://')) await shell.openExternal(url)
  })
  ipcMain.handle('app:quit', async () => {
    quitting = true
    app.quit()
  })
}

async function runSmoke(target: BrowserWindow): Promise<void> {
  const outDir = join(app.getAppPath(), 'artifacts')
  await fs.mkdir(outDir, { recursive: true })
  await sleep(2200)
  const pages: { hash: string; name: string }[] = [
    { hash: '#/home', name: '01-home' },
    { hash: '#/nodes', name: '02-nodes' },
    { hash: '#/diag', name: '06-diag' },
    { hash: '#/settings', name: '03-settings' },
    { hash: '#/logs', name: '04-logs' },
    { hash: '#/about', name: '05-about' }
  ]
  for (const page of pages) {
    await target.webContents.executeJavaScript(`location.hash = ${JSON.stringify(page.hash)}`)
    await sleep(700)
    const image = await target.webContents.capturePage()
    await fs.writeFile(join(outDir, `${page.name}.png`), image.toPNG())
    if (page.name === '03-settings') {
      await target.webContents.executeJavaScript(
        `document.querySelector('.content').scrollTop = 640; null`
      )
      await sleep(500)
      const scrolled = await target.webContents.capturePage()
      await fs.writeFile(join(outDir, '07-optimize.png'), scrolled.toPNG())
      await target.webContents.executeJavaScript(
        `document.querySelector('.content').scrollTop = 0; null`
      )
    }
  }
  app.exit(0)
}

async function bootstrap(): Promise<void> {
  engine = new Engine({
    home: homeDir(),
    coreCandidates: coreCandidates(),
    version: app.getVersion(),
    hooks: {
      onStatus: (status) => {
        try {
          win?.webContents.send('engine:status', status)
        } catch {
          // window is gone
        }
        buildTrayMenu()
        if (tray) tray.setToolTip(`XEHN Desktop — ${status.state === 'connected' ? '已连接' : '未连接'}`)
      },
      onLog: (line) => {
        try {
          win?.webContents.send('engine:log', line)
        } catch {
          // window is gone
        }
      },
      onScanProgress: (progress) => {
        try {
          win?.webContents.send('engine:scan-progress', progress)
        } catch {
          // window is gone
        }
      }
    }
  })

  readyPromise = engine.init()

  win = createWindow()

  win.webContents.once('did-finish-load', () => {
    if (isSmoke && win) void runSmoke(win)
  })

  if (!isSmoke) createTray()
}

if (!isSmoke && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())

  app.whenReady().then(async () => {
    app.setAppUserModelId('io.xehn.desktop')
    Menu.setApplicationMenu(null)
    registerIpc()
    await bootstrap()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) showWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (!engine?.getSettings().closeToTray || quitting) app.quit()
  })

  app.on('before-quit', (event) => {
    quitting = true
    if (shutdownComplete || !engine) return
    event.preventDefault()
    void engine.shutdown().finally(() => {
      shutdownComplete = true
      app.quit()
    })
  })
}
