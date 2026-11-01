import type {
  AccountInfo,
  Bootstrap,
  ConnectionInfo,
  CoreInfo,
  GeoIpStatus,
  LogLine,
  NodeResult,
  QualityProgress,
  QualityResult,
  ScanProgress,
  ScanResult,
  Settings,
  SpeedTestProgress,
  SpeedTestResult,
  Status
} from './types'

export interface ElectronApi {
  bootstrap: () => Promise<Bootstrap>
  updateSettings: (patch: Partial<Settings>) => Promise<Settings>
  connect: (endpoint?: string) => Promise<Status>
  disconnect: () => Promise<Status>
  scan: (deep: boolean) => Promise<ScanResult>
  cancelScan: () => Promise<void>
  register: (fresh: boolean) => Promise<AccountInfo>
  updateCore: () => Promise<CoreInfo>
  checkCore: () => Promise<{ current: string; latest: string; hasUpdate: boolean }>
  getLogs: () => Promise<LogLine[]>
  getNodes: () => Promise<NodeResult[]>
  getConnections: () => Promise<ConnectionInfo[]>
  speedTest: () => Promise<SpeedTestResult>
  qualityTest: () => Promise<QualityResult>
  exportDiagnostics: () => Promise<string>
  getGeoipStatus: () => Promise<GeoIpStatus>
  downloadGeoip: () => Promise<GeoIpStatus>
  openGeoipDir: () => Promise<string>
  openDataDir: () => Promise<void>
  openExternal: (url: string) => Promise<void>
  quit: () => Promise<void>
  onStatus: (cb: (status: Status) => void) => () => void
  onLog: (cb: (line: LogLine) => void) => () => void
  onScanProgress: (cb: (progress: ScanProgress) => void) => () => void
  onSpeedProgress: (cb: (progress: SpeedTestProgress) => void) => () => void
  onQualityProgress: (cb: (progress: QualityProgress) => void) => () => void
}
