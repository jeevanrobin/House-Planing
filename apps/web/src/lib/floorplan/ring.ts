/**
 * Courtyard and central-hall homes: rooms in a ring.
 *
 *  - Manduva (Andhra manduva illu / Kerala nalukettu): a front verandah, a
 *    hall at the front, and rooms on all four sides of an open courtyard,
 *    each opening onto the verandah that runs round it.
 *  - Cottage: the same ring of rooms around a central dining hall, with
 *    verandahs on the front and both sides.
 *
 * Plot-local frame (road at y = 0). Rooms are placed greedily where Vastu
 * wants them — the ring's corners and sides each face a compass direction —
 * then each side's length is shared among the rooms on it.
 */
import type { Placed } from "./layout";
import type { RingProgram, RoomSpec } from "./program";
import { vastuRoomScore } from "./vastu";
import type { Facing, Rect } from "./types";

export type RingKind = "manduva" | "cottage";

interface Unit {
  rooms: RoomSpec[];
  ideal?: Facing;
}

type ListName = "back" | "left" | "right";
type Corner = "FL" | "FR";

interface Lists {
  start: Record<ListName, Unit | null>;
  end: Record<ListName, Unit | null>;
  mid: Record<ListName, Unit[]>;
  corner: Record<Corner, Unit | null>;
}

export interface RingLayout {
  placed: Placed[];
  /** House outline (plot-local), verandahs included. */
  house: Rect;
}

const GROWS = new Set(["bedroom", "master_bedroom", "dining", "kitchen", "living", "office"]);
const minLen = (u: Unit) => u.rooms.reduce((a, r) => a + r.minW, 0);

/**
 * @param area     buildable rectangle (plot-local)
 * @param compass  compass direction of a plot-local point, relative to the house rectangle
 */
export function layoutRing(kind: RingKind, prog: RingProgram, area: Rect, compass: (x: number, y: number, house: Rect) => Facing, frontYard = 0): RingLayout | null {
  const manduva = kind === "manduva";
  // Section depths (m): front verandah, front row, back row, side rooms, inner verandah.
  const fv = manduva ? 1.8 : 2.1;
  const tf = 3.6;
  const tb = 3.3;
  let ts = 3.3;
  let v = manduva ? 1.5 : 0;
  let sv = 0; // cottage side verandahs

  // Width: rooms on both sides of the open centre (courtyard + verandahs, or the dining hall).
  const centreMin = manduva ? 2.4 : 3.6;
  const centreMax = manduva ? 6.0 : 6.0;
  let W: number;
  if (manduva) {
    W = Math.min(area.w, 2 * ts + 2 * v + centreMax);
    if (W - 2 * ts - 2 * v < centreMin) v = Math.max(1.05, (W - 2 * ts - centreMin) / 2);
    if (W - 2 * ts - 2 * v < centreMin) ts = Math.max(3.0, (W - 2 * v - centreMin) / 2);
    if (W - 2 * ts - 2 * v < 2.1) return null;
  } else {
    sv = Math.max(0, Math.min(1.5, (area.w - 2 * ts - centreMin) / 2));
    if (sv < 0.9) sv = 0;
    W = Math.min(area.w, 2 * sv + 2 * ts + centreMax);
    if (W - 2 * sv - 2 * ts < centreMin - 0.3) ts = Math.max(3.0, (W - 2 * sv - centreMin) / 2);
    if (W - 2 * sv - 2 * ts < 3.0) return null;
  }
  const x0 = sv;
  const x1 = W - sv;

  // Depth: enough side length for the rooms that don't fit across the back.
  const units: Unit[] = [
    ...prog.singles.map((r) => ({ rooms: [r], ideal: r.idealDir })),
    ...prog.pairs.map(([bed, bath]) => ({ rooms: [bed, bath], ideal: bed.idealDir })),
  ];
  const fixedD = fv + tf + tb + 2 * v;
  const along = (u: Unit, thick: number) => u.rooms.reduce((a, r) => a + Math.max(r.minW, r.area / thick), 0);
  const needAlong = units.reduce((a, u) => a + along(u, ts), 0);
  // Two front corners take two units; the back row takes its width; the sides share the rest.
  const minL = manduva ? 2.4 : 3.0;
  const needL = Math.max(minL, (needAlong - (x1 - x0) - 2 * ts) / 2);
  // Greedy placement never packs perfectly, so give the sides slack (a longer courtyard is no loss).
  const wantD = fixedD + Math.min(Math.max(minL, needL * 1.4 + 1.5), manduva ? 9 : 10);
  // A front yard for the car comes first, as long as the rooms still fit behind it.
  const yard = frontYard > 0 && area.h - frontYard >= fixedD + needL ? frontYard : 0;
  const D = Math.min(area.h - yard, wantD);
  const L = D - fixedD;
  if (L < (manduva ? 2.1 : 3.0)) return null;

  const hx = area.x + (area.w - W) / 2;
  const hy = area.y + yard;
  const house: Rect = { x: hx, y: hy, w: W, h: D };
  const yA = fv + tf + v;
  const yB = D - tb - v;

  // Representative points (house-local) for each position, to read its compass direction.
  const pt: Record<string, [number, number]> = {
    FL: [x0 + ts / 2, fv + tf / 2], FR: [x1 - ts / 2, fv + tf / 2],
    "back:start": [x0 + 1.6, D - tb / 2], "back:end": [x1 - 1.6, D - tb / 2], "back:mid": [W / 2, D - tb / 2],
    "left:start": [x0 + ts / 2, yA + 1.6], "left:end": [x0 + ts / 2, yB - 1.6], "left:mid": [x0 + ts / 2, (yA + yB) / 2],
    "right:start": [x1 - ts / 2, yA + 1.6], "right:end": [x1 - ts / 2, yB - 1.6], "right:mid": [x1 - ts / 2, (yA + yB) / 2],
  };
  const dir = (key: string) => compass(hx + pt[key][0], hy + pt[key][1], house);
  const capacity: Record<ListName, number> = { back: x1 - x0, left: L, right: L };

  const lists: Lists = {
    start: { back: null, left: null, right: null },
    end: { back: null, left: null, right: null },
    mid: { back: [], left: [], right: [] },
    corner: { FL: null, FR: null },
  };
  const used = (l: ListName) => [lists.start[l], lists.end[l], ...lists.mid[l]].filter((u): u is Unit => !!u).reduce((a, u) => a + minLen(u), 0);

  // Vastu-critical rooms first, then bedrooms, then the rest.
  const rank = (u: Unit) => {
    const t = u.rooms[0].type;
    return ["pooja", "kitchen", "master_bedroom", "dining", "bedroom", "store", "bathroom"].indexOf(t);
  };
  for (const u of [...units].sort((a, b) => rank(a) - rank(b))) {
    const opts: { key: string; score: number; put: () => void }[] = [];
    const single = u.rooms.length === 1 && u.rooms[0].type !== "bathroom";
    for (const c of ["FL", "FR"] as Corner[]) {
      if (single && !lists.corner[c] && u.rooms[0].minD <= tf) opts.push({ key: c, score: 0, put: () => { lists.corner[c] = u; } });
    }
    for (const l of ["back", "left", "right"] as ListName[]) {
      if (used(l) + minLen(u) > capacity[l] + 1e-6) continue;
      if (!lists.start[l]) opts.push({ key: `${l}:start`, score: 0, put: () => { lists.start[l] = u; } });
      if (!lists.end[l]) opts.push({ key: `${l}:end`, score: 0, put: () => { lists.end[l] = u; } });
      opts.push({ key: `${l}:mid`, score: -0.01, put: () => { lists.mid[l].push(u); } });
    }
    if (!opts.length) {
      // Over capacity everywhere: the roomiest side takes it (validation flags any squeeze).
      const l = (["back", "left", "right"] as ListName[]).sort((a, b) => (capacity[b] - used(b)) - (capacity[a] - used(a)))[0];
      lists.mid[l].push(u);
      continue;
    }
    for (const o of opts) {
      // Rooms without a Vastu direction keep corners and ends free for those that have one.
      o.score += u.ideal ? vastuRoomScore(dir(o.key), u.ideal) : o.key.endsWith(":mid") ? 0.6 : 0.5;
      // Spread rooms round the ring rather than piling them on one side.
      const l = o.key.split(":")[0] as ListName;
      if (l in capacity) o.score += 0.2 * ((capacity[l] - used(l)) / capacity[l]);
    }
    opts.sort((a, b) => b.score - a.score)[0].put();
  }

  // Every side of the ring needs at least one room; empty front corners become a study.
  for (const l of ["back", "left", "right"] as ListName[]) {
    if (lists.start[l] || lists.end[l] || lists.mid[l].length) continue;
    // Borrow a room from a busier side only if it fits this one; otherwise a study fills it below.
    const donor = (["back", "left", "right"] as ListName[]).find((d) => lists.mid[d].some((u) => minLen(u) <= capacity[l] + 1e-6));
    if (donor) {
      const i = lists.mid[donor].findIndex((u) => minLen(u) <= capacity[l] + 1e-6);
      lists.mid[l].push(...lists.mid[donor].splice(i, 1));
    }
  }
  let fill = 0;
  const filler = (): Unit => ({
    rooms: [{
      key: `ring-fill-${fill++}`, type: "office", label: "Study", zone: "private", area: ts * tf, minW: 1.5, minD: 1.5,
    }],
  });
  for (const c of ["FL", "FR"] as Corner[]) if (!lists.corner[c]) lists.corner[c] = filler();
  for (const l of ["back", "left", "right"] as ListName[]) {
    if (!lists.start[l] && !lists.end[l] && !lists.mid[l].length) lists.mid[l].push(filler());
  }
  // A side with lots of length to spare gets a study rather than one stretched room.
  const thickOf = (l: ListName) => (l === "back" ? tb : ts);
  for (const l of ["back", "left", "right"] as ListName[]) {
    const all = [lists.start[l], lists.end[l], ...lists.mid[l]].filter((u): u is Unit => !!u);
    const spare = capacity[l] - all.reduce((a, u) => a + along(u, thickOf(l)), 0);
    if (spare > 4.2) {
      lists.mid[l].push({
        rooms: [{ key: `ring-study-${l}`, type: "office", label: "Study", zone: "private", area: 3.0 * thickOf(l), minW: 2.4, minD: 2.4 }],
      });
    }
  }

  const placed: Placed[] = [];
  const add = (spec: RoomSpec, x: number, y: number, w: number, h: number) => placed.push({ spec, x: hx + x, y: hy + y, w, h });

  // Lay a side out along its length: baths sit towards the middle, beside their bedroom.
  const sequence = (l: ListName): RoomSpec[] => [
    ...(lists.start[l]?.rooms ?? []),
    ...lists.mid[l].flatMap((u) => u.rooms),
    ...(lists.end[l] ? [...lists.end[l]!.rooms].reverse() : []),
  ];
  const lengths = (rooms: RoomSpec[], thick: number, total: number) => {
    const target = rooms.map((r) => Math.max(r.minW, r.area / thick));
    const sum = target.reduce((a, b) => a + b, 0);
    if (sum <= total) {
      const grow = rooms.map((r, i) => (GROWS.has(r.type) ? target[i] : 0));
      const gs = grow.reduce((a, b) => a + b, 0);
      return target.map((t, i) => t + (total - sum) * (gs > 0 ? grow[i] / gs : 1 / rooms.length));
    }
    return target.map((t) => (t * total) / sum);
  };
  const back = sequence("back");
  let x = x0;
  lengths(back, tb, x1 - x0).forEach((len, i) => { add(back[i], x, D - tb, len, tb); x += len; });
  for (const l of ["left", "right"] as ListName[]) {
    const seq = sequence(l);
    let y = yA;
    const lx = l === "left" ? x0 : x1 - ts;
    lengths(seq, ts, yB - yA).forEach((len, i) => { add(seq[i], lx, y, ts, len); y += len; });
  }

  // Front row: corners and the hall / living room between them.
  add(lists.corner.FL!.rooms[0], x0, fv, ts, tf);
  add(prog.living, x0 + ts, fv, x1 - x0 - 2 * ts, tf);
  add(lists.corner.FR!.rooms[0], x1 - ts, fv, ts, tf);

  const open = (key: string, type: RoomSpec["type"], label: string, zone: RoomSpec["zone"]): RoomSpec =>
    ({ key, type, label, zone, area: 0, minW: 0.9, minD: 0.9 });
  add(open("ring-front", "sitout", "Verandah", "outdoor"), 0, 0, W, fv);
  if (manduva) {
    const ver = (k: string) => open(`ring-ver-${k}`, "corridor", "Verandah", "circulation");
    add(ver("top"), 0, fv + tf, W, v);
    add(ver("bottom"), 0, D - tb - v, W, v);
    add(ver("left"), ts, yA, v, yB - yA);
    add(ver("right"), W - ts - v, yA, v, yB - yA);
    add(open("ring-court", "terrace", "Manduva (open courtyard)", "outdoor"), ts + v, yA, W - 2 * ts - 2 * v, yB - yA);
  } else {
    add(prog.core!, x0 + ts, fv + tf, x1 - x0 - 2 * ts, D - tb - fv - tf);
    if (sv > 0) {
      add(open("ring-side-l", "sitout", "Verandah", "outdoor"), 0, fv, sv, D - fv);
      add(open("ring-side-r", "sitout", "Verandah", "outdoor"), W - sv, fv, sv, D - fv);
    }
  }
  return { placed, house };
}
