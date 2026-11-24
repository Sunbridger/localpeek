import { DEFAULT_SETTINGS } from '../shared/settings'

const GENERIC_DIRS = new Set([
  'frontend',
  'backend',
  'web',
  'client',
  'server',
  'api',
  'app',
  'src',
  'dist',
  'build',
  'node_modules'
])

export const PROJECT_ROOTS = DEFAULT_SETTINGS.projectRoots

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function normalizeProjectName(value: string | undefined): string | undefined {
  if (!value) return undefined
  const cleaned = value.trim().replace(/^["']|["']$/g, '')
  return cleaned.length > 0 ? cleaned : undefined
}

/**
 * 从命令行或工作目录中解析项目名：
 * - 优先匹配 /<projectRoot>/<project>/
 * - 其次取 cwd 中跳过 frontend/backend 等通用目录后的最后一级
 */
export function extractProjectName(
  commandLine?: string,
  cwd?: string,
  projectRoots: string[] = PROJECT_ROOTS
): string | undefined {
  const sources = [commandLine, cwd].filter(
    (value): value is string => typeof value === 'string' && value.length > 0
  )
  const roots = projectRoots.filter((root) => typeof root === 'string' && root.length > 0)
  const pattern =
    roots.length > 0
      ? new RegExp(`/(?:${roots.map(escapeRegExp).join('|')})/([^/\\s"']+)`)
      : null

  for (const source of sources) {
    const match = pattern?.exec(source)
    const name = normalizeProjectName(match?.[1])
    if (name) return name
  }

  if (cwd) {
    const parts = cwd.split('/').filter(Boolean)
    let index = parts.length - 1
    while (index >= 0 && GENERIC_DIRS.has(parts[index].toLowerCase())) index--
    const fallback = index >= 0 ? normalizeProjectName(parts[index]) : undefined
    if (fallback) return fallback
  }

  return undefined
}
