import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GeodataApi, GeodataStatus } from "../src/features/geodata/api";
import { ImportsWatcher } from "../src/features/geodata/ImportsWatcher";
import type { PopulationApi, PopulationLayer, PopulationOverview } from "../src/features/population/api";
import { JobsBar, JobsProvider } from "../src/shell/jobs";
import type { FetchedClimate, MonthClimate } from "../src/workspace/climate";
import { ClimateKeeper } from "../src/workspace/ClimateKeeper";
import type { PreferencesDoc } from "../src/workspace/preferences";

afterEach(cleanup);

const idleGeo = {
  osm: { latest: null },
  dem: { latest: null },
  demUpload: { latest: null },
} as unknown as GeodataStatus;
const geodata = { status: () => Promise.resolve(idleGeo) } as unknown as GeodataApi;

const importing = {
  id: "l1",
  name: "WorldPop 2025",
  status: "importing",
  progress: { step: "download", receivedBytes: 20e6, totalBytes: 80e6 },
} as unknown as PopulationLayer;

describe("bar at the bottom of the project", () => {
  it("shows the population import the project area started, with how far its download is", async () => {
    const population = {
      overview: () => Promise.resolve({ layers: [importing] } as unknown as PopulationOverview),
    } as unknown as PopulationApi;
    render(
      <JobsProvider>
        <ImportsWatcher api={geodata} population={population} />
        <JobsBar />
      </JobsProvider>,
    );
    const bar = await screen.findByRole("progressbar", { name: "WorldPop 2025" });
    // Step 1 of 2, a quarter downloaded.
    expect(bar.getAttribute("aria-valuenow")).toBe("13");
  });

  it("shows the climate while it is fetched, then keeps it in the project", async () => {
    const mild: MonthClimate = { mean_c: 12, max_c: 17, min_c: 7, max_sd_c: 3, min_sd_c: 3 };
    const got: FetchedClimate = {
      lat: 52.5,
      lon: 13.4,
      from_year: 1991,
      to_year: 2020,
      months: Array(12).fill(mild),
    };
    let answer: (c: FetchedClimate) => void = () => {};
    const fetcher = vi.fn(() => new Promise<FetchedClimate>((r) => (answer = r)));
    const onPreferences = vi.fn<(d: PreferencesDoc) => void>();
    render(
      <JobsProvider>
        <ClimateKeeper
          place={[13.4, 52.5]}
          bbox={[13.08, 52.33, 13.76, 52.68]}
          preferences={null}
          onPreferences={onPreferences}
          fetcher={fetcher}
        />
        <JobsBar />
      </JobsProvider>,
    );
    expect(await screen.findByRole("progressbar", { name: "Climate" })).toBeTruthy();
    expect(fetcher).toHaveBeenCalledWith(52.5, 13.4);
    answer(got);
    await waitFor(() => expect(screen.queryByRole("progressbar", { name: "Climate" })).toBeNull());
    expect(onPreferences.mock.calls[0]![0].climate?.fetched?.months).toHaveLength(12);
  });

  it("does not fetch the climate for a reader, who cannot keep it", () => {
    const fetcher = vi.fn(() => new Promise<FetchedClimate>(() => {}));
    render(
      <JobsProvider>
        <ClimateKeeper place={[13.4, 52.5]} bbox={null} preferences={null} fetcher={fetcher} />
      </JobsProvider>,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
