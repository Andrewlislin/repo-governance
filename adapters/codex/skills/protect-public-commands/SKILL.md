---
name: protect-public-commands
description: Review public command changes and their declared tests, documentation, and workflow consumers using RG004 JSON. Use when package scripts, build/test aliases, command semantics, environment assumptions, artifacts, or CI consumers change.
---

# Protect Public Commands

1. Run `repo-governance prepare-pr --json` and read `commandContractFindings`, or isolate RG004 from `check --json`.
2. Read [references/playbook.md](references/playbook.md); in the source repository, use `playbooks/protect-public-commands.md`.
3. Explain semantic impact and the smallest coherent synchronized change set.

Do not compute hashes, discover consumers independently, or invent RG003 findings.
