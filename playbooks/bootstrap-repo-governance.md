# Bootstrap repository governance

## CLI input

Run `repo-governance bootstrap --preset <confirmed-preset> --json`. For a new or cloned target, use the corresponding explicit CLI wrapper. Do not infer a preset from repository contents.

## Interpretation

- Treat `preset`, `writtenFiles`, `hookMode`, `checkResult`, and `nextActions` as facts from the CLI.
- Report success only when `ok` is true, `rolledBack` is false, and the check result is successful.
- Explain unmatched optional selectors as deferred candidates, not confirmed missing policy.
- If the CLI blocks or rolls back, preserve its error code, findings, and exact next actions.

## Boundary

Do not recreate preset matching, Hook selection, version locking, or RG001–RG005. GitHub enforcement remains a separate preflight plus explicit confirmation.
