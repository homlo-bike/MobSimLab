import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminPanel } from "../src/admin/AdminPanel";

const users = [
  {
    id: "u2",
    email: "dave@example.org",
    displayName: "Dave",
    role: "viewer",
    status: "pending",
    roleOverride: false,
    lastLoginAt: null,
    identities: [{ issuer: "https://idp", groups: ["planning"] }],
  },
  {
    id: "u3",
    email: "erin@example.org",
    displayName: "Erin",
    role: "user",
    status: "active",
    roleOverride: false,
    lastLoginAt: "2026-10-27T10:00:00Z",
    identities: [],
  },
];

/** Purpose: stub the admin API and record every call. */
function stubApi() {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      let body: unknown = { ok: true };
      if (url.startsWith("/api/admin/users")) body = { users };
      if (url === "/api/admin/audit?limit=50")
        body = {
          brokenAt: null,
          records: [
            {
              seq: "1",
              at: "2026-10-27T10:00:00Z",
              actorId: null,
              actorEmail: null,
              action: "instance.owner_reset",
              objectType: "instance",
              objectId: null,
              reason: null,
            },
          ],
        };
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Administration panel", () => {
  it("lists users with their groups and approves with the CSRF token", async () => {
    const calls = stubApi();
    render(<AdminPanel role="owner" userId="u1" csrfToken="csrf-1" onClose={() => {}} />);
    expect(await screen.findByText("dave@example.org")).toBeTruthy();
    expect(screen.getByText("planning")).toBeTruthy();
    fireEvent.click(screen.getByText("Approve"));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/admin/users/u2/approve")).toBe(true));
    const post = calls.find((c) => c.url === "/api/admin/users/u2/approve");
    expect((post?.init?.headers as Record<string, string>)["X-CSRF-Token"]).toBe("csrf-1");
  });

  it("does not offer Owner or Admin to an Admin", async () => {
    stubApi();
    render(<AdminPanel role="admin" userId="u1" csrfToken="c" onClose={() => {}} />);
    const select = (await screen.findByLabelText("Role of erin@example.org")) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["user", "viewer", "restricted"]);
  });

  it("changes a role with PATCH", async () => {
    const calls = stubApi();
    render(<AdminPanel role="owner" userId="u1" csrfToken="c" onClose={() => {}} />);
    fireEvent.change(await screen.findByLabelText("Role of erin@example.org"), {
      target: { value: "restricted" },
    });
    await waitFor(() => expect(calls.some((c) => c.init?.method === "PATCH")).toBe(true));
    const patch = calls.find((c) => c.init?.method === "PATCH");
    expect(patch?.url).toBe("/api/admin/users/u3");
    expect(patch?.init?.body).toBe(JSON.stringify({ role: "restricted" }));
  });

  it("shows the audit chain status", async () => {
    stubApi();
    render(<AdminPanel role="owner" userId="u1" csrfToken="c" onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "Audit log" }));
    expect((await screen.findByRole("status")).textContent).toMatch(/verified/);
    expect(screen.getByText("system")).toBeTruthy();
  });
});
