import pytest
from app.services.polygon_ops import (
    signed_area,
    polygon_area,
    ensure_ccw,
    polygon_centroid,
    polygon_bbox,
    rect_to_polygon,
    is_convex,
    point_in_polygon,
    inset_polygon,
    clip_polygon,
    subdivide_polygon,
    split_polygon_by_line,
    polygon_edges,
    edge_on_boundary,
    Rect,
)

# ── Test shapes ──
SQUARE = [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)]
TRIANGLE = [(5.0, 0.0), (10.0, 10.0), (0.0, 10.0)]
TRAPEZOID = [(2.0, 0.0), (8.0, 0.0), (10.0, 10.0), (0.0, 10.0)]
L_SHAPE = [(0.0, 0.0), (6.0, 0.0), (6.0, 4.0), (4.0, 4.0), (4.0, 10.0), (0.0, 10.0)]

def test_signed_area():
    assert signed_area(SQUARE) == pytest.approx(100.0)
    assert signed_area(TRIANGLE) == pytest.approx(50.0)

def test_polygon_area():
    assert polygon_area(SQUARE) == pytest.approx(100.0)
    assert polygon_area(TRIANGLE) == pytest.approx(50.0)
    assert polygon_area(TRAPEZOID) == pytest.approx(80.0)

def test_ensure_ccw():
    cw = list(reversed(SQUARE))
    assert signed_area(cw) < 0.0
    fixed = ensure_ccw(cw)
    assert signed_area(fixed) > 0.0

def test_polygon_centroid():
    cx, cy = polygon_centroid(SQUARE)
    assert cx == pytest.approx(5.0)
    assert cy == pytest.approx(5.0)

def test_polygon_bbox():
    bb = polygon_bbox(TRIANGLE)
    assert bb.x == pytest.approx(0.0)
    assert bb.y == pytest.approx(0.0)
    assert bb.w == pytest.approx(10.0)
    assert bb.h == pytest.approx(10.0)

def test_rect_to_polygon():
    poly = rect_to_polygon(Rect(1.0, 2.0, 3.0, 4.0))
    assert len(poly) == 4
    assert polygon_area(poly) == pytest.approx(12.0)

def test_is_convex():
    assert is_convex(SQUARE) is True
    assert is_convex(TRIANGLE) is True
    assert is_convex(TRAPEZOID) is True
    assert is_convex(L_SHAPE) is False

def test_point_in_polygon():
    assert point_in_polygon((5.0, 5.0), SQUARE) is True
    assert point_in_polygon((5.0, 8.0), TRIANGLE) is True
    assert point_in_polygon((15.0, 5.0), SQUARE) is False
    assert point_in_polygon((0.0, 0.0), TRIANGLE) is False

def test_inset_polygon():
    inset = inset_polygon(SQUARE, 1.0)
    assert len(inset) == 4
    # 10x10 inset by 1 on all sides -> 8x8 = 64
    assert polygon_area(inset) == pytest.approx(64.0, abs=0.5)

    inset_tri = inset_polygon(TRIANGLE, 1.0)
    assert len(inset_tri) >= 3
    assert polygon_area(inset_tri) < polygon_area(TRIANGLE)
    assert polygon_area(inset_tri) > 0.0

def test_clip_polygon():
    clip = [(2.0, 2.0), (8.0, 2.0), (8.0, 8.0), (2.0, 8.0)]
    result = clip_polygon(SQUARE, clip)
    assert len(result) == 4
    assert polygon_area(result) == pytest.approx(36.0)

    clip_h = [(0.0, 0.0), (10.0, 0.0), (10.0, 5.0), (0.0, 5.0)]
    result_tri = clip_polygon(TRIANGLE, clip_h)
    assert len(result_tri) >= 3
    assert polygon_area(result_tri) > 0.0
    assert polygon_area(result_tri) < polygon_area(TRIANGLE)

def test_subdivide_polygon():
    parts = subdivide_polygon(SQUARE, [1.0, 1.0], "y")
    assert len(parts) == 2
    a1 = polygon_area(parts[0])
    a2 = polygon_area(parts[1])
    assert a1 + a2 == pytest.approx(100.0, abs=0.5)
    assert abs(a1 - a2) < 5.0

    parts_w = subdivide_polygon(SQUARE, [2.0, 1.0, 1.0], "y")
    assert len(parts_w) == 3
    total = sum(polygon_area(p) for p in parts_w)
    assert total == pytest.approx(100.0, abs=0.5)

    parts_tri = subdivide_polygon(TRIANGLE, [1.0, 1.0], "y")
    assert len(parts_tri) == 2
    total_tri = sum(polygon_area(p) for p in parts_tri)
    assert total_tri == pytest.approx(50.0, abs=0.5)

    parts_trap = subdivide_polygon(TRAPEZOID, [1.0, 1.0], "y")
    assert len(parts_trap) == 2
    total_trap = sum(polygon_area(p) for p in parts_trap)
    assert total_trap == pytest.approx(80.0, abs=0.5)

    single = subdivide_polygon(SQUARE, [1.0])
    assert len(single) == 1
    assert polygon_area(single[0]) == pytest.approx(100.0)

def test_split_polygon_by_line():
    top, bottom = split_polygon_by_line(SQUARE, "y", 5.0)
    assert polygon_area(top) == pytest.approx(50.0, abs=0.5)
    assert polygon_area(bottom) == pytest.approx(50.0, abs=0.5)

    left, right = split_polygon_by_line(SQUARE, "x", 5.0)
    assert polygon_area(left) == pytest.approx(50.0, abs=0.5)
    assert polygon_area(right) == pytest.approx(50.0, abs=0.5)

def test_edge_utilities():
    edges = polygon_edges(SQUARE)
    assert len(edges) == 4
    assert edges[0].length == pytest.approx(10.0)

    # Bottom edge of square is on the boundary
    assert edge_on_boundary(0.0, 0.0, 10.0, 0.0, SQUARE) is True
    # Interior edge is not
    assert edge_on_boundary(3.0, 3.0, 7.0, 3.0, SQUARE) is False
