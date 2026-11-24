import { describe, expect, test } from 'vitest'
import { buildUpdateCheck, compareVersions, pickDmgAsset } from '../src/shared/update'
import type { GithubRelease } from '../src/shared/update'

const assets: GithubRelease['assets'] = [
  {
    name: 'LocalPeek-0.2.0-arm64.dmg',
    browser_download_url: 'https://github.com/Sunbridger/localpeek/releases/download/v0.2.0/x.dmg',
    size: 100
  },
  {
    name: 'LocalPeek-0.2.0-arm64.dmg.blockmap',
    browser_download_url: 'https://github.com/Sunbridger/localpeek/releases/download/v0.2.0/x.dmg.blockmap',
    size: 10
  },
  {
    name: 'LocalPeek-0.2.0-arm64.zip',
    browser_download_url: 'https://github.com/Sunbridger/localpeek/releases/download/v0.2.0/x.zip',
    size: 80
  }
]

describe('compareVersions', () => {
  test('compares numeric version segments and ignores a leading v', () => {
    expect(compareVersions('v0.1.10', '0.1.9')).toBeGreaterThan(0)
    expect(compareVersions('0.1.2', 'v0.1.2')).toBe(0)
    expect(compareVersions('0.1.1', '0.1.2')).toBeLessThan(0)
  })

  test('treats invalid versions as older', () => {
    expect(compareVersions('not-a-version', '0.1.0')).toBeLessThan(0)
    expect(compareVersions('0.1.0', 'unknown')).toBeGreaterThan(0)
  })
})

describe('pickDmgAsset', () => {
  test('prefers an arm64 dmg and ignores blockmaps and zips', () => {
    const asset = pickDmgAsset(assets)
    expect(asset?.name).toBe('LocalPeek-0.2.0-arm64.dmg')
  })

  test('falls back to any dmg when arch is not in the name', () => {
    const asset = pickDmgAsset([{ ...assets[0], name: 'LocalPeek.dmg' }])
    expect(asset?.name).toBe('LocalPeek.dmg')
  })

  test('returns undefined when there is no dmg', () => {
    expect(pickDmgAsset([assets[2]])).toBeUndefined()
  })
})

describe('buildUpdateCheck', () => {
  test('reports a newer release with its downloadable dmg', () => {
    const result = buildUpdateCheck('0.1.2', {
      tag_name: 'v0.2.0',
      html_url: 'https://github.com/Sunbridger/localpeek/releases/tag/v0.2.0',
      body: '## 更新内容\n- 修复问题',
      published_at: '2026-11-25T00:00:00Z',
      assets
    })
    expect(result.hasUpdate).toBe(true)
    expect(result.currentVersion).toBe('0.1.2')
    expect(result.latestVersion).toBe('0.2.0')
    expect(result.asset?.name).toBe('LocalPeek-0.2.0-arm64.dmg')
    expect(result.releaseNotes).toContain('修复问题')
  })

  test('reports no update when the current version is newer or equal', () => {
    const release: GithubRelease = {
      tag_name: 'v0.1.2',
      html_url: 'https://github.com/Sunbridger/localpeek/releases/tag/v0.1.2',
      body: '',
      published_at: '',
      assets
    }
    expect(buildUpdateCheck('0.1.2', release).hasUpdate).toBe(false)
    expect(buildUpdateCheck('0.1.3', release).hasUpdate).toBe(false)
  })
})
