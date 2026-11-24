import { describe, expect, test } from 'vitest'
import {
  PREVIEW_CHARS,
  buildStringPreview,
  summaryPreview
} from '../src/main/services/redisPreview'

describe('summaryPreview', () => {
  test('describes collection sizes in Chinese', () => {
    expect(summaryPreview('hash', 12)).toBe('12 个字段')
    expect(summaryPreview('list', 30)).toBe('30 条')
    expect(summaryPreview('set', 5)).toBe('5 个成员')
    expect(summaryPreview('zset', 7)).toBe('7 个成员')
    expect(summaryPreview('stream', 3)).toBe('3 条记录')
  })

  test('handles expired keys and unsupported types', () => {
    expect(summaryPreview('none', 0)).toBe('已过期')
    expect(summaryPreview('string', 10)).toBeUndefined()
    expect(summaryPreview('module', 1)).toBeUndefined()
  })
})

describe('buildStringPreview', () => {
  test('keeps short plain text as text', () => {
    expect(buildStringPreview('hello', false)).toEqual({ text: 'hello', kind: 'text' })
  })

  test('detects complete JSON values', () => {
    expect(buildStringPreview('{"a":1}', false)).toEqual({ text: '{"a":1}', kind: 'json' })
    expect(buildStringPreview('  [1,2,3] ', false).kind).toBe('json')
  })

  test('treats truncated JSON prefixes as JSON', () => {
    const raw = '{"items":["' + 'x'.repeat(300)
    expect(buildStringPreview(raw, true).kind).toBe('json')
  })

  test('does not treat invalid braces as JSON when not truncated', () => {
    expect(buildStringPreview('{not json', false).kind).toBe('text')
  })

  test('truncates long previews and appends an ellipsis', () => {
    const result = buildStringPreview('x'.repeat(PREVIEW_CHARS + 40), false)
    expect(result.text.length).toBe(PREVIEW_CHARS + 1)
    expect(result.text.endsWith('…')).toBe(true)
    expect(result.kind).toBe('text')
  })

  test('strips a trailing replacement character from a split multibyte value', () => {
    expect(buildStringPreview('中文�', false)).toEqual({ text: '中文', kind: 'text' })
  })

  test('marks truncated values with an ellipsis even when under the char limit', () => {
    expect(buildStringPreview('short', true).text).toBe('short…')
  })
})
