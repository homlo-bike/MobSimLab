import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import { connectWithRetry } from "../src/cli/connect";

/** A stand-in pg client whose connect() fails with the given errors, then succeeds. */
function clients(errors: unknown[]) {
  let made = 0;
  const make = () => {
    const e = errors[made++];
    return {
      connect: () => (e === undefined ? Promise.resolve() : Promise.reject(e)),
      end: () => Promise.resolve(),
    } as unknown as Client;
  };
  return { make, count: () => made };
}

describe("connectWithRetry", () => {
  it("retries a network error until the database answers", async () => {
    const refused = Object.assign(
      new AggregateError([new Error("connect ECONNREFUSED 172.3.0.22:5432")], ""),
      {
        code: "ECONNREFUSED",
      },
    );
    const c = clients([refused]);
    await expect(connectWithRetry(c.make, "mobsimlab at db:5432", 5_000)).resolves.toBeDefined();
    expect(c.count()).toBe(2);
  });

  it("fails at once on a database error, with its message", async () => {
    const auth = Object.assign(new Error('password authentication failed for user "mobsimlab_migrator"'), {
      code: "28P01",
    });
    const c = clients([auth]);
    await expect(connectWithRetry(c.make, "mobsimlab at db:5432", 5_000)).rejects.toThrow(
      /mobsimlab at db:5432 .*attempt 1.*password authentication failed/,
    );
    expect(c.count()).toBe(1);
  });

  it("gives up after the retry time with the last error, never an empty message", async () => {
    const c = clients([Object.assign(new AggregateError([], ""), { code: "ETIMEDOUT" })]);
    await expect(connectWithRetry(c.make, "x", 0)).rejects.toThrow(/AggregateError \(ETIMEDOUT\)|ETIMEDOUT/);
  });
});
