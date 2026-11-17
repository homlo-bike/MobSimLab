import { describe, expect, it } from "vitest";
import { errorText } from "../src/cli/error-text";

describe("errorText", () => {
  it("lists each attempt of an AggregateError, whose own message is empty", () => {
    const a = Object.assign(new Error("connect ECONNREFUSED 172.18.0.2:5432"), { code: "ECONNREFUSED" });
    const b = Object.assign(new Error("connect ECONNREFUSED [fd00::2]:5432"), { code: "ECONNREFUSED" });
    const agg = Object.assign(new AggregateError([a, b], ""), { code: "ECONNREFUSED" });
    expect(errorText(agg)).toBe("connect ECONNREFUSED 172.18.0.2:5432; connect ECONNREFUSED [fd00::2]:5432");
  });

  it("is never empty and adds a hint for a missing role or database", () => {
    expect(errorText(Object.assign(new Error(""), { code: "ETIMEDOUT" }))).toBe("Error (ETIMEDOUT)");
    expect(errorText("boom")).toBe("boom");
    const auth = Object.assign(new Error('password authentication failed for user "mobsimlab_migrator"'), {
      code: "28P01",
    });
    expect(errorText(auth)).toMatch(/28P01\): the role does not exist or its password does not match/);
  });
});
