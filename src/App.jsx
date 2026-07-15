import { useEffect, useMemo, useState } from "react";
import CollectorView from "./components/CollectorView";
import RouteDetail from "./components/RouteDetail";
import RouteList from "./components/RouteList";
import RouteMap, { MapLegend } from "./components/RouteMap";
import { filterRoutes, fmt, loadTransitData, sortRoutes } from "./lib/data";

function ViewTabs({ view, onView }) {
  const tabs = [
    ["network", "Network"],
    ["collector", "Collector"],
  ];
  return (
    <nav
      className="flex rounded-lg border p-0.5"
      style={{ borderColor: "var(--border)" }}
      aria-label="App section"
    >
      {tabs.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onView(key)}
          aria-current={view === key ? "page" : undefined}
          className="rounded-md px-3 py-1 text-xs font-semibold"
          style={
            view === key
              ? { background: "var(--ink-1)", color: "var(--surface-1)" }
              : { color: "var(--ink-2)" }
          }
        >
          {label}
        </button>
      ))}
    </nav>
  );
}

function StatTile({ value, unit, label }) {
  return (
    <div className="min-w-28">
      <div className="text-lg font-semibold leading-tight tabular-nums" style={{ color: "var(--ink-1)" }}>
        {value}
        {unit && (
          <span className="ml-1 text-xs font-normal" style={{ color: "var(--ink-2)" }}>
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

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filterKey, setFilterKey] = useState("all");
  const [sortKey, setSortKey] = useState("fuel");
  const [selectedId, setSelectedId] = useState(null);
  const [view, setView] = useState(() =>
    new URLSearchParams(window.location.search).get("view") === "collector"
      ? "collector"
      : "network"
  );

  useEffect(() => {
    loadTransitData()
      .then((d) => {
        setData(d);
        // deep link: ?route=<short name>, e.g. ?route=119
        const want = new URLSearchParams(window.location.search).get("route");
        if (want) {
          const match = d.routes.find((r) => r.short_name === want);
          if (match) setSelectedId(match.route_id);
        }
      })
      .catch((e) => setError(e.message));
  }, []);

  const visibleRoutes = useMemo(() => {
    if (!data) return [];
    return sortRoutes(filterRoutes(data.routes, filterKey, query), sortKey);
  }, [data, filterKey, query, sortKey]);

  const selected = data?.routes.find((r) => r.route_id === selectedId) || null;

  if (error) {
    return (
      <main className="flex h-full items-center justify-center p-8">
        <div
          className="max-w-md rounded-xl border p-6 text-sm"
          style={{ background: "var(--surface-1)", borderColor: "var(--border)", color: "var(--ink-2)" }}
        >
          <h1 className="mb-1 font-semibold" style={{ color: "var(--ink-1)" }}>
            Data not found
          </h1>
          <p>{error}</p>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="flex h-full items-center justify-center text-sm" style={{ color: "var(--ink-2)" }}>
        Loading the network…
      </main>
    );
  }

  const sys = data.supply.system;
  const flaggedCount = data.routes.filter((r) => (r.flags || []).length > 0).length;

  return (
    <div className="flex h-full flex-col">
      <header
        className="flex flex-wrap items-center gap-x-8 gap-y-3 border-b px-4 py-3"
        style={{ background: "var(--surface-1)", borderColor: "var(--hairline)" }}
      >
        <div>
          <h1
            className="text-base font-extrabold uppercase leading-none"
            style={{ color: "var(--ink-1)", letterSpacing: "0.12em" }}
          >
            YYC&nbsp;Bus&nbsp;Audit
          </h1>
          <p className="mt-1 text-[11px]" style={{ color: "var(--ink-3)" }}>
            Unofficial analysis of Calgary Transit open data · July 2026 schedule
          </p>
        </div>
        <div className="mr-auto">
          <ViewTabs view={view} onView={setView} />
        </div>
        <StatTile
          value={fmt.format(sys.weekday.bus_vehicle_km)}
          unit="km"
          label="bus travel per weekday"
        />
        <StatTile
          value={fmt.format(sys.weekday.est_diesel_litres)}
          unit="L"
          label="est. diesel per weekday"
        />
        <StatTile
          value={fmt.format(sys.annual.est_co2_tonnes)}
          unit="t"
          label="est. CO₂ per year"
        />
        <StatTile value={flaggedCount} label="routes flagged" />
      </header>

      {view === "collector" ? (
        <div className="min-h-0 flex-1">
          <CollectorView />
        </div>
      ) : (
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[360px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
        <aside
          className="max-h-[45vh] min-h-0 overflow-hidden border-b p-3 lg:max-h-none lg:border-b-0 lg:border-r"
          style={{ borderColor: "var(--hairline)" }}
        >
          <RouteList
            routes={visibleRoutes}
            query={query}
            onQuery={setQuery}
            filterKey={filterKey}
            onFilter={setFilterKey}
            sortKey={sortKey}
            onSort={setSortKey}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </aside>

        <section className="relative min-h-0">
          <RouteMap
            routes={data.routes}
            thresholds={data.thresholds}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          <MapLegend />
          {selected && (
            <RouteDetail
              route={selected}
              allRoutes={data.routes}
              systemWeekdayKm={sys.weekday.bus_vehicle_km}
              dieselPerKm={data.supply.assumptions.diesel_l_per_km}
              onSelect={setSelectedId}
              onClose={() => setSelectedId(null)}
            />
          )}
        </section>
      </div>
      )}
    </div>
  );
}
