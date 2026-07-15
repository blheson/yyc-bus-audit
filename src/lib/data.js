// Loads and joins the pipeline outputs (public/data/*.json) for the app.

const WEEKDAY_PERIODS = [
  { key: "early_late", label: "EA" },
  { key: "am_peak", label: "AM" },
  { key: "midday", label: "MID" },
  { key: "pm_peak", label: "PM" },
  { key: "evening", label: "EVE" },
];

export const PERIOD_NAMES = {
  early_late: "Early / late night",
  am_peak: "AM peak (6–9)",
  midday: "Midday (9–15)",
  pm_peak: "PM peak (15–18)",
  evening: "Evening (18–24)",
  daytime: "Daytime (6–18)",
};

export const FLAG_INFO = {
  hourly_or_worse_midday: {
    label: "Hourly or worse midday",
    tone: "serious",
    icon: "◷",
  },
  long_route_low_frequency: {
    label: "Long route, low frequency",
    tone: "warning",
    icon: "⇥",
  },
  high_overlap: {
    label: "Shares ≥50% of alignment",
    tone: "neutral",
    icon: "≋",
  },
};

export { WEEKDAY_PERIODS };

export async function loadTransitData() {
  const base = import.meta.env.BASE_URL;
  const [supplyRes, geoRes, demandRes, optimizerRes] = await Promise.all([
    fetch(`${base}data/supply.json`),
    fetch(`${base}data/routes.geojson`),
    fetch(`${base}data/demand.json`),
    fetch(`${base}data/optimizer.json`),
  ]);
  if (!supplyRes.ok || !geoRes.ok) {
    throw new Error(
      "Pipeline output is missing. Run pipeline/ingest_gtfs.py then pipeline/supply.py to generate public/data."
    );
  }
  const supply = await supplyRes.json();
  const geo = await geoRes.json();
  // Later pipeline stages; the network view still works without them.
  const demand = demandRes.ok ? await demandRes.json() : null;
  const optimizer = optimizerRes.ok ? await optimizerRes.json() : null;

  // geometry per route_id, flipped to Leaflet's [lat, lng]
  const paths = new Map();
  for (const f of geo.features) {
    paths.set(
      f.properties.route_id,
      f.geometry.coordinates.map(([lng, lat]) => [lat, lng])
    );
  }

  const overlapsByRoute = new Map();
  for (const o of supply.overlaps) {
    for (const [self, other, frac] of [
      [o.route_a, o.route_b, o.fraction_a],
      [o.route_b, o.route_a, o.fraction_b],
    ]) {
      if (!overlapsByRoute.has(self)) overlapsByRoute.set(self, []);
      overlapsByRoute.get(self).push({
        routeId: other,
        overlapKm: o.overlap_km,
        fraction: frac,
      });
    }
  }

  // conservative-scenario optimizer changes per route short name,
  // annualized with the same day weights the pipeline uses
  const dayWeights = supply.assumptions.annual_day_weights;
  const changesByRoute = new Map();
  for (const c of optimizer?.changes_conservative || []) {
    if (!changesByRoute.has(c.route)) changesByRoute.set(c.route, []);
    changesByRoute.get(c.route).push(c);
  }

  const routes = supply.routes
    .filter((r) => r.weekday && paths.has(r.route_id))
    .map((r) => {
      const changes = changesByRoute.get(r.short_name) || [];
      return {
        ...r,
        path: paths.get(r.route_id),
        overlaps: (overlapsByRoute.get(r.route_id) || []).sort(
          (a, b) => b.overlapKm - a.overlapKm
        ),
        demand: demand?.routes?.[r.short_name] || null,
        changes,
        savedKmYear: changes.reduce(
          (sum, c) => sum + c.saved_km_day * (dayWeights[c.day] || 0),
          0
        ),
      };
    });

  // quintile thresholds over bus vehicle-km for the map's sequential ramp
  const kms = routes
    .filter((r) => r.is_bus)
    .map((r) => r.weekday.vehicle_km)
    .sort((a, b) => a - b);
  const q = (p) => kms[Math.min(kms.length - 1, Math.floor(p * kms.length))];
  const thresholds = [q(0.2), q(0.4), q(0.6), q(0.8)];

  // quintiles over routes with any proposed savings, for the violet ramp
  const saved = routes
    .filter((r) => r.is_bus && r.savedKmYear > 0)
    .map((r) => r.savedKmYear)
    .sort((a, b) => a - b);
  const qs = (p) =>
    saved.length ? saved[Math.min(saved.length - 1, Math.floor(p * saved.length))] : 0;
  const savingsThresholds = [qs(0.2), qs(0.4), qs(0.6), qs(0.8)];

  return { supply, demand, optimizer, routes, thresholds, savingsThresholds };
}

// 0 (lightest) .. 4 (darkest) on the violet ramp; null = no change proposed
export function savingsStep(route, savingsThresholds) {
  if (!route.savedKmYear) return null;
  let step = 0;
  for (const t of savingsThresholds) if (route.savedKmYear > t) step += 1;
  return step;
}

// 0 (lightest) .. 4 (darkest) on the blue ramp
export function fuelStep(route, thresholds) {
  const km = route.weekday.vehicle_km;
  let step = 0;
  for (const t of thresholds) if (km > t) step += 1;
  return step;
}

// 0 (least frequent, lightest) .. 4 (most frequent, darkest) on the aqua ramp
export function headwayStep(headwayMin) {
  if (headwayMin == null) return null;
  if (headwayMin <= 12) return 4;
  if (headwayMin <= 20) return 3;
  if (headwayMin <= 30) return 2;
  if (headwayMin <= 45) return 1;
  return 0;
}

export function shortRouteName(route) {
  return route.is_bus ? route.short_name : `CTrain ${route.short_name}`;
}

export const fmt = new Intl.NumberFormat("en-CA");

export function sortRoutes(routes, sortKey) {
  const copy = [...routes];
  if (sortKey === "fuel") {
    copy.sort((a, b) => b.weekday.vehicle_km - a.weekday.vehicle_km);
  } else if (sortKey === "savings") {
    copy.sort((a, b) => b.savedKmYear - a.savedKmYear);
  } else if (sortKey === "number") {
    copy.sort(
      (a, b) =>
        (parseInt(a.short_name, 10) || 9999) - (parseInt(b.short_name, 10) || 9999)
    );
  } else if (sortKey === "headway") {
    const worst = (r) => {
      const mids = Object.values(r.weekday.periods)
        .map((p) => p.median_headway_min)
        .filter((h) => h != null);
      return mids.length ? Math.max(...mids) : 0;
    };
    copy.sort((a, b) => worst(b) - worst(a));
  }
  return copy;
}

export const FILTERS = {
  all: { label: "All", test: () => true },
  changed: { label: "Has proposal", test: (r) => r.changes.length > 0 },
  flagged: { label: "Flagged", test: (r) => (r.flags || []).length > 0 },
  hourly: {
    label: "Hourly",
    test: (r) => (r.flags || []).includes("hourly_or_worse_midday"),
  },
  overlap: {
    label: "Overlapping",
    test: (r) => (r.flags || []).includes("high_overlap"),
  },
};

export function filterRoutes(routes, filterKey, query) {
  const q = query.trim().toLowerCase();
  return routes.filter(
    (r) =>
      FILTERS[filterKey].test(r) &&
      (!q ||
        r.short_name.toLowerCase().includes(q) ||
        r.long_name.toLowerCase().includes(q))
  );
}
