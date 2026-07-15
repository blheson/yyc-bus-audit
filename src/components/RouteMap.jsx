import { useEffect, useMemo, useState } from "react";
import { MapContainer, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { fuelStep, savingsStep, shortRouteName } from "../lib/data";

const CALGARY_CENTER = [51.0447, -114.0719];

const FUEL_COLORS = ["--fuel-0", "--fuel-1", "--fuel-2", "--fuel-3", "--fuel-4"];
const SAVE_COLORS = ["--save-0", "--save-1", "--save-2", "--save-3", "--save-4"];

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function useDarkMode() {
  const [dark, setDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e) => setDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return dark;
}

function FitToSelection({ route }) {
  const map = useMap();
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (route) {
      map.fitBounds(route.path, { padding: [60, 60], animate: !reduced });
    }
  }, [route, map]);
  return null;
}

function DeselectOnMapClick({ onDeselect }) {
  useMapEvents({
    click: (e) => {
      if (!e.originalEvent._routeClick) onDeselect();
    },
  });
  return null;
}

export default function RouteMap({
  routes,
  thresholds,
  savingsThresholds,
  colorMode = "fuel",
  selectedId,
  onSelect,
}) {
  const dark = useDarkMode();
  const selected = routes.find((r) => r.route_id === selectedId) || null;

  // read token values once per theme so Leaflet (canvas) gets concrete colors
  const colors = useMemo(
    () => ({
      fuel: FUEL_COLORS.map(cssVar),
      save: SAVE_COLORS.map(cssVar),
      brand: cssVar("--brand"),
      ctrain: cssVar("--ctrain"),
      casing: dark ? "#0d0d0d" : "#ffffff",
    }),
    [dark]
  );

  const busColor = (r) => {
    if (colorMode === "savings") {
      const step = savingsStep(r, savingsThresholds);
      return step == null ? colors.ctrain : colors.save[step];
    }
    return colors.fuel[fuelStep(r, thresholds)];
  };

  const tileUrl = dark
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";

  return (
    <MapContainer
      center={CALGARY_CENTER}
      zoom={11}
      scrollWheelZoom
      preferCanvas
      className="h-full w-full"
    >
      <TileLayer
        key={tileUrl}
        url={tileUrl}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
      />
      <DeselectOnMapClick onDeselect={() => onSelect(null)} />
      <FitToSelection route={selected} />

      {routes.map((r) => {
        const isSelected = r.route_id === selectedId;
        if (isSelected) return null; // drawn on top below
        const color = r.is_bus ? busColor(r) : colors.ctrain;
        return (
          <Polyline
            key={r.route_id}
            positions={r.path}
            pathOptions={{
              color,
              weight: r.is_bus ? 2.5 : 3,
              opacity: selectedId ? 0.25 : 0.85,
              dashArray: r.is_bus ? null : "6 6",
            }}
            eventHandlers={{
              click: (e) => {
                e.originalEvent._routeClick = true;
                onSelect(r.route_id);
              },
            }}
          >
            <Tooltip sticky className="route-tip">
              <strong>{shortRouteName(r)}</strong> {r.long_name}
            </Tooltip>
          </Polyline>
        );
      })}

      {selected && (
        <>
          <Polyline
            positions={selected.path}
            pathOptions={{ color: colors.casing, weight: 9, opacity: 1 }}
          />
          <Polyline
            positions={selected.path}
            pathOptions={{ color: colors.brand, weight: 4.5, opacity: 1 }}
            eventHandlers={{
              click: (e) => {
                e.originalEvent._routeClick = true;
              },
            }}
          />
        </>
      )}
    </MapContainer>
  );
}

export function MapLegend({ colorMode = "fuel" }) {
  const savings = colorMode === "savings";
  const ramp = savings ? SAVE_COLORS : FUEL_COLORS;
  return (
    <div
      className="pointer-events-none absolute bottom-4 left-4 z-[1000] rounded-lg border px-3 py-2 text-xs shadow-sm"
      style={{
        background: "var(--surface-1)",
        borderColor: "var(--border)",
        color: "var(--ink-2)",
      }}
    >
      <div className="mb-1 font-medium" style={{ color: "var(--ink-1)" }}>
        {savings ? "Proposed savings per route (modeled)" : "Weekday travel per route"}
      </div>
      <div className="flex items-center gap-1">
        <span>less</span>
        {ramp.map((c) => (
          <span
            key={c}
            className="inline-block h-2.5 w-6 rounded-sm"
            style={{ background: `var(${c})` }}
          />
        ))}
        <span>{savings ? "more km/yr" : "more km"}</span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        {savings && (
          <>
            <span
              className="inline-block h-1 w-6 rounded-sm"
              style={{ background: "var(--ctrain)" }}
            />
            <span>no change</span>
          </>
        )}
        <span
          className="inline-block h-0 w-6 border-t-2 border-dashed"
          style={{ borderColor: "var(--ctrain)" }}
        />
        <span>CTrain (context)</span>
        <span
          className="ml-2 inline-block h-1 w-6 rounded-sm"
          style={{ background: "var(--brand)" }}
        />
        <span>selected</span>
      </div>
    </div>
  );
}

export function ColorModeToggle({ colorMode, onColorMode }) {
  const modes = [
    ["savings", "Savings"],
    ["fuel", "Travel"],
  ];
  return (
    <div
      className="absolute left-4 top-4 z-[1000] flex rounded-lg border p-0.5 text-xs shadow-sm"
      style={{ background: "var(--surface-1)", borderColor: "var(--border)" }}
      role="group"
      aria-label="Color routes by"
    >
      {modes.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onColorMode(key)}
          aria-pressed={colorMode === key}
          className="rounded-md px-2.5 py-1 font-semibold"
          style={
            colorMode === key
              ? { background: "var(--ink-1)", color: "var(--surface-1)" }
              : { color: "var(--ink-2)" }
          }
        >
          {label}
        </button>
      ))}
    </div>
  );
}
