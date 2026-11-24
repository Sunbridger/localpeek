import { app, net, shell } from 'electron'
import { execFile, spawn } from 'node:child_process'
import {
  accessSync,
  constants as fsConstants,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { APP_NAME, REPO_URL } from '../shared/appInfo'
import { appVersion } from './appVersion'
import {
  buildUpdateCheck,
  type GithubRelease,
  type UpdateCheckResult,
  type UpdateDownloadResult,
  type UpdateProgress
} from '../shared/update'

const execFileAsync = promisify(execFile)
const RELEASES_API = REPO_URL.replace(
  'https://github.com/',
  'https://api.github.com/repos/'
).concat('/releases/latest')
const DOWNLOAD_HOST = 'https://github.com/Sunbridger/localpeek/releases/download/'

interface PendingUpdate {
  version: string
  dmgPath: string
  stagedAppPath: string
  targetAppPath: string
}

let pending: PendingUpdate | null = null
let downloading = false

function requestHeaders(): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    'User-Agent': `${APP_NAME}/${appVersion()}`,
    'X-GitHub-Api-Version': '2022-11-28'
  }
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const response = await net.fetch(RELEASES_API, { headers: requestHeaders() })
  if (!response.ok) {
    if (response.status === 403) throw new Error('GitHub API 请求过于频繁，请稍后再试')
    if (response.status === 404) throw new Error('尚未发布可用的 Release')
    throw new Error(`检查更新失败（HTTP ${response.status}）`)
  }
  const release = (await response.json()) as GithubRelease
  return buildUpdateCheck(appVersion(), release)
}

function currentAppBundle(): string | undefined {
  const match = /^(.*\.app)\/Contents\/MacOS\//.exec(app.getPath('exe'))
  return match?.[1]
}

function canAutoInstall(): boolean {
  if (!app.isPackaged) return false
  const bundle = currentAppBundle()
  if (!bundle || bundle.startsWith('/Volumes/') || bundle.includes('/AppTranslocation/')) {
    return false
  }
  try {
    accessSync(dirname(bundle), fsConstants.W_OK)
    return true
  } catch {
    return false
  }
}

function emitProgress(
  onProgress: (progress: UpdateProgress) => void,
  phase: UpdateProgress['phase'],
  received: number,
  total: number | null
): void {
  onProgress({ phase, received, total })
}

async function prepareStagedApp(dmgPath: string, workDir: string): Promise<string> {
  const mountDir = join(workDir, 'mnt')
  const stageDir = join(workDir, 'stage')
  mkdirSync(mountDir, { recursive: true })
  mkdirSync(stageDir, { recursive: true })
  await execFileAsync('hdiutil', [
    'attach',
    '-nobrowse',
    '-readonly',
    '-noautoopen',
    '-mountpoint',
    mountDir,
    dmgPath
  ])
  try {
    const appName = readdirSync(mountDir).find((name) => name.endsWith('.app'))
    if (!appName) throw new Error('安装包中未找到应用')
    const staged = join(stageDir, appName)
    await execFileAsync('ditto', [join(mountDir, appName), staged])
    return staged
  } finally {
    await execFileAsync('hdiutil', ['detach', mountDir]).catch(() => {})
  }
}

export async function downloadUpdate(
  onProgress: (progress: UpdateProgress) => void
): Promise<UpdateDownloadResult> {
  if (downloading) throw new Error('已有更新正在下载')
  downloading = true
  try {
    const check = await checkForUpdate()
    if (!check.hasUpdate) throw new Error('当前已是最新版本')
    if (!check.asset) throw new Error('最新版本没有可用的 macOS 安装包')
    if (!check.asset.url.startsWith(DOWNLOAD_HOST)) {
      throw new Error('更新包地址不在可信的 GitHub Releases 范围内')
    }

    const dmgName = basename(check.asset.name)
    if (!/\.dmg$/i.test(dmgName)) throw new Error('更新包格式不正确')
    const workDir = join(app.getPath('temp'), 'localpeek-update', check.latestVersion)
    rmSync(workDir, { recursive: true, force: true })
    mkdirSync(workDir, { recursive: true })
    const dmgPath = join(workDir, dmgName)

    emitProgress(onProgress, 'downloading', 0, check.asset.size || null)
    const response = await net.fetch(check.asset.url, { headers: requestHeaders() })
    if (!response.ok || !response.body) {
      throw new Error(`下载更新失败（HTTP ${response.status}）`)
    }
    const totalHeader = Number(response.headers.get('content-length') ?? 0)
    const total = totalHeader > 0 ? totalHeader : check.asset.size || null
    let received = 0
    let lastReport = 0
    const source = Readable.fromWeb(
      response.body as unknown as import('node:stream/web').ReadableStream<Uint8Array>
    )
    source.on('data', (chunk: Buffer) => {
      received += chunk.length
      const now = Date.now()
      if (now - lastReport > 250) {
        lastReport = now
        emitProgress(onProgress, 'downloading', received, total)
      }
    })
    await pipeline(source, createWriteStream(dmgPath))
    if (received <= 0) throw new Error('下载的更新包为空')
    emitProgress(onProgress, 'downloading', received, total ?? received)

    if (!existsSync(dmgPath)) throw new Error('更新包下载失败')

    if (!canAutoInstall()) {
      const error = await shell.openPath(dmgPath)
      if (error) throw new Error(`无法打开安装包：${error}`)
      return {
        version: check.latestVersion,
        filePath: dmgPath,
        canAutoInstall: false,
        opened: true
      }
    }

    emitProgress(onProgress, 'preparing', received, total ?? received)
    const targetAppPath = currentAppBundle()
    if (targetAppPath) {
      try {
        const stagedAppPath = await prepareStagedApp(dmgPath, workDir)
        pending = { version: check.latestVersion, dmgPath, stagedAppPath, targetAppPath }
        return {
          version: check.latestVersion,
          filePath: dmgPath,
          canAutoInstall: true,
          opened: false
        }
      } catch {
        // 自动安装准备失败时退回打开安装包，避免更新卡住
      }
    }
    const openError = await shell.openPath(dmgPath)
    if (openError) throw new Error(`无法打开安装包：${openError}`)
    return {
      version: check.latestVersion,
      filePath: dmgPath,
      canAutoInstall: false,
      opened: true
    }
  } finally {
    downloading = false
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export async function installUpdate(): Promise<void> {
  if (!pending) throw new Error('没有已下载的更新')
  const { stagedAppPath, targetAppPath } = pending
  if (!existsSync(stagedAppPath)) throw new Error('更新包已失效，请重新下载')

  const scriptPath = join(dirname(stagedAppPath), 'install.sh')
  const logPath = join(dirname(stagedAppPath), 'install.log')
  const script = `#!/bin/sh
LOG=${shellQuote(logPath)}
exec >>"$LOG" 2>&1
echo "[$(date)] waiting for LocalPeek to exit"
i=0
while kill -0 ${process.pid} 2>/dev/null; do
  i=$((i+1))
  if [ "$i" -gt 240 ]; then echo "timeout waiting for app to exit"; exit 1; fi
  sleep 0.25
done
rm -rf ${shellQuote(targetAppPath)}
ditto ${shellQuote(stagedAppPath)} ${shellQuote(targetAppPath)}
xattr -dr com.apple.quarantine ${shellQuote(targetAppPath)} 2>/dev/null
open ${shellQuote(targetAppPath)}
`
  writeFileSync(scriptPath, script, { mode: 0o700 })
  const child = spawn('/bin/sh', [scriptPath], { detached: true, stdio: 'ignore' })
  child.unref()
  pending = null
  setTimeout(() => app.quit(), 900)
}

export async function openDownloadedUpdate(): Promise<void> {
  if (!pending || !existsSync(pending.dmgPath)) throw new Error('没有已下载的更新')
  const error = await shell.openPath(pending.dmgPath)
  if (error) throw new Error(`无法打开安装包：${error}`)
}
