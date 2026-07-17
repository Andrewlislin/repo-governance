---
name: triage-ci-failure
description: Classify a failing CI run before proposing or applying a fix. Use when tests, builds, workflows, provider checks, or governance rules fail and the team must distinguish a true bug, stale test, stale workflow, wrong CI tier, or insufficient evidence without reflexively changing business code.
---

# Triage CI Failure

Read [classification-fixtures.md](references/classification-fixtures.md) before classifying. Classification is evidence-driven and precedes any fix.

## Workflow

1. Collect the failed job/step, exact command, first causal error, relevant log context, PR diff, recent workflow/test changes, and `repo-governance check --json` output.
2. Reproduce with the same public command and environment when safe. Do not use production credentials or create external side effects merely to reproduce.
3. Assign exactly one label:
   - `true-bug`: implementation violates the current intended contract and a current test exposes it.
   - `stale-test`: implementation/contract intentionally changed, but assertions or fixtures still encode the old contract.
   - `stale-workflow`: workflow invokes an obsolete command, path, input, action, or duplicated policy implementation.
   - `wrong-ci-tier`: the check requires real provider/secret/device, high cost/duration, production context, or side effects that do not belong in PR blocking.
   - `insufficient-evidence`: available evidence does not uniquely support one of the four categories.
4. State positive evidence and rejected alternatives. If classification is `insufficient-evidence`, request the smallest missing artifact and stop before modifying code.
5. Only after classification, propose the smallest coherent fix that updates implementation, tests, docs, and workflow together when their contract changes.

## Output

Return: classification, confidence, causal evidence, alternatives rejected, minimal fix scope, and verification. Do not change business code to make CI green until evidence supports `true-bug`.
