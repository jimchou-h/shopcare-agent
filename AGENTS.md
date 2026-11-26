# ShopCare Agent

本文件适用于整个仓库。修改子目录前，读取该路径下更具体的 `AGENTS.md`，并查看与当前 Change 相关的规格和架构决策。

ShopCare Agent 是一个可公开部署的电商换货演示。项目采用 Node.js 24、pnpm 10、TypeScript、React/Vite、Fastify、SQLite 和 Docker。公开演示使用合成的顾客、订单和工单数据。

<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tools** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them. `codegraph_node` returns one symbol's source + callers, or reads a whole file with line numbers. If the tools are listed but deferred, load them by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` and `codegraph node <symbol-or-file>` print the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->

## 规格与交付

- 进行中的行为规格、技术设计和任务进度以 `openspec/changes/<change-name>/` 为准。归档后的行为规格查阅 `openspec/specs/`。GitHub Issues 是 `tasks.md` 的执行视图。
- 按已确认的 Change 顺序推进。先明确可独立验收的用户路径和验收条件，确认 proposal 与任务粒度后再拆票，实现和验证按票执行。用户确认验收通过后归档。
- 先检查工作区状态，保留其他人的改动。限定 diff 在本票范围内。行为、依赖、API 或数据结构改变时，同步受影响的契约、测试和使用说明。
- 关闭 issue 前核对验收结果、提交和远端交付状态，再更新 `tasks.md`。发布与分诊约定见下方 Agent skills。

## 代码与依赖

- TypeScript 启用 `strict`。外部输入使用 schema 从 `unknown` 解析，包括 HTTP 请求、模型结构化输出和外部文件。对外错误用稳定的错误码，详细上下文放在脱敏日志中。
- React 负责交互和展示，Fastify 负责 HTTP 与会话接入。业务规则、Flow 转移和工具权限由服务端用例处理。通过明确的接口接入模型、检索和持久化，避免业务代码依赖浏览器或数据库对象。
- 优先复用现有模块和测试入口。依赖变动同时更新 pnpm 锁文件。SQLite 结构变更用可跟踪的迁移，兼容已有演示数据。

## 注释与代码回读

- 业务注释优先用中文，简明说明这段逻辑为什么存在、依赖哪些约束或在保护什么。变量、函数和类型用准确的名称表达代码行为，注释补充单凭代码难以推断的背景。
- 对有非显然契约的公共入口和跨模块接口，使用 TSDoc 说明调用前提、返回结果的含义、写入等副作用及有意义的失败条件。复杂算法可加一组简短的输入与预期结果，方便对照测试。
- 在需要解释的关键分支附近写注释，例如检索证据不足为何要求补充信息、Flow 为何允许某次状态转移、换货提交如何绑定用户确认与幂等记录，以及访客 Key 在浏览器中的存储边界。
- 行为改变时同步更新相关注释。每票交付时附上主要代码入口和对应测试，需要时按请求、业务处理、结果的顺序给出阅读路径。

## Agent 与公开演示边界

- 政策回答携带可追溯的语料标识。证据不足时说明限制并给出下一步。把模型输出、检索内容和访客输入作为数据处理，业务资格与状态迁移以服务端规则为准。
- 所有会话、订单、工单的读写按服务端识别的访客身份校验归属。模拟坐席权限只覆盖当前访客的演示空间。涉及状态变更的 API 在服务端校验请求来源和当前会话。
- 换货提交校验当前资格和与本次操作绑定的明确确认。写入和幂等记录放在同一事务。重复提交返回原结果，失败时可安全恢复或转人工。
- 访客的 DeepSeek Key 默认只在当前标签页暂存。访客主动选择记住设备后才启用浏览器持久化，并提供清除入口。Key 只作为鉴权凭证随浏览器请求直达 DeepSeek 官方 HTTPS 端点，排除在项目 API、日志、分析系统、测试快照和仓库之外。
- 渲染模型和访客内容时保留转义。公开 API 设定请求大小、执行超时和限流。轨迹仅记录排障所需的引用标识、状态转移、工具结果与耗时，保留脱敏和最小化原则。

## 验证

- 每票默认先写对外行为测试，再实现并重构。测试优先走实际入口。涉及权限、状态和写操作时，覆盖越界读取、拒绝、取消、重试或并发等与该变更相关的失败路径。
- 日常验证使用固定样例和可控的模型替身。真实模型评测另行记录数据集、模型和运行配置，报告任务结果、引用命中、写操作结果和失败轨迹。
- 按当前 `package.json`、README 和 CI 配置运行受影响的类型检查、测试与构建。规格变更运行 `openspec validate <change-name> --strict`。交付时说明实际运行的检查、结果和验证限制。

## Agent skills

### Issue tracker

使用 GitHub Issues。见 [Issue 跟踪约定](docs/agents/issue-tracker.md)。

### Triage labels

使用默认的五个分诊标签。见 [分诊标签](docs/agents/triage-labels.md)。

### Domain docs

使用根目录 `CONTEXT.md` 和 `docs/adr/`。见 [领域文档约定](docs/agents/domain.md)。
