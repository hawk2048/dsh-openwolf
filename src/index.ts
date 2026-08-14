/**
 * dsh-openwolf — a compact code-map "second brain" for DeepSeek Harness.
 *
 * One host-plane plugin that:
 * - scans the session workspace into a compact code map (file tree + per-file
 *   one-line summaries + top symbols), cached and refreshed by a chokidar
 *   watcher;
 * - injects the map as a managed block inside the workspace `AGENTS.md`, which
 *   the harness preloads into every session — so the model sees the map instead
 *   of re-reading whole files;
 * - exposes three model tools: `wolf_map`, `wolf_file`, `wolf_refresh`.
 *
 * @module dsh-openwolf
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'
import { watch, type FSWatcher } from 'chokidar'
import { scanCodebase, summarizeFile } from './scanner.ts'
import { injectBlock, renderMap } from './render.ts'
import type { CodeMap, ScanOptions } from './types.ts'

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

/** Locate or create the cache entry for a root. */
function entryOf(cache: Map<string, CacheEntry>, root: string): CacheEntry | undefined {
  return cache.get(root)
}

/** Main plugin: registers the service internals and the three model tools. */
export function apply(ctx: Context, config: Config) {
  const cache = new Map<string, CacheEntry>()
  const timers = new Set<NodeJS.Timeout>()
  const opts = scanOptionsOf(config)

  /** Refresh the cached map for a root, then optionally re-inject AGENTS.md. */
  const refresh = async (root: string): Promise<{ map: CodeMap; injected: boolean; agentsMd: string | null; injectedBytes: number }> => {
    const map = await scanCodebase(root, opts)
    const prev = cache.get(root)
    cache.set(root, { map, watcher: prev?.watcher ?? null })
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
    const existing = entryOf(cache, root)
    if (existing !== undefined && !force) {
      return existing.map
    }
    const { map } = await refresh(root)
    return map
  }

  /** Start the watcher for a root (lazy, once). */
  const ensureWatcher = (root: string): void => {
    if (!config.watch) return
    const existing = cache.get(root)
    if (existing?.watcher !== null && existing?.watcher !== undefined) return
    const watcher = watch(root, {
      ignoreInitial: true,
      ignored: (path: string) => {
        // Delegate to the scanner's ignore logic by relativizing.
        const rel = path.slice(root.length).replace(/^[\\/]+/, '').replace(/\\/g, '/')
        if (rel === '') return false
        // Cheap pre-filter: hidden segments and the configured patterns.
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

  // Registration is effect-based: everything below unwinds when the plugin
  // unloads (config edit, HMR, profile restart).
  ctx.effect(() => () => {
    for (const [, entry] of cache) void entry.watcher?.close()
    for (const timer of timers) clearTimeout(timer)
    cache.clear()
    timers.clear()
  })

  ctx.tools.register(defineTool({
    name: 'wolf_map',
    description:
      'Read the compact dsh-openwolf code map for the current workspace: file tree, per-file one-line summaries, and top symbols. Use this before reading whole files; only read a file when the map shows it is relevant.',
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
      'Read the dsh-openwolf digest of one workspace file: language, size, line count, top-level symbols, and a bounded preview. Prefer this over reading the whole file when the code map shows a file is relevant.',
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
                `${value.size ?? 0} bytes · ${value.lines ?? 0} lines`,
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
      'Force a rescan of the current workspace and re-inject the code map into AGENTS.md. Use after large structural changes (new files, renames, moves).',
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
