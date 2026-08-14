import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeFile, describeText } from '../src/description.ts'

test('ts/js: exports summary', () => {
  const text = [
    "import { z } from 'zod'",
    'export const version = "1.0.0"',
    'export function createApp() {}',
    'export class Server {}',
    'export interface Config { port: number }',
    'export default createApp',
  ].join('\n')
  const desc = describeText(text, 'src/index.ts')
  assert.ok(desc !== null && desc.startsWith('Exports version, createApp, Server, Config'), desc ?? '')
  assert.match(desc ?? '', /default createApp/)
})

test('ts/js: http route detection beats exports', () => {
  const text = [
    "import { Router } from 'express'",
    'const router = Router()',
    "router.get('/api/users', listUsers)",
    "router.post('/api/users', createUser)",
    "router.delete('/api/users/:id', deleteUser)",
    'export default router',
  ].join('\n')
  const desc = describeText(text, 'src/routes/users.ts')
  assert.ok(desc !== null && desc.startsWith('Defines GET /api/users, POST /api/users'), desc ?? '')
})

test('ts/js: zod schema detection', () => {
  const text = "export const UserSchema = z.object({ name: z.string() })\n"
  const desc = describeText(text, 'src/schemas/user.ts')
  assert.match(desc ?? '', /zod schema/)
})

test('python: docstring and counts', () => {
  const py = '"""Resolve the auth flow for the API."""\nimport os\n\ndef login():\n    pass\n\nclass AuthProvider:\n    pass\n'
  assert.equal(describeFile(py, 'auth.py'), 'Resolve the auth flow for the API.')
  const bare = 'def a():\n    pass\ndef b():\n    pass\n'
  assert.equal(describeFile(bare, 'util.py'), '2 functions')
})

test('go: package + handler summary', () => {
  const go = 'package server\n\nfunc (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {}\n'
  assert.match(describeFile(go, 'server.go'), /package server/)
  assert.match(describeFile(go, 'server.go'), /HTTP handler/)
})

test('json: name/description metadata', () => {
  assert.equal(describeFile('{"name": "dsh-openwolf", "description": "A code map brain"}', 'package.json'), 'A code map brain')
  assert.equal(describeFile('{"name": "dsh-openwolf"}', 'package.json'), 'dsh-openwolf')
})

test('fallback: first meaningful line for plain files', () => {
  const text = '// header\n# comment\n\nconst VALUE = 42\n'
  assert.equal(describeFile(text, 'unknown.xyz'), 'const VALUE = 42')
  assert.equal(describeFile('', 'a.txt'), '')
})
