---
name: bootstrap-repo-governance
description: Use the preset-driven repo-governance CLI to adopt governance for an existing, new, or cloned repository. Use when a user asks to initialize governance, connect pre-push, select an explicit preset, or interpret bootstrap JSON before the first governed push.
---

# Bootstrap Repo Governance

1. Confirm the target repository and explicit preset.
2. Run the applicable `repo-governance bootstrap`, `new`, or `clone` command with `--json`.
3. Read [references/playbook.md](references/playbook.md); in the source repository, use `playbooks/bootstrap-repo-governance.md`.
4. Explain only the CLI report and its `nextActions`.

Never infer a preset, report rolled-back adoption as success, write GitHub state, or reimplement RG001–RG005.
