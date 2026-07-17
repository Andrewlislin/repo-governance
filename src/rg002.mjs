import { buildCommandGraph, reachableCommands } from "./command-graph.mjs";

export const TEST_TIERS = ["pr-blocking", "nightly", "manual-smoke"];

export function evaluateRg002(repo, config) {
  const findings = [];
  const tiers = config.testTiers || { "pr-blocking": [], nightly: [], "manual-smoke": [] };
  const membership = new Map();
  for (const tier of TEST_TIERS) {
    for (const id of tiers[tier] || []) {
      const assigned = membership.get(id) || [];
      assigned.push(tier);
      membership.set(id, assigned);
    }
  }
  for (const entry of config.testEntries || []) {
    const assigned = membership.get(entry.id) || [];
    if (assigned.length !== 1) {
      findings.push({
        rule: "RG002",
        testEntry: entry.id,
        actualTiers: assigned,
        message: `Executable test entry must belong to exactly one tier; found ${assigned.length}.`,
        waivable: false,
      });
    }
  }
  const graph = buildCommandGraph(repo, config);
  const reachable = reachableCommands(graph, config.prBlockingCommands || []);
  for (const entry of config.testEntries || []) {
    const assigned = membership.get(entry.id) || [];
    const commandNode = entry.type === "command" ? (entry.node || entry.id) : null;
    if (commandNode && reachable.has(commandNode) && assigned.some((tier) => tier === "nightly" || tier === "manual-smoke")) {
      findings.push({
        rule: "RG002",
        testEntry: entry.id,
        actualTiers: assigned,
        message: `PR-blocking command graph reaches ${assigned[0]} entry ${entry.id}; skip-on-missing-secret behavior does not make this safe.`,
        waivable: false,
      });
    }
  }
  return { findings, reachable: [...reachable].sort() };
}
