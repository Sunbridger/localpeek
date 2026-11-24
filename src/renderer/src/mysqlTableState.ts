import { LIMITS } from '../../shared/limits'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface MysqlTableUiState {
  view: 'data' | 'structure'
  page: number
  pageSize: number
  keywordInput: string
  whereInput: string
  keyword: string
  where: string
  orderBy?: string
  orderDir: 'asc' | 'desc'
  showSql: boolean
}

export const TABLE_STATE_STORAGE_KEY = 'localpeek.mysqlTableState.v1'
export const MAX_TABLE_STATES = 200
export const MYSQL_PAGE_SIZES = LIMITS.mysqlPageSizes

export const DEFAULT_MYSQL_TABLE_STATE: MysqlTableUiState = {
  view: 'data',
  page: 1,
  pageSize: LIMITS.mysqlDefaultPageSize,
  keywordInput: '',
  whereInput: '',
  keyword: '',
  where: '',
  orderBy: undefined,
  orderDir: 'asc',
  showSql: false
}

interface StoredEntry {
  state: unknown
  updatedAt: number
}

interface StoredShape {
  version: 1
  entries: Record<string, StoredEntry>
}

export function tableStateId(instanceId: string, database: string, table: string): string {
  return `${instanceId}|${database}|${table}`
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asPage(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : 1
}

function asPageSize(value: unknown): number {
  return typeof value === 'number' &&
    (MYSQL_PAGE_SIZES as readonly number[]).includes(value)
    ? value
    : DEFAULT_MYSQL_TABLE_STATE.pageSize
}

function sanitizeState(raw: unknown): MysqlTableUiState {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    view: value.view === 'structure' ? 'structure' : 'data',
    page: asPage(value.page),
    pageSize: asPageSize(value.pageSize),
    keywordInput: asString(value.keywordInput),
    whereInput: asString(value.whereInput),
    keyword: asString(value.keyword),
    where: asString(value.where),
    orderBy:
      typeof value.orderBy === 'string' && value.orderBy.trim().length > 0
        ? value.orderBy
        : undefined,
    orderDir: value.orderDir === 'desc' ? 'desc' : 'asc',
    showSql: value.showSql === true
  }
}

function readEntries(storage: StorageLike | null): Record<string, StoredEntry> {
  if (!storage) return {}
  try {
    const raw = storage.getItem(TABLE_STATE_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Partial<StoredShape>
    if (!parsed || typeof parsed !== 'object' || !parsed.entries) return {}
    const entries: Record<string, StoredEntry> = {}
    for (const [key, entry] of Object.entries(parsed.entries)) {
      if (!entry || typeof entry !== 'object') continue
      const updatedAt =
        typeof (entry as StoredEntry).updatedAt === 'number'
          ? (entry as StoredEntry).updatedAt
          : 0
      entries[key] = { state: (entry as StoredEntry).state, updatedAt }
    }
    return entries
  } catch {
    return {}
  }
}

function prune(entries: Record<string, StoredEntry>): void {
  const keys = Object.keys(entries)
  if (keys.length <= MAX_TABLE_STATES) return
  keys
    .sort((a, b) => {
      const diff = (entries[a].updatedAt || 0) - (entries[b].updatedAt || 0)
      return diff !== 0 ? diff : a.localeCompare(b)
    })
    .slice(0, keys.length - MAX_TABLE_STATES)
    .forEach((key) => {
      delete entries[key]
    })
}

export function readTableState(
  storage: StorageLike | null,
  key: string
): MysqlTableUiState {
  const entry = readEntries(storage)[key]
  if (!entry) return { ...DEFAULT_MYSQL_TABLE_STATE }
  return sanitizeState(entry.state)
}

export function patchTableState(
  storage: StorageLike | null,
  key: string,
  patch: Partial<MysqlTableUiState>,
  now = Date.now()
): void {
  if (!storage) return
  try {
    const entries = readEntries(storage)
    const current = entries[key]?.state
    const merged = sanitizeState({
      ...sanitizeState(current),
      ...patch
    })
    entries[key] = { state: merged, updatedAt: now }
    prune(entries)
    const payload: StoredShape = { version: 1, entries }
    storage.setItem(TABLE_STATE_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // localStorage 不可用时静默降级
  }
}
