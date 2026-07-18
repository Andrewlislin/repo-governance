# Triage CI failure

Playbook ID: `triage-ci-failure`

Canonical Playbook: `../../../playbooks/triage-ci-failure.md`

Collect the failing command, first causal error, logs, diff, and environment evidence from `$ARGUMENTS`. Run `repo-governance check --json` and preserve its findings.

Use the canonical Playbook to select exactly one advisory label: `true-bug`, `stale-test`, `stale-workflow`, `wrong-ci-tier`, or `insufficient-evidence`. For insufficient evidence, request the smallest missing artifact and stop before changing code.
