const WORKER_ONLY_COMMAND =
  /multiprocessing\.(spawn|resource_tracker)|--multiprocessing-fork|esbuild\s+--service=/i

/**
 * 历史命令是否可以直接重跑。
 * uvicorn --reload / multiprocessing 会把 fork 出来的 worker 命令行写进进程表，
 * 这些命令缺少原始入口，重跑只会立即报错。
 */
export function isReusableCommand(commandLine: string | undefined | null): boolean {
  if (!commandLine || !commandLine.trim()) return false
  return !WORKER_ONLY_COMMAND.test(commandLine)
}
