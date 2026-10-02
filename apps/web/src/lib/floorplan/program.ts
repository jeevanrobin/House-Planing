/**
 * Room program: what rooms each floor needs, at realistic sizes, grouped
 * into front-to-back bands the layout solver can tile.
 *
 * Vocabulary
 *  - Column: rooms stacked front-to-back inside one strip of a band
 *    (e.g. dressing room in front of an ensuite bath).
 *  - Unit:   columns that must stay side by side (bedroom + its ensuite).
 *  - Band:   a full-width strip of the house (sit-out, living, kitchen/dining…).
 */
import { IDEAL_DIRECTION } from "./vastu";
import type { Facing, Requirements, RoomType, Zone } from "./types";

export interface RoomSpec {
  key: string;
  type: RoomType;
  label: string;
  zone: Zone;
  /** Target floor area at this luxury level (m²). */
  area: number;
  minW: number;
  minD: number;
  idealDir?: Facing;
  /** May be dropped when its column is too shallow (e.g. dressing room). */
  optional?: boolean;
  /** Ensuite bath / dressing room: key of its bedroom. */
  parentKey?: string;
}

export interface Column {
  rooms: RoomSpec[];
  /** Fixed width (staircase, passage); otherwise sized by area. */
  fixedW?: number;
  /** Index of the room that absorbs leftover depth (default: the main room). */
  absorb?: number;
}

export interface Unit {
  cols: Column[];
  /** Keep this unit at the start/end of its band regardless of ordering. */
  pin?: "start" | "end";
}

export type BandKind =
  | "sitout" | "public" | "service" | "private" | "corridor" | "balcony" | "front" | "stair" | "terrace";

export interface Band {
  kind: BandKind;
  units: Unit[];
  /** Fixed depth (sit-out, balcony, corridor) — otherwise solved from areas. */
  fixedD?: number;
  minD: number;
  maxD: number;
  /** Corridor is behind this band (true) or in front of it (false). */
  corridorBehind?: boolean;
}

const ZONE_OF: Record<RoomType, Zone> = {
  living: "public", dining: "public", foyer: "public", lounge: "public", sitout: "outdoor",
  kitchen: "service", store: "service", utility: "service", bathroom: "service", toilet: "service",
  parking: "service", stair: "circulation", corridor: "circulation",
  bedroom: "private", master_bedroom: "private", pooja: "private", office: "private", dress: "private",
  balcony: "outdoor", garden: "outdoor", pool: "outdoor", terrace: "outdoor",
};

// Base sizes at luxury 3 / standard budget: area (m²), min width, min depth.
const CATALOG: Record<string, [number, number, number]> = {
  living: [20, 3.6, 3.3],
  lounge: [14, 3.3, 3.0],
  dining: [11, 3.0, 2.7],
  kitchen: [9, 2.4, 2.4],
  utility: [3.2, 1.2, 1.2],
  store: [2.8, 1.2, 1.2],
  pooja: [3.2, 1.5, 1.5],
  toilet: [2.6, 1.2, 1.4],
  office: [9, 2.7, 2.7],
  master_bedroom: [16, 3.6, 3.3],
  bedroom: [12.5, 3.0, 3.0],
  master_bath: [5.5, 1.6, 2.0],
  bathroom: [4.2, 1.5, 1.8],
  master_dress: [4.5, 1.5, 1.2],
  dress: [3.2, 1.2, 1.2],
  // Compact Indian sizes for tight plots: a 4'×7' toilet, a combined hall.
  compact_bath: [2.6, 1.2, 2.1],
  hall: [17, 3.3, 3.6],
  kitchen_dining: [12, 2.4, 2.7],
  compact_master: [14, 3.0, 3.0],
};

/**
 * How far the program is trimmed to fit a tight plot, before rooms shrink:
 *  0 – full program;
 *  1 – no powder room, stores, utility or dressing rooms;
 *  2 – also a hall and a kitchen-dining instead of three rooms, 4'×7' baths,
 *      no separate pooja room, and every bedroom upstairs on multi-storey homes.
 */
export type Trim = 0 | 1 | 2;

export const PORCH_D = 5.0; // 16 ft: car length + clearance, the usual Indian porch
export const CAR_W = 3.0;
export const STAIR_W = 2.6; // dog-leg stair: two 1.1 m flights + 0.4 m gap
export const STAIR_W_NARROW = 2.1; // narrow plots: two 3 ft (0.95 m) flights + 0.2 m gap

/** Houses under ~28 ft wide use 3 ft flights, as Indian plans on 20–30 ft plots do. */
export const stairWidthFor = (houseW: number) => (houseW < 8.5 ? STAIR_W_NARROW : STAIR_W);
export const STAIR_MIN_D = 3.9; // run for ~3 m floor height + landing
export const CORRIDOR_D = 1.2;
export const SITOUT_D = 1.5;
export const BALCONY_D = 1.5;

/** Room-size multiplier from luxury level and budget; `fit` < 1 compacts rooms for tight plots. */
function scale(req: Requirements, fit = 1): number {
  const budget = { economy: 0.92, standard: 1, premium: 1.08, luxury: 1.16 }[req.budget];
  return (0.7 + 0.1 * req.luxury) * budget * fit;
}

let keySeq = 0;
function room(type: RoomType, label: string, s: number, catalogKey: string = type, extra: Partial<RoomSpec> = {}): RoomSpec {
  const [area, minW, minD] = CATALOG[catalogKey] ?? [10, 2.4, 2.4];
  // Wet areas and stores grow less with luxury than living spaces do.
  const grow = ["toilet", "store", "utility"].includes(type) ? Math.sqrt(s) : s;
  return {
    key: `${type}-${keySeq++}`,
    type,
    label,
    zone: ZONE_OF[type],
    area: area * grow,
    minW,
    minD,
    idealDir: IDEAL_DIRECTION[type],
    ...extra,
  };
}

const single = (r: RoomSpec, pin?: Unit["pin"]): Unit => ({ cols: [{ rooms: [r] }], pin });

export function bedroomsPerFloor(total: number, floors: number, groundBed = true): number[] {
  if (floors <= 1) return [total];
  const out = new Array(floors).fill(0);
  // A ground-floor bedroom for elders/guests once there are 3+ bedrooms
  // (tight plots give the ground floor to parking and living instead).
  out[0] = total >= 3 && groundBed ? 1 : 0;
  let remaining = total - out[0];
  let f = 1;
  while (remaining > 0) {
    out[f] += 1;
    remaining -= 1;
    f = f + 1 >= floors ? 1 : f + 1;
  }
  return out;
}

export function bathroomsPerFloor(total: number, floors: number, beds: number[]): number[] {
  if (floors <= 1) return [total];
  const out = new Array(floors).fill(0);
  let remaining = total;
  // Every floor with bedrooms gets at least one bath, then share the rest by bedrooms.
  for (let f = 0; f < floors && remaining > 0; f++) {
    if (beds[f] > 0) { out[f] = 1; remaining -= 1; }
  }
  const totalBeds = beds.reduce((a, b) => a + b, 0) || 1;
  for (let f = 0; f < floors && remaining > 0; f++) {
    const add = Math.min(remaining, Math.round((remaining * beds[f]) / totalBeds));
    out[f] += add;
    remaining -= add;
  }
  for (let f = 1; remaining > 0; f = f + 1 >= floors ? 0 : f + 1) {
    out[f] += 1;
    remaining -= 1;
  }
  return out;
}

export function balconiesPerFloor(total: number, floors: number): number[] {
  if (floors <= 1) return [total];
  const out = new Array(floors).fill(0);
  for (let i = 0; i < total; i++) out[1 + (i % (floors - 1))] += 1;
  return out;
}

/** Bedroom units (bedroom + ensuite column) and common baths for one floor. */
function privateUnits(req: Requirements, floor: number, s: number, trim: Trim = 0): Unit[] {
  const rental = req.buildingType === "rental";
  // Duplex: bedrooms upstairs, a ground-floor guest room only in 4+ BHK homes.
  const groundBed = trim < 2 && (req.buildingType === "duplex" ? req.bedrooms >= 4 : true);
  const perFloor = rental ? new Array(req.floors).fill(req.bedrooms) : bedroomsPerFloor(req.bedrooms, req.floors, groundBed);
  const beds = perFloor[floor] ?? 0;
  let baths = rental ? req.bathrooms : bathroomsPerFloor(req.bathrooms, req.floors, perFloor)[floor] ?? 0;
  // Each rental floor is its own home with its own master bedroom.
  const masterFloor = rental ? floor : req.floors > 1 ? 1 : 0;
  const units: Unit[] = [];
  // Number bedrooms across the whole house (the master is not numbered); rental floors start again.
  let n = 1;
  if (!rental) for (let f = 0; f < floor; f++) n += perFloor[f] - (f === masterFloor && req.bedrooms > 1 ? 1 : 0);
  for (let b = 0; b < beds; b++) {
    const master = floor === masterFloor && b === 0 && req.bedrooms > 1;
    const bed = master
      // Compact plans: a 10 ft master (standard bedroom size) keeps its bath beside it.
      ? room("master_bedroom", "Master Bedroom", s, trim >= 2 ? "compact_master" : "master_bedroom")
      : room("bedroom", `Bedroom ${n++}`, s);
    if (baths > 0) {
      baths -= 1;
      const bath = room("bathroom", master ? "Master Bath" : "Bath", s, trim >= 2 ? "compact_bath" : master ? "master_bath" : "bathroom", { parentKey: bed.key });
      const dress = room("dress", master ? "Walk-in Closet" : "Dress", s, master ? "master_dress" : "dress", { parentKey: bed.key, optional: true });
      units.push({ cols: [{ rooms: [bed] }, { rooms: trim >= 1 ? [bath] : [dress, bath] }] });
    } else {
      units.push(single(bed));
    }
  }
  for (let i = 0; i < baths; i++) {
    units.push({ cols: [{ rooms: [room("bathroom", "Common Bath", s, trim >= 2 ? "compact_bath" : "bathroom")] }] });
  }
  if (!rental && floor > 0 && req.homeOffice && floor === 1) {
    units.push(single(room("office", "Home Office", s)));
  }
  return units;
}

export interface FloorProgram {
  /** Bands in the front section, the stair band, and the private section. */
  bands: Band[];
  /** Index of the band holding the staircase (multi-storey only). */
  stairBand: number;
  /** Private units still to be placed behind a corridor. */
  privateUnits: Unit[];
}

/**
 * Ground floor: sit-out → living → kitchen/dining (+stair) → [corridor → bedrooms].
 * With `porch`, cars park in a covered porch across the front instead of the yard.
 */
/**
 * With `stairFront` (narrow plots, cars in a porch) the staircase rises beside
 * the car porch, as on most 20–25 ft Indian plots, instead of behind the kitchen.
 * With `livingFront` (25–40 ft plots) the living room sits beside the car
 * instead of a full-width sit-out, so parking costs no extra depth.
 */
export function groundProgram(req: Requirements, porch = false, fit = 1, trim: Trim = 0, stairFront = false, livingFront = false, stairW = STAIR_W): FloorProgram {
  keySeq = 0;
  const s = scale(req, fit);
  const bands: Band[] = [];

  const living = trim >= 2 ? room("living", "Hall", s, "hall") : room("living", "Living Room", s);
  livingFront = livingFront && porch && !stairFront;
  if (porch) {
    const cars: Unit[] = Array.from({ length: req.parking }, (_, i) => ({
      // Beside a front stair the car takes the remaining width, so the stair keeps its exact width on every floor.
      cols: [{ rooms: [{ ...room("parking", req.parking > 1 ? `Car Porch ${i + 1}` : "Car Porch", s), area: CAR_W * PORCH_D, minW: 2.7, minD: 5.0 }], fixedW: stairFront ? undefined : CAR_W }],
      pin: "start" as const,
    }));
    const beside = stairFront
      ? { cols: [{ rooms: [room("stair", "Staircase", s)], fixedW: STAIR_W_NARROW }], pin: "end" as const }
      : livingFront ? single(living, "end") : single(room("sitout", "Sit-out", s));
    bands.push({ kind: "sitout", units: [...cars, beside], fixedD: PORCH_D, minD: PORCH_D, maxD: PORCH_D });
  } else if (stairFront) {
    // Rental floors: the stair to the upper homes rises beside the sit-out, from outside.
    const stair = { cols: [{ rooms: [room("stair", "Staircase", s)], fixedW: stairW }], pin: "end" as const };
    bands.push({ kind: "sitout", units: [single(room("sitout", "Sit-out", s)), stair], fixedD: STAIR_MIN_D, minD: STAIR_MIN_D, maxD: STAIR_MIN_D });
  } else {
    bands.push({ kind: "sitout", units: [single(room("sitout", "Sit-out", s))], fixedD: SITOUT_D, minD: SITOUT_D, maxD: SITOUT_D });
  }

  // Circulation spine on the "end" side: living above dining, dining beside the
  // stair, passages beside the stair. Bedrooms and services take the other side.
  // End-pinned units keep array order: [pooja] [living] [powder] hug each other,
  // so both small rooms open off the living room; front bedrooms go beyond them.
  const pub: Unit[] = [];
  // A compact pooja with a small store behind it, rather than a deep sliver.
  // Tight plots keep a pooja niche in the hall instead of a separate room.
  const poojaUnits: Unit[] = [];
  if (req.vastu && trim < 2) {
    (livingFront ? poojaUnits : pub).push({ cols: [{ rooms: trim >= 1 ? [room("pooja", "Pooja", s)] : [room("pooja", "Pooja", s), room("store", "Store", s, "store", { optional: true })], absorb: trim >= 1 ? undefined : 1 }], pin: livingFront ? undefined : "end" });
  }
  if (!livingFront) pub.push(single(living, "end"));
  if (req.homeOffice && req.floors === 1) pub.push(single(room("office", "Home Office", s)));
  // The public band carries the pooja / powder room even when the living room moved forward.
  const pubBand: Band = { kind: "public", units: pub, minD: livingFront ? 2.1 : 3.3, maxD: 5.4 };

  const kitchenCol: Column = {
    rooms: trim >= 2 ? [room("kitchen", "Kitchen & Dining", s, "kitchen_dining")]
      : trim >= 1 ? [room("kitchen", "Kitchen", s)]
        : [room("kitchen", "Kitchen", s), room("utility", "Wash Area", s, "utility", { optional: true })],
  };
  const svc: Unit[] = [{ cols: [kitchenCol], pin: "end" }];
  if (trim < 2) svc.push(single(room("dining", "Dining", s), "end"));
  svc.push(...poojaUnits);
  // Guest powder room near the entrance (off the living room, never the
  // kitchen) — only when the bedrooms and their baths are upstairs.
  if (req.floors > 1 && trim < 1 && req.buildingType !== "rental") {
    pub.push({ cols: [{ rooms: [room("toilet", "Powder Room", s), room("store", "Store", s, "store", { optional: true })] }], pin: "end" });
  }
  let stairBand = -1;
  if (stairFront && req.floors > 1) stairBand = 0;
  else if (req.floors > 1) {
    svc.push({ cols: [{ rooms: [room("stair", "Staircase", s)], fixedW: stairW }], pin: "end" });
  }
  if (pub.length) bands.push(pubBand);
  bands.push({ kind: "service", units: svc, minD: req.floors > 1 ? STAIR_MIN_D : 3.0, maxD: 5.0 });
  if (req.floors > 1 && stairBand < 0) stairBand = bands.length - 1;

  return { bands, stairBand, privateUnits: privateUnits(req, 0, s, trim) };
}

/**
 * Rental upper floor: a complete home — hall, kitchen, bedrooms — entered
 * from the stair at the front. Same rooms as the ground-floor home, without
 * the stair band (the upper floor builds its own beside the stair).
 */
export function rentalUpperProgram(req: Requirements, floor: number, fit = 1, trim: Trim = 0): FloorProgram {
  const g = groundProgram(req, false, fit, trim, true, false);
  const tag = (u: Unit): Unit => ({
    ...u,
    cols: u.cols.map((c) => ({ ...c, rooms: c.rooms.map((r) => ({ ...r, key: `f${floor}-${r.key}`, parentKey: r.parentKey && `f${floor}-${r.parentKey}` })) })),
  });
  return {
    bands: g.bands.slice(1).map((b) => ({ ...b, units: b.units.map(tag) })),
    stairBand: -1,
    privateUnits: g.privateUnits.map(tag),
  };
}

/** Upper floor: [balcony] → bedrooms → lounge + stair → [corridor → bedrooms] → [terrace]. */
// Note: the ground floor puts its stair last in the service band, so upper stairs pin "end" too.
export function upperProgram(req: Requirements, floor: number, fit = 1, trim: Trim = 0, stairW = STAIR_W): FloorProgram {
  const s = scale(req, fit);
  const balconies = balconiesPerFloor(req.balconies, req.floors)[floor] ?? 0;
  const units = privateUnits(req, floor, s, trim);
  const bands: Band[] = [];
  if (balconies > 0) {
    bands.push({ kind: "balcony", units: [single(room("balcony", "Balcony", s))], fixedD: BALCONY_D, minD: BALCONY_D, maxD: BALCONY_D });
  }
  // Front band: bedrooms facing the street (filled by the solver from `units`).
  bands.push({ kind: "front", units: [], minD: 3.0, maxD: 6.0 });
  const lounge = room("lounge", floor === 1 ? "Family Lounge" : "Lounge", s);
  // The stair continues on every upper floor (the top flight leads to the roof).
  const stairUnits: Unit[] = [
    single(lounge, "start"),
    { cols: [{ rooms: [room("stair", "Staircase", s)], fixedW: stairW }], pin: "end" },
  ];
  bands.push({ kind: "stair", units: stairUnits, minD: STAIR_MIN_D, maxD: 6.0 });
  return { bands, stairBand: bands.length - 1, privateUnits: units };
}

export { ZONE_OF };
