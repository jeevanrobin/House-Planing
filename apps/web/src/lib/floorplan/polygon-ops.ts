/**
 * Pure computational geometry on 2D polygons (vertices in local metres).
 * No UI or external dependencies — fully unit-testable.
 */
import type { Polygon, Rect } from "./types";

// ────────────────────────────────────────────────
// Basics
// ────────────────────────────────────────────────

/** Signed area (positive = counter-clockwise). */
export function signedArea(poly: Polygon): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

export function polygonArea(poly: Polygon): number {
  return Math.abs(signedArea(poly));
}

/** Ensure vertices are in counter-clockwise order. */
export function ensureCCW(poly: Polygon): Polygon {
  return signedArea(poly) >= 0 ? poly : [...poly].reverse();
}

export function polygonCentroid(poly: Polygon): [number, number] {
  const a6 = signedArea(poly) * 6 || 1;
  let cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    const cross = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  return [cx / a6, cy / a6];
}

export function polygonBBox(poly: Polygon): Rect {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of poly) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function rectToPolygon(r: Rect): Polygon {
  return [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
}

export function isConvex(poly: Polygon): boolean {
  const n = poly.length;
  if (n < 3) return false;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % n];
    const [x3, y3] = poly[(i + 2) % n];
    const cross = (x2 - x1) * (y3 - y2) - (y2 - y1) * (x3 - x2);
    if (Math.abs(cross) < 1e-9) continue;
    if (sign === 0) sign = cross > 0 ? 1 : -1;
    else if ((cross > 0 ? 1 : -1) !== sign) return false;
  }
  return true;
}

// ────────────────────────────────────────────────
// Point-in-polygon (ray casting)
// ────────────────────────────────────────────────

export function pointInPolygon(pt: [number, number], poly: Polygon): boolean {
  let inside = false;
  const [px, py] = pt;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// ────────────────────────────────────────────────
// Polygon inset (negative offset / shrink)
// ────────────────────────────────────────────────

/**
 * Shrink a polygon inward by `dist` metres on all sides.
 * Uses parallel-edge offset with miter joins.
 * Falls back to a smaller inset if the result degenerates.
 */
export function insetPolygon(poly: Polygon, dist: number): Polygon {
  const ccw = ensureCCW(poly);
  const n = ccw.length;
  if (n < 3 || dist <= 0) return ccw;

  // Build inward-offset edges.
  const edges: { nx: number; ny: number; d: number }[] = [];
  for (let i = 0; i < n; i++) {
    const [x1, y1] = ccw[i];
    const [x2, y2] = ccw[(i + 1) % n];
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    // Inward normal for CCW polygon: rotate edge 90° counter-clockwise → (-dy, dx).
    const nx = -dy / len, ny = dx / len;
    // The offset line: nx*x + ny*y = d
    edges.push({ nx, ny, d: nx * x1 + ny * y1 + dist });
  }

  // Intersect consecutive offset edges to get the inset vertices.
  const result: Polygon = [];
  for (let i = 0; i < n; i++) {
    const e1 = edges[i];
    const e2 = edges[(i + 1) % n];
    const det = e1.nx * e2.ny - e1.ny * e2.nx;
    if (Math.abs(det) < 1e-12) continue; // parallel edges — skip
    const x = (e1.d * e2.ny - e2.d * e1.ny) / det;
    const y = (e1.nx * e2.d - e2.nx * e1.d) / det;
    result.push([x, y]);
  }

  // Validate: if the inset result is too small or degenerate, retry with half dist.
  if (result.length < 3 || polygonArea(result) < 1) {
    if (dist > 0.3) return insetPolygon(poly, dist * 0.5);
    return ccw; // Give up — use original polygon.
  }

  return result;
}

// ────────────────────────────────────────────────
// Sutherland-Hodgman polygon clipping
// ────────────────────────────────────────────────

/** Clip `subject` polygon to the inside of `clip` polygon (assumes clip is convex). */
export function clipPolygon(subject: Polygon, clip: Polygon): Polygon {
  if (subject.length < 3 || clip.length < 3) return [];
  let output: Polygon = [...subject];

  for (let i = 0; i < clip.length && output.length > 0; i++) {
    const input = output;
    output = [];
    const [ex1, ey1] = clip[i];
    const [ex2, ey2] = clip[(i + 1) % clip.length];

    for (let j = 0; j < input.length; j++) {
      const current = input[j];
      const prev = input[(j + input.length - 1) % input.length];
      const cInside = cross2D(ex1, ey1, ex2, ey2, current[0], current[1]) >= -1e-9;
      const pInside = cross2D(ex1, ey1, ex2, ey2, prev[0], prev[1]) >= -1e-9;

      if (cInside) {
        if (!pInside) output.push(intersectLines(prev, current, [ex1, ey1], [ex2, ey2]));
        output.push(current);
      } else if (pInside) {
        output.push(intersectLines(prev, current, [ex1, ey1], [ex2, ey2]));
      }
    }
  }
  return output;
}

function cross2D(
  ex1: number, ey1: number, ex2: number, ey2: number,
  px: number, py: number,
): number {
  return (ex2 - ex1) * (py - ey1) - (ey2 - ey1) * (px - ex1);
}

function intersectLines(
  a: [number, number], b: [number, number],
  c: [number, number], d: [number, number],
): [number, number] {
  const [x1, y1] = a, [x2, y2] = b;
  const [x3, y3] = c, [x4, y4] = d;
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-12) return a; // fallback — nearly parallel
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
}

// ────────────────────────────────────────────────
// Polygon subdivision (weighted sweep-line)
// ────────────────────────────────────────────────

/**
 * Split a polygon into N sub-polygons proportional to `weights`.
 * Uses axis-aligned cuts (horizontal if the bbox is taller than wide, else vertical).
 *
 * For each weight fraction, a cut line slices the polygon and yields one piece.
 * Works correctly for convex and mildly concave polygons.
 */
export function subdividePolygon(
  poly: Polygon,
  weights: number[],
  forceAxis?: "x" | "y",
): Polygon[] {
  if (weights.length <= 1) return [poly];
  if (poly.length < 3) return [poly];

  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const bbox = polygonBBox(poly);
  const axis = forceAxis ?? (bbox.h >= bbox.w ? "y" : "x");

  const results: Polygon[] = [];
  let remaining = poly;

  for (let i = 0; i < weights.length - 1; i++) {
    // Fraction of remaining weight that this piece should take.
    const remainingWeight = weights.slice(i).reduce((a, b) => a + b, 0);
    const frac = weights[i] / remainingWeight;

    const rBBox = polygonBBox(remaining);
    let cutPos: number;
    if (axis === "y") {
      cutPos = rBBox.y + rBBox.h * frac;
    } else {
      cutPos = rBBox.x + rBBox.w * frac;
    }

    const [piece, rest] = splitPolygonByLine(remaining, axis, cutPos);
    if (piece.length >= 3) results.push(piece);
    else results.push(remaining); // degenerate — give entire remaining
    if (rest.length >= 3) remaining = rest;
    else break; // nothing left to split
  }
  // Last piece is whatever remains.
  if (remaining.length >= 3) results.push(remaining);

  // Pad if we ended up with fewer pieces than weights.
  while (results.length < weights.length) {
    results.push(results[results.length - 1]);
  }
  return results;
}

/**
 * Split a polygon into two parts along an axis-aligned line.
 * Returns [below/left, above/right].
 */
export function splitPolygonByLine(
  poly: Polygon,
  axis: "x" | "y",
  pos: number,
): [Polygon, Polygon] {
  const idx = axis === "x" ? 0 : 1;
  // Build a large clip rect on each side of the line.
  const bbox = polygonBBox(poly);
  const margin = Math.max(bbox.w, bbox.h) + 10;

  let clipA: Polygon;
  let clipB: Polygon;
  if (axis === "y") {
    clipA = [
      [bbox.x - margin, bbox.y - margin],
      [bbox.x + bbox.w + margin, bbox.y - margin],
      [bbox.x + bbox.w + margin, pos],
      [bbox.x - margin, pos],
    ];
    clipB = [
      [bbox.x - margin, pos],
      [bbox.x + bbox.w + margin, pos],
      [bbox.x + bbox.w + margin, bbox.y + bbox.h + margin],
      [bbox.x - margin, bbox.y + bbox.h + margin],
    ];
  } else {
    clipA = [
      [bbox.x - margin, bbox.y - margin],
      [pos, bbox.y - margin],
      [pos, bbox.y + bbox.h + margin],
      [bbox.x - margin, bbox.y + bbox.h + margin],
    ];
    clipB = [
      [pos, bbox.y - margin],
      [bbox.x + bbox.w + margin, bbox.y - margin],
      [bbox.x + bbox.w + margin, bbox.y + bbox.h + margin],
      [pos, bbox.y + bbox.h + margin],
    ];
  }

  return [clipPolygon(poly, clipA), clipPolygon(poly, clipB)];
}

// ────────────────────────────────────────────────
// Edge utilities for walls / openings
// ────────────────────────────────────────────────

export interface PolyEdge {
  x1: number; y1: number;
  x2: number; y2: number;
  length: number;
  /** Approximate orientation: "h" if mostly horizontal, "v" if mostly vertical. */
  orientation: "h" | "v";
}

/** Extract edges from a polygon. */
export function polygonEdges(poly: Polygon): PolyEdge[] {
  const edges: PolyEdge[] = [];
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    const length = Math.hypot(x2 - x1, y2 - y1);
    const orientation: "h" | "v" = Math.abs(x2 - x1) >= Math.abs(y2 - y1) ? "h" : "v";
    edges.push({ x1, y1, x2, y2, length, orientation });
  }
  return edges;
}

/** Check if a point lies on any edge of a polygon (within tolerance). */
export function pointOnPolygonEdge(
  pt: [number, number],
  poly: Polygon,
  tol = 0.08,
): boolean {
  const [px, py] = pt;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 1e-9) continue;
    // Distance from point to line segment.
    const t = Math.max(0, Math.min(1, ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / (len * len)));
    const dx = px - (x1 + t * (x2 - x1));
    const dy = py - (y1 + t * (y2 - y1));
    if (Math.hypot(dx, dy) < tol) return true;
  }
  return false;
}

/**
 * Check if a room edge (segment) lies on the footprint boundary.
 * Used to identify exterior walls.
 */
export function edgeOnBoundary(
  x1: number, y1: number, x2: number, y2: number,
  boundary: Polygon,
  tol = 0.08,
): boolean {
  const mid: [number, number] = [(x1 + x2) / 2, (y1 + y2) / 2];
  return pointOnPolygonEdge([x1, y1], boundary, tol) &&
    pointOnPolygonEdge([x2, y2], boundary, tol) &&
    pointOnPolygonEdge(mid, boundary, tol);
}
