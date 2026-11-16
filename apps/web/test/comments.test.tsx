import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommentsApi, ProjectComment } from "../src/features/comments/api";
import { CommentBadge, CommentsProvider, ObjectComments } from "../src/features/comments/Comments";
import { commentableObjects, CommentsPanel } from "../src/features/comments/CommentsPanel";
import type { DepotsDoc } from "../src/features/depots/types";
import type { Network } from "../src/features/railways/types";
import type { StreetLinesDoc } from "../src/features/street-lines/saved";
import type { Translate } from "../src/i18n/i18n";

afterEach(cleanup);

const comment = (over: Partial<ProjectComment>): ProjectComment => ({
  id: "c1",
  objectType: "station",
  objectId: "7",
  parentId: null,
  body: "Too close to station 6?",
  author: { id: "u2", displayName: "Carol" },
  createdAt: "2026-11-16T10:00:00.000Z",
  editedAt: null,
  resolvedAt: null,
  resolvedBy: null,
  ...over,
});

/** A comments API kept in memory, like the server: adding, resolving and deleting change what `list` returns. */
function fakeApi(initial: ProjectComment[]) {
  let rows = [...initial];
  let n = 0;
  const api: CommentsApi = {
    list: vi.fn(async () => rows),
    add: vi.fn(async (b) => {
      const c = comment({
        ...b,
        id: `new${++n}`,
        parentId: b.parentId ?? null,
        author: { id: "u1", displayName: "Me" },
      });
      rows = [...rows, c];
      return c;
    }),
    edit: vi.fn(async (id, body) => {
      rows = rows.map((c) => (c.id === id ? { ...c, body, editedAt: "2026-11-16T11:00:00.000Z" } : c));
      return rows.find((c) => c.id === id)!;
    }),
    resolve: vi.fn(async (id, resolved) => {
      rows = rows.map((c) =>
        c.id === id
          ? {
              ...c,
              resolvedAt: resolved ? "2026-11-16T12:00:00.000Z" : null,
              resolvedBy: resolved ? { id: "u1", displayName: "Me" } : null,
            }
          : c,
      );
      return rows.find((c) => c.id === id)!;
    }),
    remove: vi.fn(async (id) => {
      rows = rows.filter((c) => c.id !== id && c.parentId !== id);
      return { ok: true as const };
    }),
  };
  return api;
}

function setup(api: CommentsApi, opts: { canComment?: boolean; isOwner?: boolean } = {}) {
  return render(
    <CommentsProvider
      api={api}
      canComment={opts.canComment ?? true}
      isOwner={opts.isOwner ?? false}
      userId="u1"
    >
      <CommentBadge type="station" id={7} />
      <ObjectComments type="station" id={7} />
    </CommentsProvider>,
  );
}

describe("comments on objects", () => {
  it("shows an object's threads and replies, and the open threads on its badge", async () => {
    const api = fakeApi([
      comment({}),
      comment({ id: "c2", parentId: "c1", body: "Yes, move it", author: { id: "u3", displayName: "Bob" } }),
      comment({ id: "c3", objectId: "8", body: "Other station" }),
    ]);
    setup(api);
    expect(await screen.findByText("Too close to station 6?")).toBeTruthy();
    expect(screen.getByText("Yes, move it")).toBeTruthy();
    expect(screen.queryByText("Other station")).toBeNull();
    expect(screen.getByLabelText("1 open comment thread")).toBeTruthy();
  });

  it("starts a thread, replies to it and resolves it", async () => {
    const api = fakeApi([]);
    setup(api);
    await screen.findByText("No comments yet.");
    fireEvent.change(screen.getByPlaceholderText("Write a comment…"), {
      target: { value: "  Needs a lift  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    await screen.findByText("Needs a lift");
    expect(api.add).toHaveBeenCalledWith({ objectType: "station", objectId: "7", body: "Needs a lift" });

    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    fireEvent.change(screen.getByPlaceholderText("Write a reply…"), { target: { value: "Agreed" } });
    fireEvent.submit(screen.getByPlaceholderText("Write a reply…").closest("form")!);
    await screen.findByText("Agreed");
    expect(api.add).toHaveBeenLastCalledWith({
      objectType: "station",
      objectId: "7",
      body: "Agreed",
      parentId: "new1",
    });

    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    await screen.findByRole("button", { name: "Show 1 resolved thread" });
    expect(screen.queryByText("Needs a lift")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show 1 resolved thread" }));
    expect(screen.getByText("Resolved by Me")).toBeTruthy();
  });

  it("lets people edit only their own comments and delete others' only as Owner", async () => {
    const api = fakeApi([
      comment({ author: { id: "u1", displayName: "Me" } }),
      comment({ id: "c9", body: "Not mine" }),
    ]);
    setup(api);
    await screen.findByText("Not mine");
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(1);
    cleanup();
    setup(fakeApi([comment({ id: "c9", body: "Not mine" })]), { isOwner: true });
    await screen.findByText("Not mine");
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByText("Not mine")).toBeNull());
  });

  it("shows Viewers the threads without a way to write", async () => {
    setup(fakeApi([comment({})]), { canComment: false });
    await screen.findByText("Too close to station 6?");
    expect(screen.queryByPlaceholderText("Write a comment…")).toBeNull();
    expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
    expect(screen.getByText("Viewers can read comments but not write them.")).toBeTruthy();
  });

  it("renders nothing outside a project", () => {
    const { container } = render(<ObjectComments type="track" id={1} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("comments panel for Commenters and Viewers", () => {
  const t = ((key: string, vars?: Record<string, string | number>) =>
    `${key}${vars ? JSON.stringify(vars) : ""}`) as Translate;

  it("lists the saved objects that can carry comments", () => {
    const objects = commentableObjects(
      t,
      {
        origin: [0, 0],
        mode: "tram",
        stations: [
          { id: 1, name: "Harbour" },
          { id: 2, name: "" },
        ],
        tracks: [{ id: 3, name: "" }],
        switches: [{ id: 4 }],
        signals: [{ id: 5, name: "S5" }],
        lines: [{ id: "L1", name: "T1" }],
      } as unknown as Network,
      { lines: [{ id: "s1", name: "Bus 10" }, { name: "Old line" }] } as unknown as StreetLinesDoc,
      { depots: [{ id: "d1", name: "North depot" }] } as unknown as DepotsDoc,
    );
    expect(objects.map((o) => `${o.type}:${o.id}:${o.label}`)).toEqual([
      "station:1:Harbour",
      'station:2:rail.stationN{"id":2}',
      'track:3:rail.trackN{"id":3}',
      'switch:4:comments.switchN{"id":4}',
      "signal:5:S5",
      "service-line:L1:T1",
      "street-line:s1:Bus 10",
      "depot:d1:North depot",
    ]);
  });

  it("shows the objects with open threads and lets people pick any object to comment on", async () => {
    const api = fakeApi([comment({ objectType: "depot", objectId: "d1", body: "Gate too narrow" })]);
    render(
      <CommentsProvider api={api} canComment isOwner={false} userId="u1">
        <CommentsPanel
          objects={[
            { type: "station", id: "1", label: "Harbour" },
            { type: "depot", id: "d1", label: "North depot" },
          ]}
        />
      </CommentsProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /North depot/ }));
    expect(await screen.findByText("Gate too narrow")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "station:1" } });
    fireEvent.change(screen.getByPlaceholderText("Write a comment…"), { target: { value: "Add a shelter" } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    await waitFor(() =>
      expect(api.add).toHaveBeenCalledWith({ objectType: "station", objectId: "1", body: "Add a shelter" }),
    );
  });
});
