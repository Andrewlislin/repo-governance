export class GovernanceError extends Error {
  constructor(message, { code = "RG_CONFIG", exitCode = 2, details = {} } = {}) {
    super(message);
    this.name = "GovernanceError";
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

export function asFailure(error) {
  if (error instanceof GovernanceError) {
    return {
      ok: false,
      exitCode: error.exitCode,
      error: { code: error.code, message: error.message, details: error.details },
    };
  }
  return {
    ok: false,
    exitCode: 2,
    error: { code: "RG_INTERNAL", message: error instanceof Error ? error.message : String(error), details: {} },
  };
}
