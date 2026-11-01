import type { ElectronApi } from '../shared/api'

declare global {
  interface Window {
    api: ElectronApi
  }
}

export {}
