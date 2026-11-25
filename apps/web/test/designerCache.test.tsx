import { beforeEach, describe, expect, it } from "vitest";
import { CachedDesigner, type Designer, forgetDesignerAnswers } from "../src/features/railways/designerCache";

/** An engine that records its calls: a build answers with the tiles and document it was given. */
function engine() {
  const calls: string[] = [];
  const tiles: string[] = [];
  let built = "";
  const d: Designer & { addTile(t: string): void } = {
    addTile: (t) => {
      calls.push(`tile ${t}`);
      tiles.push(t);
    },
    build: (doc, draft) => {
      calls.push(`build ${doc}`);
      built = `${tiles.join("+")}|${doc}|${draft}`;
      return JSON.stringify({ built });
    },
    publish_lines: (lines, id) => {
      calls.push(`publish ${id}`);
      return JSON.stringify({ on: built, lines, id });
    },
    publish_lines_with: (lines, id, o) => {
      calls.push(`publish ${id} ${o}`);
      return JSON.stringify({ on: built, lines, id, o });
    },
    topology: () => {
      calls.push("topology");
      return JSON.stringify({ on: built });
    },
    missing_terrain_tiles: () => {
      calls.push("missing");
      return JSON.stringify(built ? [[1, 2]] : []);
    },
  };
  return { d, calls };
}

describe("rail engine answers kept for the page", () => {
  beforeEach(forgetDesignerAnswers);

  it("answers the same build and publication from memory, on another engine too", () => {
    const one = engine();
    const a = new CachedDesigner(one.d);
    const v1 = a.build("doc", 0);
    const p1 = a.publishLines("[1]", "weekday");
    const m1 = a.missingTerrainTiles();
    expect(one.calls).toEqual(["build doc", "publish weekday", "missing"]);

    const two = engine();
    const b = new CachedDesigner(two.d);
    expect(b.build("doc", 0)).toBe(v1);
    expect(b.publishLines("[1]", "weekday")).toBe(p1);
    expect(b.missingTerrainTiles()).toBe(m1);
    // Nothing ran on the second engine: every answer came from memory.
    expect(two.calls).toEqual([]);
  });

  it("builds again when the document, the tiles or the publish settings differ", () => {
    const a = new CachedDesigner(engine().d);
    a.build("doc", 0);
    a.publishLines("[1]", "weekday");
    const two = engine();
    const b = new CachedDesigner(two.d);
    b.change("tile t1", (d) => d.addTile("t1"));
    const v = JSON.parse(b.build("doc", 0)) as { built: string };
    expect(v.built).toBe("t1|doc|0");
    b.publishLines("[1]", "weekday", '{"max_idle_s":60}');
    expect(two.calls).toEqual(["tile t1", "build doc", 'publish weekday {"max_idle_s":60}']);
  });

  it("catches the engine up, in order, before a call it has no answer for", () => {
    const a = new CachedDesigner(engine().d);
    a.build("doc", 0);
    const two = engine();
    const b = new CachedDesigner(two.d);
    b.build("doc", 0); // from memory
    b.change("tile t1", (d) => d.addTile("t1")); // after a skipped build: waits its turn
    expect(two.calls).toEqual([]);
    const p = JSON.parse(b.publishLines("[2]", "sunday")) as { on: string };
    // The skipped build ran first, then the tile, then the publication on that build.
    expect(two.calls).toEqual(["build doc", "tile t1", "publish sunday"]);
    expect(p.on).toBe("|doc|0");
    expect(b.catchUp()).toBe(two.d);
  });
});

describe("rail publications planned elsewhere", () => {
  beforeEach(forgetDesignerAnswers);

  it("plans on the last build's topology and keeps the answer as the engine's would be", async () => {
    const one = engine();
    const a = new CachedDesigner(one.d);
    a.build("doc", 0);
    const seen: string[] = [];
    const away = async (topology: string) => {
      seen.push(topology);
      return JSON.stringify({ planned: topology });
    };
    const p1 = await a.publishLinesAway("[1]", "weekday", undefined, away);
    expect(seen).toEqual([JSON.stringify({ on: "|doc|0" })]);
    expect(one.calls).toEqual(["build doc", "topology"]);
    // The same publication on the same build comes from memory, on the page's engine or planned elsewhere.
    expect(a.publishLines("[1]", "weekday")).toBe(p1);
    expect(await a.publishLinesAway("[1]", "weekday", undefined, away)).toBe(p1);
    expect(seen).toHaveLength(1);
    expect(one.calls).toEqual(["build doc", "topology"]);
    // Other settings are planned again.
    await a.publishLinesAway("[1]", "weekday", '{"max_idle_s":60}', away);
    expect(seen).toHaveLength(2);
  });
});
