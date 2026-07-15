# Calgary Bus Route Optimizer

Personal project: analyze Calgary Transit's open data to find schedule
changes that cut fuel use (vehicle-kilometres) **without reducing service
availability** — and present the findings on an interactive map.

**Live map:** https://blheson.github.io/yyc-bus-audit/

See `PLAN.md` for the full approach, `docs/WRITEUP.md` for the public
write-up, and `docs/FINDINGS-*.md` for detailed results.

## Layout

- `pipeline/` — Python data pipeline (ingest, analysis, optimizer)
- `public/data/` — generated JSON consumed by the web app
- `src/` — React + Leaflet web app (Vite)
- `data/` — downloaded/archived transit data (gitignored, regenerable)

## Pipeline quickstart

```sh
cd pipeline
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python ingest_gtfs.py     # download + parse Calgary GTFS
.venv/bin/python supply.py          # vehicle-km, headways, overlaps
.venv/bin/pytest test_supply.py     # sanity checks
```

To collect realtime data (needed for Phase 2 metrics), open the app's
**Collector** tab and press "Start collecting" — it shows live progress
and stops from the same tab. (Optional always-on alternative:
`pipeline/launchd/README.md`.)

## Web app

```sh
npm install
npm run dev
```

## Data sources

All from [Open Calgary](https://data.calgary.ca): static GTFS
(`npk7-z3bj`), GTFS-RT vehicle positions (`am7c-qe3u`) and trip updates
(`gs4m-mdc2`), monthly ridership (`iema-jbc4`), plus census and cordon
count datasets for demand modeling (Phase 3).
