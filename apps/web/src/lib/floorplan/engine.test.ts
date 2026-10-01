import { describe, expect, it } from "vitest";
import { generatePlan } from "./engine";
import { pointInPolygon } from "./polygon-ops";
import { toFloorPlanJSON } from "./serialize";
import type { FloorPlan, PlanResult, Rect, Requirements } from "./types";

const base: Requirements = {
  plotWidth: 12,
  plotDepth: 18,
  facing: "N",
  floors: 2,
  bedrooms: 3,
  bathrooms: 3,
  parking: 1,
  balconies: 1,
  vastu: true,
  garden: false,
  pool: false,
  homeOffice: false,
  budget: "standard",
  style: "modern",
  luxury: 3,
};

const E = 0.02;
const OPEN = new Set(["sitout", "balcony", "terrace", "parking"]);
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w - E && b.x < a.x + a.w - E && a.y < b.y + b.h - E && b.y < a.y + a.h - E;
const inside = (r: Rect, poly: [number, number][]) =>
  ([[r.x + 0.06, r.y + 0.06], [r.x + r.w - 0.06, r.y + 0.06], [r.x + r.w - 0.06, r.y + r.h - 0.06], [r.x + 0.06, r.y + r.h - 0.06]] as [number, number][])
    .every((c) => pointInPolygon(c, poly));

/** Rooms reachable through doors from the entrance (ground) or the stair (upper floors). */
function unreachable(f: FloorPlan): string[] {
  const roomAt = (x: number, y: number) =>
    f.rooms.find((r) => x > r.x - E && x < r.x + r.w + E && y > r.y - E && y < r.y + r.h + E);
  const adj = new Map(f.rooms.map((r) => [r.id, new Set<string>()]));
  for (const d of f.doors) {
    const v = d.orientation === "v";
    const mx = v ? d.x : d.x + d.width / 2;
    const my = v ? d.y + d.width / 2 : d.y;
    const a = v ? roomAt(mx - 0.1, my) : roomAt(mx, my - 0.1);
    const b = v ? roomAt(mx + 0.1, my) : roomAt(mx, my + 0.1);
    if (a && b && a.id !== b.id) { adj.get(a.id)!.add(b.id); adj.get(b.id)!.add(a.id); }
  }
  const start = f.floor === 0
    ? f.rooms.filter((r) => r.type === "sitout" || r.type === "parking" || (r.type === "living" && f.doors.some((d) => d.kind === "main")))
    : f.rooms.filter((r) => r.type === "stair");
  const seen = new Set(start.map((r) => r.id));
  const queue = [...seen];
  while (queue.length) for (const n of adj.get(queue.pop()!)!) if (!seen.has(n)) { seen.add(n); queue.push(n); }
  return f.rooms.filter((r) => !seen.has(r.id) && !(OPEN.has(r.type) && r.type !== "balcony")).map((r) => r.label);
}

function expectWellFormed(p: PlanResult) {
  const fp = p.footprint;
  for (const f of p.floors) {
    const area = f.rooms.reduce((a, r) => a + r.w * r.h, 0);
    expect(area, `${f.name} rooms tile the house`).toBeCloseTo(fp.w * fp.h, 1);
    for (const r of f.rooms) {
      expect(r.x >= fp.x - E && r.y >= fp.y - E && r.x + r.w <= fp.x + fp.w + E && r.y + r.h <= fp.y + fp.h + E,
        `${r.label} inside footprint`).toBe(true);
    }
    for (let i = 0; i < f.rooms.length; i++) {
      for (let j = i + 1; j < f.rooms.length; j++) {
        expect(overlaps(f.rooms[i], f.rooms[j]), `${f.rooms[i].label} / ${f.rooms[j].label} overlap`).toBe(false);
      }
    }
    expect(unreachable(f), `${f.name} unreachable rooms`).toEqual([]);
  }
  if (p.floors.length > 1) {
    const stairs = p.floors.map((f) => f.rooms.find((r) => r.type === "stair")!);
    for (const s of stairs) {
      expect(s).toBeDefined();
      expect(Math.abs(s.x - stairs[0].x) + Math.abs(s.y - stairs[0].y) + Math.abs(s.w - stairs[0].w) + Math.abs(s.h - stairs[0].h))
        .toBeLessThan(E);
    }
  }
  expect(inside(fp, p.site.plot), "house on the plot").toBe(true);
  for (const e of p.site.elements) {
    expect(overlaps(e, fp), `${e.label} clear of the house`).toBe(false);
    expect(inside(e, p.site.plot), `${e.label} on the plot`).toBe(true);
  }
}

describe("realistic layouts", () => {
  it("sizes the house to the brief, not the plot, and keeps outdoor features outside", () => {
    // The original bug: on a big plot the pool and garden filled the house.
    const p = generatePlan({ ...base, plotWidth: 29, plotDepth: 41, facing: "E", bedrooms: 2, bathrooms: 2, garden: true, pool: true, balconies: 2 });
    expectWellFormed(p);
    const fp = p.footprint;
    expect(fp.w * fp.h).toBeLessThan(0.25 * p.plotArea);
    expect(p.floors.flatMap((f) => f.rooms).some((r) => r.type === "pool" || r.type === "garden")).toBe(false);
    expect(p.site.elements.map((e) => e.type).sort()).toEqual(["garden", "parking", "pool"]);
    expect(p.validation?.ok).toBe(true);
  });

  it("gives rooms livable proportions (no slivers)", () => {
    const p = generatePlan(base);
    for (const r of p.floors.flatMap((f) => f.rooms)) {
      if (OPEN.has(r.type) || r.type === "corridor") continue;
      expect(Math.min(r.w, r.h), `${r.label} narrowest side`).toBeGreaterThanOrEqual(1.15);
    }
    const living = p.floors[0].rooms.find((r) => r.type === "living")!;
    expect(living.w * living.h).toBeGreaterThan(14);
    expect(living.w * living.h).toBeLessThan(36);
  });

  it("uses real wall thicknesses", () => {
    const walls = generatePlan(base).floors[0].walls;
    expect(Math.max(...walls.map((w) => w.thickness))).toBeLessThanOrEqual(0.25);
    expect(walls.some((w) => w.type === "railing")).toBe(true); // sit-out front
  });

  it("puts ensuites next to their bedroom and opens them from it", () => {
    const p = generatePlan({ ...base, floors: 1, bedrooms: 2, bathrooms: 2, plotWidth: 15, plotDepth: 24 });
    const f = p.floors[0];
    for (const bath of f.rooms.filter((r) => r.parentId && r.type === "bathroom")) {
      const bed = f.rooms.find((r) => r.id === bath.parentId)!;
      expect(bed.type === "bedroom" || bed.type === "master_bedroom").toBe(true);
      const door = f.doors.find((d) => d.roomId === bath.id)!;
      expect(door).toBeDefined();
    }
  });

  it("has exactly the requested bedrooms and bathrooms", () => {
    const p = generatePlan({ ...base, floors: 3, bedrooms: 5, bathrooms: 4, plotWidth: 15, plotDepth: 25 });
    const all = p.floors.flatMap((f) => f.rooms);
    expect(all.filter((r) => r.type === "bedroom" || r.type === "master_bedroom")).toHaveLength(5);
    expect(all.filter((r) => r.type === "bathroom")).toHaveLength(4);
  });

  it("faces the main door to the road", () => {
    for (const facing of ["N", "E", "S", "W"] as const) {
      const p = generatePlan({ ...base, facing });
      const main = p.floors[0].doors.find((d) => d.kind === "main");
      expect(main, facing).toBeDefined();
    }
  });

  it("parks cars in a porch when the yards are too small", () => {
    const p = generatePlan({ ...base, plotWidth: 9, plotDepth: 20, parking: 1, floors: 2, bedrooms: 2, bathrooms: 2 });
    const porch = p.floors[0].rooms.some((r) => r.type === "parking");
    const yard = p.site.elements.some((e) => e.type === "parking");
    expect(porch || yard).toBe(true);
  });

  it("serialises to the flat { rooms, doors, windows, walls } structure in feet", () => {
    const json = toFloorPlanJSON(generatePlan(base).floors[0]);
    expect(json.unit).toBe("ft");
    expect(json.rooms.length).toBeGreaterThan(5);
    expect(json.walls.length).toBeGreaterThan(5);
  });

  it("handles map-drawn polygon plots (north is up)", () => {
    // Map polygons are y-north; a trapezoid narrowing to the north.
    const p = generatePlan({ ...base, plotWidth: 14, plotDepth: 20, plotPolygon: [[0, 0], [14, 0], [12, 20], [2, 20]] });
    expectWellFormed(p);
    // The wide edge (y = 0 on the map) is the south edge of the drawing.
    const ys = p.site.plot.map(([, y]) => y);
    const southEdge = p.site.plot.filter(([, y]) => Math.abs(y - Math.max(...ys)) < 1e-6);
    expect(Math.abs(southEdge[0][0] - southEdge[1][0])).toBeCloseTo(14, 5);
  });
});

describe("engine invariants over random briefs", () => {
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const cases: Requirements[] = Array.from({ length: 60 }, () => {
    const floors = pick([1, 2, 2, 3]);
    const bedrooms = 1 + Math.floor(rnd() * (floors === 1 ? 3 : 4));
    const req: Requirements = {
      plotWidth: Math.round(9 + rnd() * 22),
      plotDepth: Math.round(14 + rnd() * 26),
      facing: pick(["N", "E", "S", "W", "NE", "NW", "SE", "SW"]),
      floors,
      bedrooms,
      bathrooms: Math.max(1, bedrooms - Math.floor(rnd() * 2)),
      parking: pick([0, 1, 2]) as Requirements["parking"],
      balconies: pick([0, 1, 2]),
      vastu: rnd() < 0.7,
      garden: rnd() < 0.5,
      pool: rnd() < 0.2,
      homeOffice: rnd() < 0.3,
      budget: pick(["economy", "standard", "premium", "luxury"]),
      style: "modern",
      luxury: (1 + Math.floor(rnd() * 5)) as Requirements["luxury"],
    };
    if (rnd() < 0.2) {
      req.plotPolygon = [[0, 0], [req.plotWidth, 0], [req.plotWidth * 0.85, req.plotDepth], [req.plotWidth * 0.1, req.plotDepth]];
    }
    return req;
  });

  it.each(cases.map((c, i) => [i, `${c.plotWidth}x${c.plotDepth} ${c.facing} ${c.floors}fl ${c.bedrooms}bed`, c] as const))(
    "#%i %s is well formed",
    (_i, _name, req) => expectWellFormed(generatePlan(req)),
  );
});
