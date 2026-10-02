import { describe, expect, it } from "vitest";
import { generatePlan } from "./engine";
import { polygonArea } from "./polygon-ops";
import type { BuildingType, Facing, FloorPlan, Requirements } from "./types";

const FT = 0.3048;
const E = 0.02;

function plan(type: BuildingType, w: number, d: number, beds: number, facing: Facing = "E", extra: Partial<Requirements> = {}) {
  return generatePlan({
    buildingType: type, plotWidth: w * FT, plotDepth: d * FT, facing, floors: 1, bedrooms: beds, bathrooms: beds,
    parking: 1, balconies: 0, vastu: true, garden: false, pool: false, homeOffice: false,
    budget: "standard", style: "traditional", luxury: 3, ...extra,
  });
}

/** Indoor rooms not reachable through doors from the front verandah. */
function unreachable(f: FloorPlan): string[] {
  const at = (x: number, y: number) => f.rooms.find((r) => x > r.x - E && x < r.x + r.w + E && y > r.y - E && y < r.y + r.h + E);
  const adj = new Map(f.rooms.map((r) => [r.id, new Set<string>()]));
  for (const d of f.doors) {
    const v = d.orientation === "v";
    const mx = v ? d.x : d.x + d.width / 2;
    const my = v ? d.y + d.width / 2 : d.y;
    const a = v ? at(mx - 0.1, my) : at(mx, my - 0.1);
    const b = v ? at(mx + 0.1, my) : at(mx, my + 0.1);
    if (a && b && a.id !== b.id) { adj.get(a.id)!.add(b.id); adj.get(b.id)!.add(a.id); }
  }
  const seen = new Set(f.rooms.filter((r) => r.type === "sitout").map((r) => r.id));
  const queue = [...seen];
  while (queue.length) for (const n of adj.get(queue.pop()!)!) if (!seen.has(n)) { seen.add(n); queue.push(n); }
  return f.rooms.filter((r) => !seen.has(r.id) && !["sitout", "terrace"].includes(r.type)).map((r) => r.label);
}

function wellFormed(f: FloorPlan) {
  expect(f.rooms.reduce((a, r) => a + r.w * r.h, 0), "rooms tile the house").toBeCloseTo(polygonArea(f.footprintPolygon!), 1);
  for (let i = 0; i < f.rooms.length; i++) {
    for (let j = i + 1; j < f.rooms.length; j++) {
      const a = f.rooms[i];
      const b = f.rooms[j];
      const overlap = a.x < b.x + b.w - E && b.x < a.x + a.w - E && a.y < b.y + b.h - E && b.y < a.y + a.h - E;
      expect(overlap, `${a.label} / ${b.label}`).toBe(false);
    }
  }
  expect(unreachable(f)).toEqual([]);
}

describe("manduva (courtyard) houses", () => {
  for (const [w, d, beds, facing] of [[45, 55, 2, "E"], [50, 60, 3, "E"], [40, 60, 3, "N"], [60, 80, 4, "W"]] as const) {
    it(`${w}×${d} ft, ${beds} BHK, ${facing}-facing`, () => {
      const p = plan("manduva", w, d, beds, facing);
      expect(p.validation?.errors).toEqual([]);
      expect(p.floors).toHaveLength(1);
      const f = p.floors[0];
      wellFormed(f);
      const court = f.rooms.find((r) => r.type === "terrace")!;
      expect(court.label).toMatch(/courtyard/i);
      // A verandah runs round the courtyard on all four sides.
      const ver = f.rooms.filter((r) => r.type === "corridor");
      const touches = (side: "top" | "bottom" | "left" | "right") => ver.some((v) =>
        side === "top" ? Math.abs(v.y + v.h - court.y) < E && v.x <= court.x + E && v.x + v.w >= court.x + court.w - E
          : side === "bottom" ? Math.abs(v.y - (court.y + court.h)) < E && v.x <= court.x + E && v.x + v.w >= court.x + court.w - E
            : side === "left" ? Math.abs(v.x + v.w - court.x) < E && v.y <= court.y + E && v.y + v.h >= court.y + court.h - E
              : Math.abs(v.x - (court.x + court.w)) < E && v.y <= court.y + E && v.y + v.h >= court.y + court.h - E);
      expect([touches("top"), touches("bottom"), touches("left"), touches("right")]).toEqual([true, true, true, true]);
    });
  }

  it("puts the pooja, kitchen and master bedroom in their Vastu corners", () => {
    const f = plan("manduva", 50, 60, 3, "E").floors[0];
    expect(f.metrics.vastuScore).toBeGreaterThanOrEqual(70);
  });

  it("falls back to an independent house on a plot too small for a courtyard", () => {
    const p = plan("manduva", 30, 40, 2);
    expect(p.floors[0].rooms.some((r) => r.type === "terrace" && /courtyard/i.test(r.label))).toBe(false);
    expect(p.suggestions[0].message).toMatch(/manduva/i);
  });
});

describe("cottages (rooms around a central hall, verandahs outside)", () => {
  for (const [w, d, beds, facing] of [[40, 50, 2, "E"], [50, 60, 3, "S"]] as const) {
    it(`${w}×${d} ft, ${beds} BHK, ${facing}-facing`, () => {
      const p = plan("cottage", w, d, beds, facing);
      expect(p.validation?.errors).toEqual([]);
      const f = p.floors[0];
      wellFormed(f);
      expect(f.rooms.some((r) => r.label === "Dining Hall")).toBe(true);
      expect(f.rooms.filter((r) => r.type === "sitout").length).toBeGreaterThanOrEqual(1);
    });
  }
});
