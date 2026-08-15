import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { WolfBrain } from '../src/brain.ts'
import { extractSection, buildSessionDigest, anatomyStaleReason, buildSessionDigestWithWarning } from '../src/digest.ts'

let root = ''
let brain: WolfBrain
let cleanup: () => Promise<void> = async () => {}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'openwolf-digest-'))
  brain = new WolfBrain(root, '.dshwolf')
  await brain.ensure()
  cleanup = () => rm(root, { recursive: true, force: true })
})

after(async () => {
  await cleanup()
})

test('extractSection grabs one ## heading block', () => {
  const md = '## 🚀 Next phase\n\nfinish the port\n\n## ✅ Done\n\nthings\n'
  assert.equal(extractSection(md, /^## 🚀/), '## 🚀 Next phase\n\nfinish the port')
  assert.equal(extractSection('no heading', /^## 🚀/), '')
})

test('buildSessionDigest includes STATUS, Do-Not-Repeat, bugs, anatomy pointer', async () => {
  await brain.writeStatus('# STATUS\n\n## 🚀 Next phase\n\nship v0.2\n\n## ✅ Done\n')
  await brain.appendCerebrum('Do-Not-Repeat', 'do not rm -rf dist')
  await brain.logBug('segfault on init', 'added null check')
  await brain.writeScanState({ last_scanned: new Date().toISOString(), total_files: 7 })
  const digest = await buildSessionDigest(brain, 2000)
  assert.match(digest, /🚀 Next phase/)
  assert.match(digest, /ship v0.2/)
  assert.match(digest, /Do-Not-Repeat/)
  assert.match(digest, /do not rm -rf dist/)
  assert.match(digest, /Known bugs already fixed/)
  assert.match(digest, /tracks 7 files/)
})

test('buildSessionDigest respects the budget: low budget keeps only the top section', async () => {
  const r2 = await mkdtemp(join(tmpdir(), 'openwolf-digest-budget-'))
  const b2 = new WolfBrain(r2, '.dshwolf')
  await b2.ensure()
  try {
    await b2.writeStatus('# STATUS\n\n## 🚀 Next phase\n\n' + 'x'.repeat(6000) + '\n')
    // 6000 chars ≈ 1400 tokens > 300 budget → section must be dropped entirely.
    const small = await buildSessionDigest(b2, 50)
    assert.equal(small, '')
    // 2000 budget admits the section.
    const large = await buildSessionDigest(b2, 2000)
    assert.ok(extractSection(large, /^## 🚀/) !== '')
  } finally {
    await rm(r2, { recursive: true, force: true })
  }
})

test('anatomyStaleReason: age-based staleness', async () => {
  await brain.writeScanState({ last_scanned: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(), git_head: 'abc' })
  const reason = await anatomyStaleReason(brain, 6)
  assert.ok(reason !== null && /12h/.test(reason))
  await brain.writeScanState({ last_scanned: new Date().toISOString(), git_head: 'abc' })
  assert.equal(await anatomyStaleReason(brain, 6), null)
  await brain.writeScanState({})
  assert.equal(await anatomyStaleReason(brain, 6), null)
})

test('buildSessionDigestWithWarning prepends the staleness warning', async () => {
  await brain.writeStatus('# STATUS\n\n## 🚀 Next phase\n\nsmall\n')
  await brain.writeScanState({ last_scanned: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), git_head: 'abc' })
  const digest = await buildSessionDigestWithWarning(brain, 2000, 6)
  assert.match(digest, /anatomy may be stale/)
  assert.match(digest, /Next phase/)
})

test('buildSessionDigest honors a caller-supplied estimator', async () => {
  await brain.writeStatus('# STATUS\n\n## 🚀 Next phase\n\n' + 'y'.repeat(40) + '\n')
  // A tiny budget by any estimate admits nothing.
  const tight = await buildSessionDigest(brain, 50, (text) => text.length)
  assert.equal(tight, '')
  // Char-ratio (~4 chars/token) admits the 40-char section within 100 tokens…
  const loose = await buildSessionDigest(brain, 100)
  assert.match(loose, /Next phase/)
  // …but a greedy estimator that prices every char as 10 tokens drops it.
  const greedy = await buildSessionDigest(brain, 100, (text) => text.length * 10)
  assert.equal(greedy, '')
})

test('buildSessionDigestWithWarning passes the estimator through', async () => {
  await brain.writeStatus('# STATUS\n\n## 🚀 Next phase\n\nsmall\n')
  await brain.writeScanState({ last_scanned: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), git_head: 'abc' })
  // Greedy estimator: the section does not fit the budget; only the
  // (unbudgeted) staleness warning remains.
  const digest = await buildSessionDigestWithWarning(brain, 100, 6, (text) => text.length * 10)
  assert.match(digest, /anatomy may be stale/)
  assert.doesNotMatch(digest, /Next phase/)
})
