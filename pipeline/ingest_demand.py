"""Download and normalize the demand model's proxy datasets.

Fetches from Open Calgary (SODA CSV exports, cached in data/raw/demand/):
communities (2021 population + polygons, joined with 2016 civic census
transit mode share), LRT stations, monthly system ridership, and CBD
cordon counts (2019 + 2023, daily totals per screenline).

Writes data/processed/{communities,lrt_stations,ridership_monthly,cordon}.parquet

Usage: python ingest_demand.py [--force-download]
"""

import argparse

import pandas as pd
import requests

from common import DATA_PROCESSED, DATA_RAW, SODA_DATASETS, ensure_dirs, soda_csv_url

RAW_DIR = DATA_RAW / "demand"

MONTHS = {m: i + 1 for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
     "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])}


def fetch_csv(name: str, force: bool = False) -> pd.DataFrame:
    """Download one SODA dataset as CSV (cached) and return a DataFrame."""
    path = RAW_DIR / f"{name}.csv"
    if not path.exists() or force:
        url = soda_csv_url(SODA_DATASETS[name])
        print(f"downloading {name} ({SODA_DATASETS[name]}) ...")
        resp = requests.get(url, timeout=120)
        resp.raise_for_status()
        path.write_bytes(resp.content)
    df = pd.read_csv(path, low_memory=False)
    df.columns = [c.strip().lower() for c in df.columns]
    return df


def build_communities(force: bool) -> pd.DataFrame:
    pop = fetch_csv("communities_pop", force)
    modes = fetch_csv("modes_2016", force)

    pop = pop.rename(columns={"community_code": "comm_code",
                              "community_name": "name",
                              "total_pop_household": "population"})
    pop["comm_code"] = pop["comm_code"].astype(str).str.strip().str.upper()
    pop = pop[["comm_code", "name", "population", "the_geom"]].dropna(subset=["the_geom"])

    modes["comm_code"] = modes["comm_code"].astype(str).str.strip().str.upper()
    # Transit share of commuters, straight from counts (per_transi is the
    # same figure pre-rounded); NaN where total is 0 or missing.
    modes["transit_share"] = modes["transit"] / modes["total"].where(modes["total"] > 0)
    modes = modes[["comm_code", "class", "transit_share"]]

    df = pop.merge(modes, on="comm_code", how="left")
    median_share = df["transit_share"].median()
    n_missing = int(df["transit_share"].isna().sum())
    df["share_imputed"] = df["transit_share"].isna()
    df["transit_share"] = df["transit_share"].fillna(median_share)
    print(f"communities: {len(df)} with polygons, "
          f"{n_missing} missing 2016 share -> median {median_share:.3f}")
    return df


def build_lrt(force: bool) -> pd.DataFrame:
    lrt = fetch_csv("lrt_stations", force)
    # the_geom is 'POINT (lon lat)'
    coords = lrt["the_geom"].str.extract(r"POINT \((?P<lon>[-\d.]+) (?P<lat>[-\d.]+)\)")
    df = pd.DataFrame({
        "station": lrt["stationnam"],
        "leg": lrt["leg"],
        "status": lrt["status"],
        "lon": coords["lon"].astype(float),
        "lat": coords["lat"].astype(float),
    }).dropna(subset=["lon", "lat"])
    df = df[df["status"].str.upper().ne("REMOVED")]
    print(f"lrt stations: {len(df)}")
    return df


def build_ridership(force: bool) -> pd.DataFrame:
    rid = fetch_csv("ridership_monthly", force)
    df = rid[["year", "month", "bus_boarding_passengers",
              "ctrain_boarding_passengers"]].copy()
    df["month_num"] = df["month"].map(MONTHS)
    df = df.dropna(subset=["bus_boarding_passengers", "month_num"])
    df = df.astype({"year": int, "month_num": int,
                    "bus_boarding_passengers": float,
                    "ctrain_boarding_passengers": float})
    df = df.sort_values(["year", "month_num"]).reset_index(drop=True)
    latest = df.iloc[-1]
    print(f"ridership: {len(df)} months, latest with bus data "
          f"{latest['year']}-{latest['month_num']:02d} "
          f"({latest['bus_boarding_passengers'] / 1e6:.2f}M bus boardings)")
    return df


def build_cordon(force: bool) -> pd.DataFrame:
    frames = []
    for name, year in (("cordon_2019", 2019), ("cordon_2023", 2023)):
        c = fetch_csv(name, force)
        c["year"] = year
        frames.append(c[["year", "street_location", "data_collection_day",
                         "ib_auto_occu", "ob_auto_occu",
                         "ib_transit_occu", "ob_transit_occu",
                         "lat", "long"]])
    df = pd.concat(frames, ignore_index=True).rename(columns={"long": "lon"})
    print(f"cordon: {len(df)} screenline-day rows "
          f"({df[df.year == 2023]['ib_transit_occu'].sum():,.0f} inbound transit "
          f"occupants counted in 2023)")
    return df


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force-download", action="store_true")
    args = parser.parse_args()
    ensure_dirs()
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    outputs = {
        "communities": build_communities(args.force_download),
        "lrt_stations": build_lrt(args.force_download),
        "ridership_monthly": build_ridership(args.force_download),
        "cordon": build_cordon(args.force_download),
    }
    for name, df in outputs.items():
        out = DATA_PROCESSED / f"{name}.parquet"
        df.to_parquet(out, index=False)
        print(f"  {name}: {len(df):,} rows -> {out.name}")


if __name__ == "__main__":
    main()
