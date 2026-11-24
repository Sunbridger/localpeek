export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** 旧品牌 localStorage 键 -> 新键。迁移只复制，不删除旧值。 */
export const LEGACY_STORAGE_KEYS: Record<string, string> = {
  'localdb-theme': 'localpeek-theme',
  'localdb.mysqlTableState.v1': 'localpeek.mysqlTableState.v1',
  'localdb.webLogPorts.v1': 'localpeek.webLogPorts.v1',
  'localdb.webLogPort.v1': 'localpeek.webLogPort.v1'
}

export function migrateLegacyStorage(storage: StorageLike | null): void {
  if (!storage) return
  try {
    for (const [legacy, current] of Object.entries(LEGACY_STORAGE_KEYS)) {
      if (storage.getItem(current) !== null) continue
      const value = storage.getItem(legacy)
      if (value !== null) storage.setItem(current, value)
    }
  } catch {
    // localStorage 不可用时静默降级
  }
}
