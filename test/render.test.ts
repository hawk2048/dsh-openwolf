import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { scanCodebase } from '../src/scanner.ts'
import { renderMap, injectBlock, findBlock, WOLF_BLOCK_START, WOLF_BLOCK_END } from '../src/render.ts'
import type { ScanOptions } from '../src/types.ts'

const opts: ScanOptions = {
  maxFiles: 1000,
  maxFileBytes: 1 << 20,
  symbols: true,
  hidden: false,
  extraIgnore: ['node_modules'],
  useGitignore: true,
  sortBy: 'path',
}

let root = ''
let cleanup: () => Promise<void> = async () => {}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'openwolf-render-'))
  cleanup = () => rm(root, { recursive: true, force: true })
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'src/index.ts'), 'export function main() {}\n')
  await writeFile(join(root, 'src/util.ts'), 'export const util = 1\n')
  await writeFile(join(root, 'README.md'), '# Demo\n')
})

after(async () => {
  await cleanup()
})

test('renderMap produces grouped markdown with symbols', async () => {
  const map = await scanCodebase(root, opts)
  const { text, truncated } = renderMap(map, 65536)
  assert.equal(truncated, false)
  assert.match(text, /# Code Map/)
  assert.match(text, /## src/)
  assert.match(text, /`src\/index\.ts`/)
  assert.match(text, /main/)
})

test('renderMap truncates at the byte budget', async () => {
  const map = await scanCodebase(root, opts)
  const { text, truncated } = renderMap(map, 128)
  assert.equal(truncated, true)
  assert.ok(text.length <= 128 + 64)
})

test('injectBlock creates, replaces, and preserves AGENTS.md', async () => {
  const agents = join(root, 'AGENTS.md')
  const map = await scanCodebase(root, opts)

  const first = await injectBlock(agents, map, 4096)
  assert.equal(first.changed, true)
  const text1 = await readFile(agents, 'utf8')
  assert.ok(text1.includes(WOLF_BLOCK_START))
  assert.ok(text1.includes(WOLF_BLOCK_END))
  assert.ok(text1.includes('# Code Map'))

  // Idempotent: same map → no rewrite.
  const second = await injectBlock(agents, map, 4096)
  assert.equal(second.changed, false)

  // Preserves surrounding content on update.
  await writeFile(agents, `# Project\n\n${text1}\n\nCustom footer.\n`)
  const before = await readFile(agents, 'utf8')
  const updated = await injectBlock(agents, { ...map, scannedAt: map.scannedAt + 1000 }, 4096)
  assert.equal(updated.changed, true)
  const afterText = await readFile(agents, 'utf8')
  assert.ok(afterText.startsWith('# Project\n\n'))
  assert.ok(afterText.endsWith('\n\nCustom footer.\n'))
  assert.notEqual(afterText, before)
})

test('findBlock locates the managed block', () => {
  const text = `head\n${WOLF_BLOCK_START}\nmap\n${WOLF_BLOCK_END}\ntail\n`
  const found = findBlock(text)
  assert.ok(found !== null)
  assert.equal(found.before, 'head\n')
  assert.equal(found.after, 'tail\n')
  assert.equal(findBlock('no markers'), null)
})
