import { execFile } from 'node:child_process'
import http from 'node:http'
import os from 'node:os'
import { promisify } from 'node:util'
import { APP_NAME } from '../../shared/appInfo'
import {
  DEFAULT_SETTINGS,
  resolveProjectName,
  type AppSettings
} from '../../shared/settings'
import type { WebAppInfo, WebAppRole } from '../../shared/types'
import { lsofBinary, psBinary } from '../platform'
import { detectProject } from '../projectName'
import {
  isDockerCommand,
  isSshCommand,
  isSystemCommand,
  listListeningProcesses,
  type ListeningProcess
} from './listeners'
import { mapLimit } from './probe'

const execFileAsync = promisify(execFile)
const BODY_LIMIT = 16 * 1024

const FRONTEND_HINT =
  /vite|next dev|next-server|nuxt|webpack|react-scripts|@angular|ng serve|astro|svelte|parcel|remix|gatsby|turbopack/i
const BACKEND_HINT =
  /uvicorn|gunicorn|flask|django|fastapi|spring|tomcat|java|go run|php -S|rails|dotnet|nest(js)?|kratos|cargo run|hyper|actix/i

export const DEV_PORT_RANGES: ReadonlyArray<readonly [number, number]> =
  DEFAULT_SETTINGS.webPortRanges

export function isDevPort(
  port: number,
  ranges: ReadonlyArray<readonly [number, number]> = DEV_PORT_RANGES
): boolean {
  return ranges.some(([start, end]) => port >= start && port <= end)
}

const FRONTEND_PORTS = new Set([
  3000, 3001, 3002, 4173, 4200, 4321, 4322, 5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180, 8081,
  8082
])
const BACKEND_PORTS = new Set([
  4000, 4001, 5000, 5001, 7000, 7001, 8000, 8001, 8080, 8088, 8888, 9000, 9001, 9090, 9292
])

export interface HttpProbeResult {
  status: number
  server?: string
  contentType?: string
  title?: string
}

export function classifyRole(port: number, command: string, contentType: string): WebAppRole {
  if (FRONTEND_HINT.test(command)) return 'frontend'
  if (BACKEND_HINT.test(command)) return 'backend'
  if (/text\/html/i.test(contentType)) return 'frontend'
  if (/application\/json|\+json/i.test(contentType)) return 'backend'
  if (FRONTEND_PORTS.has(port)) return 'frontend'
  if (BACKEND_PORTS.has(port)) return 'backend'
  return 'web'
}

export function extractTitle(html: string): string | undefined {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  if (!match) return undefined
  const title = match[1]
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  return title.slice(0, 80) || undefined
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

export function probeHttp(port: number, timeoutMs = 800): Promise<HttpProbeResult | null> {
  return probeHttpHost('127.0.0.1', port, timeoutMs).then(
    (result) => result ?? probeHttpHost('::1', port, timeoutMs)
  )
}

function probeHttpHost(
  host: string,
  port: number,
  timeoutMs: number
): Promise<HttpProbeResult | null> {
  return new Promise((resolve) => {
    let finished = false
    let request: http.ClientRequest | null = null
    let deadline: NodeJS.Timeout | null = null

    const done = (result: HttpProbeResult | null): void => {
      if (finished) return
      finished = true
      if (deadline) clearTimeout(deadline)
      request?.destroy()
      resolve(result)
    }

    deadline = setTimeout(() => done(null), timeoutMs + 200)

    try {
      request = http.request(
        {
          host,
          port,
          path: '/',
          method: 'GET',
          timeout: timeoutMs,
          headers: {
            Host: 'localhost',
            Connection: 'close',
            'User-Agent': `${APP_NAME}/0.1`,
            Accept: 'text/html,application/json;q=0.9,*/*;q=0.8'
          }
        },
        (response) => {
          const status = response.statusCode ?? 0
          const server = headerValue(response.headers.server)
          const contentType = headerValue(response.headers['content-type'])
          let body = ''
          response.setEncoding('utf8')
          response.on('data', (chunk: string) => {
            if (body.length < BODY_LIMIT) body += chunk
          })
          response.on('end', () =>
            done({ status, server, contentType, title: extractTitle(body) })
          )
          response.on('error', () =>
            done({ status, server, contentType, title: extractTitle(body) })
          )
        }
      )
      request.on('timeout', () => done(null))
      request.on('error', () => done(null))
      request.end()
    } catch {
      done(null)
    }
  })
}

async function fetchCwds(pids: number[]): Promise<Map<number, string>> {
  const result = new Map<number, string>()
  if (pids.length === 0) return result
  try {
    const { stdout } = await execFileAsync(
      lsofBinary(),
      ['-a', '-d', 'cwd', '-p', pids.join(','), '-Fn'],
      { timeout: 4000, maxBuffer: 2 * 1024 * 1024 }
    )
    let currentPid: number | null = null
    for (const line of stdout.split('\n')) {
      if (line.startsWith('p')) {
        currentPid = Number(line.slice(1))
      } else if (line.startsWith('n') && currentPid !== null) {
        result.set(currentPid, line.slice(1))
        currentPid = null
      }
    }
  } catch {
    // cwd 获取失败时，该记录不可一键重启
  }
  return result
}

async function fetchCommandLines(pids: number[]): Promise<Map<number, string>> {
  const result = new Map<number, string>()
  if (pids.length === 0) return result
  try {
    const { stdout } = await execFileAsync(psBinary(), ['-p', pids.join(','), '-o', 'pid=,command='], {
      timeout: 4000,
      maxBuffer: 2 * 1024 * 1024
    })
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim()
      const space = trimmed.indexOf(' ')
      if (space <= 0) continue
      const pid = Number(trimmed.slice(0, space))
      const command = trimmed.slice(space + 1).trim()
      if (Number.isFinite(pid) && command) result.set(pid, command)
    }
  } catch {
    // ps 不可用时降级为 lsof 的短命令名
  }
  return result
}

export async function scanWebApps(
  excludePorts: number[] = [],
  settings: AppSettings = DEFAULT_SETTINGS
): Promise<WebAppInfo[]> {
  const listeners = await listListeningProcesses()
  if (!listeners) return []

  const excluded = new Set(excludePorts)
  const selfPid = process.pid
  const selfUser = os.userInfo().username

  const candidates: Array<{ port: number; processes: ListeningProcess[] }> = []
  for (const [port, portProcesses] of listeners) {
    if (port < 1024 || excluded.has(port) || !isDevPort(port, settings.webPortRanges)) continue
    const processes = portProcesses.filter(
      (item) => item.pid > 1 && item.pid !== selfPid && !isSystemCommand(item.command)
    )
    if (processes.length > 0) candidates.push({ port, processes })
  }

  const probes = await mapLimit(candidates, 32, async (candidate) => {
    const probe = await probeHttp(candidate.port)
    if (!probe) return null
    return { ...candidate, probe }
  })

  const detected = probes.filter((item): item is NonNullable<typeof item> => item !== null)
  const pids = [...new Set(detected.flatMap((item) => item.processes.map((p) => p.pid)))]
  const [fullCommands, cwds] = await Promise.all([fetchCommandLines(pids), fetchCwds(pids)])
  const seenAt = Date.now()

  return detected
    .map(({ port, processes, probe }) => {
      const details = processes.map((item) => {
        const commandLine = fullCommands.get(item.pid)
        const cwd = cwds.get(item.pid)
        const dockerLike = isDockerCommand(item.command) || isSshCommand(item.command)
        const owned = item.user === selfUser
        const killable = owned && !dockerLike && item.pid !== selfPid
        const killBlockedReason = dockerLike
          ? 'Docker / SSH 转发进程，请在容器或隧道侧处理'
          : !owned
            ? `进程属于用户 ${item.user}，当前用户无权结束`
            : undefined
        return {
          pid: item.pid,
          user: item.user,
          command: item.command,
          commandLine,
          cwd,
          killable,
          killBlockedReason
        }
      })

      // 端口被多个进程共同占用时（如 uvicorn reload 的父子进程、SO_REUSEPORT），
      // 必须全部结束才能释放端口；任一进程不可关闭时整体标记为不可关闭。
      const primary = details.find((item) => item.killable) ?? details[0]
      const blocked = details.filter((item) => !item.killable)
      const killable = blocked.length === 0
      const commandLine = primary.commandLine
      const cwd = primary.cwd ?? details.find((item) => item.cwd)?.cwd
      const identity = detectProject(cwd)
      const projectKey = identity?.key ?? (cwd ? `path:${cwd}` : `port:${port}`)
      const projectAuto = identity?.name
      const project = resolveProjectName(
        projectKey,
        projectAuto,
        settings.projectOverrides
      )

      return {
        port,
        online: true,
        pid: primary.pid,
        pids: details.map((item) => item.pid),
        processes: details,
        user: primary.user,
        command: primary.command,
        commandLine,
        project,
        projectAuto,
        projectKey,
        cwd: primary.cwd,
        url: `http://localhost:${port}/`,
        role: classifyRole(port, commandLine ?? primary.command, probe.contentType ?? ''),
        status: probe.status,
        server: probe.server,
        contentType: probe.contentType,
        title: probe.title,
        killable,
        killBlockedReason: killable
          ? undefined
          : blocked.map((item) => item.killBlockedReason).filter(Boolean).join('；') ||
            '端口包含不可关闭的进程',
        lastSeenAt: seenAt
      } satisfies WebAppInfo
    })
    .sort((a, b) => a.port - b.port)
}
