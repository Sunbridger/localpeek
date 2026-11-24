import { Button, Empty, Space, theme } from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { APP_NAME } from '../../../shared/appInfo'
import type { InstanceMeta } from '../../../shared/types'
import appIcon from '../assets/app-icon.png'
import { formatTime } from '../utils'

interface WelcomeProps {
  instances: InstanceMeta[]
  webCount: number
  scannedAt: number
  dockerAvailable: boolean
  scanning: boolean
  onScan: () => void
  onAdd: () => void
}

export default function Welcome({
  instances,
  webCount,
  scannedAt,
  dockerAvailable,
  scanning,
  onScan,
  onAdd
}: WelcomeProps) {
  const { token } = theme.useToken()
  const redisCount = instances.filter((instance) => instance.kind === 'redis').length
  const mysqlCount = instances.filter((instance) => instance.kind === 'mysql').length

  return (
    <div className="welcome">
      <img className="welcome-logo" src={appIcon} alt={APP_NAME} />
      <div>
        <h1>本机数据库，一眼看全</h1>
        <p>
          自动扫描本机常见端口与 Docker 容器，发现正在运行的 Redis / MySQL，
          以表格形式浏览数据，只读、安全。
        </p>
      </div>

      <div className="stats-row">
        <div className="stat-card" style={{ background: token.colorBgContainer }}>
          <div className="stat-value">{redisCount}</div>
          <div className="stat-label">Redis 实例</div>
        </div>
        <div className="stat-card" style={{ background: token.colorBgContainer }}>
          <div className="stat-value">{mysqlCount}</div>
          <div className="stat-label">MySQL 实例</div>
        </div>
        <div className="stat-card" style={{ background: token.colorBgContainer }}>
          <div className="stat-value">{webCount}</div>
          <div className="stat-label">Web 应用</div>
        </div>
      </div>

      {instances.length === 0 && !scanning ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span className="muted">
              没有发现数据库。确认服务已启动，或尝试重新扫描 / 手动添加连接。
            </span>
          }
        />
      ) : (
        <p className="muted" style={{ margin: 0 }}>
          {scannedAt ? `上次扫描 ${formatTime(scannedAt)} · ` : ''}
          Docker {dockerAvailable ? '可用' : '不可用'} · 在左侧选择实例开始浏览
        </p>
      )}

      <Space>
        <Button type="primary" icon={<ReloadOutlined />} loading={scanning} onClick={onScan}>
          重新扫描
        </Button>
        <Button icon={<PlusOutlined />} onClick={onAdd}>
          添加连接
        </Button>
      </Space>
    </div>
  )
}
