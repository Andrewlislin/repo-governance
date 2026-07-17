import assert from "node:assert/strict";
import test from "node:test";
import { validateRemoteWaiverApprovals } from "../src/github/waiver-approval.mjs";

const head = "a".repeat(40);
const event = { pull_request: { head: { sha: head }, base: { ref: "main" } } };
const report = { endpoints: { headSha: head }, acceptedWaivers: [{ waivedBy: "rg001.json" }] };
const config = { waiverApprovers: ["maintainer"] };

test("current-head approval by an allowed reviewer satisfies remote RG005", () => {
  const result = validateRemoteWaiverApprovals({
    event,
    report,
    config,
    reviews: [{ state: "APPROVED", commit_id: head, user: { login: "maintainer" }, submitted_at: "2026-01-01T00:00:00Z" }],
  });
  assert.equal(result.ok, true);
});

test("approval on an earlier head is invalid after any PR update", () => {
  assert.throws(() => validateRemoteWaiverApprovals({
    event,
    report,
    config,
    reviews: [{ state: "APPROVED", commit_id: "b".repeat(40), user: { login: "maintainer" } }],
  }), /live PR head SHA/);
});

test("unapproved reviewer and report head drift fail", () => {
  assert.throws(() => validateRemoteWaiverApprovals({
    event,
    report,
    config,
    reviews: [{ state: "APPROVED", commit_id: head, user: { login: "author" } }],
  }), /allowed GitHub approval/);
  assert.throws(() => validateRemoteWaiverApprovals({
    event,
    report: { ...report, endpoints: { headSha: "c".repeat(40) } },
    config,
    reviews: [],
  }), /does not equal/);
});

test("a later non-approval from the same reviewer supersedes an earlier approval", () => {
  assert.throws(() => validateRemoteWaiverApprovals({
    event,
    report,
    config,
    reviews: [
      { id: 1, state: "APPROVED", commit_id: head, user: { login: "maintainer" } },
      { id: 2, state: "CHANGES_REQUESTED", commit_id: head, user: { login: "maintainer" } },
    ],
  }), /requires an allowed GitHub approval/);
});
