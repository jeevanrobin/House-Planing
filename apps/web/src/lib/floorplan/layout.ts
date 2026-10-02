/**
 * Band solver: turns a floor program into non-overlapping rectangles that
 * exactly tile a W × D house footprint.
 *
 * House-local frame: x runs along the road (0..W), y runs from the front
 * (road side, y = 0) to the rear (y = D).
 */
import {
  CORRIDOR_D, type Band, type Column, type FloorProgram, type RoomSpec, type Unit,
} from "./program";
import type { Rect } from "./types";

export interface Placed extends Rect {
  spec: RoomSpec;
}

export interface BandSlot {
  band: Band;
  y: number;
  d: number;
}

const colMinW = (c: Column) => c.fixedW ?? Math.max(...c.rooms.filter((r) => !r.optional).map((r) => r.minW), 0);
const colArea = (c: Column) => c.rooms.reduce((a, r) => a + r.area, 0);
const unitMinW = (u: Unit) => u.cols.reduce((a, c) => a + colMinW(c), 0);

/** Split units into rows whose minimum widths fit in W (pinned units stay in row 0). */
export function packRows(units: Unit[], W: number): Unit[][] {
  const rows: Unit[][] = [];
  let cur: Unit[] = [];
  let used = 0;
  const pinned = units.filter((u) => u.pin);
  const free = units.filter((u) => !u.pin);
  for (const u of pinned) { cur.push(u); used += unitMinW(u); }
  for (const u of free) {
    const w = unitMinW(u);
    if (cur.length && used + w > W + 1e-6) {
      rows.push(cur);
      cur = [];
      used = 0;
    }
    cur.push(u);
    used += w;
  }
  if (cur.length) rows.push(cur);
  return rows;
}

/** Depth this band wants at width W (fixed bands ignore W). */
export function targetDepth(band: Band, W: number): number {
  if (band.fixedD !== undefined) return band.fixedD;
  if (!band.units.length) return 0;
  const cols = band.units.flatMap((u) => u.cols);
  const fixed = cols.reduce((a, c) => a + (c.fixedW ?? 0), 0);
  const area = cols.filter((c) => c.fixedW === undefined).reduce((a, c) => a + colArea(c), 0);
  const flexW = Math.max(1, W - fixed);
  return Math.min(band.maxD, Math.max(band.minD, area / flexW));
}

/** Distribute `total` across items: proportional to weight, never below min. */
function waterFill(weights: number[], mins: number[], total: number): number[] {
  const n = weights.length;
  const out = new Array<number>(n).fill(0);
  const locked = new Array<boolean>(n).fill(false);
  for (let iter = 0; iter <= n; iter++) {
    const freeW = weights.reduce((a, w, i) => a + (locked[i] ? 0 : w), 0);
    const freeTotal = total - out.reduce((a, v, i) => a + (locked[i] ? v : 0), 0);
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (locked[i]) continue;
      out[i] = freeW > 0 ? (weights[i] / freeW) * freeTotal : freeTotal / n;
    }
    for (let i = 0; i < n; i++) {
      if (!locked[i] && out[i] < mins[i] - 1e-9) {
        out[i] = mins[i];
        locked[i] = true;
        changed = true;
      }
    }
    if (!changed) break;
  }
  // Mins alone exceed the total: compress proportionally (validation flags it).
  const sum = out.reduce((a, b) => a + b, 0);
  if (sum > total + 1e-9) return out.map((v) => (v * total) / sum);
  return out;
}

function orderUnits(units: Unit[], reversed: boolean): Unit[] {
  const start = units.filter((u) => u.pin === "start");
  const end = units.filter((u) => u.pin === "end");
  let mid = units.filter((u) => !u.pin);
  if (reversed) mid = [...mid].reverse().map((u) => ({ ...u, cols: [...u.cols].reverse() }));
  return [...start, ...mid, ...end];
}

/** Habitable rooms soak up spare width; wet rooms, stores and closets barely grow. */
const GROWS = new Set(["living", "lounge", "dining", "bedroom", "master_bedroom", "office", "terrace", "corridor", "sitout"]);
const growWeight = (c: Column) => (c.rooms.some((r) => GROWS.has(r.type)) ? 1 : 0.12);

/** Column widths: target width from area, then spare goes mostly to habitable rooms. */
function columnWidths(cols: Column[], d: number, avail: number): number[] {
  const target = cols.map((c) => Math.max(colMinW(c), colArea(c) / d));
  const total = target.reduce((a, b) => a + b, 0);
  if (total <= avail) {
    const weights = cols.map((c, i) => growWeight(c) * target[i]);
    const wsum = weights.reduce((a, b) => a + b, 0) || 1;
    return target.map((t, i) => t + ((avail - total) * weights[i]) / wsum);
  }
  return waterFill(cols.map(colArea), cols.map(colMinW), avail);
}

/** Lay out one band at depth `d` starting at y. */
export function layoutBand(band: Band, y: number, d: number, W: number, reversed: boolean, x0 = 0): Placed[] {
  if (!band.units.length || d <= 0) return [];
  const cols = orderUnits(band.units, reversed).flatMap((u) => u.cols);
  const fixedTotal = cols.reduce((a, c) => a + (c.fixedW ?? 0), 0);
  const flex = cols.filter((c) => c.fixedW === undefined);
  const flexW = columnWidths(flex, d, Math.max(0, W - fixedTotal));
  const out: Placed[] = [];
  let x = 0;
  let fi = 0;
  cols.forEach((c, idx) => {
    let w = c.fixedW !== undefined ? c.fixedW : flexW[fi++];
    if (idx === cols.length - 1) w = W - x; // absorb rounding
    out.push(...stackColumn(c, x0 + x, y, w, d, !!band.corridorBehind));
    x += w;
  });
  return out;
}

/** Split a column's depth among its rooms, dropping optional rooms that don't fit. */
function stackColumn(c: Column, x: number, y: number, w: number, d: number, rearFirst: boolean): Placed[] {
  let rooms = [...c.rooms];
  while (rooms.length > 1 && rooms.reduce((a, r) => a + r.minD, 0) > d) {
    const drop = rooms.findIndex((r) => r.optional);
    if (drop < 0) break;
    rooms.splice(drop, 1);
  }
  const wanted = c.absorb !== undefined ? c.rooms[c.absorb] : undefined;
  const absorber = wanted && rooms.includes(wanted) ? wanted : undefined;
  if (rearFirst) rooms = rooms.reverse();
  const depths = waterFill(rooms.map((r) => r.area), rooms.map((r) => r.minD), d);
  // Non-absorbing rooms shouldn't balloon: cap at their area, give the rest to the absorber.
  if (rooms.length > 1) {
    const primary = absorber ? rooms.indexOf(absorber)
      : rooms.findIndex((r) => !r.optional && !r.parentKey) >= 0
        ? rooms.findIndex((r) => !r.optional && !r.parentKey)
        : rooms.findIndex((r) => !r.optional);
    rooms.forEach((r, i) => {
      if (i === primary) return;
      const cap = Math.max(r.minD, r.area / w);
      if (depths[i] > cap) {
        depths[primary >= 0 ? primary : 0] += depths[i] - cap;
        depths[i] = cap;
      }
    });
  }
  const out: Placed[] = [];
  let cy = y;
  rooms.forEach((r, i) => {
    const h = i === rooms.length - 1 ? y + d - cy : depths[i];
    out.push({ spec: r, x, y: cy, w, h });
    cy += h;
  });
  return out;
}

/**
 * Front-section bands at width W. Units that don't fit their band are returned
 * as `overflow`, to be placed off the hallway with the bedrooms — a full-width
 * row of leftovers would cut the living spaces off from each other.
 */
export function expandBands(prog: FloorProgram, W: number): { bands: Band[]; stairBand: number; overflow: Unit[] } {
  const bands: Band[] = [];
  const overflow: Unit[] = [];
  let stairBand = -1;
  prog.bands.forEach((b, i) => {
    // The stair may sit in a fixed-depth band (beside the car porch on narrow plots).
    if (i === prog.stairBand) stairBand = bands.length;
    if (b.fixedD !== undefined || !b.units.length) {
      bands.push(b);
      return;
    }
    const [first, ...rest] = packRows(b.units, W);
    bands.push({ ...b, units: first });
    overflow.push(...rest.flat());
  });
  return { bands, stairBand, overflow };
}

/** Ensuite stacked behind the bedroom (no dressing room): narrower unit for tight houses. */
export function compactUnit(u: Unit): Unit {
  if (u.cols.length !== 2) return u;
  const bed = u.cols[0].rooms[0];
  const bath = u.cols[1].rooms.find((r) => r.type === "bathroom");
  if (!bath || (bed.type !== "bedroom" && bed.type !== "master_bedroom")) return u;
  return { ...u, cols: [{ rooms: [bed, bath], absorb: 0 }] };
}

/** Fewest rows: switch to compact ensuites when that saves a row. */
export function packPrivate(units: Unit[], W: number): Unit[][] {
  const rows = packRows(units, W);
  if (rows.length <= 1) return rows;
  const compact = packRows(units.map(compactUnit), W);
  return compact.length < rows.length ? compact : rows;
}

/** Private units behind corridors; passages keep every corridor connected. */
export function privateBands(units: Unit[], W: number): Band[] {
  if (!units.length) return [];
  const passageW = 1.2;
  let rows = packPrivate(units, W);
  if (rows.length > 1) rows = packPrivate(units, W - passageW);
  const mk = (us: Unit[], corridorBehind: boolean): Band => ({
    kind: "private", units: us, minD: 3.0, maxD: 5.0, corridorBehind,
  });
  const corridor = (): Band => ({
    kind: "corridor",
    units: [{ cols: [{ rooms: [corridorSpec()] }] }],
    fixedD: CORRIDOR_D, minD: CORRIDOR_D, maxD: CORRIDOR_D,
  });
  const passage = (): Unit => ({ cols: [{ rooms: [corridorSpec()], fixedW: passageW }], pin: "end" });

  if (rows.length === 1) return [corridor(), mk(rows[0], false)];
  // Double-loaded corridor: row 0 in front of it (with a passage through), the rest behind.
  const out: Band[] = [mk([passage(), ...rows[0]], true), corridor(), mk(rows.length > 2 ? [passage(), ...rows[1]] : rows[1], false)];
  for (let i = 2; i < rows.length; i++) {
    out.push(corridor(), mk(i < rows.length - 1 ? [passage(), ...rows[i]] : rows[i], false));
  }
  return out;
}

/** A 1.2 m passage column pinned to the band's start (lines up with dining / other passages). */
export function passageUnit(): Unit {
  return { cols: [{ rooms: [corridorSpec()], fixedW: 1.2 }], pin: "end" };
}

let corridorSeq = 0;
function corridorSpec(): RoomSpec {
  return {
    key: `corridor-${corridorSeq++}`, type: "corridor", label: "Passage", zone: "circulation",
    area: 0, minW: 1.0, minD: 1.0,
  };
}

/** Assign depths so bands fill exactly `D`; flexible bands grow/shrink first. */
/** A band's horizontal extent: start x and width (house-local metres). */
export interface Extent {
  x0: number;
  w: number;
}

const widthOf = (W: number | Extent[], i: number) => (typeof W === "number" ? W : W[i].w);

export function fitDepths(bands: Band[], W: number | Extent[], D: number, frozen = 0): number[] {
  const depths = bands.map((b, i) => targetDepth(b, widthOf(W, i)));
  const flexIdx = bands.map((b, i) => i).filter((i) => i >= frozen && bands[i].fixedD === undefined && bands[i].units.length);
  let delta = D - depths.reduce((a, b) => a + b, 0);
  if (Math.abs(delta) < 1e-9 || !flexIdx.length) return depths;
  if (delta > 0) {
    // Grow rooms up to their max depth; leftovers go to open terraces/courts.
    const rooms = flexIdx.filter((i) => bands[i].kind !== "terrace");
    const fillers = flexIdx.filter((i) => bands[i].kind === "terrace");
    for (const i of rooms) {
      const add = Math.min(delta, bands[i].maxD - depths[i]);
      if (add > 0) { depths[i] += add; delta -= add; }
    }
    // Slivers under 1 m aren't worth a court: give them to the rooms instead.
    const sink = fillers.length && (delta >= 1 || !rooms.length) ? fillers : rooms;
    if (delta > 1e-9) for (const i of sink) depths[i] += delta / sink.length;
  } else {
    let need = -delta;
    for (const i of flexIdx) {
      const take = Math.min(need, depths[i] - bands[i].minD);
      if (take > 0) { depths[i] -= take; need -= take; }
    }
    if (need > 1e-9) {
      const flexTotal = flexIdx.reduce((a, i) => a + depths[i], 0);
      for (const i of flexIdx) depths[i] -= (depths[i] / flexTotal) * need;
    }
  }
  return depths;
}

/** Lay bands out top to bottom; with extents, each band can have its own width and offset. */
export function layoutBands(bands: Band[], depths: number[], W: number | Extent[], reversed: (b: Band, i: number) => boolean): { rooms: Placed[]; slots: BandSlot[] } {
  const rooms: Placed[] = [];
  const slots: BandSlot[] = [];
  let y = 0;
  bands.forEach((b, i) => {
    const ext = typeof W === "number" ? { x0: 0, w: W } : W[i];
    rooms.push(...layoutBand(b, y, depths[i], ext.w, reversed(b, i), ext.x0));
    slots.push({ band: b, y, d: depths[i] });
    y += depths[i];
  });
  return { rooms, slots };
}
