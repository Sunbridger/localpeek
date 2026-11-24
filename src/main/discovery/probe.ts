import net from 'node:net'

export type ProbeResult =
  | { kind: 'redis'; needsAuth: boolean }
  | { kind: 'mysql'; version: string }

export function parseMysqlHandshake(buf: Buffer): string | null {
  if (buf.length < 6) return null
  if (buf[4] !== 0x0a) return null
  const end = buf.indexOf(0, 5)
  if (end <= 5) return null
  const version = buf.subarray(5, end).toString('utf8')
  return /^\d+\.\d+\./.test(version) ? version : null
}

function readLine(buf: Buffer): string | null {
  const end = buf.indexOf('\r\n')
  if (end === -1) return null
  return buf.subarray(0, end).toString('utf8')
}

export function parseRedisResponse(buf: Buffer): { needsAuth: boolean } | null {
  if (buf.length === 0) return null
  const line = readLine(buf)
  if (!line) return null
  if (line.startsWith('+PONG')) return { needsAuth: false }
  if (line.startsWith('-')) {
    const text = line.slice(1)
    if (/^(NOAUTH|WRONGPASS)/.test(text) || /operation not permitted/i.test(text)) {
      return { needsAuth: true }
    }
  }
  return null
}

export function probePort(port: number, host = '127.0.0.1', timeoutMs = 800): Promise<ProbeResult | null> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    const chunks: Buffer[] = []
    let settled = false
    let pingTimer: NodeJS.Timeout | null = null

    const finish = (result: ProbeResult | null): void => {
      if (settled) return
      settled = true
      if (pingTimer) clearTimeout(pingTimer)
      clearTimeout(deadline)
      socket.removeAllListeners()
      socket.on('error', () => {})
      socket.destroy()
      resolve(result)
    }

    const deadline = setTimeout(() => finish(null), timeoutMs)

    socket.setNoDelay(true)
    socket.setTimeout(timeoutMs)
    socket.on('connect', () => {
      // MySQL 服务器会主动发握手包；先等一小会儿，没有再按 Redis 发 PING
      pingTimer = setTimeout(() => {
        if (!settled) socket.write('PING\r\n')
      }, 150)
    })
    socket.on('data', (data) => {
      chunks.push(data)
      const buf = Buffer.concat(chunks)
      const mysqlVersion = parseMysqlHandshake(buf)
      if (mysqlVersion) {
        finish({ kind: 'mysql', version: mysqlVersion })
        return
      }
      const redis = parseRedisResponse(buf)
      if (redis) {
        finish({ kind: 'redis', needsAuth: redis.needsAuth })
        return
      }
      if (buf.length > 4096) finish(null)
    })
    socket.on('error', () => finish(null))
    socket.on('close', () => finish(null))
    socket.on('timeout', () => finish(null))
    socket.connect(port, host)
  })
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index])
    }
  })
  await Promise.all(workers)
  return results
}
