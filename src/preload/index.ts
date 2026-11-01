import { contextBridge, ipcRenderer } from 'electron'
import type { ElectronApi } from '../shared/api'
import type {
  LogLine,
  QualityProgress,
  ScanProgress,
  SpeedTestProgress,
  Status
} from '../shared/types'

const api: ElectronApi = {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  connect: (endpoint) => ipcRenderer.invoke('engine:connect', endpoint),
  disconnect: () => ipcRenderer.invoke('engine:disconnect'),
  scan: (deep) => ipcRenderer.invoke('engine:scan', deep),
  cancelScan: () => ipcRenderer.invoke('engine:scan-cancel'),
  register: (fresh) => ipcRenderer.invoke('account:register', fresh),
  updateCore: () => ipcRenderer.invoke('core:update'),
  checkCore: () => ipcRenderer.invoke('core:check'),
  getLogs: () => ipcRenderer.invoke('engine:logs'),
  getNodes: () => ipcRenderer.invoke('engine:nodes'),
  getConnections: () => ipcRenderer.invoke('diag:connections'),
  speedTest: () => ipcRenderer.invoke('diag:speed'),
  qualityTest: () => ipcRenderer.invoke('diag:quality'),
  exportDiagnostics: () => ipcRenderer.invoke('diag:export'),
  getGeoipStatus: () => ipcRenderer.invoke('geoip:status'),
  downloadGeoip: () => ipcRenderer.invoke('geoip:download'),
  openGeoipDir: () => ipcRenderer.invoke('geoip:open'),
  openDataDir: () => ipcRenderer.invoke('shell:open-data'),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  quit: () => ipcRenderer.invoke('app:quit'),
  onStatus: (cb) => {
    const listener = (_e: unknown, status: Status): void => cb(status)
    ipcRenderer.on('engine:status', listener)
    return () => ipcRenderer.removeListener('engine:status', listener)
  },
  onLog: (cb) => {
    const listener = (_e: unknown, line: LogLine): void => cb(line)
    ipcRenderer.on('engine:log', listener)
    return () => ipcRenderer.removeListener('engine:log', listener)
  },
  onScanProgress: (cb) => {
    const listener = (_e: unknown, progress: ScanProgress): void => cb(progress)
    ipcRenderer.on('engine:scan-progress', listener)
    return () => ipcRenderer.removeListener('engine:scan-progress', listener)
  },
  onSpeedProgress: (cb) => {
    const listener = (_e: unknown, progress: SpeedTestProgress): void => cb(progress)
    ipcRenderer.on('diag:speed-progress', listener)
    return () => ipcRenderer.removeListener('diag:speed-progress', listener)
  },
  onQualityProgress: (cb) => {
    const listener = (_e: unknown, progress: QualityProgress): void => cb(progress)
    ipcRenderer.on('diag:quality-progress', listener)
    return () => ipcRenderer.removeListener('diag:quality-progress', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
