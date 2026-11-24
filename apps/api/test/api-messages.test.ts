import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { BadRequestException, ForbiddenException, HttpException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { apiMsgOf, badRequestLine, withMsg } from "../src/i18n/api-message.filter";
import { DRAWING_KINDS } from "../src/projects/drawings";
import type { ArgumentsHost } from "@nestjs/common";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("API error messages", () => {
  it("every fixed error text the API throws has a key", () => {
    const missing: string[] = [];
    for (const f of sources(join(__dirname, "../src"))) {
      for (const m of readFileSync(f, "utf8").matchAll(/new \w+Exception\("([^"]*)"\)/g))
        if (!apiMsgOf(m[1]!)) missing.push(`${f}: ${m[1]}`);
    }
    expect(missing).toEqual([]);
  });

  it("finds the key and values of a text with values", () => {
    expect(apiMsgOf("The project area is 1,234 km², more than the 1,000 km² an import accepts")).toEqual({
      key: "api.geodata.area_too_large",
      args: { area: "1,234", max: "1,000" },
    });
    expect(apiMsgOf("project not found")).toEqual({ key: "api.projects.project_not_found" });
    expect(apiMsgOf("something else")).toBeNull();
  });

  it("adds msg to known errors and keeps the rest of the response", () => {
    const e = withMsg(new BadRequestException("The file is empty"));
    expect(e.getStatus()).toBe(400);
    expect(e.getResponse()).toMatchObject({
      statusCode: 400,
      message: "The file is empty",
      msg: { key: "api.population.file_empty" },
    });
    expect(withMsg(new ForbiddenException()).getResponse()).toMatchObject({
      msg: { key: "api.http.forbidden" },
    });
    const other = new HttpException("not a known text", 400);
    expect(withMsg(other)).toBe(other);
  });

  it("logs a refused request with its route and reason, never its query or body", () => {
    const host = {
      getType: () => "http",
      switchToHttp: () => ({
        getRequest: () => ({
          method: "PUT",
          originalUrl: "/api/projects/p1/drawings/street-setups?x=secret",
        }),
      }),
    } as unknown as ArgumentsHost;
    const line = badRequestLine(
      new BadRequestException("Invalid input: expected array, received object"),
      host,
    );
    expect(line).toBe(
      "400 PUT /api/projects/p1/drawings/street-setups: Invalid input: expected array, received object",
    );
  });
});

describe("Drawing outlines", () => {
  it("keep a junction's street names", () => {
    const doc = [{ nodes: [321866214], signals: true, lonlat: [36.29, 33.51], name: "شارع بغداد" }];
    expect(DRAWING_KINDS["junction-setups"].schema.parse(doc)).toEqual(doc);
  });
});
