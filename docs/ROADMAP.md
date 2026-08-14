# dsh-openwolf v0.2 Roadmap

Status: proposal — not yet implemented. This document is the design contract for
the next minor release. Everything here is backward compatible with v0.1
config, tool names, and public library functions.

## 1. Why v0.2

Derived from the v0.1 "Known Limitations" plus two findings from the v0.1
verification runs (unit/integration/headless):

| # | Pain point | Evidence |
| --- | --- | --- |
| A | No `ctx.openwolf` service — other plugins cannot consume the indexer | v0.1 registers tools from a closure; library functions are exported but there is no Cordis service seam |
| B | Watcher can keep the process alive after a one-shot task | headless profile run did not exit; chokidar `FSWatcher` has no `unref()` |
| C | Regex symbol extraction misses nested/unusual declarations | `symbols.ts` heuristic table, 9 language families |
| D | Root-level `.gitignore` only; no nested files, no exact git semantics | `ignore.ts` loads a single root file |
| E | Single instruction file | `agentsMdFile: string` |
| F | Maps truncate from the head, so deep repos lose the file list first | `renderMap` slices `text.slice(0, maxBytes)` |
| G | No UI cards / no background scanning for huge repos | tools have no `presentCall`/`presentResult`; scans block a tool call |

## 2. Goals

1. **Service seam** — expose `ctx.openwolf` (Service Definition + Provider), move
   the model tools into a consumer row so the service is usable without tools.
2. **Process-lifetime correctness** — never keep a one-shot process alive;
   freshness without a persistent watcher by default.
3. **Real parsing** — optional tree-sitter-class symbol backend with zero native
   dependencies (lezer), regex stays as fallback.
4. **Git-correct ignores** — nested `.gitignore` scoping + optional
   `git check-ignore` exact mode.
5. **Multiple instruction files**, **smarter truncation**, **tool cards**,
   **background scans**.

## 3. Architecture

### 3.1 Service seam (`ctx.openwolf`)

The plugin becomes a Cordis **Service** (class form). Tool registration moves to
a second plugin module in the same package (`dsh-openwolf/tools`) that consumes
the service — mirroring the harness's Service Definition / Provider / Consumer
convention (docs: `capability-seams.md`, `adding-a-package.md`).

```ts
declare module '@deepseek-ai/cordis' {
  interface Context { openwolf: OpenWolfService }
}

export class OpenWolfService extends Service {
  constructor(ctx: Context, config: Config) { super(ctx, 'openwolf') /* ... */ }

  /** Current map for a root (staleness-checked; rescans when stale). */
  map(root: string, opts?: MapQueryOptions): Promise<CodeMap>
  /** Force a rescan + optional instruction-file injection. */
  refresh(root: string, opts?: RefreshOptions): Promise<RefreshResult>
  /** Bounded digest for one file. */
  digest(root: string, relPath: string, opts?: DigestOptions): Promise<FileDigest>
  /** Subscribe to map updates (called on every rescan). */
  onUpdate(listener: (root: string, map: CodeMap) => void): () => void
  /** Explicitly start a watcher for a root; returns a disposer. */
  watch(root: string): () => Promise<void>
}
```

`cordis.patch.yml` inserts two rows:

```yaml
- insert:
    - id: openwolf
      name: dsh-openwolf
      config: { /* service config */ }

    - id: tool-openwolf
      name: 'dsh-openwolf/tools'
      inject: [openwolf, tools]
      config: { /* tool-only config, e.g. enable/disable per tool */ }
```

Backward compatible: `wolf_map` / `wolf_file` / `wolf_refresh` keep their names
and schemas; `scanCodebase`, `summarizeFile`, `renderMap`, `injectBlock` remain
public library functions.

### 3.2 Freshness without a persistent watcher (fix B)

Replace the chokidar-always-on model with two complementary mechanisms:

- **Staleness check (default, no handles):** each scan records a cheap
  fingerprint of the root (mtime + size of the root dir and one level of
  entries, or `stat` of up to N random files). `map()` re-scans only when the
  fingerprint changed. Cost: one `stat` burst per call, no process lifetime.
- **Explicit watcher (opt-in for server surfaces):** `openwolf.watch(root)`
  starts a watcher and returns a disposer. The watcher implementation moves
  from chokidar to `node:fs.watch` with **recursive** support where available
  (Windows/macOS) and `.unref()` on every handle, so it never blocks process
  exit; on Linux (no recursive watch) the watcher degrades to a
  polling/staleness timer that is also `unref()`'d. Config `watch` becomes
  `watch: 'off' | 'on-demand' | 'always'` (default `'on-demand'`: web surfaces
  call `openwolf.watch(root)` at first tool use; one-shot processes never do).
  `watch: true` from v0.1 maps to `'always'` (kept for compat).

Integration test added: boot a minimal composition, run one tool call, assert
the process can exit without an explicit kill.

### 3.3 Symbol backend: lezer, optional (fix C)

Introduce `symbolBackend: 'auto' | 'regex' | 'lezer'` (default `auto`).

- **lezer** (`@lezer/*` grammars, pure JS, no native builds): TypeScript/JS,
  Python, Java, C/C++, Rust, Go, PHP, JSON, YAML, CSS, HTML, Markdown. Extract
  top-level declarations via CST node names (`FunctionDeclaration`,
  `ClassDeclaration`, `VariableDeclaration`, …) with line ranges and optional
  signatures.
- `regex` stays as the fallback for languages without a lezer grammar and when
  `symbolBackend: 'regex'` is forced.
- Output evolves from `string[]` to `SymbolEntry[]`:

```ts
export interface SymbolEntry {
  name: string
  kind: 'function' | 'class' | 'const' | 'type' | 'enum' | 'method' | 'other'
  line: number
  endLine?: number
  signature?: string   // e.g. "createApp(options: AppOptions): App"
}
```

`FileEntry.symbols` keeps a plain `string[]` projection for the map renderer;
`wolf_file` gains the richer `SymbolEntry[]` (`symbols` param becomes an array
of objects under a new field name to avoid breaking the schema — see §6).

### 3.4 Git-correct ignores (fix D)

- **Nested `.gitignore`:** during the walk, each directory's `.gitignore` is
  parsed and scoped to that directory (rules evaluated with the directory as
  the anchor). Cache parsed rule sets per directory.
- **Exact mode:** `useGitignore: 'auto' | 'local' | 'git'` (default `'auto'`).
  In `'git'` mode (and in `'auto'` when `git` is available and the root is a
  repo), the scanner uses `git check-ignore --stdin -z` in one batched spawn to
  get exact semantics (`!` re-inclusion, global excludes, `info/exclude`);
  `'local'` forces the built-in matcher (now with nested scoping).
- The built-in matcher additionally implements: escaped `\#`/`\!`, trailing
  spaces handling, and `**` mid-pattern cases that v0.1 approximated.

### 3.5 Multiple instruction files (fix E)

`agentsMdFile: string` → `agentsMdFiles: string[]` (default `['AGENTS.md']`).
`agentsMdFile` stays as a deprecated alias for the first element. Injection is
idempotent per file; a file missing the markers gets the block appended once.

### 3.6 Smarter truncation (fix F)

`renderMap` gains value-aware budgeting instead of head-slicing:

1. Always keep the header line (counts + timestamp).
2. Keep every directory heading.
3. Keep file lines, but trim per-file detail in order: summary → symbols →
   line count → path prefix elision; if still over budget, drop the longest
   file lines first while preserving at least one line per directory.
4. Emit a trailing `… N entries omitted` note (already present) plus a
   `truncation: 'detail' | 'files'` flag so the model knows the map is partial.

### 3.7 Tool cards + background scans (fix G)

Following the `adding-a-tool.md` contract:

- `wolf_map`: `presentCall` → generic card with `locations: []`; `presentResult`
  → generic card carrying the map text; `presentationMeta` persists
  `{ root, version }` so replay reproduces the card.
- `wolf_file`: `presentResult` → `search`-shape card (`shape: 'matches'`,
  grouped by file = single entry) or `generic` with `locations: [{ path }]`;
  `presentationMeta` persists the digest fields.
- `wolf_map` gains `run_in_background: boolean`: when the producer config
  `allowBackground` is true, scans above `maxFiles` run through `ctx.jobs`
  (`kind: 'openwolf.scan'`), returning `{ kind: 'background', jobId }`; the
  job writes the map into the cache on completion. `job_*` tools collect it.

### 3.8 Map query options

`wolf_map` parameters grow (all optional, defaulting to current behavior):

- `refresh` (existing), `maxBytes` (existing)
- `dir` — restrict the map to one relative directory
- `format: 'compact' | 'detailed'` — `detailed` includes signatures
- `run_in_background` (see §3.7)

## 4. Config delta (all additive)

| Field | v0.1 | v0.2 | Default |
| --- | --- | --- | --- |
| `agentsMdFile` | `string` | deprecated alias | — |
| `agentsMdFiles` | — | `string[]` | `['AGENTS.md']` |
| `watch` | `boolean` | `'off' \| 'on-demand' \| 'always'` | `'on-demand'` |
| `symbolBackend` | — | `'auto' \| 'regex' \| 'lezer'` | `'auto'` |
| `useGitignore` | `boolean` | `'auto' \| 'local' \| 'git'` | `'auto'` |
| `allowBackground` | — | `boolean` | `false` |
| `maxMapBytes`, `maxFileBytes`, `maxFiles`, `ignore`, `hidden`, `symbols`, `debounceMs`, `sortBy` | unchanged | unchanged | — |

Schemastery validation rejects unknown values (e.g. `watch: true` is coerced to
`'always'` for v0.1 compat).

## 5. Dependencies

New runtime deps (all zero-native, ESM-friendly):

- `@lezer/javascript`, `@lezer/python`, `@lezer/java`, `@lezer/cpp`,
  `@lezer/rust`, `@lezer/go` (or a thin adapter that lazy-loads them only when
  `symbolBackend` resolves to `lezer` for that language) — peer-optional:
  the package works with `regex` when the grammars are absent.

chokidar moves from a hard dependency to an optional peer for the `'always'`
watch mode; the default `'on-demand'` watcher uses `node:fs.watch` only.

## 6. Breaking-change policy

- Tool **names** unchanged; tool **argument schemas** only additive.
- `wolf_file` result: `symbols` (array of strings) is kept; a new
  `symbolDetails` field carries `SymbolEntry[]`.
- Library API: new optional params; existing signatures unchanged.
- Config: old keys keep meaning; `watch: true` coerced.
- Therefore: **v0.2 is a minor release** (0.2.0), shipped as `v0.2.0-rc.1`
  first, verified against the `web` and `headless` profiles, then `v0.2.0`.

## 7. Testing plan

- **Backend parity:** for each supported language, a fixture file whose
  expected symbols are asserted identically under `regex` and `lezer`
  (golden tests).
- **Nested gitignore matrix:** negation, escaped chars, dir-scoped rules,
  `**` mid-pattern, `info/exclude` (git mode, when git available).
- **Freshness:** fingerprint staleness unit tests (change a file → map stale →
  next `map()` rescans).
- **Process exit:** integration test proving a one-shot composition exits
  after the tool call (fix B regression).
- **Service seam:** a second plugin consumes `ctx.openwolf` in the integration
  harness and asserts service methods.
- **Tool contract:** schema validation of new params; `presentationMeta`
  replay round-trip via `tools/result` persistence.
- **Background:** jobs-based scan with `run_in_background` and `job_*`
  collection.

## 8. CI (new)

GitHub Actions workflow: `pnpm install` → `typecheck` → `test` (node --test)
→ `pack` (assert `lib/`, `cordis.patch.yml`, READMEs in the tarball) on
node 20 / 22 / 24, Windows + Ubuntu. Publish job (manual trigger) runs
`pnpm publish` with the npm token secret.

## 9. Milestones

| Milestone | Scope | Est. |
| --- | --- | --- |
| **M1** | §3.1 service seam + tool-row split; §3.2 freshness/watcher + process-exit test; §4 config delta | core |
| **M2** | §3.3 lezer backend + parity tests | symbols |
| **M3** | §3.4 nested gitignore/git mode; §3.5 multi-file injection; §3.6 truncation | correctness |
| **M4** | §3.7 cards + background scans; §8 CI | polish |
| **M5** | `v0.2.0-rc.1` → profile verification → `v0.2.0` | release |

P0 for the author: M1. Everything after M1 is independent of it and can be
picked up in any order.

## 10. Out of scope for v0.2

- Tree-sitter query-based semantic search / dependency graph (a v0.3 "code
  graph" direction, closer to CodeGraph's feature set).
- Vector embeddings / semantic retrieval.
- Remote/sandboxed scanning providers (the service seam makes this possible
  later, but no provider ships in v0.2).
- Client-side UI beyond the standard tool cards.
