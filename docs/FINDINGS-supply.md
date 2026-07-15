# Supply Analysis — First Findings

*Generated from Calgary Transit GTFS (July 2026 regular service), by
`pipeline/supply.py`. Full data: `public/data/supply.json`.*

## System scale (the fuel baseline)

| | Weekday | Saturday | Sunday |
|---|---|---|---|
| Bus trips | 10,077 | 6,950 | 6,723 |
| Bus vehicle-km | 146,691 | 101,060 | 98,421 |
| Est. diesel (@0.5 L/km) | ~73,300 L | ~50,500 L | ~49,200 L |

**Annualized: ~48.4M bus vehicle-km ≈ 24.2M litres of diesel ≈ 64,800 t CO₂.**
Every 1% of vehicle-km saved ≈ 242,000 L of diesel/year (~$400k at ~$1.65/L).

## Key observations

1. **Hourly service is rarer than it feels.** Only 6 of 145 weekday bus
   routes run hourly-or-worse midday (35, 119, 135, 404, 414, 440), and they
   account for just **1.5% of system vehicle-km**. Cutting them further
   saves little fuel and hurts availability — they are *not* the
   optimization target. The savings live in the frequent core network,
   where a small headway change multiplies across many daily trips.

2. **27 routes are long (>15 km) with ≤30-min frequency** — classic
   candidates for demand-checking: if modeled loads are low midday,
   these are where trips can be traded for fuel with bounded wait-time
   impact.

3. **62 routes share ≥50% of their alignment with another route.**
   Largest corridor overlaps: 36↔41 (23.2 km), 4↔5 (21.8 km),
   117↔302 (20.7 km), 128↔145 (17 km), 62↔64 (13.5 km).
   *Caveat:* some pairs (11↔12, 36↔41) are clockwise/counterclockwise
   halves of intentional loops — direction-aware analysis in Phase 3
   will separate real duplication from loop pairs.

4. **Slowest routes** (7, 17, 48, 6 at ~15–16 km/h median) burn
   disproportionate fuel per km of coverage; RT archive data will show
   whether it's congestion or padding.

## What this means for the optimizer (Phase 4)

- Objective mass sits in the top ~30 routes by vehicle-km, not the hourly
  community routes.
- The availability constraint ("no stop served worse than today") is cheap
  to honor on the core network, where headways have room between
  "every 7 min" and capacity-justified levels.
- Overlapping corridors offer a second lever: coordinated (offset)
  schedules on shared segments can raise *effective* corridor frequency
  without adding trips.

## Method notes / limitations

- Vehicle-km from GTFS shapes; feed distances cross-checked against
  geometry.
- Headway = median gap between consecutive departures, worst direction.
- Fuel factor 0.5 L/km is a fleet-average placeholder (Calgary runs some
  CNG and electric buses); refine before any public claim.
- Demand is not yet in the picture — nothing here says a trip is
  *unneeded*, only where supply is concentrated. That's Phase 3.
