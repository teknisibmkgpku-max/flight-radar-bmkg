/**
 * ====================================================================
 * BACKEND RADAR STAMET SSK II PEKANBARU + FLIGHT RADAR (MULTI-SOURCE)
 * ====================================================================
 */

var FOLDER_IDS = (function () {
  var prop = PropertiesService.getScriptProperties().getProperty("FOLDER_IDS");
  if (prop) {
    try {
      return JSON.parse(prop);
    } catch (e) {
      Logger.log(
        "Gagal parse FOLDER_IDS dari Script Properties: " + e.toString(),
      );
    }
  }
  return {};
})();

const WIBB = {
  lat: 0.4594,
  lon: 101.4444,
  radiusKm: 250,
};

// 135 NM = ~250.02 km.
// Deviasi derajat: 135 NM / 60 = 2.25 derajat lintang/bujur.
const RADIUS_NM = 135;
const BOUNDS = {
  lamin: Number((WIBB.lat - 2.25).toFixed(4)), // -1.7906
  lamax: Number((WIBB.lat + 2.25).toFixed(4)), // 2.7094
  lomin: Number((WIBB.lon - 2.25).toFixed(4)), // 99.1944
  lomax: Number((WIBB.lon + 2.25).toFixed(4)), // 103.6944
};

const AIRLABS_KEYS = (
  PropertiesService.getScriptProperties().getProperty("AIRLABS_KEYS") || ""
)
  .split(",")
  .map(function (key) {
    return key.trim();
  })
  .filter(function (key) {
    return key !== "";
  });

function doGet() {
  return HtmlService.createTemplateFromFile("Index")
    .evaluate()
    .setTitle(
      "Flight Radar Stasiun Meteorologi Sultan Syarif Kasim II Pekanbaru",
    )
    .addMetaTag(
      "viewport",
      "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover",
    )
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * MENGAMBIL METAR, TAF, DAN CUACA BANDARA DARI PAYLOAD API BMKG
 */
function fetchBmkgMetarTafor() {
  const apiKey =
    PropertiesService.getScriptProperties().getProperty("BMKG_API_KEY") || "";
  const icao = "WIBB";
  if (!apiKey) {
    return {
      status: "error",
      message: "BMKG_API_KEY belum diatur di Script Properties.",
    };
  }
  const url = "https://api.bmkg.go.id/cuaca-bandara?icao=" + icao;

  const cache = CacheService.getScriptCache();
  const cachedData = cache.get("bmkg_metar_tafor_wibb_v4");
  if (cachedData) {
    return JSON.parse(cachedData);
  }

  try {
    const options = {
      method: "get",
      muteHttpExceptions: true,
      headers: {
        "X-API-KEY": apiKey,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        Accept: "application/json",
      },
    };

    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (statusCode !== 200) {
      return {
        status: "error",
        message: "HTTP Status " + statusCode + ": " + responseText,
      };
    }

    const json = JSON.parse(responseText);

    function extractValue(dataObj, targetKey) {
      if (!dataObj) return null;
      if (dataObj[targetKey] !== undefined) {
        const val = dataObj[targetKey];
        if (typeof val === "string" || typeof val === "number") return val;
        if (typeof val === "object")
          return val.raw || val.text || val.content || JSON.stringify(val);
      }
      if (dataObj.data && dataObj.data[targetKey] !== undefined) {
        const val = dataObj.data[targetKey];
        if (typeof val === "string" || typeof val === "number") return val;
        if (typeof val === "object")
          return val.raw || val.text || val.content || JSON.stringify(val);
      }
      if (Array.isArray(dataObj) && dataObj.length > 0) {
        return extractValue(dataObj[0], targetKey);
      }
      return null;
    }

    function findWeatherObject(obj) {
      if (!obj) return null;
      if (obj.temp !== undefined || obj.weather !== undefined) return obj;
      if (
        obj.data &&
        (obj.data.temp !== undefined || obj.data.weather !== undefined)
      )
        return obj.data;
      if (Array.isArray(obj) && obj.length > 0)
        return findWeatherObject(obj[0]);
      if (typeof obj === "object") {
        for (let key in obj) {
          if (typeof obj[key] === "object") {
            let found = findWeatherObject(obj[key]);
            if (found) return found;
          }
        }
      }
      return null;
    }

    let metarStr =
      extractValue(json, "last_observation") ||
      extractValue(json, "metar") ||
      "METAR WIBB Tidak Tersedia";
    let taforStr =
      extractValue(json, "last_forecast") ||
      extractValue(json, "tafor") ||
      extractValue(json, "taf") ||
      "TAF WIBB Tidak Tersedia";

    const wObj = findWeatherObject(json) || {};

    const result = {
      status: "success",
      icao: icao,
      metar: metarStr,
      tafor: taforStr,
      weatherInfo: {
        datetime: wObj.datetime || "",
        time: wObj.time || "",
        time_zone: wObj.time_zone || "WIB",
        wind_direction: wObj.wind_direction || "",
        wind_speed: wObj.wind_speed !== undefined ? wObj.wind_speed : "--",
        visibility: wObj.visibility !== undefined ? wObj.visibility : "--",
        weather: wObj.weather || "--",
        temp: wObj.temp !== undefined ? wObj.temp + "°C" : "--°C",
        dew_point:
          wObj.dew_point !== undefined ? wObj.dew_point + "°C" : "--°C",
        pressure: wObj.pressure !== undefined ? wObj.pressure : "--",
        icon: wObj.icon ? String(wObj.icon).replace(/\\/g, "") : "",
      },
      updatedAt: new Date().toISOString(),
    };

    cache.put("bmkg_metar_tafor_wibb_v4", JSON.stringify(result), 180);
    return result;
  } catch (e) {
    return {
      status: "error",
      message: "Exception: " + e.toString(),
    };
  }
}

/**
 * MENGAMBIL CITRA RADAR DARI GOOGLE DRIVE
 */
function getRadarFiles(type, clientLastHash) {
  var FOLDER_IDS_MANUAL = {
    CMAX: "16Pg_bT9bd6wAfgoQnwhZOyQ5wk-tuo5i",
    PAC01H: "1boKjNKkWLb5dw5ph6-g7QybyZl95kE4J",
    PAC06H: "1P0AscuEmG08fzD8Jzfc39pq3Uxoy_aE6",
    PAC12H: "1kwdBRpqK-RkgvXHWbwsHkRVS6xYOZjPv",
    PAC24H: "1UGPnFoM9AkYkh34aoHbbRGAppYLaT_60",
    CAP05: "1NFav7mSbzumYl0dxF-t8Udynut27NA5D",
    CAP10: "1_zAYbtP61PzGNPrPQoufuvnn0R7riGLg",
  };

  var folderId = FOLDER_IDS_MANUAL[type];
  if (!folderId) {
    return {
      status: "error",
      message: "Folder ID tidak ditemukan untuk produk: " + type,
    };
  }

  var folder = DriveApp.getFolderById(folderId);
  var files = folder.getFilesByType(MimeType.PNG);
  var rawList = [];
  var regex = /(\d{8})-(\d{4})/;

  while (files.hasNext()) {
    var file = files.next();
    var match = file.getName().match(regex);
    if (match) {
      var dateStr = match[1];
      var timeStr = match[2];

      var y = parseInt(dateStr.substring(0, 4), 10);
      var m = parseInt(dateStr.substring(4, 6), 10) - 1;
      var d = parseInt(dateStr.substring(6, 8), 10);
      var hh = parseInt(timeStr.substring(0, 2), 10);
      var mm = parseInt(timeStr.substring(2, 4), 10);

      var utcEpoch = Date.UTC(y, m, d, hh, mm);
      var wibDate = new Date(utcEpoch + 7 * 60 * 60 * 1000);

      var pad = function (n) {
        return n < 10 ? "0" + n : n;
      };
      var timeLabel =
        pad(wibDate.getUTCHours()) +
        ":" +
        pad(wibDate.getUTCMinutes()) +
        " WIB";
      var dateLabel =
        pad(wibDate.getUTCDate()) +
        "/" +
        pad(wibDate.getUTCMonth() + 1) +
        "/" +
        wibDate.getUTCFullYear();

      rawList.push({
        id: file.getId(),
        timestamp: utcEpoch,
        displayTime: timeLabel,
        displayDate: dateLabel,
        fileObj: file,
      });
    }
  }

  if (rawList.length === 0) return { status: "empty", data: [] };

  rawList.sort(function (a, b) {
    return a.timestamp - b.timestamp;
  });
  var latest6 = rawList.slice(-6);
  var currentHash = latest6
    .map(function (item) {
      return item.id + "_" + item.timestamp;
    })
    .join("|");

  if (clientLastHash && clientLastHash === currentHash) {
    return { status: "not_modified", hash: currentHash };
  }

  var cache = CacheService.getScriptCache();
  var resultData = latest6.map(function (item) {
    var cacheKey = "b64_" + item.id;
    var b64 = cache.get(cacheKey);
    if (!b64) {
      b64 =
        "data:image/png;base64," +
        Utilities.base64Encode(item.fileObj.getBlob().getBytes());
      try {
        cache.put(cacheKey, b64, 1500);
      } catch (e) {}
    }
    return {
      id: item.id,
      timestamp: item.timestamp,
      displayTime: item.displayTime,
      displayDate: item.displayDate,
      url: b64,
    };
  });

  return { status: "updated", hash: currentHash, data: resultData };
}

/**
 * FUNGSI FETCH BERSAMAAN (PARALLEL FETCH) SEMUA PROVIDER RADAR
 * DILENGKAPI ISOLASI TRY-CATCH UNTUK OPENSKY
 */
function fetchAllRadarSourcesParallel(isAirlabsDue) {
  const cache = CacheService.getScriptCache();
  const now = Date.now();
  const requests = [];
  const providers = [];

  // 1. ADSB.fi — Interval diselaraskan minimal 11 detik
  requests.push({
    url: `https://opendata.adsb.fi/api/v3/lat/${WIBB.lat}/lon/${WIBB.lon}/dist/${RADIUS_NM}`,
    headers: { Accept: "application/json" },
    muteHttpExceptions: true,
  });
  providers.push({ name: "ADSB.fi", rank: 1, type: "adsbfi", ttl: 11 });

  // 2. ADSB.lol — Interval diselaraskan 15 detik
  requests.push({
    url: `https://api.adsb.lol/v2/point/${WIBB.lat}/${WIBB.lon}/${RADIUS_NM}`,
    headers: { Accept: "application/json" },
    muteHttpExceptions: true,
  });
  providers.push({ name: "ADSB.lol", rank: 2, type: "adsblol", ttl: 15 });

  // 3. RapidAPI
  const rapidKey =
    PropertiesService.getScriptProperties().getProperty("RAPIDAPI_KEY") || "";
  const rapidHost =
    PropertiesService.getScriptProperties().getProperty("RAPIDAPI_HOST") ||
    "aircraftscatter.p.rapidapi.com";
  if (rapidKey) {
    requests.push({
      url: `https://${rapidHost}/lat/${WIBB.lat}/lon/${WIBB.lon}/dist/${RADIUS_NM}/`,
      headers: {
        "X-RapidAPI-Key": rapidKey,
        "X-RapidAPI-Host": rapidHost,
        Accept: "application/json",
      },
      muteHttpExceptions: true,
    });
    providers.push({ name: "RapidAPI", rank: 3, type: "rapid", ttl: 45 });
  }

  // 4. AirLabs (Satu Key Aktif)
  let activeAirlabsIndex = -1;
  if (isAirlabsDue && AIRLABS_KEYS.length) {
    for (let i = 0; i < AIRLABS_KEYS.length; i++) {
      const cd = Number(cache.get("airlabs_key_cooldown_" + i) || 0);
      if (cd <= now) {
        activeAirlabsIndex = i;
        break;
      }
    }
    if (activeAirlabsIndex !== -1) {
      requests.push({
        url: `https://airlabs.co/api/v9/flights?api_key=${AIRLABS_KEYS[activeAirlabsIndex]}&bbox=${BOUNDS.lamin},${BOUNDS.lomin},${BOUNDS.lamax},${BOUNDS.lomax}`,
        headers: { Accept: "application/json" },
        muteHttpExceptions: true,
      });
      providers.push({
        name: "AirLabs (Parallel)",
        rank: 5,
        type: "airlabs",
        keyIndex: activeAirlabsIndex,
        ttl: 90,
      });
    }
  }

  const results = {};

  // Eksekusi API utama secara paralel (ADSB.fi, ADSB.lol, RapidAPI, AirLabs)
  try {
    const responses = UrlFetchApp.fetchAll(requests);
    responses.forEach((res, idx) => {
      const prov = providers[idx];
      const code = res.getResponseCode();
      const text = res.getContentText();

      if (code === 200) {
        try {
          const json = JSON.parse(text);
          results[prov.name] = {
            status: "success",
            httpStatus: 200,
            rawData: json,
            rank: prov.rank,
            type: prov.type,
            message: "OK",
          };
        } catch (e) {
          results[prov.name] = {
            status: "error",
            flights: [],
            message: "JSON Parse Error",
          };
        }
      } else {
        let retry = 0;
        try {
          retry = Number(
            res.getHeaders()["Retry-After"] ||
              res.getHeaders()["retry-after"] ||
              0,
          );
        } catch (e) {}
        results[prov.name] = {
          status: "error",
          flights: [],
          message: `HTTP ${code}: ${text.substring(0, 150)}`,
        };

        if (prov.type === "airlabs" && (code === 429 || code === 402)) {
          cache.put(
            "airlabs_key_cooldown_" + prov.keyIndex,
            String(now + 900 * 1000),
            900,
          );
        }
      }
    });
  } catch (err) {
    Logger.log("Parallel fetch utama error: " + err.toString());
  }

  // 5. Eksekusi OpenSky secara terisolasi (Try-Catch Mandiri)
  // Mencegah error "Alamat tidak tersedia" merusak pemanggilan provider lainnya
  try {
    const openSkyHeaders = {
      Accept: "application/json",
      "User-Agent": "eNCIK-FlightRadar/2.0",
    };
    const openSkyToken =
      PropertiesService.getScriptProperties().getProperty(
        "OPENSKY_ACCESS_TOKEN",
      ) || "";
    const openSkyClient =
      PropertiesService.getScriptProperties().getProperty(
        "OPENSKY_CLIENT_ID",
      ) || "";
    const openSkySecret =
      PropertiesService.getScriptProperties().getProperty(
        "OPENSKY_CLIENT_SECRET",
      ) || "";
    if (openSkyToken) openSkyHeaders.Authorization = "Bearer " + openSkyToken;
    else if (openSkyClient && openSkySecret)
      openSkyHeaders.Authorization =
        "Basic " + Utilities.base64Encode(openSkyClient + ":" + openSkySecret);

    const openSkyUrl = `https://opensky-network.org/api/states/all?lamin=${BOUNDS.lamin}&lamax=${BOUNDS.lamax}&lomin=${BOUNDS.lomin}&lomax=${BOUNDS.lomax}`;

    const osRes = UrlFetchApp.fetch(openSkyUrl, {
      method: "get",
      headers: openSkyHeaders,
      muteHttpExceptions: true,
    });

    if (osRes.getResponseCode() === 200) {
      results["OpenSky"] = {
        status: "success",
        httpStatus: 200,
        rawData: JSON.parse(osRes.getContentText()),
        rank: 4,
        type: "opensky",
        message: "OK",
      };
    } else {
      results["OpenSky"] = {
        status: "error",
        flights: [],
        message: `HTTP ${osRes.getResponseCode()}`,
      };
    }
  } catch (osErr) {
    results["OpenSky"] = {
      status: "error",
      flights: [],
      message:
        "OpenSky dilewati: Jaringan/IP dibatasi (" +
        osErr.toString().substring(0, 100) +
        ")",
    };
  }

  return results;
}

/**
 * MENGAMBIL DATA FLIGHT RADAR DENGAN PEMBATASAN MINIMAL 11 DETIK SEKALI
 */
function fetchWibbRadarData(forceRefresh) {
  const cache = CacheService.getScriptCache();
  const lock = LockService.getScriptLock();
  const LAST_GOOD_KEY = "encik_wibb_last_good_v20";
  const CHECK_KEY = "encik_wibb_check_v20";
  const THROTTLE_KEY = "encik_wibb_last_fetch_ts";
  const MIN_INTERVAL_MS = 11000; // Pembatasan minimal 11 detik (11.000 ms)

  let lastGood = null;
  try {
    const raw = cache.get(LAST_GOOD_KEY);
    lastGood = raw ? JSON.parse(raw) : loadPersistentFlightSnapshot();
  } catch (e) {
    lastGood = loadPersistentFlightSnapshot();
  }

  // Saring batas radius 250 km
  if (lastGood && Array.isArray(lastGood.flights)) {
    lastGood.flights = lastGood.flights.filter(function (f) {
      if (
        !f ||
        f.lat === null ||
        f.lat === undefined ||
        f.lon === null ||
        f.lon === undefined
      )
        return false;
      const lat = Number(f.lat),
        lon = Number(f.lon);
      return (
        Number.isFinite(lat) &&
        Number.isFinite(lon) &&
        Math.abs(lat) <= 90 &&
        Math.abs(lon) <= 180 &&
        calculateHaversineDistance(WIBB.lat, WIBB.lon, lat, lon) <=
          WIBB.radiusKm
      );
    });
    lastGood.totalCount = lastGood.flights.length;
    lastGood.wibbCount = lastGood.flights.filter(function (f) {
      return !!f.isWibbRoute;
    }).length;
  }

  // =========================================================================
  // LOGIKA PEMBATASAN MINIMAL 11 DETIK
  // =========================================================================
  const nowTs = Date.now();
  const lastFetchTs = Number(cache.get(THROTTLE_KEY) || 0);
  const timeSinceLastFetch = nowTs - lastFetchTs;

  // Jika belum lewat 11 detik sejak panggilan API jaringan terakhir:
  if (lastFetchTs > 0 && timeSinceLastFetch < MIN_INTERVAL_MS) {
    const recent = cache.get(CHECK_KEY);
    if (recent) {
      try {
        const parsed = JSON.parse(recent);
        parsed.message = `Data ditahan (minimal 11 detik sekali). Sisa jeda: ${Math.round((MIN_INTERVAL_MS - timeSinceLastFetch) / 1000)} detik.`;
        parsed.cacheStatus = "throttled_11s";
        return parsed;
      } catch (e) {}
    }
    if (lastGood && lastGood.flights) {
      lastGood.message = `Menampilkan cache aktif (minimal 11 detik sekali). Sisa jeda: ${Math.round((MIN_INTERVAL_MS - timeSinceLastFetch) / 1000)} detik.`;
      lastGood.cacheStatus = "throttled_11s";
      return lastGood;
    }
  }

  // Pengecekan cache cepat jika tidak forceRefresh
  if (!forceRefresh) {
    const recent = cache.get(CHECK_KEY);
    if (recent) {
      try {
        return JSON.parse(recent);
      } catch (e) {}
    }
  }

  // Proteksi eksekusi bersamaan (Concurrency Lock)
  if (!lock.tryLock(1500)) {
    if (lastGood && lastGood.flights) {
      lastGood.message =
        "Pengambilan data sedang berjalan; menampilkan snapshot terakhir.";
      lastGood.cacheStatus = "busy_last_good";
      return lastGood;
    }
    return {
      status: "loading",
      message: "Pengambilan data sedang berjalan.",
      flights: [],
      totalCount: 0,
      diagnostics: [],
    };
  }

  try {
    const flightMap = {};
    const diagnostics = [];
    const sourcesUsed = [];
    const props = PropertiesService.getScriptProperties();
    const cycleStartedAt = Date.now();

    // Catat stempel waktu eksekusi jaringan baru untuk pembatasan 11 detik
    try {
      cache.put(THROTTLE_KEY, String(cycleStartedAt), 15);
    } catch (e) {}

    // Pertahankan pesawat siklus sebelumnya sebagai fallback (maks. 3 menit)
    const recoveryCandidates = [];
    (lastGood && Array.isArray(lastGood.flights)
      ? lastGood.flights
      : []
    ).forEach(function (oldFlight) {
      if (
        !oldFlight ||
        !Number.isFinite(Number(oldFlight.lat)) ||
        !Number.isFinite(Number(oldFlight.lon))
      )
        return;
      const oldPositionAt =
        Number(
          oldFlight.positionTimestamp || oldFlight.lastPositionConfirmedAt || 0,
        ) || (lastGood.timestamp ? new Date(lastGood.timestamp).getTime() : 0);
      const ageMs =
        oldPositionAt > 0
          ? Math.max(0, cycleStartedAt - oldPositionAt)
          : 999999999;
      if (ageMs > 180000) return;
      const oldKey = /^[0-9A-F]{6}$/i.test(String(oldFlight.icao24 || ""))
        ? String(oldFlight.icao24).toUpperCase()
        : "CS_" + normalizeFlightCallsign(oldFlight.callsign);
      if (!oldKey || oldKey === "CS_") return;
      const seed = Object.assign({}, oldFlight, {
        sourceRank: 99,
        positionStatus: "recovery_pending",
        positionTimestamp:
          oldPositionAt || Number(oldFlight.positionTimestamp || 0),
        positionLastConfirmedAt: oldPositionAt || null,
        positionAgeSec: Math.round(ageMs / 1000),
        _seenInCurrentCycle: false,
      });
      flightMap[oldKey] = seed;
      recoveryCandidates.push(seed);
    });

    function addSource(label, result, sourceRank, routeOnly) {
      const rows = result && result.flights ? result.flights : [];
      let added = 0;
      if (!routeOnly) {
        rows.forEach(function (f) {
          f.sourceName = label;
          f.sourceRank = sourceRank;
        });
        const before = Object.keys(flightMap).length;
        mergeFlightsToMap(flightMap, rows, { matchByCallsign: true });
        added = Object.keys(flightMap).length - before;
      } else {
        rows.forEach(function (f) {
          const cs = normalizeFlightCallsign(f.callsign);
          const key = Object.keys(flightMap).find(function (k) {
            return (
              normalizeFlightCallsign(flightMap[k].callsign) === cs &&
              cs &&
              cs !== "UNKNOWN"
            );
          });
          if (!key) return;
          const target = flightMap[key];
          mergeAircraftMetadata(target, f);
          if (!isUsableRouteCode(target.origin) && isUsableRouteCode(f.origin))
            target.origin = f.origin;
          if (!isUsableRouteCode(target.dest) && isUsableRouteCode(f.dest))
            target.dest = f.dest;
          if (
            (!target.airline ||
              target.airline === "Unknown Carrier" ||
              target.airline === "Commercial Flight") &&
            f.airline
          )
            target.airline = f.airline;
          if (
            isUsableRouteCode(target.origin) &&
            isUsableRouteCode(target.dest)
          ) {
            target.routeSource = "AirLabs";
            target.isWibbRoute =
              target.origin === "PKU" ||
              target.origin === "WIBB" ||
              target.dest === "PKU" ||
              target.dest === "WIBB";
            target.directionType =
              target.dest === "PKU" || target.dest === "WIBB"
                ? "ARR"
                : target.origin === "PKU" || target.origin === "WIBB"
                  ? "DEP"
                  : "";
          }
        });
      }
      diagnostics.push({
        source: label,
        httpStatus: result ? result.httpStatus : null,
        rawCount: result ? result.rawCount || 0 : 0,
        acceptedCount: rows.length,
        addedPositionCount: added,
        status: result
          ? result.status === "success"
            ? result._fromCache
              ? "cache"
              : "berhasil"
            : result.status
          : "tidak ada",
        detail: result ? result.message || "" : "",
      });
      if (rows.length) sourcesUsed.push(label);
    }

    // =========================================================================
    // JADWAL AIRLABS PERIODIK 9 MENIT UNTUK PENUTUP POSISI DAN RUTE
    // =========================================================================
    const AIRLABS_POS_RUN_KEY = "encik_airlabs_pos_last_run";
    const AIRLABS_POS_INTERVAL_MS = 9 * 60 * 1000; // 9 Menit = 540.000 ms
    const lastAirlabsRun = Number(
      cache.get(AIRLABS_POS_RUN_KEY) ||
        props.getProperty(AIRLABS_POS_RUN_KEY) ||
        0,
    );
    const isAirlabsPositionDue =
      Date.now() - lastAirlabsRun >= AIRLABS_POS_INTERVAL_MS;

    const needsRoute = Object.values(flightMap).some(function (f) {
      return (
        f &&
        f.callsign &&
        f.callsign !== "UNKNOWN" &&
        (!isUsableRouteCode(f.origin) || !isUsableRouteCode(f.dest))
      );
    });

    const isAirlabsNeeded = isAirlabsPositionDue || needsRoute;

    // AMBIL DATA SECARA PARALEL (Dengan batasan 11 detik)
    const parallelData = fetchAllRadarSourcesParallel(isAirlabsNeeded);

    // Proses Data Hasil Parallel Fetch
    let rapidCorrection = { matched: 0, corrected: 0 };
    Object.keys(parallelData).forEach((providerName) => {
      const res = parallelData[providerName];
      if (res.status === "success") {
        let processedFlights = [];
        let rawCount = 0;

        if (res.type === "adsbfi" || res.type === "adsblol") {
          const listKey = "ac";
          let rows = Array.isArray(res.rawData)
            ? res.rawData
            : res.rawData && Array.isArray(res.rawData[listKey])
              ? res.rawData[listKey]
              : [];
          processedFlights = processAdsbFiAc(rows);
          rawCount = rows.length;
          addSource(
            providerName,
            {
              status: "success",
              httpStatus: 200,
              rawCount: rawCount,
              flights: processedFlights,
              message: "OK",
            },
            res.rank,
            false,
          );
        } else if (res.type === "rapid") {
          const listKey = "ac";
          let rows = Array.isArray(res.rawData)
            ? res.rawData
            : res.rawData && Array.isArray(res.rawData[listKey])
              ? res.rawData[listKey]
              : [];
          processedFlights = processRapidApiFlights(rows);
          rawCount = rows.length;
          addSource(
            providerName,
            {
              status: "success",
              httpStatus: 200,
              rawCount: rawCount,
              flights: processedFlights,
              message: "OK",
            },
            res.rank,
            false,
          );
          rapidCorrection = applyRapidRouteCorrections(
            flightMap,
            processedFlights || [],
          );
        } else if (res.type === "opensky") {
          const listKey = "states";
          let rows = Array.isArray(res.rawData)
            ? res.rawData
            : res.rawData && Array.isArray(res.rawData[listKey])
              ? res.rawData[listKey]
              : [];
          processedFlights = processOpenSkyStates(rows);
          rawCount = rows.length;
          addSource(
            providerName,
            {
              status: "success",
              httpStatus: 200,
              rawCount: rawCount,
              flights: processedFlights,
              message: "OK",
            },
            res.rank,
            false,
          );
        } else if (res.type === "airlabs") {
          let rows =
            res.rawData && res.rawData.response ? res.rawData.response : [];
          processedFlights = processAirLabsFlights(rows);
          rawCount = rows.length;

          if (isAirlabsPositionDue) {
            addSource(
              providerName,
              {
                status: "success",
                httpStatus: 200,
                rawCount: rawCount,
                flights: processedFlights,
                message: "OK",
              },
              res.rank,
              false,
            );
            try {
              cache.put(AIRLABS_POS_RUN_KEY, String(Date.now()), 600);
              props.setProperty(AIRLABS_POS_RUN_KEY, String(Date.now()));
            } catch (e) {}
          } else {
            addSource(
              "AirLabs (enrichment)",
              {
                status: "success",
                httpStatus: 200,
                rawCount: rawCount,
                flights: processedFlights,
                message: "OK",
              },
              res.rank,
              true,
            );
          }
        }
      } else {
        diagnostics.push({
          source: providerName,
          httpStatus: res.code || null,
          rawCount: 0,
          acceptedCount: 0,
          status: "error",
          detail: res.message,
        });
      }
    });

    if (!isAirlabsNeeded) {
      diagnostics.push({
        source: "AirLabs (9-Min Check & Enrichment)",
        httpStatus: null,
        rawCount: 0,
        acceptedCount: 0,
        status: "dilewati",
        detail: !AIRLABS_KEYS.length
          ? "API key belum dikonfigurasi."
          : "Belum jadwal 9 menit (sisa: " +
            Math.max(
              0,
              Math.round(
                (AIRLABS_POS_INTERVAL_MS - (Date.now() - lastAirlabsRun)) /
                  1000,
              ),
            ) +
            " detik) dan rute sudah lengkap.",
      });
    }

    // Pemulihan Pesawat Hilang (Targeted Lookup)
    const hasMissingSnapshotAircraft = recoveryCandidates.some(function (old) {
      const hex = String(old.icao24 || "").toUpperCase();
      const key = /^[0-9A-F]{6}$/.test(hex)
        ? hex
        : "CS_" + normalizeFlightCallsign(old.callsign);
      return !flightMap[key] || !flightMap[key]._seenInCurrentCycle;
    });

    if (hasMissingSnapshotAircraft) {
      recoverMissingAircraftPositions(
        flightMap,
        recoveryCandidates,
        diagnostics,
        cycleStartedAt,
      );
    }

    enrichFlightRoutesFromFlightradar24(flightMap, diagnostics);

    Object.keys(flightMap).forEach(function (k) {
      const f = flightMap[k];
      if (!f) return;
      if (!f._seenInCurrentCycle && f.positionStatus === "recovery_pending")
        f.positionStatus = "stale";
      const posAt = Number(
        f.positionTimestamp || f.positionLastConfirmedAt || 0,
      );
      if (posAt > 0)
        f.positionAgeSec = Math.max(0, Math.round((Date.now() - posAt) / 1000));
      delete f._seenInCurrentCycle;
    });

    const mergedFlights = Object.values(flightMap)
      .filter(function (f) {
        if (
          !f ||
          f.lat === null ||
          f.lat === undefined ||
          f.lon === null ||
          f.lon === undefined
        )
          return false;
        const lat = Number(f.lat),
          lon = Number(f.lon);
        if (
          !Number.isFinite(lat) ||
          !Number.isFinite(lon) ||
          Math.abs(lat) > 90 ||
          Math.abs(lon) > 180
        )
          return false;
        return (
          calculateHaversineDistance(WIBB.lat, WIBB.lon, lat, lon) <=
          WIBB.radiusKm
        );
      })
      .map(function (f) {
        f.distanceKm = Math.round(
          calculateHaversineDistance(
            WIBB.lat,
            WIBB.lon,
            Number(f.lat),
            Number(f.lon),
          ),
        );
        return f;
      });

    const now = new Date().toISOString();
    const fingerprint = buildFlightDataFingerprint(mergedFlights);
    const previousFingerprint =
      lastGood &&
      (lastGood.dataFingerprint ||
        (lastGood.flights ? buildFlightDataFingerprint(lastGood.flights) : ""));
    let result;

    if (mergedFlights.length) {
      const changed = fingerprint !== previousFingerprint;
      result = {
        status: "success",
        message:
          "Data posisi digabungkan secara paralel dari sumber yang tersedia.",
        source: sourcesUsed.join(", ") || "Tidak Ada Data",
        timestamp: now,
        dataUpdatedAt:
          changed || !lastGood
            ? now
            : lastGood.dataUpdatedAt || lastGood.timestamp || now,
        cacheStatus: changed || !lastGood ? "updated" : "unchanged",
        dataFingerprint: fingerprint,
        flights: mergedFlights,
        totalCount: mergedFlights.length,
        wibbCount: mergedFlights.filter(function (f) {
          return !!f.isWibbRoute;
        }).length,
        diagnostics: diagnostics,
        routeCorrection: rapidCorrection,
      };
      if (changed || !lastGood) {
        try {
          cache.put(LAST_GOOD_KEY, JSON.stringify(result), 21600);
        } catch (e) {}
        savePersistentFlightSnapshot(result);
      } else if (lastGood) {
        lastGood.timestamp = now;
        lastGood.diagnostics = diagnostics;
        lastGood.cacheStatus = "unchanged";
        result = lastGood;
        try {
          cache.put(LAST_GOOD_KEY, JSON.stringify(result), 21600);
        } catch (e) {}
      }
    } else if (lastGood && lastGood.flights && lastGood.flights.length) {
      result = Object.assign({}, lastGood, {
        status: "success",
        timestamp: now,
        message: "Tidak ada data baru dari API; menampilkan snapshot terakhir.",
        cacheStatus: "stale_fallback",
        diagnostics: diagnostics,
        lastSuccessfulUpdate: lastGood.dataUpdatedAt || lastGood.timestamp,
      });
    } else {
      result = {
        status: "error",
        message: "Belum ada API yang mengirim posisi pesawat valid.",
        timestamp: now,
        source: "Tidak Ada Data",
        flights: [],
        totalCount: 0,
        wibbCount: 0,
        cacheStatus: "empty",
        diagnostics: diagnostics,
      };
    }

    // Cache respons disimpan selama 11 detik
    try {
      cache.put(CHECK_KEY, JSON.stringify(result), 11);
    } catch (e) {}
    return result;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Snapshot permanen di Google Drive sebagai cadangan dari CacheService.
 */
function loadPersistentFlightSnapshot() {
  try {
    const props = PropertiesService.getScriptProperties();
    const fileId = props.getProperty("FLIGHT_RADAR_LAST_GOOD_FILE_ID");
    if (!fileId) return null;
    const file = DriveApp.getFileById(fileId);
    const content = file.getBlob().getDataAsString();
    return content ? JSON.parse(content) : null;
  } catch (e) {
    Logger.log("Gagal membaca snapshot permanen Flight Radar: " + e);
    return null;
  }
}

function savePersistentFlightSnapshot(snapshot) {
  try {
    const props = PropertiesService.getScriptProperties();
    const fileId = props.getProperty("FLIGHT_RADAR_LAST_GOOD_FILE_ID");
    const content = JSON.stringify(snapshot);
    if (fileId) {
      DriveApp.getFileById(fileId).setContent(content);
    } else {
      const file = DriveApp.createFile(
        "BMKG_WIBB_FlightRadar_LastGoodCache.json",
        content,
        MimeType.PLAIN_TEXT,
      );
      props.setProperty("FLIGHT_RADAR_LAST_GOOD_FILE_ID", file.getId());
    }
  } catch (e) {
    Logger.log("Gagal menyimpan snapshot permanen Flight Radar: " + e);
  }
}

function buildFlightDataFingerprint(flights) {
  const normalized = (flights || [])
    .map(function (f) {
      return [
        f.icao24,
        f.callsign,
        Number(f.lat).toFixed(4),
        Number(f.lon).toFixed(4),
        f.altFeet || 0,
        f.speedKts || 0,
        f.heading || 0,
        f.origin || "???",
        f.dest || "???",
        f.isWibbRoute ? 1 : 0,
        Number(f.positionTimestamp || 0),
        f.positionSource || "",
        f.positionStatus || "live",
        f.aircraftTypeCode || "",
        f.aircraftType || "",
        f.aircraftDescription || "",
        f.registration || "",
        f.aircraftCategory || "",
      ].join("|");
    })
    .sort();
  const raw = normalized.join("~");
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    raw,
  );
  return Utilities.base64EncodeWebSafe(digest);
}

/**
 * Ekstraksi metadata identitas pesawat dari payload provider.
 */
function extractAircraftMetadata(ac, sourceName) {
  ac = ac || {};
  function pick(keys) {
    for (var i = 0; i < keys.length; i++) {
      var v = ac[keys[i]];
      if (v !== null && v !== undefined && String(v).trim() !== "")
        return String(v).trim();
    }
    return "";
  }
  var code = pick([
    "t",
    "type",
    "type_code",
    "aircraft_type",
    "aircraft_type_code",
    "icao_type",
    "icaoType",
    "model_code",
    "aircraftCode",
  ]).toUpperCase();
  var desc = pick([
    "desc",
    "description",
    "aircraft_desc",
    "aircraft_description",
    "model",
    "aircraft_model",
    "type_description",
  ]);
  var reg = pick([
    "r",
    "reg",
    "registration",
    "registration_number",
    "reg_number",
    "tail",
    "tail_number",
    "aircraft_registration",
  ]).toUpperCase();
  var category = pick([
    "category",
    "category_description",
    "aircraft_category",
    "wtc",
  ]);
  var names = {
    AT43: "ATR 42-300/320",
    AT45: "ATR 42-500",
    AT46: "ATR 42-600",
    AT72: "ATR 72-200",
    AT73: "ATR 72-200/210",
    AT75: "ATR 72-500",
    AT76: "ATR 72-600",
    DH8A: "De Havilland Canada Dash 8-100",
    DH8B: "De Havilland Canada Dash 8-200",
    DH8C: "De Havilland Canada Dash 8-300",
    DH8D: "De Havilland Canada Dash 8 Q400",
    DHC6: "De Havilland Canada Twin Otter",
    C208: "Cessna 208 Caravan",
    C208B: "Cessna 208B Grand Caravan",
    C172: "Cessna 172",
    B738: "Boeing 737-800",
    B739: "Boeing 737-900",
    A320: "Airbus A320",
    A321: "Airbus A321",
    A20N: "Airbus A320neo",
    A21N: "Airbus A321neo",
    E190: "Embraer 190",
    E195: "Embraer 195",
  };
  return {
    aircraftTypeCode: code,
    aircraftType: desc || names[code] || "",
    aircraftDescription: desc,
    registration: reg,
    aircraftCategory: category,
    aircraftMetadataSource:
      code || desc || reg || category ? sourceName || "" : "",
  };
}

function mergeAircraftMetadata(target, incoming) {
  if (!target || !incoming) return;
  [
    "aircraftTypeCode",
    "aircraftType",
    "aircraftDescription",
    "registration",
    "aircraftCategory",
  ].forEach(function (k) {
    if (!String(target[k] || "").trim() && String(incoming[k] || "").trim())
      target[k] = incoming[k];
  });
  if (!target.aircraftType && target.aircraftTypeCode) {
    var names = {
      AT43: "ATR 42-300/320",
      AT45: "ATR 42-500",
      AT46: "ATR 42-600",
      AT72: "ATR 72-200",
      AT73: "ATR 72-200/210",
      AT75: "ATR 72-500",
      AT76: "ATR 72-600",
      DH8D: "De Havilland Canada Dash 8 Q400",
      DHC6: "De Havilland Canada Twin Otter",
      C208: "Cessna 208 Caravan",
      C208B: "Cessna 208B Grand Caravan",
      C172: "Cessna 172",
      B738: "Boeing 737-800",
      A320: "Airbus A320",
      A20N: "Airbus A320neo",
    };
    target.aircraftType = names[target.aircraftTypeCode] || "";
  }
  if (!target.aircraftMetadataSource && incoming.aircraftMetadataSource)
    target.aircraftMetadataSource = incoming.aircraftMetadataSource;
}

function normalizeFlightCallsign(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .trim();
}

function isUsableRouteCode(value) {
  const v = String(value || "")
    .trim()
    .toUpperCase();
  return (
    !!v && v !== "???" && v !== "TRANSIT" && v !== "UNKNOWN" && v !== "N/A"
  );
}

function applyRapidRouteCorrections(flightMap, rapidFlights) {
  let matched = 0,
    corrected = 0;
  (rapidFlights || []).forEach(function (r) {
    const icao = String(r.icao24 || "")
      .trim()
      .toUpperCase();
    const cs = normalizeFlightCallsign(r.callsign);
    let key = icao && icao !== "UNKNOWN" && flightMap[icao] ? icao : "";
    if (!key && cs)
      key =
        Object.keys(flightMap).find(function (k) {
          return normalizeFlightCallsign(flightMap[k].callsign) === cs;
        }) || "";
    if (!key) return;
    matched++;
    const origin = String(r.origin || "")
      .trim()
      .toUpperCase();
    const dest = String(r.dest || "")
      .trim()
      .toUpperCase();
    if (!isUsableRouteCode(origin) && !isUsableRouteCode(dest)) return;
    const target = flightMap[key];
    const needsOrigin =
      !isUsableRouteCode(target.origin) && isUsableRouteCode(origin);
    const needsDest =
      !isUsableRouteCode(target.dest) && isUsableRouteCode(dest);
    if (needsOrigin || needsDest) {
      if (needsOrigin) target.origin = origin;
      if (needsDest) target.dest = dest;
      target.routeSource = "RapidAPI (pelengkap)";
      target.isWibbRoute =
        target.origin === "PKU" ||
        target.origin === "WIBB" ||
        target.dest === "PKU" ||
        target.dest === "WIBB";
      target.directionType =
        target.dest === "PKU" || target.dest === "WIBB"
          ? "ARR"
          : target.origin === "PKU" || target.origin === "WIBB"
            ? "DEP"
            : "";
      corrected++;
    }
  });
  return { matched: matched, corrected: corrected };
}

function mergeFlightsToMap(flightMap, newFlights, options) {
  (newFlights || []).forEach(function (f) {
    if (!f) return;
    const lat = Number(f.lat),
      lon = Number(f.lon);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180
    )
      return;
    if (
      calculateHaversineDistance(WIBB.lat, WIBB.lon, lat, lon) > WIBB.radiusKm
    )
      return;

    const rawIcao = String(f.icao24 || "")
      .trim()
      .toUpperCase();
    const icao = /^[0-9A-F]{6}$/.test(rawIcao) ? rawIcao : "";
    const callsign = normalizeFlightCallsign(f.callsign);

    let key = icao || "";
    if (
      !key &&
      callsign &&
      callsign !== "UNKNOWN" &&
      (!options || options.matchByCallsign !== false)
    ) {
      key = "CS_" + callsign;
    }
    if (!key) return;

    if (!flightMap[key]) {
      flightMap[key] = Object.assign({}, f, {
        icao24: icao,
        lat: lat,
        lon: lon,
        positionStatus: "live",
        positionTimestamp: Number(f.positionTimestamp || Date.now()),
        positionLastConfirmedAt: Number(f.positionTimestamp || Date.now()),
        _seenInCurrentCycle: true,
      });
      return;
    }

    const existing = flightMap[key];
    existing._seenInCurrentCycle = true;
    const oldTime = Number(existing.positionTimestamp || 0);
    const newTime = Number(f.positionTimestamp || 0);
    const oldRank = Number(existing.sourceRank || 99);
    const newRank = Number(f.sourceRank || 99);
    const isNewer = newTime && (!oldTime || newTime > oldTime);
    const sameOrUnknownTimeBetterSource =
      (!newTime || !oldTime || newTime === oldTime) && newRank < oldRank;
    if (isNewer || sameOrUnknownTimeBetterSource) {
      existing.lat = lat;
      existing.lon = lon;
      existing.positionTimestamp = newTime || Date.now();
      existing.positionLastConfirmedAt = existing.positionTimestamp;
      existing.positionAgeSec = f.positionAgeSec != null ? f.positionAgeSec : 0;
      existing.positionSource =
        f.positionSource || f.sourceName || existing.positionSource;
      existing.positionStatus = "live";
      existing.sourceRank = newRank;
    }

    if ((!existing.callsign || existing.callsign === "UNKNOWN") && callsign)
      existing.callsign = f.callsign;
    mergeAircraftMetadata(existing, f);
    if (
      (!existing.airline ||
        /unknown|commercial flight/i.test(existing.airline)) &&
      f.airline
    )
      existing.airline = f.airline;
    if (!isUsableRouteCode(existing.origin) && isUsableRouteCode(f.origin))
      existing.origin = f.origin;
    if (!isUsableRouteCode(existing.dest) && isUsableRouteCode(f.dest))
      existing.dest = f.dest;
    if (
      isUsableRouteCode(f.origin) &&
      isUsableRouteCode(f.dest) &&
      f.routeSource
    )
      existing.routeSource = f.routeSource;
    if (
      isUsableRouteCode(existing.origin) &&
      isUsableRouteCode(existing.dest)
    ) {
      existing.isWibbRoute =
        existing.origin === "PKU" ||
        existing.origin === "WIBB" ||
        existing.dest === "PKU" ||
        existing.dest === "WIBB";
      existing.directionType =
        existing.dest === "PKU" || existing.dest === "WIBB"
          ? "ARR"
          : existing.origin === "PKU" || existing.origin === "WIBB"
            ? "DEP"
            : "";
    }
    if ((!existing.altFeet || existing.altFeet === 0) && Number(f.altFeet) > 0)
      existing.altFeet = f.altFeet;
    if (
      (!existing.speedKts || existing.speedKts === 0) &&
      Number(f.speedKts) > 0
    )
      existing.speedKts = f.speedKts;
    if ((!existing.heading || existing.heading === 0) && Number(f.heading) > 0)
      existing.heading = f.heading;
    if (existing.onGround == null && f.onGround != null)
      existing.onGround = f.onGround;
  });
}

function recoverMissingAircraftPositions(
  flightMap,
  previousFlights,
  diagnostics,
  cycleStartedAt,
) {
  const missing = (previousFlights || []).filter(function (old) {
    const hex = String(old.icao24 || "").toUpperCase();
    if (!/^[0-9A-F]{6}$/.test(hex)) return false;
    const current = flightMap[hex];
    return !current || !current._seenInCurrentCycle;
  });

  if (!missing.length) {
    diagnostics.push({
      source: "Recovery posisi pesawat",
      httpStatus: null,
      rawCount: 0,
      acceptedCount: 0,
      status: "tidak diperlukan",
      detail: "Semua pesawat snapshot sudah terdeteksi pada feed utama.",
    });
    return;
  }

  missing.sort(function (a, b) {
    function priority(f) {
      return f.isWibbRoute ||
        f.origin === "PKU" ||
        f.origin === "WIBB" ||
        f.dest === "PKU" ||
        f.dest === "WIBB"
        ? 1
        : 0;
    }
    const p = priority(b) - priority(a);
    if (p) return p;
    const aa = Number(a.positionTimestamp || 0),
      bb = Number(b.positionTimestamp || 0);
    return bb - aa;
  });

  const props = PropertiesService.getScriptProperties();
  const recoveryCursorKey = "WIBB_RECOVERY_CURSOR_V2";
  const cursor =
    Math.max(0, Number(props.getProperty(recoveryCursorKey) || 0)) %
    missing.length;
  const rotated = missing.slice(cursor).concat(missing.slice(0, cursor));
  const selected = rotated.slice(0, 20);
  props.setProperty(
    recoveryCursorKey,
    String((cursor + selected.length) % missing.length),
  );
  const hexes = selected.map(function (f) {
    return String(f.icao24).toUpperCase();
  });
  const cache = CacheService.getScriptCache();
  const listKey = hexes.join(",");
  const digest = Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, listKey),
  ).substring(0, 18);
  const recoveryCacheSeconds = 8;
  let recoveredTotal = 0;

  function fetchHexBatch(label, url, ttlKey) {
    const cached = cache.get(ttlKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        (parsed.flights || []).forEach(function (f) {
          f.sourceName = label;
          f.sourceRank = label === "ADSB.fi recovery" ? 1 : 2;
        });
        mergeFlightsToMap(flightMap, parsed.flights || [], {
          matchByCallsign: true,
        });
        recoveredTotal += (parsed.flights || []).length;
        diagnostics.push({
          source: label,
          httpStatus: 200,
          rawCount: parsed.rawCount || 0,
          acceptedCount: (parsed.flights || []).length,
          status: "cache",
          detail: "Cache recovery ICAO, umur maksimal 8 detik.",
        });
        return;
      } catch (e) {}
    }
    try {
      const response = UrlFetchApp.fetch(url, {
        method: "get",
        muteHttpExceptions: true,
        followRedirects: true,
        headers: { Accept: "application/json" },
      });
      const code = response.getResponseCode();
      if (code !== 200) {
        diagnostics.push({
          source: label,
          httpStatus: code,
          rawCount: 0,
          acceptedCount: 0,
          status: "error",
          detail:
            "Recovery ICAO HTTP " +
            code +
            ": " +
            response.getContentText().substring(0, 160),
        });
        return;
      }
      const payload = JSON.parse(response.getContentText());
      const rows = Array.isArray(payload)
        ? payload
        : (payload && (payload.ac || payload.aircraft || payload.states)) || [];
      const flights = processAdsbFiAc(rows);
      flights.forEach(function (f) {
        f.sourceName = label;
        f.sourceRank = label === "ADSB.fi recovery" ? 1 : 2;
      });
      mergeFlightsToMap(flightMap, flights, { matchByCallsign: true });
      recoveredTotal += flights.length;
      try {
        cache.put(
          ttlKey,
          JSON.stringify({ rawCount: rows.length, flights: flights }),
          recoveryCacheSeconds,
        );
      } catch (e) {}
      diagnostics.push({
        source: label,
        httpStatus: 200,
        rawCount: rows.length,
        acceptedCount: flights.length,
        status: "berhasil",
        detail: "Pemeriksaan ICAO untuk " + hexes.length + " pesawat.",
      });
    } catch (e) {
      diagnostics.push({
        source: label,
        httpStatus: null,
        rawCount: 0,
        acceptedCount: 0,
        status: "exception",
        detail: String(e && e.message ? e.message : e),
      });
    }
  }

  fetchHexBatch(
    "ADSB.fi recovery",
    "https://opendata.adsb.fi/api/v2/icao/" + encodeURIComponent(listKey),
    "wibb_recovery_adsbfi_" + digest,
  );
  fetchHexBatch(
    "ADSB.lol recovery",
    "https://api.adsb.lol/v2/icao/" + encodeURIComponent(listKey),
    "wibb_recovery_adsblol_" + digest,
  );

  const stillMissing = hexes.filter(function (hex) {
    return !flightMap[hex] || !flightMap[hex]._seenInCurrentCycle;
  }).length;
  diagnostics.push({
    source: "Recovery posisi pesawat",
    httpStatus: null,
    rawCount: hexes.length,
    acceptedCount: recoveredTotal,
    status: stillMissing ? "sebagian" : "berhasil",
    detail:
      "Diperiksa " +
      hexes.length +
      " pesawat (rute PKU diprioritaskan); berhasil memperoleh data posisi dari lookup ICAO: " +
      recoveredTotal +
      "; belum pulih: " +
      stillMissing +
      ".",
  });
}

function normalizeAltitudeToFeet(value, unit, defaultUnit) {
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    value === "ground"
  )
    return 0;
  var n = Number(value);
  if (!Number.isFinite(n)) return 0;
  var u = String(unit || defaultUnit || "ft")
    .toLowerCase()
    .trim();
  if (
    u === "m" ||
    u === "meter" ||
    u === "meters" ||
    u === "metre" ||
    u === "metres"
  ) {
    return Math.round(n * 3.28084);
  }
  return Math.round(n);
}

function processRapidApiFlights(flightList) {
  const flights = [];

  (flightList || []).forEach((ac) => {
    const rawHex = ac.hex || ac.icao24 || ac.icao || "";
    const icao24 = /^[0-9A-F]{6}$/i.test(String(rawHex).trim())
      ? String(rawHex).trim().toUpperCase()
      : "";
    const callsign = String(ac.flight || ac.callsign || "UNKNOWN")
      .trim()
      .toUpperCase();
    const rawLat = ac.lat != null ? ac.lat : ac.latitude;
    const rawLon =
      ac.lon != null ? ac.lon : ac.lng != null ? ac.lng : ac.longitude;
    if (
      rawLat === null ||
      rawLat === undefined ||
      rawLat === "" ||
      rawLon === null ||
      rawLon === undefined ||
      rawLon === ""
    )
      return;
    const lat = Number(rawLat);
    const lon = Number(rawLon);

    if (
      Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lon) <= 180
    ) {
      const distanceKm = calculateHaversineDistance(
        WIBB.lat,
        WIBB.lon,
        lat,
        lon,
      );

      if (distanceKm <= WIBB.radiusKm) {
        const origin = String(
          ac.orig_iata ||
            ac.origin_iata ||
            ac.dep_iata ||
            ac.origin ||
            ac.from ||
            "???",
        )
          .trim()
          .toUpperCase();
        const dest = String(
          ac.dest_iata ||
            ac.destination_iata ||
            ac.arr_iata ||
            ac.destination ||
            ac.to ||
            "???",
        )
          .trim()
          .toUpperCase();
        const isArr = dest === "PKU" || dest === "WIBB";
        const isDep = origin === "PKU" || origin === "WIBB";
        const routeData = {
          airline: getAirlineByCallsign(callsign),
          origin: origin,
          dest: dest,
          isWibbRoute: isArr || isDep,
          directionType: isArr ? "ARR" : isDep ? "DEP" : "",
        };

        flights.push({
          icao24: icao24.toUpperCase(),
          callsign: callsign,
          airline: routeData.airline,
          lat: lat,
          lon: lon,
          altFeet: normalizeAltitudeToFeet(
            ac.alt_baro != null ? ac.alt_baro : ac.alt_geom,
            ac.altitude_unit || ac.alt_unit,
            "ft",
          ),
          speedKts: ac.gs ? Math.round(ac.gs) : 0,
          heading: ac.track ? Math.round(ac.track) : 0,
          onGround: ac.alt_baro === "ground" || ac.gnd === true,
          distanceKm: Math.round(distanceKm),
          positionTimestamp:
            ac.seen_pos != null
              ? Date.now() - Number(ac.seen_pos) * 1000
              : Date.now(),
          positionAgeSec: ac.seen_pos != null ? Number(ac.seen_pos) : 0,
          positionSource: "RapidAPI",
          ...extractAircraftMetadata(ac, "RapidAPI"),
          isWibbRoute: routeData.isWibbRoute,
          directionType: routeData.directionType,
          origin: routeData.origin,
          dest: routeData.dest,
          routeSource:
            isUsableRouteCode(routeData.origin) &&
            isUsableRouteCode(routeData.dest)
              ? "RapidAPI"
              : "",
        });
      }
    }
  });

  return flights;
}

function processOpenSkyStates(states) {
  const flights = [];

  states.forEach((state) => {
    const rawHex = state[0] || "";
    const icao24 = /^[0-9A-F]{6}$/i.test(String(rawHex))
      ? String(rawHex).toUpperCase()
      : "";
    let callsign = String(state[1] || "UNKNOWN")
      .trim()
      .toUpperCase();
    const lon = state[5];
    const lat = state[6];
    const baroAltitude = state[7];
    const onGround = state[8];
    const velocity = state[9];
    const heading = state[10];

    if (
      lat !== null &&
      lon !== null &&
      Number.isFinite(Number(lat)) &&
      Number.isFinite(Number(lon))
    ) {
      const distanceKm = calculateHaversineDistance(
        WIBB.lat,
        WIBB.lon,
        lat,
        lon,
      );

      if (distanceKm <= WIBB.radiusKm) {
        const routeData = {
          airline: getAirlineByCallsign(callsign),
          origin: "???",
          dest: "???",
          isWibbRoute: false,
          directionType: "",
        };

        flights.push({
          icao24: icao24.toUpperCase(),
          callsign: callsign,
          airline: routeData.airline,
          lat: lat,
          lon: lon,
          altFeet: normalizeAltitudeToFeet(baroAltitude, "m", "m"),
          speedKts: velocity ? Math.round(velocity * 1.94384) : 0,
          heading: heading ? Math.round(heading) : 0,
          onGround: onGround,
          distanceKm: Math.round(distanceKm),
          positionTimestamp:
            Number(state[3] || state[4] || 0) * 1000 || Date.now(),
          positionAgeSec:
            Number(state[3] || 0) > 0
              ? Math.max(0, Math.round(Date.now() / 1000 - Number(state[3])))
              : null,
          positionSource: "OpenSky",
          isWibbRoute: routeData.isWibbRoute,
          directionType: routeData.directionType,
          origin: routeData.origin,
          dest: routeData.dest,
        });
      }
    }
  });

  return flights;
}

function processAdsbFiAc(aircraftList) {
  const flights = [];
  (aircraftList || []).forEach(function (ac) {
    if (!ac || typeof ac !== "object") return;
    const rawHex = ac.hex || ac.icao24 || ac.icao || ac.icao_hex || "";
    const icao24 = /^[0-9A-F]{6}$/i.test(String(rawHex).trim())
      ? String(rawHex).trim().toUpperCase()
      : "";
    const rawCallsign =
      ac.flight || ac.callsign || ac.call || ac.identification || "";
    const callsign =
      String(rawCallsign || "UNKNOWN")
        .trim()
        .toUpperCase() || "UNKNOWN";
    const rawLat =
      ac.lat != null ? ac.lat : ac.latitude != null ? ac.latitude : null;
    const rawLon =
      ac.lon != null
        ? ac.lon
        : ac.lng != null
          ? ac.lng
          : ac.longitude != null
            ? ac.longitude
            : null;
    if (rawLat === null || rawLon === null || rawLat === "" || rawLon === "")
      return;
    const lat = Number(rawLat),
      lon = Number(rawLon);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180
    )
      return;
    const distanceKm = calculateHaversineDistance(WIBB.lat, WIBB.lon, lat, lon);
    if (distanceKm > WIBB.radiusKm) return;

    const seenPos = Number(ac.seen_pos);
    const positionTimestamp =
      Number.isFinite(seenPos) && seenPos >= 0
        ? Date.now() - seenPos * 1000
        : Date.now();
    const altValue =
      ac.alt_baro != null
        ? ac.alt_baro
        : ac.alt_geom != null
          ? ac.alt_geom
          : ac.altitude;
    const speedValue = ac.gs != null ? ac.gs : ac.speed != null ? ac.speed : 0;
    const headingValue =
      ac.track != null ? ac.track : ac.heading != null ? ac.heading : 0;
    const routeOrigin = String(
      ac.orig_iata || ac.origin_iata || ac.dep_iata || "???",
    )
      .trim()
      .toUpperCase();
    const routeDest = String(
      ac.dest_iata || ac.destination_iata || ac.arr_iata || "???",
    )
      .trim()
      .toUpperCase();
    const isArr = routeDest === "PKU" || routeDest === "WIBB";
    const isDep = routeOrigin === "PKU" || routeOrigin === "WIBB";

    flights.push({
      icao24: icao24,
      callsign: callsign,
      airline: getAirlineByCallsign(callsign),
      lat: lat,
      lon: lon,
      altFeet: normalizeAltitudeToFeet(
        altValue,
        ac.altitude_unit || ac.alt_unit,
        "ft",
      ),
      speedKts: Number.isFinite(Number(speedValue))
        ? Math.round(Number(speedValue))
        : 0,
      heading: Number.isFinite(Number(headingValue))
        ? Math.round(Number(headingValue))
        : 0,
      onGround:
        ac.alt_baro === "ground" || ac.gnd === true || ac.on_ground === true,
      distanceKm: Math.round(distanceKm),
      positionTimestamp: positionTimestamp,
      positionAgeSec: Number.isFinite(seenPos) ? seenPos : 0,
      positionSource: "ADS-B",
      ...extractAircraftMetadata(ac, "ADSB"),
      isWibbRoute: isArr || isDep,
      directionType: isArr ? "ARR" : isDep ? "DEP" : "",
      origin: routeOrigin,
      dest: routeDest,
      routeSource:
        isUsableRouteCode(routeOrigin) && isUsableRouteCode(routeDest)
          ? "ADSB"
          : "",
    });
  });
  return flights;
}

function processAirLabsFlights(airlabsList) {
  const flights = [];

  (airlabsList || []).forEach((ac) => {
    const rawHex = ac.hex || ac.icao24 || "";
    const icao24 = /^[0-9A-F]{6}$/i.test(String(rawHex))
      ? String(rawHex).toUpperCase()
      : "UNKNOWN";
    let rawCallsign = (
      ac.flight_icao ||
      ac.flight_iata ||
      ac.flight_number ||
      "UNKNOWN"
    )
      .toString()
      .trim();

    if (/^\d+$/.test(rawCallsign)) {
      if (ac.flight_icao) rawCallsign = ac.flight_icao;
      else if (ac.flight_iata) rawCallsign = ac.flight_iata;
    }

    const callsign = rawCallsign;
    const rawLat = ac.lat;
    const rawLon = ac.lng != null ? ac.lng : ac.lon;
    if (
      rawLat === null ||
      rawLat === undefined ||
      rawLat === "" ||
      rawLon === null ||
      rawLon === undefined ||
      rawLon === ""
    )
      return;
    const lat = Number(rawLat);
    const lon = Number(rawLon);

    if (
      Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lon) <= 180
    ) {
      const distanceKm = calculateHaversineDistance(
        WIBB.lat,
        WIBB.lon,
        lat,
        lon,
      );

      if (distanceKm <= WIBB.radiusKm) {
        const orig = ac.dep_iata || "???";
        const dest = ac.arr_iata || "???";
        const isArr = dest === "PKU" || dest === "WIBB";
        const isDep = orig === "PKU" || orig === "WIBB";
        const airlineName = getAirlineByCallsign(callsign);

        flights.push({
          icao24: icao24.toUpperCase(),
          callsign: callsign,
          airline: airlineName,
          lat: lat,
          lon: lon,
          // Mengonversi meter dari AirLabs ke feet secara otomatis
          altFeet: normalizeAltitudeToFeet(
            ac.alt,
            ac.altitude_unit || ac.alt_unit,
            "m",
          ),
          speedKts:
            ac.speed != null && ac.speed !== ""
              ? Math.round(Number(ac.speed) / 1.852)
              : 0,
          heading: ac.dir || 0,
          onGround: ac.status === "ground",
          distanceKm: Math.round(distanceKm),
          ...extractAircraftMetadata(ac, "AirLabs"),
          isWibbRoute: isArr || isDep,
          directionType: isArr ? "ARR" : isDep ? "DEP" : "",
          origin: orig,
          dest: dest,
        });
      }
    }
  });

  return flights;
}

function enrichFlightRoutesFromFlightradar24(flightMap, diagnostics) {
  const flights = Object.values(flightMap || {});
  if (!flights.length) return;

  const cache = CacheService.getScriptCache();
  const routeCacheKey = "wibb_fr24_route_map_v20";
  const fetchedAtKey = routeCacheKey + "_fetched_at";
  let routeMap = {};
  const cached = cache.get(routeCacheKey);
  if (cached) {
    try {
      routeMap = JSON.parse(cached) || {};
    } catch (e) {
      routeMap = {};
    }
  }
  const fetchedAt = Number(cache.get(fetchedAtKey) || 0);
  const cacheFresh =
    Object.keys(routeMap).length > 0 &&
    fetchedAt > 0 &&
    Date.now() - fetchedAt < 60000;

  if (!cacheFresh) {
    try {
      const url =
        "https://data-cloud.flightradar24.com/zones/fcgi/feed.js?bounds=" +
        BOUNDS.lamax +
        "," +
        BOUNDS.lamin +
        "," +
        BOUNDS.lomin +
        "," +
        BOUNDS.lomax;
      const response = UrlFetchApp.fetch(url, {
        method: "get",
        muteHttpExceptions: true,
        followRedirects: true,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          Accept: "application/json, text/plain, */*",
        },
      });
      const status = response.getResponseCode();
      if (status === 200) {
        const feed = JSON.parse(response.getContentText());
        const freshMap = {};
        Object.keys(feed || {}).forEach(function (id) {
          const row = feed[id];
          if (!Array.isArray(row)) return;
          const cs = normalizeFlightCallsign(row[16] || row[13] || "");
          const origin = String(row[11] || "")
            .trim()
            .toUpperCase();
          const dest = String(row[12] || "")
            .trim()
            .toUpperCase();
          if (!cs) return;
          freshMap[cs] = {
            origin: origin || "???",
            dest: dest || "???",
            airline: getAirlineByCallsign(cs),
            routeSource: "Flightradar24",
          };
        });
        if (Object.keys(freshMap).length) {
          routeMap = freshMap;
          cache.put(routeCacheKey, JSON.stringify(routeMap), 1800);
          cache.put(fetchedAtKey, String(Date.now()), 1800);
        }
        if (diagnostics)
          diagnostics.push({
            source: "Flightradar24 Route Enrichment",
            httpStatus: status,
            rawCount: Object.keys(feed || {}).length,
            acceptedCount: Object.keys(freshMap).length,
            status: Object.keys(freshMap).length ? "berhasil" : "feed kosong",
            detail: "Feed batch; pencocokan callsign exact/suffix.",
          });
      } else if (diagnostics) {
        diagnostics.push({
          source: "Flightradar24 Route Enrichment",
          httpStatus: status,
          rawCount: 0,
          acceptedCount: 0,
          status: "gagal",
          detail: response.getContentText().substring(0, 180),
        });
      }
    } catch (e) {
      if (diagnostics)
        diagnostics.push({
          source: "Flightradar24 Route Enrichment",
          httpStatus: null,
          rawCount: 0,
          acceptedCount: 0,
          status: "exception",
          detail: String(e && e.message ? e.message : e).substring(0, 200),
        });
      Logger.log("FR24 route enrichment: " + e);
    }
  } else if (diagnostics) {
    diagnostics.push({
      source: "Flightradar24 Route Enrichment",
      httpStatus: 200,
      rawCount: 0,
      acceptedCount: Object.keys(routeMap).length,
      status: "cache",
      detail: "Cache route FR24 masih segar.",
    });
  }

  function findLegacyRoute(callsign) {
    const cs = normalizeFlightCallsign(callsign);
    if (!cs || cs === "UNKNOWN") return null;
    if (routeMap[cs]) return routeMap[cs];
    const keys = Object.keys(routeMap);
    for (let i = 0; i < keys.length; i++) {
      const candidate = normalizeFlightCallsign(keys[i]);
      if (
        candidate.length >= 3 &&
        cs.length >= 3 &&
        (candidate === cs || candidate.endsWith(cs) || cs.endsWith(candidate))
      ) {
        return routeMap[keys[i]];
      }
    }
    return null;
  }

  let applied = 0,
    proximityFallback = 0,
    routeMatched = 0;
  flights.forEach(function (f) {
    if (!f) return;
    const cs = normalizeFlightCallsign(f.callsign);
    const route = findLegacyRoute(cs);
    if (route) {
      routeMatched++;
      if (!isUsableRouteCode(f.origin) && isUsableRouteCode(route.origin))
        f.origin = route.origin;
      if (!isUsableRouteCode(f.dest) && isUsableRouteCode(route.dest))
        f.dest = route.dest;
      if (
        (!f.airline || /unknown|commercial flight/i.test(f.airline)) &&
        route.airline
      )
        f.airline = route.airline;
      if (isUsableRouteCode(f.origin) && isUsableRouteCode(f.dest)) {
        f.routeSource = "Flightradar24";
        const isArr = f.dest === "PKU" || f.dest === "WIBB";
        const isDep = f.origin === "PKU" || f.origin === "WIBB";
        f.isWibbRoute = isArr || isDep;
        f.directionType = isArr ? "ARR" : isDep ? "DEP" : "";
        applied++;
        return;
      }
    }

    const lat = Number(f.lat),
      lon = Number(f.lon);
    if (
      Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lon) <= 180
    ) {
      const distanceKm = calculateHaversineDistance(
        WIBB.lat,
        WIBB.lon,
        lat,
        lon,
      );
      f.distanceKm = Math.round(distanceKm);
      if (distanceKm <= 35 && !f.isWibbRoute) {
        if (!isUsableRouteCode(f.origin)) f.origin = "PKU";
        if (!isUsableRouteCode(f.dest)) f.dest = "ENROUTE";
        f.isWibbRoute = true;
        f.directionType = "ARR";
        f.routeSource = "Proximity fallback (35 km)";
        proximityFallback++;
      }
    }
    if (
      cs &&
      cs !== "UNKNOWN" &&
      (!f.airline || /unknown|commercial flight/i.test(f.airline))
    ) {
      f.airline = getAirlineByCallsign(cs);
    }
  });

  if (diagnostics)
    diagnostics.push({
      source: "Route Match + Proximity Fallback",
      httpStatus: null,
      rawCount: flights.length,
      acceptedCount: applied + proximityFallback,
      status: applied + proximityFallback ? "berhasil" : "belum ditemukan",
      detail:
        "FR24 exact/suffix match: " +
        routeMatched +
        "; rute terisi: " +
        applied +
        "; fallback radius 35 km: " +
        proximityFallback +
        ". Fallback bukan konfirmasi tujuan resmi.",
    });
}

function fetchRealRouteByCallsign(callsign, lat, lon, distanceKm) {
  const route = {
    airline: getAirlineByCallsign(callsign),
    origin: "???",
    dest: "???",
    isWibbRoute: false,
    directionType: "",
  };
  const map = {};
  map.__temporary__ = {
    icao24: "__temporary__",
    callsign: callsign,
    lat: lat,
    lon: lon,
    origin: "???",
    dest: "???",
  };
  enrichFlightRoutesFromFlightradar24(map, []);
  const found = map.__temporary__;
  route.origin = found.origin || "???";
  route.dest = found.dest || "???";
  route.isWibbRoute =
    route.origin === "PKU" ||
    route.origin === "WIBB" ||
    route.dest === "PKU" ||
    route.dest === "WIBB";
  route.directionType =
    route.dest === "PKU" || route.dest === "WIBB"
      ? "ARR"
      : route.origin === "PKU" || route.origin === "WIBB"
        ? "DEP"
        : "";
  return route;
}

function getAirlineByCallsign(callsign) {
  if (!callsign) return "Commercial Flight";

  if (/^\d+$/.test(callsign)) {
    return "Lion Air / Commercial Flight (ICAO: LNI)";
  }

  // Dukungan mapping ICAO (3 huruf) dan IATA (2 huruf) umum di Indonesia
  const prefix3 = callsign.substring(0, 3).toUpperCase();
  const prefix2 = callsign.substring(0, 2).toUpperCase();

  const airlinesIcao = {
    GIA: "Garuda Indonesia (ICAO: GIA | IATA: GA)",
    LNI: "Lion Air (ICAO: LNI | IATA: JT)",
    CTV: "Citilink (ICAO: CTV | IATA: QG)",
    BTK: "Batik Air (ICAO: BTK | IATA: ID)",
    SJV: "Super Air Jet (ICAO: SJV | IATA: IU)",
    AWQ: "Indonesia AirAsia (ICAO: AWQ | IATA: QZ)",
    MNO: "Wings Air (ICAO: MNO | IATA: IW)",
    WON: "Wings Air (ICAO: WON | IATA: IW)",
    PAS: "Pelita Air (ICAO: PAS | IATA: IP)",
    SQK: "Susi Air (ICAO: SQK | IATA: SI)",
    AXM: "AirAsia (ICAO: AXM | IATA: AK)",
    MXD: "Batik Air Malaysia (ICAO: MXD | IATA: OD)",
    TGW: "Scoot Airlines (ICAO: SCO | IATA: TR)",
    SIA: "Singapore Airlines (ICAO: SIA | IATA: SQ)",
    MAS: "Malaysia Airlines (ICAO: MAS | IATA: MH)",
    JSA: "Jetstar Asia (ICAO: JSA | IATA: 3K)",
    HVN: "Vietnam Airlines (ICAO: HVN | IATA: VN)",
    PAL: "Philippine Airlines (ICAO: PAL | IATA: PR)",
    QTR: "Qatar Airways (ICAO: QTR | IATA: QR)",
  };

  const airlinesIata = {
    GA: "Garuda Indonesia (ICAO: GIA | IATA: GA)",
    JT: "Lion Air (ICAO: LNI | IATA: JT)",
    QG: "Citilink (ICAO: CTV | IATA: QG)",
    ID: "Batik Air (ICAO: BTK | IATA: ID)",
    IU: "Super Air Jet (ICAO: SJV | IATA: IU)",
    QZ: "Indonesia AirAsia (ICAO: AWQ | IATA: QZ)",
    IW: "Wings Air (ICAO: IW | IATA: IW)",
    IP: "Pelita Air (ICAO: PAS | IATA: IP)",
    SI: "Susi Air (ICAO: SQK | IATA: SI)",
    AK: "AirAsia (ICAO: AXM | IATA: AK)",
    OD: "Batik Air Malaysia (ICAO: MXD | IATA: OD)",
    TR: "Scoot Airlines (ICAO: SCO | IATA: TR)",
    SQ: "Singapore Airlines (ICAO: SIA | IATA: SQ)",
    MH: "Malaysia Airlines (ICAO: MAS | IATA: MH)",
    "3K": "Jetstar Asia (ICAO: JSA | IATA: 3K)",
    VN: "Vietnam Airlines (ICAO: HVN | IATA: VN)",
    PR: "Philippine Airlines (ICAO: PAL | IATA: PR)",
    QR: "Qatar Airways (ICAO: QTR | IATA: QR)",
  };

  return (
    airlinesIcao[prefix3] ||
    airlinesIata[prefix2] ||
    (callsign.startsWith("PK-") ? "General Aviation" : "Commercial Flight")
  );
}

function getFlightRadarSetupGuide() {
  return {
    required: ["RAPIDAPI_KEY", "RAPIDAPI_HOST", "AIRLABS_KEYS", "BMKG_API_KEY"],
    optional: [
      "OPENSKY_ACCESS_TOKEN",
      "OPENSKY_CLIENT_ID",
      "OPENSKY_CLIENT_SECRET",
      "FOLDER_IDS",
    ],
    defaults: { RAPIDAPI_HOST: "aircraftscatter.p.rapidapi.com" },
    notes:
      "Pisahkan beberapa AIRLABS_KEYS dengan koma. Jangan menaruh API key di HTML/frontend.",
  };
}

function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
