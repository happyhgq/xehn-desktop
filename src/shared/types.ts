export type Proto = 'awg' | 'wg' | 'masque' | 'masque-h2'
export type ConnState = 'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'error'
export type ProxyMode = 'rule' | 'global' | 'direct'
export type Theme = 'dark' | 'light'

export interface Settings {
  proto: Proto
  mixedPort: number
  apiPort: number
  mode: ProxyMode
  systemProxy: boolean
  tun: boolean
  allowLan: boolean
  ipv6: boolean
  dns: string
  endpoint: string
  subscriptionUrls: string
  preferredRegions: string
  autoScan: boolean
  autoConnect: boolean
  closeToTray: boolean
  launchAtLogin: boolean
  theme: Theme
}

export interface AccountInfo {
  id: string
  ipv4: string
  ipv6: string
  hasMasque: boolean
  updatedAt: string
}

export type NodeSource = 'builtin' | 'subscription' | 'random'

export interface NodeGeo {
  country: string
  countryName: string
  city: string
  asn: number
  asOrg: string
}

export interface NodeResult {
  name: string
  endpoint: string
  delayMs: number
  ok: boolean
  error?: string
  lossPct?: number
  jitterMs?: number
  score?: number
  source?: NodeSource
  tag?: string
  geo?: NodeGeo
}

export interface SourceSummary {
  builtin: number
  subscription: number
  random: number
  total: number
  subscriptionErrors: number
}

export interface GeoIpStatus {
  available: boolean
  cityPath: string
  countryPath: string
  asnPath: string
  note: string
}

export interface Status {
  state: ConnState
  proto: Proto
  endpoint: string
  exitIp: string
  country: string
  colo: string
  city: string
  latencyMs: number
  upBps: number
  downBps: number
  activeConns: number
  startedAt: number | null
  mixedPort: number
  apiPort: number
  tun: boolean
  systemProxy: boolean
  coreVersion: string
  error: string
}

export interface LogLine {
  ts: number
  level: 'debug' | 'info' | 'warn' | 'error'
  source: 'app' | 'core'
  text: string
}

export interface ScanProgress {
  done: number
  total: number
}

export interface CoreInfo {
  available: boolean
  path: string
  version: string
}

export interface Bootstrap {
  settings: Settings
  account: AccountInfo | null
  status: Status
  nodes: NodeResult[]
  nodesAt: number | null
  sources: SourceSummary | null
  core: CoreInfo
  geoip: GeoIpStatus
  version: string
  platform: string
  licenseNotice: string
}

export interface ScanResult {
  nodes: NodeResult[]
  scannedAt: number
  proto: Proto
  sources: SourceSummary
}

export interface ConnectionInfo {
  id: string
  host: string
  ip: string
  port: string
  network: string
  chains: string[]
  rule: string
  process: string
  upload: number
  download: number
  start: number
}

export interface SpeedTestProgress {
  phase: 'down' | 'up'
  mbps: number
  progress: number
}

export interface SpeedTestResult {
  downMbps: number
  upMbps: number
  downBytes: number
  upBytes: number
  downMs: number
  upMs: number
}

export interface QualityProgress {
  done: number
  total: number
  lastMs: number | null
}

export interface QualityResult {
  sent: number
  received: number
  lossPct: number
  minMs: number
  avgMs: number
  maxMs: number
  samples: number[]
}

export const DEFAULT_SETTINGS: Settings = {
  proto: 'awg',
  mixedPort: 7890,
  apiPort: 9090,
  mode: 'rule',
  systemProxy: true,
  tun: false,
  allowLan: false,
  ipv6: false,
  dns: '1.1.1.1, 1.0.0.1',
  endpoint: '',
  subscriptionUrls: '',
  preferredRegions: '',
  autoScan: true,
  autoConnect: false,
  closeToTray: true,
  launchAtLogin: false,
  theme: 'dark'
}

export const LICENSE_NOTICE = '本软件开源免费，仅供学习交流使用，禁止售卖！'
