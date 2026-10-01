import type { FloorPlan } from "./types";

const M_TO_FT = 3.28084;
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface FlatRoom {
  name: string;
  type: string;
  width: number;
  height: number;
  x: number;
  y: number;
  area: number;
}

export interface FlatWall {
  x1: number; y1: number; x2: number; y2: number;
  type: "exterior" | "interior";
  thickness: number;
}

export interface FlatOpening {
  x: number; y: number;
  width: number;
  orientation: "h" | "v";
  roomId: string;
}

export interface FloorPlanJSON {
  unit: "ft";
  floor: string;
  rooms: FlatRoom[];
  doors: FlatOpening[];
  windows: FlatOpening[];
  walls: FlatWall[];
}

/**
 * Serialise a generated floor to the flat interchange structure
 * { rooms, doors, windows, walls } with all geometry in feet.
 */
export function toFloorPlanJSON(floor: FloorPlan): FloorPlanJSON {
  return {
    unit: "ft",
    floor: floor.name,
    rooms: floor.rooms.map((r) => ({
      name: r.label,
      type: r.type,
      width: r2(r.w * M_TO_FT),
      height: r2(r.h * M_TO_FT),
      x: r2(r.x * M_TO_FT),
      y: r2(r.y * M_TO_FT),
      area: r2(r.w * r.h * M_TO_FT * M_TO_FT),
    })),
    doors: floor.doors.map((d) => ({
      x: r2(d.x * M_TO_FT), y: r2(d.y * M_TO_FT),
      width: r2(d.width * M_TO_FT), orientation: d.orientation, roomId: d.roomId,
    })),
    windows: floor.windows.map((w) => ({
      x: r2(w.x * M_TO_FT), y: r2(w.y * M_TO_FT),
      width: r2(w.width * M_TO_FT), orientation: w.orientation, roomId: w.roomId,
    })),
    walls: floor.walls.map((w) => ({
      x1: r2(w.x1 * M_TO_FT), y1: r2(w.y1 * M_TO_FT),
      x2: r2(w.x2 * M_TO_FT), y2: r2(w.y2 * M_TO_FT),
      type: w.type, thickness: r2(w.thickness * M_TO_FT),
    })),
  };
}
