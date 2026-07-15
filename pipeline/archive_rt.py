"""Archive Calgary Transit's GTFS-Realtime feeds for later analysis.

Polls vehicle positions and trip updates every POLL_SECS, flushes to
parquet every FLUSH_SECS into per-day directories:

    data/rt/YYYY-MM-DD/vp_HHMMSS.parquet   one row per vehicle per poll
    data/rt/YYYY-MM-DD/tu_HHMMSS.parquet   one row per trip per poll
                                           (delay at next stop)

Runs forever; designed to sit under launchd (see launchd/README.md).
Duplicate polls (feed not yet refreshed) are skipped via the feed
header timestamp.

Usage: python archive_rt.py [--max-minutes N]   (N for test runs)
"""

import argparse
import datetime as dt
import signal
import sys
import time

import pandas as pd
import requests
from google.transit import gtfs_realtime_pb2

from common import DATA_RT, RT_TRIP_UPDATES_URL, RT_VEHICLE_POSITIONS_URL, ensure_dirs

POLL_SECS = 60
FLUSH_SECS = 300

vp_buffer: list[dict] = []
tu_buffer: list[dict] = []
last_feed_ts = {"vp": 0, "tu": 0}


def fetch_feed(url: str) -> gtfs_realtime_pb2.FeedMessage:
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    feed = gtfs_realtime_pb2.FeedMessage()
    feed.ParseFromString(resp.content)
    return feed


def collect_vehicle_positions(poll_ts: int) -> int:
    feed = fetch_feed(RT_VEHICLE_POSITIONS_URL)
    if feed.header.timestamp <= last_feed_ts["vp"]:
        return 0
    last_feed_ts["vp"] = feed.header.timestamp
    n = 0
    for e in feed.entity:
        if not e.HasField("vehicle"):
            continue
        v = e.vehicle
        vp_buffer.append({
            "poll_ts": poll_ts,
            "feed_ts": feed.header.timestamp,
            "vehicle_ts": v.timestamp,
            "trip_id": v.trip.trip_id,
            "route_id": v.trip.route_id,
            "vehicle_id": v.vehicle.id,
            "lat": v.position.latitude,
            "lon": v.position.longitude,
            "bearing": v.position.bearing if v.position.HasField("bearing") else None,
            "speed": v.position.speed if v.position.HasField("speed") else None,
        })
        n += 1
    return n


def collect_trip_updates(poll_ts: int) -> int:
    feed = fetch_feed(RT_TRIP_UPDATES_URL)
    if feed.header.timestamp <= last_feed_ts["tu"]:
        return 0
    last_feed_ts["tu"] = feed.header.timestamp
    n = 0
    for e in feed.entity:
        if not e.HasField("trip_update"):
            continue
        tu = e.trip_update
        # keep only the first upcoming stop_time_update: the trip's
        # current delay estimate (full per-stop history would be ~30x larger)
        if not tu.stop_time_update:
            continue
        stu = tu.stop_time_update[0]
        event = stu.arrival if stu.HasField("arrival") else stu.departure
        # Calgary publishes absolute predicted times, not delays; delay is
        # derived later in rt_metrics.py as pred_time - scheduled time.
        tu_buffer.append({
            "poll_ts": poll_ts,
            "feed_ts": feed.header.timestamp,
            "trip_id": tu.trip.trip_id,
            "route_id": tu.trip.route_id,
            "vehicle_id": tu.vehicle.id,
            "stop_id": stu.stop_id,
            "stop_sequence": stu.stop_sequence,
            "pred_time": event.time if event.HasField("time") else None,
            "delay_s": event.delay if event.HasField("delay") else None,
        })
        n += 1
    return n


def flush() -> None:
    now = dt.datetime.now()
    day_dir = DATA_RT / now.strftime("%Y-%m-%d")
    day_dir.mkdir(parents=True, exist_ok=True)
    stamp = now.strftime("%H%M%S")
    for name, buf in (("vp", vp_buffer), ("tu", tu_buffer)):
        if buf:
            pd.DataFrame(buf).to_parquet(day_dir / f"{name}_{stamp}.parquet",
                                         index=False)
            print(f"[{now:%H:%M:%S}] flushed {len(buf):>5} {name} rows", flush=True)
            buf.clear()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-minutes", type=float, default=None,
                        help="stop after N minutes (for testing)")
    args = parser.parse_args()
    ensure_dirs()

    def on_term(signum, frame):
        flush()
        sys.exit(0)

    signal.signal(signal.SIGTERM, on_term)
    signal.signal(signal.SIGINT, on_term)

    started = time.time()
    last_flush = time.time()
    print(f"archiver started, polling every {POLL_SECS}s", flush=True)
    while True:
        poll_ts = int(time.time())
        for label, fn in (("vp", collect_vehicle_positions),
                          ("tu", collect_trip_updates)):
            try:
                fn(poll_ts)
            except Exception as exc:  # network blips must not kill the loop
                print(f"[warn] {label} poll failed: {exc}", flush=True)
        if time.time() - last_flush >= FLUSH_SECS:
            flush()
            last_flush = time.time()
        if args.max_minutes and (time.time() - started) / 60 >= args.max_minutes:
            flush()
            print("max duration reached, exiting")
            return
        time.sleep(POLL_SECS)


if __name__ == "__main__":
    main()
