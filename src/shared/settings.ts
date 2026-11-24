export type PortRange = [number, number]

export interface AppSettings {
  /** 自动发现扫描的主机 */
  scanHost: string
  /** 从路径中识别项目名的根目录，如 /mycode/<项目>/ */
  projectRoots: string[]
  /** 常用数据库端口 + 额外扫描区间 */
  dbPorts: number[]
  dbPortRanges: PortRange[]
  /** Web 应用端口区间 */
  webPortRanges: PortRange[]
  /** Redis 逻辑库数量（db0..N-1） */
  redisDbs: number
  /** Web 端口历史保留条数 */
  webHistoryLimit: number
}

export const DEFAULT_SETTINGS: AppSettings = {
  scanHost: '127.0.0.1',
  projectRoots: ['mycode', 'code'],
  dbPorts: [3306, 3307, 3308, 6379, 6380, 6479],
  dbPortRanges: [
    [3300, 3400],
    [6300, 6400]
  ],
  webPortRanges: [
    [1234, 1240],
    [3000, 3100],
    [4000, 4100],
    [4173, 4180],
    [4200, 4300],
    [4321, 4330],
    [5000, 5100],
    [5170, 5200],
    [5500, 5510],
    [6000, 6100],
    [7000, 7100],
    [8000, 8100],
    [8880, 8900],
    [9000, 9100],
    [9200, 9300]
  ],
  redisDbs: 16,
  webHistoryLimit: 50
}

function isPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65535
}

function sanitizePorts(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value)) return [...fallback]
  const ports: number[] = []
  for (const item of value) {
    if (!isPort(item) || ports.includes(item)) continue
    ports.push(item)
  }
  return ports.length > 0 ? ports : [...fallback]
}

function sanitizeRanges(value: unknown, fallback: PortRange[]): PortRange[] {
  if (!Array.isArray(value)) return fallback.map(([start, end]) => [start, end] as PortRange)
  const ranges: PortRange[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!Array.isArray(item) || item.length !== 2) continue
    const [start, end] = item
    if (!isPort(start) || !isPort(end) || start > end) continue
    const key = `${start}:${end}`
    if (seen.has(key)) continue
    seen.add(key)
    ranges.push([start, end])
  }
  return ranges.length > 0
    ? ranges
    : fallback.map(([start, end]) => [start, end] as PortRange)
}

/** 把设置页里的逗号/空白分隔输入解析成项目根目录列表。 */
export function parseProjectRootsInput(input: string): string[] {
  const roots: string[] = []
  for (const item of input.split(/[,，\s]+/)) {
    const root = item.trim().replace(/^\/+|\/+$/g, '')
    if (!root || root.includes('/') || root.includes('\\') || roots.includes(root)) continue
    roots.push(root)
  }
  return roots
}

function sanitizeRoots(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback]
  const roots: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const root = item.trim().replace(/^\/+|\/+$/g, '')
    if (!root || root.includes('/') || root.includes('\\') || roots.includes(root)) continue
    roots.push(root)
  }
  return roots.length > 0 ? roots : [...fallback]
}

function sanitizeHost(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_SETTINGS.scanHost
  const host = value.trim()
  if (!host || /\s/.test(host)) return DEFAULT_SETTINGS.scanHost
  return host
}

function sanitizeBoundedInt(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback
}

/** 用默认值补齐并逐字段校验配置，非法字段回退到默认值。 */
export function sanitizeSettings(raw: unknown): AppSettings {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    scanHost: sanitizeHost(value.scanHost),
    projectRoots: sanitizeRoots(value.projectRoots, DEFAULT_SETTINGS.projectRoots),
    dbPorts: sanitizePorts(value.dbPorts, DEFAULT_SETTINGS.dbPorts),
    dbPortRanges: sanitizeRanges(value.dbPortRanges, DEFAULT_SETTINGS.dbPortRanges),
    webPortRanges: sanitizeRanges(value.webPortRanges, DEFAULT_SETTINGS.webPortRanges),
    redisDbs: sanitizeBoundedInt(value.redisDbs, 1, 64, DEFAULT_SETTINGS.redisDbs),
    webHistoryLimit: sanitizeBoundedInt(
      value.webHistoryLimit,
      1,
      500,
      DEFAULT_SETTINGS.webHistoryLimit
    )
  }
}
