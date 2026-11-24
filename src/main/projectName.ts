import { existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

const REPO_MARKERS = ['.git', '.hg']
const PACKAGE_MARKERS = [
  'package.json',
  'pyproject.toml',
  'go.mod',
  'Cargo.toml',
  'composer.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'mix.exs',
  'Gemfile'
]

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

export interface ProjectIdentity {
  key: string
  name: string
  path?: string
  source: 'repo' | 'package'
}

function safeRealpath(value: string): string {
  try {
    return realpathSync(value)
  } catch {
    return value
  }
}

export function normalizeProjectName(value: string | undefined): string | undefined {
  if (!value) return undefined
  const cleaned = value.trim().replace(/^["']|["']$/g, '')
  return cleaned.length > 0 ? cleaned : undefined
}

function parentProjectName(start: string): string | undefined {
  const home = safeRealpath(homedir())
  let dir = start
  for (let depth = 0; depth < 6; depth++) {
    if (dir === home || dir === '/' || dir.length === 0) return undefined
    const name = normalizeProjectName(basename(dir))
    if (name && !GENERIC_DIRS.has(name.toLowerCase())) return name
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

/**
 * 从进程 cwd 向上找仓库根（.git/.hg）或包根（package.json 等）。
 * 仓库根优先，保证 monorepo 内多个服务归到同一个项目；
 * 非 git 项目若包目录是 frontend/backend 这类通用名，则使用父目录名。
 * 没有任何项目标记时返回 undefined，由用户手工命名。
 */
export function detectProject(cwd?: string): ProjectIdentity | undefined {
  if (!cwd || !existsSync(cwd)) return undefined

  let dir = safeRealpath(cwd)
  let packageRoot: string | undefined

  for (let depth = 0; depth < 12; depth++) {
    if (REPO_MARKERS.some((marker) => existsSync(join(dir, marker)))) {
      const name = normalizeProjectName(basename(dir))
      if (name) return { key: `repo:${dir}`, name, path: dir, source: 'repo' }
    }
    if (!packageRoot && PACKAGE_MARKERS.some((marker) => existsSync(join(dir, marker)))) {
      packageRoot = dir
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  if (!packageRoot) return undefined

  const base = normalizeProjectName(basename(packageRoot))
  const name =
    base && !GENERIC_DIRS.has(base.toLowerCase())
      ? base
      : parentProjectName(dirname(packageRoot)) ?? base
  if (!name) return undefined

  return {
    key: `package:${packageRoot}`,
    name,
    path: packageRoot,
    source: 'package'
  }
}
