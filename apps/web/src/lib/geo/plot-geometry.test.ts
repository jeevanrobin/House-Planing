import { describe, expect, it } from "vitest";
import {
  bearingToFacing,
  computePlotMetrics,
  isSelfIntersecting,
  polygonAreaSqm,
  principalDimensions,
  toGeoJSON,
  fromGeoJSON,
  validatePolygon,
  type LatLng,
} from "./plot-geometry";

const EARTH_R = 6378137;
const D2R = Math.PI / 180;
const ORIGIN = { lat: 12.97, lng: 77.59 };

/** Build a lat/lng point from local east/north metre offsets. */
function pt(east: number, north: number): LatLng {
  return {
    lat: ORIGIN.lat + north / EARTH_R / D2R,
    lng: ORIGIN.lng + east / (EARTH_R * Math.cos(ORIGIN.lat * D2R)) / D2R,
  };
}

// 20 m (E-W) × 40 m (N-S) rectangle.
const RECT: LatLng[] = [pt(0, 0), pt(20, 0), pt(20, 40), pt(0, 40)];

describe("plot geometry", () => {
  it("computes area within 0.5% of the analytic value", () => {
    const a = polygonAreaSqm(RECT);
    expect(a).toBeGreaterThan(800 * 0.995);
    expect(a).toBeLessThan(800 * 1.005);
  });

  it("derives length and width via PCA (longer = N-S side)", () => {
    const { lengthM, widthM } = principalDimensions(RECT);
    expect(lengthM).toBeCloseTo(40, 0);
    expect(widthM).toBeCloseTo(20, 0);
  });

  it("reports a North/South facing for an N-S elongated plot", () => {
    const { facing } = computePlotMetrics(RECT);
    expect(["N", "S"]).toContain(facing);
  });

  it("maps bearings to the nearest octant", () => {
    expect(bearingToFacing(0)).toBe("N");
    expect(bearingToFacing(90)).toBe("E");
    expect(bearingToFacing(135)).toBe("SE");
    expect(bearingToFacing(360)).toBe("N");
  });

  it("accepts a simple rectangle", () => {
    expect(validatePolygon(RECT)).toEqual({ ok: true });
  });

  it("rejects a self-intersecting bow-tie", () => {
    const bowtie: LatLng[] = [pt(0, 0), pt(20, 20), pt(20, 0), pt(0, 20)];
    expect(isSelfIntersecting(bowtie)).toBe(true);
    expect(validatePolygon(bowtie).ok).toBe(false);
  });

  it("rejects fewer than three points", () => {
    expect(validatePolygon([pt(0, 0), pt(10, 0)]).ok).toBe(false);
  });

  it("round-trips through GeoJSON (closed ring, lng/lat order)", () => {
    const geo = toGeoJSON(RECT);
    expect(geo.coordinates[0]).toHaveLength(RECT.length + 1); // closed
    expect(geo.coordinates[0][0]).toEqual([RECT[0].lng, RECT[0].lat]);
    const back = fromGeoJSON(geo);
    expect(back).toHaveLength(RECT.length);
    expect(back[0].lat).toBeCloseTo(RECT[0].lat, 9);
  });
});
