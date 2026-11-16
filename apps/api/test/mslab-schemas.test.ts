import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FILE_SCHEMAS } from "../src/mslab/format.mts";
import { DRAWING_KINDS } from "../src/projects/drawings";

/**
 * The published JSON Schemas of the .mslab format (contracts/mslab/) and the drawing schemas the sandboxed
 * reader checks with (src/mslab/drawing-schemas.generated.json) must match the code: the hand-written file
 * schemas in format.mts and the editors' drawing outlines in drawings.ts. After changing either, run
 * `UPDATE_MSLAB_SCHEMAS=1 pnpm --filter @mobsimlab/api test mslab-schemas` and commit the files.
 */
const ROOT = join(__dirname, "..", "..", "..");
const CONTRACTS = join(ROOT, "contracts", "mslab");
const GENERATED = join(__dirname, "..", "src", "mslab", "drawing-schemas.generated.json");
const update = process.env.UPDATE_MSLAB_SCHEMAS === "1";

/** Purpose: the JSON Schema of one drawing kind's document, from its zod outline. */
function drawingSchema(kind: string, schema: z.ZodType): Record<string, unknown> {
  const s = z.toJSONSchema(schema, { target: "draft-2020-12", unrepresentable: "any" }) as Record<
    string,
    unknown
  >;
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://github.com/homlo-bike/MobSimLab/blob/main/contracts/mslab/drawings/${kind}.schema.json`,
    title: `Document of a "${kind}" drawing (data/${kind}.json, field doc)`,
    ...Object.fromEntries(Object.entries(s).filter(([k]) => k !== "$schema")),
  };
}

function expected(): Map<string, string> {
  const files = new Map<string, string>();
  const text = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
  for (const [name, schema] of Object.entries(FILE_SCHEMAS)) files.set(join(CONTRACTS, name), text(schema));
  const generated: Record<string, { schemaVersion: number; schema: unknown }> = {};
  for (const [kind, k] of Object.entries(DRAWING_KINDS)) {
    const schema = drawingSchema(kind, k.schema as z.ZodType);
    files.set(join(CONTRACTS, "drawings", `${kind}.schema.json`), text(schema));
    generated[kind] = { schemaVersion: k.schemaVersion, schema };
  }
  files.set(GENERATED, text(generated));
  return files;
}

describe("mslab schemas", () => {
  it("are published and match the code", () => {
    const files = expected();
    if (update) {
      mkdirSync(join(CONTRACTS, "drawings"), { recursive: true });
      for (const [path, content] of files) writeFileSync(path, content);
    }
    for (const [path, content] of files) {
      expect(existsSync(path), `${path} is missing; run with UPDATE_MSLAB_SCHEMAS=1`).toBe(true);
      expect(readFileSync(path, "utf8"), `${path} is out of date; run with UPDATE_MSLAB_SCHEMAS=1`).toBe(
        content,
      );
    }
    // No schema for a drawing kind that no longer exists.
    const kinds = readdirSync(join(CONTRACTS, "drawings")).map((f) => f.replace(/\.schema\.json$/, ""));
    expect(kinds.sort()).toEqual(Object.keys(DRAWING_KINDS).sort());
  });
});
