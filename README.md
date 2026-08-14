# dsh-openwolf

English | [中文](README.zh.md)

A compact code-map **"second brain"** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It pre-indexes your workspace into a small, dense map — file tree, per-file one-line summaries, and top symbols — injects it into `AGENTS.md` so every session starts with the map, and gives the model three tools (`wolf_map`, `wolf_file`, `wolf_refresh`) so it stops re-reading whole files.

Inspired by the token-saving idea behind [OpenWolf for Claude Code](https://github.com/cytostack/openwolf) ("sharper context, fewer tokens"), implemented from scratch as a native DSH plugin — no MCP server, no external CLI, no build step for users.

- **Zero-config drop-in**: one bundle row; the harness preloads the map via `AGENTS.md` automatically.
- **Dependency-light**: `chokidar` for watching + `schemastery` for config; everything else is `node:fs`.
- **Workspace-aware**: the map follows the session workspace, never a hard-coded path.
- **Fresh by default**: a debounced watcher rescans and re-injects on file changes.

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

Three native tools appear in every session:

| Tool | Purpose |
| --- | --- |
| `wolf_map` | The compact code map for the current workspace (optionally force a rescan with `refresh`). |
| `wolf_file` | A bounded digest of one file: language, size, line count, top symbols, and a preview — instead of reading the whole file. |
| `wolf_refresh` | Force a rescan and re-inject the map into `AGENTS.md` after large structural changes. |

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

- **Scanner** (`src/scanner.ts`): walks the workspace with a gitignore-lite matcher (negation, `**`, anchored patterns, directory rules), a file budget, and a size cap; skips binaries and over-large files; extracts per-file symbols and one-line summaries; aggregates per-directory counts.
- **Renderer** (`src/render.ts`): groups entries by directory into a bounded Markdown map and manages the `AGENTS.md` block (create / replace / preserve, idempotent).
- **Plugin** (`src/index.ts`): caches maps per workspace root, lazily starts a debounced chokidar watcher, resolves the workspace from the calling agent's session (`agent.session.header.cwd`), and registers the three tools on `ctx.tools`. Every registration is an effect: unloading the plugin (config edit, HMR, restart) unwinds watchers, timers, and tools.

The scanner/analyzer is dependency-free and exported for reuse; `scanCodebase`, `summarizeFile`, `renderMap`, and `injectBlock` are public API.

## Model Experience

### Request context and condition

#### What the model sees

Three tool schemas (`wolf_map`, `wolf_file`, `wolf_refresh`) with the descriptions above, plus — when `injectAgentsMd` is enabled and the session workspace has an `AGENTS.md` — a managed `# Code Map` block preloaded by the harness's `agent-instructions` plugin. The block is capped at `maxMapBytes` and replaced only when the underlying map changes.

#### Token effect

The injected block is retained context charged once per session baseline, bounded by `maxMapBytes` (default 16 KiB). `wolf_map` returns up to `maxBytes` (or `maxMapBytes`) on demand; `wolf_file` returns a bounded digest instead of a whole file. Net effect vs. re-reading files: one fixed map read replaces N repeated whole-file reads, which is the token-reduction mechanism of the plugin.

#### KV Cache effect

Prefix-stable while the map is unchanged: identical `AGENTS.md` content reproduces an identical request prefix. A rescan that changes the map (file edits, new files) replaces the block and invalidates reuse from the first changed token — the same behavior as any `AGENTS.md` edit. Tool-call results are append-only and do not invalidate earlier prefixes.

## Known Limitations and Deferred Work

- **Heuristic symbols** — symbol extraction is regex-based per language family, not a real parser; nested or unusual declarations may be missed. A tree-sitter backend is the natural v2.
- **Root-level `.gitignore` only** — nested `.gitignore` files and `git check-ignore` exactness (e.g. `!` re-inclusion inside pruned directories) are not supported yet.
- **Single instruction file** — the managed block lives in one file (`agentsMdFile`); multiple instruction files are not maintained simultaneously.
- **No service export** — v0.1 registers tools from the plugin closure; the indexer is exported as library functions, but there is no `ctx.openwolf` service for other plugins to consume. That is the v0.2 seam.
- **Watch is per-request-root** — watchers start lazily on the first `wolf_*` call for a root and stay for the plugin lifetime; roots that are never queried are never watched.

## License

MIT — an independent implementation of the code-map idea, with no code from any AGPL-licensed project.
