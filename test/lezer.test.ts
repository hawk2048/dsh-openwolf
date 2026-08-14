import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractSymbolsLezer } from '../src/lezer.ts'
import { scanCodebase } from '../src/scanner.ts'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ScanOptions } from '../src/types.ts'

const baseOpts: ScanOptions = {
  maxFiles: 500, maxFileBytes: 1 << 20, symbols: true, symbolBackend: 'auto',
  hidden: false, extraIgnore: ['node_modules'], useGitignore: true, sortBy: 'path',
}

test('lezer: ts golden (names, lines, end lines, tokens)', async () => {
  const src = [
    'export const version = "1.0.0"',
    'export function greet(who: string) {',
    '  return who',
    '}',
    'class Server {',
    '  listen() {}',
    '}',
    'export interface Config { port: number }',
    'export type Id = string',
    'export enum Mode { A }',
    '',
  ].join('\n')
  const hits = await extractSymbolsLezer(src, 'src/index.ts', 16)
  assert.deepEqual(
    hits.map((h) => ({ name: h.name, line: h.line, endLine: h.endLine })),
    [
      { name: 'version', line: 1, endLine: 1 },
      { name: 'greet', line: 2, endLine: 4 },
      { name: 'Server', line: 5, endLine: 7 },
      { name: 'Config', line: 8, endLine: 8 },
      { name: 'Id', line: 9, endLine: 9 },
      { name: 'Mode', line: 10, endLine: 10 },
    ],
  )
  assert.ok(hits.every((h) => h.tokens > 0), 'per-symbol token estimates present')
})

test('lezer: python / go / rust / java top-level declarations', async () => {
  const py = await extractSymbolsLezer('def fetch(url):\n    pass\n\nclass Handler:\n    pass\n', 'a.py', 16)
  assert.deepEqual(py.map((h) => h.name), ['fetch', 'Handler'])
  const go = await extractSymbolsLezer('package main\nfunc main() {}\nfunc (s *Server) Serve() {}\ntype Config struct { Port int }\n', 'a.go', 16)
  assert.deepEqual(go.map((h) => h.name), ['main', 'Serve', 'Config'])
  const rs = await extractSymbolsLezer('pub fn main() {}\npub struct Server {}\npub enum Mode {}\npub trait Handler {}\nimpl Server {}\n', 'a.rs', 16)
  assert.deepEqual(rs.map((h) => h.name), ['main', 'Server', 'Mode', 'Handler', 'Server'])
  const java = await extractSymbolsLezer('public class Main {\n}\ninterface Service {\n}\n', 'a.java', 16)
  assert.deepEqual(java.map((h) => h.name), ['Main', 'Service'])
})

test('lezer: no grammar for unsupported languages', async () => {
  const hits = await extractSymbolsLezer('def main(): pass\n', 'a.txt', 16)
  assert.deepEqual(hits, [])
})

test('backend parity: regex and lezer agree on clean fixtures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openwolf-parity-'))
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'src/index.ts'), [
    'export const version = "1"',
    'export function createApp() {}',
    'class Server {}',
    'export interface Config { port: number }',
    'export enum Mode { A }',
    '',
  ].join('\n'))
  await writeFile(join(root, 'src/main.py'), 'import os\ndef fetch():\n    pass\n\nclass Handler:\n    pass\n')
  await writeFile(join(root, 'src/main.go'), 'package main\nfunc main() {}\ntype Config struct {}\n')
  try {
    const lezerMap = await scanCodebase(root, baseOpts)
    const regexMap = await scanCodebase(root, { ...baseOpts, symbolBackend: 'regex' })
    const byPath = (map: typeof lezerMap) => new Map(map.files.map((f) => [f.path, f.symbols]))
    const lezer = byPath(lezerMap)
    const regex = byPath(regexMap)
    for (const [path, syms] of lezer) {
      assert.deepEqual(syms, regex.get(path), `parity for ${path}`)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
