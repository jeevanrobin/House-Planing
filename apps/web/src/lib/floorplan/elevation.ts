/**
 * Front elevation: the facade that faces the road, as an architect draws it.
 *
 * Drawing frame: x along the road (the plan's x), h = height above ground
 * (metres, up). The road is along the bottom of the plan sheet (largest y),
 * so the viewer stands there looking at walls whose outside faces +y.
 * Everything comes from the plan, so the elevation always matches it.
 */
import { buildModel, DOOR_H, FLOOR_H, SILL_H, SLAB, type RoofStyle } from "./model3d";
import type { FloorPlan, PlanResult, Wall } from "./types";

export const PLINTH = 0.45;

export interface FacadeBlock {
  x0: number;
  x1: number;
  h0: number;
  h1: number;
  /** How far behind the front-most wall it stands (m): deeper is drawn darker. */
  depth: number;
  floor: number;
  /** Modern houses: wood-slat cladding on one feature block. */
  clad?: boolean;
}

export interface Opening {
  x0: number;
  x1: number;
  h0: number;
  h1: number;
  kind: "window" | "door" | "main";
  depth: number;
}

export interface Railing {
  x0: number;
  x1: number;
  h0: number;
  h1: number;
  depth: number;
}

export interface Elevation {
  x0: number;
  x1: number;
  /** Height of the highest point (parapet top or roof ridge). */
  top: number;
  blocks: FacadeBlock[];
  openings: Opening[];
  railings: Railing[];
  /** Slab edges (with sunshades over windows). */
  slabs: { x0: number; x1: number; h: number }[];
  chajjas: { x0: number; x1: number; h: number }[];
  pillars: { x: number; h0: number; h1: number }[];
  roof: { kind: "flat"; x0: number; x1: number; h0: number; h1: number }
    | { kind: "sloped"; eave: [number, number]; ridge: [number, number]; h0: number; h1: number };
  /** Finished floor levels (for the level marks). */
  levels: { label: string; h: number }[];
  plot: { x0: number; x1: number };
  /** Gate opening in the compound wall, in front of the car / entrance. */
  gate: { x0: number; x1: number };
  style: "modern" | "traditional";
}

const E = 0.04;
const OPEN = ["sitout", "balcony", "terrace", "parking"];

/** Exterior and railing walls of a floor whose outside faces the road (+y). */
function frontWalls(f: FloorPlan): Wall[] {
  return f.walls.filter((w) => {
    if (w.orientation !== "h" || w.type === "interior") return false;
    const a = Math.min(w.x1, w.x2);
    const b = Math.max(w.x1, w.x2);
    const mid = (a + b) / 2;
    // A room just north of the wall (inside), and nothing enclosed just south of it on this floor
    // (a facade behind a sit-out or balcony still shows, behind its railing).
    const inside = f.rooms.some((r) => Math.abs(r.y + r.h - w.y1) < E && mid > r.x && mid < r.x + r.w);
    const outside = f.rooms.some((r) => !OPEN.includes(r.type) && Math.abs(r.y - w.y1) < E && mid > r.x && mid < r.x + r.w);
    return inside && !outside;
  });
}

export function buildElevation(plan: PlanResult, roofStyle: RoofStyle = "flat"): Elevation {
  const style = roofStyle === "sloped" ? "traditional" : "modern";
  const front = Math.max(...plan.floors.flatMap((f) => frontWalls(f).map((w) => w.y1)));
  const blocks: FacadeBlock[] = [];
  const openings: Opening[] = [];
  const railings: Railing[] = [];
  const slabs: Elevation["slabs"] = [];
  const chajjas: Elevation["chajjas"] = [];
  const pillars: Elevation["pillars"] = [];
  const levels: Elevation["levels"] = [{ label: "Ground", h: 0 }];
  const names = ["Plinth", "First", "Second", "Third", "Fourth", "Fifth"];
  const top = plan.floors.length - 1;

  plan.floors.forEach((f, i) => {
    const base = PLINTH + i * FLOOR_H;
    levels.push({ label: i === 0 ? "Plinth" : `${names[i]} floor`, h: base });
    const xs = f.rooms.map((r) => [r.x, r.x + r.w]).flat();
    const fx0 = Math.min(...xs);
    const fx1 = Math.max(...xs);
    slabs.push({ x0: fx0, x1: fx1, h: base + FLOOR_H - SLAB });
    for (const w of frontWalls(f)) {
      const a = Math.min(w.x1, w.x2);
      const b = Math.max(w.x1, w.x2);
      const depth = front - w.y1;
      if (w.type === "railing") {
        railings.push({ x0: a, x1: b, h0: base, h1: base + 1.0, depth });
        // A ground-floor sit-out / verandah stands on pillars.
        if (i === 0 && f.rooms.some((r) => r.type === "sitout" && Math.abs(r.y + r.h - w.y1) < E)) {
          const n = Math.max(1, Math.ceil((b - a) / 2.4));
          for (let k = 0; k <= n; k++) pillars.push({ x: a + ((b - a) * k) / n, h0: base, h1: base + FLOOR_H - SLAB });
        }
        continue;
      }
      blocks.push({ x0: a, x1: b, h0: base, h1: base + FLOOR_H, depth, floor: i });
      for (const o of [...f.doors.map((d) => ({ ...d, isDoor: true })), ...f.windows.map((wi) => ({ ...wi, isDoor: false, kind: undefined }))]) {
        if (o.orientation !== "h" || Math.abs(o.y - w.y1) > 0.03) continue;
        const ox0 = Math.max(a, o.x);
        const ox1 = Math.min(b, o.x + o.width);
        if (ox1 - ox0 < 0.2) continue;
        const kind: Opening["kind"] = o.isDoor ? (o.kind === "main" ? "main" : "door") : "window";
        openings.push({ x0: ox0, x1: ox1, h0: base + (kind === "window" ? SILL_H : 0), h1: base + DOOR_H, kind, depth });
        if (kind === "window") chajjas.push({ x0: ox0 - 0.3, x1: ox1 + 0.3, h: base + DOOR_H + 0.15 });
      }
    }
  });

  // Roof.
  const topBase = PLINTH + top * FLOOR_H;
  const topRooms = plan.floors[top].rooms;
  const tx0 = Math.min(...topRooms.map((r) => r.x));
  const tx1 = Math.max(...topRooms.map((r) => r.x + r.w));
  let roof: Elevation["roof"];
  let height: number;
  if (roofStyle === "sloped") {
    const mesh = buildModel(plan, { roofStyle: "sloped", furniture: false }).meshes[0];
    const ys: number[] = [];
    const xs: number[] = [];
    for (let k = 0; k < mesh.positions.length; k += 3) { xs.push(mesh.positions[k]); ys.push(mesh.positions[k + 1]); }
    const yMax = Math.max(...ys);
    const ridge = xs.filter((_, k) => ys[k] > yMax - 1e-6);
    const lift = PLINTH; // the 3D model has no plinth
    roof = {
      kind: "sloped", eave: [Math.min(...xs), Math.max(...xs)], ridge: [Math.min(...ridge), Math.max(...ridge)],
      h0: Math.min(...ys) + lift, h1: yMax + lift,
    };
    height = yMax + lift;
  } else {
    roof = { kind: "flat", x0: tx0, x1: tx1, h0: topBase + FLOOR_H, h1: topBase + FLOOR_H + 0.9 };
    height = topBase + FLOOR_H + 0.9;
  }

  // Modern facade: wood-slat cladding on the front-most block of the top floor (or the ground floor of a bungalow).
  if (style === "modern" && blocks.length) {
    const candidates = blocks.filter((b) => b.floor === top && b.x1 - b.x0 >= 1.8);
    const pick = candidates.sort((p, q) => p.depth - q.depth || (q.x1 - q.x0) - (p.x1 - p.x0))[0];
    if (pick) pick.clad = true;
  }

  // Gate: in front of the car if there is one, else the main door.
  const site = plan.site;
  const car = [...plan.floors[0].rooms.filter((r) => r.type === "parking"), ...site.elements.filter((e) => e.type === "parking")][0];
  const main = openings.find((o) => o.kind === "main");
  const gx = car ? car.x + car.w / 2 : main ? (main.x0 + main.x1) / 2 : (tx0 + tx1) / 2;
  const gw = car ? 3.6 : 1.5;
  const px = site.plot.map(([x]) => x);
  const plot = { x0: Math.min(...px), x1: Math.max(...px) };
  const gate = { x0: Math.max(plot.x0 + 0.3, gx - gw / 2), x1: Math.min(plot.x1 - 0.3, gx + gw / 2) };

  return {
    x0: Math.min(...blocks.map((b) => b.x0), tx0), x1: Math.max(...blocks.map((b) => b.x1), tx1),
    top: height, blocks, openings, railings, slabs, chajjas, pillars, roof, levels, plot, gate, style,
  };
}
