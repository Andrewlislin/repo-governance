import { GovernanceError } from "./errors.mjs";
import { runGit } from "./process.mjs";

export function repositoryRoot(cwd = process.cwd()) {
  const result = runGit(["rev-parse", "--show-toplevel"], { cwd });
  return result.stdout.trim();
}

export function resolveCommit(repo, revision) {
  const result = runGit(["rev-parse", "--verify", `${revision}^{commit}`], {
    cwd: repo,
    allowFailure: true,
  });
  if (result.status !== 0) {
    throw new GovernanceError(`Git history is missing required revision: ${revision}. Fetch the target history explicitly and retry.`, {
      code: "RG_GIT_HISTORY_INSUFFICIENT",
      details: { revision },
    });
  }
  return result.stdout.trim();
}

function assertAncestor(repo, ancestor, descendant, label) {
  const result = runGit(["merge-base", "--is-ancestor", ancestor, descendant], {
    cwd: repo,
    allowFailure: true,
  });
  if (result.status !== 0) {
    throw new GovernanceError(`${label} is not an ancestor of the target head.`, {
      code: "RG005_CANONICAL_BASE_INVALID",
      details: { ancestor, descendant },
    });
  }
}

export function resolveCanonicalBase(repo, baseRef, headRef = "HEAD") {
  const baseTip = resolveCommit(repo, baseRef);
  const headSha = resolveCommit(repo, headRef);
  const result = runGit(["merge-base", baseTip, headSha], { cwd: repo, allowFailure: true });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new GovernanceError("Unable to compute a canonical merge-base from the fetched target repository graph.", {
      code: "RG_GIT_HISTORY_INSUFFICIENT",
      details: { baseRef, headRef },
    });
  }
  const canonicalBaseSha = resolveCommit(repo, result.stdout.trim());
  assertAncestor(repo, canonicalBaseSha, headSha, "Canonical base");
  assertAncestor(repo, canonicalBaseSha, baseTip, "Canonical base");
  return { canonicalBaseSha, baseTip, headSha };
}

export function changedPaths(repo, baseSha, headSha) {
  const result = runGit([
    "-c", "core.quotepath=false",
    "-c", "diff.renames=false",
    "diff", "--name-only", "-z", "--no-renames", baseSha, headSha,
    "--", ".", ":(exclude).repo-governance/waivers/**",
  ], { cwd: repo, binary: true });
  return result.stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

export function trackedChanges(repo, paths) {
  if (paths.length === 0) return [];
  const result = runGit(["status", "--porcelain", "--", ...paths], { cwd: repo });
  return result.stdout.split("\n").filter(Boolean);
}
