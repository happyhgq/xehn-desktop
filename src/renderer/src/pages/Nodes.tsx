import { useMemo, useState, type JSX } from 'react'
import type { AppContext } from '../context'
import { Icon } from '../components/Icon'
import type { NodeResult, NodeSource } from '../../../shared/types'
import { fmtAgo, fmtLatency } from '../format'

const SOURCE_LABEL: Record<NodeSource, string> = {
  builtin: '内置',
  subscription: '订阅',
  random: '随机'
}

function lossTone(loss: number): string {
  if (loss <= 0) return 'good'
  if (loss <= 33) return 'mid'
  return 'slow'
}

function scoreTone(score: number): string {
  if (score >= 80) return 'good'
  if (score >= 55) return 'mid'
  return 'slow'
}

export default function Nodes({ app }: { app: AppContext }): JSX.Element {
  const {
    nodes,
    nodesAt,
    sources,
    geoip,
    settings,
    status,
    scanning,
    scanProgress,
    scan,
    cancelScan,
    updateSettings,
    connect,
    disconnect,
    navigate,
    toast
  } = app
  const [manual, setManual] = useState(settings.endpoint)
  const [switching, setSwitching] = useState('')

  const okNodes = useMemo(() => nodes.filter((n) => n.ok), [nodes])
  const failed = useMemo(() => nodes.filter((n) => !n.ok), [nodes])
  const best = okNodes[0]
  const progressPct = scanProgress.total ? Math.round((scanProgress.done / scanProgress.total) * 100) : 0

  const applyManual = async (): Promise<void> => {
    const value = manual.trim()
    try {
      await updateSettings({ endpoint: value })
      toast(value ? `已固定节点 ${value}` : '已切换为自动选择')
      if (status.state === 'connected') toast('节点已修改，重新连接后生效')
    } catch (err) {
      toast(`保存失败：${(err as Error).message}`)
    }
  }

  const useNode = async (endpoint: string): Promise<void> => {
    setSwitching(endpoint)
    try {
      await updateSettings({ endpoint })
      if (status.state === 'connected') {
        await disconnect()
        await connect(endpoint)
        toast(`已切换到 ${endpoint}`)
      } else {
        toast(`已固定节点 ${endpoint}`)
      }
    } finally {
      setSwitching('')
    }
  }

  const autoSelect = async (): Promise<void> => {
    setManual('')
    await updateSettings({ endpoint: '' })
    toast('已切换为自动选择（跟随最佳节点）')
  }

  return (
    <div className="page-nodes">
      <section className="card">
        <div className="card-head">
          <div>
            <div className="card-title">节点测速</div>
            <div className="card-sub">内置池 + 订阅源 + CIDR 随机采样，多轮探测后按延迟、丢包与抖动综合评分</div>
          </div>
          <div className="btn-row">
            {scanning ? (
              <button className="btn btn-ghost" onClick={cancelScan}>
                <Icon name="x" size={15} />
                取消
              </button>
            ) : (
              <>
                <button className="btn btn-ghost" onClick={() => void scan(false)}>
                  <Icon name="refresh" size={15} />
                  快速测速
                </button>
                <button className="btn btn-primary" onClick={() => void scan(true)}>
                  <Icon name="scan" size={15} />
                  深度测速
                </button>
              </>
            )}
          </div>
        </div>

        <div className="scan-progress">
          <div className="scan-track">
            <div className="scan-fill" style={{ width: `${scanning ? Math.max(progressPct, 4) : 0}%` }} />
          </div>
          <div className="scan-note">
            {scanning
              ? `正在多轮探测 ${scanProgress.done} / ${scanProgress.total || '…'}（每节点 3–4 次）`
              : nodesAt
                ? `上次测速：${fmtAgo(nodesAt)} · ${okNodes.length} 个可用`
                : '尚未测速。快速测速约 10 秒，深度测速覆盖更多来源与端口，耗时更长。'}
          </div>
        </div>

        <div className="source-bar">
          <span className="source-chip builtin">内置 {sources?.builtin ?? 0}</span>
          <span className="source-chip subscription">订阅 {sources?.subscription ?? 0}</span>
          <span className="source-chip random">随机 {sources?.random ?? 0}</span>
          {sources && sources.subscriptionErrors > 0 && (
            <span className="source-chip warn">订阅失败 {sources.subscriptionErrors}</span>
          )}
          <span className="source-gap" />
          <button
            className={`source-chip clickable ${geoip.available ? 'ok' : 'warn'}`}
            onClick={() => navigate('settings')}
          >
            <Icon name="pulse" size={12} />
            {geoip.available ? '归属地已启用' : '归属地未启用'}
          </button>
        </div>

        <div className="manual-row">
          <div className="manual-input">
            <Icon name="server" size={16} />
            <input
              value={manual}
              placeholder="手动节点，如 162.159.192.1:2408（留空 = 自动选择）"
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void applyManual()
              }}
            />
          </div>
          <button className="btn btn-ghost" onClick={() => void applyManual()}>
            应用
          </button>
          <button className={`btn ${settings.endpoint ? 'btn-ghost' : 'btn-active'}`} onClick={() => void autoSelect()}>
            <Icon name="check" size={15} />
            自动
          </button>
        </div>
      </section>

      <section className="card node-list-card">
        <div className="node-list-head">
          <span>节点 / 归属</span>
          <span>延迟</span>
          <span>丢包</span>
          <span>评分</span>
          <span>状态</span>
          <span>操作</span>
        </div>

        {nodes.length === 0 && !scanning && (
          <div className="empty">
            <div className="empty-ico">
              <Icon name="nodes" size={28} />
            </div>
            <div className="empty-title">暂无节点数据</div>
            <div className="empty-sub">
              点击“快速测速”聚合内置池、订阅源与随机采样端点，客户端会按综合评分选出最佳节点。
            </div>
          </div>
        )}

        {best && settings.endpoint === '' && (
          <NodeRow
            node={best}
            auto
            switching={switching === best.endpoint}
            onUse={() => void useNode(best.endpoint)}
          />
        )}

        {okNodes.map((node) => {
          const pinned = settings.endpoint === node.endpoint
          const isActive = status.endpoint === node.endpoint
          if (!settings.endpoint && node.endpoint === best?.endpoint) return null
          return (
            <NodeRow
              key={node.endpoint}
              node={node}
              pinned={pinned}
              live={isActive}
              switching={switching === node.endpoint}
              onUse={() => void useNode(node.endpoint)}
            />
          )
        })}

        {failed.length > 0 && (
          <details className="failed-block">
            <summary>不可用节点（{failed.length}）</summary>
            {failed.map((node) => (
              <NodeRow key={node.endpoint} node={node} />
            ))}
          </details>
        )}

        <div className="node-foot">
          <span>协议 {settings.proto.toUpperCase()}</span>
          <span>多轮探测</span>
          <span>节点缓存 6 小时</span>
          <span>{nodes.length} 条记录</span>
          {sources && <span>来源：内置 {sources.builtin} · 订阅 {sources.subscription} · 随机 {sources.random}</span>}
        </div>
      </section>
    </div>
  )
}

function NodeRow({
  node,
  auto,
  pinned,
  live,
  switching,
  onUse
}: {
  node: NodeResult
  auto?: boolean
  pinned?: boolean
  live?: boolean
  switching?: boolean
  onUse?: () => void
}): JSX.Element {
  const geo = node.geo
  const loss = node.lossPct ?? 0
  const score = node.score ?? 0
  const location = geo
    ? [geo.countryName || geo.country, geo.city].filter(Boolean).join(' · ')
    : ''

  return (
    <div
      className={`node-row ${node.ok ? '' : 'failed'} ${pinned ? 'pinned' : ''} ${live ? 'active' : ''}`}
    >
      <div className="node-addr">
        <span className={`node-dot ${node.ok ? 'ok' : 'bad'}`} />
        <div className="node-main">
          <div className="node-endpoint">
            <strong>{node.endpoint}</strong>
            {node.tag && <span className="pill pill-tag">{node.tag}</span>}
            {auto && <span className="pill">自动最佳</span>}
            {pinned && <span className="pill">已固定</span>}
            {live && <span className="pill pill-live">当前</span>}
          </div>
          <div className="node-geo">
            {node.source && <span className={`src src-${node.source}`}>{SOURCE_LABEL[node.source]}</span>}
            {geo ? (
              <>
                <span className="geo-cc">{geo.country || '--'}</span>
                <span className="geo-text">
                  {location}
                  {geo.asn > 0 ? ` · AS${geo.asn}` : ''}
                </span>
              </>
            ) : (
              <span className="geo-text muted">归属地未知</span>
            )}
          </div>
        </div>
      </div>

      <div className="node-latency">
        {node.ok ? (
          <LatencyBar ms={node.delayMs} jitter={node.jitterMs} />
        ) : (
          <span className="muted mono">超时</span>
        )}
      </div>

      <div className={`node-loss ${lossTone(loss)}`}>{node.ok ? `${loss}%` : '100%'}</div>

      <div>
        <span className={`score ${node.ok ? scoreTone(score) : 'slow'}`}>{node.ok ? score : '—'}</span>
      </div>

      <div className={`node-state ${node.ok ? 'ok' : 'bad'}`}>{node.ok ? '可用' : '不可用'}</div>

      <div className="node-actions">
        {onUse && (
          <button className="btn btn-tiny" onClick={onUse} disabled={switching}>
            {switching ? '切换中…' : '使用'}
          </button>
        )}
      </div>
    </div>
  )
}

function LatencyBar({ ms, jitter }: { ms: number; jitter?: number }): JSX.Element {
  const pct = Math.min(100, Math.max(6, (ms / 300) * 100))
  const tone = ms < 80 ? 'good' : ms < 180 ? 'mid' : 'slow'
  return (
    <div className="latency" title={jitter !== undefined ? `抖动 ±${jitter} ms` : undefined}>
      <div className="latency-track">
        <div className={`latency-fill ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span>{fmtLatency(ms)}</span>
    </div>
  )
}
