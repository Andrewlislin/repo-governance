import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const THIN_WORKFLOW_PATH = ".github/workflows/repo-governance.yml";

export function thinWorkflow({ engineVersion, engineCommitSha, comment = false }) {
  if (!/^[0-9a-f]{40}$/.test(engineCommitSha)) return null;
  const reporter = comment
    ? `\n  reporter:\n    needs: governance\n    if: always()\n    uses: Andrewlislin/repo-governance/.github/workflows/reporter.yml@${engineCommitSha}\n    with:\n      report-artifact: \${{ needs.governance.outputs.report-artifact }}\n    permissions:\n      actions: read\n      pull-requests: write\n`
    : "";
  return `# repo-governance engine ${engineVersion}\nname: Repo Governance\n\non:\n  pull_request:\n\npermissions:\n  contents: read\n  pull-requests: read\n\njobs:\n  governance:\n    uses: Andrewlislin/repo-governance/.github/workflows/governance.yml@${engineCommitSha}\n    permissions:\n      contents: read\n      pull-requests: read\n${reporter}`;
}

export function writeThinWorkflow(repo, identity) {
  const contents = thinWorkflow({ engineVersion: identity.version, engineCommitSha: identity.commitSha });
  if (!contents) return { written: false, reason: "Development engine has no immutable commit SHA; release installation will generate the thin workflow." };
  const path = join(repo, THIN_WORKFLOW_PATH);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, { flag: "wx" });
  return { written: true, path: THIN_WORKFLOW_PATH };
}
