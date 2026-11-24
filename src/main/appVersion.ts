import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { APP_PACKAGE_NAME } from '../shared/appInfo'

function readPackageVersion(packagePath: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as {
      name?: unknown
      version?: unknown
    }
    if (pkg.name === APP_PACKAGE_NAME && typeof pkg.version === 'string' && pkg.version) {
      return pkg.version
    }
  } catch {
    // 忽略读取失败，继续向上查找
  }
  return undefined
}

export function appVersion(): string {
  if (app.isPackaged) return app.getVersion()
  let dir = app.getAppPath()
  for (let depth = 0; depth < 5; depth += 1) {
    const packagePath = join(dir, 'package.json')
    if (existsSync(packagePath)) {
      const version = readPackageVersion(packagePath)
      if (version) return version
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return app.getVersion()
}
