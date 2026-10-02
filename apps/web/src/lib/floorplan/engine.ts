/**
 * Floor-plan engine (v4).
 *
 *  1. Program   – realistic rooms per floor, grouped into front→rear bands.
 *  2. Shape     – the plot is turned so its road frontage is square to the
 *                 drawing; each band takes the width the land allows at its
 *                 depth, so the house steps with the plot's shape (one side
 *                 stays straight as the circulation spine).
 *  3. Sizing    – house width chosen by laying every floor out and scoring
 *                 room sizes, plot fit and site features. Rooms compact on
 *                 tight plots and grow towards villa proportions on big ones.
 *  4. Stacking  – upper floors sit within the ground floor's outline and keep
 *                 the staircase exactly above the ground-floor stair.
 *  5. Variants  – band orderings and a mirror are tried; the best Vastu (true
 *                 north) / daylight score wins.
 *  6. Site      – parking, pool and garden go in the open land around the house.
 */
import {
  BALCONY_D, CAR_W, STAIR_MIN_D, STAIR_W, STAIR_W_NARROW, ZONE_OF, groundProgram, rentalUpperProgram, ringProgram, stairWidthFor, upperProgram,
  type Band, type Trim, type FloorProgram, type RoomSpec, type Unit,
} from "./program";
import {
  compactUnit, expandBands, fitDepths, layoutBands, packPrivate, passageUnit, privateBands, targetDepth,
  type Extent, type Placed,
} from "./layout";
import { placeOpenings, sharedWall } from "./openings";
import { layoutRing, type RingKind } from "./ring";
import { insetPolygon, polygonArea } from "./polygon-ops";
import {
  buildableEnvelope, buildableRect, makePlotFrame, planSite, setbacksFor, toWorldRect,
  type Envelope, type PlotFrame, type Setbacks,
} from "./site";
import { directionOf, vastuRoomScore } from "./vastu";
import { exteriorEdges, generateWalls } from "./walls";
import type { FloorAccess, FloorPlan, PlanResult, Polygon, Rect, Requirements, Room, Suggestion } from "./types";

export { placeOpenings } from "./openings";

const FLOOR_NAMES = ["Ground Floor", "First Floor", "Second Floor", "Third Floor", "Fourth Floor", "Fifth Floor"];
const OPEN_TYPES = new Set(["sitout", "balcony", "terrace", "parking"]);
const MAX_HOUSE_W = 30;

/* ------------------------------------------------------------------ */
/* Floor structures at a given width                                   */
/* ------------------------------------------------------------------ */

interface FloorStructure {
  bands: Band[];
  /** Bands before this index keep their natural depth (stair alignment). */
  frozen: number;
}

function openSpec(type: "terrace" | "sitout" | "balcony", label: string, area: number, key: string): RoomSpec {
  return { key, type, label, zone: "outdoor", area, minW: 1.0, minD: 1.0 };
}

/** Pad sparse bands with an open terrace / courtyard instead of stretching rooms. */
function withFiller(band: Band, W: number, label: string, key: string): Band {
  if (band.fixedD !== undefined || !band.units.length) return band;
  const d = targetDepth(band, W);
  const used = band.units.flatMap((u) => u.cols).reduce((a, c) => a + (c.fixedW ?? Math.max(
    c.rooms.reduce((s, r) => s + r.area, 0) / d,
    Math.max(...c.rooms.map((r) => r.minW)),
  )), 0);
  const spare = W - used;
  if (spare < 2.2) return band;
  // Unpinned, so it lands beside the rooms and away from the circulation spine.
  const filler: Unit = { cols: [{ rooms: [openSpec("terrace", label, spare * d, key)] }] };
  return { ...band, units: [...band.units, filler] };
}

/** Insert `u` right after the living room (end-pinned units keep array order). */
function withAfterLiving(units: Unit[], u: Unit): Unit[] {
  const i = units.findIndex((x) => x.cols[0].rooms[0].type === "living");
  return i < 0 ? [...units, u] : [...units.slice(0, i + 1), u, ...units.slice(i + 1)];
}

/** Open-plan living + dining on wide houses so the living room isn't stretched. */
function adjustGround(prog: FloorProgram, W: number): FloorProgram {
  const pub = prog.bands.find((b) => b.kind === "public");
  const svc = prog.bands.find((b) => b.kind === "service");
  // Only beside the living room (not when it moved forward beside the car).
  if (!pub || !svc || !pub.units.some((u) => u.cols[0].rooms[0].type === "living")) return prog;
  const pubArea = pub.units.flatMap((u) => u.cols).flatMap((c) => c.rooms).reduce((a, r) => a + r.area, 0);
  const dining = svc.units.find((u) => u.cols[0].rooms[0].type === "dining");
  if (!dining || pubArea / W >= pub.minD * 0.8) return prog;
  if (pub.units.reduce((a, u) => a + unitMinW(u), 0) + unitMinW(dining) > W) return prog;
  const bands = prog.bands.map((b) =>
    b === pub ? { ...b, units: withAfterLiving(b.units, { ...dining, pin: "end" as const }) }
      : b === svc ? { ...b, units: b.units.filter((u) => u !== dining) } : b);
  return { ...prog, bands };
}

const unitMinW = (u: Unit) => u.cols.reduce((a, c) => a + (c.fixedW ?? Math.max(...c.rooms.filter((r) => !r.optional).map((r) => r.minW), 0)), 0);
const unitArea = (u: Unit) => u.cols.flatMap((c) => c.rooms).filter((r) => !r.optional).reduce((s, r) => s + r.area, 0);

/**
 * Put ground-floor bedrooms beside the living room when the front band has
 * room — and, in compact plans, beside the kitchen-dining too — so small
 * single-storey homes need no bedroom wing behind a corridor. Bedrooms then
 * open straight off the hall or dining, as on most 25–35 ft Indian plots.
 */
function frontBedrooms(prog: FloorProgram, W: number, compact = false): FloorProgram {
  const pub = prog.bands.find((b) => b.kind === "public");
  if (!pub || !prog.privateUnits.length) return prog;
  // Beside the kitchen only when it doubles as the dining room (a bedroom never opens off a kitchen).
  const svc = prog.bands.find((b) => b.kind === "service"
    && b.units.some((u) => u.cols[0].rooms[0].label === "Kitchen & Dining"));
  const targets = [pub, ...(compact && svc ? [svc] : [])];
  const units = new Map(targets.map((b) => [b, [...b.units]]));
  const rest: Unit[] = [];
  for (const u of prog.privateUnits) {
    const type = u.cols[0].rooms[0].type;
    const isBed = type === "bedroom" || type === "master_bedroom";
    let placed = false;
    for (const band of targets) {
      // A common bath may open off the hall, never off the kitchen.
      const variants = isBed ? [u, compactUnit(u)] : compact && type === "bathroom" && band === pub ? [u] : [];
      for (const v of variants) {
        const trial = [...units.get(band)!, v];
        // Fits if minimum widths fit and the band wouldn't need to be deeper than allowed.
        const fitsWidth = trial.reduce((a, t) => a + unitMinW(t), 0) <= W + 1e-6;
        const fitsDepth = trial.reduce((a, t) => a + unitArea(t), 0) / W <= band.maxD;
        if (fitsWidth && fitsDepth) {
          units.get(band)!.push(v);
          placed = true;
          break;
        }
      }
      if (placed) break;
    }
    if (!placed) rest.push(u);
  }
  if (rest.length === prog.privateUnits.length) return prog;
  return { ...prog, bands: prog.bands.map((b) => (units.has(b) ? { ...b, units: units.get(b)! } : b)), privateUnits: rest };
}


function groundStructure(req: Requirements, W: number, Wpriv: number, porch: boolean, ctx: SiteContext): FloorStructure & { stairBand: number } {
  // Narrow plots: the stair rises beside the car porch.
  // Separate homes per floor always reach the stair from outside, at the front.
  const stairFront = req.floors > 1 && (req.buildingType === "rental" || (porch && W < 7.5));
  // Wider plots: the living room sits beside the car rather than behind a sit-out.
  const livingFront = porch && !stairFront && W - req.parking * CAR_W >= 3.6;
  const raw = groundProgram(req, porch, ctx.fit, ctx.trim, stairFront, livingFront, stairWidthFor(W));
  // Tight plots can drop the sit-out (main door straight onto the front wall).
  // (Never when the stair rises beside the sit-out: that row is the way upstairs.)
  const base = ctx.noSitout && !porch && !stairFront ? { ...raw, bands: raw.bands.filter((b) => b.kind !== "sitout"), stairBand: raw.stairBand >= 0 ? raw.stairBand - 1 : -1 } : raw;
  let prog = adjustGround(frontBedrooms(base, W, (ctx.trim ?? 0) >= 2), W);
  // Living room beside the car: rooms in the row behind it (office, a bedroom)
  // would cut it off from the dining, so a passage runs through that row.
  if (livingFront) {
    prog = { ...prog, bands: prog.bands.map((b) => (b.kind === "public" ? { ...b, units: [...b.units, passageUnit()] } : b)) };
  }
  const { bands, stairBand, overflow: spill } = expandBands(prog, W);
  // Maximising a wide plot: spare width in the living and kitchen rows becomes
  // an open-to-sky courtyard (angan) rather than stretched rooms.
  if (ctx.maxUse) {
    bands.forEach((b, i) => {
      if (b.kind === "public" || b.kind === "service") bands[i] = withFiller(b, W, "Courtyard", `court-${b.kind}-${i}`);
    });
  }
  // Rooms that didn't fit their band: try the front band, else (powder room /
  // store with no bedrooms downstairs) leave them out rather than add a hallway.
  const pubIdx = bands.findIndex((b) => b.kind === "public");
  const overflow: Unit[] = [];
  for (const u of spill) {
    const pub = bands[pubIdx];
    if (pub && pub.units.reduce((a, x) => a + unitMinW(x), 0) + unitMinW(u) <= W) {
      bands[pubIdx] = { ...pub, units: [...pub.units, u] };
      continue;
    }
    const type = u.cols[0].rooms[0].type;
    if ((type === "toilet" || type === "store") && !prog.privateUnits.length) continue;
    overflow.push(u);
  }
  // Single-storey "balconies" are decks in the bedroom row, off the hallway.
  const decks: Unit[] = req.floors === 1 && !ctx.trim
    ? Array.from({ length: req.balconies }, (_, i) => ({ cols: [{ rooms: [{ ...openSpec("balcony", `Balcony ${i + 1}`, 6, `gbal-${i}`), minW: 1.8, minD: 1.5 }] }] }))
    : [];
  const privateUnits = [...overflow, ...prog.privateUnits, ...decks];
  // The hallway must open onto a living space: if the band just in front of it
  // has none (e.g. the kitchen row spilled over), run a passage through it.
  const ACCESSIBLE = new Set(["dining", "living", "lounge", "stair", "corridor"]);
  if (privateUnits.length) {
    const last = bands[bands.length - 1];
    const types = last.units.flatMap((u) => u.cols).flatMap((c) => c.rooms).map((r) => r.type);
    if (last.fixedD === undefined && !types.some((t) => ACCESSIBLE.has(t))) {
      bands[bands.length - 1] = { ...last, units: [...last.units, passageUnit()] };
    }
  }
  const priv = privateBands(privateUnits, Wpriv).map((b, i) =>
    b.kind === "private" && !b.corridorBehind ? withFiller(b, Wpriv, "Courtyard", `court-${i}`) : b);
  const all = [...bands, ...priv];
  // Absorbs extra depth when an upper floor is deeper than the ground floor.
  all.push({ kind: "terrace", units: [{ cols: [{ rooms: [openSpec("terrace", "Open Court", 0, "gcourt")] }] }], minD: 0, maxD: 99 });
  // Bands up to the stair keep their natural depth so the stair stacks.
  return { bands: all, frozen: stairBand + 1, stairBand };
}

/**
 * Rental upper floor: the stair (at the front, as on the ground floor) with a
 * bedroom or balcony beside it, then a complete home behind: hall, kitchen,
 * bedrooms — the same rows as the ground-floor home.
 */
function rentalUpperStructure(req: Requirements, floor: number, W: number, stairD: number, stairW: number, fit: number, trim: Trim): FloorStructure {
  const stairUnit = upperProgram(req, floor, fit, trim, stairW).bands.find((b) => b.kind === "stair")!.units
    .find((u) => u.cols[0].rooms[0].type === "stair")!;
  const home = adjustGround(frontBedrooms(rentalUpperProgram(req, floor, fit, trim), W, trim >= 2), W);
  const { bands, overflow } = expandBands(home, W);
  let rest = [...overflow, ...home.privateUnits];
  // Over the porch / sit-out, beside the stair: a bedroom if one fits, else a balcony.
  const room = W - stairW;
  const i = rest.findIndex((u) => u.cols[0].rooms[0].type === "bedroom" && unitMinW(compactUnit(u)) <= room + 1e-6);
  const beside: Unit = i >= 0
    ? { ...compactUnit(rest[i]), pin: "start" }
    : { cols: [{ rooms: [openSpec("balcony", "Balcony", room * stairD, `rbal-front-${floor}`)] }], pin: "start" };
  if (i >= 0) rest = rest.filter((_, j) => j !== i);
  const front: Band = { kind: "stair", units: [beside, { ...stairUnit, cols: [{ ...stairUnit.cols[0], fixedW: stairW }] }], fixedD: stairD, minD: stairD, maxD: stairD };
  // The hallway must open onto a living space (as on the ground floor).
  const ACCESSIBLE = new Set(["dining", "living", "lounge", "corridor"]);
  if (rest.length) {
    const last = bands[bands.length - 1];
    const types = last.units.flatMap((u) => u.cols).flatMap((c) => c.rooms).map((r) => r.type);
    if (last.fixedD === undefined && !types.some((t) => ACCESSIBLE.has(t))) {
      bands[bands.length - 1] = { ...last, units: [...last.units, passageUnit()] };
    }
  }
  const priv = privateBands(rest, W);
  const all = [front, ...bands, ...priv];
  all.push({ kind: "terrace", units: [{ cols: [{ rooms: [openSpec("terrace", "Open Terrace", 0, `rterr-${floor}`)] }] }], minD: 0, maxD: 99 });
  return { bands: all, frozen: 1 };
}

function upperStructure(req: Requirements, floor: number, W: number, Wrear: number, stairY: number, stairD: number, fit: number, maxUse = false, trim: Trim = 0, stairW = stairWidthFor(W)): FloorStructure {
  if (req.buildingType === "rental") return rentalUpperStructure(req, floor, W, stairD, stairW, fit, trim);
  const prog = upperProgram(req, floor, fit, trim, stairWidthFor(W));
  const balcony = prog.bands.find((b) => b.kind === "balcony");
  const stair = prog.bands[prog.stairBand];
  const rows = packPrivate(prog.privateUnits, W);
  // A bedroom with its bath stacked behind it needs ~4.3 m; keep the front
  // balcony only if the bedrooms still get that depth.
  const stacked = (rows[0] ?? []).some((u) => u.cols.some((c) => c.rooms.filter((r) => !r.optional).length > 1));
  const useBalcony = !!balcony && stairY - BALCONY_D >= (stacked ? 4.3 : 3.0);
  const frontD = stairY - (useBalcony ? BALCONY_D : 0);
  const frontUnits = frontD >= 3.0 ? rows[0] ?? [] : [];
  // Compact variants are copies, so match units by their first room.
  const frontKeys = new Set(frontUnits.map((u) => u.cols[0].rooms[0].key));
  let rearUnits = prog.privateUnits.filter((u) => !frontKeys.has(u.cols[0].rooms[0].key));
  let stairUnits = stair.units;
  // Stair at the very front (beside the car porch on narrow plots): a bedroom
  // over the porch takes the lounge's place beside it, as on 20–25 ft plots.
  if (stairY < 0.01) {
    const stairUnit = stair.units.find((u) => u.cols[0].rooms[0].type === "stair")!;
    const room = W - (stairUnit.cols[0].fixedW ?? 0);
    // A regular bedroom takes the porch slot; the master keeps the larger rear room.
    const fits = (u: Unit, type: string) => u.cols[0].rooms[0].type === type && unitMinW(compactUnit(u)) <= room + 1e-6;
    let i = rearUnits.findIndex((u) => fits(u, "bedroom"));
    if (i < 0) i = rearUnits.findIndex((u) => fits(u, "master_bedroom"));
    if (i >= 0) {
      stairUnits = [{ ...compactUnit(rearUnits[i]), pin: "start" }, stairUnit];
      rearUnits = rearUnits.filter((_, j) => j !== i);
    }
  }

  const bands: Band[] = [];
  if (useBalcony) {
    const n = (balcony!.units.length);
    bands.push({ ...balcony!, units: Array.from({ length: n }, (_, i) => ({ cols: [{ rooms: [openSpec("balcony", n > 1 ? `Balcony ${i + 1}` : "Balcony", 6, `bal-${floor}-${i}`)] }] })) });
  }
  const front: Band = frontUnits.length
    ? withFiller({ kind: "front", units: frontUnits, fixedD: frontD, minD: frontD, maxD: frontD }, W, "Open Terrace", `fterr-${floor}`)
    : { kind: "terrace", units: [{ cols: [{ rooms: [openSpec("terrace", "Open Terrace", W * frontD, `fterr-${floor}`)] }] }], fixedD: frontD, minD: frontD, maxD: frontD };
  if (frontD > 0.3) bands.push(front);
  const stairBand: Band = { ...stair, units: stairUnits, fixedD: stairD, minD: stairD, maxD: stairD };
  bands.push(maxUse ? withFiller({ ...stairBand, fixedD: undefined }, W, "Open Terrace", `sterr-${floor}`) : stairBand);
  if (maxUse) bands[bands.length - 1] = { ...bands[bands.length - 1], fixedD: stairD };

  const rear = privateBands(rearUnits, Wrear).map((b, i) =>
    b.kind === "private" && !b.corridorBehind ? withFiller(b, Wrear, "Open Terrace", `rterr-${floor}-${i}`) : b);
  const frozen = bands.length;
  bands.push(...rear);
  // Unbalanced balconies (front didn't fit): keep the count at the rear.
  if (balcony && !useBalcony) {
    bands.push({ ...balcony, units: balcony.units.map((_, i) => ({ cols: [{ rooms: [openSpec("balcony", `Balcony ${i + 1}`, 6, `rbal-${floor}-${i}`)] }] })) });
  }
  // Spare depth behind the rooms becomes an open terrace over the floor below.
  bands.push({ kind: "terrace", units: [{ cols: [{ rooms: [openSpec("terrace", "Open Terrace", 0, `bterr-${floor}`)] }] }], minD: 0, maxD: 99 });
  return { bands, frozen };
}

/** Depth an upper floor needs in front of the stair for its street-facing rooms. */
function upperFrontNeed(req: Requirements, floor: number, W: number, fit: number, trim: Trim = 0): number {
  const prog = upperProgram(req, floor, fit, trim, stairWidthFor(W));
  const front = packPrivate(prog.privateUnits, W)[0];
  if (!front?.length) return 0;
  const d = targetDepth({ kind: "front", units: front, minD: 3.0, maxD: 5.0 }, W);
  return d + (prog.bands.some((b) => b.kind === "balcony") ? BALCONY_D : 0);
}

/** How far the laid-out rooms fall short of (or overshoot) their targets. */
function roomPenalty(placed: Placed[]): number {
  let p = 0;
  for (const r of placed) {
    const spec = r.spec;
    if (spec.area <= 0 || spec.type === "terrace" || spec.type === "corridor") continue;
    const ratio = (r.w * r.h) / spec.area;
    if (ratio < 1) p += (1 - ratio) ** 2 * 4;
    if (ratio > 1.35) p += (ratio - 1.35) * 1.5;
    if (r.w < spec.minW - 0.05) p += 1 + (spec.minW - r.w);
    if (r.h < spec.minD - 0.05) p += 1 + (spec.minD - r.h);
  }
  return p;
}

/* ------------------------------------------------------------------ */
/* Shape: band extents that follow the plot                            */
/* ------------------------------------------------------------------ */

interface SiteContext {
  frame: PlotFrame;
  sb: Setbacks;
  env: Envelope;
  /** Room-size multiplier (1 = brief as given; < 1 compact; > 1 roomier on big plots). */
  fit: number;
  /** Program trimmed for a tight plot (see Trim). */
  trim?: Trim;
  noSitout?: boolean;
  /** Make full use of the plot: favour wide houses that follow its shape. */
  maxUse?: boolean;
}

const cumulative = (depths: number[]) => depths.reduce<number[]>((a, d, i) => [...a, i ? a[i - 1] + depths[i - 1] : 0], []);

/**
 * Horizontal extent of each ground band, following the envelope. Both sides
 * of each row follow the land, but the spine side (living above dining,
 * dining beside the stair) may jog at most 2 m between rows so those rooms
 * still overlap and connect. Small jogs are smoothed out — fewer jogs build
 * better — and access rules keep every row reachable.
 */
function groundExtents(depths: number[], env: Envelope, y0: number, W: number, anchor: number, bands: Band[]): { ext: Extent[]; missing: number } {
  const ys = cumulative(depths);
  const ivs = depths.map((d, i) => (d > 0.01 ? env.extent(y0 + ys[i], y0 + ys[i] + d, anchor) : null));
  const missing = depths.filter((d, i) => d > 0.01 && !ivs[i]).length;
  const live = ivs.filter((iv): iv is [number, number] => !!iv);
  if (!live.length) return { ext: depths.map(() => ({ x0: anchor - W / 2, w: W })), missing: depths.length };
  // Missing / zero-depth rows borrow the nearest live row's interval.
  const filled = ivs.map((iv, i) => iv ?? ivs.slice(0, i).reverse().find((v) => v) ?? ivs.slice(i).find((v) => v)!);
  // Spine on the high-x side; at most W wide.
  const x1 = filled.map((iv) => iv[1]);
  const x0 = filled.map((iv, i) => Math.max(iv[0], x1[i] - W));
  const live2 = (i: number) => depths[i] > 0.01;
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i + 1 < x1.length; i++) {
      if (!live2(i) || !live2(i + 1)) continue;
      // Spine: smooth small jogs, cap big ones at 2 m.
      if (Math.abs(x1[i] - x1[i + 1]) < 0.9) x1[i] = x1[i + 1] = Math.min(x1[i], x1[i + 1]);
      if (x1[i] - x1[i + 1] > 2) x1[i] = x1[i + 1] + 2;
      if (x1[i + 1] - x1[i] > 2) x1[i + 1] = x1[i] + 2;
      // Far side: smooth small jogs.
      if (Math.abs(x0[i] - x0[i + 1]) < 0.9) x0[i] = x0[i + 1] = Math.max(x0[i], x0[i + 1]);
    }
    clampAccess(bands, x0, x1);
  }
  for (let i = 0; i < x0.length; i++) {
    if (!live2(i) && i > 0) { x0[i] = x0[i - 1]; x1[i] = x1[i - 1]; }
  }
  return { ext: x0.map((x, i) => ({ x0: x, w: Math.max(0.5, x1[i] - x) })), missing };
}

/**
 * Access rules for stepped outlines:
 *  - front rows (sit-out, living row) don't overhang the row behind on the far
 *    side — their rooms are reached through it;
 *  - bedroom rows stay within the hallway that serves them.
 */
function clampAccess(bands: Band[], x0: number[], x1: number[]) {
  for (let i = bands.length - 2; i >= 0; i--) {
    const k = bands[i].kind;
    if ((k === "public" || k === "sitout") && bands[i + 1].units.length) x0[i] = Math.max(x0[i], x0[i + 1]);
  }
  for (let i = 0; i < bands.length; i++) {
    if (bands[i].kind !== "corridor") continue;
    for (const j of [i - 1, i + 1]) {
      if (j >= 0 && j < bands.length && bands[j].kind === "private") {
        x0[j] = Math.max(x0[j], x0[i]);
        x1[j] = Math.min(x1[j], x1[i]);
      }
    }
  }
}

/** Extent of an upper-floor band: within the ground floor's outline over its depth range. */
function upperExtents(depths: number[], gDepths: number[], gExt: Extent[], bands: Band[]): Extent[] {
  const gys = cumulative(gDepths);
  const ys = cumulative(depths);
  const x0: number[] = [];
  const x1: number[] = [];
  depths.forEach((d, i) => {
    const a = ys[i];
    const b = ys[i] + Math.max(d, 0.01);
    const under = gExt.filter((_, j) => gDepths[j] > 0.01 && gys[j] < b - 1e-6 && gys[j] + gDepths[j] > a + 1e-6);
    const src = under.length ? under : [gExt[gExt.length - 1]];
    x0.push(Math.max(...src.map((e) => e.x0)));
    x1.push(Math.min(...src.map((e) => e.x0 + e.w)));
  });
  clampAccess(bands, x0, x1);
  return x0.map((x, i) => ({ x0: x, w: Math.max(0.5, x1[i] - x) }));
}

const widthIn = (ext: Extent[], bands: Band[], pred: (b: Band) => boolean, fallback: number) => {
  const ws = ext.filter((_, i) => pred(bands[i]) && bands[i].units.length).map((e) => e.w);
  return ws.length ? Math.min(...ws) : fallback;
};
const isPrivateBand = (b: Band) => b.kind === "private" || b.kind === "corridor";

interface Candidate {
  W: number;
  D: number;
  /** House front, plot-local. */
  y0: number;
  porch: boolean;
  ground: FloorStructure & { stairBand: number };
  uppers: FloorStructure[];
  gDepths: number[];
  gExt: Extent[];
  uDepths: number[][];
  uExt: Extent[][];
  /** Depth scale (< 1 only when the plot is too shallow for the brief). */
  k: number;
  /** Rooms below their minimum size or width — the brief doesn't really fit. */
  cramped: number;
  /** Requested parking didn't fit anywhere. */
  noCar: boolean;
  cost: number;
}

function evaluateWidth(req: Requirements, W: number, ctx: SiteContext, porch: boolean): Candidate {
  const { env } = ctx;
  const anchor = env.center();
  const wantFront = (req.parking > 0 && !porch) ? 5.6 : 0;

  // Pass 1: lay out at the nominal width to see where the plot pinches.
  let ground = groundStructure(req, W, W, porch, ctx);
  let depths = ground.bands.map((b) => targetDepth(b, W));
  // Narrowest a band of rooms can usefully be: land narrower than this isn't buildable depth.
  const minBand = Math.min(W, 5.0);
  const front0 = env.firstWideRow(minBand);
  const usable = env.usableDepth(front0, minBand);
  // Default: the house starts just behind the front setback (plus room for cars).
  // Maximising: slide it back to where the land is widest over the house's
  // depth, the "heart" of an irregular plot (the front becomes garden/drive).
  const yFront = (total: number) => {
    const base = front0 + Math.max(0, Math.min(wantFront, usable - total));
    if (!ctx.maxUse) return base;
    let best = base;
    let bestW = -1;
    for (let y = base; y + total <= front0 + usable + 1e-6; y += 0.5) {
      const iv = env.extent(y, y + total, anchor);
      const w = iv ? iv[1] - iv[0] : 0;
      if (w > bestW + 0.25) { bestW = w; best = y; }
    }
    return best;
  };
  let y0 = yFront(depths.reduce((a, b) => a + b, 0));
  let { ext } = groundExtents(depths, env, y0, W, anchor, ground.bands);

  // Pass 2: rebuild each section for the width the plot actually allows there.
  const Wfront = Math.min(W, widthIn(ext, ground.bands, (b) => !isPrivateBand(b) && b.kind !== "sitout", W));
  const Wpriv = Math.min(W, widthIn(ext, ground.bands, isPrivateBand, W));
  ground = groundStructure(req, Wfront, Wpriv, porch, ctx);
  const nominal = ground.bands.map((b) => (isPrivateBand(b) ? Wpriv : Wfront));
  depths = ground.bands.map((b, i) => targetDepth(b, nominal[i]));
  y0 = yFront(depths.reduce((a, b) => a + b, 0));
  ({ ext } = groundExtents(depths, env, y0, W, anchor, ground.bands));
  depths = ground.bands.map((b, i) => targetDepth(b, ext[i].w));

  // Deepen the front of the ground floor if upper floors need it for their bedrooms.
  const si = ground.stairBand;
  if (si >= 0) {
    const stairY = depths.slice(0, si).reduce((a, b) => a + b, 0);
    let need = 0;
    for (let f = 1; f < req.floors; f++) need = Math.max(need, upperFrontNeed(req, f, Wfront, ctx.fit, ctx.trim));
    const grow = Math.min(need - stairY, 3);
    const j = ground.bands.slice(0, si).map((b, i) => (b.fixedD === undefined && b.units.length ? i : -1)).filter((i) => i >= 0).pop();
    if (grow > 0.05 && j !== undefined) {
      const nd = depths[j] + grow;
      ground.bands[j] = { ...ground.bands[j], fixedD: nd, minD: nd, maxD: nd };
      depths[j] = nd;
    }
  }
  const stairY = si >= 0 ? depths.slice(0, si).reduce((a, b) => a + b, 0) : 0;
  const stairD = si >= 0 ? depths[si] : 0;
  const gys = cumulative(depths);
  const rearW = si >= 0 ? Math.min(...ext.filter((_, i) => i > si && depths[i] > 0.01).map((e) => e.w), Wfront) : Wfront;

  // Upper floors sit within the ground floor's outline.
  const uppers: FloorStructure[] = [];
  let D = depths.reduce((a, b) => a + b, 0);
  for (let f = 1; f < req.floors; f++) {
    const st = upperStructure(req, f, Wfront, Number.isFinite(rearW) ? rearW : Wfront, stairY, stairD, ctx.fit, ctx.maxUse, ctx.trim, porch && req.floors > 1 && (req.buildingType === "rental" || Wfront < 7.5) ? STAIR_W_NARROW : stairWidthFor(Wfront));
    uppers.push(st);
    const ue = upperExtents(st.bands.map((b) => targetDepth(b, Wfront)), depths, ext, st.bands);
    D = Math.max(D, st.bands.reduce((a, b, i) => a + targetDepth(b, ue[i].w), 0));
  }
  void gys;

  // Final depths at the shared house depth D, compressed if the plot is too shallow.
  y0 = yFront(D);
  const avail = env.usableDepth(y0, minBand);
  const k = D > avail ? avail / D : 1;
  let gDepths = fitDepths(ground.bands, ext, D, ground.frozen).map((d) => d * k);
  const shaped = groundExtents(gDepths, env, y0, W, anchor, ground.bands);
  const gExt = shaped.ext;
  gDepths = gDepths.map((d) => d);
  const uDepths: number[][] = [];
  const uExt: Extent[][] = [];
  for (const st of uppers) {
    const guess = upperExtents(st.bands.map((b) => targetDepth(b, Wfront)), gDepths.map((d) => d / k), gExt, st.bands);
    const ud = fitDepths(st.bands, guess, D, st.frozen).map((d) => d * k);
    uDepths.push(ud);
    uExt.push(upperExtents(ud, gDepths, gExt, st.bands));
  }

  // Score: rooms near their targets, plot fit, site features, few jogs.
  const structures = [ground, ...uppers];
  const allDepths = [gDepths, ...uDepths];
  const allExt = [gExt, ...uExt];
  const laid = structures.map((st, i) => layoutBands(st.bands, allDepths[i], allExt[i], () => false).rooms);
  const rooms = laid.reduce((a, placed) => a + roomPenalty(placed), 0);
  const cramped = laid.flat().filter((r) => isCramped(r.spec, r.w, r.h)).length;
  const filler = structures.flatMap((st) => st.bands).flatMap((b) => b.units).flatMap((u) => u.cols)
    .flatMap((c) => c.rooms).filter((r) => r.type === "terrace").reduce((a, r) => a + r.area, 0);
  const blocks = bandRects(gDepths, gExt, y0);
  const siteReq = porch ? { ...req, parking: 0 as const } : req;
  const siteWarnings = planSite(ctx.frame, bbox(blocks), siteReq, ctx.sb, blocks, false).warnings;
  const site = siteWarnings.reduce((a, w) => a + (w.includes("car space") ? 3.5 : 1), 0);
  const noCar = siteWarnings.some((w) => w.includes("car space"));
  const jogs = gExt.filter((e, i) => i > 0 && gDepths[i] > 0.01 && gDepths[i - 1] > 0.01 && Math.abs(e.x0 - gExt[i - 1].x0) > 0.05).length;
  const over = Math.max(0, D - avail);
  const aspect = Math.abs(Math.log(D / W / 1.15));
  // "Maximise the plot": prefer houses as wide as the land, so the outline follows it.
  const usePull = ctx.maxUse ? (1 - W / Math.min(env.maxWidth(), MAX_HOUSE_W)) * 25 : 0;
  const cost = over * 40 + rooms * 3 + aspect * (ctx.maxUse ? 1 : 4) + (filler / (W * D)) * (ctx.maxUse ? 4 : 12)
    + site * 10 + (porch ? 4 : 0) + jogs * (ctx.maxUse ? 0.3 : 0.8) + shaped.missing * 50 + usePull;
  if (process.env.PLAN_DEBUG && !porch && ctx.maxUse) console.log("W", W.toFixed(2), "fit", ctx.fit.toFixed(2), "cost", cost.toFixed(1), JSON.stringify({ over: +over.toFixed(2), rooms: +(rooms * 3).toFixed(1), filler: +((filler / (W * D)) * 4).toFixed(1), site, jogs, miss: shaped.missing, usePull: +usePull.toFixed(1), D: +D.toFixed(1), k: +k.toFixed(2), maxW: +env.maxWidth().toFixed(1), ext: gExt.map((e) => +e.w.toFixed(1)) }));
  return { W, D, y0, porch, ground, uppers, gDepths, gExt, uDepths, uExt, k, cramped, noCar, cost };
}

/** Footprint rectangles (plot-local) of a set of bands. */
function bandRects(depths: number[], ext: Extent[], y0: number): Rect[] {
  const ys = cumulative(depths);
  return depths.map((d, i) => ({ x: ext[i].x0, y: y0 + ys[i], w: ext[i].w, h: d })).filter((r) => r.h > 0.01);
}

function bbox(rects: Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
}

/** How badly a candidate misses the brief: undersized rooms, no parking, compressed depth. */
// A squeeze of up to 3% is harmless: rooms are checked at their compressed size.
const badness = (c: Candidate) => c.cramped + (c.noCar ? 2 : 0) + (c.k < 0.97 ? 5 + (1 - c.k) * 100 : 0);
const better = (a: Candidate, b: Candidate) => badness(a) < badness(b) - 1e-9 || (Math.abs(badness(a) - badness(b)) < 1e-9 && a.cost < b.cost);

/** Best house width (and parking strategy): a coarse sweep, then a fine one around the winner. */
function chooseCandidate(req: Requirements, ctx: SiteContext): Candidate {
  const maxW = Math.min(ctx.env.maxWidth(), MAX_HOUSE_W);
  let best: Candidate | null = null;
  const tryW = (W: number) => {
    for (const porch of req.parking > 0 ? [false, true] : [false]) {
      const c = evaluateWidth(req, W, ctx, porch);
      if (!best || better(c, best)) best = c;
    }
  };
  for (let W = Math.min(6, maxW); W <= maxW + 1e-9; W += 0.5) tryW(W);
  const centre = best!.W;
  for (const W of [centre - 0.25, centre + 0.25]) if (W >= Math.min(6, maxW) && W <= maxW) tryW(W);
  return best!;
}

/* ------------------------------------------------------------------ */
/* Scoring & placement                                                 */
/* ------------------------------------------------------------------ */

function computeVastu(rooms: Room[], fp: Rect, northDeg: number): number {
  const scored = rooms.filter((r) => r.idealDir);
  if (!scored.length) return 100;
  const sum = scored.reduce((a, r) => a + vastuRoomScore(directionOf(r.x + r.w / 2, r.y + r.h / 2, fp, northDeg), r.idealDir!), 0);
  return Math.round((sum / scored.length) * 100);
}

/** Daylight: an outside wall, or a wall onto a sit-out / balcony / terrace. */
function hasDaylight(r: Room, rooms: Room[]): boolean {
  return exteriorEdges(r, rooms).some((e) => e.iv.b - e.iv.a > 0.9)
    || rooms.some((o) => OPEN_TYPES.has(o.type) && !!sharedWall(r, o));
}

function floorScore(rooms: Room[], fp: Rect, req: Requirements, northDeg: number): number {
  const beds = rooms.filter((r) => r.type === "bedroom" || r.type === "master_bedroom");
  const lit = beds.length ? beds.filter((b) => hasDaylight(b, rooms)).length / beds.length : 1;
  const kitchen = rooms.find((r) => r.type === "kitchen");
  const kitchenLit = kitchen && exteriorEdges(kitchen, rooms).length ? 1 : 0;
  return (req.vastu ? computeVastu(rooms, fp, northDeg) / 100 : 0) + 0.25 * lit + 0.1 * kitchenLit;
}

interface Placement {
  frame: PlotFrame;
  y0: number;
  /** Reflect the layout across the plot (x → pw − x). */
  mirror: boolean;
}

function toWorld(p: Placement, r: Rect): Rect {
  const x = p.mirror ? p.frame.pw - r.x - r.w : r.x;
  return toWorldRect(p.frame, { x, y: r.y, w: r.w, h: r.h });
}

function toRooms(placed: Placed[], p: Placement): Room[] {
  const keys = new Set(placed.map((pl) => pl.spec.key));
  return placed.map((pl) => ({
    id: pl.spec.key,
    type: pl.spec.type,
    label: pl.spec.label,
    zone: pl.spec.zone,
    idealDir: pl.spec.idealDir,
    parentId: pl.spec.parentKey && keys.has(pl.spec.parentKey) ? pl.spec.parentKey : undefined,
    ...toWorld(p, { x: pl.x, y: p.y0 + pl.y, w: pl.w, h: pl.h }),
  }));
}

/** All band-reversal combinations worth trying for a floor (capped). */
function reversalSets(bands: Band[]): boolean[][] {
  const flippable = bands.map((b, i) => (b.units.filter((u) => !u.pin).length > 1 ? i : -1)).filter((i) => i >= 0).slice(0, 4);
  const sets: boolean[][] = [];
  for (let m = 0; m < 1 << flippable.length; m++) {
    const rev = bands.map(() => false);
    flippable.forEach((bi, k) => { rev[bi] = !!(m & (1 << k)); });
    sets.push(rev);
  }
  return sets;
}

function bestFloor(s: FloorStructure, depths: number[], ext: Extent[], p: Placement, fp: Rect, req: Requirements): { rooms: Room[]; score: number } {
  let best: { rooms: Room[]; score: number } | null = null;
  for (const rev of reversalSets(s.bands)) {
    const { rooms: placed } = layoutBands(s.bands, depths, ext, (_, i) => rev[i]);
    const rooms = toRooms(placed, p);
    const score = floorScore(rooms, fp, req, p.frame.northDeg);
    if (!best || score > best.score + 1e-9) best = { rooms, score };
  }
  return best!;
}

/** Outline of stacked band rectangles (each overlapping the next), plot-local. */
function outline(rects: Rect[]): Polygon {
  if (!rects.length) return [];
  const pts: Polygon = [];
  // Down the high-x side, then back up the low-x side.
  for (const r of rects) pts.push([r.x + r.w, r.y], [r.x + r.w, r.y + r.h]);
  for (let i = rects.length - 1; i >= 0; i--) pts.push([rects[i].x, rects[i].y + rects[i].h], [rects[i].x, rects[i].y]);
  const out: Polygon = [];
  for (const q of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - q[0]) < 1e-6 && Math.abs(last[1] - q[1]) < 1e-6) continue;
    out.push(q);
  }
  // Drop collinear points.
  return out.filter((q, i) => {
    const a = out[(i - 1 + out.length) % out.length];
    const b = out[(i + 1) % out.length];
    return Math.abs((q[0] - a[0]) * (b[1] - a[1]) - (q[1] - a[1]) * (b[0] - a[0])) > 1e-6;
  });
}

/* ------------------------------------------------------------------ */
/* Metrics, suggestions, validation                                    */
/* ------------------------------------------------------------------ */

function floorMetrics(rooms: Room[], fp: Rect, outlinePoly: Polygon, walls: ReturnType<typeof generateWalls>, northDeg: number) {
  const open = rooms.filter((r) => r.type === "terrace").reduce((a, r) => a + r.w * r.h, 0);
  const builtUpArea = polygonArea(outlinePoly) - open;
  const indoor = rooms.filter((r) => !OPEN_TYPES.has(r.type)).reduce((a, r) => a + r.w * r.h, 0);
  const wallArea = walls.filter((w) => w.type !== "railing")
    .reduce((a, w) => a + Math.hypot(w.x2 - w.x1, w.y2 - w.y1) * w.thickness, 0);
  const carpetArea = Math.max(0, indoor - wallArea);
  let perimeter = 0;
  for (let i = 0; i < outlinePoly.length; i++) {
    const [ax, ay] = outlinePoly[i];
    const [bx, by] = outlinePoly[(i + 1) % outlinePoly.length];
    perimeter += Math.hypot(bx - ax, by - ay);
  }
  return {
    builtUpArea,
    carpetArea,
    efficiency: builtUpArea > 0 ? carpetArea / builtUpArea : 0,
    perimeter,
    vastuScore: computeVastu(rooms, fp, northDeg),
  };
}

export function planVastuScore(plan: PlanResult): number {
  return Math.round(plan.floors.reduce((a, f) => a + f.metrics.vastuScore, 0) / plan.floors.length);
}

function buildSuggestions(plan: PlanResult, req: Requirements, siteWarnings: string[]): Suggestion[] {
  const out: Suggestion[] = [];
  let blind = 0;
  for (const f of plan.floors) {
    for (const r of f.rooms) {
      if ((r.type === "bedroom" || r.type === "master_bedroom") && !hasDaylight(r, f.rooms)) blind++;
    }
  }
  out.push(
    blind === 0
      ? { kind: "ventilation", severity: "good", message: "Every bedroom has an outside wall for daylight and cross-ventilation." }
      : { kind: "ventilation", severity: "warn", message: `${blind} bedroom(s) have no outside wall — consider a light well or a narrower, deeper house.` },
  );

  const vastu = planVastuScore(plan);
  if (req.vastu) {
    out.push({
      kind: "vastu",
      severity: vastu >= 75 ? "good" : vastu >= 55 ? "info" : "warn",
      message: `Vastu compliance ${vastu}/100${vastu >= 75 ? " — strong alignment with directional principles." : " — the road-facing direction limits kitchen/master placement; try the editor to fine-tune."}`,
    });
  }

  const ground = plan.floors[0];
  const footprint = ground.footprintPolygon ? polygonArea(ground.footprintPolygon) : plan.footprint.w * plan.footprint.h;
  const built = plan.floors.reduce((a, f) => a + f.metrics.builtUpArea, 0);
  const coverage = footprint / plan.plotArea;
  out.push({
    kind: "space",
    severity: coverage <= 0.65 ? "good" : "info",
    message: `House footprint ${Math.round(footprint)} m² (${Math.round(coverage * 100)}% ground coverage), ${Math.round(built)} m² built-up across ${plan.floors.length} floor(s).`,
  });

  if (req.floors > 1) {
    out.push({ kind: "circulation", severity: "info", message: "The staircase sits in the same spot on every floor, so it stacks as one structural core." });
  }
  for (const w of siteWarnings) out.push({ kind: "space", severity: "warn", message: w });

  const rate = { economy: 1400, standard: 1900, premium: 2600, luxury: 3600 }[req.budget];
  out.push({
    kind: "cost",
    severity: "info",
    message: `Indicative construction estimate ≈ ₹${(built * 10.7639 * rate).toLocaleString("en-IN", { maximumFractionDigits: 0 })} at ${req.budget} finish (≈₹${rate}/ft² of built-up area).`,
  });
  return out;
}

/** Below minimum area, narrower than the room's own minimum, or a porch too short for a car. */
function isCramped(spec: RoomSpec, w: number, h: number): boolean {
  if (spec.type === "parking") return Math.max(w, h) < 4.25 || Math.min(w, h) < 2.5;
  if (OPEN_TYPES.has(spec.type) || spec.type === "corridor" || spec.type === "terrace" || spec.optional) return false;
  // Stairs have a fixed, deliberate width; only their area matters here.
  if (spec.type === "stair") return w * h < (MIN_ROOM_AREA.stair ?? 0) - 1e-6;
  const min = MIN_ROOM_AREA[spec.type];
  const narrow = Math.min(w, h) < Math.max(0.9, Math.min(spec.minW, spec.minD) * 0.9);
  return (min !== undefined && w * h < min - 1e-6) || narrow;
}

const MIN_ROOM_AREA: Partial<Record<string, number>> = {
  living: 10, lounge: 8, dining: 6, kitchen: 5, toilet: 1.5, pooja: 1.5, office: 6, stair: 6,
  store: 1.2, utility: 1.2, master_bedroom: 9, bedroom: 8, bathroom: 2.5, dress: 1.2,
};

export function validatePlanRequirements(plan: PlanResult, req: Requirements): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const all = plan.floors.flatMap((f) => f.rooms);
  for (const room of all) {
    const min = MIN_ROOM_AREA[room.type];
    const area = room.w * room.h;
    if (min !== undefined && area < min) {
      errors.push(`${room.label} is too small (${area.toFixed(1)} m², minimum is ${min} m²).`);
    }
    if (!OPEN_TYPES.has(room.type) && room.type !== "corridor" && Math.min(room.w, room.h) < 0.9) {
      errors.push(`${room.label} is too narrow (${Math.min(room.w, room.h).toFixed(2)} m).`);
    }
  }
  // Car porches and bays (not drive aisles or two-wheeler strips) must hold a car.
  for (const car of all.filter((r) => r.type === "parking" && /^Car/.test(r.label))) {
    if (Math.max(car.w, car.h) < 4.25) errors.push(`${car.label} is only ${Math.max(car.w, car.h).toFixed(1)} m long; a car needs at least 4.3 m (14 ft).`);
  }
  const count = (pred: (r: Room) => boolean) => all.filter(pred).length;
  const beds = count((r) => r.type === "bedroom" || r.type === "master_bedroom");
  const baths = count((r) => r.type === "bathroom");
  // Rental: the brief is per home, one home per floor; apartments: per flat.
  const apartment = req.buildingType === "apartment";
  const homes = req.buildingType === "rental" ? req.floors : apartment ? (req.flatsPerFloor ?? 2) * (req.floors - 1) : 1;
  if (beds !== req.bedrooms * homes) errors.push(`Expected ${req.bedrooms * homes} bedrooms, but generated ${beds}.`);
  if (baths !== req.bathrooms * homes) errors.push(`Expected ${req.bathrooms * homes} bathrooms, but generated ${baths}.`);
  if (homes > 1 && !apartment) {
    plan.floors.forEach((f) => {
      if (!f.rooms.some((r) => r.type === "kitchen")) errors.push(`${f.name} has no kitchen of its own.`);
    });
  }
  if (apartment) {
    plan.floors.slice(1).forEach((f) => {
      const flats = new Set(f.rooms.filter((r) => r.unit).map((r) => r.unit));
      for (const u of flats) {
        if (!f.rooms.some((r) => r.unit === u && r.type === "kitchen")) errors.push(`Flat ${u} has no kitchen.`);
        if (!f.doors.some((d) => d.kind === "main" && f.rooms.find((r) => r.id === d.roomId)?.unit === u)) errors.push(`Flat ${u} has no front door on the lobby.`);
      }
    });
  }
  if (req.homeOffice && !count((r) => r.type === "office")) errors.push("Home Office was requested but not generated.");
  return { ok: errors.length === 0, errors };
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/** Mirror a plot-local polygon across the plot (x → pw − x). */
function mirrored(frame: PlotFrame): PlotFrame {
  return { ...frame, local: frame.local.map(([x, y]) => [frame.pw - x, y] as [number, number]).reverse() };
}

export function generatePlan(req: Requirements): PlanResult {
  if (req.buildingType === "apartment") {
    const apt = generateApartment(req);
    if (apt) return apt;
    const plain = generatePlan({ ...req, buildingType: "rental", floors: Math.max(2, Math.min(4, req.floors)) });
    plain.suggestions.unshift({ kind: "space", severity: "warn", message: "This plot is too small for an apartment block with a lift, so it is planned as floors for rent instead." });
    return plain;
  }
  if (req.buildingType === "manduva" || req.buildingType === "cottage") {
    const ring = generateRing(req, req.buildingType);
    if (ring) return ring;
    // Too small for rooms around a courtyard / hall: a regular single-storey home instead.
    const plain = generatePlan({ ...req, buildingType: "house", floors: 1 });
    plain.suggestions.unshift({
      kind: "space", severity: "warn",
      message: `A ${req.buildingType === "manduva" ? "manduva (courtyard) house needs a plot of about 45 × 55 ft or more" : "cottage with verandahs needs a plot of about 40 × 45 ft or more"}, so this is planned as an independent house.`,
    });
    return plain;
  }
  const plan = generateShaped(req);
  if (plan.floors.every((f) => f.rooms.length) || !req.plotPolygon) return plan;
  // Shape-following failed on an unusual plot: plan the largest rectangle inside it instead.
  const frame = makePlotFrame(req);
  const sb = setbacksFor(frame.pw, frame.pd);
  const r = buildableRect(frame, sb);
  const rectPlan = generateShaped({ ...req, plotPolygon: undefined, plotWidth: r.w + 2 * sb.side, plotDepth: r.h + sb.front + sb.rear });
  rectPlan.suggestions.push({ kind: "space", severity: "warn", message: "This plot's outline is unusual, so the plan uses the largest regular area inside it." });
  return rectPlan;
}

/** Ways to fit a brief, best first: trim the program before shrinking rooms. */
const ATTEMPTS: { fit: number; trim: Trim; noSitout: boolean }[] = [
  { fit: 1, trim: 0, noSitout: false }, { fit: 0.9, trim: 0, noSitout: false },
  { fit: 1, trim: 1, noSitout: false }, { fit: 0.9, trim: 1, noSitout: false },
  { fit: 1, trim: 2, noSitout: false }, { fit: 0.9, trim: 2, noSitout: false },
  { fit: 0.9, trim: 2, noSitout: true }, { fit: 0.8, trim: 2, noSitout: false },
  { fit: 0.8, trim: 2, noSitout: true }, { fit: 0.72, trim: 2, noSitout: true },
];

/* ------------------------------------------------------------------ */
/* Apartments                                                          */
/* ------------------------------------------------------------------ */

const LIFT_W = 2.0;

/**
 * One flat laid out in a w x d rectangle by the band engine, entered from
 * the lobby along its y = 0 edge (flat-local: x along the lobby, y away from it).
 * Open space left over at the outer edge becomes the flat's balcony.
 */
function layoutFlat(req: Requirements, w: number, d: number, unit: string): { placed: Placed[]; cramped: number } {
  const fr: Requirements = {
    ...req, buildingType: "house", floors: 1, parking: 0, garden: false, pool: false, homeOffice: false, balconies: 0,
    plotPolygon: undefined, plotUse: "balanced", plotWidth: w, plotDepth: d, facing: "S",
  };
  const frame = makePlotFrame(fr);
  const sb: Setbacks = { front: 0, rear: 0, side: 0 };
  const env = buildableEnvelope(frame, sb);
  let best: Candidate | null = null;
  for (const a of ATTEMPTS) {
    // A flat opens straight into its hall: no sit-out.
    const c = evaluateWidth(fr, w, { frame, sb, env, fit: a.fit, trim: a.trim, noSitout: true }, false);
    if (!best || better(c, best)) best = c;
    if (badness(best) === 0) break;
  }
  const cand = best!;
  const depths = fitDepths(cand.ground.bands, cand.gExt, d, cand.ground.frozen);
  const { rooms } = layoutBands(cand.ground.bands, depths, cand.gExt, () => false);
  const placed = rooms.filter((p) => p.w * p.h > 0.05).map((p) => {
    let spec: RoomSpec = { ...p.spec, key: `${unit}-${p.spec.key}`, parentKey: p.spec.parentKey && `${unit}-${p.spec.parentKey}` };
    if (spec.type === "terrace") {
      // Leftover open space: a balcony on the outside wall, else a light well inside the flat.
      spec = p.y + p.h > d - 0.05 ? { ...spec, type: "balcony", label: "Balcony" } : { ...spec, label: "Open to Sky" };
    }
    return { ...p, spec };
  });
  return { placed, cramped: placed.filter((p) => isCramped(p.spec, p.w, p.h)).length };
}

/**
 * Apartment building: stilt parking on the ground floor, flats above.
 * Every floor: front flat(s), then a lobby row with the stair and lift, then back flat(s).
 */
function generateApartment(req: Requirements): PlanResult | null {
  const flats = req.flatsPerFloor ?? 2;
  const floors = Math.min(6, Math.max(2, req.floors));
  const r: Requirements = { ...req, floors };
  const frame = makePlotFrame(r);
  const base = setbacksFor(frame.pw, frame.pd);
  // Taller buildings keep wider margins (typical bye-law minimums for G+3 and up).
  const sb: Setbacks = floors >= 4
    ? { front: Math.max(base.front, 3), rear: Math.max(base.rear, 1.5), side: Math.max(base.side, 1.5) }
    : base;
  const area = buildableRect(frame, sb);
  const coreW = STAIR_W + LIFT_W;
  const W = area.w;
  if (W - coreW < 2.4) return null;
  const bandD = STAIR_MIN_D;
  const flatD = Math.min(10, (area.h - bandD) / 2);
  if (flatD < 5) return null;
  const nFront = flats >= 3 ? 2 : 1;
  const nBack = flats - nFront;
  const x0 = area.x;
  const y0 = area.y;
  const cx = x0 + W / 2;
  const lobbyTop = y0 + flatD;
  const lobbyBot = lobbyTop + bandD;
  const house: Rect = { x: x0, y: y0, w: W, h: 2 * flatD + bandD };
  // Core at the left end of the lobby row: the stair, then the lift above a
  // small lift lobby; one continuous lobby runs on to the right, so every
  // flat's front door, the stair and the lift share it.
  const LIFT_D = 2.0;
  const lobbyX = x0 + coreW;

  const spec = (key: string, type: RoomSpec["type"], label: string): RoomSpec =>
    ({ key, type, label, zone: ZONE_OF[type], area: 0, minW: 0.9, minD: 0.9 });
  const at = (s: RoomSpec, x: number, y: number, w: number, h: number): Placed => ({ spec: s, x, y, w, h });
  const AISLE = 3.0;
  const core = (floor: number, ground: boolean): Placed[] => {
    const rest = x0 + W - lobbyX;
    // On the stilt floor the far end of the lobby row is the drive aisle to the back bays, when it fits.
    const aisle = ground && rest - AISLE >= 1.5;
    const lobbyW = aisle ? rest - AISLE : rest;
    const out = [
      at(spec(`core-stair-${floor}`, "stair", "Staircase"), x0, lobbyTop, STAIR_W, bandD),
      at(spec(`core-lift-${floor}`, "lift", "Lift"), x0 + STAIR_W, lobbyTop, LIFT_W, LIFT_D),
      at(spec(`core-liftlobby-${floor}`, "corridor", "Lift Lobby"), x0 + STAIR_W, lobbyTop + LIFT_D, LIFT_W, bandD - LIFT_D),
      at(spec(`core-lobby-${floor}`, "corridor", ground ? "Entrance Lobby" : "Lobby"), lobbyX, lobbyTop, lobbyW, bandD),
    ];
    if (aisle) out.push(at(spec(`core-aisle-${floor}`, "parking", "Drive Aisle"), lobbyX + lobbyW, lobbyTop, AISLE, bandD));
    return out;
  };

  const units = new Map<string, string>();
  const floorsPlaced: Placed[][] = [];
  let cramped = 0;
  let bays = 0;

  // Stilt floor: car bays across the front and, with a drive aisle, the back.
  const ground = core(0, true);
  const aisle = ground.some((p) => p.spec.label === "Drive Aisle");
  const BAY = 2.7;
  const zone = (y: number, label: string, cars: boolean): Placed[] => {
    if (!cars) return [at(spec(`stilt-${label}`, "store", "Utility & Stores"), x0, y, W, flatD)];
    const n = Math.floor(W / BAY);
    const out: Placed[] = [];
    for (let i = 0; i < n; i++) out.push(at(spec(`bay-${label}-${i}`, "parking", `Car ${++bays}`), x0 + i * BAY, y, BAY, flatD));
    const rest = W - n * BAY;
    if (rest > 0.05) out.push(at(spec(`bike-${label}`, "parking", "Two-wheelers"), x0 + n * BAY, y, rest, flatD));
    return out;
  };
  ground.push(...zone(y0, "front", true), ...zone(lobbyBot, "back", aisle));
  floorsPlaced.push(ground);

  for (let f = 1; f < floors; f++) {
    const placed = core(f, false);
    let n = 0;
    for (const [row, count] of [["front", nFront], ["back", nBack]] as const) {
      for (let i = 0; i < count; i++) {
        const unit = `${f}${String(++n).padStart(2, "0")}`;
        const w = W / count;
        const flat = layoutFlat(r, w, flatD, unit);
        cramped += flat.cramped;
        for (const p of flat.placed) {
          units.set(p.spec.key, unit);
          // Flat-local x runs along the lobby and the hall sits at its far end,
          // so it lands on the lobby, clear of the stair and lift at the left.
          const x = i === 0 ? x0 + p.x : cx + p.x;
          const y = row === "front" ? lobbyTop - p.y - p.h : lobbyBot + p.y;
          placed.push({ ...p, x, y });
        }
      }
    }
    floorsPlaced.push(placed);
  }

  const placement: Placement = { frame, y0: 0, mirror: false };
  const floorRooms = floorsPlaced.map((ps) => toRooms(ps, placement).map((room) => ({ ...room, unit: units.get(room.id) })));
  const homes = flats * (floors - 1);
  const notes: Suggestion[] = [
    { kind: "space", severity: "good", message: `${homes} flats of ${req.bedrooms} BHK (${flats} on each of ${floors - 1} floors) around a stair and lift core, with stilt parking below.` },
    { kind: "space", severity: bays >= homes ? "good" : "warn", message: `${bays} car bays in the stilt parking for ${homes} flats${bays >= homes ? "." : `: short by ${homes - bays}. Plan visitor and two-wheeler parking, or a basement.`}` },
  ];
  if (cramped) {
    notes.push({ kind: "space", severity: "warn", message: `${req.bedrooms} BHK flats are tight at ${flats} per floor on this plot; try fewer flats per floor or fewer bedrooms.` });
  }
  return assemble(r, frame, sb, placement, floorRooms, floorsPlaced.map(() => [house]), { porch: true, fit: 1, trim: 0, notes });
}

const RING_NOTES: Record<RingKind, string> = {
  manduva: "A manduva house: rooms around an open courtyard, each opening onto the verandah that runs round it. The courtyard brings light and air to every room.",
  cottage: "A cottage: rooms around a central dining hall, with verandahs on the front and sides. Best with a sloped tiled roof.",
};

/** Courtyard (manduva) and central-hall (cottage) homes — single storey, rooms in a ring. */
function generateRing(req: Requirements, kind: RingKind): PlanResult | null {
  const r1: Requirements = { ...req, floors: 1 };
  const frame = makePlotFrame(r1);
  const sb = setbacksFor(frame.pw, frame.pd);
  const area = buildableRect(frame, sb);
  let best: { rooms: Room[]; house: Rect; placement: Placement; fit: number; score: number } | null = null;
  for (const fit of [1, 0.9, 0.8]) {
    for (const mirror of [false, true]) {
      const placement: Placement = { frame, y0: 0, mirror };
      const compass = (x: number, y: number, house: Rect) => {
        const p = toWorld(placement, { x, y, w: 0, h: 0 });
        return directionOf(p.x, p.y, toWorld(placement, house), frame.northDeg);
      };
      const lay = layoutRing(kind, ringProgram(r1, fit), area, compass, r1.parking > 0 ? 5.6 : 0);
      if (!lay) return null;
      const rooms = toRooms(lay.placed, placement);
      const cramped = lay.placed.filter((p) => isCramped(p.spec, p.w, p.h)).length;
      const score = floorScore(rooms, toWorld(placement, lay.house), r1, frame.northDeg) - cramped;
      if (!best || score > best.score + 1e-9) best = { rooms, house: lay.house, placement, fit, score };
    }
    if (best && best.score > -1) break;
  }
  const b = best!;
  return assemble(r1, frame, sb, b.placement, [b.rooms], [[b.house]], {
    porch: false, fit: b.fit, trim: 0,
    notes: [{ kind: "space", severity: "good", message: RING_NOTES[kind] }],
  });
}

function generateShaped(req: Requirements): PlanResult {
  const frame = makePlotFrame(req);
  const sb = setbacksFor(frame.pw, frame.pd);

  let chosen: { floors: Room[][]; score: number; cand: Candidate; placement: Placement; fit: number; trim: Trim; rects: Rect[] } | null = null;
  for (const mirror of [false, true]) {
    // The layout always runs with its spine on the right; mirroring the plot
    // gives the left-spine variant (and the other Vastu orientation).
    const f2 = mirror ? mirrored(frame) : frame;
    const env = buildableEnvelope(f2, sb);
    const base = { frame: f2, sb, env };

    // Fit the brief: compact step by step when it doesn't fit; on generous
    // plots, let rooms grow towards villa proportions.
    // Tight plots trim the program the way Indian plans do (no powder room or
    // stores, then one hall and 4'×7' baths) before shrinking rooms.
    const attempts = ATTEMPTS;
    let cand: Candidate | null = null;
    let fit = 1;
    let trim: Trim = 0;
    for (const a of attempts) {
      const next = chooseCandidate(req, { ...base, ...a });
      if (!cand || badness(next) < badness(cand)) { cand = next; fit = a.fit; trim = a.trim; }
      if (badness(cand) === 0) break;
    }
    if (!cand) throw new Error("No layout candidate");
    // Generous plots: let rooms grow. "Maximise" aims for ~60% ground coverage
    // of the buildable land (a typical bye-law ceiling); "balanced" ~42%.
    const maxUse = (req.plotUse ?? (req.plotPolygon ? "max" : "balanced")) === "max";
    if (fit === 1 && trim === 0 && cand.k >= 1) {
      const footprint = bandRects(cand.gDepths, cand.gExt, cand.y0).reduce((a, r) => a + r.w * r.h, 0);
      const target = (maxUse ? 0.6 : 0.42) * env.area();
      const roomier = Math.min(maxUse ? 1.9 : 1.45, Math.sqrt(target / Math.max(footprint, 1)));
      for (const f of [roomier, 1 + (roomier - 1) * 0.6, 1 + (roomier - 1) * 0.3]) {
        if (f <= 1.05) break;
        const big = chooseCandidate(req, { ...base, fit: f, maxUse });
        if (big.k >= 1 && badness(big) === 0) { cand = big; fit = f; break; }
      }
    }

    const placement: Placement = { frame, y0: cand.y0, mirror };
    const rects = bandRects(cand.gDepths, cand.gExt, cand.y0);
    const fp = bboxOf(rects.map((r) => toWorld(placement, r)));
    const all = [cand.ground, ...cand.uppers];
    const depths = [cand.gDepths, ...cand.uDepths];
    const exts = [cand.gExt, ...cand.uExt];
    const floors = all.map((st, i) => bestFloor(st, depths[i], exts[i], { ...placement, y0: cand!.y0 }, fp, req));
    const score = floors.reduce((a, f) => a + f.score, 0) - cand.cost * 0.01;
    if (!chosen || score > chosen.score + 1e-9) chosen = { floors: floors.map((f) => f.rooms), score, cand, placement, fit, trim, rects };
  }

  const { cand, placement, fit, trim, rects } = chosen!;
  const floorRects = [rects, ...cand.uppers.map((_, i) => bandRects(cand.uDepths[i], cand.uExt[i], cand.y0))];
  return assemble(req, frame, sb, placement, chosen!.floors, floorRects, {
    porch: cand.porch, fit, trim, depth: cand.k < 1 ? { need: cand.D, have: cand.D * cand.k } : undefined,
  });
}

interface AssemblyInfo {
  porch: boolean;
  fit: number;
  trim: Trim;
  /** The plot was too shallow and rooms were compressed. */
  depth?: { need: number; have: number };
  notes?: Suggestion[];
}

/** Turn placed rooms into the final plan: doors, walls, metrics, site plan, suggestions, validation. */
function assemble(req: Requirements, frame: PlotFrame, sb: Setbacks, placement: Placement, floorRooms: Room[][], floorRects: Rect[][], info: AssemblyInfo): PlanResult {
  const rects = floorRects[0];
  const toWorldPt = ([x, y]: [number, number]) => {
    const r = toWorld(placement, { x, y, w: 0, h: 0 });
    return [r.x, r.y] as [number, number];
  };
  const fp = bboxOf(rects.map((r) => toWorld(placement, r)));
  const floorOutlines = floorRects.map((rs) => outline(rs).map(toWorldPt));

  const floors: FloorPlan[] = floorRooms.map((rooms, i) => {
    const access: FloorAccess | undefined = req.buildingType === "rental" && req.floors > 1 ? (i === 0 ? "stairOutside" : "fromStair") : undefined;
    const { doors, windows } = placeOpenings(rooms, fp, frame.road, access);
    const walls = generateWalls(rooms);
    return {
      floor: i,
      name: FLOOR_NAMES[i] ?? `Floor ${i}`,
      roadSide: frame.road,
      access,
      footprint: fp,
      footprintPolygon: floorOutlines[i],
      rooms,
      doors,
      windows,
      walls,
      metrics: floorMetrics(rooms, fp, floorOutlines[i], walls, frame.northDeg),
    };
  });

  const siteReq = info.porch ? { ...req, parking: 0 as const } : req;
  const siteFrame = placement.mirror ? mirrored(frame) : frame;
  const site = planSite(siteFrame, bbox(rects), siteReq, sb, rects);
  const envRect = buildableEnvelope(frame, sb);
  void envRect;
  const result: PlanResult = {
    plotArea: frame.area,
    footprint: fp,
    site: {
      plot: frame.world,
      buildable: toWorldRect(frame, buildableRect(frame, sb)),
      setbackLine: setbackPolygon(frame, sb).map(([x, y]) => {
        const w = toWorldRect(frame, { x, y, w: 0, h: 0 });
        return [w.x, w.y] as [number, number];
      }),
      roadSide: frame.road,
      northDeg: frame.northDeg,
      elements: site.elements.map((e) => ({ ...e, ...toWorld(placement, e) })),
    },
    setback: sb,
    floors,
    suggestions: [],
  };
  const warnings = [...site.warnings];
  if (req.buildingType === "rental" && req.floors > 1) {
    result.suggestions.push({ kind: "circulation", severity: "good", message: `${req.floors} separate ${req.bedrooms} BHK homes, one per floor. The staircase rises from outside at the front, so each home has its own front door.` });
  }
  if (info.porch && req.buildingType !== "apartment") {
    result.suggestions.push({ kind: "space", severity: "info", message: "Cars park in a covered porch at the front of the house, under the floor above." });
  }
  if (info.trim >= 1) {
    result.suggestions.push({
      kind: "space", severity: "info",
      message: info.trim >= 2
        ? "Planned as a compact home for this plot: a hall and a kitchen-dining, 4'×7' bathrooms, and a pooja niche instead of a separate room."
        : "Planned without a powder room, stores or dressing rooms so the main rooms keep their size on this plot.",
    });
  }
  if (info.fit < 1) {
    result.suggestions.push({ kind: "space", severity: "info", message: `Rooms were sized compactly (about ${Math.round(info.fit * 100)}% of the usual size for this finish level) to fit the plot.` });
  } else if (info.fit > 1) {
    result.suggestions.push({ kind: "space", severity: "good", message: `The plot is generous, so rooms are about ${Math.round((info.fit - 1) * 100)}% larger than a standard home of this finish level.` });
  }
  if (rects.some((r) => Math.abs(r.x - rects[0].x) > 0.05 || Math.abs(r.w - rects[0].w) > 0.05)) {
    result.suggestions.push({ kind: "space", severity: "info", message: "The house steps in where the plot narrows, so it follows the shape of your land instead of a plain rectangle." });
  }
  if (info.depth) {
    warnings.push(`The brief needs ${info.depth.need.toFixed(1)} m of depth but the plot allows ${info.depth.have.toFixed(1)} m, so rooms were compressed.`);
  }
  result.suggestions.push(...(info.notes ?? []));
  result.suggestions = [...buildSuggestions(result, req, warnings), ...result.suggestions];
  result.validation = validatePlanRequirements(result, req);
  const ring = req.buildingType === "manduva" || req.buildingType === "cottage";
  if (!result.validation.ok && (ring || req.floors < 4)) {
    result.suggestions.unshift({
      kind: "space", severity: "warn",
      message: ring
        ? `${req.bedrooms} bedrooms don't fit comfortably around the ${req.buildingType === "manduva" ? "courtyard" : "hall"} on this plot. Plan one bedroom fewer, or use a larger plot.`
        : `${req.bedrooms} bedrooms don't fit comfortably on ${req.floors === 1 ? "one floor" : `${req.floors} floors`} of this plot. Add a floor or plan one bedroom fewer for full-size rooms.`,
    });
  }
  return result;
}

/** The setback line in plot-local metres: the buildable rectangle, or the plot inset by the side setback. */
function setbackPolygon(frame: PlotFrame, sb: Setbacks): Polygon {
  const rectPlot = frame.local.length === 4 && Math.abs(polygonArea(frame.local) - frame.pw * frame.pd) < 1e-6;
  if (rectPlot) {
    const r = buildableRect(frame, sb);
    return [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
  }
  const inset = insetPolygon(frame.local, sb.side);
  return inset.length >= 3 ? inset : frame.local;
}

function bboxOf(rects: Rect[]): Rect {
  return bbox(rects);
}
