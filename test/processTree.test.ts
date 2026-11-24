import { describe, expect, test } from 'vitest'
import { parseProcessTable, pickLaunchCommand } from '../src/main/discovery/processTree'

const table = parseProcessTable(`  100     1 -zsh
  200   100 bash ./dev.sh
  300   200 uv run uvicorn app.main:app --host 127.0.0.1 --port 8002 --reload
  301   300 /repo/backend/.venv/bin/python /repo/backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8002 --reload
  302   301 /repo/backend/.venv/bin/python -c from multiprocessing.spawn import spawn_main; spawn_main(tracker_fd=5, pipe_handle=7) --multiprocessing-fork
  400   100 node /repo/frontend/node_modules/.bin/vite --host 127.0.0.1 --port 5173
  401   400 /repo/frontend/node_modules/@esbuild/darwin-arm64/bin/esbuild --service=0.25.12 --ping
`)

describe('parseProcessTable', () => {
  test('parses pid, ppid and the full command', () => {
    expect(table.get(301)?.ppid).toBe(300)
    expect(table.get(301)?.command).toContain('uvicorn app.main:app')
    expect(table.get(302)?.command).toContain('multiprocessing.spawn')
  })
})

describe('pickLaunchCommand', () => {
  test('walks past the uvicorn reload worker to the uvicorn server command', () => {
    const launch = pickLaunchCommand([301, 302], table)
    expect(launch?.pid).toBe(301)
    expect(launch?.command).toContain('uvicorn app.main:app')
  })

  test('does not pick multiprocessing helpers or the parent dev script', () => {
    const launch = pickLaunchCommand([302], table)
    expect(launch?.command).not.toContain('multiprocessing')
    expect(launch?.command).not.toContain('dev.sh')
  })

  test('picks the vite command for a frontend listener', () => {
    const launch = pickLaunchCommand([400], table)
    expect(launch?.pid).toBe(400)
    expect(launch?.command).toContain('vite')
  })

  test('returns undefined when only wrappers and workers are available', () => {
    const wrappers = parseProcessTable(`  10     1 -zsh
  11    10 bash ./dev.sh
  12    11 python -c from multiprocessing.spawn import spawn_main; spawn_main() --multiprocessing-fork
`)
    expect(pickLaunchCommand([12], wrappers)).toBeUndefined()
  })
})
