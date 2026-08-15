<p align="center">
  <strong style="font-size:28px">dsh-openwolf</strong>
</p>

<p align="center">
  <strong>The second brain for DeepSeek Harness.</strong>
</p>

<p align="center">
  Improved context management, a pre-indexed project map, and smarter token utilization,<br />
  delivered through invisible harness hooks. Zero workflow changes.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-openwolf"><img src="https://img.shields.io/npm/v/dsh-openwolf?color=cb3837&label=npm" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/dsh-openwolf"><img src="https://img.shields.io/npm/dm/dsh-openwolf?color=2ea44f&label=downloads" alt="npm downloads" /></a>
  <a href="https://github.com/hawk2048/dsh-openwolf/stargazers"><img src="https://img.shields.io/github/stars/hawk2048/dsh-openwolf?color=444&label=stars" alt="GitHub stars" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D20-2ea44f" alt="Node.js" /></a>
</p>

<p align="center">
  <a href="#quick-start"><b>Quick Start</b></a> &nbsp;&middot;&nbsp;
  <a href="#what-it-creates"><b>What It Creates</b></a> &nbsp;&middot;&nbsp;
  <a href="#initialize-and-keep-it-fresh"><b>Initialize</b></a> &nbsp;&middot;&nbsp;
  <a href="#how-it-works"><b>How It Works</b></a> &nbsp;&middot;&nbsp;
  <a href="#token-intelligence"><b>Token Intelligence</b></a> &nbsp;&middot;&nbsp;
  <a href="#dashboard"><b>Dashboard</b></a> &nbsp;&middot;&nbsp;
  <a href="#commands"><b>Commands</b></a> &nbsp;&middot;&nbsp;
  <a href="CHANGELOG.md"><b>Changelog</b></a>
</p>

English | [中文](README-zh.md)

---

| Without dsh-openwolf | With dsh-openwolf |
|---|---|
| The agent rereads a file it already saw (~2,000 tokens) | It reads the one-line description first, or skips the read entirely |
| Whole-file reads just to find one function | Symbol-level hints give exact line ranges for `offset`/`limit` reads |
| Context compaction wipes what the session did | A PreCompact snapshot and restore keep the work in context |
| Every session starts from a cold prompt | A budget-capped session digest preloads goals, known mistakes, recent fixes, and the project map |
| No idea where your tokens went | Usage measured from the harness token meter, plus a live local dashboard |

---

## Why dsh-openwolf?

Coding agents are powerful but they work blind. An agent does not know what a
file contains until it opens it. It cannot tell a 50-token config from a
2,000-token module. It rereads the same file in one session without noticing,
forgets your corrections between sessions, and loses everything when its
context window compacts.

dsh-openwolf gives the harness a second brain that fixes all of that —
inspired by [OpenWolf](https://github.com/cytostack/openwolf) for Claude Code,
implemented from scratch as a **native DeepSeek Harness plugin** (MIT, no code
from the AGPL reference):

- **Context management.** A budget-capped digest of your project's most
  valuable state (current goals, known mistakes, fixed bugs, the project map)
  is injected at every session start. A compaction snapshot plus a
  compaction-aware restore mean context compaction no longer erases what the
  session already did.
- **Architecture scaffolding.** A durable, self-healing project index maps
  every file with a description, a token estimate, and (for large files) its
  functions and classes with exact line ranges. Agents navigate your codebase
  instead of rediscovering it.
- **Token utilization.** Repeated reads are caught, whole-file reads become
  targeted slice reads, and real usage is measured from the harness token
  meter so you can verify the savings instead of trusting an estimate.

## Quick Start

```bash
dsh plugin --profile web add dsh-openwolf    # install into your profile
dsh web                                      # restart (or restart the GUI)
```

That is it. There is nothing to initialize and nothing to configure: on the
first session the plugin scans the workspace once, keeps the map fresh from
then on, and works underneath — use the harness exactly as you always have.

**Even simpler: just ask the harness to do it.** Start a session and say:

> 帮我把 dsh-openwolf 装进当前 profile，然后重启生效。

The agent runs the `dsh plugin` command for you and tells you when to restart.
Works from the Web GUI or the `headless` profile.

The `wolf` CLI also works standalone once the package is installed anywhere
(see [Commands](#commands)):

```sh
npx wolf init . && npx wolf scan .
```

Installing from a git URL or a local checkout needs extra build
authorization — see [Installing from Source](docs/INSTALL-FROM-SOURCE.md) for
that path.

## What It Creates

The first scan creates a `.wolf/` directory in your workspace:

| File | Purpose |
|------|---------|
| `anatomy-index.json` | Durable project index: descriptions, token estimates, content hashes, symbols |
| `anatomy.md` | Human-readable render of the index, kept in sync automatically |
| `cerebrum.md` | Learned preferences, corrections, Do-Not-Repeat list |
| `memory.md` | Chronological action log with token estimates |
| `STATUS.md` | Session handoff: resume any session in one small read |
| `buglog.json` | Bug fix memory, searchable, prevents rediscovery |
| `token-ledger.json` | Measured token usage, per session and per agent |
| `hooks/` | Session state, scan state (git HEAD pin), precompact snapshots |
| `config.json` | Configuration, including the session-digest budget |
| `OPENWOLF.md` | The operating protocol your agents follow |

## Initialize and Keep It Fresh

**Nothing needs manual setup** — the plugin initializes the brain lazily on
its first use in a workspace and rescans automatically:

- **First contact**: the first `wolf_*` tool call (or the first session with
  `injectAgentsMd`) creates `.wolf/`, scans the workspace once, and injects
  the map into `AGENTS.md`. No `init` step required.
- **Auto-refresh**: a debounced watcher rescans on file changes; `write`/`edit`
  results re-analyze the single changed file immediately, so the map and
  `anatomy.md` stay fresh while you work.
- **Session-start digest**: every new session gets a budget-capped digest
  (STATUS 🚀 / Do-Not-Repeat / recent bugs / anatomy pointer) plus a
  staleness warning when the scan is old or the git HEAD moved.

When you do want explicit control, everything is one command (also available
as tools inside a session):

| You want to… | Command (CLI) | Tool (in session) |
|---|---|---|
| Rebuild the whole index from disk now | `wolf scan` | `wolf_refresh` |
| Verify the index still matches the filesystem (CI-friendly) | `wolf scan --check` | `wolf_scan` |
| Initialize `.wolf/` by hand (idempotent, rarely needed) | `wolf init` | `wolf_init` |
| Write/read the session handoff doc | `wolf status` | `wolf_status` |
| Update every registered project (with backup first) | `wolf update` | — |
| Roll back `.wolf/` from a timestamped backup | `wolf restore` | — |
| Schedule unattended rescans (zero token) | `wolf cron add … scan` | `wolf_schedule` |

> **Tip**: you rarely need any of this — the plugin's job is to make the
> brain self-maintaining. Run `wolf scan` only when you changed many files
> outside the harness (e.g. a big `git pull`) and want the map rebuilt
> immediately.

## How It Works

```
Session starts
    |
The plugin injects a token-budgeted digest: current goals, known mistakes,
recent bug fixes, project map pointer
    |
Agent decides to read a big file
    |
The plugin: "auth.ts (~2,900 tok). Symbols: validateToken L82-140 ~450 tok.
Read with offset/limit to fetch just the part you need."
    |
Agent edits files
    |
The plugin updates the index under a cross-process lock, logs the action,
and refreshes the changed file's entry
    |
Context compacts mid-session
    |
The plugin snapshots state before compaction and re-injects a digest of the
files already modified, so the agent does not redo finished work
    |
Session ends
    |
The plugin reads the real token usage from the harness token meter into
the ledger
```

The harness preloads the code map through the built-in `agent-instructions`
plugin: the plugin maintains a marker-fenced block inside your workspace
`AGENTS.md` (your own content is never touched, an identical block is never
rewritten), so every session starts with the map already in context.

## Context Management

- **Session digest.** The highest-value state is pushed into the model's
  context at session start, capped to a configurable token budget. Section
  costs are priced with the harness token meter's heuristic when available.
  The model gets what it needs without reading six files.
- **Compaction survival.** A `compaction/start` snapshot; after compaction the
  digest lists the files already modified with a pointer to the action log.
  Resume and compaction no longer reset tracking.
- **Staleness detection.** Scans pin the git HEAD. If the HEAD moves or the
  scan ages out, the agent is told to rescan before trusting the map. A wrong
  index is never silently trusted.
- **STATUS.md handoff.** End-of-phase state lives in one small document, so a
  fresh session reaches productive context in a single read.
- **Housekeeping reminders.** Sparse cerebrum → use `wolf_learn`; empty
  buglog → use `wolf_bug`. The plugin nudges, the model feeds the brain.

## Project Anatomy

The index is a durable store (`anatomy-index.json`) with a rendered,
human-readable view (`anatomy.md`). Writers coordinate through a
cross-process lock, so concurrent hook fires cannot lose entries. Edits made
to the markdown by hand are detected by content hash and absorbed additively.

Files above 500 estimated tokens also index their top-level symbols:

```
- `shared.ts` (~3,200 tok)
  - fn `parseAnatomy` L82-104 (~180 tok)
  - fn `serializeAnatomy` L106-129 (~200 tok)
```

Before the agent reads a large file, the hint lists the biggest symbols with
line ranges so it can fetch one function with offset/limit instead of the
whole file. Hints are suppressed automatically if the file changed since
indexing; a stale range is never allowed to misdirect a read. Symbol support
today: TypeScript, JavaScript, Python, Go, Rust, Java (lezer CST parsing,
optional dependencies — other languages fall back to the regex heuristic).

## Token Intelligence

Estimates are useful; measurements are trustworthy. The plugin reads real
usage from the harness token meter (`ctx.tokenMeter`, provider-reported) and
upserts it into the ledger per session:

```bash
wolf report
```

```
token ledger: 12 sessions
measured (harness token meter): ~1,549,658 tokens
estimated (heuristic): ~1,420,011 tokens
current session: ~57,489 tokens
```

**Measured A/B in DeepSeek Harness** (same 1-read/1-edit task on identical
3-file fixtures, provider-reported totals):

| Run | Reads | Edits | Billed tokens |
| --- | --- | --- | --- |
| with dsh-openwolf | 1 | 1 | 39,164 |
| without | 1 | 1 | 35,488 |
| **delta** | | | **+3,676 (+10%)** |

**Reading this honestly**: on a minimal one-read task the plugin is a *net
overhead* — its fixed costs dominate. The savings mechanism (avoiding
re-reads, offset/limit reads, map-first navigation) only pays off once a
session reads multiple files or re-reads the same file. The reference
project's field data (heuristic estimates) averaged **~65.8% token reduction
across 20 projects / 132 sessions, with 71% of repeated reads caught**.
Expect the plugin to **break even once a session touches a handful of files
or runs long**.

What the plugin adds per session:

| Component | Per | Size |
| --- | --- | --- |
| Session digest (+ housekeeping reminder) | session start | ≤ 1,500 tokens (config) |
| `AGENTS.md` map block (when `injectAgentsMd`) | session baseline | ≤ `maxMapBytes` (16 KiB ≈ 4k tokens) |
| 10 `wolf_*` tool schemas | every request | ≈ 1–2k tokens (KV-cache prefix-stable) |
| 2 skill catalog entries | session baseline | ≈ 100 tokens |

For one-shot tiny tasks, consider `digestEnabled: false` /
`injectAgentsMd: false` / a smaller `maxMapBytes`.

## Security

- The dashboard binds to 127.0.0.1 and requires a per-project token
  (timing-safe comparison) for all API access; the token may live in a
  `--token-file` (created `chmod 600`) so it never appears on argv.
- Every dynamic process invocation uses argument arrays; no shell
  interpolation anywhere.
- Path traversal guards on all file access.
- Secret-bearing files (keys, keystores, credential files, `.npmrc`, `.env`
  and friends) never enter the index, hints, or logs; templates
  (`.env.example`) stay indexable.
- A security regression suite runs with `pnpm test`.

## Bundled Skills

Two skills register into the harness skill catalog:

- **`wolf-security-audit`** — layered audit (dependencies → secrets →
  injection surfaces → authorization) ending in a severity-ranked report wired
  into `.wolf/buglog.json`.
- **`wolf-reframe`** — the design brain. Pick or migrate a UI framework from a
  13-framework knowledge base, or audit/fix existing UI against an
  anti-generic design mandate: distinctiveness is an acceptance criterion, and
  the recognizable AI-generated look is a failure state.

## Dashboard

```bash
wolf daemon start
wolf dashboard
```

A local, token-authenticated dashboard: measured vs estimated tokens,
context health (scan freshness, pinned git HEAD, digest budget), session
handoff, live activity, cron control, and the anatomy browser with per-file
symbols. Panels are deep-linkable (`/#tokens`). The page is live — an SSE
stream re-renders the active panel the moment a brain file changes, with a
30s poll as fallback when the stream drops.

## Commands

All commands take an optional directory (default: current working directory).
They are grouped by what you are trying to do:

**Brain lifecycle**

| Command | What it does | When to use it |
|---|---|---|
| `wolf init [dir]` | Create `.wolf/` (idempotent) | Usually unnecessary — the brain initializes itself on first use |
| `wolf scan [dir]` | Rebuild the project index, render `anatomy.md`, inject `AGENTS.md` | After a big change outside the harness (e.g. `git pull`) when you want the map rebuilt now |
| `wolf scan --check [dir]` | Verify the index matches the filesystem (size/mtime + git HEAD) | CI or pre-session verification; exits 1 on drift |
| `wolf status [dir]` | Brain health: config, scan state, ledger, memory/buglog counts | "Is my brain healthy?" |
| `wolf report [dir]` | Token ledger summary: measured vs estimated per session | Understanding where tokens went |

**Memory and bugs**

| Command | What it does | When to use it |
|---|---|---|
| `wolf bug search <term>` | Search `.wolf/buglog.json` | Before re-debugging something that may already be fixed |
| `wolf register [dir]` | Add the workspace to the global project registry | Enables `wolf update` across all your projects |
| `wolf unregister [dir]` | Remove it from the registry | Cleanup |
| `wolf update` | Backup + rescan every registered workspace | Refresh all indexed projects at once |

**Backups**

| Command | What it does | When to use it |
|---|---|---|
| `wolf backups [dir]` | List timestamped `.wolf/` backups | See what you can roll back to |
| `wolf restore [dir] [tag]` | Restore `.wolf/` from a backup (newest by default) | After an experiment went wrong |

**Scheduling and serving**

| Command | What it does | When to use it |
|---|---|---|
| `wolf cron add <name> '<expr>' <scan\|check> [dir]` | Schedule a zero-token task (cron syntax, `@daily` etc.) | Unattended refreshes: e.g. nightly `scan` |
| `wolf cron list [dir]` / `wolf cron run <id>` / `wolf cron remove <id>` | Manage scheduled tasks | Inspect or trigger tasks by hand |
| `wolf dashboard [dir]` | Serve the web dashboard in the foreground (`--port`, `--token`, `--token-file`) | Live overview of tokens / context / anatomy |
| `wolf daemon start [dir]` / `wolf daemon stop` | Run dashboard + cron scheduler as a background daemon | Keep the dashboard and scheduled tasks running without a terminal |

Every command also exists as a session tool (`wolf_map`, `wolf_file`,
`wolf_refresh`, `wolf_scan`, `wolf_init`, `wolf_status`, `wolf_learn`,
`wolf_bug`, `wolf_report`, `wolf_schedule`) — the model can do all of this
itself, so the CLI is only for humans, scripts, and cron.

## Requirements

- Node.js 20+
- A DeepSeek Harness profile (any: `web`, `headless`, …)
- Windows, macOS, or Linux

## Config

Everything is schema-validated with sane defaults; nothing needs configuring.
Override any option in your profile's `cordis.patch.yml` (row id `openwolf`):

```yaml
- id: openwolf
  config:
    maxMapBytes: 16384        # cap on the injected/returned map text (bytes)
    maxFileBytes: 65536       # files larger than this are listed, not opened
    maxFiles: 4000            # hard cap on scanned files per workspace
    watch: true               # debounced watcher rescans on file changes
    injectAgentsMd: true      # maintain the AGENTS.md managed block
    useGitignore: true        # honor the root .gitignore
    symbols: true             # extract top-level symbols
    symbolBackend: auto       # auto | regex | lezer (CST parsing)
    sessionDigestBudgetTokens: 1500   # cap on the injected session digest
    rescanIntervalHours: 6    # staleness window before a rescan warning
    symbolThresholdTokens: 500        # files above this get symbol line-range hints
    digestEnabled: true       # inject the session digest on session start
    interceptReads: true      # repeated-read warnings + anatomy hints
    interceptWrites: true     # action log + single-file index refresh
    compactionSurvival: true  # snapshot + restore digest on compaction
    skillsEnabled: true       # register wolf-security-audit + wolf-reframe
    autoRescanMinutes: 0      # auto-rescan cached roots every N minutes (0 = off)
```

A later layer can override the whole row by `id`, so deployments keep their
own defaults.

## Limitations

- **Measured vs estimated** — measured figures come from the harness token
  meter and are exact; heuristic estimates are a char-ratio approximation.
- **Multi-agent wiring is N/A** — the reference hooks five external agents
  (Claude Code/Codex/OpenCode/Gemini/Cursor); DSH is the agent platform
  itself, so one brain serves every DSH session and subagent.
- **The cron engine is self-contained** — zero token per run, chosen
  deliberately over the harness's model-facing scheduler (which burns an LLM
  turn per trigger).
- **Dashboard is a server-rendered single page** (zero deps) with a panel
  subset, not a React SPA.
- **Root-level `.gitignore` only** — nested `.gitignore` files and
  `git check-ignore` exactness are not supported yet.
- **Read hints ride the result** — `tools/post-execute` attaches hints as
  result context (DSH has no pre-read seam yet).
- **Digest injection depends on the agent lifecycle** — sessions resumed from
  a persisted log skip the digest (history is intact, matching OpenWolf's
  resume behavior).
- Found something broken? [File an issue](https://github.com/hawk2048/dsh-openwolf/issues).

## Development

```sh
pnpm install
pnpm build        # tsc → lib/
pnpm test         # node --test, in-process
```

The package is **erasable TypeScript** with `rewriteRelativeImportExtensions`,
so `node` can run `src/` directly for tests while `tsc` emits the ESM `lib/`
for publication. `prepare` builds from source, which is what makes git-based
installs work. For running a local checkout inside a real harness profile,
see [Installing from Source](docs/INSTALL-FROM-SOURCE.md).

## License

MIT — an independent implementation of the code-map/context-brain idea, with
no code from any AGPL-licensed project. Built for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).
