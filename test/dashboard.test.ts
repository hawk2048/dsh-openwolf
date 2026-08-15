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
  assert.ok(text.includes('#anatomy') && text.includes('#activity') && text.includes('#cron') && text.includes('#overview'), 'deep-linkable panels')

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
  const cron = await (await fetch(`${server.url}/api/cron?token=secret123`)).json()
  assert.deepEqual(cron.tasks, [])
  assert.equal((await fetch(`${server.url}/api/nope?token=secret123`)).status, 404)
})

test('dashboardHtml is self-contained', () => {
  const html = dashboardHtml()
  assert.ok(!html.includes('http://'), 'no external assets')
  assert.ok(html.includes('localStorage'), 'token persistence')
})

test('dashboardHtml has 30s auto-refresh with an in-flight guard', () => {
  const html = dashboardHtml()
  assert.ok(html.includes('live · 30s'), 'live badge present')
  assert.ok(html.includes('setInterval'), 'auto-refresh interval wired')
  assert.ok(html.includes('document.hidden'), 'paused when the tab is hidden')
  assert.ok(html.includes('refreshing'), 'no stacked refreshes')
})

test('dashboardHtml prefers Server-Sent Events with a poll fallback', () => {
  const html = dashboardHtml()
  assert.ok(html.includes("new EventSource('/api/events?token='"), 'SSE wired with token')
  assert.ok(html.includes("sse.addEventListener('refresh', refreshNow)"), 'refresh event handled')
  assert.ok(html.includes('sse.onopen = stopPoll'), 'poll stops once SSE is live')
  assert.ok(html.includes('sse.onerror = startPoll'), 'poll resumes on SSE drop')
})

test('dashboard SSE pushes a refresh event when a brain file changes', async () => {
  const ac = new AbortController()
  const res = await fetch(`${server.url}/api/events?token=secret123`, { signal: ac.signal })
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/)
  const reader = res.body?.getReader()
  assert.ok(reader, 'streaming body available')
  const decoder = new TextDecoder()
  // Let the server prime its mtime map, then touch a watched brain file
  // (buglog.json) and expect a push.
  await new Promise((r) => setTimeout(r, 2500))
  await brain.logBug('sse-live-test', 'verified')
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), 6000))
  const collect = (async (): Promise<string | null> => {
    let buf = ''
    for (;;) {
      const { done, value } = await reader!.read()
      if (done) return null
      buf += decoder.decode(value, { stream: true })
      if (buf.includes('event: refresh')) return buf
    }
  })()
  const out = await Promise.race([collect, timeout])
  ac.abort()
  assert.ok(out !== null && out.includes('event: refresh'), 'refresh event pushed after a brain change')
})
