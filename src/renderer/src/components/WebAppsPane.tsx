import { useEffect, useMemo, useState } from 'react'
import {
  App,
  Button,
  Empty,
  Input,
  Popconfirm,
  Space,
  Splitter,
  Table,
  Tag,
  Tooltip
} from 'antd'
import {
  LinkOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SearchOutlined,
  StopOutlined
} from '@ant-design/icons'
import type { WebAppInfo, WebAppRole } from '../../../shared/types'
import { api } from '../api'
import { cleanError, formatDateTime } from '../utils'
import WebLogPanel from './WebLogPanel'
import { MAX_LOG_PANELS, sanitizeLogPorts, toggleLogPort } from '../webLogPorts'

const LOG_PORTS_STORAGE_KEY = 'localpeek.webLogPorts.v1'
const LEGACY_LOG_PORT_STORAGE_KEY = 'localpeek.webLogPort.v1'

function readStoredLogPorts(): number[] {
  try {
    const raw = window.localStorage.getItem(LOG_PORTS_STORAGE_KEY)
    if (raw) return sanitizeLogPorts(JSON.parse(raw))
    const legacy = window.localStorage.getItem(LEGACY_LOG_PORT_STORAGE_KEY)
    if (!legacy) return []
    return sanitizeLogPorts([JSON.parse(legacy)])
  } catch {
    return []
  }
}

interface WebAppsPaneProps {
  webApps: WebAppInfo[]
  focusPort?: number
  onWebAppsUpdated: (apps: WebAppInfo[]) => void
}

interface ProjectGroup {
  name: string
  entries: WebAppInfo[]
  online: number
  offline: number
  startable: number
  killable: number
}

const ROLE_META: Record<WebAppRole, { label: string; color: string }> = {
  frontend: { label: '前端', color: 'cyan' },
  backend: { label: '后端', color: 'geekblue' },
  web: { label: 'Web', color: 'default' }
}

const UNKNOWN_PROJECT = '未识别项目'

function projectNameOf(app: WebAppInfo): string {
  return app.project || UNKNOWN_PROJECT
}

export default function WebAppsPane({
  webApps,
  focusPort,
  onWebAppsUpdated
}: WebAppsPaneProps) {
  const { message } = App.useApp()
  const [scanning, setScanning] = useState(false)
  const [killingPort, setKillingPort] = useState<number | null>(null)
  const [startingPort, setStartingPort] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [batch, setBatch] = useState<{ name: string; action: 'start' | 'stop' } | null>(null)
  const [logPorts, setLogPorts] = useState<number[]>(readStoredLogPorts)

  useEffect(() => {
    try {
      if (logPorts.length === 0) window.localStorage.removeItem(LOG_PORTS_STORAGE_KEY)
      else window.localStorage.setItem(LOG_PORTS_STORAGE_KEY, JSON.stringify(logPorts))
      window.localStorage.removeItem(LEGACY_LOG_PORT_STORAGE_KEY)
    } catch {
      // localStorage 不可用时仅保留会话内状态
    }
  }, [logPorts])

  useEffect(() => {
    if (webApps.length === 0) return
    setLogPorts((previous) => {
      const next = previous.filter((port) => webApps.some((app) => app.port === port))
      return next.length === previous.length ? previous : next
    })
  }, [webApps])

  const toggleLog = (port: number): void => {
    if (!logPorts.includes(port) && logPorts.length >= MAX_LOG_PANELS) {
      message.info(`最多同时查看 ${MAX_LOG_PANELS} 个日志，已替换 :${logPorts[0]}`)
    }
    setLogPorts((previous) => toggleLogPort(previous, port))
  }

  const onlineCount = webApps.filter((app) => app.online).length
  const offlineCount = webApps.length - onlineCount

  const projects = useMemo<ProjectGroup[]>(() => {
    const map = new Map<string, ProjectGroup>()
    for (const app of webApps) {
      const name = projectNameOf(app)
      let group = map.get(name)
      if (!group) {
        group = { name, entries: [], online: 0, offline: 0, startable: 0, killable: 0 }
        map.set(name, group)
      }
      group.entries.push(app)
      if (app.online) {
        group.online++
        if (app.killable) group.killable++
      } else {
        group.offline++
        if (app.startable) group.startable++
      }
    }
    return [...map.values()].sort((a, b) => b.online - a.online || a.name.localeCompare(b.name))
  }, [webApps])

  const normalizedSearch = search.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!normalizedSearch) return webApps
    return webApps.filter((app) =>
      [
        projectNameOf(app),
        String(app.port),
        app.title,
        app.commandLine,
        app.command,
        ROLE_META[app.role].label
      ].some((value) => value?.toLowerCase().includes(normalizedSearch))
    )
  }, [webApps, normalizedSearch])

  const projectByName = useMemo(
    () => new Map(projects.map((group) => [group.name, group])),
    [projects]
  )

  const displayGroups = useMemo(() => {
    const map = new Map<string, WebAppInfo[]>()
    for (const app of filtered) {
      const name = projectNameOf(app)
      const list = map.get(name) ?? []
      list.push(app)
      map.set(name, list)
    }
    const order = new Map(projects.map((group, index) => [group.name, index]))
    return [...map.entries()]
      .sort((a, b) => (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0))
      .map(([name, rows]) => ({
        name,
        rows: rows.sort((a, b) =>
          a.online === b.online ? a.port - b.port : a.online ? -1 : 1
        )
      }))
  }, [filtered, projects])

  const orderedRows = useMemo(
    () => displayGroups.flatMap((group) => group.rows),
    [displayGroups]
  )

  const firstRowIndexByName = useMemo(() => {
    const map = new Map<string, number>()
    let index = 0
    for (const group of displayGroups) {
      map.set(group.name, index)
      index += group.rows.length
    }
    return map
  }, [displayGroups])

  const groupSizeByName = useMemo(() => {
    const map = new Map<string, number>()
    for (const group of displayGroups) map.set(group.name, group.rows.length)
    return map
  }, [displayGroups])

  const refresh = async (): Promise<void> => {
    setScanning(true)
    try {
      const apps = await api.web.scan()
      onWebAppsUpdated(apps)
      const online = apps.filter((app) => app.online).length
      message.success(`扫描完成，在线 ${online} 个 · 历史 ${apps.length} 个`)
    } catch (error) {
      message.error(cleanError(error))
    } finally {
      setScanning(false)
    }
  }

  const kill = async (app: WebAppInfo): Promise<void> => {
    if (!app.pid) return
    setKillingPort(app.port)
    try {
      const result = await api.web.kill(app.port, app.pid)
      onWebAppsUpdated(result.webApps)
      if (result.ok) message.success(result.message)
      else message.warning(result.message)
    } catch (error) {
      message.error(cleanError(error))
    } finally {
      setKillingPort(null)
    }
  }

  const start = async (app: WebAppInfo): Promise<void> => {
    setStartingPort(app.port)
    try {
      const result = await api.web.start(app.port)
      onWebAppsUpdated(result.webApps)
      if (result.ok) message.success(result.message)
      else message.warning(result.message)
    } catch (error) {
      message.error(cleanError(error))
    } finally {
      setStartingPort(null)
    }
  }

  const startProject = async (group: ProjectGroup): Promise<void> => {
    const ports = group.entries
      .filter((app) => !app.online && app.startable)
      .map((app) => app.port)
    if (ports.length === 0) {
      message.info(`${group.name} 没有可启动的离线端口`)
      return
    }
    setBatch({ name: group.name, action: 'start' })
    try {
      const result = await api.web.startMany(ports)
      onWebAppsUpdated(result.webApps)
      if (result.ok) message.success(result.message)
      else message.warning(result.message)
    } catch (error) {
      message.error(cleanError(error))
    } finally {
      setBatch(null)
    }
  }

  const stopProject = async (group: ProjectGroup): Promise<void> => {
    const items = group.entries
      .filter((app) => app.online && app.killable && app.pid)
      .map((app) => ({ port: app.port, pid: app.pid as number }))
    if (items.length === 0) {
      message.info(`${group.name} 没有可关闭的在线端口`)
      return
    }
    setBatch({ name: group.name, action: 'stop' })
    try {
      const result = await api.web.killMany(items)
      onWebAppsUpdated(result.webApps)
      if (result.ok) message.success(result.message)
      else message.warning(result.message)
    } catch (error) {
      message.error(cleanError(error))
    } finally {
      setBatch(null)
    }
  }

  const open = async (app: WebAppInfo): Promise<void> => {
    try {
      await api.openExternal(app.url)
    } catch (error) {
      message.error(cleanError(error))
    }
  }

  return (
    <div className="pane">
      <div className="pane-header">
        <div className="pane-title">
          <span>Web 应用</span>
          <Tag color="cyan">项目与端口管理</Tag>
        </div>
        <div className="pane-meta">
          <span>在线 {onlineCount}</span>
          <span className="muted">·</span>
          <span>离线 {offlineCount}</span>
          <span className="muted">·</span>
          <span>历史最多保留 50 条</span>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={scanning}
            onClick={refresh}
          >
            重新检测
          </Button>
        </div>
      </div>

      <div className="pane-body">
        <div className="web-toolbar" style={{ padding: '12px 16px 0' }}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="按项目 / 端口 / 标题搜索"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            style={{ width: 280 }}
          />
          {search ? (
            <Button type="link" size="small" onClick={() => setSearch('')}>
              清除筛选
            </Button>
          ) : null}
          <div style={{ flex: 1 }} />
          <span className="muted">
            显示 {filtered.length} / {webApps.length}
          </span>
        </div>

        <Splitter orientation="vertical" className="web-splitter">
          <Splitter.Panel min={160} style={{ overflow: 'hidden' }}>
            <div className="web-table-scroll">
        <Table
          size="small"
          rowKey="port"
          dataSource={orderedRows}
          pagination={false}
          scroll={{ x: 'max-content' }}
          rowClassName={(record) =>
            [
              record.port === focusPort ? 'row-active' : '',
              record.online ? '' : 'row-offline',
              logPorts.includes(record.port) ? 'row-log-target' : ''
            ]
              .filter(Boolean)
              .join(' ')
          }
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <span className="muted">
                    {webApps.length > 0
                      ? '没有匹配的项目或端口'
                      : '暂无在线或历史记录。启动前端 / 后端后点击「重新检测」。'}
                  </span>
                }
              />
            )
          }}
          columns={[
            {
              title: '项目',
              key: 'project',
              width: 232,
              onCell: (record, rowIndex) => {
                const name = projectNameOf(record)
                const first = firstRowIndexByName.get(name)
                const size = groupSizeByName.get(name) ?? 1
                return { rowSpan: rowIndex === first ? size : 0, style: { verticalAlign: 'top' } }
              },
              render: (_value, record) => {
                const group = projectByName.get(projectNameOf(record))
                if (!group) return null
                const startLoading =
                  batch?.name === group.name && batch.action === 'start'
                const stopLoading =
                  batch?.name === group.name && batch.action === 'stop'
                return (
                  <div className="project-merged-cell">
                    <div className="project-merged-head">
                      <span
                        className="web-project-cell"
                        title={group.name}
                        onClick={() => setSearch(group.name)}
                      >
                        {group.name}
                      </span>
                      <span className="project-count">
                        在线 {group.online} / {group.entries.length}
                      </span>
                    </div>
                    <div className="project-merged-actions">
                      <Tooltip title={`启动 ${group.name} 的离线端口`}>
                        <Button
                          size="small"
                          type="text"
                          icon={<PlayCircleOutlined />}
                          disabled={group.startable === 0 || batch !== null}
                          loading={startLoading}
                          onClick={() => startProject(group)}
                        >
                          启动 {group.startable > 0 ? group.startable : ''}
                        </Button>
                      </Tooltip>
                      <Popconfirm
                        title={`关闭 ${group.name} 的 ${group.killable} 个在线端口？`}
                        description="将对项目内所有在线端口执行 SIGTERM → SIGKILL"
                        okText="全部关闭"
                        cancelText="取消"
                        okButtonProps={{ danger: true }}
                        disabled={group.killable === 0 || batch !== null}
                        onConfirm={() => stopProject(group)}
                      >
                        <Button
                          size="small"
                          type="text"
                          danger
                          icon={<StopOutlined />}
                          disabled={group.killable === 0 || batch !== null}
                          loading={stopLoading}
                        >
                          停止 {group.killable > 0 ? group.killable : ''}
                        </Button>
                      </Popconfirm>
                    </div>
                  </div>
                )
              }
            },
            {
              title: '端口',
              dataIndex: 'port',
              width: 150,
              render: (port: number, record) =>
                record.online ? (
                  <Button
                    type="link"
                    size="small"
                    className="mono web-port-link"
                    onClick={() => open(record)}
                  >
                    :{port}
                  </Button>
                ) : (
                  <span className="mono web-port-offline">:{port}</span>
                )
            },
            {
              title: '状态',
              key: 'state',
              width: 100,
              render: (_value, record) =>
                record.online ? (
                  <Tooltip
                    title={`HTTP ${record.status ?? '—'}${record.server ? ` · ${record.server}` : ''}`}
                  >
                    <Tag color="success">在线</Tag>
                  </Tooltip>
                ) : (
                  <Tooltip title={`上次在线：${formatDateTime(record.lastSeenAt)}`}>
                    <Tag>已离线</Tag>
                  </Tooltip>
                )
            },
            {
              title: '角色',
              dataIndex: 'role',
              width: 90,
              render: (role: WebAppRole) => (
                <Tag color={ROLE_META[role].color}>{ROLE_META[role].label}</Tag>
              )
            },
            {
              title: '页面 / 服务',
              key: 'page',
              render: (_value, record) => {
                const text = record.title || record.server || record.contentType || '—'
                return (
                  <Tooltip
                    title={[record.server, record.contentType].filter(Boolean).join(' · ') || text}
                    placement="topLeft"
                  >
                    <span className="web-page-cell">{text}</span>
                  </Tooltip>
                )
              }
            },
            {
              title: '进程',
              key: 'process',
              render: (_value, record) => {
                const processes =
                  record.processes && record.processes.length > 0
                    ? record.processes
                    : record.online
                      ? [
                          {
                            pid: record.pid,
                            user: record.user,
                            command: record.command,
                            commandLine: record.commandLine
                          }
                        ]
                      : []
                return (
                  <Tooltip
                    title={
                      record.online ? (
                        <div className="web-process-tooltip">
                          {processes.map((item) => (
                            <div key={item.pid}>
                              PID {item.pid} · {item.command} · {item.user}
                            </div>
                          ))}
                          {record.commandLine ? (
                            <div className="mono">{record.commandLine}</div>
                          ) : null}
                        </div>
                      ) : (
                        record.commandLine || record.command
                      )
                    }
                    placement="topLeft"
                  >
                    <div
                      className="web-process web-process-clickable"
                      role="button"
                      tabIndex={0}
                      aria-label={`查看端口 ${record.port} 的实时日志`}
                      onClick={(event) => {
                        event.stopPropagation()
                        toggleLog(record.port)
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return
                        event.preventDefault()
                        toggleLog(record.port)
                      }}
                    >
                      <span className="mono">
                        {record.command}
                        {processes.length > 1 ? ` +${processes.length - 1}` : ''}
                      </span>
                      <span className="muted">
                        {record.online
                          ? `PID ${record.pid} · ${record.user}${
                              processes.length > 1 ? ` · 共 ${processes.length} 个进程` : ''
                            }`
                          : `上次在线 ${formatDateTime(record.lastSeenAt)}`}
                      </span>
                    </div>
                  </Tooltip>
                )
              }
            },
            {
              title: '操作',
              key: 'actions',
              width: 200,
              render: (_value, record) =>
                record.online ? (
                  <Space size={4}>
                    <Button
                      size="small"
                      type="text"
                      icon={<LinkOutlined />}
                      onClick={() => open(record)}
                    >
                      打开
                    </Button>
                    <Tooltip
                      title={
                        record.killable
                          ? '先 SIGTERM，未退出再 SIGKILL'
                          : record.killBlockedReason || '不可关闭'
                      }
                    >
                      <span>
                        <Popconfirm
                          title={`强制关闭端口 ${record.port}？`}
                          description={
                            <div className="kill-confirm">
                              <div className="mono">{record.commandLine || record.command}</div>
                              <div className="muted">
                              PID {record.pid}
                              {record.processes && record.processes.length > 1
                                ? ` 等 ${record.processes.length} 个进程`
                                : ''}
                            </div>
                            </div>
                          }
                          okText="关闭进程"
                          cancelText="取消"
                          okButtonProps={{ danger: true }}
                          disabled={!record.killable}
                          onConfirm={() => kill(record)}
                        >
                          <Button
                            size="small"
                            type="text"
                            danger
                            disabled={!record.killable}
                            loading={killingPort === record.port}
                            icon={<StopOutlined />}
                          >
                            关闭
                          </Button>
                        </Popconfirm>
                      </span>
                    </Tooltip>
                  </Space>
                ) : (
                  <Tooltip
                    title={
                      record.startable
                        ? '按上次的目录与命令重新启动'
                        : '缺少历史启动命令或工作目录，无法一键启动'
                    }
                  >
                    <span>
                      <Popconfirm
                        title={`重新启动端口 ${record.port}？`}
                        description={
                          <div className="kill-confirm">
                            <div className="muted">{record.cwd || '未知目录'}</div>
                            <div className="mono">{record.commandLine || record.command}</div>
                          </div>
                        }
                        okText="启动服务"
                        cancelText="取消"
                        disabled={!record.startable}
                        onConfirm={() => start(record)}
                      >
                        <Button
                          size="small"
                          type="text"
                          disabled={!record.startable}
                          loading={startingPort === record.port}
                          icon={<PlayCircleOutlined />}
                        >
                          启动
                        </Button>
                      </Popconfirm>
                    </span>
                  </Tooltip>
                )
            }
          ]}
        />
        <div className="muted" style={{ marginTop: 10, fontSize: 11.5, lineHeight: 1.7 }}>
          项目名取自命令行 / 工作目录中的 /mycode/&lt;项目&gt;/ 或 /code/&lt;项目&gt;/；离线记录保留最近
          50 条，按项目一键启动会在原工作目录执行各自上次命令。Docker / SSH 转发或非当前用户的进程只展示，不会直接结束。
          点击「进程」查看实时输出，最多并排 4 个（超出时替换最早打开的），分隔条可拖动调整宽度，
          再次点击收起。
        </div>
            </div>
          </Splitter.Panel>
          {logPorts.length > 0 ? (
            <Splitter.Panel defaultSize={260} min={140} style={{ overflow: 'hidden' }}>
              <Splitter
                key={logPorts.join(',')}
                orientation="horizontal"
                className="web-log-splitter"
              >
                {logPorts.map((port) => (
                  <Splitter.Panel key={port} min={180} style={{ overflow: 'hidden' }}>
                    <WebLogPanel
                      port={port}
                      app={webApps.find((app) => app.port === port)}
                      onClose={() =>
                        setLogPorts((previous) =>
                          previous.filter((item) => item !== port)
                        )
                      }
                      onWebAppsUpdated={onWebAppsUpdated}
                    />
                  </Splitter.Panel>
                ))}
              </Splitter>
            </Splitter.Panel>
          ) : null}
        </Splitter>
      </div>
    </div>
  )
}
