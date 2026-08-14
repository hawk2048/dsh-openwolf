/**
 * The `.wolf/` brain directory: a durable, per-workspace store of context
 * state that survives sessions — session digests, learned preferences,
 * action logs, bug memory, and token accounting. Independent implementation
 * of the OpenWolf `.wolf/` concept for DeepSeek Harness (MIT; the reference
 * is AGPL-3.0 and is used only as a behavioral spec).
 *
 * Layout under the workspace root:
 *
 * ```
 * .wolf/
 * ├── config.json          # budgets, rescan interval, thresholds
 * ├── STATUS.md            # end-of-phase handoff (## 🚀 next phase section)
 * ├── cerebrum.md          # learned preferences + Do-Not-Repeat list
 * ├── memory.md            # chronological action log (append-only)
 * ├── buglog.json          # searchable bug-fix memory
 * ├── token-ledger.json    # per-session/per-agent estimated usage
 * ├── hooks/_session.json  # in-flight session state (read/write tracking)
 * ├── hooks/_scan-state.json   # anatomy scan freshness (git HEAD pin)
 * └── hooks/_precompact-snapshot.json  # compaction survival snapshot
 * ```
 *
 * @module dsh-openwolf/brain
 */

import { mkdir, readFile, writeFile, rename, readdir, unlink, stat, rm } from 'node:fs/promises'
import { join, dirname, basename } from 'node:path'

/** Default brain configuration (independent default values). */
export interface BrainConfig {
  openwolf: {
    context: {
      /** Cap on the session digest in tokens. */
      sessionDigestBudgetTokens: number
      /** Per-agent budgets, keyed by agent name; falls back to the default. */
      budgets?: Record<string, number>
    }
    anatomy: {
      /** Scan freshness window before a staleness warning. */
      rescanIntervalHours: number
      /** Files above this estimated token count get symbol-level hints. */
      symbolThresholdTokens: number
    }
    dashboard?: {
      port?: number
      token?: string
    }
  }
}

/** Defaults, matching the behavioral spec of the reference implementation. */
export const DEFAULT_CONFIG: BrainConfig = {
  openwolf: {
    context: {
      sessionDigestBudgetTokens: 1500,
    },
    anatomy: {
      rescanIntervalHours: 6,
      symbolThresholdTokens: 500,
    },
  },
}

/** In-flight session state tracked by the read/write interception. */
export interface SessionState {
  session_id: string
  started: string
  files_read: Record<string, { count: number; tokens: number; first_read: string }>
  files_written: Array<{ file: string; at: string }>
  edit_counts: Record<string, number>
  anatomy_hits: number
  anatomy_misses: number
  repeated_reads_warned: number
  cerebrum_warnings: number
}

/** Scan freshness state (git HEAD pin + last summary). */
export interface ScanState {
  last_scanned?: string
  git_head?: string
  total_files?: number
  total_lines?: number
}

/** Ledger shape (estimated fields kept for backward compat). */
export interface Ledger {
  version: number
  lifetime: { total_sessions: number }
  sessions: Array<{ session_id: string; agent?: string; measured_tokens?: number; estimated_tokens?: number; at: string }>
}

const DEFAULT_LEDGER: Ledger = { version: 1, lifetime: { total_sessions: 0 }, sessions: [] }

/** One bug-fix record in the buglog. */
export interface BugRecord {
  id: string
  error_message: string
  fix: string
  file?: string
  at: string
}

/** Buglog shape. */
export interface Buglog {
  version: number
  bugs: BugRecord[]
}

/** Sensitive file names/extensions that must never enter the index or logs. */
const SENSITIVE_EXTENSIONS = new Set([
  '.env', '.pem', '.key', '.p12', '.pfx', '.jks', '.keystore', '.asc', '.gpg',
  '.pwd', '.secret', '.token', '.credentials',
])
const SENSITIVE_BASENAMES = new Set([
  '.npmrc', '.netrc', '.htpasswd', '.pgpass', '.env', 'id_rsa', 'id_ed25519',
  'credentials.json', 'service-account.json', 'secrets.yaml', 'secrets.yml',
])

/** True when a file basename should never be indexed or logged. */
export function isSensitiveFile(filePath: string): boolean {
  const name = basename(filePath)
  if (SENSITIVE_BASENAMES.has(name)) return true
  const ext = name.includes('.') ? `.${name.split('.').pop() ?? ''}`.toLowerCase() : ''
  return SENSITIVE_EXTENSIONS.has(ext)
}

/** Simple token estimate: ~4 chars per token (heuristic, ±15%). */
export function estimateTokens(text: string, type: 'code' | 'prose' | 'mixed' = 'mixed'): number {
  const perToken = type === 'prose' ? 4.2 : type === 'code' ? 3.8 : 4.0
  return Math.max(1, Math.ceil(text.length / perToken))
}

/**
 * The brain for one workspace. All mutations are atomic (write tmp + rename)
 * so concurrent hook fires cannot corrupt state. Synchronous paths mirror the
 * reference behavior; I/O is async but each call is small.
 */
export class WolfBrain {
  readonly root: string
  readonly dir: string

  constructor(root: string, dirName = '.wolf') {
    this.root = root
    this.dir = join(root, dirName)
  }

  /** Create the brain directory and default files if missing (race-safe). */
  async ensure(): Promise<void> {
    await mkdir(join(this.dir, 'hooks'), { recursive: true })
    await this.withLock(async () => {
      for (const file of ['STATUS.md', 'cerebrum.md', 'memory.md']) {
        const p = join(this.dir, file)
        try {
          await stat(p)
        } catch {
          await this.writeText(p, this.defaultMarkdown(file))
        }
      }
      for (const [file, data] of [
        ['config.json', DEFAULT_CONFIG],
        ['buglog.json', { version: 1, bugs: [] }],
        ['token-ledger.json', { version: 1, lifetime: { total_sessions: 0 }, sessions: [] }],
      ] as const) {
        try {
          await stat(join(this.dir, file))
        } catch {
          await this.writeJSON(join(this.dir, file), data)
        }
      }
    })
  }

  private defaultMarkdown(file: string): string {
    if (file === 'STATUS.md') {
      return `# STATUS\n\n## 🚀 Next phase\n\n_Describe the next phase here; the session digest picks up this section._\n\n## ✅ Done\n\n## 🧭 Notes\n`
    }
    if (file === 'cerebrum.md') {
      return `# Cerebrum\n\nLearned preferences, project conventions, and corrections.\n\n## Preferences\n\n## Conventions\n\n## Do-Not-Repeat\n\n`
    }
    return `# Memory\n\nChronological action log.\n\n| Time | Action | File(s) | Outcome | ~Tokens |\n|------|--------|---------|---------|--------|\n`
  }

  // ── config ────────────────────────────────────────────────────────────

  async readConfig(): Promise<BrainConfig> {
    return this.readJSON<BrainConfig>(join(this.dir, 'config.json'), DEFAULT_CONFIG)
  }

  async writeConfig(config: BrainConfig): Promise<void> {
    await this.writeJSON(join(this.dir, 'config.json'), config)
  }

  /** The session-digest budget for an agent name (falls back to default). */
  async digestBudget(agent?: string): Promise<number> {
    const cfg = await this.readConfig()
    const ctx = cfg.openwolf.context
    const budget = agent !== undefined ? ctx.budgets?.[agent] : undefined
    return budget ?? ctx.sessionDigestBudgetTokens ?? DEFAULT_CONFIG.openwolf.context.sessionDigestBudgetTokens
  }

  // ── STATUS / cerebrum / memory ────────────────────────────────────────

  async readText(p: string): Promise<string> {
    try {
      return await readFile(p, 'utf8')
    } catch {
      return ''
    }
  }

  private async writeText(p: string, text: string): Promise<void> {
    await mkdir(dirname(p), { recursive: true })
    // Unique temp name per call: concurrent writers never clobber each other's
    // in-flight temp before rename.
    const tmp = `${p}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
    await writeFile(tmp, text, 'utf8')
    await rename(tmp, p)
  }

  private async writeJSON(p: string, data: unknown): Promise<void> {
    await this.writeText(p, `${JSON.stringify(data, null, 2)}\n`)
  }

  private async readJSON<T>(p: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(await readFile(p, 'utf8')) as T
    } catch {
      return fallback
    }
  }

  async readStatus(): Promise<string> {
    return this.readText(join(this.dir, 'STATUS.md'))
  }

  async writeStatus(markdown: string): Promise<void> {
    await this.writeText(join(this.dir, 'STATUS.md'), markdown)
  }

  async readCerebrum(): Promise<string> {
    return this.readText(join(this.dir, 'cerebrum.md'))
  }

  async appendCerebrum(section: string, entry: string): Promise<void> {
    await this.withLock(async () => {
      const text = await this.readCerebrum()
      const marker = `## ${section}`
      const line = `- ${entry.replace(/\r?\n/g, ' ')}`
      if (text.includes(marker)) {
        // Insert right after the heading's first blank line.
        const idx = text.indexOf(marker)
        const afterHeading = text.indexOf('\n', idx)
        const insertAt = text.indexOf('\n\n', afterHeading) === -1 ? text.length : text.indexOf('\n\n', afterHeading) + 2
        await this.writeText(join(this.dir, 'cerebrum.md'), `${text.slice(0, insertAt)}${line}\n${text.slice(insertAt)}`)
      } else {
        await this.writeText(join(this.dir, 'cerebrum.md'), `${text.trimEnd()}\n\n${marker}\n\n${line}\n`)
      }
    })
  }

  async appendMemory(action: string, files: string[], outcome = 'ok', tokens = 0): Promise<void> {
    await this.withLock(async () => {
      const now = new Date()
      const stamp = `${now.toISOString().slice(0, 10)} ${now.toTimeString().slice(0, 5)}`
      const filesCell = files.slice(0, 4).join(', ') + (files.length > 4 ? ` +${files.length - 4}` : '')
      const row = `| ${stamp} | ${action.replace(/\|/g, '\\|')} | \`${filesCell}\` | ${outcome} | ${tokens} |\n`
      await this.writeText(join(this.dir, 'memory.md'), `${(await this.readText(join(this.dir, 'memory.md'))).trimEnd()}\n${row}`)
    })
  }

  // ── buglog ────────────────────────────────────────────────────────────

  async readBuglog(): Promise<Buglog> {
    return this.readJSON<Buglog>(join(this.dir, 'buglog.json'), { version: 1, bugs: [] })
  }

  async logBug(errorMessage: string, fix: string, file?: string): Promise<BugRecord> {
    return this.withLock(async () => {
      const log = await this.readBuglog()
      const record: BugRecord = {
        id: `bug-${log.bugs.length + 1}-${Date.now().toString(36)}`,
        error_message: errorMessage.slice(0, 500),
        fix: fix.slice(0, 2000),
        ...(file !== undefined ? { file } : {}),
        at: new Date().toISOString(),
      }
      log.bugs.push(record)
      await this.writeJSON(join(this.dir, 'buglog.json'), log)
      return record
    })
  }

  async searchBugs(term: string, limit = 10): Promise<BugRecord[]> {
    const log = await this.readBuglog()
    const t = term.toLowerCase()
    const hits = log.bugs.filter(
      (b) =>
        b.error_message.toLowerCase().includes(t) ||
        b.fix.toLowerCase().includes(t) ||
        (b.file ?? '').toLowerCase().includes(t),
    )
    return hits.slice(-limit).reverse()
  }

  // ── token ledger ──────────────────────────────────────────────────────

  /** Upsert a session's usage into the ledger; appends a new entry on first sight. */
  async recordSessionUsage(sessionId: string, agent: string | undefined, measured: number, at?: string): Promise<void> {
    await this.withLock(async () => {
      const ledger = await this.readJSON<Ledger>(join(this.dir, 'token-ledger.json'), DEFAULT_LEDGER)
      const existing = (ledger.sessions as Array<{ session_id: string }>).findIndex((s) => s.session_id === sessionId)
      if (existing !== -1) {
        const session = ledger.sessions[existing] as Record<string, unknown>
        session.measured_tokens = measured
        session.at = at ?? new Date().toISOString()
        if (agent !== undefined) session.agent = agent
      } else {
        ledger.lifetime.total_sessions += 1
        ledger.sessions.push({
          session_id: sessionId,
          ...(agent !== undefined ? { agent } : {}),
          measured_tokens: measured,
          at: at ?? new Date().toISOString(),
        })
      }
      await this.writeJSON(join(this.dir, 'token-ledger.json'), ledger)
    })
  }

  async readLedger(): Promise<Ledger> {
    return this.readJSON<Ledger>(join(this.dir, 'token-ledger.json'), DEFAULT_LEDGER)
  }

  // ── session + scan state ──────────────────────────────────────────────

  async readSession(): Promise<SessionState> {
    return this.readJSON<SessionState>(join(this.dir, 'hooks/_session.json'), {
      session_id: '', started: '', files_read: {}, files_written: [], edit_counts: {},
      anatomy_hits: 0, anatomy_misses: 0, repeated_reads_warned: 0, cerebrum_warnings: 0,
    })
  }

  async writeSession(state: SessionState): Promise<void> {
    await this.writeJSON(join(this.dir, 'hooks/_session.json'), state)
  }

  async readScanState(): Promise<ScanState> {
    return this.readJSON<ScanState>(join(this.dir, 'hooks/_scan-state.json'), {})
  }

  async writeScanState(state: ScanState): Promise<void> {
    await this.writeJSON(join(this.dir, 'hooks/_scan-state.json'), state)
  }

  async snapshotPrecompact(session: SessionState, trigger: string): Promise<void> {
    await this.writeJSON(join(this.dir, 'hooks/_precompact-snapshot.json'), {
      at: new Date().toISOString(),
      trigger,
      session,
    })
  }

  /** Clean stale `.tmp` files left by interrupted atomic writes. */
  async cleanTmpFiles(): Promise<void> {
    try {
      for (const entry of await readdir(this.dir, { recursive: true })) {
        if (typeof entry === 'string' && entry.endsWith('.tmp')) {
          await unlink(join(this.dir, entry)).catch(() => {})
        }
      }
    } catch {
      // no-op
    }
  }

  // ── cross-process lock ────────────────────────────────────────────────

  private static readonly LOCK_FILE = '.lock'
  private static readonly LOCK_STALE_MS = 10_000
  private static readonly LOCK_RETRY_MS = 25
  private static readonly LOCK_TIMEOUT_MS = 5_000

  /**
   * Run `fn` under a cross-process exclusive lock (`.wolf/.lock`, exclusive
   * create + retry + stale-lock steal). Protects read-modify-write races
   * between concurrent hook fires or separate harness processes.
   */
  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const lockPath = join(this.dir, WolfBrain.LOCK_FILE)
    const started = Date.now()
    for (;;) {
      try {
        await mkdir(lockPath)
        break
      } catch {
        // Lock held; steal when stale.
        try {
          const st = await stat(lockPath)
          if (Date.now() - st.mtimeMs > WolfBrain.LOCK_STALE_MS) {
            await rm(lockPath, { recursive: true, force: true })
            continue
          }
        } catch {
          // Lock vanished; retry acquisition.
        }
        if (Date.now() - started > WolfBrain.LOCK_TIMEOUT_MS) {
          throw new Error(`[dsh-openwolf] could not acquire brain lock ${lockPath}`)
        }
        await new Promise((resolve) => setTimeout(resolve, WolfBrain.LOCK_RETRY_MS))
      }
    }
    try {
      return await fn()
    } finally {
      await rm(lockPath, { recursive: true, force: true }).catch(() => {})
    }
  }
}
