/**
 * Domain model for the AI Plot Planner floor-plan engine.
 * All geometry is in metres; the renderer converts to pixels.
 */

/** Closed polygon as an array of [x, y] vertices in local metres. */
export type Polygon = [number, number][];

export type Facing = "N" | "E" | "S" | "W" | "NE" | "NW" | "SE" | "SW";

export type RoomType =
  | "living"
  | "dining"
  | "kitchen"
  | "bedroom"
  | "master_bedroom"
  | "bathroom"
  | "toilet"
  | "pooja"
  | "store"
  | "stair"
  | "corridor"
  | "foyer"
  | "balcony"
  | "parking"
  | "office"
  | "utility"
  | "garden"
  | "pool";

export type Zone = "public" | "service" | "private" | "circulation" | "outdoor";

export interface Requirements {
  // Step 1
  plotWidth: number; // metres (along the road / facing edge)
  plotDepth: number; // metres
  facing: Facing;
  floors: number;

  /** Optional polygon boundary in local metres. When present the engine
   *  uses this as the true plot shape instead of the plotWidth×plotDepth rect. */
  plotPolygon?: Polygon;

  // Step 2
  bedrooms: number;
  bathrooms: number;
  parking: 0 | 1 | 2 | 3;
  balconies: number;

  // Step 3
  vastu: boolean;
  garden: boolean;
  pool: boolean;
  homeOffice: boolean;

  // Step 4
  budget: "economy" | "standard" | "premium" | "luxury";
  style: "modern" | "contemporary" | "traditional" | "minimal";
  luxury: 1 | 2 | 3 | 4 | 5;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Room extends Rect {
  id: string;
  type: RoomType;
  label: string;
  zone: Zone;
  /** Ideal compass direction for this room per Vastu, if any. */
  idealDir?: Facing;
  /** Actual polygon boundary of the room (when engine uses a polygon plot).
   *  x/y/w/h are the axis-aligned bounding box of this polygon. */
  polygon?: Polygon;
}

export interface Door {
  x: number;
  y: number;
  /** Wall orientation the door sits on. */
  orientation: "h" | "v";
  width: number;
  roomId: string;
  exterior?: boolean;
}

export interface WindowMark {
  x: number;
  y: number;
  orientation: "h" | "v";
  width: number;
  roomId: string;
}

export interface Wall {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  orientation: "h" | "v";
  type: "exterior" | "interior";
  thickness: number;
}

export interface PlanMetrics {
  builtUpArea: number; // m²
  carpetArea: number; // m²
  efficiency: number; // carpet / builtUp (0-1)
  perimeter: number;
  vastuScore: number; // 0-100
}

export interface FloorPlan {
  floor: number;
  name: string;
  footprint: Rect;
  /** The actual polygon boundary of the buildable footprint (if polygon mode). */
  footprintPolygon?: Polygon;
  rooms: Room[];
  doors: Door[];
  windows: WindowMark[];
  walls: Wall[];
  metrics: PlanMetrics;
}

export interface PlanResult {
  plotArea: number;
  footprint: Rect;
  /** The original user-drawn plot polygon in local metres (if polygon mode). */
  plotPolygon?: Polygon;
  setback: { front: number; rear: number; side: number };
  floors: FloorPlan[];
  suggestions: Suggestion[];
  validation?: { ok: boolean; errors: string[] };
}

export interface Suggestion {
  kind: "ventilation" | "vastu" | "space" | "cost" | "circulation";
  severity: "info" | "good" | "warn";
  message: string;
}
