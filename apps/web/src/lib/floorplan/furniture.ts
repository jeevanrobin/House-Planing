/**
 * Furniture and fixtures for a room, as simple line-drawing primitives in
 * world metres. Pieces sit against walls, keep door swings and openings
 * clear, and are skipped when they don't fit — an empty corner beats a bed
 * blocking a door.
 */
import type { Door, Rect, Room, WindowMark } from "./types";

export type Shape =
  | { kind: "rect"; x: number; y: number; w: number; h: number; rx?: number; solid?: boolean }
  | { kind: "circle"; cx: number; cy: number; r: number }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number };

type Side = "top" | "bottom" | "left" | "right";
const SIDES: Side[] = ["top", "bottom", "left", "right"];
const E = 0.03;

interface Wall {
  side: Side;
  len: number;
  /** Room extent away from this wall. */
  room: number;
  hasDoor: boolean;
  hasWindow: boolean;
  /** (u along the wall, v into the room) → world rectangle. */
  rect: (u: number, v: number, w: number, d: number) => Rect;
  /** (u, v) → world point. */
  pt: (u: number, v: number) => [number, number];
}

function wallOf(r: Room, side: Side): Omit<Wall, "hasDoor" | "hasWindow"> {
  switch (side) {
    case "top": return { side, len: r.w, room: r.h, rect: (u, v, w, d) => ({ x: r.x + u, y: r.y + v, w, h: d }), pt: (u, v) => [r.x + u, r.y + v] };
    case "bottom": return { side, len: r.w, room: r.h, rect: (u, v, w, d) => ({ x: r.x + u, y: r.y + r.h - v - d, w, h: d }), pt: (u, v) => [r.x + u, r.y + r.h - v] };
    case "left": return { side, len: r.h, room: r.w, rect: (u, v, w, d) => ({ x: r.x + v, y: r.y + u, w: d, h: w }), pt: (u, v) => [r.x + v, r.y + u] };
    case "right": return { side, len: r.h, room: r.w, rect: (u, v, w, d) => ({ x: r.x + r.w - v - d, y: r.y + u, w: d, h: w }), pt: (u, v) => [r.x + r.w - v, r.y + u] };
  }
}

/** Opening (door/window) that sits on a given side of the room. */
function onSide(r: Room, side: Side, o: { x: number; y: number; width: number; orientation: "h" | "v" }): boolean {
  if (side === "top" || side === "bottom") {
    const at = side === "top" ? r.y : r.y + r.h;
    return o.orientation === "h" && Math.abs(o.y - at) < E && o.x < r.x + r.w - E && o.x + o.width > r.x + E;
  }
  const at = side === "left" ? r.x : r.x + r.w;
  return o.orientation === "v" && Math.abs(o.x - at) < E && o.y < r.y + r.h - E && o.y + o.width > r.y + E;
}

/** Floor area kept clear in front of each door / opening into this room. */
function clearZones(r: Room, doors: Door[]): Rect[] {
  const zones: Rect[] = [];
  for (const d of doors) {
    for (const side of SIDES) {
      if (!onSide(r, side, d)) continue;
      const depth = d.kind === "opening" ? 0.9 : d.width + 0.1;
      const w = wallOf(r, side);
      const u0 = side === "top" || side === "bottom" ? d.x - r.x : d.y - r.y;
      zones.push(w.rect(u0 - 0.1, 0, d.width + 0.2, Math.min(depth, w.room)));
    }
  }
  return zones;
}

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w - E && b.x < a.x + a.w - E && a.y < b.y + b.h - E && b.y < a.y + a.h - E;
const insideRoom = (a: Rect, r: Room) => a.x >= r.x - E && a.y >= r.y - E && a.x + a.w <= r.x + r.w + E && a.y + a.h <= r.y + r.h + E;

class Planner {
  shapes: Shape[] = [];
  taken: Rect[];
  walls: Wall[];
  constructor(public room: Room, doors: Door[], windows: WindowMark[]) {
    this.taken = clearZones(room, doors);
    this.walls = SIDES.map((s) => ({
      ...wallOf(room, s),
      hasDoor: doors.some((d) => onSide(room, s, d)),
      hasWindow: windows.some((w) => onSide(room, s, w)),
    }));
  }

  fits(a: Rect, pad = 0) {
    const grown = { x: a.x - pad, y: a.y - pad, w: a.w + 2 * pad, h: a.h + 2 * pad };
    return insideRoom(a, this.room) && !this.taken.some((t) => overlap(grown, t));
  }

  /**
   * Find a spot against `wall` for a w × d piece (plus `front` metres of
   * clearance in front of it). Returns the u offset, or null.
   */
  slot(wall: Wall, w: number, d: number, front = 0, prefer: "center" | "start" | "end" = "center"): number | null {
    if (w > wall.len - 0.05 || d + front > wall.room + E) return null;
    const free = wall.len - w;
    const center = free / 2;
    const order = prefer === "center" ? [center, 0.05, free - 0.05] : prefer === "start" ? [0.05, center, free - 0.05] : [free - 0.05, center, 0.05];
    for (let step = 0; step <= 12; step++) {
      for (const base of order) {
        for (const sgn of step === 0 ? [0] : [1, -1]) {
          const u = Math.min(Math.max(0, base + sgn * step * 0.15), free);
          const body = wall.rect(u, 0, w, d);
          const clearance = front > 0 ? wall.rect(u, d, w, front) : null;
          if (this.fits(body) && (!clearance || !this.taken.some((t) => overlap(clearance, t)))) return u;
        }
      }
    }
    return null;
  }

  take(a: Rect) {
    this.taken.push(a);
  }

  /** Walls sorted by preference: no door first, then by length. */
  wallsBy(score: (w: Wall) => number): Wall[] {
    return [...this.walls].sort((a, b) => score(b) - score(a));
  }

  rect(a: Rect, rx = 0.04) { this.shapes.push({ kind: "rect", ...a, rx }); }
  line(a: [number, number], b: [number, number]) { this.shapes.push({ kind: "line", x1: a[0], y1: a[1], x2: b[0], y2: b[1] }); }
  circle(c: [number, number], r: number) { this.shapes.push({ kind: "circle", cx: c[0], cy: c[1], r }); }
}

/* ------------------------------------------------------------------ */
/* Pieces (drawn in wall coordinates: u along the wall, v into the room) */
/* ------------------------------------------------------------------ */

function bed(p: Planner, master: boolean) {
  const r = p.room;
  const sizes = master ? [[1.8, 2.0], [1.5, 2.0]] : [[1.5, 1.95], [1.2, 1.9], [0.9, 1.9]];
  // Headboard on a solid wall: no door, ideally no window.
  for (const wall of p.wallsBy((w) => (w.hasDoor ? -10 : 0) + (w.hasWindow ? -2 : 0) + w.len * 0.1)) {
    for (const [bw, bl] of sizes) {
      const u = p.slot(wall, bw, bl, 0.6);
      if (u === null) continue;
      const body = wall.rect(u, 0, bw, bl);
      p.take(wall.rect(u - 0.05, 0, bw + 0.1, bl + 0.6));
      p.rect(body, 0.06);
      // Pillows, blanket fold.
      const n = bw >= 1.4 ? 2 : 1;
      const pw = (bw - 0.2 - (n - 1) * 0.1) / n;
      for (let i = 0; i < n; i++) p.rect(wall.rect(u + 0.1 + i * (pw + 0.1), 0.1, pw, 0.4), 0.08);
      p.line(wall.pt(u, bl * 0.42), wall.pt(u + bw, bl * 0.42));
      p.line(wall.pt(u, bl * 0.42 + 0.12), wall.pt(u + bw, bl * 0.42 + 0.12));
      // Bedside tables if there's room.
      for (const nu of [u - 0.5, u + bw + 0.05]) {
        const t = wall.rect(nu, 0, 0.45, 0.4);
        if (p.fits(t)) { p.rect(t, 0.03); p.take(t); }
      }
      wardrobe(p, Math.min(2.4, r.w, r.h) * 0.9);
      return;
    }
  }
}

function wardrobe(p: Planner, maxLen: number) {
  for (const wall of p.wallsBy((w) => (w.hasDoor ? 0 : 1) + (w.hasWindow ? 0 : 1) + w.len * 0.01)) {
    for (const len of [maxLen, 1.8, 1.2]) {
      if (len < 0.9) continue;
      const u = p.slot(wall, len, 0.6, 0.5, "end");
      if (u === null) continue;
      const body = wall.rect(u, 0, len, 0.6);
      p.take(wall.rect(u, 0, len, 1.1));
      p.rect(body, 0.02);
      p.line(wall.pt(u, 0.3), wall.pt(u + len, 0.3));
      const doors = Math.max(2, Math.round(len / 0.6));
      for (let i = 1; i < doors; i++) p.line(wall.pt(u + (len * i) / doors, 0.3), wall.pt(u + (len * i) / doors, 0.6));
      return;
    }
  }
}

function sofaSet(p: Planner) {
  const walls = p.wallsBy((w) => (w.hasDoor ? -5 : 0) + w.len * 0.2 + (w.hasWindow ? -0.5 : 0));
  for (const wall of walls) {
    for (const sw of [2.2, 1.8, 1.4]) {
      const u = p.slot(wall, sw, 0.9, 1.6);
      if (u === null) continue;
      const body = wall.rect(u, 0, sw, 0.9);
      p.take(wall.rect(u, 0, sw, 1.0));
      p.rect(body, 0.12);
      p.rect(wall.rect(u + 0.05, 0.05, sw - 0.1, 0.2), 0.06); // backrest
      const seats = Math.round(sw / 0.7);
      for (let i = 1; i < seats; i++) p.line(wall.pt(u + (sw * i) / seats, 0.25), wall.pt(u + (sw * i) / seats, 0.85));
      // Coffee table in front.
      const tw = Math.min(1.1, sw * 0.55);
      const table = wall.rect(u + (sw - tw) / 2, 1.3, tw, 0.55);
      if (p.fits(table)) { p.rect(table, 0.05); p.take(table); }
      // TV unit on the opposite wall when the room is deep enough.
      const opposite = p.walls.find((w) => w.side === ({ top: "bottom", bottom: "top", left: "right", right: "left" } as const)[wall.side])!;
      if (wall.room >= 3.0) {
        const tv = p.slot(opposite, Math.min(1.8, opposite.len * 0.5), 0.4, 0.3);
        if (tv !== null) {
          const unit = opposite.rect(tv, 0, Math.min(1.8, opposite.len * 0.5), 0.4);
          p.rect(unit, 0.02);
          p.take(unit);
          p.line(opposite.pt(tv + 0.2, 0.08), opposite.pt(tv + Math.min(1.8, opposite.len * 0.5) - 0.2, 0.08));
        }
      }
      return;
    }
  }
}

function diningSet(p: Planner) {
  const r = p.room;
  const long = Math.max(r.w, r.h);
  const short = Math.min(r.w, r.h);
  const opts: [number, number, number][] = [[1.8, 0.9, 3], [1.4, 0.85, 2], [1.0, 0.8, 2], [0.8, 0.8, 1]];
  for (const [tl, tw, perSide] of opts) {
    if (tl + 1.2 > long || tw + 1.3 > short) continue;
    const horizontal = r.w >= r.h;
    const w = horizontal ? tl : tw;
    const h = horizontal ? tw : tl;
    const table: Rect = { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
    const zone = { x: table.x - 0.55, y: table.y - 0.55, w: w + 1.1, h: h + 1.1 };
    if (!p.fits(zone)) continue;
    p.rect(table, 0.06);
    p.take(zone);
    for (let i = 0; i < perSide; i++) {
      const t = (i + 0.5) / perSide;
      if (horizontal) {
        const cx = table.x + t * w - 0.22;
        p.rect({ x: cx, y: table.y - 0.5, w: 0.44, h: 0.42 }, 0.08);
        p.rect({ x: cx, y: table.y + h + 0.08, w: 0.44, h: 0.42 }, 0.08);
      } else {
        const cy = table.y + t * h - 0.22;
        p.rect({ x: table.x - 0.5, y: cy, w: 0.42, h: 0.44 }, 0.08);
        p.rect({ x: table.x + w + 0.08, y: cy, w: 0.42, h: 0.44 }, 0.08);
      }
    }
    return;
  }
}

function kitchen(p: Planner) {
  // Counter along the best wall (sink under the window), returning along a second wall.
  const walls = p.wallsBy((w) => (w.hasDoor ? -5 : 0) + (w.hasWindow ? 2 : 0) + w.len * 0.3);
  // Longest counter that clears the doors, on the best wall that takes one.
  let main = walls[0];
  let len = 0;
  let u: number | null = null;
  search: for (const w of walls) {
    for (let l = w.len - 0.1; l >= 1.2; l -= 0.15) {
      const at = p.slot(w, l, 0.6, 0.75);
      if (at !== null) { main = w; len = l; u = at; break search; }
    }
  }
  if (u === null) return;
  const counter = main.rect(u, 0, len, 0.6);
  p.rect(counter, 0.01);
  p.take(main.rect(u, 0, len, 0.6));
  // Sink (double bowl) near the middle, hob towards one end.
  const sinkU = u + len * 0.5 - 0.4;
  p.rect(main.rect(sinkU, 0.1, 0.38, 0.4), 0.05);
  p.rect(main.rect(sinkU + 0.42, 0.1, 0.38, 0.4), 0.05);
  if (len > 2.2) {
    const hobU = u + len - 0.75;
    for (const [du, dv] of [[0.15, 0.17], [0.45, 0.17], [0.15, 0.43], [0.45, 0.43]]) {
      const [cx, cy] = main.pt(hobU + du, dv);
      p.circle([cx, cy], 0.09);
    }
  }
  // Return counter on an adjacent wall without a door.
  const adj = p.walls.filter((w) => w.side !== main.side && !w.hasDoor && w.len > 1.4 &&
    (["top", "bottom"].includes(main.side) ? ["left", "right"] : ["top", "bottom"]).includes(w.side));
  for (const w2 of adj) {
    const l2 = Math.min(w2.len - 0.7, 1.8);
    const u2 = p.slot(w2, l2, 0.6, 0.6, "start");
    if (u2 === null) continue;
    const c2 = w2.rect(u2, 0, l2, 0.6);
    p.rect(c2, 0.01);
    p.take(c2);
    break;
  }
  // Fridge.
  for (const w3 of p.walls) {
    const uf = p.slot(w3, 0.7, 0.7, 0.4, "end");
    if (uf === null) continue;
    const f = w3.rect(uf, 0, 0.7, 0.7);
    p.rect(f, 0.04);
    p.line(w3.pt(uf, 0.12), w3.pt(uf + 0.7, 0.12));
    p.take(f);
    break;
  }
}

function bath(p: Planner, generous: boolean, shower = true) {
  const walls = p.wallsBy((w) => (w.hasDoor ? -5 : 0) + w.len * 0.1);
  // Shower / tub in the far corner, WC and basin along a wall.
  const wall = walls[0];
  const tub = generous && wall.len >= 1.8 && wall.room >= 1.6;
  const sw = tub ? 1.7 : Math.min(0.9, wall.len * 0.45);
  const sd = tub ? 0.75 : Math.min(0.9, wall.room * 0.5);
  const su = shower ? p.slot(wall, sw, sd, 0, "end") : null;
  if (su !== null) {
    const s = wall.rect(su, 0, sw, sd);
    p.take(s);
    if (tub) {
      p.rect(s, 0.05);
      p.rect(wall.rect(su + 0.08, 0.08, sw - 0.16, sd - 0.16), 0.3);
    } else {
      p.rect(s, 0.0);
      p.line(wall.pt(su, 0), wall.pt(su + sw, sd));
      p.line(wall.pt(su + sw, 0), wall.pt(su, sd));
    }
  }
  for (const w of walls) {
    const uw = p.slot(w, 0.42, 0.7, 0.4, "start");
    if (uw === null) continue;
    const [cx, cy] = w.pt(uw + 0.21, 0.45);
    p.rect(w.rect(uw + 0.03, 0, 0.36, 0.18), 0.03); // cistern
    p.circle([cx, cy], 0.2);
    p.take(w.rect(uw - 0.1, 0, 0.62, 1.1));
    break;
  }
  for (const w of walls) {
    const ub = p.slot(w, 0.5, 0.42, 0.4);
    if (ub === null) continue;
    const b = w.rect(ub, 0, 0.5, 0.42);
    p.rect(b, 0.04);
    const [cx, cy] = w.pt(ub + 0.25, 0.24);
    p.circle([cx, cy], 0.13);
    p.take(b);
    break;
  }
}

function desk(p: Planner) {
  for (const wall of p.wallsBy((w) => (w.hasDoor ? -5 : 0) + (w.hasWindow ? 2 : 0))) {
    const u = p.slot(wall, 1.3, 0.6, 0.8);
    if (u === null) continue;
    p.rect(wall.rect(u, 0, 1.3, 0.6), 0.02);
    p.circle(wall.pt(u + 0.65, 0.95), 0.25);
    p.take(wall.rect(u, 0, 1.3, 1.3));
    return;
  }
}

function altar(p: Planner) {
  for (const wall of p.wallsBy((w) => (w.hasDoor ? -5 : 0) + w.len * 0.1)) {
    const w = Math.min(1.0, wall.len - 0.2);
    const u = p.slot(wall, w, 0.45, 0.6);
    if (u === null) continue;
    p.rect(wall.rect(u, 0, w, 0.45), 0.02);
    p.rect(wall.rect(u + w * 0.3, 0.05, w * 0.4, 0.2), 0.02);
    p.circle(wall.pt(u + w / 2, 0.75), 0.08);
    return;
  }
}

function washer(p: Planner) {
  for (const wall of p.wallsBy((w) => (w.hasDoor ? -5 : 0))) {
    const u = p.slot(wall, 0.6, 0.6, 0.4);
    if (u === null) continue;
    const box = wall.rect(u, 0, 0.6, 0.6);
    p.rect(box, 0.04);
    p.circle(wall.pt(u + 0.3, 0.32), 0.2);
    p.take(box);
    return;
  }
}

function shelves(p: Planner) {
  for (const wall of p.wallsBy((w) => (w.hasDoor ? -5 : 0) + w.len)) {
    const len = wall.len - 0.1;
    const u = p.slot(wall, len, 0.4, 0.4);
    if (u === null) continue;
    p.rect(wall.rect(u, 0, len, 0.4), 0);
    p.line(wall.pt(u, 0.2), wall.pt(u + len, 0.2));
    return;
  }
}

function seating(p: Planner) {
  const r = p.room;
  const n = Math.min(3, Math.floor(Math.max(r.w, r.h) / 1.6));
  const horizontal = r.w >= r.h;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const c: [number, number] = horizontal ? [r.x + t * r.w, r.y + r.h / 2] : [r.x + r.w / 2, r.y + t * r.h];
    const rad = Math.min(0.3, Math.min(r.w, r.h) * 0.22);
    const zone = { x: c[0] - rad, y: c[1] - rad, w: rad * 2, h: rad * 2 };
    if (!p.fits(zone)) continue;
    p.circle(c, rad);
    p.take(zone);
  }
}

/** Furniture for one room (world metres). */
/** Door clearance zones for a room (exported for tests). */
export function doorClearances(room: Room, doors: Door[]): Rect[] {
  return clearZones(room, doors);
}

export function furnish(room: Room, doors: Door[], windows: WindowMark[]): Shape[] {
  const p = new Planner(room, doors, windows);
  switch (room.type) {
    case "master_bedroom": bed(p, true); break;
    case "bedroom": bed(p, false); break;
    case "living":
    case "lounge": sofaSet(p); break;
    case "dining": diningSet(p); break;
    case "kitchen": kitchen(p); break;
    case "bathroom": bath(p, room.w * room.h >= 5.2); break;
    case "toilet": bath(p, false, false); break;
    case "dress": wardrobe(p, Math.max(room.w, room.h) - 0.2); break;
    case "office": desk(p); break;
    case "pooja": altar(p); break;
    case "utility": washer(p); break;
    case "store": shelves(p); break;
    case "sitout":
    case "balcony": seating(p); break;
  }
  return p.shapes;
}
