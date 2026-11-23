/**
 * Export of a schematic (FR-SCH-03): SVG for print shops and editing, PNG for screens and quick sharing, and
 * the browser's print dialog for PDF. The diagram is drawn with presentation attributes only, so the SVG
 * stands alone without the app's stylesheet.
 */

/** Purpose: the SVG element as a stand-alone file (XML declaration, namespace). */
export function svgText(svg: SVGSVGElement): string {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  // Screen zoom, app classes and cursors stay in the app.
  copy.removeAttribute("class");
  copy.removeAttribute("style");
  copy.querySelectorAll("[style]").forEach((n) => n.removeAttribute("style"));
  // Selection rings and drag handles are not part of the map.
  copy.querySelectorAll("[data-ui]").forEach((n) => n.remove());
  // Colours that follow dark mode on screen (`var(--diagram-…, light)`): the file keeps the light one.
  const text = new XMLSerializer().serializeToString(copy).replace(/var\(--[\w-]+,\s*([^)]+)\)/g, "$1");
  return `<?xml version="1.0" encoding="UTF-8"?>\n${text}`;
}

/** Purpose: a file name from a title: letters, digits and dashes. */
export function fileName(title: string, ext: string): string {
  const base =
    title
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "schematic";
  return `${base}.${ext}`;
}

/** Purpose: hand the browser a file to save. Side effect: a download starts. */
export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Purpose: the SVG's size in CSS pixels, from its width and height attributes. */
function sizeOf(svg: SVGSVGElement): [number, number] {
  return [Number(svg.getAttribute("width")) || 1200, Number(svg.getAttribute("height")) || 800];
}

/** Largest PNG: about 40 megapixels and 8,192 px a side, which common image viewers and browsers open. */
const MAX_PNG_PIXELS = 40e6;
const MAX_PNG_SIDE = 8192;

/** Purpose: the scale for a PNG of a `w` × `h` drawing: `wanted`, or less so the image stays openable. */
export function pngScale(w: number, h: number, wanted = 2): number {
  return Math.min(wanted, MAX_PNG_SIDE / Math.max(w, h, 1), Math.sqrt(MAX_PNG_PIXELS / Math.max(w * h, 1)));
}

/** Smallest station names in an export: 10 px in a PNG, 7 pt on paper. */
export const MIN_NAME_PX = 10;
export const MIN_NAME_PT = 7;

/**
 * Purpose: the SVG drawn into a PNG at `wanted` times its size (less for a very large drawing, see `pngScale`),
 * on white.
 * Output: the PNG and the scale it was drawn at (to tell how large the names came out), or an error when the
 * browser cannot draw it.
 */
export async function pngImage(svg: SVGSVGElement, wanted = 2): Promise<{ blob: Blob; scale: number }> {
  const [w, h] = sizeOf(svg);
  const scale = pngScale(w, h, wanted);
  const url = URL.createObjectURL(new Blob([svgText(svg)], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise<void>((ok, fail) => {
      img.onload = () => ok();
      img.onerror = () => fail(new Error("the diagram could not be drawn as an image"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("this browser cannot draw images");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((ok, fail) =>
      canvas.toBlob((b) => (b ? ok(b) : fail(new Error("the image could not be made"))), "image/png"),
    );
    return { blob, scale };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** ISO A paper sizes offered for printing, short and long side in mm. */
const PAPERS: readonly { name: string; mm: [number, number] }[] = [
  { name: "A4", mm: [210, 297] },
  { name: "A3", mm: [297, 420] },
  { name: "A2", mm: [420, 594] },
  { name: "A1", mm: [594, 841] },
  { name: "A0", mm: [841, 1189] },
];
const PRINT_MARGIN_MM = 10;
const MM_PER_PT = 25.4 / 72;

/**
 * Purpose: the smallest A paper (A4 to A0) on which a `w` × `h` px drawing, fitted inside 10 mm margins, prints
 * its station names (`namePx` px of the drawing) at least `MIN_NAME_PT` tall; A0 when none does.
 * Output: the paper's name, its size in mm in the drawing's orientation, and the name size in pt on it.
 */
export function printPaper(
  w: number,
  h: number,
  namePx: number,
): { name: string; mm: [number, number]; namePt: number } {
  const landscape = w >= h;
  let pick = PAPERS[PAPERS.length - 1]!;
  let namePt = 0;
  for (const p of PAPERS) {
    const [pw, ph] = landscape ? [p.mm[1], p.mm[0]] : p.mm;
    const mmPerPx = Math.min(
      (pw - 2 * PRINT_MARGIN_MM) / Math.max(w, 1),
      (ph - 2 * PRINT_MARGIN_MM) / Math.max(h, 1),
    );
    namePt = (namePx * mmPerPx) / MM_PER_PT;
    pick = p;
    if (namePt >= MIN_NAME_PT) break;
  }
  return {
    name: pick.name,
    mm: landscape ? [pick.mm[1], pick.mm[0]] : pick.mm,
    namePt: Math.round(namePt * 10) / 10,
  };
}

/**
 * Purpose: open the browser's print dialog with only the diagram on the page, sized to fit, so it can be
 * printed or saved as PDF. The page is the smallest A paper on which the station names (`namePx` px of the
 * drawing) print at a readable size (`printPaper`). Side effect: a hidden frame is added, printed and removed.
 * Output: the paper chosen.
 */
export function printSvg(svg: SVGSVGElement, title: string, namePx = 13): ReturnType<typeof printPaper> {
  const [w, h] = sizeOf(svg);
  const paper = printPaper(w, h, namePx);
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.append(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    frame.remove();
    return paper;
  }
  const esc = title.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
  doc.open();
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${esc}</title><style>` +
      `@page{size:${paper.mm[0]}mm ${paper.mm[1]}mm;margin:${PRINT_MARGIN_MM}mm}html,body{margin:0}` +
      `svg{width:100%;height:auto;max-height:100vh;display:block}</style></head><body>` +
      svgText(svg).replace(/^<\?xml[^>]*>\s*/, "") +
      `</body></html>`,
  );
  doc.close();
  const done = () => setTimeout(() => frame.remove(), 500);
  win.addEventListener("afterprint", done);
  setTimeout(() => {
    win.focus();
    win.print();
    done();
  }, 50);
  return paper;
}
