import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { CoreInfo } from '../../shared/types'
import { ensureDir, nowISO, readJSON, writeJSON } from './util'

const RELEASE_API = 'https://api.github.com/repos/MetaCubeX/mihomo/releases/latest'
const UA = 'xehn-desktop'

interface VersionFile {
  version: string
  downloadedAt: string
  source: string
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

function readVersion(binary: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(binary, ['-v'], { windowsHide: true, timeout: 5000 }, (err, stdout, stderr) => {
      if (err) return resolve('')
      const text = `${stdout}\n${stderr}`
      const m = text.match(/v?\d+\.\d+\.\d+/)
      resolve(m ? m[0] : '')
    })
  })
}

export async function resolveCore(home: string, candidates: string[]): Promise<CoreInfo> {
  const local = join(home, 'core', process.platform === 'win32' ? 'mihomo.exe' : 'mihomo')
  const paths = [local, ...candidates, ...(process.env.MIHOMO_PATH ? [process.env.MIHOMO_PATH] : [])]
  for (const path of paths) {
    if (path && (await exists(path))) {
      const cached = await readJSON<VersionFile | null>(join(home, 'core', 'version.json'), null)
      const version = (cached && cached.version) || (await readVersion(path))
      return { available: true, path, version }
    }
  }
  return { available: false, path: '', version: '' }
}

interface GithubAsset {
  name: string
  browser_download_url: string
  size: number
}

export async function latestRelease(): Promise<{ version: string; url: string }> {
  const res = await fetch(RELEASE_API, {
    headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(20000)
  })
  if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}`)
  const body = (await res.json()) as { tag_name?: string; assets?: GithubAsset[] }
  const assets = body.assets ?? []
  const pick =
    assets.find((a) => /windows-amd64-compatible.*\.zip$/i.test(a.name)) ??
    assets.find((a) => /windows-amd64-v\d.*\.zip$/i.test(a.name)) ??
    assets.find((a) => /windows-amd64.*\.zip$/i.test(a.name))
  if (!pick) throw new Error('未找到 Windows amd64 核心包')
  return { version: body.tag_name ?? '', url: pick.browser_download_url }
}

export async function downloadCore(
  home: string,
  onLog: (text: string) => void
): Promise<CoreInfo> {
  const { version, url } = await latestRelease()
  onLog(`开始下载 mihomo ${version || ''}`)
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(300000)
  })
  if (!res.ok) throw new Error(`下载核心失败：HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 3 * 1024 * 1024) throw new Error('核心文件过小，下载可能失败')

  const coreDir = join(home, 'core')
  await ensureDir(coreDir)
  const zipPath = join(coreDir, 'mihomo.zip')
  const extractDir = join(coreDir, '_unzip')
  await fs.writeFile(zipPath, buf)
  await fs.rm(extractDir, { recursive: true, force: true })
  await ensureDir(extractDir)

  await new Promise<void>((resolve, reject) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${extractDir}' -Force`
      ],
      { windowsHide: true, timeout: 120000 },
      (err) => (err ? reject(new Error(`解压核心失败：${err.message}`)) : resolve())
    )
  })

  const entries = await fs.readdir(extractDir, { recursive: true, withFileTypes: true })
  const exe = entries.find((e) => e.isFile() && e.name.toLowerCase() === 'mihomo.exe')
  if (!exe) throw new Error('核心包中没有 mihomo.exe')
  const source = join(exe.parentPath, exe.name)
  const target = join(coreDir, 'mihomo.exe')
  await fs.copyFile(source, target)
  await fs.rm(zipPath, { force: true })
  await fs.rm(extractDir, { recursive: true, force: true })

  const info: VersionFile = { version, downloadedAt: nowISO(), source: url }
  await writeJSON(join(coreDir, 'version.json'), info)
  onLog(`核心已更新到 ${version}`)
  return { available: true, path: target, version }
}
