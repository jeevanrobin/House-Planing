import { buildFloorClusters, type Cluster, type RoomSpec } from "./program";
import { directionOf, vastuRoomScore } from "./vastu";
import { generateWalls, generatePolygonWalls } from "./walls";
import {
  insetPolygon,
  polygonArea,
  polygonBBox,
  polygonCentroid,
  rectToPolygon,
  subdividePolygon,
  clipPolygon,
  edgeOnBoundary,
  polygonEdges,
  type PolyEdge,
} from "./polygon-ops";
import type {
  Door,
  Facing,
  FloorPlan,
  PlanResult,
  Polygon,
  Rect,
  Room,
  Suggestion,
  WindowMark,
  Requirements,
  Zone,
} from "./types";

const EPS = 0.001;
// Front → back bands. Service + circulation share a band so small rooms
// (stair, store) pack in 2D beside the kitchen instead of spanning the whole
// width as a sliver; service stays adjacent to public (kitchen ↔ dining).
const BAND_GROUPS: Zone[][] = [["public"], ["service", "circulation"], ["private"], ["outdoor"]];

/** Setback margins (m) scale gently with plot size. */
function setbacks(req: Requirements) {
  const base = Math.max(0.9, Math.min(req.plotWidth, req.plotDepth) * 0.08);
  return { front: base * 1.4, rear: base, side: base };
}

/** Cardinal direction used to orient the layout (front band). */
function layoutCardinal(f: Facing): "N" | "S" | "E" | "W" {
  if (f.includes("N")) return "N";
  if (f.includes("S")) return "S";
  return f as "E" | "W";
}

/* ------------------------------------------------------------------ */
/* Squarified slicing of weighted items into a rectangle.              */
/* ------------------------------------------------------------------ */
interface Placed<T> extends Rect {
  item: T;
}

function slice<T extends { weight: number }>(rect: Rect, items: T[]): Placed<T>[] {
  if (items.length === 0) return [];
  if (items.length === 1) return [{ ...rect, item: items[0] }];

  const total = items.reduce((a, b) => a + b.weight, 0);
  let acc = 0;
  let split = 0;
  for (let i = 0; i < items.length; i++) {
    acc += items[i].weight;
    if (acc >= total / 2) {
      split = i + 1;
      break;
    }
  }
  split = Math.min(Math.max(split, 1), items.length - 1);
  const a = items.slice(0, split);
  const b = items.slice(split);
  const frac = a.reduce((x, y) => x + y.weight, 0) / total;

  // Choose the split axis that keeps both children closest to square,
  // which avoids thin slivers when a small room sits beside a large one.
  const aspect = (w: number, h: number) =>
    Math.max(w / Math.max(h, 1e-6), h / Math.max(w, 1e-6));
  const vWorst = Math.max(aspect(rect.w * frac, rect.h), aspect(rect.w * (1 - frac), rect.h));
  const hWorst = Math.max(aspect(rect.w, rect.h * frac), aspect(rect.w, rect.h * (1 - frac)));

  if (vWorst <= hWorst) {
    const wA = rect.w * frac;
    return [
      ...slice({ ...rect, w: wA }, a),
      ...slice({ x: rect.x + wA, y: rect.y, w: rect.w - wA, h: rect.h }, b),
    ];
  }
  const hA = rect.h * frac;
  return [
    ...slice({ ...rect, h: hA }, a),
    ...slice({ x: rect.x, y: rect.y + hA, w: rect.w, h: rect.h - hA }, b),
  ];
}

/**
 * Subdivide a cluster's rectangle into its rooms. A bedroom + attached
 * bathroom splits with the bath taking a corner against an exterior side
 * wall (for plumbing + a window), always sharing an edge with the bedroom.
 */
function layoutCluster(rect: Rect, cluster: Cluster, crossLen: number): Placed<RoomSpec>[] {
  if (cluster.rooms.length === 1) return [{ ...rect, item: cluster.rooms[0] }];

  const [bed, bath] = cluster.rooms;
  const f = Math.max(0.2, Math.min(0.34, bath.weight / cluster.weight));
  const touchesLeft = rect.x < EPS;
  const touchesRight = Math.abs(rect.x + rect.w - crossLen) < EPS;

  let bathRect: Rect;
  let bedRect: Rect;
  if (touchesLeft || touchesRight) {
    const bw = rect.w * f;
    if (touchesRight && !touchesLeft) {
      bathRect = { x: rect.x + rect.w - bw, y: rect.y, w: bw, h: rect.h };
      bedRect = { x: rect.x, y: rect.y, w: rect.w - bw, h: rect.h };
    } else {
      bathRect = { x: rect.x, y: rect.y, w: bw, h: rect.h };
      bedRect = { x: rect.x + bw, y: rect.y, w: rect.w - bw, h: rect.h };
    }
  } else if (rect.w >= rect.h) {
    const bw = rect.w * f;
    bathRect = { x: rect.x + rect.w - bw, y: rect.y, w: bw, h: rect.h };
    bedRect = { x: rect.x, y: rect.y, w: rect.w - bw, h: rect.h };
  } else {
    const bh = rect.h * f;
    bathRect = { x: rect.x, y: rect.y + rect.h - bh, w: rect.w, h: bh };
    bedRect = { x: rect.x, y: rect.y, w: rect.w, h: rect.h - bh };
  }
  return [
    { ...bedRect, item: bed },
    { ...bathRect, item: bath },
  ];
}

/* ------------------------------------------------------------------ */
/* Canonical → actual transform (front band placed on facing side).    */
/* ------------------------------------------------------------------ */
function makeTransform(fp: Rect, card: "N" | "S" | "E" | "W", depthLen: number) {
  return (c: Rect): Rect => {
    switch (card) {
      case "N":
        return { x: fp.x + c.x, y: fp.y + c.y, w: c.w, h: c.h };
      case "S":
        return { x: fp.x + c.x, y: fp.y + (depthLen - (c.y + c.h)), w: c.w, h: c.h };
      case "W":
        return { x: fp.x + c.y, y: fp.y + c.x, w: c.h, h: c.w };
      case "E":
        return { x: fp.x + (depthLen - (c.y + c.h)), y: fp.y + c.x, w: c.h, h: c.w };
    }
  };
}

/* ------------------------------------------------------------------ */
/* Vastu: reassign interchangeable rooms to better-matching cells.      */
/* This optimises the function→cell assignment only; geometry and       */
/* bedroom/bathroom adjacency are untouched.                            */
/* ------------------------------------------------------------------ */
const SWAPPABLE = new Set([
  "kitchen", "dining", "living", "pooja", "store", "utility", "office", "foyer", "toilet",
]);

function roomVastu(r: Room, fp: Rect): number {
  if (!r.idealDir) return 0;
  return vastuRoomScore(directionOf(r.x + r.w / 2, r.y + r.h / 2, fp), r.idealDir);
}

function optimizeVastu(rooms: Room[], fp: Rect) {
  const idx = rooms.map((_, i) => i).filter((i) => SWAPPABLE.has(rooms[i].type));
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 8) {
    improved = false;
    for (const a of idx) {
      for (const b of idx) {
        if (a >= b) continue;
        const ra = rooms[a];
        const rb = rooms[b];
        const areaA = ra.w * ra.h;
        const areaB = rb.w * rb.h;
        if (Math.abs(areaA - areaB) / Math.max(areaA, areaB) > 0.45) continue;
        const before = roomVastu(ra, fp) + roomVastu(rb, fp);
        swapFunction(ra, rb);
        const after = roomVastu(ra, fp) + roomVastu(rb, fp);
        if (after > before + 1e-9) improved = true;
        else swapFunction(ra, rb);
      }
    }
  }
}

function swapFunction(a: Room, b: Room) {
  [a.type, b.type] = [b.type, a.type];
  [a.label, b.label] = [b.label, a.label];
  [a.zone, b.zone] = [b.zone, a.zone];
  [a.idealDir, b.idealDir] = [b.idealDir, a.idealDir];
}

const ROOM_IDEAL_POS: Record<string, [number, number]> = {
  pooja: [1.0, 0.0],          // NE
  kitchen: [1.0, 1.0],        // SE
  master_bedroom: [0.0, 1.0], // SW
  bedroom: [0.0, 0.5],        // W
  living: [0.5, 0.0],         // N
  dining: [0.0, 0.5],         // W
  bathroom: [0.0, 0.0],       // NW
  toilet: [0.0, 0.0],         // NW
  stair: [0.0, 1.0],          // SW
  store: [0.0, 1.0],          // SW
  office: [0.0, 0.5],         // W
  parking: [0.0, 0.0],        // NW
};

function getVastuSortKey(c: Cluster, axis: "x" | "y"): number {
  const primaryType = c.rooms[0]?.type;
  const pos = ROOM_IDEAL_POS[primaryType] ?? [0.5, 0.5];
  return axis === "x" ? pos[0] : pos[1];
}

/* ------------------------------------------------------------------ */
/* Layout one floor.                                                    */
/* ------------------------------------------------------------------ */
function layoutFloor(fp: Rect, clusters: Cluster[], req: Requirements): Room[] {
  const card = layoutCardinal(req.facing);
  const horizontal = card === "E" || card === "W";
  const crossLen = horizontal ? fp.h : fp.w;
  const depthLen = horizontal ? fp.w : fp.h;
  const transform = makeTransform(fp, card, depthLen);

  const byZone = new Map<Zone, Cluster[]>();
  for (const c of clusters) (byZone.get(c.zone) ?? byZone.set(c.zone, []).get(c.zone)!).push(c);

  const bands = BAND_GROUPS
    .map((zs) => zs.flatMap((z) => byZone.get(z) ?? []))
    .filter((g) => g.length > 0);
  const bandWeight = (g: Cluster[]) => g.reduce((a, c) => a + c.weight, 0);
  const totalWeight = bands.reduce((a, g) => a + bandWeight(g), 0) || 1;

  const rooms: Room[] = [];
  let cursor = 0;

  bands.forEach((group, i) => {
    const isLast = i === bands.length - 1;
    const bandDepth = isLast ? depthLen - cursor : (bandWeight(group) / totalWeight) * depthLen;
    const band: Rect = { x: 0, y: cursor, w: crossLen, h: bandDepth };

    // Largest rooms first or Vastu-preferring first → better squarification, fewer slivers.
    const axis = horizontal ? "y" : "x";
    const ordered = [...group].sort((p, q) => {
      if (req.vastu) {
        const vp = getVastuSortKey(p, axis);
        const vq = getVastuSortKey(q, axis);
        if (Math.abs(vp - vq) > 0.01) return vp - vq;
      }
      return q.weight - p.weight;
    });
    for (const placedCluster of slice(band, ordered)) {
      const cRect: Rect = { x: placedCluster.x, y: placedCluster.y, w: placedCluster.w, h: placedCluster.h };
      for (const pr of layoutCluster(cRect, placedCluster.item, crossLen)) {
        const r = transform({ x: pr.x, y: pr.y, w: pr.w, h: pr.h });
        rooms.push({
          ...r,
          id: `${pr.item.type}-${rooms.length}`,
          type: pr.item.type,
          label: pr.item.label,
          zone: pr.item.zone,
          idealDir: pr.item.idealDir,
        });
      }
    }
    cursor += bandDepth;
  });

  if (req.vastu) optimizeVastu(rooms, fp);
  return rooms;
}

/* ------------------------------------------------------------------ */
/* Doors & windows.                                                     */
/* ------------------------------------------------------------------ */
function onBoundary(v: number, edge: number) {
  return Math.abs(v - edge) < 0.05;
}

export function placeOpenings(rooms: Room[], fp: Rect) {
  const doors: Door[] = [];
  const windows: WindowMark[] = [];
  const right = fp.x + fp.w;
  const bottom = fp.y + fp.h;

  for (const room of rooms) {
    if (room.type === "garden") continue;
    const edges = [
      { o: "v" as const, at: room.x, p0: room.y, len: room.h, ext: onBoundary(room.x, fp.x) },
      { o: "v" as const, at: room.x + room.w, p0: room.y, len: room.h, ext: onBoundary(room.x + room.w, right) },
      { o: "h" as const, at: room.y, p0: room.x, len: room.w, ext: onBoundary(room.y, fp.y) },
      { o: "h" as const, at: room.y + room.h, p0: room.x, len: room.w, ext: onBoundary(room.y + room.h, bottom) },
    ];

    const interior = edges.filter((e) => !e.ext && e.len > 1.0);
    const doorEdge = (interior.length ? interior : edges).sort((a, b) => b.len - a.len)[0];
    if (doorEdge) {
      const dw = Math.min(0.95, doorEdge.len * 0.4);
      const mid = doorEdge.p0 + doorEdge.len / 2;
      doors.push({
        roomId: room.id,
        orientation: doorEdge.o,
        width: dw,
        exterior: room.type === "foyer",
        x: doorEdge.o === "v" ? doorEdge.at : mid - dw / 2,
        y: doorEdge.o === "v" ? mid - dw / 2 : doorEdge.at,
      });
    }

    const habitable = !["stair", "store", "utility", "parking", "foyer", "corridor"].includes(room.type);
    if (habitable) {
      for (const e of edges) {
        if (e.ext && e.len > 1.6) {
          const ww = Math.min(1.5, e.len * 0.5);
          const mid = e.p0 + e.len / 2;
          windows.push({
            roomId: room.id,
            orientation: e.o,
            width: ww,
            x: e.o === "v" ? e.at : mid - ww / 2,
            y: e.o === "v" ? mid - ww / 2 : e.at,
          });
        }
      }
    }
  }
  return { doors, windows };
}

/* ------------------------------------------------------------------ */
/* Metrics & Vastu.                                                     */
/* ------------------------------------------------------------------ */
function computeVastu(rooms: Room[], fp: Rect): number {
  const scored = rooms.filter((r) => r.idealDir);
  if (!scored.length) return 100;
  let sum = 0;
  for (const r of scored) {
    const dir = directionOf(r.x + r.w / 2, r.y + r.h / 2, fp);
    sum += vastuRoomScore(dir, r.idealDir!);
  }
  return Math.round((sum / scored.length) * 100);
}

function floorMetrics(rooms: Room[], fp: Rect) {
  const builtUpArea = fp.w * fp.h;
  const efficiency = Math.max(0.78, Math.min(0.9, 0.92 - rooms.length * 0.0045));
  return {
    builtUpArea,
    carpetArea: builtUpArea * efficiency,
    efficiency,
    perimeter: 2 * (fp.w + fp.h),
    vastuScore: computeVastu(rooms, fp),
  };
}

/* ------------------------------------------------------------------ */
/* Suggestions.                                                         */
/* ------------------------------------------------------------------ */
function buildSuggestions(plan: PlanResult, req: Requirements): Suggestion[] {
  const out: Suggestion[] = [];
  const ground = plan.floors[0];

  const right = plan.footprint.x + plan.footprint.w;
  const bottom = plan.footprint.y + plan.footprint.h;
  let blind = 0;
  for (const f of plan.floors)
    for (const r of f.rooms)
      if (r.type === "bedroom" || r.type === "master_bedroom") {
        const hasExt =
          onBoundary(r.x, plan.footprint.x) ||
          onBoundary(r.x + r.w, right) ||
          onBoundary(r.y, plan.footprint.y) ||
          onBoundary(r.y + r.h, bottom);
        if (!hasExt) blind++;
      }
  out.push(
    blind === 0
      ? { kind: "ventilation", severity: "good", message: "Every bedroom has at least one external wall for cross-ventilation and daylight." }
      : { kind: "ventilation", severity: "warn", message: `${blind} bedroom(s) are landlocked — consider a light shaft or rearranging to an outer wall.` },
  );

  const avgVastu = Math.round(
    plan.floors.reduce((a, f) => a + f.metrics.vastuScore, 0) / plan.floors.length,
  );
  out.push({
    kind: "vastu",
    severity: avgVastu >= 75 ? "good" : avgVastu >= 55 ? "info" : "warn",
    message: `Vastu compliance score: ${avgVastu}/100${avgVastu >= 75 ? " — strong alignment with directional principles." : " — kitchen/master placement could be tuned for a higher score."}`,
  });

  out.push({
    kind: "space",
    severity: ground.metrics.efficiency >= 0.85 ? "good" : "info",
    message: `Carpet-area efficiency ≈ ${Math.round(ground.metrics.efficiency * 100)}%. Built-up ${Math.round(plan.floors.reduce((a, f) => a + f.metrics.builtUpArea, 0))} m² across ${plan.floors.length} floor(s).`,
  });

  if (req.floors > 1)
    out.push({ kind: "circulation", severity: "info", message: "Staircase is stacked vertically across floors for an efficient structural core." });

  const rate = { economy: 1400, standard: 1900, premium: 2600, luxury: 3600 }[req.budget];
  const totalArea = plan.floors.reduce((a, f) => a + f.metrics.builtUpArea, 0);
  out.push({
    kind: "cost",
    severity: "info",
    message: `Indicative construction estimate ≈ ₹${(totalArea * 10.7639 * rate).toLocaleString("en-IN", { maximumFractionDigits: 0 })} at ${req.budget} finish (≈₹${rate}/ft²).`,
  });

  return out;
}

/* ------------------------------------------------------------------ */
/* Polygon-mode: layout rooms within an arbitrary polygon.              */
/* ------------------------------------------------------------------ */
function layoutFloorPoly(
  fpPoly: Polygon,
  clusters: Cluster[],
  req: Requirements,
): Room[] {
  const fpBBox = polygonBBox(fpPoly);
  const card = layoutCardinal(req.facing);
  const horizontal = card === "E" || card === "W";
  // For polygon mode the "cross" and "depth" come from the polygon's bbox.
  const crossLen = horizontal ? fpBBox.h : fpBBox.w;

  const byZone = new Map<Zone, Cluster[]>();
  for (const c of clusters) (byZone.get(c.zone) ?? byZone.set(c.zone, []).get(c.zone)!).push(c);

  const bands = BAND_GROUPS
    .map((zs) => zs.flatMap((z) => byZone.get(z) ?? []))
    .filter((g) => g.length > 0);
  const bandWeight = (g: Cluster[]) => g.reduce((a, c) => a + c.weight, 0);

  // Split the footprint polygon into band polygons (front → back).
  const bandWeights = bands.map(bandWeight);
  // Axis: for N/S facing, split along Y; for E/W, split along X.
  const splitAxis = horizontal ? "x" : "y";
  // For S/W facing, reverse the band order (front band at the high end).
  const needsReverse = card === "S" || card === "W";
  const orderedWeights = needsReverse ? [...bandWeights].reverse() : bandWeights;
  let bandPolys = subdividePolygon(fpPoly, orderedWeights, splitAxis);
  if (needsReverse) bandPolys = bandPolys.reverse();

  const rooms: Room[] = [];

  bands.forEach((group, i) => {
    const bandPoly = bandPolys[i] ?? fpPoly;
    const innerAxis = splitAxis === "y" ? "x" : "y";

    const ordered = [...group].sort((p, q) => {
      if (req.vastu) {
        const vp = getVastuSortKey(p, innerAxis);
        const vq = getVastuSortKey(q, innerAxis);
        if (Math.abs(vp - vq) > 0.01) return vp - vq;
      }
      return q.weight - p.weight;
    });

    // Split band polygon into cluster polygons.
    const clusterWeights = ordered.map((c) => c.weight);
    const clusterPolys = subdividePolygon(bandPoly, clusterWeights, innerAxis);

    ordered.forEach((cluster, ci) => {
      const cPoly = clusterPolys[ci] ?? bandPoly;

      if (cluster.rooms.length === 1) {
        const spec = cluster.rooms[0];
        const bbox = polygonBBox(cPoly);
        rooms.push({
          ...bbox,
          id: `${spec.type}-${rooms.length}`,
          type: spec.type,
          label: spec.label,
          zone: spec.zone,
          idealDir: spec.idealDir,
          polygon: cPoly,
        });
      } else {
        // Bedroom + bathroom cluster: split into two sub-polygons.
        const [bed, bath] = cluster.rooms;
        const f = Math.max(0.2, Math.min(0.34, bath.weight / cluster.weight));
        const subPolys = subdividePolygon(cPoly, [1 - f, f], innerAxis);

        for (let k = 0; k < 2; k++) {
          const spec = k === 0 ? bed : bath;
          const sp = subPolys[k] ?? cPoly;
          const bbox = polygonBBox(sp);
          rooms.push({
            ...bbox,
            id: `${spec.type}-${rooms.length}`,
            type: spec.type,
            label: spec.label,
            zone: spec.zone,
            idealDir: spec.idealDir,
            polygon: sp,
          });
        }
      }
    });
  });

  if (req.vastu) optimizeVastu(rooms, fpBBox);
  return rooms;
}

/* ------------------------------------------------------------------ */
/* Polygon-mode: doors & windows using polygon edges.                   */
/* ------------------------------------------------------------------ */
export function placeOpeningsPoly(
  rooms: Room[],
  fpPoly: Polygon,
): { doors: Door[]; windows: WindowMark[] } {
  const doors: Door[] = [];
  const windows: WindowMark[] = [];

  for (const room of rooms) {
    if (room.type === "garden") continue;
    const rp = room.polygon;
    if (!rp || rp.length < 3) continue;

    const edges = polygonEdges(rp);
    const classified = edges.map((e) => ({
      ...e,
      ext: edgeOnBoundary(e.x1, e.y1, e.x2, e.y2, fpPoly),
    }));

    // Door: prefer longest interior edge.
    const interior = classified.filter((e) => !e.ext && e.length > 1.0);
    const doorEdge = (interior.length ? interior : classified).sort((a, b) => b.length - a.length)[0];
    if (doorEdge) {
      const dw = Math.min(0.95, doorEdge.length * 0.4);
      const mx = (doorEdge.x1 + doorEdge.x2) / 2;
      const my = (doorEdge.y1 + doorEdge.y2) / 2;
      doors.push({
        roomId: room.id,
        orientation: doorEdge.orientation,
        width: dw,
        exterior: room.type === "foyer",
        x: doorEdge.orientation === "v" ? doorEdge.x1 : mx - dw / 2,
        y: doorEdge.orientation === "v" ? my - dw / 2 : doorEdge.y1,
      });
    }

    // Windows on exterior edges.
    const habitable = !["stair", "store", "utility", "parking", "foyer", "corridor"].includes(room.type);
    if (habitable) {
      for (const e of classified) {
        if (e.ext && e.length > 1.6) {
          const ww = Math.min(1.5, e.length * 0.5);
          const mx = (e.x1 + e.x2) / 2;
          const my = (e.y1 + e.y2) / 2;
          windows.push({
            roomId: room.id,
            orientation: e.orientation,
            width: ww,
            x: e.orientation === "v" ? e.x1 : mx - ww / 2,
            y: e.orientation === "v" ? my - ww / 2 : e.y1,
          });
        }
      }
    }
  }
  return { doors, windows };
}

/* ------------------------------------------------------------------ */
/* Public API.                                                          */
/* ------------------------------------------------------------------ */
const FLOOR_NAMES = ["Ground Floor", "First Floor", "Second Floor", "Third Floor", "Fourth Floor"];

export function generatePlan(req: Requirements): PlanResult {
  const sb = setbacks(req);
  const hasPolygon = req.plotPolygon && req.plotPolygon.length >= 3;

  // ── Polygon mode ──
  if (hasPolygon) {
    const plotPoly = req.plotPolygon!;
    const avgSetback = (sb.front + sb.rear + sb.side) / 3;
    const fpPoly = insetPolygon(plotPoly, avgSetback);
    const fpBBox = polygonBBox(fpPoly);
    const plotArea = polygonArea(plotPoly);

    const floors: FloorPlan[] = [];
    for (let i = 0; i < req.floors; i++) {
      const clusters = buildFloorClusters(req, i, polygonArea(fpPoly));
      const rooms = layoutFloorPoly(fpPoly, clusters, req);
      const { doors, windows } = placeOpeningsPoly(rooms, fpPoly);
      floors.push({
        floor: i,
        name: FLOOR_NAMES[i] ?? `Floor ${i}`,
        footprint: fpBBox,
        footprintPolygon: fpPoly,
        rooms,
        doors,
        windows,
        walls: generatePolygonWalls(rooms, fpPoly),
        metrics: floorMetricsPoly(rooms, fpPoly, fpBBox),
      });
    }

    const result: PlanResult = {
      plotArea,
      plotPolygon: plotPoly,
      footprint: fpBBox,
      setback: sb,
      floors,
      suggestions: [],
    };
    result.suggestions = buildSuggestions(result, req);
    result.validation = validatePlanRequirements(result, req);
    return result;
  }

  // ── Rectangular mode (original) ──
  const footprint: Rect = {
    x: sb.side,
    y: sb.front,
    w: Math.max(3, req.plotWidth - sb.side * 2),
    h: Math.max(3, req.plotDepth - sb.front - sb.rear),
  };

  const floors: FloorPlan[] = [];
  for (let i = 0; i < req.floors; i++) {
    const clusters = buildFloorClusters(req, i, footprint.w * footprint.h);
    const rooms = layoutFloor(footprint, clusters, req);
    const { doors, windows } = placeOpenings(rooms, footprint);
    floors.push({
      floor: i,
      name: FLOOR_NAMES[i] ?? `Floor ${i}`,
      footprint,
      rooms,
      doors,
      windows,
      walls: generateWalls(rooms, footprint),
      metrics: floorMetrics(rooms, footprint),
    });
  }

  const result: PlanResult = {
    plotArea: req.plotWidth * req.plotDepth,
    footprint,
    setback: sb,
    floors,
    suggestions: [],
  };
  result.suggestions = buildSuggestions(result, req);
  result.validation = validatePlanRequirements(result, req);
  return result;
}

const MIN_ROOM_AREA: Record<string, number> = {
  foyer: 2.0,
  living: 10.0,
  dining: 6.0,
  kitchen: 5.0,
  toilet: 1.5,
  pooja: 1.5,
  office: 6.0,
  stair: 4.0,
  corridor: 2.0,
  store: 1.5,
  utility: 2.0,
  master_bedroom: 10.0,
  bedroom: 8.0,
  bathroom: 2.5,
  parking: 11.0,
  balcony: 2.0,
  garden: 5.0,
  pool: 8.0,
};

export function validatePlanRequirements(plan: PlanResult, req: Requirements): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  let bedroomCount = 0;
  let bathroomCount = 0;
  let parkingCount = 0;
  let balconyCount = 0;
  let hasGarden = false;
  let hasPool = false;
  let hasOffice = false;

  for (const floor of plan.floors) {
    for (const room of floor.rooms) {
      if (room.type === "bedroom" || room.type === "master_bedroom") {
        bedroomCount++;
      }
      if (room.type === "bathroom") {
        bathroomCount++;
      }
      if (room.type === "parking") {
        parkingCount++;
      }
      if (room.type === "balcony" && room.label.includes("Balcony")) {
        balconyCount++;
      }
      if (room.type === "garden" && room.label === "Garden") {
        hasGarden = true;
      }
      if (room.type === "pool") {
        hasPool = true;
      }
      if (room.type === "office") {
        hasOffice = true;
      }

      // Check min area
      const area = room.w * room.h;
      const minArea = MIN_ROOM_AREA[room.type] ?? 2.0;
      if (area < minArea) {
        errors.push(`${room.label} is too small (${area.toFixed(1)} m², minimum is ${minArea} m²).`);
      }
    }
  }

  if (bedroomCount !== req.bedrooms) {
    errors.push(`Expected ${req.bedrooms} bedrooms, but generated ${bedroomCount}.`);
  }
  if (bathroomCount !== req.bathrooms) {
    errors.push(`Expected ${req.bathrooms} bathrooms, but generated ${bathroomCount}.`);
  }
  if (parkingCount !== req.parking) {
    errors.push(`Expected ${req.parking} parking spaces, but generated ${parkingCount}.`);
  }
  if (balconyCount !== req.balconies) {
    errors.push(`Expected ${req.balconies} balconies, but generated ${balconyCount}.`);
  }
  if (req.garden && !hasGarden) {
    errors.push("Garden was requested but not generated.");
  }
  if (req.pool && !hasPool) {
    errors.push("Swimming Pool was requested but not generated.");
  }
  if (req.homeOffice && !hasOffice) {
    errors.push("Home Office was requested but not generated.");
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

/* ------------------------------------------------------------------ */
/* Metrics for polygon mode.                                            */
/* ------------------------------------------------------------------ */
function floorMetricsPoly(rooms: Room[], fpPoly: Polygon, fpBBox: Rect) {
  const builtUpArea = polygonArea(fpPoly);
  const efficiency = Math.max(0.78, Math.min(0.9, 0.92 - rooms.length * 0.0045));
  // Perimeter of footprint polygon.
  let perimeter = 0;
  for (let i = 0; i < fpPoly.length; i++) {
    const [x1, y1] = fpPoly[i];
    const [x2, y2] = fpPoly[(i + 1) % fpPoly.length];
    perimeter += Math.hypot(x2 - x1, y2 - y1);
  }
  return {
    builtUpArea,
    carpetArea: builtUpArea * efficiency,
    efficiency,
    perimeter,
    vastuScore: computeVastu(rooms, fpBBox),
  };
}
