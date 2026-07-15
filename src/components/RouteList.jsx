import { FILTERS, WEEKDAY_PERIODS, fmt, headwayStep } from "../lib/data";

export function Roundel({ route, size = "md" }) {
  const cls = size === "md" ? "h-9 w-9 text-sm" : "h-11 w-11 text-base";
  return (
    <span
      className={`flex ${cls} shrink-0 items-center justify-center rounded-md font-bold`}
      style={{
        background: route.is_bus ? "var(--brand)" : "var(--ctrain)",
        color: "var(--brand-ink)",
      }}
      aria-hidden="true"
    >
      {route.short_name}
    </span>
  );
}

// The signature element: five cells, one per weekday service period,
// shaded by median headway (darker = more frequent), labeled in minutes.
export function FrequencyStrip({ route }) {
  const periods = route.weekday.periods;
  return (
    <div
      className="grid grid-cols-5 gap-0.5"
      role="img"
      aria-label={`Median headway by period: ${WEEKDAY_PERIODS.map((p) => {
        const h = periods[p.key]?.median_headway_min;
        return `${p.label} ${h != null ? h + " min" : "no service"}`;
      }).join(", ")}`}
    >
      {WEEKDAY_PERIODS.map((p) => {
        const h = periods[p.key]?.median_headway_min;
        const step = headwayStep(h);
        const filled = step != null;
        return (
          <div key={p.key} className="text-center">
            <div
              className="rounded-sm py-0.5 text-[11px] font-semibold tabular-nums"
              style={
                filled
                  ? {
                      background: `var(--freq-${step})`,
                      color: step >= 2 ? "#ffffff" : "#0b0b0b",
                    }
                  : { background: "var(--hairline)", color: "var(--ink-3)" }
              }
            >
              {filled ? Math.round(h) : "–"}
            </div>
            <div className="mt-0.5 text-[9px] tracking-wide" style={{ color: "var(--ink-3)" }}>
              {p.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RouteRow({ route, isSelected, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(route.route_id)}
      aria-pressed={isSelected}
      className="w-full rounded-lg border p-2.5 text-left transition-colors"
      style={{
        background: "var(--surface-1)",
        borderColor: isSelected ? "var(--brand)" : "var(--border)",
        boxShadow: isSelected ? "0 0 0 1px var(--brand)" : "none",
      }}
    >
      <div className="flex items-center gap-2.5">
        <Roundel route={route} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium" style={{ color: "var(--ink-1)" }}>
            {route.long_name}
          </div>
          <div className="text-xs tabular-nums" style={{ color: "var(--ink-2)" }}>
            {fmt.format(Math.round(route.weekday.vehicle_km))} km/weekday
            {!route.is_bus && " · CTrain"}
          </div>
        </div>
      </div>
      <div className="mt-2">
        <FrequencyStrip route={route} />
      </div>
    </button>
  );
}

export default function RouteList({
  routes,
  query,
  onQuery,
  filterKey,
  onFilter,
  sortKey,
  onSort,
  selectedId,
  onSelect,
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5">
      <input
        type="search"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="Find a route by number or name"
        aria-label="Find a route by number or name"
        className="w-full rounded-lg border px-3 py-2 text-sm"
        style={{
          background: "var(--surface-1)",
          borderColor: "var(--border)",
          color: "var(--ink-1)",
        }}
      />

      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter routes">
        {Object.entries(FILTERS).map(([key, f]) => (
          <button
            key={key}
            type="button"
            onClick={() => onFilter(key)}
            aria-pressed={filterKey === key}
            className="rounded-full border px-2.5 py-1 text-xs font-medium"
            style={
              filterKey === key
                ? { background: "var(--ink-1)", color: "var(--surface-1)", borderColor: "var(--ink-1)" }
                : { background: "var(--surface-1)", color: "var(--ink-2)", borderColor: "var(--border)" }
            }
          >
            {f.label}
          </button>
        ))}
        <span className="mx-1 h-4 w-px" style={{ background: "var(--hairline)" }} />
        <label className="flex items-center gap-1 text-xs" style={{ color: "var(--ink-3)" }}>
          Sort
          <select
            value={sortKey}
            onChange={(e) => onSort(e.target.value)}
            className="rounded-md border px-1.5 py-1 text-xs"
            style={{
              background: "var(--surface-1)",
              borderColor: "var(--border)",
              color: "var(--ink-1)",
            }}
          >
            <option value="fuel">most km first</option>
            <option value="headway">worst headway first</option>
            <option value="number">route number</option>
          </select>
        </label>
      </div>

      <p className="text-[11px] leading-snug" style={{ color: "var(--ink-3)" }}>
        Strip cells: median minutes between buses per weekday period — darker
        means more frequent.
      </p>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1" role="list">
        {routes.length === 0 && (
          <div
            className="rounded-lg border p-4 text-sm"
            style={{ background: "var(--surface-1)", borderColor: "var(--border)", color: "var(--ink-2)" }}
          >
            No routes match. Clear the search or pick a different filter.
          </div>
        )}
        {routes.map((r) => (
          <RouteRow
            key={r.route_id}
            route={r}
            isSelected={r.route_id === selectedId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}
