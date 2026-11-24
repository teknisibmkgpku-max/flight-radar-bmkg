
const express = require("express");

const {
  processEncikAiChat
} = require("../services/AiService");

const {
  submitEncikFeedback
} = require("../services/EncikFeedbackService");

const router = express.Router();

// POST /api/ai/chat
router.post("/chat", async (req, res) => {
  try {
    const {
      message,
      userId,
      liveContext,
      conversationHistory
    } = req.body;

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: "Pesan tidak boleh kosong."
      });
    }

    const result = await processEncikAiChat(
      message.trim(),
      userId || "guest",
      liveContext || {},
      Array.isArray(conversationHistory)
        ? conversationHistory
        : []
    );

    return res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error("Error eNCIK AI:", error);

    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan saat memproses eNCIK.",
      error: error.message
    });
  }
});

// POST /api/ai/feedback
router.post("/feedback", async (req, res) => {
  try {
    const result = await submitEncikFeedback(req.body);

    return res.json(result);

  } catch (error) {
    console.error("Error menyimpan feedback eNCIK:", error);

    return res.status(400).json({
      success: false,
      message: error.message || "Feedback gagal disimpan."
    });
  }
});

module.exports = router;
