// Real cordis-runtime integration test: mount system-prompt + tools +
// dsh-openwolf and drive the tools through the actual execution pipeline.
import { Context } from '@deepseek-ai/cordis'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime, TOOL_ABORTED } from '@deepseek-ai/dsh-tools'
import { CallId } from '@deepseek-ai/dsh-llm'
import * as openwolf from '../lib/index.js'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const fixture = await mkdtemp(join(tmpdir(), 'openwolf-it-'))
await mkdir(join(fixture, 'src'), { recursive: true })
await writeFile(join(fixture, 'src/index.ts'), 'export function main() {}\nexport const x = 1\n')
await writeFile(join(fixture, 'README.md'), '# Fixture\n')

const app = new Context()
app.plugin(SystemPrompt)
app.plugin(ToolRuntime)
app.plugin(openwolf)

// Cordis activates plugins asynchronously (PENDING → LOADING → ACTIVE).
for (let i = 0; i < 100 && app.get('tools') === undefined; i++) {
  await new Promise((r) => setTimeout(r, 20))
}
const tools = app.get('tools')
if (tools === undefined) throw new Error('tools service missing')

const agent = { session: { header: { cwd: fixture } } }
const signal = new AbortController().signal
const call = (name, arguments_) =>
  tools.execute({ callId: CallId(`it-${name}`), name, arguments: arguments_ ?? {}, signal, agent })

let pass = 0
const ok = (cond, label) => {
  if (!cond) throw new Error(`FAILED: ${label}`)
  pass++
  console.log(`ok ${pass} - ${label}`)
}

// 1. wolf_map returns a compact map for the fixture workspace.
const mapResult = await call('wolf_map', {})
ok(mapResult.isError !== true, 'wolf_map succeeds')
const mapText = mapResult.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
ok(mapText.includes('Code Map'), 'wolf_map text contains the map heading')
ok(mapText.includes('src/index.ts'), 'wolf_map lists src/index.ts')
ok(mapText.includes('main'), 'wolf_map shows the main symbol')

// 2. wolf_file returns a bounded digest.
const fileResult = await call('wolf_file', { path: 'src/index.ts', previewBytes: 256 })
ok(fileResult.isError !== true, 'wolf_file succeeds')
const fileValue = fileResult.value
ok(fileValue?.exists === true && fileValue.lang === 'ts', 'wolf_file digest metadata')
ok(Array.isArray(fileValue?.symbols) && fileValue.symbols.includes('main'), 'wolf_file symbols')
ok(typeof fileValue?.preview === 'string' && fileValue.preview.includes('export function main'), 'wolf_file preview')

// 3. wolf_file rejects traversal.
const escapeResult = await call('wolf_file', { path: '../evil.ts' })
ok(escapeResult.isError !== true && escapeResult.value?.exists === false, 'wolf_file rejects parent traversal')

// 4. wolf_refresh rescans and injects AGENTS.md.
const refreshResult = await call('wolf_refresh', {})
ok(refreshResult.isError !== true && refreshResult.value?.totalFiles === 2, 'wolf_refresh stats')
const agents = await readFile(join(fixture, 'AGENTS.md'), 'utf8')
ok(agents.includes('<!-- dsh-openwolf:start -->'), 'AGENTS.md contains the managed block')
ok(agents.includes('# Code Map'), 'AGENTS.md contains the code map')

// 5. Cancel is honored (abort before dispatch).
try {
  await tools.execute({ callId: CallId('it-abort'), name: 'wolf_map', arguments: {}, signal: AbortSignal.abort(), agent })
  ok(false, 'aborted call should throw')
} catch (err) {
  ok(String(err).includes('abort'), 'aborted call throws')
}

console.log(`\n${pass} integration assertions passed`)
await rm(fixture, { recursive: true, force: true })
process.exit(0)
