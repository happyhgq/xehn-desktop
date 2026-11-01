import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { sleep } from './util'

export type LogSink = (level: 'debug' | 'info' | 'warn' | 'error', text: string) => void

export interface CoreStartOptions {
  binary: string
  home: string
  configPath: string
  apiPort: number
  onLog: LogSink
  onExit?: (code: number | null) => void
}

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g

export interface CoreConnection {
  id?: string
  upload?: number
  download?: number
  start?: string
  chains?: string[]
  rule?: string
  rulePayload?: string
  metadata?: {
    network?: string
    host?: string
    destinationIP?: string
    destinationPort?: string
    processPath?: string
    type?: string
  }
}

export class MihomoCore {
  private proc: ChildProcess | null = null
  private apiPort = 0
  private versionCache = ''
  private stderrTail: string[] = []

  get running(): boolean {
    return this.proc !== null && this.proc.exitCode === null
  }

  get port(): number {
    return this.apiPort
  }

  async start(opts: CoreStartOptions): Promise<void> {
    if (this.running) throw new Error('核心已在运行')
    this.apiPort = opts.apiPort
    this.stderrTail = []

    const args = ['-d', opts.home, '-f', opts.configPath]
    const proc = spawn(opts.binary, args, {
      cwd: opts.home,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.proc = proc

    const feed = (level: 'info' | 'warn', chunk: Buffer): void => {
      const text = chunk.toString('utf8').replace(ANSI, '')
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed) continue
        if (level === 'warn') {
          this.stderrTail.push(trimmed)
          if (this.stderrTail.length > 40) this.stderrTail.shift()
        }
        opts.onLog(level, trimmed)
      }
    }
    proc.stdout?.on('data', (b: Buffer) => feed('info', b))
    proc.stderr?.on('data', (b: Buffer) => feed('warn', b))

    proc.once('exit', (code) => {
      const wasRunning = this.proc === proc
      if (wasRunning) this.proc = null
      opts.onLog(code === 0 ? 'info' : 'warn', `mihomo 退出，code=${code ?? 'null'}`)
      if (wasRunning) opts.onExit?.(code)
    })

    try {
      await this.waitReady(15000)
    } catch (err) {
      await this.stop()
      const tail = this.stderrTail.slice(-6).join(' | ')
      throw new Error(`${(err as Error).message}${tail ? `（${tail}）` : ''}`)
    }
  }

  private async waitReady(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (!this.running) throw new Error('核心进程已退出')
      try {
        const res = await fetch(`http://127.0.0.1:${this.apiPort}/version`, {
          signal: AbortSignal.timeout(1200)
        })
        if (res.ok) {
          const body = (await res.json()) as { version?: string }
          this.versionCache = body.version ?? ''
          return
        }
      } catch {
        // not up yet
      }
      await sleep(150)
    }
    throw new Error('核心启动超时（controller 未响应）')
  }

  async version(): Promise<string> {
    if (this.versionCache) return this.versionCache
    try {
      const res = await fetch(`http://127.0.0.1:${this.apiPort}/version`, {
        signal: AbortSignal.timeout(2000)
      })
      if (res.ok) {
        const body = (await res.json()) as { version?: string }
        this.versionCache = body.version ?? ''
        return this.versionCache
      }
    } catch {
      // ignore
    }
    return ''
  }

  async api<T>(path: string, init: RequestInit = {}, timeoutMs = 8000): Promise<T> {
    const res = await fetch(`http://127.0.0.1:${this.apiPort}${path}`, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) }
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`core API ${path}: HTTP ${res.status} ${text.slice(0, 200)}`)
    if (!text) return undefined as T
    return JSON.parse(text) as T
  }

  async delay(proxyName: string, timeoutMs = 3000): Promise<number | null> {
    const url = `http://www.gstatic.com/generate_204`
    const path = `/proxies/${encodeURIComponent(proxyName)}/delay?url=${encodeURIComponent(url)}&timeout=${timeoutMs}`
    try {
      const body = await this.api<{ delay?: number }>(path, {}, timeoutMs + 5000)
      return typeof body.delay === 'number' && body.delay > 0 ? body.delay : null
    } catch {
      return null
    }
  }

  async activeConnections(): Promise<number> {
    try {
      const body = await this.api<{ connections?: unknown[] }>('/connections', {}, 3000)
      return body.connections?.length ?? 0
    } catch {
      return 0
    }
  }

  async connections(): Promise<CoreConnection[]> {
    try {
      const body = await this.api<{ connections?: CoreConnection[] }>('/connections', {}, 3000)
      return body.connections ?? []
    } catch {
      return []
    }
  }

  async stop(): Promise<void> {
    const proc = this.proc
    if (!proc) return
    this.proc = null
    this.versionCache = ''
    try {
      proc.kill()
    } catch {
      // already gone
    }
    if (process.platform === 'win32' && proc.pid) {
      await new Promise<void>((resolve) => {
        execFile('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true }, () =>
          resolve()
        )
        setTimeout(resolve, 2500)
      })
    }
    await sleep(200)
    if (proc.exitCode === null) {
      try {
        proc.kill('SIGKILL')
      } catch {
        // ignore
      }
    }
  }
}

export async function removeIfExists(path: string): Promise<void> {
  try {
    await fs.rm(path, { force: true, recursive: true })
  } catch {
    // ignore
  }
}

export function coreHome(home: string): string {
  return join(home, 'core')
}
