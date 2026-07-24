import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import {
  parsePrePushInput,
  resolveCiRevision,
  resolvePrePushCandidates,
  writeCanonicalBaseRef,
} from "../src/revisions.mjs";
import { baseConfig, commitAll, git, initGitRepo, temporaryDirectory, write, writeConfig } from "./helpers.mjs";

const ZERO_SHA = "0".repeat(40);

function fixture() {
  const repo = initGitRepo();
  writeConfig(repo, baseConfig());
  write(join(repo, "base.txt"), "base\n");
  const base = commitAll(repo, "base");
  const remote = join(temporaryDirectory("repo-governance-bare-parent-"), "remote.git");
  git(repo, ["init", "--bare", "-b", "main", remote]);
  git(repo, ["remote", "add", "origin", remote]);
  git(repo, ["push", "-u", "origin", "main"]);
  git(repo, ["switch", "-c", "feature"]);
  write(join(repo, "feature.txt"), "feature\n");
  const feature = commitAll(repo, "feature");
  return { repo, remote, base, feature };
}

test("pre-push parser requires exact four-field records", () => {
  const record = `refs/heads/feature ${"a".repeat(40)} refs/heads/feature ${ZERO_SHA}\n`;
  assert.equal(parsePrePushInput(record).length, 1);
  assert.throws(() => parsePrePushInput("invalid\n"), /expected local ref/);
});

test("default branch uses actual remote SHA while feature and tags use remote-tracking default branch", () => {
  const { repo, remote, base, feature } = fixture();
  git(repo, ["switch", "main"]);
  write(join(repo, "main.txt"), "next\n");
  const nextMain = commitAll(repo, "next main");
  const defaultPush = resolvePrePushCandidates(repo, {
    remote: "origin",
    remoteUrl: remote,
    defaultBranch: "main",
    input: `refs/heads/main ${nextMain} refs/heads/main ${base}\n`,
  });
  assert.equal(defaultPush.candidates[0].baseSource, "pre-push-remote-sha");
  assert.equal(defaultPush.candidates[0].canonicalBaseInputSha, base);
  const unavailableRemoteSha = resolvePrePushCandidates(repo, {
    remote: "origin",
    remoteUrl: remote,
    defaultBranch: "main",
    input: `refs/heads/main ${nextMain} refs/heads/main ${"b".repeat(40)}\n`,
  });
  assert.equal(unavailableRemoteSha.candidates[0].baseSource, "remote-tracking-default-branch");
  assert.equal(unavailableRemoteSha.candidates[0].canonicalBaseInputSha, base);

  git(repo, ["tag", "lightweight", feature]);
  git(repo, ["tag", "-a", "annotated", "-m", "annotated", feature]);
  const annotatedObject = git(repo, ["rev-parse", "annotated"]).trim();
  const input = [
    `refs/heads/feature ${feature} refs/heads/feature ${ZERO_SHA}`,
    `refs/tags/lightweight ${feature} refs/tags/lightweight ${ZERO_SHA}`,
    `refs/tags/annotated ${annotatedObject} refs/tags/annotated ${ZERO_SHA}`,
    `(delete) ${ZERO_SHA} refs/heads/old ${"b".repeat(40)}`,
  ].join("\n");
  const result = resolvePrePushCandidates(repo, { remote: "origin", remoteUrl: remote, defaultBranch: "main", input });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].refs.length, 3);
  assert.equal(result.candidates[0].refs[2].pushedObjectSha, annotatedObject);
  assert.equal(result.candidates[0].refs[2].pushedCommitSha, feature);
  assert.equal(result.candidates[0].canonicalBaseInputSha, base);
  assert.deepEqual(result.skipped, [{ ref: "refs/heads/old", reason: "delete" }]);
});

test("missing remote tracking base fails offline with an explicit fetch instruction", () => {
  const { repo, remote, feature } = fixture();
  git(repo, ["update-ref", "-d", "refs/remotes/origin/main"]);
  assert.throws(
    () => resolvePrePushCandidates(repo, {
      remote: "origin",
      remoteUrl: remote,
      defaultBranch: "main",
      input: `refs/heads/feature ${feature} refs/heads/feature ${ZERO_SHA}\n`,
    }),
    /git fetch origin main/,
  );
});

test("unknown remote and non-commit pushed objects fail closed", () => {
  const { repo, remote, base } = fixture();
  assert.throws(() => resolvePrePushCandidates(repo, { remote: remote, remoteUrl: remote, defaultBranch: "main", input: "" }), /configured named remote/);
  const blob = git(repo, ["hash-object", "-w", "--stdin"], { env: process.env }).trim();
  assert.throws(
    () => resolvePrePushCandidates(repo, {
      remote: "origin",
      remoteUrl: remote,
      defaultBranch: "main",
      input: `refs/tags/blob ${blob} refs/tags/blob ${ZERO_SHA}\n`,
    }),
    /cannot be peeled to a commit/,
  );
  assert.match(base, /^[0-9a-f]{40}$/);
});

test("CI revision sources use event head/base SHAs and write the dedicated base ref", () => {
  const { repo, base, feature } = fixture();
  const profile = baseConfig().executionProfiles[0];
  const pullRequest = resolveCiRevision(repo, {
    profile,
    event: { pull_request: { head: { sha: feature }, base: { sha: base } } },
  });
  assert.deepEqual(pullRequest, {
    revisionSource: "pull-request-head",
    eventCommitSha: feature,
    canonicalBaseInputSha: base,
  });
  assert.deepEqual(writeCanonicalBaseRef(repo, base), { ref: "refs/repo-governance/base", canonicalBaseInputSha: base });
  assert.equal(git(repo, ["rev-parse", "refs/repo-governance/base"]).trim(), base);

  const pushProfile = structuredClone(profile);
  pushProfile.consumers[1].revisionSource = "push-event-sha";
  assert.deepEqual(resolveCiRevision(repo, {
    profile: pushProfile,
    githubSha: feature,
    event: { before: base, after: feature },
  }), {
    revisionSource: "push-event-sha",
    eventCommitSha: feature,
    canonicalBaseInputSha: base,
  });
  const mergeProfile = structuredClone(profile);
  mergeProfile.consumers[1].revisionSource = "pull-request-merge";
  assert.deepEqual(resolveCiRevision(repo, {
    profile: mergeProfile,
    githubSha: feature,
    event: { pull_request: { head: { sha: "c".repeat(40) }, base: { sha: base } } },
  }), {
    revisionSource: "pull-request-merge",
    eventCommitSha: feature,
    canonicalBaseInputSha: base,
  });
  assert.throws(() => resolveCiRevision(repo, {
    profile: pushProfile,
    githubSha: feature,
    event: { before: ZERO_SHA, after: feature },
  }), /usable exact head and base/);
});
