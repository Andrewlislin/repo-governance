# Triage a CI failure

## Evidence

Collect the failed job and step, exact command, first causal error, relevant log context, PR diff, recent workflow/test changes, and `repo-governance check --json` output. Reproduce with the same public command when safe; never use production credentials or side effects only to reproduce.

## Classification

Assign exactly one advisory label:

- `true-bug`: implementation violates the active intended contract.
- `stale-test`: an intentional contract change left assertions or fixtures on the old contract.
- `stale-workflow`: CI invokes an obsolete command, path, input, Action, or duplicated policy implementation.
- `wrong-ci-tier`: the executable requires provider, secret, device, cost, production context, or side effects inappropriate for PR blocking.
- `insufficient-evidence`: available evidence cannot uniquely support another label.

State positive evidence and rejected alternatives. For `insufficient-evidence`, request the smallest missing artifact and stop before modifying code. Propose a fix only after classification, while preserving CLI RG findings as facts.

## Boundary examples

- A snapshot mismatch can expose a true unintended UI change; it is not automatically a stale test.
- A missing secret can be a stale workflow; it is not automatically a tier problem.
- A workflow failure can correctly expose a product or build bug.
