"""Estimate bus boardings per stop per hour, calibrated to published totals.

No per-stop ridership is published for Calgary, so this is a *modeled*
estimate (a calibrated gravity model, not a trained regressor — there are
no labels to train on). Per-stop demand potential comes from land use:

    potential = pop_400m_eff * transit_share
                * (1 + G_DT * exp(-dist_downtown / LAMBDA_KM))
                * (1 + LRT_BONUS * is_lrt_feeder)

spread over the day with canonical transit demand curves, then scaled so
the citywide total matches Calgary Transit's published monthly
"Bus Boarding Passengers" (iema-jbc4, mean of the latest 12 months).

The open cordon counts are daily totals (no hourly table), so they inform
the downtown-attraction shape and serve as a sanity reference only.
Scenario ranges (conservative/moderate/aggressive) vary the peak-load
factor and curve peakiness; they are honesty bounds, not precision.

Reads data/processed/*.parquet (GTFS + ingest_demand.py outputs).
Writes data/processed/stop_demand.parquet, route_loads.parquet
and public/data/demand.json.

Usage: python demand_model.py
"""

import calendar as cal
import datetime as dt
import json

import numpy as np
import pandas as pd
import shapely
from shapely import STRtree
from shapely.geometry import Point

from common import DATA_PROCESSED, PUBLIC_DATA, WEEKDAY_PERIODS, ensure_dirs
from supply import (KM_PER_DEG_LAT, KM_PER_DEG_LON, SAMPLE_DATES, WEEKEND_PERIODS,
                    active_service_ids, assign_period, shape_lengths_km, trip_stats)

BUFFER_KM = 0.4          # walk-access catchment around a stop
LRT_FEEDER_KM = 0.6      # stop within this of an LRT station = feeder
G_DT = 1.5               # downtown attraction strength (employment proxy)
LAMBDA_KM = 3.0          # downtown attraction decay length
LRT_BONUS = 0.35         # extra boardings at LRT feeder stops (transfers)

# Peak-load factor: share of a trip's total boardings simultaneously on
# board at the peak-load point. Higher = fuller buses = less headroom for
# the optimizer, so "conservative" (for savings claims) uses the highest.
SCENARIOS = {
    "conservative": {"alpha": 0.55, "peakiness": 1.15},
    "moderate": {"alpha": 0.45, "peakiness": 1.0},
    "aggressive": {"alpha": 0.35, "peakiness": 0.85},
}

# Canonical hour-of-day boarding shares for a North American transit
# weekday (twin peaks) and weekend (single midday hump); normalized below.
WEEKDAY_CURVE = np.array([
    0.2, 0.15, 0.1, 0.1, 0.3, 1.2, 3.5, 7.5, 8.5, 5.5, 4.5, 5.0,
    5.5, 5.5, 6.0, 8.0, 9.0, 9.0, 6.0, 4.0, 3.0, 2.5, 2.0, 1.2])
WEEKEND_CURVE = np.array([
    0.3, 0.2, 0.15, 0.1, 0.2, 0.6, 1.5, 3.0, 4.5, 6.0, 7.0, 7.5,
    8.0, 8.0, 7.5, 7.0, 6.5, 6.0, 5.5, 4.5, 3.5, 3.0, 2.5, 2.0])
PEAK_HOURS = [6, 7, 8, 15, 16, 17]


def hourly_curve(day: str, peakiness: float) -> np.ndarray:
    base = (WEEKDAY_CURVE if day == "weekday" else WEEKEND_CURVE).copy()
    for h in PEAK_HOURS:
        base[h] *= peakiness
    return base / base.sum()


def project_km(lon: pd.Series, lat: pd.Series) -> np.ndarray:
    return np.column_stack([lon * KM_PER_DEG_LON, lat * KM_PER_DEG_LAT])


def load_inputs() -> dict:
    names = ["routes", "trips", "stop_times", "stops", "shapes", "calendar",
             "calendar_dates", "communities", "lrt_stations",
             "ridership_monthly", "cordon"]
    return {n: pd.read_parquet(DATA_PROCESSED / f"{n}.parquet") for n in names}


def periods_for(day: str) -> dict:
    return WEEKDAY_PERIODS if day == "weekday" else WEEKEND_PERIODS


def bus_stop_times(t: dict, ts_all: pd.DataFrame,
                   day: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Stop-level departures and trip-level stats for one sample service
    day, bus routes only. Returns (stop_departures, day_trips)."""
    periods = periods_for(day)
    services = active_service_ids(SAMPLE_DATES[day], t["calendar"],
                                  t["calendar_dates"])
    bus_routes = set(t["routes"][t["routes"]["route_type"] == 3]["route_id"])
    day_trips = ts_all[ts_all["service_id"].isin(services)
                       & ts_all["route_id"].isin(bus_routes)].copy()
    day_trips["period"] = day_trips["start_wrapped"].map(
        lambda s: assign_period(s, periods))

    st = t["stop_times"].merge(
        day_trips[["trip_id", "route_id"]], on="trip_id", how="inner")
    st["hour"] = (st["departure_secs"] % (24 * 3600)) // 3600
    st["period"] = (st["departure_secs"] % (24 * 3600)).map(
        lambda s: assign_period(s, periods))
    return st, day_trips


def stop_features(t: dict, st: pd.DataFrame) -> pd.DataFrame:
    """Per-stop land-use features for every stop with weekday bus service."""
    stops = t["stops"][["stop_id", "stop_name", "stop_lat", "stop_lon"]].copy()
    stops = stops[stops["stop_id"].isin(st["stop_id"].unique())].reset_index(drop=True)

    xy = project_km(stops["stop_lon"], stops["stop_lat"])
    points = shapely.points(xy)

    # Community polygons -> local km frame; density from 2021 population
    comms = t["communities"].copy()
    geoms = shapely.from_wkt(comms["the_geom"])
    geoms = shapely.transform(
        geoms, lambda a: a * np.array([KM_PER_DEG_LON, KM_PER_DEG_LAT]))
    comms["geom"] = geoms
    comms["area_km2"] = shapely.area(geoms)
    comms["density"] = comms["population"] / comms["area_km2"].where(
        comms["area_km2"] > 0)
    comms = comms.dropna(subset=["density"]).reset_index(drop=True)

    tree = STRtree(comms["geom"].to_numpy())
    buffers = shapely.buffer(points, BUFFER_KM, quad_segs=6)

    pop400 = np.zeros(len(stops))
    share_w = np.full(len(stops), np.nan)
    q_stop, q_comm = tree.query(buffers, predicate="intersects")
    for i in range(len(stops)):
        idx = q_comm[q_stop == i]
        if len(idx) == 0:
            continue
        inter = shapely.area(shapely.intersection(
            buffers[i], comms["geom"].to_numpy()[idx]))
        pop_contrib = inter * comms["density"].to_numpy()[idx]
        total = pop_contrib.sum()
        pop400[i] = total
        if total > 0:
            share_w[i] = (pop_contrib
                          * comms["transit_share"].to_numpy()[idx]).sum() / total
    median_share = float(np.nanmedian(share_w))
    share_w = np.where(np.isnan(share_w), median_share, share_w)

    # Nearby-stop competition: the same catchment population is shared by
    # every stop whose buffer covers it; divide by local stop count as a
    # cheap Voronoi stand-in so dense stop spacing doesn't inflate demand.
    stop_tree = STRtree(points)
    a, b = stop_tree.query(points, predicate="dwithin", distance=BUFFER_KM)
    n_competing = np.bincount(a, minlength=len(stops))  # includes self

    # LRT feeder flag
    lrt_xy = project_km(t["lrt_stations"]["lon"], t["lrt_stations"]["lat"])
    lrt_tree = STRtree(shapely.points(lrt_xy))
    f_stop, _ = lrt_tree.query(points, predicate="dwithin",
                               distance=LRT_FEEDER_KM)
    is_feeder = np.zeros(len(stops), dtype=bool)
    is_feeder[np.unique(f_stop)] = True

    # Downtown = centroid of the CBD cordon screenlines
    cordon = t["cordon"]
    dt_xy = project_km(cordon["lon"], cordon["lat"]).mean(axis=0)
    dist_dt = np.hypot(xy[:, 0] - dt_xy[0], xy[:, 1] - dt_xy[1])

    per_stop_routes = st.groupby("stop_id")["route_id"].nunique()

    stops["pop_400m"] = pop400
    stops["pop_400m_eff"] = pop400 / np.maximum(n_competing, 1)
    stops["transit_share"] = share_w
    stops["is_lrt_feeder"] = is_feeder
    stops["dist_downtown_km"] = dist_dt
    stops["n_routes"] = stops["stop_id"].map(per_stop_routes).fillna(0).astype(int)
    print(f"stop features: {len(stops)} bus stops, "
          f"median pop400={np.median(pop400):,.0f}, "
          f"{is_feeder.sum()} LRT feeders, "
          f"median downtown dist {np.median(dist_dt):.1f} km")
    return stops


def demand_potential(stops: pd.DataFrame) -> pd.Series:
    gravity = 1 + G_DT * np.exp(-stops["dist_downtown_km"] / LAMBDA_KM)
    lrt = 1 + LRT_BONUS * stops["is_lrt_feeder"].astype(float)
    return stops["pop_400m_eff"] * stops["transit_share"] * gravity * lrt


def weekday_target(t: dict, day_trips: pd.DataFrame, ts_all: pd.DataFrame,
                   t_cal: dict) -> dict:
    """Average weekday bus boardings implied by the latest 12 published
    monthly totals, using supply vehicle-km ratios as weekend weights."""
    # Weekend supply weights from the same GTFS the model uses
    km = {"weekday": day_trips["length_km"].sum()}
    for day in ("saturday", "sunday"):
        services = active_service_ids(SAMPLE_DATES[day], t_cal["calendar"],
                                      t_cal["calendar_dates"])
        bus_routes = set(t["routes"][t["routes"]["route_type"] == 3]["route_id"])
        km[day] = ts_all[ts_all["service_id"].isin(services)
                         & ts_all["route_id"].isin(bus_routes)]["length_km"].sum()
    w_sat, w_sun = km["saturday"] / km["weekday"], km["sunday"] / km["weekday"]

    rid = t["ridership_monthly"].tail(12)
    per_month = []
    for _, r in rid.iterrows():
        year, month = int(r["year"]), int(r["month_num"])
        counts = {0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0}
        for d in range(1, cal.monthrange(year, month)[1] + 1):
            counts[dt.date(year, month, d).weekday()] += 1
        n_wd = sum(counts[i] for i in range(5))
        eq_days = n_wd + counts[5] * w_sat + counts[6] * w_sun
        per_month.append(r["bus_boarding_passengers"] / eq_days)
    target = float(np.mean(per_month))
    months = f"{rid.iloc[0]['year']}-{int(rid.iloc[0]['month_num']):02d}..{rid.iloc[-1]['year']}-{int(rid.iloc[-1]['month_num']):02d}"
    print(f"calibration: mean weekday bus boardings {target:,.0f} "
          f"(months {months}; w_sat={w_sat:.2f}, w_sun={w_sun:.2f})")
    return {"weekday": target, "saturday": target * w_sat,
            "sunday": target * w_sun, "months": months,
            "w_sat": w_sat, "w_sun": w_sun}


def route_period_loads(st: pd.DataFrame, day_trips: pd.DataFrame,
                       stop_day: pd.Series, curve: np.ndarray,
                       periods: dict) -> pd.DataFrame:
    """Allocate stop demand to routes by departure share, roll up to
    route x period, divide by trips for per-trip boardings."""
    period_share = {p: curve[[h for h in range(24)
                              if assign_period(h * 3600, periods) == p]].sum()
                    for p in list(periods)}

    dep = st.groupby(["stop_id", "period", "route_id"]).size().rename("dep")
    dep = dep.reset_index()
    dep["share"] = dep["dep"] / dep.groupby(["stop_id", "period"])["dep"].transform("sum")
    dep["stop_day"] = dep["stop_id"].map(stop_day)
    dep["boardings"] = (dep["stop_day"] * dep["period"].map(period_share)
                        * dep["share"])

    loads = dep.groupby(["route_id", "period"])["boardings"].sum().reset_index()
    trips = day_trips.groupby(["route_id", "period"]).size().rename("trips")
    loads = loads.merge(trips, on=["route_id", "period"], how="left")
    loads["boardings_per_trip"] = loads["boardings"] / loads["trips"].where(
        loads["trips"] > 0)
    return loads


def main() -> None:
    ensure_dirs()
    t = load_inputs()
    shape_len = shape_lengths_km(t["shapes"])
    ts_all = trip_stats(t["trips"], t["stop_times"], shape_len)

    st_wd, trips_wd = bus_stop_times(t, ts_all, "weekday")
    stops = stop_features(t, st_wd)
    targets = weekday_target(t, trips_wd, ts_all, t)

    potential = demand_potential(stops)
    scale = targets["weekday"] / potential.sum()
    stops["weekday_boardings"] = potential * scale
    stops["saturday_boardings"] = stops["weekday_boardings"] * targets["w_sat"]
    stops["sunday_boardings"] = stops["weekday_boardings"] * targets["w_sun"]
    print(f"modeled weekday boardings: {stops['weekday_boardings'].sum():,.0f} "
          f"(target {targets['weekday']:,.0f})")

    all_loads = []
    for day in SAMPLE_DATES:
        st, day_trips = (st_wd, trips_wd) if day == "weekday" \
            else bus_stop_times(t, ts_all, day)
        stop_day = stops.set_index("stop_id")[f"{day}_boardings"]
        for name, cfg in SCENARIOS.items():
            curve = hourly_curve(day, cfg["peakiness"])
            loads = route_period_loads(st, day_trips, stop_day, curve,
                                       periods_for(day))
            loads["day"] = day
            loads["scenario"] = name
            loads["peak_load_per_trip"] = loads["boardings_per_trip"] * cfg["alpha"]
            all_loads.append(loads)
    loads = pd.concat(all_loads, ignore_index=True)

    stops_out = stops.drop(columns=["stop_name"])
    stops_out.to_parquet(DATA_PROCESSED / "stop_demand.parquet", index=False)
    loads.to_parquet(DATA_PROCESSED / "route_loads.parquet", index=False)
    print(f"wrote stop_demand.parquet ({len(stops_out)}) and "
          f"route_loads.parquet ({len(loads)})")

    # --- app export ---
    def num(x) -> float:
        """NaN-safe float for JSON (NaN is truthy, so `or 0` won't catch it)."""
        return 0.0 if pd.isna(x) else float(x)

    routes_meta = t["routes"].set_index("route_id")
    by_route: dict[str, dict] = {}
    mod_wd = loads[(loads["scenario"] == "moderate") & (loads["day"] == "weekday")]
    for route_id, gr in loads.groupby("route_id"):
        days: dict[str, dict] = {}
        for (day, period), gp in gr.groupby(["day", "period"]):
            sc = gp.set_index("scenario")
            days.setdefault(day, {})[period] = {
                "trips": int(num(sc.loc["moderate", "trips"])),
                "boardings_day": round(num(sc.loc["moderate", "boardings"]), 1),
                "boardings_per_trip": round(
                    num(sc.loc["moderate", "boardings_per_trip"]), 1),
                "peak_load_range": [
                    round(num(sc.loc["aggressive", "peak_load_per_trip"]), 1),
                    round(num(sc.loc["moderate", "peak_load_per_trip"]), 1),
                    round(num(sc.loc["conservative", "peak_load_per_trip"]), 1),
                ],
            }
        by_route[str(routes_meta.loc[route_id, "route_short_name"])] = {
            "route_id": route_id,
            "weekday_boardings": round(float(
                mod_wd[mod_wd["route_id"] == route_id]["boardings"].sum()), 0),
            "days": days,
        }

    payload = {
        "generated": dt.datetime.now().isoformat(timespec="seconds"),
        "method": "calibrated gravity model on open data (modeled, not measured)",
        "assumptions": {
            "buffer_km": BUFFER_KM, "g_downtown": G_DT, "lambda_km": LAMBDA_KM,
            "lrt_bonus": LRT_BONUS,
            "scenarios": SCENARIOS,
            "calibration_months": targets["months"],
            "weekday_boardings_target": round(targets["weekday"]),
        },
        "system": {
            "weekday_boardings": round(float(stops["weekday_boardings"].sum())),
            "saturday_boardings": round(float(stops["saturday_boardings"].sum())),
            "sunday_boardings": round(float(stops["sunday_boardings"].sum())),
        },
        "routes": by_route,
        "stops": [
            {"id": r.stop_id, "lat": round(float(r.stop_lat), 5),
             "lon": round(float(r.stop_lon), 5),
             "wd": round(float(r.weekday_boardings), 1)}
            for r in stops.itertuples()
        ],
    }
    out = PUBLIC_DATA / "demand.json"
    out.write_text(json.dumps(payload, allow_nan=False))
    print(f"wrote {out}")

    top = (mod_wd.groupby("route_id")["boardings"].sum()
           .sort_values(ascending=False).head(10))
    print("\ntop 10 routes by modeled weekday boardings:")
    for rid, b in top.items():
        print(f"  {routes_meta.loc[rid, 'route_short_name']:>4} "
              f"{routes_meta.loc[rid, 'route_long_name'][:40]:<40} {b:>9,.0f}")


if __name__ == "__main__":
    main()
