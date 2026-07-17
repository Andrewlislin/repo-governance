import assert from "node:assert/strict";
import test from "node:test";
import { githubEnforce } from "../src/github/enforce.mjs";

function response(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

function fixture({ admin = true, rulesets = [], readback = ["repo-governance"] } = {}) {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/repos/acme/project")) return response(200, { default_branch: "main", permissions: { admin } });
    if (url.includes("/rulesets?")) return response(200, rulesets);
    if (url.endsWith("/protection") && options.method === "GET") {
      const isReadback = calls.filter((call) => call.url.endsWith("/protection") && call.options.method === "GET").length > 1;
      return response(200, { required_status_checks: { contexts: isReadback ? readback : [] } });
    }
    if (url.endsWith("/required_status_checks") && options.method === "PATCH") return response(200, {});
    throw new Error(`Unexpected request: ${options.method} ${url}`);
  };
  return { request, calls };
}

test("permission preflight blocks without attempting a write", async () => {
  const { request, calls } = fixture({ admin: false });
  const result = await githubEnforce({ owner: "acme", repo: "project", checkName: "repo-governance", token: "test", confirm: true, fetchImpl: request });
  assert.equal(result.status, "blocked");
  assert.equal(calls.some((call) => call.options.method !== "GET"), false);
});

test("active required-check ruleset reports a manual conflict", async () => {
  const rulesets = [{ enforcement: "active", rules: [{ type: "required_status_checks" }] }];
  const { request } = fixture({ rulesets });
  const result = await githubEnforce({ owner: "acme", repo: "project", checkName: "repo-governance", token: "test", confirm: true, fetchImpl: request });
  assert.equal(result.status, "blocked");
  assert.match(result.blockers[0], /ruleset/);
});

test("capable preflight remains read-only until explicit confirmation", async () => {
  const { request, calls } = fixture();
  const result = await githubEnforce({ owner: "acme", repo: "project", checkName: "repo-governance", token: "test", fetchImpl: request });
  assert.equal(result.status, "needs-confirmation");
  assert.equal(calls.some((call) => call.options.method !== "GET"), false);
});

test("confirmed write is reported only after matching readback", async () => {
  const { request } = fixture();
  const result = await githubEnforce({ owner: "acme", repo: "project", checkName: "repo-governance", token: "test", confirm: true, fetchImpl: request });
  assert.equal(result.status, "configured");
  assert.equal(result.writeAttempted, true);
});

test("readback mismatch never reports success", async () => {
  const { request } = fixture({ readback: [] });
  await assert.rejects(() => githubEnforce({ owner: "acme", repo: "project", checkName: "repo-governance", token: "test", confirm: true, fetchImpl: request }), /did not survive readback/);
});
