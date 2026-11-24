import type { DbManager } from './manager'

/** 开发期自检：LOCALPEEK_SMOKE=1 启动时跑一遍真实发现与浏览，输出 JSON 后退出。 */
export async function runSmoke(manager: DbManager): Promise<void> {
  const result = await manager.scan()
  const checks: Array<Record<string, unknown>> = []

  for (const instance of result.instances) {
    if (instance.status !== 'ready') continue
    try {
      if (instance.kind === 'mysql') {
        const databases = await manager.mysqlDatabases(instance.id)
        const database = databases[0]
        const tables = database ? await manager.mysqlTables(instance.id, database) : []
        const table = tables[0]
        const data =
          database && table
            ? await manager.mysqlQuery({
                instanceId: instance.id,
                database,
                table: table.name,
                page: 1,
                pageSize: 5
              })
            : null
        checks.push({
          id: instance.id,
          databases: databases.length,
          firstDatabase: database,
          tables: tables.length,
          firstTable: table?.name,
          columns: data?.columns.length,
          rows: data?.rows.length,
          total: data?.total
        })
      } else {
        const [firstDb, secondDb, thirdDb] = await Promise.all([
          manager.redisKeys({ instanceId: instance.id, db: 0, cursor: '0' }),
          manager.redisKeys({ instanceId: instance.id, db: 1, cursor: '0' }),
          manager.redisKeys({ instanceId: instance.id, db: 2, cursor: '0' })
        ])
        const firstKey = firstDb.keys[0]
        const detail = firstKey
          ? await manager.redisKeyDetail({ instanceId: instance.id, db: 0, key: firstKey.key })
          : null
        checks.push({
          id: instance.id,
          keys: firstDb.keys.length,
          db1Keys: secondDb.keys.length,
          db2Keys: thirdDb.keys.length,
          firstKey: firstKey?.key,
          firstKeyType: detail?.type,
          loaded: detail?.loaded,
          total: detail?.total
        })
      }
    } catch (error) {
      checks.push({ id: instance.id, error: String(error) })
    }
  }

  console.log('[localpeek:smoke]', JSON.stringify(result, null, 2))
  console.log('[localpeek:smoke:checks]', JSON.stringify(checks, null, 2))
}
