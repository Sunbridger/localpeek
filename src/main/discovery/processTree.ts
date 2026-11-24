export interface ProcessEntry {
  pid: number
  ppid: number
  command: string
}

const WORKER_COMMAND =
  /multiprocessing\.(spawn|resource_tracker)|--multiprocessing-fork|esbuild\s+--service=|celery\s+.*\bworker\b/i
const WRAPPER_COMMAND =
  /^(?:\S*\/)?(?:zsh|bash|sh|fish|login|sudo|nohup|env|time)(?:\s|$)|(?:^|\/)(?:dev\.sh)(?:\s|$)/i
const SERVER_COMMAND =
  /(?:^|[\s/])(?:uvicorn|gunicorn|daphne|hypercorn|vite|next|nuxt|astro|remix|webpack|parcel|flask|django-admin|manage\.py|rails|puma|php|java|dotnet|cargo|go)(?:\s|$)|npm\s+run\s+dev|pnpm(?:\s+run)?\s+dev|yarn\s+dev|bun\s+(?:run\s+)?dev|node\s+\S*(?:vite|server|next)/i

export function parseProcessTable(output: string): Map<number, ProcessEntry> {
  const result = new Map<number, ProcessEntry>()
  for (const line of output.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line)
    if (!match) continue
    const pid = Number(match[1])
    const ppid = Number(match[2])
    const command = match[3]
    if (Number.isInteger(pid) && pid > 0 && Number.isInteger(ppid) && command) {
      result.set(pid, { pid, ppid, command })
    }
  }
  return result
}

function isLaunchCommand(command: string): boolean {
  if (WORKER_COMMAND.test(command) || WRAPPER_COMMAND.test(command)) return false
  return SERVER_COMMAND.test(command)
}

/**
 * 找到可复用的启动命令。
 * 监听端口的进程可能是 reload / fork 出来的 worker（如 uvicorn --reload），
 * 直接重跑 worker 的命令行必然失败，因此向上查找最近的服务器启动命令。
 */
export function pickLaunchCommand(
  pids: readonly number[],
  table: ReadonlyMap<number, ProcessEntry>,
  maxDepth = 6
): ProcessEntry | undefined {
  for (const startPid of pids) {
    let current = table.get(startPid)
    for (let depth = 0; current && depth <= maxDepth; depth += 1) {
      if (isLaunchCommand(current.command)) return current
      const parent = table.get(current.ppid)
      if (!parent || parent.pid === current.pid) break
      current = parent
    }
  }
  return undefined
}
