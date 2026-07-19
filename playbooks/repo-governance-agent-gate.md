# Repository governance Agent gate

## CLI input

Before changing code, running task tests, committing, or preparing a pull request, run `repo-governance preflight --json` in the task working directory. Use `cwd` only as the invocation location and `repoPath` as the repository root. Never treat `cwd` as the root when the CLI returns a different `repoPath`.

For a new or cloned project, prefer the explicit `repo-governance new` or `repo-governance clone` entry point with a user-confirmed preset. Before pull request work, use `repo-governance prepare-pr --json` after the intended commits exist and the worktree is clean.

## Decision contract

Decide from `status`, `repoState`, and `recommendedAction` together. `ok` only states that preflight completed; it is never sufficient permission to write.

- Continue repository writes only for `status: "succeeded"` and `repoState: "managed"`.
- For `unmanaged`, preserve the CLI-selected action, preset, and confirmation fields. Ask for a preset or confirmation when required, then call the explicit bootstrap command. Never infer a preset.
- For `not_git_repo`, do not write repository files. Ask the user to enter the intended repository or choose the explicit `new` workflow.
- For `misconfigured`, allow read-only inspection and diagnosis but stop edits, tests that create repository artifacts, commits, and other repository writes. Preserve the CLI error and recommendation exactly.
- For `blocked`, stop and report the CLI error. Do not attempt a local fallback classification.

After an approved bootstrap or Hook repair, run preflight again and require the managed/succeeded pair before writing. A disconnected Hook remains `misconfigured` even when configuration and engine facts are valid.

## Authorization boundary

`policy.autoBootstrap` can waive repeated bootstrap confirmation only when the CLI also returns an explicit preset and a bootstrap action. It does not allow preset inference. It never authorizes `github enforce --confirm`, pull request creation, comments, ruleset changes, or other remote writes.

Optional lifecycle Hooks may surface this decision earlier and deny matched edit tools, but they are an explicitly installed and trusted guardrail, not a complete enforcement boundary. The Hook runner only invokes preflight and translates its report. It does not implement RG001-RG005, engine checks, Hook discovery, preset selection, or path policy.
