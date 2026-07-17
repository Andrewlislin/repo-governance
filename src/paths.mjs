import { homedir } from "node:os";
import { join } from "node:path";

export function governanceDataRoot(env = process.env, platform = process.platform) {
  if (platform === "win32") {
    if (!env.LOCALAPPDATA) throw new Error("LOCALAPPDATA is required on Windows.");
    return join(env.LOCALAPPDATA, "repo-governance");
  }
  const base = env.XDG_DATA_HOME || join(env.HOME || homedir(), ".local", "share");
  return join(base, "repo-governance");
}
