---
name: bootstrap-repo-governance
description: Initialize or review repo-governance policy for a newly created or newly cloned repository. Use when a user asks to adopt governance, map high-impact paths, review initialization candidates, connect Husky/pre-push, or diagnose a version-pinned dispatcher before the repository's first governed push.
---

# Bootstrap Repo Governance

Use the version-pinned CLI as the rule source. This Skill helps the user make explicit policy choices; it must not recreate RG001–RG005 or silently infer strict configuration.

## Workflow

1. Confirm the repository is a future opt-in target. Do not scan, initialize, or modify unrelated existing repositories.
2. Run `repo-governance init --json` without `--accept`. Read the candidate ecosystems, manifests, paths, and public commands.
3. Inspect repository structure and ask the user to confirm:
   - high-impact business path mappings and required test categories;
   - executable `testEntries` versus `testSupport` helpers/fixtures;
   - `pr-blocking`, `nightly`, and `manual-smoke` assignments;
   - public commands and their contract-test, documentation, and workflow consumers;
   - policy jobs, formal guards, and waiver approvers.
4. Present the proposed strict configuration as a diff. Do not claim candidates are confirmed facts.
5. After explicit confirmation, run `repo-governance init --accept`, apply the confirmed policy, and run `repo-governance check --json`.
6. Run `repo-governance hooks doctor --json`. If Husky or another `core.hooksPath` is active, verify both its original pre-push work and the stable dispatcher remain reachable.
7. Report engine version/SHA alignment, unresolved configuration choices, and the exact next command.

## Guardrails

- Never install hooks by relying on the user's current `PATH`.
- Never download or switch engines during push.
- Never overwrite an existing global `init.templateDir`; stop or use explicit composition after review.
- Never report initialization as successful while CLI check or hook doctor is failing.
