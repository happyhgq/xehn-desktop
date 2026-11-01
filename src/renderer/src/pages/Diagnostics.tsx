import { useEffect, useRef, useState, type JSX } from 'react'
import type { AppContext } from '../context'
import { Icon } from '../components/Icon'
import { fmtBps } from '../format'
import type {
  ConnectionInfo,
  QualityProgress,
  QualityResult,
  SpeedTestProgress,
  SpeedTestResult
} from '../../../shared/types'

interface ConnRow extends ConnectionInfo {
  downRate: number
  upRate: number
}

function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

function procName(path: string): string {
  if (!path) return '—'
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

function cleanError(err: unknown): string {
  let text = err instanceof Error ? err.message : String(err)
  text = text.replace(/^Error invoking remote method '[^']+':\s*/i, '')
  text = text.replace(/^Error:\s*/i, '')
  return text
}

export default function Diagnostics({ app }: { app: AppContext }): JSX.Element {
  const { status, toast } = app
  const connected = status.state === 'connected'

  const [conns, setConns] = useState<ConnRow[]>([])
  const prevRef = useRef<{ at: number; map: Map<string, ConnectionInfo> }>({
    at: 0,
    map: new Map()
  })

  const [speedRunning, setSpeedRunning] = useState(false)
  const [speedProgress, setSpeedProgress] = useState<SpeedTestProgress | null>(null)
  const [speedResult, setSpeedResult] = useState<SpeedTestResult | null>(null)
  const [speedLive, setSpeedLive] = useState({ down: 0, up: 0 })

  const [qualityRunning, setQualityRunning] = useState(false)
  const [qualityProgress, setQualityProgress] = useState<QualityProgress | null>(null)
  const [qualityResult, setQualityResult] = useState<QualityResult | null>(null)

  const [exporting, setExporting] = useState(false)
  const [lastExport, setLastExport] = useState('')

  useEffect(() => {
    if (!connected) {
      setConns([])
      prevRef.current = { at: 0, map: new Map() }
      return
    }
    let alive = true
    let timer = 0

    const tick = async (): Promise<void> => {
      try {
        const list = await window.api.getConnections()
        if (!alive) return
        const now = Date.now()
        const prev = prevRef.current
        const dt = prev.at ? Math.max(0.2, (now - prev.at) / 1000) : 0
        setConns(
          list.map((c) => {
            const old = prev.map.get(c.id)
            return {
              ...c,
              downRate: old && dt ? Math.max(0, (c.download - old.download) / dt) : 0,
              upRate: old && dt ? Math.max(0, (c.upload - old.upload) / dt) : 0
            }
          })
        )
        prevRef.current = { at: now, map: new Map(list.map((c) => [c.id, c])) }
      } catch {
        // core may be shutting down; retry on the next tick
      }
      if (alive) timer = window.setTimeout(() => void tick(), 2000)
    }

    void tick()
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [connected])

  useEffect(() => {
    const offSpeed = window.api.onSpeedProgress((progress) => {
      setSpeedProgress(progress)
      setSpeedLive((prev) =>
        progress.phase === 'down'
          ? { ...prev, down: progress.mbps }
          : { ...prev, up: progress.mbps }
      )
    })
    const offQuality = window.api.onQualityProgress((progress) => setQualityProgress(progress))
    return () => {
      offSpeed()
      offQuality()
    }
  }, [])

  const runSpeedTest = async (): Promise<void> => {
    if (!connected || speedRunning) return
    setSpeedRunning(true)
    setSpeedResult(null)
    setSpeedLive({ down: 0, up: 0 })
    setSpeedProgress({ phase: 'down', mbps: 0, progress: 0 })
    try {
      const result = await window.api.speedTest()
      setSpeedResult(result)
      toast(`测速完成：↓ ${result.downMbps} Mbps · ↑ ${result.upMbps} Mbps`)
    } catch (err) {
      toast(`测速失败：${cleanError(err)}`)
    } finally {
      setSpeedRunning(false)
    }
  }

  const runQualityTest = async (): Promise<void> => {
    if (!connected || qualityRunning) return
    setQualityRunning(true)
    setQualityResult(null)
    setQualityProgress({ done: 0, total: 12, lastMs: null })
    try {
      const result = await window.api.qualityTest()
      setQualityResult(result)
      toast(
        result.lossPct > 0
          ? `质量检测完成：丢包 ${result.lossPct}%`
          : `质量检测完成：无丢包，平均 ${result.avgMs} ms`
      )
    } catch (err) {
      toast(`质量检测失败：${cleanError(err)}`)
    } finally {
      setQualityRunning(false)
    }
  }

  const exportBundle = async (): Promise<void> => {
    if (exporting) return
    setExporting(true)
    try {
      const file = await window.api.exportDiagnostics()
      setLastExport(file)
      toast('诊断包已导出，已在文件夹中定位')
    } catch (err) {
      toast(`导出失败：${cleanError(err)}`)
    } finally {
      setExporting(false)
    }
  }

  const speedPct = speedProgress ? Math.round(speedProgress.progress * 100) : 0
  const qualityPct =
    qualityProgress && qualityProgress.total
      ? Math.round((qualityProgress.done / qualityProgress.total) * 100)
      : 0
  const sampleMax = Math.max(50, ...(qualityResult?.samples ?? []))

  return (
    <div className="page-diag">
      {!connected && (
        <div className="alert alert-warn">
          <Icon name="info" size={16} />
          <span>当前未连接，实时连接、测速与质量检测将在隧道建立后可用。</span>
        </div>
      )}

      <section className="card conn-card">
        <div className="card-head">
          <div>
            <div className="card-title">实时连接</div>
            <div className="card-sub">ACTIVE CONNECTIONS</div>
          </div>
          <div className="chip chip-mono">{conns.length} 条</div>
        </div>

        {conns.length > 0 ? (
          <>
            <div className="conn-table">
              <div className="conn-head">
                <span>目标</span>
                <span>进程</span>
                <span>规则</span>
                <span>实时速率</span>
                <span>累计</span>
              </div>
              {conns.slice(0, 100).map((c) => (
                <div className="conn-row" key={c.id || `${c.host}-${c.port}`}>
                  <div className="conn-target">
                    <strong title={c.host}>{c.host || c.ip || '未知目标'}</strong>
                    <em>
                      {c.ip && c.ip !== c.host ? `${c.ip}:${c.port}` : c.port}
                      {c.network ? ` · ${c.network.toUpperCase()}` : ''}
                    </em>
                  </div>
                  <div className="conn-process" title={c.process}>
                    {procName(c.process)}
                  </div>
                  <div className="conn-rule" title={c.rule}>
                    {c.rule || c.chains.join(' → ') || '—'}
                  </div>
                  <div className="conn-rate">
                    <em>↓ {fmtBps(c.downRate)}</em>
                    <em>↑ {fmtBps(c.upRate)}</em>
                  </div>
                  <div className="conn-total">{fmtBytes(c.download + c.upload)}</div>
                </div>
              ))}
            </div>
            <div className="conn-foot">
              每 2 秒刷新 · 按累计流量排序
              {conns.length > 100 ? ' · 仅显示前 100 条' : ''}
            </div>
          </>
        ) : (
          <div className="empty">
            <div className="empty-ico">
              <Icon name="link" size={28} />
            </div>
            <div className="empty-title">{connected ? '暂无活动连接' : '未建立隧道'}</div>
            <div className="empty-sub">
              {connected
                ? '浏览器或应用产生流量后，这里会显示域名、进程与实时速率。'
                : '连接成功后即可查看每条连接的域名、进程与流量。'}
            </div>
          </div>
        )}
      </section>

      <div className="diag-grid">
        <section className="card">
          <div className="card-head">
            <div>
              <div className="card-title">带宽测速</div>
              <div className="card-sub">BANDWIDTH · CLOUDFLARE</div>
            </div>
            <button
              className="btn btn-primary"
              onClick={() => void runSpeedTest()}
              disabled={!connected || speedRunning}
            >
              <Icon name={speedRunning ? 'refresh' : 'bolt'} size={15} />
              {speedRunning ? '测速中…' : '开始测速'}
            </button>
          </div>

          <div className="diag-metrics">
            <div>
              <em>下行</em>
              <strong>
                {speedResult ? speedResult.downMbps : speedLive.down}
                <small>Mbps</small>
              </strong>
            </div>
            <div>
              <em>上行</em>
              <strong>
                {speedResult ? speedResult.upMbps : speedLive.up}
                <small>Mbps</small>
              </strong>
            </div>
          </div>

          <div className="diag-bar">
            <div className="scan-track">
              <div className="scan-fill" style={{ width: `${speedRunning ? Math.max(speedPct, 4) : speedResult ? 100 : 0}%` }} />
            </div>
            <div className="scan-note">
              {speedRunning
                ? `${speedProgress?.phase === 'up' ? '上行' : '下行'}传输中 ${speedPct}%`
                : speedResult
                  ? `下行 ${fmtBytes(speedResult.downBytes)} / ${(speedResult.downMs / 1000).toFixed(1)} 秒 · 上行 ${fmtBytes(speedResult.upBytes)} / ${(speedResult.upMs / 1000).toFixed(1)} 秒`
                  : '通过当前隧道下载 20 MB、上传 8 MB，结果受出口节点与本地网络影响。'}
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <div className="card-title">链路质量</div>
              <div className="card-sub">QUALITY · 12 PROBES</div>
            </div>
            <button
              className="btn btn-ghost"
              onClick={() => void runQualityTest()}
              disabled={!connected || qualityRunning}
            >
              <Icon name={qualityRunning ? 'refresh' : 'pulse'} size={15} />
              {qualityRunning ? '检测中…' : '开始检测'}
            </button>
          </div>

          <div className="diag-metrics quality">
            <div>
              <em>丢包</em>
              <strong className={qualityResult && qualityResult.lossPct > 0 ? 'warn' : ''}>
                {qualityResult ? qualityResult.lossPct : 0}
                <small>%</small>
              </strong>
            </div>
            <div>
              <em>平均</em>
              <strong>
                {qualityResult ? qualityResult.avgMs : 0}
                <small>ms</small>
              </strong>
            </div>
            <div>
              <em>最小</em>
              <strong>
                {qualityResult ? qualityResult.minMs : 0}
                <small>ms</small>
              </strong>
            </div>
            <div>
              <em>最大</em>
              <strong>
                {qualityResult ? qualityResult.maxMs : 0}
                <small>ms</small>
              </strong>
            </div>
          </div>

          <div className="q-bars">
            {(qualityResult?.samples ?? []).map((ms, i) => (
              <span key={i} style={{ height: `${Math.max(8, (ms / sampleMax) * 100)}%` }} title={`${ms} ms`} />
            ))}
            {!qualityResult && qualityRunning && (
              <span className="q-placeholder">
                已探测 {qualityProgress?.done ?? 0} / {qualityProgress?.total ?? 12}
                {qualityProgress?.lastMs != null ? ` · 最近 ${qualityProgress.lastMs} ms` : ' · 超时'}
              </span>
            )}
            {!qualityResult && !qualityRunning && <span className="q-placeholder">点击“开始检测”采样 12 次</span>}
          </div>

          <div className="diag-bar">
            <div className="scan-track">
              <div className="scan-fill" style={{ width: `${qualityRunning ? Math.max(qualityPct, 4) : qualityResult ? 100 : 0}%` }} />
            </div>
            <div className="scan-note">
              {qualityRunning
                ? `探测中 ${qualityProgress?.done ?? 0} / ${qualityProgress?.total ?? 12}`
                : qualityResult
                  ? `收到 ${qualityResult.received} / ${qualityResult.sent} 次响应`
                  : '通过核心出口向 gstatic 探测，丢包与抖动可反映隧道稳定性。'}
            </div>
          </div>
        </section>
      </div>

      <section className="card diag-export">
        <div className="diag-export-copy">
          <div className="card-title">诊断包</div>
          <div className="card-sub">DIAGNOSTIC BUNDLE</div>
          <p>
            汇总版本、系统、设置、节点、当前连接与最近 400 行日志，保存为 JSON。
            不包含设备私钥与 config.yaml，可直接发送给维护者排查。
          </p>
          {lastExport && <div className="diag-path">{lastExport}</div>}
        </div>
        <button className="btn btn-primary" onClick={() => void exportBundle()} disabled={exporting}>
          <Icon name="download" size={15} />
          {exporting ? '导出中…' : '导出诊断包'}
        </button>
      </section>
    </div>
  )
}
