const express = require("express");

const router = express.Router();

const {
  getLiveAircraft
} = require("../services/LiveFlightService");

const {
  getTodayWIB,
  getAccumulatedAirportScheduleData,
  readFlightHistory,
  collectFlightHistory
} = require("../services/FlightScheduleService");

// ======================================================
// 1. DATA PENERBANGAN HARI INI
// GET /api/flights/today
// ======================================================

router.get("/today", (req, res) => {
  try {
    const date = getTodayWIB();
    const data = getAccumulatedAirportScheduleData();

    res.json({
      success: true,
      date,
      timezone: "Asia/Jakarta",
      data
    });
  } catch (error) {
    console.error("Gagal mengambil penerbangan hari ini:", error);

    res.status(500).json({
      success: false,
      message: "Gagal mengambil data penerbangan hari ini.",
      error: error.message
    });
  }
});

// ======================================================
// 2. RIWAYAT PENERBANGAN BERDASARKAN TANGGAL
// GET /api/flights/history?date=2026-11-16
// ======================================================

router.get("/history", (req, res) => {
  try {
    const date = req.query.date || getTodayWIB();

    // Validasi format tanggal
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        success: false,
        message: "Format tanggal harus YYYY-MM-DD."
      });
    }

    const data = readFlightHistory(date);

    res.json({
      success: true,
      date,
      timezone: "Asia/Jakarta",
      data
    });
  } catch (error) {
    console.error("Gagal mengambil riwayat penerbangan:", error);

    res.status(500).json({
      success: false,
      message: "Gagal mengambil riwayat penerbangan.",
      error: error.message
    });
  }
});

// ======================================================
// 3. PENGAMBILAN DATA MANUAL
// POST /api/flights/collect
// ======================================================

router.post("/collect", async (req, res) => {
  try {
    const result = await collectFlightHistory(true);

    res.json({
      success: true,
      message: "Proses pengambilan data penerbangan selesai.",
      result
    });
  } catch (error) {
    console.error("Gagal mengambil data Aviationstack:", error);

    res.status(500).json({
      success: false,
      message: "Gagal mengambil data penerbangan.",
      error: error.message
    });
  }
});

// ======================================================
// 4. STATUS DATA PENERBANGAN
// GET /api/flights/status
// ======================================================

router.get("/status", (req, res) => {
  try {
    const date = getTodayWIB();
    const data = getAccumulatedAirportScheduleData();

    res.json({
      success: true,
      date,
      timezone: "Asia/Jakarta",
      departureCount: Array.isArray(data.departure)
        ? data.departure.length
        : 0,
      arrivalCount: Array.isArray(data.arrival)
        ? data.arrival.length
        : 0,
      totalFlights:
        (Array.isArray(data.departure) ? data.departure.length : 0) +
        (Array.isArray(data.arrival) ? data.arrival.length : 0)
    });
  } catch (error) {
    console.error("Gagal memeriksa status penerbangan:", error);

    res.status(500).json({
      success: false,
      message: "Gagal memeriksa status penerbangan.",
      error: error.message
    });
  }
});

// ======================================================
// 5. LIVE FLIGHT TRACKING OPENSKY
// GET /api/flights/live
// ======================================================

router.get("/live", async (req, res) => {
  try {
    const data = await getLiveAircraft();

    res.json(data);

  } catch (error) {
    console.error("Gagal mengambil posisi pesawat:", error);

    res.status(502).json({
      success: false,
      message: "Gagal mengambil posisi pesawat dari OpenSky.",
      error: error.message
    });
  }
});

module.exports = router;