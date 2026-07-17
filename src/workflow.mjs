import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const THIN_WORKFLOW_PATH = ".github/workflows/repo-governance.yml";

export function thinWorkflow({ engineVersion, engineCommitSha, comment = false }) {
  if (!/^[0-9a-f]{40}$/.test(engineCommitSha)) return null;
  return `# repo-governance engine ${engineVersion}\nname: Repo Governance\n\non:\n  pull_request:\n\npermissions:\n  contents: read\n  pull-requests: read\n\njobs:\n  governance:\n    uses: Andrewlislin/repo-governance/.github/workflows/governance.yml@${engineCommitSha}\n    with:\n      comment: ${comment}\n`;
}

export function writeThinWorkflow(repo, identity) {
  const contents = thinWorkflow({ engineVersion: identity.version, engineCommitSha: identity.commitSha });
  if (!contents) return { written: false, reason: "Development engine has no immutable commit SHA; release installation will generate the thin workflow." };
  const path = join(repo, THIN_WORKFLOW_PATH);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, { flag: "wx" });
  return { written: true, path: THIN_WORKFLOW_PATH };
}
