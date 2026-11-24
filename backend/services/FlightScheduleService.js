
const db = require("../database/connection");

const CONFIG = {
  API_URL: "https://api.aviationstack.com/v1/flights",
  AIRPORT_IATA: "PKU",
  AIRPORT_ICAO: "WIBB",
  AIRPORT_NAME: "Bandara Sultan Syarif Kasim II, Pekanbaru",
  TIME_ZONE: "Asia/Jakarta",
  MAX_ROWS: 100,
  POLL_HOURS: [9, 20]
};

// ======================================================
// 1. PERSIAPAN TABEL DATABASE
// ======================================================

db.exec(`
  CREATE TABLE IF NOT EXISTS flight_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    flight_key TEXT NOT NULL UNIQUE,
    local_date TEXT NOT NULL,
    type TEXT NOT NULL,
    flight_number TEXT,
    airline TEXT,
    origin TEXT,
    origin_iata TEXT,
    destination TEXT,
    destination_iata TEXT,
    scheduled_raw TEXT,
    scheduled_wib TEXT,
    estimated_raw TEXT,
    estimated_wib TEXT,
    actual_raw TEXT,
    actual_wib TEXT,
    status TEXT,
    delay_minutes INTEGER,
    terminal TEXT,
    gate TEXT,
    departure_timezone TEXT,
    arrival_timezone TEXT,
    first_seen_wib TEXT,
    last_seen_wib TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_flight_history_date
  ON flight_history(local_date);

  CREATE INDEX IF NOT EXISTS idx_flight_history_type
  ON flight_history(type);

  CREATE TABLE IF NOT EXISTS flight_poll_state (
    slot TEXT PRIMARY KEY,
    completed_at TEXT,
    captured INTEGER DEFAULT 0,
    added INTEGER DEFAULT 0,
    errors TEXT
  );
`);

// ======================================================
// 2. UTILITAS TANGGAL DAN WAKTU WIB
// ======================================================

function getTodayWIB() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CONFIG.TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const values = {};
  parts.forEach(part => {
    values[part.type] = part.value;
  });

  return `${values.year}-${values.month}-${values.day}`;
}

function getCurrentWIB() {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: CONFIG.TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).format(new Date());
}

// Mempertahankan jam yang tertulis pada timestamp sumber.
// Tidak menggeser jam berdasarkan offset +00:00.
function formatFlightTime(value) {
  if (!value || value === "-") return "-";

  const raw = String(value).trim();

  const match = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/
  );

  if (match) {
    return `${match[3]}-${match[2]}-${match[1]} ${match[4]}:${match[5]} WIB`;
  }

  return raw;
}

function getFlightDate(value) {
  if (!value || value === "-") return "";

  const match = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (!match) return "";

  return `${match[1]}-${match[2]}-${match[3]}`;
}

function getValue(object, key, fallback = "-") {
  const value = object?.[key];

  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return value;
}

// ======================================================
// 3. AMBIL DATA AVIATIONSTACK
// ======================================================

async function fetchAviationstackFlights(type) {
  const apiKey = String(process.env.AVIATIONSTACK_API_KEY || "").trim();

  if (!apiKey) {
    throw new Error("AVIATIONSTACK_API_KEY belum diisi di file .env");
  }

  if (!["departure", "arrival"].includes(type)) {
    throw new Error(`Jenis penerbangan tidak dikenal: ${type}`);
  }

  const params = new URLSearchParams({
    access_key: apiKey,
    limit: String(CONFIG.MAX_ROWS)
  });

  if (type === "departure") {
    params.set("dep_iata", CONFIG.AIRPORT_IATA);
  } else {
    params.set("arr_iata", CONFIG.AIRPORT_IATA);
  }

  const url = `${CONFIG.API_URL}?${params.toString()}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json"
    },
    signal: AbortSignal.timeout(30000)
  });

  const body = await response.text();

  let json;

  try {
    json = JSON.parse(body);
  } catch {
    throw new Error(`Respons Aviationstack bukan JSON. HTTP ${response.status}`);
  }

  if (!response.ok || json.error) {
    const apiError = json.error || json;

    throw new Error(
      `Aviationstack HTTP ${response.status}: ${
        apiError.message || apiError.type || JSON.stringify(apiError)
      }`
    );
  }

  return {
    flights: Array.isArray(json.data) ? json.data : [],
    pagination: json.pagination || null
  };
}

// ======================================================
// 4. FORMAT DATA PENERBANGAN
// ======================================================

function formatFlight(flight, type) {
  const dep = flight.departure || {};
  const arr = flight.arrival || {};
  const airline = flight.airline || {};
  const flightInfo = flight.flight || {};

  const scheduled = type === "departure" ? dep.scheduled : arr.scheduled;
  const estimated = type === "departure" ? dep.estimated : arr.estimated;
  const actual = type === "departure" ? dep.actual : arr.actual;

  return {
    type,
    airline: getValue(airline, "name"),
    flightNumber: getValue(
      flightInfo,
      "iata",
      getValue(flightInfo, "number")
    ),
    origin: getValue(dep, "airport"),
    originIata: getValue(dep, "iata"),
    destination: getValue(arr, "airport"),
    destinationIata: getValue(arr, "iata"),

    scheduledRaw: scheduled || null,
    estimatedRaw: estimated || null,
    actualRaw: actual || null,

    scheduledWib: formatFlightTime(scheduled),
    estimatedWib: formatFlightTime(estimated),
    actualWib: formatFlightTime(actual),

    localDate: getFlightDate(scheduled),

    departureTimezone: dep.timezone || "",
    arrivalTimezone: arr.timezone || "",

    status: flight.flight_status || "unknown",
    delayMinutes: type === "departure" ? dep.delay : arr.delay,
    terminal: type === "departure" ? dep.terminal || "-" : arr.terminal || "-",
    gate: type === "departure" ? dep.gate || "-" : arr.gate || "-"
  };
}

// ======================================================
// 5. IDENTITAS DAN PENYIMPANAN RIWAYAT
// ======================================================

function getFlightHistoryKey(flight) {
  return [
    flight.type,
    flight.flightNumber,
    flight.scheduledRaw || flight.scheduledWib,
    flight.originIata,
    flight.destinationIata
  ].join("|").toLowerCase();
}

const saveFlightStatement = db.prepare(`
  INSERT INTO flight_history (
    flight_key,
    local_date,
    type,
    flight_number,
    airline,
    origin,
    origin_iata,
    destination,
    destination_iata,
    scheduled_raw,
    scheduled_wib,
    estimated_raw,
    estimated_wib,
    actual_raw,
    actual_wib,
    status,
    delay_minutes,
    terminal,
    gate,
    departure_timezone,
    arrival_timezone,
    first_seen_wib,
    last_seen_wib
  )
  VALUES (
    @flight_key,
    @local_date,
    @type,
    @flight_number,
    @airline,
    @origin,
    @origin_iata,
    @destination,
    @destination_iata,
    @scheduled_raw,
    @scheduled_wib,
    @estimated_raw,
    @estimated_wib,
    @actual_raw,
    @actual_wib,
    @status,
    @delay_minutes,
    @terminal,
    @gate,
    @departure_timezone,
    @arrival_timezone,
    @first_seen_wib,
    @last_seen_wib
  )
  ON CONFLICT(flight_key) DO UPDATE SET
    local_date = excluded.local_date,
    airline = excluded.airline,
    origin = excluded.origin,
    origin_iata = excluded.origin_iata,
    destination = excluded.destination,
    destination_iata = excluded.destination_iata,
    scheduled_raw = excluded.scheduled_raw,
    scheduled_wib = excluded.scheduled_wib,
    estimated_raw = excluded.estimated_raw,
    estimated_wib = excluded.estimated_wib,
    actual_raw = excluded.actual_raw,
    actual_wib = excluded.actual_wib,
    status = excluded.status,
    delay_minutes = excluded.delay_minutes,
    terminal = excluded.terminal,
    gate = excluded.gate,
    departure_timezone = excluded.departure_timezone,
    arrival_timezone = excluded.arrival_timezone,
    last_seen_wib = excluded.last_seen_wib
`);

function saveFlightHistory(flights) {
  if (!Array.isArray(flights) || flights.length === 0) {
    return 0;
  }

  const now = getCurrentWIB();
  let added = 0;

  const findExisting = db.prepare(`
    SELECT id FROM flight_history WHERE flight_key = ?
  `);

  const saveMany = db.transaction(items => {
    for (const flight of items) {
      const key = getFlightHistoryKey(flight);
      const exists = findExisting.get(key);

      saveFlightStatement.run({
        flight_key: key,
        local_date: flight.localDate || getTodayWIB(),
        type: flight.type || "",
        flight_number: flight.flightNumber || "",
        airline: flight.airline || "",
        origin: flight.origin || "",
        origin_iata: flight.originIata || "",
        destination: flight.destination || "",
        destination_iata: flight.destinationIata || "",
        scheduled_raw: flight.scheduledRaw || "",
        scheduled_wib: flight.scheduledWib || "",
        estimated_raw: flight.estimatedRaw || "",
        estimated_wib: flight.estimatedWib || "",
        actual_raw: flight.actualRaw || "",
        actual_wib: flight.actualWib || "",
        status: flight.status || "",
        delay_minutes: flight.delayMinutes ?? null,
        terminal: flight.terminal || "",
        gate: flight.gate || "",
        departure_timezone: flight.departureTimezone || "",
        arrival_timezone: flight.arrivalTimezone || "",
        first_seen_wib: now,
        last_seen_wib: now
      });

      if (!exists) added++;
    }
  });

  saveMany(flights);

  return added;
}

// ======================================================
// 6. MEMBACA RIWAYAT PENERBANGAN
// ======================================================

function readFlightHistory(dateWib) {
  const rows = db.prepare(`
    SELECT * FROM flight_history
    WHERE local_date = ?
    ORDER BY scheduled_raw ASC
  `).all(dateWib);

  const result = {
    departure: [],
    arrival: []
  };

  for (const row of rows) {
    const flight = {
      type: row.type,
      flightNumber: row.flight_number,
      airline: row.airline,
      origin: row.origin,
      originIata: row.origin_iata,
      destination: row.destination,
      destinationIata: row.destination_iata,
      scheduledRaw: row.scheduled_raw,
      scheduledWib: row.scheduled_wib,
      estimatedRaw: row.estimated_raw,
      estimatedWib: row.estimated_wib,
      actualRaw: row.actual_raw,
      actualWib: row.actual_wib,
      status: row.status,
      delayMinutes: row.delay_minutes,
      terminal: row.terminal,
      gate: row.gate,
      departureTimezone: row.departure_timezone,
      arrivalTimezone: row.arrival_timezone,
      firstSeenWib: row.first_seen_wib,
      lastSeenWib: row.last_seen_wib,
      localDate: row.local_date
    };

    if (row.type === "departure") result.departure.push(flight);
    if (row.type === "arrival") result.arrival.push(flight);
  }

  return result;
}

function getAccumulatedAirportScheduleData(dateWib = getTodayWIB()) {
  const history = readFlightHistory(dateWib);

  return {
    source: "Akumulasi data Aviationstack",
    dataType: "ACCUMULATED_FLIGHT_OBSERVATIONS",
    airport: CONFIG.AIRPORT_NAME,
    airportIata: CONFIG.AIRPORT_IATA,
    airportIcao: CONFIG.AIRPORT_ICAO,
    requestedDateWib: dateWib,
    fetchedAt: getCurrentWIB(),
    departure: history.departure,
    arrival: history.arrival,
    available: history.departure.length > 0 || history.arrival.length > 0
  };
}

// ======================================================
// 7. PENGAMBILAN DAN PENYIMPANAN OTOMATIS
// ======================================================

async function collectFlightHistory(force = false) {
  const today = getTodayWIB();

  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: CONFIG.TIME_ZONE,
      hour: "2-digit",
      hourCycle: "h23"
    }).format(new Date())
  );

  if (!force && !CONFIG.POLL_HOURS.includes(hour)) {
    return {
      success: false,
      message: "Bukan waktu pengambilan data.",
      hourWib: hour
    };
  }

  const slot = `${today}_${hour}`;

  const existingSlot = db.prepare(`
    SELECT slot FROM flight_poll_state WHERE slot = ?
  `).get(slot);

  if (!force && existingSlot) {
    return {
      success: true,
      skipped: true,
      message: "Data pada waktu ini sudah pernah diambil.",
      slot
    };
  }

  const collected = [];
  const errors = [];

  for (const type of ["departure", "arrival"]) {
    try {
      const response = await fetchAviationstackFlights(type);

      for (const raw of response.flights) {
        const flight = formatFlight(raw, type);

        if (flight.localDate === today) {
          collected.push(flight);
        }
      }
    } catch (error) {
      errors.push(`${type}: ${error.message}`);
    }
  }

  const added = saveFlightHistory(collected);

  db.prepare(`
    INSERT INTO flight_poll_state (
      slot, completed_at, captured, added, errors
    )
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(slot) DO UPDATE SET
      completed_at = excluded.completed_at,
      captured = excluded.captured,
      added = excluded.added,
      errors = excluded.errors
  `).run(
    slot,
    new Date().toISOString(),
    collected.length,
    added,
    JSON.stringify(errors)
  );

  return {
    success: errors.length < 2,
    dateWib: today,
    slot,
    captured: collected.length,
    added,
    errors
  };
}

// ======================================================
// 8. KONTEKS JADWAL UNTUK eNCIK
// ======================================================

function isFlightScheduleQuestion(question) {
  return /jadwal|penerbangan|pesawat|flight|keberangkatan|kedatangan|berangkat|mendarat|lepas landas|landing|take.?off|arriv|depart|maskapai|nomor penerbangan|bandara/i
    .test(String(question || ""));
}

function buildAirportScheduleContext(question) {
  if (!isFlightScheduleQuestion(question)) return "";

  const q = String(question || "").toLowerCase();
  const wantsDeparture =
    /keberangkatan|berangkat|lepas landas|take.?off|departures?/i.test(q);
  const wantsArrival =
    /kedatangan|mendarat|landing|arrivals?/i.test(q);
  const isTomorrow = /\b(besok|esok)\b/i.test(q);
  const isYesterday = /\b(kemarin|semalam)\b/i.test(q);

  const header = [
    "DATA PENERBANGAN BANDARA SULTAN SYARIF KASIM II (PKU)",
    `Tanggal sistem: ${getTodayWIB()} (WIB)`,
    "Zona waktu tampilan: WIB (Asia/Jakarta)",
    "Sumber: Akumulasi data Aviationstack real-time.",
    "Data merupakan penerbangan yang berhasil tertangkap saat pengambilan API, bukan jadwal resmi atau daftar lengkap seluruh penerbangan bandara.",
    ""
  ];

  if (isTomorrow || isYesterday) {
    header.push(
      "Permintaan tanggal di luar hari ini.",
      "Paket Aviationstack Free yang digunakan hanya menyediakan akses real-time; Flight Schedules/Future Flights termasuk fitur paket berbayar.",
      "Jangan mengarang jadwal besok atau kemarin."
    );

    return header.join("\n");
  }

  const data = getAccumulatedAirportScheduleData();

  header.push(`Terakhir dibaca: ${data.fetchedAt}`, "");

  function append(title, flights, type) {
    header.push(title);

    if (!flights.length) {
      header.push(
        "Belum ada data penerbangan yang berhasil tersimpan untuk kategori ini. Ini BUKAN bukti bahwa tidak ada penerbangan.",
        ""
      );
      return;
    }

    flights.forEach((flight, index) => {
      const route = type === "departure"
        ? `${flight.destination || "-"} (${flight.destinationIata || "-"})`
        : `${flight.origin || "-"} (${flight.originIata || "-"})`;

      header.push(
        `${index + 1}. ${flight.flightNumber || "-"} | ` +
        `${flight.airline || "-"} | ` +
        `${type === "departure" ? "Tujuan" : "Asal"}: ${route} | ` +
        `Jadwal: ${flight.scheduledWib || "Tidak tersedia"} | ` +
        `Status API: ${flight.status || "unknown"} | ` +
        `Delay: ${flight.delayMinutes == null ? "Tidak tersedia" : flight.delayMinutes + " menit"}`
      );
    });

    header.push("");
  }

  if (wantsDeparture && !wantsArrival) {
    append("KEBERANGKATAN HARI INI", data.departure, "departure");
  } else if (wantsArrival && !wantsDeparture) {
    append("KEDATANGAN HARI INI", data.arrival, "arrival");
  } else {
    append("KEBERANGKATAN HARI INI", data.departure, "departure");
    append("KEDATANGAN HARI INI", data.arrival, "arrival");
  }

  header.push(
    "ATURAN UNTUK AI:",
    "- Gunakan hanya penerbangan yang tercantum.",
    "- Semua waktu sudah diformat ke WIB. Jangan menambahkan 7 jam lagi.",
    "- Jangan menyebut data ini sebagai jadwal lengkap atau resmi bandara.",
    "- Data kosong bukan berarti tidak ada penerbangan.",
    "- Jangan mengklaim pesawat sudah berangkat atau mendarat tanpa data aktual.",
    "- Data merupakan gabungan hasil pengambilan pagi dan malam."
  );

  return header.join("\n");
}

// ======================================================
// 9. EXPORT FUNGSI
// ======================================================

module.exports = {
  CONFIG,
  getTodayWIB,
  getCurrentWIB,
  fetchAviationstackFlights,
  formatFlight,
  saveFlightHistory,
  readFlightHistory,
  getAccumulatedAirportScheduleData,
  collectFlightHistory,
  isFlightScheduleQuestion,
  buildAirportScheduleContext
};
