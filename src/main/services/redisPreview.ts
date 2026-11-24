import { LIMITS } from '../../shared/limits'
import type { RedisPreviewKind } from '../../shared/types'

/** GETRANGE 一次最多取固定字节数，避免列表加载时传输大 value */
export const PREVIEW_BYTES = LIMITS.redisPreviewBytes
/** 表格单元格最多展示的字符数 */
export const PREVIEW_CHARS = LIMITS.redisPreviewChars

export interface StringPreview {
  text: string
  kind: Extract<RedisPreviewKind, 'text' | 'json'>
}

export function summaryPreview(type: string, count: number): string | undefined {
  switch (type) {
    case 'hash':
      return `${count} 个字段`
    case 'list':
      return `${count} 条`
    case 'set':
    case 'zset':
      return `${count} 个成员`
    case 'stream':
      return `${count} 条记录`
    case 'none':
      return '已过期'
    default:
      return undefined
  }
}

function isJsonPreview(text: string, truncated: boolean): boolean {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false
  // 截断的 JSON 无法完整解析，按前缀判断
  if (truncated) return true
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

export function buildStringPreview(raw: string, truncated: boolean): StringPreview {
  // GETRANGE 按字节截取，末尾可能留下半个多字节字符
  const clean = raw.replace(/�+$/, '')
  const clipped = clean.length > PREVIEW_CHARS ? clean.slice(0, PREVIEW_CHARS) : clean
  const needsEllipsis = truncated || clean.length > PREVIEW_CHARS
  return {
    text: needsEllipsis ? `${clipped}…` : clipped,
    kind: isJsonPreview(clean, truncated) ? 'json' : 'text'
  }
}
