const sqlite3 = require('sqlite3').verbose();
const dbPath = process.env.SQLITE_PATH || './database.db';
const db = new sqlite3.Database(dbPath);

// Fungsi ini akan membuat tabel 'users' yang simpel (hanya lisensi)
function initializeDatabase() {
    db.serialize(() => {
        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                userId TEXT PRIMARY KEY,
                username TEXT,
                expirationDate TEXT
            )
        `);
        console.log("Database 'users' (Hanya Lisensi) siap digunakan.");
    });
}

// Fungsi untuk menambah/memperbarui lisensi pengguna
function setLicense(userId, username, expirationDateInput) {
    return new Promise((resolve, reject) => {
        let formattedDate;
        try {
            const date = new Date(expirationDateInput);
            if (isNaN(date.getTime())) {
                throw new Error("Format tanggal tidak valid. Gunakan YYYY-MM-DD.");
            }
            const year = date.getFullYear();
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            const day = date.getDate().toString().padStart(2, '0');
            formattedDate = `${year}-${month}-${day}`;
        } catch (e) {
            return reject(e);
        }

        const stmt = db.prepare(`
            INSERT INTO users (userId, username, expirationDate)
            VALUES (?, ?, ?)
            ON CONFLICT(userId) DO UPDATE SET
                username = excluded.username,
                expirationDate = excluded.expirationDate
        `);
        
        stmt.run(userId, username, formattedDate, (err) => {
            if (err) return reject(err);
            resolve(`Lisensi untuk ${username} (${userId}) diatur sampai ${formattedDate}`);
        });
        stmt.finalize();
    });
}

// Fungsi "Satpam" yang hanya mengecek lisensi
function checkUserAccess(userId) {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM users WHERE userId = ?", [userId], (err, user) => {
            if (err) return reject(err);

            if (!user) {
                return reject(new Error("Anda tidak terdaftar. Hubungi admin untuk mendapatkan lisensi."));
            }
            if (!user.expirationDate) {
                 return reject(new Error("Data lisensi Anda rusak (null). Hubungi admin untuk perbaikan."));
            }

            const today = new Date();
            const expiration = new Date(user.expirationDate);
            
            today.setHours(0, 0, 0, 0);
            expiration.setHours(0, 0, 0, 0);

            if (today > expiration) {
                return reject(new Error(`Lisensi Anda sudah habis sejak ${user.expirationDate}.`));
            }

            const sisaHari = Math.ceil((expiration - today) / (1000 * 60 * 60 * 24)) + 1;
            resolve(`✅ Akses Diterima.\nSisa lisensi: ${sisaHari} hari lagi.`);
        });
    });
}

// Fungsi untuk melihat SEMUA pengguna (termasuk yang mati) - Tetap disimpan jika butuh backup
function getAllUsers() {
    return new Promise((resolve, reject) => {
        db.all("SELECT userId, expirationDate FROM users ORDER BY expirationDate DESC", [], (err, rows) => {
            if (err) return reject(err);
            resolve(rows); 
        });
    });
}

// === FUNGSI BARU: HANYA LIHAT USER AKTIF ===
function getActiveUsersOnly() {
    return new Promise((resolve, reject) => {
        // Ambil tanggal hari ini (YYYY-MM-DD)
        const date = new Date();
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        const todayStr = `${year}-${month}-${day}`;

        // Query SQL: Ambil user di mana expirationDate >= hari ini
        db.all("SELECT userId, expirationDate FROM users WHERE expirationDate >= ? ORDER BY expirationDate ASC", [todayStr], (err, rows) => {
            if (err) return reject(err);
            resolve(rows); 
        });
    });
}
// ===========================================

// Fungsi untuk menghapus pengguna
function deleteUser(userId) {
    return new Promise((resolve, reject) => {
        const stmt = db.prepare("DELETE FROM users WHERE userId = ?");
        stmt.run(userId, function(err) {
            if (err) return reject(err);
            if (this.changes === 0) {
                resolve(`Pengguna dengan ID ${userId} tidak ditemukan di database.`);
            } else {
                resolve(`Pengguna dengan ID ${userId} telah berhasil dihapus.`);
            }
        });
        stmt.finalize();
    });
}

// Fungsi untuk menambah hari ke semua pengguna
function addDaysToAllUsers(daysToAdd) {
    return new Promise((resolve, reject) => {
        const modifier = `+${daysToAdd} days`;
        const stmt = db.prepare("UPDATE users SET expirationDate = date(expirationDate, ?)");
        stmt.run(modifier, function(err) { 
            if (err) return reject(err);
            resolve(`Berhasil menambahkan ${daysToAdd} hari ke ${this.changes} pengguna.`);
        });
        stmt.finalize();
    });
}

initializeDatabase();

module.exports = {
    setLicense,
    checkUserAccess,
    getAllUsers,
    getActiveUsersOnly, // <-- Pastikan ini ada
    deleteUser,
    addDaysToAllUsers 
};

