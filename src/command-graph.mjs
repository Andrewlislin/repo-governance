import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { GovernanceError } from "./errors.mjs";

function nodeId(manifest, script) {
  return `${manifest}#${script}`;
}

function dynamicOrOpaque(command) {
  return /\beval\b|\$\(|`|\$\{|\bmake(?:\s|$)|\b(?:ba)?sh\s+[^;&|]+\.sh\b/.test(command);
}

function packageInvocation(segment, manifest) {
  const filtered = segment.match(/^pnpm\s+(?:--filter|-F)\s+\S+\s+(?:run\s+)?([\w:.-]+)(?:\s|$)/);
  if (filtered) return nodeId(manifest, filtered[1]);
  const direct = segment.match(/^(?:npm|pnpm|bun)\s+(?:run\s+)?([\w:.-]+)(?:\s|$)/);
  if (direct) return nodeId(manifest, direct[1]);
  return null;
}

export function buildCommandGraph(repo, config) {
  const manifests = config.commandManifests || ["package.json"];
  const scripts = new Map();
  for (const manifest of manifests) {
    const path = join(repo, manifest);
    if (!existsSync(path)) continue;
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    for (const [name, definition] of Object.entries(parsed.scripts || {})) {
      scripts.set(nodeId(manifest, name), { manifest, name, definition });
    }
  }
  const aliases = new Map(Object.entries(config.commandAliases || {}));
  const registeredLeaves = new Map((config.testEntries || [])
    .filter((entry) => entry.type === "command")
    .map((entry) => [entry.command, entry.id]));
  const pythonLeaves = new Map((config.pythonTestEntries || []).map((entry) => [entry.command, entry.id]));

  function edges(id) {
    if (aliases.has(id)) return aliases.get(id);
    const script = scripts.get(id);
    if (!script) return [];
    if (dynamicOrOpaque(script.definition)) {
      throw new GovernanceError(`RG002 cannot statically resolve protected command ${id}. Declare an explicit alias or registered Python/pytest entry.`, {
        code: "RG002_COMMAND_GRAPH",
        details: { command: id, definition: script.definition },
      });
    }
    const dependencies = [];
    for (const raw of script.definition.split(/&&|\|\||;/)) {
      const segment = raw.trim().replace(/^[A-Z_][A-Z0-9_]*=[^\s]+\s+/, "");
      if (!segment) continue;
      const invoked = packageInvocation(segment, script.manifest);
      if (invoked) {
        dependencies.push(invoked);
        continue;
      }
      const leaf = registeredLeaves.get(segment) || pythonLeaves.get(segment);
      if (leaf) dependencies.push(leaf);
      else if (/^(?:python\s+-m\s+pytest|pytest)(?:\s|$)/.test(segment)) {
        throw new GovernanceError(`Unregistered pytest invocation in protected command ${id}: ${segment}`, {
          code: "RG002_COMMAND_GRAPH",
          details: { command: id, invocation: segment },
        });
      } else if (/^(?:\.?\/?[\w.-]+\/)*[\w.-]+\.sh(?:\s|$)/.test(segment)) {
        throw new GovernanceError(`Opaque shell entry in protected command ${id}: ${segment}`, {
          code: "RG002_COMMAND_GRAPH",
          details: { command: id, invocation: segment },
        });
      }
    }
    return dependencies;
  }
  return { scripts, edges, normalizeNode: (id) => normalize(id).replaceAll("\\", "/") };
}

export function reachableCommands(graph, roots) {
  const visited = new Set();
  const stack = [...roots];
  while (stack.length > 0) {
    const current = stack.pop();
    if (visited.has(current)) continue;
    visited.add(current);
    for (const dependency of graph.edges(current)) stack.push(dependency);
  }
  return visited;
}
