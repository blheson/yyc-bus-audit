"""Shared paths, data source URLs, and service period definitions."""

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_RAW = REPO_ROOT / "data" / "raw"
DATA_RT = REPO_ROOT / "data" / "rt"
DATA_PROCESSED = REPO_ROOT / "data" / "processed"
PUBLIC_DATA = REPO_ROOT / "public" / "data"

# Open Calgary dataset endpoints (verified 2026-07-14)
GTFS_STATIC_URL = "https://data.calgary.ca/download/npk7-z3bj/application%2Fx-zip-compressed"
RT_VEHICLE_POSITIONS_URL = "https://data.calgary.ca/download/am7c-qe3u/application%2Foctet-stream"
RT_TRIP_UPDATES_URL = "https://data.calgary.ca/download/gs4m-mdc2/application%2Foctet-stream"

# Service periods for a weekday; weekend handled as its own period.
# Bounds are seconds since midnight (GTFS stop_times can exceed 24h for
# after-midnight trips on the previous service day).
WEEKDAY_PERIODS = {
    "am_peak": (6 * 3600, 9 * 3600),
    "midday": (9 * 3600, 15 * 3600),
    "pm_peak": (15 * 3600, 18 * 3600),
    "evening": (18 * 3600, 24 * 3600),
    "early_late": (0, 6 * 3600),  # includes >24h times wrapped by caller
}


def ensure_dirs() -> None:
    for d in (DATA_RAW, DATA_RT, DATA_PROCESSED, PUBLIC_DATA):
        d.mkdir(parents=True, exist_ok=True)
