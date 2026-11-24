import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, App, Button, Popconfirm, Spin, Tag, Tooltip } from 'antd'
import {
  ArrowDownOutlined,
  CloseOutlined,
  CopyOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import { APP_NAME } from '../../../shared/appInfo'
import { LIMITS } from '../../../shared/limits'
import type { WebAppInfo, WebLogInfo, WebLogSource } from '../../../shared/types'
import { api } from '../api'
import { cleanError, copyText } from '../utils'

const MAX_LOG_LINES = LIMITS.webLogLines

const SOURCE_META: Record<WebLogSource, { label: string; color: string }> = {
  launch: { label: `${APP_NAME} 启动`, color: 'green' },
  file: { label: '外部日志文件', color: 'blue' },
  unavailable: { label: '不可读', color: 'default' }
}

interface WebLogPanelProps {
  port: number
  app?: WebAppInfo
  onClose: () => void
  onWebAppsUpdated: (apps: WebAppInfo[]) => void
}

export default function WebLogPanel({
  port,
  app,
  onClose,
  onWebAppsUpdated
}: WebLogPanelProps) {
  const { message } = App.useApp()
  const [info, setInfo] = useState<WebLogInfo | null>(null)
  const [lines, setLines] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [restarting, setRestarting] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const viewRef = useRef<HTMLPreElement | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const followRef = useRef(true)

  // 面板拖动改变宽度后，若仍处于跟随状态则保持在最新一行
  const attachView = useCallback((node: HTMLPreElement | null) => {
    viewRef.current = node
    resizeObserverRef.current?.disconnect()
    resizeObserverRef.current = null
    if (!node) return
    const observer = new ResizeObserver(() => {
      if (followRef.current) node.scrollTop = node.scrollHeight
    })
    observer.observe(node)
    resizeObserverRef.current = observer
    node.scrollTop = node.scrollHeight
  }, [])

  useEffect(() => () => resizeObserverRef.current?.disconnect(), [])
  // 进程启停或被其他进程重新占用端口时，PID 集合会变化，需要重新解析日志来源
  const sessionKey = `${app?.online ? 'online' : 'offline'}:${
    app?.pids?.join(',') ?? app?.pid ?? ''
  }`

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setInfo(null)
    setLines([])
    setError(null)
    followRef.current = true
    setAtBottom(true)

    const unsubscribe = api.web.onLogLines((event) => {
      if (event.port !== port) return
      setLines((previous) => {
        const next = [...previous, ...event.lines]
        return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next
      })
    })

    api.web
      .followLog(port)
      .then((data) => {
        if (cancelled) return
        setInfo(data)
        setLines(data.lines.slice(-MAX_LOG_LINES))
      })
      .catch((err) => {
        if (!cancelled) setError(cleanError(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
      unsubscribe()
      void api.web.unfollowLog(port).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [port, sessionKey])

  useEffect(() => {
    const view = viewRef.current
    if (!view || !followRef.current) return
    view.scrollTop = view.scrollHeight
  }, [lines])

  const handleScroll = (): void => {
    const view = viewRef.current
    if (!view) return
    const bottom = view.scrollHeight - view.scrollTop - view.clientHeight < 24
    followRef.current = bottom
    setAtBottom(bottom)
  }

  const scrollToLatest = (): void => {
    const view = viewRef.current
    if (!view) return
    view.scrollTop = view.scrollHeight
    followRef.current = true
    setAtBottom(true)
  }

  const copyAll = async (): Promise<void> => {
    try {
      await copyText(lines.join('\n'))
      message.success('已复制日志')
    } catch {
      message.error('复制失败')
    }
  }

  const restart = async (): Promise<void> => {
    setRestarting(true)
    try {
      const result = await api.web.restartForLog(port)
      // webApps 更新后 PID 集合变化，会触发上面的 effect 重新解析来源并订阅
      onWebAppsUpdated(result.webApps)
      if (result.ok) message.success('已重启，正在捕获输出')
      else message.warning(result.message)
    } catch (err) {
      message.error(cleanError(err))
    } finally {
      setRestarting(false)
    }
  }

  const source = info?.source
  const unavailable = source === 'unavailable' || (!loading && !info && error !== null)
  const reason =
    info?.reason ?? error ?? '无法读取该进程的输出'
  const online = info ? info.online : Boolean(app?.online)
  const pidLabel =
    app?.processes && app.processes.length > 0
      ? app.processes.map((item) => item.pid).join('、')
      : app?.pid
        ? String(app.pid)
        : undefined

  return (
    <div className="web-log-panel">
      <div className="web-log-head">
        <span className="mono web-log-title">:{port} 输出</span>
        {source ? (
          <Tag className="web-log-source" color={SOURCE_META[source].color}>
            {SOURCE_META[source].label}
          </Tag>
        ) : null}
        <Tag className="web-log-online" color={online ? 'success' : 'default'}>
          {online ? '在线' : '已结束'}
        </Tag>
        {pidLabel ? <span className="muted web-log-pid">PID {pidLabel}</span> : null}
        {info?.path ? (
          <Tooltip title={info.path}>
            <span className="muted web-log-path">{info.path}</span>
          </Tooltip>
        ) : null}
        <div style={{ flex: 1 }} />
        {!atBottom && !unavailable ? (
          <Button size="small" type="text" icon={<ArrowDownOutlined />} onClick={scrollToLatest}>
            回到最新
          </Button>
        ) : null}
        <span className="muted web-log-count">
          {lines.length} / {MAX_LOG_LINES} 行
        </span>
        <Tooltip title="复制全部日志">
          <Button
            size="small"
            type="text"
            disabled={lines.length === 0}
            icon={<CopyOutlined />}
            onClick={copyAll}
          />
        </Tooltip>
        <Button
          size="small"
          type="text"
          aria-label="关闭日志面板"
          icon={<CloseOutlined />}
          onClick={onClose}
        />
      </div>

      <div className="web-log-body">
        {loading ? (
          <div className="web-log-center">
            <Spin size="small" />
          </div>
        ) : unavailable ? (
          <div className="web-log-center">
            <Alert
              type="warning"
              showIcon
              title="无法读取该进程的输出"
              description={
                <div className="web-log-reason">
                  <div>{reason}</div>
                  <div className="muted" style={{ marginTop: 6 }}>
                    终端里启动的进程输出只存在终端的 pty 中，没有写入文件。由 {APP_NAME}
                    按历史命令重新启动后即可持续捕获。
                  </div>
                </div>
              }
              action={
                app?.online && app.killable ? (
                  <Popconfirm
                    title={`重启端口 ${port} 以捕获输出？`}
                    description={
                      <div className="kill-confirm">
                        <div className="muted">将先结束当前进程，再按历史命令重启</div>
                        <div className="mono">{app.commandLine || app.command}</div>
                      </div>
                    }
                    okText="重启并捕获"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                    onConfirm={restart}
                  >
                    <Button size="small" icon={<ReloadOutlined />} loading={restarting}>
                      重启并捕获输出
                    </Button>
                  </Popconfirm>
                ) : undefined
              }
            />
          </div>
        ) : lines.length === 0 ? (
          <div className="web-log-center muted">等待输出…</div>
        ) : (
          <pre ref={attachView} className="web-log-view mono" onScroll={handleScroll}>
            {lines.join('\n')}
          </pre>
        )}
      </div>
    </div>
  )
}
