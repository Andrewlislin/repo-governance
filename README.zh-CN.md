# repo-governance

[English](./README.md) | [简体中文](./README.zh-CN.md)

由本地 Git hooks、CI、Codex 和 Claude Code 共享的确定性仓库治理工具。本项目有意拆分为严格且可解释的 CLI 规则引擎和精简的建议型 Agent 适配层。本地与 CI 使用固定为同一版本的规则引擎。

## 能力边界

`RG001` 验证高影响业务变更是否在同一次变更中为配置要求的每个配套测试类别提供了证据。它**不能**证明断言覆盖了新的语义、实现正确或者测试具有高质量。测试执行、代码审查以及 `plan-change-test-impact` 的建议仍然不可或缺。

## 开发

需要 Node.js 22。

```sh
npm test
npm run check:static
```

## 源码安装

适用于本地开发或让 Agent 协助部署：

```sh
git clone https://github.com/Andrewlislin/repo-governance.git
cd repo-governance
npm ci
npm run install:local
```

该命令会构建本地 engine，安装到标准 repo-governance 数据目录，并输出下一步安装 hooks 的命令。

安装的 pre-push hook 保持精简且离线运行。它调用平台数据目录中的稳定 dispatcher；dispatcher 从 `.repo-governance.json` 读取 `engineCommitSha`，验证锁定的可执行文件，然后运行 `repo-governance check`。如果引擎缺失或损坏，检查会明确失败并提示执行 `repo-governance update`。

## 已有仓库快速接入

先安装经过验证且锁定版本的 release，然后运行一次显式接入命令：

```sh
cd existing-repository
repo-governance bootstrap --preset node-library --json
```

`bootstrap` 会验证所选静态 Preset、写入 `.repo-governance.json` 和精简 GitHub Actions caller、组合当前仓库实际生效的 pre-push hook，并运行 adoption 检查。它绝不会覆盖已有治理配置；接入失败时会恢复原 Hook，并删除本次尝试创建的文件。

内置 Preset 包括 `node-library`、`node-service`、`react-web`、`tauri-desktop` 和 `python-service`。详见 [Preset 说明](docs/presets.md) 与 [接入模型](docs/adoption-model.md)。

## 新建与克隆仓库快速接入

需要在创建或克隆仓库的同时完成治理接入时，使用以下显式入口：

```sh
repo-governance new my-service --preset node-service --json
repo-governance clone https://example.com/team/project.git --preset node-service --json
```

`new` 创建只含治理骨架的 Git 仓库，只提交生成的治理文件，然后运行标准检查；它不会生成业务代码。`clone` 保留原提交历史，并把生成的治理文件作为未提交变更留给开发者审阅。如果 clone、bootstrap、check 或 Git 身份验证失败，只会删除本次命令创建的目标目录。

本工具绝不会拦截原生 `git clone`。只有显式使用 `repo-governance clone` 才会获得组合流程。

## 准备 Pull Request

提交完计划纳入 PR 的全部变更后，运行确定性预检：

```sh
repo-governance prepare-pr --json
```

`prepare-pr` 要求工作区干净，并把普通 `check` 结果投影为 RG001–RG005 分组、必要测试证据、workflow findings、命令契约 findings 和 Markdown PR body 草稿。它不会创建 PR、调用 `gh`、发表评论或写入 GitHub。报告始终保留 RG001 能力边界：存在配套测试类别证据不代表语义覆盖已经验证。

## 手工初始化未来仓库

```sh
repo-governance init --json
# 审阅检测到的候选项并定义严格映射。
repo-governance init --accept
```

安装仅面向未来仓库。`hooks install` 会配置 Git template，但绝不会扫描或修改现有仓库。除非用户明确指定 `--compose`，否则会保留已有的全局 `init.templateDir` 配置；组合时如有文件冲突则停止。使用 Husky 或其他 `core.hooksPath` 的仓库会保留已有 pre-push 命令，并在其后追加 dispatcher 调用。

版本化配置 Schema 位于 `schemas/repo-governance.schema.json`。豁免文件位于 `.repo-governance/waivers/*.json`，只能应用于 `RG001`；固定业务 diff 指纹会排除豁免文件自身所在的目录，并且豁免文件永远不会保存 head SHA 或审批状态。

## 测试分层（RG002）

可执行测试入口必须且只能属于 `pr-blocking`、`nightly` 或 `manual-smoke` 中的一层。fixture、mock、helper、setup 模块、共享测试工具和测试数据应归入 `testSupport`，不会被归类为独立测试入口。PR blocking 命令绝不能触达 nightly 或 manual 入口，即使该入口在没有真实 secret 时会跳过执行。

V1 的命令图刻意只支持 `package.json` scripts、pnpm workspace/filter/run 调用、Bun scripts、配置中登记的 Python/pytest 入口和显式别名。受保护调用链中的动态拼接、`eval`、Makefile 分派、不透明 shell 脚本和未知间接调用都属于配置错误；规则引擎不会进行猜测。

## Workflow 单一规则源（RG003）

硬门禁只作用于明确登记为策略检查的 job 和 step。登记的 step 必须调用 allowlist 中的中央 Action、CLI 或正式仓库守卫；正式策略 job 中出现未登记的 `run` step 会导致失败。要求存在的守卫文件必须真实存在，并通过配置的精确入口被调用。

普通构建、环境准备和产物处理 job 可以使用多行脚本。CLI 不会使用正则启发式判断任意 YAML 是否“看起来像”重复实现了 secret、大小或卫生检查；提供建议的 Skills 可以提示审阅此类代码，但不会将其变成确定性失败。

## 公共命令契约（RG004）

团队确认的每个公共入口都记录其 manifest、命令名称、精确定义的 SHA-256、语义、测试层级以及契约测试、文档和 workflow 消费者。`pnpm test`、`check:static` 和 `tauri:build` 只是初始化器示例，并非硬编码的全局命令。

修改命令文本但不更新契约会导致失败。主动接受新语义后，如果配置的契约测试、文档和 workflow 消费者没有在同一 diff 中更新，也会导致失败。这样可以防止熟悉的命令名称悄悄获得不同的含义。

## 在 Codex 与 Claude Code 中使用

Agent 无关的建议知识统一位于 `playbooks/`。精简 Codex wrapper 位于 `adapters/codex/skills/`；Claude Code 使用 `adapters/claude-code/` 下的 `CLAUDE.md` 和五个对应命令模板。两套适配声明相同的 CLI 命令、JSON 报告版本、Playbook ID、消费字段和建议标签。它们调用锁定版本的 CLI 并解释 JSON，不重新实现硬规则。

CI 失败分类会先选择 `true-bug`、`stale-test`、`stale-workflow`、`wrong-ci-tier` 或 `insufficient-evidence`，然后才提出修复建议。这些是建议标签；CLI RG findings 始终是确定性事实。

Release 与源码安装会把规范 Playbook 和两套 adapter 保存在已安装引擎的版本锁定 `agent-assets/` 目录中。Codex Skill 还会安装到 `CODEX_HOME`；可按需把 Claude 模板复制到目标仓库的 `.claude/commands/`。详见 [Agent 适配说明](docs/agent-adapters.md)。

## GitHub 强制层与豁免审批

未来仓库会获得一个精简的 `pull_request` 调用 workflow，并固定到与 `engineCommitSha` 相同的完整提交。reusable workflow 会 checkout 实时的不可信 head、获取完整目标分支历史、自行计算 merge-base，并运行同一 CLI。它绝不会使用 `pull_request_target`。核心检查只拥有 `contents: read` 和 `pull-requests: read` 权限；可选评论在单独的 job 中运行，该 job 不会 checkout 或执行 PR 代码。

远端 `RG005` 验证会读取实时 Review。允许审批者的最新 Review 必须为 `APPROVED`，且其 `commit_id` 必须等于实时 PR head SHA。包括仅修改豁免文件在内的任何后续提交都会使审批失效；业务变更还会使固定 diff 指纹失效。

`repo-governance github enforce` 会对能力、权限、分支保护和 ruleset 执行只读预检。不带 `--confirm` 时绝不会写入。缺少管理权限或存在有效 ruleset 冲突时返回 `blocked`；确认执行后的修改只有在回读结果包含 required check 时才算成功。

## 发布与安装

发布构建需要 Node.js 22.x，并为 CLI 和稳定 dispatcher 生成各平台的 Node SEA 可执行文件。GitHub Releases 每个平台只发布一个压缩包（Linux/macOS 使用 `.tar.gz`，Windows 使用 `.zip`），并附带顶层 `SHA256SUMS` 和 `release-index.json`；不使用 GitHub Packages。每个压缩包内部包含 CLI、dispatcher、Codex Skills、规范 Playbook、Codex/Claude adapter、内部 manifest 和平台内校验文件。发布产物包含 SHA-256 元数据和 GitHub artifact attestation，后者绑定到 `Andrewlislin/repo-governance`、`.github/workflows/release.yml`、源码提交、平台压缩包以及 release manifest。经过 attestation 的 release manifest 还会绑定确定性的 Skill、策略资产和 Agent 资产目录摘要。如果 checksum 或 attestation 任一验证失败，安装都会失败；绝不单独信任 checksum。

在 macOS/Linux 上，CLI/dispatcher 数据使用 `${XDG_DATA_HOME:-$HOME/.local/share}/repo-governance`；在 Windows 上使用 `%LOCALAPPDATA%/repo-governance`。Skills 使用 `${CODEX_HOME:-$HOME/.codex}/skills`。可选的 shareable-index 边界记录在 `adapters/` 下，绝不会成为公开项目的运行时依赖。

面向本地 hooks、CI、Codex 和 Claude Code 的确定性仓库治理工具
