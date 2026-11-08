import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("maplibre-gl", () => {
  class Map {
    addControl() {}
    on() {}
    remove() {}
  }
  class Control {}
  return {
    Map,
    AttributionControl: Control,
    NavigationControl: Control,
    ScaleControl: Control,
    setWorkerUrl: () => {},
  };
});

import { App } from "../src/App";
import { MESSAGES } from "../src/i18n/messages";
import { resolveLanguage } from "../src/i18n/i18n";
import { DEFAULT_BASEMAP } from "../src/map/basemaps";
import type { Project } from "../src/projects/api";
import type { Me } from "../src/session/api";
import { parseRoute, routePath } from "../src/shell/route";

const signedOut: Me = { instance: { mode: "open", name: "MobSimLab" }, signInAvailable: true };
const owner: Me = {
  ...signedOut,
  user: { id: "u1", role: "owner", email: "alice@example.org", displayName: "Alice Smith", preferences: {} },
  csrfToken: "csrf-123",
};
const plainUser: Me = { ...owner, user: { ...owner.user!, role: "user" } };

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const P3 = "33333333-3333-4333-8333-333333333333";
const NEW = "44444444-4444-4444-8444-444444444444";
const project = (
  id: string,
  name: string,
  myRole: Project["myRole"],
  extra: Partial<Project> = {},
): Project => ({
  id,
  name,
  description: "",
  areaName: "Lakeside",
  modes: ["tram"],
  myRole,
  viaLink: false,
  owner: {
    id: myRole === "owner" ? "u1" : "u2",
    displayName: myRole === "owner" ? "Alice Smith" : "Ana Kovač",
  },
  memberCount: myRole === "owner" ? 1 : 3,
  linkAccess: false,
  createdAt: "2026-11-01T10:00:00Z",
  updatedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
  archivedAt: null,
  ...extra,
});
const projects = [
  project(P1, "Lakeside network", "owner"),
  project(P2, "Regional rail 2035", "editor"),
  project(P3, "City-wide 2030", "viewer"),
];

interface Call {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

/** Purpose: stub fetch with a small fake API; returns the recorded calls. */
function stubApi(me: Me | Me[], overrides: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const mes = Array.isArray(me) ? me : [me];
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body, headers: (init?.headers as Record<string, string>) ?? {} });
      const key = `${method} ${url}`;
      const reply = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
      if (key in overrides) return reply(overrides[key]);
      if (url === "/api/auth/me") return reply(mes[Math.min(i++, mes.length - 1)]);
      if (key === "GET /api/projects") return reply({ projects });
      if (key === "GET /api/projects?archived=true") return reply({ projects: [] });
      if (key === "POST /api/projects")
        return reply(
          { project: project(NEW, (body as { name: string }).name, "owner", { areaName: null }) },
          201,
        );
      const one = /^\/api\/projects\/([0-9a-f-]{36})$/.exec(url);
      if (one && method === "GET") {
        const p = [...projects, project(NEW, "Riverside tram study", "owner", { areaName: null })].find(
          (x) => x.id === one[1],
        );
        return p ? reply({ project: p }) : reply({ message: "project not found" }, 404);
      }
      if (key === "PUT /api/auth/preferences") return reply({ preferences: body });
      return reply({ ok: true });
    }),
  );
  return calls;
}

let languages: string[] = ["en-GB", "en"];
beforeEach(() => {
  languages = ["en-GB", "en"];
  vi.spyOn(navigator, "languages", "get").mockImplementation(() => languages);
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
  document.documentElement.className = "";
});

describe("sign-in page", () => {
  it("offers OpenID Connect sign-in and explains a refused sign-in", async () => {
    stubApi(signedOut);
    window.history.replaceState(null, "", "/?signin=pending_approval");
    render(<App />);
    const link = await screen.findByRole("link", { name: /Continue with your organisation account/ });
    expect(link.getAttribute("href")).toBe("/api/auth/login");
    expect(screen.getByRole("status").textContent).toMatch(/waiting for an administrator/);
  });

  it("follows the browser language and lets the person pick another", async () => {
    languages = ["de-AT", "en"];
    stubApi(signedOut);
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Anmelden" })).toBeTruthy();
    expect(document.documentElement.lang).toBe("de");
    fireEvent.click(screen.getByRole("button", { name: /Deutsch \(vom Gerät\)/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Français" }));
    expect(await screen.findByRole("heading", { name: "Se connecter" })).toBeTruthy();
    expect(window.localStorage.getItem("mobsimlab.language")).toBe("fr");
  });

  it("opens the About dialog with the version, licence and source link", async () => {
    stubApi(signedOut);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "About" }));
    const dlg = screen.getByRole("dialog", { name: "About MobSimLab" });
    expect(within(dlg).getByText(/GNU AGPL-3.0/)).toBeTruthy();
    expect(within(dlg).getByText("0.1.0", { exact: false })).toBeTruthy();
    expect(within(dlg).getByRole("link", { name: "Source on GitHub" }).getAttribute("href")).toBe(
      "https://github.com/homlo-bike/MobSimLab",
    );
  });
});

describe("projects home", () => {
  it("groups own, shared and view-only projects", async () => {
    stubApi(owner);
    render(<App />);
    const mine = await screen.findByRole("region", { name: "My projects" });
    expect(within(mine).getByText("Lakeside network")).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "Shared with me · you can edit" })).getByText(
        "Regional rail 2035",
      ),
    ).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "View only" })).getByText("City-wide 2030"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "View only · 1" }));
    expect(screen.queryByText("Lakeside network")).toBeNull();
  });

  it("opens the project menu by right-click, with actions by role", async () => {
    stubApi(owner);
    render(<App />);
    fireEvent.contextMenu(await screen.findByText("Lakeside network"));
    const menu = screen.getByRole("menu", { name: "Actions for Lakeside network" });
    const items = within(menu)
      .getAllByRole("menuitem")
      .map((b) => b.textContent);
    expect(items).toEqual(["Open", "Rename", "Share", "Manage access", "Duplicate", "Archive", "Delete…"]);
    fireEvent.keyDown(menu, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Actions for City-wide 2030" }));
    const viewer = screen.getByRole("menu", { name: "Actions for City-wide 2030" });
    expect(
      within(viewer)
        .getAllByRole("menuitem")
        .map((b) => b.textContent),
    ).toEqual(["Open", "Manage access", "Duplicate"]);
  });

  it("deletes only after the name is typed", async () => {
    const calls = stubApi(owner);
    render(<App />);
    fireEvent.contextMenu(await screen.findByText("Lakeside network"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete…" }));
    const dlg = screen.getByRole("dialog", { name: "Delete “Lakeside network”?" });
    const del = within(dlg).getByRole("button", { name: "Delete" });
    expect((del as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dlg).getByLabelText("Type the project name to confirm"), {
      target: { value: "Lakeside network" },
    });
    fireEvent.click(del);
    await waitFor(() =>
      expect(calls.some((c) => c.method === "DELETE" && c.url === `/api/projects/${P1}`)).toBe(true),
    );
    const call = calls.find((c) => c.method === "DELETE");
    expect(call?.body).toEqual({ confirmName: "Lakeside network" });
    expect(call?.headers["X-CSRF-Token"]).toBe("csrf-123");
    expect(await screen.findByText("Moved Lakeside network to the bin.")).toBeTruthy();
  });

  it("creates a project and opens its Create tab with the street or rail chooser", async () => {
    const calls = stubApi(owner);
    render(<App />);
    fireEvent.click((await screen.findAllByRole("button", { name: "New project" }))[0]!);
    const dlg = screen.getByRole("dialog", { name: "New project" });
    fireEvent.change(within(dlg).getByLabelText("Project name"), {
      target: { value: "Riverside tram study" },
    });
    fireEvent.click(within(dlg).getByRole("button", { name: "Metro" }));
    fireEvent.click(within(dlg).getByRole("button", { name: "Create and open" }));
    expect(await screen.findByRole("region", { name: "What do you want to build first?" })).toBeTruthy();
    expect(window.location.pathname).toBe(`/projects/${NEW}/create`);
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      name: "Riverside tram study",
      areaName: null,
      modes: ["bus", "tram", "metro"],
    });
    fireEvent.click(screen.getByRole("button", { name: /Street route/ }));
    expect(await screen.findByRole("toolbar", { name: "Street line tools" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Street route" })).toBeTruthy();
  });

  it("keeps Viewers from creating projects", async () => {
    stubApi({ ...owner, user: { ...owner.user!, role: "viewer" } });
    render(<App />);
    await screen.findByText("Lakeside network");
    expect(screen.queryByRole("button", { name: "New project" })).toBeNull();
  });
});

describe("project workspace", () => {
  it("opens an existing project on the Simulator tab and moves between tabs", async () => {
    stubApi(owner);
    render(<App />);
    fireEvent.click(await screen.findByText("Lakeside network"));
    expect(await screen.findByRole("tab", { name: "Journey time A → B" })).toBeTruthy();
    expect(window.location.pathname).toBe(`/projects/${P1}/simulator`);
    const nav = screen.getAllByRole("navigation", { name: "Project" })[0]!;
    expect(
      within(nav)
        .getAllByRole("link")
        .map((a) => a.textContent),
    ).toEqual(["Simulator", "Create", "Schematic", "GIS", "Tables", "Preferences"]);
    fireEvent.click(within(nav).getByRole("link", { name: "Create" }));
    expect(await screen.findByRole("toolbar", { name: "Street line tools" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Rail route" }));
    expect(await screen.findByRole("complementary", { name: "Rail route" })).toBeTruthy();
    fireEvent.click(within(nav).getByRole("link", { name: "Tables" }));
    expect(screen.getByRole("region", { name: "Tables" })).toBeTruthy();
  });

  it("shows view-only projects without the editing tools", async () => {
    stubApi(owner);
    window.history.replaceState(null, "", `/projects/${P3}/create`);
    render(<App />);
    expect(await screen.findByText(/You can look at this project but not change it/)).toBeTruthy();
    expect(screen.queryByRole("toolbar", { name: "Street line tools" })).toBeNull();
  });

  it("says when a project cannot be opened", async () => {
    stubApi(owner);
    window.history.replaceState(null, "", "/projects/99999999-9999-4999-8999-999999999999/simulator");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Project not found" })).toBeTruthy();
  });

  it("moves street setups kept in this browser into the project and shows that they are saved", async () => {
    const setups = [{ way: 42, bus_lane: true }];
    window.localStorage.setItem(`mobsimlab.streetSetups.${P1}`, JSON.stringify(setups));
    const calls = stubApi(owner, {
      [`GET /api/projects/${P1}/drawings`]: { drawings: {} },
      [`PUT /api/projects/${P1}/drawings/street-setups`]: {
        drawing: {
          kind: "street-setups",
          schemaVersion: 1,
          doc: setups,
          version: 1,
          updatedAt: "2026-11-03T10:00:00Z",
          updatedBy: { id: "u1", displayName: "Alice Smith" },
        },
      },
    });
    window.history.replaceState(null, "", `/projects/${P1}/schematic`);
    render(<App />);
    await waitFor(
      () =>
        expect(
          calls.find((c) => c.method === "PUT" && c.url.endsWith("/drawings/street-setups")),
        ).toBeTruthy(),
      { timeout: 3000 },
    );
    const put = calls.find((c) => c.url.endsWith("/drawings/street-setups"));
    expect(put?.body).toEqual({ doc: setups, baseVersion: null });
    expect(put?.headers["X-CSRF-Token"]).toBe("csrf-123");
    expect(window.localStorage.getItem(`mobsimlab.streetSetups.${P1}`)).toBeNull();
    expect((await screen.findByText("Saved")).getAttribute("role")).toBe("status");
  });

  it("asks which drawing to keep when someone else saved first", async () => {
    window.localStorage.setItem(`mobsimlab.streetSetups.${P1}`, JSON.stringify([{ way: 7 }]));
    const theirs = {
      kind: "street-setups",
      schemaVersion: 1,
      doc: [{ way: 8 }],
      version: 3,
      updatedAt: "2026-11-03T10:00:00Z",
      updatedBy: { id: "u2", displayName: "Ana Kovač" },
    };
    stubApi(owner, { [`GET /api/projects/${P1}/drawings`]: { drawings: {} } });
    const plain = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) =>
      String(url).endsWith("/drawings/street-setups")
        ? new Response(JSON.stringify({ message: "someone else saved", current: theirs }), { status: 409 })
        : plain(url, init),
    );
    window.history.replaceState(null, "", `/projects/${P1}/schematic`);
    render(<App />);
    const alert = await screen.findByRole("alert", {}, { timeout: 3000 });
    expect(alert.textContent).toMatch(/Ana Kovač saved the street setups while you were changing it/);
    fireEvent.click(within(alert).getByRole("button", { name: "Use theirs" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Saved")).toBeTruthy();
  });

  it("saves project preferences", async () => {
    const calls = stubApi(owner, {
      [`PATCH /api/projects/${P1}`]: { project: project(P1, "Lakeside 2030", "owner") },
    });
    window.history.replaceState(null, "", `/projects/${P1}/preferences`);
    render(<App />);
    const name = await screen.findByLabelText("Project name");
    fireEvent.change(name, { target: { value: "Lakeside 2030" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")?.body).toMatchObject({ name: "Lakeside 2030" });
  });
});

describe("user menu and settings", () => {
  it("shows Admin settings to Owners only", async () => {
    stubApi(owner);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Account and settings" }));
    expect(screen.getByRole("menuitem", { name: /Admin settings/ })).toBeTruthy();
    cleanup();
    stubApi(plainUser);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Account and settings" }));
    expect(screen.queryByRole("menuitem", { name: /Admin settings/ })).toBeNull();
    expect(screen.getByRole("menuitem", { name: /Connected agents/ })).toBeTruthy();
  });

  it("changes the language and saves it to the account", async () => {
    const calls = stubApi(owner);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Account and settings" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /User settings/ }));
    fireEvent.click(screen.getByRole("button", { name: /Language/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Nederlands/ }));
    expect(await screen.findByRole("heading", { name: "Taal" })).toBeTruthy();
    await waitFor(() =>
      expect(calls.find((c) => c.url === "/api/auth/preferences")?.body).toEqual({ language: "nl" }),
    );
  });

  it("uses the language saved on the account over the browser's", async () => {
    stubApi({ ...owner, user: { ...owner.user!, preferences: { language: "es" } } });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Proyectos" })).toBeTruthy();
  });

  it("applies larger touch targets", async () => {
    const calls = stubApi(owner);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Account and settings" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /App settings/ }));
    fireEvent.click(screen.getByRole("switch", { name: "Larger touch targets" }));
    expect(document.documentElement.classList.contains("larger-targets")).toBe(true);
    await waitFor(() =>
      expect(calls.find((c) => c.url === "/api/auth/preferences")?.body).toEqual({ largerTargets: true }),
    );
  });

  it("keeps existing railways off until the planner turns them on", async () => {
    const calls = stubApi(owner);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Account and settings" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /App settings/ }));
    const toggle = screen.getByRole("switch", { name: "Show existing railways from OpenStreetMap" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await waitFor(() =>
      expect(calls.find((c) => c.url === "/api/auth/preferences")?.body).toEqual({ existingRailways: true }),
    );
  });

  it("shows the setup wizard to the Owner and sends the CSRF token", async () => {
    const setupOwner = { ...owner, instance: { mode: "setup" as const, name: "MobSimLab" } };
    const calls = stubApi([setupOwner, { ...owner, instance: { mode: "open", name: "Köln" } }]);
    render(<App />);
    const input = await screen.findByLabelText("Instance name");
    fireEvent.change(input, { target: { value: "Köln" } });
    fireEvent.click(screen.getByText("Finish setup"));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Setup" })).toBeNull());
    const put = calls.find((c) => c.url === "/api/setup/instance");
    expect(put?.method).toBe("PUT");
    expect(put?.headers["X-CSRF-Token"]).toBe("csrf-123");
    expect(await screen.findByText("Köln")).toBeTruthy();
  });
});

describe("building blocks", () => {
  it("parses and prints routes", () => {
    expect(parseRoute("/")).toEqual({ page: "home" });
    expect(parseRoute(`/projects/${P1}/gis`)).toEqual({ page: "project", id: P1, tab: "gis", fresh: false });
    expect(parseRoute(`/projects/${P1}`, "?new=1")).toEqual({
      page: "project",
      id: P1,
      tab: "simulator",
      fresh: true,
    });
    expect(parseRoute(`/projects/${P1}/nope`)).toMatchObject({ tab: "simulator" });
    expect(parseRoute("/agents/consent")).toEqual({ page: "consent" });
    expect(routePath({ page: "project", id: P1, tab: "create", fresh: true })).toBe(
      `/projects/${P1}/create?new=1`,
    );
  });

  it("resolves the language from the choice and the browser", () => {
    expect(resolveLanguage("system", ["fr-CA", "en"])).toBe("fr");
    expect(resolveLanguage("system", ["ja", "nl-BE"])).toBe("nl");
    expect(resolveLanguage("system", ["ja"])).toBe("en");
    expect(resolveLanguage("de", ["fr"])).toBe("de");
    expect(resolveLanguage("xx", ["fr"])).toBe("en");
  });

  it("has every message translated and keeps placeholders", () => {
    for (const [lang, messages] of Object.entries(MESSAGES)) {
      for (const [key, text] of Object.entries(MESSAGES.en)) {
        const other = (messages as Record<string, string>)[key];
        expect(other, `${lang} ${key}`).toBeTruthy();
        const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
        expect(holes(other ?? ""), `${lang} ${key}`).toEqual(holes(text));
      }
    }
  });

  it("credits OpenStreetMap on the default basemap", () => {
    expect(DEFAULT_BASEMAP.attribution).toContain("OpenStreetMap contributors");
  });
});
