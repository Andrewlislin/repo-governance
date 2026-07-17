# CI failure classification fixtures

Use these fixtures as boundary examples, not as keyword rules.

| Evidence | Classification | Why |
| --- | --- | --- |
| Current contract says status `ready`; implementation returns `error`; current contract test fails on `error` | `true-bug` | Business behavior violates the active contract. |
| PR intentionally changes response field `name` to `displayName`; updated contract/docs agree; old assertion still expects `name` | `stale-test` | The test encodes the superseded contract. |
| Workflow still runs removed `pnpm legacy:test` while repository contract and docs use `pnpm test` | `stale-workflow` | CI orchestration is stale, not product behavior. |
| Default PR job invokes a real provider test needing a live key and network; deterministic contract suite passes | `wrong-ci-tier` | The executable belongs in nightly, regardless of skip behavior. |
| Log contains only `exit code 1` with no failed assertion, command, diff, or environment detail | `insufficient-evidence` | No unique causal category can be supported. |

Counterexamples:

- A snapshot mismatch is not automatically `stale-test`; it can expose a real unintended UI change.
- A missing secret is not automatically `wrong-ci-tier`; a deterministic test may have been incorrectly configured by a stale workflow.
- A workflow failure is not automatically `stale-workflow`; the workflow may correctly surface a true build bug.
