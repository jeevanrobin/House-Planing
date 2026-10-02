/** Client-side export helpers for floor-plan SVGs. */

function serialize(svg: SVGSVGElement): string {
  // The drawing paints its own paper background, so exports keep the
  // current palette (trace paper or blueprint).
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return new XMLSerializer().serializeToString(clone);
}

function triggerDownload(href: string, filename: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.click();
}

export function exportSVG(svg: SVGSVGElement, name = "floor-plan") {
  const blob = new Blob([serialize(svg)], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, `${name}.svg`);
  URL.revokeObjectURL(url);
}

/**
 * Rasterise a drawing at roughly 60 px per metre, capped so very large plots
 * don't exceed browser canvas limits.
 */
export async function rasterize(svg: SVGSVGElement, maxPx = 6000): Promise<{ dataUrl: string; width: number; height: number }> {
  const data = serialize(svg);
  const vb = svg.getAttribute("viewBox")?.split(" ").map(Number) ?? [0, 0, 800, 600];
  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = rej;
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(data)))}`;
  });
  const k = Math.min(60, maxPx / Math.max(vb[2], vb[3]));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(vb[2] * k);
  canvas.height = Math.round(vb[3] * k);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
}

export async function exportPNG(svg: SVGSVGElement, name = "floor-plan") {
  const { dataUrl } = await rasterize(svg);
  triggerDownload(dataUrl, `${name}.png`);
}

/** A drawing set: one A3 landscape page per sheet, each fitted and centred. */
export async function exportPDF(sheets: SVGSVGElement[], name = "drawing-set") {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });
  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();
  const margin = 10;
  for (let i = 0; i < sheets.length; i++) {
    if (i > 0) pdf.addPage("a3", "landscape");
    const { dataUrl, width, height } = await rasterize(sheets[i], 4200);
    const k = Math.min((pw - 2 * margin) / width, (ph - 2 * margin) / height);
    const w = width * k;
    const h = height * k;
    pdf.addImage(dataUrl, "PNG", (pw - w) / 2, (ph - h) / 2, w, h, undefined, "FAST");
  }
  pdf.save(`${name}.pdf`);
}
