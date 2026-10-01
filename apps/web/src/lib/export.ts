/** Client-side export helpers for floor-plan SVGs. */

function serialize(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  // Inline a white background so PNG/PDF aren't transparent.
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  const vb = svg.getAttribute("viewBox")?.split(" ").map(Number) ?? [0, 0, 100, 100];
  bg.setAttribute("x", String(vb[0]));
  bg.setAttribute("y", String(vb[1]));
  bg.setAttribute("width", String(vb[2]));
  bg.setAttribute("height", String(vb[3]));
  bg.setAttribute("fill", "#ffffff");
  clone.insertBefore(bg, clone.firstChild);
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

export async function exportPNG(svg: SVGSVGElement, name = "floor-plan", scale = 3) {
  const data = serialize(svg);
  const vb = svg.getAttribute("viewBox")?.split(" ").map(Number) ?? [0, 0, 800, 600];
  const img = new Image();
  const url = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(data)))}`;
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = rej;
    img.src = url;
  });
  const canvas = document.createElement("canvas");
  canvas.width = vb[2] * 20 * scale;
  canvas.height = vb[3] * 20 * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  triggerDownload(canvas.toDataURL("image/png"), `${name}.png`);
}
