# Plan change test impact

Playbook ID: `plan-change-test-impact`

Canonical Playbook: `../../../playbooks/plan-change-test-impact.md`

Run `repo-governance prepare-pr --json` for the clean committed diff. If `$ARGUMENTS` supplies explicit endpoints, run `repo-governance check --base <ref> --head <ref> --json` instead.

Use only the returned changed paths, RG001 projection, required test evidence, and capability boundary as deterministic facts. Recommend concrete nearby tests and observable assertions according to the canonical Playbook. Preserve `semanticCoverageVerified: false`.
