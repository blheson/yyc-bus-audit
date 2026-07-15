import { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import { fetchCalgaryRoadConstructions } from "./utils/constructionData";

import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

delete L.Icon.Default.prototype._getIconUrl;

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const CALGARY_CENTER = [51.0447, -114.0719];

const selectedIcon = new L.Icon({
  iconUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [30, 48],
  iconAnchor: [15, 48],
  popupAnchor: [1, -42],
  shadowSize: [41, 41],
});

function StatusBadge({ status }) {
  const colors = {
    active: "bg-green-100 text-green-800 border-green-200",
    unknown: "bg-slate-100 text-slate-700 border-slate-200",
    upcoming: "bg-blue-100 text-blue-800 border-blue-200",
    completed: "bg-zinc-100 text-zinc-700 border-zinc-200",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
        colors[status] || colors.unknown
      }`}
    >
      {status}
    </span>
  );
}

function FitMapToMarkers({ items }) {
  const map = useMap();

  useEffect(() => {
    const points = items
      .filter((item) => item.coordinates)
      .map((item) => [item.coordinates.lat, item.coordinates.lng]);

    if (points.length === 0) {
      map.setView(CALGARY_CENTER, 11);
      return;
    }

    if (points.length === 1) {
      map.setView(points[0], 14);
      return;
    }

    map.fitBounds(points, {
      padding: [40, 40],
      maxZoom: 15,
    });
  }, [items, map]);

  return null;
}

function MapFocusController({ selectedItem, markerRefs }) {
  const map = useMap();

  useEffect(() => {
    if (!selectedItem?.coordinates) return;

    const { lat, lng } = selectedItem.coordinates;

    map.flyTo([lat, lng], 15, {
      duration: 0.6,
    });

    const marker = markerRefs.current[selectedItem.id];

    if (marker) {
      marker.openPopup();
    }
  }, [selectedItem, map, markerRefs]);

  return null;
}

function ConstructionMap({
  items,
  selectedItem,
  onSelectItem,
}) {
  const markerRefs = useRef({});

  const mappableItems = items.filter((item) => item.coordinates);

  return (
    <div className="h-[420px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:h-full">
      <MapContainer
        center={CALGARY_CENTER}
        zoom={11}
        scrollWheelZoom
        className="h-full min-h-[420px] lg:min-h-0"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <FitMapToMarkers items={mappableItems} />
        <MapFocusController
          selectedItem={selectedItem}
          markerRefs={markerRefs}
        />

        {mappableItems.map((item) => (
          <Marker
            key={item.id}
            position={[item.coordinates.lat, item.coordinates.lng]}
            icon={selectedItem?.id === item.id ? selectedIcon : undefined}
            eventHandlers={{
              click: () => onSelectItem(item),
            }}
            ref={(marker) => {
              if (marker) {
                markerRefs.current[item.id] = marker;
              }
            }}
          >
            <Popup>
              <div className="max-w-xs">
                <h3 className="mb-1 font-semibold text-slate-900">
                  {item.title}
                </h3>
                <p className="mb-1 text-sm text-slate-700">
                  <strong>Status:</strong> {item.status}
                </p>
                <p className="mb-1 text-sm text-slate-700">
                  <strong>Location:</strong> {item.location}
                </p>
                <p className="text-sm text-slate-700">
                  <strong>Community:</strong> {item.community}
                </p>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}

function ConstructionCard({ item, isSelected, onClick }) {
  return (
    <button
      type="button"
      onClick={() => onClick(item)}
      className={`w-full rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:border-blue-400 hover:shadow-md ${
        isSelected
          ? "selected-card border-blue-600"
          : "border-slate-200"
      }`}
    >
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-950">
          {item.title}
        </h2>
        <StatusBadge status={item.normalizedStatus} />
      </div>

      <dl className="space-y-2 text-sm text-slate-700">
        <div>
          <dt className="font-medium text-slate-900">Status</dt>
          <dd>{item.status}</dd>
        </div>

        <div>
          <dt className="font-medium text-slate-900">Location</dt>
          <dd>{item.location}</dd>
        </div>

        <div>
          <dt className="font-medium text-slate-900">Community</dt>
          <dd>{item.community}</dd>
        </div>

        <div>
          <dt className="font-medium text-slate-900">Address</dt>
          <dd>{item.address}</dd>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <dt className="font-medium text-slate-900">Start date</dt>
            <dd>{item.startDate}</dd>
          </div>

          <div>
            <dt className="font-medium text-slate-900">End date</dt>
            <dd>{item.endDate}</dd>
          </div>
        </div>

        <div>
          <dt className="font-medium text-slate-900">Description</dt>
          <dd className="line-clamp-4">{item.description}</dd>
        </div>
      </dl>

      {!item.hasCoordinates && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          No map location available.
        </div>
      )}
    </button>
  );
}

export default function App() {
  const [items, setItems] = useState([]);
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      try {
        setIsLoading(true);
        setErrorMessage("");

        const data = await fetchCalgaryRoadConstructions();

        if (!isMounted) return;

        setItems(data);

        const firstMappableItem = data.find((item) => item.coordinates);
        setSelectedItemId(firstMappableItem?.id || data[0]?.id || null);
      } catch (error) {
        if (!isMounted) return;

        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Something went wrong while loading construction data."
        );
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadData();

    return () => {
      isMounted = false;
    };
  }, []);

  const filteredItems = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    if (!query) return items;

    return items.filter((item) => item.searchText.includes(query));
  }, [items, searchTerm]);

  const selectedItem = useMemo(() => {
    return (
      filteredItems.find((item) => item.id === selectedItemId) ||
      filteredItems[0] ||
      null
    );
  }, [filteredItems, selectedItemId]);

  const totalWithCoordinates = filteredItems.filter(
    (item) => item.coordinates
  ).length;

  const totalWithoutCoordinates =
    filteredItems.length - totalWithCoordinates;

  function handleSelectItem(item) {
    setSelectedItemId(item.id);
  }

  function handleClearSearch() {
    setSearchTerm("");
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
          <p className="text-sm font-medium uppercase tracking-wide text-blue-700">
            Calgary road construction
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
            Ongoing Road Construction Map
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600 sm:text-base">
            Search current Calgary road construction projects and explore
            mapped project locations using a free OpenStreetMap basemap.
          </p>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[420px_minmax(0,1fr)] lg:px-8">
        <aside className="flex min-h-0 flex-col gap-4 lg:h-[calc(100vh-150px)]">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <label
              htmlFor="location-search"
              className="text-sm font-semibold text-slate-900"
            >
              Search by location
            </label>

            <div className="mt-2 flex gap-2">
              <input
                id="location-search"
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Try a street, community, project, or address"
                className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              />

              {searchTerm && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs text-slate-600">
              <div className="rounded-xl bg-slate-100 px-2 py-2">
                <div className="font-semibold text-slate-950">
                  {filteredItems.length}
                </div>
                Results
              </div>

              <div className="rounded-xl bg-slate-100 px-2 py-2">
                <div className="font-semibold text-slate-950">
                  {totalWithCoordinates}
                </div>
                On map
              </div>

              <div className="rounded-xl bg-slate-100 px-2 py-2">
                <div className="font-semibold text-slate-950">
                  {totalWithoutCoordinates}
                </div>
                No location
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {isLoading && (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
                Loading Calgary road construction data...
              </div>
            )}

            {!isLoading && errorMessage && (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-800 shadow-sm">
                <h2 className="font-semibold">Unable to load data</h2>
                <p className="mt-1">{errorMessage}</p>
              </div>
            )}

            {!isLoading &&
              !errorMessage &&
              filteredItems.length === 0 && (
                <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
                  No construction projects matched your search.
                </div>
              )}

            {!isLoading &&
              !errorMessage &&
              filteredItems.length > 0 && (
                <div className="space-y-3">
                  {filteredItems.map((item) => (
                    <ConstructionCard
                      key={item.id}
                      item={item}
                      isSelected={selectedItem?.id === item.id}
                      onClick={handleSelectItem}
                    />
                  ))}
                </div>
              )}
          </div>
        </aside>

        <section className="lg:h-[calc(100vh-150px)]">
          {!isLoading && !errorMessage && (
            <ConstructionMap
              items={filteredItems}
              selectedItem={selectedItem}
              onSelectItem={handleSelectItem}
            />
          )}

          {isLoading && (
            <div className="flex h-[420px] items-center justify-center rounded-2xl border border-slate-200 bg-white text-sm text-slate-600 shadow-sm lg:h-full">
              Loading map...
            </div>
          )}

          {!isLoading && errorMessage && (
            <div className="flex h-[420px] items-center justify-center rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-800 shadow-sm lg:h-full">
              Map unavailable because the data could not be loaded.
            </div>
          )}
        </section>
      </section>
    </main>
  );
}