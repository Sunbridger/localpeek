import { createPool, type Pool, type RowDataPacket } from 'mysql2/promise'
import type {
  MysqlColumnInfo,
  MysqlIndexInfo,
  MysqlQueryInput,
  MysqlQueryResult,
  MysqlTableInfo
} from '../../shared/types'
import { buildWhereClause, escapeId, formatSql } from '../sql'

export interface MysqlConnOptions {
  host: string
  port: number
  username: string
  password: string
}

export interface MysqlOpenResult {
  pool?: Pool
  version?: string
  error?: string
  accessDenied?: boolean
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export function createMysqlPool(options: MysqlConnOptions): Pool {
  return createPool({
    host: options.host,
    port: options.port,
    user: options.username,
    password: options.password,
    connectionLimit: 3,
    waitForConnections: true,
    connectTimeout: 5000,
    multipleStatements: false,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    charset: 'utf8mb4'
  })
}

export async function openMysql(options: MysqlConnOptions): Promise<MysqlOpenResult> {
  const pool = createMysqlPool(options)
  try {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT VERSION() AS version')
    return { pool, version: String(rows[0]?.version ?? 'unknown') }
  } catch (error) {
    await pool.end().catch(() => {})
    const message = errorMessage(error)
    return { error: message, accessDenied: /access denied|1045/i.test(message) }
  }
}

function serializeValue(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (Buffer.isBuffer(value)) return `<Binary ${value.length} bytes>`
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return value
}

export function serializeRows(rows: RowDataPacket[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const record: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(row)) record[key] = serializeValue(value)
    return record
  })
}

const SYSTEM_DATABASES = new Set(['information_schema', 'performance_schema', 'mysql', 'sys'])

export async function listDatabases(pool: Pool): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>({ sql: 'SHOW DATABASES', timeout: 10_000 })
  return rows
    .map((row) => String(Object.values(row)[0]))
    .filter((name) => !SYSTEM_DATABASES.has(name))
}

export async function listTables(pool: Pool, database: string): Promise<MysqlTableInfo[]> {
  const [rows] = await pool.query<RowDataPacket[]>({
    sql: `SELECT TABLE_NAME AS name, ENGINE AS engine, TABLE_ROWS AS rowCount, DATA_LENGTH AS dataLength
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ?
     ORDER BY TABLE_NAME`,
    values: [database],
    timeout: 10_000
  })
  return rows.map((row) => ({
    name: String(row.name),
    engine: row.engine === null || row.engine === undefined ? null : String(row.engine),
    rows: row.rowCount === null || row.rowCount === undefined ? null : Number(row.rowCount),
    dataLength: row.dataLength === null || row.dataLength === undefined ? null : Number(row.dataLength)
  }))
}

const columnsCache = new Map<string, { data: MysqlColumnInfo[]; at: number }>()
const COLUMNS_TTL = 30_000

export async function listColumns(
  pool: Pool,
  instanceId: string,
  database: string,
  table: string
): Promise<MysqlColumnInfo[]> {
  const cacheKey = `${instanceId}|${database}|${table}`
  const cached = columnsCache.get(cacheKey)
  if (cached && Date.now() - cached.at < COLUMNS_TTL) return cached.data

  const [rows] = await pool.query<RowDataPacket[]>({
    sql: `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable,
            COLUMN_KEY AS columnKey, COLUMN_DEFAULT AS defaultValue, EXTRA AS extra
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    values: [database, table],
    timeout: 10_000
  })
  const data: MysqlColumnInfo[] = rows.map((row) => ({
    name: String(row.name),
    type: String(row.type),
    nullable: String(row.nullable).toUpperCase() === 'YES',
    key: String(row.columnKey ?? ''),
    defaultValue: row.defaultValue === null || row.defaultValue === undefined ? null : String(row.defaultValue),
    extra: String(row.extra ?? '')
  }))
  columnsCache.set(cacheKey, { data, at: Date.now() })
  return data
}

export async function listIndexes(pool: Pool, database: string, table: string): Promise<MysqlIndexInfo[]> {
  const [rows] = await pool.query<RowDataPacket[]>({
    sql: `SHOW INDEX FROM ${escapeId(database)}.${escapeId(table)}`,
    timeout: 10_000
  })
  const grouped = new Map<string, MysqlIndexInfo>()
  const ordered = [...rows].sort(
    (a, b) => Number(a.Seq_in_index ?? 0) - Number(b.Seq_in_index ?? 0)
  )
  for (const row of ordered) {
    const name = String(row.Key_name)
    const existing = grouped.get(name)
    const column = String(row.Column_name ?? '')
    if (existing) {
      existing.columns.push(column)
    } else {
      grouped.set(name, {
        name,
        unique: Number(row.Non_unique) === 0,
        columns: [column]
      })
    }
  }
  return [...grouped.values()]
}

export async function queryTable(
  pool: Pool,
  instanceId: string,
  input: MysqlQueryInput
): Promise<MysqlQueryResult> {
  const columns = await listColumns(pool, instanceId, input.database, input.table)
  const keywordColumns = columns
    .filter((column) => /char|text|enum|json|set/i.test(column.type))
    .slice(0, 12)
    .map((column) => column.name)

  const { clause, params } = buildWhereClause({
    where: input.where,
    keyword: input.keyword,
    keywordColumns
  })

  const orderColumn =
    input.orderBy && columns.some((column) => column.name === input.orderBy) ? input.orderBy : undefined
  const order = orderColumn
    ? ` ORDER BY ${escapeId(orderColumn)} ${input.orderDir === 'desc' ? 'DESC' : 'ASC'}`
    : ''

  const pageSize = Math.min(Math.max(Math.trunc(input.pageSize) || 100, 1), 500)
  const page = Math.max(Math.trunc(input.page) || 1, 1)
  const offset = (page - 1) * pageSize
  const from = `${escapeId(input.database)}.${escapeId(input.table)}`

  const dataSql = `SELECT * FROM ${from}${clause}${order} LIMIT ? OFFSET ?`
  const [rows] = await pool.query<RowDataPacket[]>({
    sql: dataSql,
    values: [...params, pageSize, offset],
    timeout: 20_000
  })

  let total: number | null = null
  try {
    const [countRows] = await pool.query<RowDataPacket[]>({
      sql: `SELECT COUNT(*) AS total FROM ${from}${clause}`,
      values: params,
      timeout: 8_000
    })
    total = Number(countRows[0]?.total ?? 0)
  } catch {
    total = null
  }

  return {
    columns: rows.length > 0 ? Object.keys(rows[0]) : columns.map((column) => column.name),
    rows: serializeRows(rows),
    total,
    sql: formatSql(dataSql, [...params, pageSize, offset])
  }
}

export function clearColumnsCache(instanceId?: string): void {
  if (!instanceId) {
    columnsCache.clear()
    return
  }
  for (const key of columnsCache.keys()) {
    if (key.startsWith(`${instanceId}|`)) columnsCache.delete(key)
  }
}
