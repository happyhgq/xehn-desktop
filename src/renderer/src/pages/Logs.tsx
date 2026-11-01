import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { AppContext } from '../context'
import { Icon } from '../components/Icon'
import { fmtClock } from '../format'

type Tab = 'all' | 'app' | 'core'

export default function Logs({ app }: { app: AppContext }): JSX.Element {
  const { logs, openDataDir, toast } = app
  const [tab, setTab] = useState<Tab>('all')
  const [autoScroll, setAutoScroll] = useState(true)
  const [clearedAt, setClearedAt] = useState(0)
  const boxRef = useRef<HTMLDivElement | null>(null)

  const visible = useMemo(() => {
    return logs.filter((line) => {
      if (line.ts <= clearedAt) return false
      if (tab === 'all') return true
      return line.source === tab
    })
  }, [logs, tab, clearedAt])

  useEffect(() => {
    if (!autoScroll) return
    const box = boxRef.current
    if (box) box.scrollTop = box.scrollHeight
  }, [visible, autoScroll])

  const copyAll = async (): Promise<void> => {
    const text = visible
      .map((l) => `${fmtClock(l.ts)} [${l.level.toUpperCase()}] [${l.source}] ${l.text}`)
      .join('\n')
    try {
      await navigator.clipboard.writeText(text)
      toast(`已复制 ${visible.length} 行日志`)
    } catch {
      toast('复制失败')
    }
  }

  return (
    <div className="page-logs">
      <section className="card logs-card">
        <div className="card-head">
          <div>
            <div className="card-title">运行日志</div>
            <div className="card-sub">应用与 mihomo 核心的实时输出</div>
          </div>
          <div className="btn-row">
            <button className="btn btn-ghost" onClick={() => void copyAll()}>
              <Icon name="copy" size={15} />
              复制
            </button>
            <button className="btn btn-ghost" onClick={() => setClearedAt(Date.now())}>
              <Icon name="x" size={15} />
              清空显示
            </button>
            <button className="btn btn-ghost" onClick={openDataDir}>
              <Icon name="folder" size={15} />
              数据目录
            </button>
          </div>
        </div>

        <div className="logs-toolbar">
          <div className="tabs">
            {(
              [
                { id: 'all', label: '全部' },
                { id: 'app', label: '应用' },
                { id: 'core', label: '核心' }
              ] as { id: Tab; label: string }[]
            ).map((item) => (
              <button
                key={item.id}
                className={`tab ${tab === item.id ? 'active' : ''}`}
                onClick={() => setTab(item.id)}
              >
                {item.label}
                <em>
                  {item.id === 'all'
                    ? logs.length
                    : logs.filter((l) => l.source === item.id).length}
                </em>
              </button>
            ))}
          </div>
          <label className="auto-scroll">
            <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
            自动滚动
          </label>
        </div>

        <div className="log-console" ref={boxRef}>
          {visible.length === 0 && <div className="log-empty">暂无日志</div>}
          {visible.map((line, i) => (
            <div className={`log-line ${line.level}`} key={`${line.ts}-${i}`}>
              <span className="log-time">{fmtClock(line.ts)}</span>
              <span className={`log-level ${line.level}`}>{line.level.toUpperCase()}</span>
              <span className={`log-source ${line.source === 'core' ? 'src-core' : 'src-app'}`}>{line.source === 'core' ? 'CORE' : 'APP'}</span>
              <span className="log-text">{line.text}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
