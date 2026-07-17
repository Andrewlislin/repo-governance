import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { installReleaseBundle } from "../src/release-install.mjs";
import { treeDigest } from "../src/tree-digest.mjs";
import { temporaryDirectory, write } from "./helpers.mjs";

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function bundle(overrides = {}) {
  const root = temporaryDirectory("repo-governance-release-");
  const cli = Buffer.from("cli");
  const dispatcher = Buffer.from("dispatcher");
  const cliName = process.platform === "win32" ? "repo-governance.exe" : "repo-governance";
  const dispatcherName = process.platform === "win32" ? "dispatcher.exe" : "dispatcher";
  write(join(root, cliName), cli, 0o755);
  write(join(root, dispatcherName), dispatcher, 0o755);
  write(join(root, "skills", "example-skill", "SKILL.md"), "---\nname: example-skill\ndescription: Example installation fixture used for release tests.\n---\n");
  const manifest = {
    schemaVersion: 1,
    engineVersion: "1.0.0",
    engineCommitSha: "a".repeat(40),
    repository: "Andrewlislin/repo-governance",
    buildWorkflow: ".github/workflows/release.yml",
    platform: `${process.platform}-${process.arch}`,
    cli: { file: cliName, sha256: digest(cli) },
    dispatcher: { file: dispatcherName, sha256: digest(dispatcher) },
    skillsSha256: treeDigest(join(root, "skills")),
    attestationRequired: true,
    ...overrides,
  };
  write(join(root, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { root, manifest, cliName };
}

function isolatedEnv() {
  const home = temporaryDirectory("repo-governance-install-home-");
  return { ...process.env, HOME: home, XDG_DATA_HOME: join(home, ".local", "share"), CODEX_HOME: join(home, ".codex") };
}

test("verified bundle installs CLI, dispatcher, and Skills only in standard roots", () => {
  const { root, manifest } = bundle();
  const env = isolatedEnv();
  const result = installReleaseBundle(root, { env, verifyAttestation: () => true });
  assert.equal(result.engineCommitSha, manifest.engineCommitSha);
  assert.ok(existsSync(join(result.dataRoot, "engines", manifest.engineCommitSha, process.platform === "win32" ? "repo-governance.exe" : "repo-governance")));
  assert.ok(existsSync(join(result.skills.root, "example-skill", "SKILL.md")));
  assert.equal(result.dataRoot, join(env.XDG_DATA_HOME, "repo-governance"));
  assert.equal(result.skills.root, join(env.CODEX_HOME, "skills"));
});

test("tampered binary or checksum fails before installation", () => {
  const fixture = bundle();
  write(join(fixture.root, fixture.cliName), "tampered");
  assert.throws(() => installReleaseBundle(fixture.root, { env: isolatedEnv(), verifyAttestation: () => true }), /checksum/);
});

test("checksum without valid attestation is insufficient", () => {
  const fixture = bundle();
  assert.throws(() => installReleaseBundle(fixture.root, {
    env: isolatedEnv(),
    verifyAttestation: (path) => path.endsWith("release-manifest.json"),
  }), /attestation.*checksum alone/i);
});

test("tampered installed Skill content is rejected through the attested manifest digest", () => {
  const fixture = bundle();
  write(join(fixture.root, "skills", "example-skill", "SKILL.md"), "tampered\n");
  assert.throws(() => installReleaseBundle(fixture.root, { env: isolatedEnv(), verifyAttestation: () => true }), /Skill tree digest/);
});

for (const overrides of [
  { repository: "attacker/repo" },
  { buildWorkflow: ".github/workflows/other.yml" },
  { engineCommitSha: "not-a-full-sha" },
  { attestationRequired: false },
]) {
  test(`invalid provenance identity is rejected: ${JSON.stringify(overrides)}`, () => {
    const fixture = bundle(overrides);
    assert.throws(() => installReleaseBundle(fixture.root, { env: isolatedEnv(), verifyAttestation: () => true }), /provenance identity/);
  });
}

test("existing Skill conflict rolls back engine and dispatcher", () => {
  const env = isolatedEnv();
  const fixture = bundle();
  write(join(env.CODEX_HOME, "skills", "example-skill", "SKILL.md"), "existing\n");
  assert.throws(() => installReleaseBundle(fixture.root, { env, verifyAttestation: () => true }), /already exists/);
  const dataRoot = join(env.XDG_DATA_HOME, "repo-governance");
  assert.equal(existsSync(join(dataRoot, "engines", fixture.manifest.engineCommitSha)), false);
  assert.equal(existsSync(join(dataRoot, process.platform === "win32" ? "dispatcher.exe" : "dispatcher")), false);
});
