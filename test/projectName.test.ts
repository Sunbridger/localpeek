import { describe, expect, it } from 'vitest'
import { extractProjectName } from '../src/main/projectName'

describe('extractProjectName', () => {
  it('parses project names from /mycode/ paths', () => {
    expect(
      extractProjectName(
        'node /Users/me/mycode/demo-project/frontend/node_modules/.bin/vite --host 127.0.0.1 --port 5173'
      )
    ).toBe('demo-project')
  })

  it('supports custom project roots from settings', () => {
    expect(
      extractProjectName(
        'node /Users/me/work/client-a/frontend/node_modules/.bin/vite',
        undefined,
        ['work']
      )
    ).toBe('client-a')
  })

  it('parses project names from /code/ paths', () => {
    expect(extractProjectName('python3 /Users/me/code/agent-api/app.py')).toBe('agent-api')
    expect(extractProjectName(undefined, '/Users/me/code/web-console/frontend')).toBe('web-console')
  })

  it('prefers the command line over the cwd', () => {
    expect(
      extractProjectName(
        'node /Users/me/mycode/first-project/frontend/vite',
        '/Users/me/mycode/second-project/frontend'
      )
    ).toBe('first-project')
  })

  it('falls back to the last meaningful cwd segment', () => {
    expect(extractProjectName('uvicorn app:app', '/Users/me/projects/bar/frontend')).toBe('bar')
    expect(extractProjectName('node server.js', '/Users/me/projects/backend')).toBe('projects')
    expect(extractProjectName('node server.js', '/Users/me/projects/shop/api')).toBe('shop')
  })

  it('returns undefined when nothing meaningful is available', () => {
    expect(extractProjectName(undefined, '/frontend')).toBeUndefined()
    expect(extractProjectName(undefined, '/')).toBeUndefined()
    expect(extractProjectName('node server.js')).toBeUndefined()
  })
})
