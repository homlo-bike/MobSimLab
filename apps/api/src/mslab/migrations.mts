/**
 * Forward migrations of the `.mslab` format (ADR-0021: code may break compatibility before 1.0, user data must
 * not). Each step upgrades the files of one format version to the next; `migrate` applies them in order until
 * the file is at the current version. A new format version adds its step here, a fixture of the old version in
 * `apps/api/test/fixtures/mslab/` and a test that reads it.
 *
 * Version 1.0.0 is the first format, so there are no steps yet. A file of an older minor version of the
 * current major (1.x) that no step names is already readable as it is: minor versions only add.
 */

/** One upgrade from `from` to `to`: takes the files (path → bytes) and returns the upgraded files. */
export interface MigrationStep {
  from: string;
  to: string;
  up(files: Map<string, Buffer>): Map<string, Buffer>;
}

/** The upgrade steps, oldest first. */
export const MIGRATIONS: readonly MigrationStep[] = [];

/**
 * Purpose: upgrade a file's contents step by step from its format version.
 * Output: the upgraded files and the version they are now at (the input version when no step applies).
 */
export function migrate(
  files: Map<string, Buffer>,
  version: string,
  steps: readonly MigrationStep[] = MIGRATIONS,
): { files: Map<string, Buffer>; version: string } {
  let current = version;
  let out = files;
  for (;;) {
    const step = steps.find((s) => s.from === current);
    if (!step) return { files: out, version: current };
    out = step.up(out);
    current = step.to;
  }
}
