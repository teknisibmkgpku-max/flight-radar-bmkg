/**
 * ============================================================
 * eNCIK BACKEND AI — GROQ / GEMINI + PENCARIAN TIKET
 * Google Flights sebagai pencarian utama.
 *
 * Zona waktu: Asia/Jakarta
 *
 * SCRIPT PROPERTIES:
 * AI_PROVIDER          = groq atau gemini
 * GROQ_API_KEY         = API key Groq
 * GROQ_MODEL           = llama-3.3-70b-versatile
 * GEMINI_API_KEY       = API key Gemini
 * GEMINI_MODEL         = gemini-2.5-flash
 * TRAVELPAYOUTS_TOKEN  = (opsional) token Travelpayouts
 * STAYING_API_KEY      = diisi langsung pada konstanta di bawah
 *
 * Catatan:
 * - Travelpayouts hanya dipakai untuk mengambil estimasi harga
 *   jika token tersedia.
 * - Tautan pencarian utama selalu Google Flights.
 * - Tautan pencarian tiket diarahkan ke Google Flights.
 * ============================================================
 */

// API key StayingAPI sengaja diletakkan langsung di kode, bukan Script Properties.
// Ganti placeholder ini dengan API key LIVE yang baru (jangan bagikan kode berisi key).
const STAYING_API_KEY = "stay_live_wwIH8ZpzK8OZAxT89RWQ4MEpIunm35XGC75v55NwjZs";
const STAYING_API_BASE = "https://api.stayingapi.com";

/* ============================================================
 * 1. FUNGSI UTAMA CHAT eNCIK
 * ============================================================ */

function processEncikAiChat(
  userMessage,
  userId,
  liveContext,
  conversationHistory,
) {
  const props = PropertiesService.getScriptProperties();
  const provider = (props.getProperty("AI_PROVIDER") || "groq")
    .trim()
    .toLowerCase();

  if (!userMessage || !String(userMessage).trim()) {
    return {
      status: "error",
      reply: "Boleh tulis pertanyaannya dulu, Cik.",
    };
  }

  const message = String(userMessage).trim();

  // Deteksi rute dan tanggal dari pesan pengguna.
  const routeInfo = extractRouteFromMessage_(message);
  const flightDates = extractEncikFlightDates_(message);

  // Deteksi apakah pengguna sedang mencari tiket/penerbangan.
  const isFlightSearch = isEncikFlightSearch_(message);

  // Deteksi pencarian akomodasi/hotel.
  const isHotelSearch = isEncikHotelSearch_(message);
  const hotelRequest = isHotelSearch
    ? extractEncikHotelRequest_(message)
    : null;
  const hotelResult = isHotelSearch
    ? fetchStayingApiHotels_(hotelRequest)
    : null;

  // Jika pengguna meminta tiket, siapkan data pencarian.
  let flightData = null;

  if (isFlightSearch) {
    flightData = fetchTravelpayoutsDeals(
      routeInfo.origin,
      routeInfo.destination,
      flightDates.departureDate,
      flightDates.returnDate,
    );
  }

  const compactMetar =
    props.getProperty("LATEST_METAR_DATA") ||
    "Data METAR belum tersedia pada cache server.";

  const compactFlight =
    props.getProperty("LATEST_FLIGHT_DATA") ||
    "Ringkasan penerbangan belum tersedia pada cache server.";

  // Ambil jadwal penerbangan langsung dari Aviationstack untuk pertanyaan jadwal.
  // Fungsi ini berasal dari modul jadwal Aviationstack yang disediakan.
  const airportScheduleContext = encikBuildAirportScheduleContext_(message);

  const contextFromBrowser = compactEncikText_(liveContext, 3500);

  let flightContext = "Pengguna tidak sedang meminta pencarian tiket pesawat.";

  if (isFlightSearch) {
    flightContext = JSON.stringify(
      {
        route: routeInfo,
        dates: flightDates,
        flightData: flightData,
      },
      null,
      2,
    );
  }

  const sskDestinationContext = extractSskDestinationNames_(compactFlight);

  const hotelContext = isHotelSearch
    ? buildEncikHotelContext_(hotelRequest, hotelResult)
    : "Pengguna tidak sedang meminta pencarian hotel.";

  const dateInstruction = buildEncikDateInstruction_(
    flightDates,
    isFlightSearch,
  );

  const systemInstruction = `
Kamu adalah eNCIK, asisten AI yang ramah untuk dashboard Flight Radar
Stasiun Meteorologi Sultan Syarif Kasim II Pekanbaru (WIBB/PKU).

GAYA JAWAB:
1. Jawab dalam Bahasa Indonesia yang santai, ramah, sopan, dan to the point.
2. Sapaan "Cik" atau "Sobat" gunakan seperlunya.
3. Hindari tabel Markdown. Gunakan poin-poin.
4. Jawaban harus mudah dipahami dan tidak bertele-tele.

ATURAN INFORMASI PENERBANGAN:
1. Jangan mengarang harga, jadwal, nomor penerbangan, atau ketersediaan kursi.
2. Bedakan data estimasi dengan data penerbangan aktual.
3. Jika data harga tidak tersedia, sampaikan bahwa harga perlu diperiksa langsung.
4. Untuk pencarian tiket, arahkan pengguna hanya ke Google Flights.
5. Jangan menampilkan tautan Tiket.com, Traveloka, Trip.com, atau Aviasales.
6. Jangan mengubah atau mengarang tautan Google Flights yang diberikan sistem.
7. Jika tanggal belum disebutkan, jangan mengarang tanggal keberangkatan.
8. Jika tanggal tidak valid atau ambigu, minta pengguna memperjelas tanggalnya.
9. Jika pengguna menyebut tanggal pulang, gunakan tanggal tersebut sebagai tanggal kembali.
10. Ketersediaan kursi dan harga akhir harus diperiksa langsung di Google Flights.

ATURAN FORMAT LINK:
- Gunakan tag HTML <a> untuk tautan.
- Jangan memecah URL dengan baris baru.
- Jangan mengubah karakter URL.
- Tautan Google Flights akan ditambahkan oleh backend setelah jawaban AI selesai.

ATURAN PENCARIAN HOTEL:
1. Gunakan hanya data hotel yang diberikan pada DATA PENCARIAN HOTEL.
2. Jangan mengarang nama hotel, harga, rating, fasilitas, atau tautan.
3. Jika status pencarian pending, jelaskan bahwa hasil masih diproses dan belum tersedia.
4. Jika hasil kosong/gagal, sampaikan apa adanya. Harga mengikuti mata uang dan data API.
5. Tampilkan nama hotel/penginapan persis sesuai field "name" dari StayingAPI.
6.  Dilarang mengganti, menerjemahkan, meringkas, atau membuat nama hotel sendiri.
7. Jangan menggunakan nama generik seperti "Guest House", "Hotel A", atau "Akomodasi".

ATURAN CUACA DAN RADAR:
1. METAR adalah observasi cuaca.
2. TAF adalah prakiraan cuaca.
3. Jangan mengarang data METAR, TAF, radar, atau status pesawat.
4. Informasi bukan pengganti instruksi resmi ATC, NOTAM, atau briefing keselamatan.

ATURAN KOREKSI JAWABAN:
- Periksa relevansi jawaban terhadap pertanyaan.
- Periksa akurasi fakta berdasarkan konteks yang tersedia.
- Periksa kelengkapan jawaban.
- Jangan menambahkan fakta yang tidak tersedia.
- Jika informasi tidak cukup, jelaskan keterbatasannya.

KONTEKS TANGGAL PENCARIAN:
${dateInstruction}

DATA PENCARIAN PENERBANGAN:
${compactEncikText_(flightContext, 3500)}

DATA PENCARIAN HOTEL:
ATURAN PENCARIAN HOTEL:
- StayingAPI hanya gunakan platform Booking.com, jangan Airbnb.
- Jangan kirim atau meminta tanggal check-in/check-out untuk pencarian katalog hotel.
- Nama hotel harus persis dari field name; jangan membuat nama generik atau mengubah nama.
- Tampilkan hanya data yang benar-benar dikembalikan API. Harga/rating yang kosong disebut belum tersedia.
- Kota tujuan penerbangan SSK II berasal dari konteks cache; jangan mengarang kota tujuan.
DATA HOTEL:
${hotelContext}

DATA JADWAL PENERBANGAN SSK II (AVIATIONSTACK):
${airportScheduleContext || "Pertanyaan ini bukan tentang jadwal penerbangan."}

DATA CACHE SERVER:
METAR/TAF:
${compactEncikText_(compactMetar, 900)}

Ringkasan Radar/Penerbangan:
${compactEncikText_(compactFlight, 900)}

KOTA TUJUAN PENERBANGAN SSK II YANG TERBACA DARI CACHE:
${sskDestinationContext}

KONTEKS LANGSUNG DASHBOARD:
${contextFromBrowser || "Konteks dashboard langsung tidak dikirim."}
`;

  let result;

  if (provider === "gemini") {
    result = processGeminiChat_(
      message,
      systemInstruction,
      conversationHistory,
      props,
    );
  } else {
    result = processGroqChat_(
      message,
      systemInstruction,
      conversationHistory,
      props,
    );
  }

  // Untuk pertanyaan tiket umum dari Pekanbaru tanpa kota tujuan,
  // tampilkan daftar kota tujuan berdasarkan penerbangan keberangkatan
  // yang benar-benar dikembalikan Aviationstack. Setiap rute punya link Google Flights.
  if (
    result &&
    result.status === "success" &&
    isFlightSearch &&
    routeInfo.origin === "PKU" &&
    !routeInfo.destination
  ) {
    result.reply = buildEncikPkuTicketDestinationList_(flightDates);
  } else if (result && result.status === "success" && isFlightSearch) {
    // Jika tujuan sudah disebut, langsung tampilkan link untuk rute tersebut.
    result.reply = appendEncikFlightLinks_(
      result.reply,
      routeInfo,
      flightDates,
      flightData,
    );
  }

  // Jika pencarian hotel masih berjalan, jangan biarkan AI menyatakan hasil sudah ada.
  if (
    result &&
    result.status === "success" &&
    isHotelSearch &&
    hotelResult &&
    hotelResult.status === "pending"
  ) {
    result.reply =
      "Pencarian hotel di " +
      hotelRequest.location +
      " masih diproses oleh StayingAPI. Hasilnya belum tersedia. Coba tanyakan kembali dalam beberapa saat.";
  }

  return result;
}

/* ============================================================
 * 2. INTEGRASI STAYINGAPI — PENCARIAN HOTEL
 * ============================================================ */

function isEncikHotelSearch_(text) {
  const value = String(text || "").toLowerCase();
  return /hotel|penginapan|akomodasi|airbnb|booking\.com|cari\s+(?:tempat\s+)?menginap|tempat\s+tidur|homestay|villa|resort/.test(
    value,
  );
}

function extractEncikHotelRequest_(text) {
  const value = String(text || "");
  const lower = value.toLowerCase();
  let location = "";

  // Kenali kota yang umum muncul sebagai tujuan penerbangan SSK II.
  const knownPlaces = [
    "Pekanbaru",
    "Jakarta",
    "Bandung",
    "Surabaya",
    "Medan",
    "Padang",
    "Batam",
    "Yogyakarta",
    "Jogja",
    "Bali",
    "Denpasar",
    "Malang",
    "Bogor",
    "Palembang",
    "Makassar",
    "Semarang",
    "Lombok",
    "Bengkulu",
    "Dumai",
    "Bukittinggi",
    "Solo",
    "Depok",
    "Tangerang",
    "Bekasi",
    "Gunungsitoli",
    "Jambi",
    "Tanjung Pinang",
    "Kuala Lumpur",
  ];
  for (let i = 0; i < knownPlaces.length; i++) {
    if (lower.indexOf(knownPlaces[i].toLowerCase()) !== -1) {
      location = knownPlaces[i];
      break;
    }
  }

  if (!location) {
    const match = value.match(
      /(?:hotel|penginapan|akomodasi|booking|menginap|di)\s+(?:di|untuk|ke)?\s*([A-Za-zÀ-ÿ .'-]{2,45})/i,
    );
    if (match) location = match[1].replace(/[?.!,].*$/, "").trim();
  }

  const adultsMatch = lower.match(/(\d+)\s*(?:orang|dewasa|tamu)/);
  const adults = adultsMatch
    ? Math.max(1, Math.min(16, parseInt(adultsMatch[1], 10)))
    : 2;

  // Pencarian katalog hotel tidak memakai tanggal check-in/check-out.
  return {
    location: location,
    adults: adults,
    platforms: "booking",
    limit: 10,
  };
}

function buildEncikHotelContext_(request, result) {
  if (!request || !request.location) {
    return (
      "Pengguna meminta informasi hotel tetapi belum menyebut kota. Minta pengguna memilih kota dari daftar tujuan penerbangan SSK II berikut: " +
      extractSskDestinationNames_(
        PropertiesService.getScriptProperties().getProperty(
          "LATEST_FLIGHT_DATA",
        ) || "",
      )
    );
  }
  if (!result) return "Data pencarian hotel tidak tersedia.";
  if (result.status === "pending") {
    return (
      "STATUS: pending. Job ID: " +
      (result.jobId || "-") +
      ". Lokasi: " +
      (request.location || "tidak disebutkan") +
      ". Hasil belum tersedia; jangan membuat daftar hotel."
    );
  }
  if (result.status !== "success") {
    return (
      "Pencarian hotel gagal: " +
      compactEncikText_(result.message || "Tidak ada detail error.", 500)
    );
  }
  const rows = (result.hotels || []).map(function (h, i) {
    return {
      nomor: i + 1,
      nama: h.name || "Nama tidak tersedia",
      platform: h.platform || "",
      lokasi: h.city || request.location,
      negara: h.country || "",
      rating: h.guestRating || h.starRating || null,
      harga: h.price || null,
      url: h.url || "",
    };
  });
  return JSON.stringify(
    { status: "success", location: request.location, hotels: rows },
    null,
    2,
  ).substring(0, 4500);
}

function fetchStayingApiHotels_(request) {
  const key = String(STAYING_API_KEY || "").trim();
  if (!key || key.indexOf("TEMPEL_") === 0) {
    return {
      status: "error",
      message:
        "STAYING_API_KEY belum diisi langsung pada konstanta AiService.gs.",
    };
  }
  if (key.indexOf("stay_live_") !== 0) {
    return {
      status: "error",
      message: "Gunakan API key StayingAPI Live (awalan stay_live_).",
    };
  }
  if (!request || !request.location) {
    return {
      status: "error",
      message:
        "Lokasi hotel belum disebutkan. Minta pengguna menyebutkan kota tujuan.",
    };
  }

  const params = [
    "location=" + encodeURIComponent(request.location),
    "platforms=" + encodeURIComponent("booking"),
    "limit=" + encodeURIComponent(String(request.limit || 5)),
    "adults=" + encodeURIComponent(String(request.adults || 2)),
    "currency=IDR",
  ];
  if (request.checkIn && request.checkOut) {
    params.push("checkIn=" + encodeURIComponent(request.checkIn));
    params.push("checkOut=" + encodeURIComponent(request.checkOut));
  }

  try {
    const response = UrlFetchApp.fetch(
      STAYING_API_BASE + "/v1/search?" + params.join("&"),
      {
        method: "get",
        headers: { Authorization: "Bearer " + key, Accept: "application/json" },
        muteHttpExceptions: true,
      },
    );
    const code = response.getResponseCode();
    const raw = response.getContentText();
    let body = {};
    try {
      body = JSON.parse(raw);
    } catch (e) {
      body = {};
    }

    if (
      code === 202 ||
      (body.data && body.data.jobId) ||
      body.status === "pending" ||
      (body.data && body.data.status === "pending")
    ) {
      const jobId =
        body.data && body.data.jobId
          ? body.data.jobId
          : body.jobId || (body.data && body.data.job && body.data.job.id);
      if (!jobId)
        return {
          status: "pending",
          message: "API mengembalikan 202 tanpa jobId.",
        };
      return pollStayingApiJob_(jobId);
    }
    if (code < 200 || code >= 300) {
      Logger.log("StayingAPI HTTP " + code + ": " + raw.substring(0, 2000));
      return {
        status: "error",
        message:
          "StayingAPI HTTP " +
          code +
          ": " +
          compactEncikText_(body.error || body.message || raw, 400),
      };
    }
    if (
      body.sandbox === true ||
      (body.meta && body.meta.sandbox === true) ||
      (body.meta && body.meta.environment === "sandbox")
    ) {
      return {
        status: "error",
        message: "Respons berasal dari Sandbox, bukan data Live.",
      };
    }
    return {
      status: "success",
      hotels: Array.isArray(body.data) ? body.data.slice(0, 5) : [],
      meta: body.meta || {},
    };
  } catch (error) {
    Logger.log("StayingAPI connection error: " + error);
    return { status: "error", message: String(error) };
  }
}

function pollStayingApiJob_(jobId) {
  // Polling singkat agar Apps Script tidak menunggu terlalu lama. Poll gratis menurut dokumentasi.
  for (let attempt = 0; attempt < 5; attempt++) {
    Utilities.sleep(2000);
    try {
      const response = UrlFetchApp.fetch(
        STAYING_API_BASE + "/v1/jobs/" + encodeURIComponent(jobId),
        {
          method: "get",
          headers: {
            Authorization: "Bearer " + STAYING_API_KEY,
            Accept: "application/json",
          },
          muteHttpExceptions: true,
        },
      );
      const code = response.getResponseCode();
      const raw = response.getContentText();
      let body = {};
      try {
        body = JSON.parse(raw);
      } catch (e) {
        body = {};
      }
      if (code < 200 || code >= 300) {
        Logger.log(
          "StayingAPI job HTTP " + code + ": " + raw.substring(0, 1000),
        );
        return {
          status: "error",
          message: "Pengecekan job StayingAPI gagal (HTTP " + code + ").",
        };
      }
      const data = body.data || body;
      if (data.status === "completed") {
        const result = data.result || {};
        return {
          status: "success",
          hotels: Array.isArray(result.data)
            ? result.data.slice(0, 5)
            : Array.isArray(result)
              ? result.slice(0, 5)
              : [],
          meta: result.meta || body.meta || {},
        };
      }
      if (data.status === "failed" || data.status === "error") {
        return {
          status: "error",
          message: data.error || data.message || "Job pencarian hotel gagal.",
        };
      }
    } catch (error) {
      Logger.log("StayingAPI polling error: " + error);
    }
  }
  return { status: "pending", jobId: jobId };
}

function extractSskDestinationNames_(raw) {
  const text = String(raw || "");
  if (!text) return "Data tujuan penerbangan SSK II belum tersedia di cache.";
  let values = [];
  try {
    const parsed = JSON.parse(text);
    const seen = {};
    function walk(node, depth) {
      if (!node || depth > 8) return;
      if (Array.isArray(node)) {
        node.forEach(function (x) {
          walk(x, depth + 1);
        });
        return;
      }
      if (typeof node !== "object") return;
      Object.keys(node).forEach(function (k) {
        const v = node[k];
        if (
          /destination|arrival.?city|kota.?tujuan|tujuan/i.test(k) &&
          typeof v === "string"
        ) {
          const name = v.trim();
          if (name && name.length < 70 && !seen[name.toLowerCase()]) {
            seen[name.toLowerCase()] = true;
            values.push(name);
          }
        }
        if (typeof v === "object") walk(v, depth + 1);
      });
    }
    walk(parsed, 0);
  } catch (e) {
    // Cache bukan JSON; coba ekstraksi label tujuan sederhana.
    const matches =
      text.match(
        /(?:destination|arrivalCity|tujuan)\s*["']?\s*[:=]\s*["']([^"']+)/gi,
      ) || [];
    values = matches.map(function (x) {
      return x.split(/[:=]/).pop().replace(/["']/g, "").trim();
    });
  }
  return values.length
    ? values.slice(0, 40).join(", ")
    : "Nama kota tujuan belum dapat dibaca dari cache penerbangan.";
}

function compactEncikText_(value, maxLength) {
  let text = String(value == null ? "" : value);
  text = text.replace(/\s+/g, " ").trim();
  return text.length > maxLength ? text.substring(0, maxLength) + "…" : text;
}

function testStayingApiLive() {
  const result = fetchStayingApiHotels_({
    location: "Pekanbaru, Indonesia",
    platforms: "booking",
    limit: 10,
  });
  const hotels = result && Array.isArray(result.hotels) ? result.hotels : [];
  Logger.log(
    JSON.stringify(
      {
        status: result.status,
        total: hotels.length,
        platforms: [
          ...new Set(
            hotels.map(function (h) {
              return h.platform;
            }),
          ),
        ],
        hotels: hotels.map(function (h) {
          return {
            name: h.name || null,
            platform: h.platform || null,
            location: h.location || null,
            rating: h.guestRating || h.starRating || null,
            price: h.price || null,
            url: h.url || null,
          };
        }),
        meta: result.meta || null,
        message: result.message || null,
      },
      null,
      2,
    ),
  );
  return result;
}

/* ============================================================
 * 3. DETEKSI PERTANYAAN PENCARIAN TIKET
 * ============================================================ */

function isEncikFlightSearch_(text) {
  // Hanya permintaan tiket/harga/pemesanan yang masuk alur pencarian tiket.
  // Pertanyaan jadwal tetap ditangani oleh Aviationstack secara terpisah.
  const value = String(text || "").toLowerCase();

  return /\b(tiket|harga tiket|cari tiket|carikan tiket|booking tiket|pesan tiket|pemesanan tiket|beli tiket|harga pesawat|tiket pesawat)\b/.test(
    value,
  );
}

/* ============================================================
 * 3. DETEKSI RUTE BANDARA
 * ============================================================ */

function extractRouteFromMessage_(text) {
  const value = String(text || "").toUpperCase();

  const airports = {
    PEKANBARU: "PKU",
    PKU: "PKU",
    "SULTAN SYARIF KASIM": "PKU",

    JAKARTA: "CGK",
    "SOEKARNO HATTA": "CGK",
    "SOEKARNO-HATTA": "CGK",
    CGK: "CGK",

    HALIM: "HLP",
    HLP: "HLP",

    BATAM: "BTH",
    BTH: "BTH",

    MEDAN: "KNO",
    KUALANAMU: "KNO",
    KNO: "KNO",

    SURABAYA: "SUB",
    SUB: "SUB",

    BALI: "DPS",
    DENPASAR: "DPS",
    DPS: "DPS",

    JOGJA: "YIA",
    YOGYAKARTA: "YIA",
    YIA: "YIA",

    PADANG: "PDG",
    PDG: "PDG",

    "KUALA LUMPUR": "KUL",
    KUL: "KUL",

    SINGAPURA: "SIN",
    SINGAPORE: "SIN",
    SIN: "SIN",
  };

  let origin = "";
  let destination = "";

  // Prioritaskan pola rute eksplisit: BTH ke KNO, PKU-KNO, dan sebagainya.
  const routeMatch = value.match(
    /\b(PKU|BTH|KNO|CGK|HLP|SUB|DPS|YIA|PDG|KUL|SIN)\b\s*(?:KE|MENUJU|[-→])\s*\b(PKU|BTH|KNO|CGK|HLP|SUB|DPS|YIA|PDG|KUL|SIN)\b/,
  );

  if (routeMatch) {
    return {
      origin: routeMatch[1],
      destination: routeMatch[2],
      detected: true,
    };
  }

  // Cari nama/kode bandara yang muncul dalam pesan.
  const found = [];

  Object.keys(airports).forEach(function (name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp("\\b" + escaped + "\\b", "i");

    if (regex.test(value)) {
      const code = airports[name];

      if (found.indexOf(code) === -1) {
        found.push(code);
      }
    }
  });

  if (found.length >= 2) {
    origin = found[0];
    destination = found[1];
  } else if (found.length === 1) {
    // Jika hanya tujuan disebutkan, gunakan PKU sebagai bandara asal.
    if (found[0] === "PKU") {
      origin = "PKU";
      destination = "";
    } else {
      origin = "PKU";
      destination = found[0];
    }
  }

  return {
    origin: origin,
    destination: destination,
    detected: Boolean(origin && destination),
  };
}

/* ============================================================
 * 4. WAKTU DAN FORMAT TANGGAL
 * ============================================================ */

function getEncikToday_() {
  const todayText = Utilities.formatDate(
    new Date(),
    "Asia/Jakarta",
    "yyyy-MM-dd",
  );

  const parts = todayText.split("-");

  return new Date(
    Number(parts[0]),
    Number(parts[1]) - 1,
    Number(parts[2]),
    12,
    0,
    0,
  );
}

function encikFormatDate_(date) {
  return Utilities.formatDate(date, "Asia/Jakarta", "yyyy-MM-dd");
}

function encikAddDays_(date, days) {
  const result = new Date(date.getTime());
  result.setDate(result.getDate() + days);
  return result;
}

function encikIsValidDate_(year, month, day) {
  const date = new Date(year, month - 1, day, 12, 0, 0);

  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

/* ============================================================
 * 5. PARSER TANGGAL INDONESIA
 * Mendukung:
 * - hari ini
 * - besok
 * - lusa
 * - 2026-11-03
 * - 03/11/2026
 * - 03-11-2026
 * - 3 November 2026
 * - Jumat depan
 * ============================================================ */

function encikParseOneDate_(text) {
  const value = String(text || "")
    .toLowerCase()
    .replace(/,/g, " ")
    .trim();

  if (!value) return null;

  const today = getEncikToday_();

  if (/\bhari ini\b|\bsekarang\b/.test(value)) {
    return encikFormatDate_(today);
  }

  if (/\bbesok\b|\besok\b/.test(value)) {
    return encikFormatDate_(encikAddDays_(today, 1));
  }

  if (/\blusa\b/.test(value)) {
    return encikFormatDate_(encikAddDays_(today, 2));
  }

  // Format ISO: YYYY-MM-DD
  let match = value.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);

  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    if (!encikIsValidDate_(year, month, day)) return null;

    return encikFormatDate_(new Date(year, month - 1, day, 12, 0, 0));
  }

  // Format DD/MM/YYYY atau DD-MM-YYYY
  match = value.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})\b/);

  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);

    if (!encikIsValidDate_(year, month, day)) return null;

    return encikFormatDate_(new Date(year, month - 1, day, 12, 0, 0));
  }

  // Format DD/MM tanpa tahun.
  match = value.match(/\b(\d{1,2})[\/-](\d{1,2})\b/);

  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);

    let year = today.getFullYear();

    if (!encikIsValidDate_(year, month, day)) return null;

    let date = new Date(year, month - 1, day, 12, 0, 0);

    // Jika tanggal sudah lewat, gunakan tahun berikutnya.
    if (date < today) {
      year++;
      if (!encikIsValidDate_(year, month, day)) return null;
      date = new Date(year, month - 1, day, 12, 0, 0);
    }

    return encikFormatDate_(date);
  }

  // Nama bulan Indonesia.
  const months = {
    januari: 1,
    jan: 1,
    februari: 2,
    feb: 2,
    maret: 3,
    mar: 3,
    april: 4,
    apr: 4,
    mei: 5,
    juni: 6,
    jun: 6,
    juli: 7,
    jul: 7,
    agustus: 8,
    agu: 8,
    agustus: 8,
    september: 9,
    sep: 9,
    oktober: 10,
    okt: 10,
    november: 11,
    nov: 11,
    desember: 12,
    des: 12,
  };

  const monthPattern = Object.keys(months).join("|");

  match = value.match(
    new RegExp(
      "\\b(\\d{1,2})\\s+(" + monthPattern + ")(?:\\s+(20\\d{2}))?\\b",
      "i",
    ),
  );

  if (match) {
    const day = Number(match[1]);
    const month = months[match[2].toLowerCase()];
    let year = match[3] ? Number(match[3]) : today.getFullYear();

    if (!encikIsValidDate_(year, month, day)) return null;

    let date = new Date(year, month - 1, day, 12, 0, 0);

    if (!match[3] && date < today) {
      year++;
      if (!encikIsValidDate_(year, month, day)) return null;
      date = new Date(year, month - 1, day, 12, 0, 0);
    }

    return encikFormatDate_(date);
  }

  // Deteksi nama hari.
  const weekdays = {
    minggu: 0,
    senin: 1,
    selasa: 2,
    rabu: 3,
    kamis: 4,
    jumat: 5,
    "jum'at": 5,
    sabtu: 6,
  };

  const weekdayPattern = Object.keys(weekdays)
    .map(function (day) {
      return day.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("|");

  match = value.match(
    new RegExp(
      "\\b(" + weekdayPattern + ")(?:\\s+(depan|minggu depan))?\\b",
      "i",
    ),
  );

  if (match) {
    const requestedDay = weekdays[match[1].toLowerCase()];
    const currentDay = today.getDay();

    let difference = (requestedDay - currentDay + 7) % 7;

    if (difference === 0 && match[2]) {
      difference = 7;
    } else if (difference === 0) {
      difference = 0;
    } else if (match[2]) {
      difference += 7;
    }

    return encikFormatDate_(encikAddDays_(today, difference));
  }

  return null;
}

/* ============================================================
 * 6. DETEKSI TANGGAL BERANGKAT DAN PULANG
 * ============================================================ */

function extractEncikFlightDates_(text) {
  const original = String(text || "");
  const lower = original.toLowerCase();

  const returnMarker = /\b(pulang|kembali|return|returning)\b/i;
  const markerMatch = returnMarker.exec(original);

  let departureText = original;
  let returnText = "";

  if (markerMatch) {
    departureText = original.substring(0, markerMatch.index);
    returnText = original.substring(markerMatch.index + markerMatch[0].length);
  }

  const departureDate = encikParseOneDate_(departureText);

  let returnDate = returnText ? encikParseOneDate_(returnText) : null;

  // Jika tanggal keberangkatan dan kepulangan sama-sama disebutkan,
  // pastikan tanggal pulang tidak lebih awal dari tanggal berangkat.
  let dateError = false;
  let dateErrorMessage = "";

  if (returnMarker.test(lower) && !returnDate) {
    dateError = true;
    dateErrorMessage =
      "Tanggal pulang belum terbaca. Mohon tuliskan tanggal pulang dengan jelas.";
  }

  if (returnDate && !departureDate) {
    dateError = true;
    dateErrorMessage =
      "Tanggal keberangkatan belum terbaca. Mohon tuliskan tanggal keberangkatan.";
  }

  if (departureDate && returnDate && returnDate < departureDate) {
    dateError = true;
    dateErrorMessage =
      "Tanggal pulang tidak boleh lebih awal dari tanggal keberangkatan.";
  }

  const hasDateRequest =
    /\b(tanggal|tgl|hari ini|besok|esok|lusa|senin|selasa|rabu|kamis|jumat|jum'at|sabtu|minggu|berangkat|pulang|kembali|return)\b/i.test(
      original,
    ) ||
    /\b20\d{2}-\d{1,2}-\d{1,2}\b/.test(original) ||
    /\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/.test(original) ||
    /\b\d{1,2}\s+(januari|jan|februari|feb|maret|mar|april|apr|mei|juni|jun|juli|jul|agustus|agu|september|sep|oktober|okt|november|nov|desember|des)\b/i.test(
      original,
    );

  if (hasDateRequest && !departureDate && !dateError) {
    dateError = true;
    dateErrorMessage =
      "Tanggal keberangkatan belum dapat dibaca. Contoh format: 3 November 2026 atau 03/11/2026.";
  }

  return {
    departureDate: departureDate,
    returnDate: returnDate,
    hasDateRequest: hasDateRequest,
    dateError: dateError,
    dateErrorMessage: dateErrorMessage,
  };
}

/* ============================================================
 * 7. PEMBUAT URL GOOGLE FLIGHTS
 *
 * FORMAT:
 * https://www.google.com/travel/flights?q=Flights+from+BTH+to+KNO+on+2026-11-03+one+way&hl=id&utm_source=chatgpt.com
 *
 * Parameter q menggunakan tanda + untuk pemisah kata.
 * ============================================================ */

/**
 * MEMBUAT LINK GOOGLE FLIGHTS
 * Format harus mempertahankan parameter q, hl, dan utm_source.
 */
function buildGoogleFlightsUrl_(
  origin,
  destination,
  departureDate,
  returnDate,
) {
  origin = String(origin || "")
    .trim()
    .toUpperCase();
  destination = String(destination || "")
    .trim()
    .toUpperCase();

  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination)) {
    return "";
  }

  // Format dasar harus seperti contoh yang diberikan.
  let query = "Flights from " + origin + " to " + destination;

  if (departureDate) {
    query += " on " + departureDate;
  }

  if (returnDate) {
    query += " returning " + returnDate;
  } else if (departureDate) {
    query += " one way";
  }

  // Encode spasi menjadi tanda +, bukan menghilangkan parameter q.
  const encodedQuery = encodeURIComponent(query).replace(/%20/g, "+");

  return (
    "https://www.google.com/travel/flights?q=" +
    encodedQuery +
    "&hl=id&utm_source=chatgpt.com"
  );
}

/* ============================================================
 * 9. TRAVELPAYOUTS — DATA ESTIMASI HARGA
 *
 * API ini tidak dipakai untuk membuat URL Google Flights.
 * API hanya memberikan data harga estimasi jika token tersedia.
 * ============================================================ */

function fetchTravelpayoutsDeals(
  origin,
  destination,
  departureDate,
  returnDate,
) {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty("TRAVELPAYOUTS_TOKEN");

  const result = {
    origin: origin,
    destination: destination,
    departureDate: departureDate || null,
    returnDate: returnDate || null,
    estimatedPrices: [],
    message: "",
  };

  if (!origin || !destination) {
    result.message =
      "Rute belum lengkap. Mohon sebutkan bandara asal dan tujuan.";
    return result;
  }

  if (!token) {
    result.message =
      "Data estimasi harga Travelpayouts belum tersedia karena token belum dikonfigurasi.";
    return result;
  }

  const apiUrl =
    "https://api.travelpayouts.com/v1/prices/cheap" +
    "?origin=" +
    encodeURIComponent(origin) +
    "&destination=" +
    encodeURIComponent(destination) +
    "&currency=idr";

  try {
    const response = UrlFetchApp.fetch(apiUrl, {
      method: "get",
      headers: {
        "x-access-token": token,
      },
      muteHttpExceptions: true,
    });

    const status = response.getResponseCode();

    if (status < 200 || status >= 300) {
      result.message =
        "Data estimasi harga belum berhasil diperoleh (HTTP " + status + ").";
      return result;
    }

    const json = JSON.parse(response.getContentText() || "{}");

    if (json.success && json.data && json.data[destination]) {
      const destinationData = json.data[destination];
      const keys = Object.keys(destinationData).slice(0, 5);

      keys.forEach(function (key) {
        const item = destinationData[key];

        if (!item) return;

        result.estimatedPrices.push({
          price: Number(item.price || 0),
          currency: "IDR",
          flightNumber: item.flight_number || "",
          departureAt: item.departure_at || "",
        });
      });
    }

    if (result.estimatedPrices.length) {
      result.message =
        "Estimasi harga berhasil diperoleh dari Travelpayouts. Data ini bukan jaminan harga dan ketersediaan kursi pada tanggal yang dipilih.";
    } else {
      result.message = "Belum ada data estimasi harga untuk rute tersebut.";
    }
  } catch (error) {
    Logger.log("Travelpayouts error: " + error);
    result.message = "Terjadi kendala saat mengambil estimasi harga.";
  }

  return result;
}

/* ============================================================
 * 10. PETUNJUK TANGGAL UNTUK AI
 * ============================================================ */

function buildEncikDateInstruction_(dates, isFlightSearch) {
  if (!isFlightSearch) {
    return "Tidak ada pencarian tiket yang diminta.";
  }

  if (dates.dateError) {
    return (
      "Tanggal bermasalah: " +
      dates.dateErrorMessage +
      " Jangan membuat tautan pencarian sebelum tanggal diperjelas."
    );
  }

  if (!dates.hasDateRequest) {
    return "Pengguna belum menyebut tanggal. Jangan mengarang tanggal. Tautan Google Flights dapat dibuat tanpa tanggal.";
  }

  return [
    "Tanggal keberangkatan: " + (dates.departureDate || "Belum terbaca"),
    "Tanggal kepulangan: " + (dates.returnDate || "Tidak diminta"),
    "Gunakan tanggal tersebut secara tepat.",
    "Jangan mengubah tanggal atau menebak tanggal lain.",
  ].join("\n");
}

/* ============================================================
 * 11. MENAMBAHKAN TAUTAN KE JAWABAN AI
 * ============================================================ */

function appendEncikFlightLinks_(aiReply, routeInfo, dates, flightData) {
  let reply = String(aiReply || "").trim();

  if (!routeInfo || !routeInfo.origin || !routeInfo.destination) {
    return reply + "\n\nMohon sebutkan bandara asal dan tujuan penerbangan.";
  }

  if (dates && dates.dateError) {
    return reply + "\n\n" + escapeEncikHtml_(dates.dateErrorMessage);
  }

  const googleUrl = buildGoogleFlightsUrl_(
    routeInfo.origin,
    routeInfo.destination,
    dates ? dates.departureDate : null,
    dates ? dates.returnDate : null,
  );

  if (!googleUrl) return reply;

  let section = "\n\n";
  section += "<p><strong>PENCARIAN TIKET PESAWAT</strong></p>";

  section +=
    "<p>Rute: <strong>" +
    escapeEncikHtml_(routeInfo.origin) +
    " → " +
    escapeEncikHtml_(routeInfo.destination) +
    "</strong></p>";

  if (dates && dates.departureDate) {
    section +=
      "<p>Tanggal berangkat: <strong>" +
      escapeEncikHtml_(dates.departureDate) +
      "</strong></p>";
  }

  if (dates && dates.returnDate) {
    section +=
      "<p>Tanggal pulang: <strong>" +
      escapeEncikHtml_(dates.returnDate) +
      "</strong></p>";
  }

  // Link Google Flights harus menggunakan URL lengkap.
  section +=
    '<p><a href="' +
    escapeEncikHtml_(googleUrl) +
    '" target="_blank" rel="noopener noreferrer">' +
    "BUKA GOOGLE FLIGHTS" +
    "</a></p>";

  return reply + section;
}

/* ============================================================
 * DAFTAR RUTE TIKET DARI PEKANBARU
 * Sumber daftar tujuan: jadwal keberangkatan Aviationstack.
 * Link pencarian setiap rute: Google Flights.
 * ============================================================ */
function buildEncikPkuTicketDestinationList_(dates) {
  var intro =
    "Ini daftar tujuan penerbangan dari Pekanbaru (PKU) yang terbaca dari data jadwal Aviationstack. Pilih tujuan untuk melihat pilihan tiket di Google Flights.";

  if (dates && dates.dateError) {
    return intro + "\n\n" + dates.dateErrorMessage;
  }

  var schedule;
  try {
    schedule = encikGetAirportScheduleData_(false);
  } catch (error) {
    return (
      intro +
      "\n\nMaaf, data tujuan penerbangan belum berhasil diambil. Coba lagi beberapa saat lagi."
    );
  }

  var flights =
    schedule && Array.isArray(schedule.departure) ? schedule.departure : [];
  var destinations = {};

  flights.forEach(function (flight) {
    var code = String(flight.destinationIata || "")
      .trim()
      .toUpperCase();
    var name = String(flight.destination || "").trim();
    if (!/^[A-Z]{3}$/.test(code) || code === "PKU") return;
    if (!destinations[code]) {
      destinations[code] = { code: code, name: name || code };
    }
  });

  var list = Object.keys(destinations)
    .sort()
    .map(function (code) {
      var item = destinations[code];
      var url = buildGoogleFlightsUrl_(
        "PKU",
        item.code,
        dates ? dates.departureDate : null,
        dates ? dates.returnDate : null,
      );
      return (
        "<li><strong>PKU → " +
        escapeEncikHtml_(item.code) +
        " (" +
        escapeEncikHtml_(item.name) +
        ")</strong><br>" +
        '<a href="' +
        escapeEncikHtml_(url) +
        '" target="_blank" rel="noopener noreferrer">Cek Tiket di Google Flights</a></li>'
      );
    });

  if (!list.length) {
    return (
      intro +
      "\n\nBelum ada daftar kota tujuan yang berhasil dibaca dari data keberangkatan Aviationstack. Data kosong bukan berarti tidak ada penerbangan. Silakan coba lagi nanti."
    );
  }

  var output = "<p>" + escapeEncikHtml_(intro) + "</p>";
  if (dates && dates.departureDate) {
    output +=
      "<p>Tanggal berangkat: <strong>" +
      escapeEncikHtml_(dates.departureDate) +
      "</strong></p>";
  }
  if (dates && dates.returnDate) {
    output +=
      "<p>Tanggal pulang: <strong>" +
      escapeEncikHtml_(dates.returnDate) +
      "</strong></p>";
  }
  output += "<ol>" + list.join("") + "</ol>";
  output +=
    "<p>Harga dan ketersediaan kursi akan terlihat setelah rute dibuka di Google Flights.</p>";
  return output;
}

/* ============================================================
 * 12. ESCAPE HTML
 * ============================================================ */

function escapeEncikHtml_(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ============================================================
 * 13. HANDLER GOOGLE GEMINI
 * ============================================================ */

function processGeminiChat_(
  userMessage,
  systemInstruction,
  conversationHistory,
  props,
) {
  const apiKey = props.getProperty("GEMINI_API_KEY");
  const model = (
    props.getProperty("GEMINI_MODEL") || "gemini-2.5-flash"
  ).trim();

  if (!apiKey) {
    return {
      status: "error",
      reply: "Maaf Cik, GEMINI_API_KEY belum dipasang pada Script Properties.",
    };
  }

  const contents = [];
  const history = Array.isArray(conversationHistory) ? conversationHistory : [];

  history.slice(-4).forEach(function (item) {
    if (!item) return;

    const role =
      item.role === "assistant" || item.role === "model" ? "model" : "user";

    let content = item.content;

    if (content == null && Array.isArray(item.parts)) {
      content = item.parts
        .map(function (part) {
          return part && part.text ? part.text : "";
        })
        .join("\n");
    }

    if (typeof content === "string" && content.trim()) {
      contents.push({
        role: role,
        parts: [
          {
            text: content.substring(0, 900),
          },
        ],
      });
    }
  });

  contents.push({
    role: "user",
    parts: [
      {
        text: String(userMessage).substring(0, 1800),
      },
    ],
  });

  const payload = {
    system_instruction: {
      parts: [
        {
          text: String(systemInstruction || "").substring(0, 8500),
        },
      ],
    },
    contents: contents,
    generationConfig: {
      temperature: 0.5,
      maxOutputTokens: 900,
    },
  };

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(model) +
    ":generateContent?key=" +
    encodeURIComponent(apiKey);

  try {
    const response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    const statusCode = response.getResponseCode();
    const raw = response.getContentText();

    let data = {};

    try {
      data = JSON.parse(raw);
    } catch (error) {
      data = {};
    }

    if (statusCode >= 200 && statusCode < 300) {
      const candidate = data.candidates && data.candidates[0];

      const reply =
        candidate &&
        candidate.content &&
        candidate.content.parts &&
        candidate.content.parts[0]
          ? candidate.content.parts[0].text
          : "";

      if (reply && String(reply).trim()) {
        const reviewedReply = selfReviewEncikReply_(
          userMessage,
          String(reply).trim(),
          systemInstruction,
          props,
        );

        return {
          status: "success",
          reply: reviewedReply,
          model: model,
        };
      }

      return {
        status: "error",
        reply: "Maaf Cik, layanan Gemini mengirim jawaban kosong.",
      };
    }

    Logger.log("Gemini HTTP " + statusCode + ": " + raw);

    return {
      status: "error",
      reply: "Permintaan ke Gemini gagal (HTTP " + statusCode + ").",
    };
  } catch (error) {
    Logger.log("Gemini connection error: " + error);

    return {
      status: "error",
      reply: "eNCIK belum berhasil terhubung ke Gemini.",
    };
  }
}

/* ============================================================
 * 14. HANDLER GROQ
 * ============================================================ */

function processGroqChat_(
  userMessage,
  systemInstruction,
  conversationHistory,
  props,
) {
  const apiKey = props.getProperty("GROQ_API_KEY");

  const model = (
    props.getProperty("GROQ_MODEL") || "llama-3.3-70b-versatile"
  ).trim();

  if (!apiKey) {
    return {
      status: "error",
      reply: "Maaf Cik, GROQ_API_KEY belum dipasang pada Script Properties.",
    };
  }

  const messages = [
    {
      role: "system",
      content: String(systemInstruction || "").substring(0, 8500),
    },
  ];

  const history = Array.isArray(conversationHistory) ? conversationHistory : [];

  history.slice(-4).forEach(function (item) {
    if (!item) return;

    const role =
      item.role === "assistant" || item.role === "model" ? "assistant" : "user";

    let content = item.content;

    if (content == null && Array.isArray(item.parts)) {
      content = item.parts
        .map(function (part) {
          return part && part.text ? part.text : "";
        })
        .join("\n");
    }

    if (typeof content === "string" && content.trim()) {
      messages.push({
        role: role,
        content: content.substring(0, 900),
      });
    }
  });

  messages.push({
    role: "user",
    content: String(userMessage).substring(0, 1800),
  });

  try {
    const response = UrlFetchApp.fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "post",
        contentType: "application/json",
        headers: {
          Authorization: "Bearer " + apiKey,
        },
        payload: JSON.stringify({
          model: model,
          messages: messages,
          temperature: 0.5,
          max_tokens: 900,
          stream: false,
        }),
        muteHttpExceptions: true,
      },
    );

    const statusCode = response.getResponseCode();
    const raw = response.getContentText();

    let data = {};

    try {
      data = JSON.parse(raw);
    } catch (error) {
      data = {};
    }

    if (statusCode >= 200 && statusCode < 300) {
      const reply =
        data.choices && data.choices[0] && data.choices[0].message
          ? data.choices[0].message.content
          : "";

      if (reply && String(reply).trim()) {
        const reviewedReply = selfReviewEncikReply_(
          userMessage,
          String(reply).trim(),
          systemInstruction,
          props,
        );

        return {
          status: "success",
          reply: reviewedReply,
          model: data.model || model,
        };
      }

      return {
        status: "error",
        reply: "Maaf Cik, layanan Groq mengirim jawaban kosong.",
      };
    }

    Logger.log("Groq HTTP " + statusCode + ": " + raw);

    if (statusCode === 429) {
      return {
        status: "error",
        reply:
          "Layanan AI sedang mencapai batas permintaan (HTTP 429). Silakan tunggu sebentar sebelum mencoba kembali.",
      };
    }

    return {
      status: "error",
      reply: "Permintaan ke Groq gagal (HTTP " + statusCode + ").",
    };
  } catch (error) {
    Logger.log("Groq connection error: " + error);

    return {
      status: "error",
      reply: "eNCIK belum berhasil terhubung ke Groq.",
    };
  }
}

/* ============================================================
 * 15. AI SELF-REVIEW
 *
 * Jika proses review gagal, jawaban awal tetap digunakan.
 * ============================================================ */

function selfReviewEncikReply_(question, draftReply, systemInstruction, props) {
  const provider = (props.getProperty("AI_PROVIDER") || "groq")
    .trim()
    .toLowerCase();

  const reviewPrompt = [
    "Kamu adalah pemeriksa kualitas jawaban eNCIK.",
    "Periksa relevansi, akurasi, kelengkapan, dan bahasa Indonesia.",
    "Jangan mengarang fakta atau data penerbangan.",
    "Jangan mengubah tanggal atau kode bandara.",
    "Jangan menghapus atau mengubah URL yang valid.",
    "Jika jawaban sudah benar, pertahankan.",
    "Keluarkan hanya jawaban final.",
    "",
    "PERTANYAAN PENGGUNA:",
    String(question || "").substring(0, 2500),
    "",
    "DRAF JAWABAN:",
    String(draftReply || "").substring(0, 5000),
  ].join("\n");

  try {
    if (provider === "gemini") {
      const key = props.getProperty("GEMINI_API_KEY");

      const model = (
        props.getProperty("GEMINI_MODEL") || "gemini-2.5-flash"
      ).trim();

      if (!key) return draftReply;

      const url =
        "https://generativelanguage.googleapis.com/v1beta/models/" +
        encodeURIComponent(model) +
        ":generateContent?key=" +
        encodeURIComponent(key);

      const response = UrlFetchApp.fetch(url, {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify({
          system_instruction: {
            parts: [
              {
                text: String(systemInstruction || "").substring(0, 10000),
              },
            ],
          },
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: reviewPrompt,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 900,
          },
        }),
        muteHttpExceptions: true,
      });

      if (
        response.getResponseCode() < 200 ||
        response.getResponseCode() >= 300
      ) {
        return draftReply;
      }

      const data = JSON.parse(response.getContentText() || "{}");

      const reviewed =
        data.candidates &&
        data.candidates[0] &&
        data.candidates[0].content &&
        data.candidates[0].content.parts &&
        data.candidates[0].content.parts[0]
          ? data.candidates[0].content.parts[0].text
          : "";

      return reviewed && String(reviewed).trim()
        ? String(reviewed).trim()
        : draftReply;
    }

    const key = props.getProperty("GROQ_API_KEY");

    const model = (
      props.getProperty("GROQ_MODEL") || "llama-3.3-70b-versatile"
    ).trim();

    if (!key) return draftReply;

    const response = UrlFetchApp.fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "post",
        contentType: "application/json",
        headers: {
          Authorization: "Bearer " + key,
        },
        payload: JSON.stringify({
          model: model,
          messages: [
            {
              role: "system",
              content: String(systemInstruction || "").substring(0, 10000),
            },
            {
              role: "user",
              content: reviewPrompt,
            },
          ],
          temperature: 0.2,
          max_tokens: 900,
          stream: false,
        }),
        muteHttpExceptions: true,
      },
    );

    if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
      return draftReply;
    }

    const data = JSON.parse(response.getContentText() || "{}");

    const reviewed =
      data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content
        : "";

    return reviewed && String(reviewed).trim()
      ? String(reviewed).trim()
      : draftReply;
  } catch (error) {
    Logger.log("selfReviewEncikReply_ error: " + error);
    return draftReply;
  }
}

/* ============================================================
 * MODUL JADWAL PENERBANGAN AVIATIONSTACK — PKU/WIBB
 * Diintegrasikan dari modul jadwal yang diberikan.
 * ============================================================ */

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
  CACHE_SECONDS: 86400, // 24 jam; hemat kuota Free
  CACHE_PROPERTY: "ENCIK_PKU_REALTIME_CACHE_V1",
  MAX_ROWS: 30,
  SCRIPT_PROPERTY_API_KEY: "AVIATIONSTACK_API_KEY",
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
  var hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);

  if (!hasZone) {
    // Format API tanpa offset: pertahankan jam lokal yang diterima.
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
  }

  var date = new Date(raw);
  if (isNaN(date.getTime())) return raw;

  return Utilities.formatDate(
    date,
    ENCIK_SCHEDULE_CONFIG.TIME_ZONE,
    "dd-MM-yyyy HH:mm 'WIB'",
  );
}

function encikFlightDateInWib_(value) {
  if (!value || value === "-") return "";
  var raw = String(value).trim();
  var hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);

  if (!hasZone) {
    var m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[1] + "-" + m[2] + "-" + m[3] : "";
  }

  var date = new Date(raw);
  if (isNaN(date.getTime())) return "";
  return Utilities.formatDate(
    date,
    ENCIK_SCHEDULE_CONFIG.TIME_ZONE,
    "yyyy-MM-dd",
  );
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
    "PENTING: Ini data real-time yang tersedia dari API, BUKAN papan jadwal resmi atau daftar seluruh penerbangan bandara.",
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
        "Tidak ada data real-time untuk kategori ini pada respons API. Ini BUKAN bukti bahwa tidak ada penerbangan.",
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
    "- Gunakan seluruh data penerbangan yang tersedia dari riwayat Google Sheets.",
    "- Jangan menyimpulkan tidak ada penerbangan hanya karena data tidak muncul pada satu kali pengambilan API.",
    "- Semua waktu menggunakan WIB.",
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
