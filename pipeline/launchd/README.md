# Running the GTFS-RT archiver continuously

The archiver polls Calgary Transit's realtime feeds every 60s and writes
parquet files under `data/rt/YYYY-MM-DD/`. Storage is roughly 5–10 MB/day.
Aim for **2+ weeks** of data before running `rt_metrics.py`.

## Install (launchd keeps it running and restarts it after reboots/crashes)

```sh
cp pipeline/launchd/com.calgarytransit.archiver.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.calgarytransit.archiver.plist
```

## Check it's working

```sh
launchctl list | grep calgarytransit          # should show the label
tail -f data/rt/archiver.log                  # flush lines every 5 min
ls data/rt/$(date +%F)/                       # parquet files accumulating
```

## Stop / uninstall

```sh
launchctl bootout gui/$(id -u)/com.calgarytransit.archiver
rm ~/Library/LaunchAgents/com.calgarytransit.archiver.plist
```

## Notes

- The laptop must be awake for polls to happen; gaps (sleep, no wifi) are
  fine — the analysis tolerates missing intervals. If you want denser
  coverage, keep the lid open on AC power, or run
  `caffeinate -s pipeline/.venv/bin/python pipeline/archive_rt.py` in a
  terminal instead of launchd.
- Test run without installing:
  `pipeline/.venv/bin/python pipeline/archive_rt.py --max-minutes 10`
