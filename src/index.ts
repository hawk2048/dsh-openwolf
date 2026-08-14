/**
 * dsh-openwolf — a compact code-map "second brain" for DeepSeek Harness.
 *
 * v0.2 adds the OpenWolf-class context core on top of the v0.1 code map:
 *
 * - `.wolf/` brain directory per workspace (STATUS, cerebrum, memory, buglog,
 *   token ledger, session state) — see {@link module:dsh-openwolf/brain}.
 * - Session digest injected on `agent/session-start` via `agent.inject()`
 *   (STATUS 🚀 + Do-Not-Repeat + recent bugs + anatomy pointer, budget-capped)
 *   with a git-HEAD staleness warning; compaction survival via the `compact`
 *   source.
 * - Read interception on `tools/post-execute`: repeated-read warnings and
 *   anatomy hints with symbol line ranges for offset/limit reads.
 * - Write interception: action log + session tracking + single-file index
 *   refresh.
 * - Tools: `wolf_map`, `wolf_file`, `wolf_refresh` (v0.1) plus `wolf_init`,
 *   `wolf_status`, `wolf_learn`, `wolf_bug`, `wolf_report`.
 *
 * Independent MIT implementation; the AGPL reference is used only as a
 * behavioral spec.
 *
 * @module dsh-openwolf
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type PostToolDecision } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import Schema from '@deepseek-ai/schemastery'
import { watch, type FSWatcher } from 'chokidar'
import { scanCodebase, summarizeFile, analyzeFile } from './scanner.ts'
import { injectBlock, renderMap } from './render.ts'
import { WolfBrain, isSensitiveFile } from './brain.ts'
import { buildSessionDigestWithWarning, buildSessionDigest, currentGitHead, anatomyStaleReason } from './digest.ts'
import type { CodeMap, FileEntry, ScanOptions } from './types.ts'

/** Plugin display name used in diagnostics. */
export const name = 'dsh-openwolf'

/** Hard dependencies: the tool registry must exist before we register. */
export const inject = ['tools']

/** User-facing configuration. */
export interface Config {
  /** Cap on the rendered map (bytes) used by AGENTS.md injection and wolf_map. */
  maxMapBytes: number
  /** Files larger than this are listed but not opened. */
  maxFileBytes: number
  /** Hard cap on scanned files per workspace. */
  maxFiles: number
  /** Watch the workspace and refresh the map on changes. */
  watch: boolean
  /** Maintain the managed code-map block inside the instruction file. */
  injectAgentsMd: boolean
  /** Instruction file that receives the managed block (`AGENTS.md` or `CLAUDE.md`). */
  agentsMdFile: string
  /** Honor the workspace root `.gitignore`. */
  useGitignore: boolean
  /** Extra ignore patterns (gitignore-lite syntax). */
  ignore: string[]
  /** Include dot-files/dot-directories (`.git` is always excluded). */
  hidden: boolean
  /** Extract top-level symbols for map entries and digests. */
  symbols: boolean
  /** Debounce (ms) for watcher-triggered rescans. */
  debounceMs: number
  /** Sort map files by `path` (ascending) or `size` (descending). */
  sortBy: 'path' | 'size'
  /** Enable the `.wolf/` brain (session digests, memory, buglog, ledger). */
  brainEnabled: boolean
  /** Brain directory name under the workspace root. */
  brainDir: string
  /** Cap on the injected session digest (tokens). */
  sessionDigestBudgetTokens: number
  /** Anatomy scan freshness window (hours) before a staleness warning. */
  rescanIntervalHours: number
  /** Files above this estimated token count get symbol-level read hints. */
  symbolThresholdTokens: number
  /** Inject the session digest on session start. */
  digestEnabled: boolean
  /** Intercept `read` tool calls (repeated-read warnings + anatomy hints). */
  interceptReads: boolean
  /** Intercept `write`/`edit` tool calls (action log + session tracking). */
  interceptWrites: boolean
  /** Snapshot session state on compaction (survival belt-and-braces). */
  compactionSurvival: boolean
}

/** Config schema — validated at load; defaults fill omitted fields. */
export const Config: Schema<Config> = Schema.object({
  maxMapBytes: Schema.number().min(512).max(1 << 20).default(16384),
  maxFileBytes: Schema.number().min(1024).max(1 << 24).default(65536),
  maxFiles: Schema.number().min(1).max(100000).default(4000),
  watch: Schema.boolean().default(true),
  injectAgentsMd: Schema.boolean().default(true),
  agentsMdFile: Schema.string().default('AGENTS.md'),
  useGitignore: Schema.boolean().default(true),
  ignore: Schema.array(String).default([
    'node_modules', '.git', 'dist', 'build', 'coverage', '.venv', '__pycache__',
    '.next', '.cache', '.turbo', '.idea', '.vscode', 'target', 'out', '*.log',
  ]),
  hidden: Schema.boolean().default(false),
  symbols: Schema.boolean().default(true),
  debounceMs: Schema.number().min(0).max(60000).default(1000),
  sortBy: Schema.union(['path', 'size']).default('path'),
  brainEnabled: Schema.boolean().default(true),
  brainDir: Schema.string().default('.wolf'),
  sessionDigestBudgetTokens: Schema.number().min(128).max(1 << 15).default(1500),
  rescanIntervalHours: Schema.number().min(0.1).max(24 * 30).default(6),
  symbolThresholdTokens: Schema.number().min(100).max(1 << 20).default(500),
  digestEnabled: Schema.boolean().default(true),
  interceptReads: Schema.boolean().default(true),
  interceptWrites: Schema.boolean().default(true),
  compactionSurvival: Schema.boolean().default(true),
})

/** Derive scan options from validated config. */
function scanOptionsOf(config: Config): ScanOptions {
  return {
    maxFiles: config.maxFiles,
    maxFileBytes: config.maxFileBytes,
    symbols: config.symbols,
    hidden: config.hidden,
    // The instruction file itself carries the managed map block; exclude it so
    // the map does not list (or recurse into) its own output.
    extraIgnore: [...config.ignore, config.agentsMdFile],
    useGitignore: config.useGitignore,
    sortBy: config.sortBy,
  }
}

/** Workspace root for one tool call: the agent's session cwd, else the process cwd. */
function resolveWorkspace(exec: { agent?: { session?: { header?: { cwd?: string } } } }): string {
  return exec.agent?.session?.header?.cwd ?? process.cwd()
}

/** Map cache entry with an optional active watcher. */
interface CacheEntry {
  map: CodeMap
  watcher: FSWatcher | null
}

/** A user-role context message owned by this plugin. */
function wolfMessage(text: string) {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'dsh-openwolf' },
  })
}

/** Main plugin: registers the service internals, the brain, hooks, and tools. */
export function apply(ctx: Context, config: Config) {
  const cache = new Map<string, CacheEntry>()
  const brains = new Map<string, WolfBrain>()
  const timers = new Set<NodeJS.Timeout>()
  const opts = scanOptionsOf(config)

  /** The brain for a workspace root (lazy-created). */
  const brainOf = async (root: string): Promise<WolfBrain | null> => {
    if (!config.brainEnabled) return null
    let brain = brains.get(root)
    if (brain === undefined) {
      brain = new WolfBrain(root, config.brainDir)
      await brain.ensure()
      await brain.cleanTmpFiles()
      brains.set(root, brain)
    }
    return brain
  }

  /** Refresh the cached map for a root, pin scan state, then re-inject AGENTS.md. */
  const refresh = async (root: string): Promise<{ map: CodeMap; injected: boolean; agentsMd: string | null; injectedBytes: number }> => {
    const map = await scanCodebase(root, opts)
    const prev = cache.get(root)
    cache.set(root, { map, watcher: prev?.watcher ?? null })
    const brain = await brainOf(root)
    if (brain !== null) {
      await brain.writeScanState({
        last_scanned: new Date().toISOString(),
        git_head: (await currentGitHead(root)) ?? undefined,
        total_files: map.totalFiles,
        total_lines: map.totalLines,
      })
    }
    let injected = false
    let agentsMd: string | null = null
    let injectedBytes = 0
    if (config.injectAgentsMd) {
      const result = await injectBlock(`${root}/${config.agentsMdFile}`, map, config.maxMapBytes)
      injected = result.changed
      agentsMd = result.path
      injectedBytes = result.blockBytes
    }
    return { map, injected, agentsMd, injectedBytes }
  }

  /** Return the current map, scanning on first access or when forced. */
  const getMap = async (root: string, force = false): Promise<CodeMap> => {
    const existing = cache.get(root)
    if (existing !== undefined && !force) {
      return existing.map
    }
    const { map } = await refresh(root)
    return map
  }

  /** Find a file entry in the cached map, or null. */
  const fileEntryOf = (root: string, relPath: string): FileEntry | null => {
    const entry = cache.get(root)
    if (entry === undefined) return null
    return entry.map.files.find((f) => f.path === relPath) ?? null
  }

  /** Re-analyze one file and patch the cached map (write interception). */
  const reanalyzeFile = async (root: string, absPath: string, relPath: string): Promise<void> => {
    const entry = cache.get(root)
    if (entry === undefined) return
    try {
      const { stat } = await import('node:fs/promises')
      const st = await stat(absPath)
      const updated = await analyzeFile(absPath, st.size, st.mtimeMs, opts)
      updated.path = relPath
      const idx = entry.map.files.findIndex((f) => f.path === relPath)
      if (idx !== -1) {
        const files = [...entry.map.files]
        files[idx] = updated
        cache.set(root, { ...entry, map: { ...entry.map, files } })
      }
    } catch {
      // best-effort single-file refresh
    }
  }

  // ── lifecycle cleanup (effects) ───────────────────────────────────────
  ctx.effect(() => () => {
    for (const [, entry] of cache) void entry.watcher?.close()
    for (const timer of timers) clearTimeout(timer)
    cache.clear()
    brains.clear()
    timers.clear()
  })

  // ── session digest injection (agent/session-start) ────────────────────
  ctx.on('agent/session-start', async ({ agent, source }) => {
    if (!config.digestEnabled) return
    const root = agent.session?.header?.cwd ?? process.cwd()
    const brain = await brainOf(root)
    if (brain === null) return
    try {
      if (source === 'compact') {
        // Compaction survival: resurface in-flight session state.
        const session = await brain.readSession()
        const files = [...new Set(session.files_written.map((w) => w.file))].slice(-15)
        if (files.length > 0) {
          agent.inject(wolfMessage(
            `## Session in progress (context was just compacted)\nFiles already modified this session: ${files.join(', ')}. Do not re-read them wholesale — check .wolf/memory.md for what was done.`,
          ))
        }
        return
      }
      if (source === 'resume') return // history is intact on resume; no digest needed
      const budget = await brain.digestBudget(agent.options?.model ?? undefined)
      const digest = await buildSessionDigestWithWarning(brain, budget, config.rescanIntervalHours)
      if (digest !== '') {
        agent.inject(wolfMessage(digest))
      }
      // Housekeeping reminders: nudge the model to keep the brain fed.
      try {
        const cerebrum = await brain.readCerebrum()
        const entryLines = cerebrum.split('\n').filter((l) => {
          const t = l.trim()
          return t.startsWith('- ') || t.startsWith('* ')
        })
        const buglog = await brain.readBuglog()
        const reminders: string[] = []
        if (entryLines.length < 3) {
          reminders.push(`💡 .wolf/cerebrum.md has only ${entryLines.length} entr${entryLines.length === 1 ? 'y' : 'ies'}. Record preferences, conventions, and mistakes with wolf_learn this session.`)
        }
        if (buglog.bugs.length === 0) {
          reminders.push('📋 .wolf/buglog.json is empty. Log any bugs you find or fix with wolf_bug.')
        }
        if (reminders.length > 0) {
          agent.inject(wolfMessage(reminders.join('\n')))
        }
      } catch {
        // best-effort
      }
      // Reset per-session read/write tracking for a fresh session.
      await brain.writeSession({
        session_id: agent.id ?? '',
        started: new Date().toISOString(),
        files_read: {},
        files_written: [],
        edit_counts: {},
        anatomy_hits: 0,
        anatomy_misses: 0,
        repeated_reads_warned: 0,
        cerebrum_warnings: 0,
      })
    } catch {
      // injection is best-effort; never break the session lifecycle
    }
  })

  // ── compaction snapshot + token ledger (session/event) ────────────────
  ctx.on('session/event', async (session, event) => {
    const type = (event as { type: string }).type
    const root = (session as { header?: { cwd?: string } }).header?.cwd
    if (root === undefined) return
    const brain = await brainOf(root)
    if (brain === null) return
    if (type === 'compaction/start') {
      if (!config.compactionSurvival) return
      try {
        await brain.snapshotPrecompact(await brain.readSession(), 'auto')
      } catch {
        // best-effort
      }
      return
    }
    if (type === 'turn/end') {
      // Measure the session from the harness token meter and upsert the ledger.
      try {
        const meter = ctx.get('tokenMeter')
        let measured = 0
        if (meter !== undefined) {
          try {
            measured = (meter as { measure: (s: unknown) => { totalTokens: number } }).measure(session).totalTokens
          } catch {
            measured = 0
          }
        }
        const agents = ctx.get('agents') as { get?: (id: unknown) => { options?: { model?: string } } | undefined } | undefined
        const agent = agents?.get?.((session as { id?: unknown }).id)
        await brain.recordSessionUsage(String((session as { id?: unknown }).id ?? 'unknown'), agent?.options?.model, measured)
      } catch {
        // best-effort
      }
    }
  })

  // ── read / write interception (tools/post-execute) ────────────────────
  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = (await next()) as PostToolDecision
    try {
      if (exec.agent === undefined) return decision
      const root = resolveWorkspace(exec)
      const args = (exec.arguments ?? {}) as { file_path?: string }
      const relPath = args.file_path
      if (typeof relPath !== 'string' || relPath === '' || isSensitiveFile(relPath)) return decision
      if (relPath.startsWith('.wolf/') || relPath.startsWith('.wolf\\')) return decision

      if (config.interceptReads && exec.name === 'read') {
        const brain = await brainOf(root)
        if (brain === null) return decision
        const session = await brain.readSession()
        const path = relPath.split(/[\\/]+/).join('/')
        const hints: string[] = []

        const prev = session.files_read[path]
        if (prev !== undefined) {
          session.repeated_reads_warned += 1
          hints.push(`⚡ ${path} was already read this session (~${Math.max(1, prev.tokens)} tokens). Consider using your existing knowledge of this file.`)
        } else {
          const entry = fileEntryOf(root, path)
          if (entry !== null) {
            session.anatomy_hits += 1
            let line = `📋 anatomy: ${entry.path} — ${entry.summary || '[no summary]'} (~${entry.tokens} tok)`
            // Symbol hint with line ranges — suppressed when the file changed
            // since indexing (a stale range must never misdirect a read).
            if (entry.tokens >= config.symbolThresholdTokens && entry.symbolLines !== undefined && entry.symbolLines.length > 0) {
              const fresh = await fileIsFresh(root, entry)
              if (fresh) {
                const top = entry.symbolLines.slice(0, 5)
                const list = top.map((s) => `${s.name} at L${s.line}`).join('; ')
                line += `\n   ↳ symbols: ${list}. Use read offset/limit starting at the relevant line to fetch just what you need.`
              } else {
                line += '\n   ↳ file changed since index — run wolf_refresh before trusting this range.'
              }
            }
            hints.push(line)
          } else {
            session.anatomy_misses += 1
          }
        }

        const entry = fileEntryOf(root, path)
        session.files_read[path] = {
          count: (prev?.count ?? 0) + 1,
          tokens: entry?.tokens ?? prev?.tokens ?? 0,
          first_read: prev?.first_read ?? new Date().toISOString(),
        }
        await brain.writeSession(session)

        if (hints.length > 0 && decision.kind === 'accept') {
          return {
            ...decision,
            additionalContexts: [...(decision.additionalContexts ?? []), wolfMessage(hints.join('\n'))],
          }
        }
        return decision
      }

      if (config.interceptWrites && (exec.name === 'write' || exec.name === 'edit')) {
        const brain = await brainOf(root)
        if (brain === null) return decision
        const session = await brain.readSession()
        const path = relPath.split(/[\\/]+/).join('/')
        session.files_written.push({ file: path, at: new Date().toISOString() })
        session.edit_counts[path] = (session.edit_counts[path] ?? 0) + 1
        await brain.writeSession(session)
        await brain.appendMemory(exec.name, [path], result.isError ? 'error' : 'ok')
        await reanalyzeFile(root, `${root.replace(/[\\/]+$/, '')}/${path}`, path)
        return decision
      }
      return decision
    } catch {
      return decision
    }
  })

  // ── watcher ──────────────────────────────────────────────────────────
  const ensureWatcher = (root: string): void => {
    if (!config.watch) return
    const existing = cache.get(root)
    if (existing?.watcher !== null && existing?.watcher !== undefined) return
    const watcher = watch(root, {
      ignoreInitial: true,
      ignored: (path: string) => {
        const rel = path.slice(root.length).replace(/^[\\/]+/, '').replace(/\\/g, '/')
        if (rel === '') return false
        if (!config.hidden && rel.split('/').some((seg) => seg.startsWith('.'))) return true
        return opts.extraIgnore.some((p) => matchLite(p, rel))
      },
      awaitWriteFinish: { stabilityThreshold: Math.max(200, config.debounceMs / 2), pollInterval: 100 },
    })
    let pending: NodeJS.Timeout | null = null
    const schedule = () => {
      if (pending !== null) clearTimeout(pending)
      pending = setTimeout(() => {
        if (pending !== null) timers.delete(pending)
        pending = null
        void refresh(root).catch((err: unknown) => {
          console.warn(`[dsh-openwolf] refresh failed for ${root}: ${err instanceof Error ? err.message : String(err)}`)
        })
      }, config.debounceMs)
      timers.add(pending)
    }
    watcher.on('change', schedule)
    watcher.on('add', schedule)
    watcher.on('unlink', schedule)
    watcher.on('addDir', schedule)
    watcher.on('unlinkDir', schedule)
    const prev = cache.get(root)
    if (prev !== undefined) {
      cache.set(root, { ...prev, watcher })
    }
  }

  // ── tools ─────────────────────────────────────────────────────────────

  ctx.tools.register(defineTool({
    name: 'wolf_map',
    description:
      'Read the compact dsh-openwolf code map for the current workspace: file tree, per-file one-line summaries, top symbols, and token estimates. Use this before reading whole files; only read a file when the map shows it is relevant.',
    parameters: {
      refresh: {
        type: 'boolean',
        description: 'Force a rescan instead of returning the cached map.',
      },
      maxBytes: {
        type: 'number',
        description: 'Cap on the returned map text, in bytes (default: the plugin maxMapBytes).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          root: { type: 'string', required: true },
          generatedAt: { type: 'number', required: true },
          totalFiles: { type: 'number', required: true },
          totalLines: { type: 'number', required: true },
          truncated: { type: 'boolean', required: true },
          map: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.map }],
    },
    async execute(args, exec) {
      const root = resolveWorkspace(exec)
      ensureWatcher(root)
      const map = await getMap(root, args.refresh === true)
      const cap = typeof args.maxBytes === 'number' ? Math.max(512, Math.floor(args.maxBytes)) : config.maxMapBytes
      const { text, truncated } = renderMap(map, cap)
      return {
        root,
        generatedAt: map.scannedAt,
        totalFiles: map.totalFiles,
        totalLines: map.totalLines,
        truncated,
        map: text,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'wolf_file',
    description:
      'Read the dsh-openwolf digest of one workspace file: language, size, line count, token estimate, top-level symbols with line numbers, and a bounded preview. Prefer this over reading the whole file when the code map shows a file is relevant.',
    parameters: {
      path: {
        type: 'string',
        required: true,
        description: 'Workspace-relative file path (e.g. src/server.ts). Absolute paths and parent traversal are rejected.',
      },
      previewBytes: {
        type: 'number',
        description: 'Preview budget in bytes (default 4096).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          exists: { type: 'boolean', required: true },
          size: { type: 'number' },
          lines: { type: 'number' },
          lang: { type: 'string' },
          tokens: { type: 'number' },
          symbols: { type: 'array', items: { type: 'string' }, required: true },
          preview: { type: 'string' },
          previewTruncated: { type: 'boolean' },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: value.exists
            ? [
                `# ${value.path} (${value.lang ?? 'text'})`,
                `${value.size ?? 0} bytes · ${value.lines ?? 0} lines${value.tokens !== undefined ? ` · ~${value.tokens} tok` : ''}`,
                value.symbols.length > 0 ? `symbols: ${value.symbols.join(', ')}` : '',
                '```',
                value.preview ?? '',
                '```',
                value.previewTruncated === true ? '(preview truncated)' : '',
              ].filter((line) => line !== '').join('\n')
            : `not found in workspace: ${value.path}`,
        },
      ],
    },
    async execute(args, exec) {
      const root = resolveWorkspace(exec)
      const previewBytes = typeof args.previewBytes === 'number' ? Math.max(256, Math.floor(args.previewBytes)) : undefined
      const digest = await summarizeFile(root, args.path, opts, previewBytes)
      return {
        path: digest.path,
        exists: digest.exists,
        symbols: digest.symbols ?? [],
        ...(digest.size !== undefined ? { size: digest.size } : {}),
        ...(digest.lines !== undefined ? { lines: digest.lines } : {}),
        ...(digest.lang !== undefined ? { lang: digest.lang } : {}),
        ...(digest.preview !== undefined ? { preview: digest.preview } : {}),
        ...(digest.previewTruncated !== undefined ? { previewTruncated: digest.previewTruncated } : {}),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'wolf_refresh',
    description:
      'Force a rescan of the current workspace, pin the scan state (git HEAD + timestamp), and re-inject the code map into AGENTS.md. Use after large structural changes or when warned that anatomy may be stale.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          root: { type: 'string', required: true },
          totalFiles: { type: 'number', required: true },
          totalLines: { type: 'number', required: true },
          truncated: { type: 'boolean', required: true },
          injected: { type: 'boolean', required: true },
          agentsMd: { type: 'string' },
          injectedBytes: { type: 'number' },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: [
            `rescanned ${value.root}`,
            `${value.totalFiles} files · ${value.totalLines} lines${value.truncated ? ' (truncated)' : ''}`,
            value.injected ? `re-injected code map into ${value.agentsMd ?? 'AGENTS.md'}` : 'code map already current',
          ].join('\n'),
        },
      ],
    },
    async execute(_args, exec) {
      const root = resolveWorkspace(exec)
      ensureWatcher(root)
      const { map, injected, agentsMd, injectedBytes } = await refresh(root)
      return {
        root,
        totalFiles: map.totalFiles,
        totalLines: map.totalLines,
        truncated: map.truncated,
        injected,
        agentsMd: agentsMd ?? undefined,
        injectedBytes,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'wolf_init',
    description:
      'Initialize the .wolf/ brain directory for the current workspace (STATUS.md, cerebrum.md, memory.md, buglog.json, token ledger, config). Idempotent; existing data is preserved.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          root: { type: 'string', required: true },
          brainDir: { type: 'string', required: true },
          config: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `brain initialized at ${value.root}/${value.brainDir}\n${value.config}`,
      }],
    },
    async execute(_args, exec) {
      const root = resolveWorkspace(exec)
      const brain = await brainOf(root)
      if (brain === null) throw new Error('brain is disabled (brainEnabled=false)')
      return {
        root,
        brainDir: config.brainDir,
        config: JSON.stringify(await brain.readConfig(), null, 2),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'wolf_status',
    description:
      'Read or update the .wolf/STATUS.md handoff document. With no body, returns the current STATUS.md; with body, replaces it (the ## 🚀 Next phase section feeds the session digest).',
    parameters: {
      body: {
        type: 'string',
        description: 'Optional full replacement content for STATUS.md.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          body: { type: 'string', required: true },
          changed: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `# STATUS (${value.path})\n${value.body}` }],
    },
    async execute(args, exec) {
      const root = resolveWorkspace(exec)
      const brain = await brainOf(root)
      if (brain === null) throw new Error('brain is disabled (brainEnabled=false)')
      if (typeof args.body === 'string') {
        await brain.writeStatus(args.body)
        return { path: `${root}/${config.brainDir}/STATUS.md`, body: args.body, changed: true }
      }
      return { path: `${root}/${config.brainDir}/STATUS.md`, body: await brain.readStatus(), changed: false }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'wolf_learn',
    description:
      'Record a learned preference, convention, or mistake in .wolf/cerebrum.md. Use for durable cross-session knowledge; the Do-Not-Repeat section feeds the session digest.',
    parameters: {
      section: {
        type: 'string',
        description: 'Section name, e.g. Preferences, Conventions, Do-Not-Repeat.',
      },
      entry: {
        type: 'string',
        required: true,
        description: 'The learned fact, one line.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          section: { type: 'string', required: true },
          entry: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `learned → ${value.section}: ${value.entry}` }],
    },
    async execute(args, exec) {
      const root = resolveWorkspace(exec)
      const brain = await brainOf(root)
      if (brain === null) throw new Error('brain is disabled (brainEnabled=false)')
      await brain.appendCerebrum(args.section ?? 'Preferences', args.entry)
      return { section: args.section ?? 'Preferences', entry: args.entry }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'wolf_bug',
    description:
      'Log a fixed bug to .wolf/buglog.json (searchable, prevents rediscovery), or search existing entries when only a query is given. Recent bugs feed the session digest.',
    parameters: {
      error: {
        type: 'string',
        description: 'The error message / symptom to remember.',
      },
      fix: {
        type: 'string',
        description: 'How it was fixed.',
      },
      file: {
        type: 'string',
        description: 'Optional file where the bug was found.',
      },
      search: {
        type: 'string',
        description: 'Search term for existing bugs (no error given = search mode).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          mode: { type: 'string', required: true },
          results: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                error_message: { type: 'string', required: true },
                fix: { type: 'string', required: true },
                file: { type: 'string' },
                at: { type: 'string', required: true },
              },
            },
            required: true,
          },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: value.mode === 'logged'
            ? `bug logged: ${value.results[0]?.error_message} → ${value.results[0]?.fix}`
            : value.results.length === 0
              ? 'no matching bugs in .wolf/buglog.json'
              : value.results.map((b) => `- ${b.error_message} → ${b.fix}${b.file !== undefined ? ` (${b.file})` : ''}`).join('\n'),
        },
      ],
    },
    async execute(args, exec) {
      const root = resolveWorkspace(exec)
      const brain = await brainOf(root)
      if (brain === null) throw new Error('brain is disabled (brainEnabled=false)')
      if (typeof args.error === 'string' && args.error !== '') {
        const record = await brain.logBug(args.error, args.fix ?? '', args.file)
        return {
          mode: 'logged',
          results: [{ error_message: record.error_message, fix: record.fix, at: record.at, ...(record.file !== undefined ? { file: record.file } : {}) }],
        }
      }
      const term = args.search ?? ''
      const hits = await brain.searchBugs(term)
      return {
        mode: 'search',
        results: hits.map((b) => ({ error_message: b.error_message, fix: b.fix, at: b.at, ...(b.file !== undefined ? { file: b.file } : {}) })),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'wolf_report',
    description:
      'Report token usage for this workspace: the .wolf token ledger (per session, estimated) plus the current session measurement from the harness token meter when available.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          totalSessions: { type: 'number', required: true },
          totalEstimatedTokens: { type: 'number', required: true },
          totalMeasuredTokens: { type: 'number' },
          currentSessionTokens: { type: 'number' },
          report: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.report }],
    },
    async execute(_args, exec) {
      const root = resolveWorkspace(exec)
      const brain = await brainOf(root)
      if (brain === null) throw new Error('brain is disabled (brainEnabled=false)')
      const ledger = await brain.readLedger()
      const sessions = ledger.sessions as Array<{ measured_tokens?: number; estimated_tokens?: number }>
      const totalMeasured = sessions.reduce((sum, s) => sum + (s.measured_tokens ?? 0), 0)
      const totalEstimated = sessions.reduce((sum, s) => sum + (s.estimated_tokens ?? 0), 0)
      let currentTokens: number | undefined
      const meter = ctx.get('tokenMeter')
      const agent = exec.agent as { session?: unknown } | undefined
      if (meter !== undefined && agent?.session !== undefined) {
        try {
          currentTokens = (meter as { measure: (s: unknown) => { totalTokens: number } }).measure(agent.session).totalTokens
        } catch {
          currentTokens = undefined
        }
      }
      const lines = [
        `token ledger: ${ledger.lifetime.total_sessions} sessions`,
        totalMeasured > 0 ? `measured (harness token meter): ~${totalMeasured.toLocaleString()} tokens` : `measured: none recorded yet`,
        totalEstimated > 0 ? `estimated (heuristic): ~${totalEstimated.toLocaleString()} tokens` : '',
        ...(currentTokens !== undefined ? [`current session: ~${currentTokens.toLocaleString()} tokens`] : []),
      ].filter((l) => l !== '')
      return {
        totalSessions: ledger.lifetime.total_sessions,
        totalEstimatedTokens: totalEstimated,
        ...(totalMeasured > 0 ? { totalMeasuredTokens: totalMeasured } : {}),
        ...(currentTokens !== undefined ? { currentSessionTokens: currentTokens } : {}),
        report: lines.join('\n'),
      }
    },
  }))
}

/** True when a cached file entry matches the on-disk file (hint freshness). */
async function fileIsFresh(root: string, entry: FileEntry): Promise<boolean> {
  try {
    const { stat } = await import('node:fs/promises')
    const st = await stat(`${root.replace(/[\\/]+$/, '')}/${entry.path}`)
    return (entry.size === undefined || st.size === entry.size) &&
      (entry.mtimeMs === undefined || Math.abs(st.mtimeMs - entry.mtimeMs) < 1)
  } catch {
    return false
  }
}

/** Tiny wildcard matcher for the watcher's ignored() pre-filter. */
function matchLite(pattern: string, rel: string): boolean {
  let re = ''
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        re += '.*'
        i++
      } else {
        re += '[^/]*'
      }
    } else if (ch === '?') {
      re += '[^/]'
    } else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(re).test(rel)
}

export { anatomyStaleReason }
