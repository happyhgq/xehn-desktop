import { ProxyAgent, fetch as proxyFetch } from 'undici'
import type {
  ConnectionInfo,
  QualityProgress,
  QualityResult,
  SpeedTestProgress,
  SpeedTestResult
} from '../../shared/types'
import type { CoreConnection } from './core'
import { sleep } from './util'

const DOWN_BYTES = 20 * 1024 * 1024
const UP_CHUNKS = 4
const UP_CHUNK_BYTES = 2 * 1024 * 1024

function mbps(bytes: number, ms: number): number {
  if (bytes <= 0 || ms <= 0) return 0
  return (bytes * 8) / 1e6 / (ms / 1000)
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function describeError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  if (/aborted|timeout/i.test(text)) return '测速请求超时，当前节点可能无法访问 speed.cloudflare.com'
  if (/fetch failed|ECONN|socket|ENOTFOUND/i.test(text)) return '无法连接 speed.cloudflare.com，请确认隧道可用'
  return text
}

export function toConnectionInfo(raw: CoreConnection): ConnectionInfo {
  const meta = raw.metadata ?? {}
  const host = meta.host || meta.destinationIP || ''
  const start = raw.start ? Date.parse(raw.start) : 0
  return {
    id: raw.id ?? '',
    host,
    ip: meta.destinationIP ?? '',
    port: meta.destinationPort ?? '',
    network: meta.network ?? '',
    chains: raw.chains ?? [],
    rule: [raw.rule, raw.rulePayload].filter(Boolean).join(' · '),
    process: meta.processPath ?? '',
    upload: raw.upload ?? 0,
    download: raw.download ?? 0,
    start: Number.isFinite(start) ? start : 0
  }
}

async function download(
  agent: ProxyAgent,
  onProgress: (progress: SpeedTestProgress) => void
): Promise<{ bytes: number; ms: number; mbps: number }> {
  const startedAt = Date.now()
  const res = await proxyFetch(`https://speed.cloudflare.com/__down?bytes=${DOWN_BYTES}`, {
    dispatcher: agent,
    signal: AbortSignal.timeout(90000)
  })
  if (!res.ok || !res.body) throw new Error(`下行测速失败：HTTP ${res.status}`)
  const reader = res.body.getReader()
  let bytes = 0
  let firstAt = 0
  let firstBytes = 0
  let lastEmit = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!firstAt) {
      firstAt = Date.now()
      firstBytes = value.byteLength
    }
    bytes += value.byteLength
    const now = Date.now()
    if (now - lastEmit > 150) {
      lastEmit = now
      onProgress({
        phase: 'down',
        mbps: round2(mbps(bytes - firstBytes, now - firstAt)),
        progress: Math.min(1, bytes / DOWN_BYTES)
      })
    }
  }
  const endedAt = Date.now()
  const transferMs = Math.max(1, endedAt - (firstAt || startedAt))
  const transferBytes = Math.max(0, bytes - firstBytes)
  return { bytes, ms: transferMs, mbps: mbps(transferBytes, transferMs) }
}

async function upload(
  agent: ProxyAgent,
  onProgress: (progress: SpeedTestProgress) => void
): Promise<{ bytes: number; ms: number; mbps: number }> {
  const payload = new Uint8Array(UP_CHUNK_BYTES)
  const startedAt = Date.now()
  let bytes = 0
  for (let i = 0; i < UP_CHUNKS; i++) {
    const res = await proxyFetch('https://speed.cloudflare.com/__up', {
      method: 'POST',
      body: payload,
      headers: { 'Content-Type': 'application/octet-stream' },
      dispatcher: agent,
      signal: AbortSignal.timeout(90000)
    })
    await res.arrayBuffer().catch(() => undefined)
    if (!res.ok) throw new Error(`上行测速失败：HTTP ${res.status}`)
    bytes += payload.byteLength
    const elapsed = Math.max(1, Date.now() - startedAt)
    onProgress({ phase: 'up', mbps: round2(mbps(bytes, elapsed)), progress: (i + 1) / UP_CHUNKS })
  }
  const ms = Math.max(1, Date.now() - startedAt)
  return { bytes, ms, mbps: mbps(bytes, ms) }
}

export async function runSpeedTest(
  mixedPort: number,
  onProgress: (progress: SpeedTestProgress) => void
): Promise<SpeedTestResult> {
  const agent = new ProxyAgent(`http://127.0.0.1:${mixedPort}`)
  try {
    onProgress({ phase: 'down', mbps: 0, progress: 0 })
    const down = await download(agent, onProgress)
    onProgress({ phase: 'up', mbps: 0, progress: 0 })
    const up = await upload(agent, onProgress)
    return {
      downMbps: round2(down.mbps),
      upMbps: round2(up.mbps),
      downBytes: down.bytes,
      upBytes: up.bytes,
      downMs: down.ms,
      upMs: up.ms
    }
  } catch (err) {
    throw new Error(describeError(err))
  } finally {
    await agent.close().catch(() => undefined)
  }
}

export async function runQualityTest(
  probe: () => Promise<number | null>,
  onProgress: (progress: QualityProgress) => void,
  samples = 12,
  intervalMs = 260
): Promise<QualityResult> {
  const hits: number[] = []
  for (let i = 0; i < samples; i++) {
    if (i > 0) await sleep(intervalMs)
    const ms = await probe()
    if (ms !== null) hits.push(ms)
    onProgress({ done: i + 1, total: samples, lastMs: ms })
  }
  const sent = samples
  const received = hits.length
  const avg = received ? hits.reduce((sum, v) => sum + v, 0) / received : 0
  return {
    sent,
    received,
    lossPct: sent ? round2(((sent - received) / sent) * 100) : 0,
    minMs: received ? Math.min(...hits) : 0,
    avgMs: Math.round(avg),
    maxMs: received ? Math.max(...hits) : 0,
    samples: hits
  }
}
