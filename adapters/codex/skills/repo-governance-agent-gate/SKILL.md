---
name: repo-governance-agent-gate
description: Gate repository-changing Agent work through the read-only repo-governance preflight JSON contract. Use before fixing bugs, adding features, editing code, running task tests, committing, or preparing a pull request, and when interpreting unmanaged, misconfigured, blocked, or disconnected-hook states.
---

# Repository Governance Agent Gate

1. Run `repo-governance preflight --json` in the task working directory before repository-changing work.
2. Read [references/playbook.md](references/playbook.md); in the source repository, use `playbooks/repo-governance-agent-gate.md`.
3. Decide from `status`, `repoState`, and `recommendedAction` together. Never use `ok` alone as write permission.
4. Continue writes only for `status: "succeeded"` with `repoState: "managed"`.
5. Re-run preflight after an approved bootstrap or Hook repair. Use `repo-governance prepare-pr --json` before pull request work.

Do not infer a preset, repair configuration on your own, write remote state, or reimplement RG001-RG005, engine checks, Hook discovery, or path policy.
