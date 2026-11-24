import { app } from 'electron'
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import { CONFIG_FILE_NAME } from '../shared/appInfo'
import {
  DEFAULT_SETTINGS,
  sanitizeSettings,
  type AppSettings
} from '../shared/settings'
import type { DbKind, WebAppRole } from '../shared/types'

export interface StoredCredential {
  username?: string
  password?: string
}

export interface StoredManualConnection {
  kind: DbKind
  host: string
  port: number
  label?: string
}

export interface StoredWebHistoryEntry {
  port: number
  role: WebAppRole
  title?: string
  command: string
  commandLine: string
  project?: string
  projectAuto?: string
  projectKey?: string
  cwd?: string
  lastSeenAt: number
}

export interface PersistedConfig {
  version: 2
  manual: StoredManualConnection[]
  credentials: Record<string, StoredCredential>
  webHistory: StoredWebHistoryEntry[]
  settings: AppSettings
}

let cache: PersistedConfig | null = null

export function configPath(): string {
  return join(app.getPath('userData'), CONFIG_FILE_NAME)
}

function emptyConfig(): PersistedConfig {
  return {
    version: 2,
    manual: [],
    credentials: {},
    webHistory: [],
    settings: sanitizeSettings(DEFAULT_SETTINGS)
  }
}

/**
 * 旧版本 userData 目录（localdb / LocalDB）或开发期 Electron 目录中的配置，
 * 在首次启动时复制到新位置；失败不影响启动。
 */
function migrateLegacyData(): void {
  if (existsSync(configPath())) return
  const appData = app.getPath('appData')
  for (const name of ['localdb', 'LocalDB', 'Electron']) {
    const legacyDir = join(appData, name)
    const legacyConfig = join(legacyDir, 'localdb-config.json')
    if (!existsSync(legacyConfig)) continue
    try {
      mkdirSync(dirname(configPath()), { recursive: true })
      copyFileSync(legacyConfig, configPath())
      const legacyLogs = join(legacyDir, 'logs')
      if (existsSync(legacyLogs)) {
        cpSync(legacyLogs, join(app.getPath('userData'), 'logs'), {
          recursive: true,
          force: false,
          errorOnExist: false
        })
      }
      // 让渲染层的 localStorage 迁移（localdb.* -> localpeek.*）有旧数据可读
      const legacyStorage = join(legacyDir, 'Local Storage')
      if (existsSync(legacyStorage)) {
        cpSync(legacyStorage, join(app.getPath('userData'), 'Local Storage'), {
          recursive: true,
          force: false,
          errorOnExist: false
        })
      }
    } catch (error) {
      console.error('[LocalPeek] 迁移旧配置失败', error)
    }
    return
  }
}

export function loadConfig(): PersistedConfig {
  if (cache) return cache
  migrateLegacyData()
  try {
    const raw = JSON.parse(readFileSync(configPath(), 'utf8')) as Partial<PersistedConfig>
    cache = {
      version: 2,
      manual: Array.isArray(raw.manual) ? raw.manual : [],
      credentials: raw.credentials && typeof raw.credentials === 'object' ? raw.credentials : {},
      webHistory: Array.isArray(raw.webHistory) ? raw.webHistory : [],
      settings: sanitizeSettings(raw.settings)
    }
  } catch {
    cache = emptyConfig()
  }
  return cache
}

export function saveConfig(): void {
  if (!cache) return
  try {
    writeFileSync(configPath(), JSON.stringify(cache, null, 2), { mode: 0o600 })
  } catch (error) {
    console.error('[LocalPeek] 保存配置失败', error)
  }
}

export function rememberCredential(instanceId: string, credential: StoredCredential): void {
  const config = loadConfig()
  config.credentials[instanceId] = credential
  saveConfig()
}
