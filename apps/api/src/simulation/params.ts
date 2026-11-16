import { z } from "zod";

/**
 * Settings of simulation runs, shared by the runs API (runs.controller.ts) and the agent tools (ADR-0035 §7):
 * the rail capacity run's `CapacityParams` (crates/rail-sim/src/capacity.rs) and the design of a settings sweep
 * (worker/src/mobsim_worker/jobs/sweep.py).
 */

const DAY = 48 * 3600;
const seconds = z.number().finite().min(0).max(DAY);
const share = z.number().finite().min(0).max(1);
const count = z.number().int().min(0).max(100);
const seed = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/** The settings a sweep may vary, with their checks. The period (`from_s`, `to_s`) stays fixed. */
export const SWEEP_PARAMS = {
  warmup_s: seconds,
  recovery_s: seconds,
  min_buffer_s: seconds,
  occupancy_limit_share: share,
  spare_share: share,
  late_threshold_s: seconds,
  stability_runs: count,
  delayed_share: share,
  primary_delay_mean_s: seconds,
  primary_delay_max_s: seconds,
  residual_delay_s: seconds,
  seed,
} as const;
export type SweepParam = keyof typeof SWEEP_PARAMS;
export const SWEEP_PARAM_IDS = Object.keys(SWEEP_PARAMS) as [SweepParam, ...SweepParam[]];

/** Settings that only take whole numbers; a Latin hypercube rounds them. */
export const INTEGER_PARAMS: readonly SweepParam[] = ["stability_runs", "seed"];

/** The project's signalling and driving values (`Signalling` of crates/rail-sim/src/capacity.rs). */
const positive = z.number().finite().min(0).max(100_000);
export const signallingParams = z.strictObject(
  Object.fromEntries(
    [
      "route_setting_s",
      "sight_reaction_s",
      "release_s",
      "sighting_m",
      "overlap_release_s",
      "approach_release_s",
      "barrier_closing_s",
      "signal_closing_s",
      "moving_block_margin_m",
      "supervision_tolerance_kmh",
      "emergency_brake_factor",
      "ato_brake_share",
      "terminal_separation_s",
    ].map((k) => [k, positive.optional()]),
  ),
);

/** `CapacityParams` of crates/rail-sim/src/capacity.rs. Unknown settings are refused. */
export const capacityParams = z
  .strictObject({
    from_s: seconds,
    to_s: seconds,
    ...Object.fromEntries(Object.entries(SWEEP_PARAMS).map(([k, v]) => [k, v.optional()])),
    signalling: signallingParams.optional(),
  })
  .refine((p) => p.to_s > p.from_s, "the period must end after it starts") as z.ZodType<CapacitySettings>;

/** The capacity run's settings: the period, and any other setting (missing ones take the kernel's defaults). */
export type CapacitySettings = { from_s: number; to_s: number } & Partial<Record<SweepParam, number>> & {
    signalling?: Record<string, number>;
  };

/**
 * What a sweep can measure for each variant, from the capacity run's result, and which way is better. The
 * worker computes all of them; the Pareto front uses the ones the sweep names as objectives.
 */
export const SWEEP_METRICS = {
  verdict_rank: {
    better: "lower",
    meaning:
      "the run's overall verdict as a rank: 0 works, 1 near the limit, 2 over the limit, 3 delays pile up, 4 not enough capacity",
  },
  vehicles: { better: "lower", meaning: "trains needed including the reserve (fleet.vehicles)" },
  peak_out: { better: "lower", meaning: "trains out at the busiest moment (fleet.peak_out)" },
  unplaced: { better: "lower", meaning: "trips of the period that could not be placed, all lines" },
  max_consumption: {
    better: "lower",
    meaning: "highest capacity consumption of any line (UIC 406 share of the period)",
  },
  min_punctuality: { better: "higher", meaning: "lowest punctuality of any line without primary delays" },
  min_disturbed_punctuality: {
    better: "higher",
    meaning: "lowest punctuality of any line in the stability test with random primary delays",
  },
  max_knock_on_s: { better: "lower", meaning: "largest knock-on delay of any line, s" },
  max_residual_delay_s: {
    better: "lower",
    meaning: "largest mean delay left at the end of the recovery time, any line, s",
  },
} as const;
export type SweepMetric = keyof typeof SWEEP_METRICS;
export const SWEEP_METRIC_IDS = Object.keys(SWEEP_METRICS) as [SweepMetric, ...SweepMetric[]];

/** Most variants one sweep may run: each variant is a full capacity run with its stability test. */
export const MAX_SWEEP_VARIANTS = 200;

const gridParam = z.strictObject({
  name: z.enum(SWEEP_PARAM_IDS),
  values: z.array(z.number().finite()).min(1).max(MAX_SWEEP_VARIANTS),
});
const rangeParam = z.strictObject({
  name: z.enum(SWEEP_PARAM_IDS),
  min: z.number().finite(),
  max: z.number().finite(),
});

/**
 * How a sweep varies the settings: every combination of the listed values (a full grid), or a Latin
 * hypercube (McKay, Beckman & Conover 1979) of `samples` variants over ranges, drawn with a seed so the same
 * sweep gives the same variants.
 */
export const sweepDesign = z
  .discriminatedUnion("design", [
    z.strictObject({ design: z.literal("grid"), parameters: z.array(gridParam).min(1).max(4) }),
    z.strictObject({
      design: z.literal("latin_hypercube"),
      parameters: z.array(rangeParam).min(1).max(8),
      samples: z.number().int().min(2).max(MAX_SWEEP_VARIANTS),
      seed: seed.default(1),
    }),
  ])
  .superRefine((d, ctx) => {
    const names = d.parameters.map((p) => p.name);
    if (new Set(names).size !== names.length)
      ctx.addIssue({ code: "custom", message: "each setting may be varied only once" });
    for (const p of d.parameters) {
      const check = SWEEP_PARAMS[p.name];
      const vals = "values" in p ? p.values : [p.min, p.max];
      for (const v of vals) {
        const r = check.safeParse(v);
        if (!r.success)
          ctx.addIssue({
            code: "custom",
            message: `${p.name}: ${v} is out of range (${r.error.issues[0]?.message})`,
          });
      }
      if ("min" in p && p.min > p.max)
        ctx.addIssue({ code: "custom", message: `${p.name}: min is above max` });
    }
    if (d.design === "grid") {
      const n = d.parameters.reduce((a, p) => a * p.values.length, 1);
      if (n > MAX_SWEEP_VARIANTS)
        ctx.addIssue({
          code: "custom",
          message: `the grid has ${n} variants; at most ${MAX_SWEEP_VARIANTS} are allowed`,
        });
    }
  });
export type SweepDesign = z.infer<typeof sweepDesign>;

/** Purpose: how many variants a sweep design runs. */
export function variantCount(d: SweepDesign): number {
  return d.design === "grid" ? d.parameters.reduce((a, p) => a * p.values.length, 1) : d.samples;
}
