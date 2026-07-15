"""Sanity checks for the demand model outputs.

Run after ingest_demand.py + demand_model.py:  .venv/bin/pytest test_demand.py
"""

import json

import pandas as pd
import pytest

from common import DATA_PROCESSED, PUBLIC_DATA


@pytest.fixture(scope="module")
def demand():
    return json.loads((PUBLIC_DATA / "demand.json").read_text())


@pytest.fixture(scope="module")
def stops():
    return pd.read_parquet(DATA_PROCESSED / "stop_demand.parquet")


@pytest.fixture(scope="module")
def loads():
    return pd.read_parquet(DATA_PROCESSED / "route_loads.parquet")


def test_calibration_matches_published_total(demand):
    target = demand["assumptions"]["weekday_boardings_target"]
    modeled = demand["system"]["weekday_boardings"]
    assert abs(modeled - target) / target < 0.001


def test_weekday_target_plausible(demand):
    # Calgary bus boardings are ~200-260k/weekday in recent years
    assert 150_000 < demand["assumptions"]["weekday_boardings_target"] < 350_000


def test_stop_demand_clean(stops):
    for col in ("pop_400m", "pop_400m_eff", "transit_share",
                "dist_downtown_km", "weekday_boardings"):
        assert stops[col].notna().all(), col
        assert (stops[col] >= 0).all(), col
    assert 200 < stops["pop_400m"].median() < 20_000
    assert stops["transit_share"].between(0, 1).all()


def test_downtown_gravity_visible(stops):
    downtown = stops[stops["dist_downtown_km"] < 2]["weekday_boardings"]
    assert downtown.mean() > stops["weekday_boardings"].mean(), \
        "downtown stops should out-board the citywide average"


def test_scenarios_ordered(loads):
    wide = loads.pivot_table(index=["route_id", "day", "period"],
                             columns="scenario", values="peak_load_per_trip")
    wide = wide.dropna()
    assert (wide["conservative"] >= wide["moderate"]).all()
    assert (wide["moderate"] >= wide["aggressive"]).all()


def test_all_day_types_present(loads):
    assert set(loads["day"].unique()) == {"weekday", "saturday", "sunday"}


def test_every_weekday_bus_route_has_loads(loads):
    supply = json.loads((PUBLIC_DATA / "supply.json").read_text())
    weekday_bus = {r["route_id"] for r in supply["routes"]
                   if r["is_bus"] and r.get("weekday")}
    with_loads = set(loads[loads["day"] == "weekday"]["route_id"])
    missing = weekday_bus - with_loads
    assert not missing, f"bus routes without weekday loads: {sorted(missing)[:5]}"


def test_loads_positive_where_served(loads):
    served = loads[loads["trips"].notna() & (loads["trips"] > 0)]
    assert (served["boardings"] >= 0).all()
    assert served["boardings_per_trip"].notna().all()


def test_json_stop_layer_matches_parquet(demand, stops):
    assert len(demand["stops"]) == len(stops)
    total = sum(s["wd"] for s in demand["stops"])
    assert abs(total - demand["system"]["weekday_boardings"]) \
        / demand["system"]["weekday_boardings"] < 0.01
