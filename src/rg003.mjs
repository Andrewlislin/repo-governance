import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "yaml";

function stepKey(step) {
  return step.id || step.name;
}

function entryFor(step) {
  if (typeof step.uses === "string") return `uses:${step.uses}`;
  if (typeof step.run === "string") return `run:${step.run.trim()}`;
  return null;
}

export function evaluateRg003(repo, config) {
  const findings = [];
  const allowed = new Set(config.workflowAllowedEntries || []);
  const guards = new Map((config.guards || []).map((guard) => [guard.id, guard]));
  for (const policy of config.policyChecks || []) {
    const workflowPath = join(repo, policy.workflow);
    if (!existsSync(workflowPath)) {
      findings.push({ rule: "RG003", workflow: policy.workflow, message: "Registered policy workflow is missing.", waivable: false });
      continue;
    }
    const document = parseDocument(readFileSync(workflowPath, "utf8"), { prettyErrors: true });
    if (document.errors.length > 0) throw document.errors[0];
    const workflow = document.toJS();
    const job = workflow.jobs?.[policy.job];
    if (!job) {
      findings.push({ rule: "RG003", workflow: policy.workflow, job: policy.job, message: "Registered policy job is missing.", waivable: false });
      continue;
    }
    const registeredSteps = new Set(policy.steps || []);
    const seenEntries = new Set();
    for (const step of job.steps || []) {
      const key = stepKey(step);
      if (!registeredSteps.has(key)) {
        if (typeof step.run === "string") {
          findings.push({ rule: "RG003", workflow: policy.workflow, job: policy.job, step: key || null, message: "Formal policy job contains an unregistered run step.", waivable: false });
        }
        continue;
      }
      const entry = entryFor(step);
      if (!entry || !allowed.has(entry)) {
        findings.push({ rule: "RG003", workflow: policy.workflow, job: policy.job, step: key, actualEntry: entry, message: "Registered policy step does not call an allowed central Action, CLI, or repository guard entry.", waivable: false });
      } else {
        seenEntries.add(entry);
      }
    }
    for (const guardId of policy.requiredGuards || []) {
      const guard = guards.get(guardId);
      if (!guard || !existsSync(join(repo, guard.path)) || !seenEntries.has(guard.entry)) {
        findings.push({ rule: "RG003", workflow: policy.workflow, job: policy.job, guard: guardId, message: "Registered repository guard is missing, replaced, or bypassed by the policy job.", waivable: false });
      }
    }
  }
  return { findings };
}
