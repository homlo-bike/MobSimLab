import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FLUSH_MS, flushLogs, getLogger, logUncaughtErrors, setLogSession } from "../src/logging/logger";

/** Browser logs (ADR-0022): batched to POST /api/logs while signed in, redacted first. */
describe("browser logs", () => {
  let calls: { url: string; init: RequestInit }[];

  beforeEach(() => {
    calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(null, { status: 204 });
      }),
    );
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    setLogSession(null);
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const sent = () =>
    calls.flatMap((c) => (JSON.parse(String(c.init.body)) as { entries: Record<string, unknown>[] }).entries);

  it("sends nothing while signed out", async () => {
    setLogSession(null);
    getLogger("map").error("boom");
    await flushLogs();
    expect(calls).toHaveLength(0);
  });

  it("holds INFO and WARN for 10 seconds, then sends them in one request with the CSRF token", async () => {
    vi.useFakeTimers();
    setLogSession("csrf-1");
    const log = getLogger("map");
    log.debug("not sent");
    log.info("tiles loaded");
    log.warn({ layer: "noise" }, "layer slow");
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/api/logs");
    expect(calls[0]?.init.method).toBe("POST");
    expect((calls[0]?.init.headers as Record<string, string>)["X-CSRF-Token"]).toBe("csrf-1");
    expect(sent().map((e) => [e.level, e.module, e.message])).toEqual([
      ["info", "map", "tiles loaded"],
      ["warn", "map", "layer slow"],
    ]);
    expect(sent()[1]?.context).toEqual({ layer: "noise" });
  });

  it("sends at once on ERROR and CRITICAL", async () => {
    setLogSession("csrf-1");
    getLogger("editor").critical("lost the drawing");
    await flushLogs();
    expect(sent()[0]).toMatchObject({ level: "critical", module: "editor", message: "lost the drawing" });
  });

  it("redacts secret fields and inline credentials before sending", async () => {
    setLogSession("csrf-1");
    getLogger("api").error(
      { headers: { authorization: "Bearer abc" }, password: "p" },
      "call failed: Bearer abc at https://t.example.org/1/2/3.png?key=k1",
    );
    await flushLogs();
    expect(sent()[0]).toMatchObject({
      message: "call failed: Bearer [REDACTED] at https://t.example.org/1/2/3.png?key=[REDACTED]",
      context: { headers: { authorization: "[REDACTED]" }, password: "[REDACTED]" },
    });
  });

  it("logs uncaught errors and unhandled rejections", async () => {
    setLogSession("csrf-1");
    const target = new EventTarget() as unknown as Window;
    logUncaughtErrors(target);
    target.dispatchEvent(new ErrorEvent("error", { message: "x is undefined", error: new TypeError("x") }));
    const rejection = new Event("unhandledrejection") as Event & { reason: unknown };
    rejection.reason = new Error("fetch failed");
    target.dispatchEvent(rejection);
    await flushLogs();
    expect(sent().map((e) => [e.level, e.message])).toEqual([
      ["error", "x is undefined"],
      ["error", "unhandled promise rejection"],
    ]);
  });
});
