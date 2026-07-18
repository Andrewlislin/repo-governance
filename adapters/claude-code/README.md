# Claude Code adapter

`CLAUDE.md` and the five prompt templates under `commands/` consume the same version-pinned CLI JSON and canonical Playbooks as the Codex adapter. `adapter-contract.json` declares the shared report version, command templates, consumed fields, and advisory classification labels used by cross-adapter tests.

Copy only the prompt templates you want into a repository's `.claude/commands/` directory. Do not copy rules into the prompt: each template reads the matching Playbook and delegates deterministic findings to `repo-governance`.
