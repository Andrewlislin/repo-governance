import { createHash } from "node:crypto";
import { runGit } from "./process.mjs";

export const DIFF_FINGERPRINT_ALGORITHM = "git-raw-z-v1-sha256";
export const DIFF_FINGERPRINT_DOMAIN = Buffer.from("repo-governance:diff-fingerprint:v1\0", "utf8");

export function diffFingerprint(repo, canonicalBaseSha, headSha) {
  const result = runGit([
    "-c", "core.quotepath=false",
    "-c", "diff.renames=false",
    "diff", "--raw", "-z", "--no-abbrev", "--no-renames", "--no-ext-diff", "--no-textconv",
    "--ignore-submodules=none", canonicalBaseSha, headSha,
    "--", ".", ":(exclude).repo-governance/waivers/**",
  ], { cwd: repo, binary: true });
  return createHash("sha256").update(DIFF_FINGERPRINT_DOMAIN).update(result.stdout).digest("hex");
}
