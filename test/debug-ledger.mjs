// Reproduce the turn/end ledger path: mount the plugin, emit a turn/end
// session event, and check the ledger.
import { Context } from '@deepseek-ai/cordis'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import * as openwolf from '../lib/index.js'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const fixture = await mkdtemp(join(tmpdir(), 'openwolf-ledger-'))
await mkdir(join(fixture, 'src'), { recursive: true })

const app = new Context()
app.plugin(SystemPrompt)
app.plugin(ToolRuntime)
app.plugin(openwolf)
for (let i = 0; i < 100 && app.get('tools') === undefined; i++) {
  await new Promise((r) => setTimeout(r, 20))
}
console.log('tools mounted:', app.get('tools') !== undefined)

const fakeSession = {
  id: 'ledger-test-session',
  header: { cwd: fixture },
}

// assistant/message with provider usage (the web-session trigger).
app.emit('session/event', fakeSession, {
  type: 'assistant/message',
  data: {
    turn: 1,
    step: 1,
    message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }], id: 'm1', source: { kind: 'model', model: 'x' } },
    usage: { inputTokens: 1200, outputTokens: 300, cacheReadTokens: 4000, cacheWriteTokens: 200 },
  },
})
app.emit('session/event', fakeSession, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })

// Give async handlers time to settle.
await new Promise((r) => setTimeout(r, 500))

try {
  const ledger = JSON.parse(await readFile(join(fixture, '.wolf/token-ledger.json'), 'utf8'))
  console.log('ledger total_sessions:', ledger.lifetime.total_sessions)
  console.log('ledger sessions:', JSON.stringify(ledger.sessions))
  // assistant/message with usage → measured = 1200+300+4000+200 = 5700; turn/end (no usage) → falls back to meter (~0).
  const ok = ledger.lifetime.total_sessions === 1 && ledger.sessions[0]?.measured_tokens === 5700
  console.log(ok ? 'LEDGER (assistant/message usage) PATH: WORKS' : 'LEDGER PATH: FAILED')
} catch (e) {
  console.log('ledger read failed:', e.message)
}
await rm(fixture, { recursive: true, force: true })
process.exit(0)
