# Execution contracts and RG006

Configuration schema version 1 uses a separately versioned `executionContractVersion`. Version 1 requires `governanceCompleteness: "complete"`, a runtime registry, and execution profiles that reference registered runtimes by `runtimeId`. Top-level or profile-embedded runtime definitions are rejected.

Each runtime declares its language runtime when applicable, an exact package-manager version, and an explicit `systemTools` allowlist. Every tool needs a version range or SHA-256 digest. A self-contained tool also needs a safe repository-relative tracked path.

Each profile declares:

- one public entry as an argv array;
- ordered `dependencies`, optional `prepare`, and `validate` stages;
- one dependency-preparation contract;
- local Hook and remote workflow consumers.

The ordered graph preserves repeated commands. Dynamic shell composition, `||`, `;`, command substitution, and graph cycles are rejected. Repository lifecycle scripts are forbidden by default. If enabled, dependency lifecycle packages must be locked by package name, exact version, integrity, and script stages; repository lifecycle commands must also appear explicitly in the protected `dependencies` stage.

## Dependency definition hash

The definition input contains `resolvedRuntime`, `adapter`, `workingDirectory`, `env`, `lifecycleScripts`, `hookArgv`, and `ciArgv`. Object keys are recursively sorted by UTF-8 bytes, arrays retain their declared order, and the result is serialized as JSON without whitespace.

The SHA-256 input is the UTF-8 byte sequence:

```text
repo-governance:dependency-preparation:v1\0
```

followed immediately by the canonical JSON bytes. CLI validation, tests, documentation examples, and execution adapters call the same implementation.

Static `check --json` reports whether the execution contract passed RG006, but reports `cleanCheckoutVerified: null`, `cleanCheckoutStatus: "not-run"`, and `semanticCoverageVerified: false`. Only isolated dynamic execution may claim a clean checkout.
