import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminPanel } from "../src/admin/AdminPanel";
import {
  activePlugins,
  findMode,
  PLUGINS,
  type Plugin,
  type ProjectPlugin,
  pluginsOfProject,
  pluginTools,
  setActivePlugins,
} from "../src/plugins/registry";
import { ProjectPlugins } from "../src/workspace/ProjectPlugins";

const contributes = {
  modes: ["Water taxi"],
  tools: ["Water taxi"],
  parameters: 1,
  calculations: [],
  mapLayers: [],
};
const taxiEntry: Plugin = {
  ...PLUGINS.find((p) => p.id === "org.mobsimlab.ferry")!,
  id: "org.example.water-taxi",
  name: "Water taxis",
  bundled: false,
  modes: [
    {
      id: "water_taxi",
      label: "Water taxi",
      family: "water",
      colour: "#0e7490",
      gtfsRouteType: 4,
      kit: "water-route",
      operation: "frequency",
    },
  ],
  contexts: [],
  tools: [{ id: "water-taxi", label: "Water taxi", kit: "water-route", modes: ["water_taxi"] }],
  calculations: [],
  mapLayers: [],
};
const row = (over: Partial<ProjectPlugin>): ProjectPlugin => ({
  id: "org.example.water-taxi",
  name: "Water taxis",
  description: "Small boats.",
  publisher: { name: "Example Transit Lab" },
  bundled: false,
  enabled: false,
  version: "1.1.0",
  versions: ["1.0.0", "1.1.0"],
  permissions: ["read:network"],
  contributes,
  missing: false,
  ...over,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setActivePlugins(PLUGINS);
});

describe("plugins per project (ADR-0036 §9)", () => {
  it("uses the bundled plugins the project kept and the installed ones it turned on", () => {
    const list: ProjectPlugin[] = [
      row({ id: "org.mobsimlab.ferry", name: "Ferries", bundled: true, enabled: false, versions: [] }),
      row({ enabled: true, entry: taxiEntry }),
    ];
    const active = pluginsOfProject(list);
    expect(active.map((p) => p.id)).not.toContain("org.mobsimlab.ferry");
    expect(active.map((p) => p.id)).toContain("org.mobsimlab.aerial-lift");
    expect(active.at(-1)?.id).toBe("org.example.water-taxi");
    setActivePlugins(active);
    expect(activePlugins()).toBe(active);
    expect(pluginTools().map((t) => t.id)).toEqual([
      "cable-car",
      "on-demand-bus",
      "people-mover",
      "water-taxi",
    ]);
    expect(findMode("water_taxi")?.mode.kit).toBe("water-route");
    expect(findMode("ferry")).toBeNull();
  });

  it("lets the Owner turn a plugin on with the chosen version, and shows it read-only to others", async () => {
    const onSet = vi.fn(async () => {});
    const { rerender } = render(<ProjectPlugins plugins={[row({})]} manage onSet={onSet} />);
    // A short list: the name opens the plugin's window with its details and version.
    expect(screen.queryByText("Uses: the project's network")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Water taxis/ }));
    const dialog = screen.getByRole("dialog", { name: "Water taxis" });
    expect(within(dialog).getByText("By Example Transit Lab · Version 1.1.0")).toBeTruthy();
    expect(within(dialog).getByText("Uses: the project's network")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("Version of Water taxis"), { target: { value: "1.0.0" } });
    await waitFor(() => expect(onSet).toHaveBeenCalledWith("org.example.water-taxi", false, "1.0.0"));
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Use Water taxis in this project" }));
    await waitFor(() => expect(onSet).toHaveBeenCalledWith("org.example.water-taxi", true, "1.1.0"));

    rerender(
      <ProjectPlugins plugins={[row({ missing: true, version: "0.9.0" })]} manage={false} onSet={onSet} />,
    );
    expect((screen.getByRole("switch") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/Version 0.9.0 was removed/)).toBeTruthy();
    expect(screen.getByText("Only the project's Owner can turn plugins on or off.")).toBeTruthy();

    // An Admin turned it off for the whole MobSimLab: off here too, and the Owner cannot turn it on.
    rerender(<ProjectPlugins plugins={[row({ enabled: false, instanceOff: true })]} manage onSet={onSet} />);
    expect((screen.getByRole("switch") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("Turned off for this MobSimLab by an administrator.")).toBeTruthy();
  });
});

describe("a plugin's window in Project preferences", () => {
  it("never shows a plugin's own settings: Esri's API key is only in Administration", () => {
    const esri = row({
      id: "org.mobsimlab.esri-imagery",
      name: "Esri World Imagery",
      bundled: true,
      versions: [],
    });
    render(<ProjectPlugins plugins={[esri]} manage onSet={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Esri World Imagery/ }));
    expect(screen.getByRole("dialog", { name: "Esri World Imagery" })).toBeTruthy();
    expect(screen.queryByLabelText("ArcGIS API key")).toBeNull();
  });
});

describe("Plugins tab of Administration", () => {
  it("checks an uploaded package, lists its problems, and adds a trusted key", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        let body: unknown = { ok: true };
        if (url.startsWith("/api/admin/users")) body = { users: [] };
        if (url === "/api/admin/plugins")
          body = { bundled: [], installed: [], keys: [], developmentMode: false, allowUnsigned: false };
        if (url === "/api/admin/basemaps")
          body = { esri: { configured: false, termsUrl: "https://esri.test" } };
        if (url === "/api/admin/plugins/inspect")
          body = {
            inspection: {
              plugin: null,
              signature: "unsigned",
              signer: null,
              sha256: "ab".repeat(32),
              problems: ["the package is not signed; ask the publisher for a signed package"],
            },
          };
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    render(<AdminPanel role="admin" userId="u1" csrfToken="csrf-1" onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "Plugins" }));
    fireEvent.click(await screen.findByRole("button", { name: "Install a plugin" }));
    const install = screen.getByRole("dialog", { name: "Install a plugin" });
    const file = new File([new Uint8Array([80, 75, 5, 6])], "taxi.msplugin");
    fireEvent.change(screen.getByLabelText("Choose a .msplugin file"), { target: { files: [file] } });
    expect((await screen.findByRole("alert")).textContent).toMatch(/not signed/);
    const inspect = calls.find((c) => c.url === "/api/admin/plugins/inspect");
    expect((inspect?.init?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/octet-stream",
    );
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
    fireEvent.click(within(install).getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByRole("button", { name: "Publishers and limits" }));

    fireEvent.change(screen.getByLabelText("Publisher name"), { target: { value: "Example Transit Lab" } });
    fireEvent.change(screen.getByLabelText("Public key"), {
      target: { value: "-----BEGIN PUBLIC KEY-----" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add key" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/admin/plugin-keys")).toBe(true));
    // Unsigned plugins are offered only in development mode.
    expect(screen.queryByText(/Allow unsigned plugins/)).toBeNull();
  });
});

describe("Plugin list of Administration", () => {
  const bundled = (id: string, name: string) => ({
    id,
    name,
    description: `${name} does things.`,
    version: "0.1.0",
    publisher: { name: "MobSimLab contributors" },
    license: "AGPL-3.0-or-later",
    dataLicense: "CC-BY-4.0",
    bundled: true,
    tiers: ["data"],
    permissions: [],
    contributes: { modes: [], tools: [], parameters: 0, calculations: [], mapLayers: [] },
    projects: 2,
  });

  it("lists each plugin with Configure and a switch that turns it off for the whole MobSimLab", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    let off: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        let body: unknown = { ok: true };
        if (url.startsWith("/api/admin/users")) body = { users: [] };
        if (url === "/api/admin/plugins")
          body = {
            bundled: [
              bundled("org.mobsimlab.panoramax", "Panoramax street photos"),
              bundled("org.mobsimlab.esri-imagery", "Esri World Imagery"),
            ],
            installed: [],
            keys: [],
            developmentMode: false,
            allowUnsigned: false,
            off,
          };
        if (url === "/api/admin/basemaps")
          body = { esri: { configured: false, termsUrl: "https://esri.test" } };
        if (url.endsWith("/enabled")) {
          off = JSON.parse(String(init?.body)).enabled ? [] : ["org.mobsimlab.panoramax"];
          body = { off };
        }
        if (url === "/api/basemaps") body = { available: [], layers: [] };
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    render(<AdminPanel role="admin" userId="u1" csrfToken="csrf-1" onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "Plugins" }));
    const sw = await screen.findByRole("switch", { name: "Use Panoramax street photos on this MobSimLab" });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    // Sorted by name, and Esri says it needs a key.
    const items = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(items[0]).toMatch(/^Esri World Imagery.*Needs an API key/);
    expect(items[1]).toMatch(/^Panoramax street photos/);

    fireEvent.click(sw);
    await waitFor(() => expect(sw.getAttribute("aria-checked")).toBe("false"));
    const put = calls.find((c) => c.url.endsWith("/enabled"))!;
    expect(put.url).toBe("/api/admin/plugins/org.mobsimlab.panoramax/enabled");
    expect(JSON.parse(String(put.init?.body))).toEqual({ enabled: false });
    expect(screen.getByText("Off in every project")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Configure Panoramax street photos" }));
    const dialog = screen.getByRole("dialog", { name: "Panoramax street photos" });
    expect(dialog.textContent).toMatch(/Panoramax street photos does things\./);
    expect(screen.getByRole("link", { name: /^Panoramax$/ }).getAttribute("href")).toBe(
      "https://panoramax.fr",
    );
    fireEvent.click(screen.getByRole("button", { name: "Accept changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
