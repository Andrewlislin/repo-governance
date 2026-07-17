import { GovernanceError } from "../errors.mjs";

export function validateRemoteWaiverApprovals({ event, reviews, report, config }) {
  const pullRequest = event?.pull_request;
  if (!pullRequest?.head?.sha || !pullRequest?.base?.ref) {
    throw new GovernanceError("Remote waiver validation requires a pull_request event with live base and head data.", { code: "RG005_GITHUB_EVENT" });
  }
  if (report.endpoints?.headSha !== pullRequest.head.sha) {
    throw new GovernanceError("Governance report head does not equal the live pull_request.head.sha.", {
      code: "RG005_HEAD_MISMATCH",
      exitCode: 1,
      details: { reportHead: report.endpoints?.headSha, liveHead: pullRequest.head.sha },
    });
  }
  const acceptedWaivers = report.acceptedWaivers || [];
  if (acceptedWaivers.length === 0) return { ok: true, approvals: [], message: "No remote waiver approvals are required." };
  const allowed = new Set((config.waiverApprovers || []).map((login) => login.toLowerCase()));
  const latestByReviewer = new Map();
  for (const review of reviews) {
    const login = review.user?.login?.toLowerCase();
    if (allowed.has(login)) latestByReviewer.set(login, review);
  }
  const currentApprovals = [...latestByReviewer.values()].filter((review) =>
    review.state === "APPROVED" && review.commit_id === pullRequest.head.sha);
  if (currentApprovals.length === 0) {
    throw new GovernanceError("RG005 requires an allowed GitHub approval whose review commit_id equals the live PR head SHA.", {
      code: "RG005_CURRENT_HEAD_APPROVAL",
      exitCode: 1,
      details: { liveHead: pullRequest.head.sha, allowedApprovers: [...allowed] },
    });
  }
  return {
    ok: true,
    approvals: currentApprovals.map((review) => ({ login: review.user.login, commitId: review.commit_id, submittedAt: review.submitted_at })),
    message: "Every accepted local waiver has an allowed approval bound to the live PR head.",
  };
}
