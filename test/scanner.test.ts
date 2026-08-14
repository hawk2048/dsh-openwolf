import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { scanCodebase, summarizeFile, resolveInside } from '../src/scanner.ts'
import type { ScanOptions } from '../src/types.ts'

const opts: ScanOptions = {
  maxFiles: 1000,
  maxFileBytes: 1 << 20,
  symbols: true,
  hidden: false,
  extraIgnore: ['node_modules', '*.log'],
  useGitignore: true,
  sortBy: 'path',
}

let root = ''
let cleanup: () => Promise<void> = async () => {}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'openwolf-test-'))
  cleanup = () => rm(root, { recursive: true, force: true })
  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(join(root, 'node_modules'), { recursive: true })
  await mkdir(join(root, '.hidden-dir'), { recursive: true })
  await writeFile(join(root, 'src/index.ts'), [
    'export const version = "1.0.0"',
    'export function createApp() { return {} }',
    'class Server {',
    '  async listen() {}',
    '}',
    '',
  ].join('\n'))
  await writeFile(join(root, 'src/server.go'), [
    'package main',
    'func main() {}',
    'type Config struct { Port int }',
    '',
  ].join('\n'))
  await writeFile(join(root, 'README.md'), '# Demo\n\nA tiny fixture project.\n')
  await writeFile(join(root, 'node_modules/dep.js'), 'module.exports = 1\n')
  await writeFile(join(root, '.hidden-dir/secret.txt'), 'hidden\n')
  await writeFile(join(root, 'debug.log'), 'log line\n')
  await writeFile(join(root, '.gitignore'), 'dist/\n*.log\n')
})

after(async () => {
  await cleanup()
})

test('scanCodebase builds a compact map with ignores applied', async () => {
  const map = await scanCodebase(root, opts)
  assert.equal(map.root, root)
  assert.equal(map.totalFiles, 3)
  const paths = map.files.map((f) => f.path)
  assert.deepEqual(paths, ['README.md', 'src/index.ts', 'src/server.go'])
  const index = map.files.find((f) => f.path === 'src/index.ts')!
  assert.equal(index.lang, 'ts')
  assert.equal(index.lines, 5)
  assert.deepEqual(index.symbols, ['createApp', 'Server', 'version'])
  // Language-aware description: exports summary replaces the bare first line.
  assert.equal(index.summary, 'Exports version, createApp')
  const readme = map.files.find((f) => f.path === 'README.md')!
  assert.equal(readme.lang, 'md')
  // dirs aggregates
  const srcDir = map.dirs.find((d) => d.path === 'src')!
  assert.equal(srcDir.files, 2)
  assert.ok(srcDir.lines >= 4)
})

test('scanCodebase honors maxFiles cap', async () => {
  const capped = await scanCodebase(root, { ...opts, maxFiles: 2 })
  assert.equal(capped.truncated, true)
  assert.equal(capped.files.length, 2)
  assert.ok(capped.skippedFiles >= 1)
})

test('scanCodebase includes hidden entries when hidden=true', async () => {
  const map = await scanCodebase(root, { ...opts, hidden: true })
  assert.ok(map.files.some((f) => f.path === '.hidden-dir/secret.txt'))
})

test('summarizeFile returns a bounded digest', async () => {
  const digest = await summarizeFile(root, 'src/index.ts', opts, 256)
  assert.equal(digest.exists, true)
  assert.equal(digest.lang, 'ts')
  assert.ok((digest.symbols ?? []).includes('createApp'))
  assert.ok((digest.preview ?? '').startsWith('export const'))
})

test('summarizeFile rejects traversal and missing files', async () => {
  assert.equal((await summarizeFile(root, '../outside.ts', opts)).exists, false)
  assert.equal((await summarizeFile(root, 'nope.ts', opts)).exists, false)
  assert.equal((await summarizeFile(root, 'C:\\evil.ts', opts)).exists, false)
})

test('resolveInside contains paths', () => {
  assert.equal(resolveInside(root, 'src/index.ts'), `${root}/src/index.ts`)
  assert.equal(resolveInside(root, '../x'), null)
  assert.equal(resolveInside(root, 'a/../../x'), null)
  assert.equal(resolveInside(root, 'C:\\abs.ts'), null)
  assert.equal(resolveInside(root, '/abs.ts'), null)
})
