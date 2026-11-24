import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { lsofBinary, systemPath } from '../platform'

const execFileAsync = promisify(execFile)

export interface ListeningProcess {
  command: string
  pid: number
  user: string
}

export function parseLsof(output: string): Map<number, ListeningProcess[]> {
  const result = new Map<number, ListeningProcess[]>()
  const lines = output.split('\n')
  for (const line of lines.slice(1)) {
    const columns = line.trim().split(/\s+/)
    if (columns.length < 9) continue
    const command = columns[0]
    const pid = Number(columns[1])
    const user = columns[2]
    let match: RegExpExecArray | null = null
    for (let index = columns.length - 1; index >= 3; index--) {
      match = /:(\d+)$/.exec(columns[index])
      if (match) break
    }
    if (!match || !Number.isFinite(pid)) continue
    const port = Number(match[1])
    if (!Number.isFinite(port)) continue
    const list = result.get(port) ?? []
    // 同一进程可能同时监听 IPv4/IPv6，按 PID 去重
    if (!list.some((item) => item.pid === pid)) {
      list.push({ command, pid, user })
      result.set(port, list)
    }
  }
  return result
}

export function isDockerCommand(command: string): boolean {
  return /^com\.dock|docker|vpnkit/i.test(command)
}

export function isSshCommand(command: string): boolean {
  return /^ssh$/i.test(command)
}

export function isSystemCommand(command: string): boolean {
  return /^ControlCe|rapportd|mDNSRespo|mdns|cupsd|sharingd|AirPlay|remoted|SystemUIS/i.test(
    command
  )
}

export async function listListeningProcesses(): Promise<Map<number, ListeningProcess[]> | null> {
  try {
    const { stdout } = await execFileAsync(lsofBinary(), ['-nP', '-iTCP', '-sTCP:LISTEN'], {
      timeout: 5000,
      maxBuffer: 8 * 1024 * 1024,
      env: {
        ...process.env,
        PATH: systemPath()
      }
    })
    return parseLsof(stdout)
  } catch {
    return null
  }
}
