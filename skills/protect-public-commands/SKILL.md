---
name: protect-public-commands
description: Review changes to public repository command semantics and all declared consumers. Use when package scripts such as test, static checks, build/package commands, or team-facing aliases change; when RG004 fails; or when documentation, workflows, and command-contract tests may have drifted.
---

# Protect Public Commands

Use RG004 as the deterministic contract check and add human analysis of what the command now means to developers and automation.

## Workflow

1. Run `repo-governance check --json` and isolate RG004 findings.
2. Compare the manifest definition and `.repo-governance.json` contract at the canonical base and current head.
3. Explain semantic changes: selected tests, environment assumptions, artifacts, exit behavior, side effects, platform scope, and tier.
4. Trace configured consumers and supported command aliases. Confirm updates to:
   - command-contract tests;
   - developer/operator documentation;
   - PR, nightly, manual, release, or reusable workflows as applicable.
5. Distinguish a text-only refactor that preserves semantics from an accepted contract change. In both cases keep the exact definition hash synchronized; for semantic changes require all declared consumers in the same PR.
6. Flag suspected unregistered workflow duplication as advisory review feedback only. Do not invent an RG003 hard failure.

## Output

Report old/new semantics, affected consumers, missing synchronized changes, test-tier impact, and the minimal coherent change set. Never say a familiar command is safe merely because its name did not change.
