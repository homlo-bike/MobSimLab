import { Worker } from "node:worker_threads";

/**
 * Exact Maximal Covering Location Problem (Church & ReVelle 1974) for `suggest_stop_locations` (ADR-0035 §6),
 * solved with HiGHS (MIT licence, WebAssembly build `highs`). The solve runs in a worker thread so a long solve
 * never blocks the API, and stops at a time limit.
 *
 *   maximise   Σ w_i y_i
 *   subject to y_i ≤ Σ_{j covers i} x_j     for every demand point i
 *              Σ x_j ≤ k
 *              x_a + x_b ≤ 1                for candidates closer than the minimum spacing
 *              x_j ∈ {0, 1}, 0 ≤ y_i ≤ 1
 */

export interface CoveringInstance {
  weights: number[];
  candidates: number[];
  cover: number[][];
  conflicts: [number, number][];
}

export interface CoverSolution {
  /** Chosen candidates, indices into `instance.candidates`. */
  chosen: number[];
  /** Demand covered by the chosen candidates. */
  objective: number;
  /** HiGHS proved the choice optimal. */
  optimal: boolean;
  /** HiGHS model status. */
  status: string;
}

/** Purpose: the instance in CPLEX LP format, which HiGHS reads. Long sums are split over lines. */
export function lpModel(inst: CoveringInstance, k: number): string {
  const coveredBy: number[][] = inst.weights.map(() => []);
  inst.cover.forEach((pts, j) => pts.forEach((i) => coveredBy[i]!.push(j)));
  const lines: string[] = ["Maximize"];
  const wrap = (terms: string[]) => {
    const out: string[] = [];
    for (let i = 0; i < terms.length; i += 40) out.push(` ${terms.slice(i, i + 40).join(" ")}`);
    return out;
  };
  const obj = inst.weights.flatMap((w, i) => (w > 0 ? [`+ ${w} y${i}`] : []));
  lines.push(" obj:", ...wrap(obj.length ? obj : ["0 x0"]));
  lines.push("Subject To");
  coveredBy.forEach((js, i) => {
    lines.push(` c${i}: y${i}`, ...wrap(js.map((j) => `- x${j}`)), " <= 0");
  });
  lines.push(" k:", ...wrap(inst.candidates.map((_, j) => `+ x${j}`)), ` <= ${k}`);
  inst.conflicts.forEach(([a, b], n) => lines.push(` s${n}: x${a} + x${b} <= 1`));
  lines.push("Bounds");
  inst.weights.forEach((_, i) => lines.push(` 0 <= y${i} <= 1`));
  lines.push("Binary", ...wrap(inst.candidates.map((_, j) => `x${j}`)), "End");
  return lines.join("\n");
}

const WORKER = `
const { parentPort, workerData } = require("node:worker_threads");
require(workerData.highs)().then((h) => {
  try {
    const r = h.solve(workerData.model, {
      time_limit: workerData.timeLimitS,
      mip_rel_gap: 0,
      output_flag: false,
      threads: 1,
    });
    const chosen = [];
    for (const [name, c] of Object.entries(r.Columns)) {
      if (name[0] === "x" && c.Primal > 0.5) chosen.push(Number(name.slice(1)));
    }
    parentPort.postMessage({ status: r.Status, chosen });
  } catch (e) {
    parentPort.postMessage({ status: "error", error: String(e), chosen: [] });
  }
}, (e) => parentPort.postMessage({ status: "error", error: String(e), chosen: [] }));
`;

/**
 * Purpose: solve the covering instance exactly within the time limit.
 * Output: the best choice HiGHS found and whether it is proved optimal; `null` when HiGHS found no solution.
 * Side effects: runs a worker thread for at most the time limit plus a margin.
 */
export async function solveMaxCover(
  inst: CoveringInstance,
  k: number,
  timeLimitS: number,
): Promise<CoverSolution | null> {
  const model = lpModel(inst, k);
  const res = await new Promise<{ status: string; chosen: number[] }>((resolve) => {
    const w = new Worker(WORKER, {
      eval: true,
      workerData: { highs: require.resolve("highs"), model, timeLimitS },
    });
    const kill = setTimeout(
      () => {
        void w.terminate();
        resolve({ status: "worker timeout", chosen: [] });
      },
      (timeLimitS + 20) * 1000,
    );
    w.once("message", (m: { status: string; chosen: number[] }) => {
      clearTimeout(kill);
      void w.terminate();
      resolve(m);
    });
    w.once("error", (e) => {
      clearTimeout(kill);
      resolve({ status: `error: ${e.message}`, chosen: [] });
    });
  });
  if (res.chosen.length === 0) return null;
  const covered = new Set<number>();
  for (const j of res.chosen) for (const i of inst.cover[j] ?? []) covered.add(i);
  const objective = [...covered].reduce((a, i) => a + inst.weights[i]!, 0);
  return { chosen: res.chosen, objective, optimal: res.status === "Optimal", status: res.status };
}
