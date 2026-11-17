import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EsriImageryAdmin, type EsriStatus } from "../src/admin/EsriImageryAdmin";

const KEY = "AAPTesriTestKey_0123456789abcdefWXYZ";
const none: EsriStatus = {
  configured: false,
  keyEnd: null,
  termsAcceptedAt: null,
  termsAcceptedBy: null,
  termsUrl: "https://www.esri.com/en-us/legal/terms/full-master-agreement",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Esri World Imagery in Administration", () => {
  it("saves the key only with Esri's terms accepted, and shows only its last four characters", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    let status = none;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (init?.method === "PUT")
          status = {
            ...none,
            configured: true,
            keyEnd: "WXYZ",
            termsAcceptedAt: "2026-11-17T21:00:00Z",
            termsAcceptedBy: "Alice",
          };
        return new Response(JSON.stringify({ esri: status }), { status: 200 });
      }),
    );
    const run = async (f: () => Promise<unknown>) => void (await f());
    render(<EsriImageryAdmin csrfToken="csrf-1" run={run} />);
    expect(await screen.findByText(/No key saved/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("ArcGIS API key"), { target: { value: KEY } });
    const save = screen.getByRole("button", { name: "Save key" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(save);
    expect(await screen.findByText(/Key ending WXYZ saved by Alice/)).toBeTruthy();
    const put = calls.find((c) => c.init?.method === "PUT")!;
    expect(put.url).toBe("/api/admin/basemaps/esri");
    expect(JSON.parse(String(put.init?.body))).toEqual({ apiKey: KEY, acceptTerms: true });
    expect((put.init?.headers as Record<string, string>)["X-CSRF-Token"]).toBe("csrf-1");
    expect(screen.queryByText(new RegExp(KEY))).toBeNull();
  });
});
