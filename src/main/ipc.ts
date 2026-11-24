import { ipcMain, shell } from 'electron'
import type { AppSettings } from '../shared/settings'
import type {
  CredentialInput,
  ManualConnectionInput,
  MysqlQueryInput,
  RedisKeyDetailInput,
  RedisKeysInput,
  WebLogLinesEvent
} from '../shared/types'
import type { DbManager } from './manager'

export function registerIpc(manager: DbManager): void {
  const logSubscriptions = new Map<number, Map<number, (lines: string[]) => void>>()

  const cleanupSubscriptions = (webContentsId: number): void => {
    const map = logSubscriptions.get(webContentsId)
    if (!map) return
    for (const [port, listener] of map) manager.unsubscribeWebLog(port, listener)
    logSubscriptions.delete(webContentsId)
  }

  ipcMain.handle('localpeek:scan', () => manager.scan())
  ipcMain.handle('localpeek:settings', () => manager.currentSettings())
  ipcMain.handle('localpeek:settings:update', (_event, patch: Partial<AppSettings>) =>
    manager.updateSettings(patch)
  )
  ipcMain.handle('localpeek:paths', () => manager.paths())
  ipcMain.handle('localpeek:instances', () => manager.currentInstances())
  ipcMain.handle('localpeek:testConnection', (_event, input: ManualConnectionInput) =>
    manager.testConnection(input)
  )
  ipcMain.handle('localpeek:addManual', (_event, input: ManualConnectionInput) =>
    manager.addManual(input)
  )
  ipcMain.handle('localpeek:removeManual', (_event, instanceId: string) =>
    manager.removeManual(instanceId)
  )
  ipcMain.handle('localpeek:setCredentials', (_event, input: CredentialInput) =>
    manager.setCredentials(input)
  )

  ipcMain.handle('localpeek:mysql:databases', (_event, instanceId: string) =>
    manager.mysqlDatabases(instanceId)
  )
  ipcMain.handle('localpeek:mysql:tables', (_event, instanceId: string, database: string) =>
    manager.mysqlTables(instanceId, database)
  )
  ipcMain.handle(
    'localpeek:mysql:columns',
    (_event, instanceId: string, database: string, table: string) =>
      manager.mysqlColumns(instanceId, database, table)
  )
  ipcMain.handle(
    'localpeek:mysql:indexes',
    (_event, instanceId: string, database: string, table: string) =>
      manager.mysqlIndexes(instanceId, database, table)
  )
  ipcMain.handle('localpeek:mysql:query', (_event, input: MysqlQueryInput) =>
    manager.mysqlQuery(input)
  )

  ipcMain.handle('localpeek:redis:selectDb', (_event, instanceId: string, db: number) =>
    manager.redisSelectDb(instanceId, db)
  )
  ipcMain.handle('localpeek:redis:keys', (_event, input: RedisKeysInput) => manager.redisKeys(input))
  ipcMain.handle('localpeek:redis:keyDetail', (_event, input: RedisKeyDetailInput) =>
    manager.redisKeyDetail(input)
  )

  ipcMain.handle('localpeek:web:scan', () => manager.scanWeb())
  ipcMain.handle('localpeek:web:kill', (_event, port: number, pid: number) =>
    manager.killWebProcess(port, pid)
  )
  ipcMain.handle('localpeek:web:start', (_event, port: number) => manager.startWebProcess(port))
  ipcMain.handle(
    'localpeek:web:killMany',
    (_event, items: Array<{ port: number; pid: number }>) => manager.killWebProcesses(items)
  )
  ipcMain.handle('localpeek:web:startMany', (_event, ports: number[]) =>
    manager.startWebProcesses(ports)
  )
  ipcMain.handle('localpeek:web:clearHistory', () => manager.clearWebHistory())
  ipcMain.handle('localpeek:web:logInfo', (_event, port: number) => manager.webLogInfo(port))
  ipcMain.handle('localpeek:web:logFollow', (event, port: number) => {
    const sender = event.sender
    const senderId = sender.id
    let map = logSubscriptions.get(senderId)
    if (!map) {
      map = new Map()
      logSubscriptions.set(senderId, map)
      sender.once('destroyed', () => cleanupSubscriptions(senderId))
    }
    const previous = map.get(port)
    if (previous) manager.unsubscribeWebLog(port, previous)

    const listener = (lines: string[]): void => {
      if (sender.isDestroyed()) return
      const payload: WebLogLinesEvent = { port, lines }
      sender.send('localpeek:web:logLines', payload)
    }
    map.set(port, listener)
    return manager.subscribeWebLog(port, listener)
  })
  ipcMain.handle('localpeek:web:logUnfollow', (event, port: number) => {
    const map = logSubscriptions.get(event.sender.id)
    const listener = map?.get(port)
    if (!listener) return
    manager.unsubscribeWebLog(port, listener)
    map?.delete(port)
  })
  ipcMain.handle('localpeek:web:restartForLog', (_event, port: number) =>
    manager.restartWebProcess(port)
  )
  ipcMain.handle('localpeek:openExternal', async (_event, url: string) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      throw new Error('仅允许打开 http(s) 链接')
    }
    await shell.openExternal(url)
  })
}
