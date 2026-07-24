import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildCommandGraph } from "./command-graph.mjs";
import { dependencyPreparationDefinitionHash } from "./execution-contract.mjs";

const STAGE_ORDER = ["dependencies", "prepare", "validate"];
const REJECTED_SHELL = /\|\||;|\$\(|`/;
const LIFECYCLE_SCRIPTS = ["preinstall", "install", "postinstall", "prepare"];

function finding(profileId, message, details = {}) {
  return { rule: "RG006", profileId, message, waivable: false, ...details };
}

function commandGraphFindings(repo, config, profile, commands) {
  const findings = [];
  let graph;
  try {
    graph = buildCommandGraph(repo, config);
  } catch (error) {
    return [finding(profile.id, error.message)];
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(command, path = []) {
    if (!graph.scripts.has(command) && !(config.commandAliases || {})[command]) return;
    if (visiting.has(command)) {
      findings.push(finding(profile.id, "Protected execution command graph contains a cycle.", { cycle: [...path, command] }));
      return;
    }
    if (visited.has(command)) return;
    const script = graph.scripts.get(command);
    if (script && REJECTED_SHELL.test(script.definition)) {
      findings.push(finding(profile.id, `Protected command ${command} uses forbidden shell composition.`, { command, definition: script.definition }));
      return;
    }
    visiting.add(command);
    let dependencies = [];
    try {
      dependencies = graph.edges(command);
    } catch (error) {
      findings.push(finding(profile.id, error.message, { command }));
    }
    for (const dependency of dependencies) visit(dependency, [...path, command]);
    visiting.delete(command);
    visited.add(command);
  }
  for (const command of commands) if (!command.startsWith("dependency:") && !command.startsWith("system:")) visit(command);
  return findings;
}

function lifecycleFindings(repo, profile) {
  const manifest = join(repo, "package.json");
  if (!existsSync(manifest)) return [];
  const scripts = JSON.parse(readFileSync(manifest, "utf8")).scripts || {};
  const preparation = profile.dependencyPreparation;
  const present = LIFECYCLE_SCRIPTS.filter((name) => typeof scripts[name] === "string");
  if (present.length === 0) return [];
  if (preparation.lifecycleScripts.mode === "forbid") {
    return [finding(profile.id, "Repository lifecycle scripts are forbidden by the dependency preparation contract.", { lifecycleScripts: present })];
  }
  const dependencyCommands = new Set(profile.requiredStages.find((stage) => stage.id === "dependencies")?.commands || []);
  const unprotected = present.filter((name) => !dependencyCommands.has(`package.json#${name}`));
  const findings = [];
  if (unprotected.length > 0) findings.push(finding(profile.id, "Repository lifecycle scripts must be explicit commands in the dependencies stage.", { lifecycleScripts: unprotected }));
  return findings;
}

export function evaluateRg006(repo, config) {
  const findings = [];
  const runtimes = new Map();
  for (const runtime of config.runtimes) {
    if (runtimes.has(runtime.id)) findings.push(finding(null, `Runtime id is duplicated: ${runtime.id}.`, { runtimeId: runtime.id }));
    runtimes.set(runtime.id, runtime);
    const tools = new Set();
    for (const tool of runtime.systemTools || []) {
      if (tools.has(tool.name)) findings.push(finding(null, `System tool is duplicated in runtime ${runtime.id}: ${tool.name}.`, { runtimeId: runtime.id, tool: tool.name }));
      tools.add(tool.name);
      if (!tool.version && !tool.sha256) findings.push(finding(null, `System tool ${tool.name} must declare a version range or SHA-256 digest.`, { runtimeId: runtime.id, tool: tool.name }));
      if (tool.source === "self-contained" && (!tool.path || tool.path.startsWith("/") || tool.path.split(/[\\/]/).includes(".."))) {
        findings.push(finding(null, `Self-contained tool ${tool.name} must use a safe repository-relative path.`, { runtimeId: runtime.id, tool: tool.name }));
      }
    }
  }

  const profileIds = new Set();
  const commandGraphs = {};
  for (const profile of config.executionProfiles) {
    if (profileIds.has(profile.id)) findings.push(finding(profile.id, `Execution profile id is duplicated: ${profile.id}.`));
    profileIds.add(profile.id);
    const runtime = runtimes.get(profile.runtimeId);
    if (!runtime) {
      findings.push(finding(profile.id, `Execution profile references unknown runtime ${profile.runtimeId}.`, { runtimeId: profile.runtimeId }));
      continue;
    }
    if (profile.runtime !== undefined) findings.push(finding(profile.id, "Execution profiles may only reference the runtime registry through runtimeId."));
    const expectedHash = dependencyPreparationDefinitionHash(runtime, profile.dependencyPreparation);
    if (profile.dependencyPreparation.definitionHash !== expectedHash) {
      findings.push(finding(profile.id, "Dependency preparation definitionHash does not match the canonical execution contract.", {
        expectedDefinitionHash: expectedHash,
        actualDefinitionHash: profile.dependencyPreparation.definitionHash,
      }));
    }
    const packageManager = runtime.packageManager?.name || null;
    if (
      (packageManager === null && profile.dependencyPreparation.adapter !== "none")
      || (packageManager !== null && profile.dependencyPreparation.adapter !== packageManager)
    ) {
      findings.push(finding(profile.id, "Dependency adapter must exactly match the resolved runtime package manager.", {
        adapter: profile.dependencyPreparation.adapter,
        packageManager,
      }));
    }
    const stageIds = profile.requiredStages.map((stage) => stage.id);
    const stagePositions = stageIds.map((id) => STAGE_ORDER.indexOf(id));
    if (
      stageIds[0] !== "dependencies"
      || stageIds.at(-1) !== "validate"
      || stagePositions.some((position) => position < 0)
      || stagePositions.some((position, index) => index > 0 && position <= stagePositions[index - 1])
    ) {
      findings.push(finding(profile.id, "requiredStages must be ordered as dependencies, optional prepare, then validate.", { stages: stageIds }));
    }
    const dependencyReference = `dependency:${profile.dependencyPreparation.id}`;
    if (!profile.requiredStages[0]?.commands.includes(dependencyReference)) {
      findings.push(finding(profile.id, `Dependencies stage must invoke ${dependencyReference}.`));
    }
    if (
      !Array.isArray(profile.entry.argv)
      || profile.entry.argv.length === 0
      || profile.entry.argv.some((argument) => typeof argument !== "string" || REJECTED_SHELL.test(argument))
    ) {
      findings.push(finding(profile.id, "Profile entry must use a non-empty argv array without shell operators or command substitution."));
    }
    for (const field of ["hookArgv", "ciArgv"]) {
      const argv = profile.dependencyPreparation[field];
      if (!Array.isArray(argv) || argv.some((argument) => typeof argument !== "string" || REJECTED_SHELL.test(argument))) {
        findings.push(finding(profile.id, `${field} must be an argv array without shell operators or command substitution.`));
      }
    }
    const preparation = profile.dependencyPreparation;
    if (preparation.adapter === "none" && (preparation.hookArgv.length > 0 || preparation.ciArgv.length > 0)) {
      findings.push(finding(profile.id, "The none dependency adapter must use empty hookArgv and ciArgv."));
    }
    if (preparation.adapter === "pnpm") {
      for (const [field, argv] of [["hookArgv", preparation.hookArgv], ["ciArgv", preparation.ciArgv]]) {
        if (argv[0] !== "pnpm" || !argv.includes("--frozen-lockfile") || !argv.includes("--ignore-scripts")) {
          findings.push(finding(profile.id, `${field} must use pnpm with a frozen lockfile and disabled lifecycle scripts.`));
        }
      }
      if (!preparation.hookArgv.includes("--offline")) findings.push(finding(profile.id, "pnpm hookArgv must be offline."));
    }
    if (preparation.adapter === "npm") {
      for (const [field, argv] of [["hookArgv", preparation.hookArgv], ["ciArgv", preparation.ciArgv]]) {
        if (argv[0] !== "npm" || argv[1] !== "ci" || !argv.includes("--ignore-scripts")) {
          findings.push(finding(profile.id, `${field} must use npm ci with disabled lifecycle scripts.`));
        }
      }
      if (!preparation.hookArgv.includes("--offline")) findings.push(finding(profile.id, "npm hookArgv must be offline."));
    }
    const orderedCommands = profile.requiredStages.flatMap((stage) => stage.commands);
    commandGraphs[profile.id] = profile.requiredStages.map((stage) => ({ id: stage.id, commands: [...stage.commands] }));
    findings.push(...commandGraphFindings(repo, config, profile, orderedCommands));
    findings.push(...lifecycleFindings(repo, profile));
  }
  return { findings, commandGraphs };
}
