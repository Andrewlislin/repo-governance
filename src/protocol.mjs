export const PRE_PUSH_PROTOCOL_VERSION = 1;
export const SUPPORTED_EXECUTION_CONTRACT_VERSIONS = Object.freeze([1]);

export function supportsExecutionContract(manifest, version) {
  return manifest.prePushProtocolVersion >= PRE_PUSH_PROTOCOL_VERSION
    && Array.isArray(manifest.supportedExecutionContractVersions)
    && manifest.supportedExecutionContractVersions.includes(version);
}
