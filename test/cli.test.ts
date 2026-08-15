import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { main } from '../bin/wolf.mjs'
import { WolfBrain } from '../src/brain.ts'
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

test('cron add/list/run/remove round-trip', async () => {
  out = ''
  assert.equal(await main(['cron', 'add', 'nightly', '30 2 * * *', 'scan', dir], io), 0)
  assert.match(out, /added cron task/)
  out = ''
  assert.equal(await main(['cron', 'list', dir], io), 0)
  const listed = out
  assert.match(listed, /nightly/)
  const id = listed.match(/task-[a-z0-9]+/)?.[0] ?? ''
  assert.ok(id.length > 0, 'task id extracted')
  out = ''
  assert.equal(await main(['cron', 'run', id, dir], io), 0)
  assert.match(out, /ok/)
  out = ''
  assert.equal(await main(['cron', 'list', dir], io), 0)
  assert.match(out, /last .*ok/)
  assert.equal(await main(['cron', 'remove', id, dir], io), 0)
  out = ''
  assert.equal(await main(['cron', 'list', dir], io), 0)
  assert.match(out, /no cron tasks/)
})

test('cron add rejects invalid expressions', async () => {
  err = ''
  assert.equal(await main(['cron', 'add', 'bad', '99 99 * * *', 'scan', dir], io), 2)
  assert.match(err, /invalid cron/)
})

test('bug search finds logged bugs', async () => {
  const brain = new WolfBrain(dir, '.wolf')
  await brain.ensure()
  await brain.logBug('TypeError: boom', 'added guard')
  out = ''
  assert.equal(await main(['bug', 'search', 'boom', `--dir=${dir}`], io), 0)
  assert.match(out, /boom/)
})

test('register/update/backups/restore round-trip with a test registry', async () => {
  const reg = join(dir, '..', `reg-${Date.now()}.json`)
  const oldEnv = process.env.DSH_WOLF_REGISTRY
  process.env.DSH_WOLF_REGISTRY = reg
  try {
    out = ''
    assert.equal(await main(['register', dir], io), 0)
    out = ''
    assert.equal(await main(['update'], io), 0)
    assert.match(out, /scan .*files/)
    out = ''
    assert.equal(await main(['backups', dir], io), 0)
    const tag = out.trim().split('\n')[0] ?? ''
    assert.ok(tag.length > 0, 'backup tag listed')
    out = ''
    assert.equal(await main(['restore', tag, dir], io), 0)
    assert.match(out, /restored from/)
    assert.equal(await main(['unregister', dir], io), 0)
  } finally {
    if (oldEnv === undefined) delete process.env.DSH_WOLF_REGISTRY
    else process.env.DSH_WOLF_REGISTRY = oldEnv
    await rm(reg, { force: true })
  }
})

test('init creates OPENWOLF.md protocol', async () => {
  const protocol = await readFile(join(dir, '.wolf/OPENWOLF.md'), 'utf8')
  assert.match(protocol, /Operating Protocol/)
  assert.match(protocol, /wolf_bug/)
})
