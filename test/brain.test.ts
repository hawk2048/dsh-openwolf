import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { WolfBrain, isSensitiveFile, estimateTokens, DEFAULT_CONFIG } from '../src/brain.ts'

let root = ''
let brain: WolfBrain
let cleanup: () => Promise<void> = async () => {}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'openwolf-brain-'))
  brain = new WolfBrain(root, '.wolf')
  await brain.ensure()
  cleanup = () => rm(root, { recursive: true, force: true })
})

after(async () => {
  await cleanup()
})

test('ensure creates the .wolf/ layout with defaults', async () => {
  const status = await readFile(join(root, '.wolf/STATUS.md'), 'utf8')
  assert.match(status, /## 🚀 Next phase/)
  const cerebrum = await readFile(join(root, '.wolf/cerebrum.md'), 'utf8')
  assert.match(cerebrum, /## Do-Not-Repeat/)
  const config = await brain.readConfig()
  assert.equal(config.openwolf.context.sessionDigestBudgetTokens, DEFAULT_CONFIG.openwolf.context.sessionDigestBudgetTokens)
  assert.equal(config.openwolf.anatomy.rescanIntervalHours, 6)
})

test('digestBudget falls back to the default and honors per-agent budgets', async () => {
  assert.equal(await brain.digestBudget(), 1500)
  assert.equal(await brain.digestBudget('claude'), 1500)
  await brain.writeConfig({
    openwolf: {
      context: { sessionDigestBudgetTokens: 900, budgets: { claude: 400 } },
      anatomy: { rescanIntervalHours: 3, symbolThresholdTokens: 300 },
    },
  })
  assert.equal(await brain.digestBudget(), 900)
  assert.equal(await brain.digestBudget('claude'), 400)
  await brain.writeConfig(DEFAULT_CONFIG)
})

test('appendCerebrum inserts under an existing section and creates new ones', async () => {
  await brain.appendCerebrum('Do-Not-Repeat', 'never touch lock files')
  let text = await brain.readCerebrum()
  assert.match(text, /## Do-Not-Repeat\n\n- never touch lock files/)
  await brain.appendCerebrum('Conventions', 'use 2-space indent')
  text = await brain.readCerebrum()
  assert.match(text, /## Conventions\n\n- use 2-space indent/)
})

test('appendMemory appends rows and stays append-only', async () => {
  await brain.appendMemory('write', ['src/a.ts'], 'ok', 120)
  await brain.appendMemory('edit', ['src/b.ts'], 'error', 40)
  const memory = await readFile(join(root, '.wolf/memory.md'), 'utf8')
  const rows = memory.split('\n').filter((l) => l.startsWith('| 2'))
  assert.equal(rows.length, 2)
  assert.match(rows[0] ?? '', /write/)
  assert.match(rows[1] ?? '', /error/)
})

test('logBug + searchBugs round-trip', async () => {
  await brain.logBug('TypeError: x is not a function', 'added a guard', 'src/index.ts')
  await brain.logBug('ENOENT on missing config', 'created defaults')
  const hits = await brain.searchBugs('TypeError')
  assert.equal(hits.length, 1)
  assert.equal(hits[0]?.fix, 'added a guard')
  const all = await brain.searchBugs('')
  assert.equal(all.length, 2)
})

test('session state read/write', async () => {
  await brain.writeSession({
    session_id: 's1', started: new Date().toISOString(),
    files_read: { 'src/a.ts': { count: 2, tokens: 100, first_read: 'x' } },
    files_written: [], edit_counts: {}, anatomy_hits: 1, anatomy_misses: 0,
    repeated_reads_warned: 1, cerebrum_warnings: 0,
  })
  const session = await brain.readSession()
  assert.equal(session.files_read['src/a.ts']?.count, 2)
  assert.equal(session.anatomy_hits, 1)
})

test('scan state round-trip', async () => {
  await brain.writeScanState({ last_scanned: new Date().toISOString(), git_head: 'abc123', total_files: 42 })
  const state = await brain.readScanState()
  assert.equal(state.total_files, 42)
  assert.equal(state.git_head, 'abc123')
})

test('isSensitiveFile denies secrets', () => {
  assert.equal(isSensitiveFile('.env'), true)
  assert.equal(isSensitiveFile('config/.npmrc'), true)
  assert.equal(isSensitiveFile('keys/id_rsa'), true)
  assert.equal(isSensitiveFile('prod/credentials.json'), true)
  assert.equal(isSensitiveFile('src/server.ts'), false)
  // Templates (.env.example) are safe to index; only real secrets are excluded.
  assert.equal(isSensitiveFile('.env.example'), false)
})

test('estimateTokens is a positive char-ratio heuristic', () => {
  assert.equal(estimateTokens(''), 1)
  assert.ok(estimateTokens('a'.repeat(400)) >= 95 && estimateTokens('a'.repeat(400)) <= 105)
})

test('recordSessionUsage upserts by session id', async () => {
  await brain.recordSessionUsage('sess-1', 'claude', 1000)
  await brain.recordSessionUsage('sess-1', 'claude', 2500)
  await brain.recordSessionUsage('sess-2', undefined, 500)
  const ledger = await brain.readLedger()
  assert.equal(ledger.lifetime.total_sessions, 2)
  assert.equal(ledger.sessions.length, 2)
  const s1 = ledger.sessions.find((s) => s.session_id === 'sess-1')
  assert.equal(s1?.measured_tokens, 2500)
})

test('withLock serializes concurrent appends (no lost rows)', async () => {
  const b2 = new WolfBrain(root, '.wolf')
  await Promise.all(
    Array.from({ length: 20 }, (_, i) => b2.appendMemory('write', [`f${i}.ts`], 'ok', i)),
  )
  const memory = await readFile(join(root, '.wolf/memory.md'), 'utf8')
  const rows = memory.split('\n').filter((l) => /f\d+\.ts/.test(l))
  assert.equal(rows.length, 20)
})

test('withLock steals a stale lock', async () => {
  const b2 = new WolfBrain(root, '.wolf')
  const { mkdir, utimes } = await import('node:fs/promises')
  const lockPath = join(root, '.wolf/.lock')
  await mkdir(lockPath)
  const old = new Date(Date.now() - 11_000)
  await utimes(lockPath, old, old)
  const value = await b2.withLock(() => Promise.resolve(42))
  assert.equal(value, 42)
  // Lock released afterwards.
  await assert.rejects(() => b2.withLock(() => Promise.reject(new Error('x'))), /x/)
  await rm(lockPath, { recursive: true, force: true })
})

test('renderAnatomy produces the human-readable index view', () => {
  const map = {
    root, scannedAt: Date.now(), version: 1,
    totalFiles: 1, totalLines: 3, totalBytes: 30, skippedFiles: 0, truncated: false, elapsedMs: 1,
    files: [{
      path: 'src/a.ts', size: 30, lines: 3, symbols: ['main'], lang: 'ts', tokens: 8,
      symbolLines: [{ name: 'main', line: 1, endLine: 3, tokens: 8 }],
      summary: 'Exports main', mtimeMs: 0, skipped: false,
    }],
    dirs: [{ path: 'src', files: 1, lines: 3, bytes: 30 }],
  }
  const md = brain.renderAnatomy(map)
  assert.match(md, /# Anatomy/)
  assert.match(md, /Files: 1 tracked/)
  assert.match(md, /`src\/a\.ts` \(~8 tok\) — Exports main/)
  assert.match(md, /main L1-3 ~8 tok/)
})

test('syncAnatomy writes once, idempotent, and absorbs manual edits', async () => {
  const map = {
    root, scannedAt: Date.now(), version: 2,
    totalFiles: 1, totalLines: 1, totalBytes: 10, skippedFiles: 0, truncated: false, elapsedMs: 1,
    files: [{
      path: 'x.ts', size: 10, lines: 1, symbols: ['x'], lang: 'ts', tokens: 3,
      symbolLines: [{ name: 'x', line: 1, endLine: 1, tokens: 3 }],
      summary: 'Exports x', mtimeMs: 0, skipped: false,
    }],
    dirs: [],
  }
  const first = await brain.syncAnatomy(map)
  assert.equal(first.changed, true)
  assert.equal(first.absorbed, false)
  // Same map → identical render → no rewrite (idempotent).
  const second = await brain.syncAnatomy(map)
  assert.equal(second.changed, false, 'identical render is a no-op')
  // Human edit: append a note, then resync → absorb additively.
  const anatomyPath = join(root, '.wolf/anatomy.md')
  const text = await readFile(anatomyPath, 'utf8')
  await writeFile(anatomyPath, `${text}\n## Human note\n\nkeep this\n`, 'utf8')
  const third = await brain.syncAnatomy({ ...map, scannedAt: Date.now() + 2 })
  assert.equal(third.absorbed, true)
  const final = await readFile(anatomyPath, 'utf8')
  assert.ok(final.includes('keep this'), 'human edit preserved')
  assert.ok(final.includes('Auto-generated index (updated)'), 'fresh index appended')
})
