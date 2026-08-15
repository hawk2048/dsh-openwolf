# Changelog

All notable changes to **dsh-openwolf** are tracked here. The project follows a
`0.x.0` minor-release cadence; `rc` builds are released to the `rc` npm tag and
promoted to `latest` when verified. Version history follows
[Keep a Changelog](https://keepachangelog.com/) loosely (added / changed / fixed).

## [0.8.12] — 2026-08-15

### Changed

- **`dshwolf harness add` output is now one clean line** — the intermediate
  "wired …", "installing into …" and the raw `pnpm install` output are gone;
  success prints exactly
  `✓ dsh-openwolf@<v> installed into profile '<name>'. Restart the harness (dsh web) to activate it.`
  (`--no-install` prints a one-line "run pnpm install in … to finish"). The
  install runs via `cmd.exe /c pnpm …` on Windows — argument-array spawn, no
  `shell:true` and no shell-string execution, keeping the security audit
  suite green (it caught the first two attempts).

## [0.8.11] — 2026-08-15

### Added

- **`dshwolf harness add` is now one-command wiring** — it edits the profile's
  `package.json` (dependencies + bundles) **and runs `pnpm install` for you**
  (mirroring `openwolf init --agent` doing the whole setup in one shot), then
  prints "restart the harness". `--no-install` edits only (CI/scripts).
  Verified live: `harness add web` wired + installed `dsh-openwolf@0.8.10`
  into the real web profile in one shot.

### Changed (docs)

- **Way 2 no longer needs the manual `cd … && pnpm install` step** — Quick
  Start (EN + zh) now shows: `harness status` → `harness add web` (wires +
  installs) → restart.

## [0.8.10] — 2026-08-15

### Changed (docs)

- **Quick Start reorganized as Way 1 / Way 2** — Way 1 (install into the
  harness, with the conversational alternative) and Way 2 (standalone CLI
  install) are now numbered and parallel in EN + zh. Way 2 now documents the
  complete "enable it in the harness" flow step by step: `dshwolf harness
  status` → `dshwolf harness add web` → `pnpm install` in the profile →
  restart, with the verified explanation of why the wiring step exists.
  Verified live against a scratch profile: `harness add` writes the
  dependency + bundle row exactly as documented.

## [0.8.9] — 2026-08-15

### Added

- **Subcommand help** — `dshwolf cron|daemon|bug|harness --help` (or `-h`, or
  just the bare group name) now prints that group's own usage block, matching
  OpenWolf's Commander behavior. The top-level help points at it
  (`dshwolf <command> --help`).

## [0.8.8] — 2026-08-15

### Changed

- **CLI renamed `wolf` → `dshwolf`** — the primary binary is now `dshwolf`
  (distinct from the unrelated `wolf@0.1.0` package on npm that `npx wolf`
  can accidentally pull). The old `wolf` name is kept as an alias, so
  existing scripts keep working. Usage text, `--version` output, and all
  CLI-facing docs (EN + zh) now show `dshwolf`. Session tools
  (`wolf_map` / `wolf_file` / …), the `.wolf/` directory, and
  `OPENWOLF.md` are **not** renamed — they are harness-facing names, not
  CLI commands.

## [0.8.7] — 2026-08-15

### Added

- **OpenWolf-style CLI ergonomics** — `wolf --help` / `-h` (grouped usage) and
  `wolf --version` / `-v` now work anywhere, and a bare `wolf` prints the
  help. The usage text is reorganized into the same grouping pattern as
  OpenWolf's Commander help (Brain lifecycle / Memory & bugs / Scheduling &
  serving / Registry & backups / Harness wiring), so the full command surface
  is discoverable without reading the README.

## [0.8.6] — 2026-08-15

### Added

- **`wolf harness status` / `wolf harness add [name]`** — the CLI can now
  detect which DSH profiles have `dsh-openwolf` wired (`status`) and wire it
  into a profile's `package.json` (`add`, default `web`), mirroring OpenWolf's
  `openwolf init` auto-wire step. After a standalone (`npm install -g`)
  install, this is the one-command bridge to the in-session experience
  (then `pnpm install` in the profile + restart). `DSH_WOLF_PROFILES_DIR`
  env-overridable for tests; 3 new unit tests.

### Changed (docs)

- **Option B clarified with a verified fact** — the README now states plainly
  that a global `npm install` is invisible to the harness (verified: a global
  copy is not resolvable from the profile's `node_modules`), that CLI and
  plugin share one `.wolf/` brain, and how OpenWolf's `openwolf init` wiring
  maps onto DSH's one-line profile registration. Both EN + zh.

## [0.8.5] — 2026-08-15

### Changed (docs)

- **Conversational install wording** — replaced the stilted "start a session
  and say…" instruction with the copy-paste-prompt pattern used by mainstream
  open-source projects (e.g. MCP server READMEs): a quoted, copyable prompt
  the user can drop straight into any session, plus what the agent will do
  ("installs the plugin and restarts for you"). The agent understands intent,
  not exact phrasing, so users are told they can reword it freely.

## [0.8.4] — 2026-08-15

### Changed (docs)

- **Quick Start adds an external-install path** — Option B documents the
  standalone `npm install -g dsh-openwolf` (or `--save-dev` in a project)
  route that gives you the `wolf` CLI without a harness profile, plus a
  "what you get after installing" table (in-session tools / automatic
  behavior / CLI commands / dashboard) so new users can discover every
  feature from the first page. Verified live: global install + `wolf init`
  + `wolf scan` work standalone.

## [0.8.3] — 2026-08-15

### Changed (docs)

- **Quick Start simplified** — the main README now shows only the two-line
  install plus the conversational "ask the harness to install it" path; the
  source/git-install method (including `allowBuilds`) moved to
  `docs/INSTALL-FROM-SOURCE.md` so casual readers are not confused by build
  authorization details.
- **New "Initialize and Keep It Fresh" section** — explains that the brain
  initializes itself on first use and stays fresh automatically (watcher,
  write-interception refresh, session-start digest), with a table mapping
  intent → CLI command → session tool for the rare explicit cases.
- **Commands section rewritten** — every `wolf` subcommand is grouped by use
  case (brain lifecycle / memory & bugs / backups / scheduling & serving)
  with a "when to use it" column.

## [0.8.2] — 2026-08-15

### Changed

- **npm README fix** — renamed `README.zh.md` to `README-zh.md` so npm's
  readme detection (`{README,README.*}` glob) picks the English `README.md`;
  the Chinese README ships via the `files` array instead.

## [0.8.1] — 2026-08-15

### Changed

- Ship the restructured READMEs (OpenWolf-style hero + Quick Start) and the
  new `CHANGELOG.md` in the npm tarball.

## [0.8.0] — 2026-08-15

First stable `0.x.0` release (no `-rc` suffix). OpenWolf v2.0.1 feature
replication is complete (23/23, see `docs/OPENWOLF-PORT.md`).

### Added

- **Dashboard Server-Sent Events (`/api/events`)** — the dashboard now pushes
  `refresh` events the moment a watched brain file (`token-ledger.json`,
  `memory.md`, `STATUS.md`, `buglog.json`, `cron-tasks.json`, `anatomy-index.json`,
  session/scan state) changes on disk. The client uses `EventSource` for
  near-instant updates and keeps the 30s poll as a fallback when the stream
  drops (the poll stops while SSE is live and resumes on error).
- **`CHANGELOG.md`** — this file.

### Changed

- **Session-digest budget pricing** — section costs are now priced with the
  harness token meter's heuristic (`ctx.tokenMeter.estimateMessage`) when
  available, falling back to the char-ratio estimator otherwise, so the digest
  budget behaves like the real request prefix.
- **Lezer grammars are optional** — the five `@lezer/*` grammars moved from
  `dependencies` to `optionalDependencies`. A missing grammar (e.g.
  `npm install --omit=optional`) now silently degrades that language to the
  regex backend instead of failing the scan; the failure is remembered per
  language so it is only attempted once per process.
- **Session-state pruning** — `hooks/_session.json` prunes itself on every
  write: read-tracking entries older than 24h are dropped and the written-files
  log is capped at the most recent 500 entries (edit counts follow), so
  long-lived sessions cannot grow the file forever.
- **Token-ledger cap** — `token-ledger.json` retains at most the 500 most
  recent session rows; the lifetime unique-session counter keeps counting, so
  long-lived profiles stay small while totals remain true.

### Added (CLI)

- **`wolf daemon start --token-file=…` / `wolf dashboard --token-file=…`** —
  persist a generated auth token to a file (created `chmod 600`, reused on
  restart) so the daemon and external clients share one token without it
  appearing on the process argv.

## [0.7.0] — 2026-08-15

Optimization round (measured on a 200-file fixture, see
`docs/REPLICATION-REVIEW.md`).

### Added

- **Concurrent scan pool** — file analysis runs across 8 workers: 55ms vs 94ms
  sequential (**1.71x**).
- **Lezer symbol threshold** — files below `symbolThresholdTokens` (default
  500) skip the CPU-bound CST parse and use the regex backend: 161ms → 55ms
  overall (**2.9x**), aligning with OpenWolf's "index symbols only above 500
  tokens" behavior.
- **git HEAD TTL cache** — HEAD lookups cached 30s: 20 lookups in 80ms instead
  of ~1.2s.
- **memory.md batching** — memory rows buffer and flush at ≥16 rows or ≥2s,
  turning burst writes into one disk write.
- **CLI `--json`** — `wolf status`, `wolf report`, `wolf scan --check` support
  machine-readable JSON output.
- **GitHub Actions CI** — node 20/22/24 × ubuntu/windows:
  install + typecheck + test + pack sanity.

## [0.6.0] — 2026-08-14

Replication P4 + B1 + F — full OpenWolf feature replication (23/23).

### Added

- **Cron engine** — zero-dependency 5-field parser with `@` shorthands and
  month/weekday names, minute-anchored scheduling, in-flight guard, durable
  tasks in `.wolf/cron-tasks.json`; `wolf cron add|list|run|remove` CLI.
- **`wolf_schedule` tool** — 0-token model-driven cron registration (a
  deliberate divergence from dsh-schedule, which burns an LLM turn per trigger).
- **Project registry** — `~/.dsh-wolf-registry.json` (env-overridable for
  tests), `wolf register|unregister|update`, timestamped backups,
  `wolf backups|restore`.
- **Durable anatomy index** — `anatomy-index.json` incremental refresh
  (re-analyze only drifted files) + `wolf_scan` integrity checks (size/mtime vs
  manifest, pinned git HEAD).
- **Security regression suite** — secret denylist (`.env*` + keys/keystores,
  template exemptions), path-traversal, timing-safe auth, cron file-access
  guards; the suite caught and fixed two real indexing bugs.
- **`OPENWOLF.md`** — the operating-protocol doc, written on `wolf init`.

## [0.5.0] — 2026-08-13

Replication P3 — standalone surface + dashboard.

### Added

- **Standalone CLI** — the `wolf` binary works without a running harness:
  `init`, `scan` (+`--check`), `status`, `report`, `bug search`.
- **Dashboard server** — zero-dependency `node:http` server bound to
  127.0.0.1 with timing-safe token auth (`?token=` or `Authorization: Bearer`);
  panels: overview, tokens, context health, anatomy, handoff, activity, bugs.
- **Daemon** — `wolf daemon start|stop`: dashboard + cron scheduler as a
  detached background process.
- **Auto-rescan** — `autoRescanMinutes` keeps cached roots fresh without tool
  calls.
- **Bundled skills** — `wolf-security-audit` and `wolf-reframe` register into
  the harness skill catalog (`skillsEnabled`).

## [0.4.0] — 2026-08-12

Replication P2 — symbol intelligence + integrity.

### Added

- **Lezer symbol backend** — pure-JS CodeMirror grammars (TS/JS, Python, Go,
  Rust, Java) extract top-level declarations with exact start/end lines and
  per-symbol token estimates; `symbolBackend: auto | regex | lezer` with
  backend-parity tests.
- **`wolf_scan` tool** — integrity check comparing the cached index against
  the filesystem (size/mtime) and the pinned git HEAD.
- **`anatomy.md`** — human-readable index view kept in sync on every rescan;
  manual edits are content-hash detected and absorbed additively.

## [0.3.0] — 2026-08-11

Replication P1 — measured token ledger + hardening.

### Added

- **Measured token ledger** — per-session measured usage upserted into
  `token-ledger.json` from provider-reported usage on `assistant/message`
  (web long-lived sessions never fire `turn/end`), with `ctx.tokenMeter`
  fallback; `wolf_report` shows measured totals.
- **Session housekeeping reminders** — nudge the model to use `wolf_learn`
  (sparse cerebrum) and `wolf_bug` (empty buglog).
- **Cross-process lock** — `.wolf/.lock` with stale-lock steal serializes
  read-modify-write updates so concurrent hook fires never lose rows.
- **Language-aware descriptions** — export summaries, HTTP route detection,
  zod-schema/JSON-metadata recognition, module docstrings.

## [0.2.0] — 2026-08-10

Replication P0 — the OpenWolf-class context core.

### Added

- **`.wolf/` brain** per workspace: `config.json`, `STATUS.md`, `cerebrum.md`,
  `memory.md`, `buglog.json`, token ledger, session/scan state.
- **Session digest** — on `agent/session-start`, a budget-capped digest
  (STATUS 🚀 next phase → Do-Not-Repeat last 10 → recent 5 bugs → anatomy
  pointer) injected via `agent.inject()`, with a git-HEAD staleness warning.
- **Read interception** — `tools/post-execute` on `read`: anatomy hints
  (summary + token estimate), symbol line ranges for `offset`/`limit` reads,
  repeated-read warnings with prior token cost.
- **Write interception** — `write`/`edit` results logged to `memory.md`,
  tracked in session state, single-file index refresh.
- **Compaction survival** — `compaction/start` snapshot + restore digest on
  `session-start(source: compact)`.
- **Secret hygiene** — `.env`, `.npmrc`, keys, keystores never enter hints or
  logs.

## [0.1.0] — 2026-08-09

Initial release.

### Added

- **Compact code-map plugin** for DeepSeek Harness: pre-indexed project maps,
  per-file digests, AGENTS.md managed-block injection, `wolf_map`,
  `wolf_file`, `wolf_refresh` tools.
- chokidar watcher with debounced rescans; workspace resolution from the
  agent's session `cwd`; cache per workspace root.
- Bilingual README (EN + zh).

[0.8.12]: https://github.com/hawk2048/dsh-openwolf/releases/tag/v0.8.12
[0.8.11]: https://github.com/hawk2048/dsh-openwolf/releases/tag/v0.8.11
[0.8.10]: https://github.com/hawk2048/dsh-openwolf/releases/tag/v0.8.10
[0.8.9]: https://github.com/hawk2048/dsh-openwolf/releases/tag/v0.8.9
[0.8.8]: https://github.com/hawk2048/dsh-openwolf/releases/tag/v0.8.8
[0.8.7]: https://github.com/hawk2048/dsh-openwolf/releases/tag/v0.8.7
[0.8.6]: https://github.com/hawk2048/dsh-openwolf/releases/tag/v0.8.6
[0.8.5]: https://github.com/hawk2048/dsh-openwolf/releases/tag/v0.8.5
[0.8.4]: https://github.com/hawk2048/dsh-openwolf/releases/tag/v0.8.4
[0.8.3]: https://github.com/hawk2048/dsh-openwolf/releases/tag/v0.8.3
[0.8.2]: https://github.com/hawk2048/dsh-openwolf/releases/tag/v0.8.2
[0.8.1]: https://github.com/hawk2048/dsh-openwolf/releases/tag/v0.8.1
[0.8.0]: https://github.com/hawk2048/dsh-openwolf/releases/tag/v0.8.0
[0.7.0]: https://github.com/hawk2048/dsh-openwolf/releases/tag/v0.7.0-rc.2
[0.6.0]: https://github.com/hawk2048/dsh-openwolf/releases/tag/v0.6.0-rc.3
[0.5.0]: https://github.com/hawk2048/dsh-openwolf/releases/tag/v0.5.0-rc.2
[0.4.0]: https://github.com/hawk2048/dsh-openwolf/releases/tag/v0.4.0-rc.1
[0.3.0]: https://github.com/hawk2048/dsh-openwolf/releases/tag/v0.3.0-rc.2
[0.2.0]: https://github.com/hawk2048/dsh-openwolf/releases/tag/v0.2.0-rc.1
[0.1.0]: https://github.com/hawk2048/dsh-openwolf/releases/tag/v0.1.0
