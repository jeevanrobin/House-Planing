import { describe, expect, it } from "vitest";
import { generatePlan } from "./engine";
import type { BuildingType, FloorPlan, Requirements, Room } from "./types";

const FT = 0.3048;
const E = 0.02;

function plan(type: BuildingType, w: number, d: number, beds: number, floors: number, extra: Partial<Requirements> = {}) {
  return generatePlan({
    buildingType: type, plotWidth: w * FT, plotDepth: d * FT, facing: "E", floors, bedrooms: beds, bathrooms: beds,
    parking: 1, balconies: 1, vastu: true, garden: false, pool: false, homeOffice: false,
    budget: "standard", style: "modern", luxury: 3, ...extra,
  });
}

/** Pairs of rooms joined by a door or opening, as labels' types. */
function doorPairs(f: FloorPlan): [Room, Room][] {
  const at = (x: number, y: number) => f.rooms.find((r) => x > r.x - E && x < r.x + r.w + E && y > r.y - E && y < r.y + r.h + E);
  const out: [Room, Room][] = [];
  for (const d of f.doors) {
    const v = d.orientation === "v";
    const mx = v ? d.x : d.x + d.width / 2;
    const my = v ? d.y + d.width / 2 : d.y;
    const a = v ? at(mx - 0.1, my) : at(mx, my - 0.1);
    const b = v ? at(mx + 0.1, my) : at(mx, my + 0.1);
    if (a && b && a.id !== b.id) out.push([a, b]);
  }
  return out;
}

const bedrooms = (f: FloorPlan) => f.rooms.filter((r) => r.type === "bedroom" || r.type === "master_bedroom").length;

describe("floors for rent (a separate home on every floor)", () => {
  for (const [w, d, beds, floors] of [[30, 40, 2, 2], [30, 50, 2, 3], [40, 60, 3, 2]] as const) {
    it(`${w}×${d} ft, ${beds} BHK × ${floors} floors`, () => {
      const p = plan("rental", w, d, beds, floors);
      expect(p.validation?.errors).toEqual([]);
      for (const f of p.floors) {
        // Every floor is a complete home.
        expect(f.rooms.some((r) => r.type === "kitchen"), f.name).toBe(true);
        expect(f.rooms.some((r) => r.type === "living"), f.name).toBe(true);
        expect(bedrooms(f), f.name).toBe(beds);
      }
      // The ground-floor stair is reached only from outside — never through the home.
      const g = p.floors[0];
      expect(g.access).toBe("stairOutside");
      for (const [a, b] of doorPairs(g)) {
        const other = a.type === "stair" ? b : b.type === "stair" ? a : null;
        if (other) expect(["sitout", "parking"], `stair ↔ ${other.label}`).toContain(other.type);
      }
      // Each upper home has its front door on the stair landing.
      for (const f of p.floors.slice(1)) {
        expect(f.access).toBe("fromStair");
        const main = f.doors.find((dr) => dr.kind === "main");
        expect(main, f.name).toBeDefined();
        expect(doorPairs(f).some(([a, b]) => [a.type, b.type].sort().join() === "living,stair")).toBe(true);
      }
    });
  }
});

describe("duplex (one family over two floors)", () => {
  it("puts every bedroom upstairs in a 3 BHK", () => {
    const p = plan("duplex", 30, 50, 3, 2);
    expect(p.validation?.errors).toEqual([]);
    expect(bedrooms(p.floors[0])).toBe(0);
    expect(bedrooms(p.floors[1])).toBe(3);
  });

  it("keeps a ground-floor guest bedroom in a 4 BHK", () => {
    const p = plan("duplex", 40, 60, 4, 2);
    expect(p.validation?.errors).toEqual([]);
    expect(bedrooms(p.floors[0])).toBe(1);
  });
});

describe("single-storey homes on standard plots", () => {
  for (const [w, d, beds, baths] of [[30, 40, 2, 2], [30, 40, 3, 2], [30, 40, 3, 3], [30, 50, 3, 2]] as const) {
    it(`${w}×${d} ft, ${beds} BHK with ${baths} baths fits on one floor`, () => {
      const p = plan("house", w, d, beds, 1, { bathrooms: baths, balconies: 0 });
      expect(p.validation?.errors).toEqual([]);
    });
  }
});
