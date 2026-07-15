"""Supply-side analysis of Calgary Transit's schedule.

Computes, per route and service period: trips, headways, vehicle-km
(the fuel proxy), estimated peak vehicles, and average speed. Also finds
corridors where multiple routes overlap, and flags candidate routes for
optimization. Exports public/data/supply.json and a routes GeoJSON.

Usage: python supply.py
"""

import datetime as dt
import json
import math

import pandas as pd
from shapely import STRtree
from shapely.geometry import LineString

from common import DATA_PROCESSED, PUBLIC_DATA, WEEKDAY_PERIODS, ensure_dirs

# Representative regular-service dates (post-Stampede, pre-holiday)
SAMPLE_DATES = {
    "weekday": dt.date(2026, 7, 20),
    "saturday": dt.date(2026, 7, 25),
    "sunday": dt.date(2026, 7, 26),
}
WEEKEND_PERIODS = {"daytime": (6 * 3600, 18 * 3600), "evening": (18 * 3600, 24 * 3600),
                   "early_late": (0, 6 * 3600)}
# Annualization: ~255 weekdays, 52 Saturdays, 58 Sunday/holiday days
ANNUAL_DAY_WEIGHTS = {"weekday": 255, "saturday": 52, "sunday": 58}
DIESEL_L_PER_KM = 0.5          # typical 40-ft transit bus ~45-55 L/100km
OVERLAP_BUFFER_KM = 0.15
DAY_SECS = 24 * 3600

# Equirectangular projection around Calgary for metric geometry
LAT0 = 51.05
KM_PER_DEG_LAT = 110.57
KM_PER_DEG_LON = 111.32 * math.cos(math.radians(LAT0))

DOW_COLS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def load_tables() -> dict[str, pd.DataFrame]:
    names = ["routes", "trips", "stop_times", "shapes", "calendar", "calendar_dates"]
    return {n: pd.read_parquet(DATA_PROCESSED / f"{n}.parquet") for n in names}


def active_service_ids(date: dt.date, calendar: pd.DataFrame,
                       calendar_dates: pd.DataFrame) -> set[str]:
    datenum = int(date.strftime("%Y%m%d"))
    dow = DOW_COLS[date.weekday()]
    base = calendar[
        (calendar[dow] == 1)
        & (calendar["start_date"] <= datenum)
        & (calendar["end_date"] >= datenum)
    ]["service_id"]
    active = set(base)
    exceptions = calendar_dates[calendar_dates["date"] == datenum]
    active |= set(exceptions[exceptions["exception_type"] == 1]["service_id"])
    active -= set(exceptions[exceptions["exception_type"] == 2]["service_id"])
    return active


def shape_lengths_km(shapes: pd.DataFrame) -> pd.Series:
    """Length per shape_id. Uses shape_dist_traveled (km) when sane,
    haversine-ish planar length otherwise."""
    dist = shapes.groupby("shape_id")["shape_dist_traveled"].max()

    pts = shapes.sort_values(["shape_id", "shape_pt_sequence"]).copy()
    pts["x"] = pts["shape_pt_lon"] * KM_PER_DEG_LON
    pts["y"] = pts["shape_pt_lat"] * KM_PER_DEG_LAT
    dx = pts.groupby("shape_id")["x"].diff()
    dy = pts.groupby("shape_id")["y"].diff()
    geom = (dx.pow(2) + dy.pow(2)).pow(0.5).groupby(pts["shape_id"]).sum()

    # Trust the feed's distances only if they broadly agree with geometry
    ratio = (dist / geom).replace([float("inf")], float("nan"))
    use_feed = ratio.between(0.8, 1.2)
    result = dist.where(use_feed, geom)
    n_fallback = int((~use_feed).sum())
    if n_fallback:
        print(f"  shape length fallback to geometry for {n_fallback} shapes")
    return result


def trip_stats(trips: pd.DataFrame, stop_times: pd.DataFrame,
               shape_len: pd.Series) -> pd.DataFrame:
    agg = stop_times.groupby("trip_id").agg(
        start_secs=("departure_secs", "min"),
        end_secs=("arrival_secs", "max"),
        n_stops=("stop_id", "size"),
    )
    ts = trips.merge(agg, on="trip_id")
    ts["length_km"] = ts["shape_id"].map(shape_len)
    ts["duration_s"] = ts["end_secs"] - ts["start_secs"]
    ts["start_wrapped"] = ts["start_secs"] % DAY_SECS
    return ts


def assign_period(start_wrapped: int, periods: dict[str, tuple[int, int]]) -> str:
    for name, (lo, hi) in periods.items():
        if lo <= start_wrapped < hi:
            return name
    return "early_late"


def route_day_stats(day_trips: pd.DataFrame, periods: dict) -> dict:
    """Per-route metrics for one service day."""
    out: dict[str, dict] = {}
    for route_id, gr in day_trips.groupby("route_id"):
        per_period = {}
        for pname in periods:
            gp = gr[gr["period"] == pname]
            if gp.empty:
                continue
            # median gap between consecutive departures, worst direction
            headways = []
            for _, gd in gp.groupby("direction_id"):
                starts = sorted(gd["start_secs"])
                if len(starts) >= 2:
                    gaps = [b - a for a, b in zip(starts, starts[1:])]
                    headways.append(pd.Series(gaps).median() / 60)
            span_h = (periods[pname][1] - periods[pname][0]) / 3600
            per_period[pname] = {
                "trips": int(len(gp)),
                "trips_per_hour": round(len(gp) / span_h, 2),
                "median_headway_min": round(max(headways), 1) if headways else None,
            }
        rt_time_s = gr.groupby("direction_id")["duration_s"].mean().sum()
        peak = per_period.get("am_peak") or per_period.get("pm_peak") \
            or per_period.get("daytime") or {}
        peak_headway = peak.get("median_headway_min")
        vehicles_est = (
            math.ceil((rt_time_s / 60) * 1.15 / peak_headway) if peak_headway else None
        )
        out[route_id] = {
            "trips": int(len(gr)),
            "vehicle_km": round(float(gr["length_km"].sum()), 1),
            "avg_trip_km": round(float(gr["length_km"].mean()), 2),
            "avg_speed_kmh": round(
                float((gr["length_km"] / (gr["duration_s"] / 3600)).median()), 1),
            "peak_vehicles_est": vehicles_est,
            "n_blocks": int(gr["block_id"].nunique()),
            "periods": per_period,
        }
    return out


def representative_shapes(day_trips: pd.DataFrame,
                          shapes: pd.DataFrame) -> dict[str, LineString]:
    """Most-used shape per route (direction 0 preferred), as a metric LineString."""
    pick: dict[str, str] = {}
    for route_id, gr in day_trips.groupby("route_id"):
        d0 = gr[gr["direction_id"] == 0]
        source = d0 if not d0.empty else gr
        pick[route_id] = source["shape_id"].mode().iloc[0]

    geoms: dict[str, LineString] = {}
    shape_groups = dict(tuple(shapes.groupby("shape_id")))
    for route_id, shape_id in pick.items():
        pts = shape_groups[shape_id].sort_values("shape_pt_sequence")
        coords = list(zip(pts["shape_pt_lon"] * KM_PER_DEG_LON,
                          pts["shape_pt_lat"] * KM_PER_DEG_LAT))
        if len(coords) >= 2:
            geoms[route_id] = LineString(coords).simplify(0.03)
    return geoms


def overlap_analysis(geoms: dict[str, LineString]) -> list[dict]:
    route_ids = list(geoms)
    lines = [geoms[r] for r in route_ids]
    buffered = [g.buffer(OVERLAP_BUFFER_KM) for g in lines]
    tree = STRtree(lines)
    results = []
    for i, rid_a in enumerate(route_ids):
        for j in tree.query(buffered[i]):
            j = int(j)
            if j <= i:
                continue
            rid_b = route_ids[j]
            overlap_km = float(lines[j].intersection(buffered[i]).length)
            if overlap_km < 3.0:
                continue
            frac_a = min(overlap_km / lines[i].length, 1.0)
            frac_b = min(overlap_km / lines[j].length, 1.0)
            if max(frac_a, frac_b) >= 0.3:
                results.append({
                    "route_a": rid_a, "route_b": rid_b,
                    "overlap_km": round(overlap_km, 1),
                    "fraction_a": round(frac_a, 2), "fraction_b": round(frac_b, 2),
                })
    results.sort(key=lambda r: -max(r["fraction_a"], r["fraction_b"]))
    return results


def compute_flags(route_entry: dict, overlaps_by_route: dict[str, float]) -> list[str]:
    flags = []
    wk = route_entry.get("weekday") or {}
    midday = (wk.get("periods") or {}).get("midday") or {}
    hw = midday.get("median_headway_min")
    if hw is not None and hw >= 55:
        flags.append("hourly_or_worse_midday")
    if hw is not None and hw >= 30 and route_entry["length_km"] > 15:
        flags.append("long_route_low_frequency")
    if overlaps_by_route.get(route_entry["route_id"], 0) >= 0.5:
        flags.append("high_overlap")
    return flags


def export_geojson(geoms: dict[str, LineString], routes: pd.DataFrame) -> None:
    meta = routes.set_index("route_id")
    features = []
    for route_id, line in geoms.items():
        coords = [[round(x / KM_PER_DEG_LON, 5), round(y / KM_PER_DEG_LAT, 5)]
                  for x, y in line.coords]
        features.append({
            "type": "Feature",
            "properties": {
                "route_id": route_id,
                "short_name": str(meta.loc[route_id, "route_short_name"]),
                "long_name": str(meta.loc[route_id, "route_long_name"]),
                "route_type": int(meta.loc[route_id, "route_type"]),
            },
            "geometry": {"type": "LineString", "coordinates": coords},
        })
    out = PUBLIC_DATA / "routes.geojson"
    out.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    print(f"wrote {out} ({len(features)} routes)")


def main() -> None:
    ensure_dirs()
    t = load_tables()
    print("computing shape lengths ...")
    shape_len = shape_lengths_km(t["shapes"])
    ts = trip_stats(t["trips"], t["stop_times"], shape_len)

    day_results: dict[str, dict] = {}
    weekday_trips = None
    for day, date in SAMPLE_DATES.items():
        services = active_service_ids(date, t["calendar"], t["calendar_dates"])
        day_trips = ts[ts["service_id"].isin(services)].copy()
        periods = WEEKDAY_PERIODS if day == "weekday" else WEEKEND_PERIODS
        day_trips["period"] = day_trips["start_wrapped"].map(
            lambda s: assign_period(s, periods))
        print(f"{day} ({date}): {len(day_trips):,} trips, "
              f"{day_trips['route_id'].nunique()} routes, "
              f"{day_trips['length_km'].sum():,.0f} vehicle-km")
        day_results[day] = route_day_stats(day_trips, periods)
        if day == "weekday":
            weekday_trips = day_trips

    print("running corridor overlap analysis ...")
    bus_route_ids = set(t["routes"][t["routes"]["route_type"] == 3]["route_id"])
    geoms = representative_shapes(weekday_trips, t["shapes"])
    overlaps = overlap_analysis({r: g for r, g in geoms.items() if r in bus_route_ids})
    max_overlap_frac: dict[str, float] = {}
    for o in overlaps:
        max_overlap_frac[o["route_a"]] = max(max_overlap_frac.get(o["route_a"], 0),
                                             o["fraction_a"])
        max_overlap_frac[o["route_b"]] = max(max_overlap_frac.get(o["route_b"], 0),
                                             o["fraction_b"])

    route_entries = []
    for _, r in t["routes"].sort_values("route_short_name",
                                        key=lambda s: s.astype(str)).iterrows():
        rid = r["route_id"]
        entry = {
            "route_id": rid,
            "short_name": str(r["route_short_name"]),
            "long_name": str(r["route_long_name"]),
            "is_bus": int(r["route_type"]) == 3,
            "length_km": round(float(geoms[rid].length), 1) if rid in geoms else None,
        }
        for day in SAMPLE_DATES:
            entry[day] = day_results[day].get(rid)
        if entry["length_km"] is not None and entry["weekday"]:
            entry["flags"] = compute_flags(entry, max_overlap_frac)
        route_entries.append(entry)

    bus_ids = bus_route_ids
    system = {}
    for day in SAMPLE_DATES:
        stats = day_results[day]
        bus_km = sum(v["vehicle_km"] for k, v in stats.items() if k in bus_ids)
        system[day] = {
            "bus_vehicle_km": round(bus_km),
            "bus_trips": sum(v["trips"] for k, v in stats.items() if k in bus_ids),
            "est_diesel_litres": round(bus_km * DIESEL_L_PER_KM),
        }
    annual_km = sum(system[d]["bus_vehicle_km"] * w for d, w in ANNUAL_DAY_WEIGHTS.items())
    system["annual"] = {
        "bus_vehicle_km": round(annual_km),
        "est_diesel_litres": round(annual_km * DIESEL_L_PER_KM),
        "est_co2_tonnes": round(annual_km * DIESEL_L_PER_KM * 2.68 / 1000),
    }

    payload = {
        "generated": dt.datetime.now().isoformat(timespec="seconds"),
        "sample_dates": {k: v.isoformat() for k, v in SAMPLE_DATES.items()},
        "assumptions": {
            "diesel_l_per_km": DIESEL_L_PER_KM,
            "annual_day_weights": ANNUAL_DAY_WEIGHTS,
            "overlap_buffer_m": OVERLAP_BUFFER_KM * 1000,
        },
        "system": system,
        "routes": route_entries,
        "overlaps": overlaps,
    }
    out = PUBLIC_DATA / "supply.json"
    out.write_text(json.dumps(payload, indent=1))
    print(f"wrote {out}")
    export_geojson(geoms, t["routes"])

    print("\n=== SYSTEM SUMMARY ===")
    print(json.dumps(system, indent=2))
    flagged = [r for r in route_entries if r.get("flags")]
    print(f"\nflagged routes: {len(flagged)}")
    for r in flagged[:20]:
        print(f"  {r['short_name']:>4} {r['long_name'][:45]:<45} {r['flags']}")
    print(f"\ntop overlaps: {len(overlaps)}")
    for o in overlaps[:10]:
        print(f"  {o['route_a']} <-> {o['route_b']}: {o['overlap_km']} km "
              f"(frac {o['fraction_a']}/{o['fraction_b']})")


if __name__ == "__main__":
    main()
