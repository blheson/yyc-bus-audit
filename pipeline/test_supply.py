"""Sanity checks for the supply analysis outputs.

Run after ingest_gtfs.py + supply.py:  .venv/bin/pytest test_supply.py
"""

import json

import pytest

from common import PUBLIC_DATA

# Calgary bounding box
LON_RANGE = (-114.6, -113.6)
LAT_RANGE = (50.7, 51.4)


@pytest.fixture(scope="module")
def supply():
    return json.loads((PUBLIC_DATA / "supply.json").read_text())


@pytest.fixture(scope="module")
def geojson():
    return json.loads((PUBLIC_DATA / "routes.geojson").read_text())


def test_system_vehicle_km_plausible(supply):
    wk = supply["system"]["weekday"]["bus_vehicle_km"]
    # Calgary bus fleet is ~800 vehicles; 50k-300k km/weekday is the sane band
    assert 50_000 < wk < 300_000
    assert supply["system"]["weekday"]["bus_vehicle_km"] > \
        supply["system"]["sunday"]["bus_vehicle_km"]


def test_every_served_route_has_headways(supply):
    for r in supply["routes"]:
        if r.get("weekday"):
            periods = r["weekday"]["periods"]
            assert periods, f"route {r['short_name']} has weekday trips but no periods"
            assert any(v["median_headway_min"] for v in periods.values() if v), \
                f"route {r['short_name']} has no computed headway in any period"


def test_route_1_midday_headway_matches_schedule(supply):
    """Pinned against raw stop_times: route 1 runs every 19 min midday."""
    r1 = next(r for r in supply["routes"] if r["short_name"] == "1")
    assert r1["weekday"]["periods"]["midday"]["median_headway_min"] == 19.0


def test_overlap_fractions_valid(supply):
    for o in supply["overlaps"]:
        assert 0 < o["fraction_a"] <= 1.0
        assert 0 < o["fraction_b"] <= 1.0
        assert o["overlap_km"] >= 3.0


def test_flags_consistent_with_headways(supply):
    for r in supply["routes"]:
        if "hourly_or_worse_midday" in (r.get("flags") or []):
            hw = r["weekday"]["periods"]["midday"]["median_headway_min"]
            assert hw >= 55


def test_geojson_covers_routes_within_calgary(geojson):
    assert len(geojson["features"]) > 140
    for f in geojson["features"]:
        for lon, lat in f["geometry"]["coordinates"]:
            assert LON_RANGE[0] < lon < LON_RANGE[1], f["properties"]["short_name"]
            assert LAT_RANGE[0] < lat < LAT_RANGE[1], f["properties"]["short_name"]


def test_speeds_plausible(supply):
    for r in supply["routes"]:
        wk = r.get("weekday")
        if wk:
            assert 5 < wk["avg_speed_kmh"] < 80, \
                f"route {r['short_name']} speed {wk['avg_speed_kmh']}"
