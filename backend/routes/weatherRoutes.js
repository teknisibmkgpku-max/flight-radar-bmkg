
const express = require("express");
const router = express.Router();

const {
  getAirportWeather
} = require("../services/WeatherService");

// GET /api/weather
router.get("/", async (req, res) => {
  try {
    const force = req.query.refresh === "true";

    const result = await getAirportWeather(force);

    if (result.status !== "success") {
      return res.status(502).json(result);
    }

    return res.json(result);

  } catch (error) {
    console.error("Weather Route Error:", error);

    return res.status(500).json({
      status: "error",
      message: "Terjadi kesalahan pada server cuaca bandara."
    });
  }
});

module.exports = router;
