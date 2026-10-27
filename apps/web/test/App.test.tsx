import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("maplibre-gl", () => {
  class Map {
    addControl() {}
    remove() {}
  }
  class Control {}
  return { Map, AttributionControl: Control, NavigationControl: Control, ScaleControl: Control };
});

import { App } from "../src/App";
import { DEFAULT_BASEMAP } from "../src/map/basemaps";
import type { Me } from "../src/session/api";

const setupMe: Me = { instance: { mode: "setup", name: "MobSimLab" }, signInAvailable: true };
const ownerMe: Me = {
  ...setupMe,
  user: { id: "u1", role: "owner", email: "alice@example.org", displayName: "Alice" },
  csrfToken: "csrf-123",
};

/** Purpose: stub fetch with a sequence of /api/auth/me answers and record other calls. */
function stubFetch(meAnswers: Me[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const body = url === "/api/auth/me" ? meAnswers[Math.min(i++, meAnswers.length - 1)] : {};
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("App shell", () => {
  it("renders the menu, the map container and a sign-in link", async () => {
    stubFetch([setupMe]);
    render(<App />);
    expect(screen.getByRole("navigation", { name: "Main menu" })).toBeTruthy();
    expect(screen.getByTestId("map")).toBeTruthy();
    expect((await screen.findByText("Sign in")).getAttribute("href")).toBe("/api/auth/login");
  });

  it("explains a refused sign-in", async () => {
    stubFetch([setupMe]);
    window.history.replaceState(null, "", "/?signin=setup_in_progress");
    render(<App />);
    expect((await screen.findByRole("status")).textContent).toMatch(/being set up/);
  });

  it("shows the setup wizard to the Owner and sends the CSRF token", async () => {
    const calls = stubFetch([ownerMe, { ...ownerMe, instance: { mode: "open", name: "Köln" } }]);
    render(<App />);
    const input = await screen.findByLabelText("Instance name");
    fireEvent.change(input, { target: { value: "Köln" } });
    fireEvent.click(screen.getByText("Finish setup"));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Setup" })).toBeNull());
    const put = calls.find((c) => c.url === "/api/setup/instance");
    expect(put?.init?.method).toBe("PUT");
    expect((put?.init?.headers as Record<string, string>)["X-CSRF-Token"]).toBe("csrf-123");
    expect(calls.some((c) => c.url === "/api/setup/finish")).toBe(true);
    expect(await screen.findByText("Köln")).toBeTruthy();
  });

  it("credits OpenStreetMap on the default basemap", () => {
    expect(DEFAULT_BASEMAP.attribution).toContain("OpenStreetMap contributors");
  });
});
