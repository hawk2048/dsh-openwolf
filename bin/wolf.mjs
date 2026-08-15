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
import { parseCron, dueTasks, nextMinuteDelay } from '../lib/cron.js'
import { listProjects, registerProject, unregisterProject, backupBrain, listBackups, restoreBrain } from '../lib/registry.js'
import { stat, readFile, writeFile, rm, mkdir, chmod, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, resolve, dirname } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

/** CLI-default scan options (mirror the plugin defaults). */
function scanOptions() {
  return {
    maxFiles: 4000,
    maxFileBytes: 65536,
    symbols: true,
    symbolBackend: 'auto',
    symbolThresholdTokens: 500,
    hidden: false,
    extraIgnore: ['node_modules', '.git', 'dist', 'build', 'coverage', '.venv', '__pycache__', '.next', '.cache', '.turbo', '.idea', '.vscode', 'target', 'out', '*.log', 'AGENTS.md', '.wolf'],
    useGitignore: true,
    sortBy: 'path',
  }
}

/** Resolve the target directory: `--dir=` flag wins, else the LAST non-flag arg. */
function resolveDir(argv) {
  const flagged = argv.find((a) => a.startsWith('--dir='))
  if (flagged !== undefined) return resolve(process.cwd(), flagged.slice(6))
  const positional = argv.filter((a) => !a.startsWith('-'))
  const last = positional.at(-1)
  return last !== undefined ? resolve(process.cwd(), last) : process.cwd()
}

const USAGE = `usage:
  wolf init [dir]             initialize .wolf/ brain
  wolf scan [dir]             rescan + pin state + render anatomy.md + inject AGENTS.md
  wolf scan --check [dir]     verify index vs filesystem (CI-friendly; exit 1 on drift)
  wolf status [dir]           brain health: config, scan state, ledger, memory/buglog
  wolf report [dir]           token ledger summary
  wolf bug search <term>      search the buglog
  wolf cron add <name> '<expr>' <scan|check> [dir]
  wolf cron list [dir]        list scheduled tasks
  wolf cron run <id> [dir]    run one task now
  wolf cron remove <id> [dir]
  wolf register [dir]         add workspace to the global registry
  wolf unregister [dir]       remove workspace from the registry
  wolf update                 backup + rescan every registered workspace
  wolf backups [dir]          list timestamped .wolf backups
  wolf restore [dir] [tag]    restore .wolf from a backup (newest by default)
  wolf dashboard [dir]        local dashboard server (--port, --token, --token-file)
  wolf daemon start [dir]     dashboard + cron scheduler as a background daemon
                              (--port, --token, --token-file)
  wolf daemon stop [dir]      stop the daemon
  wolf harness status         check which DSH profiles have dsh-openwolf wired
  wolf harness add [name]     wire dsh-openwolf into a DSH profile (default: web)`

/** Run one cron action against a workspace. */
async function runCronAction(dir, action, io) {
  const brain = new WolfBrain(dir, '.wolf')
  await brain.ensure()
  if (action === 'check') {
    const manifest = await brain.readScanManifest()
    if (manifest.files.length === 0) return { ok: false, detail: 'no manifest' }
    let drift = 0
    for (const entry of manifest.files) {
      try {
        const st = await stat(join(dir, entry.path))
        if (st.size !== entry.size || Math.abs(st.mtimeMs - entry.mtimeMs) >= 1) drift++
      } catch {
        drift++
      }
    }
    return { ok: drift === 0, detail: drift === 0 ? 'fresh' : `${drift} drifted` }
  }
  // scan
  const map = await scanCodebase(dir, scanOptions())
  await brain.writeScanState({
    last_scanned: new Date().toISOString(),
    git_head: (await currentGitHead(dir)) ?? undefined,
    total_files: map.totalFiles,
    total_lines: map.totalLines,
  })
  await brain.writeScanManifest(map.files.map((f) => ({ path: f.path, size: f.size, mtimeMs: f.mtimeMs ?? 0 })))
  await brain.syncAnatomy(map)
  await brain.writeAnatomyIndex(map)
  return { ok: true, detail: `${map.totalFiles} files` }
}

function flag(rest, name, fallback) {
  const hit = rest.find((a) => a.startsWith(`--${name}=`))
  return hit !== undefined ? hit.slice(name.length + 3) : fallback
}

/**
 * Resolve the dashboard auth token: `--token=` wins; else `--token-file=`
 * (read existing, or generate + persist so restarts reuse it); else generate
 * an ephemeral one. Returns { token, tokenFile } so callers that spawn a child
 * can hand over the file path instead of leaking the token on argv.
 */
export async function resolveToken(rest) {
  const explicit = flag(rest, 'token', '')
  if (explicit !== '') return { token: explicit, tokenFile: undefined }
  const tokenFile = flag(rest, 'token-file', '')
  if (tokenFile !== '') {
    let token = ''
    try {
      token = (await readFile(tokenFile, 'utf8')).trim()
    } catch {
      token = ''
    }
    if (token === '') {
      token = randomBytes(12).toString('hex')
      await mkdir(dirname(tokenFile), { recursive: true })
      await writeFile(tokenFile, token, 'utf8')
      try {
        await chmod(tokenFile, 0o600)
      } catch {
        // chmod is a no-op on some platforms; not fatal
      }
    }
    return { token, tokenFile }
  }
  return { token: randomBytes(12).toString('hex'), tokenFile: undefined }
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
        await brain.writeAnatomyIndex(map)
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
          if (sizeChanged || mtimeChanged) drift.push({ path: entry.path, sizeChanged, mtimeChanged })
        } catch {
          drift.push({ path: entry.path, sizeChanged: true, mtimeChanged: true })
        }
      }
      // Fresh scan to catch new files (the harness cache does this in memory).
      const fresh = await scanCodebase(dir, scanOptions())
      const freshPaths = new Set(fresh.files.map((f) => f.path))
      for (const p of freshPaths) {
        if (!seen.has(p)) drift.push({ path: p, sizeChanged: false, mtimeChanged: false })
      }
      const state = await brain.readScanState()
      const head = await currentGitHead(dir)
      const gitHeadMoved = state.git_head !== undefined && head !== null && state.git_head !== head
      if (gitHeadMoved) drift.push({ path: 'git HEAD', sizeChanged: false, mtimeChanged: false })
      if (rest.includes('--json')) {
        io.out(JSON.stringify({ dir, fresh: drift.length === 0, drifted: drift, gitHeadMoved }))
        return drift.length === 0 ? 0 : 1
      }
      if (drift.length === 0) {
        io.out('INDEX FRESH — manifest matches the filesystem')
        return 0
      }
      const stale = await anatomyStaleReason(brain, 6)
      io.err(`index drifted (${drift.length}):\n${drift.map((d) => `  - ${d.path}${d.sizeChanged ? ' (size)' : ''}${d.mtimeChanged ? ' (mtime)' : ''}`).join('\n')}${stale !== null ? `\n  ⚠ ${stale}` : ''}`)
      return 1
    }
    case 'status': {
      await brain.ensure()
      const config = await brain.readConfig()
      const state = await brain.readScanState()
      const ledger = await brain.readLedger()
      const buglog = await brain.readBuglog()
      if (rest.includes('--json')) {
        io.out(JSON.stringify({
          dir, digestBudget: config.openwolf.context.sessionDigestBudgetTokens,
          rescanHours: config.openwolf.anatomy.rescanIntervalHours,
          lastScanned: state.last_scanned ?? null, gitHead: state.git_head ?? null,
          totalFiles: state.total_files ?? 0, sessions: ledger.lifetime.total_sessions,
          bugs: buglog.bugs.length,
        }))
        return 0
      }
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
      if (rest.includes('--json')) {
        io.out(JSON.stringify({
          sessions: ledger.lifetime.total_sessions,
          measuredTokens: measured,
          recent: ledger.sessions.slice(-3).map((s) => ({ id: s.session_id.slice(0, 8), agent: s.agent ?? null, tokens: s.measured_tokens ?? 0 })),
        }))
        return 0
      }
      io.out(
        [
          `token ledger: ${ledger.lifetime.total_sessions} sessions`,
          measured > 0 ? `measured: ~${measured.toLocaleString()} tokens` : 'measured: none yet',
          ...ledger.sessions.slice(-3).map((s) => `  - ${s.session_id.slice(0, 8)} ${s.agent ?? ''} ~${(s.measured_tokens ?? 0).toLocaleString()} tok`),
        ].join('\n'),
      )
      return 0
    }
    case 'bug': {
      if (rest[0] !== 'search' || rest[1] === undefined) {
        io.err('usage: wolf bug search <term> [--dir=X]')
        return 2
      }
      // bug search has no positional dir (free-text terms); use --dir= or cwd.
      const searchDir = flag(rest, 'dir', process.cwd())
      const searchBrain = new WolfBrain(resolve(searchDir), '.wolf')
      await searchBrain.ensure()
      const term = rest.slice(1).filter((a) => !a.startsWith('-')).join(' ')
      const hits = await searchBrain.searchBugs(term)
      if (hits.length === 0) {
        io.out('no matching bugs')
        return 0
      }
      io.out(hits.map((b) => `- ${b.error_message} → ${b.fix}${b.file !== undefined ? ` (${b.file})` : ''}`).join('\n'))
      return 0
    }
    case 'cron': {
      const sub = rest[0]
      if (sub === 'add') {
        const [name, expr, action] = rest.slice(1)
        if (name === undefined || expr === undefined || (action !== 'scan' && action !== 'check')) {
          io.err("usage: wolf cron add <name> '<expr>' <scan|check>")
          return 2
        }
        try {
          parseCron(expr) // validate
        } catch (e) {
          io.err(`invalid cron: ${e instanceof Error ? e.message : e}`)
          return 2
        }
        await brain.ensure()
        const id = `task-${Date.now().toString(36)}`
        await brain.upsertCronTask({
          id, name, expr, action, enabled: true,
          created_at: new Date().toISOString(),
        })
        io.out(`added cron task ${id} (${name}: ${expr} → ${action})`)
        return 0
      }
      if (sub === 'list') {
        await brain.ensure()
        const tasks = await brain.readCronTasks()
        if (tasks.length === 0) {
          io.out('no cron tasks')
          return 0
        }
        io.out(tasks.map((t) => `- ${t.id} ${t.name} "${t.expr}" ${t.action} ${t.enabled ? 'enabled' : 'disabled'}${t.last_run !== undefined ? ` · last ${t.last_run.slice(0, 16)} ${t.last_status ?? ''}` : ''}`).join('\n'))
        return 0
      }
      if (sub === 'run') {
        const id = rest[1]
        if (id === undefined) {
          io.err('usage: wolf cron run <id>')
          return 2
        }
        await brain.ensure()
        const tasks = await brain.readCronTasks()
        const task = tasks.find((t) => t.id === id)
        if (task === undefined) {
          io.err(`no such task: ${id}`)
          return 1
        }
        const { ok, detail } = await runCronAction(dir, task.action, io)
        await brain.recordCronRun(id, ok ? 'ok' : 'error', detail)
        io.out(`task ${id} (${task.name}) ${ok ? 'ok' : 'FAILED'}: ${detail ?? ''}`)
        return ok ? 0 : 1
      }
      if (sub === 'remove') {
        const id = rest[1]
        if (id === undefined) {
          io.err('usage: wolf cron remove <id>')
          return 2
        }
        await brain.ensure()
        return (await brain.removeCronTask(id)) ? (io.out(`removed ${id}`), 0) : (io.err(`no such task: ${id}`), 1)
      }
      io.err('usage: wolf cron add|list|run|remove')
      return 2
    }
    case 'register': {
      await registerProject(dir)
      io.out(`registered ${dir}`)
      return 0
    }
    case 'unregister': {
      return (await unregisterProject(dir)) ? (io.out(`unregistered ${dir}`), 0) : (io.err('not registered'), 1)
    }
    case 'update': {
      const projects = await listProjects()
      if (projects.length === 0) {
        io.err('no registered projects — run `wolf register <dir>` first')
        return 1
      }
      let failed = 0
      for (const p of projects) {
        try {
          const backup = await backupBrain(p.dir)
          const result = await runCronAction(p.dir, 'scan', io)
          io.out(`✓ ${p.name} — scan ${result.detail} (backup: ${backup})`)
        } catch (e) {
          failed++
          io.err(`✗ ${p.name} — ${e instanceof Error ? e.message : e}`)
        }
      }
      return failed === 0 ? 0 : 1
    }
    case 'backups': {
      const backups = await listBackups(dir)
      io.out(backups.length === 0 ? 'no backups' : backups.join('\n'))
      return 0
    }
    case 'restore': {
      // `wolf restore [tag] [dir]` — tag is the first positional, dir the last.
      const tag = rest.find((a) => !a.startsWith('-'))
      const tagDir = rest.length > 1 ? resolveDir(rest) : process.cwd()
      try {
        const done = await restoreBrain(tagDir, tag)
        io.out(done)
        return 0
      } catch (e) {
        io.err(e instanceof Error ? e.message : String(e))
        return 1
      }
    }
    case 'serve': {
      // dashboard + cron scheduler loop (used by `daemon start`).
      await brain.ensure()
      const { token } = await resolveToken(rest)
      const port = Number(flag(rest, 'port', '3310'))
      const server = await startDashboard({ brain, token, port })
      io.out(`dashboard: ${server.url}/?token=${token}`)
      const running = new Set()
      const runDue = async () => {
        const tasks = await brain.readCronTasks()
        for (const task of dueTasks(tasks, new Date())) {
          if (running.has(task.id)) continue // never overlap a long run
          running.add(task.id)
          try {
            const { ok, detail } = await runCronAction(dir, task.action, io)
            await brain.recordCronRun(task.id, ok ? 'ok' : 'error', detail)
          } catch (e) {
            await brain.recordCronRun(task.id, 'error', e instanceof Error ? e.message : String(e))
          } finally {
            running.delete(task.id)
          }
        }
      }
      await runDue()
      // Minute-anchored wake: compute the exact delay to the next minute
      // boundary so `dueTasks` never misses a window and never double-runs.
      const arm = () => {
        const tick = setTimeout(() => { void runDue().finally(arm) }, nextMinuteDelay())
        tick.unref?.()
      }
      arm()
      await new Promise(() => {})
      return 0
    }
    case 'dashboard': {
      await brain.ensure()
      const { token } = await resolveToken(rest)
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
        const { token, tokenFile } = await resolveToken(restAfter)
        const port = Number(flag(restAfter, 'port', '3310'))
        const childArgs = [fileURLToPath(import.meta.url), 'serve', daemonDir, `--port=${port}`]
        if (tokenFile !== undefined) {
          childArgs.push(`--token-file=${tokenFile}`)
        } else {
          childArgs.push(`--token=${token}`)
        }
        const child = spawn(process.execPath, childArgs, { detached: true, stdio: 'ignore' })
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
    case 'harness': {
      // `wolf harness status|add [name]` — detect DSH profiles and wire the
      // plugin into one. Mirrors OpenWolf's `openwolf init` "auto-wire" step:
      // DSH is the agent platform itself, so wiring = editing the profile's
      // package.json (dependencies + bundles) instead of installing hook files.
      const action = rest[0] ?? 'status'
      // Env-overridable for tests: DSH_WOLF_PROFILES_DIR.
      const profilesDir =
        process.env.DSH_WOLF_PROFILES_DIR !== undefined
          ? resolve(process.env.DSH_WOLF_PROFILES_DIR)
          : join(homedir(), '.dsh', 'profiles')
      if (action === 'status') {
        let names = []
        try {
          names = (await readdir(profilesDir, { withFileTypes: true }))
            .filter((e) => e.isDirectory() && existsSync(join(profilesDir, e.name, 'package.json')))
            .map((e) => e.name)
            .sort()
        } catch {
          io.err(`no DSH profiles dir at ${profilesDir}`)
          return 1
        }
        if (names.length === 0) {
          io.out('no DSH profiles found')
          return 0
        }
        for (const name of names) {
          const pkgPath = join(profilesDir, name, 'package.json')
          let wired = false
          try {
            const doc = JSON.parse(await readFile(pkgPath, 'utf8'))
            const deps = doc.dependencies ?? {}
            const bundles = doc.dsh?.profile?.bundles ?? []
            wired = deps['dsh-openwolf'] !== undefined && bundles.includes('dsh-openwolf')
          } catch {
            wired = false
          }
          io.out(`${wired ? '✔' : '·'} ${name}${wired ? '' : '  (dsh-openwolf not wired)'}`)
        }
        return 0
      }
      if (action === 'add') {
        const profileName = rest.slice(1).find((a) => !a.startsWith('-')) ?? 'web'
        const pkgPath = join(profilesDir, profileName, 'package.json')
        if (!existsSync(pkgPath)) {
          io.err(`no profile '${profileName}' at ${pkgPath}`)
          return 1
        }
        // Pin the version this CLI ships with (same package, so it matches).
        const ownVersion = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version
        const doc = JSON.parse(await readFile(pkgPath, 'utf8'))
        doc.dependencies = doc.dependencies ?? {}
        doc.dependencies['dsh-openwolf'] = ownVersion
        doc.dsh = doc.dsh ?? { profile: { bundles: [] } }
        doc.dsh.profile = doc.dsh.profile ?? { bundles: [] }
        if (!doc.dsh.profile.bundles.includes('dsh-openwolf')) doc.dsh.profile.bundles.push('dsh-openwolf')
        await writeFile(pkgPath, JSON.stringify(doc, null, 2) + '\n', 'utf8')
        io.out(`wired dsh-openwolf@${ownVersion} into profile '${profileName}'`)
        io.out(`next: cd ${join(profilesDir, profileName)} && pnpm install, then restart the harness`)
        return 0
      }
      io.err('usage: wolf harness status | wolf harness add [profile-name]')
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
