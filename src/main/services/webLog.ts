import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs'

import { LIMITS } from '../../shared/limits'

export const MAX_LINES = LIMITS.webLogLines
export const TAIL_BYTES = LIMITS.webLogTailBytes
export const MAX_LINE_LENGTH = LIMITS.webLogMaxLine
export const POLL_INTERVAL_MS = LIMITS.webLogPollMs

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '')
}

export function sanitizeLine(line: string): string {
  const clean = stripAnsi(line).replace(/\r+$/, '')
  if (clean.length <= MAX_LINE_LENGTH) return clean
  return `${clean.slice(0, MAX_LINE_LENGTH)}…`
}

function decodeLines(buffer: Buffer): { lines: string[]; rest: Buffer } {
  const lines: string[] = []
  let start = 0
  for (let index = 0; index < buffer.length; index++) {
    if (buffer[index] !== 0x0a) continue
    lines.push(sanitizeLine(buffer.subarray(start, index).toString('utf8')))
    start = index + 1
  }
  return { lines, rest: buffer.subarray(start) }
}

function readChunk(path: string, start: number, length: number): Buffer {
  const fd = openSync(path, 'r')
  try {
    const buffer = Buffer.alloc(length)
    let read = 0
    while (read < length) {
      const count = readSync(fd, buffer, read, length - read, start + read)
      if (count <= 0) break
      read += count
    }
    return read === length ? buffer : buffer.subarray(0, read)
  } finally {
    closeSync(fd)
  }
}

/**
 * 读取日志文件末尾最多 maxLines 行完整内容。
 * 文件末尾没有换行的半行会被丢弃，等待 LogTail 补齐后再推送。
 */
export function readTail(path: string, maxLines = MAX_LINES): string[] {
  try {
    const stat = statSync(path)
    if (!stat.isFile() || stat.size === 0) return []
    const start = Math.max(0, stat.size - TAIL_BYTES)
    let buffer = readChunk(path, start, stat.size - start)
    if (start > 0) {
      const newline = buffer.indexOf(0x0a)
      buffer = newline >= 0 ? buffer.subarray(newline + 1) : Buffer.alloc(0)
    }
    // decodeLines 只返回完整行；末尾没有换行的半行被丢弃
    const { lines } = decodeLines(buffer)
    return lines.slice(-maxLines)
  } catch {
    return []
  }
}

/** 解析 `lsof -a -p <pids> -d 1,2 -Fn` 输出，返回每个 PID 的普通文件路径。 */
export function parseLsofFds(output: string): Map<number, string[]> {
  const result = new Map<number, string[]>()
  let currentPid: number | null = null
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) {
      const pid = Number(line.slice(1))
      currentPid = Number.isInteger(pid) && pid > 0 ? pid : null
      continue
    }
    if (!line.startsWith('n') || currentPid === null) continue
    const path = line.slice(1)
    if (!path.startsWith('/')) continue
    if (path.startsWith('/dev/')) continue
    if (path.endsWith(' (deleted)') || path.includes('(deleted)')) continue
    const list = result.get(currentPid) ?? []
    if (!list.includes(path)) {
      list.push(path)
      result.set(currentPid, list)
    }
  }
  return result
}

export interface LogTailCallbacks {
  onLines: (lines: string[]) => void
  onError: (error: Error) => void
}

/**
 * 轮询文件追加内容并逐行回调。
 * - 从文件末尾开始，不重复推送已有内容（历史由 readTail 提供）。
 * - 文件被截断（重新启动）时从 0 重新读取。
 * - 没有换行的半行留在缓冲区，等换行出现后整行推送。
 */
export class LogTail {
  private path: string
  private callbacks: LogTailCallbacks
  private offset = 0
  private pending: Buffer = Buffer.alloc(0)
  private timer: NodeJS.Timeout | null = null
  private lastError: string | null = null

  constructor(path: string, callbacks: LogTailCallbacks) {
    this.path = path
    this.callbacks = callbacks
  }

  start(): void {
    if (this.timer) return
    this.offset = 0
    this.pending = Buffer.alloc(0)
    this.lastError = null
    this.seekToEnd()
    this.timer = setInterval(() => this.pump(), POLL_INTERVAL_MS)
    if (typeof this.timer.unref === 'function') this.timer.unref()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** 立即读取一次增量；测试与启动时使用。 */
  pump(): void {
    try {
      if (!existsSync(this.path)) return
      const stat = statSync(this.path)
      if (!stat.isFile()) return
      if (stat.size < this.offset) {
        this.offset = 0
        this.pending = Buffer.alloc(0)
      }
      if (stat.size === this.offset) return
      const chunk = readChunk(this.path, this.offset, stat.size - this.offset)
      this.offset += chunk.length
      const combined = Buffer.concat([this.pending, chunk])
      const { lines, rest } = decodeLines(combined)
      this.pending = rest.length > 256 * 1024 ? rest.subarray(rest.length - 256 * 1024) : rest
      if (lines.length > 0) this.callbacks.onLines(lines)
      this.lastError = null
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message !== this.lastError) {
        this.lastError = message
        this.callbacks.onError(error instanceof Error ? error : new Error(message))
      }
    }
  }

  private seekToEnd(): void {
    try {
      const stat = statSync(this.path)
      if (!stat.isFile() || stat.size === 0) return
      const start = Math.max(0, stat.size - TAIL_BYTES)
      const buffer = readChunk(this.path, start, stat.size - start)
      const lastNewline = buffer.lastIndexOf(0x0a)
      this.offset = stat.size
      if (lastNewline >= 0 && lastNewline < buffer.length - 1) {
        this.pending = Buffer.from(buffer.subarray(lastNewline + 1))
      }
    } catch {
      // 文件尚未创建或不可读，等待后续 pump
    }
  }

  /** 供测试与诊断使用。 */
  currentOffset(): number {
    return this.offset
  }
}
