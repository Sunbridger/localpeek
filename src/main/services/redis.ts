import Redis from 'ioredis'
import { LIMITS } from '../../shared/limits'
import type { RedisKeyDetail, RedisKeyInfo, RedisKeyPage } from '../../shared/types'
import { errorMessage } from './mysql'
import { PREVIEW_BYTES, buildStringPreview, summaryPreview } from './redisPreview'

export interface RedisOpenResult {
  client?: Redis
  version?: string
  error?: string
  authFailed?: boolean
}

export async function openRedis(host: string, port: number, password?: string): Promise<RedisOpenResult> {
  const client = new Redis({
    host,
    port,
    password: password && password.length > 0 ? password : undefined,
    lazyConnect: true,
    connectTimeout: 3000,
    retryStrategy: () => null,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: true
  })
  client.on('error', () => {})

  try {
    await client.connect()
    let version: string | undefined
    try {
      const info = await client.info('server')
      version = /redis_version:([^\r\n]+)/.exec(info)?.[1]?.trim()
    } catch {
      version = undefined
    }
    return { client, version }
  } catch (error) {
    const message = errorMessage(error)
    client.disconnect()
    return {
      error: message,
      authFailed: /WRONGPASS|NOAUTH|invalid password|operation not permitted/i.test(message)
    }
  }
}

export async function scanKeys(
  client: Redis,
  cursor: string,
  pattern: string | undefined,
  count = 300
): Promise<RedisKeyPage> {
  const match = pattern && pattern.trim().length > 0 ? pattern.trim() : '*'
  const [nextCursor, keys] = await client.scan(cursor, 'MATCH', match, 'COUNT', count)

  const pipeline = client.pipeline()
  for (const key of keys) {
    pipeline.type(key)
    pipeline.ttl(key)
    pipeline.memory('USAGE', key)
  }
  const replies = keys.length > 0 ? await pipeline.exec() : []
  const infos: RedisKeyInfo[] = keys.map((key, index) => {
    const typeReply = replies?.[index * 3]
    const ttlReply = replies?.[index * 3 + 1]
    const memoryReply = replies?.[index * 3 + 2]
    return {
      key: String(key),
      type: typeReply && !typeReply[0] ? String(typeReply[1]) : 'unknown',
      ttl: ttlReply && !ttlReply[0] ? Number(ttlReply[1]) : -1,
      bytes:
        memoryReply && !memoryReply[0] && memoryReply[1] !== null ? Number(memoryReply[1]) : null
    }
  })

  // 第二次 pipeline 依次取 value 预览；string 取前缀，集合取数量摘要
  const previews = client.pipeline()
  const previewPlan: Array<{ index: number; kind: 'string' | 'summary'; type: string }> = []
  infos.forEach((info, index) => {
    if (info.type === 'string') {
      previews.getrange(info.key, 0, PREVIEW_BYTES - 1)
      previewPlan.push({ index, kind: 'string', type: info.type })
      return
    }
    if (info.type === 'none') {
      infos[index] = {
        ...info,
        preview: summaryPreview('none', 0),
        previewKind: 'summary'
      }
      return
    }
    if (info.type === 'hash') previews.hlen(info.key)
    else if (info.type === 'list') previews.llen(info.key)
    else if (info.type === 'set') previews.scard(info.key)
    else if (info.type === 'zset') previews.zcard(info.key)
    else if (info.type === 'stream') previews.xlen(info.key)
    else return
    previewPlan.push({ index, kind: 'summary', type: info.type })
  })

  const previewReplies = previewPlan.length > 0 ? await previews.exec() : []
  previewPlan.forEach((plan, replyIndex) => {
    const reply = previewReplies?.[replyIndex]
    if (!reply || reply[0]) return
    if (plan.kind === 'string') {
      const raw = reply[1] === null || reply[1] === undefined ? '' : String(reply[1])
      const truncated = Buffer.byteLength(raw, 'utf8') >= PREVIEW_BYTES
      const preview = buildStringPreview(raw, truncated)
      infos[plan.index] = {
        ...infos[plan.index],
        preview: preview.text,
        previewKind: preview.kind
      }
    } else {
      const count = Number(reply[1] ?? 0)
      infos[plan.index] = {
        ...infos[plan.index],
        preview: summaryPreview(plan.type, count),
        previewKind: 'summary'
      }
    }
  })

  return { cursor: String(nextCursor), keys: infos, done: String(nextCursor) === '0' }
}

const DETAIL_LIMIT = LIMITS.redisDetailLimit
const STRING_LIMIT = LIMITS.redisStringLimit

async function scanCollection(
  step: (cursor: string) => Promise<[string, string[]]>
): Promise<string[]> {
  const values: string[] = []
  let cursor = '0'
  do {
    const [next, batch] = await step(cursor)
    values.push(...batch)
    cursor = String(next)
    if (values.length >= DETAIL_LIMIT) return values.slice(0, DETAIL_LIMIT)
  } while (cursor !== '0')
  return values
}

export async function keyDetail(client: Redis, key: string): Promise<RedisKeyDetail> {
  const type = await client.type(key)
  const ttl = await client.ttl(key)
  const base = { key, type, ttl }

  if (type === 'none') {
    return { ...base, total: 0, loaded: 0, truncated: false, columns: [], rows: [], note: 'Key 不存在（可能已过期）' }
  }

  if (type === 'string') {
    const length = await client.strlen(key)
    const value = await client.getrange(key, 0, STRING_LIMIT - 1)
    return {
      ...base,
      total: length,
      loaded: Math.min(length, STRING_LIMIT),
      truncated: length > STRING_LIMIT,
      columns: ['value'],
      rows: [],
      stringValue: value,
      stringLength: length,
      stringTruncated: length > STRING_LIMIT
    }
  }

  if (type === 'hash') {
    const total = await client.hlen(key)
    const values = await scanCollection(async (cursor) => {
      const [next, elements] = await client.hscan(key, cursor, 'COUNT', 500)
      return [next, elements]
    })
    const rows: Record<string, unknown>[] = []
    for (let i = 0; i < values.length; i += 2) {
      rows.push({ field: values[i], value: values[i + 1] ?? '' })
    }
    return {
      ...base,
      total,
      loaded: rows.length,
      truncated: total > rows.length,
      columns: ['field', 'value'],
      rows
    }
  }

  if (type === 'list') {
    const total = await client.llen(key)
    const values = await client.lrange(key, 0, DETAIL_LIMIT - 1)
    return {
      ...base,
      total,
      loaded: values.length,
      truncated: total > values.length,
      columns: ['index', 'value'],
      rows: values.map((value, index) => ({ index, value }))
    }
  }

  if (type === 'set') {
    const total = await client.scard(key)
    const values = await scanCollection(async (cursor) => {
      const [next, elements] = await client.sscan(key, cursor, 'COUNT', 500)
      return [next, elements]
    })
    return {
      ...base,
      total,
      loaded: values.length,
      truncated: total > values.length,
      columns: ['member'],
      rows: values.map((value) => ({ member: value }))
    }
  }

  if (type === 'zset') {
    const total = await client.zcard(key)
    const flat = (await client.zrange(key, 0, DETAIL_LIMIT - 1, 'WITHSCORES')) as unknown as string[]
    const rows: Record<string, unknown>[] = []
    for (let i = 0; i < flat.length; i += 2) {
      rows.push({ member: flat[i], score: flat[i + 1] ?? '' })
    }
    return {
      ...base,
      total,
      loaded: rows.length,
      truncated: total > rows.length,
      columns: ['member', 'score'],
      rows
    }
  }

  if (type === 'stream') {
    const total = await client.xlen(key)
    const entries = await client.xrange(key, '-', '+', 'COUNT', DETAIL_LIMIT)
    return {
      ...base,
      total,
      loaded: entries.length,
      truncated: total > entries.length,
      columns: ['id', 'fields'],
      rows: entries.map(([id, fields]) => {
        const record: Record<string, string> = {}
        for (let i = 0; i < fields.length; i += 2) record[fields[i]] = fields[i + 1] ?? ''
        return { id, fields: JSON.stringify(record) }
      })
    }
  }

  return {
    ...base,
    total: 0,
    loaded: 0,
    truncated: false,
    columns: [],
    rows: [],
    note: `暂不支持展示类型 ${type}`
  }
}
