# dsh-openwolf

[English](README.md) | 中文

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的紧凑代码地图 **"第二大脑"** 插件。它把工作区预索引成一份小而密的代码地图——文件树、每个文件的一行摘要、顶层符号、token 估算——注入 `AGENTS.md`，让每个会话一开始就带上地图，并拦截读写调用，避免反复整文件重读。

灵感来自 [Claude Code 版 OpenWolf](https://github.com/cytostack/openwolf)（"更锐利的上下文、更少的 token"），但作为 DSH 原生插件从零实现——不需要 MCP server、不需要外部 CLI、用户侧零构建。

- **零配置即插即用**：一个 bundle 行；地图经 `AGENTS.md` 由 harness 自动预载。
- **依赖极轻**：仅 `chokidar`（监听）+ `schemastery`（配置），其余全是 `node:fs`。
- **工作区感知**：地图跟随会话工作区，绝不写死路径。
- **默认保鲜**：防抖 watcher 在文件变更时自动重扫并重新注入。
- **v0.2 大脑**：每个工作区一个 `.wolf/` 目录（STATUS/cerebrum/memory/buglog/token 账本），会话开始时注入**预算封顶的会话摘要**，**读拦截**（重复读警告 + 符号行号提示，支持 offset/limit 定向读），**写拦截**（动作日志 + 单文件索引刷新），以及**压缩幸存**。

## 安装

装进任意 profile（例如你启动 `dsh web` 所用的 `web` profile）：

```sh
dsh plugin --profile web add dsh-openwolf          # 从 npm
# 或本地 checkout：
dsh plugin --profile web add ./path/to/dsh-openwolf
# 或从 GitHub（需要 allowBuilds 授权，见下）：
dsh plugin --profile web add github:hawk2048/dsh-openwolf
```

**直接跟 DeepSeek Harness 对话安装**——让 agent 帮你装。开一个会话（或任意 agent），直接说：

> 帮我把 dsh-openwolf 插件装进当前 profile（`dsh plugin --profile web add dsh-openwolf`），然后重启生效。

harness 有 shell 权限，agent 会替你执行 `dsh plugin` 命令并提示重启 `dsh web`。Web GUI 或 `headless` profile（`dsh --profile headless "install dsh-openwolf"`）都能这么装。

重启 profile（`dsh web`）。bundle 层会插入一行 host 插件，为每个会话注册工具、技能与钩子。

从 git URL 安装拉取的是**源码而非构建产物**，首次 `add` 会失败，需要先在 profile 的 `pnpm-workspace.yaml` 里授权构建：

```yaml
allowBuilds:
  dsh-openwolf: true
```

然后重新执行 `add`。从 npm 或 tarball 安装则无需任何授权。

CLI 装好后也可独立使用：

```sh
npx wolf init . && npx wolf scan . && npx wolf scan --check .
npx wolf cron add nightly '30 2 * * *' scan .   # 定时零 token 任务
npx wolf dashboard .        # 本地仪表盘（--port / --token / --token-file）
npx wolf daemon start .     # 后台守护：仪表盘 + cron 调度
npx wolf daemon stop .      # 停止守护
```

仪表盘与守护的每个请求都需要 token（`?token=` 或 `Authorization: Bearer`）。用
`--token=…` 显式指定，或用 `--token-file=…` 把生成的 token 持久化到文件
（`chmod 600`），重启与外部客户端共享同一 token，且不出现在进程 argv 里。仪表盘
页面每 30s 自动刷新当前面板（标签页隐藏或刷新进行中时暂停）。

## 模型看到的工具

每个会话会出现八个原生工具：

| 工具 | 用途 |
| --- | --- |
| `wolf_map` | 当前工作区的紧凑代码地图（可用 `refresh` 强制重扫）。 |
| `wolf_file` | 单个文件的有界摘要：语言、大小、行数、token 估算、符号、预览——而不是整文件。 |
| `wolf_refresh` | 强制重扫、钉住扫描状态（git HEAD + 时间戳）并重新注入 `AGENTS.md`。 |
| `wolf_init` | 初始化 `.wolf/` 大脑目录（幂等）。 |
| `wolf_status` | 读写 `STATUS.md`；其 `## 🚀` 段进入会话摘要。 |
| `wolf_learn` | 在 `cerebrum.md` 记录偏好/约定/Do-Not-Repeat。 |
| `wolf_bug` | 记录已修复 bug 或搜索 buglog（防止重新排查）。 |
| `wolf_report` | token 账本报告（各会话估算 + 当前会话由 harness token meter 实测）。 |

## v0.2 大脑（OpenWolf 级上下文核心）

`brainEnabled` 开启时，每个工作区会有一个 `.wolf/` 目录：

```
.wolf/
├── config.json          # 会话摘要预算、重扫间隔、阈值
├── STATUS.md            # 阶段交接文档（## 🚀 段 → 会话摘要）
├── cerebrum.md          # 学习到的偏好 + Do-Not-Repeat 列表
├── memory.md            # 时序动作日志（含 token 估算）
├── buglog.json          # 可搜索的 bug 修复记忆
├── token-ledger.json    # 各会话估算用量
└── hooks/               # 会话状态、扫描状态（git HEAD 钉住）、压缩前快照
```

- **会话摘要** —— `agent/session-start` 时经 `agent.inject()` 注入预算封顶的摘要：STATUS 🚀 下一阶段 → Do-Not-Repeat（最近 10 条）→ 最近 5 个 bug → anatomy 指针；钉住的 git HEAD 移动或上次扫描超过 `rescanIntervalHours` 时，前缀**陈旧警告**。各段成本优先用 harness token meter 的启发式（`ctx.tokenMeter.estimateMessage`）计价，不可用时回退字符比，预算行为贴近真实请求前缀。另有**维护提醒**（cerebrum 条目过少 → 用 `wolf_learn`；buglog 为空 → 用 `wolf_bug`）。
- **读拦截** —— `read` 工具的 `tools/post-execute`：anatomy 提示（`path — summary (~tokens)`）；超过 `symbolThresholdTokens` 的文件给出前 5 个符号的行号，引导 offset/limit 定向读；文件在索引后变过则抑制提示。同会话重复读同一文件会警告并给出此前 token 成本。摘要**语言感知**（`src/description.ts`）：导出摘要、HTTP 路由识别、zod schema 与 JSON 元数据识别、模块 docstring。
- **写拦截** —— `write`/`edit` 结果写入 `memory.md`、记入会话状态，并把该文件单文件重分析进缓存地图。
- **压缩幸存** —— `compaction/start` 快照 + `session-start(source: compact)` 恢复摘要（列出本会话已修改文件）。
- **有界会话状态** —— `hooks/_session.json` 的读写跟踪每次写入自剪裁：超过 24h 的读取条目丢弃、写入日志最多保留最近 500 条，长会话不会让文件无限增长。
- **token 账本（实测）** —— 每个 `turn/end` 用 harness token meter（`ctx.tokenMeter`）测量并按 session_id upsert 进 `token-ledger.json`；`wolf_report` 展示实测总量。账本最多保留最近 500 个会话行（lifetime 去重计数继续累加），长期 profile 保持小巧。
- **跨进程锁** —— `.wolf/.lock`（独占创建 + 陈旧锁抢占）串行化读改写更新，并发 hook 触发不丢行。
- **秘密文件卫生** —— `.env`、`.npmrc`、密钥、凭据等绝不进入提示或日志。

此外，当 `injectAgentsMd` 开启时，插件会维护工作区 `AGENTS.md` 内的一个受管块：

```markdown
<!-- dsh-openwolf:start -->
# Code Map
Generated … · 42 files · 1234 lines · 0.12s

## src
- `src/index.ts` — 90 lines · createApp, Server · export function createApp()…
<!-- dsh-openwolf:end -->
```

harness 自带的 `agent-instructions` 插件本来就会把 `AGENTS.md`（以及 `CLAUDE.md`）读入每个会话（带自己的字节预算和变更追踪），所以地图在会话开始时即被预载、变更后自动刷新。指令文件其余部分原样保留——只管理两个标记之间的块，内容不变时不会重写。

## 配置

所有配置项加载时经 schema 校验，缺省用默认值。在 profile 的 `cordis.patch.yml` 中按行 id（`openwolf`）覆盖：

```yaml
- id: openwolf
  config:
    maxMapBytes: 16384        # 注入/返回地图文本的上限（字节）
    maxFileBytes: 65536       # 超过此大小的文件只列不读
    maxFiles: 4000            # 每个工作区扫描文件数上限
    watch: true               # 防抖 chokidar watcher
    injectAgentsMd: true      # 维护 AGENTS.md 受管块
    agentsMdFile: AGENTS.md   # 或 CLAUDE.md
    useGitignore: true        # 遵循根目录 .gitignore
    ignore: [node_modules, .git, dist, build, coverage, .venv, __pycache__, .next, .cache, .turbo, .idea, .vscode, target, out, "*.log"]
    hidden: false             # 是否纳入点文件/点目录（.git 始终排除）
    symbols: true             # 提取顶层符号
    debounceMs: 1000          # watcher 防抖毫秒数
    sortBy: path              # path | size
    brainEnabled: true        # .wolf/ 大脑（摘要/记忆/buglog/账本）
    brainDir: .wolf           # 工作区下的大脑目录名
    sessionDigestBudgetTokens: 1500   # 注入的会话摘要 token 上限
    rescanIntervalHours: 6    # 陈旧警告前的扫描新鲜窗口（小时）
    symbolThresholdTokens: 500        # 超过此 token 数的文件给符号行号提示
    digestEnabled: true       # 会话开始时注入会话摘要
    interceptReads: true      # 重复读警告 + anatomy 提示
    interceptWrites: true     # 动作日志 + 单文件索引刷新
    compactionSurvival: true  # 压缩快照 + 恢复摘要
```

后层可按 `id` 整体覆盖该行，部署方可以保留自己的默认值。

## 用与不用 dsh-openwolf 的差异

插件对本工作区 agent 会话的改变，以及运行它的诚实代价。

| 不用 dsh-openwolf | 用 dsh-openwolf |
| --- | --- |
| 模型反复整文件重读（每次 ~2k tokens） | 先看一行摘要 + token 估算；重复读会被标记 |
| 为找一个函数整文件读取 | 符号行号提示 → `offset`/`limit` 定向读 |
| 上下文压缩抹掉已做的工作 | 压缩幸存：恢复摘要列出本会话已改文件 |
| 每个会话从冷提示开始 | 预算封顶的会话摘要预载 STATUS🚀/Do-Not-Repeat/最近 bugs/地图指针 |
| 不知道 token 花在哪 | 按会话实测账本（provider usage）+ `wolf_report` + dashboard |
| 修过的 bug 反复排查 | `wolf_bug` 搜索防 rediscovery；`wolf_learn` 持久化纠正 |
| 无人值守刷新要手动 | `wolf_schedule` + daemon 零 token 自动 scan |
| 没有项目全局视图 | `anatomy.md` + dashboard（健康/token/活动/cron） |

### 使用它的代价

- **上下文 tokens**：注入的 `AGENTS.md` 地图块（上限 `maxMapBytes`，默认 16 KiB ≈ 4k tokens）随每个会话基线常驻，另有会话摘要（上限 `sessionDigestBudgetTokens`，默认 1500）。两者前缀稳定（KV-cache 友好）。
- **工作区元数据**：每工作区一个 `.wolf/` 目录（KB 级）+ `AGENTS.md` 内的受管块。秘密文件按设计排除。
- **hook 在进程内运行**：读提示附加在结果上（`tools/post-execute`——DSH 没有读前拦截缝，提示与结果同达而非严格先于读取）。
- **符号覆盖**：lezer 覆盖 TS/JS、Python、Go、Rust、Java；其余语言回退正则启发式。lezer 语法是**可选依赖**：未安装（如 `npm install --omit=optional`）时对应语言静默回退正则，不会让扫描报错。
- **daemon/CLI 是独立进程**（与原版同架构）——cron/update/dashboard 需要它。

### 与原版（OpenWolf v2.0.1）的已知差距

- **多 agent 接线 N/A**——原版钩 5 个外部 agent（Claude Code/Codex/OpenCode/Gemini/Cursor）；DSH 本身是 agent 平台，一个大脑服务所有 DSH 会话与子代理。
- **未桥接 `dsh-schedule`**——cron 引擎为自研独立实现（每次运行 0 token），而非 harness 的模型面向调度器。
- **dashboard 是零依赖服务器渲染单页**（面板子集），非 React SPA；描述提取器是原版大启发式的紧凑移植。

## Token 影响（实测）

我们在 DeepSeek Harness 里做了受控 A/B：同一任务（"读 `src/app.ts`，列出函数，新增调用 `createUser` 的 `createUser2`"）、同一份 3 文件工作区，一次**带插件**、一次在裸 profile 上运行。用量为 provider 实测合计（input+output+cache 读写，从会话日志汇总）：

| 运行 | 步数 | 读取 | 编辑 | 计费 tokens |
| --- | --- | --- | --- | --- |
| 带 dsh-openwolf | 3 | 1 | 1 | 39,164 |
| 不带 | 3 | 1 | 1 | 35,488 |
| **差值** | | | | **+3,676（+10%）** |

**诚实解读**：在"单次读取"的最小任务上，插件是**净开销**——固定成本占优。省 token 的机制（避免重复读、offset/limit 定向读、地图优先导航）要等会话读多个文件或重复读同一文件时才兑现。

### 成本结构（插件新增了什么）

| 组件 | 频次 | 大小 |
| --- | --- | --- |
| 会话摘要（+维护提醒） | 会话开始 | ≤ 1,500 tokens（可配） |
| `AGENTS.md` 地图块（`injectAgentsMd` 开启时） | 会话基线 | ≤ `maxMapBytes`（16 KiB ≈ 4k tokens） |
| 10 个 `wolf_*` 工具 schema | **每个请求** | ≈ 1–2k tokens（KV-cache 前缀稳定） |
| 2 条技能目录条目 | 会话基线 | ≈ 100 tokens |

### 省在哪

| 机制 | 节省 | 何时生效 |
| --- | --- | --- |
| 重复读警告 | 每次拦下一次整文件读（~2k tokens） | 会话重复读文件时 |
| 符号行号提示 | offset/limit 定向读代替整文件 | 大文件（>500 tokens） |
| 地图优先导航 | N 次整文件读 → 1 次地图读 | 多文件探索 |
| 压缩幸存 | 压缩后不再重做已完成工作 | 长会话 |

原版项目自身的字段数据（启发式估算）：**20 个项目 / 132 会话平均 ~65.8% token 下降，拦下 71% 的重复读**，其测试项目 ~80%（425K vs 2.5M tokens）。预期：**会话触及多个文件或足够长时回本**；一次性小任务可考虑 `digestEnabled: false` / `injectAgentsMd: false` / 调小 `maxMapBytes`。

## 开发

```sh
pnpm install
pnpm build        # tsc → lib/
pnpm test         # node --test，进程内执行（不依赖子进程 runner）
```

本包是**可擦除 TypeScript** + `rewriteRelativeImportExtensions`：`node` 可直接运行 `src/` 做测试，`tsc` 产出发布用的 ESM `lib/`。`prepare` 脚本从源码构建，这正是 git 安装能工作的原因。

未发布时想在真实 harness 里试用：

```sh
pnpm build
dsh plugin --profile <name> add ./dsh-openwolf
dsh --profile <name> --dump-config | grep -A2 openwolf
```

## 工作原理

- **扫描器**（`src/scanner.ts`）：gitignore 子集匹配（否定、`**`、锚定、目录规则）+ 文件预算 + 大小上限；跳过二进制、超大文件与秘密文件；提取符号（含行号）与一行摘要；估算 token；聚合每目录计数。
- **渲染器**（`src/render.ts`）：按目录分组输出有界 Markdown 地图；管理 `AGENTS.md` 受管块（创建 / 替换 / 保留，幂等）。
- **大脑**（`src/brain.ts`）：持久的 `.wolf/` 存储——配置、STATUS、cerebrum、memory、buglog、token 账本、会话/扫描状态——原子写入 + 秘密黑名单。
- **摘要**（`src/digest.ts`）：预算封顶的会话摘要构建 + git HEAD 陈旧检测。
- **插件**（`src/index.ts`）：按工作区根缓存地图，懒启动防抖 chokidar watcher，从 agent 会话解析工作区（`agent.session.header.cwd`），在 `agent/session-start` 注入会话摘要，在 `tools/post-execute` 拦截 `read`/`write`/`edit`（经 `additionalContexts` 附加模型可见提示），在 `compaction/start` 做快照，向 `ctx.tools` 注册八个工具。所有注册都是 effect：插件卸载（改配置、HMR、重启）时 watcher、定时器、工具一并清理。

扫描/分析引擎零依赖且对外开放：`scanCodebase`、`summarizeFile`、`renderMap`、`injectBlock`、`WolfBrain` 与摘要构建器均为公开 API。

## Model Experience

### 请求上下文与触发条件

#### 模型看到什么

三个工具 schema（`wolf_map`、`wolf_file`、`wolf_refresh`）及其描述；当 `injectAgentsMd` 开启且会话工作区存在 `AGENTS.md` 时，还有 harness 的 `agent-instructions` 插件预载的一段受管 `# Code Map` 块。该块受 `maxMapBytes` 上限约束，仅在地图变化时被替换。

#### Token 影响

注入块是每个会话基线里一次性计费的保留上下文，上限 `maxMapBytes`（默认 16 KiB）。`wolf_map` 按需返回至多 `maxBytes`（或 `maxMapBytes`）；`wolf_file` 返回有界摘要而非整文件。净效果：一次固定地图读取取代 N 次重复整文件读取，即本插件的省 token 机制。

#### KV 缓存影响

地图不变时前缀稳定：`AGENTS.md` 内容相同则请求前缀可复用。重扫导致地图变化（文件编辑、新增文件）会替换该块，从第一个变化的 token 起使复用失效——与任何 `AGENTS.md` 编辑行为一致。工具调用结果只追加，不使更早前缀失效。

## 已知限制与后续计划

- **启发式符号** —— 符号提取基于各语言族的正则，而非真正的解析器；嵌套或非常规声明可能漏掉。v2 的自然方向是 tree-sitter 后端。
- **仅根级 `.gitignore`** —— 暂不支持嵌套 `.gitignore` 与 `git check-ignore` 的精确语义（例如被剪枝目录内的 `!` 重新纳入）。
- **单一指令文件** —— 受管块只维护一个文件（`agentsMdFile`），不同时维护多个指令文件。
- **暂无服务导出** —— v0.1 从插件闭包注册工具；索引器以库函数形式导出，但还没有供其他插件消费的 `ctx.openwolf` 服务。那是 v0.2 的接缝。
- **watch 按请求根懒启动** —— 首次对某根调用 `wolf_*` 才启动 watcher 并保持到插件生命周期结束；从未被查询的根不会被监听。

## License

MIT —— 对代码地图思路的独立实现，不含任何 AGPL 项目的代码。
