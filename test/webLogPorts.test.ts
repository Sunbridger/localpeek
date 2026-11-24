import { describe, expect, test } from 'vitest'
import {
  MAX_LOG_PANELS,
  sanitizeLogPorts,
  toggleLogPort
} from '../src/renderer/src/webLogPorts'

describe('toggleLogPort', () => {
  test('opens ports in click order', () => {
    expect(toggleLogPort([], 5173)).toEqual([5173])
    expect(toggleLogPort([5173], 8002)).toEqual([5173, 8002])
  })

  test('closes an already open port', () => {
    expect(toggleLogPort([5173, 8002, 9000], 8002)).toEqual([5173, 9000])
  })

  test('replaces the oldest panel when opening beyond the limit', () => {
    const full = [5173, 8002, 9000, 9001]
    expect(MAX_LOG_PANELS).toBe(4)
    expect(toggleLogPort(full, 9100)).toEqual([8002, 9000, 9001, 9100])
  })

  test('does not reorder when toggling an open port at the limit', () => {
    expect(toggleLogPort([5173, 8002, 9000, 9001], 5173)).toEqual([8002, 9000, 9001])
  })
})

describe('sanitizeLogPorts', () => {
  test('keeps valid unique ports and caps at the newest four', () => {
    expect(sanitizeLogPorts([5173, '5173', 8002, 0, -1, 9000, 9001, 9100, 'x'])).toEqual([
      8002,
      9000,
      9001,
      9100
    ])
  })

  test('returns empty for non-arrays', () => {
    expect(sanitizeLogPorts(null)).toEqual([])
    expect(sanitizeLogPorts(5173)).toEqual([])
    expect(sanitizeLogPorts({ a: 1 })).toEqual([])
  })
})
