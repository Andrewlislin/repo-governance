import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { GovernanceError } from "./errors.mjs";

export function codexSkillsRoot(env = process.env) {
  return join(env.CODEX_HOME || join(env.HOME || homedir(), ".codex"), "skills");
}

export function installSkills(source, { env = process.env, replace = false, playbooksSource } = {}) {
  if (!existsSync(source)) throw new GovernanceError("Skill source directory does not exist.", { code: "RG_INSTALL" });
  const root = codexSkillsRoot(env);
  mkdirSync(root, { recursive: true });
  const names = readdirSync(source).sort();
  for (const name of names) {
    if (existsSync(join(root, name)) && !replace) throw new GovernanceError(`Skill ${name} already exists; use explicit --replace after review.`, { code: "RG_INSTALL" });
  }
  const installed = [];
  try {
    for (const name of names) {
      const target = join(root, name);
      cpSync(join(source, name), target, { recursive: true, force: replace, errorOnExist: !replace });
      installed.push(name);
      if (playbooksSource) {
        const playbook = join(playbooksSource, `${name}.md`);
        if (!existsSync(playbook)) throw new GovernanceError(`Shared playbook is missing for Skill ${name}.`, { code: "RG_INSTALL" });
        mkdirSync(join(target, "references"), { recursive: true });
        cpSync(playbook, join(target, "references", "playbook.md"), { force: true });
      }
    }
  } catch (error) {
    for (const name of installed) rmSync(join(root, name), { recursive: true, force: true });
    throw error;
  }
  return { root, installed };
}
