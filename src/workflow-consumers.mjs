import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parseDocument } from "yaml";

const CHECKOUT_ACTION = /^actions\/checkout@[0-9a-f]{40}$/;
const SETUP_NODE_ACTION = /^actions\/setup-node@[0-9a-f]{40}$/;
const CACHE_ACTION = /^actions\/cache@[0-9a-f]{40}$/;
const PINNED_REMOTE = /^[^@\s]+@[0-9a-f]{40}$/;

function finding(profileId, message, details = {}) {
  return { rule: "RG006", profileId, message, waivable: false, ...details };
}

function revisionExpression(source) {
  if (source === "pull-request-head") return "${{ github.event.pull_request.head.sha }}";
  if (source === "pull-request-merge" || source === "push-event-sha") return "${{ github.sha }}";
  return null;
}

function normalizedNeeds(needs) {
  if (needs === undefined || needs === null) return [];
  return Array.isArray(needs) ? needs : [needs];
}

function executionContext(workflow, job, step) {
  return {
    workingDirectory: step["working-directory"] ?? ".",
    shell: step.shell ?? null,
    continueOnError: step["continue-on-error"] ?? false,
    stepIf: step.if ?? null,
    jobIf: job.if ?? null,
    defaultsRun: workflow.defaults?.run || job.defaults?.run
      ? { workflow: workflow.defaults?.run ?? null, job: job.defaults?.run ?? null }
      : null,
    matrix: job.strategy?.matrix ?? null,
    needs: normalizedNeeds(job.needs),
    env: { ...(workflow.env || {}), ...(job.env || {}), ...(step.env || {}) },
    runner: job["runs-on"] ?? null,
    container: job.container ?? null,
    timeoutMinutes: job["timeout-minutes"] ?? null,
  };
}

function validateProtectedJob(config, profile, consumer, workflow, job) {
  const findings = [];
  const steps = job.steps || [];
  const verification = steps.filter((step) => step.name === consumer.verificationStep || step.id === consumer.verificationStep);
  if (verification.length !== 1) {
    return [finding(profile.id, "Workflow consumer must uniquely locate its verification step.", {
      workflow: consumer.workflow,
      job: consumer.job,
      verificationStep: consumer.verificationStep,
      matches: verification.length,
    })];
  }
  const verificationStep = verification[0];
  if (!isDeepStrictEqual(executionContext(workflow, job, verificationStep), consumer.executionContext)) {
    findings.push(finding(profile.id, "Workflow execution context differs from the declared consumer contract.", {
      workflow: consumer.workflow,
      job: consumer.job,
      expected: consumer.executionContext,
      actual: executionContext(workflow, job, verificationStep),
    }));
  }
  for (const step of steps) {
    if (step.uses?.startsWith("./")) {
      findings.push(finding(profile.id, "Local composite Actions are forbidden unless their directory tree digest is explicitly contracted.", { workflow: consumer.workflow, step: step.name || null }));
    } else if (step.uses && !PINNED_REMOTE.test(step.uses)) {
      findings.push(finding(profile.id, "Every remote Action must be pinned to a full 40-character commit SHA.", { workflow: consumer.workflow, step: step.name || null, uses: step.uses }));
    }
  }
  if (steps.length < 3 || !CHECKOUT_ACTION.test(steps[0].uses || "")) {
    findings.push(finding(profile.id, "Protected workflow must begin with a pinned actions/checkout step.", { workflow: consumer.workflow }));
  } else {
    const expectedRef = revisionExpression(consumer.revisionSource);
    if (
      steps[0].with?.ref !== expectedRef
      || steps[0].with?.clean !== true
      || steps[0].with?.["persist-credentials"] !== false
    ) {
      findings.push(finding(profile.id, "Checkout must select the declared exact revision with clean: true and credentials disabled.", {
        workflow: consumer.workflow,
        expectedRef,
      }));
    }
  }
  const runtime = config.runtimes.find((candidate) => candidate.id === profile.runtimeId);
  const setupIndex = steps.findIndex((step) => SETUP_NODE_ACTION.test(step.uses || ""));
  const verificationIndex = steps.indexOf(verificationStep);
  if (runtime?.node) {
    const expectedNode = runtime.node.version.replace(/\.x$/, "");
    if (setupIndex < 1 || setupIndex >= verificationIndex || String(steps[setupIndex].with?.["node-version"]) !== expectedNode) {
      findings.push(finding(profile.id, "Protected workflow must set up the declared Node.js runtime before verification.", { workflow: consumer.workflow, expectedNode }));
    }
  }
  const expectedAction = config.engineCommitSha === "development"
    ? /^CoaseEdge\/repo-governance\/action@[0-9a-f]{40}$/
    : new RegExp(`^CoaseEdge/repo-governance/action@${config.engineCommitSha}$`);
  if (!expectedAction.test(verificationStep.uses || "")) {
    findings.push(finding(profile.id, "Verification step must call the immutable repo-governance Action for the configured engine.", {
      workflow: consumer.workflow,
      uses: verificationStep.uses || null,
    }));
  }
  if (
    verificationStep.with?.profile !== profile.id
    || verificationStep.with?.["event-file"] !== "${{ github.event_path }}"
  ) {
    findings.push(finding(profile.id, "Verification step inputs must select the declared profile and GitHub event file.", { workflow: consumer.workflow }));
  }
  for (const [index, step] of steps.entries()) {
    if (index === 0 || index === setupIndex || step === verificationStep) continue;
    if (CACHE_ACTION.test(step.uses || "")) {
      const paths = String(step.with?.path || "").split(/\r?\n/).map((path) => path.trim()).filter(Boolean);
      if (paths.length === 0 || paths.some((path) => !path.startsWith("~/"))) {
        findings.push(finding(profile.id, "Only package-manager download caches outside the workspace may be restored.", { workflow: consumer.workflow, step: step.name || null }));
      }
      continue;
    }
    findings.push(finding(profile.id, "Protected workflow contains an undeclared run or uses step outside checkout, runtime setup, cache, and governed verification.", {
      workflow: consumer.workflow,
      step: step.name || null,
    }));
  }
  return findings;
}

export function evaluateWorkflowConsumers(repo, config) {
  const findings = [];
  for (const profile of config.executionProfiles) {
    const hooks = profile.consumers.filter((consumer) => consumer.type === "pre-push");
    const workflows = profile.consumers.filter((consumer) => consumer.type === "github-actions");
    if (hooks.length !== 1 || hooks[0].revisionSource !== "pushed-ref-tip") {
      findings.push(finding(profile.id, "Execution profile must declare exactly one pre-push consumer bound to pushed-ref-tip."));
    }
    if (workflows.length === 0) findings.push(finding(profile.id, "Execution profile must declare at least one GitHub Actions consumer."));
    const locations = new Set();
    for (const consumer of workflows) {
      const location = `${consumer.workflow}\0${consumer.job}\0${consumer.verificationStep}`;
      if (locations.has(location)) {
        findings.push(finding(profile.id, "Workflow consumer location is duplicated.", { workflow: consumer.workflow, job: consumer.job, verificationStep: consumer.verificationStep }));
        continue;
      }
      locations.add(location);
      const path = join(repo, consumer.workflow);
      if (!existsSync(path)) {
        findings.push(finding(profile.id, "Declared workflow consumer file is missing.", { workflow: consumer.workflow }));
        continue;
      }
      const document = parseDocument(readFileSync(path, "utf8"), { prettyErrors: true });
      if (document.errors.length > 0) throw document.errors[0];
      const workflow = document.toJS();
      if (!Object.hasOwn(workflow.on || {}, consumer.trigger)) {
        findings.push(finding(profile.id, "Workflow trigger does not match the declared consumer.", { workflow: consumer.workflow, trigger: consumer.trigger }));
        continue;
      }
      const job = workflow.jobs?.[consumer.job];
      if (!job || job.uses) {
        findings.push(finding(profile.id, "Workflow consumer job is missing or delegates validation to an opaque reusable workflow.", { workflow: consumer.workflow, job: consumer.job }));
        continue;
      }
      findings.push(...validateProtectedJob(config, profile, consumer, workflow, job));
    }
  }
  return { findings, verified: findings.length === 0 };
}
