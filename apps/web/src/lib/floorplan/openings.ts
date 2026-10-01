/**
 * Doors and windows from room adjacency.
 *
 * Every room gets a door onto the room it is accessed from (bedrooms from
 * the passage, ensuites from their bedroom, kitchen from dining, …). Windows
 * go on exterior walls of habitable and wet rooms.
 */
import type { Door, Rect, Room, RoomType, WindowMark } from "./types";
import { exteriorEdges } from "./walls";

const EPS = 0.02;

/** Rooms each type is entered from, in order of preference. */
const ACCESS: Partial<Record<RoomType, RoomType[]>> = {
  living: ["sitout", "foyer", "parking"],
  dining: ["living", "lounge"],
  kitchen: ["dining", "living"],
  utility: ["kitchen", "dining"],
  store: ["kitchen", "dining", "corridor", "living", "lounge"],
  toilet: ["dining", "living", "corridor", "lounge"],
  pooja: ["living", "dining", "lounge", "corridor"],
  office: ["corridor", "living", "lounge", "dining"],
  stair: ["dining", "living", "corridor", "lounge"],
  corridor: ["dining", "living", "lounge", "stair"],
  lounge: ["stair", "corridor"],
  bedroom: ["corridor", "lounge", "living", "dining", "stair"],
  master_bedroom: ["corridor", "lounge", "living", "dining", "stair"],
  bathroom: ["corridor", "lounge", "dining", "living", "stair"],
  terrace: ["lounge", "corridor", "stair", "bedroom", "master_bedroom", "dining", "living"],
};

/** Open-plan connections get a doorless opening instead of a leaf. */
const OPEN_PAIRS = new Set(["dining:living", "dining:lounge", "corridor:dining", "corridor:living", "corridor:lounge",
  "corridor:corridor", "stair:dining", "stair:living", "stair:corridor", "lounge:stair", "corridor:stair"]);

const WET: RoomType[] = ["bathroom", "toilet", "utility"];

/** Never put a door between a toilet/bath and a kitchen or pooja room. */
function forbidden(a: RoomType, b: RoomType): boolean {
  const wet = (t: RoomType) => t === "bathroom" || t === "toilet";
  const clean = (t: RoomType) => t === "kitchen" || t === "pooja";
  return (wet(a) && clean(b)) || (wet(b) && clean(a));
}
const OUTDOOR: RoomType[] = ["sitout", "balcony", "terrace", "garden", "pool", "parking"];
const WINDOWED: RoomType[] = [
  "living", "dining", "kitchen", "bedroom", "master_bedroom", "office", "lounge", "pooja", "stair",
  "bathroom", "toilet", "utility",
];

interface Shared {
  orientation: "h" | "v";
  at: number;
  lo: number;
  hi: number;
}

/** Wall segment two rectangles share, if any. */
export function sharedWall(a: Rect, b: Rect): Shared | null {
  const ov = (a0: number, a1: number, b0: number, b1: number) => [Math.max(a0, b0), Math.min(a1, b1)] as const;
  if (Math.abs(a.x + a.w - b.x) < EPS || Math.abs(b.x + b.w - a.x) < EPS) {
    const [lo, hi] = ov(a.y, a.y + a.h, b.y, b.y + b.h);
    if (hi - lo > EPS) return { orientation: "v", at: Math.abs(a.x + a.w - b.x) < EPS ? b.x : a.x, lo, hi };
  }
  if (Math.abs(a.y + a.h - b.y) < EPS || Math.abs(b.y + b.h - a.y) < EPS) {
    const [lo, hi] = ov(a.x, a.x + a.w, b.x, b.x + b.w);
    if (hi - lo > EPS) return { orientation: "h", at: Math.abs(a.y + a.h - b.y) < EPS ? b.y : a.y, lo, hi };
  }
  return null;
}

function makeDoor(room: Room, other: Room, s: Shared, kind: Door["kind"], width: number, atStart = true): Door | null {
  const len = s.hi - s.lo;
  if (len < 0.65) return null;
  const w = Math.min(width, len - 0.15);
  const pos = kind === "door" ? (atStart ? s.lo + 0.12 : s.hi - 0.12 - w) : s.lo + (len - w) / 2;
  // Swing into `room` (the room being entered).
  const roomSide = s.orientation === "v" ? (room.x + room.w / 2 > s.at ? 1 : -1) : (room.y + room.h / 2 > s.at ? 1 : -1);
  return {
    roomId: room.id,
    orientation: s.orientation,
    width: w,
    kind,
    swing: roomSide as 1 | -1,
    exterior: kind === "main",
    x: s.orientation === "v" ? s.at : pos,
    y: s.orientation === "v" ? pos : s.at,
  };
}

function doorWidth(type: RoomType, kind: Door["kind"], len: number): number {
  if (kind === "main") return 1.1;
  if (kind === "opening") return Math.max(1.0, Math.min(2.4, len * 0.6));
  return WET.includes(type) || type === "dress" || type === "store" ? 0.75 : 0.9;
}

/** Which side of a room faces the road, in the drawing frame. */
const ROAD_SIDE = { N: "top", S: "bottom", W: "left", E: "right" } as const;

function edgeAsShared(r: Rect, side: "top" | "bottom" | "left" | "right", iv: { a: number; b: number }): Shared {
  switch (side) {
    case "top": return { orientation: "h", at: r.y, lo: iv.a, hi: iv.b };
    case "bottom": return { orientation: "h", at: r.y + r.h, lo: iv.a, hi: iv.b };
    case "left": return { orientation: "v", at: r.x, lo: iv.a, hi: iv.b };
    case "right": return { orientation: "v", at: r.x + r.w, lo: iv.a, hi: iv.b };
  }
}

export function placeOpenings(rooms: Room[], _fp: Rect, road: "N" | "E" | "S" | "W" = "N"): { doors: Door[]; windows: WindowMark[] } {
  const doors: Door[] = [];
  const windows: WindowMark[] = [];
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const neighbours = (r: Room) =>
    rooms.filter((o) => o.id !== r.id).map((o) => ({ o, s: sharedWall(r, o) })).filter((n): n is { o: Room; s: Shared } => !!n.s);
  const linked = new Set<string>();
  const link = (a: Room, b: Room) => linked.add([a.id, b.id].sort().join("|"));
  const isLinked = (a: Room, b: Room) => linked.has([a.id, b.id].sort().join("|"));

  for (const r of rooms) {
    if (OUTDOOR.includes(r.type) && r.type !== "terrace") continue;
    const ns = neighbours(r);

    // Ensuite bath / dressing room: through the bedroom (or the sibling next to it).
    if (r.parentId) {
      const parent = byId.get(r.parentId);
      const direct = parent ? ns.find((n) => n.o.id === parent.id) : undefined;
      const sibling = ns.find((n) => n.o.parentId === r.parentId && n.o.type !== r.type);
      const via = direct ?? sibling;
      if (via && !isLinked(r, via.o)) {
        const d = makeDoor(r, via.o, via.s, "door", doorWidth(r.type, "door", 0), false);
        if (d) { doors.push(d); link(r, via.o); }
      }
      continue;
    }

    if (r.type === "living") {
      const sit = ns.find((n) => n.o.type === "sitout" && n.s.hi - n.s.lo >= 1.3)
        ?? ns.find((n) => n.o.type === "parking" && n.s.hi - n.s.lo >= 1.3);
      if (sit) {
        const d = makeDoor(r, sit.o, sit.s, "main", 1.1);
        if (d) { doors.push(d); link(r, sit.o); }
      } else {
        // No sit-out: main door on an outside wall facing the road
        // (any outside wall as a fallback, e.g. on a stepped facade).
        const facing = ROAD_SIDE[road];
        const ext = exteriorEdges(r, rooms).sort((a, b) =>
          Number(b.side === facing) - Number(a.side === facing) || (b.iv.b - b.iv.a) - (a.iv.b - a.iv.a));
        for (const e of ext) {
          const d = makeDoor(r, r, edgeAsShared(r, e.side, e.iv), "main", 1.1);
          if (d) { doors.push(d); break; }
        }
      }
    }

    // Corridors connect to every adjacent corridor (passages) with an opening.
    if (r.type === "corridor") {
      for (const n of ns) {
        if (n.o.type === "corridor" && !isLinked(r, n.o)) {
          const d = makeDoor(r, n.o, n.s, "opening", Math.min(1.2, n.s.hi - n.s.lo));
          if (d) { doors.push(d); link(r, n.o); }
        }
      }
    }

    const prefs = ACCESS[r.type] ?? [];
    let connected = r.type === "living" ? false : ns.some((n) => isLinked(r, n.o) && prefs.includes(n.o.type));
    for (const t of prefs) {
      if (connected) break;
      const cands = ns.filter((n) => n.o.type === t && n.s.hi - n.s.lo >= 0.8).sort((a, b) => (b.s.hi - b.s.lo) - (a.s.hi - a.s.lo));
      for (const n of cands) {
        if (isLinked(r, n.o)) { connected = true; break; }
        const kind: Door["kind"] = OPEN_PAIRS.has([r.type, n.o.type].sort().join(":")) ? "opening" : "door";
        const d = makeDoor(r, n.o, n.s, kind, doorWidth(r.type, kind, n.s.hi - n.s.lo));
        if (d) { doors.push(d); link(r, n.o); connected = true; break; }
      }
    }
    if (r.type === "living") continue;
    // Last resort so no room is sealed off: the longest wall to any indoor room.
    if (!connected && !ns.some((n) => isLinked(r, n.o))) {
      const n = ns.filter((x) => !OUTDOOR.includes(x.o.type) && !x.o.parentId && !forbidden(r.type, x.o.type))
        .sort((a, b) => (b.s.hi - b.s.lo) - (a.s.hi - a.s.lo))[0];
      if (n) {
        const d = makeDoor(r, n.o, n.s, "door", doorWidth(r.type, "door", 0));
        if (d) { doors.push(d); link(r, n.o); }
      }
    }
  }

  // Connectivity repair: walk from the entrance (or stair) through doors; any
  // room not reached gets an opening onto a reached neighbour, preferring
  // circulation and living spaces over pass-through rooms.
  const PASS = ["corridor", "living", "dining", "lounge", "foyer", "stair", "sitout", "kitchen", "office", "terrace", "parking"];
  const entry = rooms.filter((r) => ["sitout", "parking"].includes(r.type) || (r.type === "living" && doors.some((d) => d.kind === "main" && d.roomId === r.id)));
  const starts = entry.length ? entry : rooms.filter((r) => r.type === "stair");
  for (let guard = 0; guard < rooms.length; guard++) {
    const reached = new Set(starts.map((r) => r.id));
    const queue = [...reached];
    while (queue.length) {
      const id = queue.pop()!;
      for (const o of rooms) {
        if (!reached.has(o.id) && linked.has([id, o.id].sort().join("|"))) { reached.add(o.id); queue.push(o.id); }
      }
    }
    let fixed = false;
    for (const r of rooms) {
      if (reached.has(r.id) || r.type === "balcony" || (OUTDOOR.includes(r.type) && r.type !== "terrace")) continue;
      const via = neighbours(r)
        .filter((n) => reached.has(n.o.id) && PASS.includes(n.o.type) && !forbidden(r.type, n.o.type) && n.s.hi - n.s.lo >= 0.8)
        .sort((a, b) => PASS.indexOf(a.o.type) - PASS.indexOf(b.o.type) || (b.s.hi - b.s.lo) - (a.s.hi - a.s.lo))[0];
      if (!via) continue;
      const kind: Door["kind"] = OPEN_PAIRS.has([r.type, via.o.type].sort().join(":")) ? "opening" : "door";
      const d = makeDoor(r, via.o, via.s, kind, doorWidth(r.type, kind, via.s.hi - via.s.lo));
      if (d) { doors.push(d); link(r, via.o); fixed = true; break; }
    }
    if (!fixed) break;
  }

  // Balconies: a door from every bedroom / lounge that opens onto them.
  for (const b of rooms.filter((r) => r.type === "balcony")) {
    for (const n of neighbours(b)) {
      if (["bedroom", "master_bedroom", "lounge", "office", "living", "dining", "corridor", "stair", "terrace"].includes(n.o.type) && !isLinked(b, n.o)) {
        const d = makeDoor(n.o, b, n.s, "door", 0.9);
        if (d) { doors.push({ ...d, roomId: b.id }); link(b, n.o); }
      }
    }
  }

  // Windows on outside walls — any stretch with nothing on the other side,
  // so stepped and angled facades get windows too.
  for (const r of rooms) {
    if (!WINDOWED.includes(r.type)) continue;
    const small = WET.includes(r.type);
    const edges: Shared[] = exteriorEdges(r, rooms).map((e) => edgeAsShared(r, e.side, e.iv));
    for (const e of edges) {
      const len = e.hi - e.lo;
      if (len < (small ? 0.9 : 1.4)) continue;
      const w = small ? 0.6 : Math.min(r.type === "stair" ? 1.0 : 1.8, Math.max(0.9, len * 0.5));
      const mid = e.lo + len / 2;
      windows.push({
        roomId: r.id, orientation: e.orientation, width: w,
        x: e.orientation === "v" ? e.at : mid - w / 2,
        y: e.orientation === "v" ? mid - w / 2 : e.at,
      });
      if (small) break; // one ventilator is enough
    }
  }
  return { doors, windows };
}
