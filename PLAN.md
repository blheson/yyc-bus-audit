# Calgary Bus Route Optimization — Analysis Pipeline + Map App

## End goal

A **well-executed civic data project**: finished, deployed, honestly framed, and put in front of people. Success is the quality and reception of the artifact — not the city adopting the schedule (transit agencies don't adopt outside schedules directly; they have their own planners, APC data, and political constraints). "Meaningful for government" is achieved through Phase 6 below, with the direct city pitch as the stretch outcome, not the bar.

## Context

Personal project: use AI/optimization on Calgary's open transit data to find bus schedule changes that cut fuel use (vehicle-km) without reducing service availability — potentially growing into a proposal for the city.

**Verified data reality (checked 2026-07-14):**
- Calgary publishes static GTFS (`CT_GTFS.zip`, dataset `npk7-z3bj`) and GTFS-Realtime feeds updated every 30s: vehicle positions (`am7c-qe3u`), trip updates (`gs4m-mdc2`), alerts (`jhgn-ynqj`).
- **The RT feed carries NO `occupancy_status`** (decoded live feed: 379 vehicles, only trip_id/position/timestamp/vehicle_id). Ridership dataset (`iema-jbc4`) is monthly + system-level only (includes a "Bus Boarding Passengers" column usable as a calibration total).
- Therefore per-bus emptiness must be **estimated** via a demand model built from proxies: civic census Modes of Travel to Work (`7tad-i2m6`, `7ta2-pupq`), downtown cordon counts 2012–2023, transit stops (`muzh-c9qc`), stops-by-route xref (`pm3p-838w`), LRT stations (`2axz-xm4q`), routes GIS (`hpnd-riq4`).

**Decisions:** analysis-first milestone; Python pipeline + existing React/Vite/Leaflet app (this repo) as presentation layer; include a GTFS-RT archiver. (FOIP request for APC data noted as future option, not a deliverable.)

## Architecture

```
copilot_app/
├── pipeline/                 # Python (new)
│   ├── requirements.txt      # pandas, pyarrow, requests, gtfs-realtime-bindings, ortools, scikit-learn, shapely
│   ├── ingest_gtfs.py        # download + parse CT_GTFS.zip
│   ├── archive_rt.py         # poll RT feeds → daily parquet
│   ├── supply.py             # vehicle-km, headways, overlap analysis
│   ├── rt_metrics.py         # speeds, adherence, bunching (needs archived weeks)
│   ├── demand_model.py       # stop×hour boardings estimate, calibrated to monthly totals
│   ├── optimize.py           # OR-Tools frequency-setting MIP
│   └── export_json.py        # writes public/data/*.json for the app
├── data/raw/, data/rt/, data/processed/   # gitignored
├── public/data/              # generated JSON consumed by app
└── src/                      # React app (existing starter, to be rebuilt in a later milestone)
```

Pipeline outputs static JSON; no backend server needed.

## Phases (first milestone = Phases 0–2 + starting the archiver; 3–5 follow)

### Phase 0 — Setup
- `pipeline/` package, requirements.txt, extend `.gitignore` for `data/`.

### Phase 1 — GTFS ingest + supply analysis (first real findings)
- `ingest_gtfs.py`: download `https://data.calgary.ca/download/npk7-z3bj/application%2Fx-zip-compressed` (verify URL at runtime), load routes/trips/stop_times/shapes/calendar into DataFrames/parquet.
- `supply.py` per route × period (AM peak / midday / PM peak / evening / weekend):
  - trips per hour → headway; route length from shapes → **vehicle-km/day** (fuel proxy); round-trip time / headway → vehicles required.
  - Corridor overlap: buffer route shapes (~150m), find segments served by 2+ routes with high combined frequency.
  - Flag candidates: long routes with low estimated productivity, hourly-only routes, duplicated corridors.
- Spot-check computed headways for 2–3 well-known routes against calgarytransit.com published schedules.
- Deliverable: `public/data/supply.json` + a short findings write-up.

### Phase 2 — GTFS-RT archiver (start early; value accrues over weeks)
- `archive_rt.py`: poll VP (`https://data.calgary.ca/download/am7c-qe3u/application%2Foctet-stream`) + trip updates every 60s, parse with `gtfs-realtime-bindings`, append to daily parquet in `data/rt/`. ~30MB/day raw; parquet much smaller.
- Run via launchd agent on macOS (provide plist + install instructions); resilient to network blips.
- After ~2 weeks: `rt_metrics.py` → actual segment speeds by hour, schedule adherence, bunching, layover/dead time.

### Phase 3 — Demand model (the "AI" estimation layer)
- Features per stop: population within 400m (census communities), community transit mode-share, LRT-feeder flag, distance to downtown, stop's route count.
- Temporal profile from cordon counts + standard transit demand curves.
- Model: gradient-boosted regressor (scikit-learn) or calibrated gravity model → boardings per stop per hour; **scale so citywide monthly total matches published "Bus Boarding Passengers"** from `iema-jbc4`.
- Roll up to route load profiles → peak-load point per route × period.

### Phase 4 — Optimizer
- `optimize.py`, OR-Tools MIP/CP-SAT:
  - **Variable:** headway per (route, period) from {10, 12, 15, 20, 30, 45, 60} min.
  - **Objective:** minimize total vehicle-km.
  - **Constraints:** (a) peak load per trip = demand × headway ≤ bus capacity × load-factor policy; (b) headway ≤ current headway at every route/period (availability never worse); (c) total vehicles needed per period ≤ current fleet usage.
  - Convert savings: vehicle-km → diesel (~50 L/100km) → CO₂ (2.68 kg/L) → $/year.
- Run 3 scenarios (conservative/moderate/aggressive load factors); assert constraint satisfaction in code.

### Phase 5 — App (later milestone, after findings exist)
- Rebuild `src/`: Leaflet map of route shapes colored by savings opportunity; route detail panel (headway before/after, estimated load profile, savings); citywide savings dashboard; methodology page (credibility for a city pitch). Reads `public/data/*.json`.

### Phase 6 — Dissemination (the actual finish line)
Prerequisite: ~~`git init`~~ (done 2026-07-15) + public GitHub repo (not yet created).
- **Publish the code**: GitHub repo, README leading with the headline number ("X% vehicle-km savings ≈ Y litres diesel ≈ $Z/year, with no stop served worse than today").
- **Deploy the app**: static JSON means GitHub Pages/Netlify, free — a live map link is the demo.
- **Write-up**: methodology + limitations (modeled demand, ranges not point claims, fuel factor caveats) as a blog post or docs page. This is what makes transit professionals engage instead of dismissing it.
- **Civic channels** (roughly in order of ease):
  1. Submit to Calgary's open data program as a showcase use (they actively look for these).
  2. Present at Civic Tech YYC.
  3. Brief transit advocacy groups / a councillor's office — lead with the positive-sum corridor-coordination finding, not cuts.
  4. Pitch Calgary Transit for an APC data partnership ("open data alone shows this much — your data makes it decision-grade"); FOIP as fallback.
- Success metric: project is public, deployed, written up, and presented in at least one civic channel. A response from the city is upside, not the bar.

## Verification
- **Phase 1:** pytest sanity checks (vehicle-km totals in plausible range; headways match published schedules for spot-checked routes; every route has shape + stops).
- **Phase 2:** run archiver 10 minutes → confirm parquet rows accumulate with valid coordinates/timestamps; kill/restart survives.
- **Phase 4:** programmatic assertions that every solution respects capacity/availability/fleet constraints; compare objective vs current schedule baseline.
- **Phase 5:** `npm run dev`, load map, click through routes.

## Honest-framing notes (for the eventual pitch)
- Demand is *modeled*, not measured — present ranges, not point claims. The upgrade path is requesting Calgary Transit's internal APC data (FOIP or partnership).
- Empty buses aren't automatically waste (deadheading, directional imbalance, service guarantees) — the supply analysis distinguishes these.
