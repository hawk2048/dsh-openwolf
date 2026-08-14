# dsh-openwolf

English | [中文](README.zh.md)

A compact code-map **"second brain"** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It pre-indexes your workspace into a small, dense map — file tree, per-file one-line summaries, top symbols, and token estimates — injects it into `AGENTS.md` so every session starts with the map, and intercepts reads and writes so the agent stops re-reading whole files.

Inspired by the token-saving idea behind [OpenWolf for Claude Code](https://github.com/cytostack/openwolf) ("sharper context, fewer tokens"), implemented from scratch as a native DSH plugin — no MCP server, no external CLI, no build step for users.

- **Zero-config drop-in**: one bundle row; the harness preloads the map via `AGENTS.md` automatically.
- **Dependency-light**: `chokidar` for watching + `schemastery` for config; everything else is `node:fs`.
- **Workspace-aware**: the map follows the session workspace, never a hard-coded path.
- **Fresh by default**: a debounced watcher rescans and re-injects on file changes.
- **v0.2 brain**: a per-workspace `.wolf/` directory (STATUS, cerebrum, memory, buglog, token ledger), a budget-capped **session digest** injected at session start, **read interception** (repeated-read warnings + symbol line-range hints for offset/limit reads), **write interception** (action log + single-file index refresh), and **compaction survival**.

## Install

Into any profile (e.g. the `web` profile you boot with `dsh web`):

```sh
dsh plugin --profile web add dsh-openwolf          # from npm
# or from a local checkout:
dsh plugin --profile web add ./path/to/dsh-openwolf
# or from GitHub (requires the allowBuilds entry, see below):
dsh plugin --profile web add github:hawk2048/dsh-openwolf
```

Restart the profile (`dsh web`). The bundle layer inserts one host row that registers the service and the three tools for every session.

Installing from a git URL pulls **source**, not build output, so the first `add` fails until you authorize the package's build in the profile's `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  dsh-openwolf: true
```

then re-run `add`. Installing from npm or a tarball needs no authorization.

## What the model sees

Eight native tools appear in every session:

| Tool | Purpose |
| --- | --- |
| `wolf_map` | The compact code map for the current workspace (optionally force a rescan with `refresh`). |
| `wolf_file` | A bounded digest of one file: language, size, line count, token estimate, top symbols, and a preview — instead of reading the whole file. |
| `wolf_refresh` | Force a rescan, pin the scan state (git HEAD + timestamp), and re-inject the map into `AGENTS.md`. |
| `wolf_init` | Initialize the `.wolf/` brain directory (idempotent). |
| `wolf_status` | Read or update `STATUS.md`; its `## 🚀` section feeds the session digest. |
| `wolf_learn` | Record a preference / convention / Do-Not-Repeat entry in `cerebrum.md`. |
| `wolf_bug` | Log a fixed bug or search the buglog (prevents rediscovery). |
| `wolf_report` | Token ledger report (estimated per session + measured current session via the harness token meter). |

Additionally, when `injectAgentsMd` is on, the plugin maintains a managed block inside the workspace `AGENTS.md`:

```markdown
<!-- dsh-openwolf:start -->
# Code Map
Generated … · 42 files · 1234 lines · 0.12s

## src
- `src/index.ts` — 90 lines · createApp, Server · export function createApp()…
<!-- dsh-openwolf:end -->
```

The harness's built-in `agent-instructions` plugin already reads `AGENTS.md` (and `CLAUDE.md`) into every session with its own byte budget and change tracking, so the map is preloaded at session start and refreshed automatically when it changes. Other instruction files stay untouched — only the block between the two markers is managed, and an identical block is never rewritten.

## The v0.2 brain (OpenWolf-class context core)

When `brainEnabled` is on, each workspace gets a `.wolf/` directory:

```
.wolf/
├── config.json          # session-digest budget, rescan interval, thresholds
├── STATUS.md            # end-of-phase handoff (## 🚀 section → session digest)
├── cerebrum.md          # learned preferences + Do-Not-Repeat list
├── memory.md            # chronological action log (token estimates)
├── buglog.json          # searchable bug-fix memory
├── token-ledger.json    # per-session estimated usage
└── hooks/               # session state, scan state (git HEAD pin), precompact snapshots
```

- **Session digest** — on `agent/session-start`, a budget-capped digest is injected via `agent.inject()`: STATUS 🚀 next phase → Do-Not-Repeat (last 10) → recent 5 bugs → anatomy pointer. A **staleness warning** is prepended when the pinned git HEAD moved or the last scan is older than `rescanIntervalHours`.
- **Read interception** — on `tools/post-execute` of `read`: an anatomy hint (`path — summary (~tokens)`), and for files above `symbolThresholdTokens`, the top symbols with line numbers for `offset`/`limit` reads. Hints are suppressed when the file changed since indexing. Re-reading the same file in one session warns with the earlier token cost.
- **Write interception** — `write`/`edit` results are logged to `memory.md`, tracked in session state, and the single changed file is re-analyzed into the cached map.
- **Compaction survival** — a `compaction/start` snapshot plus a `session-start(source: compact)` restore digest listing files already modified this session.
- **Secret hygiene** — `.env`, `.npmrc`, keys, keystores and friends never enter hints or logs.

## Config

All options are schema-validated at load; omitted fields use defaults. Override any of them in your profile's `cordis.patch.yml` (the row is `openwolf`):

```yaml
- id: openwolf
  config:
    maxMapBytes: 16384        # cap on the injected/returned map text (bytes)
    maxFileBytes: 65536       # files larger than this are listed, not opened
    maxFiles: 4000            # hard cap on scanned files per workspace
    watch: true               # debounced chokidar watcher
    injectAgentsMd: true      # maintain the AGENTS.md managed block
    agentsMdFile: AGENTS.md   # or CLAUDE.md
    useGitignore: true        # honor the root .gitignore
    ignore: [node_modules, .git, dist, build, coverage, .venv, __pycache__, .next, .cache, .turbo, .idea, .vscode, target, out, "*.log"]
    hidden: false             # include dotfiles/dot-directories (.git stays excluded)
    symbols: true             # extract top-level symbols
    debounceMs: 1000          # watcher debounce for rescans
    sortBy: path              # path | size
    brainEnabled: true        # the .wolf/ brain (digest, memory, buglog, ledger)
    brainDir: .wolf           # brain directory under the workspace root
    sessionDigestBudgetTokens: 1500   # cap on the injected session digest
    rescanIntervalHours: 6    # anatomy freshness window before a staleness warning
    symbolThresholdTokens: 500        # files above this get symbol line-range hints
    digestEnabled: true       # inject the session digest on session start
    interceptReads: true      # repeated-read warnings + anatomy hints
    interceptWrites: true     # action log + single-file index refresh
    compactionSurvival: true  # snapshot + restore digest on compaction
```

A later layer can override the whole row by `id`, so deployments keep their own defaults.

## Development

```sh
pnpm install
pnpm build        # tsc → lib/
pnpm test         # node --test, in-process (no subprocess runner)
```

The package is **erasable TypeScript** with `rewriteRelativeImportExtensions`, so `node` can run `src/` directly for tests while `tsc` emits the ESM `lib/` for publication. `prepare` builds from source, which is what makes git-based installs work.

To try the plugin against a running harness without publishing:

```sh
pnpm build
dsh plugin --profile <name> add ./dsh-openwolf
dsh --profile <name> --dump-config | grep -A2 openwolf
```

## How it works

- **Scanner** (`src/scanner.ts`): walks the workspace with a gitignore-lite matcher (negation, `**`, anchored patterns, directory rules), a file budget, and a size cap; skips binaries, over-large files, and secrets; extracts per-file symbols (with line numbers) and one-line summaries; estimates tokens; aggregates per-directory counts.
- **Renderer** (`src/render.ts`): groups entries by directory into a bounded Markdown map and manages the `AGENTS.md` block (create / replace / preserve, idempotent).
- **Brain** (`src/brain.ts`): the durable `.wolf/` store — config, STATUS, cerebrum, memory, buglog, token ledger, session/scan state — with atomic writes and a secret denylist.
- **Digest** (`src/digest.ts`): budget-capped session digest construction and git-HEAD staleness detection.
- **Plugin** (`src/index.ts`): caches maps per workspace root, lazily starts a debounced chokidar watcher, resolves the workspace from the calling agent's session (`agent.session.header.cwd`), injects the session digest on `agent/session-start`, intercepts `read`/`write`/`edit` on `tools/post-execute` (attaching model-facing hints via `additionalContexts`), snapshots on `compaction/start`, and registers eight tools on `ctx.tools`. Every registration is an effect: unloading the plugin (config edit, HMR, restart) unwinds watchers, timers, and tools.

The scanner/analyzer is dependency-free and exported for reuse; `scanCodebase`, `summarizeFile`, `renderMap`, `injectBlock`, `WolfBrain`, and the digest builders are public API.

## Model Experience

### Request context and condition

#### What the model sees

Eight tool schemas (`wolf_map`, `wolf_file`, `wolf_refresh`, `wolf_init`, `wolf_status`, `wolf_learn`, `wolf_bug`, `wolf_report`) with the descriptions above, plus — when `injectAgentsMd` is enabled and the session workspace has an `AGENTS.md` — a managed `# Code Map` block preloaded by the harness's `agent-instructions` plugin (capped at `maxMapBytes`, replaced only when the map changes). When `digestEnabled`, `agent/session-start` injects a budget-capped session digest (STATUS 🚀 / Do-Not-Repeat / recent bugs / anatomy pointer, plus a staleness warning when the pinned git HEAD moved or the scan is older than `rescanIntervalHours`). When `interceptReads`, `read` results carry anatomy hints (description + token estimate, and symbol line ranges for files above `symbolThresholdTokens`) and repeated-read warnings via `additionalContexts`.

#### Token effect

The map block is retained context charged once per session baseline, bounded by `maxMapBytes` (default 16 KiB); the session digest is bounded by `sessionDigestBudgetTokens` (default 1500). `wolf_map` returns up to `maxBytes` (or `maxMapBytes`) on demand; `wolf_file` returns a bounded digest instead of a whole file; read hints steer the model to `offset`/`limit` reads. Net effect vs. re-reading files: one fixed map/digest read replaces N repeated whole-file reads, which is the token-reduction mechanism of the plugin.

#### KV Cache effect

Prefix-stable while the map and digest are unchanged: identical `AGENTS.md` content and digest text reproduce an identical request prefix. A rescan that changes the map replaces the block and invalidates reuse from the first changed token; digest changes behave the same on the next session start. Tool-call results (including interception hints) are append-only and do not invalidate earlier prefixes.

## Known Limitations and Deferred Work

- **Heuristic symbols** — symbol extraction is regex-based per language family, not a real parser; nested or unusual declarations may be missed. A tree-sitter backend is a v0.3 direction.
- **Root-level `.gitignore` only** — nested `.gitignore` files and `git check-ignore` exactness (e.g. `!` re-inclusion inside pruned directories) are not supported yet.
- **Single instruction file** — the managed block lives in one file (`agentsMdFile`); multiple instruction files are not maintained simultaneously.
- **No service export** — tools are registered from the plugin closure; the indexer and brain are exported as library functions, but there is no `ctx.openwolf` service for other plugins to consume. That is the v0.3 seam.
- **Read hints ride the result** — `tools/post-execute` attaches hints as result context, so the model sees them with (not strictly before) the read; a pre-read interception would require a DSH extension point that does not exist yet.
- **Watch is per-request-root** — watchers start lazily on the first `wolf_*` call for a root and stay for the plugin lifetime; roots that are never queried are never watched.
- **Digest injection depends on the agent lifecycle** — `agent/session-start` fires once per session lifecycle; sessions resumed from a persisted log skip the digest (history is intact, matching OpenWolf's resume behavior).

## License

MIT — an independent implementation of the code-map/context-brain idea, with no code from any AGPL-licensed project.
