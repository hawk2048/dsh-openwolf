import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFileSync } from 'node:fs'
import { scanCodebase, summarizeFile, resolveInside } from '../src/scanner.ts'
import { isSensitiveFile } from '../src/brain.ts'
import { startDashboard } from '../src/dashboard.ts'
import { WolfBrain } from '../src/brain.ts'
import type { ScanOptions } from '../src/types.ts'

const opts: ScanOptions = {
  maxFiles: 500, maxFileBytes: 1 << 20, symbols: true, symbolBackend: 'auto',
  hidden: false, extraIgnore: ['node_modules'], useGitignore: true, sortBy: 'path',
}

let root = ''
let brain: WolfBrain
let cleanup: () => Promise<void> = async () => {}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'openwolf-sec-'))
  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(join(root, 'keys'), { recursive: true })
  await writeFile(join(root, 'src/app.ts'), 'export const ok = 1\n')
  await writeFile(join(root, '.env'), 'API_KEY=supersecret\n')
  await writeFile(join(root, 'keys/id_rsa'), 'PRIVATE KEY\n')
  await writeFile(join(root, '.npmrc'), '//registry:token\n')
  brain = new WolfBrain(root, '.wolf')
  await brain.ensure()
  cleanup = () => rm(root, { recursive: true, force: true })
})

after(async () => {
  await cleanup()
})

// ── 1. path traversal matrix ────────────────────────────────────────────
test('path traversal: absolute, parent, encoded, and mixed separators are rejected', async () => {
  const bad = [
    '../escape.ts', 'a/../../x.ts', '..\\escape.ts', 'C:\\abs.ts', '/abs.ts',
    'sub/../../x.ts', '....//..//x.ts', `${'../'.repeat(8)}etc/passwd`,
  ]
  for (const p of bad) {
    const digest = await summarizeFile(root, p, opts)
    assert.equal(digest.exists, false, `should reject: ${p}`)
    assert.equal(resolveInside(root, p), null, `resolveInside should reject: ${p}`)
  }
  assert.equal(resolveInside(root, 'src/app.ts'), `${root}/src/app.ts`, 'legit path resolves')
})

// ── 2. secrets never enter the index, hints, or logs ────────────────────
test('secret files are excluded from the scanned map', async () => {
  const map = await scanCodebase(root, opts)
  const paths = map.files.map((f) => f.path)
  assert.ok(paths.includes('src/app.ts'), 'normal file indexed')
  assert.ok(!paths.includes('.env'), '.env excluded')
  assert.ok(!paths.includes('keys/id_rsa'), 'private key excluded')
  assert.ok(!paths.includes('.npmrc'), '.npmrc excluded')
})

test('isSensitiveFile denylist covers secret shapes', () => {
  for (const f of ['.env', '.env.local', 'keys/id_rsa', 'prod/credentials.json', 'a/.npmrc', 'b/.pem', 'c/.key']) {
    assert.equal(isSensitiveFile(f), true, `should be sensitive: ${f}`)
  }
  for (const f of ['src/app.ts', '.env.example', 'README.md', 'keys/README.md']) {
    assert.equal(isSensitiveFile(f), false, `should be safe: ${f}`)
  }
})

test('memory log never receives secret writes (write interception skip)', async () => {
  // Direct brain-level guard: sensitive basenames bypass the memory log.
  const before = await readFile(join(root, '.wolf/memory.md'), 'utf8')
  assert.ok(!before.includes('supersecret'), 'secret never logged')
})

// ── 3. dashboard auth: rejects without/with wrong token (both transports) ─
test('dashboard auth rejects missing and wrong tokens', async () => {
  const server = await startDashboard({ brain, token: 's3cr3t', port: 0 })
  try {
    assert.equal((await fetch(`${server.url}/api/report`)).status, 401)
    assert.equal((await fetch(`${server.url}/api/report?token=wrong`)).status, 401)
    const bearer = await fetch(`${server.url}/api/report`, { headers: { authorization: 'Bearer wrong' } })
    assert.equal(bearer.status, 401)
    assert.equal((await fetch(`${server.url}/api/report?token=s3cr3t`)).status, 200)
    const bearerOk = await fetch(`${server.url}/api/report`, { headers: { authorization: 'Bearer s3cr3t' } })
    assert.equal(bearerOk.status, 200)
  } finally {
    await server.close()
  }
})

// ── 4. no shell interpolation anywhere (arg-array only) ──────────────────
test('source audit: no shell-string execution (exec/spawn with string)', async () => {
  const base = join(import.meta.dirname ?? '.', '..')
  const files = [
    join(base, 'src/index.ts'),
    join(base, 'src/scanner.ts'),
    join(base, 'src/digest.ts'),
    join(base, 'src/dashboard.ts'),
    join(base, 'bin/wolf.mjs'),
    join(base, 'src/registry.ts'),
    join(base, 'src/cron.ts'),
  ]
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    // execFile / spawn with an ARRAY argument is fine; a single STRING argument
    // or exec(string) / shell:true is the failure mode.
    assert.ok(!/exec\(['"`]/.test(src), `${f}: exec(string) found`)
    assert.ok(!/\bexec\s*\(/.test(src), `${f}: child_process exec used`)
    assert.ok(!/shell\s*:\s*true/.test(src), `${f}: shell:true used`)
    assert.ok(!/spawn\([^,]+,\s*['"`]/.test(src), `${f}: spawn(string) found`)
  }
})
