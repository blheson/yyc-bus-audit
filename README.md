# YYC Bus Audit — Calgary Bus Route Optimizer

**Calgary's bus network could save ~10% of its vehicle-kilometres —
≈5.0M km ≈ 2.5M litres of diesel ≈ 6,700 t CO₂ ≈ $4.1M per year — with
modeled ridership impact under 2% and no stop losing service in any
period it has today.** (Conservative scenario of three; demand is modeled
from open data, not measured — see the write-up for limitations.)

An unofficial, fully reproducible analysis of Calgary Transit open data:
a Python pipeline (GTFS supply analysis → calibrated demand model →
CP-SAT frequency optimizer) presented on an interactive map.

- **Live map:** https://blheson.github.io/yyc-bus-audit/
- **Write-up:** [blog post](https://blheson.github.io/yyc-bus-audit/writeup.html), the argument, the method, and what it does *not* say
- **Detailed findings:** [supply](docs/FINDINGS-supply.md) · [demand](docs/FINDINGS-demand.md) · [optimizer](docs/FINDINGS-optimizer.md)
- **Architecture:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the pipeline fits together, with a system diagram
- **Plan / roadmap:** [PLAN.md](PLAN.md)

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

## Licence

The code and write-up are released under the [MIT License](LICENSE), a
permissive licence that lets anyone reuse them as long as they keep the
copyright notice.

The MIT License does not cover the transit data. That data belongs to the
City of Calgary and is used under the City's
[Open Government Licence](https://data.calgary.ca/stories/s/Open-Calgary-Terms-of-Use/u45n-7awa),
which allows free reuse as long as the source is credited:

> Contains information licensed under the Open Government Licence – City of Calgary.

The files generated from it in `public/data/` remain subject to that
licence, and this project is not affiliated with or endorsed by the City
of Calgary or Calgary Transit.
