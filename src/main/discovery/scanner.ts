import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/settings'
import type { DbKind, InstanceMeta } from '../../shared/types'
import { listDockerContainers, toDockerInfo, type DockerContainer } from './docker'
import {
  isDockerCommand,
  isSshCommand,
  listListeningProcesses
} from './listeners'
import { mapLimit, probePort } from './probe'

export const COMMON_PORTS = DEFAULT_SETTINGS.dbPorts

export function buildCandidatePorts(
  extra: number[] = [],
  settings: AppSettings = DEFAULT_SETTINGS
): number[] {
  const ports = new Set<number>(settings.dbPorts)
  for (const port of extra) {
    if (Number.isFinite(port) && port > 0) ports.add(port)
  }
  for (const [start, end] of settings.dbPortRanges) {
    for (let port = start; port <= end; port++) ports.add(port)
  }
  return [...ports].sort((a, b) => a - b)
}

export interface DiscoveryResult {
  instances: InstanceMeta[]
  containersByPort: Map<number, DockerContainer>
  dockerAvailable: boolean
  probedPorts: number
  detectedPorts: number
}

export async function discover(settings: AppSettings = DEFAULT_SETTINGS): Promise<DiscoveryResult> {
  const host = settings.scanHost
  const [containers, listeners] = await Promise.all([
    listDockerContainers(),
    listListeningProcesses()
  ])
  const dockerAvailable = containers !== null

  const containersByPort = new Map<number, DockerContainer>()
  for (const container of containers ?? []) {
    for (const hostPort of container.hostPorts.keys()) {
      containersByPort.set(hostPort, container)
    }
  }

  const ports = buildCandidatePorts([...containersByPort.keys()], settings)
  const probes = await mapLimit(ports, 64, async (port) => ({
    port,
    result: await probePort(port, host)
  }))

  const detected = probes.filter((item) => item.result !== null)
  const instances: InstanceMeta[] = detected.map(({ port, result }) => {
    const probe = result!
    const kind: DbKind = probe.kind
    const id = `${kind}://${host}:${port}`
    const kindLabel = kind === 'mysql' ? 'MySQL' : 'Redis'
    const portProcesses = listeners?.get(port) ?? []
    const dockerListener = portProcesses.some((item) => isDockerCommand(item.command))
    const sshListener = portProcesses.some((item) => isSshCommand(item.command))
    const command = portProcesses[0]?.command

    // 端口若被本机其它进程（如原生 redis-server）占用，则不能归给 Docker 映射
    const container =
      command && !dockerListener && !sshListener ? undefined : containersByPort.get(port)
    const via: InstanceMeta['via'] = sshListener
      ? 'ssh'
      : container || dockerListener
        ? 'docker'
        : 'local'
    const label = container
      ? container.name
      : sshListener
        ? `SSH 转发 ${kindLabel} :${port}`
        : via === 'docker'
          ? `容器 ${kindLabel} :${port}`
          : `本地 ${kindLabel} :${port}`

    return {
      id,
      kind,
      host,
      port,
      source: container ? 'docker' : 'scan',
      label,
      via,
      container: container ? toDockerInfo(container) : undefined,
      version: probe.kind === 'mysql' ? probe.version : undefined,
      status: 'checking',
      manual: false
    }
  })

  instances.sort((a, b) => a.kind.localeCompare(b.kind) || a.port - b.port)

  return {
    instances,
    containersByPort,
    dockerAvailable,
    probedPorts: ports.length,
    detectedPorts: instances.length
  }
}
