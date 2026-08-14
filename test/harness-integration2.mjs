// Real cordis-runtime integration test for dsh-openwolf v0.2:
// brain tools, read/write interception, and session digest state.
import { Context } from '@deepseek-ai/cordis'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime, defineTool } from '@deepseek-ai/dsh-tools'
import { CallId } from '@deepseek-ai/dsh-llm'
import * as openwolf from '../lib/index.js'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const fixture = await mkdtemp(join(tmpdir(), 'openwolf-it2-'))
await mkdir(join(fixture, 'src'), { recursive: true })
await writeFile(join(fixture, 'src/index.ts'), 'export function main() {}\nexport const x = 1\n'.repeat(120))
await writeFile(join(fixture, 'README.md'), '# Fixture\n')

const app = new Context()
app.plugin(SystemPrompt)
app.plugin(ToolRuntime)
app.plugin(openwolf)

// Dummy read/write tools so the interception hooks have something to observe.
app.plugin({
  name: 'dummy-fs-tools',
  inject: ['tools'],
  apply(ctx) {
    ctx.tools.register(defineTool({
      name: 'read',
      description: 'dummy read',
      parameters: { file_path: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
      async execute(args) { return `content of ${args.file_path}` },
    }))
    ctx.tools.register(defineTool({
      name: 'write',
      description: 'dummy write',
      parameters: { file_path: { type: 'string', required: true }, content: { type: 'string' } },
      output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
      async execute(args) { return `wrote ${args.file_path}` },
    }))
  },
})

for (let i = 0; i < 100 && app.get('tools') === undefined; i++) {
  await new Promise((r) => setTimeout(r, 20))
}
const tools = app.get('tools')
if (tools === undefined) throw new Error('tools service missing')

const agent = { session: { header: { cwd: fixture } } }
const call = (name, arguments_) =>
  tools.execute({ callId: CallId(`it2-${name}-${Math.random().toString(36).slice(2)}`), name, arguments: arguments_ ?? {}, signal: new AbortController().signal, agent })

let pass = 0
const ok = (cond, label) => {
  if (!cond) throw new Error(`FAILED: ${label}`)
  pass++
  console.log(`ok ${pass} - ${label}`)
}

// 1. wolf_init creates the .wolf/ brain.
const init = await call('wolf_init', {})
ok(init.isError !== true, 'wolf_init succeeds')
const brainEntries = await readdir(join(fixture, '.wolf'))
ok(brainEntries.includes('STATUS.md') && brainEntries.includes('buglog.json'), 'brain files created')

// 2. wolf_status read + write round-trip.
const status = await call('wolf_status', { body: '# STATUS\n\n## 🚀 Next phase\n\nship the brain\n' })
ok(status.isError !== true && status.value?.changed === true, 'wolf_status writes')
const statusRead = await call('wolf_status', {})
ok(statusRead.value?.body.includes('ship the brain'), 'wolf_status reads back')

// 3. wolf_learn records cerebrum knowledge.
const learn = await call('wolf_learn', { section: 'Do-Not-Repeat', entry: 'never trust stale maps' })
ok(learn.isError !== true, 'wolf_learn succeeds')
const cerebrum = await readFile(join(fixture, '.wolf/cerebrum.md'), 'utf8')
ok(cerebrum.includes('never trust stale maps'), 'cerebrum updated')

// 4. wolf_bug logs and searches.
const bug = await call('wolf_bug', { error: 'ECONNREFUSED', fix: 'added retry' })
ok(bug.isError !== true && bug.value?.mode === 'logged', 'wolf_bug logs')
const search = await call('wolf_bug', { search: 'ECONNREFUSED' })
ok(search.value?.results?.length === 1, 'wolf_bug searches')

// 5. wolf_report reads the ledger.
const report = await call('wolf_report', {})
ok(report.isError !== true && typeof report.value?.totalSessions === 'number', 'wolf_report works')

// 6. wolf_map seeds the anatomy cache, then read interception attaches hints.
const map = await call('wolf_map', {})
ok(map.isError !== true, 'wolf_map seeds anatomy')
const read1 = await call('read', { file_path: 'src/index.ts' })
const hintText1 = (read1.additionalContexts ?? []).map((m) => m.content.map((b) => (b.type === 'text' ? b.text : '')).join('')).join('\n')
ok(read1.isError !== true, 'first read succeeds')
ok(hintText1.includes('anatomy:') && hintText1.includes('tok'), 'first read carries anatomy hint')
// Big file → symbol line-range hint.
ok(hintText1.includes('symbols:') && hintText1.includes('L'), 'big-file read carries symbol line hints')

// 7. Second read of the same file warns about repetition.
const read2 = await call('read', { file_path: 'src/index.ts' })
const hintText2 = (read2.additionalContexts ?? []).map((m) => m.content.map((b) => (b.type === 'text' ? b.text : '')).join('')).join('\n')
ok(hintText2.includes('already read this session'), 'repeated read warns')

// 8. Write interception logs to memory.md and tracks the session.
const write = await call('write', { file_path: 'src/new.ts', content: 'export const n = 1\n' })
ok(write.isError !== true, 'write succeeds')
const memory = await readFile(join(fixture, '.wolf/memory.md'), 'utf8')
ok(memory.includes('src/new.ts') || memory.includes('write'), 'memory.md logs the write')
const session = JSON.parse(await readFile(join(fixture, '.wolf/hooks/_session.json'), 'utf8'))
ok(session.files_written.some((w) => w.file === 'src/new.ts'), 'session tracks written file')

// 9. Secret files are never hinted.
const secret = await call('read', { file_path: '.env' })
ok(secret.isError !== true && (secret.additionalContexts ?? []).length === 0, 'secret reads carry no hints')

// 10. wolf_scan verifies index freshness (CI-friendly, read-only).
const scanFresh = await call('wolf_scan', {})
ok(scanFresh.isError !== true && scanFresh.value?.fresh === true, 'wolf_scan reports fresh index')
// Touch a file on disk → wolf_scan detects drift.
await writeFile(join(fixture, 'src/index.ts'), 'export function changed() {}\n')
const scanDrift = await call('wolf_scan', {})
ok(scanDrift.isError !== true && scanDrift.value?.fresh === false, 'wolf_scan detects drift after a file change')
ok(scanDrift.value?.drifted?.some((d) => d.path === 'src/index.ts'), 'drifted list names the changed file')

// 11. anatomy.md is maintained after wolf_refresh.
const refresh2 = await call('wolf_refresh', {})
ok(refresh2.isError !== true, 'wolf_refresh for anatomy sync')
const anatomy = await readFile(join(fixture, '.wolf/anatomy.md'), 'utf8')
ok(anatomy.includes('# Anatomy') && anatomy.includes('Files:'), 'anatomy.md rendered')

console.log(`\n${pass} integration assertions passed`)
await rm(fixture, { recursive: true, force: true })
process.exit(0)
