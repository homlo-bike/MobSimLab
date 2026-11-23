import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project, ProjectsApi } from "../src/projects/api";
import { ProjectPreferences } from "../src/workspace/ProjectPreferences";
import type { PreferencesDoc } from "../src/workspace/preferences";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const project: Project = {
  id: "nav-test",
  name: "Riverside tram",
  description: "",
  areaName: "Riverside",
  modes: ["tram", "bus"],
  myRole: "owner",
  viaPublic: false,
  owner: { id: "u1", displayName: null },
  memberCount: 1,
  visibility: "private",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  archivedAt: null,
};
const api = { update: async () => project, valueHistory: async () => [] } as unknown as ProjectsApi;

/** The section headings a person sees now (hidden groups are left out). */
const headings = () => screen.queryAllByRole("heading", { level: 2 }).map((h) => h.textContent);

describe("Project preferences navigation", () => {
  it("shows one group at a time and keeps the others out of the way", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 503 })),
    );
    render(
      <ProjectPreferences api={api} project={project} onSaved={() => {}} preferences={{ values: {} }} />,
    );
    expect(headings()).toContain("Project");
    expect(headings()).toContain("Currency");
    expect(headings()).not.toContain("Design rules per mode");

    fireEvent.click(screen.getByRole("button", { name: "Network design" }));
    expect(screen.getByRole("button", { name: "Network design" }).getAttribute("aria-current")).toBe("true");
    expect(headings()).toEqual(expect.arrayContaining(["Design rules per mode", "Switches", "Stations"]));
    expect(headings()).not.toContain("Currency");
  });

  it("searches the text of every section, across the groups", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 503 })),
    );
    render(
      <ProjectPreferences api={api} project={project} onSaved={() => {}} preferences={{ values: {} }} />,
    );
    fireEvent.change(screen.getByLabelText("Search preferences"), {
      target: { value: "Background car traffic" },
    });
    expect(headings()).toContain("Road simulation");
    expect(headings()).not.toContain("Project");

    fireEvent.change(screen.getByLabelText("Search preferences"), { target: { value: "zzzz nothing" } });
    expect(screen.getByRole("status").textContent).toBe("Nothing matches “zzzz nothing”.");
  });
});

describe("Project preferences → Visuals", () => {
  it("sets the delays and colours of the simulation's vehicles in their own tab, and puts the defaults back", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 503 })),
    );
    const saved: PreferencesDoc[] = [];
    const { rerender } = render(
      <ProjectPreferences
        api={api}
        project={project}
        onSaved={() => {}}
        preferences={{ values: {} }}
        onPreferences={(d) => saved.push(d)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Visuals" }));
    expect(headings()).toEqual(["Vehicles in the simulation"]);
    expect((screen.getByLabelText("In service, on time") as HTMLInputElement).value).toBe("#16a34a");

    fireEvent.change(screen.getByLabelText("Late up to (minutes late); later is very late"), {
      target: { value: "5" },
    });
    expect(saved.at(-1)?.visuals).toEqual({ late_min: 5 });
    fireEvent.change(screen.getByLabelText("Parked in the depot"), { target: { value: "#AABBCC" } });
    expect(saved.at(-1)?.visuals).toEqual({ colors: { parked: "#aabbcc" } });

    rerender(
      <ProjectPreferences
        api={api}
        project={project}
        onSaved={() => {}}
        preferences={{ values: {}, visuals: { late_min: 5, colors: { parked: "#aabbcc" } } }}
        onPreferences={(d) => saved.push(d)}
      />,
    );
    expect((screen.getByLabelText("Parked in the depot") as HTMLInputElement).value).toBe("#aabbcc");
    for (const b of screen.getAllByRole("button", { name: "Use the default" })) fireEvent.click(b);
    expect(saved.at(-1)?.visuals).toEqual({ late_min: 5 });
  });
});
