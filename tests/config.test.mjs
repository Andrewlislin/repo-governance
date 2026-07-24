import assert from "node:assert/strict";
import test from "node:test";
import { validateConfig } from "../src/config.mjs";
import { baseConfig } from "./helpers.mjs";

test("configuration locks the fingerprint algorithm", () => {
  assert.throws(
    () => validateConfig(baseConfig({ diffFingerprintAlgorithm: "patch-text" }), { enforceEngine: false }),
    /git-raw-z-v1-sha256/,
  );
});

test("high-impact mappings may require alternatives or multiple independent categories", () => {
  const config = baseConfig({
    highImpactMappings: [{
      businessPaths: ["src/build/**"],
      requirements: [{ anyOf: ["command-contract"] }, { anyOf: ["build-verification"] }],
    }],
  });
  assert.equal(validateConfig(config, { enforceEngine: false }), config);
});

test("unknown mapped test category is a configuration error", () => {
  assert.throws(() => validateConfig(baseConfig({
    highImpactMappings: [{ businessPaths: ["src/api/**"], requirements: [{ anyOf: ["anything"] }] }],
  }), { enforceEngine: false }), /Unknown test category/);
});

test("execution contract structure rejects missing versions and embedded runtimes", () => {
  assert.throws(
    () => validateConfig(baseConfig({ executionContractVersion: undefined }), { enforceEngine: false }),
    /executionContractVersion/,
  );
  const config = baseConfig();
  config.executionProfiles[0].runtime = config.runtimes[0];
  assert.throws(() => validateConfig(config, { enforceEngine: false }), /runtimeId instead of an embedded runtime/);
});
