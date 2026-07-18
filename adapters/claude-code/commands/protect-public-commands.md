# Protect public commands

Playbook ID: `protect-public-commands`

Canonical Playbook: `../../../playbooks/protect-public-commands.md`

Run `repo-governance prepare-pr --json` and read `commandContractFindings`. When `$ARGUMENTS` supplies explicit check endpoints, run `repo-governance check --json` with those endpoints and isolate RG004.

Explain the CLI result and the smallest synchronized change set according to the canonical Playbook. Do not compute command hashes, discover consumers independently, or invent workflow findings.
