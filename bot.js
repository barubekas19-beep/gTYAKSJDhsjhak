// Muat file .env di baris paling atas
require('dotenv').config(); 

const TelegramBot = require('node-telegram-bot-api');
const { generateVideo, generateVideoFromImage } = require('./fireflyService');
const fs = require('fs');
// Impor semua fungsi, termasuk 'getActiveUsersOnly'
const { setLicense, checkUserAccess, getAllUsers, getActiveUsersOnly, deleteUser, addDaysToAllUsers } = require('./database.js'); 

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

// ===== ID ADMIN ANDA =====
const ADMIN_USER_ID = "959684975"; 
// =========================

// Variabel status maintenance (Default: false / mati)
let isMaintenanceMode = false;

// Cek token (Bagian Firefly sudah dihapus agar tidak error di Railway)
if (!TELEGRAM_TOKEN) {
    console.error("Error: Pastikan TELEGRAM_TOKEN ada di file .env / Variables Railway");
    process.exit(1);
}

if (ADMIN_USER_ID === "GANTI_DENGAN_ID_ADMIN_ANDA") {
     console.error("Error: Harap isi ADMIN_USER_ID di file bot.js");
    process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
let userState = new Map();
console.log('Bot Telegram sedang berjalan...');

// --- FUNGSI: Mengirim Pilihan Mode ---
async function sendModeSelection(chatId) {
    userState.delete(chatId); 
    await bot.sendMessage(chatId, "Pilih mode yang ingin Anda gunakan untuk membuat video berikutnya:", {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '✏️ Text to Video', callback_data: 'mode_t2v' },
                    { text: '🖼️ Image to Video', callback_data: 'mode_i2v' }
                ]
            ]
        }
    }).catch(err => console.error("Gagal mengirim pilihan mode:", err.message));
}

// Perintah /start
bot.onText(/\/start/, async (msg) => {
    // CEK MAINTENANCE
    if (isMaintenanceMode && msg.from.id.toString() !== ADMIN_USER_ID) {
        return bot.sendMessage(msg.chat.id, "⚠️ **SISTEM SEDANG MAINTENANCE**\n\nMohon maaf, bot sedang dalam perbaikan/update sistem. Silakan coba lagi nanti.");
    }

    userState.delete(msg.chat.id);
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const userName = msg.from.first_name || 'Pengguna';

    await bot.sendMessage(chatId, 
`👋 Halo, ${userName}!
Bot ini adalah bot premium dengan sistem lisensi.

Ketik /buat untuk memulai, atau hubungi admin untuk aktivasi lisensi.
`
    );

    try {
        const accessMessage = await checkUserAccess(userId);
        await bot.sendMessage(chatId, `👤 Status Lisensi Anda:\n${accessMessage}`); 
    } catch (err) {
        await bot.sendMessage(chatId, `❌ Akses Ditolak: ${err.message}`);
    }
    
    await sendModeSelection(chatId); 
});

// Perintah /batal
bot.onText(/\/batal/, (msg) => {
    if (userState.has(msg.chat.id)) {
        userState.delete(msg.chat.id);
        bot.sendMessage(msg.chat.id, "Proses dibatalkan.");
    } else {
        bot.sendMessage(msg.chat.id, "Tidak ada proses yang sedang berjalan.");
    }
});

// ===== PERINTAH-PERINTAH ADMIN =====

// Admin: /lisensi
bot.onText(/\/lisensi (.+)/, async (msg, match) => {
    if (msg.from.id.toString() !== ADMIN_USER_ID) return;
    try {
        const args = match[1].split(' ');
        const userId = args[0];
        const expirationDate = args[1]; // Format 'YYYY-MM-DD'
        const username = `user_${userId}`; 
        if (!userId || !expirationDate) throw new Error("Format salah. Contoh: /lisensi 12345678 2025-11-13");
        
        const response = await setLicense(userId, username, expirationDate);
        bot.sendMessage(msg.chat.id, response);
    } catch (err) {
        bot.sendMessage(msg.chat.id, `Error: ${err.message}`);
    }
});

// Admin: /blokir
bot.onText(/\/blokir (.+)/, async (msg, match) => {
    if (msg.from.id.toString() !== ADMIN_USER_ID) return;
    try {
        const userId = match[1].trim(); 
        if (!userId) throw new Error("Format salah. Contoh: /blokir 12345678");
        
        const response = await setLicense(userId, 'blocked_user', '2000-01-01');
        bot.sendMessage(msg.chat.id, `Pengguna ${userId} telah diblokir.`);
    } catch (err) {
        bot.sendMessage(msg.chat.id, `Error: ${err.message}`);
    }
});

// Admin: /hapus
bot.onText(/\/hapus (.+)/, async (msg, match) => {
    if (msg.from.id.toString() !== ADMIN_USER_ID) return;
    try {
        const userId = match[1].trim(); 
        if (!userId) throw new Error("Format salah. Contoh: /hapus 12345678");
        
        const response = await deleteUser(userId);
        bot.sendMessage(msg.chat.id, response);
    } catch (err) {
        bot.sendMessage(msg.chat.id, `Error: ${err.message}`);
    }
});

// Admin: /listusers (HANYA YANG AKTIF)
bot.onText(/\/listusers/, async (msg) => {
    if (msg.from.id.toString() !== ADMIN_USER_ID) return;

    try {
        // Menggunakan fungsi filter baru
        const users = await getActiveUsersOnly();
        
        if (users.length === 0) {
            bot.sendMessage(msg.chat.id, "Tidak ada pengguna aktif saat ini.");
            return;
        }

        let message = `✅ **Daftar Pengguna AKTIF** (${users.length} pengguna):\n\n`;
        users.forEach(user => {
            message += `👤 ID: \`${user.userId}\`\n🗓️ Aktif Sampai: ${user.expirationDate}\n\n`;
        });
        
        if (message.length > 4096) {
            bot.sendMessage(msg.chat.id, "Daftar pengguna terlalu panjang, mengirim sebagai beberapa pesan...");
            for (let i = 0; i < message.length; i += 4096) {
                await bot.sendMessage(msg.chat.id, message.substring(i, i + 4096), { parse_mode: 'Markdown' });
            }
        } else {
            bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
        }

    } catch (err) {
        bot.sendMessage(msg.chat.id, `Gagal mengambil daftar pengguna: ${err.message}`);
    }
});

// Admin: /adddays
bot.onText(/\/adddays (.+)/, async (msg, match) => {
    if (msg.from.id.toString() !== ADMIN_USER_ID) return;
    try {
        const days = parseInt(match[1], 10);
        if (isNaN(days) || days <= 0) {
            throw new Error("Format salah. Masukkan jumlah hari yang valid. Contoh: /adddays 30");
        }
        const response = await addDaysToAllUsers(days);
        bot.sendMessage(msg.chat.id, response); 
    } catch (err) {
        bot.sendMessage(msg.chat.id, `Error: ${err.message}`);
    }
});

// Admin: /mt (Maintenance Mode)
bot.onText(/\/mt (.+)/, (msg, match) => {
    if (msg.from.id.toString() !== ADMIN_USER_ID) return;

    const action = match[1].toLowerCase().trim();

    if (action === 'on') {
        isMaintenanceMode = true;
        bot.sendMessage(msg.chat.id, "Pv 🛠️ **MAINTENANCE MODE: AKTIF**\n\nUser biasa tidak bisa menggunakan bot. Admin tetap bisa.");
    } else if (action === 'off') {
        isMaintenanceMode = false;
        bot.sendMessage(msg.chat.id, "✅ **MAINTENANCE MODE: MATI**\n\nBot kembali normal untuk semua user.");
    } else {
        bot.sendMessage(msg.chat.id, "Gunakan: /mt on atau /mt off");
    }
});
// ===================================


// Perintah /buat
bot.onText(/\/buat/, async (msg) => { 
    if (isMaintenanceMode && msg.from.id.toString() !== ADMIN_USER_ID) {
        return bot.sendMessage(msg.chat.id, "⚠️ **SISTEM SEDANG MAINTENANCE**\n\nMohon maaf, bot sedang dalam perbaikan/update sistem. Silakan coba lagi nanti.");
    }

    const chatId = msg.chat.id;
    userState.delete(chatId); 
    await sendModeSelection(chatId); 
});

// Listener untuk GAMBAR (I2V)
bot.on('photo', async (msg) => {
    if (isMaintenanceMode && msg.from.id.toString() !== ADMIN_USER_ID) {
        return bot.sendMessage(msg.chat.id, "⚠️ **SISTEM SEDANG MAINTENANCE**\n\nGambar Anda tidak diproses karena sedang update.");
    }

    const chatId = msg.chat.id;
    const state = userState.get(chatId);

    try {
        await checkUserAccess(msg.from.id.toString());
    } catch (err) {
        bot.sendMessage(chatId, `❌ Akses Ditolak: ${err.message}`);
        return; 
    }

    if (state && state.step === 'awaiting_photo_i2v') {
        const photo = msg.photo[msg.photo.length - 1];
        const fileId = photo.file_id;
        
        userState.set(chatId, { step: 'awaiting_prompt_i2v', fileId: fileId }); 
        
        bot.sendMessage(chatId, `✅ Gambar diterima.
Sekarang, silakan kirimkan prompt untuk video Anda (bisa teks biasa atau format JSON)...`, {
            reply_markup: {
                force_reply: true,
            }
        });
    } else {
        await bot.sendMessage(chatId, "Untuk memulai Image-to-Video, silakan kirim /buat dan pilih mode 'Image to Video' terlebih dahulu.");
        await sendModeSelection(chatId); 
    }
});


// Listener untuk TEKS (Menangani T2V dan I2V)
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();

    if (isMaintenanceMode && userId !== ADMIN_USER_ID) return;
    if (!msg.text || msg.text.startsWith('/')) return; 

    const state = userState.get(chatId);
    if (!state) return; 

    const promptText = msg.text;

    // --- ALUR T2V (Text-to-Video) ---
    if (state.step === 'awaiting_prompt_t2v') { 
        try {
            await checkUserAccess(userId);
        } catch (err) {
            bot.sendMessage(chatId, `❌ Akses Ditolak: ${err.message}`);
            userState.delete(chatId);
            return; 
        }
        
        try {
            const jsonInput = JSON.parse(promptText);
            if (jsonInput.prompt && jsonInput.aspectRatio) {
                userState.delete(chatId);
                const statusMsg = await bot.sendMessage(chatId, `✅ JSON prompt T2V diterima.\n\nMemulai proses...`);
                const settings = {
                    prompt: jsonInput.prompt,
                    aspectRatio: jsonInput.aspectRatio,
                    seed: jsonInput.seed, 
                    videoModelKey: jsonInput.videoModelKey,
                    muteAudio: false
                };
                startTextGeneration(chatId, settings, statusMsg.message_id);
            } else { throw new Error("JSON tidak valid."); }
        } catch (e) {
            const prompt = promptText;
            userState.set(chatId, { step: 'awaiting_ratio_t2v', prompt: prompt });
            bot.sendMessage(chatId, `✅ Prompt T2V diterima.
Sekarang, silakan pilih rasio aspek T2V:`, {
                reply_markup: {
                    inline_keyboard: [
                        [ { text: 'Landscape 16:9', callback_data: 'ratio_t2v_16:9' }, { text: 'Portrait 9:16', callback_data: 'ratio_t2v_9:16' } ],
                        [ { text: '❌ Batal', callback_data: 'cancel_process' } ]
                    ]
                }
            });
        }
    } 
    // --- ALUR I2V (Image-to-Video) ---
    else if (state.step === 'awaiting_prompt_i2v') {
        const fileId = state.fileId;
        
        try {
            const jsonInput = JSON.parse(promptText);
            if (jsonInput.prompt && jsonInput.aspectRatio) {
                userState.delete(chatId);
                const statusMsg = await bot.sendMessage(chatId, `✅ JSON prompt I2V diterima.\n\nMemulai proses...`);
                const settings = {
                    prompt: jsonInput.prompt,
                    aspectRatio: jsonInput.aspectRatio,
                    seed: jsonInput.seed, 
                    videoModelKey: jsonInput.videoModelKey,
                    muteAudio: false
                };
                startImageGeneration(chatId, settings, fileId, statusMsg.message_id);
            } else { throw new Error("JSON tidak valid."); }
        } catch (e) {
            const prompt = promptText;
            userState.set(chatId, { step: 'awaiting_ratio_i2v', prompt: prompt, fileId: fileId });
            bot.sendMessage(chatId, `✅ Prompt I2V diterima: "${prompt.substring(0, 50)}..."
Sekarang, silakan pilih rasio aspek I2V:`, {
                reply_markup: {
                    inline_keyboard: [
                        [ { text: 'Landscape 16:9', callback_data: 'ratio_i2v_16:9' }, { text: 'Portrait 9:16', callback_data: 'ratio_i2v_9:16' } ],
                        [ { text: '❌ Batal', callback_data: 'cancel_process' } ]
                    ]
                }
            });
        }
    }
});


// Listener untuk Tombol Inline
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id.toString(); 
    const data = query.data;
    const state = userState.get(chatId);
    const msgId = query.message.message_id;

    if (isMaintenanceMode && userId !== ADMIN_USER_ID) {
        return bot.answerCallbackQuery(query.id, {
            text: "⚠️ Sedang Maintenance. Coba lagi nanti.",
            show_alert: true
        });
    }

    bot.answerCallbackQuery(query.id).catch(err => console.log("Mengabaikan error 'query too old'"));

    if (data === 'cancel_process') {
        userState.delete(chatId);
        bot.editMessageText("Dibatalkan.", { chat_id: chatId, message_id: msgId }).catch(err => console.log("Gagal edit pesan 'Batal'"));
        return;
    }

    if (data === 'mode_t2v') {
        try {
            await checkUserAccess(userId); 
        } catch (err) {
            bot.editMessageText(`❌ Akses Ditolak: ${err.message}`, { chat_id: chatId, message_id: msgId }).catch(err => console.log("Gagal edit pesan 'Akses Ditolak'"));
            return;
        }
        
        userState.set(chatId, { step: 'awaiting_prompt_t2v' });
        bot.editMessageText("Mode: ✏️ Text to Video\n\nSilakan kirimkan prompt video Anda (bisa teks biasa atau format JSON)...", {
            chat_id: chatId, message_id: msgId
        }).catch(err => console.log("Gagal edit pesan 'Mode T2V'"));
        
        bot.sendMessage(chatId, "↑ Balas pesan ini dengan prompt Anda ↑", {
             reply_markup: { force_reply: true }
        });
        return;
    }

    if (data === 'mode_i2v') {
        try {
            await checkUserAccess(userId); 
        } catch (err) {
            bot.editMessageText(`❌ Akses Ditolak: ${err.message}`, { chat_id: chatId, message_id: msgId }).catch(err => console.log("Gagal edit pesan 'Akses Ditolak'"));
            return;
        }

        userState.set(chatId, { step: 'awaiting_photo_i2v' });
        bot.editMessageText("Mode: 🖼️ Image to Video\n\nSilakan kirimkan satu gambar (foto) untuk dianimasikan...", {
            chat_id: chatId, message_id: msgId
        }).catch(err => console.log("Gagal edit pesan 'Mode I2V'"));
        return;
    }
    
    if (!state) {
        bot.editMessageText("Terjadi kesalahan (state tidak ditemukan), silakan mulai lagi.", { chat_id: chatId, message_id: msgId })
           .catch(() => {}); 
        await sendModeSelection(chatId);
        return;
    }

    // --- ALUR T2V (Teks-ke-Video) ---
    if (data.startsWith('ratio_t2v_') && state.step === 'awaiting_ratio_t2v') {
        const aspectRatio = data.split('_')[2]; 
        const prompt = state.prompt;
        userState.delete(chatId); 

        bot.editMessageText(
            `✅ T2V Diterima.\n\nPrompt: "${prompt}"\nRasio: ${aspectRatio}\n\nMemulai proses...`, 
            { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } } 
        ).catch(err => console.log("Gagal edit pesan 'T2V Diterima'"));
        
        const settings = { prompt: prompt, aspectRatio: aspectRatio, muteAudio: false };
        startTextGeneration(chatId, settings, msgId);
    }
    
    // --- ALUR I2V (Gambar-ke-Video) ---
    if (data.startsWith('ratio_i2v_') && state.step === 'awaiting_ratio_i2v') {
        const aspectRatio = data.split('_')[2]; 
        const { prompt, fileId } = state;
        userState.delete(chatId); 

        bot.editMessageText(
            `✅ I2V Diterima.\n\nPrompt: "${prompt}"\nRasio: ${aspectRatio}\n\nMemulai proses...`, 
            { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } } 
        ).catch(err => console.log("Gagal edit pesan 'I2V Diterima'"));
        
        const settings = { prompt: prompt, aspectRatio: aspectRatio, muteAudio: false };
        startImageGeneration(chatId, settings, fileId, msgId);
    }
});


// === FUNGSI GENERATE (T2V) ===
async function startTextGeneration(chatId, settings, statusMessageId) {
    const onStatusUpdate = (text) => {
        console.log(`[${chatId}] ${text}`);
        bot.editMessageText(
            `Status: ${text}`, 
            { 
                chat_id: chatId, 
                message_id: statusMessageId,
                reply_markup: { inline_keyboard: [] } 
            }
        ).catch(err => console.log("Gagal update status:", err.message));
    };

    try {
        const videoPath = await generateVideo(settings, onStatusUpdate); 
        const stats = fs.statSync(videoPath);
        const fileSizeInMB = stats.size / (1024 * 1024);

        if (fileSizeInMB > 50) {
            onStatusUpdate(`❌ Gagal! Ukuran video ${fileSizeInMB.toFixed(2)} MB (melebihi 50 MB).`);
            bot.sendMessage(chatId, `❌ Video berhasil dibuat, tetapi terlalu besar untuk dikirim (${fileSizeInMB.toFixed(2)} MB). Batas Telegram 50 MB.`);
        } else {
            onStatusUpdate("Mengunggah video ke Telegram...");
            const maxPromptLength = 900; 
            const truncatedPrompt = settings.prompt.length > maxPromptLength ? settings.prompt.substring(0, maxPromptLength) + "..." : settings.prompt;
            const captionText = `✅ Selesai (T2V)!\n\nPrompt: "${truncatedPrompt}"`;
            await bot.sendVideo(chatId, videoPath, { caption: captionText });
            await bot.deleteMessage(chatId, statusMessageId).catch(err => console.log("Gagal menghapus pesan status:", err.message));
        }
        fs.unlinkSync(videoPath);
    } catch (error) {
        console.error(error); 
        bot.editMessageText(`❌ Terjadi Error: ${error.message}`, { chat_id: chatId, message_id: statusMessageId, reply_markup: { inline_keyboard: [] } })
           .catch(err => console.log("Gagal edit pesan 'Error'"));
    } finally {
        userState.delete(chatId); 
        await sendModeSelection(chatId); 
    }
}

// === FUNGSI GENERATE (I2V) ===
async function startImageGeneration(chatId, settings, fileId, statusMessageId) {
    const onStatusUpdate = (text) => {
        console.log(`[${chatId}] ${text}`);
        bot.editMessageText(
            `Status: ${text}`, 
            { 
                chat_id: chatId, 
                message_id: statusMessageId,
                reply_markup: { inline_keyboard: [] } 
            }
        ).catch(err => console.log("Gagal update status:", err.message));
    };

    try {
        onStatusUpdate("Mengunduh gambar dari Telegram...");
        const fileStream = bot.getFileStream(fileId);
        
        const chunks = [];
        for await (const chunk of fileStream) {
            chunks.push(chunk);
        }
        const imageBuffer = Buffer.concat(chunks);
        
        settings.imageBuffer = imageBuffer;

        const videoPath = await generateVideoFromImage(settings, onStatusUpdate);
        
        const stats = fs.statSync(videoPath);
        const fileSizeInMB = stats.size / (1024 * 1024);

        if (fileSizeInMB > 50) {
            onStatusUpdate(`❌ Gagal! Ukuran video ${fileSizeInMB.toFixed(2)} MB (melebihi 50 MB).`);
            bot.sendMessage(chatId, `❌ Video berhasil dibuat, tetapi terlalu besar untuk dikirim (${fileSizeInMB.toFixed(2)} MB). Batas Telegram 50 MB.`);
        } else {
            onStatusUpdate("Mengunggah video ke Telegram...");
            const maxPromptLength = 900; 
            const truncatedPrompt = settings.prompt.length > maxPromptLength ? settings.prompt.substring(0, maxPromptLength) + "..." : settings.prompt;
            const captionText = `✅ Selesai (I2V)!\n\nPrompt: "${truncatedPrompt}"`;
            await bot.sendVideo(chatId, videoPath, { caption: captionText });
            await bot.deleteMessage(chatId, statusMessageId).catch(err => console.log("Gagal menghapus pesan status:", err.message));
        }
        fs.unlinkSync(videoPath);
    } catch (error) {
        console.error(error); 
        bot.editMessageText(`❌ Terjadi Error: ${error.message}`, { chat_id: chatId, message_id: statusMessageId, reply_markup: { inline_keyboard: [] } })
           .catch(err => console.log("Gagal edit pesan 'Error'"));
    } finally {
        userState.delete(chatId); 
        await sendModeSelection(chatId); 
    }
}
