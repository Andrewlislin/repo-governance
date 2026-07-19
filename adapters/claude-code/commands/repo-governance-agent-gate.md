# Repository governance Agent gate

Playbook ID: `repo-governance-agent-gate`

Canonical Playbook: `../../../playbooks/repo-governance-agent-gate.md`

Before changing code, running task tests, committing, or preparing a pull request, run `repo-governance preflight --json` in the task working directory.

Decide only from `status`, `repoState`, and `recommendedAction` together. `ok` means inspection completed; it is not write permission. Continue repository writes only for `status: "succeeded"` with `repoState: "managed"`.

For other states, preserve the CLI recommendation and follow the canonical Playbook. Do not infer a preset, bootstrap silently, repair configuration without approval, write remote state, or recreate governance logic. Re-run preflight after an approved repair. Run `repo-governance prepare-pr --json` only after the intended commits exist and the worktree is clean.
