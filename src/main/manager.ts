import { app } from 'electron'
import { appVersion } from './appVersion'
import { execFile, spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, statSync, writeSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import type Redis from 'ioredis'
import type { Pool } from 'mysql2/promise'
import type {
  CredentialInput,
  DbKind,
  InstanceMeta,
  ManualConnectionInput,
  MysqlColumnInfo,
  MysqlIndexInfo,
  MysqlQueryInput,
  MysqlQueryResult,
  MysqlTableInfo,
  RedisKeyDetail,
  RedisKeyDetailInput,
  RedisKeyPage,
  RedisKeysInput,
  ScanResult,
  TestConnectionResult,
  WebActionResult,
  WebAppInfo,
  WebLogInfo,
  WebLogSource
} from '../shared/types'
import {
  configPath,
  loadConfig,
  rememberCredential,
  saveConfig,
  type StoredCredential,
  type StoredWebHistoryEntry
} from './config'
import { lsofBinary, shellBinary } from './platform'
import { APP_NAME } from '../shared/appInfo'
import { type AppSettings, sanitizeSettings } from '../shared/settings'
import type { DockerContainer } from './discovery/docker'
import { isDockerCommand, isSshCommand } from './discovery/listeners'
import { mapLimit } from './discovery/probe'
import { discover } from './discovery/scanner'
import { probeHttp, scanWebApps as detectWebApps } from './discovery/webapps'
import { mergeWebHistory } from './services/webHistory'
import {
  clearColumnsCache,
  errorMessage,
  listColumns,
  listDatabases,
  listIndexes,
  listTables,
  openMysql,
  queryTable
} from './services/mysql'
import { keyDetail, openRedis, scanKeys } from './services/redis'
import { LogTail, MAX_LINES, parseLsofFds, readTail } from './services/webLog'

export function instanceIdFor(kind: DbKind, host: string, port: number): string {
  return `${kind}://${host}:${port}`
}

interface Credentials {
  username: string
  password: string
}

function normalizeHost(host?: string): string {
  const value = host?.trim()
  return value && value.length > 0 ? value : '127.0.0.1'
}

function normalizePort(port: number): number {
  const value = Number(port)
  if (!Number.isInteger(value) || value <= 0 || value > 65535) throw new Error('端口不合法')
  return value
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM 说明进程存在但不属于当前用户
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function normalizeKind(kind: DbKind): DbKind {
  if (kind !== 'mysql' && kind !== 'redis') throw new Error('数据库类型不合法')
  return kind
}

export class DbManager {
  private instances = new Map<string, InstanceMeta>()
  private containersByPort = new Map<number, DockerContainer>()
  private mysqlPools = new Map<string, Pool>()
  private redisClients = new Map<string, Redis>()
  private mysqlCreds = new Map<string, Credentials>()
  private redisCreds = new Map<string, string | undefined>()
  private redisDb = new Map<string, number>()
  private redisLocks = new Map<string, Promise<unknown>>()
  private webApps: WebAppInfo[] = []
  private logTails = new Map<
    number,
    { path: string; tail: LogTail; listeners: Set<(lines: string[]) => void> }
  >()
  private lastScanAt = 0
  private dockerAvailable = false
  private probedPorts = 0
  private detectedPorts = 0
  private scanPromise: Promise<ScanResult> | null = null

  async scan(): Promise<ScanResult> {
    if (!this.scanPromise) {
      this.scanPromise = this.doScan().finally(() => {
        this.scanPromise = null
      })
    }
    return this.scanPromise
  }

  currentInstances(): InstanceMeta[] {
    return this.snapshot()
  }

  currentSettings(): AppSettings {
    return loadConfig().settings
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const config = loadConfig()
    config.settings = sanitizeSettings({ ...config.settings, ...patch })
    saveConfig()
    return config.settings
  }

  currentWebApps(): WebAppInfo[] {
    return this.webApps
  }

  paths(): { userData: string; configFile: string; logsDir: string; version: string } {
    return {
      userData: app.getPath('userData'),
      configFile: configPath(),
      logsDir: this.logsDir(),
      version: appVersion()
    }
  }

  private snapshot(): InstanceMeta[] {
    return [...this.instances.values()].sort(
      (a, b) => a.kind.localeCompare(b.kind) || a.port - b.port || a.label.localeCompare(b.label)
    )
  }

  private snapshotResult(): ScanResult {
    return {
      instances: this.snapshot(),
      webApps: this.webApps,
      scannedAt: this.lastScanAt,
      dockerAvailable: this.dockerAvailable,
      probedPorts: this.probedPorts,
      detectedPorts: this.detectedPorts
    }
  }

  private update(id: string, patch: Partial<InstanceMeta>): void {
    const current = this.instances.get(id)
    if (!current) return
    this.instances.set(id, { ...current, ...patch })
  }

  private requireInstance(id: string): InstanceMeta {
    const instance = this.instances.get(id)
    if (!instance) throw new Error('实例不存在，请重新扫描或重新添加')
    return instance
  }

  private closeConnections(id: string): void {
    const pool = this.mysqlPools.get(id)
    if (pool) {
      pool.end().catch(() => {})
      this.mysqlPools.delete(id)
    }
    const client = this.redisClients.get(id)
    if (client) {
      try {
        client.disconnect()
      } catch {
        // ignore
      }
      this.redisClients.delete(id)
    }
    this.redisDb.delete(id)
  }

  private async doScan(): Promise<ScanResult> {
    const config = loadConfig()
    const discovery = await discover(config.settings)
    this.containersByPort = discovery.containersByPort
    this.dockerAvailable = discovery.dockerAvailable
    this.probedPorts = discovery.probedPorts
    this.detectedPorts = discovery.detectedPorts

    const knownIds = new Set<string>()
    for (const meta of discovery.instances) {
      knownIds.add(meta.id)
      const previous = this.instances.get(meta.id)
      this.instances.set(meta.id, { ...meta, version: meta.version ?? previous?.version })
    }

    for (const manual of config.manual) {
      const id = instanceIdFor(manual.kind, manual.host, manual.port)
      knownIds.add(id)
      const existing = this.instances.get(id)
      if (existing) {
        this.instances.set(id, { ...existing, manual: true })
      } else {
        this.instances.set(id, {
          id,
          kind: manual.kind,
          host: manual.host,
          port: manual.port,
          source: 'manual',
          label: manual.label || `${manual.kind} @ ${manual.host}:${manual.port}`,
          status: 'checking',
          manual: true
        })
      }
    }

    for (const [id, instance] of [...this.instances.entries()]) {
      if (!knownIds.has(id) && !instance.manual) {
        this.closeConnections(id)
        clearColumnsCache(id)
        this.instances.delete(id)
        this.mysqlCreds.delete(id)
        this.redisCreds.delete(id)
      }
    }

    const targets = [...this.instances.keys()]
    const [webApps] = await Promise.all([
      this.refreshWebApps(config.settings).catch(() => [] as WebAppInfo[]),
      mapLimit(targets, 6, (id) => this.connectInstance(id))
    ])
    this.webApps = webApps

    this.lastScanAt = Date.now()
    return this.snapshotResult()
  }

  private async connectInstance(id: string): Promise<void> {
    const instance = this.instances.get(id)
    if (!instance) return
    this.closeConnections(id)
    this.instances.set(id, { ...instance, status: 'checking', error: undefined })

    const stored = loadConfig().credentials[id]
    try {
      if (instance.kind === 'mysql') {
        await this.connectMysql(id, stored)
      } else {
        await this.connectRedis(id, stored)
      }
    } catch (error) {
      this.update(id, { status: 'error', error: errorMessage(error) })
    }
  }

  private async connectMysql(id: string, stored?: StoredCredential): Promise<void> {
    const instance = this.instances.get(id)
    if (!instance) return
    const localHost = instance.host === '127.0.0.1' || instance.host === 'localhost'
    const env = localHost ? this.containersByPort.get(instance.port)?.env : undefined

    const candidates: Credentials[] = []
    if (stored && (stored.username !== undefined || stored.password !== undefined)) {
      candidates.push({ username: stored.username ?? 'root', password: stored.password ?? '' })
    }
    if (env) {
      if (env.MYSQL_ROOT_PASSWORD !== undefined) {
        candidates.push({ username: 'root', password: env.MYSQL_ROOT_PASSWORD })
      }
      if (env.MYSQL_USER && env.MYSQL_PASSWORD !== undefined) {
        candidates.push({ username: env.MYSQL_USER, password: env.MYSQL_PASSWORD })
      }
    }
    candidates.push({ username: 'root', password: '' }, { username: 'root', password: 'root' })

    let lastError = ''
    let accessDenied = false
    const seen = new Set<string>()

    for (const candidate of candidates) {
      const fingerprint = `${candidate.username}\u0000${candidate.password}`
      if (seen.has(fingerprint)) continue
      seen.add(fingerprint)

      const opened = await openMysql({
        host: instance.host,
        port: instance.port,
        username: candidate.username,
        password: candidate.password
      })

      if (opened.pool) {
        this.mysqlPools.set(id, opened.pool)
        this.mysqlCreds.set(id, candidate)
        this.update(id, {
          status: 'ready',
          version: opened.version,
          username: candidate.username,
          error: undefined
        })
        rememberCredential(id, { username: candidate.username, password: candidate.password })
        return
      }

      lastError = opened.error ?? '连接失败'
      if (opened.accessDenied) {
        accessDenied = true
        continue
      }
      break
    }

    this.update(id, { status: accessDenied ? 'needCredentials' : 'error', error: lastError })
  }

  private async connectRedis(id: string, stored?: StoredCredential): Promise<void> {
    const instance = this.instances.get(id)
    if (!instance) return
    const localHost = instance.host === '127.0.0.1' || instance.host === 'localhost'
    const container = localHost ? this.containersByPort.get(instance.port) : undefined

    const candidates: Array<string | undefined> = []
    if (stored && 'password' in stored) candidates.push(stored.password ?? '')
    candidates.push('')
    if (container) {
      for (const name of ['REDIS_PASSWORD', 'REDIS_PASS', 'REDIS_AUTH']) {
        const value = container.env[name]
        if (value) candidates.push(value)
      }
      const match = /--requirepass\s+(\S+)/.exec(container.cmd)
      if (match) candidates.push(match[1])
    }

    let lastError = ''
    let authFailed = false
    const seen = new Set<string>()

    for (const password of candidates) {
      const fingerprint = password === undefined ? '\u0000undefined' : `\u0001${password}`
      if (seen.has(fingerprint)) continue
      seen.add(fingerprint)

      const opened = await openRedis(instance.host, instance.port, password)
      if (opened.client) {
        this.redisClients.set(id, opened.client)
        this.redisCreds.set(id, password)
        this.redisDb.set(id, 0)
        this.update(id, { status: 'ready', version: opened.version, error: undefined })
        rememberCredential(id, { password: password ?? '' })
        return
      }

      lastError = opened.error ?? '连接失败'
      if (opened.authFailed) {
        authFailed = true
        continue
      }
      break
    }

    this.update(id, { status: authFailed ? 'needCredentials' : 'error', error: lastError })
  }

  private async ensureMysqlPool(id: string): Promise<Pool> {
    const existing = this.mysqlPools.get(id)
    if (existing) return existing
    const instance = this.requireInstance(id)
    const stored = loadConfig().credentials[id]
    const credential =
      this.mysqlCreds.get(id) ??
      (stored && (stored.username !== undefined || stored.password !== undefined)
        ? { username: stored.username ?? 'root', password: stored.password ?? '' }
        : undefined)
    if (!credential) throw new Error('缺少 MySQL 连接凭据，请先填写账号密码')

    const opened = await openMysql({
      host: instance.host,
      port: instance.port,
      username: credential.username,
      password: credential.password
    })
    if (!opened.pool) {
      this.update(id, { status: 'error', error: opened.error })
      throw new Error(opened.error ?? 'MySQL 连接失败')
    }
    this.mysqlPools.set(id, opened.pool)
    this.mysqlCreds.set(id, credential)
    if (opened.version) this.update(id, { status: 'ready', version: opened.version })
    return opened.pool
  }

  private async ensureRedisClient(id: string): Promise<Redis> {
    const existing = this.redisClients.get(id)
    if (existing && existing.status === 'ready') return existing
    if (existing) {
      try {
        existing.disconnect()
      } catch {
        // ignore
      }
      this.redisClients.delete(id)
    }
    const instance = this.requireInstance(id)
    const stored = loadConfig().credentials[id]
    const password = this.redisCreds.has(id) ? this.redisCreds.get(id) : stored?.password

    const opened = await openRedis(instance.host, instance.port, password)
    if (!opened.client) {
      this.update(id, { status: 'error', error: opened.error })
      throw new Error(opened.error ?? 'Redis 连接失败')
    }
    this.redisClients.set(id, opened.client)
    this.redisCreds.set(id, password)
    const db = this.redisDb.get(id) ?? 0
    if (db !== 0) await opened.client.select(db)
    this.redisDb.set(id, db)
    return opened.client
  }

  async testConnection(input: ManualConnectionInput): Promise<TestConnectionResult> {
    const kind = normalizeKind(input.kind)
    let host: string
    let port: number
    try {
      host = normalizeHost(input.host)
      port = normalizePort(input.port)
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }

    if (kind === 'mysql') {
      const opened = await openMysql({
        host,
        port,
        username: input.username?.trim() || 'root',
        password: input.password ?? ''
      })
      if (opened.pool) {
        await opened.pool.end().catch(() => {})
        return { ok: true, version: opened.version }
      }
      return { ok: false, error: opened.error }
    }

    const opened = await openRedis(host, port, input.password)
    if (opened.client) {
      opened.client.disconnect()
      return { ok: true, version: opened.version }
    }
    return { ok: false, error: opened.error }
  }

  async addManual(input: ManualConnectionInput): Promise<InstanceMeta> {
    const kind = normalizeKind(input.kind)
    const host = normalizeHost(input.host)
    const port = normalizePort(input.port)
    const id = instanceIdFor(kind, host, port)
    const label = input.label?.trim() || `${kind === 'mysql' ? 'MySQL' : 'Redis'} @ ${host}:${port}`

    let version: string | undefined
    if (kind === 'mysql') {
      const username = input.username?.trim() || 'root'
      const password = input.password ?? ''
      const opened = await openMysql({ host, port, username, password })
      if (!opened.pool) throw new Error(`连接失败：${opened.error ?? '未知错误'}`)
      this.closeConnections(id)
      this.mysqlPools.set(id, opened.pool)
      this.mysqlCreds.set(id, { username, password })
      rememberCredential(id, { username, password })
      version = opened.version
    } else {
      const opened = await openRedis(host, port, input.password)
      if (!opened.client) throw new Error(`连接失败：${opened.error ?? '未知错误'}`)
      this.closeConnections(id)
      this.redisClients.set(id, opened.client)
      this.redisCreds.set(id, input.password)
      this.redisDb.set(id, 0)
      rememberCredential(id, { password: input.password ?? '' })
      version = opened.version
    }

    const existing = this.instances.get(id)
    const meta: InstanceMeta = {
      id,
      kind,
      host,
      port,
      source: 'manual',
      label,
      container: existing?.container,
      version,
      status: 'ready',
      username: kind === 'mysql' ? input.username?.trim() || 'root' : undefined,
      manual: true
    }
    this.instances.set(id, meta)

    const config = loadConfig()
    config.manual = config.manual.filter((item) => instanceIdFor(item.kind, item.host, item.port) !== id)
    config.manual.push({ kind, host, port, label })
    saveConfig()

    return meta
  }

  async removeManual(id: string): Promise<void> {
    const instance = this.instances.get(id)
    if (!instance) return
    const config = loadConfig()
    config.manual = config.manual.filter((item) => instanceIdFor(item.kind, item.host, item.port) !== id)
    delete config.credentials[id]
    saveConfig()

    this.closeConnections(id)
    clearColumnsCache(id)
    this.mysqlCreds.delete(id)
    this.redisCreds.delete(id)
    this.instances.delete(id)
  }

  async setCredentials(input: CredentialInput): Promise<InstanceMeta> {
    const instance = this.requireInstance(input.instanceId)

    if (instance.kind === 'mysql') {
      const username = input.username?.trim() || 'root'
      const password = input.password ?? ''
      const opened = await openMysql({ host: instance.host, port: instance.port, username, password })
      if (!opened.pool) throw new Error(opened.error ?? '连接失败')
      this.closeConnections(instance.id)
      this.mysqlPools.set(instance.id, opened.pool)
      this.mysqlCreds.set(instance.id, { username, password })
      rememberCredential(instance.id, { username, password })
      this.update(instance.id, {
        status: 'ready',
        version: opened.version,
        username,
        error: undefined
      })
    } else {
      const password = input.password ?? ''
      const opened = await openRedis(instance.host, instance.port, password)
      if (!opened.client) throw new Error(opened.error ?? '连接失败')
      this.closeConnections(instance.id)
      this.redisClients.set(instance.id, opened.client)
      this.redisCreds.set(instance.id, password)
      this.redisDb.set(instance.id, 0)
      rememberCredential(instance.id, { password })
      this.update(instance.id, { status: 'ready', version: opened.version, error: undefined })
    }

    return this.requireInstance(instance.id)
  }

  private localPorts(): number[] {
    return [...this.instances.values()]
      .filter((instance) => instance.host === '127.0.0.1' || instance.host === 'localhost')
      .map((instance) => instance.port)
  }

  private async refreshWebApps(
    settings: AppSettings = this.currentSettings()
  ): Promise<WebAppInfo[]> {
    const online = await detectWebApps(this.localPorts(), settings)
    const config = loadConfig()
    const merged = mergeWebHistory(
      config.webHistory ?? [],
      online,
      Date.now(),
      settings.webHistoryLimit,
      settings.projectOverrides
    )
    config.webHistory = merged.history
    saveConfig()
    this.webApps = merged.webApps
    return this.webApps
  }

  async scanWeb(): Promise<WebAppInfo[]> {
    return this.refreshWebApps()
  }

  private logsDir(): string {
    return join(app.getPath('userData'), 'logs')
  }

  private webLogPathFor(port: number): string {
    return join(this.logsDir(), `web-${port}.log`)
  }

  async killWebProcess(port: number, pid: number): Promise<WebActionResult> {
    if (!Number.isInteger(port) || !Number.isInteger(pid)) throw new Error('参数不合法')
    const target = this.webApps.find(
      (item) => item.online && item.port === port && item.pid === pid
    )
    if (!target) throw new Error('该端口记录已失效，请刷新列表')
    if (pid <= 1 || pid === process.pid) throw new Error('拒绝操作该进程')
    if (!target.killable) throw new Error(target.killBlockedReason ?? '该进程不允许关闭')

    const result = await this.killWebProcesses([{ port, pid }])
    const processCount = target.pids?.length ?? 1
    return {
      ...result,
      message: result.ok
        ? `已关闭端口 ${port} 对应进程${processCount > 1 ? `（${processCount} 个）` : ''}`
        : `已向端口 ${port} 的进程发送信号，但端口仍被占用（可能有守护进程自动重启）`
    }
  }

  async killWebProcesses(items: Array<{ port: number; pid: number }>): Promise<WebActionResult> {
    if (!Array.isArray(items) || items.length === 0) throw new Error('没有需要关闭的端口')
    const targets: WebAppInfo[] = []
    const seen = new Set<string>()

    for (const item of items) {
      if (!Number.isInteger(item?.port) || !Number.isInteger(item?.pid)) continue
      const key = `${item.port}:${item.pid}`
      if (seen.has(key)) continue
      seen.add(key)
      const target = this.webApps.find(
        (app) => app.online && app.port === item.port && app.pid === item.pid
      )
      if (!target || !target.killable || !target.pid) continue
      if (target.pid <= 1 || target.pid === process.pid) continue
      targets.push(target)
    }

    if (targets.length === 0) throw new Error('没有可关闭的端口（可能无权限或已离线）')

    const targetPids = [
      ...new Set(
        targets.flatMap((target) =>
          (target.pids && target.pids.length > 0 ? target.pids : target.pid ? [target.pid] : []).filter(
            (pid) => pid > 1 && pid !== process.pid
          )
        )
      )
    ]
    if (targetPids.length === 0) throw new Error('没有可关闭的进程')

    for (const pid of targetPids) {
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        // ignore, reported by the re-scan below
      }
    }
    await wait(700)
    for (const pid of targetPids) {
      try {
        process.kill(pid, 0)
        process.kill(pid, 'SIGKILL')
      } catch {
        // already exited
      }
    }
    await wait(300)

    const webApps = await this.refreshWebApps()
    const remaining = targets.filter((target) =>
      webApps.some((app) => app.online && app.port === target.port)
    )
    const closed = targets.length - remaining.length
    return {
      ok: remaining.length === 0,
      message:
        remaining.length === 0
          ? `已关闭 ${closed} 个端口`
          : `已关闭 ${closed} 个端口，${remaining.length} 个仍被占用（可能有守护进程自动重启）`,
      webApps
    }
  }

  private spawnWebEntry(entry: StoredWebHistoryEntry): void {
    if (!entry.commandLine || !entry.cwd || !existsSync(entry.cwd)) {
      throw new Error('缺少启动命令或工作目录')
    }
    const logPath = this.webLogPathFor(entry.port)
    let logFd: number | null = null
    try {
      mkdirSync(this.logsDir(), { recursive: true })
      // 每次启动截断该端口日志，避免历史输出与本次进程混淆
      logFd = openSync(logPath, 'w')
      writeSync(
        logFd,
        `[${new Date().toISOString()}] port=${entry.port} cwd=${entry.cwd}\n$ ${entry.commandLine}\n`
      )
      const child = spawn(shellBinary(), ['-lc', entry.commandLine], {
        cwd: entry.cwd,
        detached: true,
        stdio: ['ignore', logFd, logFd]
      })
      child.unref()
    } finally {
      if (logFd !== null) {
        try {
          closeSync(logFd)
        } catch {
          // ignore
        }
      }
    }
  }

  async clearWebHistory(): Promise<WebAppInfo[]> {
    const config = loadConfig()
    config.webHistory = []
    saveConfig()
    return this.refreshWebApps()
  }

  async startWebProcess(port: number): Promise<WebActionResult> {
    if (!Number.isInteger(port)) throw new Error('参数不合法')
    const result = await this.startWebProcesses([port])
    return {
      ...result,
      message: result.ok
        ? `端口 ${port} 已重新上线`
        : `${result.message}；日志：${this.webLogPathFor(port)}`
    }
  }

  async startWebProcesses(ports: number[]): Promise<WebActionResult> {
    if (!Array.isArray(ports) || ports.length === 0) throw new Error('没有需要启动的端口')
    const history = loadConfig().webHistory ?? []
    const entries = [...new Set(ports)]
      .map((port) => history.find((entry) => entry.port === port))
      .filter((entry): entry is StoredWebHistoryEntry => Boolean(entry))
    const valid = entries.filter(
      (entry) => Boolean(entry.commandLine) && Boolean(entry.cwd) && existsSync(entry.cwd!)
    )
    if (valid.length === 0) throw new Error('没有可用的历史启动记录（缺少命令或工作目录）')

    const errors: string[] = []
    const spawned: StoredWebHistoryEntry[] = []
    for (const entry of valid) {
      try {
        this.spawnWebEntry(entry)
        spawned.push(entry)
      } catch (error) {
        errors.push(`:${entry.port} ${errorMessage(error)}`)
      }
    }
    if (spawned.length === 0) throw new Error(`启动失败：${errors.join('；')}`)

    // 慢启动的框架（Next.js / Spring 等）可能超过固定等待时间，这里轮询端口直到上线或超时
    const deadline = Date.now() + 9000
    const up = new Set<number>()
    while (Date.now() < deadline) {
      await wait(600)
      const pending = spawned.filter((entry) => !up.has(entry.port))
      const results = await Promise.all(
        pending.map(async (entry) => ({
          port: entry.port,
          online: Boolean(await probeHttp(entry.port, 500))
        }))
      )
      for (const result of results) {
        if (result.online) up.add(result.port)
      }
      if (up.size === spawned.length) break
    }

    const webApps = await this.refreshWebApps()
    const online = spawned.filter((entry) =>
      webApps.some((app) => app.online && app.port === entry.port)
    )
    return {
      ok: online.length > 0,
      message: `已执行 ${spawned.length} 个启动命令，${online.length}/${spawned.length} 个端口已上线${
        errors.length > 0 ? `；失败 ${errors.length} 个` : ''
      }`,
      webApps
    }
  }

  private lsofFds(pids: number[]): Promise<string | null> {
    return new Promise((resolve) => {
      execFile(
        lsofBinary(),
        ['-a', '-p', pids.join(','), '-d', '1,2', '-Fn'],
        { timeout: 3000, maxBuffer: 2 * 1024 * 1024 },
        (error, stdout) => {
          // 进程消失时 lsof 会以非零退出，但仍可能输出部分结果
          if (typeof stdout === 'string' && stdout.length > 0) resolve(stdout)
          else resolve(error ? null : '')
        }
      )
    })
  }

  private async probeLogFile(
    app: WebAppInfo,
    pids: number[] = (app.pids && app.pids.length > 0 ? app.pids : app.pid ? [app.pid] : [])
  ): Promise<string | null> {
    if (pids.length === 0) return null
    const output = await this.lsofFds(pids)
    if (!output) return null
    const parsed = parseLsofFds(output)
    for (const pid of pids) {
      for (const path of parsed.get(pid) ?? []) {
        try {
          if (statSync(path).isFile()) return path
        } catch {
          // 无权限或文件已删除，继续尝试下一个
        }
      }
    }
    return null
  }

  private webLogUnavailableReason(app: WebAppInfo | undefined, online: boolean): string {
    if (!app) return '端口记录已失效，请重新扫描'
    if (!online) return '服务未运行，且没有可读取的历史输出文件'
    const processes = app.processes ?? []
    if (
      processes.some(
        (item) => isDockerCommand(item.command) || isSshCommand(item.command)
      )
    ) {
      return 'Docker / SSH 转发进程无法直接读取输出'
    }
    const selfUser = os.userInfo().username
    const other = processes.find((item) => item.user && item.user !== selfUser)
    if (other && processes.every((item) => item.user !== selfUser)) {
      return `进程属于用户 ${other.user}，无法读取输出`
    }
    return `该进程不是由 ${APP_NAME} 启动，且输出没有写入文件；可重启以捕获日志`
  }

  async webLogInfo(port: number): Promise<WebLogInfo> {
    if (!Number.isInteger(port) || port <= 0) throw new Error('端口不合法')
    const app = this.webApps.find((item) => item.port === port)
    const processList = app?.processes ?? []
    const allPids =
      app?.pids && app.pids.length > 0 ? app.pids : app?.pid ? [app.pid] : []
    const alive = allPids.filter((pid) => pidAlive(pid))
    const online = Boolean(app?.online) && (allPids.length === 0 || alive.length > 0)
    const expected = this.webLogPathFor(port)
    const selfUser = os.userInfo().username
    // 只读取当前用户进程的 fd，避免触碰其他用户的文件
    const ownPids =
      processList.length > 0
        ? processList
            .filter((item) => item.user === selfUser)
            .map((item) => item.pid)
            .filter((pid) => alive.includes(pid))
        : alive
    let path: string | null = null

    // 只信任当前进程 fd 实际指向的文件；避免端口被新进程占用后继续展示旧日志
    if (online && app && ownPids.length > 0) path = await this.probeLogFile(app, ownPids)
    // 离线时回退到该端口上次启动留下的日志
    if (!path && !online && app && existsSync(expected)) path = expected

    if (!path) {
      return {
        source: 'unavailable',
        reason: this.webLogUnavailableReason(app, online),
        lines: [],
        online
      }
    }

    const source: WebLogSource = path === expected ? 'launch' : 'file'
    return { source, path, lines: readTail(path, MAX_LINES), online }
  }

  async subscribeWebLog(
    port: number,
    listener: (lines: string[]) => void
  ): Promise<WebLogInfo> {
    const info = await this.webLogInfo(port)
    if (!info.path) return info

    let entry = this.logTails.get(port)
    if (entry && entry.path !== info.path) {
      entry.tail.stop()
      this.logTails.delete(port)
      entry = undefined
    }
    if (!entry) {
      const tail = new LogTail(info.path, {
        onLines: (lines) => {
          this.logTails.get(port)?.listeners.forEach((item) => item(lines))
        },
        onError: () => {}
      })
      entry = { path: info.path, tail, listeners: new Set() }
      this.logTails.set(port, entry)
      tail.start()
    }
    entry.listeners.add(listener)
    return info
  }

  unsubscribeWebLog(port: number, listener: (lines: string[]) => void): void {
    const entry = this.logTails.get(port)
    if (!entry) return
    entry.listeners.delete(listener)
    if (entry.listeners.size === 0) {
      entry.tail.stop()
      this.logTails.delete(port)
    }
  }

  async restartWebProcess(port: number): Promise<WebActionResult> {
    if (!Number.isInteger(port) || port <= 0) throw new Error('端口不合法')
    const app = this.webApps.find((item) => item.port === port && item.online)
    if (!app) throw new Error('该端口当前不在线')
    if (!app.pid) throw new Error('缺少进程 PID')
    if (!app.killable) throw new Error(app.killBlockedReason ?? '该进程不允许重启')

    const history = loadConfig().webHistory ?? []
    const entry = history.find((item) => item.port === port)
    if (!entry?.commandLine || !entry.cwd || !existsSync(entry.cwd)) {
      throw new Error('缺少历史启动命令或工作目录，无法自动重启')
    }

    const closed = await this.killWebProcesses([{ port, pid: app.pid }])
    if (!closed.ok) {
      return { ...closed, message: `未能结束当前进程，无法重启；${closed.message}` }
    }
    return this.startWebProcesses([port])
  }

  async mysqlDatabases(instanceId: string): Promise<string[]> {
    const pool = await this.ensureMysqlPool(instanceId)
    return listDatabases(pool)
  }

  async mysqlTables(instanceId: string, database: string): Promise<MysqlTableInfo[]> {
    if (!database) throw new Error('数据库名不能为空')
    const pool = await this.ensureMysqlPool(instanceId)
    return listTables(pool, database)
  }

  async mysqlColumns(instanceId: string, database: string, table: string): Promise<MysqlColumnInfo[]> {
    if (!database || !table) throw new Error('数据库名或表名不能为空')
    const pool = await this.ensureMysqlPool(instanceId)
    return listColumns(pool, instanceId, database, table)
  }

  async mysqlIndexes(instanceId: string, database: string, table: string): Promise<MysqlIndexInfo[]> {
    if (!database || !table) throw new Error('数据库名或表名不能为空')
    const pool = await this.ensureMysqlPool(instanceId)
    return listIndexes(pool, database, table)
  }

  async mysqlQuery(input: MysqlQueryInput): Promise<MysqlQueryResult> {
    if (!input.database || !input.table) throw new Error('数据库名或表名不能为空')
    const pool = await this.ensureMysqlPool(input.instanceId)
    return queryTable(pool, input.instanceId, input)
  }

  private assertDb(db: number): void {
    const limit = this.currentSettings().redisDbs
    if (!Number.isInteger(db) || db < 0 || db >= limit) throw new Error('Redis db 不合法')
  }

  private async selectDbIfNeeded(id: string, client: Redis, db: number): Promise<void> {
    if ((this.redisDb.get(id) ?? 0) !== db) {
      await client.select(db)
      this.redisDb.set(id, db)
    }
  }

  /**
   * Redis 连接上共享同一个连接的 SELECT 状态，多个 db 的请求并发时会串库。
   * 这里按实例串行化「切库 + 执行命令」。
   */
  private async withRedisDb<T>(
    id: string,
    db: number,
    task: (client: Redis) => Promise<T>
  ): Promise<T> {
    const previous = this.redisLocks.get(id) ?? Promise.resolve()
    const run = previous
      .catch(() => {})
      .then(async () => {
        const client = await this.ensureRedisClient(id)
        await this.selectDbIfNeeded(id, client, db)
        return task(client)
      })
    this.redisLocks.set(
      id,
      run.catch(() => {})
    )
    return run
  }

  async redisSelectDb(instanceId: string, db: number): Promise<void> {
    this.assertDb(db)
    await this.withRedisDb(instanceId, db, async () => {})
  }

  async redisKeys(input: RedisKeysInput): Promise<RedisKeyPage> {
    this.assertDb(input.db)
    return this.withRedisDb(input.instanceId, input.db, (client) =>
      scanKeys(client, input.cursor || '0', input.pattern)
    )
  }

  async redisKeyDetail(input: RedisKeyDetailInput): Promise<RedisKeyDetail> {
    this.assertDb(input.db)
    if (!input.key) throw new Error('Key 不能为空')
    return this.withRedisDb(input.instanceId, input.db, (client) => keyDetail(client, input.key))
  }
}
