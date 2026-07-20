import { createPublicKey, verify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { GovernanceError } from "./errors.mjs";
import { governanceDataRoot } from "./paths.mjs";

export const CATALOG_PUBLIC_KEY_BASE64 = "MCowBQYDK2VwAyEA1sKeer2E9yIKIXVxOca+4e1ltW8DinhDIAlsRH0+rBM=";
export const CATALOG_URL = "https://github.com/CoaseEdge/repo-governance/releases/latest/download/release-catalog.json";
export const CATALOG_SIGNATURE_URL = "https://github.com/CoaseEdge/repo-governance/releases/latest/download/release-catalog.sig";

const MAX_REDIRECTS = 5;
const MAX_CATALOG_BYTES = 1024 * 1024;
const GITHUB_REPOSITORY_ASSET_ID = "1303721975";
const CACHE_LOCK_TIMEOUT_MS = 2_000;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function semverParts(value) {
  const match = String(value).match(SEMVER);
  return match ? { core: match.slice(1, 4).map(BigInt), prerelease: match[4]?.split(".") || [] } : null;
}

export function compareSemver(left, right) {
  const a = semverParts(left);
  const b = semverParts(right);
  if (!a || !b) throw new GovernanceError("Release catalog contains an invalid SemVer version.", { code: "RG_CATALOG_SCHEMA" });
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] < b.core[index] ? -1 : 1;
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1;
  const count = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < count; index += 1) {
    if (a.prerelease[index] === undefined || b.prerelease[index] === undefined) return a.prerelease[index] === undefined ? -1 : 1;
    if (a.prerelease[index] === b.prerelease[index]) continue;
    const aNumeric = /^\d+$/.test(a.prerelease[index]);
    const bNumeric = /^\d+$/.test(b.prerelease[index]);
    if (aNumeric && bNumeric) {
      const aNumber = BigInt(a.prerelease[index]);
      const bNumber = BigInt(b.prerelease[index]);
      if (aNumber !== bNumber) return aNumber < bNumber ? -1 : 1;
      continue;
    }
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return a.prerelease[index].localeCompare(b.prerelease[index]);
  }
  return 0;
}

function exactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

export function validateReleaseCatalog(catalog) {
  if (!exactKeys(catalog, ["schemaVersion", "releases"]) || catalog.schemaVersion !== 1 || !Array.isArray(catalog.releases) || catalog.releases.length === 0) {
    throw new GovernanceError("Release catalog schema is invalid.", { code: "RG_CATALOG_SCHEMA" });
  }
  const versions = new Set();
  const commits = new Set();
  let previous = null;
  let previousReleasedAt = null;
  for (const release of catalog.releases) {
    if (
      !exactKeys(release, ["version", "commitSha", "releasedAt", "securityFix"])
      || !semverParts(release.version)
      || !/^[0-9a-f]{40}$/.test(release.commitSha || "")
      || typeof release.securityFix !== "boolean"
      || typeof release.releasedAt !== "string"
      || !Number.isFinite(Date.parse(release.releasedAt))
      || new Date(release.releasedAt).toISOString() !== release.releasedAt
    ) throw new GovernanceError("Release catalog contains an invalid release record.", { code: "RG_CATALOG_SCHEMA" });
    if (versions.has(release.version) || commits.has(release.commitSha)) {
      throw new GovernanceError("Release catalog versions and commit SHAs must be unique.", { code: "RG_CATALOG_DUPLICATE" });
    }
    if (previous && compareSemver(previous.version, release.version) >= 0) {
      throw new GovernanceError("Release catalog versions must be strictly increasing.", { code: "RG_CATALOG_ROLLBACK" });
    }
    if (previousReleasedAt && Date.parse(previousReleasedAt) >= Date.parse(release.releasedAt)) {
      throw new GovernanceError("Release catalog timestamps must be strictly increasing.", { code: "RG_CATALOG_ROLLBACK" });
    }
    versions.add(release.version);
    commits.add(release.commitSha);
    previous = release;
    previousReleasedAt = release.releasedAt;
  }
  return catalog;
}

export function serializeReleaseCatalog(catalog) {
  validateReleaseCatalog(catalog);
  return Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    releases: catalog.releases.map(({ version, commitSha, releasedAt, securityFix }) => ({ version, commitSha, releasedAt, securityFix })),
  })}\n`);
}

export function parseReleaseCatalog(bytes) {
  const buffer = Buffer.from(bytes);
  if (buffer.length === 0 || buffer.length > MAX_CATALOG_BYTES) throw new GovernanceError("Release catalog has an invalid size.", { code: "RG_CATALOG_SCHEMA" });
  let catalog;
  try {
    catalog = JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new GovernanceError("Release catalog is not valid JSON.", { code: "RG_CATALOG_SCHEMA" });
  }
  validateReleaseCatalog(catalog);
  if (!buffer.equals(serializeReleaseCatalog(catalog))) {
    throw new GovernanceError("Release catalog bytes are not in the deterministic format.", { code: "RG_CATALOG_FORMAT" });
  }
  return catalog;
}

function publicKey(base64 = CATALOG_PUBLIC_KEY_BASE64) {
  try {
    const key = createPublicKey({ key: Buffer.from(base64, "base64"), format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ed25519") throw new Error("wrong key type");
    return key;
  } catch {
    throw new GovernanceError("The pinned release catalog public key is invalid.", { code: "RG_CATALOG_KEY" });
  }
}

export function verifyReleaseCatalog(catalogBytes, signatureBytes, { publicKeyBase64 = CATALOG_PUBLIC_KEY_BASE64 } = {}) {
  const signatureText = Buffer.from(signatureBytes).toString("utf8");
  if (!/^[A-Za-z0-9+/]{86}==\n$/.test(signatureText)) {
    throw new GovernanceError("Release catalog detached signature format is invalid.", { code: "RG_CATALOG_SIGNATURE" });
  }
  const signature = Buffer.from(signatureText.trimEnd(), "base64");
  if (signature.length !== 64 || !verify(null, Buffer.from(catalogBytes), publicKey(publicKeyBase64), signature)) {
    throw new GovernanceError("Release catalog detached signature verification failed.", { code: "RG_CATALOG_SIGNATURE" });
  }
  return parseReleaseCatalog(catalogBytes);
}

export function catalogCachePath(env = process.env, platform = process.platform) {
  return join(governanceDataRoot(env, platform), "release-catalog-cache.json");
}

export function readVerifiedCatalogCache({ env = process.env, platform = process.platform, publicKeyBase64 = CATALOG_PUBLIC_KEY_BASE64 } = {}) {
  const path = catalogCachePath(env, platform);
  if (!existsSync(path)) return { status: "missing", path, catalog: null };
  try {
    const envelope = JSON.parse(readFileSync(path, "utf8"));
    if (!exactKeys(envelope, ["schemaVersion", "source", "catalogBase64", "signatureBase64"]) || envelope.schemaVersion !== 1 || envelope.source !== CATALOG_URL) throw new Error("invalid envelope");
    const catalogBytes = Buffer.from(envelope.catalogBase64, "base64");
    const signatureBytes = Buffer.from(envelope.signatureBase64, "base64");
    if (catalogBytes.toString("base64") !== envelope.catalogBase64 || signatureBytes.toString("base64") !== envelope.signatureBase64) throw new Error("non-canonical base64");
    return { status: "verified", path, catalog: verifyReleaseCatalog(catalogBytes, signatureBytes, { publicKeyBase64 }), catalogBytes, signatureBytes };
  } catch {
    return { status: "invalid", path, catalog: null };
  }
}

function writeVerifiedCatalogCache(catalogBytes, signatureBytes, { env, platform, publicKeyBase64, failBeforeRename = false }) {
  verifyReleaseCatalog(catalogBytes, signatureBytes, { publicKeyBase64 });
  const path = catalogCachePath(env, platform);
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeFileSync(temporary, `${JSON.stringify({
      schemaVersion: 1,
      source: CATALOG_URL,
      catalogBase64: Buffer.from(catalogBytes).toString("base64"),
      signatureBase64: Buffer.from(signatureBytes).toString("base64"),
    }, null, 2)}\n`, { flag: "wx" });
    if (failBeforeRename) throw new GovernanceError("Injected release catalog cache write failure.", { code: "RG_CATALOG_CACHE" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
  return path;
}

function withCatalogCacheLock({ env, platform }, operation) {
  const path = catalogCachePath(env, platform);
  const lock = `${path}.lock`;
  mkdirSync(dirname(path), { recursive: true });
  const started = Date.now();
  while (true) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() - started >= CACHE_LOCK_TIMEOUT_MS) {
        throw new GovernanceError("Release catalog cache is locked by another process; retry after it finishes.", { code: "RG_CATALOG_CACHE" });
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  try {
    return operation();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

function storeVerifiedCatalog(catalog, catalogBytes, signatureBytes, options) {
  return withCatalogCacheLock(options, () => {
    const current = readVerifiedCatalogCache(options);
    if (current.catalog && compareSemver(catalog.releases.at(-1).version, current.catalog.releases.at(-1).version) < 0) {
      throw new GovernanceError("Downloaded release catalog is older than the verified cache.", { code: "RG_CATALOG_ROLLBACK" });
    }
    return writeVerifiedCatalogCache(catalogBytes, signatureBytes, options);
  });
}

function unavailable(currentVersion, catalogStatus, reason, latestVersion = null) {
  return {
    available: false,
    currentVersion,
    latestVersion,
    versionsBehind: 0,
    securityFixAvailable: false,
    shouldWarn: false,
    reason,
    catalogStatus,
  };
}

export function updateAdvisory(catalog, currentVersion, catalogStatus) {
  if (!catalog) return unavailable(currentVersion, catalogStatus, `catalog_${catalogStatus}`);
  const latestVersion = catalog.releases.at(-1).version;
  const currentIndex = catalog.releases.findIndex((release) => release.version === currentVersion);
  if (currentIndex === -1) return unavailable(currentVersion, "current_unknown", "current_version_not_in_catalog", latestVersion);
  const later = catalog.releases.slice(currentIndex + 1);
  const versionsBehind = later.length;
  const securityFixAvailable = later.some((release) => release.securityFix);
  const shouldWarn = securityFixAvailable || versionsBehind >= 2;
  return {
    available: versionsBehind > 0,
    currentVersion,
    latestVersion,
    versionsBehind,
    securityFixAvailable,
    shouldWarn,
    reason: versionsBehind === 0
      ? "up_to_date"
      : securityFixAvailable
        ? "security_fix_available"
        : shouldWarn
          ? "multiple_versions_behind"
          : "one_version_behind",
    catalogStatus,
  };
}

export function readUpdateAdvisory(currentVersion, options = {}) {
  try {
    const cached = readVerifiedCatalogCache(options);
    return updateAdvisory(cached.catalog, currentVersion, cached.status === "verified" ? "cached" : cached.status);
  } catch {
    return unavailable(currentVersion, "invalid", "catalog_invalid");
  }
}

function validateDownloadUrl(value, expectedFile) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new GovernanceError("Release catalog redirect URL is invalid.", { code: "RG_CATALOG_REDIRECT" });
  }
  if (url.protocol !== "https:" || url.username || url.password) throw new GovernanceError("Release catalog downloads require HTTPS without URL credentials.", { code: "RG_CATALOG_REDIRECT" });
  if (url.hostname === "github.com") {
    const escaped = expectedFile.replace(".", "\\.");
    if (!new RegExp(`^/CoaseEdge/repo-governance/releases/(?:latest/download|download/[^/]+)/${escaped}$`).test(url.pathname)) {
      throw new GovernanceError("Release catalog GitHub path is outside the canonical repository boundary.", { code: "RG_CATALOG_REDIRECT" });
    }
  } else if (url.hostname === "release-assets.githubusercontent.com") {
    const disposition = url.searchParams.get("response-content-disposition") || "";
    const filename = expectedFile.replace(".", "\\.");
    if (!new RegExp(`^/github-production-release-asset/${GITHUB_REPOSITORY_ASSET_ID}/[^/]+$`).test(url.pathname) || !new RegExp(`filename="?${filename}"?(?:;|$)`).test(disposition)) {
      throw new GovernanceError("Release catalog asset redirect is outside the allowed path boundary.", { code: "RG_CATALOG_REDIRECT" });
    }
  } else {
    throw new GovernanceError("Release catalog redirect host is not allowed.", { code: "RG_CATALOG_REDIRECT" });
  }
  return url;
}

async function download(initialUrl, expectedFile, fetchImpl) {
  let url = validateDownloadUrl(initialUrl, expectedFile);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    let response;
    try {
      response = await fetchImpl(url, { redirect: "manual", headers: { accept: "application/octet-stream", "user-agent": "repo-governance-version-check" } });
    } catch (error) {
      throw new GovernanceError(`Unable to download the release catalog: ${error.message}`, { code: "RG_CATALOG_FETCH" });
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirect === MAX_REDIRECTS) throw new GovernanceError("Release catalog exceeded the redirect limit.", { code: "RG_CATALOG_REDIRECT" });
      const location = response.headers.get("location");
      if (!location) throw new GovernanceError("Release catalog redirect omitted Location.", { code: "RG_CATALOG_REDIRECT" });
      url = validateDownloadUrl(new URL(location, url).href, expectedFile);
      continue;
    }
    if (response.status !== 200) throw new GovernanceError(`Release catalog download returned HTTP ${response.status}.`, { code: "RG_CATALOG_FETCH" });
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_CATALOG_BYTES) throw new GovernanceError("Release catalog download is too large.", { code: "RG_CATALOG_FETCH" });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_CATALOG_BYTES) throw new GovernanceError("Release catalog download has an invalid size.", { code: "RG_CATALOG_FETCH" });
    return bytes;
  }
  throw new GovernanceError("Release catalog redirect handling failed.", { code: "RG_CATALOG_REDIRECT" });
}

function publicFailure(error) {
  return { code: error?.code || "RG_CATALOG_FETCH", message: error?.message || String(error) };
}

function releasesAhead(catalog, currentVersion) {
  const index = catalog.releases.findIndex((release) => release.version === currentVersion);
  return index === -1 ? [] : catalog.releases.slice(index + 1);
}

export async function checkVersion(currentVersion, {
  env = process.env,
  platform = process.platform,
  fetchImpl = globalThis.fetch,
  publicKeyBase64 = CATALOG_PUBLIC_KEY_BASE64,
  failBeforeCacheRename = false,
} = {}) {
  try {
    if (typeof fetchImpl !== "function") throw new GovernanceError("This runtime does not provide HTTPS fetch.", { code: "RG_CATALOG_FETCH" });
    const [catalogBytes, signatureBytes] = await Promise.all([
      download(CATALOG_URL, "release-catalog.json", fetchImpl),
      download(CATALOG_SIGNATURE_URL, "release-catalog.sig", fetchImpl),
    ]);
    const catalog = verifyReleaseCatalog(catalogBytes, signatureBytes, { publicKeyBase64 });
    const cachePath = storeVerifiedCatalog(catalog, catalogBytes, signatureBytes, {
      env,
      platform,
      publicKeyBase64,
      failBeforeRename: failBeforeCacheRename,
    });
    const advisory = updateAdvisory(catalog, currentVersion, "verified");
    return {
      command: "version check",
      ok: true,
      status: "verified",
      exitCode: 0,
      catalogStatus: advisory.catalogStatus,
      cachePath,
      availableReleases: releasesAhead(catalog, currentVersion),
      recommendation: advisory.available
        ? "Review the verified releases, then install a verified bundle explicitly if you choose to update."
        : advisory.catalogStatus === "current_unknown"
          ? "Verify the installed engine identity because its version is not present in the signed catalog."
          : null,
      updateAdvisory: advisory,
      message: advisory.catalogStatus === "current_unknown"
        ? `Verified release catalog, but ${currentVersion} is not listed; update status is unknown.`
        : advisory.available
          ? `Verified release catalog: ${currentVersion} can update to ${advisory.latestVersion}. No update was downloaded.`
          : `Verified release catalog: ${currentVersion} is current.`,
    };
  } catch (error) {
    const fallback = readVerifiedCatalogCache({ env, platform, publicKeyBase64 });
    if (fallback.catalog) {
      const advisory = updateAdvisory(fallback.catalog, currentVersion, "cached");
      return {
        command: "version check",
        ok: true,
        status: "cached",
        exitCode: 0,
        catalogStatus: "cached",
        cachePath: fallback.path,
        availableReleases: releasesAhead(fallback.catalog, currentVersion),
        recommendation: advisory.available ? "Review the cached releases, then run version check again before explicitly installing a verified bundle." : null,
        refreshError: publicFailure(error),
        updateAdvisory: advisory,
        message: "Catalog refresh failed; using the previously verified cache. No update was downloaded.",
      };
    }
    const advisory = unavailable(currentVersion, fallback.status, `catalog_${fallback.status}`);
    return {
      command: "version check",
      ok: false,
      status: "unavailable",
      exitCode: 2,
      catalogStatus: fallback.status,
      cachePath: fallback.path,
      availableReleases: [],
      recommendation: "Run version check again when the canonical GitHub release catalog is reachable.",
      refreshError: publicFailure(error),
      updateAdvisory: advisory,
      message: "No verified release catalog is available; version status could not be determined.",
    };
  }
}
