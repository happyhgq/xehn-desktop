import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import { dirname, join } from 'node:path'
import WebSocket from 'ws'
import {
  DEFAULT_SETTINGS,
  LICENSE_NOTICE,
  type AccountInfo,
  type Bootstrap,
  type ConnectionInfo,
  type CoreInfo,
  type GeoIpStatus,
  type LogLine,
  type NodeResult,
  type QualityProgress,
  type QualityResult,
  type ScanProgress,
  type ScanResult,
  type Settings,
  type SourceSummary,
  type SpeedTestProgress,
  type SpeedTestResult,
  type Status
} from '../../shared/types'
import { AccountStore, type WarpAccount } from './account'
import { GROUP_NAME, NODE_NAME, normalizeEndpoint, parseEndpoint, renderConfig } from './config'
import { MihomoCore } from './core'
import { runQualityTest, runSpeedTest, toConnectionInfo } from './diagnostics'
import { downloadCore, latestRelease, resolveCore } from './coreBinary'
import { downloadGeoipDb, ensureGeoipDir, GeoIp } from './geoip'
import { probeExit } from './probe'
import { scanEndpoints } from './scanner'
import { hasBackup, proxyIsOurs, restoreSystemProxy, setSystemProxy } from './systemProxy'
import { ensureDir, getFreePort, isPortFree, nowISO, readJSON, sleep, writeJSON } from './util'

export interface EngineHooks {
  onStatus: (status: Status) => void
  onLog: (line: LogLine) => void
  onScanProgress: (progress: ScanProgress) => void
}

interface NodeCache {
  proto: string
  scannedAt: number
  nodes: NodeResult[]
  sources?: SourceSummary
}

const NODE_TTL = 6 * 60 * 60 * 1000

export class Engine {
  private readonly home: string
  private readonly coreCandidates: string[]
  private readonly version: string
  private readonly hooks: EngineHooks

  private settings: Settings = { ...DEFAULT_SETTINGS }
  private readonly accounts: AccountStore
  private core: MihomoCore | null = null
  private coreInfo: CoreInfo = { available: false, path: '', version: '' }
  private nodes: NodeResult[] = []
  private nodesAt: number | null = null
  private sources: SourceSummary | null = null
  private readonly geoip = new GeoIp()
  private logs: LogLine[] = []
  private scanning = false
  private scanCancelled = false
  private busy = false
  private traffic: WebSocket | null = null
  private timers: NodeJS.Timeout[] = []
  private broadcastAt = 0
  private proxyApplied = false

  private status: Status

  constructor(opts: { home: string; coreCandidates: string[]; version: string; hooks: EngineHooks }) {
    this.home = opts.home
    this.coreCandidates = opts.coreCandidates
    this.version = opts.version
    this.hooks = opts.hooks
    this.accounts = new AccountStore(opts.home)
    this.status = this.baseStatus()
  }

  private baseStatus(): Status {
    return {
      state: 'disconnected',
      proto: this.settings.proto,
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
      mixedPort: this.settings.mixedPort,
      apiPort: this.settings.apiPort,
      tun: this.settings.tun,
      systemProxy: false,
      coreVersion: this.coreInfo.version,
      error: ''
    }
  }

  async init(): Promise<void> {
    await ensureDir(this.home)
    const saved = await readJSON<Partial<Settings>>(join(this.home, 'settings.json'), {})
    this.settings = this.normalize({ ...DEFAULT_SETTINGS, ...saved })
    await this.saveSettings()
    await this.accounts.load()

    const cache = await readJSON<NodeCache | null>(join(this.home, 'nodes.json'), null)
    if (cache && cache.proto === this.settings.proto && Date.now() - cache.scannedAt < NODE_TTL) {
      this.nodes = cache.nodes
      this.nodesAt = cache.scannedAt
      this.sources = cache.sources ?? null
    }

    const geoStatus = await this.geoip.load(this.home)
    this.log(
      'info',
      geoStatus.available ? `归属地数据库：${geoStatus.note}` : '未加载 GeoIP 数据库，扫描将跳过归属地标签'
    )

    this.coreInfo = await resolveCore(this.home, this.coreCandidates)
    this.status = this.baseStatus()
    this.status.coreVersion = this.coreInfo.version

    if (this.coreInfo.available) {
      this.log('info', `mihomo 核心：${this.coreInfo.version || '未知版本'}（${this.coreInfo.path}）`)
    } else {
      this.log('warn', '未找到 mihomo 核心，首次连接时将自动下载')
    }

    if (await hasBackup(this.home)) {
      try {
        await restoreSystemProxy(this.home)
        this.log('info', '已恢复上次异常退出遗留的系统代理设置')
      } catch (err) {
        this.log('warn', `恢复系统代理失败：${(err as Error).message}`)
      }
    }

    if (this.settings.autoConnect) {
      setTimeout(() => {
        this.connect().catch((err) => this.log('error', `自动连接失败：${(err as Error).message}`))
      }, 1500)
    }
  }

  private normalize(settings: Settings): Settings {
    const clampPort = (n: number, fallback: number): number => {
      const v = Math.trunc(Number(n))
      return Number.isFinite(v) && v >= 1024 && v <= 65535 ? v : fallback
    }
    return {
      ...settings,
      mixedPort: clampPort(settings.mixedPort, DEFAULT_SETTINGS.mixedPort),
      apiPort: clampPort(settings.apiPort, DEFAULT_SETTINGS.apiPort),
      dns: typeof settings.dns === 'string' ? settings.dns : DEFAULT_SETTINGS.dns,
      endpoint: typeof settings.endpoint === 'string' ? settings.endpoint.trim() : '',
      subscriptionUrls:
        typeof settings.subscriptionUrls === 'string'
          ? settings.subscriptionUrls
          : DEFAULT_SETTINGS.subscriptionUrls,
      preferredRegions:
        typeof settings.preferredRegions === 'string'
          ? settings.preferredRegions
          : DEFAULT_SETTINGS.preferredRegions
    }
  }

  private async saveSettings(): Promise<void> {
    await writeJSON(join(this.home, 'settings.json'), this.settings)
  }

  getSettings(): Settings {
    return { ...this.settings }
  }

  getStatus(): Status {
    return { ...this.status }
  }

  getNodes(): NodeResult[] {
    return [...this.nodes]
  }

  getNodesAt(): number | null {
    return this.nodesAt
  }

  getLogs(): LogLine[] {
    return [...this.logs]
  }

  getCoreInfo(): CoreInfo {
    return { ...this.coreInfo }
  }

  getGeoipStatus(): GeoIpStatus {
    return this.geoip.getStatus()
  }

  async downloadGeoip(): Promise<GeoIpStatus> {
    if (this.scanning) throw new Error('请等待扫描结束再下载数据库')
    await downloadGeoipDb(this.home, (level, text) => this.log(level, text))
    const status = await this.geoip.load(this.home)
    this.log('info', `归属地数据库已重新加载：${status.note}`)
    return status
  }

  async openGeoipDir(): Promise<string> {
    return ensureGeoipDir(this.home)
  }

  async getConnections(): Promise<ConnectionInfo[]> {
    if (!this.core || this.status.state !== 'connected') return []
    const raw = await this.core.connections()
    return raw
      .map(toConnectionInfo)
      .sort((a, b) => b.upload + b.download - (a.upload + a.download))
  }

  async speedTest(onProgress: (progress: SpeedTestProgress) => void): Promise<SpeedTestResult> {
    if (!this.core || this.status.state !== 'connected') throw new Error('请先连接后再测速')
    this.log('info', '开始带宽测速（Cloudflare speed.cloudflare.com）')
    try {
      const result = await runSpeedTest(this.settings.mixedPort, onProgress)
      this.log(
        'info',
        `测速完成：下行 ${result.downMbps} Mbps，上行 ${result.upMbps} Mbps`
      )
      return result
    } catch (err) {
      this.log('warn', `带宽测速失败：${(err as Error).message}`)
      throw err
    }
  }

  async qualityTest(onProgress: (progress: QualityProgress) => void): Promise<QualityResult> {
    if (!this.core || this.status.state !== 'connected') throw new Error('请先连接后再检测')
    const result = await runQualityTest(() => this.core!.delay(NODE_NAME, 2500), onProgress)
    this.log(
      'info',
      `质量检测完成：丢包 ${result.lossPct}%，平均 ${result.avgMs} ms（${result.received}/${result.sent}）`
    )
    return result
  }

  async exportDiagnostics(): Promise<string> {
    const dir = join(this.home, 'diagnostics')
    await ensureDir(dir)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const file = join(dir, `xehn-diag-${stamp}.json`)
    const connections = await this.getConnections()
    const okNodes = this.nodes.filter((n) => n.ok)
    const report = {
      exportedAt: nowISO(),
      app: {
        version: this.version,
        platform: process.platform,
        arch: process.arch,
        os: `${os.version()} (${os.release()})`
      },
      core: this.getCoreInfo(),
      status: this.getStatus(),
      settings: this.getSettings(),
      account: this.accounts.info(),
      nodes: {
        scannedAt: this.nodesAt ? new Date(this.nodesAt).toISOString() : null,
        total: this.nodes.length,
        ok: okNodes.length,
        sources: this.sources,
        list: this.nodes.map((n) => ({
          endpoint: n.endpoint,
          delayMs: n.delayMs,
          ok: n.ok,
          error: n.error ?? '',
          lossPct: n.lossPct ?? null,
          jitterMs: n.jitterMs ?? null,
          score: n.score ?? null,
          source: n.source ?? '',
          country: n.geo?.country ?? '',
          city: n.geo?.city ?? '',
          asn: n.geo?.asn ?? 0,
          asOrg: n.geo?.asOrg ?? ''
        }))
      },
      connections: connections.map((c) => ({
        host: c.host,
        ip: c.ip,
        port: c.port,
        network: c.network,
        rule: c.rule,
        process: c.process,
        upload: c.upload,
        download: c.download
      })),
      logs: this.logs.slice(-400)
    }
    await fs.writeFile(file, JSON.stringify(report, null, 2), 'utf8')
    this.log('info', `诊断报告已导出：${file}`)
    return file
  }

  async updateSettings(patch: Partial<Settings>): Promise<Settings> {
    const prevProto = this.settings.proto
    this.settings = this.normalize({ ...this.settings, ...patch })
    if (prevProto !== this.settings.proto && this.settings.endpoint) {
      try {
        normalizeEndpoint(this.settings.endpoint, this.settings.proto)
      } catch {
        this.settings.endpoint = ''
      }
    }
    await this.saveSettings()
    this.status.proto = this.settings.proto
    this.status.mixedPort = this.settings.mixedPort
    this.status.apiPort = this.settings.apiPort
    this.status.tun = this.settings.tun
    this.emitStatus(true)
    return this.getSettings()
  }

  getBootstrap(): Bootstrap {
    return {
      settings: this.getSettings(),
      account: this.accounts.info(),
      status: this.getStatus(),
      nodes: this.getNodes(),
      nodesAt: this.nodesAt,
      sources: this.sources,
      core: this.getCoreInfo(),
      geoip: this.getGeoipStatus(),
      version: this.version,
      platform: process.platform,
      licenseNotice: LICENSE_NOTICE
    }
  }

  private log(level: LogLine['level'], text: string, source: LogLine['source'] = 'app'): void {
    const line: LogLine = { ts: Date.now(), level, source, text }
    this.logs.push(line)
    if (this.logs.length > 800) this.logs.splice(0, this.logs.length - 800)
    this.hooks.onLog(line)
  }

  private emitStatus(force = false): void {
    const now = Date.now()
    if (!force && now - this.broadcastAt < 400) return
    this.broadcastAt = now
    this.hooks.onStatus(this.getStatus())
  }

  private clearTimers(): void {
    for (const timer of this.timers) clearInterval(timer)
    this.timers = []
  }

  private setStatus(patch: Partial<Status>, force = true): void {
    this.status = { ...this.status, ...patch }
    this.emitStatus(force)
  }

  async ensureCore(): Promise<CoreInfo> {
    if (this.coreInfo.available) return this.coreInfo
    this.log('info', '正在获取 mihomo 核心…')
    this.coreInfo = await downloadCore(this.home, (text) => this.log('info', text))
    this.status.coreVersion = this.coreInfo.version
    return this.coreInfo
  }

  async updateCore(): Promise<CoreInfo> {
    if (this.status.state === 'connected') throw new Error('请先断开连接再更新核心')
    this.coreInfo = await downloadCore(this.home, (text) => this.log('info', text))
    this.status.coreVersion = this.coreInfo.version
    this.emitStatus(true)
    return this.getCoreInfo()
  }

  async checkCoreUpdate(): Promise<{ current: string; latest: string; hasUpdate: boolean }> {
    const latest = await latestRelease()
    const current = this.coreInfo.version.replace(/^v/, '')
    return {
      current: this.coreInfo.version,
      latest: latest.version,
      hasUpdate: Boolean(latest.version) && latest.version.replace(/^v/, '') !== current
    }
  }

  private async ensureAccount(): Promise<WarpAccount> {
    let existing = this.accounts.get()
    if (!existing) {
      this.log('info', '首次使用，正在注册 WARP 设备…')
      existing = await this.accounts.register()
      this.log('info', `WARP 设备注册成功：${existing.id.slice(0, 8)}…`)
    }
    const proto = this.settings.proto
    if ((proto === 'masque' || proto === 'masque-h2') && !existing.masque) {
      this.log('info', '正在注册 MASQUE 设备…')
      await this.accounts.ensureMasque()
      this.log('info', 'MASQUE 设备注册成功')
      existing = this.accounts.get()!
    }
    return existing
  }

  async register(fresh = false): Promise<AccountInfo> {
    if (this.busy || this.status.state === 'connected') throw new Error('请先断开连接')
    this.log('info', fresh ? '正在注册全新 WARP 设备…' : '正在刷新 WARP 设备密钥…')
    const account = fresh ? await this.accounts.reset() : await this.accounts.register({ fresh: false })
    this.nodes = []
    this.nodesAt = null
    this.sources = null
    await fs.rm(join(this.home, 'nodes.json'), { force: true })
    this.log('info', `WARP 设备已就绪：${account.id.slice(0, 8)}…`)
    return this.accounts.info()!
  }

  private nodeCacheValid(): boolean {
    return (
      this.nodes.length > 0 &&
      this.nodesAt !== null &&
      Date.now() - this.nodesAt < NODE_TTL &&
      this.nodes.some((n) => n.ok)
    )
  }

  async scan(deep = false): Promise<ScanResult> {
    if (this.scanning) throw new Error('扫描已在进行中')
    this.scanning = true
    this.scanCancelled = false
    try {
      const core = await this.ensureCore()
      const account = await this.ensureAccount()
      const result = await scanEndpoints({
        home: this.home,
        binary: core.path,
        settings: this.getSettings(),
        account,
        deep,
        geoip: this.geoip,
        onProgress: (progress) => this.hooks.onScanProgress(progress),
        onLog: (level, text) => this.log(level, text),
        isCancelled: () => this.scanCancelled
      })
      this.nodes = result.nodes
      this.nodesAt = Date.now()
      this.sources = result.sources
      const cache: NodeCache = {
        proto: this.settings.proto,
        scannedAt: this.nodesAt,
        nodes: result.nodes,
        sources: result.sources
      }
      await writeJSON(join(this.home, 'nodes.json'), cache)
      return {
        nodes: result.nodes,
        scannedAt: this.nodesAt,
        proto: this.settings.proto,
        sources: result.sources
      }
    } finally {
      this.scanning = false
    }
  }

  cancelScan(): void {
    if (this.scanning) {
      this.scanCancelled = true
      this.log('warn', '正在取消扫描…')
    }
  }

  async connect(endpointOverride?: string): Promise<Status> {
    if (this.busy) return this.getStatus()
    if (this.status.state === 'connected' || this.status.state === 'connecting') {
      return this.getStatus()
    }
    this.busy = true
    this.setStatus({ state: 'connecting', error: '', exitIp: '', country: '', colo: '', city: '', latencyMs: 0, upBps: 0, downBps: 0, activeConns: 0 })

    try {
      const core = await this.ensureCore()
      const account = await this.ensureAccount()

      if (this.status.tun || this.getSettings().tun) this.log('info', 'TUN 模式需要管理员权限，若启动失败请以管理员身份运行')

      let endpoint = (endpointOverride ?? this.settings.endpoint).trim()
      if (endpoint) {
        endpoint = normalizeEndpoint(endpoint, this.settings.proto)
      } else {
        if (this.settings.autoScan && !this.nodeCacheValid()) {
          this.log('info', '尚无可用节点，先进行快速测速…')
          await this.scan(false)
        }
        const best = this.nodes.find((n) => n.ok)
        if (!best) throw new Error('没有可用节点，请先在“节点”页测速或手动填写端点')
        endpoint = best.endpoint
      }

      if (!(await isPortFree(this.settings.mixedPort))) {
        throw new Error(`本地代理端口 ${this.settings.mixedPort} 已被占用，请在设置中更换`)
      }

      let apiPort = this.settings.apiPort
      if (!(await isPortFree(apiPort))) {
        apiPort = await getFreePort()
        this.log('warn', `API 端口 ${this.settings.apiPort} 被占用，本次改用 ${apiPort}`)
      }

      const config = renderConfig({
        settings: this.getSettings(),
        account,
        endpoint,
        mixedPort: this.settings.mixedPort,
        apiPort
      })
      const configPath = join(this.home, 'config.yaml')
      await ensureDir(dirname(configPath))
      await fs.writeFile(configPath, config, 'utf8')

      this.core = new MihomoCore()
      const coreVersion = core.version
      this.log('info', `启动核心并连接 ${endpoint}（${this.settings.proto.toUpperCase()}）`)
      await this.core.start({
        binary: core.path,
        home: this.home,
        configPath,
        apiPort,
        onLog: (level, text) => this.log(level, text, 'core'),
        onExit: (code) => {
          if (this.status.state === 'connected' || this.status.state === 'connecting') {
            this.log('error', `核心意外退出（code=${code ?? 'null'}）`)
            this.teardownOnError('核心意外退出，请重试或更换节点')
          }
        }
      })

      if (this.settings.systemProxy && !this.settings.tun) {
        try {
          await setSystemProxy(this.home, this.settings.mixedPort)
          this.proxyApplied = true
        } catch (err) {
          this.log('warn', `设置系统代理失败：${(err as Error).message}`)
        }
      } else {
        this.proxyApplied = false
      }

      this.startTrafficWatcher(apiPort)
      this.status = {
        ...this.status,
        state: 'connected',
        proto: this.settings.proto,
        endpoint,
        exitIp: '',
        country: '',
        colo: '',
        city: '',
        latencyMs: this.nodes.find((n) => n.endpoint === endpoint)?.delayMs ?? 0,
        startedAt: Date.now(),
        mixedPort: this.settings.mixedPort,
        apiPort,
        tun: this.settings.tun,
        systemProxy: this.proxyApplied,
        coreVersion,
        error: ''
      }
      this.emitStatus(true)
      this.log('info', `已连接，本地代理 127.0.0.1:${this.settings.mixedPort}`)

      void this.refreshLatency()
      void this.refreshExit(4)
      this.startTimers()
      await this.saveSessionState('connected')

      return this.getStatus()
    } catch (err) {
      const message = (err as Error).message
      this.log('error', `连接失败：${message}`)
      await this.disconnect({ silent: true })
      this.setStatus({ state: 'error', error: message })
      throw err
    } finally {
      this.busy = false
    }
  }

  async disconnect(opts: { silent?: boolean } = {}): Promise<Status> {
    const wasConnected = this.status.state !== 'disconnected'
    this.setStatus({ state: wasConnected ? 'disconnecting' : 'disconnected' })
    this.clearTimers()
    this.stopTrafficWatcher()
    try {
      if (this.proxyApplied) {
        await restoreSystemProxy(this.home)
        this.proxyApplied = false
      }
    } catch (err) {
      this.log('warn', `恢复系统代理失败：${(err as Error).message}`)
    }
    if (this.core) {
      await this.core.stop()
      this.core = null
    }
    this.status = {
      ...this.baseStatus(),
      state: 'disconnected',
      coreVersion: this.coreInfo.version,
      mixedPort: this.settings.mixedPort,
      tun: this.settings.tun
    }
    this.emitStatus(true)
    if (!opts.silent) this.log('info', '已断开连接')
    await this.saveSessionState('disconnected')
    return this.getStatus()
  }

  private async teardownOnError(message: string): Promise<void> {
    this.clearTimers()
    this.stopTrafficWatcher()
    try {
      if (this.proxyApplied) {
        await restoreSystemProxy(this.home)
        this.proxyApplied = false
      }
    } catch {
      // ignore
    }
    if (this.core) {
      await this.core.stop()
      this.core = null
    }
    this.status = {
      ...this.baseStatus(),
      state: 'error',
      error: message,
      coreVersion: this.coreInfo.version
    }
    this.emitStatus(true)
  }

  private startTimers(): void {
    this.clearTimers()
    this.timers.push(
      setInterval(() => {
        void this.refreshConnections()
      }, 5000),
      setInterval(() => {
        void this.refreshLatency()
      }, 15000),
      setInterval(() => {
        void this.refreshExit(2)
      }, 60000),
      setInterval(() => {
        this.emitStatus(true)
      }, 2000)
    )
  }

  private async refreshConnections(): Promise<void> {
    if (!this.core) return
    const count = await this.core.activeConnections()
    this.status.activeConns = count
    this.emitStatus()
  }

  private async refreshLatency(): Promise<void> {
    if (!this.core) return
    const delay = await this.core.delay(NODE_NAME, 4000)
    if (delay !== null) {
      this.status.latencyMs = delay
      this.emitStatus()
    }
  }

  private async refreshExit(attempts = 1): Promise<void> {
    if (!this.core || this.status.state !== 'connected') return
    for (let i = 0; i < attempts; i++) {
      try {
        const info = await probeExit(this.settings.mixedPort)
        if (info.ip) {
          this.status.exitIp = info.ip
          this.status.country = info.country
          this.status.colo = info.colo
          this.status.city = info.city
          this.emitStatus(true)
          this.log('info', `出口 IP：${info.ip}${info.colo ? `（${info.colo}）` : ''}`)
          return
        }
        const why = info.errors.slice(0, 2).join('；') || '未知错误'
        this.log(
          'warn',
          i < attempts - 1 ? `出口探测失败（${why}），正在重试…` : `未能获取出口 IP：${why}`
        )
      } catch (err) {
        this.log('warn', `出口探测失败：${(err as Error).message}`)
      }
      if (!this.core || this.status.state !== 'connected') return
      if (i < attempts - 1) await sleep(Math.min(2000 * 2 ** i, 15000))
    }
  }

  private startTrafficWatcher(apiPort: number): void {
    this.stopTrafficWatcher()
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${apiPort}/traffic`)
      this.traffic = ws
      ws.on('message', (data) => {
        try {
          const body = JSON.parse(data.toString()) as { up?: number; down?: number }
          this.status.upBps = body.up ?? 0
          this.status.downBps = body.down ?? 0
          this.emitStatus()
        } catch {
          // ignore
        }
      })
      ws.on('error', () => undefined)
      ws.on('close', () => {
        if (this.traffic === ws) this.traffic = null
      })
    } catch {
      // traffic meter is optional
    }
  }

  private stopTrafficWatcher(): void {
    const ws = this.traffic
    this.traffic = null
    if (ws) {
      try {
        ws.close()
      } catch {
        // ignore
      }
    }
  }

  private async saveSessionState(state: string): Promise<void> {
    await writeJSON(join(this.home, 'session.json'), {
      state,
      endpoint: this.status.endpoint,
      proto: this.status.proto,
      mixedPort: this.settings.mixedPort,
      updatedAt: nowISO()
    }).catch(() => undefined)
  }

  async shutdown(): Promise<void> {
    this.scanCancelled = true
    if (this.status.state === 'connected' || this.status.state === 'connecting') {
      await this.disconnect({ silent: true })
    }
    this.clearTimers()
    this.stopTrafficWatcher()
  }

  async systemProxyActive(): Promise<boolean> {
    return proxyIsOurs(this.settings.mixedPort)
  }

  async resolveEndpointPort(endpoint: string): Promise<number> {
    return parseEndpoint(endpoint, this.settings.proto).port
  }

  groupName(): string {
    return GROUP_NAME
  }

  async sleep(ms: number): Promise<void> {
    await sleep(ms)
  }
}
