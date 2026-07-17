import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
if (Number(process.versions.node.split(".")[0]) !== 22) throw new Error(`SEA release builds require Node.js 22.x; found ${process.version}.`);
const dist = join(root, "dist");
const version = process.env.REPO_GOVERNANCE_BUILD_VERSION || JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const commitSha = process.env.REPO_GOVERNANCE_BUILD_SHA || execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const extension = process.platform === "win32" ? ".exe" : "";

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
  execFileSync(postject, [executable, "NODE_SEA_BLOB", blob, "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (process.platform === "darwin") execFileSync("codesign", ["--sign", "-", executable]);
}
