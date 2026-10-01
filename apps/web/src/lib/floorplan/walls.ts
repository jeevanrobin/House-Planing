import type { Rect, Room, Wall } from "./types";

const EPS = 0.04;
const EXTERIOR_T = 0.66; // ft
const INTERIOR_T = 0.46;

interface Interval {
  a: number;
  b: number;
}

function keyOf(v: number) {
  return Math.round(v * 100) / 100;
}

function push(map: Map<number, Interval[]>, coord: number, a: number, b: number) {
  const k = keyOf(coord);
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (hi - lo < EPS) return;
  (map.get(k) ?? map.set(k, []).get(k)!).push({ a: lo, b: hi });
}

/** Merge overlapping / touching intervals on a single line. */
function merge(list: Interval[]): Interval[] {
  if (list.length === 0) return [];
  const sorted = [...list].sort((x, y) => x.a - y.a);
  const out: Interval[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    if (sorted[i].a <= last.b + EPS) {
      last.b = Math.max(last.b, sorted[i].b);
    } else {
      out.push({ ...sorted[i] });
    }
  }
  return out;
}

/**
 * Build the wall network for a set of non-overlapping rooms that tile a
 * footprint. Every room edge contributes a wall; shared edges between two
 * rooms collapse into a single interior wall. Edges on the footprint
 * boundary become (thicker) exterior walls.
 */
export function generateWalls(rooms: Room[], fp: Rect): Wall[] {
  const verticals = new Map<number, Interval[]>(); // x -> y-intervals
  const horizontals = new Map<number, Interval[]>(); // y -> x-intervals

  for (const r of rooms) {
    push(verticals, r.x, r.y, r.y + r.h);
    push(verticals, r.x + r.w, r.y, r.y + r.h);
    push(horizontals, r.y, r.x, r.x + r.w);
    push(horizontals, r.y + r.h, r.x, r.x + r.w);
  }
  // Guarantee a continuous outer shell even if rooms inset slightly.
  push(verticals, fp.x, fp.y, fp.y + fp.h);
  push(verticals, fp.x + fp.w, fp.y, fp.y + fp.h);
  push(horizontals, fp.y, fp.x, fp.x + fp.w);
  push(horizontals, fp.y + fp.h, fp.x, fp.x + fp.w);

  const walls: Wall[] = [];
  const isExt = (v: number, lo: number, hi: number) =>
    Math.abs(v - lo) < EPS || Math.abs(v - hi) < EPS;

  for (const [x, list] of verticals) {
    for (const iv of merge(list)) {
      const exterior = isExt(x, fp.x, fp.x + fp.w);
      walls.push({
        x1: x, y1: iv.a, x2: x, y2: iv.b,
        orientation: "v",
        type: exterior ? "exterior" : "interior",
        thickness: exterior ? EXTERIOR_T : INTERIOR_T,
      });
    }
  }
  for (const [y, list] of horizontals) {
    for (const iv of merge(list)) {
      const exterior = isExt(y, fp.y, fp.y + fp.h);
      walls.push({
        x1: iv.a, y1: y, x2: iv.b, y2: y,
        orientation: "h",
        type: exterior ? "exterior" : "interior",
        thickness: exterior ? EXTERIOR_T : INTERIOR_T,
      });
    }
  }
  return walls;
}

/* ------------------------------------------------------------------ */
/* Polygon-mode walls: edges from room polygons + footprint boundary.  */
/* ------------------------------------------------------------------ */
import type { Polygon } from "./types";
import { edgeOnBoundary, polygonEdges } from "./polygon-ops";

/**
 * Build walls for polygon-mode layouts. Room polygon edges become walls;
 * edges coinciding with the footprint boundary are exterior (thicker).
 */
export function generatePolygonWalls(rooms: Room[], fpPoly: Polygon): Wall[] {
  // Collect all unique wall segments, deduplicating shared edges.
  const segKey = (x1: number, y1: number, x2: number, y2: number) => {
    const k = (v: number) => Math.round(v * 100);
    // Canonical order: smaller point first.
    if (k(x1) < k(x2) || (k(x1) === k(x2) && k(y1) < k(y2))) {
      return `${k(x1)},${k(y1)}-${k(x2)},${k(y2)}`;
    }
    return `${k(x2)},${k(y2)}-${k(x1)},${k(y1)}`;
  };

  const seen = new Map<string, Wall>();

  // Add room polygon edges.
  for (const room of rooms) {
    const rp = room.polygon;
    if (!rp || rp.length < 3) {
      // Fallback for rooms without polygons (shouldn't happen in polygon mode).
      push(new Map(), room.x, room.y, room.y + room.h);
      continue;
    }
    for (const edge of polygonEdges(rp)) {
      const key = segKey(edge.x1, edge.y1, edge.x2, edge.y2);
      if (!seen.has(key)) {
        const ext = edgeOnBoundary(edge.x1, edge.y1, edge.x2, edge.y2, fpPoly);
        seen.set(key, {
          x1: edge.x1, y1: edge.y1, x2: edge.x2, y2: edge.y2,
          orientation: edge.orientation,
          type: ext ? "exterior" : "interior",
          thickness: ext ? EXTERIOR_T : INTERIOR_T,
        });
      }
    }
  }

  // Add footprint boundary edges to guarantee a continuous shell.
  for (const edge of polygonEdges(fpPoly)) {
    const key = segKey(edge.x1, edge.y1, edge.x2, edge.y2);
    if (!seen.has(key)) {
      seen.set(key, {
        x1: edge.x1, y1: edge.y1, x2: edge.x2, y2: edge.y2,
        orientation: edge.orientation,
        type: "exterior",
        thickness: EXTERIOR_T,
      });
    }
  }

  return Array.from(seen.values());
}
