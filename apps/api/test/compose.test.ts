import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(__dirname, "..", "..", "..");

describe("compose.yaml", () => {
  it("carries the same init script as db/init/10-roles.sh", () => {
    const compose = readFileSync(join(REPO, "compose.yaml"), "utf8");
    const start = compose.indexOf("  db-init:\n");
    expect(start).toBeGreaterThan(0);
    const block = compose.slice(compose.indexOf("    content: |\n", start) + "    content: |\n".length);
    const lines: string[] = [];
    for (const line of block.split("\n")) {
      if (line !== "" && !line.startsWith("      ")) break;
      lines.push(line.slice(6));
    }
    const inlined = lines.join("\n").replace(/\$\$/g, "$").trimEnd();
    expect(inlined).toBe(readFileSync(join(REPO, "db", "init", "10-roles.sh"), "utf8").trimEnd());
  });
});
