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
  /**
   * The drawing is turned so the road runs along the bottom of the sheet and
   * the frontage is square to it, as Indian plans are drawn. True north
   * points this many degrees clockwise from "up" on the sheet.
   */
  northDeg: number;
}

export function toWorldPoint(f: PlotFrame, [lx, ly]: [number, number]): [number, number] {
  switch (f.road) {
    case "N": return [f.bx + lx, f.by + ly];
    case "S": return [f.bx + f.pw - lx, f.by + f.pd - ly];
    case "E": return [f.bx + f.pd - ly, f.by + lx];
    case "W": return [f.bx + ly, f.by + f.pw - lx];
  }
}

function toLocalPoint(f: Omit<PlotFrame, "local" | "world" | "area" | "northDeg">, [wx, wy]: [number, number]): [number, number] {
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
const FACING_BEARING: Record<Facing, number> = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };

/** Compass bearing (0 = N, clockwise) of a vector in y-down coordinates. */
function bearingOf(vx: number, vy: number): number {
  return ((Math.atan2(vx, -vy) * 180) / Math.PI + 360) % 360;
}

/**
 * Bearing of the road frontage's outward normal.
 *
 * 1. A real straight boundary edge facing the road is the strongest cue: the
 *    house squares up with it. Edges within 50 degrees of the facing qualify;
 *    the best-aligned wins, and near-ties go to the orientation that leaves
 *    the plot deeper (narrow plots front the road on their short side).
 * 2. Blob-like plots drawn with many short edges have no such edge; then the
 *    plot's principal axis is used, but only when the shape is clearly
 *    elongated (otherwise the axis is noise and the plot stays unrotated).
 */
function frontageBearing(poly: Polygon, facing: Facing): number | null {
  const n = poly.length;
  const want = FACING_BEARING[facing];
  const angDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
  const cx = poly.reduce((a, q) => a + q[0], 0) / n;
  const cy = poly.reduce((a, q) => a + q[1], 0) / n;
  let perimeter = 0;
  for (let i = 0; i < n; i++) perimeter += Math.hypot(poly[(i + 1) % n][0] - poly[i][0], poly[(i + 1) % n][1] - poly[i][1]);
  const depthAlong = (nx: number, ny: number) => {
    const proj = poly.map(([x, y]) => x * nx + y * ny);
    return Math.max(...proj) - Math.min(...proj);
  };

  const edges: { bearing: number; diff: number; len: number; depth: number }[] = [];
  for (let i = 0; i < n; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % n];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < Math.max(2, perimeter * 0.1)) continue;
    let nx = (by - ay) / len;
    let ny = -(bx - ax) / len;
    if (nx * ((ax + bx) / 2 - cx) + ny * ((ay + by) / 2 - cy) < 0) { nx = -nx; ny = -ny; }
    const bearing = bearingOf(nx, ny);
    const diff = angDiff(bearing, want);
    if (diff <= 50) edges.push({ bearing, diff, len, depth: depthAlong(nx, ny) });
  }
  if (edges.length) {
    const bestDiff = Math.min(...edges.map((e) => e.diff));
    const near = edges.filter((e) => e.diff <= bestDiff + 10);
    near.sort((a, b) => b.depth - a.depth || b.len - a.len);
    return near[0].bearing;
  }

  // Blob: principal axis of points sampled along the boundary.
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % n];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.5));
    for (let k = 0; k < steps; k++) pts.push([ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps]);
  }
  const mx = pts.reduce((a, q) => a + q[0], 0) / pts.length;
  const my = pts.reduce((a, q) => a + q[1], 0) / pts.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of pts) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc;
  const l2 = tr / 2 - disc;
  if (l2 <= 0 || l1 / l2 < 1.6) return null; // too round to have a meaningful axis
  const phi = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const major: [number, number] = [Math.cos(phi), Math.sin(phi)];
  const minor: [number, number] = [-Math.sin(phi), Math.cos(phi)];
  const cands = [
    { v: major, short: true }, { v: [-major[0], -major[1]] as [number, number], short: true },
    { v: minor, short: false }, { v: [-minor[0], -minor[1]] as [number, number], short: false },
  ].map((c) => ({ ...c, bearing: bearingOf(c.v[0], c.v[1]), diff: angDiff(bearingOf(c.v[0], c.v[1]), want) }));
  cands.sort((a, b) => (Math.abs(a.diff - b.diff) < 10 ? Number(b.short) - Number(a.short) : a.diff - b.diff));
  return cands[0].bearing;
}

const rotate = ([x, y]: [number, number], deg: number): [number, number] => {
  const t = (deg * Math.PI) / 180;
  return [x * Math.cos(t) - y * Math.sin(t), x * Math.sin(t) + y * Math.cos(t)];
};

const CARD_BEARING: Record<Cardinal, number> = { N: 0, E: 90, S: 180, W: 270 };

/** Rotation (clockwise, degrees) that turns a frontage with this bearing to face the bottom of the sheet. */
function roadDownRotation(frontage: number): number {
  let rot = ((180 - frontage) % 360 + 540) % 360 - 180;
  const square = Math.round(rot / 90) * 90;
  if (Math.abs(rot - square) < 1.5) rot = square;
  return rot === -180 ? 180 : rot;
}

export function makePlotFrame(req: Requirements): PlotFrame {
  if (req.plotPolygon && req.plotPolygon.length >= 3) {
    // Map metres are y-north; the drawing frame is y-down.
    const flipped: Polygon = req.plotPolygon.map(([x, y]) => [x, -y]);
    // Turn the plot so its road frontage lies square along the bottom of the sheet.
    const fb = frontageBearing(flipped, req.facing) ?? CARD_BEARING[roadSideOf(req.facing)];
    const rot = roadDownRotation(fb);
    const turned: Polygon = flipped.map((p) => rotate(p, rot));
    const bb = polygonBBox(turned);
    const world: Polygon = turned.map(([x, y]) => [x - bb.x, y - bb.y]);
    const base = { road: "S" as const, bx: 0, by: 0, pw: bb.w, pd: bb.h };
    const local = world.map((p) => toLocalPoint(base, p));
    return { ...base, local, world, area: polygonArea(world), northDeg: rot };
  }
  const pw = req.plotWidth;
  const pd = req.plotDepth;
  const local: Polygon = [[0, 0], [pw, 0], [pw, pd], [0, pd]];
  const northDeg = roadDownRotation(CARD_BEARING[roadSideOf(req.facing)]);
  const frame = { road: "S" as Cardinal, bx: 0, by: 0, pw, pd, local, world: [] as Polygon, area: pw * pd, northDeg };
  frame.world = local.map((p) => toWorldPoint(frame, p));
  return frame;
}

/* ------------------------------------------------------------------ */
/* Buildable envelope                                                  */
/* ------------------------------------------------------------------ */

/**
 * The buildable area of a plot (plot-local, road at y = 0), sliced into thin
 * horizontal rows so the layout can ask how wide the land is between depth
 * y0 and y1. This is what lets footprints follow the plot's shape.
 */
export class Envelope {
  readonly step = 0.25;
  readonly y0: number;
  readonly y1: number;
  /** Per row: the free x-intervals inside the envelope. */
  private rows: [number, number][][];

  constructor(poly: Polygon, frontY: number) {
    const bb = polygonBBox(poly);
    this.y0 = Math.max(bb.y, frontY);
    this.y1 = bb.y + bb.h;
    this.rows = [];
    for (let y = this.y0; y < this.y1 - 1e-9; y += this.step) {
      // Narrowest of the row's top and bottom scanlines, so every rectangle
      // drawn within the row stays inside the polygon.
      const a = scan(poly, y + 1e-6);
      const b = scan(poly, Math.min(y + this.step, this.y1) - 1e-6);
      this.rows.push(intersectIntervals(a, b));
    }
  }

  get depth(): number {
    return this.y1 - this.y0;
  }

  /** Widest free interval across all rows in [ya, yb] containing `near` (else the widest). */
  extent(ya: number, yb: number, near?: number): [number, number] | null {
    const i0 = Math.max(0, Math.floor((ya - this.y0) / this.step + 1e-6));
    const i1 = Math.min(this.rows.length - 1, Math.ceil((yb - this.y0) / this.step - 1e-6) - 1);
    if (i1 < i0) return null;
    let acc: [number, number][] = this.rows[i0];
    for (let i = i0 + 1; i <= i1 && acc.length; i++) acc = intersectIntervals(acc, this.rows[i]);
    if (!acc.length) return null;
    if (near !== undefined) {
      const hit = acc.find(([a, b]) => near >= a - 1e-6 && near <= b + 1e-6);
      if (hit) return hit;
    }
    return acc.reduce((m, iv) => (iv[1] - iv[0] > m[1] - m[0] ? iv : m));
  }

  /** First depth (from the front) where the land is at least `minW` wide — skips a narrow tip at the front. */
  firstWideRow(minW: number): number {
    const i = this.rows.findIndex((row) => row.some(([a, b]) => b - a >= minW - 1e-6));
    return i < 0 ? this.y0 : this.y0 + i * this.step;
  }

  /**
   * How deep the house can go from y0 while every row still offers a free
   * interval at least `minW` wide (a sliver in a corner isn't buildable depth).
   */
  usableDepth(y0: number, minW: number): number {
    const i0 = Math.max(0, Math.floor((y0 - this.y0) / this.step + 1e-6));
    let i = i0;
    while (i < this.rows.length && this.rows[i].some(([a, b]) => b - a >= minW - 1e-6)) i++;
    return Math.max(0, this.y0 + i * this.step - y0);
  }

  /** Buildable area (m²). */
  area(): number {
    return this.rows.reduce((a, row) => a + row.reduce((s, [x0, x1]) => s + (x1 - x0), 0), 0) * this.step;
  }

  /** Widest row anywhere (for sizing searches). */
  maxWidth(): number {
    return Math.max(0, ...this.rows.flat().map(([a, b]) => b - a));
  }

  /** A central x to anchor the house on (middle of the widest row). */
  center(): number {
    let best: [number, number] = [0, 0];
    for (const row of this.rows) for (const iv of row) if (iv[1] - iv[0] > best[1] - best[0]) best = iv;
    return (best[0] + best[1]) / 2;
  }
}

/** x-intervals where a horizontal line at y is inside the polygon. */
function scan(poly: Polygon, y: number): [number, number][] {
  const xs: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    if ((ay <= y && by > y) || (by <= y && ay > y)) xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
  }
  xs.sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
  return out;
}

function intersectIntervals(a: [number, number][], b: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [a0, a1] of a) {
    for (const [b0, b1] of b) {
      const lo = Math.max(a0, b0);
      const hi = Math.min(a1, b1);
      if (hi - lo > 0.05) out.push([lo, hi]);
    }
  }
  return out;
}

/** Buildable envelope (plot-local): the plot inset by the side setback, behind the front setback. */
export function buildableEnvelope(frame: PlotFrame, sb: Setbacks): Envelope {
  const rectPlot = frame.local.length === 4 && Math.abs(polygonArea(frame.local) - frame.pw * frame.pd) < 1e-6;
  if (rectPlot) {
    const r = buildableRect(frame, sb);
    return new Envelope([[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]], r.y);
  }
  const inset = insetPolygon(frame.local, sb.side);
  const poly = inset.length >= 3 ? inset : frame.local;
  return new Envelope(poly, polygonBBox(frame.local).y + sb.front);
}

export interface Setbacks {
  front: number;
  rear: number;
  side: number;
}

/**
 * Setbacks by frontage, in typical Indian bye-law ranges. Small plots are
 * built close to the boundary (a 20 ft plot can't give up 6 ft to side
 * margins); larger plots scale gently.
 */
export function setbacksFor(pw: number, pd: number): Setbacks {
  const frontage = Math.min(pw, pd);
  if (frontage < 7.5) return { front: 1.0, rear: 0.6, side: 0.45 }; // up to ~24 ft
  if (frontage < 10.5) return { front: 1.5, rear: 0.75, side: 0.6 }; // ~25–34 ft
  if (frontage < 13.5) return { front: 1.5, rear: 0.9, side: 0.9 }; // ~35–44 ft
  const side = Math.min(3, Math.max(0.9, frontage * 0.075));
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
/**
 * `thorough` enables the whole-plot free-space search (needed for irregular
 * plots); it's skipped while scoring candidate widths, where speed matters.
 */
export function planSite(frame: PlotFrame, house: Rect, req: Requirements, sb: Setbacks, blocks: Rect[] = [house], thorough = true): SiteLayout {
  const elements: SiteElement[] = [];
  const warnings: string[] = [];
  const margin = 0.4;
  const inside = (r: Rect) => rectInside(r, frame.local);
  // `house` is the footprint's bounding box (for yard positions); `blocks` are
  // the actual footprint rectangles, so a stepped house leaves usable notches.
  const free = (r: Rect) =>
    inside(r) && ![...blocks, ...elements].some((o) =>
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
    let place = spot;
    if (!place) {
      // Irregular plots: the largest open rectangle anywhere on the land.
      const open = thorough ? largestFreeRect(frame.local, [...blocks, ...elements], 1.5) : null;
      if (open) {
        for (const [w, h] of [[pl, pwid], [pwid, pl]]) {
          if (open.w >= w && open.h >= h) {
            place = { x: open.x + (open.w - w) / 2, y: open.y + (open.h - h) / 2, w, h };
            break;
          }
        }
      }
    }
    if (place) elements.push({ ...place, id: "pool", type: "pool", label: "Swimming Pool" });
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
    let best = yards
      .filter((y) => y.w >= 2 && y.h >= 2)
      .map((y) => shrinkToFree(y, free))
      .filter((y): y is Rect => !!y)
      .sort((a, b) => b.w * b.h - a.w * a.h)[0];
    // Irregular plots: the largest open rectangle of land, if bigger.
    const open = thorough ? largestFreeRect(frame.local, [...blocks, ...elements], 0.6) : null;
    if (open && free(open) && (!best || open.w * open.h > best.w * best.h)) best = open;
    if (best && best.w * best.h >= 8) {
      elements.push({ ...best, id: "garden", type: "garden", label: "Garden" });
    } else {
      warnings.push("There's no open yard large enough for a garden; consider a terrace garden.");
    }
  }

  void sb;
  return { elements, warnings };
}

/**
 * Largest axis-aligned rectangle of open land: inside the plot, at least
 * `gap` metres clear of every block (house, pool, cars). Grid-based, so it
 * works for any plot shape.
 */
export function largestFreeRect(poly: Polygon, blocks: Rect[], gap = 0.6): Rect | null {
  const bb = polygonBBox(poly);
  const step = Math.max(0.25, Math.max(bb.w, bb.h) / 160);
  const cols = Math.max(1, Math.floor(bb.w / step));
  const rows = Math.max(1, Math.floor(bb.h / step));
  const heights = new Array<number>(cols).fill(0);
  let best = { area: 0, x: 0, y: 0, w: 0, h: 0 };
  const blocked = (x: number, y: number) =>
    blocks.some((b) => x > b.x - gap && x < b.x + b.w + gap && y > b.y - gap && y < b.y + b.h + gap);
  for (let r = 0; r < rows; r++) {
    const y0 = bb.y + r * step;
    for (let c = 0; c < cols; c++) {
      const x0 = bb.x + c * step;
      // A cell counts only if all four corners are inside the plot and clear.
      const ok = ([[x0, y0], [x0 + step, y0], [x0, y0 + step], [x0 + step, y0 + step]] as [number, number][])
        .every(([x, y]) => pointInPolygon([x, y], poly) && !blocked(x, y));
      heights[c] = ok ? heights[c] + 1 : 0;
    }
    const stack: number[] = [];
    for (let c = 0; c <= cols; c++) {
      const h = c === cols ? 0 : heights[c];
      while (stack.length && heights[stack[stack.length - 1]] >= h) {
        const top = stack.pop()!;
        const height = heights[top];
        const left = stack.length ? stack[stack.length - 1] + 1 : 0;
        const width = c - left;
        // Prefer usable proportions: area, discounted for very thin strips.
        const w = width * step;
        const hh = height * step;
        const score = w * hh * Math.min(1, Math.min(w, hh) / 3);
        if (score > best.area) best = { area: score, x: left, y: r - height + 1, w: width, h: height };
      }
      stack.push(c);
    }
  }
  if (!best.area) return null;
  return { x: bb.x + best.x * step, y: bb.y + best.y * step, w: best.w * step, h: best.h * step };
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
