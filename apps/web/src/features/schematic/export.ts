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
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(copy)}`;
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

/**
 * Purpose: the SVG drawn into a PNG at `scale` times its size, on white.
 * Output: the PNG, or an error when the browser cannot draw it.
 */
export async function pngBlob(svg: SVGSVGElement, scale = 2): Promise<Blob> {
  const [w, h] = sizeOf(svg);
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
    return await new Promise<Blob>((ok, fail) =>
      canvas.toBlob((b) => (b ? ok(b) : fail(new Error("the image could not be made"))), "image/png"),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Purpose: open the browser's print dialog with only the diagram on the page, sized to fit, so it can be
 * printed or saved as PDF. Side effect: a hidden frame is added, printed and removed.
 */
export function printSvg(svg: SVGSVGElement, title: string): void {
  const [w, h] = sizeOf(svg);
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.append(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    frame.remove();
    return;
  }
  const esc = title.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
  doc.open();
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${esc}</title><style>` +
      `@page{size:${w >= h ? "landscape" : "portrait"};margin:10mm}html,body{margin:0}` +
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
}
