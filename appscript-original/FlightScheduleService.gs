/************************************************************
 * eNCIK - DATA PENERBANGAN AVIATIONSTACK (PAKET FREE)
 * Bandara Sultan Syarif Kasim II, Pekanbaru (PKU/WIBB)
 *
 * PENTING:
 * - Paket Free Aviationstack menyediakan real-time flights.
 * - Flight Schedules dan Future Flights tercantum pada paket berbayar.
 * - Modul ini TIDAK mengklaim sebagai timetable resmi bandara.
 * - Data /flights adalah data real-time yang tersedia dari API.
 * - Waktu ditampilkan berdasarkan timezone Asia/Jakarta.
 *
 * SCRIPT PROPERTY WAJIB:
 * AVIATIONSTACK_API_KEY = API key Aviationstack yang BARU
 *
 * Batas:
 * - 2 request per pembaruan (departure + arrival).
 * - Cache 16 jam agar penggunaan tidak menghabiskan kuota
 *   Free 100 request/bulan terlalu cepat.
 * - Jangan jalankan force refresh berkali-kali.
 ************************************************************/

var ENCIK_SCHEDULE_CONFIG = {
  API_URL: "https://api.aviationstack.com/v1/flights",
  AIRPORT_IATA: "PKU",
  AIRPORT_ICAO: "WIBB",
  AIRPORT_NAME: "Bandara Sultan Syarif Kasim II, Pekanbaru",
  TIME_ZONE: "Asia/Jakarta",

  // Pengambilan data otomatis
  POLL_HOURS: [9, 20],

  // Maksimal data dari API per kategori
  MAX_ROWS: 100,

  SCRIPT_PROPERTY_API_KEY: "AVIATIONSTACK_API_KEY",

  // Penyimpanan riwayat
  SPREADSHEET_PROPERTY_ID: "ENCIK_FLIGHT_HISTORY_SPREADSHEET_ID",
  HISTORY_SHEET: "Riwayat Penerbangan PKU",
  STATE_PROPERTY: "ENCIK_PKU_POLL_STATE_V2",
};

/* =========================================================
 * 1. DETEKSI PERTANYAAN JADWAL
 * ========================================================= */

function encikIsFlightScheduleQuestion_(question) {
  return /jadwal|penerbangan|pesawat|flight|keberangkatan|kedatangan|berangkat|mendarat|lepas landas|landing|take.?off|arriv|depart|maskapai|nomor penerbangan|bandara/i.test(
    String(question || ""),
  );
}

/* =========================================================
 * 2. UTILITAS
 * ========================================================= */

function encikFlightGet_(object, path, fallback) {
  var current = object;
  var parts = String(path || "").split(".");
  for (var i = 0; i < parts.length; i++) {
    if (current == null || current[parts[i]] == null) {
      return fallback == null ? "-" : fallback;
    }
    current = current[parts[i]];
  }
  return current === "" ? (fallback == null ? "-" : fallback) : current;
}

function encikFlightToday_() {
  return Utilities.formatDate(
    new Date(),
    ENCIK_SCHEDULE_CONFIG.TIME_ZONE,
    "yyyy-MM-dd",
  );
}

/**
 * Mengubah timestamp ISO yang memiliki Z/offset ke WIB.
 * Tidak menambahkan +7 jam secara manual.
 * Jika timestamp tidak memiliki zona waktu, gunakan nilai apa adanya
 * sebagai waktu lokal bandara PKU (WIB), bukan menganggapnya UTC.
 */
function encikFlightFormatTime_(value) {
  if (!value || value === "-") return "-";

  var raw = String(value).trim();

  // Aviationstack pada data PKU memberikan jam lokal
  // tetapi timestamp dapat memiliki offset +00:00.
  // Karena sudah diverifikasi dengan jadwal bandara,
  // gunakan tanggal dan jam yang tertulis langsung.
  var match = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/,
  );

  if (match) {
    return (
      match[3] +
      "-" +
      match[2] +
      "-" +
      match[1] +
      " " +
      match[4] +
      ":" +
      match[5] +
      " WIB"
    );
  }

  return raw;
}

function encikFlightDateInWib_(value) {
  if (!value || value === "-") return "";

  var raw = String(value).trim();

  // Ambil tanggal langsung dari timestamp Aviationstack.
  // Jangan mengonversi offset +00:00 menjadi tanggal UTC+7.
  var match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (match) {
    return match[1] + "-" + match[2] + "-" + match[3];
  }

  return "";
}

function encikFlightApiKey_() {
  var key = PropertiesService.getScriptProperties().getProperty(
    ENCIK_SCHEDULE_CONFIG.SCRIPT_PROPERTY_API_KEY,
  );
  return String(key || "").trim();
}

/* =========================================================
 * 3. AMBIL DATA REAL-TIME AVIATIONSTACK
 * ========================================================= */

function encikFetchAviationstackFlights_(type) {
  var apiKey = encikFlightApiKey_();
  if (!apiKey) {
    throw new Error(
      "AVIATIONSTACK_API_KEY belum diisi di Apps Script > Project Settings > Script Properties.",
    );
  }

  if (type !== "departure" && type !== "arrival") {
    throw new Error("Jenis penerbangan tidak dikenal: " + type);
  }

  var params = [
    "access_key=" + encodeURIComponent(apiKey),
    "limit=" + ENCIK_SCHEDULE_CONFIG.MAX_ROWS,
  ];

  if (type === "departure") {
    params.push("dep_iata=" + ENCIK_SCHEDULE_CONFIG.AIRPORT_IATA);
  } else {
    params.push("arr_iata=" + ENCIK_SCHEDULE_CONFIG.AIRPORT_IATA);
  }

  var url = ENCIK_SCHEDULE_CONFIG.API_URL + "?" + params.join("&");
  var response = UrlFetchApp.fetch(url, {
    method: "get",
    muteHttpExceptions: true,
  });

  var http = response.getResponseCode();
  var body = response.getContentText();
  var json;

  try {
    json = JSON.parse(body);
  } catch (e) {
    throw new Error("Respons Aviationstack bukan JSON. HTTP " + http);
  }

  if (http < 200 || http >= 300 || json.error) {
    var apiError = json.error || json;
    throw new Error(
      "Aviationstack HTTP " +
        http +
        ": " +
        (apiError.message || apiError.type || JSON.stringify(apiError)),
    );
  }

  return {
    flights: Array.isArray(json.data) ? json.data : [],
    pagination: json.pagination || null,
  };
}

/* =========================================================
 * 4. FORMAT DATA PENERBANGAN
 * ========================================================= */

function encikFormatFlight_(flight, type) {
  var dep = flight.departure || {};
  var arr = flight.arrival || {};
  var airline = flight.airline || {};
  var flightInfo = flight.flight || {};

  var scheduled = type === "departure" ? dep.scheduled : arr.scheduled;
  var estimated = type === "departure" ? dep.estimated : arr.estimated;
  var actual = type === "departure" ? dep.actual : arr.actual;

  return {
    type: type,
    airline: encikFlightGet_(airline, "name", "-"),
    flightNumber: encikFlightGet_(
      flightInfo,
      "iata",
      encikFlightGet_(flightInfo, "number", "-"),
    ),
    origin: encikFlightGet_(dep, "airport", "-"),
    originIata: encikFlightGet_(dep, "iata", "-"),
    destination: encikFlightGet_(arr, "airport", "-"),
    destinationIata: encikFlightGet_(arr, "iata", "-"),
    scheduledRaw: scheduled || null,
    estimatedRaw: estimated || null,
    actualRaw: actual || null,
    scheduledWib: encikFlightFormatTime_(scheduled),
    estimatedWib: encikFlightFormatTime_(estimated),
    actualWib: encikFlightFormatTime_(actual),
    localDate: encikFlightDateInWib_(scheduled),
    departureTimezone: dep.timezone || "",
    arrivalTimezone: arr.timezone || "",
    status: flight.flight_status || "unknown",
    delayMinutes: type === "departure" ? dep.delay : arr.delay,
    terminal: type === "departure" ? dep.terminal || "-" : arr.terminal || "-",
    gate: type === "departure" ? dep.gate || "-" : arr.gate || "-",
  };
}

/* =========================================================
 * 5. AMBIL DATA HARI INI + CACHE
 * ========================================================= */

function encikGetAirportScheduleData_(forceRefresh) {
  var props = PropertiesService.getScriptProperties();
  var today = encikFlightToday_();
  var cacheKey = ENCIK_SCHEDULE_CONFIG.CACHE_PROPERTY;

  if (!forceRefresh) {
    var cachedRaw = props.getProperty(cacheKey);
    if (cachedRaw) {
      try {
        var cachedObj = JSON.parse(cachedRaw);
        var ageSeconds = (Date.now() - Number(cachedObj.savedAt || 0)) / 1000;
        if (
          cachedObj.date === today &&
          ageSeconds >= 0 &&
          ageSeconds < ENCIK_SCHEDULE_CONFIG.CACHE_SECONDS &&
          cachedObj.data
        ) {
          return cachedObj.data;
        }
      } catch (e) {
        props.deleteProperty(cacheKey);
      }
    }
  }

  var result = {
    source: "Aviationstack /v1/flights (real-time)",
    dataType: "REALTIME_FLIGHTS_NOT_OFFICIAL_TIMETABLE",
    airport: ENCIK_SCHEDULE_CONFIG.AIRPORT_NAME,
    airportIata: ENCIK_SCHEDULE_CONFIG.AIRPORT_IATA,
    airportIcao: ENCIK_SCHEDULE_CONFIG.AIRPORT_ICAO,
    requestedDateWib: today,
    fetchedAt: Utilities.formatDate(
      new Date(),
      ENCIK_SCHEDULE_CONFIG.TIME_ZONE,
      "dd-MM-yyyy HH:mm:ss 'WIB'",
    ),
    departure: [],
    arrival: [],
    departureError: null,
    arrivalError: null,
    available: false,
  };

  try {
    var depResult = encikFetchAviationstackFlights_("departure");
    result.departure = depResult.flights
      .map(function (f) {
        return encikFormatFlight_(f, "departure");
      })
      .filter(function (f) {
        return f.localDate === today;
      });
    result.departureHttpStatus = 200;
  } catch (e1) {
    result.departureError = String(e1.message || e1);
  }

  try {
    var arrResult = encikFetchAviationstackFlights_("arrival");
    result.arrival = arrResult.flights
      .map(function (f) {
        return encikFormatFlight_(f, "arrival");
      })
      .filter(function (f) {
        return f.localDate === today;
      });
    result.arrivalHttpStatus = 200;
  } catch (e2) {
    result.arrivalError = String(e2.message || e2);
  }

  result.available = result.departure.length > 0 || result.arrival.length > 0;
  result.partialFailure = !!(result.departureError || result.arrivalError);

  // Simpan di Script Properties karena CacheService memiliki batas TTL.
  // TTL 24 jam: maksimum 2 request per hari (sekitar 60 request/bulan).
  // Respons kosong juga disimpan agar pertanyaan berulang tidak menghabiskan kuota.
  props.setProperty(
    cacheKey,
    JSON.stringify({
      date: today,
      savedAt: Date.now(),
      data: result,
    }),
  );

  console.log(
    "[eNCIK Aviationstack] tanggal WIB=" +
      today +
      ", departure=" +
      result.departure.length +
      ", arrival=" +
      result.arrival.length +
      ", partialFailure=" +
      result.partialFailure,
  );

  return result;
}

/* =========================================================
 * 6. KONTEKS JADWAL UNTUK AI
 * ========================================================= */

function encikBuildAirportScheduleContext_(question) {
  if (!encikIsFlightScheduleQuestion_(question)) return "";

  var q = String(question || "").toLowerCase();
  var wantsDeparture =
    /keberangkatan|berangkat|lepas landas|take.?off|departures?/i.test(q);
  var wantsArrival = /kedatangan|mendarat|landing|arrivals?/i.test(q);
  var isTomorrow = /\b(besok|esok)\b/i.test(q);
  var isYesterday = /\b(kemarin|semalam)\b/i.test(q);

  var header = [
    "DATA PENERBANGAN BANDARA SULTAN SYARIF KASIM II (PKU)",
    "Tanggal sistem: " + encikFlightToday_() + " (WIB)",
    "Zona waktu tampilan: WIB (Asia/Jakarta)",
    "Sumber: Aviationstack Free /v1/flights real-time",
    "Sumber: Akumulasi hasil pengambilan berkala Aviationstack yang tersimpan di Google Sheets.",
    "PENTING: Data merupakan penerbangan yang berhasil tertangkap saat pengambilan API, bukan jadwal resmi atau daftar lengkap seluruh penerbangan bandara.",
    "",
  ];

  if (isTomorrow || isYesterday) {
    header.push(
      "Permintaan tanggal di luar hari ini.",
      "Paket Aviationstack Free yang digunakan hanya menyediakan akses real-time; Flight Schedules/Future Flights termasuk fitur paket berbayar.",
      "Jangan mengarang jadwal besok atau kemarin. Jelaskan keterbatasan sumber dengan singkat.",
    );
    return header.join("\n");
  }

  var data;
  try {
    data = encikGetAccumulatedAirportScheduleData_();
  } catch (err) {
    return header
      .concat([
        "Gagal mengambil data Aviationstack: " + String(err.message || err),
        "Jangan mengarang nomor penerbangan, jam, tujuan, atau status.",
      ])
      .join("\n");
  }

  header.push("Terakhir diambil: " + data.fetchedAt, "");

  if (data.departureError)
    header.push("Error keberangkatan: " + data.departureError);
  if (data.arrivalError) header.push("Error kedatangan: " + data.arrivalError);

  function append_(title, flights, type) {
    header.push(title);
    if (!flights || !flights.length) {
      header.push(
        "Belum ada data penerbangan yang berhasil tersimpan untuk kategori ini. Ini BUKAN bukti bahwa tidak ada penerbangan.",
        "",
      );
      return;
    }

    flights.forEach(function (f, i) {
      var route =
        type === "departure"
          ? (f.destination || "-") +
            (f.destinationIata && f.destinationIata !== "-"
              ? " (" + f.destinationIata + ")"
              : "")
          : (f.origin || "-") +
            (f.originIata && f.originIata !== "-"
              ? " (" + f.originIata + ")"
              : "");

      header.push(
        i +
          1 +
          ". " +
          (f.flightNumber || "-") +
          " | " +
          (f.airline || "-") +
          " | " +
          (type === "departure" ? "Tujuan: " : "Asal: ") +
          route +
          " | Jadwal: " +
          (f.scheduledWib || "Tidak tersedia") +
          " | Status API: " +
          (f.status || "unknown") +
          " | Delay: " +
          (f.delayMinutes == null
            ? "Tidak tersedia"
            : f.delayMinutes + " menit"),
      );
    });
    header.push("");
  }

  if (wantsDeparture && !wantsArrival) {
    append_("KEBERANGKATAN HARI INI", data.departure, "departure");
  } else if (wantsArrival && !wantsDeparture) {
    append_("KEDATANGAN HARI INI", data.arrival, "arrival");
  } else {
    append_("KEBERANGKATAN HARI INI", data.departure, "departure");
    append_("KEDATANGAN HARI INI", data.arrival, "arrival");
  }

  header.push(
    "ATURAN UNTUK AI:",
    "- Gunakan hanya penerbangan yang tercantum di atas.",
    "- Semua waktu sudah diformat ke WIB. Jangan menambahkan 7 jam lagi.",
    "- Jangan menyebut data ini sebagai jadwal lengkap/resmi bandara.",
    "- Data kosong berarti API tidak mengembalikan data, bukan berarti bandara tidak memiliki penerbangan.",
    "- Jangan mengubah status API menjadi klaim pesawat sudah berangkat/mendarat jika tidak ada data aktual.",
    "- Jika pengguna membandingkan dengan Skyscanner, jelaskan bahwa sumber dan cakupan data dapat berbeda.",
    "- Data yang diberikan merupakan gabungan hasil pengambilan pagi dan malam.",
    "- Gunakan seluruh penerbangan yang tersedia dalam konteks.",
    "- Jangan menganggap data yang tidak tercatat berarti penerbangan tersebut tidak ada.",
    "- Semua waktu ditampilkan dalam WIB. Jangan menambahkan 7 jam lagi.",
  );

  return header.join("\n");
}

/* =========================================================
 * 7. TES MANUAL
 * ========================================================= */

function testEncikAirportSchedule() {
  var result = encikGetAirportScheduleData_(true);
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function testAviationstackDeparturePKU() {
  var result = encikFetchAviationstackFlights_("departure");
  Logger.log("Jumlah data mentah departure: " + result.flights.length);
  Logger.log(JSON.stringify(result.flights.slice(0, 5), null, 2));
  return result;
}

function testAviationstackArrivalPKU() {
  var result = encikFetchAviationstackFlights_("arrival");
  Logger.log("Jumlah data mentah arrival: " + result.flights.length);
  Logger.log(JSON.stringify(result.flights.slice(0, 5), null, 2));
  return result;
}

/* =========================================================
 * PENYIMPANAN RIWAYAT PENERBANGAN eNCIK
 * ========================================================= */

function encikFlightHistorySheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(ENCIK_SCHEDULE_CONFIG.SPREADSHEET_PROPERTY_ID);

  var ss = id
    ? SpreadsheetApp.openById(id)
    : SpreadsheetApp.create("Riwayat Penerbangan eNCIK PKU");

  if (!id) {
    props.setProperty(
      ENCIK_SCHEDULE_CONFIG.SPREADSHEET_PROPERTY_ID,
      ss.getId(),
    );
  }

  var sheet = ss.getSheetByName(ENCIK_SCHEDULE_CONFIG.HISTORY_SHEET);

  if (!sheet) {
    sheet = ss.insertSheet(ENCIK_SCHEDULE_CONFIG.HISTORY_SHEET);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      "Key",
      "Tanggal WIB",
      "Jenis",
      "Nomor Penerbangan",
      "Maskapai",
      "Asal",
      "Kode Asal",
      "Tujuan",
      "Kode Tujuan",
      "Jadwal Raw",
      "Jadwal WIB",
      "Estimasi Raw",
      "Estimasi WIB",
      "Aktual Raw",
      "Aktual WIB",
      "Status",
      "Delay",
      "Terminal",
      "Gate",
      "Timezone Departure",
      "Timezone Arrival",
      "Pertama Terlihat",
      "Terakhir Terlihat",
    ]);

    sheet.setFrozenRows(1);
  }

  return sheet;
}

function encikFlightHistoryKey_(f) {
  return [
    f.type,
    f.flightNumber,
    f.scheduledRaw || f.scheduledWib,
    f.originIata,
    f.destinationIata,
  ]
    .join("|")
    .toLowerCase();
}

function encikSaveFlightHistory_(flights) {
  if (!flights || !flights.length) return 0;

  var sheet = encikFlightHistorySheet_();
  var lastRow = sheet.getLastRow();
  var existing = {};

  if (lastRow > 1) {
    var keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();

    keys.forEach(function (row, index) {
      existing[String(row[0])] = index + 2;
    });
  }

  var now = Utilities.formatDate(
    new Date(),
    ENCIK_SCHEDULE_CONFIG.TIME_ZONE,
    "yyyy-MM-dd HH:mm:ss",
  );

  var added = 0;

  flights.forEach(function (f) {
    var key = encikFlightHistoryKey_(f);

    var row = [
      key,
      f.localDate || encikFlightToday_(),
      f.type || "",
      f.flightNumber || "",
      f.airline || "",
      f.origin || "",
      f.originIata || "",
      f.destination || "",
      f.destinationIata || "",
      f.scheduledRaw || "",
      f.scheduledWib || "",
      f.estimatedRaw || "",
      f.estimatedWib || "",
      f.actualRaw || "",
      f.actualWib || "",
      f.status || "",
      f.delayMinutes == null ? "" : f.delayMinutes,
      f.terminal || "",
      f.gate || "",
      f.departureTimezone || "",
      f.arrivalTimezone || "",
      now,
      now,
    ];

    if (existing[key]) {
      var rowNumber = existing[key];
      var firstSeen = sheet.getRange(rowNumber, 22).getValue() || now;

      row[21] = firstSeen;

      sheet.getRange(rowNumber, 1, 1, 23).setValues([row]);
    } else {
      sheet.appendRow(row);
      added++;
    }
  });

  return added;
}

function encikReadFlightHistory_(dateWib) {
  var sheet = encikFlightHistorySheet_();
  var lastRow = sheet.getLastRow();

  var result = {
    departure: [],
    arrival: [],
  };

  if (lastRow < 2) return result;

  var rows = sheet.getRange(2, 1, lastRow - 1, 23).getValues();

  rows.forEach(function (r) {
    var storedDate = r[1];
    var normalizedDate = "";

    // Jika tanggal terbaca sebagai objek Date
    if (storedDate instanceof Date) {
      normalizedDate = Utilities.formatDate(
        storedDate,
        ENCIK_SCHEDULE_CONFIG.TIME_ZONE,
        "yyyy-MM-dd",
      );
    } else {
      normalizedDate = String(storedDate || "").trim();
    }

    if (normalizedDate !== dateWib) return;

    var f = {
      type: String(r[2]),
      flightNumber: String(r[3]),
      airline: String(r[4]),
      origin: String(r[5]),
      originIata: String(r[6]),
      destination: String(r[7]),
      destinationIata: String(r[8]),
      scheduledRaw: String(r[9]),
      scheduledWib: String(r[10]),
      estimatedRaw: String(r[11]),
      estimatedWib: String(r[12]),
      actualRaw: String(r[13]),
      actualWib: String(r[14]),
      status: String(r[15]),
      delayMinutes: r[16] === "" ? null : r[16],
      terminal: String(r[17]),
      gate: String(r[18]),
      departureTimezone: String(r[19]),
      arrivalTimezone: String(r[20]),
      firstSeenWib: String(r[21]),
      lastSeenWib: String(r[22]),
      localDate: normalizedDate,
    };

    if (f.type === "departure") {
      result.departure.push(f);
    }

    if (f.type === "arrival") {
      result.arrival.push(f);
    }
  });

  return result;
}

/* =========================================================
 * PENGAMBILAN DATA OTOMATIS
 * ========================================================= */

function collectEncikFlightHistory() {
  var lock = LockService.getScriptLock();

  if (!lock.tryLock(20000)) return;

  try {
    var today = encikFlightToday_();

    var hour = Number(
      Utilities.formatDate(new Date(), ENCIK_SCHEDULE_CONFIG.TIME_ZONE, "H"),
    );

    if (ENCIK_SCHEDULE_CONFIG.POLL_HOURS.indexOf(hour) === -1) {
      Logger.log("Bukan waktu pengambilan data.");
      return;
    }

    var props = PropertiesService.getScriptProperties();
    var state = {};

    try {
      state = JSON.parse(
        props.getProperty(ENCIK_SCHEDULE_CONFIG.STATE_PROPERTY) || "{}",
      );
    } catch (e) {}

    var slot = today + "_" + hour;

    if (state[slot]) {
      Logger.log("Data pada waktu ini sudah diambil.");
      return;
    }

    var collected = [];
    var errors = [];

    ["departure", "arrival"].forEach(function (type) {
      try {
        var response = encikFetchAviationstackFlights_(type);

        response.flights.forEach(function (raw) {
          var flight = encikFormatFlight_(raw, type);

          if (flight.localDate === today) {
            collected.push(flight);
          }
        });
      } catch (err) {
        errors.push(type + ": " + err.message);
      }
    });

    var added = encikSaveFlightHistory_(collected);

    state[slot] = {
      completedAt: new Date().toISOString(),
      captured: collected.length,
      added: added,
      errors: errors,
    };

    props.setProperty(
      ENCIK_SCHEDULE_CONFIG.STATE_PROPERTY,
      JSON.stringify(state),
    );

    Logger.log(
      "Pengambilan selesai: " +
        collected.length +
        " data, " +
        added +
        " data baru.",
    );
  } finally {
    lock.releaseLock();
  }
}

/* =========================================================
 * MEMASANG TRIGGER 09.00 DAN 20.00 WIB
 * ========================================================= */

function setupEncikFlightCollectionTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === "collectEncikFlightHistory") {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  [9, 20].forEach(function (hour) {
    ScriptApp.newTrigger("collectEncikFlightHistory")
      .timeBased()
      .everyDays(1)
      .atHour(hour)
      .inTimezone(ENCIK_SCHEDULE_CONFIG.TIME_ZONE)
      .create();
  });

  Logger.log("Trigger 09.00 dan 20.00 WIB berhasil dipasang.");
}

/* =========================================================
 * MEMBACA AKUMULASI RIWAYAT HARI INI
 * ========================================================= */

function encikGetAccumulatedAirportScheduleData_() {
  var today = encikFlightToday_();

  var history = encikReadFlightHistory_(today);

  return {
    source: "Akumulasi data Aviationstack",
    dataType: "ACCUMULATED_FLIGHT_OBSERVATIONS",
    airport: ENCIK_SCHEDULE_CONFIG.AIRPORT_NAME,
    airportIata: ENCIK_SCHEDULE_CONFIG.AIRPORT_IATA,
    requestedDateWib: today,

    fetchedAt: Utilities.formatDate(
      new Date(),
      ENCIK_SCHEDULE_CONFIG.TIME_ZONE,
      "dd-MM-yyyy HH:mm:ss 'WIB'",
    ),

    departure: history.departure,
    arrival: history.arrival,

    available: history.departure.length > 0 || history.arrival.length > 0,
  };
}
function testEncikFlightHistory() {
  var result = encikGetAccumulatedAirportScheduleData_();

  Logger.log(JSON.stringify(result, null, 2));
}

function testCollectEncikFlightHistory() {
  var today = encikFlightToday_();
  var allFlights = [];
  var report = {};

  ["departure", "arrival"].forEach(function (type) {
    try {
      var response = encikFetchAviationstackFlights_(type);
      var rawFlights = response.flights || [];

      report[type] = {
        apiCount: rawFlights.length,
        matchedToday: 0,
        samples: [],
      };

      rawFlights.forEach(function (raw) {
        var flight = encikFormatFlight_(raw, type);

        if (report[type].samples.length < 3) {
          report[type].samples.push({
            flight: flight.flightNumber,
            scheduledRaw: flight.scheduledRaw,
            scheduledWib: flight.scheduledWib,
            localDate: flight.localDate,
            status: flight.status,
          });
        }

        if (flight.localDate === today) {
          allFlights.push(flight);
          report[type].matchedToday++;
        }
      });
    } catch (err) {
      report[type] = {
        error: err.message || String(err),
      };
    }
  });

  var saved = encikSaveFlightHistory_(allFlights);

  report.todayWib = today;
  report.totalMatched = allFlights.length;
  report.totalSavedNew = saved;

  Logger.log(JSON.stringify(report, null, 2));
}

function testCheckJT236Timezone() {
  var response = encikFetchAviationstackFlights_("departure");
  var results = [];

  (response.flights || []).forEach(function (item) {
    var flightNumber = item.flight && (item.flight.iata || item.flight.number);

    if (flightNumber === "JT236") {
      results.push({
        flight: item.flight,
        departure: item.departure,
        arrival: item.arrival,
        flight_status: item.flight_status,
      });
    }
  });

  Logger.log(JSON.stringify(results, null, 2));
}

function encikCheckFlightTimezone_(rawTime, airportTimezone) {
  if (!rawTime) {
    return {
      raw: rawTime,
      timezone: airportTimezone,
      anomaly: false,
      message: "Waktu tidak tersedia",
    };
  }

  var offsetMatch = String(rawTime).match(/([+-])(\d{2}):?(\d{2})$/);

  var offset = null;

  if (offsetMatch) {
    var sign = offsetMatch[1] === "+" ? 1 : -1;

    offset = sign * (Number(offsetMatch[2]) * 60 + Number(offsetMatch[3]));
  } else if (/Z$/i.test(String(rawTime))) {
    offset = 0;
  }

  var expectedOffset = null;

  try {
    var now = new Date();

    var utcText = Utilities.formatDate(now, "UTC", "Z");

    var localText = Utilities.formatDate(now, airportTimezone, "Z");

    var match = localText.match(/([+-])(\d{2})(\d{2})/);

    if (match) {
      var sign = match[1] === "+" ? 1 : -1;
      expectedOffset = sign * (Number(match[2]) * 60 + Number(match[3]));
    }
  } catch (e) {}

  return {
    raw: rawTime,
    timezone: airportTimezone,
    rawOffsetMinutes: offset,
    expectedOffsetMinutes: expectedOffset,
    anomaly:
      offset !== null && expectedOffset !== null && offset !== expectedOffset,
    message:
      offset !== null && expectedOffset !== null && offset !== expectedOffset
        ? "Offset timestamp berbeda dengan timezone bandara. Perlu verifikasi sumber."
        : "Tidak ditemukan perbedaan offset.",
  };
}
function testJT236TimezoneCheck() {
  var result = encikCheckFlightTimezone_(
    "2026-11-03T16:40:00+00:00",
    "Asia/Jakarta",
  );

  Logger.log(JSON.stringify(result, null, 2));
}
function debugEncikFlightHistorySheet() {
  var sheet = encikFlightHistorySheet_();
  var lastRow = sheet.getLastRow();

  Logger.log("Nama Sheet: " + sheet.getName());
  Logger.log("Jumlah baris: " + lastRow);
  Logger.log("Tanggal yang dicari: " + encikFlightToday_());

  if (lastRow < 2) {
    Logger.log("SHEET BELUM MEMILIKI DATA PENERBANGAN.");
    return;
  }

  var rows = sheet.getRange(2, 1, Math.min(lastRow - 1, 10), 23).getValues();

  rows.forEach(function (row, index) {
    Logger.log(
      JSON.stringify({
        baris: index + 2,
        key: row[0],
        tanggal: row[1],
        tanggalType: Object.prototype.toString.call(row[1]),
        jenis: row[2],
        nomorPenerbangan: row[3],
        jamWib: row[10],
      }),
    );
  });
}
function testEncikFlightHistorySummary() {
  var data = encikGetAccumulatedAirportScheduleData_();

  var result = {
    tanggal: data.requestedDateWib,
    jumlahKeberangkatan: data.departure.length,
    jumlahKedatangan: data.arrival.length,
    totalPenerbangan: data.departure.length + data.arrival.length,
    tersedia: data.available,
    contohKeberangkatan: data.departure.slice(0, 3).map(function (f) {
      return {
        nomor: f.flightNumber,
        tujuan: f.destination,
        jam: f.scheduledWib,
      };
    }),
    contohKedatangan: data.arrival.slice(0, 3).map(function (f) {
      return {
        nomor: f.flightNumber,
        asal: f.origin,
        jam: f.scheduledWib,
      };
    }),
  };

  Logger.log(JSON.stringify(result, null, 2));
}
