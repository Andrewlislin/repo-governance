# Agent adapters / Agent 适配层

## Shared contract

The repo-governance CLI is the only deterministic rule engine. Codex and Claude Code use the same `schemaVersion: 1` reports, canonical Playbook IDs, command templates, consumed fields, and advisory classification labels. The machine-readable declarations are:

- `adapters/codex/adapter-contract.json`
- `adapters/claude-code/adapter-contract.json`

Cross-adapter tests remove only the adapter name and require the remaining declarations to be identical. They also feed both declarations the same report fixtures. This verifies structured inputs and boundaries; it does not claim two language models will produce word-for-word identical prose.

| Playbook ID | CLI fact source | Adapter output |
|---|---|---|
| `bootstrap-repo-governance` | `bootstrap/new/clone --json` | Adoption explanation and next actions |
| `plan-change-test-impact` | `prepare-pr --json` or explicit `check --json` | Concrete companion-test advice |
| `classify-test-tier` | `check --json` RG002 plus operating evidence | One advisory tier |
| `protect-public-commands` | `prepare-pr --json` RG004 projection | Synchronized consumer advice |
| `triage-ci-failure` | `check --json` plus CI evidence | One advisory failure label |

Codex releases install the five self-contained Skills into `${CODEX_HOME:-$HOME/.codex}/skills`. Claude Code assets remain version-locked under the installed engine:

```text
${XDG_DATA_HOME:-$HOME/.local/share}/repo-governance/
  engines/<engineCommitSha>/agent-assets/
    playbooks/
    adapters/claude-code/
```

To expose a Claude prompt template in one repository, copy the selected Markdown file from `agent-assets/adapters/claude-code/commands/` into that repository's `.claude/commands/` directory. Keep `CLAUDE.md`, `adapter-contract.json`, and the canonical Playbooks available from the same locked asset tree. Agent wrappers must not infer a Preset, recreate path matching or command hashes, silently write GitHub state, or claim test evidence proves semantic coverage.

## 共享契约

repo-governance CLI 是唯一的确定性规则引擎。Codex 与 Claude Code 使用相同的 `schemaVersion: 1` 报告、规范 Playbook ID、命令模板、消费字段和建议分类标签。跨适配测试只忽略适配器名称，要求其余声明完全一致，并让两份声明消费同一组报告 fixture。该测试验证结构化输入和能力边界，不声称两个语言模型会生成逐字一致的自然语言。

Codex release 会把五个自包含 Skill 安装到 `${CODEX_HOME:-$HOME/.codex}/skills`。Claude Code 的 `CLAUDE.md`、命令模板和两边共享的 Playbook 则保存在引擎目录的 `agent-assets/` 下，并由同一个 release manifest 摘要与 `engineCommitSha` 锁定。

如需在某个仓库启用 Claude 命令，把锁定资产中的指定命令 Markdown 复制到该仓库的 `.claude/commands/`。Wrapper 不得猜 Preset、重做路径匹配或命令哈希、静默写 GitHub，也不得把测试类别证据说成语义覆盖已经验证。
