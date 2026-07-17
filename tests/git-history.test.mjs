import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { resolveCanonicalBase } from "../src/git.mjs";
import { commitAll, git, initGitRepo, temporaryDirectory, write } from "./helpers.mjs";

test("merge and rebase histories produce the target-derived canonical base", () => {
  const repo = initGitRepo();
  write(join(repo, "base.txt"), "base\n");
  commitAll(repo, "base");
  git(repo, ["switch", "-c", "feature"]);
  write(join(repo, "feature.txt"), "feature\n");
  commitAll(repo, "feature");
  git(repo, ["switch", "main"]);
  write(join(repo, "main.txt"), "main update\n");
  const mainTip = commitAll(repo, "main update");
  git(repo, ["switch", "feature"]);
  git(repo, ["merge", "--no-edit", "main"]);
  assert.equal(resolveCanonicalBase(repo, "main", "HEAD").canonicalBaseSha, mainTip);

  git(repo, ["switch", "-c", "rebased", "HEAD~2"]);
  write(join(repo, "rebased.txt"), "rebased feature\n");
  commitAll(repo, "rebased work");
  git(repo, ["rebase", "main"]);
  assert.equal(resolveCanonicalBase(repo, "main", "HEAD").canonicalBaseSha, mainTip);
});

test("shallow history fails explicitly and never trusts a declared waiver base", () => {
  const source = initGitRepo();
  write(join(source, "base.txt"), "base\n");
  commitAll(source, "base");
  git(source, ["switch", "-c", "feature"]);
  write(join(source, "feature.txt"), "feature\n");
  commitAll(source, "feature");
  const parent = temporaryDirectory("repo-governance-shallow-parent-");
  const shallow = join(parent, "shallow");
  git(parent, ["clone", "--branch", "feature", "--depth", "1", `file://${source}`, shallow]);
  git(shallow, ["fetch", "--depth", "1", "origin", "+refs/heads/main:refs/remotes/origin/main"]);
  assert.throws(() => resolveCanonicalBase(shallow, "origin/main", "HEAD"), /canonical merge-base|history/i);
  git(shallow, ["fetch", "--unshallow", "origin"]);
  assert.doesNotThrow(() => resolveCanonicalBase(shallow, "origin/main", "HEAD"));
});
