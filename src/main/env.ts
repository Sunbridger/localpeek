import { ENV_PREFIX } from '../shared/appInfo'

/** 读取 LOCALPEEK_* 环境变量；兼容旧版 LOCALDB_*。 */
export function envValue(name: string): string | undefined {
  return process.env[`${ENV_PREFIX}_${name}`] ?? process.env[`LOCALDB_${name}`]
}
