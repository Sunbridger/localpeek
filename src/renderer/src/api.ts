import type { LocalPeekApi } from '../../shared/types'
import { cleanError } from './utils'

function wrap<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return async (...args: A): Promise<R> => {
    try {
      return await fn(...args)
    } catch (error) {
      throw new Error(cleanError(error))
    }
  }
}

const raw = window.localpeek

export const api: LocalPeekApi = {
  scan: wrap(raw.scan),
  settings: wrap(raw.settings),
  updateSettings: wrap(raw.updateSettings),
  paths: wrap(raw.paths),
  onNavigate: raw.onNavigate,
  onOpenSettings: raw.onOpenSettings,
  onScanResult: raw.onScanResult,
  currentInstances: wrap(raw.currentInstances),
  testConnection: wrap(raw.testConnection),
  addManual: wrap(raw.addManual),
  removeManual: wrap(raw.removeManual),
  setCredentials: wrap(raw.setCredentials),
  mysql: {
    databases: wrap(raw.mysql.databases),
    tables: wrap(raw.mysql.tables),
    columns: wrap(raw.mysql.columns),
    indexes: wrap(raw.mysql.indexes),
    query: wrap(raw.mysql.query)
  },
  redis: {
    selectDb: wrap(raw.redis.selectDb),
    keys: wrap(raw.redis.keys),
    keyDetail: wrap(raw.redis.keyDetail)
  },
  web: {
    scan: wrap(raw.web.scan),
    kill: wrap(raw.web.kill),
    killMany: wrap(raw.web.killMany),
    start: wrap(raw.web.start),
    startMany: wrap(raw.web.startMany),
    clearHistory: wrap(raw.web.clearHistory),
    logInfo: wrap(raw.web.logInfo),
    followLog: wrap(raw.web.followLog),
    unfollowLog: wrap(raw.web.unfollowLog),
    restartForLog: wrap(raw.web.restartForLog),
    onLogLines: raw.web.onLogLines
  },
  openExternal: wrap(raw.openExternal)
}
