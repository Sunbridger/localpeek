import { describe, expect, it } from 'vitest'
import { parseDockerInspect, toDockerInfo } from '../src/main/discovery/docker'
import { buildCandidatePorts, COMMON_PORTS } from '../src/main/discovery/scanner'

describe('parseDockerInspect', () => {
  it('maps host ports, env vars and container metadata', () => {
    const raw = [
      {
        Id: 'abcdef0123456789',
        Name: '/demo-mysql',
        Config: {
          Image: 'mysql:8.0',
          Env: ['MYSQL_ROOT_PASSWORD=root_pass', 'MYSQL_USER=agent', 'MYSQL_PASSWORD=agent_pass'],
          Cmd: ['mysqld']
        },
        State: { Status: 'running' },
        HostConfig: {
          PortBindings: {
            '3306/tcp': [{ HostIp: '0.0.0.0', HostPort: '3307' }],
            '33060/tcp': [{ HostIp: '0.0.0.0', HostPort: '33061' }]
          }
        }
      }
    ]

    const [container] = parseDockerInspect(raw)
    expect(container.name).toBe('demo-mysql')
    expect(container.image).toBe('mysql:8.0')
    expect(container.status).toBe('running')
    expect(container.hostPorts.get(3307)).toBe(3306)
    expect(container.hostPorts.get(33061)).toBe(33060)
    expect(container.env.MYSQL_ROOT_PASSWORD).toBe('root_pass')
    expect(container.cmd).toBe('mysqld')
    expect(toDockerInfo(container).id).toBe('abcdef012345')
  })

  it('reads requirepass from the container command', () => {
    const raw = [
      {
        Id: 'f'.repeat(64),
        Name: '/redis',
        Config: {
          Image: 'redis:7',
          Cmd: ['redis-server', '--requirepass', 'secret', '--appendonly', 'yes']
        },
        State: { Status: 'running' },
        HostConfig: { PortBindings: { '6379/tcp': [{ HostPort: '6479' }] } }
      }
    ]
    const [container] = parseDockerInspect(raw)
    expect(container.cmd).toBe('redis-server --requirepass secret --appendonly yes')
    expect(container.hostPorts.get(6479)).toBe(6379)
  })

  it('skips malformed entries and empty input', () => {
    expect(parseDockerInspect(null)).toEqual([])
    expect(parseDockerInspect([{ Name: 'x' }, null])).toEqual([])
  })
})

describe('buildCandidatePorts', () => {
  it('includes common ports, ranges and docker ports, sorted and unique', () => {
    const ports = buildCandidatePorts([6479, 6399, 6379])
    for (const port of COMMON_PORTS) expect(ports).toContain(port)
    expect(ports).toContain(3300)
    expect(ports).toContain(3400)
    expect(ports).toContain(6300)
    expect(ports).toContain(6400)
    expect(new Set(ports).size).toBe(ports.length)
    expect([...ports].sort((a, b) => a - b)).toEqual(ports)
  })
})
