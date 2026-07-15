import { FLAG_INFO, PERIOD_NAMES, fmt } from "../lib/data";
import { FrequencyStrip, Roundel } from "./RouteList";

function Stat({ label, value, unit }) {
  return (
    <div>
      <div className="text-base font-semibold tabular-nums" style={{ color: "var(--ink-1)" }}>
        {value}
        {unit && (
          <span className="ml-0.5 text-xs font-normal" style={{ color: "var(--ink-2)" }}>
            {unit}
          </span>
        )}
      </div>
      <div className="text-[11px]" style={{ color: "var(--ink-3)" }}>
        {label}
      </div>
    </div>
  );
}

function FlagChip({ flag }) {
  const info = FLAG_INFO[flag];
  if (!info) return null;
  const color =
    info.tone === "serious"
      ? "var(--status-serious)"
      : info.tone === "warning"
        ? "var(--status-warning)"
        : "var(--ink-2)";
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={{ borderColor: "var(--border)", color }}
    >
      <span aria-hidden="true">{info.icon}</span>
      {info.label}
    </span>
  );
}

const DAY_SHORT = { weekday: "Wkday", saturday: "Sat", sunday: "Sun" };

function OptimizerSection({ route, optimizer }) {
  if (!optimizer) return null;
  const money = new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  });
  const litres =
    route.savedKmYear * (optimizer.assumptions.diesel_l_per_km || 0.5);
  return (
    <div>
      <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--ink-3)" }}>
        Optimizer proposal · conservative scenario
      </h3>
      {route.changes.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--ink-2)" }}>
          No change proposed — modeled loads or service standards keep
          today's frequency in place.
        </p>
      ) : (
        <>
          <table className="w-full text-xs" style={{ color: "var(--ink-2)" }}>
            <thead>
              <tr className="text-left" style={{ color: "var(--ink-3)" }}>
                <th className="py-0.5 font-medium">When</th>
                <th className="py-0.5 text-right font-medium">Every</th>
                <th className="py-0.5 text-right font-medium">Peak load</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {route.changes.map((c) => (
                <tr
                  key={`${c.day}-${c.period}`}
                  className="border-t"
                  style={{ borderColor: "var(--hairline)" }}
                >
                  <td className="py-1">
                    {DAY_SHORT[c.day]} {(PERIOD_NAMES[c.period] || c.period).split(" (")[0].toLowerCase()}
                  </td>
                  <td className="py-1 text-right">
                    {Math.round(c.headway)} → <strong style={{ color: "var(--ink-1)" }}>{Math.round(c.new_headway)}</strong> min
                  </td>
                  <td className="py-1 text-right">
                    {c.peak_load} → {c.peak_load_new}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1.5 text-xs" style={{ color: "var(--ink-1)" }}>
            ≈ {fmt.format(Math.round(route.savedKmYear))} km,{" "}
            {fmt.format(Math.round(litres))} L diesel,{" "}
            {money.format(litres * (optimizer.assumptions.diesel_price_cad_per_l || 1.65))}{" "}
            saved per year
          </p>
        </>
      )}
    </div>
  );
}

function DemandSection({ route }) {
  const wd = route.demand?.days?.weekday;
  if (!wd) return null;
  const order = ["am_peak", "midday", "pm_peak", "evening", "early_late"];
  const rows = order.filter((k) => wd[k]);
  return (
    <div>
      <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--ink-3)" }}>
        Modeled weekday demand
      </h3>
      <table className="w-full text-xs" style={{ color: "var(--ink-2)" }}>
        <thead>
          <tr className="text-left" style={{ color: "var(--ink-3)" }}>
            <th className="py-0.5 font-medium">Period</th>
            <th className="py-0.5 text-right font-medium">Board / trip</th>
            <th className="py-0.5 text-right font-medium">Peak load range</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map((k) => (
            <tr key={k} className="border-t" style={{ borderColor: "var(--hairline)" }}>
              <td className="py-1">{(PERIOD_NAMES[k] || k).split(" (")[0]}</td>
              <td className="py-1 text-right">{wd[k].boardings_per_trip}</td>
              <td className="py-1 text-right">
                {wd[k].peak_load_range[0]}–{wd[k].peak_load_range[2]} pax
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[11px]" style={{ color: "var(--ink-3)" }}>
        Modeled from land use, calibrated to system totals — not measured.
      </p>
    </div>
  );
}

export default function RouteDetail({ route, allRoutes, systemWeekdayKm, dieselPerKm, optimizer, onSelect, onClose }) {
  const wk = route.weekday;
  const share = (wk.vehicle_km / systemWeekdayKm) * 100;
  const byId = new Map(allRoutes.map((r) => [r.route_id, r]));

  return (
    <div
      className="absolute right-4 top-4 z-[1000] flex max-h-[calc(100%-2rem)] w-80 flex-col overflow-hidden rounded-xl border shadow-lg"
      style={{ background: "var(--surface-1)", borderColor: "var(--border)" }}
      role="region"
      aria-label={`Route ${route.short_name} details`}
    >
      <div className="flex items-start gap-2.5 border-b p-3" style={{ borderColor: "var(--hairline)" }}>
        <Roundel route={route} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold leading-tight" style={{ color: "var(--ink-1)" }}>
            {route.long_name}
          </h2>
          <div className="text-xs" style={{ color: "var(--ink-2)" }}>
            {route.is_bus ? "Bus route" : "CTrain line"} · {route.length_km} km one way
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close route details"
          className="rounded-md px-1.5 text-lg leading-none"
          style={{ color: "var(--ink-3)" }}
        >
          ×
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="km per weekday" value={fmt.format(Math.round(wk.vehicle_km))} />
          <Stat label="of all bus km" value={share.toFixed(1)} unit="%" />
          {route.is_bus ? (
            <Stat
              label="est. diesel / weekday"
              value={fmt.format(Math.round(wk.vehicle_km * dieselPerKm))}
              unit="L"
            />
          ) : (
            <Stat label="powered by" value="electric" />
          )}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="trips per weekday" value={wk.trips} />
          <Stat label="median speed" value={wk.avg_speed_kmh} unit="km/h" />
          <Stat label="buses at peak (est.)" value={wk.peak_vehicles_est ?? "–"} />
        </div>

        {(route.flags || []).length > 0 && (
          <div className="flex flex-wrap gap-1">
            {route.flags.map((f) => (
              <FlagChip key={f} flag={f} />
            ))}
          </div>
        )}

        {route.is_bus && <OptimizerSection route={route} optimizer={optimizer} />}
        {route.is_bus && <DemandSection route={route} />}

        <div>
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--ink-3)" }}>
            Weekday frequency
          </h3>
          <FrequencyStrip route={route} />
          <table className="mt-2 w-full text-xs" style={{ color: "var(--ink-2)" }}>
            <thead>
              <tr className="text-left" style={{ color: "var(--ink-3)" }}>
                <th className="py-0.5 font-medium">Period</th>
                <th className="py-0.5 text-right font-medium">Every</th>
                <th className="py-0.5 text-right font-medium">Trips</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {Object.entries(wk.periods).map(([key, p]) => (
                <tr key={key} className="border-t" style={{ borderColor: "var(--hairline)" }}>
                  <td className="py-1">{PERIOD_NAMES[key] || key}</td>
                  <td className="py-1 text-right">
                    {p.median_headway_min != null ? `${p.median_headway_min} min` : "–"}
                  </td>
                  <td className="py-1 text-right">{p.trips}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {route.overlaps.length > 0 && (
          <div>
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--ink-3)" }}>
              Shares its corridor with
            </h3>
            <div className="space-y-1">
              {route.overlaps.slice(0, 5).map((o) => {
                const other = byId.get(o.routeId);
                if (!other) return null;
                return (
                  <button
                    key={o.routeId}
                    type="button"
                    onClick={() => onSelect(o.routeId)}
                    className="flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs"
                    style={{ borderColor: "var(--border)", color: "var(--ink-2)" }}
                  >
                    <Roundel route={other} />
                    <span className="min-w-0 flex-1 truncate">{other.long_name}</span>
                    <span className="tabular-nums" style={{ color: "var(--ink-1)" }}>
                      {o.overlapKm} km
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
