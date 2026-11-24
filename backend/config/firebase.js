
const path = require("path");

const {
  initializeApp,
  cert,
  getApps
} = require("firebase-admin/app");

const {
  getFirestore
} = require("firebase-admin/firestore");

// Lokasi file kredensial Firebase
const serviceAccountPath = path.join(
  __dirname,
  "../../credentials/firebase-service-account.json"
);

// Membaca kredensial
const serviceAccount = require(serviceAccountPath);

// Inisialisasi Firebase
const firebaseApp = getApps().length
  ? getApps()[0]
  : initializeApp({
      credential: cert(serviceAccount)
    });

// Koneksi Firestore
const db = getFirestore(firebaseApp);

// Export
module.exports = {
  db,
  firebaseApp
};

console.log("Firebase berhasil diinisialisasi!");
