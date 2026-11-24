import { contextBridge, ipcRenderer } from 'electron'
import type { LocalPeekApi, ScanResult, WebLogLinesEvent } from '../shared/types'
import type { UpdateProgress } from '../shared/update'

const api: LocalPeekApi = {
  scan: () => ipcRenderer.invoke('localpeek:scan'),
  settings: () => ipcRenderer.invoke('localpeek:settings'),
  updateSettings: (patch) => ipcRenderer.invoke('localpeek:settings:update', patch),
  paths: () => ipcRenderer.invoke('localpeek:paths'),
  updates: {
    check: () => ipcRenderer.invoke('localpeek:update:check'),
    download: () => ipcRenderer.invoke('localpeek:update:download'),
    install: () => ipcRenderer.invoke('localpeek:update:install'),
    openDownloaded: () => ipcRenderer.invoke('localpeek:update:open'),
    onProgress: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: UpdateProgress): void =>
        callback(progress)
      ipcRenderer.on('localpeek:update:progress', handler)
      return () => ipcRenderer.removeListener('localpeek:update:progress', handler)
    }
  },
  onNavigate: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, port: number): void => callback(port)
    ipcRenderer.on('localpeek:navigate', handler)
    return () => ipcRenderer.removeListener('localpeek:navigate', handler)
  },
  onOpenSettings: (callback) => {
    const handler = (): void => callback()
    ipcRenderer.on('localpeek:openSettings', handler)
    return () => ipcRenderer.removeListener('localpeek:openSettings', handler)
  },
  onScanResult: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, result: ScanResult): void =>
      callback(result)
    ipcRenderer.on('localpeek:scanResult', handler)
    return () => ipcRenderer.removeListener('localpeek:scanResult', handler)
  },
  currentInstances: () => ipcRenderer.invoke('localpeek:instances'),
  testConnection: (input) => ipcRenderer.invoke('localpeek:testConnection', input),
  addManual: (input) => ipcRenderer.invoke('localpeek:addManual', input),
  removeManual: (instanceId) => ipcRenderer.invoke('localpeek:removeManual', instanceId),
  setCredentials: (input) => ipcRenderer.invoke('localpeek:setCredentials', input),
  mysql: {
    databases: (instanceId) => ipcRenderer.invoke('localpeek:mysql:databases', instanceId),
    tables: (instanceId, database) =>
      ipcRenderer.invoke('localpeek:mysql:tables', instanceId, database),
    columns: (instanceId, database, table) =>
      ipcRenderer.invoke('localpeek:mysql:columns', instanceId, database, table),
    indexes: (instanceId, database, table) =>
      ipcRenderer.invoke('localpeek:mysql:indexes', instanceId, database, table),
    query: (input) => ipcRenderer.invoke('localpeek:mysql:query', input)
  },
  redis: {
    selectDb: (instanceId, db) => ipcRenderer.invoke('localpeek:redis:selectDb', instanceId, db),
    keys: (input) => ipcRenderer.invoke('localpeek:redis:keys', input),
    keyDetail: (input) => ipcRenderer.invoke('localpeek:redis:keyDetail', input)
  },
  web: {
    scan: () => ipcRenderer.invoke('localpeek:web:scan'),
    kill: (port, pid) => ipcRenderer.invoke('localpeek:web:kill', port, pid),
    killMany: (items) => ipcRenderer.invoke('localpeek:web:killMany', items),
    start: (port) => ipcRenderer.invoke('localpeek:web:start', port),
    startMany: (ports) => ipcRenderer.invoke('localpeek:web:startMany', ports),
    clearHistory: () => ipcRenderer.invoke('localpeek:web:clearHistory'),
    logInfo: (port) => ipcRenderer.invoke('localpeek:web:logInfo', port),
    followLog: (port) => ipcRenderer.invoke('localpeek:web:logFollow', port),
    unfollowLog: (port) => ipcRenderer.invoke('localpeek:web:logUnfollow', port),
    restartForLog: (port) => ipcRenderer.invoke('localpeek:web:restartForLog', port),
    onLogLines: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: WebLogLinesEvent): void =>
        callback(payload)
      ipcRenderer.on('localpeek:web:logLines', handler)
      return () => ipcRenderer.removeListener('localpeek:web:logLines', handler)
    }
  },
  openExternal: (url) => ipcRenderer.invoke('localpeek:openExternal', url)
}

contextBridge.exposeInMainWorld('localpeek', api)
