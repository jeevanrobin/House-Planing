import type { Facing, Rect, RoomType } from "./types";

const OCTANTS: Facing[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** Ideal Vastu direction per room type (best-practice heuristics). */
export const IDEAL_DIRECTION: Partial<Record<RoomType, Facing>> = {
  pooja: "NE",
  kitchen: "SE",
  master_bedroom: "SW",
  bedroom: "W",
  living: "N",
  dining: "W",
  bathroom: "NW",
  toilet: "NW",
  stair: "SW",
  store: "SW",
  office: "W",
  parking: "NW",
};

/** 8-way compass direction of a point relative to the footprint centre. */
export function directionOf(cx: number, cy: number, fp: Rect): Facing {
  const dx = cx - (fp.x + fp.w / 2);
  // screen y grows south, so invert for a true compass bearing
  const dy = (fp.y + fp.h / 2) - cy;
  const angle = (Math.atan2(dx, dy) * 180) / Math.PI; // 0 = North, 90 = East
  const norm = (angle + 360) % 360;
  const idx = Math.round(norm / 45) % 8;
  return OCTANTS[idx];
}

/** Octant distance 0..4 between two directions. */
function octantDistance(a: Facing, b: Facing): number {
  const ia = OCTANTS.indexOf(a);
  const ib = OCTANTS.indexOf(b);
  if (ia < 0 || ib < 0) return 2;
  const d = Math.abs(ia - ib);
  return Math.min(d, 8 - d);
}

/** Score 0..1 for how well an actual direction matches the ideal. */
export function vastuRoomScore(actual: Facing, ideal: Facing): number {
  const d = octantDistance(actual, ideal);
  return Math.max(0, 1 - d / 3);
}
