/**
 * Plumbing and drainage, derived from a finished plan (world metres, the
 * drawing frame — road along the bottom of the sheet).
 *
 *  - Stacks: every toilet / bath gets a soil stack and every kitchen / wash
 *    area a waste stack, in the room's corner on an outside wall. Wet rooms
 *    stacked floor over floor share one stack, so pipes run straight down.
 *  - Drainage: each stack drops to an inspection chamber (IC) just outside
 *    the wall (kitchen waste through a gully trap first). The ICs are joined
 *    by a drain that runs round the house to the final chamber at the front,
 *    then to the municipal sewer, or to a septic tank and soak pit.
 *  - Water: an underground sump at the front, away from the septic tank, and
 *    an overhead tank on the terrace above the stair.
 *  - Rainwater: down-pipes at the corners (and along long walls) to a
 *    rainwater-harvesting pit in the yard.
 */
import { polygonBBox } from "./polygon-ops";
import type { PlanResult, Rect, Requirements, RoomType } from "./types";

export type Drainage = "sewer" | "septic";
type Pt = [number, number];

export interface Stack {
  id: string;
  kind: "soil" | "waste";
  x: number;
  y: number;
  /** Floors it serves (0 = ground). */
  floors: number[];
  /** Inside the house with no outside wall: needs a duct / shaft. */
  duct: boolean;
}

export interface Chamber {
  id: string;
  x: number;
  y: number;
  /** Kitchen / wash waste passes a gully trap before this chamber. */
  gully: boolean;
  final?: boolean;
}

export interface Tank {
  kind: "septic" | "soakpit" | "sump" | "oht" | "rwh";
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Capacity in litres (tanks), when it matters. */
  litres?: number;
}

export interface ScheduleRow {
  item: string;
  spec: string;
  qty: string;
}

export interface ServicesPlan {
  stacks: Stack[];
  chambers: Chamber[];
  /** Drain runs (polylines) from chamber to chamber and on to the outfall. */
  drains: Pt[][];
  /** Stack → chamber connections. */
  branches: Pt[][];
  /** Rainwater down-pipes, and the runs to the harvesting pit. */
  rwps: Pt[];
  rainRuns: Pt[][];
  tanks: Tank[];
  /** Where the drain leaves the plot (sewer) or ends (septic tank). */
  outfall: Pt;
  drainage: Drainage;
  schedule: ScheduleRow[];
  notes: string[];
}

const SOIL: RoomType[] = ["bathroom", "toilet"];
const WASTE: RoomType[] = ["kitchen", "utility"];
const FLOOR_H = 3.0;
const PERSONS_PER_HOME = 5;
const LPCD = 135; // litres per person per day (BIS norm for domestic supply)

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const roundUp = (v: number, step: number) => Math.ceil(v / step) * step;

/** Homes in the building (each one a household for water / septic sizing). */
export function homesIn(req: Requirements): number {
  if (req.buildingType === "rental") return req.floors;
  if (req.buildingType === "apartment") return (req.flatsPerFloor ?? 2) * (req.floors - 1);
  return 1;
}

export function planServices(plan: PlanResult, req: Requirements, drainage: Drainage = req.drainage ?? "sewer"): ServicesPlan {
  const fp = plan.footprint;
  const plot = polygonBBox(plan.site.plot);
  const notes: string[] = [];
  const x0 = fp.x;
  const y0 = fp.y;
  const x1 = fp.x + fp.w;
  const y1 = fp.y + fp.h;

  // Chambers sit in the open land beside each wall, half-way to the boundary (but at least 0.3 m out).
  const gap = { top: y0 - plot.y, bottom: plot.y + plot.h - y1, left: x0 - plot.x, right: plot.x + plot.w - x1 };
  const off = (g: number) => Math.max(0.3, Math.min(0.75, g / 2));
  const ring: Rect = { x: x0 - off(gap.left), y: y0 - off(gap.top), w: fp.w + off(gap.left) + off(gap.right), h: fp.h + off(gap.top) + off(gap.bottom) };

  /* ---------------- stacks ---------------- */
  const raw: Stack[] = [];
  plan.floors.forEach((f) => {
    for (const r of f.rooms) {
      const kind = SOIL.includes(r.type) ? "soil" : WASTE.includes(r.type) ? "waste" : null;
      if (!kind) continue;
      // Corner on the outside wall nearest the house edge.
      const E = 0.05;
      const sides = [
        { on: Math.abs(r.x - x0) < E, d: r.x - x0 },
        { on: Math.abs(r.x + r.w - x1) < E, d: x1 - r.x - r.w },
        { on: Math.abs(r.y - y0) < E, d: r.y - y0 },
        { on: Math.abs(r.y + r.h - y1) < E, d: y1 - r.y - r.h },
      ];
      const outside = sides.some((s) => s.on);
      const i = sides.reduce((best, s, k) => (s.d < sides[best].d ? k : best), 0);
      const inset = 0.18;
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      // On the chosen side, take the corner nearer the house's middle-line (shorter branch).
      let x = i === 0 ? r.x + inset : i === 1 ? r.x + r.w - inset : (cx < fp.x + fp.w / 2 ? r.x + inset : r.x + r.w - inset);
      let y = i === 2 ? r.y + inset : i === 3 ? r.y + r.h - inset : (cy < fp.y + fp.h / 2 ? r.y + inset : r.y + r.h - inset);
      if (i <= 1) y = Math.min(Math.max(y, r.y + inset), r.y + r.h - inset);
      if (i >= 2) x = Math.min(Math.max(x, r.x + inset), r.x + r.w - inset);
      raw.push({ id: "", kind, x, y, floors: [f.floor], duct: !outside });
    }
  });
  // Wet rooms over wet rooms share a stack.
  const stacks: Stack[] = [];
  for (const s of raw.sort((a, b) => a.floors[0] - b.floors[0])) {
    const near = stacks.find((t) => t.kind === s.kind && dist([t.x, t.y], [s.x, s.y]) < 1.2 && !t.floors.includes(s.floors[0]));
    if (near) {
      near.floors.push(s.floors[0]);
      near.duct = near.duct || s.duct;
    } else {
      stacks.push({ ...s, floors: [...s.floors] });
    }
  }
  let sp = 0;
  let wp = 0;
  stacks.forEach((s) => { s.id = s.kind === "soil" ? `SP${++sp}` : `WP${++wp}`; });
  const ducts = stacks.filter((s) => s.duct).length;
  if (ducts) notes.push(`${ducts} stack(s) serve wet rooms with no outside wall: run them in a duct / shaft with an access panel.`);

  /* ---------------- chambers ---------------- */
  // Project a point onto the chamber ring (the loop just outside the walls).
  const P = 2 * (ring.w + ring.h);
  const toRing = (x: number, y: number): { pt: Pt; t: number } => {
    const cands: { pt: Pt; t: number; d: number }[] = [
      { pt: [Math.min(Math.max(x, ring.x), ring.x + ring.w), ring.y], t: 0, d: 0 },
      { pt: [ring.x + ring.w, Math.min(Math.max(y, ring.y), ring.y + ring.h)], t: 0, d: 0 },
      { pt: [Math.min(Math.max(x, ring.x), ring.x + ring.w), ring.y + ring.h], t: 0, d: 0 },
      { pt: [ring.x, Math.min(Math.max(y, ring.y), ring.y + ring.h)], t: 0, d: 0 },
    ];
    cands[0].t = cands[0].pt[0] - ring.x;
    cands[1].t = ring.w + (cands[1].pt[1] - ring.y);
    cands[2].t = ring.w + ring.h + (ring.x + ring.w - cands[2].pt[0]);
    cands[3].t = 2 * ring.w + ring.h + (ring.y + ring.h - cands[3].pt[1]);
    cands.forEach((c) => { c.d = dist(c.pt, [x, y]); });
    const best = cands.sort((a, b) => a.d - b.d)[0];
    return { pt: best.pt, t: best.t };
  };
  const atT = (t: number): Pt => {
    t = ((t % P) + P) % P;
    if (t <= ring.w) return [ring.x + t, ring.y];
    if (t <= ring.w + ring.h) return [ring.x + ring.w, ring.y + (t - ring.w)];
    if (t <= 2 * ring.w + ring.h) return [ring.x + ring.w - (t - ring.w - ring.h), ring.y + ring.h];
    return [ring.x, ring.y + ring.h - (t - 2 * ring.w - ring.h)];
  };
  /** Path along the ring from t0 to t1 the short way, with its corners. */
  const along = (t0: number, t1: number): Pt[] => {
    let d = t1 - t0;
    if (d > P / 2) d -= P;
    if (d < -P / 2) d += P;
    const corners = [0, ring.w, ring.w + ring.h, 2 * ring.w + ring.h];
    const out: Pt[] = [atT(t0)];
    const steps = corners.flatMap((c) => [c, c + P, c - P])
      .filter((c) => (d > 0 ? c > t0 && c < t0 + d : c < t0 && c > t0 + d))
      .sort((a, b) => (d > 0 ? a - b : b - a));
    for (const c of steps) out.push(atT(c));
    out.push(atT(t0 + d));
    return out;
  };
  const len = (pl: Pt[]) => pl.slice(1).reduce((a, p, i) => a + dist(pl[i], p), 0);

  const chambers: (Chamber & { t: number })[] = [];
  const branches: Pt[][] = [];
  for (const s of stacks) {
    const { pt, t } = toRing(s.x, s.y);
    let c = chambers.find((k) => Math.abs(((k.t - t + P / 2) % P + P) % P - P / 2) < 1.5);
    if (!c) {
      c = { id: "", x: pt[0], y: pt[1], gully: false, t };
      chambers.push(c);
    }
    if (s.kind === "waste") c.gully = true;
    branches.push([[s.x, s.y], [c.x, c.y]]);
  }

  // Outfall: the drain leaves at the road (bottom of the sheet) below the house's middle.
  const roadY = plot.y + plot.h;
  const midX = fp.x + fp.w / 2;
  const final = toRing(midX, ring.y + ring.h);
  let fc = chambers.find((k) => Math.abs(((k.t - final.t + P / 2) % P + P) % P - P / 2) < 1.5);
  if (!fc) {
    fc = { id: "", x: final.pt[0], y: final.pt[1], gully: false, t: final.t };
    chambers.push(fc);
  }
  fc.final = true;
  // Number the chambers round the ring, ending at the final one.
  chambers.sort((a, b) => ((a.t - fc!.t + P) % P) - ((b.t - fc!.t + P) % P));
  const ordered = [...chambers.slice(1), chambers[0]];
  ordered.forEach((c, i) => { c.id = c.final ? "IC (final)" : `IC${i + 1}`; });

  // Each chamber drains to its neighbour on the way to the final chamber (two branches round the house).
  const drains: Pt[][] = [];
  const rel = (c: { t: number }) => {
    let d = c.t - fc!.t;
    if (d > P / 2) d -= P;
    if (d < -P / 2) d += P;
    return d;
  };
  for (const side of [1, -1]) {
    const branch = chambers.filter((c) => !c.final && Math.sign(rel(c)) === side).sort((a, b) => Math.abs(rel(b)) - Math.abs(rel(a)));
    for (let i = 0; i < branch.length; i++) {
      const next = i + 1 < branch.length ? branch[i + 1] : fc;
      drains.push(along(branch[i].t, next.t));
    }
  }

  /* ---------------- outfall: sewer, or septic tank + soak pit ---------------- */
  const tanks: Tank[] = [];
  const homes = homesIn(req);
  const persons = homes * PERSONS_PER_HOME;
  const frontGap = gap.bottom;
  let outfall: Pt;
  if (drainage === "sewer") {
    outfall = [fc.x, roadY];
    drains.push([[fc.x, fc.y], outfall]);
  } else {
    // Two-chamber septic tank sized for the household (IS 2470 order of magnitude), then a soak pit.
    const len = Math.min(4.0, 1.5 + persons * 0.05);
    const wid = Math.min(2.0, 0.9 + persons * 0.02);
    const fits = frontGap >= wid + 0.4;
    const tx = Math.min(Math.max(fc.x - len / 2, plot.x + 0.2), plot.x + plot.w - len - 1.6);
    const ty = fits ? y1 + (frontGap - wid) / 2 : fc.y + 0.3;
    tanks.push({ kind: "septic", label: "Septic tank", x: tx, y: ty, w: len, h: wid, litres: Math.round(persons * 130 + 1000) });
    const pitD = 1.2;
    tanks.push({ kind: "soakpit", label: "Soak pit", x: tx + len + 0.3, y: ty + (wid - pitD) / 2, w: pitD, h: pitD });
    outfall = [tx + len / 2, ty];
    drains.push([[fc.x, fc.y], [fc.x, ty]]);
    drains.push([[tx + len, ty + wid / 2], [tx + len + 0.3, ty + wid / 2]]);
    if (!fits) notes.push("The front yard is narrow for a septic tank; it may need to sit under the driveway with a heavy-duty cover.");
  }

  /* ---------------- water ---------------- */
  // Sump in the front corner away from the septic tank / outfall; OHT over the stair.
  const daily = persons * LPCD;
  const sumpL = roundUp(daily * 1.5, 500);
  const sumpW = Math.min(2.4, Math.max(1.5, Math.sqrt(sumpL / 1000 / 1.5)));
  const leftFar = Math.abs(outfall[0] - plot.x) > Math.abs(outfall[0] - (plot.x + plot.w));
  const sx = leftFar ? plot.x + 0.3 : plot.x + plot.w - sumpW - 0.3;
  const sy = Math.max(y1 + 0.2, roadY - Math.min(frontGap, sumpW) - 0.2);
  tanks.push({ kind: "sump", label: "Sump", x: sx, y: sy, w: sumpW, h: Math.min(sumpW, Math.max(0.8, frontGap - 0.4)), litres: sumpL });
  const top = plan.floors[plan.floors.length - 1];
  const stair = top.rooms.find((r) => r.type === "stair") ?? top.rooms.find((r) => SOIL.includes(r.type)) ?? top.rooms[0];
  const ohtL = roundUp(daily, 500);
  tanks.push({ kind: "oht", label: "Overhead tank", x: stair.x + 0.2, y: stair.y + 0.2, w: Math.min(1.6, stair.w - 0.4), h: Math.min(1.6, stair.h - 0.4), litres: ohtL });

  /* ---------------- rainwater ---------------- */
  const rwps: Pt[] = [];
  const edge = (a: Pt, b: Pt) => {
    const n = Math.max(1, Math.round(dist(a, b) / 9));
    for (let i = 0; i < n; i++) rwps.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
  };
  const c4: Pt[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  for (let i = 0; i < 4; i++) edge(c4[i], c4[(i + 1) % 4]);
  // Harvesting pit in the rear yard if there's room, else the roomier side yard.
  const pitR = 0.6;
  const pit: Pt = gap.top >= 1.4 ? [midX, y0 - gap.top / 2]
    : gap.left >= gap.right ? [x0 - gap.left / 2, fp.y + fp.h / 2] : [x1 + gap.right / 2, fp.y + fp.h / 2];
  tanks.push({ kind: "rwh", label: "Rainwater pit", x: pit[0] - pitR, y: pit[1] - pitR, w: 2 * pitR, h: 2 * pitR });
  const rainRuns = rwps.filter((p) => dist(p, pit) < Math.max(fp.w, fp.h) * 0.75)
    .sort((a, b) => dist(a, pit) - dist(b, pit)).slice(0, 2).map((p) => [p, pit] as Pt[]);
  if (Math.min(gap.top, gap.left, gap.right) < 0.9) notes.push("Side and rear margins are tight: keep chambers and pipes clear of the neighbour's wall.");

  /* ---------------- schedule ---------------- */
  const soil = stacks.filter((s) => s.kind === "soil");
  const waste = stacks.filter((s) => s.kind === "waste");
  const storeys = plan.floors.length;
  const stackLen = (ss: Stack[]) => ss.reduce((a, s) => a + (Math.max(...s.floors) + 1) * FLOOR_H + 1.0, 0);
  const drainLen = drains.reduce((a, d) => a + len(d), 0) + branches.reduce((a, b) => a + len(b), 0);
  const schedule: ScheduleRow[] = [
    { item: "Soil stacks (SP) + vent", spec: "110 mm uPVC SWR", qty: `${soil.length} nos · ${Math.round(stackLen(soil))} m` },
    { item: "Waste stacks (WP)", spec: "75 mm uPVC SWR", qty: `${waste.length} nos · ${Math.round(stackLen(waste))} m` },
    { item: "Inspection chambers", spec: "450 × 450 mm brick, CI cover", qty: `${chambers.length} nos` },
    { item: "Gully traps", spec: "Kitchen / wash waste", qty: `${chambers.filter((c) => c.gully).length} nos` },
    { item: "Underground drain", spec: "110 mm uPVC, 1:40 fall", qty: `${Math.round(drainLen)} m` },
    drainage === "sewer"
      ? { item: "Sewer connection", spec: "To municipal line at the road", qty: "1 no" }
      : { item: "Septic tank + soak pit", spec: `${tanks[0].w.toFixed(1)} × ${tanks[0].h.toFixed(1)} m, ~${(tanks[0].litres! / 1000).toFixed(1)} kL · pit Ø1.2 m`, qty: "1 set" },
    { item: "Sump (underground)", spec: `${(sumpL / 1000).toFixed(1)} kL · 1.5 days' supply`, qty: "1 no" },
    { item: "Overhead tank", spec: `${(ohtL / 1000).toFixed(1)} kL · one day's supply`, qty: "1 no" },
    { item: "Rainwater pipes (RWP)", spec: "110 mm uPVC", qty: `${rwps.length} nos · ${Math.round(rwps.length * (storeys * FLOOR_H + 0.6))} m` },
    { item: "Rainwater harvesting pit", spec: "Ø1.2 m, 2.5 m deep, filter media", qty: "1 no" },
  ];
  notes.push(`Water sized for ${persons} people (${homes} home${homes > 1 ? "s" : ""} × ${PERSONS_PER_HOME}) at ${LPCD} litres per person per day.`);

  return {
    stacks, chambers: ordered.map((c) => ({ id: c.id, x: c.x, y: c.y, gully: c.gully, final: c.final })), drains, branches, rwps, rainRuns, tanks, outfall, drainage, schedule, notes,
  };
}
