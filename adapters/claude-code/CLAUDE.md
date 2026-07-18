# repo-governance for Claude Code

Use `repo-governance` as the only deterministic governance engine. Every Agent-facing invocation must request JSON, preserve `schemaVersion`, and explain the returned findings without recreating RG001–RG005.

## Shared workflow

1. Select the matching Playbook in `../../playbooks/`.
2. Run the exact CLI entry declared in `adapter-contract.json` with `--json`.
3. Treat CLI fields, findings, status, and next actions as facts.
4. Add only the advisory explanation allowed by the Playbook.

Never infer a Preset, compute rule findings, hash public commands, reconstruct workflow allowlists, guess test tiers from paths, or write GitHub state. Preserve `semanticCoverageVerified: false`: test-category evidence is not proof of semantic coverage.

The five prompt templates under `commands/` map one-to-one to the shared Playbook IDs. They may be copied into a repository's `.claude/commands/` directory; the canonical templates remain version-locked with the installed engine assets.
