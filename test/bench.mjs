import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { scanCodebase, poolMap, analyzeFile } from '../lib/scanner.js'
import { currentGitHead } from '../lib/digest.js'

const opts = {
  maxFiles: 10000, maxFileBytes: 1 << 20, symbols: true, symbolBackend: 'auto',
  hidden: false, extraIgnore: ['node_modules', '.git'], useGitignore: true, sortBy: 'path',
}

// ── fixture: 200 TS files ───────────────────────────────────────────────
const root = await mkdtemp(join(tmpdir(), 'openwolf-bench-'))
await mkdir(join(root, 'src'), { recursive: true })
for (let i = 0; i < 200; i++) {
  const body = [
    `import { z } from 'zod'`,
    `export const name${i} = "v${i}"`,
    `export function fn${i}(input: string) {`,
    `  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')`,
    `}`,
    `export class Service${i} {`,
    `  private value = ${i}`,
    `  async run() { return this.value }`,
    `}`,
    `export interface Config${i} { port: number; host: string }`,
    `export const schema${i} = z.object({ name: z.string() })`,
    '',
  ].join('\n')
  await writeFile(join(root, `src/file${String(i).padStart(3, '0')}.ts`), body)
}
console.log('fixture: 200 files')

// ── measure: pooled scan (new, 8 workers) ──────────────────────────────
const t1 = Date.now()
const map = await scanCodebase(root, opts)
const pooledMs = Date.now() - t1
console.log(`pooled scan (8 workers): ${pooledMs}ms, ${map.totalFiles} files`)

// ── measure: sequential analysis (old behavior) ────────────────────────
const { readdir, stat } = await import('node:fs/promises')
const paths = []
const stack = [root]
while (stack.length) {
  const d = stack.pop()
  for (const e of await readdir(d, { withFileTypes: true })) {
    if (e.isDirectory()) stack.push(join(d, e.name))
    else if (e.isFile() && e.name.endsWith('.ts')) paths.push(join(d, e.name))
  }
}
const t2 = Date.now()
await poolMap(paths, 1, async (abs) => {
  const st = await stat(abs)
  await analyzeFile(abs, st.size, st.mtimeMs, opts)
})
const sequentialMs = Date.now() - t2
console.log(`sequential analysis (1 worker): ${sequentialMs}ms`)
console.log(`speedup: ${(sequentialMs / Math.max(1, pooledMs)).toFixed(2)}x`)

// ── measure: git HEAD TTL cache (20 calls) ─────────────────────────────
const gitRoot = await mkdtemp(join(tmpdir(), 'openwolf-gitbench-'))
const { execFile } = await import('node:child_process')
const { promisify } = await import('node:util')
const exec = promisify(execFile)
try {
  await exec('git', ['init', '-q'], { cwd: gitRoot })
  await writeFile(join(gitRoot, 'a.txt'), 'x')
  await exec('git', ['add', '-A'], { cwd: gitRoot })
  await exec('git', ['-c', 'user.name=bench', '-c', 'user.email=b@b', 'commit', '-qm', 'init'], { cwd: gitRoot })
  const t3 = Date.now()
  for (let i = 0; i < 20; i++) await currentGitHead(gitRoot)
  const cachedMs = Date.now() - t3
  console.log(`20 git HEAD lookups (TTL-cached): ${cachedMs}ms`)
} catch (e) {
  console.log('git bench skipped:', e.message)
}

await rm(root, { recursive: true, force: true })
await rm(gitRoot, { recursive: true, force: true })
process.exit(0)
