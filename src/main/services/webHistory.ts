import { resolveProjectName } from '../../shared/settings'
import type { WebAppInfo, WebAppRole } from '../../shared/types'
import type { StoredWebHistoryEntry } from '../config'

export const WEB_HISTORY_LIMIT = 50

export interface MergedWebHistory {
  history: StoredWebHistoryEntry[]
  webApps: WebAppInfo[]
}

function isEntryValid(entry: StoredWebHistoryEntry | undefined): entry is StoredWebHistoryEntry {
  return Boolean(
    entry &&
      Number.isInteger(entry.port) &&
      entry.port > 0 &&
      typeof entry.commandLine === 'string'
  )
}

export function mergeWebHistory(
  history: StoredWebHistoryEntry[],
  online: WebAppInfo[],
  seenAt: number,
  limit = WEB_HISTORY_LIMIT,
  projectOverrides: Record<string, string> = {}
): MergedWebHistory {
  const onlinePorts = new Set(online.map((app) => app.port))
  const byPort = new Map<number, StoredWebHistoryEntry>()

  for (const entry of history) {
    if (!isEntryValid(entry)) continue
    const auto = entry.projectAuto ?? entry.project
    byPort.set(entry.port, {
      ...entry,
      project: resolveProjectName(entry.projectKey, auto, projectOverrides),
      projectAuto: auto
    })
  }

  for (const app of online) {
    byPort.set(app.port, {
      port: app.port,
      role: app.role,
      title: app.title,
      command: app.command,
      commandLine: app.commandLine ?? app.command,
      project: app.project,
      projectAuto: app.projectAuto,
      projectKey: app.projectKey,
      cwd: app.cwd,
      lastSeenAt: seenAt
    })
  }

  const nextHistory = [...byPort.values()]
    .sort((a, b) => {
      const aOnline = onlinePorts.has(a.port) ? 1 : 0
      const bOnline = onlinePorts.has(b.port) ? 1 : 0
      return bOnline - aOnline || b.lastSeenAt - a.lastSeenAt
    })
    .slice(0, limit)

  const storedPorts = new Set(nextHistory.map((entry) => entry.port))
  const offline: WebAppInfo[] = nextHistory
    .filter((entry) => !onlinePorts.has(entry.port))
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt || a.port - b.port)
    .map((entry) => ({
      port: entry.port,
      online: false,
      command: entry.command,
      commandLine: entry.commandLine,
      project: entry.project,
      projectAuto: entry.projectAuto,
      projectKey: entry.projectKey,
      cwd: entry.cwd,
      url: `http://localhost:${entry.port}/`,
      role: (entry.role ?? 'web') as WebAppRole,
      title: entry.title,
      killable: false,
      killBlockedReason: '服务未运行',
      startable: Boolean(entry.commandLine && entry.cwd),
      lastSeenAt: entry.lastSeenAt
    }))

  const onlineApps = [...online]
    .sort((a, b) => a.port - b.port)
    .map((app) => ({ ...app, online: true, lastSeenAt: seenAt }))
    .filter((app) => storedPorts.has(app.port))

  return { history: nextHistory, webApps: [...onlineApps, ...offline] }
}
