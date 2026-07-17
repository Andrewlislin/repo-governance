import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { DIFF_FINGERPRINT_DOMAIN, diffFingerprint } from "../src/fingerprint.mjs";
import { resolveCanonicalBase } from "../src/git.mjs";
import { createWaiver } from "../src/waiver.mjs";
import { commitAll, git, initGitRepo, write } from "./helpers.mjs";

test("fingerprint is the exact fixed raw NUL-delimited Git byte stream", () => {
  const repo = initGitRepo();
  write(join(repo, "file.txt"), "one\n");
  const base = commitAll(repo, "base");
  git(repo, ["switch", "-c", "feature"]);
  write(join(repo, "file.txt"), "two\n");
  write(join(repo, "binary.bin"), Buffer.from([0, 255, 1]));
  const head = commitAll(repo, "changes");
  const raw = git(repo, [
    "-c", "core.quotepath=false", "-c", "diff.renames=false", "diff", "--raw", "-z", "--no-abbrev",
    "--no-renames", "--no-ext-diff", "--no-textconv", "--ignore-submodules=none", base, head,
    "--", ".", ":(exclude).repo-governance/waivers/**",
  ], { binary: true });
  const expected = createHash("sha256").update(DIFF_FINGERPRINT_DOMAIN).update(raw).digest("hex");
  assert.equal(diffFingerprint(repo, base, head), expected);
});

test("waiver file is excluded from its own fingerprint while mode and rename changes matter", () => {
  const repo = initGitRepo();
  write(join(repo, "script.sh"), "echo one\n", 0o644);
  const base = commitAll(repo, "base");
  git(repo, ["switch", "-c", "feature"]);
  chmodSync(join(repo, "script.sh"), 0o755);
  git(repo, ["mv", "script.sh", "renamed.sh"]);
  const businessHead = commitAll(repo, "rename and mode");
  const before = diffFingerprint(repo, base, businessHead);
  createWaiver(repo, {
    name: "rg001",
    businessPaths: ["renamed.sh"],
    reason: "Temporary audited exception",
    expiresAt: "2099-01-01T00:00:00.000Z",
    canonicalBaseSha: base,
    headSha: businessHead,
  });
  const waiverHead = commitAll(repo, "add waiver");
  assert.equal(diffFingerprint(repo, base, waiverHead), before);
  assert.notEqual(diffFingerprint(repo, base, businessHead), diffFingerprint(repo, businessHead, waiverHead));
});

test("canonical base is independently computed and arbitrary declarations cannot change it", () => {
  const repo = initGitRepo();
  write(join(repo, "base.txt"), "base\n");
  const base = commitAll(repo, "base");
  git(repo, ["switch", "-c", "feature"]);
  write(join(repo, "feature.txt"), "feature\n");
  const head = commitAll(repo, "feature");
  const result = resolveCanonicalBase(repo, "main", head);
  assert.equal(result.canonicalBaseSha, base);
  assert.throws(() => resolveCanonicalBase(repo, "does-not-exist", head), /missing required revision/);
});
