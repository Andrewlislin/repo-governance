# Protect public commands

## CLI input

Run `repo-governance prepare-pr --json` and read `commandContractFindings`, or run `repo-governance check --json` and isolate RG004 findings.

## Review

Explain old and new command semantics: selected tests, environment assumptions, artifacts, exit behavior, side effects, platform scope, and tier. Trace only the consumers declared by the CLI configuration: contract tests, documentation, and workflows.

Keep the exact definition hash synchronized for both semantic changes and text-only refactors. For accepted semantic changes, update every declared consumer in the same change. Treat suspected but unregistered workflow duplication as advisory review feedback, never an invented RG003 failure.

## Boundary

Do not decide safety from the command name and do not reimplement command hashing or consumer evidence matching.
