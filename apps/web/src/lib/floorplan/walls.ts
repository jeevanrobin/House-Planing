import type { Room, RoomType, Wall } from "./types";

const EPS = 0.04;
// Real-world thicknesses in metres: 230 mm brick outer walls, 115 mm partitions.
export const EXTERIOR_T = 0.23;
export const INTERIOR_T = 0.115;
export const RAILING_T = 0.06;

/** Rooms open to the air: their outer edges get a railing, not a wall. */
export const OPEN: RoomType[] = ["sitout", "balcony", "terrace", "parking"];

export interface Interval {
  a: number;
  b: number;
}

function keyOf(v: number) {
  return Math.round(v * 100) / 100;
}

/** Merge overlapping / touching intervals on a single line. */
export function merge(list: Interval[]): Interval[] {
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
export function subtract(list: Interval[], cut: Interval[]): Interval[] {
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
  return out.filter((iv) => iv.b - iv.a > EPS);
}

/** Overlap of two merged interval lists. */
export function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const x of a) {
    for (const y of b) {
      const lo = Math.max(x.a, y.a);
      const hi = Math.min(x.b, y.b);
      if (hi - lo > EPS) out.push({ a: lo, b: hi });
    }
  }
  return merge(out);
}

/**
 * Every wall line, with the room coverage on each side. For a vertical line
 * at x, "low" is the side with smaller x (rooms whose right edge is on it).
 */
interface Line {
  lowSolid: Interval[];
  lowOpen: Interval[];
  highSolid: Interval[];
  highOpen: Interval[];
}

function collect(rooms: Room[]) {
  const lines = { v: new Map<number, Line>(), h: new Map<number, Line>() };
  const get = (o: "v" | "h", at: number) => {
    const k = keyOf(at);
    let l = lines[o].get(k);
    if (!l) { l = { lowSolid: [], lowOpen: [], highSolid: [], highOpen: [] }; lines[o].set(k, l); }
    return l;
  };
  for (const r of rooms) {
    const open = OPEN.includes(r.type);
    const add = (o: "v" | "h", at: number, side: "low" | "high", a: number, b: number) => {
      if (b - a < EPS) return;
      const l = get(o, at);
      (side === "low" ? (open ? l.lowOpen : l.lowSolid) : (open ? l.highOpen : l.highSolid)).push({ a, b });
    };
    add("v", r.x, "high", r.y, r.y + r.h);
    add("v", r.x + r.w, "low", r.y, r.y + r.h);
    add("h", r.y, "high", r.x, r.x + r.w);
    add("h", r.y + r.h, "low", r.x, r.x + r.w);
  }
  return lines;
}

/**
 * Build the wall network for rooms that tile a footprint of any (stepped)
 * outline. Each stretch of a wall line is classified by what lies on its two
 * sides: room | room → partition; room | nothing → outer wall; open room
 * (sit-out, balcony…) | nothing → railing; room | open room → outer wall
 * (the facade facing the sit-out); open | open → nothing.
 */
export function generateWalls(rooms: Room[]): Wall[] {
  const walls: Wall[] = [];
  const lines = collect(rooms);
  for (const o of ["v", "h"] as const) {
    for (const [at, l] of lines[o]) {
      const lowS = merge(l.lowSolid);
      const lowO = merge(l.lowOpen);
      const highS = merge(l.highSolid);
      const highO = merge(l.highOpen);
      const low = merge([...lowS, ...lowO]);
      const high = merge([...highS, ...highO]);
      for (const iv of intersect(lowS, highS)) walls.push(wall(o, at, iv, "interior"));
      for (const iv of merge([...intersect(lowS, highO), ...intersect(lowO, highS)])) walls.push(wall(o, at, iv, "exterior"));
      for (const iv of merge([...subtract(lowS, high), ...subtract(highS, low)])) walls.push(wall(o, at, iv, "exterior"));
      for (const iv of merge([...subtract(lowO, high), ...subtract(highO, low)])) walls.push(wall(o, at, iv, "railing"));
    }
  }
  return walls;
}

/**
 * Stretches of a room's edges with nothing on the other side (the house's
 * outer skin), per side. Used for windows, entrances and daylight checks.
 */
export function exteriorEdges(r: Room, rooms: Room[]): { side: "top" | "bottom" | "left" | "right"; iv: Interval }[] {
  const out: { side: "top" | "bottom" | "left" | "right"; iv: Interval }[] = [];
  const others = rooms.filter((o) => o.id !== r.id);
  const near = (a: number, b: number) => Math.abs(a - b) < EPS;
  const cover = (pred: (o: Room) => boolean, span: (o: Room) => Interval) => merge(others.filter(pred).map(span));
  const sides: ["top" | "bottom" | "left" | "right", Interval, Interval[]][] = [
    ["top", { a: r.x, b: r.x + r.w }, cover((o) => near(o.y + o.h, r.y), (o) => ({ a: o.x, b: o.x + o.w }))],
    ["bottom", { a: r.x, b: r.x + r.w }, cover((o) => near(o.y, r.y + r.h), (o) => ({ a: o.x, b: o.x + o.w }))],
    ["left", { a: r.y, b: r.y + r.h }, cover((o) => near(o.x + o.w, r.x), (o) => ({ a: o.y, b: o.y + o.h }))],
    ["right", { a: r.y, b: r.y + r.h }, cover((o) => near(o.x, r.x + r.w), (o) => ({ a: o.y, b: o.y + o.h }))],
  ];
  for (const [side, edge, covered] of sides) {
    for (const iv of subtract([edge], covered)) out.push({ side, iv });
  }
  return out;
}

function wall(o: "v" | "h", at: number, iv: Interval, type: Wall["type"]): Wall {
  const thickness = type === "exterior" ? EXTERIOR_T : type === "railing" ? RAILING_T : INTERIOR_T;
  return o === "v"
    ? { x1: at, y1: iv.a, x2: at, y2: iv.b, orientation: "v", type, thickness }
    : { x1: iv.a, y1: at, x2: iv.b, y2: at, orientation: "h", type, thickness };
}
