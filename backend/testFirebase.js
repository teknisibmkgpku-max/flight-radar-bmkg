
const { db } = require("./config/firebase");

async function testFirebase() {
  try {
    console.log("Menghubungkan ke Firebase...");

    const testRef = db.collection("_system_checks")
      .doc("connection_test");

    // Tes menulis data
    await testRef.set({
      status: "connected",
      application: "Flight Radar BMKG",
      testedAt: new Date().toISOString()
    });

    console.log("Berhasil menulis data!");

    // Tes membaca data
    const snapshot = await testRef.get();

    console.log("Data berhasil dibaca:");
    console.log(snapshot.data());

    // Hapus data tes
    await testRef.delete();

    console.log("Data tes berhasil dihapus.");
    console.log("FIREBASE BERHASIL TERHUBUNG!");

    process.exit(0);

  } catch (error) {
    console.error("KONEKSI FIREBASE GAGAL!");
    console.error(error.message);

    process.exit(1);
  }
}

testFirebase();
