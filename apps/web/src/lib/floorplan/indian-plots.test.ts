import { describe, expect, it } from "vitest";
import { generatePlan } from "./engine";
import type { PlanResult, Requirements, Room } from "./types";

/**
 * Standard Indian plot sizes (feet), checked against how local plans are
 * actually drawn: parking at the road, a stair that stacks, kitchen next to
 * the dining, bedrooms of livable size.
 */
const FT = 0.3048;

function plot(w: number, d: number, bedrooms: number, floors: number, extra: Partial<Requirements> = {}): PlanResult {
  return generatePlan({
    plotWidth: w * FT, plotDepth: d * FT, facing: "E", floors, bedrooms, bathrooms: bedrooms, parking: 1,
    balconies: 1, vastu: true, garden: false, pool: false, homeOffice: false,
    budget: "standard", style: "modern", luxury: 3, ...extra,
  });
}

const all = (p: PlanResult) => p.floors.flatMap((f) => f.rooms);
const cars = (p: PlanResult) =>
  p.floors[0].rooms.filter((r) => r.type === "parking").length + p.site.elements.filter((e) => e.type === "parking").length;
const touching = (a: Room, b: Room) => {
  const E = 0.05;
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return (ox > 0.6 && Math.abs(oy) < E) || (oy > 0.6 && Math.abs(ox) < E);
};

describe("standard Indian plots", () => {
  const G1: [number, number, number][] = [[20, 40, 2], [25, 50, 3], [30, 50, 3], [40, 60, 4]];

  it.each(G1)("%i×%i ft, %i BHK G+1 is a valid plan with parking", (w, d, beds) => {
    const p = plot(w, d, beds, 2);
    expect(p.validation?.errors).toEqual([]);
    expect(cars(p)).toBe(1);
    // The stair stacks: same place on both floors.
    const [s0, s1] = p.floors.map((f) => f.rooms.find((r) => r.type === "stair")!);
    expect(s0 && s1).toBeTruthy();
    expect(Math.abs(s0.x - s1.x) + Math.abs(s0.y - s1.y)).toBeLessThan(0.05);
  });

  it.each(G1)("%i×%i ft, %i BHK G+1 keeps the kitchen next to the dining or hall", (w, d, beds) => {
    const g = plot(w, d, beds, 2).floors[0].rooms;
    const kitchen = g.find((r) => r.type === "kitchen")!;
    const eating = g.filter((r) => r.type === "dining" || r.type === "living");
    // Compact plans fold dining into the kitchen ("Kitchen & Dining").
    expect(kitchen.label === "Kitchen & Dining" || eating.some((r) => touching(kitchen, r))).toBe(true);
  });

  it("20×40 ft: the stair rises beside the car porch, with a bedroom over the porch", () => {
    const p = plot(20, 40, 2, 2);
    const g = p.floors[0].rooms;
    const porch = g.find((r) => r.type === "parking")!;
    const stair = g.find((r) => r.type === "stair")!;
    expect(touching(porch, stair)).toBe(true);
    const up = p.floors[1].rooms;
    const upStair = up.find((r) => r.type === "stair")!;
    expect(up.some((r) => /bedroom/.test(r.type) && touching(r, upStair))).toBe(true);
  });

  it("small plots get bye-law setbacks, not 3 ft on every side", () => {
    expect(plot(20, 40, 2, 2).setback.side).toBeLessThanOrEqual(0.5);
    expect(plot(30, 40, 3, 2).setback.side).toBeLessThanOrEqual(0.6);
  });

  it("bedrooms are never slivers on standard plots", () => {
    for (const [w, d, beds] of G1) {
      for (const r of all(plot(w, d, beds, 2)).filter((x) => /bedroom/.test(x.type))) {
        // 8 ft minimum: 8½–9 ft bedrooms are normal on 20 ft plots.
        expect(Math.min(r.w, r.h), `${w}×${d} ${r.label}`).toBeGreaterThanOrEqual(2.44);
      }
    }
  });

  it("says so when the brief doesn't fit, and suggests another floor", () => {
    const p = plot(20, 30, 2, 1);
    expect(p.validation?.ok).toBe(false);
    expect(p.suggestions[0].message).toMatch(/Add a floor/);
  });
});
