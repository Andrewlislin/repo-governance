# Adoption model

repo-governance uses explicit commands instead of background or transparent Git automation.

For an existing repository, `repo-governance bootstrap --preset <name>` validates the locked runtime, materializes the preset, composes the current repository's effective pre-push hook, writes the thin CI caller, and runs an adoption check. The adoption check treats the current repository snapshot as the initial policy evidence while still validating the real default-branch commit graph.

Bootstrap is atomic. Configuration conflicts, unsafe Hook targets, missing locked runtime files, or governance findings restore the exact prior Hook and remove files created by the failed attempt. Existing `.repo-governance.json` files are never overwritten.

This model deliberately does not:

- intercept native `git clone`;
- select a preset from repository heuristics;
- silently change GitHub rulesets;
- put RG001–RG005 logic in Agent prompts or wrappers.
