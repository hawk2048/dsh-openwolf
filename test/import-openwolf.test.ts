import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { importOpenWolf } from '../src/import-openwolf.ts'
import { main } from '../bin/wolf.mjs'

const WOLF_CEREBRUM = `# OpenWolf Cerebrum

## Preferences
- Use TypeScript strict mode
- [2026-08-01] Prefer functional components

## Do-Not-Repeat
- never use \`any\` in shared code
`

const WOLF_MEMORY = `| 2026-08-01 10:00 | Edited src/app.ts | refactored auth | ~120 |
| 2026-08-02 09:30 | Created src/lib.ts | — | ~80 |
`

const WOLF_BUGLOG = {
  version: 1,
  bugs: [
    {
      id: 'bug-001',
      timestamp: '2026-08-01T10:00:00.000Z',
      error_message: 'Missing error handling in app',
      file: 'src/app.ts',
      root_cause: 'no try/catch',
      fix: 'Added try/catch',
      tags: ['auto-detected', 'error-handling', 'ts'],
      related_bugs: [],
      occurrences: 1,
      last_seen: '2026-08-01T10:00:00.000Z',
    },
    {
      id: 'bug-002',
      timestamp: '2026-08-02T11:00:00.000Z',
      error_message: 'Null access in lib',
      file: 'src/lib.ts',
      root_cause: 'optional chaining missing',
      fix: 'Added ?.',
      tags: ['auto-detected', 'null-safety', 'ts'],
      related_bugs: [],
      occurrences: 2,
      last_seen: '2026-08-02T11:00:00.000Z',
    },
  ],
}

const WOLF_STATUS = `# STATUS

## 🚀 Next phase
Implement the import command.

## ✅ Done
Set up CI.
`

let root = ''
let cleanup: () => Promise<void> = async () => {}

async function writeWolfBrain() {
  const wolf = join(root, '.wolf')
  await mkdir(wolf, { recursive: true })
  await writeFile(join(wolf, 'cerebrum.md'), WOLF_CEREBRUM)
  await writeFile(join(wolf, 'memory.md'), WOLF_MEMORY)
  await writeFile(join(wolf, 'buglog.json'), `${JSON.stringify(WOLF_BUGLOG, null, 2)}\n`)
  await writeFile(join(wolf, 'STATUS.md'), WOLF_STATUS)
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'openwolf-import-'))
  cleanup = () => rm(root, { recursive: true, force: true })
})

after(async () => {
  await cleanup()
})

test('import-openwolf merges cerebrum, memory, buglog and STATUS into a fresh brain', async () => {
  await writeWolfBrain()
  const report = await importOpenWolf(root)
  assert.equal(report.found, true)
  assert.equal(report.cerebrum.entries, 3, 'all three cerebrum entries imported')
  assert.equal(report.memory.rows, 2)
  assert.equal(report.bugs.added, 2)
  assert.equal(report.bugs.skipped, 0)
  assert.equal(report.status.action, 'imported')
  assert.ok(report.backup !== null, 'timestamped backup created')
  assert.deepEqual(report.changed.sort(), ['STATUS.md', 'buglog.json', 'cerebrum.md', 'memory.md'].sort())

  // cerebrum: source sections landed in the target file
  const cerebrum = await readFile(join(root, '.dshwolf/cerebrum.md'), 'utf8')
  assert.match(cerebrum, /## Preferences/)
  assert.match(cerebrum, /Use TypeScript strict mode/)
  assert.match(cerebrum, /never use `any` in shared code/)

  // memory: rows appended
  const memory = await readFile(join(root, '.dshwolf/memory.md'), 'utf8')
  assert.match(memory, /Edited src\/app\.ts/)
  assert.match(memory, /imported from \.wolf/)

  // buglog: OpenWolf records converted and carried over extra fields
  const buglog = JSON.parse(await readFile(join(root, '.dshwolf/buglog.json'), 'utf8'))
  assert.equal(buglog.bugs.length, 2)
  const imported = buglog.bugs.find((b: { error_message: string }) => b.error_message.includes('Missing error handling'))
  assert.ok(imported, 'first bug imported')
  assert.equal(imported.file, 'src/app.ts')
  assert.equal(imported.root_cause, 'no try/catch', 'OpenWolf-only field carried along')
  assert.ok(imported.at, 'at mapped from OpenWolf timestamp')

  // STATUS: fresh template replaced
  const status = await readFile(join(root, '.dshwolf/STATUS.md'), 'utf8')
  assert.match(status, /Implement the import command/)

  // backup directory exists
  const backups = await readdir(join(root, '.dshwolf-backups'))
  assert.equal(backups.length, 1)
})

test('import-openwolf is idempotent — a second run adds nothing', async () => {
  const report = await importOpenWolf(root)
  assert.equal(report.found, true)
  assert.equal(report.cerebrum.entries, 0)
  assert.equal(report.memory.rows, 0)
  assert.equal(report.bugs.added, 0)
  assert.equal(report.bugs.skipped, 2, 'both bugs recognized as duplicates')
  assert.equal(report.status.action, 'kept')
  assert.equal(report.changed.length, 0, 'nothing changes on re-import')
  // No second backup was taken.
  const backups = await readdir(join(root, '.dshwolf-backups'))
  assert.equal(backups.length, 1)
})

test('import-openwolf --dry-run writes nothing and reports no backup', async () => {
  // A second fresh workspace to observe a full dry-run.
  const fresh = join(root, 'fresh-dry')
  await mkdir(fresh, { recursive: true })
  await mkdir(join(fresh, '.wolf'), { recursive: true })
  await writeFile(join(fresh, '.wolf/cerebrum.md'), '## Conventions\n- always dry-run first\n')
  const report = await importOpenWolf(fresh, { dryRun: true })
  assert.equal(report.dryRun, true)
  assert.equal(report.cerebrum.entries, 1)
  assert.equal(report.backup, null)
  assert.deepEqual(report.changed, ['cerebrum.md'])
  await assert.rejects(() => readFile(join(fresh, '.dshwolf/cerebrum.md'), 'utf8').then(() => Promise.reject(new Error('missing'))), /missing/)
})

test('import-openwolf keeps an edited STATUS.md by default and honors --status=overwrite', async () => {
  const edited = join(root, 'edited-status')
  await mkdir(edited, { recursive: true })
  await mkdir(join(edited, '.wolf'), { recursive: true })
  await writeFile(join(edited, '.wolf/STATUS.md'), '# STATUS\n\n## 🚀 Next phase\nFrom OpenWolf.\n')
  // Make the target STATUS non-pristine.
  await mkdir(join(edited, '.dshwolf'), { recursive: true })
  await writeFile(join(edited, '.dshwolf/STATUS.md'), '# STATUS\n\n## 🚀 Next phase\nMy own handoff.\n')
  const report = await importOpenWolf(edited)
  assert.equal(report.status.action, 'kept')
  const status = await readFile(join(edited, '.dshwolf/STATUS.md'), 'utf8')
  assert.match(status, /My own handoff/, 'target content preserved')

  const forced = await importOpenWolf(edited, { status: 'overwrite' })
  assert.equal(forced.status.action, 'overwritten')
  const status2 = await readFile(join(edited, '.dshwolf/STATUS.md'), 'utf8')
  assert.match(status2, /From OpenWolf/, 'forced overwrite replaced the target')
})

test('import-openwolf reports missing source and skips with --status=skip', async () => {
  const bare = join(root, 'bare')
  await mkdir(bare, { recursive: true })
  const report = await importOpenWolf(bare)
  assert.equal(report.found, false)
  assert.equal(report.changed.length, 0)

  const skip = await importOpenWolf(root, { status: 'skip' })
  assert.equal(skip.status.action, 'skipped')
})

test('import-openwolf CLI prints a merge summary and exits 0; missing source exits 1', async () => {
  let out = ''
  let err = ''
  const io = {
    out: (s: string) => { out += `${s}\n` },
    err: (s: string) => { err += `${s}\n` },
  }
  // Fresh workspace with a .wolf brain, exercised through the CLI entry point.
  const cliRoot = join(root, 'cli')
  await mkdir(cliRoot, { recursive: true })
  await mkdir(join(cliRoot, '.wolf'), { recursive: true })
  await writeFile(join(cliRoot, '.wolf/buglog.json'), JSON.stringify({ version: 1, bugs: [{ error_message: 'CLI bug', fix: 'fixed', file: 'a.ts', timestamp: '2026-08-03T00:00:00.000Z' }] }))

  const code = await main(['import-openwolf', cliRoot], io)
  assert.equal(code, 0)
  assert.match(out, /import-openwolf:/)
  assert.match(out, /buglog\.json\s+\+1 bug/)
  assert.match(out, /backup:/)

  err = ''
  const missing = await main(['import-openwolf', join(cliRoot, 'nope')], io)
  assert.equal(missing, 1)
  assert.match(err, /no OpenWolf brain found/)
})
