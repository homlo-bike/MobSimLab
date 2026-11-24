import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/** How serious a check is. */
export type CheckSeverity = "error" | "warning" | "info" | "ok";

/** One live check of a drawing tool, such as "the platform is shorter than the train". */
export interface CheckItem {
  severity: CheckSeverity;
  text: string;
  /** A second line, such as the design value it comes from. */
  detail?: string;
  /** Shows the place or element the check is about (only while its tool is open). */
  onShow?: () => void;
}

/** The checks of one tool (street lines, railway, depots, a plugin tool), as the notifications list shows them. */
export interface CheckGroup {
  source: string;
  label: string;
  items: CheckItem[];
  /** The tool is open now: its checks are current and can show their place. */
  live: boolean;
  /** Which of the tool's drawings the checks are about (a street line's id), to open it again. */
  context?: string;
}

interface Store {
  publish: (source: string, label: string, items: CheckItem[], context?: string) => void;
  retire: (source: string) => void;
  groups: CheckGroup[];
  /** Opens a closed tool again and shows the check once its tool reports it; null when tools cannot be opened. */
  reopen: ((group: CheckGroup, item: CheckItem) => void) | null;
}

const ChecksContext = createContext<Store | null>(null);

/**
 * Purpose: collect the drawing tools' checks for the project's notifications button, so every mode's checks are in
 * one place. A tool that closes keeps its last checks (they cannot change while it is closed), without the links to
 * the map.
 */
export function ChecksProvider({
  children,
  onReopen,
}: {
  children: ReactNode;
  /** Opens a tool (by its checks' source, and which of its drawings) so a check of it can be shown. */
  onReopen?: (source: string, context: string | undefined) => void;
}) {
  const [groups, setGroups] = useState<CheckGroup[]>([]);
  // A check chosen while its tool was closed: shown once the tool, opened again, reports it.
  const pending = useRef<{ source: string; context?: string; text: string; until: number } | null>(null);
  const publish = useCallback((source: string, label: string, items: CheckItem[], context?: string) => {
    setGroups((gs) => {
      const next = { source, label, items, live: true, ...(context !== undefined ? { context } : {}) };
      const i = gs.findIndex((g) => g.source === source);
      return i < 0 ? [...gs, next] : gs.map((g, k) => (k === i ? next : g));
    });
    const want = pending.current;
    if (want && Date.now() > want.until) pending.current = null;
    else if (want && want.source === source && want.context === context) {
      // The tool may report its checks in steps (an engine still loading): wait for this one.
      const item = items.find((x) => x.text === want.text);
      if (item) {
        pending.current = null;
        // After the tool has drawn itself, so the element it selects is there.
        if (item.onShow) setTimeout(() => item.onShow?.(), 0);
      }
    }
  }, []);
  const retire = useCallback((source: string) => {
    setGroups((gs) =>
      gs.map((g) =>
        g.source === source
          ? { ...g, live: false, items: g.items.map((i) => ({ ...i, onShow: undefined })) }
          : g,
      ),
    );
  }, []);
  const opener = useRef(onReopen);
  opener.current = onReopen;
  const reopen = useCallback((g: CheckGroup, item: CheckItem) => {
    pending.current = {
      until: Date.now() + 30_000,
      source: g.source,
      ...(g.context !== undefined ? { context: g.context } : {}),
      text: item.text,
    };
    opener.current?.(g.source, g.context);
  }, []);
  const store = useMemo(
    () => ({ publish, retire, groups, reopen: onReopen ? reopen : null }),
    [publish, retire, groups, reopen, onReopen],
  );
  return <ChecksContext.Provider value={store}>{children}</ChecksContext.Provider>;
}

/** Purpose: the checks of every tool, for the notifications button; empty outside a project. */
export function useCheckGroups(): CheckGroup[] {
  return useContext(ChecksContext)?.groups ?? [];
}

/** Purpose: open a check's tool again and show the check; null when the project cannot (outside a project). */
export function useReopenCheck(): ((group: CheckGroup, item: CheckItem) => void) | null {
  return useContext(ChecksContext)?.reopen ?? null;
}

/**
 * Purpose: send a tool's live checks to the project's notifications button.
 * Output: true when they went there; false when the tool is shown on its own (no project around it), so it lists
 * its checks itself.
 */
export function usePublishChecks(
  source: string,
  label: string,
  items: CheckItem[],
  /** Which of the tool's drawings they are about (a street line's id), to open it again from the list. */
  context?: string,
): boolean {
  const store = useContext(ChecksContext);
  const publish = store?.publish;
  const retire = store?.retire;
  // The links change on every render; the latest are used when a check is clicked.
  const latest = useRef(items);
  latest.current = items;
  const key = JSON.stringify(items.map((i) => [i.severity, i.text, i.detail ?? "", Boolean(i.onShow)]));
  useEffect(() => {
    if (!publish) return;
    publish(
      source,
      label,
      latest.current.map((item, k) => ({
        ...item,
        onShow: item.onShow ? () => latest.current[k]?.onShow?.() : undefined,
      })),
      context,
    );
  }, [publish, source, label, key, context]);
  useEffect(() => {
    if (!retire) return;
    return () => retire(source);
  }, [retire, source]);
  return Boolean(store);
}
