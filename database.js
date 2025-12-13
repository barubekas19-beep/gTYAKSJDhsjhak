const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(process.env.SQLITE_PATH || './database.db');

// Inisialisasi Database
function initializeDatabase() {
    db.serialize(() => {
        // Tabel users dengan tambahan kolom 'credits' untuk trial
        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                userId TEXT PRIMARY KEY,
                username TEXT,
                expirationDate TEXT,
                credits INTEGER DEFAULT 0 
            )
        `);

        // Migrasi aman: Tambah kolom credits jika database lama belum punya
        db.run("ALTER TABLE users ADD COLUMN credits INTEGER DEFAULT 0", (err) => {
            // Error diabaikan jika kolom sudah ada
        });
        
        console.log("Database siap (Sistem Sewa + Trial 5x).");
    });
}

// FUNGSI 1: Daftarkan User Baru (Otomatis dapat 5 Credit Trial)
function registerTrialUser(userId, username) {
    return new Promise((resolve, reject) => {
        db.get("SELECT userId FROM users WHERE userId = ?", [userId], (err, row) => {
            if (err) return reject(err);
            
            // Jika user belum ada di database, buat baru dengan 5 kredit
            if (!row) {
                const stmt = db.prepare("INSERT INTO users (userId, username, expirationDate, credits) VALUES (?, ?, ?, ?)");
                // expirationDate NULL (belum sewa), Credits 5 (Trial)
                stmt.run(userId, username, null, 5, (err) => {
                    if (err) return reject(err);
                    resolve(true); // User baru sukses dibuat
                });
                stmt.finalize();
            } else {
                resolve(false); // User sudah ada
            }
        });
    });
}

// FUNGSI 2: Cek Akses (Prioritas: Sewa Waktu -> Baru Kuota Trial)
function checkUserAccess(userId) {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM users WHERE userId = ?", [userId], (err, user) => {
            if (err) return reject(err);
            
            // Jika user tidak ada di database sama sekali
            if (!user) return reject(new Error("Anda belum terdaftar. Ketik /start untuk mengambil trial 5x gratis."));

            // A. CEK MASA AKTIF (SEWA) - PRIORITAS UTAMA
            if (user.expirationDate) {
                const today = new Date();
                const expiration = new Date(user.expirationDate);
                // Reset jam agar hitungan per hari akurat
                today.setHours(0,0,0,0); 
                expiration.setHours(0,0,0,0);

                if (today <= expiration) {
                    const sisaHari = Math.ceil((expiration - today) / (1000 * 60 * 60 * 24)) + 1; // +1 biar hari H terhitung
                    // Jika masih dalam masa sewa, lolos tanpa cek kredit
                    return resolve({ type: 'premium', msg: `💎 **Premium Akses**\nSisa masa aktif: ${sisaHari} hari (Unlimited Generate).` });
                }
            }

            // B. JIKA MASA SEWA HABIS/BELUM BELI -> CEK TRIAL
            if (user.credits > 0) {
                return resolve({ type: 'trial', msg: `🎁 **Mode Trial Gratis**\nSisa kuota: ${user.credits}x generate lagi.` });
            }

            // C. JIKA TIDAK ADA KEDUANYA
            return reject(new Error("Masa sewa habis & Kuota trial 0.\nSilakan hubungi admin untuk sewa akses harian/bulanan, atau gabung grup untuk info promo."));
        });
    });
}

// FUNGSI 3: Potong Kredit (Hanya memotong jika user TIDAK punya masa aktif)
function deductCredit(userId) {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM users WHERE userId = ?", [userId], (err, user) => {
            if (err) return reject(err);
            if (!user) return resolve();

            // Cek Masa Aktif dulu
            if (user.expirationDate) {
                const today = new Date();
                const expiration = new Date(user.expirationDate);
                today.setHours(0,0,0,0); expiration.setHours(0,0,0,0);

                // JIKA MASIH AKTIF SEWA, JANGAN POTONG KREDIT
                if (today <= expiration) {
                    return resolve("Premium User: No deduction");
                }
            }

            // JIKA TIDAK ADA MASA AKTIF, BARU POTONG KREDIT
            db.run("UPDATE users SET credits = credits - 1 WHERE userId = ?", [userId], (err) => {
                if (err) return reject(err);
                resolve("Trial Credit deducted");
            });
        });
    });
}

// Fungsi Admin Lainnya (Tetap Sama)
function setLicense(userId, username, expirationDateInput) {
    return new Promise((resolve, reject) => {
        let formattedDate;
        try {
            const date = new Date(expirationDateInput);
            if (isNaN(date.getTime())) throw new Error("Format tanggal salah.");
            formattedDate = date.toISOString().split('T')[0];
        } catch (e) { return reject(e); }

        const stmt = db.prepare(`
            INSERT INTO users (userId, username, expirationDate)
            VALUES (?, ?, ?)
            ON CONFLICT(userId) DO UPDATE SET
                username = excluded.username,
                expirationDate = excluded.expirationDate
        `);
        
        stmt.run(userId, username, formattedDate, (err) => {
            if (err) return reject(err);
            resolve(`✅ Masa aktif ${username} diperbarui sampai ${formattedDate}`);
        });
        stmt.finalize();
    });
}

function getAllUsers() {
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM users ORDER BY expirationDate DESC", [], (err, rows) => { if (err) return reject(err); resolve(rows); });
    });
}

function getActiveUsersOnly() {
    return new Promise((resolve, reject) => {
        const todayStr = new Date().toISOString().split('T')[0];
        db.all("SELECT * FROM users WHERE expirationDate >= ?", [todayStr], (err, rows) => { if (err) return reject(err); resolve(rows); });
    });
}

function deleteUser(userId) {
    return new Promise((resolve, reject) => {
        db.run("DELETE FROM users WHERE userId = ?", [userId], function(err) { if (err) return reject(err); resolve(this.changes > 0 ? `User ${userId} dihapus.` : `User tidak ditemukan.`); });
    });
}

function addDaysToAllUsers(days) { return Promise.resolve("Fitur disabled."); }
function addDaysToActiveUsers(days) { return Promise.resolve("Fitur disabled."); }

initializeDatabase();

module.exports = {
    setLicense, checkUserAccess, getAllUsers, getActiveUsersOnly, deleteUser,
    registerTrialUser, deductCredit, addDaysToAllUsers, addDaysToActiveUsers
};
