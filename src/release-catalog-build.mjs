import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GovernanceError } from "./errors.mjs";
import {
  CATALOG_PUBLIC_KEY_BASE64,
  parseReleaseCatalog,
  serializeReleaseCatalog,
  verifyReleaseCatalog,
} from "./release-catalog.mjs";

function signingKey(privateKeyPem) {
  try {
    const key = createPrivateKey(privateKeyPem);
    if (key.asymmetricKeyType !== "ed25519") throw new Error("wrong key type");
    return key;
  } catch {
    throw new GovernanceError("Release catalog signing requires an Ed25519 private key.", { code: "RG_CATALOG_KEY" });
  }
}

export function writeSignedReleaseCatalog({
  sourcePath,
  outputDirectory,
  version,
  commitSha,
  releasedAt,
  securityFix,
  privateKeyPem,
  publicKeyBase64 = CATALOG_PUBLIC_KEY_BASE64,
}) {
  const catalog = parseReleaseCatalog(readFileSync(sourcePath));
  const release = { version, commitSha, releasedAt, securityFix };
  const existing = catalog.releases.find((item) => item.version === version || item.commitSha === commitSha);
  if (existing && JSON.stringify(existing) !== JSON.stringify(release)) {
    throw new GovernanceError("The release version or commit SHA conflicts with catalog history.", { code: "RG_CATALOG_DUPLICATE" });
  }
  const nextCatalog = existing ? catalog : { schemaVersion: 1, releases: [...catalog.releases, release] };
  const catalogBytes = serializeReleaseCatalog(nextCatalog);
  const privateKey = signingKey(privateKeyPem);
  const derivedPublic = createPublicKey(privateKey).export({ format: "der", type: "spki" }).toString("base64");
  if (derivedPublic !== publicKeyBase64) {
    throw new GovernanceError("Release catalog private key does not match the pinned public key.", { code: "RG_CATALOG_KEY" });
  }
  const signatureBytes = Buffer.from(`${sign(null, catalogBytes, privateKey).toString("base64")}\n`);
  verifyReleaseCatalog(catalogBytes, signatureBytes, { publicKeyBase64 });
  mkdirSync(outputDirectory, { recursive: true });
  const catalogPath = join(outputDirectory, "release-catalog.json");
  const signaturePath = join(outputDirectory, "release-catalog.sig");
  writeFileSync(catalogPath, catalogBytes);
  writeFileSync(signaturePath, signatureBytes);
  return { catalogPath, signaturePath, catalog: nextCatalog };
}
