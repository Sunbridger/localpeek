import { existsSync } from 'node:fs'

export const IS_MAC = process.platform === 'darwin'
export const IS_LINUX = process.platform === 'linux'

/** 当前仅针对 macOS 验证；Linux 预留，Windows 暂不支持。 */
export function isSupportedPlatform(): boolean {
  return IS_MAC || IS_LINUX
}

export function lsofCandidates(): string[] {
  return IS_MAC
    ? ['/usr/sbin/lsof', '/usr/bin/lsof']
    : ['/usr/bin/lsof', '/usr/sbin/lsof', '/bin/lsof']
}

export function lsofBinary(): string {
  for (const candidate of lsofCandidates()) {
    if (existsSync(candidate)) return candidate
  }
  return 'lsof'
}

export function psBinary(): string {
  for (const candidate of ['/bin/ps', '/usr/bin/ps']) {
    if (existsSync(candidate)) return candidate
  }
  return 'ps'
}

export function shellBinary(): string {
  const shell = process.env.SHELL
  if (shell && existsSync(shell)) return shell
  return IS_MAC ? '/bin/zsh' : '/bin/sh'
}

export function systemPath(): string {
  const base = process.env.PATH ?? ''
  return `${base}:/usr/sbin:/sbin:/usr/bin:/bin`
}
