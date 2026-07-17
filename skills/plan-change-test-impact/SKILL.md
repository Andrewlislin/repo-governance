---
name: plan-change-test-impact
description: Analyze a repository diff together with repo-governance JSON to recommend concrete companion tests. Use for API/DTO changes, status-machine changes, UI text/DOM/interaction changes, build-command changes, RG001 failures, or review questions about which unit, contract, integration, frontend, command-contract, or build-verification file should change.
---

# Plan Change Test Impact

Interpret the CLI's deterministic mapping result and add behavior-aware advice. Do not copy the engine's mapping logic or treat RG001 success as proof of semantic coverage.

## Workflow

1. Run `repo-governance check --base <target-ref> --head <target-head> --json` and read `changedPaths`, `findings`, `satisfied`, and `capabilityBoundary`.
2. Inspect the changed behavior and nearby test layout. Trace each high-impact path to the smallest relevant executable test, not merely any changed test file.
3. For every affected behavior, state:
   - the observed change (return shape, state/event, UI text/DOM/interaction, or command/build semantics);
   - the CLI-required category or categories;
   - a concrete existing test file to update, or a proposed new file path;
   - the assertions/observable outcomes that should change;
   - the expected test tier.
4. When build or packaging semantics change, require both command-contract and build-verification evidence.
5. Separate mandatory RG001 evidence from optional regression hardening.

## Output

Return a compact table with business path, behavior impact, required category, concrete test target, tier, and confidence. End with this boundary: companion-category evidence is present or missing, but assertion quality and semantic coverage still require execution and review.
