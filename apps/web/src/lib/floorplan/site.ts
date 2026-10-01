/**
 * Site planning: plot frame, setbacks, buildable area and where the house and
 * outdoor elements (parking, garden, pool) sit on the plot.
 *
 * Two frames are used:
 *  - "plot-local": x runs along the road, y runs away from the road (y = 0 is
 *    the road edge). All site and house layout is done here.
 *  - "world": the drawing frame. x = east, y = south (screen down), so north is
 *    up. `toWorld*` maps plot-local into world according to which side the
 *    road is on.
 */
import { insetPolygon, pointInPolygon, polygonArea, polygonBBox } from "./polygon-ops";
import type { Facing, Polygon, Rect, Requirements, SiteElement } from "./types";

export type Cardinal = "N" | "E" | "S" | "W";

export function roadSideOf(f: Facing): Cardinal {
  if (f.includes("N")) return "N";
  if (f.includes("S")) return "S";
  return f as Cardinal;
}

export interface PlotFrame {
  road: Cardinal;
  /** Plot extent along the road / away from the road (plot-local). */
  pw: number;
  pd: number;
  /** World-frame origin of the plot's bounding box. */
  bx: number;
  by: number;
  /** Plot boundary in plot-local coordinates (rectangle or user polygon). */
  local: Polygon;
  /** Plot boundary in world coordinates. */
  world: Polygon;
  area: number;
}

export function toWorldPoint(f: PlotFrame, [lx, ly]: [number, number]): [number, number] {
  switch (f.road) {
    case "N": return [f.bx + lx, f.by + ly];
    case "S": return [f.bx + f.pw - lx, f.by + f.pd - ly];
    case "E": return [f.bx + f.pd - ly, f.by + lx];
    case "W": return [f.bx + ly, f.by + f.pw - lx];
  }
}

function toLocalPoint(f: Omit<PlotFrame, "local" | "world" | "area">, [wx, wy]: [number, number]): [number, number] {
  const x = wx - f.bx;
  const y = wy - f.by;
  switch (f.road) {
    case "N": return [x, y];
    case "S": return [f.pw - x, f.pd - y];
    case "E": return [y, f.pd - x];
    case "W": return [f.pw - y, x];
  }
}

export function toWorldRect(f: PlotFrame, r: Rect): Rect {
  const [ax, ay] = toWorldPoint(f, [r.x, r.y]);
  const [bx, by] = toWorldPoint(f, [r.x + r.w, r.y + r.h]);
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
}

/**
 * Build the plot frame. A user polygon arrives in map metres (x = east,
 * y = north); flip y so it matches the drawing frame (y = south).
 */
export function makePlotFrame(req: Requirements): PlotFrame {
  const road = roadSideOf(req.facing);
  if (req.plotPolygon && req.plotPolygon.length >= 3) {
    const flipped: Polygon = req.plotPolygon.map(([x, y]) => [x, -y]);
    const bb = polygonBBox(flipped);
    const world: Polygon = flipped.map(([x, y]) => [x - bb.x, y - bb.y]);
    const horizontalRoad = road === "N" || road === "S";
    const base = { road, bx: 0, by: 0, pw: horizontalRoad ? bb.w : bb.h, pd: horizontalRoad ? bb.h : bb.w };
    const local = world.map((p) => toLocalPoint(base, p));
    return { ...base, local, world, area: polygonArea(world) };
  }
  const pw = req.plotWidth;
  const pd = req.plotDepth;
  const local: Polygon = [[0, 0], [pw, 0], [pw, pd], [0, pd]];
  const frame = { road, bx: 0, by: 0, pw, pd, local, world: [] as Polygon, area: pw * pd };
  frame.world = local.map((p) => toWorldPoint(frame, p));
  return frame;
}

export interface Setbacks {
  front: number;
  rear: number;
  side: number;
}

/** Setbacks scale gently with plot size (typical Indian bye-law ranges). */
export function setbacksFor(pw: number, pd: number): Setbacks {
  const side = Math.min(3, Math.max(0.9, Math.min(pw, pd) * 0.075));
  return { front: Math.max(1.5, side * 1.5), rear: side, side };
}

/** Largest axis-aligned rectangle inside a polygon (plot-local), via a grid. */
export function largestInscribedRect(poly: Polygon): Rect {
  const bb = polygonBBox(poly);
  const step = Math.max(0.25, Math.max(bb.w, bb.h) / 240);
  const cols = Math.max(1, Math.floor(bb.w / step));
  const rows = Math.max(1, Math.floor(bb.h / step));
  const heights = new Array<number>(cols).fill(0);
  let best = { area: 0, x: 0, y: 0, w: 0, h: 0 };
  for (let r = 0; r < rows; r++) {
    const cy = bb.y + (r + 0.5) * step;
    for (let c = 0; c < cols; c++) {
      const inside = pointInPolygon([bb.x + (c + 0.5) * step, cy], poly);
      heights[c] = inside ? heights[c] + 1 : 0;
    }
    // Largest rectangle in histogram, ending at row r.
    const stack: number[] = [];
    for (let c = 0; c <= cols; c++) {
      const h = c === cols ? 0 : heights[c];
      while (stack.length && heights[stack[stack.length - 1]] >= h) {
        const top = stack.pop()!;
        const height = heights[top];
        const left = stack.length ? stack[stack.length - 1] + 1 : 0;
        const width = c - left;
        if (height * width > best.area) {
          best = { area: height * width, x: left, y: r - height + 1, w: width, h: height };
        }
      }
      stack.push(c);
    }
  }
  return { x: bb.x + best.x * step, y: bb.y + best.y * step, w: best.w * step, h: best.h * step };
}

/** Buildable rectangle (plot-local) after setbacks. */
export function buildableRect(frame: PlotFrame, sb: Setbacks): Rect {
  const rectPlot = frame.local.length === 4 && Math.abs(polygonArea(frame.local) - frame.pw * frame.pd) < 1e-6;
  if (rectPlot) {
    return {
      x: sb.side,
      y: sb.front,
      w: Math.max(3, frame.pw - 2 * sb.side),
      h: Math.max(3, frame.pd - sb.front - sb.rear),
    };
  }
  const inset = insetPolygon(frame.local, (sb.side + sb.rear) / 2);
  const r = largestInscribedRect(inset.length >= 3 ? inset : frame.local);
  return { ...r, w: Math.max(3, r.w), h: Math.max(3, r.h) };
}

const CAR_W = 2.7;
const CAR_L = 5.0; // standard bay; Indian hatchbacks and sedans are 3.8–4.6 m

function rectInside(r: Rect, poly: Polygon): boolean {
  const corners: [number, number][] = [
    [r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h],
  ];
  // Slight inset so rectangles touching the boundary still count as inside.
  return corners.every(([x, y]) => pointInPolygon([
    x + (x < r.x + r.w / 2 ? 0.05 : -0.05),
    y + (y < r.y + r.h / 2 ? 0.05 : -0.05),
  ], poly));
}

export interface SiteLayout {
  elements: SiteElement[]; // plot-local
  warnings: string[];
}

/**
 * Place parking, pool and garden around a house that occupies `house`
 * (plot-local). Elements never overlap the house or each other.
 */
export function planSite(frame: PlotFrame, house: Rect, req: Requirements, sb: Setbacks): SiteLayout {
  const elements: SiteElement[] = [];
  const warnings: string[] = [];
  const margin = 0.4;
  const inside = (r: Rect) => rectInside(r, frame.local);
  const free = (r: Rect) =>
    inside(r) && ![house, ...elements].some((o) =>
      r.x < o.x + o.w - 1e-6 && o.x < r.x + r.w - 1e-6 && r.y < o.y + o.h - 1e-6 && o.y < r.y + r.h - 1e-6);

  // Parking: cars side by side in the front yard, nose towards the house.
  if (req.parking > 0) {
    const frontDepth = house.y;
    let placed = 0;
    if (frontDepth >= CAR_L + 0.2) {
      const y = Math.max(margin, house.y - CAR_L - 0.2);
      const total = req.parking * CAR_W;
      // Prefer lining up in front of the house, starting at its left edge.
      let x0 = Math.min(Math.max(house.x, margin), frame.pw - margin - total);
      x0 = Math.max(margin, x0);
      for (let i = 0; i < req.parking; i++) {
        const r: Rect = { x: x0 + i * CAR_W, y, w: CAR_W, h: CAR_L };
        if (!free(r)) break;
        elements.push({ ...r, id: `parking-${i}`, type: "parking", label: `Car ${i + 1}` });
        placed++;
      }
    }
    // Fall back to the wider side yard.
    if (placed < req.parking) {
      const leftW = house.x;
      const rightW = frame.pw - (house.x + house.w);
      const sideX = rightW >= leftW ? house.x + house.w + margin : margin;
      const sideW = Math.max(leftW, rightW) - 2 * margin;
      if (sideW >= CAR_W) {
        for (let i = placed; i < req.parking; i++) {
          const r: Rect = { x: sideX, y: house.y + (i - placed) * (CAR_L + 0.2), w: CAR_W, h: CAR_L };
          if (!free(r)) break;
          elements.push({ ...r, id: `parking-${i}`, type: "parking", label: `Car ${i + 1}` });
          placed++;
        }
      }
    }
    if (placed < req.parking) {
      warnings.push(`Only ${placed} of ${req.parking} car space(s) fit in the open yards; consider stilt parking.`);
    }
  }

  const rearY = house.y + house.h;
  const rearYard: Rect = { x: margin, y: rearY + margin, w: frame.pw - 2 * margin, h: frame.pd - rearY - 2 * margin };

  // Pool: in the rear yard with a 1.5 m deck from the house.
  if (req.pool) {
    const [pl, pwid] = req.luxury >= 4 ? [10, 4.5] : [8, 4];
    const deck = 1.5;
    const candidates: Rect[] = [];
    const ry = rearY + deck;
    const cx = house.x + house.w / 2;
    candidates.push({ x: cx - pl / 2, y: ry, w: pl, h: pwid }); // long side along the house
    candidates.push({ x: cx - pwid / 2, y: ry, w: pwid, h: pl });
    // Side yards.
    const rightX = house.x + house.w + deck;
    candidates.push({ x: rightX, y: house.y, w: pwid, h: pl });
    candidates.push({ x: house.x - deck - pwid, y: house.y, w: pwid, h: pl });
    const spot = candidates
      .map((c) => ({ ...c, x: Math.min(Math.max(c.x, margin), frame.pw - margin - c.w) }))
      .find(free);
    if (spot) elements.push({ ...spot, id: "pool", type: "pool", label: "Swimming Pool" });
    else warnings.push("The swimming pool doesn't fit in the open yards of this plot.");
  }

  // Garden: the largest free open-yard rectangle that remains.
  if (req.garden) {
    const pool = elements.find((e) => e.type === "pool");
    const yards: Rect[] = [];
    if (rearYard.h > 0) {
      if (pool && pool.y >= rearY) {
        // Split the rear yard around the pool.
        yards.push({ ...rearYard, h: pool.y - rearYard.y - 0.6 });
        yards.push({ ...rearYard, y: pool.y + pool.h + 0.6, h: rearYard.y + rearYard.h - (pool.y + pool.h + 0.6) });
        yards.push({ x: rearYard.x, y: rearYard.y, w: pool.x - rearYard.x - 0.6, h: rearYard.h });
        yards.push({ x: pool.x + pool.w + 0.6, y: rearYard.y, w: rearYard.x + rearYard.w - (pool.x + pool.w + 0.6), h: rearYard.h });
      } else {
        yards.push(rearYard);
      }
    }
    yards.push({ x: margin, y: house.y, w: house.x - 2 * margin, h: house.h });
    yards.push({ x: house.x + house.w + margin, y: house.y, w: frame.pw - house.x - house.w - 2 * margin, h: house.h });
    const best = yards
      .filter((y) => y.w >= 2 && y.h >= 2)
      .map((y) => shrinkToFree(y, free))
      .filter((y): y is Rect => !!y)
      .sort((a, b) => b.w * b.h - a.w * a.h)[0];
    if (best && best.w * best.h >= 8) {
      elements.push({ ...best, id: "garden", type: "garden", label: "Garden" });
    } else {
      warnings.push("There's no open yard large enough for a garden; consider a terrace garden.");
    }
  }

  void sb;
  return { elements, warnings };
}

/** Shrink a candidate rectangle until it no longer collides (simple inset search). */
function shrinkToFree(r: Rect, free: (r: Rect) => boolean): Rect | null {
  let cur = { ...r };
  for (let i = 0; i < 12; i++) {
    if (cur.w < 2 || cur.h < 2) return null;
    if (free(cur)) return cur;
    cur = { x: cur.x + 0.25, y: cur.y + 0.25, w: cur.w - 0.5, h: cur.h - 0.5 };
  }
  return null;
}
