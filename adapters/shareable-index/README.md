# Optional shareable-index adapter boundary

`shareable-index` is a personal integration and is not a runtime dependency of repo-governance. Public CLI, workflows, Hooks, and Skills never assume a Common Settings path or a user-specific directory.

After standard installation into `${CODEX_HOME:-$HOME/.codex}/skills`, a user may explicitly run their own shareable-index refresh tool against that directory. The public installer deliberately does not infer, create, or mutate an unknown personal index schema.
