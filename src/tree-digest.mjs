import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function treeDigest(root) {
  const hash = createHash("sha256").update("repo-governance:tree-digest:v1\0");
  function visit(directory, prefix = "") {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)));
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(directory, entry.name);
      hash.update(relative).update("\0");
      if (entry.isDirectory()) visit(path, relative);
      else hash.update(readFileSync(path)).update("\0");
    }
  }
  visit(root);
  return hash.digest("hex");
}
