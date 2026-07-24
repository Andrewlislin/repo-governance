# Execution contracts and RG006

Configuration schema version 1 uses a separately versioned `executionContractVersion`. Version 1 requires `governanceCompleteness: "complete"`, a runtime registry, and execution profiles that reference registered runtimes by `runtimeId`. Top-level or profile-embedded runtime definitions are rejected.

Each runtime declares its language runtime when applicable, an exact package-manager version, and an explicit `systemTools` allowlist. Every tool needs a version range or SHA-256 digest. Platform-specific tools also declare a non-empty `platforms` subset of `darwin`, `linux`, and `win32`; they are verified only on those platforms and never become a fallback elsewhere. A self-contained tool also needs a safe repository-relative tracked path.

Each profile declares:

- one public entry as an argv array;
- ordered `dependencies`, optional `prepare`, and `validate` stages;
- one dependency-preparation contract;
- local Hook and remote workflow consumers.

`consumers` is the only profile-to-workflow mapping. A pre-push consumer is bound to `pushed-ref-tip`. A GitHub Actions consumer names one workflow, job, verification step, trigger, revision source, and the complete execution context: working directory, shell, continuation behavior, step/job conditions, defaults, matrix, needs, environment, runner, container, and timeout.

Protected PR workflow jobs have one fixed sequence:

```text
checkout the exact pull-request head with clean: true
→ set up the registered runtime
→ optionally restore only an external package-manager download cache
→ run the immutable governed validation Action
```

Remote Actions require full 40-character commit SHAs. Local composite Actions, independent dependency/build/test commands, undeclared `run` or `uses` steps, workspace artifact caches, and opaque reusable validation jobs are rejected.

The ordered graph preserves repeated commands. Dynamic shell composition, `||`, `;`, command substitution, and graph cycles are rejected. Repository lifecycle scripts are forbidden by default. If enabled, dependency lifecycle packages must be locked by package name, exact version, integrity, and script stages; repository lifecycle commands must also appear explicitly in the protected `dependencies` stage.

## Dependency definition hash

The definition input contains `resolvedRuntime`, `adapter`, `workingDirectory`, `env`, `lifecycleScripts`, `hookArgv`, and `ciArgv`. Object keys are recursively sorted by UTF-8 bytes, arrays retain their declared order, and the result is serialized as JSON without whitespace.

The SHA-256 input is the UTF-8 byte sequence:

```text
repo-governance:dependency-preparation:v1\0
```

followed immediately by the canonical JSON bytes. CLI validation, tests, documentation examples, and execution adapters call the same implementation.

Static `check --json` reports whether the execution contract passed RG006, but reports `cleanCheckoutVerified: null`, `cleanCheckoutStatus: "not-run"`, and `semanticCoverageVerified: false`. Only isolated dynamic execution may claim a clean checkout.

## Revision and canonical base inputs

Pre-push parses every four-field stdin record and peels each pushed object to a commit. Deletions are skipped. Identical pushed commit/base pairs are verified once, while annotated tags retain both the tag object SHA and peeled commit SHA in their report.

The base comes only from the actual push remote:

- a default-branch update uses the Hook stdin remote SHA when that object is available;
- other refs, and a default-branch creation without an available remote SHA, use `refs/remotes/<remote>/<defaultBranch>`;
- an unknown remote or missing remote-tracking base fails offline and tells the user to run `git fetch <remote> <defaultBranch>`.

No Hook path fetches or falls back to a local branch. CI uses the event payload’s exact pull-request base SHA or push `before` SHA and binds the event revision to `pull-request-head`, `pull-request-merge`, or `push-event-sha`. The chosen base is written to `refs/repo-governance/base` before the explicit static check.

## Dynamic CI verification

The protected Action invokes `verify-execution --profile <id> --ci --event-file <path>`. The command resolves the configured consumer’s exact event and base revisions, requires checked-out `HEAD` to equal that event revision, and rejects any staged, unstaged, untracked, or ignored residue before static validation.

RG001–RG006 run before runtime validation or dependency preparation. After the static check succeeds, the verifier constructs a controlled `PATH` from the declared runtime, allowlisted system tools, exact package manager, and checkout-local dependency binaries. It then runs the profile’s `ciArgv` followed by its public entry. A final proof requires unchanged `HEAD`, unchanged `refs/repo-governance/base`, and no staged or unstaged tracked changes.

The Action writes its JSON report to the runner’s external temporary directory while verification is active, then moves the completed report to the requested path. This prevents report creation itself from contaminating the initial clean-checkout proof.

## Revision-bound pre-push

The effective Hook path contains only a governance wrapper. On connection, an existing executable Hook is atomically moved to `pre-push.repo-governance-original`; a sibling manifest records wrapper, sidecar, dispatcher, permissions, digests, and protocol version. The wrapper applies `umask 077`, captures stdin once in a secure `mktemp` file, installs normal and signal cleanup traps, and passes the complete bytes first to the sidecar and then to the stable dispatcher. Either failure blocks the push. `hooks doctor` rejects missing, changed, recursive, non-executable, or digest-mismatched components. `hooks disconnect` restores the original Hook only while every recorded component is unchanged.

The stable dispatcher parses the proposed ref records before selecting an engine. For every non-deletion object it peels the pushed commit, reads that commit’s `.repo-governance.json`, and verifies the candidate’s exact installed engine and protocol. It groups only candidates with the same verified identity and replays their original stdin records to that engine; mutable workspace configuration and the default-engine pointer are never fallbacks.

The engine resolves the candidate commit’s own default branch and source-remote base, then creates an isolated checkout with `git clone --local --no-hardlinks --no-checkout`, `GIT_LFS_SKIP_SMUDGE=1`, and no submodule recursion. Each unique pushed commit/base pair is checked out detached and verified once per declared pre-push profile. Static RG001–RG006 validation precedes runtime checks, offline dependency preparation, and profile execution. Temporary checkouts are removed on success, failure, and handled termination signals, and source-repository Git operations use `GIT_OPTIONAL_LOCKS=0`.

This local Hook remains bypassable with `git push --no-verify`, and an offline remote-tracking base can be stale. Required remote CI on the event’s exact revision is the final enforcement boundary.
