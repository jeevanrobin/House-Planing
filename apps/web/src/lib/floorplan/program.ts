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
};

export const PORCH_D = 5.5; // car length + clearance
export const CAR_W = 3.0;
export const STAIR_W = 2.6; // dog-leg stair: two 1.1 m flights + 0.4 m gap
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

export function bedroomsPerFloor(total: number, floors: number): number[] {
  if (floors <= 1) return [total];
  const out = new Array(floors).fill(0);
  // A ground-floor bedroom for elders/guests once there are 3+ bedrooms.
  out[0] = total >= 3 ? 1 : 0;
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
function privateUnits(req: Requirements, floor: number, s: number): Unit[] {
  const beds = bedroomsPerFloor(req.bedrooms, req.floors)[floor] ?? 0;
  let baths = bathroomsPerFloor(req.bathrooms, req.floors, bedroomsPerFloor(req.bedrooms, req.floors))[floor] ?? 0;
  const masterFloor = req.floors > 1 ? 1 : 0;
  const units: Unit[] = [];
  // Number bedrooms across the whole house (the master is not numbered).
  const perFloor = bedroomsPerFloor(req.bedrooms, req.floors);
  let n = 1;
  for (let f = 0; f < floor; f++) n += perFloor[f] - (f === masterFloor && req.bedrooms > 1 ? 1 : 0);
  for (let b = 0; b < beds; b++) {
    const master = floor === masterFloor && b === 0 && req.bedrooms > 1;
    const bed = master
      ? room("master_bedroom", "Master Bedroom", s)
      : room("bedroom", `Bedroom ${n++}`, s);
    if (baths > 0) {
      baths -= 1;
      const bath = room("bathroom", master ? "Master Bath" : "Bath", s, master ? "master_bath" : "bathroom", { parentKey: bed.key });
      const dress = room("dress", master ? "Walk-in Closet" : "Dress", s, master ? "master_dress" : "dress", { parentKey: bed.key, optional: true });
      units.push({ cols: [{ rooms: [bed] }, { rooms: [dress, bath] }] });
    } else {
      units.push(single(bed));
    }
  }
  for (let i = 0; i < baths; i++) {
    units.push({ cols: [{ rooms: [room("bathroom", "Common Bath", s)] }] });
  }
  if (floor > 0 && req.homeOffice && floor === 1) {
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
export function groundProgram(req: Requirements, porch = false, fit = 1): FloorProgram {
  keySeq = 0;
  const s = scale(req, fit);
  const bands: Band[] = [];

  if (porch) {
    const cars: Unit[] = Array.from({ length: req.parking }, (_, i) => ({
      cols: [{ rooms: [{ ...room("parking", req.parking > 1 ? `Car Porch ${i + 1}` : "Car Porch", s), area: CAR_W * PORCH_D, minW: 2.7, minD: 5.0 }], fixedW: CAR_W }],
      pin: "start" as const,
    }));
    bands.push({ kind: "sitout", units: [...cars, single(room("sitout", "Sit-out", s))], fixedD: PORCH_D, minD: PORCH_D, maxD: PORCH_D });
  } else {
    bands.push({ kind: "sitout", units: [single(room("sitout", "Sit-out", s))], fixedD: SITOUT_D, minD: SITOUT_D, maxD: SITOUT_D });
  }

  // Circulation spine on the "end" side: living above dining, dining beside the
  // stair, passages beside the stair. Bedrooms and services take the other side.
  // End-pinned units keep array order: [pooja] [living] [powder] hug each other,
  // so both small rooms open off the living room; front bedrooms go beyond them.
  const pub: Unit[] = [];
  // A compact pooja with a small store behind it, rather than a deep sliver.
  if (req.vastu) pub.push({ cols: [{ rooms: [room("pooja", "Pooja", s), room("store", "Store", s, "store", { optional: true })], absorb: 1 }], pin: "end" });
  pub.push(single(room("living", "Living Room", s), "end"));
  if (req.homeOffice && req.floors === 1) pub.push(single(room("office", "Home Office", s)));
  bands.push({ kind: "public", units: pub, minD: 3.3, maxD: 5.4 });

  const kitchenCol: Column = { rooms: [room("kitchen", "Kitchen", s), room("utility", "Utility", s, "utility", { optional: true })] };
  const svc: Unit[] = [{ cols: [kitchenCol], pin: "end" }, single(room("dining", "Dining", s), "end")];
  // Guest powder room near the entrance (off the living room, never the
  // kitchen) — only when the bedrooms and their baths are upstairs.
  if (req.floors > 1) {
    pub.push({ cols: [{ rooms: [room("toilet", "Powder Room", s), room("store", "Store", s, "store", { optional: true })] }], pin: "end" });
  }
  let stairBand = -1;
  if (req.floors > 1) {
    svc.push({ cols: [{ rooms: [room("stair", "Staircase", s)], fixedW: STAIR_W }], pin: "end" });
  }
  bands.push({ kind: "service", units: svc, minD: req.floors > 1 ? STAIR_MIN_D : 3.0, maxD: 5.0 });
  if (req.floors > 1) stairBand = bands.length - 1;

  return { bands, stairBand, privateUnits: privateUnits(req, 0, s) };
}

/** Upper floor: [balcony] → bedrooms → lounge + stair → [corridor → bedrooms] → [terrace]. */
// Note: the ground floor puts its stair last in the service band, so upper stairs pin "end" too.
export function upperProgram(req: Requirements, floor: number, fit = 1): FloorProgram {
  const s = scale(req, fit);
  const balconies = balconiesPerFloor(req.balconies, req.floors)[floor] ?? 0;
  const units = privateUnits(req, floor, s);
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
    { cols: [{ rooms: [room("stair", "Staircase", s)], fixedW: STAIR_W }], pin: "end" },
  ];
  bands.push({ kind: "stair", units: stairUnits, minD: STAIR_MIN_D, maxD: 6.0 });
  return { bands, stairBand: bands.length - 1, privateUnits: units };
}

export { ZONE_OF };
