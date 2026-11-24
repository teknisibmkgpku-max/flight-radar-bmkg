
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

// Lokasi penyimpanan database
const databaseFolder = __dirname;
const databasePath = path.join(databaseFolder, "flight_radar.db");

// Pastikan folder database tersedia
if (!fs.existsSync(databaseFolder)) {
  fs.mkdirSync(databaseFolder, { recursive: true });
}

// Membuka koneksi SQLite
const db = new Database(databasePath);

// Pengaturan database
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Tabel pengaturan aplikasi
db.exec(`
  CREATE TABLE IF NOT EXISTS app_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    setting_key TEXT NOT NULL UNIQUE,
    setting_value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

console.log("Database SQLite berhasil terhubung!");

module.exports = db;
