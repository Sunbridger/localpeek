import { describe, expect, it } from 'vitest'
import {
  buildWhereClause,
  escapeId,
  escapeLike,
  formatSql,
  validateWhere
} from '../src/main/sql'

describe('escapeId', () => {
  it('wraps identifiers and doubles backticks', () => {
    expect(escapeId('user')).toBe('`user`')
    expect(escapeId('we`ird')).toBe('`we``ird`')
  })
})

describe('escapeLike', () => {
  it('escapes wildcard and escape characters', () => {
    expect(escapeLike('100%_done\\')).toBe('100\\%\\_done\\\\')
  })
})

describe('validateWhere', () => {
  it('returns trimmed clause for a normal condition', () => {
    expect(validateWhere('  status = 1  ')).toBe('status = 1')
  })

  it('returns undefined for blank input', () => {
    expect(validateWhere('   ')).toBeUndefined()
    expect(validateWhere(undefined)).toBeUndefined()
  })

  it.each(['status = 1; DROP TABLE users', 'id = 1 -- comment', '/* x */ 1=1', 'id = 1 # x'])(
    'rejects unsafe clause %s',
    (clause) => {
      expect(() => validateWhere(clause)).toThrow()
    }
  )

  it('rejects file operations', () => {
    expect(() => validateWhere("id = 1 INTO OUTFILE '/tmp/x'")).toThrow()
    expect(() => validateWhere('LOAD_FILE("/etc/passwd")')).toThrow()
  })
})

describe('buildWhereClause', () => {
  it('builds no clause and no params for empty input', () => {
    expect(buildWhereClause({})).toEqual({ clause: '', params: [] })
  })

  it('wraps the raw WHERE condition', () => {
    const result = buildWhereClause({ where: 'status = 1 AND id > 10' })
    expect(result.clause).toBe(' WHERE (status = 1 AND id > 10)')
    expect(result.params).toEqual([])
  })

  it('builds a LIKE OR across keyword columns', () => {
    const result = buildWhereClause({
      keyword: 'go%_od',
      keywordColumns: ['name', 'email']
    })
    expect(result.clause).toBe(' WHERE (`name` LIKE ? OR `email` LIKE ?)')
    expect(result.params).toEqual(['%go\\%\\_od%', '%go\\%\\_od%'])
  })

  it('combines WHERE and keyword clauses', () => {
    const result = buildWhereClause({
      where: 'status = 1',
      keyword: 'alice',
      keywordColumns: ['name']
    })
    expect(result.clause).toBe(' WHERE (status = 1) AND (`name` LIKE ?)')
    expect(result.params).toEqual(['%alice%'])
  })

  it('ignores keyword when no text columns exist', () => {
    const result = buildWhereClause({ keyword: 'alice', keywordColumns: [] })
    expect(result).toEqual({ clause: '', params: [] })
  })
})

describe('formatSql', () => {
  it('inlines params for display', () => {
    expect(formatSql('SELECT * FROM t WHERE a = ? AND b = ? LIMIT ?', [1, "o'k", 100])).toBe(
      "SELECT * FROM t WHERE a = 1 AND b = 'o''k' LIMIT 100"
    )
  })
})
