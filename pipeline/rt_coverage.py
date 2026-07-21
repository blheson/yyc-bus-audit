"""Coverage windows for the GTFS-RT archive.

The collector pauses while this Mac sleeps, so some archive days are
only partly covered. Sleep also is not all-or-nothing: macOS briefly
wakes during sleep for background chores (a "dark wake"), and each one
can land a single stray poll. Those fragments look like data but
represent a minute of a day, and letting them into per-period stats
would let 40 rows pretend to be "Saturday midday".

This module reconstructs when the collector was genuinely observing
the feed, as a list of coverage windows per day, built from the
poll_ts column of the day's parquet files:

- consecutive polls more than MAX_GAP_SECS apart start a new window
- windows shorter than MIN_WINDOW_SECS are discarded as fragments

rt_metrics must filter rows through these windows and weight any
per-day or per-period average by covered seconds, not by wall clock.
The motivating case is 2026-07-18 (a Saturday): the machine slept
from 00:51 to 21:00, so that day is valid only as an evening sample.
The mornings of 07-16 and 07-17 have similar 03:30 to 08:00 holes.

Caveat: Calgary's feed itself goes quiet in the overnight service gap
(roughly 03:00 to 05:00, when no buses run), so those hours read as
uncovered even when the machine was awake. That is harmless: there is
no service to measure then, but it means "covered seconds per day"
should never be compared against a 24 h denominator uncritically.

Usage: python rt_coverage.py    (prints a per-day coverage table)
"""

import datetime as dt
import sys

import pandas as pd

from common import DATA_RT

MAX_GAP_SECS = 600     # >10 min without a poll means the observer was gone
MIN_WINDOW_SECS = 1200  # <20 min of polling is a fragment, not coverage


def split_windows(poll_ts: list[int],
                  max_gap_secs: int = MAX_GAP_SECS,
                  min_window_secs: int = MIN_WINDOW_SECS) -> list[tuple[int, int]]:
    """Turn sorted unique poll timestamps into (start, end) windows."""
    windows = []
    if not poll_ts:
        return windows
    start = prev = poll_ts[0]
    for ts in poll_ts[1:]:
        if ts - prev > max_gap_secs:
            windows.append((start, prev))
            start = ts
        prev = ts
    windows.append((start, prev))
    return [(a, b) for a, b in windows if b - a >= min_window_secs]


def day_poll_ts(date: str) -> list[int]:
    """All poll timestamps recorded for a day, vp and tu combined."""
    day_dir = DATA_RT / date
    ts: set[int] = set()
    for f in sorted(day_dir.glob("*.parquet")):
        ts.update(pd.read_parquet(f, columns=["poll_ts"])["poll_ts"].unique())
    return sorted(ts)


def day_windows(date: str) -> list[tuple[int, int]]:
    return split_windows(day_poll_ts(date))


def covered_secs(windows: list[tuple[int, int]],
                 start_ts: int | None = None,
                 end_ts: int | None = None) -> int:
    """Seconds of coverage, optionally clipped to [start_ts, end_ts).

    The clipped form is what per-period weighting needs: pass the
    period's bounds and divide the period's totals by this, so an
    evening-only day contributes to evening stats at full weight and
    to midday stats not at all.
    """
    total = 0
    for a, b in windows:
        lo = a if start_ts is None else max(a, start_ts)
        hi = b if end_ts is None else min(b, end_ts)
        if hi > lo:
            total += hi - lo
    return total


def filter_to_coverage(df: pd.DataFrame,
                       windows: list[tuple[int, int]]) -> pd.DataFrame:
    """Keep only rows whose poll_ts falls inside a coverage window."""
    if df.empty or not windows:
        return df.iloc[0:0]
    keep = pd.Series(False, index=df.index)
    for a, b in windows:
        keep |= df["poll_ts"].between(a, b)
    return df[keep]


def coverage_table() -> pd.DataFrame:
    """One row per archive day: windows, covered hours, share of 24 h."""
    rows = []
    days = sorted(d.name for d in DATA_RT.iterdir()
                  if d.is_dir() and len(d.name) == 10)
    for date in days:
        windows = day_windows(date)
        fmt = lambda ts: dt.datetime.fromtimestamp(ts).strftime("%H:%M")
        rows.append({
            "date": date,
            "weekday": dt.date.fromisoformat(date).strftime("%a"),
            "windows": ", ".join(f"{fmt(a)}-{fmt(b)}" for a, b in windows),
            "covered_h": round(covered_secs(windows) / 3600, 1),
            "pct_of_day": round(100 * covered_secs(windows) / 86400),
        })
    return pd.DataFrame(rows)


if __name__ == "__main__":
    table = coverage_table()
    if table.empty:
        sys.exit("no archive days found under data/rt/")
    print(table.to_string(index=False))
