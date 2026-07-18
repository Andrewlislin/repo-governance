import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { GovernanceError } from "./errors.mjs";

export function stageCodexSkills({ skillsSource, playbooksSource, destination }) {
  mkdirSync(destination, { recursive: true });
  const names = readdirSync(skillsSource).sort();
  for (const name of names) {
    const skillSource = join(skillsSource, name);
    const playbook = join(playbooksSource, `${name}.md`);
    if (!existsSync(playbook)) throw new GovernanceError(`Shared playbook is missing for Codex Skill ${name}.`, { code: "RG_AGENT_ASSETS" });
    const target = join(destination, name);
    cpSync(skillSource, target, { recursive: true });
    mkdirSync(join(target, "references"), { recursive: true });
    cpSync(playbook, join(target, "references", "playbook.md"));
  }
  return { destination, names };
}

export function stageAgentAssets({ playbooksSource, adaptersSource, destination }) {
  mkdirSync(destination, { recursive: true });
  cpSync(playbooksSource, join(destination, "playbooks"), { recursive: true });
  cpSync(adaptersSource, join(destination, "adapters"), { recursive: true });
  return { destination };
}
