
const db = require("../database/connection");

// Buat tabel feedback otomatis jika belum tersedia
db.exec(`
  CREATE TABLE IF NOT EXISTS encik_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rating TEXT NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    correction TEXT DEFAULT '',
    comment TEXT DEFAULT '',
    user_id TEXT DEFAULT '',
    model TEXT DEFAULT 'unknown',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

function submitEncikFeedback(payload) {
  try {
    if (!payload || typeof payload !== "object") {
      throw new Error("Data feedback tidak valid.");
    }

    const rating = String(payload.rating || "").trim();
    const question = String(payload.question || "").trim();
    const answer = String(payload.answer || "").trim();

    if (!["positive", "negative"].includes(rating)) {
      throw new Error("Rating feedback tidak valid.");
    }

    if (!question || !answer) {
      throw new Error("Pertanyaan dan jawaban wajib tersedia.");
    }

    const statement = db.prepare(`
      INSERT INTO encik_feedback (
        rating,
        question,
        answer,
        correction,
        comment,
        user_id,
        model
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = statement.run(
      rating,
      question,
      answer,
      String(payload.correction || ""),
      String(payload.comment || ""),
      String(payload.userId || ""),
      String(payload.model || "unknown")
    );

    return {
      success: true,
      message: "Terima kasih. Feedback berhasil disimpan.",
      id: result.lastInsertRowid
    };

  } catch (error) {
    console.error("Gagal menyimpan feedback eNCIK:", error);

    return {
      success: false,
      message: error.message || "Feedback gagal disimpan."
    };
  }
}

module.exports = {
  submitEncikFeedback
};
