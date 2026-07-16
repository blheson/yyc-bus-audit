// Methodology page — how the numbers are made, and what they are not.
// Content mirrors docs/FINDINGS-*.md; keep the honesty framing intact.

function Section({ title, children }) {
  return (
    <section
      className="rounded-xl border p-4"
      style={{ background: "var(--surface-1)", borderColor: "var(--border)" }}
    >
      <h2 className="mb-2 text-sm font-semibold" style={{ color: "var(--ink-1)" }}>
        {title}
      </h2>
      <div className="space-y-2 text-[13px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
        {children}
      </div>
    </section>
  );
}

const SOURCES = [
  ["Static GTFS schedule", "npk7-z3bj", "routes, trips, stop times, shapes"],
  ["GTFS-Realtime feeds", "am7c-qe3u · gs4m-mdc2", "vehicle positions + trip updates, archived every 60 s"],
  ["Monthly ridership", "iema-jbc4", "the calibration total (bus boardings/month)"],
  ["2021 federal census by community", "f9wk-wej9", "population + community polygons"],
  ["2016 civic census, modes of travel", "7ta2-pupq", "community transit mode share"],
  ["LRT stations", "2axz-xm4q", "feeder-stop flag"],
  ["CBD cordon counts 2019 / 2023", "ghvn-cts5 · ii28-85m5", "downtown sanity anchor (daily totals only)"],
];

export default function MethodologyView() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-4 p-4 pb-10">
        <p className="max-w-2xl text-[13px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
          This is an unofficial, open-data-only analysis. Everything below can be
          reproduced from the public pipeline; every guarantee the optimizer makes
          is asserted in code, and every number that rests on a model is labeled as
          modeled. The honest limitation up front:{" "}
          <strong style={{ color: "var(--ink-1)" }}>
            Calgary publishes no per-stop or per-route ridership, so demand here is
            estimated, not measured.
          </strong>
        </p>

        <p className="max-w-2xl text-[13px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
          The full story — including why the first optimizer run was wrong —
          is in{" "}
          <a
            href="https://github.com/blheson/yyc-bus-audit/blob/master/docs/WRITEUP.md"
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--ink-1)", textDecoration: "underline" }}
          >
            the write-up
          </a>
          ; the pipeline, data exports, and this app are open source at{" "}
          <a
            href="https://github.com/blheson/yyc-bus-audit"
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--ink-1)", textDecoration: "underline" }}
          >
            github.com/blheson/yyc-bus-audit
          </a>
          .
        </p>

        <Section title="Data sources (Open Calgary)">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <tbody>
                {SOURCES.map(([name, id, use]) => (
                  <tr key={id} className="border-t" style={{ borderColor: "var(--hairline)" }}>
                    <td className="py-1.5 pr-2 font-medium" style={{ color: "var(--ink-1)" }}>
                      {name}
                    </td>
                    <td className="py-1.5 pr-2 font-mono text-[11px]" style={{ color: "var(--ink-3)" }}>
                      {id}
                    </td>
                    <td className="py-1.5" style={{ color: "var(--ink-2)" }}>
                      {use}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="1 · Supply — what the schedule burns">
          <p>
            From the GTFS schedule: trips, headways (median gap, worst direction),
            and vehicle-kilometres per route and period, cross-checked against route
            geometry. Vehicle-km is the fuel proxy: ~48.4M bus km/year ≈ 24.2M litres
            of diesel ≈ 64,800 t CO₂ at a fleet-average 0.5 L/km (Calgary's CNG and
            electric buses make the true litres lower; the kilometres stand).
          </p>
        </Section>

        <Section title="2 · Demand — a calibrated gravity model">
          <p>
            Each stop's demand potential = population within 400 m × the community's
            transit mode share × a downtown-attraction kernel (3 km decay) × an LRT
            feeder bonus. Potentials are spread over the day with canonical transit
            demand curves and scaled so the citywide total equals the published
            224,517 bus boardings per average weekday (12-month mean). Demand is then
            split across the routes serving each stop by their share of departures.
          </p>
          <p>
            Because there is nothing to train on, this is a structural model, not a
            fitted one — totals are anchored, the spatial distribution is not
            validated. All downstream loads carry a three-scenario range
            (conservative / moderate / aggressive) instead of a point claim.
          </p>
        </Section>

        <Section title="3 · Optimizer — trade trips for fuel, within guardrails">
          <p>
            An OR-Tools CP-SAT model picks a headway per route × period × day type
            from {"{10, 12, 15, 20, 30, 45, 60}"} minutes, never shorter than today's,
            maximizing vehicle-km saved subject to:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong style={{ color: "var(--ink-1)" }}>Capacity</strong> — modeled peak
              load stays within 55 seats × the scenario's load-factor policy.
            </li>
            <li>
              <strong style={{ color: "var(--ink-1)" }}>Availability</strong> — no stop
              loses service in any period it has today; nothing goes worse than
              hourly; already-hourly service is untouched.
            </li>
            <li>
              <strong style={{ color: "var(--ink-1)" }}>Service standards</strong> —
              routes at ≤15 min stay ≤15 min (the frequent-network promise); no wait
              more than doubles.
            </li>
            <li>
              <strong style={{ color: "var(--ink-1)" }}>Ridership</strong> — boardings
              lost to longer waits (headway elasticity −0.4) stay under a system-wide
              budget: 2% / 3.5% / 5% by scenario. This is the binding constraint.
            </li>
          </ul>
          <p>
            Worth knowing: a capacity-only version of this optimizer "saved" ~50% of
            vehicle-km by cutting BRT lines to hourly — a model-error artifact, not a
            plan. The guardrails above are what make the result mean something. Every
            constraint is asserted programmatically against the outputs.
          </p>
        </Section>

        <Section title="What this is — and is not">
          <p>
            This is a feasibility argument built entirely on open data: roughly 10%
            of bus vehicle-km (≈$4M/year, ≈6,700 t CO₂) appears tradeable at ≤2%
            modeled ridership impact, concentrated in off-peak and weekend service on
            long, thin routes. It is not a service plan: demand is modeled, savings
            assume trips scale with headway, and a real runcut, APC (automatic
            passenger counter) data, and rider equity analysis would all move the
            numbers. The upgrade path is exactly that — Calgary Transit's APC data
            would replace the weakest layer while the rest of the pipeline stands.
          </p>
        </Section>

        <Section title="Reproduce it">
          <pre
            className="overflow-x-auto rounded-lg border p-3 font-mono text-[11px] leading-relaxed"
            style={{ borderColor: "var(--hairline)", color: "var(--ink-2)" }}
          >
            {`cd pipeline && python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python ingest_gtfs.py     # GTFS -> parquet
.venv/bin/python supply.py          # vehicle-km, headways, overlaps
.venv/bin/python ingest_demand.py   # census, ridership, cordon, LRT
.venv/bin/python demand_model.py    # calibrated gravity model
.venv/bin/python optimize.py        # CP-SAT frequency optimizer
.venv/bin/python -m pytest          # every guarantee, asserted`}
          </pre>
        </Section>
      </div>
    </div>
  );
}
