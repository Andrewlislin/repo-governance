import { relative } from "node:path";
import { asFailure, GovernanceError } from "./errors.mjs";
import { repositoryRoot, resolveCanonicalBase } from "./git.mjs";
import { checkRepository } from "./check.mjs";
import { initializeRepository } from "./init.mjs";
import { connectEffectiveRepositoryHook, doctorHooks, installFutureHooks, uninstallFutureHooks } from "./hooks.mjs";
import { createWaiver } from "./waiver.mjs";
import { controlledUpdate } from "./update.mjs";
import { readConfig } from "./config.mjs";
import { runtimeIdentity } from "./version.mjs";
import { readFileSync } from "node:fs";
import { validateRemoteWaiverApprovals } from "./github/waiver-approval.mjs";
import { githubEnforce } from "./github/enforce.mjs";
import { installReleaseBundle } from "./release-install.mjs";
import { installSkills } from "./skills-install.mjs";

function parse(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const [key, inline] = token.slice(2).split("=", 2);
    if (inline !== undefined) flags[key] = inline;
    else if (argv[index + 1] && !argv[index + 1].startsWith("--")) flags[key] = argv[++index];
    else flags[key] = true;
  }
  return { positional, flags };
}

function emit(payload, json = false, stream = process.stdout) {
  if (json) stream.write(`${JSON.stringify(payload, null, 2)}\n`);
  else if (typeof payload === "string") stream.write(`${payload}\n`);
  else stream.write(`${payload.message || JSON.stringify(payload, null, 2)}\n`);
}

function help() {
  return `repo-governance commands:
  init [--accept] [--default-branch main] [--json]
  check [--base <ref>] [--head <ref>] [--json]
  waiver create --name <name> --paths <a,b> --reason <text> --expires <ISO> [--base <ref>]
  hooks install --dispatcher <verified-file> [--compose]
  hooks doctor
  hooks uninstall
  github validate-waivers --event <json> --reviews <json> --report <json>
  github enforce --owner <owner> --repo <repo> --check <name> [--confirm]
  install --bundle <verified-release-directory>
  skills install --source <skills-directory> [--replace]
  update --bundle <verified-directory>
  version [--json]`;
}

export async function main(argv, context = {}) {
  const cwd = context.cwd || process.cwd();
  const env = context.env || process.env;
  const stdout = context.stdout || process.stdout;
  const stderr = context.stderr || process.stderr;
  const parsed = parse(argv);
  const [command, subcommand] = parsed.positional;
  const json = Boolean(parsed.flags.json);
  try {
    if (!command || command === "help" || parsed.flags.help) {
      emit(help(), false, stdout);
      return 0;
    }
    if (command === "version") {
      const identity = runtimeIdentity();
      emit(json ? identity : `${identity.version} (${identity.commitSha})`, json, stdout);
      return 0;
    }
    if (command === "github" && subcommand === "enforce") {
      const result = await githubEnforce({
        owner: parsed.flags.owner,
        repo: parsed.flags.repo,
        checkName: parsed.flags.check,
        token: env.GITHUB_TOKEN,
        confirm: Boolean(parsed.flags.confirm),
      });
      emit(result, json, result.status === "blocked" ? stderr : stdout);
      return result.status === "blocked" ? 2 : 0;
    }
    if (command === "install") {
      if (!parsed.flags.bundle) throw new GovernanceError("--bundle is required.", { code: "RG_INVOCATION" });
      emit(installReleaseBundle(parsed.flags.bundle, { env }), json, stdout);
      return 0;
    }
    if (command === "skills" && subcommand === "install") {
      if (!parsed.flags.source) throw new GovernanceError("--source is required.", { code: "RG_INVOCATION" });
      emit(installSkills(parsed.flags.source, { env, replace: Boolean(parsed.flags.replace) }), json, stdout);
      return 0;
    }
    if (command === "hooks" && subcommand === "install") {
      const result = installFutureHooks({ compose: Boolean(parsed.flags.compose), env, dispatcherSource: parsed.flags.dispatcher });
      emit(result, json, stdout);
      return 0;
    }
    if (command === "hooks" && subcommand === "uninstall") {
      emit(uninstallFutureHooks({ env }), json, stdout);
      return 0;
    }
    const repo = repositoryRoot(cwd);
    if (command === "github" && subcommand === "validate-waivers") {
      for (const flag of ["event", "reviews", "report"]) if (!parsed.flags[flag]) throw new GovernanceError(`--${flag} is required.`, { code: "RG_INVOCATION" });
      const result = validateRemoteWaiverApprovals({
        event: JSON.parse(readFileSync(parsed.flags.event, "utf8")),
        reviews: JSON.parse(readFileSync(parsed.flags.reviews, "utf8")),
        report: JSON.parse(readFileSync(parsed.flags.report, "utf8")),
        config: readConfig(repo),
      });
      emit(result, json, stdout);
      return 0;
    }
    if (command === "init") {
      const result = initializeRepository(repo, { accept: Boolean(parsed.flags.accept), defaultBranch: parsed.flags["default-branch"] || "main" });
      if (result.written) result.hook = connectEffectiveRepositoryHook(repo, { env });
      emit(result, json, stdout);
      return result.written || !parsed.flags.accept ? 0 : 2;
    }
    if (command === "check") {
      const result = checkRepository(repo, { base: parsed.flags.base, head: parsed.flags.head });
      emit(result, json, result.ok ? stdout : stderr);
      return result.exitCode;
    }
    if (command === "waiver" && subcommand === "create") {
      const required = ["name", "paths", "reason", "expires"];
      for (const flag of required) if (!parsed.flags[flag]) throw new GovernanceError(`--${flag} is required.`, { code: "RG_INVOCATION" });
      const config = readConfig(repo);
      const endpoints = resolveCanonicalBase(repo, parsed.flags.base || config.defaultBranch, parsed.flags.head || "HEAD");
      const path = createWaiver(repo, {
        name: parsed.flags.name,
        businessPaths: String(parsed.flags.paths).split(",").filter(Boolean),
        reason: parsed.flags.reason,
        expiresAt: parsed.flags.expires,
        canonicalBaseSha: endpoints.canonicalBaseSha,
        headSha: endpoints.headSha,
      });
      emit({ created: relative(repo, path), baseSha: endpoints.canonicalBaseSha, headShaStored: false }, json, stdout);
      return 0;
    }
    if (command === "hooks" && subcommand === "doctor") {
      const result = doctorHooks(repo, { env });
      emit(result, json, result.ok ? stdout : stderr);
      return result.ok ? 0 : 2;
    }
    if (command === "update") {
      if (!parsed.flags.bundle) throw new GovernanceError("--bundle is required; push and check never download an engine implicitly.", { code: "RG_INVOCATION" });
      emit(controlledUpdate(repo, parsed.flags.bundle, { env }), json, stdout);
      return 0;
    }
    throw new GovernanceError(`Unknown command: ${parsed.positional.join(" ")}`, { code: "RG_INVOCATION" });
  } catch (error) {
    const failure = asFailure(error);
    emit(json ? failure : `${failure.error.code}: ${failure.error.message}`, json, stderr);
    return failure.exitCode;
  }
}
