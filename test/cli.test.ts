import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { main, resolveToken } from '../bin/wolf.mjs'
import { WolfBrain } from '../src/brain.ts'
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises'
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

test('dshwolf init creates the brain', async () => {
  out = ''
  const code = await main(['init', dir], io)
  assert.equal(code, 0)
  assert.match(out, /brain initialized/)
  await assert.rejects(() => readFile(join(dir, '.wolf/config.json'), 'utf8').then(() => Promise.reject(new Error('missing'))), /missing/)
})

test('dshwolf scan builds the index and pins state', async () => {
  out = ''
  const code = await main(['scan', dir], io)
  assert.equal(code, 0)
  assert.match(out, /scanned 2 files/)
  const state = JSON.parse(await readFile(join(dir, '.wolf/hooks/_scan-state.json'), 'utf8'))
  assert.equal(state.total_files, 2)
  const anatomy = await readFile(join(dir, '.wolf/anatomy.md'), 'utf8')
  assert.match(anatomy, /src\/app\.ts/)
})

test('dshwolf scan --check is fresh, then detects drift after edits', async () => {
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

test('dshwolf status and report are healthy', async () => {
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

test('--help / -h / bare invocation print grouped usage and exit 0', async () => {
  for (const args of [['--help'], ['-h'], []]) {
    out = ''
    err = ''
    assert.equal(await main(args, io), 0)
    assert.match(out, /usage: dshwolf <command>/)
    assert.match(out, /Brain lifecycle/)
    assert.match(out, /Memory & bugs/)
    assert.match(out, /Scheduling & serving/)
    assert.match(out, /Registry & backups/)
    assert.match(out, /Harness wiring/)
    assert.match(out, /--version/)
  }
})

test('--version prints the package version and exits 0', async () => {
  out = ''
  assert.equal(await main(['--version'], io), 0)
  assert.match(out, /dshwolf \d+\.\d+\.\d+ \(dsh-openwolf\)/)
})

test('subcommand help: cron/daemon/bug/harness --help and bare invocation', async () => {
  const cases: Array<[string[], RegExp]> = [
    [['cron', '--help'], /usage: dshwolf cron <add\|list\|run\|remove>/],
    [['cron', '-h'], /usage: dshwolf cron/],
    [['cron'], /usage: dshwolf cron/],
    [['daemon', '--help'], /usage: dshwolf daemon <start\|stop>/],
    [['daemon'], /usage: dshwolf daemon/],
    [['bug', '--help'], /usage: dshwolf bug search/],
    [['bug'], /usage: dshwolf bug search/],
    [['harness', '--help'], /usage: dshwolf harness <status\|add>/],
    [['harness', '-h'], /usage: dshwolf harness/],
  ]
  for (const [args, re] of cases) {
    out = ''
    err = ''
    assert.equal(await main(args, io), 0, `${args.join(' ')} exits 0`)
    assert.match(out, re, `${args.join(' ')} shows subcommand usage`)
  }
})

test('top-level help points at subcommand help', async () => {
  out = ''
  assert.equal(await main(['--help'], io), 0)
  assert.match(out, /dshwolf <command> --help/)
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

test('resolveToken: --token wins over a token file', async () => {
  const f = join(dir, 'token-win.txt')
  await writeFile(f, 'file-token', 'utf8')
  const r = await resolveToken(['--token=explicit', `--token-file=${f}`])
  assert.equal(r.token, 'explicit')
  assert.equal(r.tokenFile, undefined)
})

test('resolveToken: reads an existing token file', async () => {
  const f = join(dir, 'token-read.txt')
  await writeFile(f, 'persisted-token', 'utf8')
  const r = await resolveToken([`--token-file=${f}`])
  assert.equal(r.token, 'persisted-token')
  assert.equal(r.tokenFile, f)
})

test('resolveToken: creates a token file when missing and reuses it later', async () => {
  const f = join(dir, 'token-create.txt')
  const r1 = await resolveToken([`--token-file=${f}`])
  assert.ok(r1.token.length >= 20, 'generated a hex token')
  assert.equal(r1.tokenFile, f)
  const onDisk = (await readFile(f, 'utf8')).trim()
  assert.equal(onDisk, r1.token)
  const r2 = await resolveToken([`--token-file=${f}`])
  assert.equal(r2.token, r1.token, 'second call reuses the persisted token')
})

test('resolveToken: regenerates an empty token file', async () => {
  const f = join(dir, 'token-empty.txt')
  await writeFile(f, '   \n', 'utf8')
  const r = await resolveToken([`--token-file=${f}`])
  assert.ok(r.token.length >= 20)
  assert.equal((await readFile(f, 'utf8')).trim(), r.token)
  const st = await stat(f)
  assert.ok(st.size > 0)
})

test('resolveToken: ephemeral random token with no flags', async () => {
  const a = await resolveToken([])
  const b = await resolveToken([])
  assert.ok(a.token.length >= 20)
  assert.notEqual(a.token, b.token)
  assert.equal(a.tokenFile, undefined)
})

test('dshwolf harness status lists profiles and wiring', async () => {
  const profiles = await mkdtemp(join(tmpdir(), 'openwolf-profiles-'))
  await mkdir(join(profiles, 'web'), { recursive: true })
  await mkdir(join(profiles, 'headless'), { recursive: true })
  await writeFile(join(profiles, 'web/package.json'), JSON.stringify({
    name: 'dsh-profile-web', private: true,
    dependencies: { 'dsh-openwolf': '0.8.5' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-openwolf'] } },
  }))
  await writeFile(join(profiles, 'headless/package.json'), JSON.stringify({
    name: 'dsh-profile-headless', private: true,
    dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
  }))
  const oldEnv = process.env.DSH_WOLF_PROFILES_DIR
  process.env.DSH_WOLF_PROFILES_DIR = profiles
  try {
    out = ''
    assert.equal(await main(['harness', 'status'], io), 0)
    assert.match(out, /✔ web/)
    assert.match(out, /· headless.*not wired/)
  } finally {
    if (oldEnv === undefined) delete process.env.DSH_WOLF_PROFILES_DIR
    else process.env.DSH_WOLF_PROFILES_DIR = oldEnv
    await rm(profiles, { recursive: true, force: true })
  }
})

test('dshwolf harness add wires the plugin into a profile', async () => {
  const profiles = await mkdtemp(join(tmpdir(), 'openwolf-profiles-add-'))
  await mkdir(join(profiles, 'cli'), { recursive: true })
  await writeFile(join(profiles, 'cli/package.json'), JSON.stringify({
    name: 'dsh-profile-cli', private: true,
    dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
  }))
  const oldEnv = process.env.DSH_WOLF_PROFILES_DIR
  process.env.DSH_WOLF_PROFILES_DIR = profiles
  try {
    out = ''
    assert.equal(await main(['harness', 'add', 'cli'], io), 0)
    assert.match(out, /wired dsh-openwolf@/)
    const doc = JSON.parse(await readFile(join(profiles, 'cli/package.json'), 'utf8'))
    assert.ok(doc.dependencies['dsh-openwolf'], 'dependency added')
    assert.ok(doc.dsh.profile.bundles.includes('dsh-openwolf'), 'bundle registered')
    assert.ok(!doc.dsh.profile.bundles.includes('dsh-openwolf') === false, 'no duplicate bundle')
    // Idempotent: a second add does not duplicate the bundle entry.
    out = ''
    assert.equal(await main(['harness', 'add', 'cli'], io), 0)
    const doc2 = JSON.parse(await readFile(join(profiles, 'cli/package.json'), 'utf8'))
    assert.equal(doc2.dsh.profile.bundles.filter((b) => b === 'dsh-openwolf').length, 1)
  } finally {
    if (oldEnv === undefined) delete process.env.DSH_WOLF_PROFILES_DIR
    else process.env.DSH_WOLF_PROFILES_DIR = oldEnv
    await rm(profiles, { recursive: true, force: true })
  }
})

test('dshwolf harness add rejects an unknown profile', async () => {
  const profiles = await mkdtemp(join(tmpdir(), 'openwolf-profiles-bad-'))
  const oldEnv = process.env.DSH_WOLF_PROFILES_DIR
  process.env.DSH_WOLF_PROFILES_DIR = profiles
  try {
    err = ''
    assert.equal(await main(['harness', 'add', 'nope'], io), 1)
    assert.match(err, /no profile 'nope'/)
  } finally {
    if (oldEnv === undefined) delete process.env.DSH_WOLF_PROFILES_DIR
    else process.env.DSH_WOLF_PROFILES_DIR = oldEnv
    await rm(profiles, { recursive: true, force: true })
  }
})
