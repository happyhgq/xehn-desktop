import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { ensureDir, readJSON, writeJSON } from './util'

export interface ProxySnapshot {
  enable: number
  server: string
  override: string
}

const PS_KEY = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'

const PS_SCRIPT = [
  'param(',
  '  [Parameter(Mandatory=$true)][string]$Action,',
  "  [string]$Server = '',",
  "  [string]$Override = '',",
  '  [int]$Enable = 1',
  ')',
  "$ErrorActionPreference = 'Stop'",
  '$key = ' + "'" + PS_KEY + "'",
  "Add-Type -Namespace Xehn -Name WinInet -MemberDefinition '[DllImport(\"wininet.dll\", SetLastError=true)] public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);'",
  "if ($Action -eq 'set') {",
  '  Set-ItemProperty -Path $key -Name ProxyServer -Value $Server',
  '  Set-ItemProperty -Path $key -Name ProxyEnable -Value 1',
  '  if ($Override -ne "") { Set-ItemProperty -Path $key -Name ProxyOverride -Value $Override }',
  '} else {',
  '  Set-ItemProperty -Path $key -Name ProxyEnable -Value $Enable',
  '  if ($Server -ne "") { Set-ItemProperty -Path $key -Name ProxyServer -Value $Server }',
  '  else { Remove-ItemProperty -Path $key -Name ProxyServer -ErrorAction SilentlyContinue }',
  '  if ($Override -ne "") { Set-ItemProperty -Path $key -Name ProxyOverride -Value $Override }',
  '}',
  '[void][Xehn.WinInet]::InternetSetOption([IntPtr]::Zero,39,[IntPtr]::Zero,0)',
  '[void][Xehn.WinInet]::InternetSetOption([IntPtr]::Zero,37,[IntPtr]::Zero,0)'
].join('\r\n')

const PS_READ =
  `$k='${PS_KEY}'; ` +
  '$p=Get-ItemProperty -Path $k -ErrorAction SilentlyContinue; ' +
  '$o=[pscustomobject]@{enable=[int]($p.ProxyEnable); server=[string]($p.ProxyServer); override=[string]($p.ProxyOverride)}; ' +
  '$o | ConvertTo-Json -Compress'

function runPowerShell(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args],
      { windowsHide: true, timeout: 30000 },
      (err, stdout, stderr) => {
        if (err) reject(new Error((stderr || err.message).trim()))
        else resolve(stdout)
      }
    )
  })
}

const supported = (): boolean => process.platform === 'win32'

export async function readProxy(): Promise<ProxySnapshot> {
  if (!supported()) return { enable: 0, server: '', override: '' }
  try {
    const out = await runPowerShell(['-Command', PS_READ])
    const parsed = JSON.parse(out.trim()) as Partial<ProxySnapshot>
    return {
      enable: Number(parsed.enable ?? 0),
      server: String(parsed.server ?? ''),
      override: String(parsed.override ?? '')
    }
  } catch {
    return { enable: 0, server: '', override: '' }
  }
}

function backupPath(home: string): string {
  return join(home, 'proxy-backup.json')
}

export async function setSystemProxy(home: string, port: number): Promise<void> {
  if (!supported()) return
  const existing = await readJSON<ProxySnapshot | null>(backupPath(home), null)
  if (!existing) {
    await writeJSON(backupPath(home), await readProxy())
  }
  const scriptPath = join(home, 'setproxy.ps1')
  await ensureDir(dirname(scriptPath))
  await fs.writeFile(scriptPath, PS_SCRIPT, 'utf8')
  await runPowerShell([
    '-File',
    scriptPath,
    '-Action',
    'set',
    '-Server',
    `127.0.0.1:${port}`,
    '-Override',
    '<local>'
  ])
}

export async function restoreSystemProxy(home: string): Promise<void> {
  if (!supported()) return
  const backup = await readJSON<ProxySnapshot | null>(backupPath(home), null)
  if (!backup) return
  const scriptPath = join(home, 'setproxy.ps1')
  await ensureDir(dirname(scriptPath))
  await fs.writeFile(scriptPath, PS_SCRIPT, 'utf8')
  await runPowerShell([
    '-File',
    scriptPath,
    '-Action',
    'restore',
    '-Enable',
    String(backup.enable ? 1 : 0),
    '-Server',
    backup.server,
    '-Override',
    backup.override
  ])
  await fs.rm(backupPath(home), { force: true })
}

export async function proxyIsOurs(port: number): Promise<boolean> {
  if (!supported()) return false
  const snap = await readProxy()
  return snap.enable === 1 && snap.server.includes(`127.0.0.1:${port}`)
}

export async function hasBackup(home: string): Promise<boolean> {
  const backup = await readJSON<ProxySnapshot | null>(backupPath(home), null)
  return Boolean(backup)
}
