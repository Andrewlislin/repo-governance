# Codex adapter

The five Skills under `skills/` are thin wrappers around version-pinned repo-governance CLI JSON. Detailed advisory workflows live only in the repository-level `playbooks/` directory.

Release and local-source packaging copy each canonical Playbook into the installed Skill as `references/playbook.md`. This keeps the source of truth shared while preserving the standard self-contained installed Skill layout.
