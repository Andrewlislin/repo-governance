# Adoption model

repo-governance uses explicit commands instead of background or transparent Git automation.

For an existing repository, `repo-governance bootstrap --preset <name>` validates the locked runtime, materializes the preset, composes the current repository's effective pre-push hook, writes the thin CI caller, and runs an adoption check. The adoption check treats the current repository snapshot as the initial policy evidence while still validating the real default-branch commit graph.

Bootstrap is atomic. Configuration conflicts, unsafe Hook targets, missing locked runtime files, or governance findings restore the exact prior Hook and remove files created by the failed attempt. Existing `.repo-governance.json` files are never overwritten.

This model deliberately does not:

- intercept native `git clone`;
- select a preset from repository heuristics;
- silently change GitHub rulesets;
- put RG001–RG005 logic in Agent prompts or wrappers.

## New and cloned repositories

`repo-governance new <name> --preset <name>` creates a governance-only repository. It verifies an explicit Git identity, writes governance files through the same bootstrap implementation, commits only those generated files, and then runs the standard check.

`repo-governance clone <repo> [directory] --preset <name>` passes the repository argument directly to `git clone`, preserves source history, and enters the same adoption flow. GitHub is not required for local Hook and CLI governance. For a non-GitHub origin, the generated GitHub Actions caller is reported as a template whose provider applicability has not been confirmed.

Both commands reject pre-existing destinations. If an operation fails, cleanup is limited to the exact destination that the command verified did not exist and then created.
