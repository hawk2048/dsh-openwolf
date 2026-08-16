<p align="center">
  <strong style="font-size:28px">dsh-openwolf</strong>
</p>

<p align="center">
  <strong>DeepSeek Harness 的第二大脑。</strong>
</p>

<p align="center">
  更好的上下文管理、预索引项目地图、更聪明的 token 利用，<br />
  通过 harness 隐形钩子交付。工作流零改动。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-openwolf"><img src="https://img.shields.io/npm/v/dsh-openwolf?color=cb3837&label=npm" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/dsh-openwolf"><img src="https://img.shields.io/npm/dm/dsh-openwolf?color=2ea44f&label=downloads" alt="npm downloads" /></a>
  <a href="https://github.com/hawk2048/dsh-openwolf/stargazers"><img src="https://img.shields.io/github/stars/hawk2048/dsh-openwolf?color=444&label=stars" alt="GitHub stars" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D20.19-2ea44f" alt="Node.js" /></a>
</p>

<p align="center">
  <a href="#快速开始"><b>快速开始</b></a> &nbsp;&middot;&nbsp;
  <a href="#它会创建什么"><b>它会创建什么</b></a> &nbsp;&middot;&nbsp;
  <a href="#初始化与保持新鲜"><b>初始化</b></a> &nbsp;&middot;&nbsp;
  <a href="#工作原理"><b>工作原理</b></a> &nbsp;&middot;&nbsp;
  <a href="#token-智能"><b>Token 智能</b></a> &nbsp;&middot;&nbsp;
  <a href="#仪表盘"><b>仪表盘</b></a> &nbsp;&middot;&nbsp;
  <a href="#命令"><b>命令</b></a> &nbsp;&middot;&nbsp;
  <a href="CHANGELOG.md"><b>变更日志</b></a>
</p>

[English](README-en.md) | 中文

---

| 不用 dsh-openwolf | 用 dsh-openwolf |
|---|---|
| 模型反复整文件重读（每次 ~2,000 tokens） | 先读一行摘要，或干脆跳过读取 |
| 为找一个函数整文件读取 | 符号级提示给出精确行号，`offset`/`limit` 定向读 |
| 上下文压缩抹掉已做的工作 | PreCompact 快照 + 恢复摘要，工作留在上下文里 |
| 每个会话从冷提示开始 | 预算封顶的会话摘要预载目标、已知错误、最近修复与项目地图 |
| 不知道 token 花在哪 | harness token meter 实测 + 实时本地仪表盘 |

---

## 为什么用 dsh-openwolf？

编码 agent 很强大，但它们是"盲"的。在打开文件之前，agent 不知道文件里有什么；它分不清 50-token 的配置和 2,000-token 的模块；同一会话里重读同一文件而不自知；跨会话忘记你的纠正；上下文窗口压缩时丢失一切。

dsh-openwolf 给 harness 一个修复这一切的第二大脑——灵感来自
[Claude Code 版 OpenWolf](https://github.com/cytostack/openwolf)，作为
**DeepSeek Harness 原生插件**从零实现（MIT，不含 AGPL 参考项目的任何代码）：

- **上下文管理。** 每个会话开始注入一份预算封顶的摘要（当前目标、已知错误、
  已修复 bug、项目地图）。压缩快照 + 压缩感知恢复意味着上下文压缩不再抹掉
  会话已完成的工作。
- **架构脚手架。** 一份持久、自愈的项目索引为每个文件标注描述、token 估算，
  大文件还索引函数与类及其精确行号。agent 导航你的代码库，而不是重新发现它。
- **Token 利用。** 重复读被拦下，整文件读变成定向切片读，真实用量从 harness
  token meter 实测——你可以验证节省，而不是相信估算。

## 快速开始

两种安装方式，二选一——最终都能获得完整体验。

### 方式 1 —— 装进 harness（推荐）

**最直接的方式。** 一条命令，每个会话获得完整体验（会话摘要、读/写拦截、
工具、技能）：

```bash
dsh plugin --profile web add dsh-openwolf    # 装进你的 profile
dsh web                                      # 重启（或重启 GUI）
```

就这么简单。**无需初始化、无需配置**：第一个会话里插件扫描一次工作区，此后
保持地图新鲜，在底层默默工作——harness 照常用，没有任何流程改动。

**不想敲命令？让 agent 帮你装。** 把下面这句复制进任意会话（Web GUI 或
headless 都行），agent 会替你安装并重启：

> 帮我把 dsh-openwolf 装进当前 profile，然后重启让它生效。

agent 会执行 `dsh plugin --profile web add dsh-openwolf`、重启，然后确认
装好了。（用自己的话表达也可以——agent 理解意图，不挑措辞。）

### 方式 2 —— 独立安装 CLI，再接进 harness

本包也是普通 npm 包：装在任何地方，`dshwolf` CLI 即可独立使用（init /
scan / status / report / dashboard / cron / backups）：

```bash
npm install -g dsh-openwolf    # 或项目内：npm install --save-dev dsh-openwolf
dshwolf init . && dshwolf scan .     # 初始化 + 索引当前目录
```

**要在 harness 里也使能**（会话获得工具、会话摘要、读/写拦截——而不只是
CLI），把已装的包接进某个 profile——**一条命令同时完成初始化 + 接线 +
安装依赖**：

```bash
dshwolf init . --agent deepseek-harness   # 初始化 + 接进默认 profile（web）
dsh web                                   # 重启 harness（或重启 GUI）
```

也可以指定某个 profile 或全部，OpenWolf 风格：

```bash
dshwolf init . --agent headless           # 接进 'headless' profile
dshwolf init . --agent all                # 接进所有 profile
dshwolf harness status                    # 看看哪些 profile 已接线
dshwolf harness add web                   # 显式接线 + 安装到某个 profile
```

> **为什么需要这一步。** CLI 和 harness 插件是同一个 `.dshwolf/` 大脑的两个
> 前端——CLI 初始化的内容（地图、STATUS、memory、buglog、账本）正是 harness
> 读取的内容。但全局 `npm install` 对 harness **不可见**：harness 只解析你
> profile `dependencies` 里声明的包（已实测：profile `node_modules` 解析不到
> 全局副本）。`dshwolf init --agent`（与 `harness add`）替你注册依赖 + bundle
> 行**并自动运行 `pnpm install`**——对应 OpenWolf `openwolf init --agent
> claude` 的一步到位（只想改 package.json 时用 `--no-install`，如 CI）。两个
> 前端并存——CLI 给人和 cron 用、插件给会话用，共享同一个大脑。DSH 本身就是
> agent 平台，所以"接线"= profile 里注册一行，而不是 OpenWolf 的 hook 文件
> 安装。

从 git URL 或本地 checkout 安装需要额外的构建授权——见
[从源码安装](docs/INSTALL-FROM-SOURCE.md)。

**装完你能得到什么**（全部开箱即用，无需额外配置）：

| 领域 | 内容 |
|---|---|
| 会话内工具 | `wolf_map` · `wolf_file` · `wolf_refresh` · `wolf_scan` · `wolf_init` · `wolf_status` · `wolf_learn` · `wolf_bug` · `wolf_report` · `wolf_schedule` |
| 自动行为 | 会话开始摘要、重复读警告、符号行号提示、写动作日志、压缩幸存 |
| CLI 命令 | init · scan · scan --check · status · report · bug search · cron · register · update · backups · restore · dashboard · daemon |
| 仪表盘 | 实时本地面板：token、上下文健康、anatomy、活动、cron |

每个命令的用途场景见[命令](#命令)；自我维护机制（什么自动初始化、什么保持
新鲜、什么时候才需要手动命令）见[初始化与保持新鲜](#初始化与保持新鲜)。

## 它会创建什么

首次扫描会在工作区创建 `.dshwolf/` 目录：

| 文件 | 用途 |
|------|------|
| `anatomy-index.json` | 持久项目索引：描述、token 估算、内容哈希、符号 |
| `anatomy.md` | 索引的人类可读渲染，自动保持同步 |
| `cerebrum.md` | 学习到的偏好、纠正、Do-Not-Repeat 列表 |
| `memory.md` | 时序动作日志（含 token 估算） |
| `STATUS.md` | 会话交接：一次小读取即可恢复任何会话 |
| `buglog.json` | bug 修复记忆，可搜索，防止重新排查 |
| `token-ledger.json` | 实测 token 用量，按会话与 agent 统计 |
| `hooks/` | 会话状态、扫描状态（git HEAD 钉住）、压缩前快照 |
| `config.json` | 配置，包括会话摘要预算 |
| `OPENWOLF.md` | agent 遵循的操作协议 |

> **为什么用 `.dshwolf/` 而不是 `.wolf/`？** 原版
> [OpenWolf](https://github.com/cytostack/openwolf)（面向 Claude Code /
> Codex / OpenCode / Gemini / Cursor）也使用 `.wolf/` 大脑。我们把大脑放在
> 独立的 `.dshwolf/` 目录，意味着两个工具可以管理**同一个工作区**而互不覆盖
> 彼此的配置、账本或记忆——未来的 OpenWolf 更新也永远不会逼着这里跟着改。
> 从本插件旧位置（0.9 之前）迁移：`mv .wolf .dshwolf`。（文件*格式*遵循
> OpenWolf 行为规范——cerebrum、STATUS、buglog、memory——所以一个项目可以
> 选择其中任一大脑或两者并用。）

## 初始化与保持新鲜

**无需任何手动初始化**——插件在工作区的首次使用时惰性初始化大脑，之后自动
重扫：

- **首次接触**：第一次调用 `wolf_*` 工具（或第一个带 `injectAgentsMd` 的
  会话）即创建 `.dshwolf/`、扫描一次工作区、把地图注入 `AGENTS.md`。不需要
  单独执行 init。
- **自动刷新**：防抖 watcher 在文件变更时重扫；`write`/`edit` 结果立即
  重分析被改文件，地图和 `anatomy.md` 随你的工作保持新鲜。
- **会话开始摘要**：每个新会话注入预算封顶的摘要（STATUS 🚀 / Do-Not-Repeat /
  最近 bugs / anatomy 指针），扫描过旧或 git HEAD 移动时给出陈旧警告。

想要显式控制时，一切都是一条命令（会话内也有对应工具）：

| 你想… | 命令（CLI） | 工具（会话内） |
|---|---|---|
| 立刻从磁盘重建整个索引 | `dshwolf scan` | `wolf_refresh` |
| 校验索引与文件系统一致（CI 友好） | `dshwolf scan --check` | `wolf_scan` |
| 手动初始化 `.dshwolf/`（幂等，很少需要） | `dshwolf init` | `wolf_init` |
| 读写会话交接文档 | `dshwolf status` | `wolf_status` |
| 更新所有已注册项目（先备份） | `dshwolf update` | — |
| 从时间戳备份回滚 `.dshwolf/` | `dshwolf restore` | — |
| 定时无人值守重扫（零 token） | `dshwolf cron add … scan` | `wolf_schedule` |

> **提示**：这些基本都不需要——插件的职责就是让大脑自我维护。只有当你
> 在 harness 之外改了大量文件（例如一次大 `git pull`）想立刻重建地图时，
> 才需要跑 `dshwolf scan`。

## 工作原理

```
会话开始
    |
插件注入预算封顶的摘要：当前目标、已知错误、最近 bug 修复、项目地图指针
    |
agent 决定读一个大文件
    |
插件："auth.ts (~2,900 tok)。符号: validateToken L82-140 ~450 tok。
用 offset/limit 只取你要的部分。"
    |
agent 编辑文件
    |
插件在跨进程锁下更新索引、记录动作、刷新被改文件的条目
    |
会话中途上下文压缩
    |
插件在压缩前快照状态，压缩后重新注入"本会话已改文件"摘要，
agent 不会重做已完成的工作
    |
会话结束
    |
插件从 harness token meter 读取真实用量写入账本
```

代码地图通过 harness 内置的 `agent-instructions` 插件预载：插件在工作区
`AGENTS.md` 内维护一个标记围栏块（你自己的内容从不被改动，相同内容绝不重写），
所以每个会话开始时地图已经在上下文里。

## 上下文管理

- **会话摘要。** 会话开始时把最高价值状态推进模型上下文，按可配置的 token
  预算封顶（各段成本优先用 harness token meter 的启发式计价）。模型不需要
  读六个文件就能拿到所需。
- **压缩幸存。** `compaction/start` 快照；压缩后摘要列出已修改文件并指向
  动作日志。恢复与压缩不再重置跟踪。
- **陈旧检测。** 扫描钉住 git HEAD。HEAD 移动或扫描超龄时，agent 会被提示
  先重扫再信任地图——错误索引绝不会被静默信任。
- **STATUS.md 交接。** 阶段末状态放在一份小文档里，新会话一次读取即达生产性
  上下文。
- **维护提醒。** cerebrum 过少 → 用 `wolf_learn`；buglog 为空 → 用
  `wolf_bug`。插件提醒，模型喂大脑。

## 项目解剖

索引是持久存储（`anatomy-index.json`）加人类可读渲染（`anatomy.md`）。写入方
通过跨进程锁协调，并发 hook 触发不丢条目。手改 markdown 会被内容哈希检测并
**加性吸收**（绝不覆盖）。

超过 500 估算 token 的文件还索引顶层符号：

```
- `shared.ts` (~3,200 tok)
  - fn `parseAnatomy` L82-104 (~180 tok)
  - fn `serializeAnatomy` L106-129 (~200 tok)
```

在大文件被读取前，提示列出最大的符号及其行号，agent 用 offset/limit 取一个
函数而不是整个文件。文件在索引后变过则自动抑制提示——过期行号绝不会误导读取。
当前符号支持：TypeScript、JavaScript、Python、Go、Rust、Java（lezer CST
解析，可选依赖——其余语言回退正则启发式）。

## Token 智能

估算有用，实测可信。插件从 harness token meter（`ctx.tokenMeter`，
provider 上报）读取真实用量，按会话写入账本：

```bash
dshwolf report
```

```
token ledger: 12 sessions
measured (harness token meter): ~1,549,658 tokens
estimated (heuristic): ~1,420,011 tokens
current session: ~57,489 tokens
```

**DeepSeek Harness 实测 A/B**（同一"1 读 1 编辑"任务、同一份 3 文件工作区、
provider 上报合计）：

| 运行 | 读取 | 编辑 | 计费 tokens |
| --- | --- | --- | --- |
| 带 dsh-openwolf | 1 | 1 | 39,164 |
| 不带 | 1 | 1 | 35,488 |
| **差值** | | | **+3,676（+10%）** |

**诚实解读**：在"单次读取"的最小任务上，插件是**净开销**——固定成本占优。
省 token 的机制（避免重复读、offset/limit 定向读、地图优先导航）要等会话读
多个文件或重复读同一文件时才兑现。原版项目字段数据（启发式估算）平均
**~65.8% token 下降、拦下 71% 的重复读**。预期：**会话触及多个文件或足够长
时回本**。

插件每个会话新增什么：

| 组件 | 频次 | 大小 |
| --- | --- | --- |
| 会话摘要（+维护提醒） | 会话开始 | ≤ 1,500 tokens（可配） |
| `AGENTS.md` 地图块（`injectAgentsMd` 开启时） | 会话基线 | ≤ `maxMapBytes`（16 KiB ≈ 4k tokens） |
| 10 个 `wolf_*` 工具 schema | **每个请求** | ≈ 1–2k tokens（KV-cache 前缀稳定） |
| 2 条技能目录条目 | 会话基线 | ≈ 100 tokens |

一次性小任务可考虑 `digestEnabled: false` / `injectAgentsMd: false` /
调小 `maxMapBytes`。

## 安全

- 仪表盘只绑定 127.0.0.1，所有 API 访问需要逐项目 token（timing-safe
  比较）；token 可放 `--token-file`（`chmod 600`），不出现在命令行参数里。
- 所有动态进程调用使用参数数组，任何地方都不做 shell 插值。
- 所有文件访问都有路径穿越防护。
- 密钥类文件（keys、keystores、凭据文件、`.npmrc`、`.env` 等）绝不进入索引、
  提示或日志；模板（`.env.example`）保持可索引。
- 安全回归套件随 `pnpm test` 运行。

## 内置技能

两个技能注册进 harness 技能目录：

- **`wolf-security-audit`** —— 分层审计（依赖 → 秘密 → 注入面 → 授权），
  产出严重度排序报告并写入 `.dshwolf/buglog.json`。
- **`wolf-reframe`** —— 设计大脑。从 13 框架知识库挑选或迁移 UI 框架，或按
  反"AI 味"设计准则审计/修复现有 UI：独特性是验收标准，一眼可辨的 AI 生成
  外观是失败态。

## 仪表盘

```bash
dshwolf daemon start
dshwolf dashboard
```

本地、token 认证的仪表盘：实测 vs 估算 token、上下文健康（扫描新鲜度、钉住的
git HEAD、摘要预算）、会话交接、实时活动、cron 控制、带逐文件符号的 anatomy
浏览器。面板可深链（`/#tokens`）。页面是**实时**的——SSE 流在 brain 文件一变
就重渲染当前面板，流断开时回退 30s 轮询。

## 命令

所有命令都接受可选目录参数（默认当前工作目录）。按使用场景分组：

**大脑生命周期**

| 命令 | 作用 | 什么时候用 |
|---|---|---|
| `dshwolf init [dir]` | 创建 `.dshwolf/`（幂等）；`--agent <profile\|all\|deepseek-harness>` 同时接线 + 安装进 harness | 通常不需要——大脑首次使用时自动初始化；`--agent` 是方式 2 的一条命令初始化 |
| `dshwolf scan [dir]` | 重建项目索引、渲染 `anatomy.md`、注入 `AGENTS.md` | 在 harness 之外做了大改动（如 `git pull`）想立刻重建地图 |
| `dshwolf scan --check [dir]` | 校验索引与文件系统一致（size/mtime + git HEAD） | CI 或会话前校验；漂移退出码 1 |
| `dshwolf status [dir]` | 大脑健康：配置、扫描状态、账本、memory/buglog 计数 | "我的大脑健康吗？" |
| `dshwolf report [dir]` | token 账本摘要：各会话实测 vs 估算 | 弄清楚 token 花在哪 |

**harness 接线**（方式 2 独立安装后）

| 命令 | 作用 | 什么时候用 |
|---|---|---|
| `dshwolf harness status` | 列出 DSH profiles，标出哪些已接 dsh-openwolf | "我哪些 profile 已经装了插件？" |
| `dshwolf harness add [name]` | 把插件写进某 profile 的 `package.json`（dependencies + bundles）**并自动运行 `pnpm install`**（默认 profile `web`；`--no-install` 只改文件） | 方式 2 独立安装后，一条命令获得会话内体验（然后重启） |

**记忆与 bug**

| 命令 | 作用 | 什么时候用 |
|---|---|---|
| `dshwolf bug search <term>` | 搜索 `.dshwolf/buglog.json` | 重新排查可能已修复的问题之前 |
| `dshwolf register [dir]` | 把工作区加进全局项目注册表 | 让 `dshwolf update` 覆盖你所有项目 |
| `dshwolf unregister [dir]` | 从注册表移除 | 清理 |
| `dshwolf update` | 备份 + 重扫所有已注册工作区 | 一次性刷新所有已索引项目 |

**备份**

| 命令 | 作用 | 什么时候用 |
|---|---|---|
| `dshwolf backups [dir]` | 列出时间戳 `.dshwolf/` 备份 | 看有哪些可回滚 |
| `dshwolf restore [dir] [tag]` | 从备份恢复 `.dshwolf/`（默认最新） | 实验搞砸之后 |

**调度与服务**

| 命令 | 作用 | 什么时候用 |
|---|---|---|
| `dshwolf cron add <name> '<expr>' <scan\|check> [dir]` | 定时零 token 任务（cron 语法、`@daily` 等） | 无人值守刷新：如每晚 `scan` |
| `dshwolf cron list [dir]` / `dshwolf cron run <id>` / `dshwolf cron remove <id>` | 管理定时任务 | 查看或手动触发任务 |
| `dshwolf dashboard [dir]` | 前台运行 Web 仪表盘（`--port` / `--token` / `--token-file`） | 实时查看 token / 上下文 / anatomy |
| `dshwolf daemon start [dir]` / `dshwolf daemon stop` | 后台守护：仪表盘 + cron 调度 | 不占用终端地常驻仪表盘与定时任务 |

所有命令也以工具形式出现在会话里（`wolf_map`、`wolf_file`、`wolf_refresh`、
`wolf_scan`、`wolf_init`、`wolf_status`、`wolf_learn`、`wolf_bug`、
`wolf_report`、`wolf_schedule`）——模型自己能做这一切，CLI 只是给人、脚本和
cron 用的。

全局选项：`dshwolf --help`（分组帮助）与 `dshwolf --version` 随处可用；裸 `dshwolf`
也打印帮助。子命令组也有自己的帮助——`dshwolf cron --help`、`dshwolf daemon --help`、
`dshwolf bug --help`、`dshwolf harness --help`（或只敲组名）。旧名 `wolf` 仍可
作为别名使用。

## 环境要求

- Node.js 20+
- 任意 DeepSeek Harness profile（`web`、`headless`、…）
- Windows、macOS 或 Linux

## 配置

所有选项经 schema 校验、默认值合理；**无需配置任何东西**。在 profile 的
`cordis.patch.yml` 中按行 id（`openwolf`）覆盖：

```yaml
- id: openwolf
  config:
    maxMapBytes: 16384        # 注入/返回地图文本的上限（字节）
    maxFileBytes: 65536       # 超过此大小的文件只列不读
    maxFiles: 4000            # 每个工作区扫描文件数上限
    watch: true               # 防抖 watcher，文件变更自动重扫
    injectAgentsMd: true      # 维护 AGENTS.md 受管块
    useGitignore: true        # 遵循根目录 .gitignore
    symbols: true             # 提取顶层符号
    symbolBackend: auto       # auto | regex | lezer（CST 解析）
    sessionDigestBudgetTokens: 1500   # 注入的会话摘要 token 上限
    rescanIntervalHours: 6    # 重扫警告前的陈旧窗口
    symbolThresholdTokens: 500        # 超过此 token 数的文件给符号行号提示
    digestEnabled: true       # 会话开始时注入会话摘要
    interceptReads: true      # 重复读警告 + anatomy 提示
    interceptWrites: true     # 动作日志 + 单文件索引刷新
    compactionSurvival: true  # 压缩快照 + 恢复摘要
    skillsEnabled: true       # 注册 wolf-security-audit + wolf-reframe
    autoRescanMinutes: 0      # 每 N 分钟自动重扫缓存根（0 = 关）
```

后层可按 `id` 整体覆盖该行，部署方保留自己的默认值。

## 限制

- **实测 vs 估算** —— 实测数字来自 harness token meter，精确；启发式估算是
  字符比近似。
- **多 agent 接线 N/A** —— 原版钩 5 个外部 agent（Claude Code/Codex/
  OpenCode/Gemini/Cursor）；DSH 本身是 agent 平台，一个大脑服务所有 DSH
  会话与子代理。
- **cron 引擎自研** —— 每次运行 0 token，有意不接 harness 的模型面向调度器
  （后者每次触发烧一次 LLM 轮次）。
- **dashboard 是零依赖服务器渲染单页**（面板子集），非 React SPA。
- **仅根级 `.gitignore`** —— 暂不支持嵌套 `.gitignore` 与 `git check-ignore`
  的精确语义。
- **读提示随结果到达** —— `tools/post-execute` 把提示附加在结果上下文上
  （DSH 目前没有读前拦截缝）。
- **摘要注入依赖 agent 生命周期** —— 从持久日志恢复的会话跳过摘要（历史
  完整，与原版 resume 行为一致）。
- 发现问题？[提交 issue](https://github.com/hawk2048/dsh-openwolf/issues)。

## 开发

```sh
pnpm install
pnpm build        # tsc → lib/
pnpm test         # node --test，进程内执行
```

本包是**可擦除 TypeScript** + `rewriteRelativeImportExtensions`：`node` 可
直接运行 `src/` 做测试，`tsc` 产出发布用的 ESM `lib/`。`prepare` 脚本从源码
构建，这正是 git 安装能工作的原因。想在真实 harness profile 里跑本地
checkout，见[从源码安装](docs/INSTALL-FROM-SOURCE.md)。

## License

MIT —— 对代码地图/上下文大脑思路的独立实现，不含任何 AGPL 项目的代码。
为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 构建。
