import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EsriImageryConfig, type EsriStatus } from "../src/admin/EsriImageryAdmin";

// A made-up key with little variety, so secret scanners do not take it for a real one.
const KEY = `test-${"x".repeat(26)}WXYZ`;
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
    const onStatus = vi.fn();
    const onClose = vi.fn();
    render(
      <EsriImageryConfig csrfToken="csrf-1" status={none} meta="" onStatus={onStatus} onClose={onClose} />,
    );
    expect(screen.getByRole("dialog", { name: "Esri World Imagery" })).toBeTruthy();
    expect(screen.getByText(/No key saved/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("ArcGIS API key"), { target: { value: KEY } });
    const accept = screen.getByRole("button", { name: "Accept changes" });
    fireEvent.click(accept);
    expect((await screen.findByRole("alert")).textContent).toMatch(/Accept Esri's terms of use/);
    expect(calls.some((c) => c.init?.method === "PUT")).toBe(false);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(accept);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ configured: true, keyEnd: "WXYZ" }));
    // The services Esri World Imagery uses are linked at the bottom.
    expect(screen.getByRole("link", { name: /ArcGIS Location Platform/ })).toBeTruthy();
    const put = calls.find((c) => c.init?.method === "PUT")!;
    expect(put.url).toBe("/api/admin/basemaps/esri");
    expect(JSON.parse(String(put.init?.body))).toEqual({ apiKey: KEY, acceptTerms: true });
    expect((put.init?.headers as Record<string, string>)["X-CSRF-Token"]).toBe("csrf-1");
    expect(screen.queryByText(new RegExp(KEY))).toBeNull();
  });
});

describe("Esri World Imagery with a saved key", () => {
  it("shows only the key's last four characters and removes the key when the changes are accepted", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ esri: none, available: [] }), { status: 200 });
      }),
    );
    const saved: EsriStatus = {
      ...none,
      configured: true,
      keyEnd: "WXYZ",
      termsAcceptedAt: "2026-11-17T21:00:00Z",
      termsAcceptedBy: "Alice",
    };
    const onClose = vi.fn();
    render(
      <EsriImageryConfig csrfToken="csrf-1" status={saved} meta="" onStatus={() => {}} onClose={onClose} />,
    );
    expect(screen.getByText(/Key ending WXYZ saved by Alice/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove key" }));
    expect(screen.getByText(/removed when you accept/)).toBeTruthy();
    expect(calls).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Accept changes" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls.find((c) => c.init?.method === "DELETE")?.url).toBe("/api/admin/basemaps/esri");
  });
});
