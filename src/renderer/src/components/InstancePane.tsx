import { useEffect, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  Popconfirm,
  Spin,
  Table,
  Tag,
  Tooltip,
  theme
} from 'antd'
import {
  ContainerOutlined,
  DatabaseOutlined
} from '@ant-design/icons'
import { APP_NAME, CONFIG_FILE_NAME } from '../../../shared/appInfo'
import type { InstanceMeta } from '../../../shared/types'
import { api } from '../api'
import { cleanError } from '../utils'
import RedisBrowser from './RedisBrowser'

interface InstancePaneProps {
  instance: InstanceMeta
  onUpdated: (instance: InstanceMeta) => void
  onOpenDatabase: (instanceId: string, database: string) => void
  onRemoveManual: (instanceId: string) => void
}

function statusTag(instance: InstanceMeta) {
  switch (instance.status) {
    case 'ready':
      return <Tag color="success">已连接</Tag>
    case 'needCredentials':
      return <Tag color="warning">需要凭据</Tag>
    case 'checking':
      return <Tag>连接中</Tag>
    default:
      return <Tag color="error">连接失败</Tag>
  }
}

function InstanceHeader({
  instance,
  onRemoveManual
}: {
  instance: InstanceMeta
  onRemoveManual: (instanceId: string) => void
}) {
  return (
    <div className="pane-header">
      <div className="pane-title">
        <span>{instance.label}</span>
        <Tag color={instance.kind === 'mysql' ? 'blue' : 'volcano'}>
          {instance.kind === 'mysql' ? 'MySQL' : 'Redis'}
        </Tag>
        {statusTag(instance)}
        {instance.manual ? <Tag>手动</Tag> : null}
      </div>
      <div className="pane-meta">
        <span className="mono">
          {instance.host}:{instance.port}
        </span>
        {instance.version ? <span>版本 {instance.version}</span> : null}
        {instance.username ? <span>用户 {instance.username}</span> : null}
        {instance.via === 'ssh' ? <Tag color="purple">SSH 转发</Tag> : null}
        {instance.via === 'local' && !instance.manual ? <Tag>本机进程</Tag> : null}
        {instance.container ? (
          <Tooltip title={`${instance.container.image} · 端口 ${instance.container.ports}`}>
            <Tag className="container-tag" icon={<ContainerOutlined />}>
              {instance.container.name}
            </Tag>
          </Tooltip>
        ) : null}
        {instance.manual ? (
          <Popconfirm
            title="移除这个手动连接？"
            description="会同时删除保存的凭据。"
            okText="移除"
            cancelText="取消"
            onConfirm={() => onRemoveManual(instance.id)}
          >
            <Button size="small" type="text" danger>
              移除手动连接
            </Button>
          </Popconfirm>
        ) : null}
      </div>
    </div>
  )
}

function ConnectionGate({
  instance,
  onUpdated
}: {
  instance: InstanceMeta
  onUpdated: (instance: InstanceMeta) => void
}) {
  const { message } = App.useApp()
  const [submitting, setSubmitting] = useState(false)
  const isMysql = instance.kind === 'mysql'

  const submit = async (values: { username?: string; password?: string }) => {
    setSubmitting(true)
    try {
      const updated = await api.setCredentials({
        instanceId: instance.id,
        username: isMysql ? values.username?.trim() || 'root' : undefined,
        password: values.password ?? ''
      })
      onUpdated(updated)
      message.success('连接成功，凭据已保存')
    } catch (error) {
      message.error(cleanError(error))
    } finally {
      setSubmitting(false)
    }
  }

  if (instance.status === 'checking') {
    return (
      <div className="center-fill">
        <Spin />
        <span>正在连接 {instance.host}:{instance.port} …</span>
      </div>
    )
  }

  return (
    <div className="pane-body" style={{ overflow: 'auto' }}>
      <div className="gate">
        <h2>{isMysql ? '需要 MySQL 账号密码' : '需要 Redis 访问密码'}</h2>
        <p>
          {APP_NAME} 自动尝试了常见凭据但未能连上。请手动填写后保存，
          下次启动会自动重连。
        </p>
        {instance.error ? (
          <Alert
            type={instance.status === 'needCredentials' ? 'warning' : 'error'}
            showIcon
            style={{ marginBottom: 16 }}
            title={instance.status === 'needCredentials' ? '认证失败' : '连接失败'}
            description={<span className="mono">{instance.error}</span>}
          />
        ) : null}

        <Form
          layout="vertical"
          onFinish={submit}
          initialValues={{ username: instance.username ?? 'root', password: '' }}
        >
          {isMysql ? (
            <Form.Item label="用户名" name="username">
              <Input autoComplete="off" placeholder="root" />
            </Form.Item>
          ) : null}
          <Form.Item label={isMysql ? '密码' : '密码（无密码可留空）'} name="password">
            <Input.Password autoComplete="off" placeholder={isMysql ? 'MySQL 密码' : 'Redis 密码'} />
          </Form.Item>
          <div className="gate-actions">
            <Button type="primary" htmlType="submit" loading={submitting}>
              连接并保存
            </Button>
          </div>
        </Form>
        <div className="gate-note">
          凭据会通过 Electron 的 IPC 保存在本机 userData 目录下的 {CONFIG_FILE_NAME} 中
          （明文，仅本机用户可读）。
        </div>
      </div>
    </div>
  )
}

function MysqlInstanceHome({
  instance,
  onOpenDatabase
}: {
  instance: InstanceMeta
  onOpenDatabase: (instanceId: string, database: string) => void
}) {
  const { token } = theme.useToken()
  const [databases, setDatabases] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api.mysql
      .databases(instance.id)
      .then((list) => {
        if (!cancelled) setDatabases(list)
      })
      .catch((err) => {
        if (!cancelled) setError(cleanError(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [instance.id, version])

  return (
    <div className="pane-body" style={{ overflow: 'auto' }}>
      <div className="instance-home">
        {error ? (
          <Alert
            type="error"
            showIcon
            title="读取数据库列表失败"
            description={<span className="mono">{error}</span>}
            action={
              <Button size="small" onClick={() => setVersion((v) => v + 1)}>
                重试
              </Button>
            }
          />
        ) : null}
        <div>
          <div className="section-title">数据库</div>
          <Table
            size="small"
            rowKey="name"
            loading={loading}
            dataSource={databases.map((name) => ({ name }))}
            pagination={false}
            scroll={{ y: 360 }}
            onRow={(record) => ({
              onClick: () => onOpenDatabase(instance.id, record.name),
              style: { cursor: 'pointer' }
            })}
            columns={[
              {
                title: '名称',
                dataIndex: 'name',
                render: (name: string) => (
                  <span>
                    <DatabaseOutlined style={{ marginRight: 8, opacity: 0.7 }} />
                    {name}
                  </span>
                )
              },
              {
                title: '',
                key: 'action',
                width: 90,
                render: (_value, record) => (
                  <Button size="small" type="link" onClick={() => onOpenDatabase(instance.id, record.name)}>
                    打开
                  </Button>
                )
              }
            ]}
            style={{ background: token.colorBgContainer, borderRadius: 8 }}
          />
        </div>
        <div className="muted">
          展开左侧实例节点也可以逐层浏览：实例 → 数据库 → 数据表。
        </div>
      </div>
    </div>
  )
}

export default function InstancePane({
  instance,
  onUpdated,
  onOpenDatabase,
  onRemoveManual
}: InstancePaneProps) {
  const ready = instance.status === 'ready'
  return (
    <div className="pane">
      <InstanceHeader instance={instance} onRemoveManual={onRemoveManual} />
      {!ready ? (
        <ConnectionGate instance={instance} onUpdated={onUpdated} />
      ) : instance.kind === 'redis' ? (
        <RedisBrowser instance={instance} />
      ) : (
        <MysqlInstanceHome instance={instance} onOpenDatabase={onOpenDatabase} />
      )}
    </div>
  )
}
