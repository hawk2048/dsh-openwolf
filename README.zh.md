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

重启 profile（`dsh web`）。bundle 层会插入一行 host 插件，为每个会话注册上述三个工具。

从 git URL 安装拉取的是**源码而非构建产物**，首次 `add` 会失败，需要先在 profile 的 `pnpm-workspace.yaml` 里授权构建：

```yaml
allowBuilds:
  dsh-openwolf: true
```

然后重新执行 `add`。从 npm 或 tarball 安装则无需任何授权。

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

- **会话摘要** —— `agent/session-start` 时经 `agent.inject()` 注入预算封顶的摘要：STATUS 🚀 下一阶段 → Do-Not-Repeat（最近 10 条）→ 最近 5 个 bug → anatomy 指针；钉住的 git HEAD 移动或上次扫描超过 `rescanIntervalHours` 时，前缀**陈旧警告**。
- **读拦截** —— `read` 工具的 `tools/post-execute`：anatomy 提示（`path — summary (~tokens)`）；超过 `symbolThresholdTokens` 的文件给出前 5 个符号的行号，引导 offset/limit 定向读；文件在索引后变过则抑制提示。同会话重复读同一文件会警告并给出此前 token 成本。
- **写拦截** —— `write`/`edit` 结果写入 `memory.md`、记入会话状态，并把该文件单文件重分析进缓存地图。
- **压缩幸存** —— `compaction/start` 快照 + `session-start(source: compact)` 恢复摘要（列出本会话已修改文件）。
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
