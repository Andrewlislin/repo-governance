import { GovernanceError } from "../errors.mjs";

function encoded(value) {
  return encodeURIComponent(value);
}

async function jsonRequest(fetchImpl, url, { token, method = "GET", body, allow = [] } = {}) {
  const response = await fetchImpl(url, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok && !allow.includes(response.status)) {
    throw new GovernanceError(`GitHub capability request failed with HTTP ${response.status}.`, {
      code: "RG_GITHUB_API",
      details: { url, method, status: response.status },
    });
  }
  return { status: response.status, data: response.status === 204 ? null : await response.json() };
}

export async function githubEnforce({ owner, repo, checkName, token, confirm = false, fetchImpl = fetch }) {
  if (!owner || !repo || !checkName || !token) throw new GovernanceError("github enforce requires owner, repo, check name, and GITHUB_TOKEN.", { code: "RG_INVOCATION" });
  const root = `https://api.github.com/repos/${encoded(owner)}/${encoded(repo)}`;
  const repository = (await jsonRequest(fetchImpl, root, { token })).data;
  const branch = repository.default_branch;
  const protectionResponse = await jsonRequest(fetchImpl, `${root}/branches/${encoded(branch)}/protection`, { token, allow: [404] });
  const rulesets = (await jsonRequest(fetchImpl, `${root}/rulesets?includes_parents=true`, { token, allow: [404] })).data || [];
  const blockers = [];
  if (!repository.permissions?.admin) blockers.push("Repository administration permission is missing.");
  const conflictingRulesets = rulesets.filter((ruleset) => ruleset.enforcement === "active" && (ruleset.rules || []).some((rule) => rule.type === "required_status_checks"));
  if (conflictingRulesets.length > 0) blockers.push("An active ruleset manages required status checks; update it through the repository ruleset path instead of branch protection.");
  const existingContexts = protectionResponse.status === 404
    ? []
    : (protectionResponse.data.required_status_checks?.contexts || protectionResponse.data.required_status_checks?.checks?.map((check) => check.context) || []);
  const preflight = {
    status: blockers.length > 0 ? "blocked" : existingContexts.includes(checkName) ? "configured" : "needs-confirmation",
    owner,
    repo,
    branch,
    checkName,
    existingContexts,
    blockers,
    writeAttempted: false,
  };
  if (blockers.length > 0 || existingContexts.includes(checkName) || !confirm) return preflight;

  const contexts = [...new Set([...existingContexts, checkName])];
  if (protectionResponse.status === 404) {
    await jsonRequest(fetchImpl, `${root}/branches/${encoded(branch)}/protection`, {
      token,
      method: "PUT",
      body: { required_status_checks: { strict: true, contexts }, enforce_admins: false, required_pull_request_reviews: null, restrictions: null },
    });
  } else {
    await jsonRequest(fetchImpl, `${root}/branches/${encoded(branch)}/protection/required_status_checks`, {
      token,
      method: "PATCH",
      body: { strict: true, contexts },
    });
  }
  const verified = (await jsonRequest(fetchImpl, `${root}/branches/${encoded(branch)}/protection`, { token })).data;
  const verifiedContexts = verified.required_status_checks?.contexts || verified.required_status_checks?.checks?.map((check) => check.context) || [];
  if (!verifiedContexts.includes(checkName)) {
    throw new GovernanceError("GitHub required check write did not survive readback verification.", {
      code: "RG_GITHUB_ENFORCE_VERIFY",
      details: { checkName, verifiedContexts },
    });
  }
  return { ...preflight, status: "configured", writeAttempted: true, verifiedContexts };
}
