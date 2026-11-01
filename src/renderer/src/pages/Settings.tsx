import { useEffect, useState, type JSX, type ReactNode } from 'react'
import type { AppContext } from '../context'
import { Icon } from '../components/Icon'
import type { Proto, ProxyMode, Settings } from '../../../shared/types'

function Toggle({
  checked,
  onChange,
  disabled
}: {
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}): JSX.Element {
  return (
    <button
      className={`toggle ${checked ? 'on' : ''}`}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  )
}

function Row({
  label,
  desc,
  children
}: {
  label: string
  desc?: string
  children: ReactNode
}): JSX.Element {
  return (
    <div className="setting-row">
      <div className="setting-copy">
        <div className="setting-label">{label}</div>
        {desc && <div className="setting-desc">{desc}</div>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  )
}

export default function SettingsPage({ app }: { app: AppContext }): JSX.Element {
  const {
    settings,
    status,
    boot,
    geoip,
    updateSettings,
    register,
    updateCore,
    checkCore,
    openDataDir,
    downloadGeoip,
    openGeoipDir,
    toast
  } = app
  const [mixedPort, setMixedPort] = useState(String(settings.mixedPort))
  const [apiPort, setApiPort] = useState(String(settings.apiPort))
  const [dns, setDns] = useState(settings.dns)
  const [endpoint, setEndpoint] = useState(settings.endpoint)
  const [subscriptions, setSubscriptions] = useState(settings.subscriptionUrls)
  const [regions, setRegions] = useState(settings.preferredRegions)
  const [working, setWorking] = useState('')

  useEffect(() => setMixedPort(String(settings.mixedPort)), [settings.mixedPort])
  useEffect(() => setApiPort(String(settings.apiPort)), [settings.apiPort])
  useEffect(() => setDns(settings.dns), [settings.dns])
  useEffect(() => setEndpoint(settings.endpoint), [settings.endpoint])
  useEffect(() => setSubscriptions(settings.subscriptionUrls), [settings.subscriptionUrls])
  useEffect(() => setRegions(settings.preferredRegions), [settings.preferredRegions])

  const save = (patch: Partial<Settings>): void => {
    void updateSettings(patch)
  }

  const commitPort = (key: 'mixedPort' | 'apiPort', raw: string): void => {
    const value = Number(raw)
    if (!Number.isFinite(value) || value < 1024 || value > 65535) {
      setMixedPort(String(settings.mixedPort))
      setApiPort(String(settings.apiPort))
      toast('端口需在 1024 - 65535 之间')
      return
    }
    save({ [key]: Math.trunc(value) } as Partial<Settings>)
  }

  const onCheckCore = async (): Promise<void> => {
    setWorking('check')
    try {
      const result = await checkCore()
      toast(result.hasUpdate ? `发现新核心 ${result.latest}` : '核心已是最新版本')
    } catch (err) {
      toast(`检查失败：${(err as Error).message}`)
    } finally {
      setWorking('')
    }
  }

  const onUpdateCore = async (): Promise<void> => {
    if (status.state === 'connected') {
      toast('请先断开连接再更新核心')
      return
    }
    setWorking('core')
    try {
      await updateCore()
    } finally {
      setWorking('')
    }
  }

  const onRegister = async (fresh: boolean): Promise<void> => {
    if (status.state === 'connected') {
      toast('请先断开连接')
      return
    }
    if (fresh && !window.confirm('将注册一个全新 WARP 设备，现有设备身份会被替换。继续吗？')) return
    setWorking('account')
    try {
      await register(fresh)
    } finally {
      setWorking('')
    }
  }

  const onDownloadGeoip = async (): Promise<void> => {
    setWorking('geoip')
    try {
      const next = await downloadGeoip()
      toast(next.available ? 'GeoIP 数据库已就绪' : '数据库已下载，但未能加载')
    } catch (err) {
      toast(`下载失败：${(err as Error).message}`)
    } finally {
      setWorking('')
    }
  }

  const connected = status.state === 'connected'
  const geoFiles = [geoip.cityPath, geoip.countryPath, geoip.asnPath]
    .filter(Boolean)
    .map((path) => path.split(/[\\/]/).pop())
    .join(' · ')

  return (
    <div className="page-settings">
      {connected && (
        <div className="alert alert-warn">
          <Icon name="info" size={16} />
          <span>当前已连接。修改协议、端口、DNS 或 IPv6 后，需要断开并重新连接才会生效。</span>
        </div>
      )}

      <section className="card">
        <div className="card-head">
          <div>
            <div className="card-title">连接</div>
            <div className="card-sub">协议、端口与流量接管方式</div>
          </div>
        </div>

        <Row label="传输协议" desc="AmneziaWG 抗 DPI 最强；WireGuard 最轻量；MASQUE 走 QUIC / HTTP2（H2 易被部分网络阻断）">
          <select
            className="control"
            value={settings.proto}
            onChange={(e) => save({ proto: e.target.value as Proto, endpoint: '' })}
          >
            <option value="awg">AmneziaWG (AWG)</option>
            <option value="wg">WireGuard (WG)</option>
            <option value="masque">MASQUE (QUIC)</option>
            <option value="masque-h2">MASQUE (HTTP/2)</option>
          </select>
        </Row>

        <Row label="路由模式" desc="规则模式仅代理必要流量；全局模式接管全部流量；直连模式不使用代理">
          <select
            className="control"
            value={settings.mode}
            onChange={(e) => save({ mode: e.target.value as ProxyMode })}
          >
            <option value="rule">规则模式（局域网直连）</option>
            <option value="global">全局模式</option>
            <option value="direct">直连模式</option>
          </select>
        </Row>

        <Row label="本地代理端口" desc="HTTP + SOCKS 混合端口，系统代理与支持代理的应用指向这里">
          <input
            className="control mono"
            value={mixedPort}
            onChange={(e) => setMixedPort(e.target.value)}
            onBlur={() => commitPort('mixedPort', mixedPort)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitPort('mixedPort', mixedPort)
            }}
          />
        </Row>

        <Row label="核心 API 端口" desc="mihomo external-controller，仅监听 127.0.0.1">
          <input
            className="control mono"
            value={apiPort}
            onChange={(e) => setApiPort(e.target.value)}
            onBlur={() => commitPort('apiPort', apiPort)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitPort('apiPort', apiPort)
            }}
          />
        </Row>

        <Row label="DNS" desc="逗号分隔。默认 Cloudflare，使用国内 DNS 可加快解析">
          <input
            className="control mono wide"
            value={dns}
            placeholder="1.1.1.1, 1.0.0.1"
            onChange={(e) => setDns(e.target.value)}
            onBlur={() => {
              const value = dns.trim()
              if (value !== settings.dns) save({ dns: value })
            }}
          />
        </Row>

        <Row label="系统代理" desc="连接时自动设置 Windows 系统代理，断开时恢复原设置" >
          <Toggle
            checked={settings.systemProxy}
            disabled={settings.tun}
            onChange={(value) => save({ systemProxy: value })}
          />
        </Row>

        <Row label="TUN 全局模式" desc="创建虚拟网卡接管全部流量，需要管理员权限">
          <div className="control-inline">
            <span className="tag tag-warn">需要管理员</span>
            <Toggle checked={settings.tun} onChange={(value) => save({ tun: value })} />
          </div>
        </Row>

        <Row label="允许局域网连接" desc="让同一局域网内的设备通过本机代理上网">
          <Toggle checked={settings.allowLan} onChange={(value) => save({ allowLan: value })} />
        </Row>

        <Row label="IPv6" desc="同时使用 WARP 分配的 IPv6 地址；网络不支持时请关闭">
          <Toggle checked={settings.ipv6} onChange={(value) => save({ ipv6: value })} />
        </Row>

        <Row label="手动节点" desc="留空则自动选择延迟最低的节点">
          <input
            className="control mono wide"
            value={endpoint}
            placeholder="162.159.192.1:2408"
            onChange={(e) => setEndpoint(e.target.value)}
            onBlur={() => {
              const value = endpoint.trim()
              if (value !== settings.endpoint) save({ endpoint: value })
            }}
          />
        </Row>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <div className="card-title">优选与识别</div>
            <div className="card-sub">多源聚合、离线归属地与综合评分</div>
          </div>
        </div>

        <Row label="订阅地址" desc="每行一个 HTTP(S) 地址；支持纯文本 IP:Port、JSON 列表与 Base64 编码订阅">
          <textarea
            className="control textarea wide mono"
            rows={3}
            value={subscriptions}
            placeholder={'https://example.com/warp-ip.txt\nhttps://example.com/nodes.json'}
            onChange={(e) => setSubscriptions(e.target.value)}
            onBlur={() => {
              const value = subscriptions.trim()
              if (value !== settings.subscriptionUrls) save({ subscriptionUrls: value })
            }}
          />
        </Row>

        <Row label="偏好区域" desc="ISO 国家代码，逗号分隔；归属地命中时综合评分加权，如 US, JP, SG">
          <input
            className="control mono"
            value={regions}
            placeholder="US, JP, SG"
            onChange={(e) => setRegions(e.target.value)}
            onBlur={() => {
              const value = regions.trim()
              if (value !== settings.preferredRegions) save({ preferredRegions: value })
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const value = regions.trim()
                if (value !== settings.preferredRegions) save({ preferredRegions: value })
              }
            }}
          />
        </Row>

        <div className="geoip-box">
          <div className={`geoip-badge ${geoip.available ? 'ok' : 'warn'}`}>
            <Icon name="globe" size={16} />
          </div>
          <div className="geoip-copy">
            <div className="geoip-title">
              GeoIP 数据库
              <span className={`geoip-state ${geoip.available ? 'ok' : 'warn'}`}>
                {geoip.available ? '已就绪' : '未安装'}
              </span>
            </div>
            <div className="geoip-note">{geoip.note}</div>
            {geoFiles && <div className="geoip-paths mono">{geoFiles}</div>}
          </div>
          <div className="btn-row">
            <button className="btn btn-ghost" onClick={openGeoipDir}>
              <Icon name="folder" size={15} />
              打开目录
            </button>
            <button
              className="btn btn-primary"
              disabled={working !== ''}
              onClick={() => void onDownloadGeoip()}
            >
              <Icon name="download" size={15} />
              {working === 'geoip' ? '下载中…' : '下载 DB-IP Lite'}
            </button>
          </div>
        </div>
        <div className="setting-desc geoip-foot">
          DB-IP Lite（CC BY 4.0）约 66 MB，仅保存在本地；也可手动放入 GeoLite2 / DB-IP 的 MMDB 文件。
          WARP 端点多为 Anycast，归属地标签仅供参考。
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <div className="card-title">启动与托盘</div>
            <div className="card-sub">后台运行与自动化</div>
          </div>
        </div>

        <Row label="开机自启" desc="登录 Windows 后自动启动客户端">
          <Toggle checked={settings.launchAtLogin} onChange={(value) => save({ launchAtLogin: value })} />
        </Row>

        <Row label="自动连接" desc="启动后自动建立 WARP 隧道">
          <Toggle checked={settings.autoConnect} onChange={(value) => save({ autoConnect: value })} />
        </Row>

        <Row label="自动测速" desc="没有可用节点缓存时，连接前自动扫描端点">
          <Toggle checked={settings.autoScan} onChange={(value) => save({ autoScan: value })} />
        </Row>

        <Row label="关闭窗口时最小化到托盘" desc="关闭窗口不退出，隧道与系统代理保持工作">
          <Toggle checked={settings.closeToTray} onChange={(value) => save({ closeToTray: value })} />
        </Row>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <div className="card-title">设备账号</div>
            <div className="card-sub">WARP 设备身份与密钥</div>
          </div>
          <div className="btn-row">
            <button className="btn btn-ghost" disabled={working !== ''} onClick={() => void onRegister(false)}>
              <Icon name="key" size={15} />
              {working === 'account' ? '处理中…' : '刷新密钥'}
            </button>
            <button className="btn btn-ghost danger" disabled={working !== ''} onClick={() => void onRegister(true)}>
              全新注册
            </button>
          </div>
        </div>

        <div className="account-grid">
          <div>
            <em>设备 ID</em>
            <strong className="mono">{boot.account?.id ?? '未注册'}</strong>
          </div>
          <div>
            <em>IPv4</em>
            <strong className="mono">{boot.account?.ipv4 || '—'}</strong>
          </div>
          <div>
            <em>IPv6</em>
            <strong className="mono small">{boot.account?.ipv6 || '—'}</strong>
          </div>
          <div>
            <em>MASQUE 设备</em>
            <strong>{boot.account?.hasMasque ? '已注册' : '按需注册'}</strong>
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-copy">
            <div className="setting-label">数据目录</div>
            <div className="setting-desc">账号、缓存、配置与日志都保存在这里</div>
          </div>
          <div className="setting-control">
            <button className="btn btn-ghost" onClick={openDataDir}>
              <Icon name="folder" size={15} />
              打开目录
            </button>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <div className="card-title">核心</div>
            <div className="card-sub">mihomo 核心版本与更新</div>
          </div>
          <div className="btn-row">
            <button className="btn btn-ghost" disabled={working !== ''} onClick={() => void onCheckCore()}>
              <Icon name="refresh" size={15} />
              {working === 'check' ? '检查中…' : '检查更新'}
            </button>
            <button className="btn btn-primary" disabled={working !== '' || connected} onClick={() => void onUpdateCore()}>
              <Icon name="download" size={15} />
              {working === 'core' ? '下载中…' : '更新核心'}
            </button>
          </div>
        </div>

        <div className="account-grid">
          <div>
            <em>核心版本</em>
            <strong className="mono">{boot.core.version || '未安装'}</strong>
          </div>
          <div>
            <em>核心状态</em>
            <strong>{boot.core.available ? '已就绪' : '首次连接时自动下载'}</strong>
          </div>
          <div className="span-2">
            <em>核心路径</em>
            <strong className="mono small">{boot.core.path || '—'}</strong>
          </div>
        </div>
      </section>
    </div>
  )
}
