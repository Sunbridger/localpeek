export function escapeId(name: string): string {
  return '`' + name.replace(/`/g, '``') + '`'
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => '\\' + m)
}

export function validateWhere(where?: string): string | undefined {
  const trimmed = where?.trim()
  if (!trimmed) return undefined
  if (trimmed.length > 2000) throw new Error('WHERE 条件过长（最多 2000 字符）')
  if (trimmed.includes(';')) throw new Error('WHERE 条件不允许包含分号')
  if (/--|\/\*|\*\/|#/.test(trimmed)) throw new Error('WHERE 条件不允许包含注释')
  if (/\b(into\s+(out|dump)file|load_file\s*\()/i.test(trimmed)) {
    throw new Error('WHERE 条件包含不支持的文件操作')
  }
  return trimmed
}

export interface WhereBuildInput {
  where?: string
  keyword?: string
  keywordColumns?: string[]
}

export interface WhereBuildResult {
  clause: string
  params: unknown[]
}

export function buildWhereClause(input: WhereBuildInput): WhereBuildResult {
  const parts: string[] = []
  const params: unknown[] = []

  const where = validateWhere(input.where)
  if (where) parts.push(`(${where})`)

  const keyword = input.keyword?.trim()
  const keywordColumns = input.keywordColumns ?? []
  if (keyword && keywordColumns.length > 0) {
    const like = `%${escapeLike(keyword)}%`
    parts.push(`(${keywordColumns.map((c) => `${escapeId(c)} LIKE ?`).join(' OR ')})`)
    for (const _ of keywordColumns) params.push(like)
  }

  return {
    clause: parts.length > 0 ? ` WHERE ${parts.join(' AND ')}` : '',
    params
  }
}

export function formatSql(sql: string, params: unknown[]): string {
  let index = 0
  return sql.replace(/\?/g, () => {
    const value = params[index++]
    if (value === null || value === undefined) return 'NULL'
    if (typeof value === 'number') return String(value)
    return `'${String(value).replace(/'/g, "''")}'`
  })
}
