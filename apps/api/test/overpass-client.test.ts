import { describe, expect, it } from "vitest";
import { OverpassClient } from "../src/gateway/overpass.client";

describe("Overpass client queue", () => {
  it("lets the next query go while a failed one backs off before its retry", async () => {
    const order: string[] = [];
    let release: () => void = () => {};
    const backingOff = new Promise<void>((r) => (release = r));
    let firstA = true;
    const fetchImpl = (async (_url: string, init: { body: string }) => {
      const q = new URLSearchParams(init.body).get("data") ?? "";
      order.push(q);
      if (q === "A" && firstA) {
        firstA = false;
        return new Response("busy", { status: 503 });
      }
      return new Response(`ok ${q}`, { status: 200 });
    }) as unknown as typeof fetch;
    // The back-off before A's retry lasts until B has answered.
    const sleep = (ms: number) => (ms >= 100 ? backingOff : Promise.resolve());
    const c = new OverpassClient({ fetchImpl, sleep, minIntervalMs: 0, backoffMs: [100] });
    const a = c.run("A");
    const b = c.run("B");
    expect(await b).toBe("ok B");
    release();
    expect(await a).toBe("ok A");
    expect(order).toEqual(["A", "B", "A"]);
  });

  it("still sends one request at a time", async () => {
    let open = 0;
    let most = 0;
    const fetchImpl = (async () => {
      open += 1;
      most = Math.max(most, open);
      await new Promise((r) => setTimeout(r, 5));
      open -= 1;
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    const c = new OverpassClient({ fetchImpl, minIntervalMs: 0 });
    await Promise.all([c.run("1"), c.run("2"), c.run("3")]);
    expect(most).toBe(1);
  });
});
