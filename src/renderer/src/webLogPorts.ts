export const MAX_LOG_PANELS = 4

/** 点击进程单元格：未打开则追加；已打开则关闭；超过上限时替换最早打开的。 */
export function toggleLogPort(ports: readonly number[], port: number): number[] {
  if (ports.includes(port)) return ports.filter((item) => item !== port)
  const next = [...ports, port]
  return next.length > MAX_LOG_PANELS ? next.slice(next.length - MAX_LOG_PANELS) : next
}

/** 读取持久化值：过滤非法/重复端口，只保留最近打开的 4 个。 */
export function sanitizeLogPorts(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  const result: number[] = []
  for (const item of value) {
    const port = typeof item === 'number' ? item : Number(item)
    if (!Number.isInteger(port) || port <= 0 || port > 65535) continue
    if (result.includes(port)) continue
    result.push(port)
  }
  return result.slice(-MAX_LOG_PANELS)
}
