import { Button, Tag, theme } from 'antd'
import {
  DatabaseOutlined,
  GlobalOutlined,
  PlusOutlined,
  ReloadOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'
import { APP_NAME } from '../../../shared/appInfo'
import type { InstanceMeta } from '../../../shared/types'
import appIcon from '../assets/app-icon.png'
import { formatTime } from '../utils'

interface WelcomeProps {
  instances: InstanceMeta[]
  webCount: number
  scannedAt: number
  scanning: boolean
  onScan: () => void
  onAdd: () => void
  onOpenInstance: (instanceId: string) => void
  onOpenWeb: () => void
}

function viaLabel(instance: InstanceMeta): string {
  if (instance.via === 'ssh') return 'SSH'
  if (instance.via === 'docker') return 'Docker'
  return '本机'
}

export default function Welcome({
  instances,
  webCount,
  scannedAt,
  scanning,
  onScan,
  onAdd,
  onOpenInstance,
  onOpenWeb
}: WelcomeProps) {
  const { token } = theme.useToken()
  const redisCount = instances.filter((instance) => instance.kind === 'redis').length
  const mysqlCount = instances.filter((instance) => instance.kind === 'mysql').length
  const firstMysql = instances.find((instance) => instance.kind === 'mysql')
  const firstRedis = instances.find((instance) => instance.kind === 'redis')
  const recent = [
    ...instances.filter((instance) => instance.kind === 'mysql').slice(0, 2),
    ...instances.filter((instance) => instance.kind === 'redis').slice(0, 2)
  ]

  return (
    <div className="welcome">
      <div className="welcome-hero">
        <div className="welcome-copy">
          <div className="welcome-brand">
            <img className="welcome-logo" src={appIcon} alt={APP_NAME} />
            <div>
              <div className="welcome-kicker">{APP_NAME}</div>
              <div className="welcome-brand-sub">本机开发环境</div>
            </div>
          </div>

          <h1 className="welcome-title">本机服务，一眼看全</h1>
          <p className="welcome-lead">
            自动扫描本机端口与 Docker 容器，发现正在运行的 Redis、MySQL 与 Web 服务，
            浏览数据、查看实时日志。只读、安全。
          </p>

          <div className="welcome-actions">
            <Button type="primary" icon={<ReloadOutlined />} loading={scanning} onClick={onScan}>
              重新扫描
            </Button>
            <Button icon={<PlusOutlined />} onClick={onAdd}>
              添加连接
            </Button>
          </div>

          <div className="welcome-meta">
            <span>只读浏览</span>
            <span>数据不上传</span>
            <span>实时日志</span>
          </div>
        </div>

        <div
          className="welcome-panel"
          style={{
            background: token.colorBgContainer,
            borderColor: token.colorBorderSecondary
          }}
        >
          <div className="welcome-panel-head">
            <span>本机概览</span>
            <Tag>{instances.length + webCount} 个端口</Tag>
          </div>

          <div className="overview-grid">
            <button
              type="button"
              className="overview-card"
              disabled={!firstMysql}
              onClick={() => firstMysql && onOpenInstance(firstMysql.id)}
            >
              <span className="overview-icon overview-mysql">
                <DatabaseOutlined />
              </span>
              <span className="overview-body">
                <span className="overview-value">{mysqlCount}</span>
                <span className="overview-label">MySQL 端口</span>
              </span>
              <span className="overview-arrow" aria-hidden="true">
                ›
              </span>
            </button>

            <button
              type="button"
              className="overview-card"
              disabled={!firstRedis}
              onClick={() => firstRedis && onOpenInstance(firstRedis.id)}
            >
              <span className="overview-icon overview-redis">
                <ThunderboltOutlined />
              </span>
              <span className="overview-body">
                <span className="overview-value">{redisCount}</span>
                <span className="overview-label">Redis 端口</span>
              </span>
              <span className="overview-arrow" aria-hidden="true">
                ›
              </span>
            </button>

            <button type="button" className="overview-card is-wide" onClick={onOpenWeb}>
              <span className="overview-icon overview-web">
                <GlobalOutlined />
              </span>
              <span className="overview-body">
                <span className="overview-value">{webCount}</span>
                <span className="overview-label">Web 端口 · 点击打开面板</span>
              </span>
              <span className="overview-arrow" aria-hidden="true">
                ›
              </span>
            </button>
          </div>

          <div className="welcome-panel-subhead">
            <span>最近发现</span>
            <span className="muted">
              {scannedAt ? `扫描于 ${formatTime(scannedAt)}` : scanning ? '扫描中…' : ''}
            </span>
          </div>

          <div className="recent-list">
            {recent.length > 0 ? (
              recent.map((instance) => (
                <button
                  type="button"
                  className="recent-item"
                  key={instance.id}
                  onClick={() => onOpenInstance(instance.id)}
                >
                  <span className={`status-dot status-${instance.status}`} />
                  <span className="recent-label">{instance.label}</span>
                  <span className="recent-port mono">:{instance.port}</span>
                  <span className="recent-via">{viaLabel(instance)}</span>
                  <span className="recent-chevron" aria-hidden="true">
                    ›
                  </span>
                </button>
              ))
            ) : (
              <div className="recent-empty">
                还没有发现实例。确认服务已启动后重新扫描，或在右上角手动添加连接。
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="welcome-steps">
        <article className="welcome-step">
          <span className="welcome-step-num">01</span>
          <div>
            <h3>发现服务</h3>
            <p>扫描本机端口与 Docker 容器</p>
          </div>
        </article>
        <article className="welcome-step">
          <span className="welcome-step-num">02</span>
          <div>
            <h3>浏览数据</h3>
            <p>点库表直接查看，支持 JSON 详情</p>
          </div>
        </article>
        <article className="welcome-step">
          <span className="welcome-step-num">03</span>
          <div>
            <h3>实时日志</h3>
            <p>点 Web 进程查看实时输出</p>
          </div>
        </article>
        <article className="welcome-step">
          <span className="welcome-step-num">04</span>
          <div>
            <h3>菜单栏常驻</h3>
            <p>关闭窗口后从菜单栏快速恢复</p>
          </div>
        </article>
      </div>
    </div>
  )
}
