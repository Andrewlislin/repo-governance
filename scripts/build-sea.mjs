import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
if (Number(process.versions.node.split(".")[0]) !== 22) throw new Error(`SEA release builds require Node.js 22.x; found ${process.version}.`);
const dist = join(root, "dist");
const version = process.env.REPO_GOVERNANCE_BUILD_VERSION || JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const commitSha = process.env.REPO_GOVERNANCE_BUILD_SHA || execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const extension = process.platform === "win32" ? ".exe" : "";

function smokeTestExecutable(name, executable) {
  if (name === "repo-governance") {
    const versionResult = spawnSync(executable, ["version", "--json"], { encoding: "utf8" });
    if (versionResult.status !== 0) throw new Error(`SEA CLI version smoke test failed: ${(versionResult.stderr || versionResult.stdout || "no output").trim()}`);
    const identity = JSON.parse(versionResult.stdout);
    if (identity.version !== version || identity.commitSha !== commitSha) throw new Error("SEA CLI identity does not match the build inputs.");

    const helpResult = spawnSync(executable, ["help"], { encoding: "utf8" });
    if (helpResult.status !== 0 || !helpResult.stdout.includes("preflight [--json]")) throw new Error("SEA CLI help does not expose preflight.");

    const cwd = mkdtempSync(join(tmpdir(), "repo-governance-sea-preflight-"));
    try {
      const preflightResult = spawnSync(executable, ["preflight", "--json"], { cwd, encoding: "utf8" });
      const report = JSON.parse(preflightResult.stdout || "{}");
      if (preflightResult.status !== 1 || report.repoState !== "not_git_repo" || report.exitCode !== 1) {
        throw new Error("SEA CLI preflight smoke test did not return the stable non-Git classification.");
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
    return;
  }
  const cwd = mkdtempSync(join(tmpdir(), "repo-governance-sea-smoke-"));
  try {
    const result = spawnSync(executable, [], { cwd, encoding: "utf8" });
    if (result.status !== 2 || !result.stderr.includes("No default engine is configured")) throw new Error("SEA launcher smoke test did not execute the expected offline no-default-engine path.");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

for (const target of [
  { name: "repo-governance", entry: join(root, "bin", "repo-governance.mjs") },
  { name: "dispatcher", entry: join(root, "bin", "dispatcher.mjs") },
]) {
  const bundle = join(dist, `${target.name}.cjs`);
  const blob = join(dist, `${target.name}.blob`);
  const executable = join(dist, `${target.name}${extension}`);
  await build({
    entryPoints: [target.entry],
    outfile: bundle,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    define: {
      REPO_GOVERNANCE_BUILD_VERSION: JSON.stringify(version),
      REPO_GOVERNANCE_BUILD_SHA: JSON.stringify(commitSha),
    },
  });
  const seaConfig = join(dist, `${target.name}.sea.json`);
  writeFileSync(seaConfig, `${JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false }, null, 2)}\n`);
  execFileSync(process.execPath, ["--experimental-sea-config", seaConfig], { stdio: "inherit" });
  cpSync(process.execPath, executable);
  if (process.platform === "darwin") execFileSync("codesign", ["--remove-signature", executable]);
  const postject = join(root, "node_modules", ".bin", process.platform === "win32" ? "postject.cmd" : "postject");
  const postjectArgs = [executable, "NODE_SEA_BLOB", blob, "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"];
  if (process.platform === "darwin") postjectArgs.push("--macho-segment-name", "NODE_SEA");
  execFileSync(postject, postjectArgs, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (process.platform === "darwin") execFileSync("codesign", ["--sign", "-", executable]);
  smokeTestExecutable(target.name, executable);
}
