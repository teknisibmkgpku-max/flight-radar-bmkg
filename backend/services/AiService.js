
const {
  buildAirportScheduleContext,
  getAccumulatedAirportScheduleData
} = require("./FlightScheduleService");

const AI_PROVIDER = (process.env.AI_PROVIDER || "groq").toLowerCase();

const GROQ_MODEL =
  process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

const GEMINI_MODEL =
  process.env.GEMINI_MODEL || "gemini-2.5-flash";


/* =====================================================
   1. MEMBANGUN RIWAYAT PERCAKAPAN
===================================================== */

function getConversationHistory(history = [], provider = "groq") {
  const recentHistory = Array.isArray(history)
    ? history.slice(-4)
    : [];

  return recentHistory
    .filter(item => item && item.content)
    .map(item => {
      let role = "user";

      if (
        item.role === "assistant" ||
        item.role === "model"
      ) {
        role = provider === "gemini" ? "model" : "assistant";
      }

      return {
        role,
        content: String(item.content).substring(0, 900)
      };
    });
}


/* =====================================================
   2. GOOGLE GEMINI
===================================================== */

async function processGeminiChat(
  userMessage,
  systemInstruction,
  conversationHistory = []
) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY belum diatur di .env");
  }

  const history = getConversationHistory(
    conversationHistory,
    "gemini"
  );

  const contents = history.map(item => ({
    role: item.role,
    parts: [{ text: item.content }]
  }));

  contents.push({
    role: "user",
    parts: [{
      text: String(userMessage).substring(0, 1800)
    }]
  });

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      system_instruction: {
        parts: [{
          text: String(systemInstruction || "").substring(0, 8500)
        }]
      },
      contents,
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 900
      }
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Gemini HTTP ${response.status}: ${
        data.error?.message || "Permintaan gagal"
      }`
    );
  }

  const reply =
    data.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("") || "";

  if (!reply.trim()) {
    throw new Error("Gemini mengirim jawaban kosong.");
  }

  return {
    status: "success",
    reply: reply.trim(),
    model: GEMINI_MODEL,
    provider: "gemini"
  };
}


/* =====================================================
   3. GROQ
===================================================== */

async function processGroqChat(
  userMessage,
  systemInstruction,
  conversationHistory = []
) {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error("GROQ_API_KEY belum diatur di .env");
  }

  const history = getConversationHistory(
    conversationHistory,
    "groq"
  );

  const messages = [
    {
      role: "system",
      content: String(systemInstruction || "").substring(0, 8500)
    },
    ...history,
    {
      role: "user",
      content: String(userMessage).substring(0, 1800)
    }
  ];

  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages,
        temperature: 0.5,
        max_tokens: 900,
        stream: false
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Groq HTTP ${response.status}: ${
        data.error?.message || "Permintaan gagal"
      }`
    );
  }

  const reply =
    data.choices?.[0]?.message?.content || "";

  if (!reply.trim()) {
    throw new Error("Groq mengirim jawaban kosong.");
  }

  return {
    status: "success",
    reply: reply.trim(),
    model: data.model || GROQ_MODEL,
    provider: "groq"
  };
}


/* =====================================================
   4. AI SELF REVIEW
===================================================== */


async function selfReviewEncikReply(
  question,
  draftReply,
  systemInstruction
) {
  // Self-review dinonaktifkan agar hasil evaluasi internal
  // tidak pernah tampil sebagai jawaban kepada pengguna.
  // Jawaban asli dari AI utama tetap digunakan.
  return String(draftReply || "").trim();
}



/* =====================================================
   5. ROUTER GROQ / GEMINI
===================================================== */

async function generateEncikAnswer(
  userMessage,
  systemInstruction,
  conversationHistory = []
) {
  const providers =
    AI_PROVIDER === "gemini"
      ? ["gemini", "groq"]
      : ["groq", "gemini"];

  const errors = [];

  for (const provider of providers) {
    try {
      let result;

      if (provider === "gemini") {
        result = await processGeminiChat(
          userMessage,
          systemInstruction,
          conversationHistory
        );
      } else {
        result = await processGroqChat(
          userMessage,
          systemInstruction,
          conversationHistory
        );
      }

      console.log(`[eNCIK AI] Provider aktif: ${provider}`);

      return result;

    } catch (error) {
      console.error(`[eNCIK AI] ${provider} gagal:`, error.message);
      errors.push(`${provider}: ${error.message}`);
    }
  }

  throw new Error(
    "Semua layanan AI gagal. " + errors.join(" | ")
  );
}


/* =====================================================
   6. EXPORT FUNGSI
===================================================== */


// ============================================================
// INTEGRASI STAYINGAPI - PENCARIAN HOTEL (NODE.JS)
// ============================================================

const STAYING_API_BASE = "https://api.stayingapi.com";

function isEncikHotelSearch_(text) {
  const value = String(text || "").toLowerCase();

  return /hotel|penginapan|akomodasi|airbnb|booking\.com|cari\s+(?:tempat\s+)?menginap|tempat\s+tidur|homestay|villa|resort/.test(value);
}

function extractEncikHotelRequest_(text) {
  const value = String(text || "");
  const lower = value.toLowerCase();
  let location = "";

  const knownPlaces = [
    "Pekanbaru", "Jakarta", "Bandung", "Surabaya", "Medan",
    "Padang", "Batam", "Yogyakarta", "Jogja", "Bali",
    "Denpasar", "Malang", "Bogor", "Palembang", "Makassar",
    "Semarang", "Lombok", "Bengkulu", "Dumai", "Bukittinggi",
    "Solo", "Depok", "Tangerang", "Bekasi", "Gunungsitoli",
    "Jambi", "Tanjung Pinang", "Kuala Lumpur"
  ];

  for (const place of knownPlaces) {
    if (lower.includes(place.toLowerCase())) {
      location = place;
      break;
    }
  }

  if (!location) {
    const match = value.match(
      /(?:hotel|penginapan|akomodasi|booking|menginap|di)\s+(?:di|untuk|ke)?\s*([A-Za-zÀ-ÿ .'-]{2,45})/i
    );

    if (match) {
      location = match[1].replace(/[?.!,].*$/, "").trim();
    }
  }

  const adultsMatch = lower.match(/(\d+)\s*(?:orang|dewasa|tamu)/);
  const adults = adultsMatch
    ? Math.max(1, Math.min(16, parseInt(adultsMatch[1], 10)))
    : 2;

  return {
    location,
    adults,
    platforms: "booking",
    limit: 10
  };
}

function buildEncikHotelContext_(request, result, compactFlight = "") {
  if (!request || !request.location) {
    return (
      "Pengguna meminta informasi hotel tetapi belum menyebut kota. " +
      "Minta pengguna memilih kota dari daftar tujuan penerbangan SSK II berikut: " +
      extractSskDestinationNames_(compactFlight)
    );
  }

  if (!result) {
    return "Data pencarian hotel tidak tersedia.";
  }

  if (result.status === "pending") {
    return (
      "STATUS: pending. Job ID: " +
      (result.jobId || "-") +
      ". Lokasi: " +
      request.location +
      ". Hasil belum tersedia; jangan membuat daftar hotel."
    );
  }

  if (result.status !== "success") {
    return (
      "Pencarian hotel gagal: " +
      compactEncikText_(result.message || "Tidak ada detail error.", 500)
    );
  }

  const rows = (result.hotels || []).map((hotel, index) => ({
    nomor: index + 1,
    nama: hotel.name || "Nama tidak tersedia",
    platform: hotel.platform || "",
    lokasi: hotel.city || request.location,
    negara: hotel.country || "",
    rating: hotel.guestRating || hotel.starRating || null,
    harga: hotel.price || null,
    url: hotel.url || ""
  }));

  return JSON.stringify({
    status: "success",
    location: request.location,
    hotels: rows
  }, null, 2).substring(0, 4500);
}


// ======================================================
// STAYINGAPI - PENCARIAN HOTEL BOOKING.COM
// ======================================================

function extractStayingHotelList_(body) {
  const candidates = [
    body?.data?.result?.data,
    body?.data?.result?.hotels,
    body?.data?.result?.results,
    body?.data?.result,
    body?.result?.data,
    body?.result?.hotels,
    body?.result?.results,
    body?.result,
    body?.data?.hotels,
    body?.data?.results,
    body?.data,
    body?.hotels,
    body?.results
  ];

  return candidates.find(Array.isArray) || [];
}

function getStayingRetryDelay_(response) {
  const retryAfter = response.headers.get("retry-after");

  if (!retryAfter) return 5000;

  const seconds = Number(retryAfter);

  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, 15000);
  }

  const date = Date.parse(retryAfter);

  if (!Number.isNaN(date)) {
    return Math.min(Math.max(date - Date.now(), 2000), 15000);
  }

  return 5000;
}

async function fetchStayingApiHotels_(request) {
  const key = String(process.env.STAYING_API_KEY || "").trim();

  if (!key) {
    return {
      status: "error",
      message: "STAYING_API_KEY belum diisi di file .env."
    };
  }

  if (!key.startsWith("stay_live_")) {
    return {
      status: "error",
      message: "Gunakan API key StayingAPI Live."
    };
  }

  if (!request || !request.location) {
    return {
      status: "error",
      message: "Lokasi hotel belum disebutkan."
    };
  }

  const params = new URLSearchParams({
    location: request.location,
    platforms: "booking",
    limit: String(request.limit || 5),
    adults: String(request.adults || 2),
    currency: "IDR"
  });

  if (request.checkIn && request.checkOut) {
    params.set("checkIn", request.checkIn);
    params.set("checkOut", request.checkOut);
  }

  try {
    const response = await fetch(
      `${STAYING_API_BASE}/v1/search?${params.toString()}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${key}`,
          Accept: "application/json"
        },
        signal: AbortSignal.timeout(30000)
      }
    );

    const raw = await response.text();

    let body = {};

    try {
      body = JSON.parse(raw);
    } catch {
      return {
        status: "error",
        message: "Respons StayingAPI bukan JSON yang valid."
      };
    }

    const data = body.data || body;

    const jobId =
      data.jobId ||
      body.jobId ||
      data.job?.id ||
      body.job?.id;

    const jobStatus = String(
      data.status || body.status || ""
    ).toLowerCase();

    // Jika API mengembalikan job asynchronous.
    if (
      response.status === 202 ||
      jobId ||
      ["pending", "processing", "queued"].includes(jobStatus)
    ) {
      if (!jobId) {
        return {
          status: "error",
          message: "StayingAPI mengembalikan proses pending tanpa Job ID."
        };
      }

      return await pollStayingApiJob_(jobId);
    }

    if (!response.ok) {
      return {
        status: "error",
        message:
          `StayingAPI HTTP ${response.status}: ` +
          compactEncikText_(
            body.error || body.message || raw,
            400
          )
      };
    }

    if (
      body.sandbox === true ||
      body.meta?.sandbox === true ||
      body.meta?.environment === "sandbox"
    ) {
      return {
        status: "error",
        message: "Respons berasal dari Sandbox, bukan data Live."
      };
    }

    if (jobStatus === "failed" || jobStatus === "error") {
      return {
        status: "error",
        message: data.error || data.message || "Pencarian hotel gagal."
      };
    }

    const hotels = extractStayingHotelList_(body);

    return {
      status: "success",
      hotels: hotels.slice(0, 5),
      meta: data.meta || body.meta || {}
    };

  } catch (error) {
    console.error("[StayingAPI Search]", error.message);

    return {
      status: "error",
      message: error.message || "Gagal menghubungi StayingAPI."
    };
  }
}

// ======================================================
// STAYINGAPI - PEMANTAUAN JOB PENCARIAN
// ======================================================

async function pollStayingApiJob_(jobId) {
  const key = String(process.env.STAYING_API_KEY || "").trim();

  const startedAt = Date.now();
  const maxWait = 240000;

  let retryDelay = 5000;

  while (Date.now() - startedAt < maxWait) {
    await new Promise(resolve => setTimeout(resolve, retryDelay));

    try {
      const response = await fetch(
        `${STAYING_API_BASE}/v1/jobs/${encodeURIComponent(jobId)}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${key}`,
            Accept: "application/json"
          },
          signal: AbortSignal.timeout(15000)
        }
      );

      if (!response.ok) {
        const raw = await response.text();

        console.error(
          "[StayingAPI Job]",
          response.status,
          compactEncikText_(raw, 300)
        );

        return {
          status: "error",
          message: `Pengecekan job hotel gagal (HTTP ${response.status}).`
        };
      }

      retryDelay = getStayingRetryDelay_(response);

      const body = await response.json();
      const data = body.data || body;

      const status = String(
        data.status || body.status || ""
      ).toLowerCase();

      if (status === "completed") {
        const hotels = extractStayingHotelList_(body);

        return {
          status: "success",
          hotels: hotels.slice(0, 5),
          meta:
            data.result?.meta ||
            data.meta ||
            body.meta ||
            {}
        };
      }

      if (status === "failed" || status === "error") {
        return {
          status: "error",
          message:
            data.error ||
            data.message ||
            "Job pencarian hotel gagal."
        };
      }

      if (
        !["pending", "processing", "queued", "running", ""].includes(status)
      ) {
        console.warn("[StayingAPI] Status job tidak dikenal:", status);
      }

    } catch (error) {
      console.error("[StayingAPI Polling]", error.message);

      // Jangan langsung menghentikan polling hanya karena
      // satu kali permintaan pengecekan mengalami gangguan.
      retryDelay = Math.min(retryDelay + 2000, 15000);
    }
  }

  return {
    status: "pending",
    jobId,
    message: "Pencarian hotel masih diproses setelah batas tunggu 4 menit."
  };
}


function extractSskDestinationNames_(raw) {
  const value = String(raw || "");

  if (!value) {
    return "Data tujuan penerbangan SSK II belum tersedia di cache.";
  }

  let values = [];

  try {
    const parsed = JSON.parse(value);
    const seen = {};

    function walk(node, depth) {
      if (!node || depth > 8) return;

      if (Array.isArray(node)) {
        node.forEach(item => walk(item, depth + 1));
        return;
      }

      if (typeof node !== "object") return;

      Object.keys(node).forEach(key => {
        const item = node[key];

        if (
          /destination|arrival.?city|kota.?tujuan|tujuan/i.test(key) &&
          typeof item === "string"
        ) {
          const name = item.trim();

          if (name && name.length < 70 && !seen[name.toLowerCase()]) {
            seen[name.toLowerCase()] = true;
            values.push(name);
          }
        }

        if (typeof item === "object") {
          walk(item, depth + 1);
        }
      });
    }

    walk(parsed, 0);

  } catch {
    const matches = value.match(
      /(?:destination|arrivalCity|tujuan)\s*["']?\s*[:=]\s*["']([^"']+)/gi
    ) || [];

    values = matches.map(item =>
      item.split(/[:=]/).pop().replace(/["']/g, "").trim()
    );
  }

  return values.length
    ? values.slice(0, 40).join(", ")
    : "Nama kota tujuan belum dapat dibaca dari cache penerbangan.";
}

function compactEncikText_(value, maxLength) {
  let text = String(value == null ? "" : value);
  text = text.replace(/\s+/g, " ").trim();

  return text.length > maxLength
    ? text.substring(0, maxLength) + "…"
    : text;
}


/* ============================================================
   8. DAFTAR TUJUAN TIKET DARI PEKANBARU
============================================================ */

async function buildEncikPkuTicketDestinationList_(dates) {
  const intro =
    "Ini daftar tujuan penerbangan dari Pekanbaru (PKU) yang terbaca dari data penerbangan tersimpan. Pilih tujuan untuk melihat pilihan tiket di Google Flights.";

  if (dates && dates.dateError) {
    return intro + "\n\n" + dates.dateErrorMessage;
  }

  try {
    const schedule = await getAccumulatedAirportScheduleData();

    const flights = Array.isArray(schedule?.departure)
      ? schedule.departure
      : [];

    const destinations = {};

    flights.forEach(flight => {
      const code = String(flight.destinationIata || "")
        .trim()
        .toUpperCase();

      const name = String(flight.destination || "").trim();

      if (!/^[A-Z]{3}$/.test(code) || code === "PKU") return;

      if (!destinations[code]) {
        destinations[code] = {
          code,
          name: name || code
        };
      }
    });

    const list = Object.keys(destinations)
      .sort()
      .map(code => {
        const item = destinations[code];

        const url = buildGoogleFlightsUrl_(
          "PKU",
          item.code,
          dates?.departureDate || null,
          dates?.returnDate || null
        );

        return (
          "<li><strong>PKU → " +
          escapeEncikHtml_(item.code) +
          " (" +
          escapeEncikHtml_(item.name) +
          ")</strong><br>" +
          '<a href="' +
          escapeEncikHtml_(url) +
          '" target="_blank" rel="noopener noreferrer">' +
          "Cek Tiket di Google Flights</a></li>"
        );
      });

    if (!list.length) {
      return (
        intro +
        "\n\nBelum ada daftar kota tujuan yang berhasil dibaca dari data keberangkatan tersimpan. Data kosong bukan berarti tidak ada penerbangan. Silakan coba lagi nanti."
      );
    }

    let output = "<p>" + escapeEncikHtml_(intro) + "</p>";

    if (dates?.departureDate) {
      output +=
        "<p>Tanggal berangkat: <strong>" +
        escapeEncikHtml_(dates.departureDate) +
        "</strong></p>";
    }

    if (dates?.returnDate) {
      output +=
        "<p>Tanggal pulang: <strong>" +
        escapeEncikHtml_(dates.returnDate) +
        "</strong></p>";
    }

    output += "<ol>" + list.join("") + "</ol>";
    output +=
      "<p>Harga dan ketersediaan kursi akan terlihat setelah rute dibuka di Google Flights.</p>";

    return output;

  } catch (error) {
    console.error("[eNCIK Daftar Tujuan]", error.message);

    return (
      intro +
      "\n\nMaaf Cik, data tujuan penerbangan belum berhasil diambil. Coba lagi beberapa saat lagi."
    );
  }
}


/* ============================================================
   9. FUNGSI UTAMA CHAT eNCIK
============================================================ */

async function processEncikAiChat(
  userMessage,
  userId,
  liveContext,
  conversationHistory = []
) {
  if (!userMessage || !String(userMessage).trim()) {
    return {
      status: "error",
      reply: "Boleh tulis pertanyaannya dulu, Cik."
    };
  }

  const message = String(userMessage).trim();

  // Deteksi rute, tanggal, dan jenis permintaan.
  const routeInfo = extractRouteFromMessage_(message);
  const flightDates = extractEncikFlightDates_(message);

  const isFlightSearch = isEncikFlightSearch_(message);
  const isHotelSearch = isEncikHotelSearch_(message);

  // Data pencarian hotel.
  const hotelRequest = isHotelSearch
    ? extractEncikHotelRequest_(message)
    : null;

  // Jalankan pencarian hotel dan tiket secara asynchronous.
  let hotelResult = null;
  let flightData = null;

  const tasks = [];

  if (isHotelSearch) {
    tasks.push(
      fetchStayingApiHotels_(hotelRequest)
        .then(result => {
          hotelResult = result;
        })
        .catch(error => {
          console.error("[eNCIK Hotel]", error.message);

          hotelResult = {
            status: "error",
            message: error.message
          };
        })
    );
  }

  if (isFlightSearch && routeInfo.origin && routeInfo.destination) {
    tasks.push(
      fetchTravelpayoutsDeals(
        routeInfo.origin,
        routeInfo.destination,
        flightDates.departureDate,
        flightDates.returnDate
      )
        .then(result => {
          flightData = result;
        })
        .catch(error => {
          console.error("[eNCIK Travelpayouts]", error.message);
        })
    );
  }

  await Promise.all(tasks);

  // Konteks jadwal penerbangan dari backend.
  let airportScheduleContext = "";

  try {
    airportScheduleContext =
      await buildAirportScheduleContext(message);
  } catch (error) {
    console.error(
      "[eNCIK Jadwal Penerbangan]",
      error.message
    );

    airportScheduleContext =
      "Data jadwal penerbangan belum berhasil diambil. Jangan mengarang data.";
  }

  // Konteks langsung dari dashboard.
  let browserContext = "";

  if (typeof liveContext === "string") {
    browserContext = liveContext;
  } else if (liveContext && typeof liveContext === "object") {
    browserContext = JSON.stringify(liveContext);
  }

  const contextFromBrowser = compactEncikText_(
    browserContext,
    3500
  );

  // Konteks pencarian tiket.
  let flightContext =
    "Pengguna tidak sedang meminta pencarian tiket pesawat.";

  if (isFlightSearch) {
    flightContext = JSON.stringify({
      route: routeInfo,
      dates: flightDates,
      flightData: flightData
    }, null, 2);
  }

  // Data akumulasi penerbangan untuk membantu pencarian hotel.
  let scheduleData = null;

  if (isHotelSearch) {
    try {
      scheduleData = await getAccumulatedAirportScheduleData();
    } catch (error) {
      console.error(
        "[eNCIK Data Tujuan Hotel]",
        error.message
      );
    }
  }

  const compactFlight = scheduleData
    ? JSON.stringify(scheduleData)
    : "";

  const sskDestinationContext =
    extractSskDestinationNames_(compactFlight);

  const hotelContext = isHotelSearch
    ? buildEncikHotelContext_(
        hotelRequest,
        hotelResult,
        compactFlight
      )
    : "Pengguna tidak sedang meminta pencarian hotel.";

  const dateInstruction = buildEncikDateInstruction_(
    flightDates,
    isFlightSearch
  );

  // Instruksi utama eNCIK.
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
4. Jika hasil kosong/gagal, sampaikan apa adanya.
5. Tampilkan nama hotel persis sesuai field name dari StayingAPI.
6. Jangan mengganti, menerjemahkan, atau membuat nama hotel sendiri.
7. StayingAPI hanya digunakan untuk platform Booking.com.
8. Jangan meminta tanggal check-in/check-out untuk pencarian katalog hotel.

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

DATA HOTEL:
${hotelContext}

DATA JADWAL PENERBANGAN SSK II:
${airportScheduleContext || "Pertanyaan ini bukan tentang jadwal penerbangan."}

KOTA TUJUAN PENERBANGAN SSK II:
${sskDestinationContext}

KONTEKS LANGSUNG DASHBOARD:
${contextFromBrowser || "Konteks dashboard langsung tidak dikirim."}
`;

  // Kirim pesan ke AI.
  let result;

  try {
    result = await generateEncikAnswer(
      message,
      systemInstruction,
      conversationHistory
    );

    if (!result || result.status !== "success") {
      return result || {
        status: "error",
        reply: "Maaf Cik, eNCIK belum berhasil memproses pertanyaan."
      };
    }


  } catch (error) {
    console.error("[eNCIK Chat]", error);

    return {
      status: "error",
      reply: "Maaf Cik, layanan eNCIK sedang mengalami kendala. Coba lagi beberapa saat."
    };
  }

  // Jika pengguna meminta daftar tujuan dari Pekanbaru.
  if (
    isFlightSearch &&
    routeInfo.origin === "PKU" &&
    !routeInfo.destination
  ) {
    result.reply =
      await buildEncikPkuTicketDestinationList_(flightDates);

  } else if (isFlightSearch && routeInfo.destination) {
    // Jika rute lengkap, tambahkan tautan Google Flights.
    result.reply = appendEncikFlightLinks_(
      result.reply,
      routeInfo,
      flightDates,
      flightData
    );
  }

  // Pastikan AI tidak menyatakan hotel tersedia jika masih pending.
  if (
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

module.exports = {
  processGeminiChat,
  processGroqChat,
  selfReviewEncikReply,
  generateEncikAnswer,
  processEncikAiChat
};

/* ============================================================
   7. INTEGRASI PENCARIAN TIKET PESAWAT
   Google Flights + estimasi Travelpayouts
============================================================ */

// Deteksi permintaan pencarian tiket
function isEncikFlightSearch_(text) {
  const value = String(text || "").toLowerCase();

  return /\b(tiket|harga tiket|cari tiket|carikan tiket|booking tiket|pesan tiket|pemesanan tiket|beli tiket|harga pesawat|tiket pesawat)\b/.test(value);
}

// Deteksi rute bandara
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
    SIN: "SIN"
  };

  const routeMatch = value.match(
    /\b(PKU|BTH|KNO|CGK|HLP|SUB|DPS|YIA|PDG|KUL|SIN)\b\s*(?:KE|MENUJU|[-→])\s*\b(PKU|BTH|KNO|CGK|HLP|SUB|DPS|YIA|PDG|KUL|SIN)\b/
  );

  if (routeMatch) {
    return {
      origin: routeMatch[1],
      destination: routeMatch[2],
      detected: true
    };
  }

  const found = [];

  Object.keys(airports).forEach(name => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp("\\b" + escaped + "\\b", "i");

    if (regex.test(value)) {
      const code = airports[name];

      if (!found.includes(code)) {
        found.push(code);
      }
    }
  });

  let origin = "";
  let destination = "";

  if (found.length >= 2) {
    origin = found[0];
    destination = found[1];
  } else if (found.length === 1) {
    origin = "PKU";
    destination = found[0] === "PKU" ? "" : found[0];
  }

  return {
    origin,
    destination,
    detected: Boolean(origin && destination)
  };
}

// Mengambil tanggal hari ini berdasarkan WIB
function getEncikToday_() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const values = {};

  parts.forEach(part => {
    values[part.type] = part.value;
  });

  return new Date(Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    12
  ));
}

function encikFormatDate_(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function encikAddDays_(date, days) {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function encikIsValidDate_(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day, 12));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

// Membaca berbagai format tanggal Indonesia
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

  let match = value.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);

  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    if (!encikIsValidDate_(year, month, day)) return null;

    return encikFormatDate_(
      new Date(Date.UTC(year, month - 1, day, 12))
    );
  }

  match = value.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})\b/);

  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);

    if (!encikIsValidDate_(year, month, day)) return null;

    return encikFormatDate_(
      new Date(Date.UTC(year, month - 1, day, 12))
    );
  }

  match = value.match(/\b(\d{1,2})[\/-](\d{1,2})\b/);

  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);

    let year = today.getUTCFullYear();

    if (!encikIsValidDate_(year, month, day)) return null;

    let date = new Date(Date.UTC(year, month - 1, day, 12));

    if (date < today) {
      year++;

      if (!encikIsValidDate_(year, month, day)) return null;

      date = new Date(Date.UTC(year, month - 1, day, 12));
    }

    return encikFormatDate_(date);
  }

  const months = {
    januari: 1, jan: 1,
    februari: 2, feb: 2,
    maret: 3, mar: 3,
    april: 4, apr: 4,
    mei: 5,
    juni: 6, jun: 6,
    juli: 7, jul: 7,
    agustus: 8, agu: 8,
    september: 9, sep: 9,
    oktober: 10, okt: 10,
    november: 11, nov: 11,
    desember: 12, des: 12
  };

  const monthPattern = Object.keys(months).join("|");

  match = value.match(
    new RegExp(
      "\\b(\\d{1,2})\\s+(" + monthPattern + ")(?:\\s+(20\\d{2}))?\\b",
      "i"
    )
  );

  if (match) {
    const day = Number(match[1]);
    const month = months[match[2].toLowerCase()];
    let year = match[3]
      ? Number(match[3])
      : today.getUTCFullYear();

    if (!encikIsValidDate_(year, month, day)) return null;

    let date = new Date(Date.UTC(year, month - 1, day, 12));

    if (!match[3] && date < today) {
      year++;

      if (!encikIsValidDate_(year, month, day)) return null;

      date = new Date(Date.UTC(year, month - 1, day, 12));
    }

    return encikFormatDate_(date);
  }

  const weekdays = {
    minggu: 0,
    senin: 1,
    selasa: 2,
    rabu: 3,
    kamis: 4,
    jumat: 5,
    "jum'at": 5,
    sabtu: 6
  };

  const weekdayPattern = Object.keys(weekdays)
    .map(day => day.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");

  match = value.match(
    new RegExp(
      "\\b(" + weekdayPattern + ")(?:\\s+(depan|minggu depan))?\\b",
      "i"
    )
  );

  if (match) {
    const requestedDay = weekdays[match[1].toLowerCase()];
    const currentDay = today.getUTCDay();

    let difference = (requestedDay - currentDay + 7) % 7;

    if (difference === 0 && match[2]) {
      difference = 7;
    } else if (match[2]) {
      difference += 7;
    }

    return encikFormatDate_(encikAddDays_(today, difference));
  }

  return null;
}

// Memisahkan tanggal berangkat dan pulang
function extractEncikFlightDates_(text) {
  const original = String(text || "");
  const lower = original.toLowerCase();

  const returnMarker = /\b(pulang|kembali|return|returning)\b/i;
  const markerMatch = returnMarker.exec(original);

  let departureText = original;
  let returnText = "";

  if (markerMatch) {
    departureText = original.substring(0, markerMatch.index);
    returnText = original.substring(
      markerMatch.index + markerMatch[0].length
    );
  }

  const departureDate = encikParseOneDate_(departureText);
  const returnDate = returnText
    ? encikParseOneDate_(returnText)
    : null;

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
    /\b(tanggal|tgl|hari ini|besok|esok|lusa|senin|selasa|rabu|kamis|jumat|jum'at|sabtu|minggu|berangkat|pulang|kembali|return)\b/i.test(original) ||
    /\b20\d{2}-\d{1,2}-\d{1,2}\b/.test(original) ||
    /\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/.test(original) ||
    /\b\d{1,2}\s+(januari|jan|februari|feb|maret|mar|april|apr|mei|juni|jun|juli|jul|agustus|agu|september|sep|oktober|okt|november|nov|desember|des)\b/i.test(original);

  if (hasDateRequest && !departureDate && !dateError) {
    dateError = true;
    dateErrorMessage =
      "Tanggal keberangkatan belum dapat dibaca. Contoh format: 3 November 2026 atau 03/11/2026.";
  }

  return {
    departureDate,
    returnDate,
    hasDateRequest,
    dateError,
    dateErrorMessage
  };
}

// Membuat tautan pencarian Google Flights
function buildGoogleFlightsUrl_(
  origin,
  destination,
  departureDate,
  returnDate
) {
  origin = String(origin || "").trim().toUpperCase();
  destination = String(destination || "").trim().toUpperCase();

  if (
    !/^[A-Z]{3}$/.test(origin) ||
    !/^[A-Z]{3}$/.test(destination)
  ) {
    return "";
  }

  let query = `Flights from ${origin} to ${destination}`;

  if (departureDate) {
    query += ` on ${departureDate}`;
  }

  if (returnDate) {
    query += ` returning ${returnDate}`;
  } else if (departureDate) {
    query += " one way";
  }

  const encodedQuery = encodeURIComponent(query).replace(/%20/g, "+");

  return (
    "https://www.google.com/travel/flights?q=" +
    encodedQuery +
    "&hl=id&utm_source=chatgpt.com"
  );
}

// Mengambil estimasi harga dari Travelpayouts
async function fetchTravelpayoutsDeals(
  origin,
  destination,
  departureDate,
  returnDate
) {
  const token = String(
    process.env.TRAVELPAYOUTS_TOKEN || ""
  ).trim();

  const result = {
    origin,
    destination,
    departureDate: departureDate || null,
    returnDate: returnDate || null,
    estimatedPrices: [],
    message: ""
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
    "?origin=" + encodeURIComponent(origin) +
    "&destination=" + encodeURIComponent(destination) +
    "&currency=idr";

  try {
    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        "x-access-token": token
      },
      signal: AbortSignal.timeout(20000)
    });

    if (!response.ok) {
      result.message =
        `Data estimasi harga belum berhasil diperoleh (HTTP ${response.status}).`;
      return result;
    }

    const json = await response.json();

    if (json.success && json.data && json.data[destination]) {
      const destinationData = json.data[destination];

      Object.keys(destinationData).slice(0, 5).forEach(key => {
        const item = destinationData[key];

        if (!item) return;

        result.estimatedPrices.push({
          price: Number(item.price || 0),
          currency: "IDR",
          flightNumber: item.flight_number || "",
          departureAt: item.departure_at || ""
        });
      });
    }

    result.message = result.estimatedPrices.length
      ? "Estimasi harga berhasil diperoleh dari Travelpayouts. Harga bukan jaminan ketersediaan kursi."
      : "Belum ada data estimasi harga untuk rute tersebut.";

  } catch (error) {
    console.error("[Travelpayouts]", error.message);
    result.message =
      "Terjadi kendala saat mengambil estimasi harga.";
  }

  return result;
}

// Petunjuk tanggal untuk AI
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
    "Jangan mengubah tanggal atau menebak tanggal lain."
  ].join("\n");
}

// Mengamankan teks sebelum dimasukkan ke HTML
function escapeEncikHtml_(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Menambahkan tautan Google Flights ke jawaban
function appendEncikFlightLinks_(aiReply, routeInfo, dates, flightData) {
  let reply = String(aiReply || "").trim();

  if (!routeInfo || !routeInfo.origin || !routeInfo.destination) {
    return reply +
      "\n\nMohon sebutkan bandara asal dan tujuan penerbangan.";
  }

  if (dates && dates.dateError) {
    return reply + "\n\n" +
      escapeEncikHtml_(dates.dateErrorMessage);
  }

  const googleUrl = buildGoogleFlightsUrl_(
    routeInfo.origin,
    routeInfo.destination,
    dates ? dates.departureDate : null,
    dates ? dates.returnDate : null
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

  section +=
    '<p><a href="' +
    escapeEncikHtml_(googleUrl) +
    '" target="_blank" rel="noopener noreferrer">' +
    "BUKA GOOGLE FLIGHTS</a></p>";

  return reply + section;
}
