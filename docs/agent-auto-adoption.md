# Agent automatic adoption / Agent 自动接入

## Contract and authorization

Run `repo-governance preflight --json` in the task working directory before repository-changing Agent work. It resolves `cwd` and the Git root to real absolute paths, reads governance and user-policy inputs without writing them, and returns one stable report.

The three outcome fields are independent:

- `ok`: whether inspection completed. It may be `true` when governance still needs attention.
- `status`: `succeeded`, `needs_attention`, or `blocked`.
- `exitCode`: shell-compatible `0`, `1`, or `2`.

Repository writes require both `status: "succeeded"` and `repoState: "managed"`. An Agent must not treat `ok: true` alone as permission.

The optional user file is `~/.repo-governance-agent.json` and conforms to `schemas/agent-policy.schema.json`:

```json
{
  "schemaVersion": 1,
  "autoPreflight": true,
  "autoBootstrap": true,
  "defaultPresetByPath": [
    {
      "pathPrefix": "/Users/example/Projects/web",
      "preset": "react-web"
    }
  ]
}
```

Missing policy uses built-in defaults. Invalid JSON, unsupported fields, unknown presets, unresolvable prefixes, unsafe `autoBootstrap`, and equal-priority conflicting matches block. Prefixes and the repository root use real paths; the longest directory-prefix match wins. `autoBootstrap` is effective only when `autoPreflight` is true and the current existing Git repository matches an explicit validated preset.

The policy can waive only the repeated confirmation for this exact local operation:

```sh
repo-governance bootstrap --preset <matched-preset> --json
```

It cannot select a preset dynamically, affect `new` or `clone` without their explicit preset, authorize `github enforce --confirm`, create or comment on a pull request, change a ruleset, or permit any other remote write. Agents consume the `policy` and `recommendedAction` fields returned by preflight; they do not read or match the user file themselves. The file stays outside repositories and release manifests.

The lifecycle has three distinct layers:

1. Agent preflight discovers governance state and decides whether repository work may start.
2. The version-locked offline Git pre-push Hook defends each governed push.
3. `repo-governance prepare-pr --json` checks the clean committed diff before pull request work.

Optional Codex/Claude lifecycle Hooks only surface or deny based on the first-layer result. They must be reviewed, trusted, and installed explicitly. repo-governance does not intercept native `git clone` or `git init`, silently bootstrap, guess presets, or automatically write GitHub state.

## Complete report examples

### Unmanaged repository with an explicitly authorized preset

Inspection completed (`ok: true`), but the repository needs adoption (`status: needs_attention`, `exitCode: 1`). `autoBootstrap` removes repeated confirmation only because `node-library` was selected by the matched real path.

```json
{
  "schemaVersion": 1,
  "command": "preflight",
  "cwd": "/Users/example/Projects/library",
  "updateAdvisory": { "available": false, "currentVersion": "1.1.1", "latestVersion": null, "versionsBehind": 0, "securityFixAvailable": false, "shouldWarn": false, "reason": "catalog_missing", "catalogStatus": "missing" },
  "policy": {
    "source": "user-policy",
    "autoPreflight": true,
    "autoBootstrap": true,
    "matchedPathPrefix": "/Users/example/Projects",
    "preset": "node-library"
  },
  "nextActions": [],
  "ok": true,
  "status": "needs_attention",
  "exitCode": 1,
  "repoPath": "/Users/example/Projects/library",
  "repoState": "unmanaged",
  "inspection": {
    "gitRepository": true,
    "configPresent": false,
    "configValid": null,
    "engineAligned": null,
    "hookConnected": null
  },
  "recommendedAction": {
    "id": "bootstrap-required",
    "command": "repo-governance bootstrap --preset node-library --json",
    "preset": "node-library",
    "requiresPreset": false,
    "requiresConfirmation": false
  },
  "message": "The Git repository is not governed. The user policy selected an explicit preset; bootstrap must complete before writing repository files."
}
```

### Current directory is not a Git repository

Path policy does not apply because there is no existing Git repository. Enter the intended repository or use the explicit `new` workflow; do not write repository files here.

```json
{
  "schemaVersion": 1,
  "command": "preflight",
  "cwd": "/Users/example/Downloads",
  "updateAdvisory": { "available": false, "currentVersion": "1.1.1", "latestVersion": null, "versionsBehind": 0, "securityFixAvailable": false, "shouldWarn": false, "reason": "catalog_missing", "catalogStatus": "missing" },
  "policy": {
    "source": "built-in-defaults",
    "autoPreflight": true,
    "autoBootstrap": false,
    "matchedPathPrefix": null,
    "preset": null
  },
  "nextActions": [],
  "ok": true,
  "status": "needs_attention",
  "exitCode": 1,
  "repoPath": null,
  "repoState": "not_git_repo",
  "inspection": {
    "gitRepository": false,
    "configPresent": false,
    "configValid": null,
    "engineAligned": null,
    "hookConnected": null
  },
  "recommendedAction": {
    "id": "enter-repository-required",
    "preset": null,
    "requiresPreset": false,
    "requiresConfirmation": false
  },
  "message": "The current directory is not a Git repository. Enter a repository or use repo-governance new with an explicit preset."
}
```

### Managed configuration with a disconnected pre-push Hook

Configuration and engine facts remain valid, but the disconnected effective Hook makes the repository `misconfigured`. Read-only diagnosis may continue; repository writes stop until the Hook is repaired and preflight succeeds again.

```json
{
  "schemaVersion": 1,
  "command": "preflight",
  "cwd": "/Users/example/Projects/service",
  "updateAdvisory": { "available": false, "currentVersion": "1.1.1", "latestVersion": null, "versionsBehind": 0, "securityFixAvailable": false, "shouldWarn": false, "reason": "catalog_missing", "catalogStatus": "missing" },
  "policy": {
    "source": "built-in-defaults",
    "autoPreflight": true,
    "autoBootstrap": false,
    "matchedPathPrefix": null,
    "preset": null
  },
  "nextActions": [],
  "ok": true,
  "status": "needs_attention",
  "exitCode": 1,
  "repoPath": "/Users/example/Projects/service",
  "repoState": "misconfigured",
  "inspection": {
    "gitRepository": true,
    "configPresent": true,
    "configValid": true,
    "engineAligned": true,
    "hookConnected": false
  },
  "recommendedAction": {
    "id": "hook-reconnect-required",
    "command": "repo-governance hooks doctor --json",
    "preset": null,
    "requiresPreset": false,
    "requiresConfirmation": true
  },
  "error": {
    "code": "RG_HOOKS_DISCONNECTED",
    "message": "The current repository's effective pre-push hook does not reach the stable dispatcher.",
    "details": {
      "mode": "native",
      "path": "/Users/example/Projects/service/.git/hooks/pre-push",
      "dispatcher": "/Users/example/.local/share/repo-governance/dispatcher"
    }
  },
  "message": "Repository governance is misconfigured: RG_HOOKS_DISCONNECTED: The current repository's effective pre-push hook does not reach the stable dispatcher."
}
```

## 中文说明

Agent 开始修改仓库前，在任务工作目录运行 `repo-governance preflight --json`。`ok` 只表示检查是否完成，`status` 表示工作流结果，`exitCode` 表示 shell 退出语义；只有 `status: "succeeded"` 和 `repoState: "managed"` 同时成立时才允许仓库写入。

可选的 `~/.repo-governance-agent.json` 必须符合 `schemas/agent-policy.schema.json`。路径和仓库根都会解析为真实绝对路径，最长目录前缀优先，同级不同 Preset 冲突直接阻断。`autoBootstrap` 只有在 `autoPreflight: true` 且当前已有 Git 仓库命中显式有效 Preset 时才生效，并且只能免去该 Preset 对应 `bootstrap` 的重复确认。

策略不会授权猜测 Preset、原生 `git clone/git init` 拦截、静默 bootstrap、`github enforce --confirm`、PR 创建或评论、ruleset 修改及其他远端写入。Agent 只消费 CLI 返回的 `policy` 和 `recommendedAction`，不得自行读取用户配置或重做路径匹配。上面三个完整示例分别展示了未治理仓库、非 Git 目录和 Hook 断开；Agent preflight、离线 Git pre-push 和 `prepare-pr` 分别负责工作前发现、push 防守和 PR 前检查。
