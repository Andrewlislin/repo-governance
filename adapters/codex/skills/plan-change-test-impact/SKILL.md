---
name: plan-change-test-impact
description: Turn repo-governance PR/check JSON into concrete companion-test advice without claiming semantic coverage. Use for API, DTO, state, UI, interaction, command, build, or packaging changes and for RG001 test-evidence findings.
---

# Plan Change Test Impact

1. Run `repo-governance prepare-pr --json`, or an explicit `check --base ... --head ... --json`.
2. Read [references/playbook.md](references/playbook.md); in the source repository, use `playbooks/plan-change-test-impact.md`.
3. Inspect changed behavior and nearby tests, then recommend concrete test files and observable assertions.
4. Preserve `semanticCoverageVerified: false` and the CLI capability boundary.

Do not copy path mappings or turn advisory analysis into a new RG finding.
