import type { JSX } from 'react'
import type { AppContext } from '../context'
import { Icon } from '../components/Icon'

const LINKS = [
  {
    label: 'XEHN 项目主页',
    desc: 'github.com/hezhanleiok/xehn — WARP 扫描与连接引擎',
    url: 'https://github.com/hezhanleiok/xehn'
  },
  {
    label: 'XEHN 发布页',
    desc: '上游 Windows 客户端与核心下载',
    url: 'https://github.com/hezhanleiok/xehn/releases'
  },
  {
    label: 'mihomo 核心',
    desc: 'MetaCubeX/mihomo — 实际负责流量路由的 Clash Meta 内核',
    url: 'https://github.com/MetaCubeX/mihomo'
  },
  {
    label: 'Cloudflare WARP',
    desc: '1.1.1.1 — 本客户端连接的 WARP 服务',
    url: 'https://1.1.1.1/'
  }
]

export default function About({ app }: { app: AppContext }): JSX.Element {
  const { boot, openExternal, openDataDir } = app

  return (
    <div className="page-about">
      <section className="card about-hero">
        <div className="about-mark">
          <Icon name="bolt" size={38} />
        </div>
        <div className="about-copy">
          <div className="about-title">
            XEHN Desktop
            <span className="pill">v{boot.version}</span>
          </div>
          <div className="about-desc">
            Cloudflare WARP 桌面客户端 · 自动测速选优 · AmneziaWG / WireGuard / MASQUE 多协议 ·
            由 mihomo 核心承载流量
          </div>
          <div className="about-actions">
            <button className="btn btn-primary" onClick={() => openExternal('https://github.com/hezhanleiok/xehn')}>
              <Icon name="external" size={15} />
              访问上游项目
            </button>
            <button className="btn btn-ghost" onClick={openDataDir}>
              <Icon name="folder" size={15} />
              打开数据目录
            </button>
          </div>
        </div>
      </section>

      <div className="licence-banner">
        <Icon name="shield" size={18} />
        <strong>{boot.licenseNotice}</strong>
        <span>客户端仅供学习交流，请在遵守当地法律法规与 Cloudflare 服务条款的前提下使用。</span>
      </div>

      <div className="about-grid">
        <section className="card">
          <div className="card-head">
            <div>
              <div className="card-title">引擎信息</div>
              <div className="card-sub">ENGINE</div>
            </div>
          </div>
          <div className="about-rows">
            <div>
              <em>客户端版本</em>
              <strong>v{boot.version}</strong>
            </div>
            <div>
              <em>mihomo 核心</em>
              <strong>{boot.core.version || '未安装'}</strong>
            </div>
            <div>
              <em>核心状态</em>
              <strong>{boot.core.available ? '已就绪' : '首次连接时自动下载'}</strong>
            </div>
            <div>
              <em>平台</em>
              <strong>{boot.platform === 'win32' ? 'Windows x64' : boot.platform}</strong>
            </div>
            <div className="span-2">
              <em>核心路径</em>
              <strong className="mono small">{boot.core.path || '—'}</strong>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <div className="card-title">设备</div>
              <div className="card-sub">WARP DEVICE</div>
            </div>
            <div className="chip chip-mono">{boot.account?.hasMasque ? 'MASQUE 已注册' : '按需注册'}</div>
          </div>
          <div className="about-rows">
            <div className="span-2">
              <em>设备 ID</em>
              <strong className="mono small">{boot.account?.id || '首次连接时自动注册'}</strong>
            </div>
            <div>
              <em>IPv4</em>
              <strong className="mono">{boot.account?.ipv4 || '—'}</strong>
            </div>
            <div>
              <em>IPv6</em>
              <strong className="mono small">{boot.account?.ipv6 || '—'}</strong>
            </div>
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <div>
            <div className="card-title">相关链接</div>
            <div className="card-sub">LINKS</div>
          </div>
        </div>
        <div className="link-list">
          {LINKS.map((link) => (
            <button className="link-row" key={link.url} onClick={() => openExternal(link.url)}>
              <div className="link-ico">
                <Icon name="link" size={16} />
              </div>
              <div className="link-copy">
                <strong>{link.label}</strong>
                <span>{link.desc}</span>
              </div>
              <Icon name="external" size={15} />
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <div className="card-title">说明</div>
            <div className="card-sub">NOTICE</div>
          </div>
        </div>
        <div className="notice-body">
          <p>
            本客户端是 XEHN 项目的独立桌面端实现：沿用其 WARP 设备注册流程与 mihomo 配置思路，
            直接管理 mihomo 核心完成连接、测速与系统代理接管。
          </p>
          <p>
            mihomo 与 psiphon 等第三方组件分别遵循其自身许可证（GPL-3.0 等），
            打包分发时需一并保留许可证文本与声明。
          </p>
          <p>
            WARP 服务由 Cloudflare 提供。请勿将本客户端用于任何违法用途；
            因使用本软件产生的一切后果由使用者自行承担。
          </p>
        </div>
      </section>
    </div>
  )
}
