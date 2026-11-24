import { describe, expect, test } from 'vitest'
import {
  DEFAULT_SETTINGS,
  resolveProjectName,
  sanitizeSettings
} from '../src/shared/settings'

describe('project overrides', () => {
  test('keeps valid string overrides and trims values', () => {
    const settings = sanitizeSettings({
      projectOverrides: {
        'repo:/Users/me/code/shop': ' 商城 ',
        'repo:/empty': '',
        'repo:/number': 42
      }
    })
    expect(settings.projectOverrides).toEqual({ 'repo:/Users/me/code/shop': '商城' })
  })

  test('resolveProjectName prefers the override for the project key', () => {
    expect(resolveProjectName('repo:/a', 'auto', { 'repo:/a': 'Merged' })).toBe('Merged')
    expect(resolveProjectName('repo:/b', 'auto', { 'repo:/a': 'Merged' })).toBe('auto')
    expect(resolveProjectName(undefined, 'auto', {})).toBe('auto')
  })
})

describe('sanitizeSettings', () => {
  test('returns defaults for missing or invalid input', () => {
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(sanitizeSettings('nope')).toEqual(DEFAULT_SETTINGS)
    expect(sanitizeSettings({})).toEqual(DEFAULT_SETTINGS)
  })

  test('merges valid partial settings', () => {
    const settings = sanitizeSettings({
      scanHost: '192.168.1.20',
      dbPorts: [4306, 6380],
      dbPortRanges: [[4300, 4310]],
      webPortRanges: [[3000, 3010]],
      redisDbs: 4,
      webHistoryLimit: 120
    })
    expect(settings).toEqual({
      scanHost: '192.168.1.20',
      dbPorts: [4306, 6380],
      dbPortRanges: [[4300, 4310]],
      webPortRanges: [[3000, 3010]],
      redisDbs: 4,
      webHistoryLimit: 120,
      projectOverrides: {}
    })
  })

  test('falls back per field for invalid values', () => {
    const settings = sanitizeSettings({
      scanHost: '   ',
      dbPorts: [0, 70000, 6379, 'x'],
      dbPortRanges: [[10, 5], [1, 2, 3], [9000, 9100]],
      webPortRanges: 'bad',
      redisDbs: 0,
      webHistoryLimit: 9999
    })
    expect(settings.scanHost).toBe(DEFAULT_SETTINGS.scanHost)
    expect(settings.dbPorts).toEqual([6379])
    expect(settings.dbPortRanges).toEqual([[9000, 9100]])
    expect(settings.webPortRanges).toEqual(DEFAULT_SETTINGS.webPortRanges)
    expect(settings.redisDbs).toBe(DEFAULT_SETTINGS.redisDbs)
    expect(settings.webHistoryLimit).toBe(DEFAULT_SETTINGS.webHistoryLimit)
  })

  test('caps redis dbs and history while allowing small positive values', () => {
    expect(sanitizeSettings({ redisDbs: 1 }).redisDbs).toBe(1)
    expect(sanitizeSettings({ redisDbs: 64 }).redisDbs).toBe(64)
    expect(sanitizeSettings({ redisDbs: 65 }).redisDbs).toBe(DEFAULT_SETTINGS.redisDbs)
    expect(sanitizeSettings({ webHistoryLimit: 1 }).webHistoryLimit).toBe(1)
    expect(sanitizeSettings({ webHistoryLimit: 500 }).webHistoryLimit).toBe(500)
  })

  test('deduplicates list values', () => {
    const settings = sanitizeSettings({
      dbPorts: [6379, 6379, 3306],
      dbPortRanges: [[3300, 3400], [3300, 3400]]
    })
    expect(settings.dbPorts).toEqual([6379, 3306])
    expect(settings.dbPortRanges).toEqual([[3300, 3400]])
  })
})
