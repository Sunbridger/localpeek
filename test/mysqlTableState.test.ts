import { describe, expect, test } from 'vitest'
import {
  DEFAULT_MYSQL_TABLE_STATE,
  MAX_TABLE_STATES,
  TABLE_STATE_STORAGE_KEY,
  patchTableState,
  readTableState,
  tableStateId,
  type StorageLike
} from '../src/renderer/src/mysqlTableState'

class MemoryStorage implements StorageLike {
  private data = new Map<string, string>()

  getItem(key: string): string | null {
    return this.data.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value)
  }
}

describe('mysqlTableState', () => {
  test('returns defaults when nothing stored', () => {
    const storage = new MemoryStorage()
    expect(readTableState(storage, 'a|b|c')).toEqual(DEFAULT_MYSQL_TABLE_STATE)
  })

  test('round-trips a full state and merges partial patches', () => {
    const storage = new MemoryStorage()
    const key = tableStateId('mysql://127.0.0.1:3306', 'shop', 'orders')
    patchTableState(storage, key, {
      page: 3,
      pageSize: 200,
      view: 'structure',
      orderBy: 'created_at',
      orderDir: 'desc',
      where: "status = 1",
      whereInput: "status = 1",
      keyword: 'alice',
      keywordInput: 'alice',
      showSql: true
    })
    patchTableState(storage, key, { page: 4 })

    const state = readTableState(storage, key)
    expect(state.page).toBe(4)
    expect(state.pageSize).toBe(200)
    expect(state.view).toBe('structure')
    expect(state.orderBy).toBe('created_at')
    expect(state.orderDir).toBe('desc')
    expect(state.where).toBe('status = 1')
    expect(state.keyword).toBe('alice')
    expect(state.showSql).toBe(true)
  })

  test('falls back to defaults for invalid stored values', () => {
    const storage = new MemoryStorage()
    storage.setItem(
      TABLE_STATE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        entries: {
          'x|y|z': {
            state: {
              view: 'bogus',
              page: -4,
              pageSize: 1234,
              orderDir: 'sideways',
              keyword: 42
            },
            updatedAt: 1
          }
        }
      })
    )
    expect(readTableState(storage, 'x|y|z')).toEqual(DEFAULT_MYSQL_TABLE_STATE)
  })

  test('ignores corrupt storage', () => {
    const storage = new MemoryStorage()
    storage.setItem(TABLE_STATE_STORAGE_KEY, '{not json')
    expect(readTableState(storage, 'a|b|c')).toEqual(DEFAULT_MYSQL_TABLE_STATE)
  })

  test('prunes oldest entries beyond the cap', () => {
    const storage = new MemoryStorage()
    patchTableState(storage, 'k|0|0', { page: 2 }, 1000)
    for (let index = 1; index < MAX_TABLE_STATES; index++) {
      patchTableState(storage, `k|${index}|0`, { page: 2 }, 1000 + index)
    }
    patchTableState(storage, 'k|new|0', { page: 2 }, 5000)

    expect(readTableState(storage, 'k|0|0')).toEqual(DEFAULT_MYSQL_TABLE_STATE)
    expect(readTableState(storage, 'k|1|0').page).toBe(2)
    expect(readTableState(storage, 'k|new|0').page).toBe(2)
  })

  test('does not throw when storage is unavailable', () => {
    const storage: StorageLike = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      }
    }
    expect(readTableState(storage, 'a|b|c')).toEqual(DEFAULT_MYSQL_TABLE_STATE)
    expect(() => patchTableState(storage, 'a|b|c', { page: 2 })).not.toThrow()
  })
})
