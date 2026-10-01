import { describe, expect, it } from "vitest";
import {
  signedArea,
  polygonArea,
  ensureCCW,
  polygonCentroid,
  polygonBBox,
  rectToPolygon,
  isConvex,
  pointInPolygon,
  insetPolygon,
  clipPolygon,
  subdividePolygon,
  splitPolygonByLine,
  polygonEdges,
  edgeOnBoundary,
} from "./polygon-ops";
import type { Polygon } from "./types";

// ── Test shapes ──
const SQUARE: Polygon = [[0, 0], [10, 0], [10, 10], [0, 10]];
const TRIANGLE: Polygon = [[5, 0], [10, 10], [0, 10]];
const TRAPEZOID: Polygon = [[2, 0], [8, 0], [10, 10], [0, 10]];
const L_SHAPE: Polygon = [[0, 0], [6, 0], [6, 4], [4, 4], [4, 10], [0, 10]];

describe("polygon-ops basics", () => {
  it("computes signed area (CCW = positive)", () => {
    expect(signedArea(SQUARE)).toBeCloseTo(100);
    expect(signedArea(TRIANGLE)).toBeCloseTo(50);
  });

  it("computes unsigned area", () => {
    expect(polygonArea(SQUARE)).toBeCloseTo(100);
    expect(polygonArea(TRIANGLE)).toBeCloseTo(50);
    expect(polygonArea(TRAPEZOID)).toBeCloseTo(80);
  });

  it("ensures CCW winding", () => {
    const cw: Polygon = [...SQUARE].reverse();
    expect(signedArea(cw)).toBeLessThan(0);
    const fixed = ensureCCW(cw);
    expect(signedArea(fixed)).toBeGreaterThan(0);
  });

  it("computes centroid", () => {
    const [cx, cy] = polygonCentroid(SQUARE);
    expect(cx).toBeCloseTo(5);
    expect(cy).toBeCloseTo(5);
  });

  it("computes bounding box", () => {
    const bb = polygonBBox(TRIANGLE);
    expect(bb.x).toBeCloseTo(0);
    expect(bb.y).toBeCloseTo(0);
    expect(bb.w).toBeCloseTo(10);
    expect(bb.h).toBeCloseTo(10);
  });

  it("converts rect to polygon", () => {
    const poly = rectToPolygon({ x: 1, y: 2, w: 3, h: 4 });
    expect(poly).toHaveLength(4);
    expect(polygonArea(poly)).toBeCloseTo(12);
  });

  it("detects convexity", () => {
    expect(isConvex(SQUARE)).toBe(true);
    expect(isConvex(TRIANGLE)).toBe(true);
    expect(isConvex(TRAPEZOID)).toBe(true);
    expect(isConvex(L_SHAPE)).toBe(false);
  });
});

describe("point-in-polygon", () => {
  it("detects inside points", () => {
    expect(pointInPolygon([5, 5], SQUARE)).toBe(true);
    expect(pointInPolygon([5, 8], TRIANGLE)).toBe(true);
  });

  it("rejects outside points", () => {
    expect(pointInPolygon([15, 5], SQUARE)).toBe(false);
    expect(pointInPolygon([0, 0], TRIANGLE)).toBe(false);
  });
});

describe("polygon inset", () => {
  it("shrinks a square polygon", () => {
    const inset = insetPolygon(SQUARE, 1);
    expect(inset.length).toBe(4);
    const area = polygonArea(inset);
    // 10×10 inset by 1 on all sides → 8×8 = 64
    expect(area).toBeCloseTo(64, 0);
  });

  it("shrinks a triangle polygon", () => {
    const inset = insetPolygon(TRIANGLE, 1);
    expect(inset.length).toBeGreaterThanOrEqual(3);
    expect(polygonArea(inset)).toBeLessThan(polygonArea(TRIANGLE));
    expect(polygonArea(inset)).toBeGreaterThan(0);
  });
});

describe("clipPolygon (Sutherland-Hodgman)", () => {
  it("clips a square to a smaller square", () => {
    const clip: Polygon = [[2, 2], [8, 2], [8, 8], [2, 8]];
    const result = clipPolygon(SQUARE, clip);
    expect(result.length).toBe(4);
    expect(polygonArea(result)).toBeCloseTo(36);
  });

  it("clips a triangle to a square", () => {
    const clip: Polygon = [[0, 0], [10, 0], [10, 5], [0, 5]];
    const result = clipPolygon(TRIANGLE, clip);
    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(polygonArea(result)).toBeGreaterThan(0);
    expect(polygonArea(result)).toBeLessThan(polygonArea(TRIANGLE));
  });
});

describe("subdividePolygon", () => {
  it("splits a square into two equal halves (Y axis)", () => {
    const parts = subdividePolygon(SQUARE, [1, 1], "y");
    expect(parts).toHaveLength(2);
    const a1 = polygonArea(parts[0]);
    const a2 = polygonArea(parts[1]);
    expect(a1 + a2).toBeCloseTo(100, 0);
    expect(Math.abs(a1 - a2)).toBeLessThan(5);
  });

  it("splits a square into three weighted pieces", () => {
    const parts = subdividePolygon(SQUARE, [2, 1, 1], "y");
    expect(parts).toHaveLength(3);
    const total = parts.reduce((s, p) => s + polygonArea(p), 0);
    expect(total).toBeCloseTo(100, 0);
  });

  it("splits a triangle into two pieces", () => {
    const parts = subdividePolygon(TRIANGLE, [1, 1], "y");
    expect(parts).toHaveLength(2);
    const total = parts.reduce((s, p) => s + polygonArea(p), 0);
    expect(total).toBeCloseTo(50, 0);
  });

  it("splits a trapezoid into two pieces", () => {
    const parts = subdividePolygon(TRAPEZOID, [1, 1], "y");
    expect(parts).toHaveLength(2);
    const total = parts.reduce((s, p) => s + polygonArea(p), 0);
    expect(total).toBeCloseTo(80, 0);
  });

  it("returns the original polygon for a single weight", () => {
    const parts = subdividePolygon(SQUARE, [1]);
    expect(parts).toHaveLength(1);
    expect(polygonArea(parts[0])).toBeCloseTo(100);
  });
});

describe("splitPolygonByLine", () => {
  it("splits a square horizontally", () => {
    const [top, bottom] = splitPolygonByLine(SQUARE, "y", 5);
    expect(polygonArea(top)).toBeCloseTo(50, 0);
    expect(polygonArea(bottom)).toBeCloseTo(50, 0);
  });

  it("splits a square vertically", () => {
    const [left, right] = splitPolygonByLine(SQUARE, "x", 5);
    expect(polygonArea(left)).toBeCloseTo(50, 0);
    expect(polygonArea(right)).toBeCloseTo(50, 0);
  });
});

describe("edge utilities", () => {
  it("extracts edges from a polygon", () => {
    const edges = polygonEdges(SQUARE);
    expect(edges).toHaveLength(4);
    expect(edges[0].length).toBeCloseTo(10);
  });

  it("detects edges on boundary", () => {
    // Bottom edge of square is on the boundary of the same square.
    expect(edgeOnBoundary(0, 0, 10, 0, SQUARE)).toBe(true);
    // Interior edge is not on boundary.
    expect(edgeOnBoundary(3, 3, 7, 3, SQUARE)).toBe(false);
  });
});
