import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { GovernanceError } from "./errors.mjs";
import { governanceDataRoot } from "./paths.mjs";
import { runGit } from "./process.mjs";

const MANIFEST = "hooks-install-manifest.json";
const MARKER = "# repo-governance:stable-dispatcher";

function configValue(args, options = {}) {
  const result = runGit(["config", ...args], { ...options, allowFailure: true });
  if (result.status !== 0) return null;
  const lines = result.stdout.trim().split("\n");
  return lines.at(-1) || null;
}

function dispatcherInvocation(dataRoot) {
  return `${MARKER}\n\"${join(dataRoot, "dispatcher")}\" pre-push \"$@\"`;
}

function writeTemplateHook(template, dataRoot) {
  const hook = join(template, "hooks", "pre-push");
  mkdirSync(dirname(hook), { recursive: true });
  writeFileSync(hook, `#!/bin/sh\n${dispatcherInvocation(dataRoot)}\n`, { mode: 0o755 });
}

function copyTemplate(source, target) {
  if (!existsSync(source)) return;
  cpSync(source, target, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
}

function templateDigest(root) {
  const hash = createHash("sha256");
  function visit(directory, prefix = "") {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(directory, entry.name);
      const stat = lstatSync(path);
      hash.update(relative).update("\0").update(String(stat.mode)).update("\0");
      if (entry.isDirectory()) visit(path, relative);
      else hash.update(readFileSync(path)).update("\0");
    }
  }
  visit(root);
  return hash.digest("hex");
}

export function installFutureHooks({ compose = false, env = process.env, dispatcherSource } = {}) {
  const dataRoot = governanceDataRoot(env);
  const managedTemplate = join(dataRoot, "git-template");
  const manifestPath = join(dataRoot, MANIFEST);
  if (existsSync(manifestPath)) throw new GovernanceError("Governance hooks are already installed.", { code: "RG_HOOKS" });
  const originResult = runGit(["config", "--global", "--show-origin", "--get", "init.templateDir"], { env, allowFailure: true });
  const existingLine = originResult.status === 0 ? originResult.stdout.trim() : "";
  const existingPath = existingLine ? existingLine.split(/\s+/).at(-1) : null;
  if (existingPath && !compose) {
    throw new GovernanceError("A global init.templateDir already exists. Nothing was changed; rerun with hooks install --compose after reviewing the source and path.", {
      code: "RG_HOOKS_TEMPLATE_EXISTS",
      details: { origin: existingLine, path: existingPath },
    });
  }
  if (!dispatcherSource || !existsSync(dispatcherSource)) {
    throw new GovernanceError("A verified stable dispatcher is required for hook installation.", { code: "RG_HOOKS_DISPATCHER" });
  }
  mkdirSync(dataRoot, { recursive: true });
  try {
    if (existingPath) copyTemplate(resolve(existingPath), managedTemplate);
    else mkdirSync(managedTemplate, { recursive: true });
    const conflict = join(managedTemplate, "hooks", "pre-push");
    if (existsSync(conflict)) throw new GovernanceError("Template composition conflicts at hooks/pre-push; resolve it manually before installing.", { code: "RG_HOOKS_CONFLICT" });
    writeTemplateHook(managedTemplate, dataRoot);
    const installedDispatcher = join(dataRoot, "dispatcher");
    cpSync(dispatcherSource, installedDispatcher, { errorOnExist: true, force: false });
    chmodSync(installedDispatcher, 0o755);
    const manifest = {
      previousTemplate: existingPath,
      previousOrigin: existingLine || null,
      previousTemplateDigest: existingPath ? templateDigest(resolve(existingPath)) : null,
      managedTemplate,
      composed: Boolean(existingPath),
    };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
    runGit(["config", "--global", "init.templateDir", managedTemplate], { env });
    return manifest;
  } catch (error) {
    rmSync(managedTemplate, { recursive: true, force: true });
    rmSync(join(dataRoot, "dispatcher"), { force: true });
    rmSync(manifestPath, { force: true });
    throw error;
  }
}

export function uninstallFutureHooks({ env = process.env } = {}) {
  const dataRoot = governanceDataRoot(env);
  const manifestPath = join(dataRoot, MANIFEST);
  if (!existsSync(manifestPath)) throw new GovernanceError("Governance hooks are not installed.", { code: "RG_HOOKS" });
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const current = configValue(["--global", "--get", "init.templateDir"], { env });
  if (resolve(current || "") !== resolve(manifest.managedTemplate)) {
    throw new GovernanceError("Global init.templateDir changed after installation; refusing to overwrite the user's newer configuration.", { code: "RG_HOOKS_UNINSTALL_BLOCKED" });
  }
  if (manifest.previousTemplate) runGit(["config", "--global", "init.templateDir", manifest.previousTemplate], { env });
  else runGit(["config", "--global", "--unset", "init.templateDir"], { env, allowFailure: true });
  rmSync(manifest.managedTemplate, { recursive: true, force: true });
  rmSync(join(dataRoot, "dispatcher"), { force: true });
  rmSync(manifestPath, { force: true });
  return { restoredTemplate: manifest.previousTemplate };
}

export function effectiveRepositoryHook(repo, { env = process.env } = {}) {
  const result = runGit(["config", "--get", "core.hooksPath"], { cwd: repo, env, allowFailure: true });
  if (result.status === 0) {
    const hooksPath = result.stdout.trim();
    return {
      mode: hooksPath.includes("husky") ? "husky" : "custom-hooks-path",
      path: join(resolve(repo, hooksPath), "pre-push"),
    };
  }
  const native = runGit(["rev-parse", "--git-path", "hooks/pre-push"], { cwd: repo, env });
  const path = native.stdout.trim();
  return { mode: "native", path: resolve(repo, path) };
}

export function snapshotEffectiveRepositoryHook(repo, { env = process.env } = {}) {
  const target = effectiveRepositoryHook(repo, { env });
  if (existsSync(target.path)) {
    const stat = lstatSync(target.path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new GovernanceError("Effective pre-push hook is not a regular file; refusing composition.", { code: "RG_HOOKS_CONFLICT", details: { path: target.path } });
    return { ...target, existed: true, contents: readFileSync(target.path), modeBits: stat.mode, parentExisted: true };
  }
  return { ...target, existed: false, contents: null, modeBits: null, parentExisted: existsSync(dirname(target.path)) };
}

export function restoreEffectiveRepositoryHook(snapshot) {
  if (snapshot.existed) writeFileSync(snapshot.path, snapshot.contents, { mode: snapshot.modeBits });
  else {
    rmSync(snapshot.path, { force: true });
    if (!snapshot.parentExisted && existsSync(dirname(snapshot.path)) && readdirSync(dirname(snapshot.path)).length === 0) rmdirSync(dirname(snapshot.path));
  }
}

export function connectEffectiveRepositoryHook(repo, { env = process.env, requireDispatcher = false } = {}) {
  const target = snapshotEffectiveRepositoryHook(repo, { env });
  const dataRoot = governanceDataRoot(env);
  const dispatcher = join(dataRoot, "dispatcher");
  if (requireDispatcher && !existsSync(dispatcher)) throw new GovernanceError("Stable dispatcher is missing; install a verified repo-governance release before bootstrap.", { code: "RG_HOOKS_DISPATCHER", details: { dispatcher } });
  const current = target.existed ? target.contents.toString("utf8") : "#!/bin/sh\n";
  if (current.includes(MARKER)) return { mode: target.mode, changed: false, path: target.path };
  mkdirSync(dirname(target.path), { recursive: true });
  writeFileSync(target.path, `${current.trimEnd()}\n${dispatcherInvocation(dataRoot)}\n`, { mode: 0o755 });
  return { mode: target.mode, changed: true, path: target.path };
}

export function doctorHooks(repo, { env = process.env } = {}) {
  const dataRoot = governanceDataRoot(env);
  const issues = [];
  const dispatcher = join(dataRoot, "dispatcher");
  if (!existsSync(dispatcher)) issues.push("Stable dispatcher is missing.");
  const manifestPath = join(dataRoot, MANIFEST);
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (manifest.composed && (!existsSync(manifest.previousTemplate) || templateDigest(manifest.previousTemplate) !== manifest.previousTemplateDigest)) {
      issues.push("The original Git template changed after composition. Rerun hooks install --compose after reviewing the new template; no files were overwritten.");
    }
  }
  const hooksResult = runGit(["config", "--show-origin", "--get", "core.hooksPath"], { cwd: repo, env, allowFailure: true });
  if (hooksResult.status === 0) {
    const hooksPath = hooksResult.stdout.trim().split(/\s+/).at(-1);
    const prePush = join(resolve(repo, hooksPath), "pre-push");
    if (!existsSync(prePush) || !readFileSync(prePush, "utf8").includes(MARKER)) {
      issues.push(`Effective core.hooksPath (${hooksResult.stdout.trim()}) does not reach the stable dispatcher. Run repo-governance init --accept to repair it.`);
    }
  } else {
    const native = effectiveRepositoryHook(repo, { env });
    const nativeConnected = existsSync(native.path) && readFileSync(native.path, "utf8").includes(MARKER);
    if (!nativeConnected) {
      const globalTemplate = configValue(["--global", "--get", "init.templateDir"], { env });
      if (!globalTemplate || !existsSync(join(globalTemplate, "hooks", "pre-push"))) issues.push("No effective repository hook or governance Git template was found.");
    }
  }
  return { ok: issues.length === 0, issues, dispatcher };
}
