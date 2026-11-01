import type { NodeSource, Settings, SourceSummary } from '../../shared/types'
import { normalizeEndpoint } from './config'
import { fetchText } from './util'

export interface Candidate {
  endpoint: string
  source: NodeSource
  tag?: string
}

const WARP_POOLS = [
  '8.6.112',
  '8.34.70',
  '8.34.146',
  '8.35.211',
  '8.39.125',
  '8.39.204',
  '8.39.214',
  '8.47.69',
  '162.159.192',
  '162.159.195',
  '188.114.96',
  '188.114.97',
  '188.114.98',
  '188.114.99'
]

const WG_PORTS = [2408, 500, 1701, 4500]
const WG_EXTRA_PORTS = [854, 859, 864, 878, 880, 890, 891, 894, 903, 908, 928, 934, 939, 942, 943, 945]

const MASQUE_ADDRS = ['162.159.198.1', '162.159.198.2']
const MASQUE_H2_POOLS = ['162.159.198', '162.159.199']
const MASQUE_PORTS = [443, 500, 1701, 4500, 4443, 8443, 8095]

const BUILTIN_SEEDS: [string, number][] = [
  ['162.159.192.1', 2408],
  ['162.159.192.2', 500],
  ['162.159.195.1', 2408],
  ['188.114.96.1', 2408],
  ['188.114.97.1', 2408],
  ['188.114.97.3', 2408],
  ['188.114.98.1', 2408],
  ['188.114.99.1', 2408],
  ['8.6.112.1', 2408],
  ['8.34.70.1', 2408],
  ['8.34.146.1', 2408],
  ['8.35.211.1', 2408],
  ['8.39.125.1', 2408],
  ['8.39.204.1', 2408],
  ['8.39.214.1', 2408],
  ['8.47.69.1', 2408]
]

function randomOctet(): number {
  return 1 + Math.floor(Math.random() * 254)
}

function shuffle<T>(list: T[]): T[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)]
}

function builtinCandidates(settings: Settings, deep: boolean): Candidate[] {
  const proto = settings.proto
  const out = new Map<string, Candidate>()

  const add = (endpoint: string): void => {
    if (!out.has(endpoint)) out.set(endpoint, { endpoint, source: 'builtin' })
  }

  if (proto === 'masque' || proto === 'masque-h2') {
    if (proto === 'masque') {
      for (const addr of MASQUE_ADDRS) {
        for (const port of deep ? MASQUE_PORTS : MASQUE_PORTS.slice(0, 4)) add(`${addr}:${port}`)
      }
    } else {
      for (const addr of ['162.159.198.1', '162.159.198.2']) {
        for (const port of deep ? [443, 8443, 4443] : [443, 8443]) add(`${addr}:${port}`)
      }
    }
    return [...out.values()]
  }

  for (const [host, port] of BUILTIN_SEEDS) add(`${host}:${port}`)
  if (deep) {
    for (const [host] of BUILTIN_SEEDS.slice(0, 6)) {
      for (const port of WG_PORTS.slice(1)) add(`${host}:${port}`)
    }
  }
  return [...out.values()]
}

function randomCandidates(settings: Settings, deep: boolean): Candidate[] {
  const proto = settings.proto
  const out = new Map<string, Candidate>()

  const add = (endpoint: string): void => {
    if (!out.has(endpoint)) out.set(endpoint, { endpoint, source: 'random' })
  }

  if (proto === 'masque') return []

  if (proto === 'masque-h2') {
    const addrs: string[] = []
    for (const pool of MASQUE_H2_POOLS) {
      const count = deep ? 8 : 4
      for (let i = 0; i < count; i++) addrs.push(`${pool}.${randomOctet()}`)
    }
    for (const addr of addrs) {
      for (const port of deep ? [443, 8443, 4443] : [443, 8443]) add(`${addr}:${port}`)
    }
    return [...out.values()]
  }

  const count = deep ? 28 : 12
  for (let i = 0; i < count; i++) {
    add(`${pick(WARP_POOLS)}.${randomOctet()}:${pick(WG_PORTS)}`)
  }
  if (deep) {
    for (let i = 0; i < 6; i++) {
      const host = `${pick(WARP_POOLS)}.${randomOctet()}`
      for (const port of shuffle(WG_EXTRA_PORTS).slice(0, 4)) add(`${host}:${port}`)
    }
  }
  return [...out.values()]
}

function splitLines(text: string): string[] {
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const item = line.trim()
    if (!item || item.startsWith('//') || item.startsWith(';')) continue
    if (item.includes(',')) {
      for (const part of item.split(',')) out.push(part.trim())
    } else {
      out.push(item)
    }
  }
  return out
}

function collectJson(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectJson(item, out)
    return
  }
  if (!value || typeof value !== 'object') return
  const obj = value as Record<string, unknown>
  if (typeof obj.endpoint === 'string') {
    out.push(obj.endpoint)
  } else {
    const host = [obj.ip, obj.host, obj.server, obj.address].find(
      (item): item is string => typeof item === 'string' && item.length > 0
    )
    if (host) {
      const port = obj.port ?? obj.portNumber
      out.push(port === undefined ? host : `${host}:${String(port)}`)
    }
  }
  for (const key of ['nodes', 'data', 'proxies', 'list', 'items']) {
    if (key in obj) collectJson(obj[key], out)
  }
}

function tryBase64(text: string): string | null {
  if (!/^[A-Za-z0-9+/=\s]+$/.test(text) || text.length < 16) return null
  try {
    const decoded = Buffer.from(text.replace(/\s+/g, ''), 'base64').toString('utf8')
    if (!decoded.includes(':') || /[\u0000-\u0008\u000e-\u001f]/.test(decoded)) return null
    return decoded
  } catch {
    return null
  }
}

export interface SubscriptionEntry {
  endpoint: string
  tag: string
}

export function parseSubscription(text: string, settings: Settings): SubscriptionEntry[] {
  const body = text.trim()
  if (!body) return []

  const entries: string[] = []
  try {
    const parsed: unknown = JSON.parse(body)
    collectJson(parsed, entries)
  } catch {
    const decoded = tryBase64(body)
    const source = decoded ?? body
    entries.push(...splitLines(source))
  }

  return entries
    .map((entry) => normalizeSubscriptionEntry(entry, settings))
    .filter((entry): entry is SubscriptionEntry => entry !== null)
    .slice(0, 500)
}

export function normalizeSubscriptionEntry(
  raw: string,
  settings: Settings
): { endpoint: string; tag: string } | null {
  let value = raw.trim().replace(/^["']|["']$/g, '')
  if (!value) return null
  let tag = ''
  const hash = value.indexOf('#')
  if (hash >= 0) {
    tag = value.slice(hash + 1).trim()
    value = value.slice(0, hash).trim()
  }
  value = value.replace(/\s+/g, '')
  if (!value || value.includes('/')) return null
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  if (!value) return null
  try {
    return { endpoint: normalizeEndpoint(value, settings.proto), tag }
  } catch {
    return null
  }
}

export function subscriptionUrls(settings: Settings): string[] {
  return settings.subscriptionUrls
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter((item) => /^https?:\/\//i.test(item))
    .slice(0, 8)
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url.slice(0, 40)
  }
}

export interface CollectOptions {
  onLog: (level: 'info' | 'warn' | 'error', text: string) => void
  isCancelled: () => boolean
}

export interface CollectedCandidates {
  candidates: Candidate[]
  summary: SourceSummary
}

export async function collectCandidates(
  settings: Settings,
  deep: boolean,
  opts: CollectOptions
): Promise<CollectedCandidates> {
  const map = new Map<string, Candidate>()

  const add = (endpoint: string, source: NodeSource, tag?: string): void => {
    const key = endpoint.trim().toLowerCase()
    if (!key || map.has(key)) return
    map.set(key, { endpoint: endpoint.trim(), source, ...(tag ? { tag } : {}) })
  }

  for (const item of builtinCandidates(settings, deep)) add(item.endpoint, item.source)
  for (const item of randomCandidates(settings, deep)) add(item.endpoint, item.source)

  const urls = subscriptionUrls(settings)
  let subscriptionErrors = 0
  if (urls.length > 0) {
    opts.onLog('info', `订阅源：${urls.length} 个，正在拉取…`)
    const fetched = await Promise.all(
      urls.map(async (url) => {
        try {
          const text = await fetchText(url, 10000, {
            'User-Agent': 'XEHN-Desktop',
            Accept: 'text/plain, application/json, */*'
          })
          return { url, text }
        } catch (err) {
          return { url, error: (err as Error).message }
        }
      })
    )
    for (const result of fetched) {
      if (opts.isCancelled()) break
      if ('error' in result) {
        subscriptionErrors++
        opts.onLog('warn', `订阅源获取失败 ${hostOf(result.url)}：${result.error}`)
        continue
      }
      const entries = parseSubscription(result.text, settings)
      let added = 0
      for (const entry of entries) {
        const before = map.size
        add(entry.endpoint, 'subscription', entry.tag)
        if (map.size > before) added++
      }
      opts.onLog('info', `订阅源 ${hostOf(result.url)}：解析 ${entries.length} 条，新增 ${added} 个节点`)
    }
  }

  const candidates = [...map.values()]
  const summary: SourceSummary = {
    builtin: candidates.filter((item) => item.source === 'builtin').length,
    subscription: candidates.filter((item) => item.source === 'subscription').length,
    random: candidates.filter((item) => item.source === 'random').length,
    total: candidates.length,
    subscriptionErrors
  }
  return { candidates, summary }
}
