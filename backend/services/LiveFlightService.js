
const CONFIG = {
  TOKEN_URL:
    "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token",

  API_URL: "https://opensky-network.org/api",
  ADSBDB_URL: "https://api.adsbdb.com/v0",

  // Area pemantauan Pekanbaru dan sekitarnya
  LAMIN: -0.5,
  LOMIN: 99.5,
  LAMAX: 2.5,
  LOMAX: 103.5,

  MAX_AIRCRAFT: 20,
  CACHE_MS: 20000,
  METADATA_CACHE_MS: 24 * 60 * 60 * 1000,
  METADATA_MISS_CACHE_MS: 15 * 60 * 1000,
  METADATA_CONCURRENCY: 4
};

let tokenCache = {
  value: null,
  expiresAt: 0
};

let liveCache = {
  data: null,
  expiresAt: 0
};

const metadataCache = new Map();

// ======================================================
// 1. ACCESS TOKEN OPENSKY
// ======================================================

async function getOpenSkyToken() {
  if (tokenCache.value && Date.now() < tokenCache.expiresAt) {
    return tokenCache.value;
  }

  const clientId = process.env.OPENSKY_CLIENT_ID;
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Konfigurasi OpenSky tidak ditemukan di .env.");
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret
  });

  const response = await fetch(CONFIG.TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok || !result.access_token) {
    throw new Error(
      `Gagal mendapatkan token OpenSky (${response.status}): ${
        result.error_description || result.error || "Token tidak tersedia"
      }`
    );
  }

  tokenCache.value = result.access_token;

  tokenCache.expiresAt =
    Date.now() + Math.max(60, Number(result.expires_in || 1800) - 90) * 1000;

  return tokenCache.value;
}

// ======================================================
// 2. INFORMASI TAMBAHAN PESAWAT ADSBDB
// ======================================================

async function getAircraftMetadata(plane) {
  const icao24 = String(plane.icao24 || "").toLowerCase();
  const callsign = String(plane.callsign || "").trim().toUpperCase();

  if (!icao24 || icao24 === "-") {
    return {};
  }

  const cacheKey = `${icao24}_${callsign}`;
  const cached = metadataCache.get(cacheKey);

  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  try {
    const url =
      `${CONFIG.ADSBDB_URL}/aircraft/${encodeURIComponent(icao24)}` +
      (callsign
        ? `?callsign=${encodeURIComponent(callsign)}`
        : "");

    const response = await fetch(url, {
      headers: {
        Accept: "application/json"
      },
      signal: AbortSignal.timeout(7000)
    });

    if (!response.ok) {
      metadataCache.set(cacheKey, {
        data: {},
        expiresAt: Date.now() + CONFIG.METADATA_MISS_CACHE_MS
      });

      return {};
    }

    const result = await response.json();
    const info = result.response || {};

    const aircraft = info.aircraft || {};
    const route = info.flightroute || {};
    const airline = route.airline || {};

    const origin = route.origin || info.origin || {};
    const destination = route.destination || info.destination || {};

    const originIcao = origin.icao_code || "";
    const destinationIcao = destination.icao_code || "";

    const metadata = {
      registration: aircraft.registration || null,

      aircraftType:
        aircraft.type ||
        aircraft.icao_type ||
        null,

      aircraftTypeCode: aircraft.icao_type || null,

      manufacturer: aircraft.manufacturer || null,

      registeredOwner: aircraft.registered_owner || null,

      airlineName:
        airline.name ||
        aircraft.registered_owner ||
        null,

      airlineIcao: airline.icao || null,
      airlineIata: airline.iata || null,

      origin:
        origin.iata_code ||
        originIcao ||
        origin.name ||
        null,

      originName: origin.name || null,
      originIcao: originIcao || null,

      destination:
        destination.iata_code ||
        destinationIcao ||
        destination.name ||
        null,

      destinationName: destination.name || null,
      destinationIcao: destinationIcao || null,

      routeSource: "ADSBdb",

      isWibbRoute:
        originIcao === "WIBB" ||
        destinationIcao === "WIBB",

      directionType:
        destinationIcao === "WIBB"
          ? "ARR"
          : originIcao === "WIBB"
            ? "DEP"
            : null
    };

    metadataCache.set(cacheKey, {
      data: metadata,
      expiresAt: Date.now() + CONFIG.METADATA_CACHE_MS
    });

    return metadata;

  } catch (error) {
    console.warn(
      `Metadata ${icao24} gagal diambil: ${error.message}`
    );

    metadataCache.set(cacheKey, {
      data: {},
      expiresAt: Date.now() + 2 * 60 * 1000
    });

    return {};
  }
}

// ======================================================
// 3. PENGAYAAN DATA PESAWAT
// ======================================================

async function enrichAircraftList(aircraft) {
  let currentIndex = 0;

  const workerCount = Math.min(
    CONFIG.METADATA_CONCURRENCY,
    aircraft.length
  );

  const workers = Array.from(
    { length: workerCount },
    async () => {
      while (currentIndex < aircraft.length) {
        const index = currentIndex++;
        const plane = aircraft[index];

        const metadata = await getAircraftMetadata(plane);

        aircraft[index] = {
          ...plane,
          ...metadata,

          // Data posisi tetap berasal dari OpenSky
          icao24: plane.icao24,
          callsign: plane.callsign,
          originCountry: plane.originCountry,
          longitude: plane.longitude,
          latitude: plane.latitude,
          baroAltitude: plane.baroAltitude,
          onGround: plane.onGround,
          velocity: plane.velocity,
          heading: plane.heading,
          verticalRate: plane.verticalRate,
          geoAltitude: plane.geoAltitude,
          squawk: plane.squawk,
          lastContact: plane.lastContact
        };
      }
    }
  );

  await Promise.all(workers);

  return aircraft;
}

// ======================================================
// 4. POSISI LIVE OPENSKY
// ======================================================

async function getLiveAircraft(forceRefresh = false) {
  if (
    !forceRefresh &&
    liveCache.data &&
    Date.now() < liveCache.expiresAt
  ) {
    return liveCache.data;
  }

  const token = await getOpenSkyToken();

  const params = new URLSearchParams({
    lamin: String(CONFIG.LAMIN),
    lomin: String(CONFIG.LOMIN),
    lamax: String(CONFIG.LAMAX),
    lomax: String(CONFIG.LOMAX)
  });

  const response = await fetch(
    `${CONFIG.API_URL}/states/all?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );

  if (response.status === 401) {
    tokenCache.value = null;
    tokenCache.expiresAt = 0;
  }

  if (!response.ok) {
    const errorBody = await response.text();

    throw new Error(
      `OpenSky API gagal (${response.status}): ${errorBody.slice(0, 400)}`
    );
  }

  const result = await response.json();
  const states = Array.isArray(result.states) ? result.states : [];

  let aircraft = states
    .map((state) => ({
      icao24: state[0] || "-",
      callsign: String(state[1] || "").trim() || "Tidak diketahui",
      originCountry: state[2] || "Tidak diketahui",

      longitude: state[5],
      latitude: state[6],

      baroAltitude: state[7],
      onGround: state[8],

      velocity: state[9],
      heading: state[10],
      verticalRate: state[11],

      geoAltitude: state[13],
      squawk: state[14],

      lastContact: state[4]
    }))
    .filter((plane) =>
      plane.latitude !== null &&
      plane.latitude !== undefined &&
      plane.longitude !== null &&
      plane.longitude !== undefined &&
      Number.isFinite(Number(plane.latitude)) &&
      Number.isFinite(Number(plane.longitude))
    )
    .sort(
      (a, b) =>
        Number(b.lastContact || 0) -
        Number(a.lastContact || 0)
    )
    .slice(0, CONFIG.MAX_AIRCRAFT);

  aircraft = await enrichAircraftList(aircraft);

  const data = {
    success: true,
    source: "OpenSky Network + ADSBdb",
    metadataSource: "ADSBdb",

    airport: "Sultan Syarif Kasim II, Pekanbaru",
    airportIcao: "WIBB",
    timezone: "Asia/Jakarta",

    timestamp: result.time || Math.floor(Date.now() / 1000),
    fetchedAt: new Date().toISOString(),

    totalDetectedInArea: states.length,
    totalDisplayed: aircraft.length,

    aircraft
  };

  liveCache.data = data;
  liveCache.expiresAt = Date.now() + CONFIG.CACHE_MS;

  return data;
}

// ======================================================
// 5. EXPORT
// ======================================================

module.exports = {
  getLiveAircraft
};
