import http from 'node:http'
import { describe, expect, it } from 'vitest'
import {
  classifyRole,
  extractTitle,
  isDevPort,
  probeHttp
} from '../src/main/discovery/webapps'

describe('classifyRole', () => {
  it('detects frontend frameworks from the command line', () => {
    expect(classifyRole(6123, 'node /repo/node_modules/vite/bin/vite.js', '')).toBe('frontend')
    expect(classifyRole(6123, 'next-server (v15.0.0)', '')).toBe('frontend')
    expect(classifyRole(6123, 'node /repo/node_modules/@angular/cli ng serve', '')).toBe('frontend')
  })

  it('detects backend frameworks from the command line', () => {
    expect(classifyRole(6123, 'python3 -m uvicorn app:app --reload', '')).toBe('backend')
    expect(classifyRole(6123, 'java -jar spring-boot-app.jar', '')).toBe('backend')
    expect(classifyRole(6123, 'gunicorn myapp.wsgi:application', '')).toBe('backend')
  })

  it('falls back to content type', () => {
    expect(classifyRole(6123, 'python3 -m http.server', 'text/html; charset=utf-8')).toBe('frontend')
    expect(classifyRole(6123, 'node server.js', 'application/json; charset=utf-8')).toBe('backend')
  })

  it('falls back to well-known ports', () => {
    expect(classifyRole(5173, 'node', '')).toBe('frontend')
    expect(classifyRole(4200, 'node', '')).toBe('frontend')
    expect(classifyRole(8000, 'node', '')).toBe('backend')
    expect(classifyRole(8080, 'node', '')).toBe('backend')
  })

  it('uses web for unknown port and content', () => {
    expect(classifyRole(6543, 'node', 'application/xml')).toBe('web')
  })
})

describe('isDevPort', () => {
  it('accepts common dev ports and their neighbourhoods', () => {
    expect(isDevPort(3000)).toBe(true)
    expect(isDevPort(5173)).toBe(true)
    expect(isDevPort(8002)).toBe(true)
    expect(isDevPort(8080)).toBe(true)
    expect(isDevPort(9090)).toBe(true)
  })

  it('rejects unrelated high ports', () => {
    expect(isDevPort(5541)).toBe(false)
    expect(isDevPort(8765)).toBe(false)
    expect(isDevPort(64080)).toBe(false)
    expect(isDevPort(6333)).toBe(false)
  })
})

describe('probeHttp', () => {
  it('probes IPv6-only localhost services', async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end('<html><head><title>IPv6 App</title></head><body>ok</body></html>')
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen({ host: '::1', port: 0 }, () => resolve())
    })
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    try {
      const result = await probeHttp(port, 500)
      expect(result?.status).toBe(200)
      expect(result?.title).toBe('IPv6 App')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

describe('extractTitle', () => {
  it('extracts and decodes the html title', () => {
    expect(extractTitle('<html><head><title> Tom &amp; Jerry </title></head></html>')).toBe(
      'Tom & Jerry'
    )
    expect(extractTitle('<title>A &quot;quoted&quot; title</title>')).toBe('A "quoted" title')
  })

  it('returns undefined without a title', () => {
    expect(extractTitle('<html><body>hello</body></html>')).toBeUndefined()
  })

  it('limits title length', () => {
    const title = extractTitle(`<title>${'x'.repeat(200)}</title>`)
    expect(title).toHaveLength(80)
  })
})
