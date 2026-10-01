import { IDEAL_DIRECTION } from "./vastu";
import type { Facing, Requirements, RoomType, Zone } from "./types";

export interface RoomSpec {
  type: RoomType;
  label: string;
  zone: Zone;
  /** Relative target area weight (≈ m²). Layout is proportional to this. */
  weight: number;
  idealDir?: Facing;
}

/**
 * A cluster is a set of rooms that must be placed adjacent to one another.
 * A bedroom and its attached bathroom form one cluster, guaranteeing the
 * ensuite shares a wall with its bedroom. Most rooms are singleton clusters.
 */
export interface Cluster {
  zone: Zone;
  weight: number;
  rooms: RoomSpec[];
}

const ZONE_OF: Record<RoomType, Zone> = {
  living: "public",
  dining: "public",
  foyer: "public",
  kitchen: "service",
  store: "service",
  utility: "service",
  bathroom: "service",
  toilet: "service",
  parking: "service",
  stair: "circulation",
  corridor: "circulation",
  bedroom: "private",
  master_bedroom: "private",
  pooja: "private",
  office: "private",
  balcony: "outdoor",
  garden: "outdoor",
  pool: "outdoor",
};

function luxuryScale(req: Requirements) {
  return 0.82 + req.luxury * 0.1; // 0.92 .. 1.32
}

function getRoomTargetArea(type: RoomType, s: number): number {
  switch (type) {
    case "foyer": return 5.0 * s;
    case "living": return 22.0 * s;
    case "dining": return 14.0 * s;
    case "kitchen": return 11.0 * s;
    case "toilet": return 3.0;
    case "pooja": return 3.5 * s;
    case "office": return 12.0 * s;
    case "stair": return 7.0;
    case "corridor": return 5.0;
    case "store": return 4.0;
    case "utility": return 4.5 * s;
    case "master_bedroom": return 18.0 * s;
    case "bedroom": return 13.0 * s;
    case "bathroom": return 4.5 * s;
    case "parking": return 15.0;
    case "balcony": return 6.0 * s;
    case "garden": return 20.0 * s;
    case "pool": return 25.0 * s;
    default: return 10.0 * s;
  }
}

function spec(type: RoomType, label: string, weight: number): RoomSpec {
  return { type, label, zone: ZONE_OF[type], weight, idealDir: IDEAL_DIRECTION[type] };
}

function single(s: RoomSpec): Cluster {
  return { zone: s.zone, weight: s.weight, rooms: [s] };
}

function attached(bed: RoomSpec, bath: RoomSpec): Cluster {
  return { zone: bed.zone, weight: bed.weight + bath.weight, rooms: [bed, bath] };
}

function bedroomsPerFloor(total: number, floors: number): number[] {
  if (floors <= 1) return [total];
  const out = new Array(floors).fill(0);
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

function bathroomsPerFloor(total: number, floors: number, bedsPerFloor: number[]): number[] {
  if (floors <= 1) return [total];
  const out = new Array(floors).fill(0);
  let remaining = total;
  for (let f = 0; f < floors; f++) {
    if (bedsPerFloor[f] > 0 && remaining > 0) {
      out[f] = 1;
      remaining -= 1;
    }
  }
  const totalBeds = bedsPerFloor.reduce((a, b) => a + b, 0) || 1;
  for (let f = 0; f < floors; f++) {
    if (remaining <= 0) break;
    const share = Math.round((remaining * bedsPerFloor[f]) / totalBeds);
    const add = Math.min(share, remaining);
    out[f] += add;
    remaining -= add;
  }
  let f = 1;
  while (remaining > 0) {
    out[f] += 1;
    remaining -= 1;
    f = f + 1 >= floors ? 0 : f + 1;
  }
  return out;
}

function balconiesPerFloor(total: number, floors: number): number[] {
  if (floors <= 1) return [total];
  const out = new Array(floors).fill(0);
  let remaining = total;
  let f = 1;
  while (remaining > 0) {
    out[f] += 1;
    remaining -= 1;
    f = f + 1 >= floors ? 1 : f + 1;
  }
  return out;
}

export function buildFloorClusters(
  req: Requirements,
  floorIndex: number,
  footprintArea: number
): Cluster[] {
  const s = luxuryScale(req);
  const isGround = floorIndex === 0;

  const bpf = bedroomsPerFloor(req.bedrooms, req.floors);
  const floorBedrooms = bpf[floorIndex] ?? 0;

  const bathPf = bathroomsPerFloor(req.bathrooms, req.floors, bpf);
  const floorBathrooms = bathPf[floorIndex] ?? 0;

  const balPf = balconiesPerFloor(req.balconies, req.floors);
  const floorBalconies = balPf[floorIndex] ?? 0;

  const floorRooms: RoomSpec[] = [];

  if (isGround) {
    floorRooms.push(spec("foyer", "Foyer", getRoomTargetArea("foyer", s)));
    floorRooms.push(spec("living", "Living Room", getRoomTargetArea("living", s)));
    floorRooms.push(spec("dining", "Dining", getRoomTargetArea("dining", s)));
    floorRooms.push(spec("kitchen", "Kitchen", getRoomTargetArea("kitchen", s)));
    floorRooms.push(spec("toilet", "Powder Room", getRoomTargetArea("toilet", s)));

    if (req.vastu) {
      floorRooms.push(spec("pooja", "Pooja", getRoomTargetArea("pooja", s)));
    }
    if (req.homeOffice && req.floors === 1) {
      floorRooms.push(spec("office", "Home Office", getRoomTargetArea("office", s)));
    }
    if (req.floors > 1) {
      floorRooms.push(spec("stair", "Staircase", getRoomTargetArea("stair", s)));
    }
    if (req.floors > 2) {
      floorRooms.push(spec("corridor", "Lift Lobby", getRoomTargetArea("corridor", s)));
    }
    for (let p = 0; p < req.parking; p++) {
      floorRooms.push(spec("parking", `Parking ${p + 1}`, getRoomTargetArea("parking", s)));
    }
    if (req.garden) {
      floorRooms.push(spec("garden", "Garden", getRoomTargetArea("garden", s)));
    }
    if (req.pool) {
      floorRooms.push(spec("pool", "Swimming Pool", getRoomTargetArea("pool", s)));
    }
  } else {
    floorRooms.push(spec("stair", "Staircase", getRoomTargetArea("stair", s)));
    floorRooms.push(spec("living", "Family Lounge", getRoomTargetArea("living", s) * 0.7));
    if (req.homeOffice && floorIndex === 1) {
      floorRooms.push(spec("office", "Home Office", getRoomTargetArea("office", s)));
    }
    if (req.floors > 2 && floorIndex < req.floors - 1) {
      floorRooms.push(spec("corridor", "Lift Lobby", getRoomTargetArea("corridor", s)));
    }
  }

  let bathsLeft = floorBathrooms;
  const masterFloor = req.floors > 1 ? 1 : 0;

  const floorBedSpecs: { bed: RoomSpec; bath?: RoomSpec }[] = [];
  for (let b = 0; b < floorBedrooms; b++) {
    const isMaster = floorIndex === masterFloor && b === 0 && req.bedrooms > 1;
    const bed = isMaster
      ? spec("master_bedroom", "Master Bedroom", getRoomTargetArea("master_bedroom", s))
      : spec("bedroom", `Bedroom ${b + 1}`, getRoomTargetArea("bedroom", s));
    
    if (bathsLeft > 0) {
      bathsLeft -= 1;
      const bath = spec("bathroom", isMaster ? "Master Bath" : `Bathroom ${b + 1}`, getRoomTargetArea("bathroom", s));
      floorBedSpecs.push({ bed, bath });
    } else {
      floorBedSpecs.push({ bed });
    }
  }

  const commonBaths: RoomSpec[] = [];
  for (let i = 0; i < bathsLeft; i++) {
    commonBaths.push(spec("bathroom", `Common Bath ${i + 1}`, getRoomTargetArea("bathroom", s)));
  }

  const balconies: RoomSpec[] = [];
  for (let i = 0; i < floorBalconies; i++) {
    balconies.push(spec("balcony", `Balcony ${i + 1}`, getRoomTargetArea("balcony", s)));
  }

  const serviceSpace = spec(
    isGround ? "store" : "utility",
    isGround ? "Store" : "Utility",
    getRoomTargetArea(isGround ? "store" : "utility", s)
  );

  const allCoreRooms = [
    ...floorRooms,
    ...floorBedSpecs.flatMap(pair => pair.bath ? [pair.bed, pair.bath] : [pair.bed]),
    ...commonBaths,
    ...balconies,
    serviceSpace
  ];

  const totalTargetArea = allCoreRooms.reduce((sum, r) => sum + r.weight, 0);
  const excess = footprintArea - totalTargetArea;
  if (excess > 0) {
    const outdoor = allCoreRooms.filter(r => r.zone === "outdoor");
    if (outdoor.length > 0) {
      const share = excess / outdoor.length;
      for (const r of outdoor) {
        r.weight += share;
      }
    } else {
      if (isGround) {
        allCoreRooms.push(spec("garden", "Open Yard", excess));
      } else {
        allCoreRooms.push(spec("balcony", "Open Terrace", excess));
      }
    }
  }

  const clusters: Cluster[] = [];
  
  for (const r of floorRooms) {
    clusters.push(single(r));
  }
  for (const pair of floorBedSpecs) {
    if (pair.bath) {
      clusters.push(attached(pair.bed, pair.bath));
    } else {
      clusters.push(single(pair.bed));
    }
  }
  for (const r of commonBaths) {
    clusters.push(single(r));
  }
  for (const r of balconies) {
    clusters.push(single(r));
  }
  clusters.push(single(serviceSpace));

  return clusters;
}
