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
  | "stair" | "furniture" | "roof" | "grass" | "water" | "car" | "trunk" | "leaves" | "ground";

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

export interface Model3D {
  boxes: Box[];
  rounds: Round[];
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
  stair: "floorStone", corridor: "floorStone", store: "floorStone", foyer: "floorStone",
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

function wallsFor(f: FloorPlan, base: number, floor: number): Box[] {
  const out: Box[] = [];
  for (const w of f.walls) {
    const lo = w.orientation === "v" ? Math.min(w.y1, w.y2) : Math.min(w.x1, w.x2);
    const hi = w.orientation === "v" ? Math.max(w.y1, w.y2) : Math.max(w.x1, w.x2);
    if (w.type === "railing") {
      out.push(wallPiece(w, lo, hi, 0, RAIL_H, base, "railing", floor));
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
}

export function buildModel(plan: PlanResult, opts: ModelOptions = {}): Model3D {
  const boxes: Box[] = [];
  const rounds: Round[] = [];
  const furniture = opts.furniture ?? true;

  plan.floors.forEach((f, i) => {
    const base = i * FLOOR_H;
    for (const r of f.rooms) {
      // Floor finish (the slab under it on upper floors).
      boxes.push(box(r.x, r.x + r.w, base - SLAB, base, r.y, r.y + r.h, FLOOR_MAT[r.type] ?? "floorStone", i, "floor"));
      if (r.type === "stair") boxes.push(...stairFor(r, base, i));
      // Roof over this floor's enclosed rooms (shown when it is the top visible floor).
      if (!OPEN.includes(r.type) || r.type === "sitout" || r.type === "parking") {
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
    boxes.push(...wallsFor(f, base, i));
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
  return { boxes, rounds, floors: plan.floors.length, center, radius };
}
