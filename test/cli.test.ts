import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { main } from '../bin/wolf.mjs'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let dir = ''
let out = ''
let err = ''
const io = {
  out: (s) => { out += `${s}\n` },
  err: (s) => { err += `${s}\n` },
}

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'openwolf-cli-'))
  await mkdir(join(dir, 'src'), { recursive: true })
  await writeFile(join(dir, 'src/app.ts'), 'export function app() { return 1 }\n')
  await writeFile(join(dir, 'README.md'), '# cli fixture\n')
})

after(async () => {
  await rm(dir, { recursive: true, force: true })
})

test('wolf init creates the brain', async () => {
  out = ''
  const code = await main(['init', dir], io)
  assert.equal(code, 0)
  assert.match(out, /brain initialized/)
  await assert.rejects(() => readFile(join(dir, '.wolf/config.json'), 'utf8').then(() => Promise.reject(new Error('missing'))), /missing/)
})

test('wolf scan builds the index and pins state', async () => {
  out = ''
  const code = await main(['scan', dir], io)
  assert.equal(code, 0)
  assert.match(out, /scanned 2 files/)
  const state = JSON.parse(await readFile(join(dir, '.wolf/hooks/_scan-state.json'), 'utf8'))
  assert.equal(state.total_files, 2)
  const anatomy = await readFile(join(dir, '.wolf/anatomy.md'), 'utf8')
  assert.match(anatomy, /src\/app\.ts/)
})

test('wolf scan --check is fresh, then detects drift after edits', async () => {
  out = ''
  let code = await main(['scan', '--check', dir], io)
  assert.equal(code, 0)
  assert.match(out, /INDEX FRESH/)
  await writeFile(join(dir, 'src/app.ts'), 'export function app() { return 2 }\n// changed\n')
  out = ''
  err = ''
  code = await main(['scan', '--check', dir], io)
  assert.equal(code, 1, 'drift exits 1 (CI-friendly)')
  assert.match(err, /index drifted/)
  assert.match(err, /src\/app\.ts/)
})

test('wolf status and report are healthy', async () => {
  out = ''
  assert.equal(await main(['status', dir], io), 0)
  assert.match(out, /digestBudget=1500/)
  out = ''
  assert.equal(await main(['report', dir], io), 0)
  assert.match(out, /token ledger: 0 sessions/)
})

test('unknown command prints usage and exits 2', async () => {
  out = ''
  err = ''
  assert.equal(await main(['frobnicate'], io), 2)
  assert.match(err, /usage:/)
})
