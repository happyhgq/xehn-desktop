import type {
  Bootstrap,
  GeoIpStatus,
  LogLine,
  NodeResult,
  ScanProgress,
  Settings,
  SourceSummary,
  Status
} from '../../shared/types'

export type Page = 'home' | 'nodes' | 'diag' | 'settings' | 'logs' | 'about'

export interface SpeedSample {
  t: number
  up: number
  down: number
}

export interface CoreUpdate {
  current: string
  latest: string
  hasUpdate: boolean
}

export interface AppContext {
  boot: Bootstrap
  settings: Settings
  status: Status
  nodes: NodeResult[]
  nodesAt: number | null
  sources: SourceSummary | null
  geoip: GeoIpStatus
  logs: LogLine[]
  scanning: boolean
  scanProgress: ScanProgress
  speed: SpeedSample[]
  coreUpdate: CoreUpdate | null
  updateSettings: (patch: Partial<Settings>) => Promise<void>
  connect: (endpoint?: string) => Promise<void>
  disconnect: () => Promise<void>
  scan: (deep: boolean) => Promise<void>
  cancelScan: () => void
  register: (fresh: boolean) => Promise<void>
  updateCore: () => Promise<void>
  checkCore: () => Promise<CoreUpdate>
  openExternal: (url: string) => void
  openDataDir: () => void
  downloadGeoip: () => Promise<GeoIpStatus>
  openGeoipDir: () => void
  toast: (text: string) => void
  navigate: (page: Page) => void
}
