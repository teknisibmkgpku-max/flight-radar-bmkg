
const CONFIG = {
  API_URL: "https://api.bmkg.go.id/cuaca-bandara",
  ICAO: "WIBB",
  CACHE_DURATION: 180000
};

// Cache sementara di memori server
let weatherCache = {
  data: null,
  expiresAt: 0
};

function extractValue(dataObj, targetKey) {
  if (!dataObj) return null;

  if (dataObj[targetKey] !== undefined) {
    const val = dataObj[targetKey];

    if (typeof val === "string" || typeof val === "number") {
      return val;
    }

    if (typeof val === "object" && val !== null) {
      return val.raw || val.text || val.content || JSON.stringify(val);
    }
  }

  if (dataObj.data && dataObj.data[targetKey] !== undefined) {
    const val = dataObj.data[targetKey];

    if (typeof val === "string" || typeof val === "number") {
      return val;
    }

    if (typeof val === "object" && val !== null) {
      return val.raw || val.text || val.content || JSON.stringify(val);
    }
  }

  if (Array.isArray(dataObj) && dataObj.length > 0) {
    return extractValue(dataObj[0], targetKey);
  }

  return null;
}

function findWeatherObject(obj) {
  if (!obj || typeof obj !== "object") return null;

  if (obj.temp !== undefined || obj.weather !== undefined) {
    return obj;
  }

  if (
    obj.data &&
    (obj.data.temp !== undefined || obj.data.weather !== undefined)
  ) {
    return obj.data;
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findWeatherObject(item);
      if (found) return found;
    }

    return null;
  }

  for (const key in obj) {
    if (typeof obj[key] === "object" && obj[key] !== null) {
      const found = findWeatherObject(obj[key]);
      if (found) return found;
    }
  }

  return null;
}

async function getAirportWeather(force = false) {
  const apiKey = process.env.BMKG_API_KEY || "";

  if (!apiKey) {
    return {
      status: "error",
      message: "BMKG_API_KEY belum diatur di file .env."
    };
  }

  // Gunakan cache jika masih berlaku
  if (
    !force &&
    weatherCache.data &&
    Date.now() < weatherCache.expiresAt
  ) {
    return weatherCache.data;
  }

  try {
    const url = `${CONFIG.API_URL}?icao=${CONFIG.ICAO}`;

    const response = await fetch(url, {
  method: "GET",
  redirect: "follow",
  headers: {
    "X-API-KEY": apiKey,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "Accept": "application/json"
  },
  signal: AbortSignal.timeout(20000)
});

    const responseText = await response.text();

    if (!response.ok) {
      return {
        status: "error",
        message: `HTTP Status ${response.status}: ${responseText}`
      };
    }

    let json;

    try {
      json = JSON.parse(responseText);
    } catch {
      return {
        status: "error",
        message: "Respons API BMKG bukan JSON yang valid."
      };
    }

    function cleanValue(value, fallback) {
      return value !== undefined && value !== null && value !== ""
        ? value
        : fallback;
    }

    const metarStr =
      extractValue(json, "last_observation") ||
      extractValue(json, "metar") ||
      "METAR WIBB Tidak Tersedia";

    const taforStr =
      extractValue(json, "last_forecast") ||
      extractValue(json, "tafor") ||
      extractValue(json, "taf") ||
      "TAF WIBB Tidak Tersedia";

    const wObj = findWeatherObject(json) || {};

    const result = {
      status: "success",
      icao: CONFIG.ICAO,
      metar: metarStr,
      tafor: taforStr,

      weatherInfo: {
        datetime: cleanValue(wObj.datetime, ""),
        time: cleanValue(wObj.time, ""),
        time_zone: cleanValue(wObj.time_zone, "WIB"),

        wind_direction: cleanValue(wObj.wind_direction, ""),
        wind_speed: cleanValue(wObj.wind_speed, "--"),
        visibility: cleanValue(wObj.visibility, "--"),

        weather: cleanValue(wObj.weather, "--"),

        temp: wObj.temp !== undefined && wObj.temp !== null
          ? `${wObj.temp}°C`
          : "--°C",

        dew_point: wObj.dew_point !== undefined && wObj.dew_point !== null
          ? `${wObj.dew_point}°C`
          : "--°C",

        pressure: cleanValue(wObj.pressure, "--"),

        icon: wObj.icon
          ? String(wObj.icon).replace(/\\/g, "")
          : ""
      },

      updatedAt: new Date().toISOString()
    };

    weatherCache = {
      data: result,
      expiresAt: Date.now() + CONFIG.CACHE_DURATION
    };

    return result;

  } catch (error) {
    console.error("BMKG Weather Error:", error);

    return {
      status: "error",
      message: error.name === "TimeoutError"
        ? "Permintaan ke API BMKG melewati batas waktu."
        : `Gagal mengambil data cuaca: ${error.message}`
    };
  }
}

module.exports = {
  getAirportWeather
};
