import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type {
  NodeGeo,
  NodeResult,
  ScanProgress,
  Settings,
  SourceSummary
} from '../../shared/types'
import type { WarpAccount } from './account'
import { renderScanConfig } from './config'
import { MihomoCore } from './core'
import type { GeoIp } from './geoip'
import { collectCandidates, type Candidate } from './ipSources'
import { ensureDir, getFreePort } from './util'

const PROBE_TIMEOUT = 3500
const PROBE_WORKERS = 8

export interface ScanOptions {
  home: string
  binary: string
  settings: Settings
  account: WarpAccount
  deep: boolean
  geoip?: GeoIp | null
  onProgress: (progress: ScanProgress) => void
  onLog: (level: 'info' | 'warn' | 'error', text: string) => void
  isCancelled: () => boolean
}

export interface ScanOutcome {
  nodes: NodeResult[]
  sources: SourceSummary
}

function preferredRegions(value: string): Set<string> {
  return new Set(
    value
      .split(/[\s,;]+/)
      .map((item) => item.trim().toUpperCase())
      .filter((item) => /^[A-Z]{2}$/.test(item))
  )
}

export function scoreNode(
  delayMs: number,
  lossPct: number,
  jitterMs: number,
  geo: NodeGeo | undefined,
  preferred: Set<string>
): number {
  if (delayMs <= 0) return 0
  const latency = Math.max(0, 100 - delayMs / 8)
  const loss = Math.max(0, 100 - lossPct * 2)
  const jitter = Math.max(0, 100 - jitterMs * 0.8)
  let score = latency * 0.6 + loss * 0.28 + jitter * 0.12
  if (geo?.country && preferred.has(geo.country)) score += 6
  return Math.max(0, Math.min(100, Math.round(score)))
}

function summarizeSamples(samples: number[]): { delayMs: number; jitterMs: number } {
  if (samples.length === 0) return { delayMs: 0, jitterMs: 0 }
  const sum = samples.reduce((total, value) => total + value, 0)
  const delayMs = Math.round(sum / samples.length)
  if (samples.length < 2) return { delayMs, jitterMs: 0 }
  let delta = 0
  for (let i = 1; i < samples.length; i++) delta += Math.abs(samples[i] - samples[i - 1])
  return { delayMs, jitterMs: Math.round(delta / (samples.length - 1)) }
}

function endpointHost(endpoint: string): string {
  const bracket = endpoint.match(/^\[([^\]]+)\]:\d+$/)
  if (bracket) return bracket[1]
  const index = endpoint.lastIndexOf(':')
  return index > 0 ? endpoint.slice(0, index) : endpoint
}

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':')
}

export async function scanEndpoints(opts: ScanOptions): Promise<ScanOutcome> {
  const collected = await collectCandidates(opts.settings, opts.deep, {
    onLog: opts.onLog,
    isCancelled: opts.isCancelled
  })
  const { candidates, summary } = collected
  opts.onLog(
    'info',
    `节点扫描开始：${candidates.length} 个候选（${opts.settings.proto.toUpperCase()}，内置 ${summary.builtin} / 订阅 ${summary.subscription} / 随机 ${summary.random}）`
  )

  if (candidates.length === 0) {
    opts.onLog('warn', '没有可用的候选节点')
    return { nodes: [], sources: summary }
  }

  const dir = join(opts.home, 'scan')
  await ensureDir(dir)
  const apiPort = await getFreePort()
  const mixedPort = await getFreePort()
  const configPath = join(dir, 'config.yaml')
  await fs.writeFile(
    configPath,
    renderScanConfig({
      settings: opts.settings,
      account: opts.account,
      endpoints: candidates.map((candidate) => candidate.endpoint),
      mixedPort,
      apiPort
    }),
    'utf8'
  )

  const geoip = opts.geoip ?? null
  const geos = candidates.map((candidate) => {
    const host = endpointHost(candidate.endpoint)
    return geoip && isIpLiteral(host) ? geoip.lookup(host) : null
  })
  if (geos.some(Boolean)) {
    opts.onLog('info', `归属地识别：${geos.filter(Boolean).length} 个节点已标注（离线 MMDB）`)
  }

  const core = new MihomoCore()
  await core.start({
    binary: opts.binary,
    home: dir,
    configPath,
    apiPort,
    onLog: (level, text) => {
      if (level === 'error') opts.onLog('warn', text)
    }
  })

  const rounds = opts.deep ? 4 : 3
  const samples: number[][] = candidates.map(() => [])
  const total = candidates.length * rounds
  let done = 0
  let cursor = 0
  opts.onProgress({ done, total })

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++
      if (index >= candidates.length) return
      for (let round = 0; round < rounds; round++) {
        if (opts.isCancelled()) return
        const delay = await core.delay(`n${index}`, PROBE_TIMEOUT)
        if (delay !== null) samples[index].push(delay)
        done++
        opts.onProgress({ done, total })
      }
    }
  }

  const workers = Array.from({ length: Math.min(PROBE_WORKERS, candidates.length) }, () => worker())
  try {
    await Promise.all(workers)
  } finally {
    await core.stop()
  }

  if (opts.isCancelled()) opts.onLog('warn', '节点扫描已取消')

  const preferred = preferredRegions(opts.settings.preferredRegions)
  const results: NodeResult[] = candidates.map((candidate, index) => {
    const geo = geos[index]
    const { delayMs, jitterMs } = summarizeSamples(samples[index])
    const lossPct = Math.round(((rounds - samples[index].length) / rounds) * 100)
    const ok = samples[index].length > 0 && delayMs > 0
    return {
      name: `n${index}`,
      endpoint: candidate.endpoint,
      delayMs,
      ok,
      ...(ok ? {} : { error: 'timeout' }),
      lossPct,
      jitterMs,
      score: ok ? scoreNode(delayMs, lossPct, jitterMs, geo ?? undefined, preferred) : 0,
      source: candidate.source,
      ...(candidate.tag ? { tag: candidate.tag } : {}),
      ...(geo ? { geo } : {})
    }
  })

  const okNodes = results
    .filter((node) => node.ok)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.delayMs - b.delayMs)
  const failed = results.filter((node) => !node.ok)
  opts.onLog(
    'info',
    `扫描完成：${okNodes.length} 个可用 / ${candidates.length} 个候选（每节点 ${rounds} 次探测）`
  )
  return { nodes: [...okNodes, ...failed], sources: summary }
}
