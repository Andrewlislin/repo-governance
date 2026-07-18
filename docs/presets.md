# Presets

Presets are explicit, static inputs to the repo-governance CLI. They are not repository detectors and they do not let an Agent guess policy.

## Built-ins

- `node-library`: Node libraries and command/build contracts.
- `node-service`: Node services with API, integration, and migration boundaries.
- `react-web`: React UI behavior and web build boundaries.
- `tauri-desktop`: React/Rust desktop behavior and packaging boundaries.
- `python-service`: Python unit, contract, integration, and build boundaries.

Each preset declares selectors, high-impact mappings, test categories and tiers, public-command candidates, the workflow allowlist template, Hook strategy, and CI caller parameters. The source JSON files are validated against `schemas/preset.schema.json` and bundled into the version-pinned CLI.

Required selectors block bootstrap before any write. Optional selectors are materialized only when the declared file or exact package script exists. Missing optional selectors are returned in `nextActions`; the CLI never writes placeholder command hashes.

Selecting a preset does not generate application code. Review the generated configuration and change it through the normal governed workflow when the repository has project-specific requirements beyond the built-in baseline.
