import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import {
  LogTail,
  MAX_LINE_LENGTH,
  parseLsofFds,
  readTail,
  sanitizeLine,
  stripAnsi
} from '../src/main/services/webLog'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'localpeek-log-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('stripAnsi / sanitizeLine', () => {
  test('removes ANSI color codes', () => {
    expect(stripAnsi('\u001b[32mINFO\u001b[0m boot')).toBe('INFO boot')
  })

  test('drops trailing carriage return and truncates long lines', () => {
    expect(sanitizeLine('hello\r')).toBe('hello')
    const long = 'x'.repeat(MAX_LINE_LENGTH + 100)
    const result = sanitizeLine(long)
    expect(result.length).toBe(MAX_LINE_LENGTH + 1)
    expect(result.endsWith('…')).toBe(true)
  })
})

describe('readTail', () => {
  test('returns the last N complete lines', () => {
    const file = join(tempDir(), 'a.log')
    writeFileSync(file, Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\n') + '\n')
    const lines = readTail(file, 200)
    expect(lines).toHaveLength(200)
    expect(lines[0]).toBe('line 100')
    expect(lines[199]).toBe('line 299')
  })

  test('drops a trailing partial line', () => {
    const file = join(tempDir(), 'b.log')
    writeFileSync(file, 'first\nsecond\nopen')
    expect(readTail(file, 200)).toEqual(['first', 'second'])
  })

  test('returns empty for a missing file', () => {
    expect(readTail(join(tempDir(), 'missing.log'))).toEqual([])
  })
})

describe('parseLsofFds', () => {
  test('keeps regular files per pid and ignores psuedo devices', () => {
    const output = [
      'p100',
      'f1',
      'n/Users/me/logs/web-5173.log',
      'f2',
      'n/Users/me/logs/web-5173.log',
      'p200',
      'f1',
      'n/dev/ttys000',
      'f2',
      'n/Users/me/dev.log',
      'p300',
      'f1',
      'n->0x1234abcd',
      'f2',
      'n/Users/me/old.log (deleted)'
    ].join('\n')
    const result = parseLsofFds(output)
    expect(result.get(100)).toEqual(['/Users/me/logs/web-5173.log'])
    expect(result.get(200)).toEqual(['/Users/me/dev.log'])
    expect(result.has(300)).toBe(false)
  })
})

describe('LogTail', () => {
  test('emits complete new lines, buffers partial lines and resets on truncation', () => {
    const dir = tempDir()
    const file = join(dir, 'tail.log')
    writeFileSync(file, 'hello\n')
    const batches: string[][] = []
    const tail = new LogTail(file, {
      onLines: (lines) => batches.push(lines),
      onError: () => {}
    })
    tail.start()
    tail.stop()

    appendFileSync(file, 'world\n')
    tail.pump()
    expect(batches).toEqual([['world']])

    appendFileSync(file, 'par')
    tail.pump()
    expect(batches).toEqual([['world']])

    appendFileSync(file, 'tial\n')
    tail.pump()
    expect(batches).toEqual([['world'], ['partial']])

    writeFileSync(file, 'fresh\n')
    tail.pump()
    expect(batches).toEqual([['world'], ['partial'], ['fresh']])
  })
})
