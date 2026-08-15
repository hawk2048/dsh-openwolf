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

### v0.7 优化轮实测结果（2026-08-15）

| 优化 | 实测（200 文件 fixture / 20 次调用） | 结论 |
| --- | --- | --- |
| 扫描并发池（8 workers） | 并发 55ms vs 串行 94ms → **1.71x** | I/O 并行有效；小文件瓶颈在 lezer 同步解析 |
| **小文件跳过 lezer**（<`symbolThresholdTokens` 用 regex） | 整体 161ms → **55ms（2.9x）** | 主要提速来源，与 OpenWolf ">500 tok 才索引符号" 对齐 |
| git HEAD TTL（30s） | 20 次共 80ms（1 次 spawn + 19 命中） | 原为 ~20×60ms ≈ 1.2s |
| memory.md 批量追加 | ≥16 行或 2s 冲刷，一次落盘 | 突发写从 N 次全文件重写 → 1 次 |
| CLI `--json` | status/report/scan --check | 机器可读输出 |
| GitHub Actions CI | node 20/22/24 × ubuntu/windows | install+typecheck+test+pack |

### v0.7.0-rc.2 优化轮（第二批，2026-08-15）

| 优化 | 实测 / 覆盖 | 结论 |
| --- | --- | --- |
| digest 预算用 tokenMeter | `ctx.tokenMeter.estimateMessage` 优先，回退字符比；新增 2 个 mock-estimator 测试 | 预算行为贴近真实请求前缀 |
| daemon `--token-file` | 生成/读取/复用持久 token（chmod 600），token 不出现在子进程 argv；5 个新单测 | 守护重启与外部客户端共享同一 token |
| 可选 lezer 依赖 | 5 个语法移入 `optionalDependencies`；缺装时按语言记忆一次失败并回退 regex；新增缺装回退测试 | 体积 ~1MB 变为可选；扫描永不因缺语法崩溃 |
| dashboard 30s 自动刷新 | 活动面板定时重渲染，标签页隐藏/刷新中暂停；HTML 断言测试 | 长开页面数据自动更新 |
| 会话状态剪枝 | `files_read` >24h 丢弃、`files_written` 上限 500、`edit_counts` 同步裁剪；新增测试 | 长会话文件有界 |
| 账本保留上限 | `sessions` 上限 500（lifetime 计数继续累加）；新增 520 会话测试 | 长期 profile 保持小巧 |

复测（v0.7 基线不变）：并发池 50ms vs 串行 85ms → **1.70x**；git HEAD TTL 20 次共 97ms；全部 13 个单测文件（95 例）+ 13 + 27 harness 集成断言通过。

优化优先级更新：**P0 完成（dashboard 缓存、memory 批量、安全套件）**；P1 完成（扫描并发+阈值、git HEAD TTL、CLI --json、**digest tokenMeter、daemon --token-file、可选 lezer、dashboard 自动刷新、会话状态剪枝、账本上限**）；剩余 P2：SSE/live 推送、CHANGELOG、0.x.0 稳定版发布。
