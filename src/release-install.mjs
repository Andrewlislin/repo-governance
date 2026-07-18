import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { GovernanceError } from "./errors.mjs";
import { governanceDataRoot } from "./paths.mjs";
import { run } from "./process.mjs";
import { installSkills } from "./skills-install.mjs";
import { treeDigest } from "./tree-digest.mjs";

function digest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function expectedArchiveDigest(archivePath) {
  const checksums = join(dirname(archivePath), "SHA256SUMS");
  if (!existsSync(checksums)) throw new GovernanceError("Top-level SHA256SUMS is required when installing from a release archive.", { code: "RG_INSTALL_SUPPLY_CHAIN" });
  const archiveName = basename(archivePath);
  for (const line of readFileSync(checksums, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([0-9a-f]{64})\s+\*?(.+)$/);
    if (match && match[2] === archiveName) return match[1];
  }
  throw new GovernanceError("Release archive is not listed in SHA256SUMS.", { code: "RG_INSTALL_SUPPLY_CHAIN" });
}

function extractArchive(archivePath, destination) {
  if (archivePath.endsWith(".zip")) {
    if (process.platform === "win32") run("powershell", ["-NoProfile", "-Command", `Expand-Archive -Path '${archivePath.replaceAll("'", "''")}' -DestinationPath '${destination.replaceAll("'", "''")}' -Force`]);
    else run("unzip", ["-q", archivePath, "-d", destination]);
    return;
  }
  if (archivePath.endsWith(".tar.gz")) {
    run("tar", ["-xzf", archivePath, "-C", destination]);
    return;
  }
  throw new GovernanceError("Release archive must be a .tar.gz or .zip file.", { code: "RG_INSTALL_SUPPLY_CHAIN" });
}

function defaultAttestationVerifier(path, manifest) {
  const signer = "Andrewlislin/repo-governance/.github/workflows/release.yml";
  const result = run("gh", ["attestation", "verify", path, "--repo", manifest.repository, "--signer-workflow", signer, "--format", "json"], { allowFailure: true });
  if (result.status !== 0) return false;
  const verifiedProvenance = result.stdout;
  return verifiedProvenance.includes(manifest.engineCommitSha) && verifiedProvenance.includes(manifest.buildWorkflow);
}

function installReleaseDirectory(bundle, { env, verifyAttestation, archivePath = null } = {}) {
  const manifestPath = join(bundle, "release-manifest.json");
  if (!existsSync(manifestPath)) throw new GovernanceError("Release manifest is missing.", { code: "RG_INSTALL_SUPPLY_CHAIN" });
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.repository !== "Andrewlislin/repo-governance" || manifest.buildWorkflow !== ".github/workflows/release.yml" || !/^[0-9a-f]{40}$/.test(manifest.engineCommitSha || "") || manifest.attestationRequired !== true || manifest.platform !== `${process.platform}-${process.arch}`) {
    throw new GovernanceError("Release provenance identity is invalid.", { code: "RG_INSTALL_SUPPLY_CHAIN" });
  }
  const cli = join(bundle, manifest.cli.file);
  const dispatcher = join(bundle, manifest.dispatcher.file);
  const skillsSource = join(bundle, "skills");
  if (!existsSync(skillsSource) || treeDigest(skillsSource) !== manifest.skillsSha256) throw new GovernanceError("Release Skill tree digest verification failed.", { code: "RG_INSTALL_SUPPLY_CHAIN" });
  if (manifest.policyAssetsSha256) {
    const policyAssets = join(bundle, "policy-assets");
    if (!existsSync(policyAssets) || treeDigest(policyAssets) !== manifest.policyAssetsSha256) throw new GovernanceError("Release policy asset digest verification failed.", { code: "RG_INSTALL_SUPPLY_CHAIN" });
  }
  if (manifest.agentAssetsSha256) {
    const agentAssets = join(bundle, "agent-assets");
    if (!existsSync(agentAssets) || treeDigest(agentAssets) !== manifest.agentAssetsSha256) throw new GovernanceError("Release Agent asset digest verification failed.", { code: "RG_INSTALL_SUPPLY_CHAIN" });
  }
  if (!verifyAttestation(manifestPath, manifest)) throw new GovernanceError("The release manifest must have a valid GitHub artifact attestation.", { code: "RG_INSTALL_SUPPLY_CHAIN" });
  if (archivePath && !verifyAttestation(archivePath, manifest)) throw new GovernanceError("The release archive must have a valid GitHub artifact attestation.", { code: "RG_INSTALL_SUPPLY_CHAIN" });
  for (const [path, expected] of [[cli, manifest.cli.sha256], [dispatcher, manifest.dispatcher.sha256]]) {
    if (!existsSync(path) || digest(path) !== expected) throw new GovernanceError("Release artifact checksum verification failed.", { code: "RG_INSTALL_SUPPLY_CHAIN" });
    if (!archivePath && !verifyAttestation(path, manifest)) throw new GovernanceError("A valid GitHub artifact attestation is required; checksum alone is insufficient.", { code: "RG_INSTALL_SUPPLY_CHAIN" });
  }
  const dataRoot = governanceDataRoot(env);
  const engineDirectory = join(dataRoot, "engines", manifest.engineCommitSha);
  const dispatcherTarget = join(dataRoot, process.platform === "win32" ? "dispatcher.exe" : "dispatcher");
  if (existsSync(engineDirectory)) throw new GovernanceError("Engine version is already installed; refusing an implicit replacement.", { code: "RG_INSTALL" });
  if (existsSync(dispatcherTarget)) throw new GovernanceError("Stable dispatcher already exists; use repo-governance update instead of install.", { code: "RG_INSTALL" });
  try {
    mkdirSync(engineDirectory, { recursive: true });
    const executable = join(engineDirectory, process.platform === "win32" ? "repo-governance.exe" : "repo-governance");
    cpSync(cli, executable);
    cpSync(dispatcher, dispatcherTarget);
    if (process.platform !== "win32") {
      chmodSync(executable, 0o755);
      chmodSync(dispatcherTarget, 0o755);
    }
    writeFileSync(join(engineDirectory, "engine-manifest.json"), `${JSON.stringify({ engineVersion: manifest.engineVersion, engineCommitSha: manifest.engineCommitSha, sha256: manifest.cli.sha256 }, null, 2)}\n`);
    const skills = installSkills(skillsSource, { env });
    return { engineVersion: manifest.engineVersion, engineCommitSha: manifest.engineCommitSha, dataRoot, skills };
  } catch (error) {
    rmSync(engineDirectory, { recursive: true, force: true });
    rmSync(dispatcherTarget, { force: true });
    throw error;
  }
}

export function installReleaseBundle(bundle, { env = process.env, verifyAttestation = defaultAttestationVerifier } = {}) {
  if (statSync(bundle).isDirectory()) return installReleaseDirectory(bundle, { env, verifyAttestation });
  const expected = expectedArchiveDigest(bundle);
  if (digest(bundle) !== expected) throw new GovernanceError("Release archive checksum verification failed.", { code: "RG_INSTALL_SUPPLY_CHAIN" });
  const extracted = mkdtempSync(join(tmpdir(), "repo-governance-release-"));
  try {
    extractArchive(bundle, extracted);
    return installReleaseDirectory(extracted, { env, verifyAttestation, archivePath: bundle });
  } finally {
    rmSync(extracted, { recursive: true, force: true });
  }
}
