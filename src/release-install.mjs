import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GovernanceError } from "./errors.mjs";
import { governanceDataRoot } from "./paths.mjs";
import { run } from "./process.mjs";
import { installSkills } from "./skills-install.mjs";
import { treeDigest } from "./tree-digest.mjs";

function digest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function defaultAttestationVerifier(path, manifest) {
  const signer = "Andrewlislin/repo-governance/.github/workflows/release.yml";
  const result = run("gh", ["attestation", "verify", path, "--repo", manifest.repository, "--signer-workflow", signer, "--format", "json"], { allowFailure: true });
  if (result.status !== 0) return false;
  const verifiedProvenance = result.stdout;
  return verifiedProvenance.includes(manifest.engineCommitSha) && verifiedProvenance.includes(manifest.buildWorkflow);
}

export function installReleaseBundle(bundle, { env = process.env, verifyAttestation = defaultAttestationVerifier } = {}) {
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
  if (!verifyAttestation(manifestPath, manifest)) throw new GovernanceError("The release manifest must have a valid GitHub artifact attestation.", { code: "RG_INSTALL_SUPPLY_CHAIN" });
  for (const [path, expected] of [[cli, manifest.cli.sha256], [dispatcher, manifest.dispatcher.sha256]]) {
    if (!existsSync(path) || digest(path) !== expected) throw new GovernanceError("Release artifact checksum verification failed.", { code: "RG_INSTALL_SUPPLY_CHAIN" });
    if (!verifyAttestation(path, manifest)) throw new GovernanceError("A valid GitHub artifact attestation is required; checksum alone is insufficient.", { code: "RG_INSTALL_SUPPLY_CHAIN" });
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
