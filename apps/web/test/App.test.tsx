import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
import { loadMessages, MESSAGE_LANGUAGES, MESSAGES_EN } from "../src/i18n/messages";
import { LANGUAGES, resolveLanguage, translatePlural } from "../src/i18n/i18n";
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
const P4 = "55555555-5555-4555-8555-555555555555";
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
  viaPublic: false,
  owner: {
    id: myRole === "owner" ? "u1" : "u2",
    displayName: myRole === "owner" ? "Alice Smith" : "Ana Kovač",
  },
  memberCount: myRole === "owner" ? 1 : 3,
  visibility: "private",
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
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : (init?.body ?? undefined);
      calls.push({ url, method, body, headers: (init?.headers as Record<string, string>) ?? {} });
      const key = `${method} ${url}`;
      const reply = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
      if (key in overrides) return reply(overrides[key]);
      if (url === "/api/auth/me") return reply(mes[Math.min(i++, mes.length - 1)]);
      if (key === "GET /api/projects") return reply({ projects });
      if (key === "GET /api/projects?archived=true") return reply({ projects: [] });
      if (key === "GET /api/projects?public=true") return reply({ projects: [] });
      if (key === "POST /api/projects")
        return reply(
          {
            project: project(NEW, (body as { name: string }).name, "owner", {
              areaName: null,
              modes: (body as { modes: string[] }).modes,
            }),
          },
          201,
        );
      const one = /^\/api\/projects\/([0-9a-f-]{36})$/.exec(url);
      if (one && method === "GET") {
        const p = [
          ...projects,
          project(NEW, "Riverside tram study", "owner", { areaName: null, modes: ["bus", "tram", "metro"] }),
        ].find((x) => x.id === one[1]);
        return p ? reply({ project: p }) : reply({ message: "project not found" }, 404);
      }
      if (key === "PUT /api/auth/preferences") return reply({ preferences: body });
      return reply({ ok: true });
    }),
  );
  return calls;
}

// The app downloads each language and each screen when first shown. Load them once up front, so a slow first
// compile on a CI runner does not use up the time the tests give a screen to appear.
beforeAll(async () => {
  await Promise.all([
    ...MESSAGE_LANGUAGES.map(loadMessages),
    import("../src/workspace/Workspace"),
    import("../src/features/appraisal/AppraisalSection"),
    import("../src/features/benefits/BenefitTables"),
    import("../src/features/benefits/RegionEditor"),
    import("../src/features/calendar-run/CalendarRun"),
    import("../src/features/capacity/CapacityRun"),
    import("../src/features/cargo-bike/CargoBikeTab"),
    import("../src/features/costs/CostTables"),
    import("../src/features/demand/DemandSection"),
    import("../src/features/demand/ZoneEditor"),
    import("../src/features/depots/DepotEditor"),
    import("../src/features/fares/FareTables"),
    import("../src/features/journey-planner/JourneyPlanner"),
    import("../src/features/noise/NoiseMap"),
    import("../src/features/population/PopulationPanel"),
    import("../src/features/railways/RailwayEditor"),
    import("../src/features/road-sim/RoadSimulation"),
    import("../src/features/schematic/Schematic"),
    import("../src/features/street-lines/StreetLineEditor"),
    import("../src/features/street-setup/StreetSetupEditor"),
    import("../src/features/tables/NetworkTables"),
    import("../src/features/tables/Scenarios"),
    import("../src/features/timetables/TimetableTables"),
    import("../src/features/walk/WalkAnalysis"),
    import("../src/kits/SpanLineEditor"),
    import("../src/kits/WaterRouteEditor"),
    import("../src/kits/ZoneEditor"),
    import("../src/workspace/ProjectPreferences"),
    import("../src/admin/AdminPanel"),
    import("../src/agents/AgentsPanel"),
    import("../src/agents/ConsentPage"),
    import("../src/setup/SetupPanel"),
  ]);
}, 120_000);

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
    await waitFor(() => expect(document.documentElement.lang).toBe("de"));
    fireEvent.click(screen.getByRole("button", { name: /Deutsch \(vom Gerät\)/ }));
    // The menu says translations are machine-made and links to the message files on GitHub.
    expect(screen.getByRole("link", { name: /Übersetzungen zu verbessern/ }).getAttribute("href")).toMatch(
      /^https:\/\/github\.com\/homlo-bike\/MobSimLab\/.*i18n$/,
    );
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Français" }));
    expect(await screen.findByRole("heading", { name: "Se connecter" })).toBeTruthy();
    expect(window.localStorage.getItem("mobsimlab.language")).toBe("fr");
  });

  it("lays the page out right to left in Arabic and back again", async () => {
    languages = ["ar-EG", "en"];
    stubApi(signedOut);
    render(<App />);
    expect(await screen.findByRole("heading", { name: "تسجيل الدخول" })).toBeTruthy();
    await waitFor(() => expect(document.documentElement.lang).toBe("ar"));
    expect(document.documentElement.dir).toBe("rtl");
    fireEvent.click(screen.getByRole("button", { name: /العربية \(من الجهاز\)/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "中文（简体）" }));
    expect(await screen.findByRole("heading", { name: "登录" })).toBeTruthy();
    await waitFor(() => expect(document.documentElement.dir).toBe("ltr"));
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
    expect(items).toEqual([
      "Open",
      "Rename",
      "Share",
      "Duplicate",
      "Save as .mslab file",
      "Archive",
      "Delete…",
    ]);
    fireEvent.keyDown(menu, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Actions for City-wide 2030" }));
    const viewer = screen.getByRole("menu", { name: "Actions for City-wide 2030" });
    expect(
      within(viewer)
        .getAllByRole("menuitem")
        .map((b) => b.textContent),
    ).toEqual(["Open", "Manage access", "Duplicate", "Save as .mslab file"]);
  });

  it("saves a project as a .mslab file, with its runs when asked", async () => {
    stubApi(owner);
    render(<App />);
    fireEvent.contextMenu(await screen.findByText("Lakeside network"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Save as .mslab file" }));
    const dlg = screen.getByRole("dialog", { name: "Save as .mslab file" });
    fireEvent.click(within(dlg).getByLabelText(/Include saved simulation runs/));
    const clicked: HTMLAnchorElement[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });
    fireEvent.click(within(dlg).getByRole("button", { name: "Save file" }));
    click.mockRestore();
    expect(clicked.map((a) => [a.getAttribute("href"), a.hasAttribute("download")])).toEqual([
      [`/api/projects/${P1}/mslab?runs=true`, true],
    ]);
    expect(screen.queryByRole("dialog", { name: "Save as .mslab file" })).toBeNull();
  });

  it("opens a .mslab file as a new project and says what was left out", async () => {
    const calls = stubApi(owner, {
      "POST /api/projects/import": {
        project: project(NEW, "Lakeside tram", "owner"),
        skipped: ["plugin com.example.missing 1.0.0: not installed on this MobSimLab"],
      },
    });
    const { container } = render(<App />);
    await screen.findByText("Lakeside network");
    const input = container.querySelector<HTMLInputElement>('input[type="file"][accept=".mslab"]')!;
    const file = new File([new Uint8Array([0x50, 0x4b, 3, 4])], "lakeside.mslab");
    fireEvent.change(input, { target: { files: [file] } });
    expect(
      await screen.findByText(
        "Opened “Lakeside tram” as a new project. Left out: plugin com.example.missing 1.0.0: not installed on this MobSimLab",
      ),
    ).toBeTruthy();
    const call = calls.find((c) => c.url === "/api/projects/import")!;
    expect(call.method).toBe("POST");
    expect(call.body).toBe(file);
    expect(call.headers["Content-Type"]).toBe("application/octet-stream");
    expect(call.headers["X-CSRF-Token"]).toBe("csrf-123");
    expect(
      within(screen.getByRole("region", { name: "My projects" })).getByText("Lakeside tram"),
    ).toBeTruthy();
  });

  it("lists public projects on their own shelf, read-only", async () => {
    const open = project(P4, "Harbour ferries", "viewer", { viaPublic: true, visibility: "public" });
    stubApi(owner, { "GET /api/projects?public=true": { projects: [open] } });
    render(<App />);
    const shelf = await screen.findByRole("region", { name: "Public projects" });
    expect(within(shelf).getByText("Harbour ferries")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Public projects · 1" })).toBeTruthy();
    // Not a member: no copy and no look at who has access.
    fireEvent.click(screen.getByRole("button", { name: "Actions for Harbour ferries" }));
    const menu = screen.getByRole("menu", { name: "Actions for Harbour ferries" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((b) => b.textContent),
    ).toEqual(["Open"]);
  });

  it("makes a project public only after the licence notice, and private again", async () => {
    const calls = stubApi(owner, {
      [`GET /api/projects/${P1}/members`]: {
        members: [{ userId: "u1", displayName: "Alice Smith", email: "alice@example.org", role: "owner" }],
      },
      [`PUT /api/projects/${P1}/visibility`]: {
        project: project(P1, "Lakeside network", "owner", { visibility: "public" }),
      },
    });
    render(<App />);
    fireEvent.contextMenu(await screen.findByText("Lakeside network"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Share" }));
    const dlg = screen.getByRole("dialog", { name: "Share “Lakeside network”" });
    expect(within(dlg).getByText("Private: only the people above can open it")).toBeTruthy();
    fireEvent.click(within(dlg).getByRole("button", { name: "Make public" }));
    const notice = within(dlg).getByRole("group", { name: "Before you make it public" });
    expect(notice.textContent).toMatch(/Open Database License \(ODbL\)/);
    expect(calls.some((c) => c.url.endsWith("/visibility"))).toBe(false);
    fireEvent.click(within(notice).getByRole("button", { name: "I understand, make it public" }));
    expect(await within(dlg).findByRole("button", { name: "Make private" })).toBeTruthy();
    expect(calls.find((c) => c.url === `/api/projects/${P1}/visibility`)?.body).toEqual({
      visibility: "public",
      licenceAccepted: true,
    });
    expect(within(dlg).getByText(/anyone signed in to this MobSimLab can find it/)).toBeTruthy();
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
    ).toEqual(["Simulator", "Create", "Schematic", "GIS", "Tables", "Preferences", "Cargo bike"]);
    fireEvent.click(within(nav).getByRole("link", { name: "Create" }));
    // The project plans trams only: Create offers the rail tools and no street route.
    expect(await screen.findByRole("complementary", { name: "Rail route" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Street route" })).toBeNull();
    expect(screen.queryByRole("toolbar", { name: "Street line tools" })).toBeNull();
    fireEvent.click(within(nav).getByRole("link", { name: "Tables" }));
    expect(screen.getByRole("region", { name: "Tables" })).toBeTruthy();
    // The tables come in groups, one shown at a time, chosen from a side panel like Project preferences; the open
    // group lists its sections, also one shown at a time.
    const tablesNav = await screen.findByRole("navigation", { name: "Tables" });
    const groups = within(tablesNav)
      .getAllByRole("button")
      .filter((b) => b.id.startsWith("tables-tab-"));
    expect(groups.map((x) => x.textContent)).toEqual([
      "Summary",
      "Timetables",
      "Construction and operating costs",
      "Economic and social benefits",
      "Demand model",
      "Fare revenue",
      "Appraisal",
      "Compare scenarios",
    ]);
    const group = (name: string) => groups.find((b) => b.textContent === name)!;
    expect(group("Summary").getAttribute("aria-current")).toBe("true");
    const summaryParts = within(tablesNav).getAllByRole("list", { name: "Summary" })[0]!;
    expect(
      within(summaryParts)
        .getAllByRole("button")
        .map((x) => x.textContent),
    ).toEqual(["Overview", "Infrastructure quantities", "Service and fleet", "Energy and emissions"]);

    fireEvent.click(group("Construction and operating costs"));
    expect(group("Construction and operating costs").getAttribute("aria-current")).toBe("true");
    const costParts = within(tablesNav).getAllByRole("list", {
      name: "Construction and operating costs",
    })[0]!;
    expect(
      within(costParts)
        .getAllByRole("button")
        .map((x) => x.textContent),
    ).toEqual([
      "Overview",
      "Construction by infrastructure type",
      "Operating cost a year",
      "Prices and unit costs",
    ]);
    expect(within(costParts).getByRole("button", { name: "Overview" }).getAttribute("aria-current")).toBe(
      "true",
    );
    fireEvent.click(within(costParts).getByRole("button", { name: "Prices and unit costs" }));
    expect(
      within(costParts).getByRole("button", { name: "Prices and unit costs" }).getAttribute("aria-current"),
    ).toBe("true");
    expect(
      within(costParts).getByRole("button", { name: "Overview" }).getAttribute("aria-current"),
    ).toBeNull();

    fireEvent.click(group("Compare scenarios"));
    expect(group("Compare scenarios").getAttribute("aria-current")).toBe("true");
    expect((document.getElementById("tables-network") as HTMLElement).hidden).toBe(true);
    expect((document.getElementById("tables-scenarios") as HTMLElement).hidden).toBe(false);
  });

  it("shows view-only projects without the editing tools", async () => {
    stubApi(owner);
    window.history.replaceState(null, "", `/projects/${P3}/create`);
    render(<App />);
    expect(await screen.findByText(/You can look at this project but not change it/)).toBeTruthy();
    expect(screen.queryByRole("toolbar", { name: "Street line tools" })).toBeNull();
  });

  it("tells a Commenter they can comment, not only view", async () => {
    const P5 = "66666666-6666-4666-8666-666666666666";
    projects.push(project(P5, "Shared for comments", "commenter"));
    try {
      stubApi(owner);
      window.history.replaceState(null, "", `/projects/${P5}/create`);
      render(<App />);
      expect(
        await screen.findByText(/comment on its stations, tracks, lines and depots, but not change/),
      ).toBeTruthy();
      expect(screen.getAllByText("Can comment").length).toBeGreaterThan(0);
      expect(screen.queryByText(/You can look at this project but not change it/)).toBeNull();
    } finally {
      projects.pop();
    }
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

  it("reopens Create on the drawn railway after a reload, not on the chooser", async () => {
    const rail = {
      kind: "railway",
      schemaVersion: 1,
      doc: { mode: "tram", origin: [7, 50], stations: [{ id: 1 }], tracks: [], switches: [], signals: [] },
      version: 2,
      updatedAt: "2026-11-03T10:00:00Z",
      updatedBy: { id: "u1", displayName: "Alice Smith" },
    };
    stubApi(owner, { [`GET /api/projects/${P1}/drawings`]: { drawings: { railway: rail } } });
    // The address still says the project is new (a reload right after creating it).
    window.history.replaceState(null, "", `/projects/${P1}/create?new=1`);
    render(<App />);
    expect(await screen.findByRole("complementary", { name: "Rail route" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "What do you want to build first?" })).toBeNull();
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

  it("changes the delay in traffic for the project and goes back to the library value", async () => {
    const saved = (values: Record<string, number>, version: number) => ({
      drawing: {
        kind: "preferences",
        schemaVersion: 1,
        doc: { values },
        version,
        updatedAt: "2026-11-08T10:00:00Z",
        updatedBy: { id: "u1", displayName: "Alice Smith" },
      },
    });
    const calls = stubApi(owner, {
      [`GET /api/projects/${P1}/drawings`]: { drawings: {} },
      [`PUT /api/projects/${P1}/drawings/preferences`]: saved({ "street.mixed_traffic_delay_share": 0.4 }, 1),
    });
    window.history.replaceState(null, "", `/projects/${P1}/preferences`);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Demand and traffic" }));
    const mixed = await screen.findByLabelText("In a main road's general traffic");
    expect((mixed as HTMLInputElement).value).toBe("25");
    expect(screen.getByText("Assumption library: 8 %")).toBeTruthy();
    fireEvent.change(mixed, { target: { value: "40" } });
    await waitFor(
      () =>
        expect(calls.find((c) => c.method === "PUT" && c.url.endsWith("/drawings/preferences"))).toBeTruthy(),
      { timeout: 3000 },
    );
    expect(calls.find((c) => c.url.endsWith("/drawings/preferences"))?.body).toEqual({
      doc: { values: { "street.mixed_traffic_delay_share": 0.4 } },
      baseVersion: null,
    });
    fireEvent.click(screen.getByRole("button", { name: "Use the library value" }));
    expect((mixed as HTMLInputElement).value).toBe("25");
    expect(screen.queryByRole("button", { name: "Use the library value" })).toBeNull();
  });
  it("sets the road simulation's off-peak traffic share", async () => {
    const calls = stubApi(owner, {
      [`GET /api/projects/${P1}/drawings`]: { drawings: {} },
      [`PUT /api/projects/${P1}/drawings/preferences`]: {
        drawing: {
          kind: "preferences",
          schemaVersion: 1,
          doc: { values: { "road.off_peak_traffic_share": 0.5 } },
          version: 1,
          updatedAt: "2026-11-16T10:00:00Z",
          updatedBy: { id: "u1", displayName: "Alice Smith" },
        },
      },
    });
    window.history.replaceState(null, "", `/projects/${P1}/preferences`);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Demand and traffic" }));
    const share = await screen.findByLabelText(
      "Traffic outside the morning and evening peaks, as a share of each street's peak",
    );
    expect((share as HTMLInputElement).value).toBe("60");
    fireEvent.change(share, { target: { value: "150" } });
    fireEvent.change(share, { target: { value: "50" } });
    await waitFor(
      () =>
        expect(calls.find((c) => c.method === "PUT" && c.url.endsWith("/drawings/preferences"))).toBeTruthy(),
      { timeout: 3000 },
    );
    expect(calls.find((c) => c.url.endsWith("/drawings/preferences"))?.body).toEqual({
      doc: { values: { "road.off_peak_traffic_share": 0.5 } },
      baseVersion: null,
    });
  });
  it("leaves a catalogue vehicle out of the project and uses all again", async () => {
    const calls = stubApi(owner, {
      [`GET /api/projects/${P1}/drawings`]: { drawings: {} },
      [`PUT /api/projects/${P1}/drawings/preferences`]: {
        drawing: {
          kind: "preferences",
          schemaVersion: 1,
          doc: { values: {}, vehiclesOff: ["siemens_avenio-munich-4-car"] },
          version: 1,
          updatedAt: "2026-11-16T10:00:00Z",
          updatedBy: { id: "u1", displayName: "Alice Smith" },
        },
      },
    });
    window.history.replaceState(null, "", `/projects/${P1}/preferences`);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Vehicles and fleet" }));
    const section = await screen.findByRole("region", { name: "Vehicles" });
    // The project plans for trams, so its trams show first, all in use.
    expect((within(section).getByLabelText("Mode") as HTMLSelectElement).value).toBe("tram");
    const avenio = within(section).getByRole("checkbox", { name: /Siemens Avenio/ }) as HTMLInputElement;
    expect(avenio.checked).toBe(true);
    fireEvent.click(avenio);
    await waitFor(
      () =>
        expect(calls.find((c) => c.method === "PUT" && c.url.endsWith("/drawings/preferences"))).toBeTruthy(),
      { timeout: 3000 },
    );
    expect(calls.find((c) => c.url.endsWith("/drawings/preferences"))?.body).toEqual({
      doc: { values: {}, vehiclesOff: ["siemens_avenio-munich-4-car"] },
      baseVersion: null,
    });
    expect(avenio.checked).toBe(false);
    fireEvent.click(within(section).getByRole("button", { name: "Use all" }));
    expect(avenio.checked).toBe(true);
  });

  it("leaves a turnout out of the project and chooses its default turnout", async () => {
    const calls = stubApi(owner, {
      [`GET /api/projects/${P1}/drawings`]: { drawings: {} },
      [`PUT /api/projects/${P1}/drawings/preferences`]: {
        drawing: {
          kind: "preferences",
          schemaVersion: 1,
          doc: { values: {} },
          version: 1,
          updatedAt: "2026-11-16T10:00:00Z",
          updatedBy: { id: "u1", displayName: "Alice Smith" },
        },
      },
    });
    window.history.replaceState(null, "", `/projects/${P1}/preferences`);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Network design" }));
    const section = await screen.findByRole("region", { name: "Switches" });
    const r50 = within(section).getByRole("checkbox", { name: /turnout R 50 m/ }) as HTMLInputElement;
    // The library's tram default stays in use.
    expect(r50.disabled).toBe(true);
    const defaults = within(section).getAllByRole("radio", { name: "Default" }) as HTMLInputElement[];
    const r100 = defaults.find((r) => r.closest("li")?.textContent?.includes("turnout R 100 m"))!;
    fireEvent.click(r100);
    expect(r100.checked).toBe(true);
    expect(r50.disabled).toBe(false);
    fireEvent.click(r50);
    await waitFor(
      () =>
        expect(
          calls.filter((c) => c.method === "PUT" && c.url.endsWith("/drawings/preferences")).length,
        ).toBeGreaterThan(0),
      { timeout: 3000 },
    );
    expect(r50.checked).toBe(false);
  });

  it("changes any library parameter for all modes or one mode, and goes back to the library value", async () => {
    const calls = stubApi(owner, {
      [`GET /api/projects/${P1}/drawings`]: { drawings: {} },
      [`PUT /api/projects/${P1}/drawings/preferences`]: {
        drawing: {
          kind: "preferences",
          schemaVersion: 1,
          doc: { values: { "mode.dwell_s": 40 } },
          version: 1,
          updatedAt: "2026-11-16T10:00:00Z",
          updatedBy: { id: "u1", displayName: "Alice Smith" },
        },
      },
    });
    window.history.replaceState(null, "", `/projects/${P1}/preferences`);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Assumptions" }));
    const params = await screen.findByRole("region", { name: "All parameters" });
    expect((within(params).getByLabelText("Group") as HTMLSelectElement).value).toBe("Modes");
    const dwell = within(params).getByLabelText("Dwell time at a stop") as HTMLInputElement;
    expect(dwell.value).toBe("30");
    fireEvent.change(dwell, { target: { value: "40" } });
    await waitFor(
      () =>
        expect(calls.find((c) => c.method === "PUT" && c.url.endsWith("/drawings/preferences"))).toBeTruthy(),
      { timeout: 3000 },
    );
    expect(calls.find((c) => c.url.endsWith("/drawings/preferences"))?.body).toEqual({
      doc: { values: { "mode.dwell_s": 40 } },
      baseVersion: null,
    });
    // For one mode, the value for all modes shows until the mode gets its own.
    fireEvent.change(within(params).getByLabelText("Mode"), { target: { value: "tram" } });
    const tramDwell = within(params).getByLabelText("Dwell time at a stop") as HTMLInputElement;
    expect(tramDwell.value).toBe("40");
    expect(params.textContent).toContain("your value for all modes");
    // An enum parameter offers its options.
    const row = within(params).getByLabelText(
      "Structure and right of way (category A, B or C)",
    ) as HTMLSelectElement;
    expect(row.value).toBe("C");
    fireEvent.change(within(params).getByLabelText("Mode"), { target: { value: "*" } });
    fireEvent.click(within(params).getByRole("button", { name: "Use the library value" }));
    expect((within(params).getByLabelText("Dwell time at a stop") as HTMLInputElement).value).toBe("30");
  });

  it("shows the assumptions report with the changed values, and exports it as CSV or for printing", async () => {
    stubApi(owner, {
      [`GET /api/projects/${P1}/drawings`]: {
        drawings: {
          preferences: {
            kind: "preferences",
            schemaVersion: 1,
            doc: { values: { "mode.dwell_s.tram": 45 }, reasons: { "mode.dwell_s.tram": "Busy stops" } },
            version: 1,
            updatedAt: "2026-11-16T10:00:00Z",
            updatedBy: { id: "u1", displayName: "Alice Smith" },
          },
        },
      },
      [`GET /api/projects/${P1}/value-history?limit=500`]: {
        history: [
          {
            seq: 3,
            id: "mode.dwell_s.tram",
            kind: "changed",
            before: { value: null, reason: null },
            after: { value: 45, reason: "Busy stops" },
            reason: "Busy stops",
            at: "2026-11-16T09:00:00Z",
            by: { id: "u1", displayName: "Alice Smith" },
          },
        ],
      },
    });
    const blobs: Blob[] = [];
    const createObjectURL = vi.fn((b: Blob) => {
      blobs.push(b);
      return "blob:report";
    });
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const print = vi.fn();
    vi.stubGlobal("print", print);
    window.history.replaceState(null, "", `/projects/${P1}/preferences`);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Assumptions" }));
    const report = await screen.findByRole("region", { name: "Assumptions report" });
    await within(report).findByRole("button", { name: "Download CSV" });
    // The project uses trams: dwell time shows for all modes and for trams, the tram value marked as changed.
    await waitFor(() => expect(report.textContent).toContain("45 s"));
    expect(within(report).getAllByText("changed").length).toBe(1);
    expect(report.textContent).toContain("Reason: Busy stops");
    await waitFor(() => expect(report.textContent).toContain("Changed by Alice Smith on"), { timeout: 4000 });
    fireEvent.click(within(report).getByLabelText("Changed values only"));
    expect(within(report).getAllByText(/Dwell time at a stop/).length).toBe(1);
    fireEvent.change(within(report).getByLabelText("Group"), { target: { value: "Cost" } });
    expect(report.textContent).toContain("No value in this group is changed.");
    expect(report.textContent).toContain("Other choices");
    fireEvent.click(within(report).getByRole("button", { name: "Download CSV" }));
    expect(createObjectURL).toHaveBeenCalled();
    const csv = await blobs[0]!.text();
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toContain("Group,Parameter,Id,Mode,Value used");
    expect(lines.some((l) => l.includes("mode.dwell_s,Tram,45,s,Yes"))).toBe(true);
    expect(lines.find((l) => l.includes("mode.dwell_s,Tram,45"))).toMatch(
      /,Busy stops,Alice Smith,2026-11-16$/,
    );
    // Changed values only: the export follows the filter.
    expect(lines.filter((l) => l.includes(",Yes,")).length).toBe(1);
    fireEvent.click(within(report).getByRole("button", { name: "Print or save as PDF" }));
    expect(print).toHaveBeenCalled();
    expect(document.querySelector(".print-report")?.textContent).toContain("Dwell time at a stop");
  });

  it("changes a design rule for one rail mode and goes back to the library value", async () => {
    const calls = stubApi(owner, {
      [`GET /api/projects/${P1}/drawings`]: { drawings: {} },
      [`PUT /api/projects/${P1}/drawings/preferences`]: {
        drawing: {
          kind: "preferences",
          schemaVersion: 1,
          doc: { values: { "mode.min_curve_radius_m.tram": 25 } },
          version: 1,
          updatedAt: "2026-11-16T10:00:00Z",
          updatedBy: { id: "u1", displayName: "Alice Smith" },
        },
      },
    });
    window.history.replaceState(null, "", `/projects/${P1}/preferences`);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Network design" }));
    const rules = await screen.findByRole("region", { name: "Design rules per mode" });
    // The project plans for trams, so tram rules show first.
    expect((within(rules).getByLabelText("Rail mode") as HTMLSelectElement).value).toBe("tram");
    const radius = within(rules).getByLabelText("Curve radius, minimum") as HTMLInputElement;
    expect(radius.value).toBe("20");
    fireEvent.change(radius, { target: { value: "25" } });
    await waitFor(
      () =>
        expect(calls.find((c) => c.method === "PUT" && c.url.endsWith("/drawings/preferences"))).toBeTruthy(),
      { timeout: 3000 },
    );
    expect(calls.find((c) => c.url.endsWith("/drawings/preferences"))?.body).toEqual({
      doc: { values: { "mode.min_curve_radius_m.tram": 25 } },
      baseVersion: null,
    });
    // Metro keeps the library's value.
    fireEvent.change(within(rules).getByLabelText("Rail mode"), { target: { value: "metro" } });
    expect((within(rules).getByLabelText("Curve radius, minimum") as HTMLInputElement).value).toBe("100");
    fireEvent.change(within(rules).getByLabelText("Rail mode"), { target: { value: "tram" } });
    fireEvent.click(within(rules).getByRole("button", { name: "Use the library value" }));
    expect((within(rules).getByLabelText("Curve radius, minimum") as HTMLInputElement).value).toBe("20");
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

  it("switches to dark mode and saves the choice to the account", async () => {
    const calls = stubApi(owner);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Account and settings" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /App settings/ }));
    const group = screen.getByRole("radiogroup", { name: "Appearance" });
    expect(within(group).getByRole("radio", { name: "System" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(group).getByRole("radio", { name: "Dark" }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
    await waitFor(() =>
      expect(calls.find((c) => c.url === "/api/auth/preferences")?.body).toEqual({ theme: "dark" }),
    );
    fireEvent.click(within(group).getByRole("radio", { name: "Light" }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("opens in the theme saved on the account", async () => {
    stubApi({ ...owner, user: { ...owner.user!, preferences: { theme: "dark" } } });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Projects" })).toBeTruthy();
    await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));
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
    const calls = stubApi([setupOwner, { ...owner, instance: { mode: "open", name: "Köln" } }], {
      "GET /api/admin/registration": {
        autoRegistration: false,
        defaultRole: "viewer",
        allowedEmailDomains: ["example.org"],
        allowedGroups: [],
      },
      "GET /api/admin/group-mappings": {
        mappings: [{ id: "m1", group: "planners", role: "user", issuer: null }],
      },
      "GET /api/admin/plugins": {
        bundled: [
          {
            id: "org.mobsimlab.esri-imagery",
            name: "Esri World Imagery",
            description: "Aerial imagery",
            version: "1.0.0",
            bundled: true,
            publisher: { name: "MobSimLab contributors" },
            projects: 0,
            contributes: {
              modes: [],
              tools: [],
              calculations: [],
              mapLayers: [],
              basemaps: ["Esri World Imagery"],
            },
          },
        ],
        installed: [],
        keys: [],
        developmentMode: false,
        allowUnsigned: false,
      },
      "GET /api/admin/basemaps": {
        esri: { configured: false, keyEnd: null, termsAcceptedAt: null, termsAcceptedBy: null, termsUrl: "" },
      },
    });
    render(<App />);
    const input = await screen.findByLabelText("Instance name");
    expect(screen.getByText(/Step 1 of 3/)).toBeTruthy();
    fireEvent.change(input, { target: { value: "Köln" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    // Step 2: the sign-up rules and group mappings of Administration.
    expect(await screen.findByText(/Step 2 of 3/)).toBeTruthy();
    expect(await screen.findByLabelText("Allowed e-mail domains")).toBeTruthy();
    expect(screen.getByText("planners")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    // Step 3: the basemaps that need an Admin.
    expect(await screen.findByText(/Step 3 of 3/)).toBeTruthy();
    expect(await screen.findByText("Needs an API key")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Configure Esri World Imagery" })).toBeTruthy();
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
    // A tab a plugin may add is kept; the workspace falls back to the simulator when the project has no such tab.
    expect(parseRoute(`/projects/${P1}/nope`)).toMatchObject({ tab: "nope" });
    expect(parseRoute(`/projects/${P1}/Nope`)).toEqual({ page: "home" });
    expect(parseRoute("/agents/consent")).toEqual({ page: "consent" });
    expect(routePath({ page: "project", id: P1, tab: "create", fresh: true })).toBe(
      `/projects/${P1}/create?new=1`,
    );
  });

  it("resolves the language from the choice and the browser", () => {
    expect(resolveLanguage("system", ["fr-CA", "en"])).toBe("fr");
    expect(resolveLanguage("system", ["th", "nl-BE"])).toBe("nl");
    expect(resolveLanguage("system", ["th"])).toBe("en");
    expect(resolveLanguage("de", ["fr"])).toBe("de");
    expect(resolveLanguage("xx", ["fr"])).toBe("en");
    expect(resolveLanguage("system", ["zh-CN"])).toBe("zh");
    expect(resolveLanguage("system", ["pt-BR"])).toBe("pt");
  });

  it("has every message translated and keeps placeholders", async () => {
    // Every language in the picker has its own messages file.
    expect([...MESSAGE_LANGUAGES].sort()).toEqual(LANGUAGES.map((l) => l.tag).sort());
    for (const lang of MESSAGE_LANGUAGES) {
      const messages = await loadMessages(lang);
      for (const [key, text] of Object.entries(MESSAGES_EN)) {
        // Plural forms other than `other` are optional: each language has the forms its grammar needs.
        if (/\.(zero|one|two|few|many)$/.test(key)) continue;
        const other = (messages as Record<string, string>)[key];
        expect(other, `${lang} ${key}`).toBeTruthy();
        const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
        expect(holes(other ?? ""), `${lang} ${key}`).toEqual(holes(text));
      }
    }
  });

  it("picks the plural form the language needs", async () => {
    await Promise.all(["ru", "ar", "zh"].map(loadMessages));
    expect(translatePlural("en", "rail.stations", 1)).toBe("1 station");
    expect(translatePlural("en", "rail.stations", 1200)).toBe("1,200 stations");
    expect(translatePlural("ru", "rail.stations", 1)).toBe("1 станция");
    expect(translatePlural("ru", "rail.stations", 3)).toBe("3 станции");
    expect(translatePlural("ru", "rail.stations", 5)).toBe("5 станций");
    expect(translatePlural("ar", "rail.stations", 2)).toBe("محطتان");
    expect(translatePlural("zh", "rail.stations", 2)).toBe("2 个车站");
  });

  it("credits OpenStreetMap on the default basemap", () => {
    expect(DEFAULT_BASEMAP.attribution).toContain("OpenStreetMap contributors");
  });
});
