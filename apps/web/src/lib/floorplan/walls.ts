import type { Rect, Room, RoomType, Wall } from "./types";

const EPS = 0.04;
// Real-world thicknesses in metres: 230 mm brick outer walls, 115 mm partitions.
export const EXTERIOR_T = 0.23;
export const INTERIOR_T = 0.115;
export const RAILING_T = 0.06;

/** Rooms open to the air: their outer edges get a railing, not a wall. */
const OPEN: RoomType[] = ["sitout", "balcony", "terrace", "parking"];

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

/** `list` minus every interval in `cut`. */
function subtract(list: Interval[], cut: Interval[]): Interval[] {
  let out = list;
  for (const c of cut) {
    out = out.flatMap((iv) => {
      if (c.b <= iv.a + EPS || c.a >= iv.b - EPS) return [iv];
      const parts: Interval[] = [];
      if (c.a > iv.a + EPS) parts.push({ a: iv.a, b: c.a });
      if (c.b < iv.b - EPS) parts.push({ a: c.b, b: iv.b });
      return parts;
    });
  }
  return out;
}

/**
 * Build the wall network for rooms that tile a footprint. Shared edges
 * collapse into one partition; edges on the footprint boundary become outer
 * walls, except along open-air rooms (sit-out, balcony, terrace), which get a
 * railing.
 */
export function generateWalls(rooms: Room[], fp: Rect): Wall[] {
  const lines = { v: new Map<number, Interval[]>(), h: new Map<number, Interval[]>() };
  const open = { v: new Map<number, Interval[]>(), h: new Map<number, Interval[]>() };

  for (const r of rooms) {
    const target = OPEN.includes(r.type) ? open : lines;
    const edges: ["v" | "h", number, number, number][] = [
      ["v", r.x, r.y, r.y + r.h],
      ["v", r.x + r.w, r.y, r.y + r.h],
      ["h", r.y, r.x, r.x + r.w],
      ["h", r.y + r.h, r.x, r.x + r.w],
    ];
    for (const [o, at, a, b] of edges) {
      const onBoundary = o === "v"
        ? Math.abs(at - fp.x) < EPS || Math.abs(at - (fp.x + fp.w)) < EPS
        : Math.abs(at - fp.y) < EPS || Math.abs(at - (fp.y + fp.h)) < EPS;
      // Open rooms only contribute railings on the boundary; their inner
      // edges are walls of the neighbouring indoor rooms.
      if (target === open && !onBoundary) continue;
      push(target[o], at, a, b);
    }
  }

  const walls: Wall[] = [];
  const isExt = (o: "v" | "h", v: number) =>
    o === "v"
      ? Math.abs(v - fp.x) < EPS || Math.abs(v - (fp.x + fp.w)) < EPS
      : Math.abs(v - fp.y) < EPS || Math.abs(v - (fp.y + fp.h)) < EPS;

  for (const o of ["v", "h"] as const) {
    for (const [at, list] of lines[o]) {
      // Boundary stretches along open rooms are railings, not walls.
      const merged = subtract(merge(list), isExt(o, at) ? merge(open[o].get(at) ?? []) : []);
      for (const iv of merged) walls.push(wall(o, at, iv, isExt(o, at) ? "exterior" : "interior"));
    }
    for (const [at, list] of open[o]) {
      const solid = merge(lines[o].get(at) ?? []);
      for (const iv of subtract(merge(list), solid)) walls.push(wall(o, at, iv, "railing"));
    }
  }
  return walls;
}

function wall(o: "v" | "h", at: number, iv: Interval, type: Wall["type"]): Wall {
  const thickness = type === "exterior" ? EXTERIOR_T : type === "railing" ? RAILING_T : INTERIOR_T;
  return o === "v"
    ? { x1: at, y1: iv.a, x2: at, y2: iv.b, orientation: "v", type, thickness }
    : { x1: iv.a, y1: at, x2: iv.b, y2: at, orientation: "h", type, thickness };
}
