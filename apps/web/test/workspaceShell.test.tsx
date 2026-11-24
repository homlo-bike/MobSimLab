import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SavedDepot } from "../src/features/depots/types";
import type { RailEngine } from "../src/features/railways/types";
import type { SavedStreetLine } from "../src/features/street-lines/saved";
import type { Me } from "../src/session/api";
import { type CheckItem, ChecksProvider, usePublishChecks } from "../src/shell/checks";
import { ChecksMenu } from "../src/shell/ChecksMenu";
import { SettingsDialog } from "../src/shell/SettingsDialog";
import { OtherModesLayer } from "../src/workspace/OtherModesLayer";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Tool({ source, label, items }: { source: string; label: string; items: CheckItem[] }) {
  const elsewhere = usePublishChecks(source, label, items);
  return elsewhere ? null : <p>listed in the panel</p>;
}

describe("checks of every mode", () => {
  it("lists the open tools' checks under the bell, errors first, and keeps a closed tool's last checks", async () => {
    const show = vi.fn();
    function Page() {
      const [open, setOpen] = useState(true);
      return (
        <ChecksProvider>
          <ChecksMenu />
          <button type="button" onClick={() => setOpen(false)}>
            close tool
          </button>
          {open && (
            <Tool
              source="rail"
              label="Railway"
              items={[
                { severity: "warning", text: "Platform shorter than the train" },
                { severity: "error", text: "Radius below the minimum", onShow: show },
              ]}
            />
          )}
          <Tool
            source="street"
            label="Street line · Line 1"
            items={[{ severity: "info", text: "2 stops" }]}
          />
        </ChecksProvider>
      );
    }
    render(<Page />);
    // In a project the tools leave their checks to the bell.
    expect(screen.queryByText("listed in the panel")).toBeNull();
    const bell = await screen.findByRole("button", { name: "Checks: 1 errors, 1 warnings" });
    fireEvent.click(bell);
    const menu = screen.getByRole("menu", { name: "Checks" });
    const rail = within(menu).getByRole("list", { name: "Railway" });
    expect(rail.textContent).toMatch(/Radius below the minimum.*Platform shorter than the train/);
    expect(within(menu).getByRole("list", { name: "Street line · Line 1" }).textContent).toContain("2 stops");
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Radius below the minimum/ }));
    expect(show).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "close tool" }));
    fireEvent.click(screen.getByRole("button", { name: /Checks/ }));
    const again = screen.getByRole("menu", { name: "Checks" });
    expect(again.textContent).toContain("as when last open");
    expect(within(again).getByRole("list", { name: "Railway" }).textContent).toContain("Radius below");
    expect(within(again).queryByRole("menuitem", { name: /Radius below the minimum/ })).toBeNull();
  });

  it("opens a closed tool again from its check and shows the check once the tool reports it", async () => {
    const show = vi.fn();
    const reopened = vi.fn();
    function Page() {
      const [open, setOpen] = useState(true);
      return (
        <ChecksProvider
          onReopen={(source) => {
            reopened(source);
            setOpen(true);
          }}
        >
          <ChecksMenu />
          <button type="button" onClick={() => setOpen(false)}>
            close tool
          </button>
          {open && (
            <Tool
              source="rail"
              label="Railway"
              items={[{ severity: "error", text: "Radius below the minimum", onShow: show }]}
            />
          )}
        </ChecksProvider>
      );
    }
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "close tool" }));
    fireEvent.click(await screen.findByRole("button", { name: /Checks/ }));
    const menu = screen.getByRole("menu", { name: "Checks" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Radius below the minimum/ }));
    expect(reopened).toHaveBeenCalledWith("rail");
    await waitFor(() => expect(show).toHaveBeenCalledTimes(1));
  });

  it("leaves a tool on its own to list its checks itself", () => {
    render(<Tool source="rail" label="Railway" items={[{ severity: "error", text: "x" }]} />);
    expect(screen.getByText("listed in the panel")).toBeTruthy();
  });
});

/** A map that only keeps sources and layers, for the read-only layers of the other modes. */
function fakeMap() {
  const sources = new Map<string, { data: unknown; setData: (d: unknown) => void }>();
  const layers: string[] = [];
  const map = {
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, s: { data: unknown }) => {
      const src = { data: s.data, setData: (d: unknown) => (src.data = d) };
      sources.set(id, src);
    },
    removeSource: (id: string) => sources.delete(id),
    getLayer: (id: string) => (layers.includes(id) ? { id } : undefined),
    addLayer: (l: { id: string }) => layers.push(l.id),
    removeLayer: (id: string) => layers.splice(layers.indexOf(id), 1),
  };
  const features = (id: string) =>
    (sources.get(id)?.data as { features: { geometry: { type: string } }[] } | undefined)?.features ?? [];
  return { map: map as unknown as MapLibreMap, layers, features };
}

describe("other modes on the map", () => {
  const line = {
    name: "Line 1",
    profile: { mode: "bus" },
    view: {
      points: [
        { id: 1, kind: "end_stop", lonlat: [10, 50] },
        { id: 2, kind: "via", lonlat: [10.005, 50] },
        { id: 3, kind: "end_stop", lonlat: [10.01, 50] },
      ],
      legs: [
        {
          coords: [
            [10, 50],
            [10.01, 50],
          ],
          status: "ok",
        },
        {
          coords: [
            [10.01, 50],
            [10, 50],
          ],
          status: "ok",
        },
      ],
    },
  } as unknown as SavedStreetLine;
  const depot = {
    id: "d1",
    name: "North",
    modes: ["bus"],
    boundary: [
      [10, 50],
      [10.001, 50],
      [10.001, 50.001],
    ],
    gates: [],
    zones: [],
    layout: null,
  } as unknown as SavedDepot;

  it("draws the other modes faded under the tool in use, and not the tool's own drawing", async () => {
    const { map, layers, features } = fakeMap();
    const build = vi.fn(() => ({
      layers: {
        tracks: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {},
              geometry: {
                type: "LineString",
                coordinates: [
                  [10, 50],
                  [10.02, 50],
                ],
              },
            },
          ],
        },
        platforms: { type: "FeatureCollection", features: [] },
        rails: {
          type: "FeatureCollection",
          features: [0, 1].map((k) => ({
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: [
                [10, 50 + k * 1e-5],
                [10.02, 50 + k * 1e-5],
              ],
            },
          })),
        },
      },
    }));
    const engine = { build, dispose: () => {} } as unknown as RailEngine;
    const railway = { tracks: [{ id: 1 }], stations: [] } as never;
    const props = {
      map,
      railway,
      streetLines: [line],
      depots: [depot],
      pluginLines: {},
      loadRail: async () => engine,
    };
    const { rerender, unmount } = render(<OtherModesLayer {...props} active="street" />);
    expect(layers).toContain("om-rail-tracks");
    // The street tool draws its own lines; the railway and the depot show.
    expect(features("om-lines")).toHaveLength(0);
    expect(features("om-depots")).toHaveLength(1);
    await waitFor(() => expect(features("om-rail")).toHaveLength(1));
    // From zoom 16 the drawn tracks show rail by rail: the only rails on a street.
    expect(layers).toContain("om-rails");
    expect(features("om-rails")).toHaveLength(2);

    rerender(<OtherModesLayer {...props} active="rail" />);
    // In the railway tool the street line (routed legs and its two stops) shows, not the railway.
    expect(features("om-lines").map((f) => f.geometry.type)).toEqual([
      "LineString",
      "LineString",
      "Point",
      "Point",
    ]);
    await waitFor(() => expect(features("om-rail")).toHaveLength(0));

    rerender(<OtherModesLayer {...props} active="depots" />);
    expect(features("om-depots")).toHaveLength(0);
    unmount();
    expect(layers).toHaveLength(0);
  });
});

describe("Settings", () => {
  const me = (local: boolean, role = "owner"): Me => ({
    instance: { mode: "open", name: "MobSimLab", local },
    signInAvailable: !local,
    user: { id: "u1", role, email: null, displayName: "Local", preferences: {} },
    csrfToken: "csrf-1",
  });

  it("connects the desktop app on this computer to a server running in the background", () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    render(
      <SettingsDialog me={me(true)} section="user" preferences={{}} onChange={() => {}} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Server" }));
    fireEvent.change(screen.getByLabelText("Server address"), { target: { value: "http://localhost:8080" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(open).toHaveBeenCalledWith(
      "mobsimlab-desktop://connect?server=http%3A%2F%2Flocalhost%3A8080",
      "_blank",
    );
  });

  it("closes with Escape even when focus has left the dialog", () => {
    const onClose = vi.fn();
    render(
      <SettingsDialog me={me(false)} section="app" preferences={{}} onChange={() => {}} onClose={onClose} />,
    );
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("has no Server tab on a server, and no Plugins tab: plugins are managed in Administration", () => {
    render(
      <SettingsDialog me={me(false)} section="app" preferences={{}} onChange={() => {}} onClose={() => {}} />,
    );
    expect(screen.queryByRole("tab", { name: "Server" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Plugins" })).toBeNull();
    expect(screen.getByRole("tab", { name: "App settings" }).getAttribute("aria-selected")).toBe("true");
  });
});
