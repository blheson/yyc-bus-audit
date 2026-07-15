// Citywide savings dashboard — reads optimizer.json (+ joined routes).
import { PERIOD_NAMES, fmt } from "../lib/data";
import { Roundel } from "./RouteList";

const compact = new Intl.NumberFormat("en-CA", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const money = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  notation: "compact",
  maximumFractionDigits: 1,
});
const DAY_SHORT = { weekday: "Weekday", saturday: "Saturday", sunday: "Sunday" };

function Hero({ value, unit, label, accent }) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{ background: "var(--surface-1)", borderColor: "var(--border)" }}
    >
      <div
        className="text-2xl font-bold leading-tight tabular-nums"
        style={{ color: accent ? "var(--save-3)" : "var(--ink-1)" }}
      >
        {value}
        {unit && (
          <span className="ml-1 text-sm font-normal" style={{ color: "var(--ink-2)" }}>
            {unit}
          </span>
        )}
      </div>
      <div className="mt-1 text-xs" style={{ color: "var(--ink-3)" }}>
        {label}
      </div>
    </div>
  );
}

function ScenarioTable({ summary }) {
  const order = ["conservative", "moderate", "aggressive"];
  return (
    <table className="w-full text-sm" style={{ color: "var(--ink-2)" }}>
      <thead>
        <tr className="text-left text-xs" style={{ color: "var(--ink-3)" }}>
          <th className="py-1.5 font-medium">Scenario</th>
          <th className="py-1.5 text-right font-medium">km / year</th>
          <th className="py-1.5 text-right font-medium">% of bus km</th>
          <th className="py-1.5 text-right font-medium">Diesel</th>
          <th className="py-1.5 text-right font-medium">CO₂</th>
          <th className="py-1.5 text-right font-medium">Value</th>
          <th className="py-1.5 text-right font-medium">Ridership impact</th>
        </tr>
      </thead>
      <tbody className="tabular-nums">
        {order.map((k) => {
          const s = summary[k];
          return (
            <tr key={k} className="border-t" style={{ borderColor: "var(--hairline)" }}>
              <td className="py-2 font-medium capitalize" style={{ color: "var(--ink-1)" }}>
                {k}
              </td>
              <td className="py-2 text-right">{compact.format(s.saved_km_annual)}</td>
              <td className="py-2 text-right">{s.pct_of_baseline}%</td>
              <td className="py-2 text-right">{compact.format(s.saved_diesel_l)} L</td>
              <td className="py-2 text-right">{fmt.format(s.saved_co2_t)} t</td>
              <td className="py-2 text-right">{money.format(s.saved_cad)}</td>
              <td className="py-2 text-right">−{s.ridership_loss_pct}%</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function TopRoutesBars({ routes, onSelectRoute }) {
  const top = [...routes]
    .filter((r) => r.is_bus && r.savedKmYear > 0)
    .sort((a, b) => b.savedKmYear - a.savedKmYear)
    .slice(0, 12);
  if (!top.length) return null;
  const max = top[0].savedKmYear;
  return (
    <div className="space-y-1">
      {top.map((r) => (
        <button
          key={r.route_id}
          type="button"
          onClick={() => onSelectRoute(r.route_id)}
          className="flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left text-xs hover:opacity-80"
          title={`${r.long_name} — open on map`}
        >
          <Roundel route={r} />
          <span className="w-40 min-w-0 truncate" style={{ color: "var(--ink-2)" }}>
            {r.long_name}
          </span>
          <span className="relative h-3 min-w-0 flex-1">
            <span
              className="absolute inset-y-0 left-0 rounded-r-[4px]"
              style={{
                width: `${Math.max(2, (r.savedKmYear / max) * 100)}%`,
                background: "var(--save-2)",
              }}
            />
          </span>
          <span className="w-20 text-right tabular-nums" style={{ color: "var(--ink-1)" }}>
            {compact.format(Math.round(r.savedKmYear))} km
          </span>
        </button>
      ))}
    </div>
  );
}

export default function SavingsView({ data, onSelectRoute }) {
  const opt = data.optimizer;
  if (!opt) {
    return (
      <div className="p-8 text-sm" style={{ color: "var(--ink-2)" }}>
        Optimizer output not found — run <code>pipeline/optimize.py</code> to
        generate <code>public/data/optimizer.json</code>.
      </div>
    );
  }
  const cons = opt.summary.conservative;
  const changes = opt.changes_conservative.slice(0, 15);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-6 p-4 pb-10">
        <section>
          <h2 className="mb-1 text-sm font-semibold" style={{ color: "var(--ink-1)" }}>
            What the schedule could save — conservative scenario
          </h2>
          <p className="mb-3 max-w-2xl text-xs" style={{ color: "var(--ink-3)" }}>
            Frequency trades on {cons.cells_changed} of {cons.cells_total} route-periods,
            with no stop losing service, the frequent network kept frequent, no wait
            more than doubled, and modeled ridership impact capped at −
            {cons.ridership_loss_pct}%. Demand is modeled, not measured — see Methodology.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Hero
              accent
              value={compact.format(cons.saved_km_annual)}
              unit="km/yr"
              label={`${cons.pct_of_baseline}% of bus vehicle-km`}
            />
            <Hero
              value={compact.format(cons.saved_diesel_l)}
              unit="L"
              label="diesel avoided per year"
            />
            <Hero value={fmt.format(cons.saved_co2_t)} unit="t" label="CO₂ avoided per year" />
            <Hero value={money.format(cons.saved_cad)} unit="/yr" label="at current diesel prices" />
            <Hero
              value={`−${cons.ridership_loss_pct}%`}
              label="modeled ridership impact (capped)"
            />
          </div>
        </section>

        <section
          className="rounded-xl border p-4"
          style={{ background: "var(--surface-1)", borderColor: "var(--border)" }}
        >
          <h2 className="mb-2 text-sm font-semibold" style={{ color: "var(--ink-1)" }}>
            Three scenarios, one trade-off
          </h2>
          <div className="overflow-x-auto">
            <ScenarioTable summary={opt.summary} />
          </div>
          <p className="mt-2 text-[11px]" style={{ color: "var(--ink-3)" }}>
            Scenarios pair demand assumptions with policy strictness; the ridership
            budget (headway elasticity −0.4) is the binding constraint in all three.
          </p>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section
            className="rounded-xl border p-4"
            style={{ background: "var(--surface-1)", borderColor: "var(--border)" }}
          >
            <h2 className="mb-2 text-sm font-semibold" style={{ color: "var(--ink-1)" }}>
              Where the savings live
            </h2>
            <TopRoutesBars routes={data.routes} onSelectRoute={onSelectRoute} />
          </section>

          <section
            className="rounded-xl border p-4"
            style={{ background: "var(--surface-1)", borderColor: "var(--border)" }}
          >
            <h2 className="mb-2 text-sm font-semibold" style={{ color: "var(--ink-1)" }}>
              Largest single changes
            </h2>
            <table className="w-full text-xs" style={{ color: "var(--ink-2)" }}>
              <thead>
                <tr className="text-left" style={{ color: "var(--ink-3)" }}>
                  <th className="py-1 font-medium">Route</th>
                  <th className="py-1 font-medium">When</th>
                  <th className="py-1 text-right font-medium">Every</th>
                  <th className="py-1 text-right font-medium">km/day</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {changes.map((c, i) => (
                  <tr key={i} className="border-t" style={{ borderColor: "var(--hairline)" }}>
                    <td className="py-1.5 font-medium" style={{ color: "var(--ink-1)" }}>
                      {c.route}
                    </td>
                    <td className="py-1.5">
                      {DAY_SHORT[c.day]} {(PERIOD_NAMES[c.period] || c.period).split(" (")[0].toLowerCase()}
                    </td>
                    <td className="py-1.5 text-right">
                      {Math.round(c.headway)} → {Math.round(c.new_headway)} min
                    </td>
                    <td className="py-1.5 text-right">{fmt.format(Math.round(c.saved_km_day))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </div>
  );
}
