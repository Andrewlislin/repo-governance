import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
  write(join(root, "skills", "repo-governance-agent-gate", "SKILL.md"), "---\nname: repo-governance-agent-gate\ndescription: Example gate fixture used for release tests.\n---\n");
  write(join(root, "policy-assets", "presets", "example.json"), "{}\n");
  write(join(root, "policy-assets", "schemas", "example.schema.json"), "{}\n");
  write(join(root, "policy-assets", "schemas", "agent-policy.schema.json"), "{}\n");
  write(join(root, "agent-assets", "playbooks", "example.md"), "# Example\n");
  write(join(root, "agent-assets", "playbooks", "repo-governance-agent-gate.md"), "# Gate\n");
  write(join(root, "agent-assets", "adapters", "codex", "adapter-contract.json"), "{}\n");
  write(join(root, "agent-assets", "adapters", "claude-code", "CLAUDE.md"), "# Example Claude adapter\n");
  write(join(root, "agent-assets", "adapters", "claude-code", "commands", "repo-governance-agent-gate.md"), "# Gate command\n");
  write(join(root, "agent-assets", "adapters", "claude-code", "hooks", "settings.example.json"), "{}\n");
  const manifest = {
    schemaVersion: 1,
    engineVersion: "1.0.0",
    engineCommitSha: "a".repeat(40),
    repository: "Andrewlislin/repo-governance",
    buildWorkflow: ".github/workflows/release.yml",
    platform: `${process.platform}-${process.arch}`,
    cli: { file: cliName, sha256: digest(cli) },
    dispatcher: { file: dispatcherName, sha256: digest(dispatcher) },
    launcher: { file: dispatcherName, sha256: digest(dispatcher) },
    skillsSha256: treeDigest(join(root, "skills")),
    policyAssetsSha256: treeDigest(join(root, "policy-assets")),
    agentAssetsSha256: treeDigest(join(root, "agent-assets")),
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

test("verified bundle installs CLI, dispatcher, versioned Agent assets, and Skills in standard roots", () => {
  const { root, manifest } = bundle();
  const env = isolatedEnv();
  const result = installReleaseBundle(root, { env, verifyAttestation: () => true });
  assert.equal(result.engineCommitSha, manifest.engineCommitSha);
  assert.ok(existsSync(join(result.dataRoot, "engines", manifest.engineCommitSha, process.platform === "win32" ? "repo-governance.exe" : "repo-governance")));
  assert.ok(existsSync(join(result.skills.root, "example-skill", "SKILL.md")));
  assert.ok(existsSync(join(result.agentAssets, "playbooks", "example.md")));
  assert.ok(existsSync(join(result.agentAssets, "adapters", "claude-code", "CLAUDE.md")));
  assert.ok(existsSync(join(result.agentAssets, "adapters", "claude-code", "commands", "repo-governance-agent-gate.md")));
  assert.ok(existsSync(join(result.agentAssets, "adapters", "claude-code", "hooks", "settings.example.json")));
  const engineManifest = JSON.parse(readFileSync(join(result.dataRoot, "engines", manifest.engineCommitSha, "engine-manifest.json"), "utf8"));
  assert.equal(engineManifest.agentAssetsSha256, manifest.agentAssetsSha256);
  assert.ok(Number.isFinite(Date.parse(engineManifest.installedAt)));
  assert.equal(result.dataRoot, join(env.XDG_DATA_HOME, "repo-governance"));
  assert.equal(result.skills.root, join(env.CODEX_HOME, "skills"));
  assert.ok(existsSync(result.launcherPath));
  assert.ok(existsSync(result.commandPath));
  assert.equal(result.defaultEngineCommitSha, manifest.engineCommitSha);
  assert.equal(result.pathConfigured, false);
  assert.match(result.actionRequired, /export PATH=/);
  assert.match(result.message, /current shell cannot use the bare repo-governance command/);
});

test("release install refuses an unmanaged command entry without replacing it", () => {
  const fixture = bundle();
  const env = isolatedEnv();
  const commandPath = join(env.HOME, ".local", "bin", "repo-governance");
  write(commandPath, "unmanaged\n", 0o755);
  assert.throws(
    () => installReleaseBundle(fixture.root, { env, verifyAttestation: () => true }),
    /unmanaged repo-governance command entry/,
  );
  assert.equal(readFileSync(commandPath, "utf8"), "unmanaged\n");
  assert.equal(existsSync(join(env.XDG_DATA_HOME, "repo-governance", "engines", fixture.manifest.engineCommitSha)), false);
});

test("v1.2 install reuses identical v1.1.1 Skills and safely adds the launcher beside the legacy dispatcher", () => {
  const fixture = bundle();
  const env = isolatedEnv();
  const dataRoot = join(env.XDG_DATA_HOME, "repo-governance");
  write(join(dataRoot, process.platform === "win32" ? "dispatcher.exe" : "dispatcher"), "legacy-v1.1.1", 0o755);
  mkdirSync(env.CODEX_HOME, { recursive: true });
  cpSync(join(fixture.root, "skills"), join(env.CODEX_HOME, "skills"), { recursive: true });
  const result = installReleaseBundle(fixture.root, { env, verifyAttestation: () => true });
  assert.deepEqual(result.skills.installed, []);
  assert.deepEqual(result.skills.reused.sort(), ["example-skill", "repo-governance-agent-gate"]);
  assert.ok(existsSync(result.launcherPath));
  assert.ok(existsSync(result.commandPath));
  assert.equal(readFileSync(result.legacyDispatcherPath, "utf8"), "legacy-v1.1.1");
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

test("tampered preset or schema content is rejected through the policy asset digest", () => {
  const fixture = bundle();
  write(join(fixture.root, "policy-assets", "presets", "example.json"), "tampered\n");
  assert.throws(() => installReleaseBundle(fixture.root, { env: isolatedEnv(), verifyAttestation: () => true }), /policy asset digest/);
});

test("tampered playbook or adapter content is rejected through the Agent asset digest", () => {
  const fixture = bundle();
  write(join(fixture.root, "agent-assets", "playbooks", "example.md"), "tampered\n");
  assert.throws(() => installReleaseBundle(fixture.root, { env: isolatedEnv(), verifyAttestation: () => true }), /Agent asset digest/);
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
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, REPO_GOVERNANCE_RELEASE_SOURCE: source, REPO_GOVERNANCE_RELEASE_OUTPUT: output },
  });
  assert.ok(existsSync(join(output, "repo-governance-v1.0.0-linux-x64.tar.gz")));
  assert.ok(existsSync(join(output, "repo-governance-v1.0.0-win32-x64.zip")));
  assert.ok(existsSync(join(output, "SHA256SUMS")));
  const index = JSON.parse(readFileSync(join(output, "release-index.json"), "utf8"));
  assert.equal(index.artifactLayout, "platform-archive-v1");
  assert.deepEqual(index.archives.map((archive) => archive.platform).sort(), platforms.sort());
});
