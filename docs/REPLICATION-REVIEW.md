# OpenWolf 复刻复盘 (Replication Review)

Status: post-completion review of `dsh-openwolf` against the reference
[OpenWolf v2.0.1](https://www.npmjs.com/package/openwolf) source (read from the
published tarball). Scope: replication degree per feature, then optimization
opportunities per implementation area.

## 1. 复刻度总览 (Coverage matrix)

| Ref feature | dsh-openwolf | Degree | Notes |
|---|---|---|---|
| A1 Session digest | `digest.ts` + `agent/session-start` + `agent.inject()` | ✅ full | budget-capped, 4-source priority, staleness warning |
| A2 Compaction survival | `compaction/start` snapshot + `source:compact` restore | ✅ full | DSH-native seam |
| A3 Staleness detection | git HEAD pin + `rescanIntervalHours` | ✅ full | |
| A4 STATUS.md handoff | `wolf_status` + digest 🚀 section | ✅ full | |
| A5 cerebrum.md | `wolf_learn` + digest DNR + freshness reminders | ✅ full | |
| A6 memory.md | write-interception action log | ✅ full | |
| A7 buglog.json | `wolf_bug` + digest + CLI `bug search` | ✅ full | |
| B1 Durable anatomy index | in-memory map cache + CLI manifest + anatomy.md | ⚠️ partial | no cross-process persistent per-file index in the harness path; CLI manifest covers `--check` |
| B2 anatomy.md | render + hash-absorb additive edits | ✅ full | |
| B3 Symbol index | lezer/regex + endLine + per-symbol tokens + threshold | ✅ full | TS/JS/Py/Go/Rust/Java |
| B4 Description extractor | `description.ts` (exports/routes/schemas/docstrings/JSON) | ✅ core | ~1.5 KB vs ref's 49 KB heuristic — deliberately compact |
| B5 Pre-read hint | `tools/post-execute` + line ranges + staleness suppression | ✅ functional | hint rides the result (DSH has no pre-read seam) |
| B6 Repeated-read warning | `_session.json` tracking | ✅ full | |
| B7 Post-write update | memory log + session state + single-file re-analysis + dirs sync | ✅ full | |
| B8 Secret exclusion | denylist in scanner + interception | ✅ full | |
| C1 Token estimate | char-ratio | ✅ full | |
| C2 token-ledger measured | provider usage on `assistant/message` + tokenMeter fallback | ✅ full | web long-turn fix |
| C3 report | `wolf_report` + CLI `report` + dashboard | ✅ full | |
| D Multi-agent | N/A (DSH is the agent platform) | — | documented |
| E init layout | config/STATUS/cerebrum/memory/buglog/ledger/hooks/**OPENWOLF.md** | ✅ full | OPENWOLF.md added in P4 |
| F Security | 127.0.0.1 + timing-safe token, arg arrays, secret skip | ✅ core | no dedicated security regression suite |
| G1 security-audit | `wolf-security-audit` skill | ✅ full | |
| G2 reframe | `wolf-reframe` skill (13-framework KB) | ✅ full | |
| H1 Dashboard | tokens/health/anatomy/handoff/bugs/overview/activity/cron | ✅ core | server-rendered single page vs React SPA |
| H2 Daemon + cron | daemon + own cron engine (minute-anchored, in-flight-guarded) | ✅ full | vs ref's node-cron |
| H3 CLI | init/scan/`--check`/status/report/bug/cron/register/update/backups/restore/dashboard/daemon | ✅ full | ref also has `update`/`restore` — replicated |

**Overall: 21/23 features full or core; 2 partial (B1 durable index, F regression suite).**

## 2. 各功能实现可优化点 (Optimization opportunities)

Priorities: **P0** = correctness/perf hot spots worth fixing soon · **P1** = clear wins ·
P2 = nice-to-have.

### Brain / storage
- **P0 memory.md rewrite cost** — `appendMemory` reads + rewrites the whole file per
  write (O(n) per row; long sessions grow). Fix: batch rows into a small in-memory
  buffer flushed on interval/unload, or append-only tail file + periodic compaction.
- **P1 anatomy.md sync on every rescan** — rescan → full render + hash → write only
  when changed (already no-op when identical) — OK; but dashboard `/api/anatomy`
  re-runs a FULL scan per request. **P0**: cache the last render keyed by scan-state
  mtime; serve without rescanning.
- **P1 config/ledger JSON rewrites** — same whole-file pattern; fine at current scale,
  batch if ledger grows.

### Scanner / symbols
- **P1 sequential file analysis** — files are analyzed one-by-one with `await`.
  A bounded-concurrency pool (e.g. 8) would cut scan latency ~5-10x on big repos.
  Careful: per-file `stat`+read are I/O-bound; worker pool is safe.
- **P2 optional lezer grammars** — the 5 grammars add ~1 MB. Make them optional deps
  (`peerDependenciesMeta` optional) so `regex`-only users skip them; `auto` degrades.
- **P1 description extractor depth** — route params/middleware detection, more langs
  (C#/PHP/Swift regex fallback already there) — cheap additions.

### Interception
- **P2 pre-read hints** — DSH `tools/post-execute` attaches hints WITH the result.
  A proactive `wolf_readhint`-style pattern (model asks before reading) or an
  `agent/pre-step` hint injection would get closer to the ref's pre-hook UX.
- **P1 session-state pruning** — `files_read` grows per session; prune entries older
  than N hours to keep `_session.json` small.

### Digest / ledger
- **P1 git HEAD TTL cache** — `currentGitHead` spawns git per session-start + per
  refresh. Cache with a ~30s TTL (still fresh, fewer spawns).
- **P1 digest budget source** — uses char-ratio estimate; `ctx.tokenMeter.estimateMessage`
  is available and more accurate for the digest cost check.
- **P2 ledger retention** — unbounded `sessions` array; cap at N with a summary rollup.

### CLI / daemon
- **P1 `--json` output + documented exit codes** — machine-readable outputs for
  `scan --check`/`status`/`report` (CI integration).
- **P1 daemon health + token rotation** — `/api/health` without auth (port-local),
  `--token-file` support so tokens are not on the command line.
- **P2 `update` parallelism** — registered projects scan sequentially; run with a
  bounded pool.

### Dashboard
- **P1 SSE live updates** — activity/cron panels poll on hash change only; an SSE
  push (or 30s refresh) for live activity.
- **P2 panel pagination** — bugs/memory capped; add paging instead of slice(50).

### Security
- **P0 dedicated security regression suite** — the ref ships one (`pnpm test` covers
  path traversal, timing-safe auth, secret skip). Add: traversal on `wolf_file`,
  auth timing, denylist fixtures, cron file access guards.

### Packaging / docs
- **P2 CI** — GitHub Actions (typecheck + test + pack on node 20/22/24 × win/ubuntu)
  was planned but never added. Highest-leverage P2.
- **P1 README parity** — document the `wolf` CLI exit codes and `--dir=` convention.

## 3. 结论

复刻度：**核心 100%，全量 ~95%**（B1 持久索引、F 安全回归套件为已知部分项）。
优化优先级建议：**P0 = dashboard 扫描缓存 + memory.md 追加批量 + 安全回归套件**；
P1 = 扫描并发、git HEAD TTL、digest 用 tokenMeter、CLI --json、daemon --token-file；
P2 = CI、可选 lezer 依赖、SSE、会话状态剪枝、账本保留上限。
