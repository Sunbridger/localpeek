import type { AppSettings } from './settings'

export type DbKind = 'redis' | 'mysql'

export type ThemeMode = 'system' | 'light' | 'dark'

export type InstanceStatus = 'ready' | 'needCredentials' | 'error' | 'checking'

export interface DockerInfo {
  id: string
  name: string
  image: string
  status: string
  ports: string
}

export interface InstanceMeta {
  id: string
  kind: DbKind
  host: string
  port: number
  source: 'scan' | 'docker' | 'manual'
  label: string
  /** 监听者身份：本机进程 / SSH 端口转发 / Docker */
  via?: 'local' | 'ssh' | 'docker'
  container?: DockerInfo
  version?: string
  status: InstanceStatus
  error?: string
  username?: string
  manual?: boolean
}

export type WebAppRole = 'frontend' | 'backend' | 'web'

export interface WebProcessInfo {
  pid: number
  user: string
  command: string
  commandLine?: string
  cwd?: string
  killable: boolean
  killBlockedReason?: string
}

export interface WebAppInfo {
  port: number
  online: boolean
  pid?: number
  pids?: number[]
  processes?: WebProcessInfo[]
  user?: string
  command: string
  commandLine?: string
  /** 解析出的项目名（/mycode/<project>/ 或 /code/<project>/） */
  project?: string
  /** 进程工作目录，用于一键重启 */
  cwd?: string
  url: string
  role: WebAppRole
  status?: number
  server?: string
  contentType?: string
  title?: string
  killable: boolean
  killBlockedReason?: string
  /** 离线记录是否具备重启条件（有历史命令与目录） */
  startable?: boolean
  lastSeenAt?: number
}

export interface WebActionResult {
  ok: boolean
  message: string
  webApps: WebAppInfo[]
}

export type WebLogSource = 'launch' | 'file' | 'unavailable'

export interface WebLogInfo {
  source: WebLogSource
  /** 可读取的日志文件路径；unavailable 时为空 */
  path?: string
  /** 不可读的原因 */
  reason?: string
  /** 最近 200 行快照 */
  lines: string[]
  online: boolean
}

export interface WebLogLinesEvent {
  port: number
  lines: string[]
}

export interface ScanResult {
  instances: InstanceMeta[]
  webApps: WebAppInfo[]
  scannedAt: number
  dockerAvailable: boolean
  probedPorts: number
  detectedPorts: number
}

export interface CredentialInput {
  instanceId: string
  username?: string
  password?: string
}

export interface ManualConnectionInput {
  kind: DbKind
  host: string
  port: number
  username?: string
  password?: string
  label?: string
}

export interface TestConnectionResult {
  ok: boolean
  version?: string
  error?: string
}

export interface MysqlTableInfo {
  name: string
  engine: string | null
  rows: number | null
  dataLength: number | null
}

export interface MysqlColumnInfo {
  name: string
  type: string
  nullable: boolean
  key: string
  defaultValue: string | null
  extra: string
}

export interface MysqlIndexInfo {
  name: string
  unique: boolean
  columns: string[]
}

export interface MysqlQueryInput {
  instanceId: string
  database: string
  table: string
  where?: string
  keyword?: string
  page: number
  pageSize: number
  orderBy?: string
  orderDir?: 'asc' | 'desc'
}

export interface MysqlQueryResult {
  columns: string[]
  rows: Record<string, unknown>[]
  total: number | null
  sql: string
}

export type RedisPreviewKind = 'text' | 'json' | 'summary'

export interface RedisKeyInfo {
  key: string
  type: string
  ttl: number
  bytes: number | null
  /** string 的值预览（截断）或集合数量摘要 */
  preview?: string
  previewKind?: RedisPreviewKind
}

export interface RedisKeyPage {
  cursor: string
  keys: RedisKeyInfo[]
  done: boolean
}

export interface RedisKeyDetail {
  key: string
  type: string
  ttl: number
  total: number
  loaded: number
  truncated: boolean
  columns: string[]
  rows: Record<string, unknown>[]
  note?: string
  stringValue?: string
  stringLength?: number
  stringTruncated?: boolean
}

export interface RedisKeysInput {
  instanceId: string
  db: number
  cursor: string
  pattern?: string
}

export interface RedisKeyDetailInput {
  instanceId: string
  db: number
  key: string
}

export interface AppPaths {
  userData: string
  configFile: string
  logsDir: string
}

export interface LocalPeekApi {
  scan: () => Promise<ScanResult>
  settings: () => Promise<AppSettings>
  updateSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>
  paths: () => Promise<AppPaths>
  onNavigate: (callback: (port: number) => void) => () => void
  onOpenSettings: (callback: () => void) => () => void
  onScanResult: (callback: (result: ScanResult) => void) => () => void
  currentInstances: () => Promise<InstanceMeta[]>
  testConnection: (input: ManualConnectionInput) => Promise<TestConnectionResult>
  addManual: (input: ManualConnectionInput) => Promise<InstanceMeta>
  removeManual: (instanceId: string) => Promise<void>
  setCredentials: (input: CredentialInput) => Promise<InstanceMeta>
  mysql: {
    databases: (instanceId: string) => Promise<string[]>
    tables: (instanceId: string, database: string) => Promise<MysqlTableInfo[]>
    columns: (instanceId: string, database: string, table: string) => Promise<MysqlColumnInfo[]>
    indexes: (instanceId: string, database: string, table: string) => Promise<MysqlIndexInfo[]>
    query: (input: MysqlQueryInput) => Promise<MysqlQueryResult>
  }
  redis: {
    selectDb: (instanceId: string, db: number) => Promise<void>
    keys: (input: RedisKeysInput) => Promise<RedisKeyPage>
    keyDetail: (input: RedisKeyDetailInput) => Promise<RedisKeyDetail>
  }
  web: {
    scan: () => Promise<WebAppInfo[]>
    kill: (port: number, pid: number) => Promise<WebActionResult>
    killMany: (items: Array<{ port: number; pid: number }>) => Promise<WebActionResult>
    start: (port: number) => Promise<WebActionResult>
    startMany: (ports: number[]) => Promise<WebActionResult>
    clearHistory: () => Promise<WebAppInfo[]>
    logInfo: (port: number) => Promise<WebLogInfo>
    followLog: (port: number) => Promise<WebLogInfo>
    unfollowLog: (port: number) => Promise<void>
    restartForLog: (port: number) => Promise<WebActionResult>
    onLogLines: (callback: (event: WebLogLinesEvent) => void) => () => void
  }
  openExternal: (url: string) => Promise<void>
}
