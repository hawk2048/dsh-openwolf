#!/usr/bin/env node
/**
 * dsh-openwolf standalone CLI — `wolf init | scan | scan --check | status |
 * report [dir]`. Works without a running harness by reusing the library
 * (scanner/brain/render/digest). Importable for tests: `main(argv, io)`.
 */
import { WolfBrain } from '../lib/brain.js'
import { scanCodebase } from '../lib/scanner.js'
import { injectBlock } from '../lib/render.js'
import { currentGitHead, anatomyStaleReason } from '../lib/digest.js'
import { startDashboard } from '../lib/dashboard.js'
import { stat, readFile, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

/** CLI-default scan options (mirror the plugin defaults). */
function scanOptions() {
  return {
    maxFiles: 4000,
    maxFileBytes: 65536,
    symbols: true,
    symbolBackend: 'auto',
    hidden: false,
    extraIgnore: ['node_modules', '.git', 'dist', 'build', 'coverage', '.venv', '__pycache__', '.next', '.cache', '.turbo', '.idea', '.vscode', 'target', 'out', '*.log', 'AGENTS.md', '.wolf'],
    useGitignore: true,
    sortBy: 'path',
  }
}

/** Resolve the target directory from argv (first non-flag arg) or cwd. */
function resolveDir(argv) {
  const arg = argv.find((a) => !a.startsWith('-'))
  return arg !== undefined ? resolve(process.cwd(), arg) : process.cwd()
}

const USAGE = `usage:
  wolf init [dir]             initialize .wolf/ brain
  wolf scan [dir]             rescan + pin state + render anatomy.md + inject AGENTS.md
  wolf scan --check [dir]     verify index vs filesystem (CI-friendly; exit 1 on drift)
  wolf status [dir]           brain health: config, scan state, ledger, memory/buglog
  wolf report [dir]           token ledger summary
  wolf dashboard [dir]        local dashboard server (--port, --token)
  wolf daemon start [dir]     dashboard as a background daemon (--port, --token)
  wolf daemon stop [dir]      stop the daemon`

function flag(rest, name, fallback) {
  const hit = rest.find((a) => a.startsWith(`--${name}=`))
  return hit !== undefined ? hit.slice(name.length + 3) : fallback
}

/** Run the CLI. Returns the process exit code. */
export async function main(argv = [], io = { out: console.log, err: console.error }) {
  const [cmd, ...rest] = argv
  const dir = resolveDir(rest)
  const brain = new WolfBrain(dir, '.wolf')

  switch (cmd) {
    case 'init': {
      await brain.ensure()
      io.out(`brain initialized at ${join(dir, '.wolf')}`)
      return 0
    }
    case 'scan': {
      const check = rest.includes('--check')
      await brain.ensure()
      if (!check) {
        const map = await scanCodebase(dir, scanOptions())
        await brain.writeScanState({
          last_scanned: new Date().toISOString(),
          git_head: (await currentGitHead(dir)) ?? undefined,
          total_files: map.totalFiles,
          total_lines: map.totalLines,
        })
        await brain.writeScanManifest(map.files.map((f) => ({ path: f.path, size: f.size, mtimeMs: f.mtimeMs ?? 0 })))
        await brain.syncAnatomy(map)
        const injected = await injectBlock(join(dir, 'AGENTS.md'), map, 16384)
        io.out(`scanned ${map.totalFiles} files · ${map.totalLines} lines${injected.changed ? ' · AGENTS.md updated' : ''}`)
        return 0
      }
      // --check: compare the persisted manifest against the filesystem.
      const manifest = await brain.readScanManifest()
      if (manifest.files.length === 0) {
        io.err('no scan manifest found — run `wolf scan` first')
        return 1
      }
      const drift = []
      const seen = new Set()
      for (const entry of manifest.files) {
        seen.add(entry.path)
        try {
          const st = await stat(join(dir, entry.path))
          const sizeChanged = st.size !== entry.size
          const mtimeChanged = Math.abs(st.mtimeMs - entry.mtimeMs) >= 1
          if (sizeChanged || mtimeChanged) drift.push(`${entry.path}${sizeChanged ? ' (size)' : ''}${mtimeChanged ? ' (mtime)' : ''}`)
        } catch {
          drift.push(`${entry.path} (missing)`)
        }
      }
      // Fresh scan to catch new files (the harness cache does this in memory).
      const fresh = await scanCodebase(dir, scanOptions())
      const freshPaths = new Set(fresh.files.map((f) => f.path))
      for (const p of freshPaths) {
        if (!seen.has(p)) drift.push(`${p} (new)`)
      }
      const state = await brain.readScanState()
      const head = await currentGitHead(dir)
      if (state.git_head !== undefined && head !== null && state.git_head !== head) {
        drift.push('git HEAD moved since last scan')
      }
      if (drift.length === 0) {
        io.out('INDEX FRESH — manifest matches the filesystem')
        return 0
      }
      const stale = await anatomyStaleReason(brain, 6)
      io.err(`index drifted (${drift.length}):\n${drift.map((d) => `  - ${d}`).join('\n')}${stale !== null ? `\n  ⚠ ${stale}` : ''}`)
      return 1
    }
    case 'status': {
      await brain.ensure()
      const config = await brain.readConfig()
      const state = await brain.readScanState()
      const ledger = await brain.readLedger()
      const buglog = await brain.readBuglog()
      io.out(
        [
          `brain: ${join(dir, '.wolf')}`,
          `config: digestBudget=${config.openwolf.context.sessionDigestBudgetTokens} · rescan=${config.openwolf.anatomy.rescanIntervalHours}h`,
          `scan: ${state.last_scanned ?? 'never'}${state.git_head !== undefined ? ` · HEAD ${state.git_head.slice(0, 8)}` : ''} · ${state.total_files ?? 0} files`,
          `ledger: ${ledger.lifetime.total_sessions} sessions`,
          `memory: tracked · buglog: ${buglog.bugs.length} bugs`,
        ].join('\n'),
      )
      return 0
    }
    case 'report': {
      await brain.ensure()
      const ledger = await brain.readLedger()
      const measured = ledger.sessions.reduce((s, x) => s + (x.measured_tokens ?? 0), 0)
      io.out(
        [
          `token ledger: ${ledger.lifetime.total_sessions} sessions`,
          measured > 0 ? `measured: ~${measured.toLocaleString()} tokens` : 'measured: none yet',
          ...ledger.sessions.slice(-3).map((s) => `  - ${s.session_id.slice(0, 8)} ${s.agent ?? ''} ~${(s.measured_tokens ?? 0).toLocaleString()} tok`),
        ].join('\n'),
      )
      return 0
    }
    case 'dashboard': {
      await brain.ensure()
      const token = flag(rest, 'token', randomBytes(12).toString('hex'))
      const port = Number(flag(rest, 'port', '3310'))
      const server = await startDashboard({ brain, token, port })
      io.out(`dashboard: ${server.url}/?token=${token}`)
      await new Promise(() => {}) // server keeps the process alive
      return 0
    }
    case 'daemon': {
      const action = rest[0]
      // daemon's layout is `daemon <start|stop> [dir]` — the dir follows the action.
      const restAfter = rest.slice(1)
      const daemonDir = resolveDir(restAfter)
      const daemonBrain = new WolfBrain(daemonDir, '.wolf')
      const pidPath = join(daemonDir, '.wolf/daemon.pid')
      if (action === 'start') {
        if (existsSync(pidPath)) {
          io.err('daemon already running (see ' + pidPath + ')')
          return 1
        }
        await daemonBrain.ensure()
        const token = flag(restAfter, 'token', randomBytes(12).toString('hex'))
        const port = Number(flag(restAfter, 'port', '3310'))
        const child = spawn(
          process.execPath,
          [fileURLToPath(import.meta.url), 'dashboard', daemonDir, `--port=${port}`, `--token=${token}`],
          { detached: true, stdio: 'ignore' },
        )
        child.unref()
        await writeFile(pidPath, String(child.pid), 'utf8')
        io.out(`daemon started (pid ${child.pid}) — dashboard: http://127.0.0.1:${port}/?token=${token}`)
        return 0
      }
      if (action === 'stop') {
        try {
          const pid = Number((await readFile(pidPath, 'utf8')).trim())
          process.kill(pid, 'SIGTERM')
          await rm(pidPath, { force: true })
          io.out(`daemon stopped (pid ${pid})`)
          return 0
        } catch {
          io.err('no daemon running')
          return 1
        }
      }
      io.err('usage: wolf daemon start|stop')
      return 2
    }
    default:
      io.err(USAGE)
      return 2
  }
}

// Run as a binary only when executed directly (not when imported by tests).
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2))
}
