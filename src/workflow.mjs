import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const THIN_WORKFLOW_PATH = ".github/workflows/repo-governance.yml";
const CHECKOUT_SHA = "df4cb1c069e1874edd31b4311f1884172cec0e10";
const SETUP_NODE_SHA = "249970729cb0ef3589644e2896645e5dc5ba9c38";

export function thinWorkflow({ engineVersion, engineCommitSha, comment = false }) {
  if (!/^[0-9a-f]{40}$/.test(engineCommitSha)) return null;
  const reporter = comment
    ? `\n  reporter:\n    needs: validate\n    if: always()\n    uses: CoaseEdge/repo-governance/.github/workflows/reporter.yml@${engineCommitSha}\n    with:\n      report-artifact: \${{ needs.validate.outputs.report-artifact }}\n    permissions:\n      actions: read\n      pull-requests: write\n`
    : "";
  return `# repo-governance engine ${engineVersion}\nname: Repo Governance\n\non:\n  pull_request:\n\npermissions:\n  contents: read\n  pull-requests: read\n\njobs:\n  validate:\n    runs-on: ubuntu-latest\n    outputs:\n      report-artifact: \${{ steps.governance.outputs.report-artifact }}\n    steps:\n      - name: Checkout exact pull request head\n        uses: actions/checkout@${CHECKOUT_SHA}\n        with:\n          ref: \${{ github.event.pull_request.head.sha }}\n          fetch-depth: 0\n          clean: true\n          persist-credentials: false\n      - name: Set up Node.js 22\n        uses: actions/setup-node@${SETUP_NODE_SHA}\n        with:\n          node-version: 22\n      - name: Run governed validation\n        id: governance\n        uses: CoaseEdge/repo-governance/action@${engineCommitSha}\n        with:\n          profile: pr-validation\n          event-file: \${{ github.event_path }}\n${reporter}`;
}

export function writeThinWorkflow(repo, identity) {
  const contents = thinWorkflow({ engineVersion: identity.version, engineCommitSha: identity.commitSha });
  if (!contents) return { written: false, reason: "Development engine has no immutable commit SHA; release installation will generate the thin workflow." };
  const path = join(repo, THIN_WORKFLOW_PATH);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, { flag: "wx" });
  return { written: true, path: THIN_WORKFLOW_PATH };
}
