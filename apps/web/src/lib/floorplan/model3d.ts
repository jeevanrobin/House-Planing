/**
 * 3D model of a generated plan, as simple solids (boxes, cylinders, spheres)
 * in metres. Pure and renderer-agnostic: the 3D view turns these into meshes.
 *
 * Axes: x = plan x, z = plan y (south), y = up. Floor f's finished floor
 * level is f × FLOOR_H.
 */
import { furnish } from "./furniture";
import type { Door, FloorPlan, PlanResult, Room, RoomType, Wall, WindowMark } from "./types";

export const FLOOR_H = 3.0;
export const SLAB = 0.15;
export const WALL_H = FLOOR_H - SLAB;
export const DOOR_H = 2.1;
export const SILL_H = 0.9;
export const RAIL_H = 1.0;

export type Material =
  | "wall" | "wallExt" | "railing" | "glass" | "lintel"
  | "floorWood" | "floorTile" | "floorStone" | "floorDeck" | "floorPaving"
  | "stair" | "furniture" | "roof" | "grass" | "water" | "car" | "trunk" | "leaves" | "ground"
  | "tile" | "pillar";

export interface Box {
  /** Centre. */
  x: number;
  y: number;
  z: number;
  /** Size along x, y, z. */
  sx: number;
  sy: number;
  sz: number;
  material: Material;
  floor: number;
  kind: "wall" | "floor" | "stair" | "furniture" | "roof" | "glass" | "site";
}

export interface Round {
  shape: "cylinder" | "sphere";
  x: number;
  y: number;
  z: number;
  r: number;
  h: number;
  material: Material;
  floor: number;
  kind: "furniture" | "site";
}

/** Triangles (x, y, z per vertex, three vertices per triangle): sloped roofs. */
export interface Mesh {
  positions: number[];
  material: Material;
  floor: number;
  kind: "roof";
}

export interface Model3D {
  boxes: Box[];
  rounds: Round[];
  meshes: Mesh[];
  floors: number;
  /** Centre and radius of everything, for framing the camera. */
  center: [number, number, number];
  radius: number;
}

const FLOOR_MAT: Partial<Record<RoomType, Material>> = {
  living: "floorWood", lounge: "floorWood", dining: "floorWood", bedroom: "floorWood", master_bedroom: "floorWood",
  office: "floorWood", dress: "floorWood", pooja: "floorStone",
  kitchen: "floorTile", bathroom: "floorTile", toilet: "floorTile", utility: "floorTile",
  sitout: "floorDeck", balcony: "floorDeck", terrace: "floorPaving", parking: "floorPaving",
  stair: "floorStone", corridor: "floorStone", store: "floorStone", foyer: "floorStone", lift: "floorStone",
};
const OPEN: RoomType[] = ["sitout", "balcony", "terrace", "parking"];

const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, material: Material, floor: number, kind: Box["kind"]): Box => ({
  x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2,
  sx: Math.max(0.001, x1 - x0), sy: Math.max(0.001, y1 - y0), sz: Math.max(0.001, z1 - z0),
  material, floor, kind,
});

/** A slice of a wall between a..b (along the wall), from height h0 to h1. */
function wallPiece(w: Wall, a: number, b: number, h0: number, h1: number, base: number, material: Material, floor: number, kind: Box["kind"] = "wall"): Box {
  const t = w.thickness / 2;
  return w.orientation === "v"
    ? box(w.x1 - t, w.x1 + t, base + h0, base + h1, a, b, material, floor, kind)
    : box(a, b, base + h0, base + h1, w.y1 - t, w.y1 + t, material, floor, kind);
}

interface Opening { a: number; b: number; kind: "door" | "window" }

/** Doors and windows lying on a wall, as intervals along it. */
function openingsOn(w: Wall, doors: Door[], windows: WindowMark[]): Opening[] {
  const at = w.orientation === "v" ? w.x1 : w.y1;
  const lo = w.orientation === "v" ? Math.min(w.y1, w.y2) : Math.min(w.x1, w.x2);
  const hi = w.orientation === "v" ? Math.max(w.y1, w.y2) : Math.max(w.x1, w.x2);
  const out: Opening[] = [];
  const add = (o: { x: number; y: number; width: number; orientation: "h" | "v" }, kind: Opening["kind"]) => {
    if (o.orientation !== w.orientation) return;
    const oat = o.orientation === "v" ? o.x : o.y;
    if (Math.abs(oat - at) > 0.03) return;
    const a = Math.max(lo, o.orientation === "v" ? o.y : o.x);
    const b = Math.min(hi, (o.orientation === "v" ? o.y : o.x) + o.width);
    if (b - a > 0.05) out.push({ a, b, kind });
  };
  doors.forEach((d) => add(d, "door"));
  windows.forEach((wi) => add(wi, "window"));
  return out.sort((p, q) => p.a - q.a);
}

function wallsFor(f: FloorPlan, base: number, floor: number, onCourtyard: (w: Wall) => boolean = () => false): Box[] {
  const out: Box[] = [];
  for (const w of f.walls) {
    const lo = w.orientation === "v" ? Math.min(w.y1, w.y2) : Math.min(w.x1, w.x2);
    const hi = w.orientation === "v" ? Math.max(w.y1, w.y2) : Math.max(w.x1, w.x2);
    if (w.type === "railing") {
      // Round a courtyard: a low sitting ledge (arugu) between the pillars, not a balustrade.
      out.push(onCourtyard(w)
        ? wallPiece(w, lo, hi, 0, 0.45, base, "floorStone", floor)
        : wallPiece(w, lo, hi, 0, RAIL_H, base, "railing", floor));
      continue;
    }
    const mat: Material = w.type === "exterior" ? "wallExt" : "wall";
    let cursor = lo;
    for (const o of openingsOn(w, f.doors, f.windows)) {
      if (o.a > cursor + 0.01) out.push(wallPiece(w, cursor, o.a, 0, WALL_H, base, mat, floor));
      if (o.kind === "door") {
        out.push(wallPiece(w, o.a, o.b, DOOR_H, WALL_H, base, mat, floor));
      } else {
        out.push(wallPiece(w, o.a, o.b, 0, SILL_H, base, mat, floor));
        out.push(wallPiece(w, o.a, o.b, DOOR_H, WALL_H, base, mat, floor));
        out.push({ ...wallPiece(w, o.a, o.b, SILL_H, DOOR_H, base, "glass", floor, "glass"), ...(w.orientation === "v" ? { sx: 0.03 } : { sz: 0.03 }) });
      }
      cursor = Math.max(cursor, o.b);
    }
    if (hi > cursor + 0.01) out.push(wallPiece(w, cursor, hi, 0, WALL_H, base, mat, floor));
  }
  return out;
}

/** Dog-leg stair: up one half of the width, a landing at the far end, back up the other half. */
function stairFor(r: Room, base: number, floor: number): Box[] {
  const out: Box[] = [];
  const alongZ = r.h >= r.w;
  const len = alongZ ? r.h : r.w;
  const wid = alongZ ? r.w : r.h;
  const risers = 18;
  const rise = FLOOR_H / risers;
  const perFlight = risers / 2;
  const landing = Math.min(wid / 2, len * 0.3);
  const run = len - landing;
  const tread = run / perFlight;
  const half = wid / 2;
  // (u along the length from the far end, v across) → world rectangle.
  const rect = (u0: number, u1: number, v0: number, v1: number, h: number): Box => alongZ
    ? box(r.x + v0, r.x + v1, base, base + h, r.y + r.h - u1, r.y + r.h - u0, "stair", floor, "stair")
    : box(r.x + r.w - u1, r.x + r.w - u0, base, base + h, r.y + v0, r.y + v1, "stair", floor, "stair");
  for (let i = 0; i < perFlight; i++) {
    // Flight 1 climbs away from the entry end (u decreasing toward the landing at u = len).
    const u0 = i * tread;
    out.push(rect(u0, u0 + tread, 0, half - 0.05, (i + 1) * rise));
  }
  out.push(rect(run, len, 0, wid, perFlight * rise));
  for (let i = 0; i < perFlight; i++) {
    // Flight 2 comes back towards the entry end on the other half.
    const u1 = run - i * tread;
    out.push(rect(u1 - tread, u1, half + 0.05, wid, (perFlight + i + 1) * rise));
  }
  return out;
}

export interface ModelOptions {
  furniture?: boolean;
  /** "flat": RCC roof with a parapet; "sloped": a Mangalore-tile roof (hip, or a ring round a courtyard). */
  roofStyle?: "flat" | "sloped";
}

export type RoofStyle = NonNullable<ModelOptions["roofStyle"]>;

const EAVE = 0.6;
const PITCH = Math.tan((24 * Math.PI) / 180);

/** Push a quad (a, b, c, d in order) as two triangles. */
function quad(out: number[], a: number[], b: number[], c: number[], d: number[]) {
  out.push(...a, ...b, ...c, ...a, ...c, ...d);
}

/**
 * Hip roof over a rectangle (plan x0..x1, z0..z1), eaves at height y:
 * a ridge along the long side, four slopes.
 */
export function hipRoof(x0: number, z0: number, x1: number, z1: number, y: number): number[] {
  x0 -= EAVE; z0 -= EAVE; x1 += EAVE; z1 += EAVE;
  const w = x1 - x0;
  const d = z1 - z0;
  const out: number[] = [];
  if (w >= d) {
    const h = y + (d / 2) * PITCH;
    const zm = (z0 + z1) / 2;
    const ra = [x0 + d / 2, h, zm];
    const rb = [x1 - d / 2, h, zm];
    quad(out, [x0, y, z0], [x1, y, z0], rb, ra);
    quad(out, [x1, y, z1], [x0, y, z1], ra, rb);
    out.push(x0, y, z1, x0, y, z0, ...ra);
    out.push(x1, y, z0, x1, y, z1, ...rb);
  } else {
    const h = y + (w / 2) * PITCH;
    const xm = (x0 + x1) / 2;
    const ra = [xm, h, z0 + w / 2];
    const rb = [xm, h, z1 - w / 2];
    quad(out, [x0, y, z1], [x0, y, z0], ra, rb);
    quad(out, [x1, y, z0], [x1, y, z1], rb, ra);
    out.push(x0, y, z0, x1, y, z0, ...ra);
    out.push(x1, y, z1, x0, y, z1, ...rb);
  }
  return out;
}

/**
 * Ring roof round an open courtyard (manduva / nalukettu): the ridge runs
 * over the middle of the rooms; one slope falls to the outer eaves, the
 * other into the courtyard, which stays open to the sky.
 */
export function ringRoof(outer: { x0: number; z0: number; x1: number; z1: number }, inner: { x0: number; z0: number; x1: number; z1: number }, y: number): number[] {
  const O = { x0: outer.x0 - EAVE, z0: outer.z0 - EAVE, x1: outer.x1 + EAVE, z1: outer.z1 + EAVE };
  const I = { x0: inner.x0 + 0.4, z0: inner.z0 + 0.4, x1: inner.x1 - 0.4, z1: inner.z1 - 0.4 };
  // Ridge half-way across the narrowest wing.
  const wing = Math.min(inner.x0 - outer.x0, outer.x1 - inner.x1, inner.z0 - outer.z0, outer.z1 - inner.z1);
  const k = wing / 2 + EAVE;
  const R = { x0: O.x0 + k, z0: O.z0 + k, x1: O.x1 - k, z1: O.z1 - k };
  const h = y + k * PITCH;
  const corners = (r: typeof O, yy: number) => [[r.x0, yy, r.z0], [r.x1, yy, r.z0], [r.x1, yy, r.z1], [r.x0, yy, r.z1]];
  const o = corners(O, y);
  const rr = corners(R, h);
  const ii = corners(I, y);
  const out: number[] = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    quad(out, o[i], o[j], rr[j], rr[i]); // outer slope
    quad(out, rr[i], rr[j], ii[j], ii[i]); // inner slope, into the courtyard
  }
  return out;
}

export function buildModel(plan: PlanResult, opts: ModelOptions = {}): Model3D {
  const boxes: Box[] = [];
  const rounds: Round[] = [];
  const meshes: Mesh[] = [];
  const furniture = opts.furniture ?? true;
  const sloped = opts.roofStyle === "sloped";
  const top = plan.floors.length - 1;
  const traditional = sloped;

  plan.floors.forEach((f, i) => {
    const base = i * FLOOR_H;
    const courts = f.rooms.filter((r) => r.type === "terrace" && /courtyard/i.test(r.label));
    const E = 0.03;
    const onCourt = (w: Wall) => courts.some((c) => {
      const lo = Math.min(w.x1, w.x2), hi = Math.max(w.x1, w.x2), lo2 = Math.min(w.y1, w.y2), hi2 = Math.max(w.y1, w.y2);
      return w.orientation === "h"
        ? (Math.abs(w.y1 - c.y) < E || Math.abs(w.y1 - c.y - c.h) < E) && lo >= c.x - E && hi <= c.x + c.w + E
        : (Math.abs(w.x1 - c.x) < E || Math.abs(w.x1 - c.x - c.w) < E) && lo2 >= c.y - E && hi2 <= c.y + c.h + E;
    });
    for (const r of f.rooms) {
      // Floor finish (the slab under it on upper floors).
      boxes.push(box(r.x, r.x + r.w, base - SLAB, base, r.y, r.y + r.h, FLOOR_MAT[r.type] ?? "floorStone", i, "floor"));
      if (r.type === "stair") boxes.push(...stairFor(r, base, i));
      // Roof over this floor's enclosed rooms (shown when it is the top visible floor);
      // a sloped roof replaces the top floor's slab.
      if ((!OPEN.includes(r.type) || r.type === "sitout" || r.type === "parking") && !(sloped && i === top)) {
        boxes.push(box(r.x, r.x + r.w, base + FLOOR_H - SLAB, base + FLOOR_H, r.y, r.y + r.h, "roof", i, "roof"));
      }
      if (furniture) {
        for (const s of furnish(r, f.doors, f.windows)) {
          if (s.kind === "rect") {
            const big = Math.max(s.w, s.h);
            const h = r.type === "kitchen" ? 0.9 : r.type === "dress" ? 2.0 : big > 1.7 ? 0.5 : 0.45;
            boxes.push(box(s.x, s.x + s.w, base, base + h, s.y, s.y + s.h, "furniture", i, "furniture"));
          } else if (s.kind === "circle") {
            rounds.push({ shape: "cylinder", x: s.cx, y: base + 0.22, z: s.cy, r: s.r, h: 0.45, material: "furniture", floor: i, kind: "furniture" });
          }
        }
      }
    }
    boxes.push(...wallsFor(f, base, i, onCourt));

    // Flat roofs: a parapet on the outside walls, shown with that floor's roof.
    if (!(sloped && i === top)) {
      for (const w of f.walls.filter((x) => x.type === "exterior")) {
        const lo = w.orientation === "v" ? Math.min(w.y1, w.y2) : Math.min(w.x1, w.x2);
        const hi = w.orientation === "v" ? Math.max(w.y1, w.y2) : Math.max(w.x1, w.x2);
        boxes.push(wallPiece(w, lo, hi, FLOOR_H, FLOOR_H + 0.9, base, "wallExt", i, "roof"));
      }
    }

    // Pillars on the ground floor: along the open edges of sit-outs / verandahs and round a courtyard.
    if (i === 0) {
      const sitouts = f.rooms.filter((r) => r.type === "sitout");
      const onSitout = (w: Wall) => sitouts.some((r) =>
        w.orientation === "h"
          ? (Math.abs(w.y1 - r.y) < E || Math.abs(w.y1 - r.y - r.h) < E) && Math.min(w.x1, w.x2) >= r.x - E && Math.max(w.x1, w.x2) <= r.x + r.w + E
          : (Math.abs(w.x1 - r.x) < E || Math.abs(w.x1 - r.x - r.w) < E) && Math.min(w.y1, w.y2) >= r.y - E && Math.max(w.y1, w.y2) <= r.y + r.h + E);
      const seen = new Set<string>();
      for (const w of f.walls.filter((x) => x.type === "railing" && (onCourt(x) || onSitout(x)))) {
        const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
        const n = Math.max(1, Math.ceil(len / 2.4));
        for (let k = 0; k <= n; k++) {
          const px = w.x1 + ((w.x2 - w.x1) * k) / n;
          const pz = w.y1 + ((w.y2 - w.y1) * k) / n;
          const key = `${px.toFixed(1)},${pz.toFixed(1)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          rounds.push({ shape: "cylinder", x: px, y: base + WALL_H / 2, z: pz, r: traditional ? 0.13 : 0.15, h: WALL_H, material: traditional ? "pillar" : "wallExt", floor: i, kind: "furniture" });
        }
      }
    }

    // Sloped tile roof over the top floor.
    if (sloped && i === top) {
      const rs = f.rooms;
      const x0 = Math.min(...rs.map((r) => r.x)), x1 = Math.max(...rs.map((r) => r.x + r.w));
      const z0 = Math.min(...rs.map((r) => r.y)), z1 = Math.max(...rs.map((r) => r.y + r.h));
      const eaveY = base + WALL_H;
      const court = courts[0];
      const positions = court
        ? ringRoof({ x0, z0, x1, z1 }, { x0: court.x, z0: court.y, x1: court.x + court.w, z1: court.y + court.h }, eaveY)
        : hipRoof(x0, z0, x1, z1, eaveY);
      meshes.push({ positions, material: "tile", floor: i, kind: "roof" });
    }
  });

  // Site: pool, cars, trees.
  for (const e of plan.site.elements) {
    if (e.type === "pool") {
      boxes.push(box(e.x, e.x + e.w, -0.6, -0.05, e.y, e.y + e.h, "water", 0, "site"));
      boxes.push(box(e.x - 0.6, e.x + e.w + 0.6, -0.08, -0.02, e.y - 0.6, e.y, "floorPaving", 0, "site"));
      boxes.push(box(e.x - 0.6, e.x + e.w + 0.6, -0.08, -0.02, e.y + e.h, e.y + e.h + 0.6, "floorPaving", 0, "site"));
    } else if (e.type === "parking") {
      const vertical = e.h >= e.w;
      const cw = 1.8, cl = 4.3;
      const cx = e.x + e.w / 2, cz = e.y + e.h / 2;
      const [sx, sz] = vertical ? [cw, cl] : [cl, cw];
      boxes.push(box(cx - sx / 2, cx + sx / 2, 0.15, 0.85, cz - sz / 2, cz + sz / 2, "car", 0, "site"));
      boxes.push(box(cx - sx * 0.4, cx + sx * 0.4, 0.85, 1.4, cz - sz * 0.3, cz + sz * 0.25, "car", 0, "site"));
    } else if (e.type === "garden") {
      for (let tx = e.x + 1.5; tx < e.x + e.w - 1; tx += 4.5) {
        for (const tz of e.h > 5 ? [e.y + 1.5, e.y + e.h - 1.5] : [e.y + e.h / 2]) {
          rounds.push({ shape: "cylinder", x: tx, y: 1.0, z: tz, r: 0.15, h: 2.0, material: "trunk", floor: 0, kind: "site" });
          rounds.push({ shape: "sphere", x: tx, y: 2.6, z: tz, r: 1.2, h: 0, material: "leaves", floor: 0, kind: "site" });
        }
      }
    }
  }
  // Ground-floor parking porch: a car under the cover.
  for (const r of plan.floors[0]?.rooms ?? []) {
    if (r.type !== "parking") continue;
    const vertical = r.h >= r.w;
    const [sx, sz] = vertical ? [1.8, Math.min(4.3, r.h - 0.6)] : [Math.min(4.3, r.w - 0.6), 1.8];
    const cx = r.x + r.w / 2, cz = r.y + r.h / 2;
    boxes.push(box(cx - sx / 2, cx + sx / 2, 0.15, 0.85, cz - sz / 2, cz + sz / 2, "car", 0, "site"));
  }

  // Frame the house (with a little of its site), not the whole plot.
  const fp = plan.footprint;
  const center: [number, number, number] = [fp.x + fp.w / 2, plan.floors.length * FLOOR_H * 0.4, fp.y + fp.h / 2];
  const radius = Math.max(fp.w, fp.h, plan.floors.length * FLOOR_H) * 0.75 + 3;
  return { boxes, rounds, meshes, floors: plan.floors.length, center, radius };
}
