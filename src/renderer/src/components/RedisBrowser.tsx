import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Empty,
  Input,
  Segmented,
  Select,
  Spin,
  Splitter,
  Table,
  Tag,
  Tooltip,
  theme
} from 'antd'
import {
  CloseOutlined,
  CopyOutlined,
  KeyOutlined,
  MinusSquareOutlined,
  PlusSquareOutlined,
  ReloadOutlined,
  UndoOutlined
} from '@ant-design/icons'
import type { InstanceMeta, RedisKeyDetail, RedisKeyInfo } from '../../../shared/types'
import { api } from '../api'
import { cleanError, copyText, formatBytes, formatCount, formatTtl } from '../utils'
import JsonView from './JsonView'

interface RedisBrowserProps {
  instance: InstanceMeta
}

type ValueMode = 'string' | 'json'
type ExpandMode = 'default' | 'all' | 'none'

const TYPE_COLORS: Record<string, string> = {
  string: 'green',
  hash: 'blue',
  list: 'orange',
  set: 'purple',
  zset: 'gold',
  stream: 'cyan',
  none: 'default'
}

export default function RedisBrowser({ instance }: RedisBrowserProps) {
  const { message } = App.useApp()
  const { token } = theme.useToken()
  const [db, setDb] = useState(0)
  const [dbCount, setDbCount] = useState(16)
  const [patternInput, setPatternInput] = useState('')
  const [pattern, setPattern] = useState('')
  const [keys, setKeys] = useState<RedisKeyInfo[]>([])
  const [cursor, setCursor] = useState('0')
  const [done, setDone] = useState(true)
  const [loading, setLoading] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [detail, setDetail] = useState<RedisKeyDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [valueMode, setValueMode] = useState<ValueMode>('string')
  const [expandMode, setExpandMode] = useState<ExpandMode>('default')

  useEffect(() => {
    const timer = setTimeout(() => setPattern(patternInput.trim()), 350)
    return () => clearTimeout(timer)
  }, [patternInput])

  useEffect(() => {
    api.settings()
      .then((settings) => setDbCount(settings.redisDbs))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (db >= dbCount) setDb(0)
  }, [db, dbCount])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.redis
      .keys({ instanceId: instance.id, db, cursor: '0', pattern: pattern || undefined })
      .then((page) => {
        if (cancelled) return
        setKeys(page.keys)
        setCursor(page.cursor)
        setDone(page.done)
      })
      .catch((err) => {
        if (!cancelled) message.error(cleanError(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    setSelectedKey(null)
    setDetail(null)
    setDetailError(null)
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance.id, db, pattern])

  const loadMore = async (): Promise<void> => {
    setLoading(true)
    try {
      const page = await api.redis.keys({
        instanceId: instance.id,
        db,
        cursor,
        pattern: pattern || undefined
      })
      setKeys((prev) => [...prev, ...page.keys])
      setCursor(page.cursor)
      setDone(page.done)
    } catch (error) {
      message.error(cleanError(error))
    } finally {
      setLoading(false)
    }
  }

  const openKey = async (key: string, mode?: ValueMode): Promise<void> => {
    if (mode) setValueMode(mode)
    setSelectedKey(key)
    setDetail(null)
    setDetailError(null)
    setExpandMode('default')
    setDetailLoading(true)
    try {
      const data = await api.redis.keyDetail({ instanceId: instance.id, db, key })
      setDetail(data)
    } catch (error) {
      setDetailError(cleanError(error))
    } finally {
      setDetailLoading(false)
    }
  }

  const renderValue = (record: RedisKeyInfo) => {
    if (record.previewKind === 'summary') {
      return record.preview ? (
        <span className="muted">{record.preview}</span>
      ) : (
        <span className="cell-null">—</span>
      )
    }
    const preview = record.preview ?? ''
    if (record.type !== 'string') return <span className="cell-null">—</span>
    if (preview.length === 0) return <span className="cell-null">空</span>
    const long =
      record.previewKind === 'json' || preview.length > 80 || preview.includes('\n')
    if (!long) return <span className="mono">{preview}</span>
    return (
      <div
        className="cell-long cell-long-clickable"
        title="点击在底部查看完整内容"
        onClick={(event) => {
          event.stopPropagation()
          void openKey(record.key, record.previewKind === 'json' ? 'json' : 'string')
        }}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {preview}
      </div>
    )
  }

  const refresh = (): void => {
    setPattern(patternInput.trim())
    if (selectedKey) openKey(selectedKey)
  }

  const copy = async (text: string, label: string): Promise<void> => {
    try {
      await copyText(text)
      message.success(`已复制 ${label}`)
    } catch {
      message.error('复制失败')
    }
  }

  const parsedJson = useMemo(() => {
    if (!detail || detail.type !== 'string') return null
    try {
      return { ok: true as const, value: JSON.parse(detail.stringValue ?? '') as unknown }
    } catch {
      return { ok: false as const }
    }
  }, [detail])

  return (
    <div className="redis-browser">
      <div className="redis-toolbar">
        <Select
          value={db}
          onChange={(value) => setDb(value)}
          style={{ width: 104 }}
          options={Array.from({ length: dbCount }, (_, index) => ({
            value: index,
            label: `db ${index}`
          }))}
        />
        <Input
          allowClear
          value={patternInput}
          onChange={(event) => setPatternInput(event.target.value)}
          onPressEnter={() => setPattern(patternInput.trim())}
          placeholder="MATCH 模式，如 user:*"
          className="mono"
          style={{ width: 280 }}
        />
        <Button icon={<ReloadOutlined />} onClick={refresh}>
          刷新
        </Button>
        <span className="muted">
          已加载 {formatCount(keys.length)} 个 key{done ? '' : '（还有更多）'}
        </span>
      </div>

      <Splitter orientation="vertical" className="redis-splitter">
        <Splitter.Panel min={160} style={{ overflow: 'hidden' }}>
          <div className="redis-keys">
            <Table
              size="small"
              rowKey="key"
              loading={loading && keys.length === 0}
              dataSource={keys}
              pagination={false}
              scroll={{ x: 'max-content' }}
              onRow={(record) => ({
                onClick: () => openKey(record.key),
                className: record.key === selectedKey ? 'row-active' : undefined,
                style: { cursor: 'pointer' }
              })}
              columns={[
                {
                  title: 'Key',
                  dataIndex: 'key',
                  render: (key: string) => (
                    <Tooltip title={key} placement="topLeft">
                      <span className="mono key-cell">{key}</span>
                    </Tooltip>
                  )
                },
                {
                  title: 'Value',
                  key: 'value',
                  width: 360,
                  render: (_value, record) => renderValue(record)
                },
                {
                  title: '类型',
                  dataIndex: 'type',
                  width: 100,
                  render: (type: string) => <Tag color={TYPE_COLORS[type] ?? 'default'}>{type}</Tag>
                },
                {
                  title: 'TTL',
                  dataIndex: 'ttl',
                  width: 120,
                  render: (ttl: number) => formatTtl(ttl)
                },
                {
                  title: '内存',
                  dataIndex: 'bytes',
                  width: 110,
                  align: 'right',
                  render: (bytes: number | null) => formatBytes(bytes)
                }
              ]}
              locale={{
                emptyText: loading ? <Spin size="small" /> : <Empty description="没有匹配的 key" />
              }}
            />
            {!done ? (
              <div style={{ textAlign: 'center', padding: '12px 0 18px' }}>
                <Button loading={loading} onClick={loadMore}>
                  加载更多
                </Button>
              </div>
            ) : null}
          </div>
        </Splitter.Panel>

        {selectedKey ? (
          <Splitter.Panel defaultSize="40%" min={190} style={{ overflow: 'hidden' }}>
            <div className="redis-detail" style={{ background: token.colorBgElevated }}>
              <div
                className="redis-detail-head"
                style={{ background: token.colorFillQuaternary }}
              >
                <span className="mono key-cell detail-key" title={selectedKey}>
                  {selectedKey}
                </span>
                {detail ? <Tag color={TYPE_COLORS[detail.type] ?? 'default'}>{detail.type}</Tag> : null}
                <div style={{ flex: 1 }} />
                {detail?.type === 'string' ? (
                  <Segmented
                    size="small"
                    value={valueMode}
                    onChange={(value) => setValueMode(String(value) as ValueMode)}
                    options={[
                      { label: '字符串', value: 'string' },
                      { label: 'JSON', value: 'json' }
                    ]}
                  />
                ) : null}
                {detail?.type === 'string' && valueMode === 'json' && parsedJson?.ok ? (
                  <>
                    <Tooltip title="展开全部">
                      <Button
                        size="small"
                        type="text"
                        aria-label="展开全部"
                        icon={<PlusSquareOutlined />}
                        onClick={() => setExpandMode('all')}
                      />
                    </Tooltip>
                    <Tooltip title="折叠全部">
                      <Button
                        size="small"
                        type="text"
                        aria-label="折叠全部"
                        icon={<MinusSquareOutlined />}
                        onClick={() => setExpandMode('none')}
                      />
                    </Tooltip>
                    <Tooltip title="恢复默认展开层级">
                      <Button
                        size="small"
                        type="text"
                        aria-label="恢复默认展开层级"
                        icon={<UndoOutlined />}
                        onClick={() => setExpandMode('default')}
                      />
                    </Tooltip>
                  </>
                ) : null}
                <Tooltip title="复制 Key">
                  <Button
                    size="small"
                    type="text"
                    aria-label="复制 Key"
                    icon={<KeyOutlined />}
                    onClick={() => copy(selectedKey, 'Key')}
                  />
                </Tooltip>
                {detail?.type === 'string' ? (
                  <Tooltip title="复制内容">
                    <Button
                      size="small"
                      type="text"
                      aria-label="复制内容"
                      icon={<CopyOutlined />}
                      onClick={() => copy(detail.stringValue ?? '', '内容')}
                    />
                  </Tooltip>
                ) : null}
                <Tooltip title="刷新详情">
                  <Button
                    size="small"
                    type="text"
                    aria-label="刷新详情"
                    icon={<ReloadOutlined />}
                    onClick={() => openKey(selectedKey)}
                  />
                </Tooltip>
                <Button
                  size="small"
                  type="text"
                  aria-label="关闭详情"
                  icon={<CloseOutlined />}
                  onClick={() => {
                    setSelectedKey(null)
                    setDetail(null)
                  }}
                />
              </div>

              <div className="redis-detail-body">
                {detailLoading ? (
                  <div className="center-fill">
                    <Spin size="small" />
                  </div>
                ) : detailError ? (
                  <Alert
                    type="error"
                    showIcon
                    title="读取 key 失败"
                    description={<span className="mono">{detailError}</span>}
                  />
                ) : detail?.note ? (
                  <Alert type="info" showIcon title={detail.note} />
                ) : detail ? (
                  <>
                    <div className="detail-meta">
                      <span>
                        {detail.type === 'string'
                          ? `长度 ${formatCount(detail.stringLength ?? 0)} 字符`
                          : `共 ${formatCount(detail.total)} 条`}
                      </span>
                      <span>·</span>
                      <span>TTL {formatTtl(detail.ttl)}</span>
                      {detail.truncated ? (
                        <span>· 仅展示前 {formatCount(detail.loaded)} 条</span>
                      ) : null}
                      {detail.type === 'string' && detail.stringTruncated ? (
                        <span>· 内容过大，仅展示前 256 KB</span>
                      ) : null}
                      {detail.type === 'string' && valueMode === 'string' && parsedJson?.ok ? (
                        <span>· 可切换到 JSON 查看</span>
                      ) : null}
                    </div>
                    {detail.type === 'string' ? (
                      <>
                        {valueMode === 'json' && parsedJson && !parsedJson.ok ? (
                          <Alert
                            type="warning"
                            showIcon
                            style={{ marginBottom: 10 }}
                            title="不是合法的 JSON，已按原始字符串显示"
                          />
                        ) : null}
                        {valueMode === 'json' && parsedJson?.ok ? (
                          <JsonView
                            key={expandMode}
                            value={parsedJson.value}
                            defaultDepth={expandMode === 'none' ? 0 : 2}
                            expandAll={expandMode === 'all'}
                          />
                        ) : (
                          <div className="redis-string mono">
                            {detail.stringValue || '（空字符串）'}
                          </div>
                        )}
                      </>
                    ) : (
                      <Table
                        size="small"
                        rowKey={(_, index) => String(index ?? 0)}
                        dataSource={detail.rows}
                        pagination={false}
                        scroll={{ x: 'max-content' }}
                        columns={detail.columns.map((name) => ({
                          title: name,
                          dataIndex: name,
                          key: name,
                          render: (value: unknown) => {
                            if (value === null || value === undefined)
                              return <span className="cell-null">NULL</span>
                            const text = String(value)
                            return text.length > 80 ? <div className="cell-long">{text}</div> : text
                          }
                        }))}
                        locale={{ emptyText: '没有数据' }}
                      />
                    )}
                  </>
                ) : null}
              </div>
            </div>
          </Splitter.Panel>
        ) : null}
      </Splitter>
    </div>
  )
}
