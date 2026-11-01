export function fmtBps(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return '0 B/s'
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let value = bps
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}

export function fmtDuration(ms: number): string {
  if (!ms || ms < 0) return '00:00:00'
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':')
}

export function fmtLatency(ms: number): string {
  if (!ms || ms <= 0) return '—'
  return `${ms} ms`
}

export function flagOf(iso: string): string {
  if (!iso || iso.length !== 2) return '🌐'
  const upper = iso.toUpperCase()
  if (!/^[A-Z]{2}$/.test(upper)) return '🌐'
  const base = 0x1f1e6
  return String.fromCodePoint(base + upper.charCodeAt(0) - 65, base + upper.charCodeAt(1) - 65)
}

export function fmtClock(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('zh-CN', { hour12: false })
}

export function fmtDateTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString('zh-CN', { hour12: false })}`
}

export function fmtAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}

export const PROTO_LABEL: Record<string, string> = {
  awg: 'AmneziaWG',
  wg: 'WireGuard',
  masque: 'MASQUE',
  'masque-h2': 'MASQUE H2'
}

export const STATE_LABEL: Record<string, string> = {
  disconnected: '未连接',
  connecting: '连接中',
  connected: '已连接',
  disconnecting: '断开中',
  error: '异常'
}
