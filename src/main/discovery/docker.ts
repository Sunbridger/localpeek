import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import type { DockerInfo } from '../../shared/types'

const execFileAsync = promisify(execFile)

export interface DockerContainer {
  id: string
  name: string
  image: string
  status: string
  ports: string
  env: Record<string, string>
  cmd: string
  /** key: 宿主机端口, value: 容器端口 */
  hostPorts: Map<number, number>
}

const DOCKER_CANDIDATES = ['/opt/homebrew/bin/docker', '/usr/local/bin/docker', '/usr/bin/docker']

function dockerBinary(): string {
  for (const candidate of DOCKER_CANDIDATES) {
    if (existsSync(candidate)) return candidate
  }
  return 'docker'
}

export function toDockerInfo(container: DockerContainer): DockerInfo {
  return {
    id: container.id.slice(0, 12),
    name: container.name,
    image: container.image,
    status: container.status,
    ports: container.ports
  }
}

export function parseDockerInspect(raw: unknown): DockerContainer[] {
  if (!Array.isArray(raw)) return []
  const containers: DockerContainer[] = []
  for (const item of raw) {
    const c = item as Record<string, any>
    if (!c || typeof c.Id !== 'string') continue

    const env: Record<string, string> = {}
    const envList: unknown = c.Config?.Env
    if (Array.isArray(envList)) {
      for (const line of envList) {
        if (typeof line !== 'string') continue
        const index = line.indexOf('=')
        if (index > 0) env[line.slice(0, index)] = line.slice(index + 1)
      }
    }

    const hostPorts = new Map<number, number>()
    const bindings: unknown = c.HostConfig?.PortBindings
    if (bindings && typeof bindings === 'object') {
      for (const [containerPort, binds] of Object.entries(bindings as Record<string, unknown>)) {
        const port = Number.parseInt(containerPort.split('/')[0], 10)
        if (!Number.isFinite(port) || !Array.isArray(binds)) continue
        for (const bind of binds) {
          const hostPort = Number((bind as Record<string, unknown>)?.HostPort)
          if (Number.isFinite(hostPort) && hostPort > 0) hostPorts.set(hostPort, port)
        }
      }
    }

    const cmdList: unknown = c.Config?.Cmd
    const cmd = Array.isArray(cmdList) ? cmdList.join(' ') : ''

    containers.push({
      id: c.Id,
      name: String(c.Name ?? '').replace(/^\//, '') || c.Id.slice(0, 12),
      image: String(c.Config?.Image ?? ''),
      status: String(c.State?.Status ?? ''),
      ports: [...hostPorts.entries()].map(([host, container]) => `${host}→${container}`).join(', '),
      env,
      cmd,
      hostPorts
    })
  }
  return containers
}

export async function listDockerContainers(): Promise<DockerContainer[] | null> {
  const binary = dockerBinary()
  try {
    const { stdout: idsOut } = await execFileAsync(binary, ['ps', '--no-trunc', '--format', '{{.ID}}'], {
      timeout: 5000,
      env: { ...process.env, PATH: `${process.env.PATH ?? ''}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin` }
    })
    const ids = idsOut
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    if (ids.length === 0) return []

    const { stdout } = await execFileAsync(binary, ['inspect', ...ids], {
      timeout: 10000,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, PATH: `${process.env.PATH ?? ''}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin` }
    })
    return parseDockerInspect(JSON.parse(stdout))
  } catch {
    return null
  }
}
