import { ProxyAgent, fetch as proxyFetch } from 'undici'

export interface ExitInfo {
  ip: string
  country: string
  colo: string
  city: string
  errors: string[]
}

const EMPTY: ExitInfo = { ip: '', country: '', colo: '', city: '', errors: [] }

interface SpeedMeta {
  clientIp?: string
  country?: string
  colo?: { iata?: string; city?: string; cca2?: string }
}

async function readBody(
  agent: ProxyAgent,
  url: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; text: string }> {
  const res = await proxyFetch(url, {
    dispatcher: agent,
    headers,
    signal: AbortSignal.timeout(5000)
  })
  const text = await res.text()
  return { status: res.status, text }
}

function parseTrace(text: string): Record<string, string> {
  const map: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const idx = line.indexOf('=')
    if (idx > 0) map[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  return map
}

interface Source {
  label: string
  run: (agent: ProxyAgent) => Promise<ExitInfo>
}

// Cloudflare's trace endpoint answers on a bare IP, so one source needs no
// resolution inside the tunnel. That matters right after connect: remote DNS
// through a cold WARP tunnel can exceed its own deadline for a few seconds.
const SOURCES: Source[] = [
  {
    label: 'speed.cloudflare.com',
    async run(agent) {
      const { status, text } = await readBody(agent, 'https://speed.cloudflare.com/meta', {
        Referer: 'https://speed.cloudflare.com/'
      })
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      const meta = JSON.parse(text) as SpeedMeta
      if (!meta.clientIp) throw new Error('missing clientIp')
      return {
        ip: meta.clientIp,
        country: meta.country ?? meta.colo?.cca2 ?? '',
        colo: meta.colo?.iata ?? '',
        city: meta.colo?.city ?? '',
        errors: []
      }
    }
  },
  {
    label: '1.1.1.1',
    async run(agent) {
      const { status, text } = await readBody(agent, 'https://1.1.1.1/cdn-cgi/trace')
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      const map = parseTrace(text)
      if (!map.ip) throw new Error('missing ip')
      return { ip: map.ip, country: map.loc ?? '', colo: map.colo ?? '', city: '', errors: [] }
    }
  },
  {
    label: 'api.ipify.org',
    async run(agent) {
      const { status, text } = await readBody(agent, 'https://api.ipify.org?format=json')
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      const body = JSON.parse(text) as { ip?: string }
      if (!body.ip) throw new Error('missing ip')
      return { ...EMPTY, ip: body.ip }
    }
  },
  {
    label: 'cloudflare.com',
    async run(agent) {
      const { status, text } = await readBody(agent, 'https://www.cloudflare.com/cdn-cgi/trace')
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
      const map = parseTrace(text)
      if (!map.ip) throw new Error('missing ip')
      return { ip: map.ip, country: map.loc ?? '', colo: map.colo ?? '', city: '', errors: [] }
    }
  }
]

// Sources run concurrently so one blocked host never serializes the probe; the
// first success wins by priority order.
export async function probeExit(mixedPort: number): Promise<ExitInfo> {
  const agent = new ProxyAgent(`http://127.0.0.1:${mixedPort}`)
  try {
    const results = await Promise.allSettled(SOURCES.map((source) => source.run(agent)))
    const errors: string[] = []
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        errors.push(`${SOURCES[i].label}: ${(result.reason as Error).message}`)
      }
    })
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.ip) {
        return { ...result.value, errors }
      }
    }
    return { ...EMPTY, errors }
  } finally {
    await agent.close().catch(() => undefined)
  }
}
