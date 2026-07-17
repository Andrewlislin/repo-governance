---
name: classify-test-tier
description: Recommend a repo-governance test tier for a new or changed executable test entry. Use when adding tests, reviewing CI placement, separating fixtures/helpers from runnable entries, or deciding whether real-provider, secret-bearing, cross-device, expensive E2E, production smoke, or deterministic tests belong in PR, nightly, or manual workflows.
---

# Classify Test Tier

Classify intent and operating requirements, then let RG002 enforce the confirmed configuration. Do not edit the command graph based on guesses.

## Workflow

1. Determine whether the file or command is directly executable. Fixtures, mocks, setup, helpers, shared test utilities, and data belong in `testSupport`, not a tier.
2. For an executable entry, collect evidence about determinism, credentials, provider/network access, duration/cost, devices, production accounts, deployment dependency, and external side effects.
3. Recommend exactly one tier:
   - `pr-blocking`: deterministic unit, contract, integration/frontend, typecheck, and build verification suitable for every PR.
   - `nightly`: real provider, real secret, cross-device, costly, long-running, or environment-sensitive E2E without production side effects.
   - `manual-smoke`: production environment/account, post-deploy checks, or scripts with external side effects.
4. Run `repo-governance check --json` after configuration changes. A nightly/manual entry reachable from a PR command is invalid even if it skips without credentials.
5. If command indirection uses dynamic shell, Makefile, `eval`, or an opaque script, request an explicit alias/formal entry instead of inferring the graph.

## Output

State `entry` or `testSupport`, the recommended tier, decisive evidence, disqualifiers for other tiers, configuration edits, and a verification command. If evidence is incomplete, list the missing facts instead of choosing a tier.
