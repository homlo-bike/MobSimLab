import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CommentNotice,
  type CommentNoticesApi,
  openCommentsLater,
  takePendingComments,
  useCommentNotices,
} from "../src/features/comments/notices";
import { ChecksMenu } from "../src/shell/ChecksMenu";

afterEach(cleanup);

const notice = (over: Partial<CommentNotice>): CommentNotice => ({
  id: "c1",
  projectId: "p1",
  projectName: "Damascus",
  objectType: "station",
  objectId: "7",
  parentId: null,
  body: "The platform is too short.",
  author: { id: "u2", displayName: "Carol" },
  createdAt: "2026-11-18T21:00:00.000Z",
  editedAt: null,
  resolvedAt: null,
  resolvedBy: null,
  ...over,
});

function fakeApi(initial: CommentNotice[]) {
  let rows = [...initial];
  const api: CommentNoticesApi = {
    list: vi.fn(async () => ({ total: rows.length, comments: rows })),
    read: vi.fn(async (b) => {
      rows = "all" in b ? [] : rows.filter((r) => !b.ids.includes(r.id));
      return { ok: true as const };
    }),
  };
  return api;
}

/** The bell with the notices of a fake API, as a project's top bar shows it. */
function Bell({ api, onOpen }: { api: CommentNoticesApi; onOpen: (n: CommentNotice) => void }) {
  const notices = useCommentNotices(api);
  return (
    <ChecksMenu
      notices={notices}
      onOpenNotice={onOpen}
      objectLabel={(n) => (n.projectId === "p1" && n.objectId === "7" ? "Ahmad Kiftaro" : null)}
    />
  );
}

describe("notices of new comments in the bell", () => {
  it("counts new comments and replies on the bell and opens a notice's object", async () => {
    const api = fakeApi([
      notice({}),
      notice({ id: "c2", parentId: "c1", author: { id: "u3", displayName: "Bob" }, body: "Agreed" }),
      notice({ id: "c3", projectId: "p2", projectName: "Riverside", objectType: "depot", objectId: "d1" }),
    ]);
    const onOpen = vi.fn();
    render(<Bell api={api} onOpen={onOpen} />);
    const bell = await screen.findByRole("button", { name: "Checks · 3 new comments" });
    expect(bell.textContent).toContain("3");
    fireEvent.click(bell);
    expect(screen.getByText("Carol commented on Ahmad Kiftaro")).toBeTruthy();
    expect(screen.getByText("Bob replied on Ahmad Kiftaro")).toBeTruthy();
    // An object of another project is named by its kind.
    expect(screen.getByText("Carol commented on Depot")).toBeTruthy();
    expect(screen.getAllByText(/Riverside/).length).toBe(1);

    fireEvent.click(screen.getByText("Carol commented on Depot"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "c3", projectId: "p2" }));
  });

  it("marks comments read, one by one or all at once", async () => {
    const api = fakeApi([notice({}), notice({ id: "c2" })]);
    let marks: ReturnType<typeof useCommentNotices> | null = null;
    function Probe() {
      marks = useCommentNotices(api);
      return <span>{marks.total}</span>;
    }
    render(<Probe />);
    await waitFor(() => expect(marks?.total).toBe(2));
    act(() => marks!.markRead({ ids: ["c1"] }));
    expect(marks!.total).toBe(1);
    expect(api.read).toHaveBeenCalledWith({ ids: ["c1"] });
    await waitFor(() => expect(marks!.comments.map((c) => c.id)).toEqual(["c2"]));

    render(<Bell api={api} onOpen={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Checks · 1 new comment" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark all as read" }));
    expect(api.read).toHaveBeenCalledWith({ all: true });
    await waitFor(() => expect(screen.queryByText("New comments · 1")).toBeNull());
  });

  it("shows only the checks without an API", () => {
    render(<Bell api={null as unknown as CommentNoticesApi} onOpen={() => {}} />);
    expect(screen.getByRole("button", { name: "Checks" })).toBeTruthy();
  });

  it("opens an object's comments once its project has opened", () => {
    openCommentsLater("p2", "depot", "d1");
    expect(takePendingComments("p1")).toBeNull();
    expect(takePendingComments("p2")).toEqual({ type: "depot", id: "d1" });
    expect(takePendingComments("p2")).toBeNull();
  });
});
