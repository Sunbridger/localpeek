import { describe, expect, test } from 'vitest'
import {
  LEGACY_STORAGE_KEYS,
  migrateLegacyStorage
} from '../src/shared/legacyStorage'

class MemoryStorage {
  private data = new Map<string, string>()

  getItem(key: string): string | null {
    return this.data.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value)
  }

  removeItem(key: string): void {
    this.data.delete(key)
  }
}

describe('migrateLegacyStorage', () => {
  test('copies every legacy key to its new name', () => {
    const storage = new MemoryStorage()
    storage.setItem('localdb-theme', 'dark')
    storage.setItem('localdb.mysqlTableState.v1', '{"version":1,"entries":{}}')
    storage.setItem('localdb.webLogPorts.v1', '[5173]')

    migrateLegacyStorage(storage)

    expect(storage.getItem('localpeek-theme')).toBe('dark')
    expect(storage.getItem('localpeek.mysqlTableState.v1')).toBe('{"version":1,"entries":{}}')
    expect(storage.getItem('localpeek.webLogPorts.v1')).toBe('[5173]')
  })

  test('does not overwrite an existing new value', () => {
    const storage = new MemoryStorage()
    storage.setItem('localdb-theme', 'dark')
    storage.setItem('localpeek-theme', 'light')

    migrateLegacyStorage(storage)

    expect(storage.getItem('localpeek-theme')).toBe('light')
  })

  test('maps the legacy single log port key', () => {
    const storage = new MemoryStorage()
    storage.setItem('localdb.webLogPort.v1', '8002')

    migrateLegacyStorage(storage)

    expect(storage.getItem('localpeek.webLogPort.v1')).toBe('8002')
  })

  test('covers every declared key pair', () => {
    const storage = new MemoryStorage()
    for (const [legacy, current] of Object.entries(LEGACY_STORAGE_KEYS)) {
      storage.setItem(legacy, legacy)
      expect(current.startsWith('localpeek')).toBe(true)
    }
    migrateLegacyStorage(storage)
    for (const [legacy, current] of Object.entries(LEGACY_STORAGE_KEYS)) {
      expect(storage.getItem(current)).toBe(legacy)
    }
  })

  test('ignores unavailable storage', () => {
    const storage = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
      removeItem: () => {
        throw new Error('denied')
      }
    }
    expect(() => migrateLegacyStorage(storage)).not.toThrow()
    expect(() => migrateLegacyStorage(null)).not.toThrow()
  })
})
