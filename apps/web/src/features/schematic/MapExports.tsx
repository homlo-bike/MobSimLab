import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n/i18n";
import { engineErrorText } from "../../i18n/engine";
import type { PluginLineInput } from "../journey-planner/network";
import type { Network, RailEngineLoader } from "../railways/types";
import type { StreetLinesDoc } from "../street-lines/saved";
import { type HeightsFetcher, useRailBuild } from "../tables/railBuild";
import { EMPTY_SCHEMATIC, LABEL_SIZE, labelSizeOf, type SchematicDoc, useModeLabel } from "./common";
import { useLineProfile, withRailDetails } from "./details";
import { download, fileName, MIN_NAME_PT, MIN_NAME_PX, pngImage, printSvg, svgText } from "./export";
import { schematicNetwork } from "./lines";
import { NetworkMap } from "./NetworkMap";
import { StripMap } from "./StripMap";
import { loadWater, waterBox, type WaterLoader, type WaterShapes } from "./water";

type Kind = "svg" | "png" | "print";

/** One export asked for: the network map (`line` null) or a line's strip map, and the file kind. */
interface Job {
  line: string | null;
  kind: Kind;
}

/** How long a map may take to load its details (rail engine, ground heights, water) before it is exported as is. */
const READY_WAIT_MS = 20_000;

/**
 * Purpose: the Export section of Project preferences: the schematic network map and every line's strip map, each
 * as SVG, PNG or the print dialog (print or save as PDF), drawn as the Schematic tab shows them (the planner's
 * layout, layers, tariff zones and landmarks).
 * Side effects: a map is only drawn (off screen) when it is exported, which loads the rail engine, the ground
 * heights and the water like the Schematic tab; then the download or print dialog starts.
 */
export function MapExports({
  railway,
  streetLines,
  pluginLines = [],
  prefs,
  doc,
  projectName,
  loadRail,
  fetchHeights,
  waterLoader = loadWater,
}: {
  railway: Network | null | undefined;
  streetLines: StreetLinesDoc | null | undefined;
  pluginLines?: readonly PluginLineInput[];
  prefs?: Record<string, number>;
  doc: SchematicDoc | null | undefined;
  projectName: string;
  /** Tests inject the rail engine, the terrain heights and the water. */
  loadRail?: RailEngineLoader;
  fetchHeights?: HeightsFetcher;
  waterLoader?: WaterLoader;
}) {
  const { t } = useI18n();
  const modeLabel = useModeLabel();
  const pluginJson = JSON.stringify(pluginLines);
  const net = useMemo(
    () => schematicNetwork(railway, streetLines, JSON.parse(pluginJson) as PluginLineInput[], prefs),
    [railway, streetLines, pluginJson, prefs],
  );
  const [job, setJob] = useState<Job | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const start = (line: string | null, kind: Kind) => {
    setError(null);
    setNote(null);
    setJob({ line, kind });
  };
  const rows: { line: string | null; label: string }[] = [
    { line: null, label: t("schematic.view.network") },
    ...net.lines.map((l) => ({
      line: l.id,
      label: `${t("schematic.view.line")}: ${l.name} · ${modeLabel(l.mode)}`,
    })),
  ];

  return (
    <section
      aria-labelledby="pp-export"
      className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 md:p-6"
    >
      <h2 id="pp-export" className="caps m-0">
        {t("schematic.exportTitle")}
      </h2>
      <p className="mt-1 text-sm text-slate-600">{t("schematic.exportsIntro")}</p>
      {net.lines.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">{t("schematic.exportsNone")}</p>
      ) : (
        <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
          {rows.map((r) => (
            <li
              key={r.line ?? ""}
              className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2 first:border-0 first:pt-0"
            >
              <span className="min-w-0 flex-1 basis-48 text-sm text-slate-800">{r.label}</span>
              <span role="group" aria-label={r.label} className="flex flex-wrap gap-2">
                {(["svg", "png", "print"] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className="btn"
                    disabled={job !== null}
                    onClick={() => start(r.line, kind)}
                  >
                    {t(`schematic.${kind}`)}
                  </button>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
      {job && (
        <p role="status" className="mt-3 text-sm text-slate-600">
          {t("schematic.exporting")}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {note && !job && (
        <p role="status" className="mt-3 text-sm text-slate-600">
          {note}
        </p>
      )}
      {job && (
        <ExportRun
          key={`${job.line ?? ""}:${job.kind}`}
          job={job}
          net={net}
          railway={railway}
          doc={doc ?? EMPTY_SCHEMATIC}
          projectName={projectName}
          modeLabel={modeLabel}
          loadRail={loadRail}
          fetchHeights={fetchHeights}
          waterLoader={waterLoader}
          onDone={(result) => {
            setJob(null);
            if (result.error !== undefined) setError(t("schematic.exportFailed", { error: result.error }));
            else setNote(result.note ?? null);
          }}
        />
      )}
    </section>
  );
}

/**
 * Purpose: draw one map off screen, wait for its details, then export it.
 * Output: `onDone` once, with a note to show (small names, paper size) or an error.
 */
function ExportRun({
  job,
  net: base,
  railway,
  doc,
  projectName,
  modeLabel,
  loadRail,
  fetchHeights,
  waterLoader,
  onDone,
}: {
  job: Job;
  net: ReturnType<typeof schematicNetwork>;
  railway: Network | null | undefined;
  doc: SchematicDoc;
  projectName: string;
  modeLabel: (m: string) => string;
  loadRail?: RailEngineLoader;
  fetchHeights?: HeightsFetcher;
  waterLoader: WaterLoader;
  onDone: (result: { note?: string; error?: string }) => void;
}) {
  const { t } = useI18n();
  const svgRef = useRef<SVGSVGElement>(null);
  const hasRail = Boolean(railway?.tracks.length);
  const { build, error: railError } = useRailBuild(
    hasRail ? (railway ?? null) : null,
    loadRail,
    fetchHeights,
  );
  const net = useMemo(() => withRailDetails(base, railway, build), [base, railway, build]);
  const line = job.line === null ? null : (net.lines.find((l) => l.id === job.line) ?? null);
  const profile = useLineProfile(line, fetchHeights);
  // The water around the network, for the network map when it is switched on.
  const wantWater = job.line === null && doc.water !== false;
  const [water, setWater] = useState<{ shapes: WaterShapes | null } | null>(
    wantWater ? null : { shapes: null },
  );
  useEffect(() => {
    if (!wantWater) return;
    let live = true;
    const box = waterBox(base.stations.map((s) => s.lonlat));
    if (!box) {
      setWater({ shapes: null });
      return;
    }
    waterLoader(box)
      .then((w) => live && setWater({ shapes: w }))
      .catch(() => live && setWater({ shapes: null }));
    return () => {
      live = false;
    };
  }, [wantWater, base, waterLoader]);
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setTimedOut(true), READY_WAIT_MS);
    return () => clearTimeout(id);
  }, []);
  const ready =
    timedOut ||
    ((!hasRail || build !== null || railError !== null) &&
      water !== null &&
      (job.line === null || line === null || line.paths.length === 0 || profile !== null));

  const done = useRef(onDone);
  done.current = onDone;
  const started = useRef(false);
  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    const svg = svgRef.current;
    if (!svg) {
      done.current({ error: t("schematic.exportsNone") });
      return;
    }
    const title = line ? `${projectName} ${line.name}` : projectName;
    // The strip map's station names are drawn at the default size.
    const namePx = line ? LABEL_SIZE : labelSizeOf(doc);
    void (async () => {
      try {
        if (job.kind === "svg") {
          download(new Blob([svgText(svg)], { type: "image/svg+xml" }), fileName(title, "svg"));
          done.current({});
        } else if (job.kind === "png") {
          // Twice the drawing's size, or more so the names are at least `MIN_NAME_PX` in the image.
          const png = await pngImage(svg, Math.max(2, MIN_NAME_PX / namePx));
          download(png.blob, fileName(title, "png"));
          const px = Math.round(namePx * png.scale * 10) / 10;
          done.current(px < MIN_NAME_PX ? { note: t("schematic.pngSmallNames", { px }) } : {});
        } else {
          const paper = printSvg(svg, title, namePx);
          done.current({
            note: t(paper.namePt < MIN_NAME_PT ? "schematic.printSmallNames" : "schematic.printPaper", {
              paper: paper.name,
              pt: paper.namePt,
            }),
          });
        }
      } catch (e) {
        done.current({ error: engineErrorText(e) });
      }
    })();
  }, [ready, job, line, doc, projectName, t]);

  const hidden = new Set(doc.hidden ?? []);
  return (
    // Drawn at full size but out of sight: the export reads the SVG's own width and height.
    <div aria-hidden="true" className="pointer-events-none fixed top-0 -left-[100000px] opacity-0">
      {job.line === null ? (
        <NetworkMap
          svgRef={svgRef}
          net={net}
          doc={doc}
          hidden={hidden}
          zoom={1}
          editable={false}
          onDoc={() => {}}
          title={projectName}
          modeLabel={modeLabel}
          selected={null}
          onSelect={() => {}}
          onLine={() => {}}
          water={water?.shapes ?? null}
          draft={null}
          onDraft={() => {}}
          selectedArea={null}
        />
      ) : (
        line && (
          <StripMap
            svgRef={svgRef}
            net={net}
            line={line}
            doc={doc}
            profile={profile}
            zoom={1}
            modeLabel={modeLabel}
            title={projectName}
          />
        )
      )}
    </div>
  );
}
