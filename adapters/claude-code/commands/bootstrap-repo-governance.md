# Bootstrap repository governance

Playbook ID: `bootstrap-repo-governance`

Canonical Playbook: `../../../playbooks/bootstrap-repo-governance.md`

Use the explicit operation in `$ARGUMENTS` to run one of these commands:

- `repo-governance bootstrap --preset <preset> --json`
- `repo-governance new <name> --preset <preset> --json`
- `repo-governance clone <repo> [directory] --preset <preset> --json`

Require the user to provide the Preset. Read the JSON status, rollback state, check result, and next actions. Explain them according to the canonical Playbook. Do not infer a Preset or reimplement RG001–RG005.
