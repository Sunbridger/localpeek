import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Empty,
  Input,
  Modal,
  Pagination,
  Segmented,
  Select,
  Space,
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
  MinusSquareOutlined,
  PlusSquareOutlined,
  ReloadOutlined,
  SearchOutlined,
  UndoOutlined
} from '@ant-design/icons'
import { LIMITS } from '../../../shared/limits'
import type {
  InstanceMeta,
  MysqlColumnInfo,
  MysqlIndexInfo,
  MysqlQueryResult
} from '../../../shared/types'
import { api } from '../api'
import {
  patchTableState,
  readTableState,
  tableStateId
} from '../mysqlTableState'
import { cleanError, copyText, formatCount } from '../utils'
import JsonView from './JsonView'

interface MysqlTablePaneProps {
  instance: InstanceMeta
  database: string
  table: string
}

type CellDetail = { field: string; text: string; type?: string; rowLabel?: string }

function LongCell({
  value,
  field,
  onOpenDetail
}: {
  value: unknown
  field: string
  onOpenDetail: (field: string, value: unknown) => void
}) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return (
    <div
      className="cell-long cell-long-clickable"
      title="点击在底部查看完整内容"
      onClick={(event) => {
        event.stopPropagation()
        onOpenDetail(field, value)
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {text}
    </div>
  )
}

function looksLikeJson(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

function renderCell(
  value: unknown,
  field: string,
  columnType: string,
  onOpenDetail: (field: string, value: unknown) => void
) {
  if (value === null || value === undefined) return <span className="cell-null">NULL</span>
  if (typeof value === 'string') {
    if (value.length === 0) return <span className="cell-null">空</span>
    // json / text 字段即使内容较短也支持点击查看，避免漏掉 arguments_json 等
    const longType = /json|text/i.test(columnType)
    if (
      longType ||
      value.length > 80 ||
      value.includes('\n') ||
      looksLikeJson(value)
    ) {
      return <LongCell value={value} field={field} onOpenDetail={onOpenDetail} />
    }
    return value
  }
  if (typeof value === 'object') {
    return <LongCell value={value} field={field} onOpenDetail={onOpenDetail} />
  }
  return String(value)
}

function RowDetailModal({
  row,
  onClose
}: {
  row: Record<string, unknown> | null
  onClose: () => void
}) {
  return (
    <Modal open={row !== null} onCancel={onClose} footer={null} width={760} title="行详情">
      {row ? (
        <Table
          size="small"
          rowKey="field"
          pagination={false}
          dataSource={Object.entries(row).map(([field, value]) => ({ field, value }))}
          columns={[
            { title: '字段', dataIndex: 'field', width: 180 },
            {
              title: '值',
              dataIndex: 'value',
              render: (value: unknown) => (
                <pre className="detail-value mono">
                  {value === null || value === undefined
                    ? 'NULL'
                    : typeof value === 'string'
                      ? value
                      : JSON.stringify(value, null, 2)}
                </pre>
              )
            }
          ]}
        />
      ) : null}
    </Modal>
  )
}

function DataView({
  instance,
  database,
  table,
  structureColumns
}: {
  instance: InstanceMeta
  database: string
  table: string
  structureColumns: MysqlColumnInfo[]
}) {
  const { message } = App.useApp()
  const stateKey = useMemo(
    () => tableStateId(instance.id, database, table),
    [instance.id, database, table]
  )
  const stored = useMemo(
    () => readTableState(window.localStorage, stateKey),
    [stateKey]
  )
  const [result, setResult] = useState<MysqlQueryResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(stored.page)
  const [pageSize, setPageSize] = useState(stored.pageSize)
  const [whereInput, setWhereInput] = useState(stored.whereInput)
  const [keywordInput, setKeywordInput] = useState(stored.keywordInput)
  const [where, setWhere] = useState(stored.where)
  const [keyword, setKeyword] = useState(stored.keyword)
  const [orderBy, setOrderBy] = useState<string | undefined>(stored.orderBy)
  const [orderDir, setOrderDir] = useState<'asc' | 'desc'>(stored.orderDir)
  const [tick, setTick] = useState(0)
  const [showSql, setShowSql] = useState(stored.showSql)
  const [detailRow, setDetailRow] = useState<Record<string, unknown> | null>(null)
  const [cellDetail, setCellDetail] = useState<CellDetail | null>(null)
  const [valueMode, setValueMode] = useState<'string' | 'json'>('string')
  const [expandMode, setExpandMode] = useState<'default' | 'all' | 'none'>('default')
  const { token } = theme.useToken()

  useEffect(() => {
    const timer = setTimeout(() => {
      patchTableState(window.localStorage, stateKey, {
        page,
        pageSize,
        keywordInput,
        whereInput,
        keyword,
        where,
        orderBy,
        orderDir,
        showSql
      })
    }, 300)
    return () => clearTimeout(timer)
  }, [
    stateKey,
    page,
    pageSize,
    keywordInput,
    whereInput,
    keyword,
    where,
    orderBy,
    orderDir,
    showSql
  ])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api.mysql
      .query({
        instanceId: instance.id,
        database,
        table,
        where: where || undefined,
        keyword: keyword || undefined,
        page,
        pageSize,
        orderBy,
        orderDir
      })
      .then((data) => {
        if (!cancelled) setResult(data)
      })
      .catch((err) => {
        const text = cleanError(err)
        if (!cancelled) {
          setError(text)
          message.error(text)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance.id, database, table, where, keyword, page, pageSize, orderBy, orderDir, tick])

  const apply = (): void => {
    setPage(1)
    setWhere(whereInput.trim())
    setKeyword(keywordInput.trim())
  }

  const columnNames = useMemo(
    () =>
      result && result.columns.length > 0
        ? result.columns
        : structureColumns.map((column) => column.name),
    [result, structureColumns]
  )

  useEffect(() => {
    if (!orderBy || columnNames.length === 0) return
    if (!columnNames.includes(orderBy)) setOrderBy(undefined)
  }, [columnNames, orderBy])

  useEffect(() => {
    if (!result || result.total === null) return
    const maxPage = Math.max(1, Math.ceil(result.total / pageSize))
    if (page > maxPage) setPage(maxPage)
  }, [result, page, pageSize])

  const openCellDetail = (field: string, value: unknown, rowIndex?: number): void => {
    setCellDetail({
      field,
      text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      type: structureColumns.find((column) => column.name === field)?.type,
      rowLabel:
        rowIndex === undefined
          ? undefined
          : `第 ${(page - 1) * pageSize + rowIndex + 1} 行`
    })
    setExpandMode('default')
  }

  const parsedJson = useMemo(() => {
    if (!cellDetail) return null
    try {
      return { ok: true as const, value: JSON.parse(cellDetail.text) as unknown }
    } catch {
      return { ok: false as const }
    }
  }, [cellDetail])

  const dataColumns = columnNames.map((name) => {
    const columnType = structureColumns.find((column) => column.name === name)?.type ?? ''
    const longType = /json|text/i.test(columnType)
    return {
      title: name,
      dataIndex: name,
      key: name,
      sorter: true,
      sortOrder:
        orderBy === name
          ? orderDir === 'asc'
            ? ('ascend' as const)
            : ('descend' as const)
          : null,
      width: longType ? 320 : undefined,
      render: (value: unknown, _record: unknown, rowIndex: number) =>
        renderCell(value, name, columnType, (field, child) =>
          openCellDetail(field, child, rowIndex)
        )
    }
  })

  const rows = result?.rows ?? []
  const total = result?.total ?? null
  const canNext = total !== null ? page * pageSize < total : rows.length >= pageSize

  return (
    <div className="pane-body" style={{ minHeight: 0 }}>
      <div className="toolbar">
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="关键词（在所有文本列中 LIKE 搜索）"
          value={keywordInput}
          onChange={(event) => setKeywordInput(event.target.value)}
          onPressEnter={apply}
          style={{ width: 260 }}
        />
        <Input
          allowClear
          className="mono"
          placeholder="WHERE 条件，如 status = 1 AND id > 100"
          value={whereInput}
          onChange={(event) => setWhereInput(event.target.value)}
          onPressEnter={apply}
          style={{ width: 320 }}
        />
        <Button onClick={apply}>应用</Button>
        <Button icon={<ReloadOutlined />} onClick={() => setTick((value) => value + 1)}>
          刷新
        </Button>
        <Select
          value={pageSize}
          onChange={(value) => {
            setPageSize(value)
            setPage(1)
          }}
          style={{ width: 118 }}
          options={LIMITS.mysqlPageSizes.map((value) => ({
            value,
            label: `${value} 行/页`
          }))}
        />
        <Button type="text" size="small" onClick={() => setShowSql((value) => !value)}>
          SQL
        </Button>
      </div>

      {error ? (
        <div style={{ padding: '10px 20px 0' }}>
          <Alert
            type="error"
            showIcon
            title="查询失败"
            description={<span className="mono">{error}</span>}
          />
        </div>
      ) : null}

      {showSql && result ? (
        <div style={{ padding: '10px 20px 0' }}>
          <pre className="sql-block mono">{result.sql}</pre>
        </div>
      ) : null}

      <Splitter orientation="vertical" className="mysql-splitter">
        <Splitter.Panel min={200} style={{ overflow: 'hidden' }}>
          <div className="mysql-table-panel">
            <div className="mysql-table-scroll">
              <Table
                size="small"
                rowKey={(_, index) => String(index ?? 0)}
                loading={loading}
                dataSource={rows}
                columns={dataColumns}
                pagination={false}
                scroll={{ x: 'max-content' }}
                onRow={(record) => ({
                  onDoubleClick: () => setDetailRow(record),
                  style: { cursor: 'default' }
                })}
                onChange={(_pagination, _filters, sorter) => {
                  const active = Array.isArray(sorter) ? sorter[0] : sorter
                  if (active && active.order) {
                    setOrderBy(String(active.field))
                    setOrderDir(active.order === 'ascend' ? 'asc' : 'desc')
                    setPage(1)
                  } else {
                    setOrderBy(undefined)
                  }
                }}
                locale={{
                  emptyText: loading ? <Spin size="small" /> : <Empty description="没有匹配的行" />
                }}
              />
            </div>

            <div className="table-footer">
              <span className="muted">
                {total !== null ? `共 ${formatCount(total)} 行` : '总行数未知'}
                {total !== null && total > 0
                  ? ` · 当前第 ${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, total)} 行`
                  : ''}
              </span>
              {total !== null ? (
                <Pagination
                  size="small"
                  current={page}
                  pageSize={pageSize}
                  total={total}
                  showSizeChanger={false}
                  onChange={(next) => setPage(next)}
                />
              ) : (
                <Space>
                  <Button size="small" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    上一页
                  </Button>
                  <span className="muted">第 {page} 页</span>
                  <Button size="small" disabled={!canNext} onClick={() => setPage(page + 1)}>
                    下一页
                  </Button>
                </Space>
              )}
            </div>
          </div>
        </Splitter.Panel>

        {cellDetail ? (
          <Splitter.Panel defaultSize="42%" min={190} style={{ overflow: 'hidden' }}>
            <div className="mysql-detail" style={{ background: token.colorBgElevated }}>
              <div
                className="mysql-detail-head"
                style={{ background: token.colorFillQuaternary }}
              >
                <span className="mono key-cell detail-key" title={cellDetail.field}>
                  {cellDetail.field}
                </span>
                {cellDetail.type ? <Tag className="mono">{cellDetail.type}</Tag> : null}
                <div style={{ flex: 1 }} />
                <Segmented
                  size="small"
                  value={valueMode}
                  onChange={(value) => setValueMode(String(value) as 'string' | 'json')}
                  options={[
                    { label: '字符串', value: 'string' },
                    { label: 'JSON', value: 'json' }
                  ]}
                />
                {valueMode === 'json' && parsedJson?.ok ? (
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
                <Tooltip title="复制内容">
                  <Button
                    size="small"
                    type="text"
                    aria-label="复制内容"
                    icon={<CopyOutlined />}
                    onClick={async () => {
                      try {
                        await copyText(cellDetail.text)
                        message.success('已复制字段内容')
                      } catch {
                        message.error('复制失败')
                      }
                    }}
                  />
                </Tooltip>
                <Button
                  size="small"
                  type="text"
                  aria-label="关闭字段详情"
                  icon={<CloseOutlined />}
                  onClick={() => setCellDetail(null)}
                />
              </div>

              <div className="mysql-detail-body">
                <div className="detail-meta">
                  {cellDetail.rowLabel ? <span>{cellDetail.rowLabel}</span> : null}
                  {cellDetail.rowLabel ? <span>·</span> : null}
                  <span>长度 {formatCount(cellDetail.text.length)} 字符</span>
                  {cellDetail.type ? (
                    <>
                      <span>·</span>
                      <span>{cellDetail.type}</span>
                    </>
                  ) : null}
                  {valueMode === 'string' && parsedJson?.ok ? (
                    <span>· 可切换到 JSON 查看</span>
                  ) : null}
                </div>
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
                    {cellDetail.text || '（空字符串）'}
                  </div>
                )}
              </div>
            </div>
          </Splitter.Panel>
        ) : null}
      </Splitter>

      <RowDetailModal row={detailRow} onClose={() => setDetailRow(null)} />
    </div>
  )
}

function StructureView({
  columns,
  indexes,
  loading,
  error
}: {
  columns: MysqlColumnInfo[]
  indexes: MysqlIndexInfo[]
  loading: boolean
  error: string | null
}) {
  return (
    <div className="pane-body" style={{ overflow: 'auto', padding: '12px 20px 20px' }}>
      {error ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          title="读取表结构失败"
          description={<span className="mono">{error}</span>}
        />
      ) : null}
      <div className="section-title">字段</div>
      <Table
        size="small"
        rowKey="name"
        loading={loading}
        pagination={false}
        dataSource={columns}
        columns={[
          { title: '字段', dataIndex: 'name' },
          { title: '类型', dataIndex: 'type', render: (value: string) => <span className="mono">{value}</span> },
          {
            title: '可空',
            dataIndex: 'nullable',
            width: 80,
            render: (value: boolean) => (value ? '是' : '否')
          },
          {
            title: '键',
            dataIndex: 'key',
            width: 80,
            render: (value: string) => (value ? <Tag>{value}</Tag> : '—')
          },
          {
            title: '默认值',
            dataIndex: 'defaultValue',
            render: (value: string | null) =>
              value === null ? <span className="cell-null">NULL</span> : value
          },
          { title: '额外', dataIndex: 'extra', render: (value: string) => value || '—' }
        ]}
      />
      <div className="section-title" style={{ marginTop: 20 }}>
        索引
      </div>
      <Table
        size="small"
        rowKey="name"
        loading={loading}
        pagination={false}
        dataSource={indexes}
        columns={[
          { title: '索引名', dataIndex: 'name' },
          {
            title: '唯一',
            dataIndex: 'unique',
            width: 80,
            render: (value: boolean) => (value ? '是' : '否')
          },
          {
            title: '字段',
            dataIndex: 'columns',
            render: (value: string[]) => (
              <span className="mono">{value.join(', ')}</span>
            )
          }
        ]}
        locale={{ emptyText: '没有索引' }}
      />
    </div>
  )
}

export default function MysqlTablePane({ instance, database, table }: MysqlTablePaneProps) {
  const stateKey = useMemo(
    () => tableStateId(instance.id, database, table),
    [instance.id, database, table]
  )
  const [view, setView] = useState<string>(
    () => readTableState(window.localStorage, stateKey).view
  )
  const [columns, setColumns] = useState<MysqlColumnInfo[]>([])
  const [indexes, setIndexes] = useState<MysqlIndexInfo[]>([])
  const [structureLoading, setStructureLoading] = useState(false)
  const [structureError, setStructureError] = useState<string | null>(null)

  useEffect(() => {
    patchTableState(window.localStorage, stateKey, {
      view: view === 'structure' ? 'structure' : 'data'
    })
  }, [stateKey, view])

  useEffect(() => {
    let cancelled = false
    setStructureLoading(true)
    setStructureError(null)
    Promise.all([
      api.mysql.columns(instance.id, database, table),
      api.mysql.indexes(instance.id, database, table)
    ])
      .then(([columnList, indexList]) => {
        if (cancelled) return
        setColumns(columnList)
        setIndexes(indexList)
      })
      .catch((err) => {
        if (!cancelled) setStructureError(cleanError(err))
      })
      .finally(() => {
        if (!cancelled) setStructureLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [instance.id, database, table])

  return (
    <div className="pane">
      <div className="pane-header">
        <div className="pane-title">
          <span>{table}</span>
          <Tag color="blue">数据表</Tag>
        </div>
        <div className="pane-meta">
          <span>{instance.label}</span>
          <span className="muted">/</span>
          <span>{database}</span>
          <span className="mono">
            {instance.host}:{instance.port}
          </span>
          <Segmented
            size="small"
            value={view}
            onChange={(value) => setView(String(value))}
            options={[
              { label: '数据', value: 'data' },
              { label: '结构', value: 'structure' }
            ]}
          />
        </div>
      </div>
      {view === 'data' ? (
        <DataView
          instance={instance}
          database={database}
          table={table}
          structureColumns={columns}
        />
      ) : (
        <StructureView
          columns={columns}
          indexes={indexes}
          loading={structureLoading}
          error={structureError}
        />
      )}
    </div>
  )
}
