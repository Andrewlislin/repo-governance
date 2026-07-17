import assert from "node:assert/strict";
import { chmodSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { diffFingerprint } from "../src/fingerprint.mjs";
import { commitAll, git, initGitRepo, write } from "./helpers.mjs";

test("text, binary, symlink, mode, special path, and rename changes affect raw fingerprint", () => {
  const repo = initGitRepo();
  write(join(repo, "text.txt"), "one\n");
  write(join(repo, "binary.bin"), Buffer.from([0, 1, 2]));
  write(join(repo, "script.sh"), "echo one\n", 0o644);
  symlinkSync("text.txt", join(repo, "link"));
  write(join(repo, "line\nbreak.txt"), "special\n");
  const base = commitAll(repo, "base fixtures");
  git(repo, ["switch", "-c", "feature"]);

  write(join(repo, "text.txt"), "two\n");
  const textHead = commitAll(repo, "text");
  const textHash = diffFingerprint(repo, base, textHead);
  write(join(repo, "binary.bin"), Buffer.from([0, 255, 2]));
  const binaryHead = commitAll(repo, "binary");
  const binaryHash = diffFingerprint(repo, base, binaryHead);
  chmodSync(join(repo, "script.sh"), 0o755);
  const modeHead = commitAll(repo, "mode");
  const modeHash = diffFingerprint(repo, base, modeHead);
  git(repo, ["rm", "link"]);
  symlinkSync("binary.bin", join(repo, "link"));
  const linkHead = commitAll(repo, "symlink");
  const linkHash = diffFingerprint(repo, base, linkHead);
  git(repo, ["mv", "text.txt", "renamed.txt"]);
  const renameHead = commitAll(repo, "rename");
  const renameHash = diffFingerprint(repo, base, renameHead);

  assert.equal(new Set([textHash, binaryHash, modeHash, linkHash, renameHash]).size, 5);
  const raw = git(repo, ["-c", "diff.renames=false", "diff", "--raw", "-z", "--no-abbrev", "--no-renames", base, renameHead], { binary: true }).toString("utf8");
  assert.doesNotMatch(raw, /\0R\d*/);
  assert.match(raw, / D\0text\.txt\0/);
  assert.match(raw, / A\0renamed\.txt\0/);
});

test("submodule commit changes affect fingerprint", () => {
  const child = initGitRepo();
  write(join(child, "child.txt"), "one\n");
  commitAll(child, "child one");
  const repo = initGitRepo();
  git(repo, ["-c", "protocol.file.allow=always", "submodule", "add", child, "modules/child"]);
  const base = commitAll(repo, "add submodule");
  git(repo, ["switch", "-c", "feature"]);
  git(join(repo, "modules/child"), ["config", "user.name", "Test User"]);
  git(join(repo, "modules/child"), ["config", "user.email", "test@example.com"]);
  write(join(repo, "modules/child", "child.txt"), "two\n");
  commitAll(join(repo, "modules/child"), "child two");
  const head = commitAll(repo, "update submodule pointer");
  assert.notEqual(diffFingerprint(repo, base, head), diffFingerprint(repo, head, head));
  const raw = git(repo, ["diff", "--raw", "--no-abbrev", base, head]).toString();
  assert.match(raw, /160000 160000/);
});
