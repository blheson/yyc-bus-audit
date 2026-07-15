"""Download Calgary Transit's static GTFS and convert it to parquet.

Usage: python ingest_gtfs.py [--skip-download]

Writes data/raw/CT_GTFS.zip and data/processed/<table>.parquet for each
GTFS table present in the feed.
"""

import argparse
import io
import sys
import zipfile

import pandas as pd
import requests

from common import DATA_PROCESSED, DATA_RAW, GTFS_STATIC_URL, ensure_dirs

GTFS_ZIP = DATA_RAW / "CT_GTFS.zip"

# Columns that must stay strings even when they look numeric (IDs with
# leading zeros, times beyond 24:00:00).
STRING_COLUMNS = {
    "route_id", "service_id", "trip_id", "stop_id", "shape_id", "block_id",
    "agency_id", "parent_station", "zone_id", "fare_id", "arrival_time",
    "departure_time", "start_time", "end_time",
}


def download(force: bool = False) -> None:
    if GTFS_ZIP.exists() and not force:
        print(f"already downloaded: {GTFS_ZIP}")
        return
    print(f"downloading {GTFS_STATIC_URL} ...")
    resp = requests.get(GTFS_STATIC_URL, timeout=120)
    resp.raise_for_status()
    # Sanity: must be a zip, not an HTML error page
    if not resp.content[:2] == b"PK":
        sys.exit(f"unexpected response ({resp.headers.get('content-type')}), not a zip")
    GTFS_ZIP.write_bytes(resp.content)
    print(f"saved {GTFS_ZIP} ({len(resp.content) / 1e6:.1f} MB)")


def parse_time_to_seconds(value: str) -> int:
    """GTFS HH:MM:SS where HH may exceed 23."""
    h, m, s = value.strip().split(":")
    return int(h) * 3600 + int(m) * 60 + int(s)


def convert_to_parquet() -> None:
    with zipfile.ZipFile(GTFS_ZIP) as zf:
        names = [n for n in zf.namelist() if n.endswith(".txt")]
        print(f"tables in feed: {sorted(names)}")
        for name in names:
            table = name.removesuffix(".txt")
            with zf.open(name) as fh:
                header = pd.read_csv(io.BytesIO(fh.read(4096)), nrows=0)
            dtypes = {c: str for c in header.columns if c.strip() in STRING_COLUMNS}
            with zf.open(name) as fh:
                df = pd.read_csv(fh, dtype=dtypes, low_memory=False)
            df.columns = [c.strip() for c in df.columns]
            if table == "stop_times":
                df["arrival_secs"] = df["arrival_time"].map(parse_time_to_seconds)
                df["departure_secs"] = df["departure_time"].map(parse_time_to_seconds)
            out = DATA_PROCESSED / f"{table}.parquet"
            df.to_parquet(out, index=False)
            print(f"  {table}: {len(df):,} rows -> {out.name}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force-download", action="store_true",
                        help="re-download even if the zip exists")
    args = parser.parse_args()
    ensure_dirs()
    download(force=args.force_download)
    convert_to_parquet()


if __name__ == "__main__":
    main()
