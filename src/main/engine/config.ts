import yaml from 'js-yaml'
import type { Settings } from '../../shared/types'
import type { WarpAccount } from './account'

export const NODE_NAME = 'WARP Node'
export const GROUP_NAME = 'WARP'
export const SCAN_GROUP = 'SCAN'
export const MASQUE_SNI = 'consumer-masque.cloudflareclient.com'

const TUNNEL_MTU = 1280
const KEEPALIVE = 25

const AWG_DEFAULTS = {
  jc: 6,
  jmin: 10,
  jmax: 50,
  s1: 0,
  s2: 0,
  h1: 1,
  h2: 2,
  h3: 3,
  h4: 4,
  i1: '<r 2><b 0x858000010001000000000669636c6f756403636f6d0000010001c00c000100010000105a00044d583737>'
}

const PRIVATE_RULES = [
  'IP-CIDR,10.0.0.0/8,DIRECT,no-resolve',
  'IP-CIDR,172.16.0.0/12,DIRECT,no-resolve',
  'IP-CIDR,192.168.0.0/16,DIRECT,no-resolve',
  'IP-CIDR,100.64.0.0/10,DIRECT,no-resolve',
  'IP-CIDR,127.0.0.0/8,DIRECT,no-resolve',
  'IP-CIDR6,fc00::/7,DIRECT,no-resolve',
  'IP-CIDR6,fe80::/10,DIRECT,no-resolve',
  'DOMAIN-SUFFIX,local,DIRECT',
  'DOMAIN-SUFFIX,lan,DIRECT',
  'DOMAIN-SUFFIX,home.arpa,DIRECT'
]

export function defaultPort(proto: Settings['proto']): number {
  return proto === 'masque' || proto === 'masque-h2' ? 443 : 2408
}

export interface EndpointParts {
  host: string
  port: number
}

export function parseEndpoint(value: string, proto: Settings['proto']): EndpointParts {
  const raw = value.trim()
  if (!raw) throw new Error('缺少节点地址')
  const bracket = raw.match(/^\[([^\]]+)\]:(\d+)$/)
  if (bracket) return { host: bracket[1], port: Number(bracket[2]) }
  const m = raw.match(/^([^:]+):(\d+)$/)
  if (m) return { host: m[1], port: Number(m[2]) }
  return { host: raw, port: defaultPort(proto) }
}

export function normalizeEndpoint(value: string, proto: Settings['proto']): string {
  const { host, port } = parseEndpoint(value, proto)
  return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`
}

export function dnsList(settings: Settings): string[] {
  return settings.dns
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function baseAddress(settings: Settings, account: WarpAccount, masque: boolean): Record<string, string> {
  if (masque) {
    const v4 = account.masque?.ipv4 ?? ''
    const v6 = account.masque?.ipv6 ?? ''
    if (settings.ipv6 && v6) return { ip: v4, ipv6: v6 }
    return { ip: v4 }
  }
  if (settings.ipv6 && account.ipv6) return { ip: account.ipv4, ipv6: account.ipv6 }
  return { ip: account.ipv4 || '172.16.0.2' }
}

export function warpProxy(
  settings: Settings,
  account: WarpAccount,
  endpoint: string,
  name = NODE_NAME
): Record<string, unknown> {
  const { host, port } = parseEndpoint(endpoint, settings.proto)
  const isMasque = settings.proto === 'masque' || settings.proto === 'masque-h2'

  if (isMasque) {
    const m = account.masque
    if (!m) throw new Error('账号缺少 MASQUE 设备，请先重新注册账号')
    return {
      name,
      type: 'masque',
      server: host,
      port,
      ...(settings.proto === 'masque-h2' ? { network: 'h2' } : {}),
      sni: MASQUE_SNI,
      'private-key': m.privateKey,
      'public-key': m.peerPublicKey,
      ...baseAddress(settings, account, true),
      'congestion-controller': 'bbr',
      'ip-stack': { mode: 'gvisor' },
      'handshake-timeout': 5
    }
  }

  const dns = dnsList(settings)
  const allowed = settings.ipv6 ? ['0.0.0.0/0', '::/0'] : ['0.0.0.0/0']
  const proxy: Record<string, unknown> = {
    name,
    type: 'wireguard',
    'private-key': account.privateKey,
    ...baseAddress(settings, account, false),
    mtu: TUNNEL_MTU,
    udp: true,
    'remote-dns-resolve': true,
    ...(dns.length ? { dns } : {}),
    peers: [
      {
        server: host,
        port,
        'public-key': account.peerPublicKey,
        'allowed-ips': allowed,
        'persistent-keepalive': KEEPALIVE
      }
    ]
  }
  if (settings.proto === 'awg') {
    proxy['amnezia-wg-option'] = { ...AWG_DEFAULTS }
  }
  return proxy
}

function routingRules(mode: Settings['mode'], group: string): string[] {
  if (mode === 'direct') return []
  if (mode === 'global') {
    return ['AND,(AND,(DST-PORT,443),(NETWORK,UDP)),REJECT', ...PRIVATE_RULES]
  }
  return [...PRIVATE_RULES, `MATCH,${group}`]
}

export interface RenderOptions {
  settings: Settings
  account: WarpAccount
  endpoint: string
  mixedPort: number
  apiPort: number
}

export function renderConfig(opts: RenderOptions): string {
  const { settings, account, endpoint, mixedPort, apiPort } = opts
  const dns = dnsList(settings)
  const tun = settings.tun

  const config: Record<string, unknown> = {
    'mixed-port': mixedPort,
    'allow-lan': settings.allowLan,
    ...(settings.allowLan ? { 'bind-address': '*' } : {}),
    mode: settings.mode === 'direct' ? 'direct' : 'rule',
    'log-level': 'info',
    ipv6: settings.ipv6,
    'external-controller': `127.0.0.1:${apiPort}`,
    'unified-delay': true,
    'tcp-concurrent': true,
    ...(dns.length
      ? {
          dns: {
            enable: true,
            ipv6: settings.ipv6,
            'respect-rules': true,
            'proxy-server-nameserver': dns,
            nameserver: dns,
            ...(tun ? { listen: '127.0.0.1:1053' } : {})
          }
        }
      : {}),
    ...(tun
      ? {
          tun: {
            enable: true,
            stack: 'gvisor',
            'auto-route': true,
            'auto-detect-interface': true,
            ...(dns.length ? { 'dns-hijack': ['any:53'] } : {})
          }
        }
      : {}),
    proxies: [warpProxy(settings, account, endpoint)],
    'proxy-groups': [
      {
        name: GROUP_NAME,
        type: 'select',
        proxies: [NODE_NAME, 'DIRECT']
      },
      {
        name: 'AUTO',
        type: 'url-test',
        url: 'http://www.gstatic.com/generate_204',
        interval: 300,
        tolerance: 50,
        proxies: [NODE_NAME]
      }
    ],
    rules: routingRules(settings.mode, GROUP_NAME)
  }

  return yaml.dump(config, { lineWidth: 200, noRefs: true })
}

export function renderScanConfig(opts: {
  settings: Settings
  account: WarpAccount
  endpoints: string[]
  mixedPort: number
  apiPort: number
}): string {
  const { settings, account, endpoints, mixedPort, apiPort } = opts
  const proxies = endpoints.map((endpoint, i) => warpProxy(settings, account, endpoint, `n${i}`))
  const config: Record<string, unknown> = {
    'mixed-port': mixedPort,
    'allow-lan': false,
    mode: 'rule',
    'log-level': 'warning',
    ipv6: settings.ipv6,
    'external-controller': `127.0.0.1:${apiPort}`,
    'unified-delay': true,
    proxies,
    'proxy-groups': [
      {
        name: SCAN_GROUP,
        type: 'select',
        proxies: endpoints.map((_, i) => `n${i}`)
      }
    ],
    rules: ['MATCH,DIRECT']
  }
  return yaml.dump(config, { lineWidth: 200, noRefs: true })
}
