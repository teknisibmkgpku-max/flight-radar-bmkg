
const express = require("express");
const cors = require("cors");
const path = require("path");
const cron = require("node-cron");

require("dotenv").config();

const db = require("./database/connection");

const flightRoutes = require("./routes/flightRoutes");
const aiRoutes = require("./routes/aiRoutes");
const radarRoutes = require("./routes/radarRoutes");
const weatherRoutes = require("./routes/weatherRoutes");

const {
  collectFlightHistory
} = require("./services/FlightScheduleService");

const app = express();
const PORT = process.env.PORT || 3000;

// ======================================================
// MIDDLEWARE
// ======================================================

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ======================================================
// API ROUTES
// ======================================================

app.use("/api/flights", flightRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/radar", radarRoutes);
app.use("/api/weather", weatherRoutes);

// ======================================================
// FRONTEND
// ======================================================

app.use(express.static(path.join(__dirname, "../frontend")));

// ======================================================
// STATUS BACKEND
// ======================================================

app.get("/api/status", (req, res) => {
  res.json({
    success: true,
    message: "Backend Flight Radar berhasil berjalan!",
    application: "Flight Radar BMKG",
    database: db.open ? "Connected" : "Disconnected",
    radar: "Google Drive API Connected",
    time: new Date().toISOString()
  });
});

// ======================================================
// HALAMAN UTAMA
// ======================================================

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

// ======================================================
// OTOMATISASI PENGAMBILAN DATA PENERBANGAN
// Setiap pukul 09.00 dan 20.00 WIB
// ======================================================

cron.schedule(
  "0 9,20 * * *",
  async () => {
    console.log("------------------------------------");
    console.log("PENGAMBILAN DATA PENERBANGAN OTOMATIS");

    console.log("Waktu:", new Date().toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta"
    }));

    console.log("------------------------------------");

    try {
      const result = await collectFlightHistory();

      console.log("Pengambilan data selesai:", result);

    } catch (error) {
      console.error("Pengambilan data otomatis gagal:", error);
    }
  },
  {
    timezone: "Asia/Jakarta"
  }
);

// ======================================================
// JALANKAN SERVER
// ======================================================

app.listen(PORT, () => {
  console.log("------------------------------------");
  console.log(" FLIGHT RADAR BMKG");
  console.log("------------------------------------");

  console.log(`Server berjalan di http://localhost:${PORT}`);

  console.log(`API Status : http://localhost:${PORT}/api/status`);
  console.log(`API Radar  : http://localhost:${PORT}/api/radar`);
  console.log(`API Flight : http://localhost:${PORT}/api/flights`);
  console.log(`API AI     : http://localhost:${PORT}/api/ai`);
  console.log(`API Weather: http://localhost:${PORT}/api/weather`);

  console.log("------------------------------------");
  console.log("Google Drive Radar: Aktif");
  console.log("Pengambilan otomatis: 09.00 dan 20.00 WIB");
  console.log("------------------------------------");
});
