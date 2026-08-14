import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectLang, extractSymbols, firstMeaningfulLine, isBinary } from '../src/symbols.ts'

test('detectLang by extension', () => {
  assert.equal(detectLang('src/index.ts'), 'ts')
  assert.equal(detectLang('main.py'), 'py')
  assert.equal(detectLang('main.go'), 'go')
  assert.equal(detectLang('lib.rs'), 'rs')
  assert.equal(detectLang('README.md'), 'md')
  assert.equal(detectLang('Makefile'), 'text')
})

test('extractSymbols: typescript', () => {
  const src = `
import { z } from 'zod'
export const name = 'demo'
export function greet(who: string) { return \`hi \${who}\` }
class DemoServer {
  async listen() {}
}
export interface DemoConfig { port: number }
`
  const symbols = extractSymbols(src, 'ts', 16)
  assert.deepEqual(symbols, ['greet', 'DemoServer', 'name', 'DemoConfig'])
})

test('extractSymbols: python', () => {
  const src = `
"""module docstring"""
import os
async def fetch(url): ...
def helper(): ...
class Handler: ...
`
  const symbols = extractSymbols(src, 'py', 16)
  assert.deepEqual(symbols, ['fetch', 'helper', 'Handler'])
})

test('extractSymbols: go', () => {
  const src = `
package main
func main() {}
func (s *Server) Serve() {}
type Config struct { Port int }
`
  const symbols = extractSymbols(src, 'go', 16)
  assert.deepEqual(symbols, ['main', 'Serve', 'Config'])
})

test('extractSymbols: control keywords are not symbols (c-like)', () => {
  const src = `
int main(void) {
  if (x > 0) { return 1; }
  for (;;) { break; }
}
static int helper(int a) { return a; }
`
  const symbols = extractSymbols(src, 'c', 16)
  assert.deepEqual(symbols, ['main', 'helper'])
})

test('extractSymbols respects the max bound', () => {
  const src = Array.from({ length: 30 }, (_, i) => `export const v${i} = ${i}`).join('\n')
  const symbols = extractSymbols(src, 'ts', 8)
  assert.equal(symbols.length, 8)
})

test('firstMeaningfulLine skips comments/imports/blanks', () => {
  const src = `
// header comment
# shebang
import x from 'y'

export function main() {}
`
  assert.equal(firstMeaningfulLine(src, 140), 'export function main() {}')
  assert.equal(firstMeaningfulLine('   \n\n', 140), '')
  assert.equal(firstMeaningfulLine('a'.repeat(200), 10), 'aaaaaaaaaa…')
})

test('isBinary sniffs NUL bytes', () => {
  assert.equal(isBinary(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), false)
  assert.equal(isBinary(new Uint8Array([0x50, 0x4b, 0x00, 0x03])), true)
})
