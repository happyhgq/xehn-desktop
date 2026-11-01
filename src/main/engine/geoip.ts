import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { gunzip } from 'node:zlib'
import { open, type AsnResponse, type CityResponse, type Reader, type Response } from 'maxmind'
import type { GeoIpStatus, NodeGeo } from '../../shared/types'
import { ensureDir } from './util'

const gunzipAsync = promisify(gunzip)

export const GEOIP_DIR = 'geoip'

const CITY_FILES = ['GeoLite2-City.mmdb', 'dbip-city-lite.mmdb']
const COUNTRY_FILES = ['GeoLite2-Country.mmdb', 'dbip-country-lite.mmdb']
const ASN_FILES = ['GeoLite2-ASN.mmdb', 'dbip-asn-lite.mmdb']

function nameOf(value: { names?: unknown } | undefined): string {
  const names = value?.names
  if (!names || typeof names !== 'object') return ''
  const record = names as Record<string, unknown>
  for (const key of ['zh-CN', 'en']) {
    const text = record[key]
    if (typeof text === 'string' && text) return text
  }
  for (const text of Object.values(record)) {
    if (typeof text === 'string' && text) return text
  }
  return ''
}

function isDbIp(path: string): boolean {
  return /(^|[\\/])dbip-/i.test(path)
}

async function firstExisting(dir: string, files: string[]): Promise<string> {
  for (const name of files) {
    const path = join(dir, name)
    try {
      const stat = await fs.stat(path)
      if (stat.isFile() && stat.size > 0) return path
    } catch {
      // try next
    }
  }
  return ''
}

function locate(ip: string): string {
  return ip.replace(/^\[|\]$/g, '')
}

function safeGet<T extends Response>(reader: Reader<T>, ip: string): T | null {
  try {
    return reader.get(locate(ip))
  } catch {
    return null
  }
}

export class GeoIp {
  private city: Reader<CityResponse> | null = null
  private country: Reader<CityResponse> | null = null
  private asn: Reader<AsnResponse> | null = null
  private status: GeoIpStatus = {
    available: false,
    cityPath: '',
    countryPath: '',
    asnPath: '',
    note: '未加载'
  }

  async load(home: string): Promise<GeoIpStatus> {
    const dir = join(home, GEOIP_DIR)
    const cityPath = await firstExisting(dir, CITY_FILES)
    const countryPath = await firstExisting(dir, COUNTRY_FILES)
    const asnPath = await firstExisting(dir, ASN_FILES)

    this.city = await this.open<CityResponse>(cityPath)
    this.country = this.city ? null : await this.open<CityResponse>(countryPath)
    this.asn = await this.open<AsnResponse>(asnPath)

    const hasGeo = Boolean(this.city || this.country)
    const parts: string[] = []
    if (this.city) parts.push('城市库')
    else if (this.country) parts.push('国家库')
    if (this.asn) parts.push('ASN 库')
    const attribution = [cityPath, countryPath, asnPath].some(isDbIp)
      ? ' · 数据来源 DB-IP (CC BY 4.0)'
      : ''

    let note: string
    if (!hasGeo && !this.asn) {
      note = '未安装 GeoIP 数据库，可在设置中下载 DB-IP Lite 或手动放入 MMDB 文件'
    } else if (!hasGeo) {
      note = `仅 ASN 库已就绪${attribution}`
    } else if (!this.asn) {
      note = `${parts.join(' + ')}已就绪，缺少 ASN 库${attribution}`
    } else {
      note = `${parts.join(' + ')}已就绪${attribution}`
    }

    this.status = {
      available: hasGeo || Boolean(this.asn),
      cityPath: this.city ? cityPath : '',
      countryPath: this.country ? countryPath : '',
      asnPath: this.asn ? asnPath : '',
      note
    }
    return this.getStatus()
  }

  private async open<T extends Response>(path: string): Promise<Reader<T> | null> {
    if (!path) return null
    try {
      return await open<T>(path, { cache: { max: 5000 } })
    } catch {
      return null
    }
  }

  getStatus(): GeoIpStatus {
    return { ...this.status }
  }

  lookup(ip: string): NodeGeo | null {
    if (!this.city && !this.country && !this.asn) return null

    let country = ''
    let countryName = ''
    let city = ''
    const geoReader = this.city ?? this.country
    if (geoReader) {
      const record = safeGet(geoReader, ip)
      const info = record?.country ?? record?.registered_country
      country = info?.iso_code ?? ''
      countryName = nameOf(info)
      city = nameOf(record?.city)
    }

    let asn = 0
    let asOrg = ''
    if (this.asn) {
      const record = safeGet(this.asn, ip)
      asn = record?.autonomous_system_number ?? 0
      asOrg = record?.autonomous_system_organization ?? ''
    }

    if (!country && !asn) return null
    return { country: country.toUpperCase(), countryName, city, asn, asOrg }
  }
}

export async function ensureGeoipDir(home: string): Promise<string> {
  const dir = join(home, GEOIP_DIR)
  await ensureDir(dir)
  return dir
}

function monthCandidates(): string[] {
  const now = new Date()
  const list: string[] = []
  for (const offset of [0, 1]) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1)
    list.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`)
  }
  return list
}

async function downloadOne(
  home: string,
  base: string,
  target: string,
  onLog: (level: 'info' | 'warn', text: string) => void
): Promise<void> {
  const dir = await ensureGeoipDir(home)
  let lastError: Error | null = null
  for (const month of monthCandidates()) {
    const url = `https://download.db-ip.com/free/${base}-${month}.mmdb.gz`
    try {
      onLog('info', `下载 ${url}`)
      const res = await fetch(url, { signal: AbortSignal.timeout(180_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const compressed = Buffer.from(await res.arrayBuffer())
      const raw = await gunzipAsync(compressed)
      const dest = join(dir, target)
      const tmp = `${dest}.tmp`
      await fs.writeFile(tmp, raw)
      await fs.rename(tmp, dest)
      onLog('info', `${target} 已保存（${(raw.length / 1024 / 1024).toFixed(1)} MB）`)
      return
    } catch (err) {
      lastError = err as Error
    }
  }
  throw new Error(`${base} 下载失败：${lastError?.message ?? '未知错误'}`)
}

export async function downloadGeoipDb(
  home: string,
  onLog: (level: 'info' | 'warn', text: string) => void
): Promise<void> {
  onLog('info', '开始下载 DB-IP Lite 数据库（城市 + ASN，约 66 MB）…')
  await downloadOne(home, 'dbip-city-lite', 'dbip-city-lite.mmdb', onLog)
  await downloadOne(home, 'dbip-asn-lite', 'dbip-asn-lite.mmdb', onLog)
  onLog('info', 'GeoIP 数据库下载完成，数据来源 DB-IP（CC BY 4.0）')
}
