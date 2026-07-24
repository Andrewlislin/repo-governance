import { GovernanceError } from "./errors.mjs";
import { resolveCommit } from "./git.mjs";
import { runGit } from "./process.mjs";

const ZERO_SHA = "0".repeat(40);

function failure(message, code, details = {}) {
  throw new GovernanceError(message, { code, details });
}

function optionalCommit(repo, revision) {
  const result = runGit(["rev-parse", "--verify", `${revision}^{commit}`], { cwd: repo, allowFailure: true });
  return result.status === 0 ? result.stdout.trim() : null;
}

function assertRemote(repo, remote, remoteUrl) {
  const names = runGit(["remote"], { cwd: repo }).stdout.split(/\r?\n/).filter(Boolean);
  if (!names.includes(remote)) failure("Pre-push requires a configured named remote; URL-only or unknown remotes cannot resolve an offline canonical base.", "RG_PRE_PUSH_REMOTE", { remote });
  const configured = runGit(["remote", "get-url", "--push", remote], { cwd: repo, allowFailure: true }).stdout.trim();
  if (!configured || (remoteUrl && configured !== remoteUrl)) {
    failure("Pre-push remote name and URL do not match the configured push remote.", "RG_PRE_PUSH_REMOTE", { remote, remoteUrl, configured });
  }
}

export function parsePrePushInput(input) {
  if (!input.trim()) return [];
  return input.split(/\r?\n/).filter(Boolean).map((line, index) => {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 4) failure("Invalid pre-push stdin record; expected local ref, local SHA, remote ref, and remote SHA.", "RG_PRE_PUSH_INPUT", { line: index + 1 });
    const [localRef, localSha, remoteRef, remoteSha] = fields;
    for (const [name, sha] of [["localSha", localSha], ["remoteSha", remoteSha]]) {
      if (!/^[0-9a-f]{40}$/.test(sha)) failure(`Invalid ${name} in pre-push stdin.`, "RG_PRE_PUSH_INPUT", { line: index + 1, sha });
    }
    return { localRef, localSha, remoteRef, remoteSha };
  });
}

export function resolvePrePushBase(repo, { remote, record, defaultBranch }) {
  const defaultRef = `refs/heads/${defaultBranch}`;
  if (record.remoteRef === defaultRef && record.remoteSha !== ZERO_SHA) {
    const remoteCommit = optionalCommit(repo, record.remoteSha);
    if (remoteCommit) {
      return {
        baseSource: "pre-push-remote-sha",
        canonicalBaseInputSha: remoteCommit,
      };
    }
  }
  const trackingRef = `refs/remotes/${remote}/${defaultBranch}`;
  const trackingCommit = optionalCommit(repo, trackingRef);
  if (!trackingCommit) {
    failure(
      `Offline canonical base is unavailable. Run git fetch ${remote} ${defaultBranch}, then retry the push.`,
      "RG_GIT_HISTORY_INSUFFICIENT",
      { remote, defaultBranch, trackingRef },
    );
  }
  return {
    baseSource: "remote-tracking-default-branch",
    canonicalBaseInputSha: trackingCommit,
  };
}

export function resolvePrePushCandidates(repo, { remote, remoteUrl, input, defaultBranch }) {
  assertRemote(repo, remote, remoteUrl);
  const records = parsePrePushInput(input);
  const skipped = [];
  const grouped = new Map();
  for (const record of records) {
    if (record.localSha === ZERO_SHA) {
      skipped.push({ ref: record.remoteRef, reason: "delete" });
      continue;
    }
    const pushedCommitSha = optionalCommit(repo, record.localSha);
    if (!pushedCommitSha) {
      failure("Pushed object cannot be peeled to a commit.", "RG_PRE_PUSH_OBJECT", { ref: record.localRef, pushedObjectSha: record.localSha });
    }
    const base = resolvePrePushBase(repo, { remote, record, defaultBranch });
    const key = `${pushedCommitSha}\0${base.canonicalBaseInputSha}`;
    const resolved = {
      ref: record.localRef,
      remote,
      remoteRef: record.remoteRef,
      pushedObjectSha: record.localSha,
      pushedCommitSha,
      ...base,
    };
    const candidate = grouped.get(key);
    if (candidate) candidate.refs.push(resolved);
    else grouped.set(key, { ...resolved, refs: [resolved] });
  }
  return { candidates: [...grouped.values()], skipped };
}

export function resolveCiRevision(repo, { profile, event, githubSha }) {
  const consumer = profile.consumers.find((candidate) => candidate.type === "github-actions");
  if (!consumer) failure("Execution profile has no GitHub Actions consumer.", "RG_CI_EVENT", { profileId: profile.id });
  let eventCommitSha;
  let canonicalBaseInputSha;
  if (consumer.revisionSource === "pull-request-head") {
    eventCommitSha = event.pull_request?.head?.sha;
    canonicalBaseInputSha = event.pull_request?.base?.sha;
  } else if (consumer.revisionSource === "pull-request-merge") {
    eventCommitSha = githubSha;
    canonicalBaseInputSha = event.pull_request?.base?.sha;
  } else if (consumer.revisionSource === "push-event-sha") {
    eventCommitSha = githubSha || event.after;
    canonicalBaseInputSha = event.before;
  } else {
    failure("Unsupported CI revisionSource.", "RG_CI_EVENT", { revisionSource: consumer.revisionSource });
  }
  if (!/^[0-9a-f]{40}$/.test(eventCommitSha || "") || !/^[0-9a-f]{40}$/.test(canonicalBaseInputSha || "") || canonicalBaseInputSha === ZERO_SHA) {
    failure("CI event does not provide usable exact head and base commit SHAs.", "RG_CI_EVENT", {
      revisionSource: consumer.revisionSource,
      eventCommitSha: eventCommitSha || null,
      canonicalBaseInputSha: canonicalBaseInputSha || null,
    });
  }
  return {
    revisionSource: consumer.revisionSource,
    eventCommitSha: resolveCommit(repo, eventCommitSha),
    canonicalBaseInputSha: resolveCommit(repo, canonicalBaseInputSha),
  };
}

export function writeCanonicalBaseRef(repo, sha) {
  const canonicalBaseInputSha = resolveCommit(repo, sha);
  runGit(["update-ref", "refs/repo-governance/base", canonicalBaseInputSha], { cwd: repo });
  return { ref: "refs/repo-governance/base", canonicalBaseInputSha };
}
