import { describe, expect, it } from 'vitest'
import { mergeWebHistory } from '../src/main/services/webHistory'
import type { StoredWebHistoryEntry } from '../src/main/config'
import type { WebAppInfo } from '../src/shared/types'

function historyEntry(port: number, overrides: Partial<StoredWebHistoryEntry> = {}): StoredWebHistoryEntry {
  return {
    port,
    role: 'frontend',
    command: 'node',
    commandLine: 'node /repo/vite',
    cwd: '/repo',
    lastSeenAt: 1000,
    ...overrides
  }
}

function onlineApp(port: number, overrides: Partial<WebAppInfo> = {}): WebAppInfo {
  return {
    port,
    online: true,
    pid: 1000 + port,
    user: 'me',
    command: 'node',
    commandLine: 'node /repo/vite',
    cwd: '/repo',
    url: `http://localhost:${port}/`,
    role: 'frontend',
    status: 200,
    killable: true,
    ...overrides
  }
}

describe('mergeWebHistory', () => {
  it('adds online services to history and marks them online', () => {
    const merged = mergeWebHistory([], [onlineApp(5173)], 5000)
    expect(merged.history).toHaveLength(1)
    expect(merged.history[0]).toMatchObject({ port: 5173, lastSeenAt: 5000 })
    expect(merged.webApps).toHaveLength(1)
    expect(merged.webApps[0]).toMatchObject({ port: 5173, online: true })
  })

  it('keeps offline history entries and marks them restartable', () => {
    const merged = mergeWebHistory([historyEntry(3000)], [], 5000)
    expect(merged.webApps).toEqual([
      expect.objectContaining({
        port: 3000,
        online: false,
        killable: false,
        startable: true,
        title: undefined,
        role: 'frontend'
      })
    ])
  })

  it('marks entries without cwd as not restartable', () => {
    const merged = mergeWebHistory([historyEntry(3000, { cwd: undefined })], [], 5000)
    expect(merged.webApps[0].startable).toBe(false)
  })

  it('marks fork / reload worker commands as not restartable', () => {
    const merged = mergeWebHistory(
      [
        historyEntry(8002, {
          commandLine:
            '/repo/.venv/bin/python -c from multiprocessing.spawn import spawn_main; spawn_main(tracker_fd=5, pipe_handle=7) --multiprocessing-fork'
        })
      ],
      [],
      5000
    )
    expect(merged.webApps[0].startable).toBe(false)
  })

  it('refreshes lastSeenAt for services that came back online', () => {
    const merged = mergeWebHistory([historyEntry(5173, { lastSeenAt: 100 })], [onlineApp(5173)], 9000)
    expect(merged.history).toHaveLength(1)
    expect(merged.history[0].lastSeenAt).toBe(9000)
    expect(merged.webApps[0].online).toBe(true)
  })

  it('caps history at the limit while keeping online entries', () => {
    const history = Array.from({ length: 60 }, (_, index) => historyEntry(3000 + index))
    const merged = mergeWebHistory(history, [onlineApp(3000)], 5000, 50)
    expect(merged.history).toHaveLength(50)
    expect(merged.history.some((entry) => entry.port === 3000)).toBe(true)
    expect(merged.webApps.filter((app) => app.online)).toHaveLength(1)
  })

  it('ignores malformed history entries', () => {
    const malformed = [
      { port: 0, commandLine: 'x', role: 'web', command: 'x', lastSeenAt: 1 },
      { port: 3000, commandLine: undefined, role: 'web', command: 'x', lastSeenAt: 1 }
    ] as unknown as StoredWebHistoryEntry[]
    const merged = mergeWebHistory(malformed, [], 5000)
    expect(merged.history).toHaveLength(0)
  })

  it('keeps stored project names for history entries', () => {
    const entry = historyEntry(3000, {
      project: 'shop',
      projectAuto: 'shop',
      projectKey: 'repo:/tmp/shop'
    })
    const merged = mergeWebHistory([entry], [], 5000)
    expect(merged.history[0].project).toBe('shop')
    expect(merged.webApps[0].project).toBe('shop')
  })

  it('applies project overrides to offline history', () => {
    const entry = historyEntry(3000, {
      project: 'alpha',
      projectAuto: 'alpha',
      projectKey: 'repo:/tmp/alpha'
    })
    const merged = mergeWebHistory([entry], [], 5000, 50, {
      'repo:/tmp/alpha': 'beta'
    })
    expect(merged.history[0].project).toBe('beta')
    expect(merged.webApps[0].project).toBe('beta')
  })

  it('orders online services before offline history', () => {
    const merged = mergeWebHistory(
      [historyEntry(3000, { lastSeenAt: 1000 }), historyEntry(4000, { lastSeenAt: 2000 })],
      [onlineApp(9000)],
      5000
    )
    expect(merged.webApps.map((app) => app.port)).toEqual([9000, 4000, 3000])
  })
})
