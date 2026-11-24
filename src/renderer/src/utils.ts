export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index++
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return value.toLocaleString('zh-CN')
}

export function formatTtl(ttl: number): string {
  if (ttl === -1) return '永久'
  if (ttl === -2 || ttl < 0) return '—'
  if (ttl < 60) return `${ttl}s`
  if (ttl < 3600) return `${Math.floor(ttl / 60)}m ${ttl % 60}s`
  if (ttl < 86400) return `${Math.floor(ttl / 3600)}h ${Math.floor((ttl % 3600) / 60)}m`
  return `${Math.floor(ttl / 86400)}d ${Math.floor((ttl % 86400) / 3600)}h`
}

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}

export function formatDateTime(timestamp?: number): string {
  if (!timestamp) return '—'
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

export function formatTime(timestamp: number): string {
  if (!timestamp) return '—'
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false })
}

export function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/^Error invoking remote method '[^']+':\s*/, '')
    .replace(/^Error:\s*/, '')
    .trim()
}

export type Selection =
  | { type: 'instance'; instanceId: string }
  | { type: 'database'; instanceId: string; database: string }
  | { type: 'table'; instanceId: string; database: string; table: string }
  | { type: 'web'; port?: number }
  | null

export function instanceKey(instanceId: string): string {
  return `instance|${encodeURIComponent(instanceId)}`
}

export function databaseKey(instanceId: string, database: string): string {
  return `db|${encodeURIComponent(instanceId)}|${encodeURIComponent(database)}`
}

export function tableKey(instanceId: string, database: string, table: string): string {
  return `table|${encodeURIComponent(instanceId)}|${encodeURIComponent(database)}|${encodeURIComponent(table)}`
}

export function webKey(port?: number): string {
  return port === undefined ? 'web|overview' : `web|${port}`
}

export function parseSelection(key?: string | null): Selection {
  if (!key) return null
  const parts = key.split('|')
  try {
    if (parts[0] === 'web' && parts.length === 2) {
      if (parts[1] === 'overview') return { type: 'web' }
      const port = Number(parts[1])
      return { type: 'web', port: Number.isInteger(port) ? port : undefined }
    }
    if (parts[0] === 'instance' && parts.length === 2) {
      return { type: 'instance', instanceId: decodeURIComponent(parts[1]) }
    }
    if (parts[0] === 'db' && parts.length === 3) {
      return {
        type: 'database',
        instanceId: decodeURIComponent(parts[1]),
        database: decodeURIComponent(parts[2])
      }
    }
    if (parts[0] === 'table' && parts.length === 4) {
      return {
        type: 'table',
        instanceId: decodeURIComponent(parts[1]),
        database: decodeURIComponent(parts[2]),
        table: decodeURIComponent(parts[3])
      }
    }
  } catch {
    return null
  }
  return null
}
