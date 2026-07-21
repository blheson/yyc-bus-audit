"""Unit tests for the coverage-window logic (pure functions, no data).

Run: .venv/bin/pytest test_rt_coverage.py
"""

import pandas as pd

from rt_coverage import covered_secs, filter_to_coverage, split_windows

T0 = 1_800_000_000  # arbitrary epoch base; only differences matter


def polls(start: int, count: int, step: int = 60) -> list[int]:
    return [start + i * step for i in range(count)]


def test_continuous_run_is_one_window():
    ts = polls(T0, 60)
    assert split_windows(ts) == [(T0, T0 + 59 * 60)]


def test_sleep_gap_splits_into_two_windows():
    ts = polls(T0, 60) + polls(T0 + 8 * 3600, 60)
    assert len(split_windows(ts)) == 2


def test_stray_single_polls_are_discarded():
    # the 07-18 pattern: a solid evening plus lone dark-wake polls
    strays = [T0 + h * 3600 for h in (2, 4, 7, 10, 14, 16)]
    evening = polls(T0 + 21 * 3600, 180)
    ts = sorted(strays + evening)
    assert split_windows(ts) == [(evening[0], evening[-1])]


def test_short_fragment_is_discarded():
    ts = polls(T0, 10)  # 9 minutes of polling
    assert split_windows(ts) == []


def test_brief_poll_failures_do_not_split():
    # a few missed polls (gap below MAX_GAP_SECS) stay one window
    ts = polls(T0, 30) + polls(T0 + 30 * 60 + 480, 30)
    assert len(split_windows(ts)) == 1


def test_covered_secs_clips_to_period():
    windows = [(T0, T0 + 3600), (T0 + 10 * 3600, T0 + 11 * 3600)]
    assert covered_secs(windows) == 7200
    # period overlapping only the second window's first half hour
    assert covered_secs(windows, T0 + 2 * 3600, T0 + 10 * 3600 + 1800) == 1800
    assert covered_secs(windows, T0 + 2 * 3600, T0 + 3 * 3600) == 0


def test_filter_to_coverage_drops_stray_rows():
    windows = [(T0, T0 + 3600)]
    df = pd.DataFrame({"poll_ts": [T0 + 60, T0 + 3600, T0 + 5 * 3600],
                       "route_id": ["1", "1", "3"]})
    kept = filter_to_coverage(df, windows)
    assert list(kept["poll_ts"]) == [T0 + 60, T0 + 3600]


def test_filter_to_coverage_empty_windows():
    df = pd.DataFrame({"poll_ts": [T0]})
    assert filter_to_coverage(df, []).empty
