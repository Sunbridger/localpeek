import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { detectProject } from '../src/main/projectName'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'localpeek-project-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('detectProject', () => {
  it('uses the git repo root for packages inside a monorepo', () => {
    const root = tempDir()
    const repo = join(root, 'shop-repo')
    mkdirSync(join(repo, '.git'), { recursive: true })
    const packageDir = join(repo, 'packages', 'api')
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(join(packageDir, 'package.json'), '{}')

    const identity = detectProject(packageDir)
    expect(identity?.name).toBe('shop-repo')
    expect(identity?.source).toBe('repo')
    expect(identity?.key.startsWith('repo:')).toBe(true)
  })

  it('falls back to the parent name for non-git generic package dirs', () => {
    const root = tempDir()
    const project = join(root, 'my-project')
    const frontend = join(project, 'frontend')
    mkdirSync(frontend, { recursive: true })
    writeFileSync(join(frontend, 'package.json'), '{}')

    const identity = detectProject(frontend)
    expect(identity?.name).toBe('my-project')
    expect(identity?.source).toBe('package')
  })

  it('uses a non-generic package directory name', () => {
    const root = tempDir()
    const packageDir = join(root, 'shop')
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(join(packageDir, 'package.json'), '{}')

    expect(detectProject(packageDir)?.name).toBe('shop')
  })

  it('returns undefined when no project markers exist', () => {
    const root = tempDir()
    const cwd = join(root, 'misc', 'app')
    mkdirSync(cwd, { recursive: true })

    expect(detectProject(cwd)).toBeUndefined()
  })
})
