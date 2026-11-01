import { useEffect, useMemo, useState, type JSX } from 'react'
import type { AppContext } from '../context'
import { Icon } from '../components/Icon'
import { PROTO_LABEL, STATE_LABEL, flagOf, fmtBps, fmtDuration, fmtLatency, fmtAgo } from '../format'

const PROTO_OPTIONS: { value: AppContext['settings']['proto']; label: string; sub: string }[] = [
  { value: 'awg', label: 'AWG', sub: 'AmneziaWG' },
  { value: 'wg', label: 'WG', sub: 'WireGuard' },
  { value: 'masque', label: 'MASQUE', sub: 'QUIC' },
  { value: 'masque-h2', label: 'MASQUE-H2', sub: 'TCP' }
]

function Sparkline({ data, color }: { data: number[]; color: string }): JSX.Element {
  const width = 460
  const height = 76
  const max = Math.max(1, ...data)
  const points = data.length
    ? data.map((v, i) => {
        const x = data.length === 1 ? width : (i / (data.length - 1)) * width
        const y = height - (v / max) * (height - 8) - 4
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
    : [`0,${height}`, `${width},${height}`]
  const line = points.join(' ')
  const area = `0,${height} ${line} ${width},${height}`
  const id = `grad-${color.replace(/[^a-z0-9]/gi, '')}`
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${id})`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

export default function Home({ app }: { app: AppContext }): JSX.Element {
  const { status, settings, nodes, nodesAt, speed, connect, disconnect, updateSettings, scan, scanning, navigate, toast } = app
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const connected = status.state === 'connected'
  const busy = status.state === 'connecting' || status.state === 'disconnecting'
  const elapsed = connected && status.startedAt ? now - status.startedAt : 0
  const best = useMemo(() => nodes.find((n) => n.ok), [nodes])
  const downSamples = useMemo(() => speed.slice(-64).map((s) => s.down), [speed])
  const upSamples = useMemo(() => speed.slice(-64).map((s) => s.up), [speed])

  const endpointText = status.endpoint || settings.endpoint || best?.endpoint || '自动选择'

  const copyIp = async (): Promise<void> => {
    if (!status.exitIp) return
    try {
      await navigator.clipboard.writeText(status.exitIp)
      toast('出口 IP 已复制')
    } catch {
      toast('复制失败')
    }
  }

  const switchProto = (proto: AppContext['settings']['proto']): void => {
    if (busy) return
    void updateSettings({ proto, endpoint: '' })
    if (connected) toast('协议已切换，重新连接后生效')
  }

  return (
    <div className="home">
      <section className="card connect-card">
        <div className="card-head">
          <div>
            <div className="card-title">连接</div>
            <div className="card-sub">Cloudflare WARP · mihomo core</div>
          </div>
          <div className={`state-badge ${status.state}`}>{STATE_LABEL[status.state]}</div>
        </div>

        <div className="orb-wrap">
          <div className={`orb ${connected ? 'on' : ''} ${busy ? 'busy' : ''}`}>
            <button
              className={`orb-btn ${connected ? 'on' : ''}`}
              disabled={busy}
              onClick={() => (connected ? void disconnect() : void connect())}
            >
              <Icon name="power" size={42} />
            </button>
            <div className={`orb-state ${status.state}`}>{STATE_LABEL[status.state]}</div>
            <div className="orb-timer">{connected ? fmtDuration(elapsed) : '--:--:--'}</div>
            <div className="orb-hint">
              {connected
                ? '点击断开连接'
                : busy
                  ? '正在建立隧道…'
                  : settings.tun
                    ? 'TUN 全局模式'
                    : '点击连接，自动选择最佳节点'}
            </div>
          </div>
        </div>

        <div className="proto-block">
          <div className="block-label">传输协议</div>
          <div className="segmented">
            {PROTO_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`seg ${settings.proto === opt.value ? 'active' : ''}`}
                onClick={() => switchProto(opt.value)}
                disabled={busy || settings.proto === opt.value && connected}
              >
                <span>{opt.label}</span>
                <em>{opt.sub}</em>
              </button>
            ))}
          </div>
        </div>

        <div className="connect-meta">
          <div className="meta-item">
            <Icon name="server" size={15} />
            <span>本地代理</span>
            <strong>127.0.0.1:{status.mixedPort}</strong>
          </div>
          <div className="meta-item">
            <Icon name={settings.systemProxy ? 'globe' : 'shield'} size={15} />
            <span>{settings.tun ? 'TUN 模式' : settings.systemProxy ? '系统代理' : '手动代理'}</span>
            <strong>
              {settings.tun
                ? '全局接管'
                : connected
                  ? status.systemProxy
                    ? '已接管'
                    : '未接管'
                  : settings.systemProxy
                    ? '连接时设置'
                    : '未设置'}
            </strong>
          </div>
        </div>

        {status.state === 'error' && status.error && (
          <div className="alert alert-error">
            <Icon name="info" size={16} />
            <span>{status.error}</span>
          </div>
        )}
      </section>

      <section className="card exit-card">
        <div className="card-head">
          <div>
            <div className="card-title">出口</div>
            <div className="card-sub">EXIT NODE</div>
          </div>
          {connected && <div className="chip chip-green">在线</div>}
        </div>

        <div className="exit-hero">
          <div className="exit-flag">{connected ? flagOf(status.country) : '🌐'}</div>
          <div className="exit-place">
            <div className="exit-country">{connected ? status.country || '未知' : '未连接'}</div>
            <div className="exit-city">{connected ? status.city || status.colo || '出口已建立' : '连接后显示出口位置'}</div>
          </div>
        </div>

        <button className={`exit-ip ${connected ? 'live' : ''}`} onClick={() => void copyIp()} disabled={!connected}>
          <span>{connected ? status.exitIp || '获取中…' : '—'}</span>
          {connected && status.exitIp && <Icon name="copy" size={15} />}
        </button>

        <div className="exit-stats">
          <div>
            <em>数据中心</em>
            <strong>{connected ? status.colo || '—' : '—'}</strong>
          </div>
          <div>
            <em>延迟</em>
            <strong>{fmtLatency(status.latencyMs)}</strong>
          </div>
          <div>
            <em>协议</em>
            <strong>{PROTO_LABEL[status.proto] ?? status.proto}</strong>
          </div>
        </div>
      </section>

      <section className="card speed-card">
        <div className="card-head">
          <div>
            <div className="card-title">实时流量</div>
            <div className="card-sub">THROUGHPUT</div>
          </div>
          <div className="chip chip-mono">{status.activeConns} 连接</div>
        </div>

        <div className="speed-row">
          <div className="speed-item">
            <div className="speed-ico down">
              <Icon name="arrowDown" size={16} />
            </div>
            <div>
              <em>下载</em>
              <strong>{fmtBps(status.downBps)}</strong>
            </div>
          </div>
          <div className="speed-item">
            <div className="speed-ico up">
              <Icon name="arrowUp" size={16} />
            </div>
            <div>
              <em>上传</em>
              <strong>{fmtBps(status.upBps)}</strong>
            </div>
          </div>
        </div>

        <div className="spark-stack">
          <Sparkline data={downSamples} color="#22d3ee" />
          <Sparkline data={upSamples} color="#818cf8" />
        </div>
      </section>

      <section className="card endpoint-card">
        <div className="card-head">
          <div>
            <div className="card-title">当前节点</div>
            <div className="card-sub">ENDPOINT</div>
          </div>
          <div className="chip chip-mono">{settings.proto.toUpperCase()}</div>
        </div>

        <div className="endpoint-value">{endpointText}</div>
        <div className="endpoint-meta">
          <span>
            最佳延迟 <strong>{best ? fmtLatency(best.delayMs) : '—'}</strong>
          </span>
          <span>
            可用节点 <strong>{nodes.filter((n) => n.ok).length}</strong>
          </span>
          <span>{nodesAt ? `测速于 ${fmtAgo(nodesAt)}` : '尚未测速'}</span>
        </div>

        <div className="endpoint-actions">
          <button className="btn btn-ghost" onClick={() => void scan(false)} disabled={scanning}>
            <Icon name="refresh" size={15} />
            {scanning ? '测速中…' : '快速测速'}
          </button>
          <button className="btn btn-ghost" onClick={() => navigate('nodes')}>
            <Icon name="nodes" size={15} />
            选择节点
          </button>
        </div>
      </section>

      <section className="card stats-card">
        <div className="stat">
          <em>会话时长</em>
          <strong>{connected ? fmtDuration(elapsed) : '—'}</strong>
        </div>
        <div className="stat">
          <em>系统代理</em>
          <strong>{settings.tun ? 'TUN' : status.systemProxy ? '已接管' : '未接管'}</strong>
        </div>
        <div className="stat">
          <em>核心</em>
          <strong>{app.boot.core.version || '未安装'}</strong>
        </div>
        <div className="stat">
          <em>设备</em>
          <strong>{app.boot.account ? `${app.boot.account.id.slice(0, 8)}…` : '未注册'}</strong>
        </div>
      </section>
    </div>
  )
}
