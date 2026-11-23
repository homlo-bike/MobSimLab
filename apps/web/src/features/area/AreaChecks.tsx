import { useMemo } from "react";
import { useI18n } from "../../i18n/i18n";
import type { MessageKey } from "../../i18n/messages";
import { type CheckItem, usePublishChecks } from "../../shell/checks";
import type { LonLat } from "./api";
import { type OutsideDrawing, outsideDrawings } from "./outside";

const TEXT: Record<OutsideDrawing["kind"], MessageKey> = {
  streetLine: "aw.outside.streetLine",
  pluginLine: "aw.outside.pluginLine",
  railway: "aw.outside.railway",
  depot: "aw.outside.depot",
  cargoBike: "aw.outside.cargoBike",
};

/**
 * Purpose: warn in the notifications button about drawings with a part outside the project area, where there is
 * no map data (large-area projects, step 2). Renders nothing.
 */
export function AreaChecks({
  docs,
  polygons,
}: {
  docs: Parameters<typeof outsideDrawings>[0];
  polygons: readonly { ring: readonly LonLat[] }[];
}) {
  const { t } = useI18n();
  const found = useMemo(() => outsideDrawings(docs, polygons), [docs, polygons]);
  const items: CheckItem[] = found.map((d) => ({
    severity: "warning",
    text: t(TEXT[d.kind], { name: d.name }),
    detail: t("aw.outside.fix"),
  }));
  usePublishChecks("project-area", t("aw.title"), items);
  return null;
}
