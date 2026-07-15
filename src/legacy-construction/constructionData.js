const CALGARY_ROAD_CONSTRUCTION_ENDPOINT =
  "https://data.calgary.ca/resource/kjkw-394k.json?$limit=5000";

const ACTIVE_WORDS = [
  "active",
  "ongoing",
  "in progress",
  "under construction",
  "current",
  "open",
];

const COMPLETED_WORDS = [
  "complete",
  "completed",
  "closed",
  "finished",
  "done",
];

const UPCOMING_WORDS = [
  "upcoming",
  "planned",
  "future",
  "scheduled",
];

function getFirstValue(record, possibleKeys) {
  for (const key of possibleKeys) {
    if (record[key] !== undefined && record[key] !== null && record[key] !== "") {
      return record[key];
    }
  }

  return "";
}

function getTextValue(record, possibleKeys, fallback = "Not provided") {
  const value = getFirstValue(record, possibleKeys);
  return value ? String(value) : fallback;
}

function classifyStatus(rawStatus, record) {
  const combinedText = [
    rawStatus,
    record.status,
    record.project_status,
    record.phase,
    record.description,
    record.project_description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (ACTIVE_WORDS.some((word) => combinedText.includes(word))) {
    return "active";
  }

  if (UPCOMING_WORDS.some((word) => combinedText.includes(word))) {
    return "upcoming";
  }

  if (COMPLETED_WORDS.some((word) => combinedText.includes(word))) {
    return "completed";
  }

  return "unknown";
}

function parseNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractCoordinates(record) {
  const latitudeKeys = [
    "latitude",
    "lat",
    "y",
    "location_1.latitude",
    "location.latitude",
  ];

  const longitudeKeys = [
    "longitude",
    "lon",
    "lng",
    "x",
    "location_1.longitude",
    "location.longitude",
  ];

  const latFromKeys = parseNumber(getFirstValue(record, latitudeKeys));
  const lngFromKeys = parseNumber(getFirstValue(record, longitudeKeys));

  if (latFromKeys !== null && lngFromKeys !== null) {
    return {
      lat: latFromKeys,
      lng: lngFromKeys,
    };
  }

  const possibleLocationObjects = [
    record.location,
    record.location_1,
    record.point,
    record.the_geom,
    record.geometry,
  ];

  for (const location of possibleLocationObjects) {
    if (!location) continue;

    if (location.latitude && location.longitude) {
      const lat = parseNumber(location.latitude);
      const lng = parseNumber(location.longitude);

      if (lat !== null && lng !== null) {
        return { lat, lng };
      }
    }

    if (Array.isArray(location.coordinates)) {
      const [lng, lat] = location.coordinates;

      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { lat, lng };
      }
    }

    if (
      location.type === "Point" &&
      Array.isArray(location.coordinates) &&
      location.coordinates.length >= 2
    ) {
      const [lng, lat] = location.coordinates;

      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { lat, lng };
      }
    }
  }

  return null;
}

function extractHumanAddress(record) {
  const locationObjects = [
    record.location,
    record.location_1,
    record.point,
  ];

  for (const location of locationObjects) {
    if (!location) continue;

    if (location.human_address) {
      try {
        const parsed = JSON.parse(location.human_address);
        return [
          parsed.address,
          parsed.city,
          parsed.state,
          parsed.zip,
        ]
          .filter(Boolean)
          .join(", ");
      } catch {
        return location.human_address;
      }
    }
  }

  return "";
}

function getAllSearchableText(record, normalized) {
  return [
    normalized.title,
    normalized.location,
    normalized.community,
    normalized.address,
    normalized.description,
    normalized.status,
    ...Object.values(record).map((value) => {
      if (value === null || value === undefined) return "";
      if (typeof value === "object") return JSON.stringify(value);
      return String(value);
    }),
  ]
    .join(" ")
    .toLowerCase();
}

function normalizeConstructionRecord(record, index) {
  const rawStatus = getTextValue(
    record,
    [
      "status",
      "project_status",
      "construction_status",
      "phase",
      "project_phase",
    ],
    "Unknown"
  );

  const title = getTextValue(
    record,
    [
      "project_name",
      "project",
      "name",
      "title",
      "project_title",
      "road_project",
      "location_description",
    ],
    `Road construction project ${index + 1}`
  );

  const community = getTextValue(
    record,
    [
      "community",
      "community_name",
      "neighbourhood",
      "neighborhood",
      "area",
    ],
    "Not provided"
  );

  const fallbackHumanAddress = extractHumanAddress(record);

  const address = getTextValue(
    record,
    [
      "address",
      "street_address",
      "location",
      "road",
      "street",
      "cross_street",
      "intersection",
    ],
    fallbackHumanAddress || "Not provided"
  );

  const location = getTextValue(
    record,
    [
      "location_description",
      "location_details",
      "location_name",
      "project_location",
      "limits",
      "roadway",
      "street",
      "intersection",
    ],
    address
  );

  const description = getTextValue(
    record,
    [
      "description",
      "project_description",
      "details",
      "scope",
      "work_description",
    ],
    "Not provided"
  );

  const startDate = getTextValue(
    record,
    [
      "start_date",
      "construction_start",
      "project_start",
      "planned_start",
    ],
    "Not provided"
  );

  const endDate = getTextValue(
    record,
    [
      "end_date",
      "completion_date",
      "expected_completion",
      "project_end",
      "planned_completion",
    ],
    "Not provided"
  );

  const coordinates = extractCoordinates(record);
  const normalizedStatus = classifyStatus(rawStatus, record);

  const normalized = {
    id:
      record.id ||
      record.project_id ||
      record.objectid ||
      record.object_id ||
      `${title}-${index}`,
    title,
    status: rawStatus,
    normalizedStatus,
    location,
    community,
    address,
    description,
    startDate,
    endDate,
    coordinates,
    hasCoordinates: Boolean(coordinates),
    raw: record,
  };

  normalized.searchText = getAllSearchableText(record, normalized);

  return normalized;
}

function getStatusRank(status) {
  switch (status) {
    case "active":
      return 0;
    case "unknown":
      return 1;
    case "upcoming":
      return 2;
    case "completed":
      return 3;
    default:
      return 4;
  }
}

export async function fetchCalgaryRoadConstructions() {
  const response = await fetch(CALGARY_ROAD_CONSTRUCTION_ENDPOINT);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch Calgary road construction data. Status: ${response.status}`
    );
  }

  const data = await response.json();

  if (!Array.isArray(data)) {
    throw new Error("Unexpected response format from Calgary Open Data.");
  }

  const normalized = data.map(normalizeConstructionRecord);

  const activeOrUnknown = normalized.filter((item) =>
    ["active", "unknown"].includes(item.normalizedStatus)
  );

  const recordsToShow =
    activeOrUnknown.length > 0 ? activeOrUnknown : normalized;

  return recordsToShow.sort((a, b) => {
    const statusSort =
      getStatusRank(a.normalizedStatus) - getStatusRank(b.normalizedStatus);

    if (statusSort !== 0) return statusSort;

    return a.title.localeCompare(b.title);
  });
}