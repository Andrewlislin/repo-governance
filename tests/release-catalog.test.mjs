import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { writeSignedReleaseCatalog } from "../src/release-catalog-build.mjs";
import { preflightRepository } from "../src/preflight.mjs";
import {
  CATALOG_SIGNATURE_URL,
  CATALOG_URL,
  catalogCachePath,
  checkVersion,
  parseReleaseCatalog,
  readUpdateAdvisory,
  serializeReleaseCatalog,
  updateAdvisory,
  verifyReleaseCatalog,
} from "../src/release-catalog.mjs";
import { temporaryDirectory, write } from "./helpers.mjs";

function keys() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKey,
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }),
    publicKeyBase64: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
  };
}

function release(version, digit, day, securityFix = false) {
  return { version, commitSha: digit.repeat(40), releasedAt: `2026-07-${String(day).padStart(2, "0")}T00:00:00.000Z`, securityFix };
}

function catalog(...releases) {
  return { schemaVersion: 1, releases };
}

function signed(value, key) {
  const catalogBytes = serializeReleaseCatalog(value);
  const signatureBytes = Buffer.from(`${sign(null, catalogBytes, key.privateKey).toString("base64")}\n`);
  return { catalogBytes, signatureBytes };
}

function response(body, { status = 200, headers = {} } = {}) {
  const bytes = Buffer.from(body);
  const normalized = new Map(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
  return {
    status,
    headers: { get(name) { return normalized.get(name.toLowerCase()) || null; } },
    async arrayBuffer() { return bytes; },
  };
}

function fetchFor(catalogBytes, signatureBytes) {
  return async (url) => response(url.href === CATALOG_URL ? catalogBytes : signatureBytes);
}

function isolatedEnv() {
  const home = temporaryDirectory("repo-governance-catalog-home-");
  return { ...process.env, HOME: home, XDG_DATA_HOME: join(home, "data") };
}

test("catalog schema and deterministic bytes reject malformed, duplicate, and rollback histories", () => {
  const schema = JSON.parse(readFileSync(new URL("../schemas/release-catalog.schema.json", import.meta.url), "utf8"));
  assert.equal(schema.$id, "https://github.com/CoaseEdge/repo-governance/schemas/release-catalog.schema.json");
  assert.equal(schema.properties.releases.items.additionalProperties, false);
  const valid = catalog(release("1.0.0", "a", 1), release("1.1.0", "b", 2));
  assert.deepEqual(parseReleaseCatalog(serializeReleaseCatalog(valid)), valid);
  assert.throws(() => parseReleaseCatalog(Buffer.from(`${JSON.stringify(valid, null, 2)}\n`)), /deterministic format/);
  assert.throws(() => serializeReleaseCatalog(catalog(release("v1.0.0", "a", 1))), /invalid release record/);
  assert.throws(() => serializeReleaseCatalog(catalog(release("1.0.0", "a", 1), release("1.0.0", "b", 2))), /unique/);
  assert.throws(() => serializeReleaseCatalog(catalog(release("1.1.0", "a", 1), release("1.0.0", "b", 2))), /strictly increasing/);
});

test("Ed25519 detached signatures authenticate exact catalog bytes", () => {
  const key = keys();
  const value = catalog(release("1.0.0", "a", 1));
  const fixture = signed(value, key);
  assert.deepEqual(verifyReleaseCatalog(fixture.catalogBytes, fixture.signatureBytes, key), value);
  const tampered = Buffer.from(fixture.catalogBytes);
  tampered[tampered.length - 3] ^= 1;
  assert.throws(() => verifyReleaseCatalog(tampered, fixture.signatureBytes, key), /verification failed/);
  assert.throws(() => verifyReleaseCatalog(fixture.catalogBytes, Buffer.from("not-base64\n"), key), /format is invalid/);
});

test("version check follows only canonical redirects, verifies, and atomically caches the catalog", async () => {
  const env = isolatedEnv();
  const key = keys();
  const fixture = signed(catalog(
    release("1.0.0", "a", 1),
    release("1.1.0", "b", 2),
    release("1.2.0", "c", 3),
  ), key);
  const fetchImpl = async (url) => {
    if (url.pathname.includes("/latest/download/")) {
      return response("", { status: 302, headers: { location: url.pathname.endsWith(".json")
        ? "https://github.com/CoaseEdge/repo-governance/releases/download/v1.2.0/release-catalog.json"
        : "https://github.com/CoaseEdge/repo-governance/releases/download/v1.2.0/release-catalog.sig" } });
    }
    if (url.hostname === "github.com") {
      const filename = url.pathname.endsWith(".json") ? "release-catalog.json" : "release-catalog.sig";
      return response("", { status: 302, headers: { location: `https://release-assets.githubusercontent.com/github-production-release-asset/1303721975/fixture?response-content-disposition=attachment%3B%20filename%3D${filename}` } });
    }
    return response(url.search.includes("release-catalog.json") ? fixture.catalogBytes : fixture.signatureBytes);
  };
  const result = await checkVersion("1.0.0", { env, fetchImpl, publicKeyBase64: key.publicKeyBase64 });
  assert.equal(result.status, "verified");
  assert.equal(result.updateAdvisory.versionsBehind, 2);
  assert.equal(result.updateAdvisory.shouldWarn, true);
  assert.deepEqual(result.availableReleases.map((item) => item.version), ["1.1.0", "1.2.0"]);
  assert.match(result.recommendation, /explicitly/);
  assert.equal(existsSync(catalogCachePath(env)), true);
  assert.equal(readUpdateAdvisory("1.0.0", { env, publicKeyBase64: key.publicKeyBase64 }).catalogStatus, "cached");
  const unknown = await checkVersion("9.0.0", { env, fetchImpl, publicKeyBase64: key.publicKeyBase64 });
  assert.equal(unknown.catalogStatus, "current_unknown");
  assert.match(unknown.message, /not listed/);
  assert.match(unknown.recommendation, /engine identity/);
});

test("one normal release does not warn, while one security release does", () => {
  const ordinary = catalog(release("1.0.0", "a", 1), release("1.1.0", "b", 2));
  const security = catalog(release("1.0.0", "a", 1), release("1.1.0", "b", 2, true));
  assert.deepEqual(updateAdvisory(ordinary, "1.0.0", "cached"), {
    available: true,
    currentVersion: "1.0.0",
    latestVersion: "1.1.0",
    versionsBehind: 1,
    securityFixAvailable: false,
    shouldWarn: false,
    reason: "one_version_behind",
    catalogStatus: "cached",
  });
  assert.equal(updateAdvisory(security, "1.0.0", "cached").shouldWarn, true);
  assert.equal(updateAdvisory(ordinary, "9.0.0", "cached").catalogStatus, "current_unknown");
});

test("download failure uses verified cache and a damaged cache is never used", async () => {
  const env = isolatedEnv();
  const key = keys();
  const fixture = signed(catalog(release("1.0.0", "a", 1), release("1.1.0", "b", 2)), key);
  await checkVersion("1.0.0", { env, fetchImpl: fetchFor(fixture.catalogBytes, fixture.signatureBytes), publicKeyBase64: key.publicKeyBase64 });
  const cached = await checkVersion("1.0.0", { env, fetchImpl: async () => { throw new Error("offline"); }, publicKeyBase64: key.publicKeyBase64 });
  assert.equal(cached.status, "cached");
  assert.equal(cached.refreshError.code, "RG_CATALOG_FETCH");
  write(catalogCachePath(env), "damaged\n");
  const advisory = readUpdateAdvisory("1.0.0", { env, publicKeyBase64: key.publicKeyBase64 });
  assert.equal(advisory.available, false);
  assert.equal(advisory.catalogStatus, "invalid");
  const unavailable = await checkVersion("1.0.0", { env, fetchImpl: async () => { throw new Error("offline"); }, publicKeyBase64: key.publicKeyBase64 });
  assert.equal(unavailable.exitCode, 2);
  assert.equal(unavailable.catalogStatus, "invalid");
});

test("preflight reads a verified cache without changing it or performing a refresh", async () => {
  const env = isolatedEnv();
  const key = keys();
  const fixture = signed(catalog(
    release("1.0.0", "a", 1),
    release("1.1.0", "b", 2),
    release("1.2.0", "c", 3),
  ), key);
  await checkVersion("1.0.0", { env, fetchImpl: fetchFor(fixture.catalogBytes, fixture.signatureBytes), publicKeyBase64: key.publicKeyBase64 });
  const cachePath = catalogCachePath(env);
  const before = readFileSync(cachePath);
  const cwd = temporaryDirectory("repo-governance-catalog-preflight-");
  const report = preflightRepository(cwd, {
    env,
    identity: { version: "1.0.0", commitSha: "a".repeat(40) },
    catalogPublicKey: key.publicKeyBase64,
  });
  assert.equal(report.exitCode, 1);
  assert.equal(report.updateAdvisory.catalogStatus, "cached");
  assert.equal(report.updateAdvisory.versionsBehind, 2);
  assert.equal(report.updateAdvisory.shouldWarn, true);
  assert.deepEqual(readFileSync(cachePath), before);
});

test("verified cache prevents catalog rollback and an unlisted redirect host is rejected", async () => {
  const env = isolatedEnv();
  const key = keys();
  const newer = signed(catalog(release("1.0.0", "a", 1), release("2.0.0", "b", 2)), key);
  await checkVersion("1.0.0", { env, fetchImpl: fetchFor(newer.catalogBytes, newer.signatureBytes), publicKeyBase64: key.publicKeyBase64 });
  const before = readFileSync(catalogCachePath(env));
  const older = signed(catalog(release("1.0.0", "a", 1), release("1.1.0", "c", 2)), key);
  const rollback = await checkVersion("1.0.0", { env, fetchImpl: fetchFor(older.catalogBytes, older.signatureBytes), publicKeyBase64: key.publicKeyBase64 });
  assert.equal(rollback.status, "cached");
  assert.equal(rollback.refreshError.code, "RG_CATALOG_ROLLBACK");
  assert.deepEqual(readFileSync(catalogCachePath(env)), before);

  const newest = signed(catalog(
    release("1.0.0", "a", 1),
    release("2.0.0", "b", 2),
    release("3.0.0", "d", 3),
  ), key);
  const failedWrite = await checkVersion("1.0.0", {
    env,
    fetchImpl: fetchFor(newest.catalogBytes, newest.signatureBytes),
    publicKeyBase64: key.publicKeyBase64,
    failBeforeCacheRename: true,
  });
  assert.equal(failedWrite.status, "cached");
  assert.equal(failedWrite.refreshError.code, "RG_CATALOG_CACHE");
  assert.deepEqual(readFileSync(catalogCachePath(env)), before);

  const cleanEnv = isolatedEnv();
  const rejected = await checkVersion("1.0.0", {
    env: cleanEnv,
    publicKeyBase64: key.publicKeyBase64,
    fetchImpl: async () => response("", { status: 302, headers: { location: "https://example.com/release-catalog.json" } }),
  });
  assert.equal(rejected.exitCode, 2);
  assert.equal(rejected.refreshError.code, "RG_CATALOG_REDIRECT");
});

test("a slower concurrent refresh cannot overwrite a newer verified catalog", async () => {
  const env = isolatedEnv();
  const key = keys();
  const older = signed(catalog(release("1.0.0", "a", 1), release("1.1.0", "b", 2)), key);
  const newer = signed(catalog(release("1.0.0", "a", 1), release("2.0.0", "c", 3)), key);
  let releaseOlder;
  const olderGate = new Promise((resolvePromise) => { releaseOlder = resolvePromise; });
  const olderCheck = checkVersion("1.0.0", {
    env,
    publicKeyBase64: key.publicKeyBase64,
    fetchImpl: async (url) => {
      await olderGate;
      return response(url.href === CATALOG_URL ? older.catalogBytes : older.signatureBytes);
    },
  });
  const newerCheck = await checkVersion("1.0.0", {
    env,
    publicKeyBase64: key.publicKeyBase64,
    fetchImpl: fetchFor(newer.catalogBytes, newer.signatureBytes),
  });
  assert.equal(newerCheck.status, "verified");
  releaseOlder();
  const staleCheck = await olderCheck;
  assert.equal(staleCheck.status, "cached");
  assert.equal(staleCheck.refreshError.code, "RG_CATALOG_ROLLBACK");
  assert.equal(staleCheck.updateAdvisory.latestVersion, "2.0.0");
});

test("release builder appends history, signs exact bytes, and rejects a mismatched private key", () => {
  const directory = temporaryDirectory("repo-governance-catalog-build-");
  const sourcePath = join(directory, "source.json");
  write(sourcePath, serializeReleaseCatalog(catalog(release("1.0.0", "a", 1))));
  const key = keys();
  const outputDirectory = join(directory, "output");
  const result = writeSignedReleaseCatalog({
    sourcePath,
    outputDirectory,
    version: "1.1.0",
    commitSha: "b".repeat(40),
    releasedAt: "2026-07-02T00:00:00.000Z",
    securityFix: true,
    privateKeyPem: key.privateKeyPem,
    publicKeyBase64: key.publicKeyBase64,
  });
  assert.equal(result.catalog.releases.length, 2);
  assert.deepEqual(
    verifyReleaseCatalog(readFileSync(result.catalogPath), readFileSync(result.signaturePath), { publicKeyBase64: key.publicKeyBase64 }),
    result.catalog,
  );
  assert.throws(() => writeSignedReleaseCatalog({
    sourcePath,
    outputDirectory,
    version: "1.1.0",
    commitSha: "b".repeat(40),
    releasedAt: "2026-07-02T00:00:00.000Z",
    securityFix: true,
    privateKeyPem: keys().privateKeyPem,
    publicKeyBase64: key.publicKeyBase64,
  }), /does not match the pinned public key/);
});
