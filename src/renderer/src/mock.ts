import type { ElectronApi } from '../../shared/api'
import {
  DEFAULT_SETTINGS,
  LICENSE_NOTICE,
  type Bootstrap,
  type ConnectionInfo,
  type GeoIpStatus,
  type LogLine,
  type NodeResult,
  type QualityProgress,
  type ScanProgress,
  type SourceSummary,
  type SpeedTestProgress,
  type Status
} from '../../shared/types'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const now = Date.now()

const demoNodes: NodeResult[] = [
  {
    name: 'n0',
    endpoint: '162.159.192.31:2408',
    delayMs: 38,
    ok: true,
    lossPct: 0,
    jitterMs: 3,
    score: 95,
    source: 'builtin',
    geo: { country: 'US', countryName: '美国', city: '洛杉矶', asn: 13335, asOrg: 'Cloudflare, Inc.' }
  },
  {
    name: 'n1',
    endpoint: '188.114.97.12:500',
    delayMs: 56,
    ok: true,
    lossPct: 0,
    jitterMs: 5,
    score: 91,
    source: 'random',
    geo: { country: 'DE', countryName: '德国', city: '法兰克福', asn: 13335, asOrg: 'Cloudflare, Inc.' }
  },
  {
    name: 'n2',
    endpoint: '162.159.195.77:2408',
    delayMs: 71,
    ok: true,
    lossPct: 33,
    jitterMs: 8,
    score: 79,
    source: 'builtin',
    tag: 'HK-02',
    geo: { country: 'HK', countryName: '中国香港', city: '香港', asn: 13335, asOrg: 'Cloudflare, Inc.' }
  },
  {
    name: 'n3',
    endpoint: '8.39.125.90:4500',
    delayMs: 94,
    ok: true,
    lossPct: 0,
    jitterMs: 12,
    score: 78,
    source: 'random',
    geo: { country: 'SG', countryName: '新加坡', city: '新加坡', asn: 13335, asOrg: 'Cloudflare, Inc.' }
  },
  {
    name: 'n4',
    endpoint: '188.114.98.44:1701',
    delayMs: 132,
    ok: true,
    lossPct: 0,
    jitterMs: 18,
    score: 69,
    source: 'subscription',
    tag: 'LAX-Premium',
    geo: { country: 'NL', countryName: '荷兰', city: '阿姆斯特丹', asn: 13335, asOrg: 'Cloudflare, Inc.' }
  },
  {
    name: 'n5',
    endpoint: '162.159.192.9:500',
    delayMs: 0,
    ok: false,
    error: 'timeout',
    lossPct: 100,
    jitterMs: 0,
    score: 0,
    source: 'random',
    geo: { country: 'US', countryName: '美国', city: '旧金山', asn: 13335, asOrg: 'Cloudflare, Inc.' }
  }
]

const demoSources: SourceSummary = {
  builtin: 2,
  subscription: 1,
  random: 3,
  total: 6,
  subscriptionErrors: 0
}

let geoip: GeoIpStatus = {
  available: true,
  cityPath: 'C:\\Users\\Happy\\AppData\\Roaming\\xehn-desktop\\geoip\\dbip-city-lite.mmdb',
  countryPath: '',
  asnPath: 'C:\\Users\\Happy\\AppData\\Roaming\\xehn-desktop\\geoip\\dbip-asn-lite.mmdb',
  note: '城市库 + ASN 库已就绪 · 数据来源 DB-IP (CC BY 4.0)'
}

let status: Status = {
  state: 'disconnected',
  proto: 'awg',
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
  mixedPort: 7890,
  apiPort: 9090,
  tun: false,
  systemProxy: false,
  coreVersion: 'v1.19.33',
  error: ''
}

const bootstrap: Bootstrap = {
  settings: { ...DEFAULT_SETTINGS },
  account: { id: '5d9a1f7c-0000-4a00-9000-demo', ipv4: '172.16.0.2', ipv6: '2606:4700:110:8d87::1', hasMasque: true, updatedAt: new Date(now).toISOString() },
  status,
  nodes: demoNodes,
  nodesAt: now,
  sources: demoSources,
  core: { available: true, path: 'C:\\XEHN\\core\\mihomo.exe', version: 'v1.19.33' },
  geoip,
  version: '1.0.0',
  platform: 'win32',
  licenseNotice: LICENSE_NOTICE
}

const logs: LogLine[] = [
  { ts: now - 52000, level: 'info', source: 'app', text: 'mihomo 核心：v1.19.33' },
  { ts: now - 51000, level: 'info', source: 'app', text: 'WARP 设备就绪：5d9a1f7c…' },
  { ts: now - 30000, level: 'info', source: 'core', text: 'Start initial configuration in progress' },
  { ts: now - 29000, level: 'info', source: 'core', text: 'Initial configuration completed' },
  { ts: now - 12000, level: 'info', source: 'app', text: '节点扫描开始：28 个候选（AWG）' },
  { ts: now - 4000, level: 'info', source: 'app', text: '扫描完成：5 个可用 / 28 个候选' }
]

const statusListeners = new Set<(s: Status) => void>()
const logListeners = new Set<(l: LogLine) => void>()
const scanListeners = new Set<(p: ScanProgress) => void>()
const speedListeners = new Set<(p: SpeedTestProgress) => void>()
const qualityListeners = new Set<(p: QualityProgress) => void>()

const demoConnections: ConnectionInfo[] = [
  {
    id: 'c1',
    host: 'api.github.com',
    ip: '140.82.113.6',
    port: '443',
    network: 'tcp',
    chains: ['XEHN', 'WARP'],
    rule: 'Rule · GEOSITE github',
    process: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    upload: 184_320,
    download: 4_612_000,
    start: now - 32_000
  },
  {
    id: 'c2',
    host: 'speed.cloudflare.com',
    ip: '104.17.209.9',
    port: '443',
    network: 'tcp',
    chains: ['XEHN', 'WARP'],
    rule: 'Rule · GEOSITE cloudflare',
    process: 'C:\\Users\\Happy\\AppData\\Local\\Programs\\XEHN Desktop\\XEHN Desktop.exe',
    upload: 2_204_800,
    download: 21_000_000,
    start: now - 18_000
  },
  {
    id: 'c3',
    host: 'www.youtube.com',
    ip: '142.250.72.206',
    port: '443',
    network: 'tcp',
    chains: ['XEHN', 'WARP'],
    rule: 'Rule · MATCH',
    process: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
    upload: 92_100,
    download: 9_480_000,
    start: now - 96_000
  },
  {
    id: 'c4',
    host: '1.1.1.1',
    ip: '1.1.1.1',
    port: '443',
    network: 'tcp',
    chains: ['XEHN', 'WARP'],
    rule: 'Rule · IPCIDR',
    process: 'C:\\Windows\\System32\\svchost.exe',
    upload: 12_400,
    download: 84_000,
    start: now - 8_000
  }
]

let timer: ReturnType<typeof setInterval> | null = null

function startTraffic(): void {
  if (timer) return
  timer = setInterval(() => {
    if (status.state !== 'connected') return
    status = {
      ...status,
      upBps: 24000 + Math.random() * 80000,
      downBps: 900000 + Math.random() * 3200000,
      activeConns: 12 + Math.floor(Math.random() * 18)
    }
    statusListeners.forEach((cb) => cb({ ...status }))
  }, 900)
}

export function installMockApi(): void {
  const api: ElectronApi = {
    bootstrap: async () => ({ ...bootstrap, status, geoip }),
    updateSettings: async (patch) => {
      bootstrap.settings = { ...bootstrap.settings, ...patch }
      return { ...bootstrap.settings }
    },
    connect: async () => {
      status = { ...status, state: 'connecting', startedAt: null, error: '' }
      statusListeners.forEach((cb) => cb({ ...status }))
      await delay(1400)
      status = {
        ...status,
        state: 'connected',
        endpoint: '162.159.192.31:2408',
        exitIp: '104.28.219.14',
        country: 'US',
        colo: 'LAX',
        city: 'Los Angeles',
        latencyMs: 42,
        startedAt: Date.now(),
        systemProxy: true
      }
      statusListeners.forEach((cb) => cb({ ...status }))
      startTraffic()
      return { ...status }
    },
    disconnect: async () => {
      status = { ...status, state: 'disconnected', exitIp: '', startedAt: null, upBps: 0, downBps: 0, activeConns: 0 }
      statusListeners.forEach((cb) => cb({ ...status }))
      return { ...status }
    },
    scan: async () => {
      for (let i = 0; i <= 90; i += 12) {
        scanListeners.forEach((cb) => cb({ done: i, total: 90 }))
        await delay(220)
      }
      return {
        nodes: demoNodes,
        scannedAt: Date.now(),
        proto: bootstrap.settings.proto,
        sources: demoSources
      }
    },
    cancelScan: async () => undefined,
    register: async () => bootstrap.account!,
    updateCore: async () => bootstrap.core,
    checkCore: async () => ({ current: 'v1.19.33', latest: 'v1.19.33', hasUpdate: false }),
    getLogs: async () => logs,
    getNodes: async () => demoNodes,
    getConnections: async () => {
      if (status.state !== 'connected') return []
      return demoConnections.map((c) => ({
        ...c,
        upload: c.upload + Math.floor(Math.random() * 40000),
        download: c.download + Math.floor(Math.random() * 900000)
      }))
    },
    speedTest: async () => {
      for (let i = 1; i <= 10; i++) {
        speedListeners.forEach((cb) =>
          cb({ phase: 'down', mbps: 30 + i * 3.4, progress: i / 10 })
        )
        await delay(140)
      }
      for (let i = 1; i <= 4; i++) {
        speedListeners.forEach((cb) =>
          cb({ phase: 'up', mbps: 6 + i * 1.2, progress: i / 4 })
        )
        await delay(160)
      }
      return {
        downMbps: 87.4,
        upMbps: 11.6,
        downBytes: 20 * 1024 * 1024,
        upBytes: 8 * 1024 * 1024,
        downMs: 1920,
        upMs: 5520
      }
    },
    qualityTest: async () => {
      const samples: number[] = []
      for (let i = 0; i < 12; i++) {
        const ms = i === 4 ? null : 32 + Math.floor(Math.random() * 46)
        if (ms !== null) samples.push(ms)
        qualityListeners.forEach((cb) => cb({ done: i + 1, total: 12, lastMs: ms }))
        await delay(160)
      }
      return {
        sent: 12,
        received: samples.length,
        lossPct: Math.round(((12 - samples.length) / 12) * 10000) / 100,
        minMs: Math.min(...samples),
        avgMs: Math.round(samples.reduce((a, b) => a + b, 0) / samples.length),
        maxMs: Math.max(...samples),
        samples
      }
    },
    exportDiagnostics: async () => 'C:\\Users\\Happy\\AppData\\Roaming\\xehn-desktop\\diagnostics\\xehn-diag-demo.json',
    getGeoipStatus: async () => ({ ...geoip }),
    downloadGeoip: async () => {
      await delay(900)
      geoip = { ...geoip, available: true }
      return { ...geoip }
    },
    openGeoipDir: async () => 'C:\\Users\\Happy\\AppData\\Roaming\\xehn-desktop\\geoip',
    openDataDir: async () => undefined,
    openExternal: async () => undefined,
    quit: async () => undefined,
    onStatus: (cb) => {
      statusListeners.add(cb)
      return () => {
        statusListeners.delete(cb)
      }
    },
    onLog: (cb) => {
      logListeners.add(cb)
      return () => {
        logListeners.delete(cb)
      }
    },
    onScanProgress: (cb) => {
      scanListeners.add(cb)
      return () => {
        scanListeners.delete(cb)
      }
    },
    onSpeedProgress: (cb) => {
      speedListeners.add(cb)
      return () => {
        speedListeners.delete(cb)
      }
    },
    onQualityProgress: (cb) => {
      qualityListeners.add(cb)
      return () => {
        qualityListeners.delete(cb)
      }
    }
  }
  Object.defineProperty(window, 'api', { value: api, configurable: true })
}
