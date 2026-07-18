# Plan change test impact

## CLI input

Run `repo-governance prepare-pr --json` for a clean committed diff, or `repo-governance check --base <ref> --head <ref> --json` when explicit endpoints are required.

## Interpretation

Use `changedPaths`, `ruleFindings.RG001`, `requiredTests`, and `capabilityBoundary` as the deterministic mapping result. For each affected behavior, inspect nearby tests and recommend the smallest concrete test target and observable assertions. Separate required category evidence from optional regression hardening.

When build or packaging semantics change, include both command-contract and build-verification evidence when the CLI requires them. Never substitute an unrelated changed test merely to satisfy a category.

## Boundary

Always state that companion-category evidence can be present or missing, while assertion quality, semantic coverage, and business correctness still require execution and review.
