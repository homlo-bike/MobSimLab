import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project, ProjectsApi } from "../src/projects/api";
import { SaveMslabDialog } from "../src/projects/ProjectDialogs";
import { ProjectPreferences } from "../src/workspace/ProjectPreferences";
import type { PreferencesDoc } from "../src/workspace/preferences";
import { SavedFilesSection, sizeText } from "../src/workspace/SavedFilesSection";
import {
  missingData,
  SAVED_DATA_IDS,
  type SavedDataRow,
  saveOptions,
  savedIn,
  withSaved,
} from "../src/workspace/savedFiles";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const project: Project = {
  id: "saved-files-test",
  name: "Riverside tram",
  description: "",
  areaName: "Riverside",
  modes: ["tram"],
  myRole: "owner",
  viaPublic: false,
  owner: { id: "u1", displayName: null },
  memberCount: 1,
  visibility: "private",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  archivedAt: null,
};

const rows: SavedDataRow[] = SAVED_DATA_IDS.map((id) => ({ id, bytes: 0, items: 0, at: null, sources: [] }));
const row = (id: SavedDataRow["id"]) => rows.find((r) => r.id === id)!;
Object.assign(row("design"), { bytes: 52_000, items: 4, at: "2026-11-20T10:00:00Z" });
Object.assign(row("runs"), { bytes: 3_400_000, items: 2, at: "2026-11-21T10:00:00Z" });
Object.assign(row("economy"), {
  bytes: 2_000,
  items: 3,
  at: "2026-11-22T10:00:00Z",
  sources: ["World Bank"],
});
Object.assign(row("facts"), { bytes: 1_000, items: 2, at: "2026-11-22T10:00:00Z", sources: ["Open-Meteo"] });

const item = (name: string) => screen.getByText(name).closest("li") as HTMLElement;

describe("saved file choices", () => {
  it("names the downloadable data a project does not have, but not what a job is still bringing in", () => {
    // The shared rows: location facts and economy figures are there; map, elevation and population are not.
    expect(missingData(rows)).toEqual(["osm", "elevation", "population"]);
    expect(missingData(rows, ["osm"])).toEqual(["elevation", "population"]);
    expect(missingData([])).toEqual(["osm", "elevation", "population", "facts", "economy"]);
  });

  it("saves everything but the viewer's map data unless the planner chooses otherwise", () => {
    expect(saveOptions(null)).toEqual({
      runs: true,
      map: false,
      results: true,
      vehicles: true,
      comments: true,
      history: true,
      fetched: {
        facts: true,
        economy: true,
        otherFetched: true,
        liveTiles: true,
        elevation: true,
        population: true,
        uploads: true,
        osm: true,
      },
    });
    const off = withSaved({ values: {} }, "runs", false);
    expect(saveOptions(off).runs).toBe(false);
    expect(saveOptions(withSaved({ values: {} }, "elevation", false)).fetched.elevation).toBe(false);
    // The drawings are always in the file.
    expect(savedIn(withSaved({ values: {} }, "design", false), "design")).toBe(true);
  });

  it("writes sizes in the language shown", () => {
    expect(sizeText(3_400_000, "en")).toBe("3.4 MB");
    expect(sizeText(52_000, "en")).toBe("52 kB");
  });
});

describe("Project preferences → Saved project files", () => {
  it("lists each kind of data with its size, source and date, and keeps the switches in the preferences", async () => {
    const api = { mslabContents: vi.fn(async () => rows) };
    const onPreferences = vi.fn();
    const onGo = vi.fn();
    render(
      <SavedFilesSection
        api={api}
        projectId="p1"
        preferences={{ values: {} }}
        editable
        onPreferences={onPreferences}
        onGo={onGo}
      />,
    );
    await waitFor(() =>
      expect(within(item("Simulation and demand runs (with OD matrices)")).getByText("3.4 MB")),
    );
    expect(api.mslabContents).toHaveBeenCalledWith("p1");
    const economy = item("Economic data (World Bank)");
    expect(within(economy).getByText("From World Bank")).toBeTruthy();
    expect(within(economy).getByText(/^Last updated /)).toBeTruthy();
    // The economy figures and the OpenStreetMap extract of the area are in saved files.
    expect(within(economy).queryByText(/coming in a later update/)).toBeNull();
    expect(
      within(item("OpenStreetMap data of the project area")).queryByText(/coming in a later update/),
    ).toBeNull();
    expect(within(item("History of changes")).getByText("None yet")).toBeTruthy();

    // The drawings cannot be left out.
    const design = screen.getByRole("switch", { name: "Include Drawings and settings in saved files" });
    expect((design as HTMLInputElement).disabled).toBe(true);

    fireEvent.click(
      screen.getByRole("switch", {
        name: "Include Simulation and demand runs (with OD matrices) in saved files",
      }),
    );
    expect(onPreferences).toHaveBeenCalledWith({ values: {}, savedFiles: { runs: false } });

    fireEvent.click(within(economy).getByRole("button", { name: "Update Economic data (World Bank)" }));
    expect(onGo).toHaveBeenCalledWith({ section: "currency" });
    fireEvent.click(
      within(item("Simulation and demand runs (with OD matrices)")).getByRole("button", { name: /^Update/ }),
    );
    expect(onGo).toHaveBeenCalledWith({ tab: "simulator" });
  });

  it("opens the Climate section from the Update link of the location facts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 503 })),
    );
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => setTimeout(() => f(0), 0));
    const api = {
      update: async () => project,
      valueHistory: async () => [],
      mslabContents: async () => rows,
    } as unknown as ProjectsApi;
    const onTab = vi.fn();
    render(
      <ProjectPreferences
        api={api}
        project={project}
        onSaved={() => {}}
        preferences={{ values: {} }}
        onPreferences={() => {}}
        onTab={onTab}
      />,
    );
    const facts = await waitFor(() => item("Location facts (country, holidays, climate)"));
    fireEvent.click(within(facts).getByRole("button", { name: /^Update/ }));
    expect(screen.getByRole("button", { name: "Calendar and climate" }).getAttribute("aria-current")).toBe(
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Project" }));
    fireEvent.click(
      within(await waitFor(() => item("Simulation and demand runs (with OD matrices)"))).getByRole("button", {
        name: /^Update/,
      }),
    );
    expect(onTab).toHaveBeenCalledWith("simulator");
  });
});

describe("Save as .mslab file", () => {
  it("starts from the Saved project files choices and leaves out what they leave out", async () => {
    const prefs: PreferencesDoc = {
      values: {},
      savedFiles: { runs: false, processed: false, vehicles: false, population: false },
    };
    const mslabUrl = vi.fn(() => "#mslab");
    const api = {
      drawings: async () => ({ preferences: { doc: prefs } }),
      mslabUrl,
    } as unknown as ProjectsApi;
    render(<SaveMslabDialog api={api} project={project} onClose={() => {}} />);
    const runs = screen.getByRole("checkbox", { name: /simulation runs/ }) as HTMLInputElement;
    await waitFor(() => expect(runs.checked).toBe(false));
    expect(
      (screen.getByRole("checkbox", { name: /results the tools worked out/ }) as HTMLInputElement).checked,
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Save file" }));
    expect(mslabUrl).toHaveBeenCalledWith(project.id, false, false, {
      results: false,
      vehicles: false,
      comments: true,
      history: true,
      fetched: {
        facts: true,
        economy: true,
        otherFetched: true,
        liveTiles: true,
        elevation: true,
        population: false,
        uploads: true,
        osm: true,
      },
    });

    // Without the downloaded data: every kind of it is left out.
    fireEvent.click(screen.getByRole("checkbox", { name: /Include downloaded data/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save file" }));
    expect(mslabUrl).toHaveBeenLastCalledWith(
      project.id,
      false,
      false,
      expect.objectContaining({
        fetched: {
          facts: false,
          economy: false,
          otherFetched: false,
          liveTiles: false,
          elevation: false,
          population: false,
          uploads: false,
          osm: false,
        },
      }),
    );
  });
});
