/** Reading enough of a population file in the browser to offer its fields before it is uploaded. */

export type FileFormat = "geotiff" | "geojson" | "csv";

/** Purpose: the format of a file from its name, or null when it is none of the three. */
export function formatOf(name: string): FileFormat | null {
  const n = name.toLowerCase();
  if (n.endsWith(".tif") || n.endsWith(".tiff")) return "geotiff";
  if (n.endsWith(".geojson") || n.endsWith(".json")) return "geojson";
  if (n.endsWith(".csv") || n.endsWith(".txt") || n.endsWith(".tsv")) return "csv";
  return null;
}

/** Purpose: the column names of a CSV text's first line (comma, semicolon or tab; quotes removed). */
export function csvColumns(text: string): string[] {
  const line = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [",", ";", "\t"].reduce((best, d) =>
    line.split(d).length > line.split(best).length ? d : best,
  );
  return line
    .split(delimiter)
    .map((c) => c.trim().replace(/^"(.*)"$/, "$1"))
    .filter(Boolean);
}

/** Purpose: the property names of a GeoJSON text's features (the first 200), in order of first use. */
export function geojsonFields(text: string): string[] {
  try {
    const json = JSON.parse(text) as { features?: { properties?: Record<string, unknown> | null }[] };
    const out = new Set<string>();
    for (const f of (json.features ?? []).slice(0, 200))
      for (const k of Object.keys(f.properties ?? {})) out.add(k);
    return [...out];
  } catch {
    return [];
  }
}

/** Purpose: the first field whose name suggests people, or the first field. */
export function guessField(fields: string[], words: RegExp): string {
  return fields.find((f) => words.test(f)) ?? fields[0] ?? "";
}

/** Largest GeoJSON read in the browser to list its fields, bytes. */
export const MAX_FIELD_SCAN_BYTES = 50 * 1024 * 1024;

/** Purpose: the fields a file offers (CSV columns, GeoJSON properties); none for a GeoTIFF. */
export async function fieldsOf(file: Blob, format: FileFormat): Promise<string[]> {
  if (format === "csv") return csvColumns(await file.slice(0, 64 * 1024).text());
  if (format === "geojson" && file.size <= MAX_FIELD_SCAN_BYTES) return geojsonFields(await file.text());
  return [];
}
