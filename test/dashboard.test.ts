import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startDashboard, dashboardHtml } from '../src/dashboard.ts'
import { WolfBrain } from '../src/brain.ts'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let dir = ''
let brain: WolfBrain
let server: { url: string; close: () => Promise<void> }
let cleanup: () => Promise<void> = async () => {}

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'openwolf-dash-'))
  await mkdir(join(dir, 'src'), { recursive: true })
  await writeFile(join(dir, 'src/app.ts'), 'export function app() { return 1 }\n')
  brain = new WolfBrain(dir, '.wolf')
  await brain.ensure()
  await brain.recordSessionUsage('sess-1', 'deepseek-v4-flash', 12345)
  server = await startDashboard({ brain, token: 'secret123', port: 0 })
  cleanup = () => rm(dir, { recursive: true, force: true })
})

after(async () => {
  await server.close()
  await cleanup()
})

test('dashboard rejects unauthenticated requests', async () => {
  const res = await fetch(`${server.url}/api/report`)
  assert.equal(res.status, 401)
  const res2 = await fetch(`${server.url}/api/report?token=wrong`)
  assert.equal(res2.status, 401)
})

test('dashboard serves the HTML page and report endpoint', async () => {
  const html = await fetch(`${server.url}/?token=secret123`)
  assert.equal(html.status, 200)
  const text = await html.text()
  assert.ok(text.includes('dsh-openwolf'), 'page title')
  assert.ok(text.includes('#anatomy'), 'deep-linkable panels')

  const report = await (await fetch(`${server.url}/api/report?token=secret123`)).json()
  assert.equal(report.totalSessions, 1)
  assert.equal(report.measuredTokens, 12345)
})

test('dashboard status and anatomy endpoints', async () => {
  const status = await (await fetch(`${server.url}/api/status?token=secret123`)).json()
  assert.equal(status.totalFiles, 0) // no scan yet
  assert.equal(typeof status.digestBudget, 'number')
  const anat = await (await fetch(`${server.url}/api/anatomy?token=secret123`)).json()
  assert.ok(anat.markdown.includes('src/app.ts'), 'anatomy lists the fixture file')
  const bugs = await (await fetch(`${server.url}/api/bugs?token=secret123`)).json()
  assert.deepEqual(bugs.bugs, [])
  assert.equal((await fetch(`${server.url}/api/nope?token=secret123`)).status, 404)
})

test('dashboardHtml is self-contained', () => {
  const html = dashboardHtml()
  assert.ok(!html.includes('http://'), 'no external assets')
  assert.ok(html.includes('localStorage'), 'token persistence')
})
