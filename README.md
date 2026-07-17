# repo-governance

Deterministic repository governance shared by local Git hooks, Codex Skills, and GitHub Actions. The project is intentionally split into a hard, explainable CLI rule engine and advisory Skills. The same version-pinned engine is used locally and in CI.

## Capability boundary

`RG001` verifies that a high-impact business change has same-change evidence in every configured companion test category. It does **not** prove that assertions cover the new semantics, that the implementation is correct, or that a test is high quality. Test execution, review, and `plan-change-test-impact` advice remain necessary.

## Development

Node.js 22 is required.

```sh
npm test
npm run check:static
```

The installed pre-push hook is thin and offline. It invokes a stable dispatcher in the platform data directory; the dispatcher reads `engineCommitSha` from `.repo-governance.json`, verifies the locked executable, and then runs `repo-governance check`. Missing or corrupt engines fail with an explicit `repo-governance update` instruction.

## Initializing a future repository

```sh
repo-governance init --json
# Review the detected candidates and define strict mappings.
repo-governance init --accept
```

Installation is future-only. `hooks install` configures a Git template but never scans or mutates existing repositories. Existing global `init.templateDir` configuration is preserved unless the user explicitly requests `--compose`; conflicting files stop composition. Repositories that use Husky or another `core.hooksPath` retain their existing pre-push commands and receive an appended dispatcher call.

The versioned configuration schema is in `schemas/repo-governance.schema.json`. Waivers live in `.repo-governance/waivers/*.json`, can apply only to `RG001`, exclude their own directory from the fixed business diff fingerprint, and never store a head SHA or approval state.

## Test tiers (RG002)

Executable test entries belong to exactly one of `pr-blocking`, `nightly`, or `manual-smoke`. Fixtures, mocks, helpers, setup modules, shared test utilities, and test data belong in `testSupport` and are not classified as standalone entries. A PR-blocking command may never reach a nightly or manual entry, even if that entry skips without a real secret.

The V1 command graph deliberately understands only `package.json` scripts, pnpm workspace/filter/run calls, Bun scripts, configured Python/pytest entries, and explicit aliases. Dynamic composition, `eval`, Makefile dispatch, opaque shell scripts, and unknown indirect calls in a protected chain are configuration errors; the engine does not guess.
Deterministic repository governance for local hooks, Codex Skills, and GitHub Actions
