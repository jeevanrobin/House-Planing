import { describe, expect, it } from "vitest";
import { generatePlan } from "./engine";
import { toFloorPlanJSON } from "./serialize";
import type { Polygon, Rect, Requirements, Room } from "./types";

const REQ: Requirements = {
  plotWidth: 12, plotDepth: 18, facing: "N", floors: 2,
  bedrooms: 4, bathrooms: 3, parking: 1, balconies: 2,
  vastu: true, garden: false, pool: false, homeOffice: true,
  budget: "premium", style: "modern", luxury: 4,
};

const overlapArea = (a: Rect, b: Rect) => {
  const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return ox * oy;
};

/** Two rects are adjacent if they share a wall segment (touch + overlap). */
const adjacent = (a: Rect, b: Rect) => {
  const t = 0.06;
  const vShared = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.5;
  const hShared = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.5;
  const vTouch = Math.abs(a.x + a.w - b.x) < t || Math.abs(b.x + b.w - a.x) < t;
  const hTouch = Math.abs(a.y + a.h - b.y) < t || Math.abs(b.y + b.h - a.y) < t;
  return (vTouch && vShared) || (hTouch && hShared);
};

describe("architectural room generation", () => {
  const plan = generatePlan(REQ);

  it("emits rooms, doors, windows and walls for every floor", () => {
    for (const f of plan.floors) {
      expect(f.rooms.length).toBeGreaterThan(3);
      expect(f.walls.length).toBeGreaterThan(4);
      expect(f.doors.length).toBeGreaterThan(0);
      expect(f.windows.length).toBeGreaterThan(0);
    }
  });

  it("never overlaps rooms and fills the footprint", () => {
    for (const f of plan.floors) {
      for (let i = 0; i < f.rooms.length; i++)
        for (let j = i + 1; j < f.rooms.length; j++)
          expect(overlapArea(f.rooms[i], f.rooms[j])).toBeLessThan(0.05);
      const sum = f.rooms.reduce((a, r) => a + r.w * r.h, 0);
      const fpArea = f.footprint.w * f.footprint.h;
      expect(sum).toBeCloseTo(fpArea, 0);
    }
  });

  it("keeps every room inside the plot footprint", () => {
    for (const f of plan.floors)
      for (const r of f.rooms) {
        expect(r.x).toBeGreaterThanOrEqual(f.footprint.x - 0.01);
        expect(r.y).toBeGreaterThanOrEqual(f.footprint.y - 0.01);
        expect(r.x + r.w).toBeLessThanOrEqual(f.footprint.x + f.footprint.w + 0.01);
        expect(r.y + r.h).toBeLessThanOrEqual(f.footprint.y + f.footprint.h + 0.01);
      }
  });

  it("places each attached bathroom next to a bedroom (adjacency rule)", () => {
    for (const f of plan.floors) {
      const beds = f.rooms.filter((r) => r.type === "bedroom" || r.type === "master_bedroom");
      const baths = f.rooms.filter((r) => r.type === "bathroom" && !r.label.startsWith("Common"));
      for (const bath of baths)
        expect(beds.some((bed: Room) => adjacent(bath, bed))).toBe(true);
    }
  });

  it("generates a continuous exterior shell on all four sides", () => {
    const f = plan.floors[0];
    const fp = f.footprint;
    const ext = f.walls.filter((w) => w.type === "exterior");
    const near = (a: number, b: number) => Math.abs(a - b) < 0.05;
    expect(ext.some((w) => w.orientation === "v" && near(w.x1, fp.x))).toBe(true);
    expect(ext.some((w) => w.orientation === "v" && near(w.x1, fp.x + fp.w))).toBe(true);
    expect(ext.some((w) => w.orientation === "h" && near(w.y1, fp.y))).toBe(true);
    expect(ext.some((w) => w.orientation === "h" && near(w.y1, fp.y + fp.h))).toBe(true);
  });

  it("serialises to the flat { rooms, doors, windows, walls } structure in feet", () => {
    const json = toFloorPlanJSON(plan.floors[0]);
    expect(json.unit).toBe("ft");
    expect(json.rooms[0]).toHaveProperty("name");
    expect(json.rooms[0]).toHaveProperty("width");
    expect(json.rooms[0]).toHaveProperty("x");
    expect(json.rooms[0]).toHaveProperty("area");
    expect(Array.isArray(json.walls)).toBe(true);
    expect(json.walls[0]).toHaveProperty("thickness");
  });

  it("enforces validation and supports pool/balcony requirements", () => {
    const plan = generatePlan({ ...REQ, pool: true, balconies: 2 });
    expect(plan.validation).toBeDefined();
    expect(plan.validation!.ok).toBe(true);
    const gfRooms = plan.floors[0].rooms;
    expect(gfRooms.some(r => r.type === "pool")).toBe(true);
    const ffRooms = plan.floors[1].rooms;
    expect(ffRooms.some(r => r.type === "balcony")).toBe(true);
    const avgVastu = plan.floors.reduce((a, f) => a + f.metrics.vastuScore, 0) / plan.floors.length;
    expect(avgVastu).toBeGreaterThanOrEqual(50);
  });

  it("fails validation on impossible small plot dimensions", () => {
    const plan = generatePlan({
      ...REQ,
      plotWidth: 5,
      plotDepth: 5,
      bedrooms: 5,
      bathrooms: 5,
      pool: true,
    });
    expect(plan.validation).toBeDefined();
    expect(plan.validation!.ok).toBe(false);
    expect(plan.validation!.errors.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* Polygon-mode tests.                                                  */
/* ------------------------------------------------------------------ */
const POLY_BASE: Omit<Requirements, "plotPolygon"> = {
  plotWidth: 12, plotDepth: 18, facing: "N", floors: 1,
  bedrooms: 2, bathrooms: 2, parking: 0, balconies: 0,
  vastu: false, garden: false, pool: false, homeOffice: false,
  budget: "standard", style: "modern", luxury: 3,
};

describe("polygon-mode floor plan generation", () => {
  it("generates a plan for a rectangular polygon (regression)", () => {
    const rectPoly: Polygon = [[0, 0], [12, 0], [12, 18], [0, 18]];
    const plan = generatePlan({ ...POLY_BASE, plotPolygon: rectPoly });
    expect(plan.plotPolygon).toBeDefined();
    expect(plan.floors).toHaveLength(1);
    const f = plan.floors[0];
    expect(f.rooms.length).toBeGreaterThan(3);
    expect(f.footprintPolygon).toBeDefined();
    // Every room should have a polygon field.
    for (const r of f.rooms) {
      expect(r.polygon).toBeDefined();
      expect(r.polygon!.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("generates a plan for a triangle plot", () => {
    const triangle: Polygon = [[6, 0], [12, 18], [0, 18]];
    const plan = generatePlan({ ...POLY_BASE, plotPolygon: triangle });
    const f = plan.floors[0];
    expect(f.rooms.length).toBeGreaterThan(3);
    // All room bboxes should be within the footprint bbox.
    const fpBBox = f.footprint;
    for (const r of f.rooms) {
      expect(r.x).toBeGreaterThanOrEqual(fpBBox.x - 0.5);
      expect(r.y).toBeGreaterThanOrEqual(fpBBox.y - 0.5);
      expect(r.x + r.w).toBeLessThanOrEqual(fpBBox.x + fpBBox.w + 0.5);
      expect(r.y + r.h).toBeLessThanOrEqual(fpBBox.y + fpBBox.h + 0.5);
    }
  });

  it("generates a plan for a trapezoid plot", () => {
    const trapezoid: Polygon = [[3, 0], [9, 0], [12, 18], [0, 18]];
    const plan = generatePlan({ ...POLY_BASE, plotPolygon: trapezoid });
    const f = plan.floors[0];
    expect(f.rooms.length).toBeGreaterThan(3);
    expect(f.walls.length).toBeGreaterThan(0);
    expect(f.doors.length).toBeGreaterThan(0);
  });

  it("generates a plan for an L-shaped plot", () => {
    const lShape: Polygon = [[0, 0], [12, 0], [12, 8], [6, 8], [6, 18], [0, 18]];
    const plan = generatePlan({ ...POLY_BASE, plotPolygon: lShape });
    const f = plan.floors[0];
    expect(f.rooms.length).toBeGreaterThan(3);
  });

  it("falls back to rect mode when no polygon is provided", () => {
    const plan = generatePlan(POLY_BASE);
    expect(plan.plotPolygon).toBeUndefined();
    const f = plan.floors[0];
    // Rooms should NOT have polygon fields in rect mode.
    for (const r of f.rooms) {
      expect(r.polygon).toBeUndefined();
    }
  });
});
