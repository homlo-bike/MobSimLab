import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsentPage } from "../src/agents/ConsentPage";
import { scenarioToGeoJson } from "../src/agents/scenarioLayer";
import type { Me } from "../src/session/api";

const me: Me = {
  instance: { mode: "open", name: "MobSimLab" },
  signInAvailable: true,
  user: { id: "u1", role: "user", email: "e@example.org", displayName: "Eve" },
  csrfToken: "csrf",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("agent consent page", () => {
  it("asks signed-out people to sign in and come back", () => {
    window.history.replaceState(null, "", "/agents/consent?request=msl_cr_abc");
    render(<ConsentPage me={{ ...me, user: undefined, csrfToken: undefined }} />);
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe(
      `/api/auth/login?return_to=${encodeURIComponent("/agents/consent?request=msl_cr_abc")}`,
    );
  });

  it("shows the client and permissions and posts the answer with the kept scopes", async () => {
    window.history.replaceState(null, "", "/agents/consent?request=msl_cr_abc");
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (!init?.method)
          return new Response(
            JSON.stringify({
              client: { name: "Claude", uri: null, redirectHost: "claude.ai", verified: false },
              scopes: [
                { id: "project:read", label: "Read" },
                { id: "scenario:write", label: "Write" },
              ],
              allowed: true,
              reason: null,
            }),
          );
        return new Response(JSON.stringify({ redirect: "#done" }));
      }),
    );
    render(<ConsentPage me={me} />);
    await screen.findByText("Claude");
    fireEvent.click(screen.getByRole("checkbox", { name: "Write" }));
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]?.url).toBe("/api/agents/consent/msl_cr_abc");
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ approve: true, scopes: ["project:read"] });
  });
});

describe("scenario layer", () => {
  it("draws routed lines and stops", () => {
    const g = scenarioToGeoJson({
      id: "s",
      name: "s",
      doc: {
        stops: [{ id: "A", name: "A", lon: 7, lat: 50 }],
        lines: [{ id: "L", name: "1", mode: "bus" }],
        routed: {
          L: {
            directions: [
              {
                coords: [
                  [7, 50],
                  [7.01, 50],
                ],
              },
            ],
          },
        },
      },
    });
    expect(g.lines.features).toHaveLength(1);
    expect(g.stops.features[0]?.geometry.coordinates).toEqual([7, 50]);
  });
});
