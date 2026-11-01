import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import {
  DEFAULT_SETTINGS,
  type Bootstrap,
  type GeoIpStatus,
  type LogLine,
  type NodeResult,
  type ScanProgress,
  type Settings,
  type SourceSummary,
  type Status
} from '../../shared/types'
import { Icon, type IconName } from './components/Icon'
import Home from './pages/Home'
import Nodes from './pages/Nodes'
import Diagnostics from './pages/Diagnostics'
import SettingsPage from './pages/Settings'
import Logs from './pages/Logs'
import About from './pages/About'
import type { AppContext, CoreUpdate, Page, SpeedSample } from './context'
import { STATE_LABEL } from './format'

const PAGE_META: Record<Page, { title: string; en: string; icon: IconName }> = {
  home: { title: '首页', en: 'OVERVIEW', icon: 'home' },
  nodes: { title: '节点', en: 'ENDPOINTS', icon: 'nodes' },
  diag: { title: '诊断', en: 'DIAGNOSTICS', icon: 'pulse' },
  settings: { title: '设置', en: 'PREFERENCES', icon: 'settings' },
  logs: { title: '日志', en: 'RUNTIME', icon: 'logs' },
  about: { title: '关于', en: 'ABOUT', icon: 'about' }
}

const NAV: Page[] = ['home', 'nodes', 'diag', 'settings', 'logs', 'about']

const EMPTY_GEOIP: GeoIpStatus = {
  available: false,
  cityPath: '',
  countryPath: '',
  asnPath: '',
  note: '未加载'
}

function emptyStatus(settings: Settings): Status {
  return {
    state: 'disconnected',
    proto: settings.proto,
    endpoint: '',
    exitIp: '',
    country: '',
    colo: '',
    city: '',
    latencyMs: 0,
    upBps: 0,
    downBps: 0,
    activeConns: 0,
    startedAt: null,
    mixedPort: settings.mixedPort,
    apiPort: settings.apiPort,
    tun: settings.tun,
    systemProxy: false,
    coreVersion: '',
    error: ''
  }
}

function readPage(): Page {
  const hash = window.location.hash.replace(/^#\/?/, '')
  return (NAV as string[]).includes(hash) ? (hash as Page) : 'home'
}

function cleanError(err: unknown): string {
  let text = err instanceof Error ? err.message : String(err)
  text = text.replace(/^Error invoking remote method '[^']+':\s*/i, '')
  text = text.replace(/^Error:\s*/i, '')
  return text
}

interface Toast {
  id: number
  text: string
}

export default function App(): JSX.Element {
  const [boot, setBoot] = useState<Bootstrap | null>(null)
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_SETTINGS })
  const [status, setStatus] = useState<Status>(emptyStatus(DEFAULT_SETTINGS))
  const [nodes, setNodes] = useState<NodeResult[]>([])
  const [nodesAt, setNodesAt] = useState<number | null>(null)
  const [sources, setSources] = useState<SourceSummary | null>(null)
  const [geoip, setGeoip] = useState<GeoIpStatus>(EMPTY_GEOIP)
  const [logs, setLogs] = useState<LogLine[]>([])
  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState<ScanProgress>({ done: 0, total: 0 })
  const [speed, setSpeed] = useState<SpeedSample[]>([])
  const [coreUpdate, setCoreUpdate] = useState<CoreUpdate | null>(null)
  const [page, setPage] = useState<Page>(readPage())
  const [toasts, setToasts] = useState<Toast[]>([])

  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random()
    setToasts((prev) => [...prev.slice(-3), { id, text }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3400)
  }, [])

  useEffect(() => {
    let alive = true
    window.api
      .bootstrap()
      .then(async (data) => {
        if (!alive) return
        setBoot(data)
        setSettings(data.settings)
        setStatus(data.status)
        setNodes(data.nodes)
        setNodesAt(data.nodesAt)
        setSources(data.sources)
        setGeoip(data.geoip)
        const history = await window.api.getLogs().catch(() => [])
        if (alive) setLogs(history)
      })
      .catch((err) => {
        if (!alive) return
        toast(`启动失败：${cleanError(err)}`)
      })
    return () => {
      alive = false
    }
  }, [toast])

  useEffect(() => {
    const offStatus = window.api.onStatus((next) => {
      setStatus(next)
      setSpeed((prev) => [
        ...prev.slice(-79),
        { t: Date.now(), up: next.upBps, down: next.downBps }
      ])
    })
    const offLog = window.api.onLog((line) => {
      setLogs((prev) => [...prev.slice(-799), line])
    })
    const offScan = window.api.onScanProgress((progress) => setScanProgress(progress))
    return () => {
      offStatus()
      offLog()
      offScan()
    }
  }, [])

  useEffect(() => {
    const onHash = (): void => setPage(readPage())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
  }, [settings.theme])

  const lastError = useRef('')
  useEffect(() => {
    if (status.state === 'error' && status.error && status.error !== lastError.current) {
      lastError.current = status.error
      toast(status.error)
    }
    if (status.state !== 'error') lastError.current = ''
  }, [status.state, status.error, toast])

  const navigate = useCallback((next: Page) => {
    window.location.hash = `#/${next}`
    setPage(next)
  }, [])

  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      try {
        const next = await window.api.updateSettings(patch)
        setSettings(next)
      } catch (err) {
        toast(`保存失败：${cleanError(err)}`)
      }
    },
    [toast]
  )

  const refreshBoot = useCallback(async () => {
    const data = await window.api.bootstrap().catch(() => null)
    if (!data) return
    setBoot(data)
    setSettings(data.settings)
    setNodes(data.nodes)
    setNodesAt(data.nodesAt)
    setSources(data.sources)
    setGeoip(data.geoip)
  }, [])

  const connect = useCallback(
    async (endpoint?: string) => {
      try {
        const next = await window.api.connect(endpoint)
        setStatus(next)
        // The first connect registers the device; pick that up for About/Settings.
        void refreshBoot()
      } catch (err) {
        toast(cleanError(err))
      }
    },
    [refreshBoot, toast]
  )

  const disconnect = useCallback(async () => {
    try {
      const next = await window.api.disconnect()
      setStatus(next)
    } catch (err) {
      toast(cleanError(err))
    }
  }, [toast])

  const scan = useCallback(
    async (deep: boolean) => {
      if (scanning) return
      setScanning(true)
      setScanProgress({ done: 0, total: 0 })
      try {
        const result = await window.api.scan(deep)
        setNodes(result.nodes)
        setNodesAt(result.scannedAt)
        setSources(result.sources)
        const ok = result.nodes.filter((n) => n.ok).length
        toast(ok > 0 ? `扫描完成：${ok} 个可用节点` : '扫描完成，但没有可用节点')
        void refreshBoot()
      } catch (err) {
        toast(`扫描失败：${cleanError(err)}`)
      } finally {
        setScanning(false)
      }
    },
    [refreshBoot, scanning, toast]
  )

  const cancelScan = useCallback(() => {
    void window.api.cancelScan()
  }, [])

  const register = useCallback(
    async (fresh: boolean) => {
      try {
        const account = await window.api.register(fresh)
        setBoot((prev) => (prev ? { ...prev, account } : prev))
        toast('设备已更新')
      } catch (err) {
        toast(`注册失败：${cleanError(err)}`)
      }
    },
    [toast]
  )

  const updateCore = useCallback(async () => {
    try {
      toast('开始下载核心…')
      const core = await window.api.updateCore()
      setBoot((prev) => (prev ? { ...prev, core } : prev))
      toast(`核心已更新：${core.version}`)
    } catch (err) {
      toast(`更新失败：${cleanError(err)}`)
    }
  }, [toast])

  const checkCore = useCallback(async (): Promise<CoreUpdate> => {
    const result = await window.api.checkCore()
    setCoreUpdate(result)
    return result
  }, [])

  const openExternal = useCallback((url: string) => {
    void window.api.openExternal(url)
  }, [])

  const openDataDir = useCallback(() => {
    void window.api.openDataDir()
  }, [])

  const downloadGeoip = useCallback(async (): Promise<GeoIpStatus> => {
    const status = await window.api.downloadGeoip()
    setGeoip(status)
    setBoot((prev) => (prev ? { ...prev, geoip: status } : prev))
    return status
  }, [])

  const openGeoipDir = useCallback(() => {
    void window.api.openGeoipDir()
  }, [])

  if (!boot) {
    return (
      <div className="splash">
        <div className="splash-mark">
          <Icon name="bolt" size={34} />
        </div>
        <div className="splash-name">XEHN</div>
        <div className="splash-bar">
          <span />
        </div>
        <div className="splash-note">正在启动桌面客户端…</div>
      </div>
    )
  }

  const app: AppContext = {
    boot,
    settings,
    status,
    nodes,
    nodesAt,
    sources,
    geoip,
    logs,
    scanning,
    scanProgress,
    speed,
    coreUpdate,
    updateSettings,
    connect,
    disconnect,
    scan,
    cancelScan,
    register,
    updateCore,
    checkCore,
    openExternal,
    openDataDir,
    downloadGeoip,
    openGeoipDir,
    toast,
    navigate
  }

  const meta = PAGE_META[page]
  const connected = status.state === 'connected'

  return (
    <div className="app">
      <aside className="rail">
        <div className="brand">
          <div className="brand-mark">
            <Icon name="bolt" size={20} />
          </div>
          <div>
            <div className="brand-name">XEHN</div>
            <div className="brand-sub">WARP DESKTOP</div>
          </div>
        </div>

        <nav className="nav">
          {NAV.map((item) => (
            <button
              key={item}
              className={`nav-item ${page === item ? 'active' : ''}`}
              onClick={() => navigate(item)}
            >
              <Icon name={PAGE_META[item].icon} size={18} />
              <span>{PAGE_META[item].title}</span>
              <em>{PAGE_META[item].en}</em>
            </button>
          ))}
        </nav>

        <div className="rail-spacer" />

        <div className="rail-card">
          <div className="rail-card-label">ENGINE</div>
          <div className="rail-card-value">{boot.core.version || '未安装'}</div>
          <div className={`rail-dot ${boot.core.available ? 'ok' : 'warn'}`} />
        </div>

        <div className="rail-footer">
          <button
            className="icon-btn"
            title={settings.theme === 'dark' ? '切换到浅色' : '切换到深色'}
            onClick={() => void updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })}
          >
            <Icon name={settings.theme === 'dark' ? 'sun' : 'moon'} size={17} />
          </button>
          <div className="rail-version">v{boot.version}</div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <div className="page-title">{meta.title}</div>
            <div className="page-sub">{meta.en}</div>
          </div>
          <div className="topbar-right">
            <div className="chip chip-mono">
              <Icon name="server" size={14} />
              127.0.0.1:{status.mixedPort}
            </div>
            <div className={`status-chip ${status.state}`}>
              <span className="status-dot" />
              {STATE_LABEL[status.state]}
            </div>
          </div>
        </header>

        <div className="content">
          {page === 'home' && <Home app={app} />}
          {page === 'nodes' && <Nodes app={app} />}
          {page === 'diag' && <Diagnostics app={app} />}
          {page === 'settings' && <SettingsPage app={app} />}
          {page === 'logs' && <Logs app={app} />}
          {page === 'about' && <About app={app} />}
        </div>

        <footer className="statusbar">
          <span className={`dot ${connected ? 'ok' : 'idle'}`} />
          {connected ? `隧道已建立 · ${status.endpoint}` : '未建立隧道'}
          <span className="statusbar-gap" />
          <span>{status.state === 'error' ? status.error : `${appsLabel(status)}`}</span>
        </footer>
      </main>

      <div className="toast-wrap">
        {toasts.map((t) => (
          <div className="toast" key={t.id}>
            <Icon name="info" size={16} />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function appsLabel(status: Status): string {
  if (status.state === 'connected') {
    return `↓ ${(status.downBps / 1024 / 1024).toFixed(2)} MB/s · ↑ ${(status.upBps / 1024 / 1024).toFixed(2)} MB/s`
  }
  return 'Cloudflare WARP · mihomo'
}
