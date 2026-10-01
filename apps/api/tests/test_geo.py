import math

import pytest

from app.services.geo import (
    area_sqm,
    bearing_to_facing,
    compute,
    is_self_intersecting,
    principal_dims,
    validate,
)

EARTH_R = 6378137.0
D2R = math.pi / 180
ORIGIN = (12.97, 77.59)


def pt(east: float, north: float):
    return (
        ORIGIN[0] + north / EARTH_R / D2R,
        ORIGIN[1] + east / (EARTH_R * math.cos(ORIGIN[0] * D2R)) / D2R,
    )


# 20 m (E-W) x 40 m (N-S) rectangle
RECT = [pt(0, 0), pt(20, 0), pt(20, 40), pt(0, 40)]


def geojson(points):
    ring = [[lng, lat] for lat, lng in points]
    ring.append(ring[0])
    return {"type": "Polygon", "coordinates": [ring]}


def test_area_matches_analytic():
    assert area_sqm(RECT) == pytest.approx(800, rel=0.01)


def test_principal_dims():
    length, width, _ = principal_dims(RECT)
    assert length == pytest.approx(40, abs=0.5)
    assert width == pytest.approx(20, abs=0.5)


def test_facing_octants():
    assert bearing_to_facing(0) == "N"
    assert bearing_to_facing(90) == "E"
    assert bearing_to_facing(225) == "SW"


def test_self_intersection_detected():
    bowtie = [pt(0, 0), pt(20, 20), pt(20, 0), pt(0, 20)]
    assert is_self_intersecting(bowtie) is True
    assert validate(bowtie) is not None


def test_valid_rectangle():
    assert validate(RECT) is None


def test_compute_full_payload():
    m = compute(geojson(RECT))
    assert m["area_sqm"] == pytest.approx(800, rel=0.01)
    assert m["area_sqft"] == pytest.approx(800 * 10.7639, rel=0.01)
    assert m["facing"] in ("N", "S")
    assert m["latitude"] == pytest.approx(ORIGIN[0], abs=1e-3)


def test_compute_rejects_bad_polygon():
    with pytest.raises(ValueError):
        compute(geojson([pt(0, 0), pt(10, 0)]))
