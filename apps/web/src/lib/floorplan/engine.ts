/**
 * Floor-plan engine (v3).
 *
 *  1. Program   – realistic rooms per floor, grouped into front→rear bands.
 *  2. Sizing    – house width chosen for good proportions; depth follows from
 *                 room areas, so the house is sized to the brief, not the plot.
 *  3. Stacking  – every upper floor keeps the staircase exactly above the
 *                 ground-floor stair.
 *  4. Variants  – band orderings and a mirror are tried; the best Vastu /
 *                 daylight score wins.
 *  5. Site      – house set back from the road; parking, pool and garden are
 *                 placed in the open yards, outside the house.
 */
import {
  BALCONY_D, groundProgram, upperProgram,
  type Band, type FloorProgram, type RoomSpec, type Unit,
} from "./program";
import { compactUnit, expandBands, fitDepths, layoutBands, packPrivate, passageUnit, privateBands, targetDepth, type Placed } from "./layout";
import { placeOpenings, sharedWall } from "./openings";
import {
  buildableRect, makePlotFrame, planSite, setbacksFor, toWorldRect, type PlotFrame,
} from "./site";
import { directionOf, vastuRoomScore } from "./vastu";
import { generateWalls } from "./walls";
import type { FloorPlan, PlanResult, Rect, Requirements, Room, Suggestion } from "./types";

export { placeOpenings } from "./openings";

const FLOOR_NAMES = ["Ground Floor", "First Floor", "Second Floor", "Third Floor", "Fourth Floor"];
const OPEN_TYPES = new Set(["sitout", "balcony", "terrace", "parking"]);
const MAX_HOUSE_W = 24;

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
  const pub = prog.bands.find((b) => b.kind === "public")!;
  const svc = prog.bands.find((b) => b.kind === "service")!;
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

/** Put ground-floor bedrooms beside the living room when the front band has room. */
function frontBedrooms(prog: FloorProgram, W: number): FloorProgram {
  const pub = prog.bands.find((b) => b.kind === "public");
  if (!pub || !prog.privateUnits.length) return prog;
  const units = [...pub.units];
  const rest: Unit[] = [];
  for (const u of prog.privateUnits) {
    const isBed = u.cols[0].rooms[0].type === "bedroom" || u.cols[0].rooms[0].type === "master_bedroom";
    let placed = false;
    for (const v of isBed ? [u, compactUnit(u)] : []) {
      const trial = [...units, v];
      // Fits if minimum widths fit and the band wouldn't need to be deeper than allowed.
      const fitsWidth = trial.reduce((a, t) => a + unitMinW(t), 0) <= W + 1e-6;
      const fitsDepth = trial.reduce((a, t) => a + unitArea(t), 0) / W <= pub.maxD;
      if (fitsWidth && fitsDepth) {
        units.push(v);
        placed = true;
        break;
      }
    }
    if (!placed) rest.push(u);
  }
  if (rest.length === prog.privateUnits.length) return prog;
  return { ...prog, bands: prog.bands.map((b) => (b === pub ? { ...b, units } : b)), privateUnits: rest };
}

function groundStructure(req: Requirements, W: number, porch: boolean, ctx: SiteContext): FloorStructure & { stairBand: number } {
  const raw = groundProgram(req, porch, ctx.fit);
  // Tight plots can drop the sit-out (main door straight onto the front wall).
  const base = ctx.noSitout && !porch ? { ...raw, bands: raw.bands.filter((b) => b.kind !== "sitout"), stairBand: raw.stairBand >= 0 ? raw.stairBand - 1 : -1 } : raw;
  const prog = adjustGround(frontBedrooms(base, W), W);
  const { bands, stairBand, overflow: spill } = expandBands(prog, W);
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
  const decks: Unit[] = req.floors === 1
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
  const priv = privateBands(privateUnits, W).map((b, i) =>
    b.kind === "private" && !b.corridorBehind ? withFiller(b, W, "Courtyard", `court-${i}`) : b);
  const all = [...bands, ...priv];
  // Absorbs extra depth when an upper floor is deeper than the ground floor.
  all.push({ kind: "terrace", units: [{ cols: [{ rooms: [openSpec("terrace", "Open Court", 0, "gcourt")] }] }], minD: 0, maxD: 99 });
  // Bands up to the stair keep their natural depth so the stair stacks.
  return { bands: all, frozen: stairBand + 1, stairBand };
}

function upperStructure(req: Requirements, floor: number, W: number, stairY: number, stairD: number, fit: number): FloorStructure {
  const prog = upperProgram(req, floor, fit);
  const balcony = prog.bands.find((b) => b.kind === "balcony");
  const stair = prog.bands[prog.stairBand];
  const useBalcony = !!balcony && stairY - BALCONY_D >= 3.0;
  const frontD = stairY - (useBalcony ? BALCONY_D : 0);

  const rows = packPrivate(prog.privateUnits, W);
  const frontUnits = frontD >= 3.0 ? rows[0] ?? [] : [];
  // Compact variants are copies, so match units by their first room.
  const frontKeys = new Set(frontUnits.map((u) => u.cols[0].rooms[0].key));
  const rearUnits = prog.privateUnits.filter((u) => !frontKeys.has(u.cols[0].rooms[0].key));

  const bands: Band[] = [];
  if (useBalcony) {
    const n = (balcony!.units.length);
    bands.push({ ...balcony!, units: Array.from({ length: n }, (_, i) => ({ cols: [{ rooms: [openSpec("balcony", n > 1 ? `Balcony ${i + 1}` : "Balcony", 6, `bal-${floor}-${i}`)] }] })) });
  }
  const front: Band = frontUnits.length
    ? withFiller({ kind: "front", units: frontUnits, fixedD: frontD, minD: frontD, maxD: frontD }, W, "Open Terrace", `fterr-${floor}`)
    : { kind: "terrace", units: [{ cols: [{ rooms: [openSpec("terrace", "Open Terrace", W * frontD, `fterr-${floor}`)] }] }], fixedD: frontD, minD: frontD, maxD: frontD };
  if (frontD > 0.3) bands.push(front);
  bands.push({ ...stair, fixedD: stairD, minD: stairD, maxD: stairD });

  const rear = privateBands(rearUnits, W).map((b, i) =>
    b.kind === "private" && !b.corridorBehind ? withFiller(b, W, "Open Terrace", `rterr-${floor}-${i}`) : b);
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

const sumDepth = (bands: Band[], W: number) => bands.reduce((a, b) => a + targetDepth(b, W), 0);

interface Candidate {
  W: number;
  D: number;
  porch: boolean;
  ground: FloorStructure & { stairBand: number };
  uppers: FloorStructure[];
  cost: number;
}

/** Depth an upper floor needs in front of the stair for its street-facing rooms. */
function upperFrontNeed(req: Requirements, floor: number, W: number, fit: number): number {
  const prog = upperProgram(req, floor, fit);
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

/** Plot-local house rectangle for a width/depth, leaving the front yard for cars. */
function houseRect(build: Rect, W: number, D: number, req: Requirements, mirror: boolean): Rect {
  const wantFront = req.parking > 0 ? Math.max(0, 5.6 - build.y) : 0;
  const y = build.y + Math.max(0, Math.min(wantFront, build.h - D));
  const spare = build.w - W;
  const x = spare < 3 ? build.x + spare / 2 : mirror ? build.x + spare : build.x;
  return { x, y, w: W, h: D };
}

function evaluateWidth(req: Requirements, W: number, ctx: SiteContext, porch: boolean): Candidate {
  const ground = groundStructure(req, W, porch, ctx);
  const si = ground.stairBand;
  if (si >= 0) {
    // Deepen the front of the ground floor if upper floors need it for their bedrooms.
    const depths = ground.bands.map((b) => targetDepth(b, W));
    const stairY = depths.slice(0, si).reduce((a, b) => a + b, 0);
    let need = 0;
    for (let f = 1; f < req.floors; f++) need = Math.max(need, upperFrontNeed(req, f, W, ctx.fit));
    const grow = Math.min(need - stairY, 3);
    const j = ground.bands.slice(0, si).map((b, i) => (b.fixedD === undefined && b.units.length ? i : -1)).filter((i) => i >= 0).pop();
    if (grow > 0.05 && j !== undefined) {
      const nd = depths[j] + grow;
      ground.bands[j] = { ...ground.bands[j], fixedD: nd, minD: nd, maxD: nd };
    }
  }
  const gDepths = ground.bands.map((b) => targetDepth(b, W));
  const gTotal = gDepths.reduce((a, b) => a + b, 0);
  const stairY = si >= 0 ? gDepths.slice(0, si).reduce((a, b) => a + b, 0) : 0;
  const stairD = si >= 0 ? gDepths[si] : 0;

  const uppers: FloorStructure[] = [];
  let D = gTotal;
  for (let f = 1; f < req.floors; f++) {
    const st = upperStructure(req, f, W, stairY, stairD, ctx.fit);
    uppers.push(st);
    D = Math.max(D, sumDepth(st.bands, W));
  }

  const Dfit = Math.min(D, ctx.build.h);
  const k = Dfit / D;
  const structures = [ground, ...uppers];
  const rooms = structures.reduce((a, st) => {
    const { rooms: placed } = layoutBands(st.bands, fitDepths(st.bands, W, D, st.frozen), W, () => false);
    return a + roomPenalty(placed.map((p) => ({ ...p, y: p.y * k, h: p.h * k })));
  }, 0);
  const filler = structures.flatMap((st) => st.bands).flatMap((b) => b.units).flatMap((u) => u.cols)
    .flatMap((c) => c.rooms).filter((r) => r.type === "terrace").reduce((a, r) => a + r.area, 0);
  const siteReq = porch ? { ...req, parking: 0 as const } : req;
  // A missing car (that the user asked for) is costly; pool/garden less so.
  const siteWarnings = planSite(ctx.frame, houseRect(ctx.build, W, Dfit, siteReq, false), siteReq, ctx.sb).warnings;
  const site = siteWarnings.reduce((a, w) => a + (w.includes("car space") ? 3.5 : 1), 0);
  const over = Math.max(0, D - ctx.build.h);
  const aspect = Math.abs(Math.log(D / W / 1.15));
  // A yard parking spot is preferred; a porch must earn its place.
  const cost = over * 40 + rooms * 3 + aspect * 4 + (filler / (W * D)) * 12 + site * 10 + (porch ? 4 : 0);
  return { W, D, porch, ground, uppers, cost };
}

interface SiteContext {
  frame: PlotFrame;
  build: Rect;
  sb: ReturnType<typeof setbacksFor>;
  /** Room-size multiplier (1 = brief as given; lower = compact rooms for tight plots). */
  fit: number;
  noSitout?: boolean;
}

/** Best house width (and parking strategy) for a given room-size multiplier. */
function chooseCandidate(req: Requirements, ctx: SiteContext): Candidate {
  const maxW = Math.min(ctx.build.w, MAX_HOUSE_W);
  let best: Candidate | null = null;
  for (let W = Math.min(6, maxW); W <= maxW + 1e-9; W += 0.25) {
    for (const porch of req.parking > 0 ? [false, true] : [false]) {
      const c = evaluateWidth(req, W, ctx, porch);
      if (!best || c.cost < best.cost) best = c;
    }
  }
  return best!;
}

/* ------------------------------------------------------------------ */
/* Scoring & placement                                                 */
/* ------------------------------------------------------------------ */

function computeVastu(rooms: Room[], fp: Rect): number {
  const scored = rooms.filter((r) => r.idealDir);
  if (!scored.length) return 100;
  const sum = scored.reduce((a, r) => a + vastuRoomScore(directionOf(r.x + r.w / 2, r.y + r.h / 2, fp), r.idealDir!), 0);
  return Math.round((sum / scored.length) * 100);
}

function touchesBoundary(r: Rect, fp: Rect): boolean {
  const e = 0.02;
  return Math.abs(r.x - fp.x) < e || Math.abs(r.y - fp.y) < e
    || Math.abs(r.x + r.w - (fp.x + fp.w)) < e || Math.abs(r.y + r.h - (fp.y + fp.h)) < e;
}

/** Daylight: an outside wall, or a wall onto a sit-out / balcony / terrace. */
function hasDaylight(r: Room, rooms: Room[], fp: Rect): boolean {
  return touchesBoundary(r, fp) || rooms.some((o) => OPEN_TYPES.has(o.type) && !!sharedWall(r, o));
}

function floorScore(rooms: Room[], fp: Rect, req: Requirements): number {
  const beds = rooms.filter((r) => r.type === "bedroom" || r.type === "master_bedroom");
  const lit = beds.length ? beds.filter((b) => hasDaylight(b, rooms, fp)).length / beds.length : 1;
  const kitchen = rooms.find((r) => r.type === "kitchen");
  const kitchenLit = kitchen && touchesBoundary(kitchen, fp) ? 1 : 0;
  return (req.vastu ? computeVastu(rooms, fp) / 100 : 0) + 0.25 * lit + 0.1 * kitchenLit;
}

interface Placement {
  frame: PlotFrame;
  /** House rectangle in plot-local coordinates. */
  local: Rect;
  mirror: boolean;
  /** House footprint in world coordinates. */
  world: Rect;
}

function toRooms(placed: Placed[], p: Placement, W: number): Room[] {
  const keyToId = new Map(placed.map((pl) => [pl.spec.key, pl.spec.key]));
  return placed.map((pl) => {
    const lx = p.mirror ? W - pl.x - pl.w : pl.x;
    const world = toWorldRect(p.frame, { x: p.local.x + lx, y: p.local.y + pl.y, w: pl.w, h: pl.h });
    return {
      id: pl.spec.key,
      type: pl.spec.type,
      label: pl.spec.label,
      zone: pl.spec.zone,
      idealDir: pl.spec.idealDir,
      parentId: pl.spec.parentKey && keyToId.has(pl.spec.parentKey) ? pl.spec.parentKey : undefined,
      ...world,
    };
  });
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

/**
 * Lay a floor out at its natural depth D, then scale depths by `k` (< 1 only
 * when the plot is too shallow — every floor scales alike, so stairs still stack).
 */
function bestFloor(s: FloorStructure, W: number, D: number, k: number, p: Placement, req: Requirements): { rooms: Room[]; score: number } {
  const depths = fitDepths(s.bands, W, D, s.frozen).map((d) => d * k);
  let best: { rooms: Room[]; score: number } | null = null;
  for (const rev of reversalSets(s.bands)) {
    const { rooms: placed } = layoutBands(s.bands, depths, W, (_, i) => rev[i]);
    const rooms = toRooms(placed, p, W);
    const score = floorScore(rooms, p.world, req);
    if (!best || score > best.score + 1e-9) best = { rooms, score };
  }
  return best!;
}

/* ------------------------------------------------------------------ */
/* Metrics, suggestions, validation                                    */
/* ------------------------------------------------------------------ */

function floorMetrics(rooms: Room[], fp: Rect, walls: ReturnType<typeof generateWalls>) {
  const open = rooms.filter((r) => r.type === "terrace").reduce((a, r) => a + r.w * r.h, 0);
  const builtUpArea = fp.w * fp.h - open;
  const indoor = rooms.filter((r) => !OPEN_TYPES.has(r.type)).reduce((a, r) => a + r.w * r.h, 0);
  const wallArea = walls.filter((w) => w.type !== "railing")
    .reduce((a, w) => a + Math.hypot(w.x2 - w.x1, w.y2 - w.y1) * w.thickness, 0);
  const carpetArea = Math.max(0, indoor - wallArea);
  return {
    builtUpArea,
    carpetArea,
    efficiency: builtUpArea > 0 ? carpetArea / builtUpArea : 0,
    perimeter: 2 * (fp.w + fp.h),
    vastuScore: computeVastu(rooms, fp),
  };
}

export function planVastuScore(plan: PlanResult): number {
  return Math.round(plan.floors.reduce((a, f) => a + f.metrics.vastuScore, 0) / plan.floors.length);
}

function buildSuggestions(plan: PlanResult, req: Requirements, siteWarnings: string[]): Suggestion[] {
  const out: Suggestion[] = [];
  const fp = plan.footprint;
  let blind = 0;
  for (const f of plan.floors) {
    for (const r of f.rooms) {
      if ((r.type === "bedroom" || r.type === "master_bedroom") && !hasDaylight(r, f.rooms, fp)) blind++;
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

  const built = plan.floors.reduce((a, f) => a + f.metrics.builtUpArea, 0);
  const coverage = (fp.w * fp.h) / plan.plotArea;
  out.push({
    kind: "space",
    severity: coverage <= 0.65 ? "good" : "info",
    message: `House footprint ${Math.round(fp.w * fp.h)} m² (${Math.round(coverage * 100)}% ground coverage), ${Math.round(built)} m² built-up across ${plan.floors.length} floor(s).`,
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

const MIN_ROOM_AREA: Partial<Record<string, number>> = {
  living: 10, lounge: 8, dining: 6, kitchen: 5, toilet: 1.5, pooja: 1.5, office: 6, stair: 7,
  store: 1.2, utility: 1.2, master_bedroom: 10, bedroom: 8, bathroom: 2.5, dress: 1.2,
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
  const count = (pred: (r: Room) => boolean) => all.filter(pred).length;
  const beds = count((r) => r.type === "bedroom" || r.type === "master_bedroom");
  const baths = count((r) => r.type === "bathroom");
  if (beds !== req.bedrooms) errors.push(`Expected ${req.bedrooms} bedrooms, but generated ${beds}.`);
  if (baths !== req.bathrooms) errors.push(`Expected ${req.bathrooms} bathrooms, but generated ${baths}.`);
  if (req.homeOffice && !count((r) => r.type === "office")) errors.push("Home Office was requested but not generated.");
  return { ok: errors.length === 0, errors };
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export function generatePlan(req: Requirements): PlanResult {
  const frame = makePlotFrame(req);
  const sb = setbacksFor(frame.pw, frame.pd);
  const build = buildableRect(frame, sb);

  // 1–2. Pick the house width. If the brief doesn't fit, compact step by step:
  // slightly smaller rooms first, then drop the sit-out, then smaller again.
  const attempts: { fit: number; noSitout: boolean }[] = [
    { fit: 1, noSitout: false }, { fit: 0.9, noSitout: false }, { fit: 1, noSitout: true },
    { fit: 0.9, noSitout: true }, { fit: 0.8, noSitout: false }, { fit: 0.8, noSitout: true },
    { fit: 0.72, noSitout: true },
  ];
  let cand: Candidate | null = null;
  let fit = 1;
  for (const a of attempts) {
    const next = chooseCandidate(req, { frame, build, sb, ...a });
    if (!cand || next.D < cand.D - 0.05) { cand = next; fit = a.fit; }
    if (cand.D <= build.h + 0.05) break;
  }
  if (!cand) throw new Error("No layout candidate");
  const W = cand.W;
  const D = Math.min(cand.D, build.h);
  const k = D / cand.D;
  const siteReq = cand.porch ? { ...req, parking: 0 as const } : req;

  // 5. Where the house sits: room in front for cars, and one usable side yard.
  let chosen: { floors: Room[][]; score: number; placement: Placement } | null = null;
  for (const mirror of [false, true]) {
    const local = houseRect(build, W, D, siteReq, mirror);
    const placement: Placement = { frame, local, mirror, world: toWorldRect(frame, local) };
    const floors = [cand.ground, ...cand.uppers].map((s) => bestFloor(s, W, cand!.D, k, placement, req));
    const score = floors.reduce((a, f) => a + f.score, 0);
    if (!chosen || score > chosen.score + 1e-9) chosen = { floors: floors.map((f) => f.rooms), score, placement };
  }
  const { placement } = chosen!;
  const fp = placement.world;

  const floors: FloorPlan[] = chosen!.floors.map((rooms, i) => {
    const { doors, windows } = placeOpenings(rooms, fp, frame.road);
    const walls = generateWalls(rooms, fp);
    return {
      floor: i,
      name: FLOOR_NAMES[i] ?? `Floor ${i}`,
      roadSide: frame.road,
      footprint: fp,
      rooms,
      doors,
      windows,
      walls,
      metrics: floorMetrics(rooms, fp, walls),
    };
  });

  const site = planSite(frame, placement.local, siteReq, sb);
  const result: PlanResult = {
    plotArea: frame.area,
    footprint: fp,
    site: {
      plot: frame.world,
      buildable: toWorldRect(frame, build),
      roadSide: frame.road,
      elements: site.elements.map((e) => ({ ...e, ...toWorldRect(frame, e) })),
    },
    setback: sb,
    floors,
    suggestions: [],
  };
  const warnings = [...site.warnings];
  if (cand.porch) {
    result.suggestions.push({ kind: "space", severity: "info", message: "Cars park in a covered porch at the front of the house, under the floor above." });
  }
  if (fit < 1) {
    result.suggestions.push({ kind: "space", severity: "info", message: `Rooms were sized compactly (about ${Math.round(fit * 100)}% of the usual size for this finish level) to fit the plot.` });
  }
  if (cand.D > build.h + 0.05) {
    warnings.push(`The brief needs ${cand.D.toFixed(1)} m of depth but only ${build.h.toFixed(1)} m is buildable, so rooms were compressed.`);
  }
  result.suggestions = [...buildSuggestions(result, req, warnings), ...result.suggestions];
  result.validation = validatePlanRequirements(result, req);
  return result;
}
