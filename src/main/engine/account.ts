import crypto from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AccountInfo } from '../../shared/types'
import { ensureDir, fetchJSON, nowISO, readJSON, writeJSON } from './util'

const REG_URL = 'https://api.cloudflareclient.com/v0a4005/reg'
const REG_UA = 'okhttp/3.12.1'
const REG_VERSION = 'a-6.11-2223'

const MASQUE_REG_URL = 'https://api.cloudflareclient.com/v0a4471/reg'
const MASQUE_UA = 'WARP for Android'
const MASQUE_VERSION = 'a-6.35-4471'

export interface MasqueAccount {
  id: string
  token: string
  privateKey: string
  peerPublicKey: string
  ipv4: string
  ipv6: string
}

export interface WarpAccount {
  id: string
  token: string
  privateKey: string
  peerPublicKey: string
  ipv4: string
  ipv6: string
  masque?: MasqueAccount
  updatedAt: string
}

interface RegResponse {
  id: string
  token: string
  config: {
    peers?: { public_key?: string }[]
    interface?: { addresses?: { v4?: string; v6?: string } }
  }
}

function generateX25519(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519')
  const pkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' })
  const spki = publicKey.export({ format: 'der', type: 'spki' })
  return {
    privateKey: Buffer.from(pkcs8.subarray(pkcs8.length - 32)).toString('base64'),
    publicKey: Buffer.from(spki.subarray(spki.length - 32)).toString('base64')
  }
}

function generateEC(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  return {
    // mihomo parses the masque private key with x509.ParseECPrivateKey, i.e.
    // SEC1, not the PKCS#8 envelope Node exports by default.
    privateKey: privateKey.export({ format: 'der', type: 'sec1' }).toString('base64'),
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
  }
}

function pemBody(key: string): string {
  const m = key.match(/-----BEGIN PUBLIC KEY-----([\s\S]*?)-----END PUBLIC KEY-----/)
  const body = m ? m[1] : key
  return body.replace(/\s+/g, '')
}

function parseRegistration(body: unknown, privateKey: string): WarpAccount {
  const r = body as RegResponse
  const peer = r?.config?.peers?.[0]?.public_key
  if (!r?.id || !peer) throw new Error('注册响应缺少设备信息')
  return {
    id: r.id,
    token: r.token ?? '',
    privateKey,
    peerPublicKey: peer,
    ipv4: r.config.interface?.addresses?.v4 ?? '',
    ipv6: r.config.interface?.addresses?.v6 ?? '',
    updatedAt: nowISO()
  }
}

function regHeaders(ua: string, version: string, token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': ua,
    'CF-Client-Version': version
  }
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

export async function registerWireGuard(): Promise<WarpAccount> {
  const keys = generateX25519()
  const body = await fetchJSON(REG_URL, {
    method: 'POST',
    headers: regHeaders(REG_UA, REG_VERSION),
    body: { key: keys.publicKey },
    timeoutMs: 20000
  })
  const account = parseRegistration(body, keys.privateKey)
  await fetchJSON(`${REG_URL}/${account.id}`, {
    method: 'PATCH',
    headers: regHeaders(REG_UA, REG_VERSION, account.token),
    body: { warp_enabled: true },
    timeoutMs: 20000
  })
  return account
}

export async function rotateWireGuard(existing: WarpAccount): Promise<WarpAccount> {
  if (!existing.id || !existing.token) return registerWireGuard()
  const keys = generateX25519()
  const body = await fetchJSON(`${REG_URL}/${existing.id}`, {
    method: 'PATCH',
    headers: regHeaders(REG_UA, REG_VERSION, existing.token),
    body: { key: keys.publicKey },
    timeoutMs: 20000
  })
  const rotated = parseRegistration(body, keys.privateKey)
  rotated.id = existing.id
  rotated.token = existing.token
  return rotated
}

export async function registerMasque(): Promise<MasqueAccount> {
  const placeholder = crypto.randomBytes(32).toString('base64')
  const serial = crypto.randomBytes(8).toString('base64')
  const firstBody = await fetchJSON(MASQUE_REG_URL, {
    method: 'POST',
    headers: regHeaders(MASQUE_UA, MASQUE_VERSION),
    body: {
      key: placeholder,
      install_id: '',
      fcm_token: '',
      tos: new Date().toISOString().replace('Z', 'Z'),
      model: 'PC',
      serial_number: serial,
      os_version: '10',
      key_type: 'curve25519',
      tunnel_type: 'wireguard',
      locale: 'en_US'
    },
    timeoutMs: 20000
  })
  const first = firstBody as RegResponse
  if (!first?.id || !first?.token) throw new Error('MASQUE 注册响应缺少 id/token')
  const keys = generateEC()
  const enrolledBody = await fetchJSON(`${MASQUE_REG_URL}/${first.id}`, {
    method: 'PATCH',
    headers: regHeaders(MASQUE_UA, MASQUE_VERSION, first.token),
    body: {
      key: keys.publicKey,
      key_type: 'secp256r1',
      tunnel_type: 'masque',
      name: 'xehn-desktop'
    },
    timeoutMs: 20000
  })
  const enrolled = enrolledBody as RegResponse
  const peer = enrolled?.config?.peers?.[0]?.public_key
  if (!peer) throw new Error('MASQUE 注册响应缺少公钥')
  return {
    id: first.id,
    token: first.token,
    privateKey: keys.privateKey,
    peerPublicKey: pemBody(peer),
    ipv4: enrolled.config.interface?.addresses?.v4 ?? '',
    ipv6: enrolled.config.interface?.addresses?.v6 ?? ''
  }
}

export class AccountStore {
  private readonly file: string
  private account: WarpAccount | null = null

  constructor(home: string) {
    this.file = join(home, 'warp-account.json')
  }

  async load(): Promise<WarpAccount | null> {
    this.account = await readJSON<WarpAccount | null>(this.file, null)
    if (this.account && (!this.account.privateKey || !this.account.peerPublicKey)) {
      this.account = null
    }
    return this.account
  }

  get(): WarpAccount | null {
    return this.account
  }

  async save(account: WarpAccount): Promise<void> {
    this.account = account
    await ensureDir(dirname(this.file))
    await writeJSON(this.file, account)
  }

  async register(opts: { fresh?: boolean } = {}): Promise<WarpAccount> {
    if (this.account && !opts.fresh) {
      try {
        const rotated = await rotateWireGuard(this.account)
        rotated.masque = this.account.masque
        await this.save(rotated)
        return rotated
      } catch {
        const fresh = await registerWireGuard()
        fresh.masque = this.account.masque
        await this.save(fresh)
        return fresh
      }
    }
    const account = await registerWireGuard()
    await this.save(account)
    return account
  }

  async ensureMasque(): Promise<MasqueAccount> {
    if (!this.account) await this.register()
    if (this.account?.masque) return this.account.masque
    const masque = await registerMasque()
    this.account!.masque = masque
    await this.save(this.account!)
    return masque
  }

  async reset(): Promise<WarpAccount> {
    const account = await registerWireGuard()
    await this.save(account)
    return account
  }

  async clear(): Promise<void> {
    this.account = null
    await fs.rm(this.file, { force: true })
  }

  info(): AccountInfo | null {
    if (!this.account) return null
    return {
      id: this.account.id,
      ipv4: this.account.ipv4,
      ipv6: this.account.ipv6,
      hasMasque: Boolean(this.account.masque),
      updatedAt: this.account.updatedAt
    }
  }
}
