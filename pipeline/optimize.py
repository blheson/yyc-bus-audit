"""Frequency-setting optimizer: trade trips for fuel where modeled loads allow.

For every (route, period, day-type) cell, choose a headway from
ALLOWED_HEADWAYS no shorter than today's, maximizing vehicle-km saved
subject to:

- capacity: modeled peak load per trip (which grows proportionally as
  trips get sparser) stays within seated capacity x the scenario's
  load-factor policy;
- availability: no stop loses service in any period it has today; never
  worse than hourly; hourly-or-worse cells untouched;
- service standards: routes now at <=15 min stay <=15 (frequent-network
  promise), wait times at most double;
- ridership: modeled boardings lost to longer waits (headway elasticity,
  linear approx) stay within the scenario's system-wide budget. This is
  the binding constraint that turns "cut every thin route to the policy
  floor" into a real trade-off — CP-SAT solves the resulting knapsack of
  the most fuel-per-lost-rider-efficient changes.

Because headways never shorten, trips and vehicles needed can only
decrease, so the fleet constraint is satisfied by construction (and
asserted anyway).

Scenario pairing (see demand_model.SCENARIOS for the demand side):
conservative = high modeled loads + strict policy + tight ridership
budget -> the headline number; aggressive -> upper bound of opportunity.

Reads public/data/supply.json + data/processed/route_loads.parquet.
Writes data/processed/optimized_headways.parquet, public/data/optimizer.json
and prints a per-scenario summary.

Usage: python optimize.py
"""

import datetime as dt
import json

import pandas as pd
from ortools.sat.python import cp_model

from common import DATA_PROCESSED, PUBLIC_DATA, ensure_dirs

ALLOWED_HEADWAYS = [10, 12, 15, 20, 30, 45, 60]  # minutes
MAX_HEADWAY = 60          # availability floor: never worse than hourly
MIN_TRIPS_TO_OPTIMIZE = 4  # below this, a period keeps its schedule as-is
# Policy guardrails. The demand model is weakest exactly where the raw
# optimum concentrates (it under-ranks BRT/trunk demand), so headways are
# also bounded by service standards, not capacity alone:
PTN_HEADWAY = 15          # frequent-network promise: routes now <=15 min stay <=15
MAX_DEGRADATION = 2.0     # wait time may at most double
# Longer waits lose riders: standard headway elasticity of demand
# (-0.3..-0.5 in the literature; linear approximation, fine for <=2x).
# In range with TCRP Report 95 ch.9 (Evans, 2004; frequency elasticities
# ~0.26-0.5) and TRL Report 593 (Balcombe et al., 2004; 0.38 short-run
# bus average across 27 studies) -- not estimated from Calgary data.
# Each scenario caps the modeled system-wide ridership loss — this is the
# constraint that turns "cut everything thin" into a real trade-off.
ELASTICITY = 0.4
RIDERSHIP_LOSS_BUDGET = {"conservative": 0.02, "moderate": 0.035,
                         "aggressive": 0.05}
SEATED_CAPACITY = 55      # 40-ft bus
POLICY_LOAD_FACTOR = {"conservative": 0.8, "moderate": 1.0, "aggressive": 1.25}
DIESEL_L_PER_KM = 0.5     # keep in sync with supply.py
CO2_KG_PER_L = 2.68
DIESEL_PRICE_PER_L = 1.65  # CAD, placeholder pump-price average
ANNUAL_DAY_WEIGHTS = {"weekday": 255, "saturday": 52, "sunday": 58}


def build_cells(supply: dict, loads: pd.DataFrame, scenario: str) -> pd.DataFrame:
    """One row per optimizable (route, day, period): current headway,
    trips, km per trip, and modeled peak load at current frequency."""
    sc = loads[loads["scenario"] == scenario]
    sc = sc[sc["trips"].notna() & (sc["trips"] > 0)]
    rows = []
    for r in supply["routes"]:
        if not r["is_bus"]:
            continue
        for day in ANNUAL_DAY_WEIGHTS:
            day_stats = r.get(day)
            if not day_stats:
                continue
            for period, p in (day_stats.get("periods") or {}).items():
                if not p or not p.get("median_headway_min"):
                    continue
                m = sc[(sc["route_id"] == r["route_id"])
                       & (sc["day"] == day) & (sc["period"] == period)]
                if m.empty:
                    continue
                rows.append({
                    "route_id": r["route_id"],
                    "short_name": r["short_name"],
                    "day": day,
                    "period": period,
                    "headway_min": float(p["median_headway_min"]),
                    "trips": int(m["trips"].iloc[0]),
                    "avg_trip_km": float(day_stats["avg_trip_km"]),
                    "peak_load": float(m["peak_load_per_trip"].iloc[0]),
                    "boardings": float(m["boardings"].iloc[0]),
                })
    return pd.DataFrame(rows)


def optimize_scenario(cells: pd.DataFrame, scenario: str) -> pd.DataFrame:
    """Pick a headway per cell with CP-SAT, minimizing vehicle-km."""
    cap = SEATED_CAPACITY * POLICY_LOAD_FACTOR[scenario]
    model = cp_model.CpModel()
    # per cell: (headway, saved_km/day, lost_boardings/day, boolvar)
    choices: list[list[tuple]] = []

    for _, c in cells.iterrows():
        h_cur = c["headway_min"]
        vkm_cur = c["trips"] * c["avg_trip_km"]
        options = [(h_cur, 0.0, 0.0)]  # keep-current is always feasible
        # Hourly-or-worse routes are untouched, and cells with a handful of
        # trips keep their schedule — headway scaling is meaningless there.
        if h_cur < MAX_HEADWAY and c["trips"] >= MIN_TRIPS_TO_OPTIMIZE:
            h_ceiling = min(MAX_HEADWAY, MAX_DEGRADATION * h_cur)
            if h_cur <= PTN_HEADWAY:
                h_ceiling = min(h_ceiling, PTN_HEADWAY)
            for h in ALLOWED_HEADWAYS:
                if h <= h_cur or h > h_ceiling:
                    continue
                # demand concentrates on fewer trips as headway lengthens
                if c["peak_load"] * (h / h_cur) > cap:
                    continue
                if c["trips"] * h_cur / h < 1:
                    continue
                saved = vkm_cur * (1 - h_cur / h)
                lost = c["boardings"] * ELASTICITY * (h / h_cur - 1)
                options.append((float(h), saved, min(lost, c["boardings"])))
        bools = [model.NewBoolVar(f"c{len(choices)}_h{h}")
                 for h, _, _ in options]
        model.AddExactlyOne(bools)
        choices.append([(h, s, l, b)
                        for (h, s, l), b in zip(options, bools)])

    # Ridership-loss budget, annualized across day types
    day_w = cells["day"].map(ANNUAL_DAY_WEIGHTS).to_numpy()
    total_boardings = float((cells["boardings"] * day_w).sum())
    budget = RIDERSHIP_LOSS_BUDGET[scenario] * total_boardings
    model.Add(sum(int(l * w * 100) * b
                  for cell, w in zip(choices, day_w)
                  for _, _, l, b in cell) <= int(budget * 100))

    model.Maximize(sum(int(s * 1000) * b
                       for cell in choices for _, s, _, b in cell))
    solver = cp_model.CpSolver()
    status = solver.Solve(model)
    assert status in (cp_model.OPTIMAL, cp_model.FEASIBLE), \
        f"solver status {solver.StatusName(status)}"

    picked = []
    for cell in choices:
        sel = [(h, s, l) for h, s, l, b in cell if solver.Value(b)]
        assert len(sel) == 1
        picked.append(sel[0])

    out = cells.copy()
    out["scenario"] = scenario
    out["new_headway_min"] = [h for h, _, _ in picked]
    out["saved_km_day"] = [s for _, s, _ in picked]
    out["lost_boardings_day"] = [l for _, _, l in picked]
    out["trips_new"] = (out["trips"]
                        * out["headway_min"] / out["new_headway_min"]).round(1)
    out["peak_load_new"] = (out["peak_load"]
                            * out["new_headway_min"] / out["headway_min"])

    # --- constraint audit (the guarantees, checked, not assumed) ---
    cap_ok = out["peak_load_new"] <= cap + 1e-6
    keep = out["new_headway_min"] == out["headway_min"]
    assert (cap_ok | keep).all(), "capacity violated on a changed cell"
    assert (out["new_headway_min"] >= out["headway_min"]).all()
    assert ((out["new_headway_min"] <= MAX_HEADWAY) | keep).all()
    assert (out["trips_new"] <= out["trips"]).all(), "fleet/trips increased"
    assert (out["trips_new"] >= 1).all(), "a served cell lost all service"
    hourly_plus = out["headway_min"] >= MAX_HEADWAY
    assert (out.loc[hourly_plus, "new_headway_min"]
            == out.loc[hourly_plus, "headway_min"]).all(), \
        "hourly-or-worse route was cut"
    assert (out["new_headway_min"]
            <= MAX_DEGRADATION * out["headway_min"] + 1e-6).all(), \
        "wait time more than doubled"
    ptn = out["headway_min"] <= PTN_HEADWAY
    assert (out.loc[ptn, "new_headway_min"] <= PTN_HEADWAY).all(), \
        "frequent-network promise broken"
    lost_annual = float((out["lost_boardings_day"] * day_w).sum())
    assert lost_annual <= budget * 1.001, "ridership-loss budget exceeded"
    return out


def annualize(result: pd.DataFrame) -> dict:
    per_day = result.groupby("day")["saved_km_day"].sum()
    annual_km = sum(per_day.get(d, 0.0) * w for d, w in ANNUAL_DAY_WEIGHTS.items())
    litres = annual_km * DIESEL_L_PER_KM
    return {
        "saved_km_annual": round(annual_km),
        "saved_diesel_l": round(litres),
        "saved_co2_t": round(litres * CO2_KG_PER_L / 1000),
        "saved_cad": round(litres * DIESEL_PRICE_PER_L),
    }


def main() -> None:
    ensure_dirs()
    supply = json.loads((PUBLIC_DATA / "supply.json").read_text())
    loads = pd.read_parquet(DATA_PROCESSED / "route_loads.parquet")
    baseline_annual_km = supply["system"]["annual"]["bus_vehicle_km"]

    results, summary = [], {}
    for scenario in POLICY_LOAD_FACTOR:
        cells = build_cells(supply, loads, scenario)
        res = optimize_scenario(cells, scenario)
        results.append(res)
        s = annualize(res)
        s["pct_of_baseline"] = round(100 * s["saved_km_annual"]
                                     / baseline_annual_km, 2)
        s["cells_changed"] = int((res["new_headway_min"]
                                  != res["headway_min"]).sum())
        s["cells_total"] = len(res)
        day_w = res["day"].map(ANNUAL_DAY_WEIGHTS)
        s["ridership_loss_pct"] = round(
            100 * float((res["lost_boardings_day"] * day_w).sum())
            / float((res["boardings"] * day_w).sum()), 2)
        summary[scenario] = s
        print(f"{scenario:>13}: {s['saved_km_annual']:,} km/yr "
              f"({s['pct_of_baseline']}%), {s['saved_diesel_l']:,} L, "
              f"{s['saved_co2_t']:,} t CO2, ${s['saved_cad']:,}/yr, "
              f"ridership impact -{s['ridership_loss_pct']}% "
              f"[{s['cells_changed']}/{s['cells_total']} cells changed]")

    result = pd.concat(results, ignore_index=True)
    result.to_parquet(DATA_PROCESSED / "optimized_headways.parquet", index=False)

    # per-route annual savings (conservative), for the app + findings
    cons = result[result["scenario"] == "conservative"].copy()
    cons["saved_km_annual"] = cons.apply(
        lambda r: r["saved_km_day"] * ANNUAL_DAY_WEIGHTS[r["day"]], axis=1)
    by_route = (cons.groupby(["route_id", "short_name"])["saved_km_annual"]
                .sum().sort_values(ascending=False).reset_index())

    changes = [
        {"route": r["short_name"], "day": r["day"], "period": r["period"],
         "headway": r["headway_min"], "new_headway": r["new_headway_min"],
         "peak_load": round(r["peak_load"], 1),
         "peak_load_new": round(r["peak_load_new"], 1),
         "saved_km_day": round(r["saved_km_day"], 1),
         "lost_boardings_day": round(r["lost_boardings_day"], 1)}
        for _, r in cons[cons["new_headway_min"] != cons["headway_min"]]
        .sort_values("saved_km_day", ascending=False).iterrows()
    ]
    payload = {
        "generated": dt.datetime.now().isoformat(timespec="seconds"),
        "assumptions": {
            "allowed_headways_min": ALLOWED_HEADWAYS,
            "max_headway_min": MAX_HEADWAY,
            "ptn_headway_min": PTN_HEADWAY,
            "max_degradation": MAX_DEGRADATION,
            "min_trips_to_optimize": MIN_TRIPS_TO_OPTIMIZE,
            "seated_capacity": SEATED_CAPACITY,
            "policy_load_factor": POLICY_LOAD_FACTOR,
            "diesel_l_per_km": DIESEL_L_PER_KM,
            "diesel_price_cad_per_l": DIESEL_PRICE_PER_L,
            "baseline_annual_bus_km": baseline_annual_km,
        },
        "summary": summary,
        "route_savings_conservative": [
            {"route": r["short_name"], "saved_km_annual": round(r["saved_km_annual"])}
            for _, r in by_route.head(30).iterrows() if r["saved_km_annual"] > 0
        ],
        "changes_conservative": changes,
    }
    out = PUBLIC_DATA / "optimizer.json"
    out.write_text(json.dumps(payload, indent=1, allow_nan=False))
    print(f"\nwrote {out} and optimized_headways.parquet ({len(result)} rows)")

    print("\ntop conservative-scenario changes:")
    for c in changes[:10]:
        print(f"  route {c['route']:>4} {c['day']:<8} {c['period']:<9} "
              f"{c['headway']:.0f} -> {c['new_headway']:.0f} min "
              f"(load {c['peak_load']} -> {c['peak_load_new']}), "
              f"saves {c['saved_km_day']} km/day")


if __name__ == "__main__":
    main()
