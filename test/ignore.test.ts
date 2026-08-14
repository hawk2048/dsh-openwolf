import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isIgnored, parseGitignore, compilePatterns } from '../src/ignore.ts'

const base = { extraRules: compilePatterns([]), gitignore: [], hidden: false }

test('always ignores .git at any depth', () => {
  assert.equal(isIgnored('.git', true, base), true)
  assert.equal(isIgnored('sub/.git', true, base), true)
})

test('hidden entries are ignored when hidden=false', () => {
  assert.equal(isIgnored('.env', false, base), true)
  assert.equal(isIgnored('src/.cache', true, base), true)
  assert.equal(isIgnored('.env', false, { ...base, hidden: true }), false)
})

test('extra patterns match basenames at any depth', () => {
  const ctx = { ...base, extraRules: compilePatterns(['node_modules', '*.log']) }
  assert.equal(isIgnored('node_modules', true, ctx), true)
  assert.equal(isIgnored('a/b/node_modules', true, ctx), true)
  assert.equal(isIgnored('debug.log', false, ctx), true)
  assert.equal(isIgnored('logs/app.log', false, ctx), true)
  assert.equal(isIgnored('src/index.ts', false, ctx), false)
})

test('anchored patterns match full relative paths (and their contents)', () => {
  const ctx = { ...base, extraRules: compilePatterns(['dist/', 'src/generated/']) }
  assert.equal(isIgnored('dist', true, ctx), true)
  assert.equal(isIgnored('src/generated', true, ctx), true)
  assert.equal(isIgnored('src/generated/types.ts', false, ctx), true)
  assert.equal(isIgnored('dist/bundle.js', false, ctx), true)
  assert.equal(isIgnored('src/index.ts', false, ctx), false)
  // 'dist/' has no leading slash: gitignore matches it at any depth.
  assert.equal(isIgnored('other/dist/bundle.js', false, ctx), true)
})

test('gitignore subset: negation, wildcards, comments', () => {
  const rules = parseGitignore([
    '# comment',
    '',
    '*.log',
    '!keep.log',
    'build/',
    '**/temp/**',
    '/anchored.txt',
  ].join('\n'))
  const ctx = { ...base, gitignore: rules }
  assert.equal(isIgnored('a.log', false, ctx), true)
  assert.equal(isIgnored('keep.log', false, ctx), false)
  assert.equal(isIgnored('build', true, ctx), true)
  assert.equal(isIgnored('x/y/temp/z.txt', false, ctx), true)
  assert.equal(isIgnored('anchored.txt', false, ctx), true)
  // /anchored.txt is anchored to the root: a nested file with the same name
  // must NOT match.
  assert.equal(isIgnored('sub/anchored.txt', false, ctx), false)
  assert.equal(isIgnored('readme.md', false, ctx), false)
})
