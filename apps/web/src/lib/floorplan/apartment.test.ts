import { describe, expect, it } from "vitest";
import { generatePlan } from "./engine";
import type { FloorPlan, Room } from "./types";

const FT = 0.3048;
const E = 0.02;

function apartment(w: number, d: number, beds: number, floors: number, flats: 2 | 3 | 4) {
  return generatePlan({
    buildingType: "apartment", flatsPerFloor: flats, plotWidth: w * FT, plotDepth: d * FT, facing: "E", floors,
    bedrooms: beds, bathrooms: beds, parking: 1, balconies: 1, vastu: true, garden: false, pool: false,
    homeOffice: false, budget: "standard", style: "modern", luxury: 3,
  });
}

/** Rooms on each side of every door. */
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

/** Rooms of every flat reachable from the common stair, through the lobby and the flat's own doors. */
function unreachable(f: FloorPlan): string[] {
  const adj = new Map(f.rooms.map((r) => [r.id, new Set<string>()]));
  for (const [a, b] of doorPairs(f)) { adj.get(a.id)!.add(b.id); adj.get(b.id)!.add(a.id); }
  const seen = new Set(f.rooms.filter((r) => r.type === "stair").map((r) => r.id));
  const queue = [...seen];
  while (queue.length) for (const n of adj.get(queue.pop()!)!) if (!seen.has(n)) { seen.add(n); queue.push(n); }
  return f.rooms.filter((r) => !seen.has(r.id) && !["balcony", "terrace", "parking"].includes(r.type)).map((r) => `${r.unit ?? ""} ${r.label}`);
}

describe("apartments", () => {
  for (const [w, d, beds, floors, flats] of [[50, 80, 2, 5, 2], [60, 80, 3, 6, 2], [60, 80, 2, 5, 3], [60, 100, 3, 6, 4]] as const) {
    it(`${w}×${d} ft, G+${floors - 1}, ${flats} × ${beds} BHK per floor`, () => {
      const p = apartment(w, d, beds, floors, flats);
      expect(p.validation?.errors).toEqual([]);
      expect(p.floors).toHaveLength(floors);

      // Stair and lift stack on every floor.
      const core = (f: FloorPlan, t: string) => f.rooms.find((r) => r.type === t)!;
      for (const t of ["stair", "lift"]) {
        const g = core(p.floors[0], t);
        for (const f of p.floors) {
          const r = core(f, t);
          expect(r, `${f.name} ${t}`).toBeDefined();
          expect(Math.abs(r.x - g.x) + Math.abs(r.y - g.y)).toBeLessThan(E);
        }
      }

      // Stilt floor: car bays, no flats.
      const g = p.floors[0];
      expect(g.rooms.some((r) => r.unit)).toBe(false);
      expect(g.rooms.filter((r) => /^Car \d/.test(r.label)).length).toBeGreaterThanOrEqual(flats);

      for (const f of p.floors.slice(1)) {
        const units = [...new Set(f.rooms.filter((r) => r.unit).map((r) => r.unit))];
        expect(units, f.name).toHaveLength(flats);
        for (const u of units) {
          expect(f.rooms.filter((r) => r.unit === u && /bedroom/.test(r.type)), `flat ${u}`).toHaveLength(beds);
        }
        // No door joins two flats; a flat meets the lobby only at its front door.
        for (const [a, b] of doorPairs(f)) {
          if (a.unit && b.unit) expect(a.unit, `${a.label} ↔ ${b.label}`).toBe(b.unit);
          if (!!a.unit !== !!b.unit) {
            const flatSide = a.unit ? a : b;
            expect(flatSide.type, `${a.label} ↔ ${b.label}`).toBe("living");
          }
        }
        expect(unreachable(f), f.name).toEqual([]);
      }
    });
  }

  it("falls back to floors for rent on a plot too small for a lift core and two rows of flats", () => {
    const p = apartment(30, 50, 2, 4, 2);
    expect(p.suggestions[0].message).toMatch(/too small for an apartment/);
    expect(p.floors.every((f) => f.rooms.some((r) => r.type === "kitchen"))).toBe(true);
  });
});
