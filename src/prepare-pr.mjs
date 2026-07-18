import { checkRepository } from "./check.mjs";
import { readConfig } from "./config.mjs";
import { GovernanceError } from "./errors.mjs";
import { projectAgentReport, projectCheckFailure } from "./agent-report.mjs";
import { runGit } from "./process.mjs";

export function preparePullRequest(repo, { base, env = process.env } = {}) {
  const status = runGit(["status", "--porcelain", "--untracked-files=all"], { cwd: repo, env }).stdout.trim();
  if (status) throw new GovernanceError("prepare-pr requires a clean worktree so the report matches the committed PR diff.", {
    code: "RG_WORKTREE_DIRTY",
    details: {
      changes: status.split("\n"),
      nextActions: [{ id: "clean-worktree", severity: "error", message: "Commit or stash all staged, unstaged, and untracked changes before prepare-pr." }],
    },
  });
  const config = readConfig(repo);
  const baseRef = base || config.defaultBranch;
  try {
    return projectAgentReport(checkRepository(repo, { base: baseRef }), { repoPath: repo, baseRef });
  } catch (error) {
    if (error instanceof GovernanceError) return projectCheckFailure(error, { repoPath: repo, baseRef });
    throw error;
  }
}
