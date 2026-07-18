# Classify test tier

Playbook ID: `classify-test-tier`

Canonical Playbook: `../../../playbooks/classify-test-tier.md`

Collect the operating evidence named in `$ARGUMENTS`, then run `repo-governance check --json`. Preserve RG002 as the deterministic rule result.

Use the canonical Playbook to return one advisory classification: `pr-blocking`, `nightly`, `manual-smoke`, or `testSupport`. Report missing evidence explicitly. Do not encode or infer the command graph in this prompt.
