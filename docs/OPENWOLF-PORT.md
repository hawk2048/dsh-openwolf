# OpenWolf Port Plan (v0.2 → v0.x)

Goal: **feature-complete replication of [OpenWolf v2.0.1](https://www.npmjs.com/package/openwolf) on DeepSeek Harness**, implemented natively as DSH plugins (MIT, independent implementation — the reference source is AGPL-3.0 and is used **only to understand the feature set and mechanisms, never copied**).

Source of truth for this inventory: the published `openwolf@2.0.1` npm tarball (README, `dist/src/**`, `dist/hooks/**`), read on 2026-08-14.

## 1. Feature inventory (confirmed from source)

### A. Context Management
| # | Feature | Mechanism (from source) | DSH seam |
|---|---|---|---|
| A1 | **Session digest** | Budget-capped (default 1500 tok, per-agent budgets in `config.json`) context injected at SessionStart via `additionalContext`; priority order: STATUS.md 🚀 section → Do-Not-Repeat (last 10) → recent 5 bugs → anatomy pointer | `agent.inject()` / agent-instructions preload seam |
| A2 | **Compaction survival** | PreCompact hook snapshots `_session.json`; SessionStart(source=`compact`) re-injects "files already modified this session" digest | need DSH compaction event seam (research) |
| A3 | **Staleness detection** | anatomy scan pins `git HEAD` + `rescan_interval_hours` (default 6h); SessionStart warns "run scan before relying" | git rev-parse + config check in plugin |
| A4 | **STATUS.md handoff** | end-of-phase doc, `## 🚀` section extracted into digest | workspace `.wolf/STATUS.md` + `wolf_status` tool |
| A5 | **cerebrum.md** | learned preferences / corrections / Do-Not-Repeat list; freshness reminders (warn if <3 entries or >3 days old) | `.wolf/cerebrum.md` + reminders |
| A6 | **memory.md** | chronological action log with token estimates, session header per session | `.wolf/memory.md` + write events |
| A7 | **buglog.json** | bug-fix memory; searchable (`openwolf bug search`); empty-state reminder | `.wolf/buglog.json` + `wolf_bug` tool |

### B. Project Anatomy
| # | Feature | Mechanism | DSH seam |
|---|---|---|---|
| B1 | **anatomy-index.json** | durable per-file store: description, token estimate, content hash, size, mtime, symbols; cross-process lock; content-hash absorb of manual edits | `.wolf/anatomy-index.json` + lock (fs-safe) |
| B2 | **anatomy.md** | human-readable render of the index | rendered view (reuse renderMap) |
| B3 | **Symbol index** | files >500 est. tok index top-level symbols: kind/name/startLine/endLine/~tokens; langs TS/JS/Py/Go/Rust | v0.2 lezer backend + token estimate |
| B4 | **Description extractor** | 49 KB per-language heuristics (route/controller detection, exports summary, schema detection, …) | port independently, or reuse summary heuristics + language-specific additions |
| B5 | **Pre-read hint** | before big-file reads: description + ~tokens + top-5 symbols w/ line ranges for offset/limit reads; suppressed when size/mtime changed since index | `tools/pre-execute` on the `read` tool (research exact args) |
| B6 | **Repeated-read warning** | `_session.json` tracks files_read w/ count+tokens; warn on 2nd read | same hook |
| B7 | **Post-write update** | edits update index under lock + log action to memory.md | `tools/post-execute` on write/edit tools |
| B8 | **Secret exclusion** | sensitive extensions + basenames (.env, .npmrc, keys, keystores…) never indexed | port the denylist |

### C. Token Intelligence
| # | Feature | Mechanism | DSH seam |
|---|---|---|---|
| C1 | **Token estimate** | char-ratio heuristic (~15%) | reuse; DSH token meter exists for real numbers |
| C2 | **token-ledger.json** | per-session/per-agent estimated + measured (input/output/cache reads/writes, API calls) | read real usage from DSH `ctx.tokenMeter` / session telemetry instead of transcripts |
| C3 | **openwolf report** | estimated vs measured report | `wolf_report` tool or web panel |

### D. Multi-agent
OpenWolf wires 5 external agents (Claude Code / Codex / OpenCode / Gemini / Cursor) via their native hook/context mechanisms. **Not applicable to DSH** — DSH is the agent platform itself; the equivalent is "one brain for all DSH sessions/subagents", which the plugin architecture gives for free.

### E. Init layout (`.wolf/`)
`config.json` (per-agent budgets, rescan interval, dashboard port/token), `OPENWOLF.md` operating protocol, `hooks/` (7 zero-dep hooks). DSH equivalent: `config` schema (plugin config) + a `wolf_init` tool / first-run bootstrap that creates `.wolf/`.

### F. Security
Dashboard binds 127.0.0.1 + timing-safe token; arg arrays only (no shell interpolation); realpath/symlink-safe traversal guards on cron file access; secret denylist; security regression tests.

### G. Skills
| # | Feature | DSH seam |
|---|---|---|
| G1 | `/security-audit [scope]` — layered dep/secrets/injection/authz audit → severity-ranked report → buglog | DSH skill or `ctx.commands` command |
| G2 | `/reframe [migrate\|audit\|fix]` — UI framework design brain (13-framework KB) | DSH skill |

### H. Platform
| # | Feature | DSH seam |
|---|---|---|
| H1 | **Dashboard** (React, dot-matrix; tokens/cache/context-health/handoff/activity/cron/anatomy browser; deep links; auth) | DSH client plugin (slots) or docs page |
| H2 | **Daemon** (file-watcher, health, cron-engine via node-cron) | `ctx.jobs` + `@deepseek-ai/dsh-schedule` (already installed) |
| H3 | **CLI commands** init/status/scan/`scan --check`/report/dashboard/daemon/cron/bug/update/restore | `wolf_*` tools + optional `dsh-openwolf/bin` CLI |

## 2. Gap analysis — current dsh-openwolf v0.1

| Already done | Missing (v0.2 → v0.x) |
|---|---|
| code map (path + lines + summary + symbols) | per-file token estimate + symbol line ranges + description richness (B3/B4) |
| AGENTS.md managed-block injection | budget-capped **session digest** from multiple sources (A1) |
| ignore/gitignore-lite matcher | secret-file denylist (B8) |
| staleness via watcher | git-HEAD pin + age-based staleness + rescan reminder (A3) |
| wolf_map / wolf_file / wolf_refresh | read/write interception hooks (B5/B6/B7), memory/buglog/cerebrum (A4-A7), token ledger/report (C), skills (G), dashboard/daemon/cron (H) |

## 3. Phased port plan

### P0 — Context core (v0.2) ✅ SHIPPED (0.2.0-rc.1)
- ✅ `.wolf/` bootstrap (`wolf_init`) + `config.json` equivalent (per-agent budget, rescan interval) — `src/brain.ts`
- ✅ **Session digest** (A1): STATUS 🚀 + Do-Not-Repeat + recent bugs + anatomy pointer, budget-capped, injected via `agent.inject()` on `agent/session-start` (startup/clear); **staleness warning** (A3, git-HEAD pin + age) — `src/digest.ts`
- ✅ **Read interception** (B5/B6): `tools/post-execute` on `read` → repeated-read warning, anatomy hint + symbol line-range hints, staleness-suppressed, secret-excluded
- ✅ **Write interception** (B7): `tools/post-execute` on `write`/`edit` → memory.md log + session tracking + single-file re-analysis
- ✅ Compaction survival (A2): `compaction/start` snapshot + `agent/session-start(source: 'compact')` restore digest (the DSH seam exists — durable `compaction/start`/`compaction/end` session events)
- ✅ New tools: `wolf_init`, `wolf_status`, `wolf_learn`, `wolf_bug`, `wolf_report`
- ✅ Tests: 32 unit + 31 integration assertions; profile boot verified; published as `dsh-openwolf@0.2.0-rc.1` (npm tag `rc`)

### P1 — Memory & measurement (v0.3) ✅ SHIPPED (0.3.0-rc.1)
- ✅ Session housekeeping reminders (A5/A7): sparse cerebrum / empty buglog nudges via `agent.inject()` on session start
- ✅ Token ledger measured (C1-C3): `turn/end` measures via `ctx.tokenMeter` and upserts by session id; `wolf_report` surfaces measured totals
- ✅ Cross-process lock (B1): `.wolf/.lock` exclusive-create + stale steal around all brain read-modify-write ops
- ✅ Description extractor (B4): `src/description.ts` — language-aware summaries (exports, HTTP routes, zod schemas, python docstrings, go handlers, JSON metadata) with first-meaningful-line fallback, used for map entries and read hints
- ✅ Tests: +8 description, +3 brain (lock/steal/upsert); published as `dsh-openwolf@0.3.0-rc.1` (npm tag `rc`)

### P2 — Anatomy engine parity (v0.4) ✅ SHIPPED (0.4.0-rc.1)
- ✅ Symbol backend (B3): `symbolBackend: auto|regex|lezer` — pure-JS lezer grammars (TS/JS, Python, Go, Rust, Java) extract top-level declarations with exact line spans + per-symbol token estimates; regex fallback; backend parity tests
- ✅ anatomy.md (B2): `.wolf/anatomy.md` human-readable index view synced on rescan; content-hash detection absorbs manual edits additively
- ✅ Integrity check: `wolf_scan` (read-only, CI-friendly) — cached index vs filesystem size/mtime drift + git HEAD pin
- ✅ Post-write incremental updates (B7): single-file re-analysis now keeps per-directory aggregates in sync
- ✅ Tests: +lezer golden/parity, +anatomy render/absorb, +dirs aggregates, +wolf_scan drift (54 unit + 36 integration); published as `dsh-openwolf@0.4.0-rc.1` and promoted to `latest`

### P3 — Platform (v0.5+) — phase 1 ✅ SHIPPED (0.5.0-rc.1)
- ✅ Skills (G1/G2): `wolf-security-audit` (4-layer audit → severity report → buglog) and `wolf-reframe` (13-framework KB + anti-generic mandate) registered into `ctx.skills`
- ✅ CLI (H3): `wolf` binary — init/scan/`scan --check`/status/report, standalone (reuses the library); `--check` persists a file manifest and exits 1 on drift
- ✅ Auto-rescan (H2-lite): `autoRescanMinutes` refreshes cached roots on an unref'd timer
- ⏳ Dashboard (H1) — deferred to P3 phase 2 (DSH client plugin over web slots)

### P3 phase 2 (dashboard) — proposed scope
- DSH client plugin (`dsh-openwolf/client`) registering web slots: token usage panel (ledger + tokenMeter), context health (scan freshness/git HEAD/digest budget), anatomy browser with per-file symbols, session handoff (STATUS), cron control

## 4. Research items before implementation

1. DSH compaction event seam (does `tools/` or `agent/*` expose a pre-compaction hook? check `dsh-compaction-basic` + event map) — gates A2.
2. `tools/pre-execute` payload for the `read`/`write` tools (exact args: `file_path`? `path`?) — gates B5/B6/B7.
3. `ctx.tokenMeter` API for measured per-session usage — gates C2.
4. `agent.inject()` semantics for dynamic digest injection vs. the agent-instructions baseline — gates A1.

## 5. Licensing note

The reference implementation is AGPL-3.0. dsh-openwolf remains MIT: features are reimplemented from the documented behavior, no code is copied, and no dependency on the reference package is introduced.
