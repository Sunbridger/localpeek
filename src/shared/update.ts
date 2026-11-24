export interface GithubAsset {
  name: string
  browser_download_url: string
  size: number
}

export interface GithubRelease {
  tag_name: string
  html_url: string
  body?: string | null
  published_at?: string | null
  assets: GithubAsset[]
}

export interface UpdateAsset {
  name: string
  url: string
  size: number
}

export interface UpdateCheckResult {
  currentVersion: string
  latestVersion: string
  hasUpdate: boolean
  releaseUrl: string
  releaseNotes: string
  publishedAt: string | null
  asset?: UpdateAsset
}

export interface UpdateProgress {
  phase: 'downloading' | 'preparing'
  received: number
  total: number | null
}

export interface UpdateDownloadResult {
  version: string
  filePath: string
  canAutoInstall: boolean
  opened: boolean
}

interface ParsedVersion {
  core: number[]
  prerelease: string | null
}

function parseVersion(version: string): ParsedVersion | null {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    String(version).trim()
  )
  if (!match) return null
  return {
    core: [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)],
    prerelease: match[4] ?? null
  }
}

export function normalizeVersion(version: string): string {
  return String(version).trim().replace(/^v/i, '')
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a && !b) return 0
  if (!a) return -1
  if (!b) return 1
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] > b.core[index] ? 1 : -1
  }
  if (a.prerelease === b.prerelease) return 0
  if (!a.prerelease) return 1
  if (!b.prerelease) return -1
  return a.prerelease > b.prerelease ? 1 : -1
}

export function pickDmgAsset(assets: GithubAsset[]): UpdateAsset | undefined {
  const candidates = assets.filter(
    (asset) => /\.dmg$/i.test(asset.name) && !/\.blockmap$/i.test(asset.name)
  )
  const chosen =
    candidates.find((asset) => /arm64|aarch64/i.test(asset.name)) ??
    candidates.find((asset) => !/x64|amd64|intel/i.test(asset.name))
  if (!chosen) return undefined
  return { name: chosen.name, url: chosen.browser_download_url, size: chosen.size }
}

export function buildUpdateCheck(
  currentVersion: string,
  release: GithubRelease
): UpdateCheckResult {
  const current = normalizeVersion(currentVersion)
  const latest = normalizeVersion(release.tag_name)
  return {
    currentVersion: current,
    latestVersion: latest,
    hasUpdate: compareVersions(latest, current) > 0,
    releaseUrl: release.html_url,
    releaseNotes: (release.body ?? '').trim(),
    publishedAt: release.published_at ?? null,
    asset: pickDmgAsset(release.assets ?? [])
  }
}
