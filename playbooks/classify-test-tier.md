# Classify a test tier

## Evidence

Determine whether the item is an executable entry or support data. Collect evidence about determinism, credentials, provider/network access, cost, duration, devices, deployment dependency, production context, and external side effects.

## Advisory classification

- `pr-blocking`: deterministic tests and build/static verification suitable for every PR.
- `nightly`: real providers, secrets, devices, cost, duration, or environment sensitivity without production side effects.
- `manual-smoke`: production context, post-deploy checks, or external side effects.
- `testSupport`: fixtures, mocks, helpers, setup, shared utilities, and test data that are not executable entries.

Run `repo-governance check --json` after the confirmed configuration changes. Use RG002 output as the rule result. If a protected command is dynamic or opaque, require an explicit alias or entry instead of inferring its graph.
