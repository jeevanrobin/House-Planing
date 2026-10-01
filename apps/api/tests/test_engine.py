import pytest

from app.services.floorplan import generate_plan, to_flat

REQ = dict(plotWidth=12, plotDepth=18, facing="N", floors=2, bedrooms=4,
           bathrooms=3, parking=1, balconies=2, vastu=True, garden=False,
           pool=False, homeOffice=True, budget="premium", style="modern", luxury=4)


def overlap(a, b):
    ox = max(0, min(a["x"] + a["w"], b["x"] + b["w"]) - max(a["x"], b["x"]))
    oy = max(0, min(a["y"] + a["h"], b["y"] + b["h"]) - max(a["y"], b["y"]))
    return ox * oy


def adjacent(a, b):
    t = 0.06
    v_shared = min(a["y"] + a["h"], b["y"] + b["h"]) - max(a["y"], b["y"]) > 0.5
    h_shared = min(a["x"] + a["w"], b["x"] + b["w"]) - max(a["x"], b["x"]) > 0.5
    v_touch = abs(a["x"] + a["w"] - b["x"]) < t or abs(b["x"] + b["w"] - a["x"]) < t
    h_touch = abs(a["y"] + a["h"] - b["y"]) < t or abs(b["y"] + b["h"] - a["y"]) < t
    return (v_touch and v_shared) or (h_touch and h_shared)


def test_floors_have_rooms_doors_windows_walls():
    plan = generate_plan(REQ)
    for f in plan["floors"]:
        assert len(f["rooms"]) > 3
        assert len(f["walls"]) > 4
        assert len(f["doors"]) > 0
        assert len(f["windows"]) > 0


def test_no_overlap_and_fills_footprint():
    plan = generate_plan(REQ)
    for f in plan["floors"]:
        rooms = f["rooms"]
        for i in range(len(rooms)):
            for j in range(i + 1, len(rooms)):
                assert overlap(rooms[i], rooms[j]) < 0.05
        total = sum(r["w"] * r["h"] for r in rooms)
        fp = f["footprint"]
        assert total == pytest.approx(fp["w"] * fp["h"], abs=0.5)


def test_attached_bath_adjacent_to_bedroom():
    plan = generate_plan(REQ)
    for f in plan["floors"]:
        beds = [r for r in f["rooms"] if r["type"] in ("bedroom", "master_bedroom")]
        baths = [r for r in f["rooms"] if r["type"] == "bathroom" and not r["label"].startswith("Common")]
        for bath in baths:
            assert any(adjacent(bath, bed) for bed in beds)


def test_exterior_shell_on_all_sides():
    f = generate_plan(REQ)["floors"][0]
    fp = f["footprint"]
    ext = [w for w in f["walls"] if w["type"] == "exterior"]

    def near(a, b):
        return abs(a - b) < 0.05
    assert any(w["orientation"] == "v" and near(w["x1"], fp["x"]) for w in ext)
    assert any(w["orientation"] == "v" and near(w["x1"], fp["x"] + fp["w"]) for w in ext)
    assert any(w["orientation"] == "h" and near(w["y1"], fp["y"]) for w in ext)
    assert any(w["orientation"] == "h" and near(w["y1"], fp["y"] + fp["h"]) for w in ext)


def test_to_flat_structure_in_feet():
    f = generate_plan(REQ)["floors"][0]
    flat = to_flat(f)
    assert flat["unit"] == "ft"
    assert {"name", "width", "height", "x", "y", "area"} <= set(flat["rooms"][0])
    assert {"x1", "y1", "x2", "y2", "type", "thickness"} <= set(flat["walls"][0])


POLY_BASE = dict(
    plotWidth=12.0, plotDepth=18.0, facing="N", floors=1,
    bedrooms=2, bathrooms=2, parking=0, balconies=0,
    vastu=False, garden=False, pool=False, homeOffice=False,
    budget="standard", style="modern", luxury=3
)


def test_polygon_mode_rectangle_regression():
    rect_poly = [(0.0, 0.0), (12.0, 0.0), (12.0, 18.0), (0.0, 18.0)]
    req = POLY_BASE.copy()
    req["plotPolygon"] = rect_poly
    plan = generate_plan(req)
    assert "plotPolygon" in plan
    assert len(plan["floors"]) == 1
    f = plan["floors"][0]
    assert len(f["rooms"]) > 3
    assert "footprintPolygon" in f
    for r in f["rooms"]:
        assert "polygon" in r
        assert len(r["polygon"]) >= 3


def test_polygon_mode_triangle():
    triangle = [(6.0, 0.0), (12.0, 18.0), (0.0, 18.0)]
    req = POLY_BASE.copy()
    req["plotPolygon"] = triangle
    plan = generate_plan(req)
    f = plan["floors"][0]
    assert len(f["rooms"]) > 3
    fp_bbox = f["footprint"]
    for r in f["rooms"]:
        assert r["x"] >= fp_bbox["x"] - 0.5
        assert r["y"] >= fp_bbox["y"] - 0.5
        assert r["x"] + r["w"] <= fp_bbox["x"] + fp_bbox["w"] + 0.5
        assert r["y"] + r["h"] <= fp_bbox["y"] + fp_bbox["h"] + 0.5


def test_polygon_mode_trapezoid():
    trapezoid = [(3.0, 0.0), (9.0, 0.0), (12.0, 18.0), (0.0, 18.0)]
    req = POLY_BASE.copy()
    req["plotPolygon"] = trapezoid
    plan = generate_plan(req)
    f = plan["floors"][0]
    assert len(f["rooms"]) > 3
    assert len(f["walls"]) > 0
    assert len(f["doors"]) > 0


def test_polygon_mode_l_shape():
    l_shape = [(0.0, 0.0), (12.0, 0.0), (12.0, 8.0), (6.0, 8.0), (6.0, 18.0), (0.0, 18.0)]
    req = POLY_BASE.copy()
    req["plotPolygon"] = l_shape
    plan = generate_plan(req)
    f = plan["floors"][0]
    assert len(f["rooms"]) > 3


def test_polygon_mode_fallback():
    plan = generate_plan(POLY_BASE)
    assert "plotPolygon" not in plan
    f = plan["floors"][0]
    for r in f["rooms"]:
        assert "polygon" not in r


def test_constraint_fulfillment():
    req = REQ.copy()
    req["pool"] = True
    req["balconies"] = 2
    plan = generate_plan(req)
    assert plan["validation"]["ok"] is True
    gf_rooms = plan["floors"][0]["rooms"]
    assert any(r["type"] == "pool" for r in gf_rooms)
    ff_rooms = plan["floors"][1]["rooms"]
    assert any(r["type"] == "balcony" for r in ff_rooms)
    assert plan["summary"]["vastuScore"] >= 50


def test_validation_fails_on_tight_plot():
    req = REQ.copy()
    req["plotWidth"] = 5.0
    req["plotDepth"] = 5.0
    req["bedrooms"] = 5
    req["bathrooms"] = 5
    req["pool"] = True
    plan = generate_plan(req)
    assert plan["validation"]["ok"] is False
    assert len(plan["validation"]["errors"]) > 0

