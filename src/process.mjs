import { spawnSync } from "node:child_process";
import { GovernanceError } from "./errors.mjs";

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: options.binary ? null : "utf8",
    stdio: options.stdio ?? "pipe",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    throw new GovernanceError(`Unable to execute ${command}: ${result.error.message}`, {
      code: "RG_INVOCATION",
      details: { command },
    });
  }
  if (result.status !== 0 && !options.allowFailure) {
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString("utf8") : result.stderr;
    throw new GovernanceError(`${command} failed: ${(stderr || "unknown error").trim()}`, {
      code: options.errorCode ?? "RG_INVOCATION",
      details: { command, args, status: result.status },
    });
  }
  return result;
}

export function runGit(args, options = {}) {
  return run("git", args, { ...options, errorCode: options.errorCode ?? "RG_GIT" });
}
