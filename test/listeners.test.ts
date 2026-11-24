import { describe, expect, it } from 'vitest'
import {
  isDockerCommand,
  isSshCommand,
  parseLsof
} from '../src/main/discovery/listeners'

const OUTPUT = `COMMAND     PID      USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
redis-ser 33676 dev    6u  IPv4 0x81376e64c0ee1832      0t0  TCP *:6379 (LISTEN)
redis-ser 33676 dev    7u  IPv6 0x59d409152502bc42      0t0  TCP *:6379 (LISTEN)
ssh       71611 dev   18u  IPv4 0xfdce605d3d267529      0t0  TCP *:3306 (LISTEN)
com.docke 4242  dev   20u  IPv6 0xdeadbeef              0t0  TCP *:5432 (LISTEN)
`

describe('parseLsof', () => {
  it('maps listening ports to the owning command', () => {
    const map = parseLsof(OUTPUT)
    expect(map.get(6379)).toEqual([{ command: 'redis-ser', pid: 33676, user: 'dev' }])
    expect(map.get(3306)).toEqual([{ command: 'ssh', pid: 71611, user: 'dev' }])
    expect(map.get(5432)).toEqual([{ command: 'com.docke', pid: 4242, user: 'dev' }])
    expect(map.get(9999)).toBeUndefined()
  })

  it('keeps multiple processes listening on the same port', () => {
    const output = `COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
python3 100 me 3u IPv4 0x1 0t0 TCP *:8002 (LISTEN)
python3 200 me 3u IPv4 0x2 0t0 TCP *:8002 (LISTEN)
python3 100 me 4u IPv6 0x3 0t0 TCP *:8002 (LISTEN)
`
    const map = parseLsof(output)
    expect(map.get(8002)).toEqual([
      { command: 'python3', pid: 100, user: 'me' },
      { command: 'python3', pid: 200, user: 'me' }
    ])
  })

  it('ignores malformed lines', () => {
    expect(parseLsof('')).toEqual(new Map())
    expect(parseLsof('COMMAND PID\nfoo bar')).toEqual(new Map())
  })
})

describe('command classification', () => {
  it('recognises docker proxies including truncated names', () => {
    expect(isDockerCommand('com.docke')).toBe(true)
    expect(isDockerCommand('docker-proxy')).toBe(true)
    expect(isDockerCommand('com.docker.backend')).toBe(true)
    expect(isDockerCommand('redis-ser')).toBe(false)
  })

  it('recognises ssh forwards', () => {
    expect(isSshCommand('ssh')).toBe(true)
    expect(isSshCommand('sshd')).toBe(false)
    expect(isSshCommand('ssh-agent')).toBe(false)
  })
})
