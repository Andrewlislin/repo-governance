---
name: classify-test-tier
description: Recommend the governance tier for an executable test entry using repository evidence and RG002 JSON. Use when adding or moving tests, separating fixtures from executable entries, or reviewing provider, secret, device, production, cost, duration, or side-effect constraints.
---

# Classify Test Tier

1. Collect the operating evidence requested by the user or repository.
2. Run `repo-governance check --json` and retain RG002 as the rule result.
3. Read [references/playbook.md](references/playbook.md); in the source repository, use `playbooks/classify-test-tier.md`.
4. Return the entry/support decision, one recommended tier, evidence, missing facts, and the verification command.

Do not infer opaque command graphs or encode tier enforcement in this Skill.
