import { describe, expect, it } from 'vitest'
import { parseMysqlHandshake, parseRedisResponse } from '../src/main/discovery/probe'

function mysqlHandshake(version: string): Buffer {
  const versionBytes = Buffer.from(version, 'utf8')
  const payload = Buffer.concat([Buffer.from([0x0a]), versionBytes, Buffer.from([0x00])])
  const header = Buffer.from([payload.length & 0xff, (payload.length >> 8) & 0xff, 0x00, 0x00])
  return Buffer.concat([header, payload])
}

describe('parseMysqlHandshake', () => {
  it('extracts the server version', () => {
    expect(parseMysqlHandshake(mysqlHandshake('8.0.46'))).toBe('8.0.46')
    expect(parseMysqlHandshake(mysqlHandshake('5.5.5-10.11.6-MariaDB'))).toBe('5.5.5-10.11.6-MariaDB')
  })

  it('rejects short or non-handshake payloads', () => {
    expect(parseMysqlHandshake(Buffer.from('+PONG\r\n'))).toBeNull()
    expect(parseMysqlHandshake(Buffer.from([0x01, 0x00, 0x00, 0x00, 0x0a]))).toBeNull()
    expect(parseMysqlHandshake(Buffer.alloc(0))).toBeNull()
  })

  it('rejects garbage version strings', () => {
    expect(parseMysqlHandshake(mysqlHandshake('not-a-version'))).toBeNull()
  })
})

describe('parseRedisResponse', () => {
  it('recognises PONG', () => {
    expect(parseRedisResponse(Buffer.from('+PONG\r\n'))).toEqual({ needsAuth: false })
  })

  it('recognises authentication requirements', () => {
    expect(parseRedisResponse(Buffer.from('-NOAUTH Authentication required.\r\n'))).toEqual({
      needsAuth: true
    })
    expect(parseRedisResponse(Buffer.from('-WRONGPASS invalid username-password pair\r\n'))).toEqual({
      needsAuth: true
    })
    expect(
      parseRedisResponse(Buffer.from('-ERR operation not permitted\r\n'))
    ).toEqual({ needsAuth: true })
  })

  it('waits for a complete line or ignores unknown responses', () => {
    expect(parseRedisResponse(Buffer.from('+PO'))).toBeNull()
    expect(parseRedisResponse(Buffer.from('-ERR unknown command\r\n'))).toBeNull()
    expect(parseRedisResponse(Buffer.from('$4\r\nPING\r\n'))).toBeNull()
  })
})
