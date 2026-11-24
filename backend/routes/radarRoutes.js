
const express = require("express");

const router = express.Router();

const {
    getRadarFiles,
    getRadarImage,
    getAllRadarFiles
} = require("../services/RadarService");

// GET /api/radar
// Mengambil semua data dari tujuh folder radar
router.get("/", async (req, res) => {
    try {
        const data = await getAllRadarFiles();

        res.json({
            success: true,
            totalFolders: data.length,
            totalFiles: data.reduce(
                (total, item) => total + item.total,
                0
            ),
            data
        });

    } catch (error) {
        console.error("Gagal mengambil semua radar:", error);

        res.status(500).json({
            success: false,
            message: "Gagal mengambil data radar.",
            error: error.message
        });
    }
});

// GET /api/radar/:type
// Mengambil daftar PNG berdasarkan jenis radar
router.get("/:type", async (req, res) => {
    try {
        const type = req.params.type.toUpperCase();

        const files = await getRadarFiles(type);

        res.json({
            success: true,
            type,
            total: files.length,
            files
        });

    } catch (error) {
        const status = error.message.startsWith("Jenis radar")
            ? 404
            : 500;

        res.status(status).json({
            success: false,
            message: error.message
        });
    }
});

// GET /api/radar/:type/image/:fileId
// Menampilkan gambar PNG dari Google Drive
router.get("/:type/image/:fileId", async (req, res) => {
    try {
        const type = req.params.type.toUpperCase();
        const { fileId } = req.params;

        const image = await getRadarImage(type, fileId);

        res.setHeader("Content-Type", image.mimeType);
        res.setHeader("Content-Disposition", "inline");
        res.setHeader("Cache-Control", "public, max-age=60");

        image.stream.on("error", error => {
            console.error("Gagal mengirim gambar radar:", error);

            if (!res.headersSent) {
                res.status(500).json({
                    success: false,
                    message: "Gagal mengirim gambar radar."
                });
            } else {
                res.destroy(error);
            }
        });

        image.stream.pipe(res);

    } catch (error) {
        console.error("Gagal membuka gambar radar:", error);

        res.status(404).json({
            success: false,
            message: error.message
        });
    }
});

module.exports = router;
