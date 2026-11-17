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
}

interface Store {
  publish: (source: string, label: string, items: CheckItem[]) => void;
  retire: (source: string) => void;
  groups: CheckGroup[];
}

const ChecksContext = createContext<Store | null>(null);

/**
 * Purpose: collect the drawing tools' checks for the project's notifications button, so every mode's checks are in
 * one place. A tool that closes keeps its last checks (they cannot change while it is closed), without the links to
 * the map.
 */
export function ChecksProvider({ children }: { children: ReactNode }) {
  const [groups, setGroups] = useState<CheckGroup[]>([]);
  const publish = useCallback((source: string, label: string, items: CheckItem[]) => {
    setGroups((gs) => {
      const next = { source, label, items, live: true };
      const i = gs.findIndex((g) => g.source === source);
      return i < 0 ? [...gs, next] : gs.map((g, k) => (k === i ? next : g));
    });
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
  const store = useMemo(() => ({ publish, retire, groups }), [publish, retire, groups]);
  return <ChecksContext.Provider value={store}>{children}</ChecksContext.Provider>;
}

/** Purpose: the checks of every tool, for the notifications button; empty outside a project. */
export function useCheckGroups(): CheckGroup[] {
  return useContext(ChecksContext)?.groups ?? [];
}

/**
 * Purpose: send a tool's live checks to the project's notifications button.
 * Output: true when they went there; false when the tool is shown on its own (no project around it), so it lists
 * its checks itself.
 */
export function usePublishChecks(source: string, label: string, items: CheckItem[]): boolean {
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
    );
  }, [publish, source, label, key]);
  useEffect(() => {
    if (!retire) return;
    return () => retire(source);
  }, [retire, source]);
  return Boolean(store);
}
