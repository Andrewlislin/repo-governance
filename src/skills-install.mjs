import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { GovernanceError } from "./errors.mjs";
import { treeDigest } from "./tree-digest.mjs";

export function codexSkillsRoot(env = process.env) {
  return join(env.CODEX_HOME || join(env.HOME || homedir(), ".codex"), "skills");
}

export function installSkills(source, { env = process.env, replace = false, playbooksSource } = {}) {
  if (!existsSync(source)) throw new GovernanceError("Skill source directory does not exist.", { code: "RG_INSTALL" });
  const root = codexSkillsRoot(env);
  mkdirSync(root, { recursive: true });
  const names = readdirSync(source).sort();
  const staging = mkdtempSync(join(tmpdir(), "repo-governance-skills-"));
  const expected = new Map();
  try {
    for (const name of names) {
      const target = join(staging, name);
      cpSync(join(source, name), target, { recursive: true });
      if (playbooksSource) {
        const playbook = join(playbooksSource, `${name}.md`);
        if (!existsSync(playbook)) throw new GovernanceError(`Shared playbook is missing for Skill ${name}.`, { code: "RG_INSTALL" });
        mkdirSync(join(target, "references"), { recursive: true });
        cpSync(playbook, join(target, "references", "playbook.md"));
      }
      expected.set(name, treeDigest(target));
    }
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  const reused = [];
  for (const name of names) {
    const target = join(root, name);
    if (!existsSync(target) || replace) continue;
    if (treeDigest(target) === expected.get(name)) reused.push(name);
    else {
      rmSync(staging, { recursive: true, force: true });
      throw new GovernanceError(`Skill ${name} already exists with different content; use explicit --replace after review.`, { code: "RG_INSTALL" });
    }
  }
  const installed = [];
  try {
    for (const name of names) {
      if (reused.includes(name)) continue;
      const target = join(root, name);
      cpSync(join(staging, name), target, { recursive: true, force: replace, errorOnExist: !replace });
      installed.push(name);
    }
  } catch (error) {
    for (const name of installed) rmSync(join(root, name), { recursive: true, force: true });
    throw error;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return { root, installed, reused };
}
