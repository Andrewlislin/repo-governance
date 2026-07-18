---
name: triage-ci-failure
description: Classify a CI failure from logs, repository evidence, and repo-governance JSON before proposing a fix. Use for failed tests, builds, workflows, provider checks, governance checks, stale assertions, stale automation, or suspected wrong CI tier.
---

# Triage CI Failure

1. Collect the failing command, first causal error, logs, diff, and environment evidence.
2. Run `repo-governance check --json` and preserve its findings.
3. Read [references/playbook.md](references/playbook.md); in the source repository, use `playbooks/triage-ci-failure.md`.
4. Return one advisory classification, evidence, rejected alternatives, minimal fix scope, and verification.

For insufficient evidence, request the smallest missing artifact and stop before modifying code. Never change business code merely to make CI green.
