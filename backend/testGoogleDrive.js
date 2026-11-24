
const drive = require("./config/googleDrive");

async function testImageMetadata() {
    const fileId = "1pDmqPq0V1BQ2z-5KO-h3dslOmh34pKVi";

    try {
        console.log("Memeriksa metadata gambar CMAX...");

        const response = await drive.files.get({
            fileId: fileId,
            fields: "id, name, mimeType, parents, trashed"
        });

        console.log("\nHASIL METADATA:");
        console.log(JSON.stringify(response.data, null, 2));

    } catch (error) {
        console.error("GAGAL MEMBACA METADATA:");
        console.error(error.response?.data || error.message);
    }
}

testImageMetadata();
