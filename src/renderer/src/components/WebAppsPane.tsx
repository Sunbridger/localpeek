import { useEffect, useMemo, useState } from 'react'
import { App, Button, Empty, Input, Modal, Popconfirm, Splitter, Tag, Tooltip } from 'antd'
import {
  EditOutlined,
  LinkOutlined,
  PlayCircleOutlined,
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

function processesOf(record: WebAppInfo): Array<{
  pid?: number
  user?: string
  command: string
  commandLine?: string
}> {
  return record.processes && record.processes.length > 0
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
}

interface PortRowProps {
  record: WebAppInfo
  focused: boolean
  logOpen: boolean
  killing: boolean
  starting: boolean
  onOpen: (app: WebAppInfo) => void
  onKill: (app: WebAppInfo) => void
  onStart: (app: WebAppInfo) => void
  onToggleLog: (port: number) => void
}

function PortRow({
  record,
  focused,
  logOpen,
  killing,
  starting,
  onOpen,
  onKill,
  onStart,
  onToggleLog
}: PortRowProps) {
  const processes = processesOf(record)
  const pageText = record.title || record.server || record.contentType || '—'
  const processTooltip = record.online ? (
    <div className="web-process-tooltip">
      {processes.map((item) => (
        <div key={item.pid}>
          PID {item.pid} · {item.command} · {item.user}
        </div>
      ))}
      {record.commandLine ? <div className="mono">{record.commandLine}</div> : null}
    </div>
  ) : (
    record.commandLine || record.command
  )

  return (
    <div
      className={[
        'port-row',
        record.online ? '' : 'is-offline',
        focused ? 'is-focused' : '',
        logOpen ? 'is-log-target' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      data-port={record.port}
    >
      <div className="port-main">
        <span
          className={`port-status-dot ${record.online ? 'is-online' : 'is-offline'}`}
          aria-hidden="true"
        />
        {record.online ? (
          <button
            type="button"
            className="port-link mono"
            onClick={() => onOpen(record)}
            title={`在浏览器打开 :${record.port}`}
          >
            :{record.port}
          </button>
        ) : (
          <span className="port-offline mono">:{record.port}</span>
        )}
        <Tooltip
          title={
            record.online
              ? `HTTP ${record.status ?? '—'}${record.server ? ` · ${record.server}` : ''}`
              : `上次在线：${formatDateTime(record.lastSeenAt)}`
          }
        >
          <Tag color={record.online ? 'success' : undefined} className="port-tag">
            {record.online ? '在线' : '已离线'}
          </Tag>
        </Tooltip>
        <Tag color={ROLE_META[record.role].color} className="port-tag">
          {ROLE_META[record.role].label}
        </Tag>
      </div>

      <div className="port-page">
        <Tooltip
          title={[record.server, record.contentType].filter(Boolean).join(' · ') || pageText}
          placement="topLeft"
        >
          <span className="port-page-text">{pageText}</span>
        </Tooltip>
      </div>

      <div className="port-process">
        <Tooltip title={processTooltip} placement="topLeft">
          <div
            className="web-process web-process-clickable"
            role="button"
            tabIndex={0}
            aria-label={`查看端口 ${record.port} 的实时日志`}
            onClick={(event) => {
              event.stopPropagation()
              onToggleLog(record.port)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              onToggleLog(record.port)
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
      </div>

      <div className="port-actions">
        {record.online ? (
          <>
            <Tooltip title="在浏览器打开">
              <Button
                size="small"
                type="text"
                className="port-action"
                icon={<LinkOutlined />}
                aria-label={`打开端口 ${record.port}`}
                onClick={() => onOpen(record)}
              />
            </Tooltip>
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
                        {processes.length > 1 ? ` 等 ${processes.length} 个进程` : ''}
                      </div>
                    </div>
                  }
                  okText="关闭进程"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  disabled={!record.killable}
                  onConfirm={() => onKill(record)}
                >
                  <Button
                    size="small"
                    type="text"
                    danger
                    className="port-action"
                    disabled={!record.killable}
                    loading={killing}
                    icon={<StopOutlined />}
                    aria-label={`关闭端口 ${record.port}`}
                  />
                </Popconfirm>
              </span>
            </Tooltip>
          </>
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
                onConfirm={() => onStart(record)}
              >
                <Button
                  size="small"
                  type="text"
                  className="port-action"
                  disabled={!record.startable}
                  loading={starting}
                  icon={<PlayCircleOutlined />}
                  aria-label={`启动端口 ${record.port}`}
                />
              </Popconfirm>
            </span>
          </Tooltip>
        )}
      </div>
    </div>
  )
}

export default function WebAppsPane({
  webApps,
  focusPort,
  onWebAppsUpdated
}: WebAppsPaneProps) {
  const { message } = App.useApp()
  const [killingPort, setKillingPort] = useState<number | null>(null)
  const [startingPort, setStartingPort] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [batch, setBatch] = useState<{ name: string; action: 'start' | 'stop' } | null>(null)
  const [logPorts, setLogPorts] = useState<number[]>(readStoredLogPorts)
  const [projectEdit, setProjectEdit] = useState<{
    name: string
    keys: string[]
    autoName: string
    overridden: boolean
  } | null>(null)
  const [projectNameInput, setProjectNameInput] = useState('')
  const [savingProject, setSavingProject] = useState(false)

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

  const refresh = async (): Promise<void> => {
    try {
      const apps = await api.web.scan()
      onWebAppsUpdated(apps)
      const online = apps.filter((app) => app.online).length
      message.success(`扫描完成，在线 ${online} 个 · 历史 ${apps.length} 个`)
    } catch (error) {
      message.error(cleanError(error))
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

  const openProjectEdit = (group: ProjectGroup): void => {
    const keys = [
      ...new Set(
        group.entries
          .map((entry) => entry.projectKey)
          .filter((key): key is string => Boolean(key))
      )
    ]
    if (keys.length === 0) {
      message.info('该分组没有可保存的项目标识')
      return
    }
    const autoName =
      group.entries.find((entry) => entry.projectAuto)?.projectAuto ?? group.name
    const overridden = group.entries.some(
      (entry) => entry.projectKey && entry.projectAuto !== entry.project
    )
    setProjectEdit({ name: group.name, keys, autoName, overridden })
    setProjectNameInput(group.name)
  }

  const saveProjectName = async (): Promise<void> => {
    if (!projectEdit) return
    const name = projectNameInput.trim()
    if (!name) {
      message.error('项目名不能为空')
      return
    }
    setSavingProject(true)
    try {
      const current = await api.settings()
      const projectOverrides = { ...current.projectOverrides }
      for (const key of projectEdit.keys) projectOverrides[key] = name
      await api.updateSettings({ projectOverrides })
      setProjectEdit(null)
      await refresh()
    } catch (error) {
      message.error(cleanError(error))
    } finally {
      setSavingProject(false)
    }
  }

  const resetProjectName = async (): Promise<void> => {
    if (!projectEdit) return
    setSavingProject(true)
    try {
      const current = await api.settings()
      const projectOverrides = { ...current.projectOverrides }
      for (const key of projectEdit.keys) delete projectOverrides[key]
      await api.updateSettings({ projectOverrides })
      setProjectEdit(null)
      await refresh()
    } catch (error) {
      message.error(cleanError(error))
    } finally {
      setSavingProject(false)
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
        </div>
      </div>

      <div className="pane-toolbar">
        <Input
          allowClear
          className="pane-search"
          prefix={<SearchOutlined />}
          placeholder="按项目 / 端口 / 标题搜索"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {search ? (
          <Button type="link" size="small" onClick={() => setSearch('')}>
            清除筛选
          </Button>
        ) : null}
        <span className="muted" style={{ marginLeft: 'auto' }}>
          显示 {filtered.length} / {webApps.length}
        </span>
      </div>

      <div className="pane-body">
        <Splitter orientation="vertical" className="web-splitter">
          <Splitter.Panel min={160} style={{ overflow: 'hidden' }}>
            <div className="web-list-scroll">
              {displayGroups.length === 0 ? (
                <div className="web-empty">
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                      <span className="muted">
                        {webApps.length > 0
                          ? '没有匹配的项目或端口'
                          : '暂无在线或历史记录。启动前端 / 后端后点击右上角「重新扫描」。'}
                      </span>
                    }
                  />
                </div>
              ) : (
                <>
                  <div className="port-list-head" aria-hidden="true">
                    <span>端口 / 状态</span>
                    <span>页面 / 服务</span>
                    <span>进程</span>
                    <span>操作</span>
                  </div>
                  {displayGroups.map((group) => {
                    const info = projectByName.get(group.name)
                    if (!info) return null
                    const visible = group.rows.length
                    const startLoading =
                      batch?.name === info.name && batch.action === 'start'
                    const stopLoading =
                      batch?.name === info.name && batch.action === 'stop'
                    return (
                      <section className="project-block" key={group.name}>
                        <header className="project-head">
                          <div className="project-title">
                            <span
                              className={`project-dot ${
                                info.online > 0 ? 'is-online' : 'is-offline'
                              }`}
                              aria-hidden="true"
                            />
                            <button
                              type="button"
                              className="project-name"
                              title={`筛选 ${info.name}`}
                              onClick={() => setSearch(info.name)}
                            >
                              {info.name}
                            </button>
                            <span className="project-meta">
                              在线 {info.online} / {info.entries.length}
                            </span>
                            {visible < info.entries.length ? (
                              <span className="project-meta">· 显示 {visible}</span>
                            ) : null}
                            <Tooltip title="重命名或合并项目">
                              <Button
                                size="small"
                                type="text"
                                className="project-edit"
                                icon={<EditOutlined />}
                                aria-label={`重命名或合并 ${info.name}`}
                                onClick={() => openProjectEdit(info)}
                              />
                            </Tooltip>
                          </div>
                          <div className="project-actions">
                            <Tooltip title={`启动 ${info.name} 的离线端口`}>
                              <Button
                                size="small"
                                type="text"
                                icon={<PlayCircleOutlined />}
                                disabled={info.startable === 0 || batch !== null}
                                loading={startLoading}
                                onClick={() => startProject(info)}
                              >
                                启动 {info.startable > 0 ? info.startable : ''}
                              </Button>
                            </Tooltip>
                            <Popconfirm
                              title={`关闭 ${info.name} 的 ${info.killable} 个在线端口？`}
                              description="将对项目内所有在线端口执行 SIGTERM → SIGKILL"
                              okText="全部关闭"
                              cancelText="取消"
                              okButtonProps={{ danger: true }}
                              disabled={info.killable === 0 || batch !== null}
                              onConfirm={() => stopProject(info)}
                            >
                              <Button
                                size="small"
                                type="text"
                                danger
                                icon={<StopOutlined />}
                                disabled={info.killable === 0 || batch !== null}
                                loading={stopLoading}
                              >
                                停止 {info.killable > 0 ? info.killable : ''}
                              </Button>
                            </Popconfirm>
                          </div>
                        </header>
                        <div className="port-list">
                          {group.rows.map((record) => (
                            <PortRow
                              key={record.port}
                              record={record}
                              focused={record.port === focusPort}
                              logOpen={logPorts.includes(record.port)}
                              killing={killingPort === record.port}
                              starting={startingPort === record.port}
                              onOpen={open}
                              onKill={kill}
                              onStart={start}
                              onToggleLog={toggleLog}
                            />
                          ))}
                        </div>
                      </section>
                    )
                  })}
                </>
              )}
              <div className="muted web-list-note">
                项目名优先从进程工作目录向上识别 git 仓库 / package.json 等项目根；识别不到时显示
                「未识别项目」，点项目名旁的铅笔手动命名或合并。离线记录保留最近 50 条。
                点击「进程」查看实时输出，最多并排 4 个（超出时替换最早打开的），分隔条可拖动，
                再次点击收起。Docker / SSH 转发或非当前用户的进程只展示，不会直接结束。
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

        <Modal
          open={projectEdit !== null}
          title="重命名或合并项目"
          okText="保存"
          cancelText="取消"
          confirmLoading={savingProject}
          onOk={saveProjectName}
          onCancel={() => setProjectEdit(null)}
        >
          {projectEdit ? (
            <div className="project-edit-body">
              <Input
                autoFocus
                value={projectNameInput}
                onChange={(event) => setProjectNameInput(event.target.value)}
                onPressEnter={saveProjectName}
                placeholder="项目名称"
              />
              <div className="project-edit-hint">
                输入已有项目名即可合并；保存后会重新扫描。自动识别名：
                {projectEdit.autoName}
              </div>
              <div className="project-suggestions">
                {projects
                  .filter((group) => group.name !== projectEdit.name)
                  .map((group) => (
                    <Tag
                      key={group.name}
                      className="project-suggestion"
                      onClick={() => setProjectNameInput(group.name)}
                    >
                      {group.name}
                    </Tag>
                  ))}
              </div>
              {projectEdit.overridden ? (
                <Button size="small" className="project-reset" onClick={resetProjectName}>
                  恢复自动名称
                </Button>
              ) : null}
            </div>
          ) : null}
        </Modal>
      </div>
    </div>
  )
}
