import { useEffect, useMemo, useState } from "react";
import CollectorView from "./components/CollectorView";
import MethodologyView from "./components/MethodologyView";
import RouteDetail from "./components/RouteDetail";
import RouteList from "./components/RouteList";
import RouteMap, { ColorModeToggle, MapLegend } from "./components/RouteMap";
import SavingsView from "./components/SavingsView";
import { filterRoutes, fmt, loadTransitData, sortRoutes } from "./lib/data";

function ViewTabs({ view, onView }) {
  const tabs = [
    ["network", "Network"],
    ["savings", "Savings"],
    ["methodology", "Methodology"],
  ];
  // The collector drives a process on the analyst's machine via dev-server
  // middleware; it has no backend on the static deployment.
  if (import.meta.env.DEV) tabs.push(["collector", "Collector"]);
  return (
    <nav
      className="flex w-full rounded-lg border p-0.5 lg:w-auto"
      style={{ borderColor: "var(--border)" }}
      aria-label="App section"
    >
      {tabs.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onView(key)}
          aria-current={view === key ? "page" : undefined}
          className="flex-1 rounded-md px-3 py-2 text-sm font-semibold lg:flex-none lg:py-1 lg:text-xs"
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
    <div className="min-w-28 shrink-0">
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

// Below Tailwind's lg breakpoint the network view shows the list or the map,
// not both, so selecting a route from the list has to switch to the map.
const isDesktop = () => window.matchMedia("(min-width: 1024px)").matches;

function PaneSwitch({ pane, onPane }) {
  const panes = [
    ["list", "List"],
    ["map", "Map"],
  ];
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-8 z-[1100] flex justify-center lg:hidden">
      <div
        className="pointer-events-auto flex rounded-full border p-1 shadow-lg"
        style={{ background: "var(--surface-1)", borderColor: "var(--border)" }}
        role="group"
        aria-label="Show routes as"
      >
        {panes.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => onPane(key)}
            aria-pressed={pane === key}
            className="min-w-20 rounded-full px-4 py-2 text-sm font-semibold"
            style={
              pane === key
                ? { background: "var(--ink-1)", color: "var(--surface-1)" }
                : { color: "var(--ink-2)" }
            }
          >
            {label}
          </button>
        ))}
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
  const [colorMode, setColorMode] = useState("savings");
  const [mobilePane, setMobilePane] = useState("list");
  const [view, setView] = useState(() => {
    const v = new URLSearchParams(window.location.search).get("view");
    const valid = ["savings", "methodology"];
    if (import.meta.env.DEV) valid.push("collector");
    return valid.includes(v) ? v : "network";
  });

  useEffect(() => {
    loadTransitData()
      .then((d) => {
        setData(d);
        // deep link: ?route=<short name>, e.g. ?route=119
        const want = new URLSearchParams(window.location.search).get("route");
        if (want) {
          const match = d.routes.find((r) => r.short_name === want);
          if (match) {
            setSelectedId(match.route_id);
            setMobilePane("map");
          }
        }
      })
      .catch((e) => setError(e.message));
  }, []);

  const visibleRoutes = useMemo(() => {
    if (!data) return [];
    return sortRoutes(filterRoutes(data.routes, filterKey, query), sortKey);
  }, [data, filterKey, query, sortKey]);

  const selected = data?.routes.find((r) => r.route_id === selectedId) || null;

  const selectFromList = (id) => {
    setSelectedId(id);
    if (!isDesktop()) setMobilePane("map");
  };

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
        className="flex flex-wrap items-center gap-x-8 gap-y-2 border-b px-4 py-2.5 lg:gap-y-3 lg:py-3"
        style={{ background: "var(--surface-1)", borderColor: "var(--hairline)" }}
      >
        <div>
          <h1
            className="text-base font-extrabold uppercase leading-none"
            style={{ color: "var(--ink-1)", letterSpacing: "0.12em" }}
          >
            YYC&nbsp;Bus&nbsp;Audit
          </h1>
          <p className="mt-1 text-[13px]" style={{ color: "var(--ink-3)" }}>
            Unofficial analysis of Calgary Transit open data · July 2026 schedule
          </p>
        </div>
        <div className="w-full lg:mr-auto lg:w-auto">
          <ViewTabs view={view} onView={setView} />
        </div>
        {/* On phones the stats are one swipeable row, and are left out of the
            network view so the list and map get the screen. On desktop the
            wrapper disappears and the tiles sit in the header row as before. */}
        <div
          className={`no-scrollbar -mx-4 w-[calc(100%+2rem)] gap-6 overflow-x-auto px-4 lg:contents ${
            view === "network" ? "hidden" : "flex"
          }`}
        >
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
        {data.optimizer ? (
          <StatTile
            value={`$${(data.optimizer.summary.conservative.saved_cad / 1e6).toFixed(1)}M`}
            unit="/yr"
            label="potential savings (modeled)"
          />
        ) : (
          <StatTile value={flaggedCount} label="routes flagged" />
        )}
        </div>
      </header>

      {view === "collector" ? (
        <div className="min-h-0 flex-1">
          <CollectorView />
        </div>
      ) : view === "savings" ? (
        <SavingsView
          data={data}
          onSelectRoute={(id) => {
            setSelectedId(id);
            setView("network");
            setMobilePane("map");
          }}
        />
      ) : view === "methodology" ? (
        <MethodologyView />
      ) : (
      <div className="relative grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside
          className={`min-h-0 overflow-hidden p-3 lg:block lg:border-r ${
            mobilePane === "list" ? "" : "hidden"
          }`}
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
            onSelect={selectFromList}
          />
        </aside>

        <section className={`relative min-h-0 lg:block ${mobilePane === "map" ? "" : "hidden"}`}>
          <RouteMap
            routes={data.routes}
            thresholds={data.thresholds}
            savingsThresholds={data.savingsThresholds}
            colorMode={data.optimizer ? colorMode : "fuel"}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          {data.optimizer && (
            <ColorModeToggle colorMode={colorMode} onColorMode={setColorMode} />
          )}
          <MapLegend colorMode={data.optimizer ? colorMode : "fuel"} hiddenOnMobile={!!selected} />
          {selected && (
            <RouteDetail
              key={selected.route_id}
              route={selected}
              allRoutes={data.routes}
              systemWeekdayKm={sys.weekday.bus_vehicle_km}
              dieselPerKm={data.supply.assumptions.diesel_l_per_km}
              optimizer={data.optimizer}
              onSelect={setSelectedId}
              onClose={() => setSelectedId(null)}
            />
          )}
        </section>
        {!(mobilePane === "map" && selected) && (
          <PaneSwitch pane={mobilePane} onPane={setMobilePane} />
        )}
      </div>
      )}
    </div>
  );
}
