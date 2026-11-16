import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import Transport from "winston-transport";
import { loadConfig } from "../src/config/env";
import { toLogRow } from "../src/logging/db.transport";
import { createLogger, LOG_LINE, type LogLevel, type LogLine, toLogLine } from "../src/logging/logger";
import { NestWinstonLogger } from "../src/logging/nest-logger";
import { isSecretKey, REDACT_KEYS, REDACTED, redact } from "../src/logging/redact";

const REPO = join(__dirname, "..", "..", "..");

/** A sink that keeps the finished lines. */
class Memory extends Transport {
  readonly lines: LogLine[] = [];
  override log(info: Record<symbol, unknown>, next: () => void): void {
    this.lines.push(info[LOG_LINE] as LogLine);
    next();
  }
}

/** Purpose: a logger at a level whose lines are kept instead of written. */
function capture(level: LogLevel = "trace") {
  const memory = new Memory();
  const logger = createLogger({ level, console: false });
  logger.add(memory);
  return { logger, lines: memory.lines };
}

describe("log redaction", () => {
  it("uses the same deny-list as the contract, the web app and the worker", () => {
    const contract = JSON.parse(readFileSync(join(REPO, "contracts", "log-redaction.json"), "utf8")) as {
      keys: string[];
      replacement: string;
    };
    expect([...REDACT_KEYS]).toEqual(contract.keys);
    expect(REDACTED).toBe(contract.replacement);
    const web = readFileSync(join(REPO, "apps", "web", "src", "logging", "redact.ts"), "utf8");
    const webKeys = /REDACT_KEYS = \[([^\]]*)\]/
      .exec(web)?.[1]
      ?.match(/"([a-z]+)"/g)
      ?.map((k) => k.slice(1, -1));
    expect(webKeys).toEqual(contract.keys);
    const worker = readFileSync(join(REPO, "worker", "src", "mobsim_worker", "logsink.py"), "utf8");
    const workerKeys = /REDACT_KEYS = \(([^)]*)\)/
      .exec(worker)?.[1]
      ?.match(/"([a-z]+)"/g)
      ?.map((k) => k.slice(1, -1));
    expect(workerKeys).toEqual(contract.keys);
  });

  it("recognises secret field names in any spelling", () => {
    for (const k of [
      "password",
      "dbPassword",
      "Authorization",
      "x-csrf-token",
      "client_secret",
      "Cookie",
      "api_key",
    ])
      expect(isSecretKey(k), k).toBe(true);
    for (const k of ["name", "projectId", "message", "speedKmh"]) expect(isSecretKey(k), k).toBe(false);
  });

  it("replaces secrets at any depth and masks inline credentials", () => {
    const out = redact({
      user: "a",
      nested: { headers: { authorization: "Bearer abc.def", accept: "json" }, list: [{ token: "t" }] },
      note: "sent Bearer abc.def-ghi to the server",
    });
    expect(out).toEqual({
      user: "a",
      nested: { headers: { authorization: REDACTED, accept: "json" }, list: [{ token: REDACTED }] },
      note: `sent Bearer ${REDACTED} to the server`,
    });
  });

  it("survives reference cycles and errors", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    expect(() => JSON.stringify(redact(a))).not.toThrow();
    const e = redact(new Error("failed with Basic dXNlcjpwYXNz")) as { message: string };
    expect(e.message).toBe(`failed with Basic ${REDACTED}`);
  });
});

describe("logger", () => {
  it("writes JSON lines with the level, severity, module and redacted context", () => {
    const { logger, lines } = capture();
    logger.warn("could not reach Bearer xyz", {
      module: "gateway",
      password: "hunter2",
      host: "example.org",
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "WARN",
      severity: 40,
      origin: "backend",
      module: "gateway",
      message: `could not reach Bearer ${REDACTED}`,
      context: { password: REDACTED, host: "example.org" },
    });
  });

  it("has the six levels, TRACE to CRITICAL, and filters below the configured one", () => {
    const { logger, lines } = capture("warn");
    for (const l of ["trace", "debug", "info", "warn", "error", "critical"] as const) logger[l](l);
    expect(lines.map((l) => [l.level, l.severity])).toEqual([
      ["WARN", 40],
      ["ERROR", 50],
      ["CRITICAL", 60],
    ]);
  });

  it("sends Nest's messages through Winston with the context as module", () => {
    const { logger, lines } = capture();
    const nest = new NestWinstonLogger(logger);
    nest.log("started", "bootstrap");
    nest.error("failed", "Error: failed\n    at x", "RunQueue");
    nest.verbose("detail", "RunQueue");
    nest.fatal("down", "RunQueue");
    expect(lines.map((l) => [l.level, l.module, l.message])).toEqual([
      ["INFO", "bootstrap", "started"],
      ["ERROR", "RunQueue", "failed"],
      ["TRACE", "RunQueue", "detail"],
      ["CRITICAL", "RunQueue", "down"],
    ]);
    expect(lines[1]?.context).toEqual({ stack: "Error: failed\n    at x" });
  });
});

describe("database sink rows", () => {
  const line = (over: Partial<LogLine>): LogLine => ({
    time: "2026-11-16T12:00:00.000Z",
    level: "WARN",
    severity: 40,
    origin: "backend",
    message: "m",
    ...over,
  });

  it("keeps WARN and above only", () => {
    for (const level of ["TRACE", "DEBUG", "INFO"]) expect(toLogRow(line({ level }))).toBeNull();
    for (const level of ["WARN", "ERROR", "CRITICAL"]) expect(toLogRow(line({ level }))?.level).toBe(level);
  });

  it("cuts fields to what the table accepts and drops IDs that are not UUIDs", () => {
    const row = toLogRow(
      line({
        message: "x".repeat(5000),
        module: "m".repeat(200),
        userId: "not-a-uuid",
        projectId: "6f1c4c1e-1b7a-4c55-9a43-0c4f7d1a2b3c",
        context: { big: "y".repeat(20_000) },
      }),
    );
    expect(row?.message).toHaveLength(4000);
    expect(row?.module).toHaveLength(100);
    expect(row?.user_id).toBeNull();
    expect(row?.project_id).toBe("6f1c4c1e-1b7a-4c55-9a43-0c4f7d1a2b3c");
    expect(JSON.parse(row?.context ?? "{}")).toMatchObject({ truncated: true });
  });

  it("is built from the same line the console gets", () => {
    const l = toLogLine({ level: "error", message: "boom", module: "x" } as never);
    expect(toLogRow(l)).toMatchObject({ level: "ERROR", origin: "backend", module: "x", message: "boom" });
  });
});

describe("logging configuration", () => {
  const env = { MOBSIMLAB_PUBLIC_URL: "https://msl.example.org", MOBSIMLAB_DB_HOST: "db" };
  const secret = (name: string) =>
    name.includes("password") ? "Zq8vR2mW5xK9pL3tY7nB4cF6" : "Zq8vR2mW5xK9pL3tY7nB4cF6hJ1sD0gA8eU2iO5wQ3r=";

  it("defaults to INFO and no file", () => {
    expect(loadConfig(env, secret).logging).toEqual({ level: "info", dir: undefined });
  });

  it("reads the level in any case and the file directory", () => {
    const c = loadConfig({ ...env, MOBSIMLAB_LOG_LEVEL: "DEBUG", MOBSIMLAB_LOG_DIR: "/data/logs" }, secret);
    expect(c.logging).toEqual({ level: "debug", dir: "/data/logs" });
  });

  it("refuses an unknown level", () => {
    expect(() => loadConfig({ ...env, MOBSIMLAB_LOG_LEVEL: "loud" }, secret)).toThrow(/MOBSIMLAB_LOG_LEVEL/);
  });
});
