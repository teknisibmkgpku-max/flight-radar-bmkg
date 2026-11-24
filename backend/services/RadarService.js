
const { google } = require("googleapis");
const path = require("path");

// ==========================================
// 1. KONFIGURASI GOOGLE DRIVE
// ==========================================

const auth = new google.auth.GoogleAuth({
    keyFile: path.join(
        __dirname,
        "../../credentials/google-drive-service-account.json"
    ),
    scopes: [
        "https://www.googleapis.com/auth/drive.readonly"
    ]
});

const drive = google.drive({
    version: "v3",
    auth
});

// ==========================================
// 2. ID TUJUH FOLDER RADAR
// ==========================================

const FOLDER_IDS = {
    CMAX: "16Pg_bT9bd6wAfgoQnwhZOyQ5wk-tuo5i",
    PAC01H: "1boKjNKkWLb5dw5ph6-g7QybyZl95kE4J",
    PAC06H: "1P0AscuEmG08fzD8Jzfc39pq3Uxoy_aE6",
    PAC12H: "1kwdBRpqK-RkgvXHWbwsHkRVS6xYOZjPv",
    PAC24H: "1UGPnFoM9AkYkh34aoHbbRGAppYLaT_60",
    CAP05: "1NFav7mSbzumYl0dxF-t8Udynut27NA5D",
    CAP10: "1_zAYbtP61PzGNPrPQoufuvnn0R7riGLg"
};

const RADAR_TYPES = Object.keys(FOLDER_IDS);

// ==========================================
// 3. MENGAMBIL SEMUA FILE DARI FOLDER
// ==========================================

async function listFolderFiles(folderId) {
    let files = [];
    let pageToken = null;

    do {
        const response = await drive.files.list({
            q: `'${folderId}' in parents and trashed = false and mimeType = 'image/png'`,
            fields: "nextPageToken, files(id, name, mimeType, createdTime)",
            pageSize: 1000,
            pageToken: pageToken || undefined,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true
        });

        files = files.concat(response.data.files || []);
        pageToken = response.data.nextPageToken || null;

    } while (pageToken);

    return files;
}

// ==========================================
// 4. MEMBACA TANGGAL DAN WAKTU NAMA FILE
// ==========================================

function parseRadarTime(fileName) {
    const match = fileName.match(/(\d{8})-(\d{4})/);

    if (!match) {
        return null;
    }

    const dateStr = match[1];
    const timeStr = match[2];

    const year = Number(dateStr.substring(0, 4));
    const month = Number(dateStr.substring(4, 6)) - 1;
    const day = Number(dateStr.substring(6, 8));
    const hour = Number(timeStr.substring(0, 2));
    const minute = Number(timeStr.substring(2, 4));

    const timestamp = Date.UTC(
        year,
        month,
        day,
        hour,
        minute
    );

    const wibDate = new Date(
        timestamp + 7 * 60 * 60 * 1000
    );

    const pad = n => String(n).padStart(2, "0");

    return {
        timestamp,
        displayTime:
            `${pad(wibDate.getUTCHours())}:` +
            `${pad(wibDate.getUTCMinutes())} WIB`,

        displayDate:
            `${pad(wibDate.getUTCDate())}/` +
            `${pad(wibDate.getUTCMonth() + 1)}/` +
            `${wibDate.getUTCFullYear()}`
    };
}

// ==========================================
// 5. MENGAMBIL ENAM GAMBAR RADAR TERBARU
// ==========================================

async function getRadarFiles(type, clientLastHash) {
    type = String(type).toUpperCase();

    const folderId = FOLDER_IDS[type];

    if (!folderId) {
        throw new Error(
            `Jenis radar tidak ditemukan: ${type}`
        );
    }

    const files = await listFolderFiles(folderId);

    const rawList = files
        .map(file => {
            const time = parseRadarTime(file.name);

            if (!time) {
                return null;
            }

            return {
                id: file.id,
                name: file.name,
                timestamp: time.timestamp,
                displayTime: time.displayTime,
                displayDate: time.displayDate
            };
        })
        .filter(Boolean);

    if (rawList.length === 0) {
        return [];
    }

    // Urutkan dari waktu paling lama ke terbaru
    rawList.sort(
        (a, b) => a.timestamp - b.timestamp
    );

    // Ambil enam gambar terbaru
    const latest6 = rawList.slice(-6);

    const currentHash = latest6
        .map(item => `${item.id}_${item.timestamp}`)
        .join("|");

    if (clientLastHash && clientLastHash === currentHash) {
        return [];
    }

    return latest6.map(item => ({
        id: item.id,
        name: item.name,
        timestamp: item.timestamp,
        displayTime: item.displayTime,
        displayDate: item.displayDate,

        // Gambar dilayani oleh endpoint backend
        url: `/api/radar/${type}/image/${item.id}`
    }));
}

// ==========================================
// 6. MENGAMBIL SEMUA DATA TUJUH FOLDER RADAR
// ==========================================

async function getAllRadarFiles() {
    const results = await Promise.all(
        RADAR_TYPES.map(async type => {
            try {
                const files = await getRadarFiles(type);

                return {
                    type,
                    total: files.length,
                    files
                };

            } catch (error) {
                console.error(
                    `Gagal mengambil radar ${type}:`,
                    error.message
                );

                return {
                    type,
                    total: 0,
                    files: [],
                    error: error.message
                };
            }
        })
    );

    return results;
}

// ==========================================
// 7. MENGAMBIL GAMBAR LANGSUNG DARI DRIVE
// ==========================================

async function getRadarImage(type, fileId) {
    type = String(type).toUpperCase();

    const folderId = FOLDER_IDS[type];

    if (!folderId) {
        throw new Error(
            `Jenis radar tidak ditemukan: ${type}`
        );
    }

    // Verifikasi file melalui daftar isi folder
    const files = await listFolderFiles(folderId);

    const file = files.find(
        item => item.id === fileId
    );

    if (!file) {
        throw new Error(
            "File radar tidak ditemukan atau tidak valid."
        );
    }

    // Ambil konten gambar sebagai stream
    const response = await drive.files.get(
        {
            fileId,
            alt: "media",
            supportsAllDrives: true
        },
        {
            responseType: "stream"
        }
    );

    return {
        name: file.name,
        mimeType: file.mimeType,
        stream: response.data
    };
}

// ==========================================
// 8. EXPORT SEMUA FUNGSI
// ==========================================

module.exports = {
    getRadarFiles,
    getAllRadarFiles,
    getRadarImage
};
