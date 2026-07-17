# repo-governance

[English](./README.md) | [简体中文](./README.zh-CN.md)

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

## Workflow rule source (RG003)

Only jobs and steps explicitly registered as policy checks are hard-gated. Their registered steps must call an allowlisted central Action, CLI, or formal repository guard; unregistered `run` steps inside a formal policy job fail. Required guard files must exist and be reached through their exact configured entry.

Normal build, environment preparation, and artifact-processing jobs may use multiline scripts. The CLI does not use regex heuristics to decide whether arbitrary YAML “looks like” a duplicate secret, size, or hygiene check; advisory Skills may flag such code for review without turning it into a deterministic failure.

## Public command contracts (RG004)

Each team-confirmed public entry records its manifest, command name, exact definition SHA-256, semantics, test tier, and contract-test/documentation/workflow consumers. `pnpm test`, `check:static`, and `tauri:build` are initializer examples only, not hard-coded global commands.

Changing command text without updating its contract fails. Accepting new semantics also fails until the configured contract tests, documentation, and workflow consumers change in the same diff. This keeps a familiar command name from silently acquiring a different meaning.

## Codex Skills

The `skills/` directory contains five advisory Skills: governance bootstrap, change-to-test impact planning, test-tier classification, public-command protection, and CI failure triage. They read repository evidence and CLI JSON rather than reimplementing hard rules. CI triage always classifies a failure as `true-bug`, `stale-test`, `stale-workflow`, `wrong-ci-tier`, or `insufficient-evidence` before suggesting a fix.

## GitHub enforcement and waiver approvals

Future repositories receive one thin `pull_request` caller pinned to the same full commit as `engineCommitSha`. The reusable workflow checks out the live untrusted head, fetches complete target history, computes merge-base itself, and runs the same CLI. It never uses `pull_request_target`. Core checks have only `contents: read` and `pull-requests: read`; optional comments run in a separate job that does not checkout or execute PR code.

Remote RG005 validation reads live reviews. The latest review by an allowed approver must be `APPROVED` and its `commit_id` must equal the live PR head SHA. Any later commit invalidates the approval, including a waiver-only commit; business changes also invalidate the fixed diff fingerprint.

`repo-governance github enforce` performs a read-only capability, permission, branch-protection, and ruleset preflight. Without `--confirm` it never writes. Missing administration permission or an active ruleset conflict returns `blocked`; a confirmed change is successful only after readback contains the required check.

## Release and installation

Release builds require Node.js 22.x and produce per-platform Node SEA executables for the CLI and stable dispatcher. Published artifacts include SHA-256 metadata and GitHub artifact attestations bound to `Andrewlislin/repo-governance`, `.github/workflows/release.yml`, the source commit, and each subject digest. The attested release manifest also binds the deterministic Skill-tree digest. Installation fails if either checksum or attestation verification fails; checksum alone is never accepted.

CLI/dispatcher data uses `${XDG_DATA_HOME:-$HOME/.local/share}/repo-governance` on macOS/Linux and `%LOCALAPPDATA%/repo-governance` on Windows. Skills use `${CODEX_HOME:-$HOME/.codex}/skills`. The optional shareable-index boundary is documented under `adapters/` and is never a public runtime dependency.
Deterministic repository governance for local hooks, Codex Skills, and GitHub Actions
