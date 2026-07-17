import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { checkRepository } from "../src/check.mjs";
import { diffFingerprint } from "../src/fingerprint.mjs";
import { commitAll, git, initGitRepo, write, writeConfig, baseConfig } from "./helpers.mjs";

function fixture({ baseSha = null, expiresAt = "2099-01-01T00:00:00.000Z", paths = ["src/api/result.js"] } = {}) {
  const repo = initGitRepo();
  writeConfig(repo, baseConfig({
    highImpactMappings: [{ businessPaths: ["src/api/**"], requirements: [{ anyOf: ["contract"] }] }],
  }));
  write(join(repo, "README.md"), "base\n");
  const base = commitAll(repo, "base");
  git(repo, ["switch", "-c", "feature"]);
  write(join(repo, "src/api/result.js"), "changed\n");
  const businessHead = commitAll(repo, "business change");
  const waiver = {
    baseSha: baseSha || base,
    rule: "RG001",
    businessPaths: paths,
    reason: "Temporary audited exception",
    expiresAt,
    diffFingerprint: diffFingerprint(repo, base, businessHead),
  };
  write(join(repo, ".repo-governance", "waivers", "rg001.json"), `${JSON.stringify(waiver, null, 2)}\n`);
  commitAll(repo, "waiver");
  return { repo, base };
}

test("valid local waiver is pending current-head remote approval", () => {
  const { repo } = fixture();
  const result = checkRepository(repo, { base: "main" });
  assert.equal(result.ok, true);
  assert.equal(result.acceptedWaivers[0].remoteApproval, "pending-current-head-review");
});

test("waiver cannot select a different base commit", () => {
  const { repo } = fixture({ baseSha: "f".repeat(40) });
  const result = checkRepository(repo, { base: "main" });
  assert.equal(result.ok, false);
  assert.equal(result.findings[0].rule, "RG005");
  assert.match(result.findings[0].message, /canonical base/);
});

test("expired waiver fails RG005", () => {
  const { repo } = fixture({ expiresAt: "2000-01-01T00:00:00.000Z" });
  const result = checkRepository(repo, { base: "main" });
  assert.equal(result.findings[0].rule, "RG005");
  assert.match(result.findings[0].message, /expired/);
});

test("business path expansion invalidates waiver scope", () => {
  const { repo } = fixture({ paths: ["src/api/other.js"] });
  const result = checkRepository(repo, { base: "main" });
  assert.equal(result.ok, false);
  assert.equal(result.findings[0].rule, "RG001");
});
