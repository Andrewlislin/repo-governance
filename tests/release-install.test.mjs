import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
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

function archiveFixture(format = "tar.gz", overrides = {}) {
  const fixture = bundle(overrides);
  const release = temporaryDirectory("repo-governance-release-assets-");
  const archive = join(release, `repo-governance-v${fixture.manifest.engineVersion}-${fixture.manifest.platform}.${format === "zip" ? "zip" : "tar.gz"}`);
  if (format === "zip" && process.platform === "win32") execFileSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${fixture.root.replaceAll("'", "''")}/*' -DestinationPath '${archive.replaceAll("'", "''")}' -Force`]);
  else if (format === "zip") execFileSync("zip", ["-qr", archive, "."], { cwd: fixture.root });
  else execFileSync("tar", ["-czf", archive, "-C", fixture.root, "."]);
  write(join(release, "SHA256SUMS"), `${digest(readFileSync(archive))}  ${basename(archive)}\n`);
  return { ...fixture, release, archive };
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

for (const format of ["tar.gz", "zip"]) {
  test(`verified ${format} platform archive installs with archive and manifest attestations`, () => {
    const fixture = archiveFixture(format);
    const env = isolatedEnv();
    const attested = new Set([fixture.archive, "release-manifest.json"]);
    const result = installReleaseBundle(fixture.archive, {
      env,
      verifyAttestation: (path) => attested.has(path) || attested.has(basename(path)),
    });
    assert.equal(result.engineCommitSha, fixture.manifest.engineCommitSha);
    assert.ok(existsSync(join(result.dataRoot, "engines", fixture.manifest.engineCommitSha, process.platform === "win32" ? "repo-governance.exe" : "repo-governance")));
  });
}

test("release archive must be listed in top-level SHA256SUMS", () => {
  const fixture = archiveFixture();
  write(join(fixture.release, "SHA256SUMS"), "");
  assert.throws(() => installReleaseBundle(fixture.archive, { env: isolatedEnv(), verifyAttestation: () => true }), /not listed in SHA256SUMS/);
});

test("tampered release archive fails before extraction", () => {
  const fixture = archiveFixture();
  write(fixture.archive, "tampered");
  assert.throws(() => installReleaseBundle(fixture.archive, { env: isolatedEnv(), verifyAttestation: () => true }), /archive checksum/);
});

test("archive checksum without archive attestation is insufficient", () => {
  const fixture = archiveFixture();
  assert.throws(() => installReleaseBundle(fixture.archive, {
    env: isolatedEnv(),
    verifyAttestation: (path) => path.endsWith("release-manifest.json"),
  }), /archive.*attestation/i);
});

test("archive attestation without manifest attestation is insufficient", () => {
  const fixture = archiveFixture();
  assert.throws(() => installReleaseBundle(fixture.archive, {
    env: isolatedEnv(),
    verifyAttestation: (path) => path === fixture.archive,
  }), /manifest.*attestation/i);
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

test("release index writer publishes only platform archives and top-level checksums", () => {
  const source = temporaryDirectory("repo-governance-index-source-");
  const output = temporaryDirectory("repo-governance-index-output-");
  const platforms = ["linux-x64", "win32-x64"];
  for (const platform of platforms) {
    const directory = join(source, `repo-governance-${platform}`);
    mkdirSync(directory, { recursive: true });
    const extension = platform.startsWith("win32") ? "zip" : "tar.gz";
    write(join(directory, `repo-governance-v1.0.0-${platform}.${extension}`), `${platform}\n`);
    write(join(directory, "release-manifest.json"), `${JSON.stringify({
      engineVersion: "1.0.0",
      engineCommitSha: "a".repeat(40),
      repository: "Andrewlislin/repo-governance",
      buildWorkflow: ".github/workflows/release.yml",
      platform,
    }, null, 2)}\n`);
  }
  execFileSync("node", ["scripts/write-release-index.mjs"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, REPO_GOVERNANCE_RELEASE_SOURCE: source, REPO_GOVERNANCE_RELEASE_OUTPUT: output },
  });
  assert.ok(existsSync(join(output, "repo-governance-v1.0.0-linux-x64.tar.gz")));
  assert.ok(existsSync(join(output, "repo-governance-v1.0.0-win32-x64.zip")));
  assert.ok(existsSync(join(output, "SHA256SUMS")));
  const index = JSON.parse(readFileSync(join(output, "release-index.json"), "utf8"));
  assert.equal(index.artifactLayout, "platform-archive-v1");
  assert.deepEqual(index.archives.map((archive) => archive.platform).sort(), platforms.sort());
});
