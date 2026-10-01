import { describe, expect, it } from "vitest";
import { generatePlan } from "./engine";
import { doorClearances, furnish, type Shape } from "./furniture";
import type { Rect, Requirements } from "./types";

const E = 0.03;
const box = (s: Shape): Rect =>
  s.kind === "rect" ? s
    : s.kind === "circle" ? { x: s.cx - s.r, y: s.cy - s.r, w: 2 * s.r, h: 2 * s.r }
      : { x: Math.min(s.x1, s.x2), y: Math.min(s.y1, s.y2), w: Math.abs(s.x2 - s.x1), h: Math.abs(s.y2 - s.y1) };
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w - E && b.x < a.x + a.w - E && a.y < b.y + b.h - E && b.y < a.y + a.h - E;

let seed = 5;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const briefs: Requirements[] = Array.from({ length: 40 }, () => ({
  plotWidth: Math.round(9 + rnd() * 20), plotDepth: Math.round(14 + rnd() * 24),
  facing: pick(["N", "E", "S", "W", "NE", "SW"]), floors: pick([1, 2, 2, 3]),
  bedrooms: 1 + Math.floor(rnd() * 4), bathrooms: 1 + Math.floor(rnd() * 3),
  parking: pick([0, 1]) as Requirements["parking"], balconies: pick([0, 1, 2]),
  vastu: rnd() < 0.7, garden: false, pool: false, homeOffice: rnd() < 0.3,
  budget: pick(["economy", "standard", "premium", "luxury"]), style: "modern",
  luxury: (1 + Math.floor(rnd() * 5)) as Requirements["luxury"],
}));
const plans = briefs.map(generatePlan);
const rooms = plans.flatMap((p) => p.floors.flatMap((f) => f.rooms.map((r) => ({ r, f }))));

describe("furniture", () => {
  it("stays inside its room", () => {
    for (const { r, f } of rooms) {
      for (const s of furnish(r, f.doors, f.windows)) {
        const b = box(s);
        expect(b.x >= r.x - E && b.y >= r.y - E && b.x + b.w <= r.x + r.w + E && b.y + b.h <= r.y + r.h + E,
          `${r.label} ${s.kind}`).toBe(true);
      }
    }
  });

  it("keeps door swings and openings clear", () => {
    for (const { r, f } of rooms) {
      const zones = doorClearances(r, f.doors);
      for (const s of furnish(r, f.doors, f.windows)) {
        for (const z of zones) expect(overlap(box(s), z), `${r.label} blocks a door`).toBe(false);
      }
    }
  });

  it("almost always fits a bed in a bedroom and a counter in a kitchen", () => {
    const beds = rooms.filter(({ r }) => r.type === "bedroom" || r.type === "master_bedroom");
    const withBed = beds.filter(({ r, f }) => furnish(r, f.doors, f.windows)
      .some((s) => s.kind === "rect" && Math.max(s.w, s.h) >= 1.85 && Math.min(s.w, s.h) >= 0.9));
    expect(withBed.length / beds.length).toBeGreaterThan(0.9);

    const kitchens = rooms.filter(({ r }) => r.type === "kitchen");
    const withCounter = kitchens.filter(({ r, f }) => furnish(r, f.doors, f.windows)
      .some((s) => s.kind === "rect" && Math.min(s.w, s.h) > 0.55 && Math.min(s.w, s.h) < 0.65 && Math.max(s.w, s.h) >= 1.15));
    expect(withCounter.length / kitchens.length).toBeGreaterThan(0.9);
  });
});
