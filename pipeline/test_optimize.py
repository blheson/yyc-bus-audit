"""Constraint audit for the optimizer outputs.

Every guarantee the pitch makes is asserted here against the artifacts.
Run after optimize.py:  .venv/bin/python -m pytest test_optimize.py
"""

import json

import pandas as pd
import pytest

from common import DATA_PROCESSED, PUBLIC_DATA
from optimize import (ANNUAL_DAY_WEIGHTS, MAX_DEGRADATION, MAX_HEADWAY,
                      PTN_HEADWAY, POLICY_LOAD_FACTOR, RIDERSHIP_LOSS_BUDGET,
                      SEATED_CAPACITY)


@pytest.fixture(scope="module")
def result():
    return pd.read_parquet(DATA_PROCESSED / "optimized_headways.parquet")


@pytest.fixture(scope="module")
def opt():
    return json.loads((PUBLIC_DATA / "optimizer.json").read_text())


def test_headways_never_shorten(result):
    assert (result["new_headway_min"] >= result["headway_min"]).all()


def test_availability_never_worse_than_hourly(result):
    changed = result[result["new_headway_min"] != result["headway_min"]]
    assert (changed["new_headway_min"] <= MAX_HEADWAY).all()
    assert (changed["trips_new"] >= 1).all()


def test_hourly_or_worse_untouched(result):
    hourly = result[result["headway_min"] >= MAX_HEADWAY]
    assert (hourly["new_headway_min"] == hourly["headway_min"]).all()


def test_wait_time_at_most_doubles(result):
    assert (result["new_headway_min"]
            <= MAX_DEGRADATION * result["headway_min"] + 1e-6).all()


def test_frequent_network_protected(result):
    ptn = result[result["headway_min"] <= PTN_HEADWAY]
    assert (ptn["new_headway_min"] <= PTN_HEADWAY).all()


def test_capacity_policy_respected(result):
    for scenario, lf in POLICY_LOAD_FACTOR.items():
        changed = result[(result["scenario"] == scenario)
                         & (result["new_headway_min"] != result["headway_min"])]
        assert (changed["peak_load_new"]
                <= SEATED_CAPACITY * lf + 1e-6).all(), scenario


def test_fleet_never_grows(result):
    assert (result["trips_new"] <= result["trips"]).all()


def test_ridership_budget_respected(result):
    for scenario, budget in RIDERSHIP_LOSS_BUDGET.items():
        sc = result[result["scenario"] == scenario]
        w = sc["day"].map(ANNUAL_DAY_WEIGHTS)
        loss = float((sc["lost_boardings_day"] * w).sum())
        total = float((sc["boardings"] * w).sum())
        assert loss <= budget * total * 1.001, scenario


def test_scenario_savings_ordered(opt):
    s = opt["summary"]
    assert (s["conservative"]["saved_km_annual"]
            <= s["moderate"]["saved_km_annual"]
            <= s["aggressive"]["saved_km_annual"])


def test_savings_positive_but_sane(opt):
    supply = json.loads((PUBLIC_DATA / "supply.json").read_text())
    baseline = supply["system"]["annual"]["bus_vehicle_km"]
    for scenario, s in opt["summary"].items():
        assert 0 < s["saved_km_annual"] < 0.25 * baseline, \
            f"{scenario}: {s['saved_km_annual']} km/yr fails the smell test"


def test_savings_arithmetic_consistent(result, opt):
    cons = result[result["scenario"] == "conservative"]
    w = cons["day"].map(ANNUAL_DAY_WEIGHTS)
    annual = float((cons["saved_km_day"] * w).sum())
    assert abs(annual - opt["summary"]["conservative"]["saved_km_annual"]) < 1
