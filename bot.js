require('dotenv').config(); 

const TelegramBot = require('node-telegram-bot-api');
const { generateVideo, generateVideoFromImage } = require('./fireflyService');
const fs = require('fs');
// IMPORT FUNGSI DATABASE LENGKAP
const { setLicense, checkUserAccess, getAllUsers, getActiveUsersOnly, deleteUser, addDaysToAllUsers, addDaysToActiveUsers, registerTrialUser, deductCredit } = require('./database.js'); 

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_USER_ID = "959684975"; 
let isMaintenanceMode = false;

if (!TELEGRAM_TOKEN) {
    console.error("Error: Pastikan TELEGRAM_TOKEN ada di file .env / Variables Railway");
    process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
let userState = new Map();
console.log('✅ Bot Telegram sedang berjalan...');

// ========================================================
// 1. SET MENU TOMBOL (SESUAI REQUEST)
// ========================================================
bot.setMyCommands([
    { command: '/start', description: 'Mulai dan coba gratis' },
    { command: '/topup', description: 'Tambah kredit via QRIS atau custom' },
    { command: '/create', description: 'Mulai proses pembuatan konten AI' },
    { command: '/prompts', description: 'Lihat prompt yang tersimpan' }
]).then(() => console.log("✅ Menu Bot telah diatur."));
// ========================================================

async function sendModeSelection(chatId) {
    userState.delete(chatId); 
    await bot.sendMessage(chatId, "Pilih mode pembuatan video:", {
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

// ========================================================
// 2. HANDLER /START (TRIAL 5X + LINK GRUP)
// ========================================================
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const userName = msg.from.first_name || 'Pengguna';
    
    console.log(`[LOG] User ${userName} (${userId}) memulai bot (/start).`);

    if (isMaintenanceMode && msg.from.id.toString() !== ADMIN_USER_ID) {
        return bot.sendMessage(chatId, "⚠️ **SISTEM SEDANG MAINTENANCE**\n\nMohon maaf, bot sedang dalam perbaikan. Silakan coba lagi nanti.");
    }
    userState.delete(chatId);

    // A. DAFTARKAN TRIAL (JIKA USER BARU)
    try {
        const isNewUser = await registerTrialUser(userId, userName);
        if (isNewUser) console.log(`[NEW USER] ${userName} terdaftar dan dapat 5 kredit.`);
    } catch (err) {
        console.error("Database Error:", err);
    }

    // B. KIRIM PESAN SAMBUTAN
    const welcomeMsg = `👋 **Halo, ${userName}!**\n\n` +
                       `Selamat datang di Bot AI Video Generator.\n` +
                       `🎁 **Khusus Pengguna Baru:**\n` +
                       `Anda mendapatkan **5x Generate Video GRATIS** untuk mencoba kualitas bot kami.\n\n` +
                       `👥 **Gabung Grup Komunitas Kami:**\n` +
                       `Dapatkan info update, tutorial, dan diskusi di sini:\n` +
                       `👉 https://t.me/+mFKFbt1KB905ZjNl\n\n` +
                       `Silakan tekan tombol di bawah untuk mulai membuat video:`;

    await bot.sendMessage(chatId, welcomeMsg, { parse_mode: 'Markdown' });

    // C. CEK STATUS & TAMPILKAN TOMBOL
    try {
        const accessMessage = await checkUserAccess(userId);
        await bot.sendMessage(chatId, `ℹ️ **Status Akun:**\n${accessMessage.msg}`); 
        await sendModeSelection(chatId); 
    } catch (err) {
        await bot.sendMessage(chatId, `❌ **Akses Habis:**\n${err.message}`);
    }
});

// HANDLER UNTUK MENU LAIN (Placeholder dulu sesuai request)
bot.onText(/\/create/, async (msg) => {
    const chatId = msg.chat.id;
    try {
        await checkUserAccess(msg.from.id.toString()); // Cek akses dulu
        await sendModeSelection(chatId); 
    } catch (err) {
        bot.sendMessage(chatId, `⚠️ ${err.message}`);
    }
});

bot.onText(/\/topup/, (msg) => {
    bot.sendMessage(msg.chat.id, "💎 **Menu Topup**\nFitur topup otomatis sedang disiapkan. Hubungi admin untuk sewa manual.");
});

bot.onText(/\/prompts/, (msg) => {
    bot.sendMessage(msg.chat.id, "📂 **Prompt Tersimpan**\nFitur ini akan segera hadir.");
});

bot.onText(/\/batal/, (msg) => {
    if (userState.has(msg.chat.id)) {
        userState.delete(msg.chat.id);
        bot.sendMessage(msg.chat.id, "Proses dibatalkan.");
    } else {
        bot.sendMessage(msg.chat.id, "Tidak ada proses yang sedang berjalan.");
    }
});

// --- ADMIN COMMANDS (TETAP SAMA) ---
bot.onText(/\/lisensi (.+)/, async (msg, match) => {
    if (msg.from.id.toString() !== ADMIN_USER_ID) return;
    try {
        const args = match[1].split(' ');
        const userId = args[0];
        const expirationDate = args[1];
        const username = `user_${userId}`; 
        const response = await setLicense(userId, username, expirationDate);
        bot.sendMessage(msg.chat.id, response);
    } catch (err) { bot.sendMessage(msg.chat.id, `Error: ${err.message}`); }
});

bot.onText(/\/blokir (.+)/, async (msg, match) => {
    if (msg.from.id.toString() !== ADMIN_USER_ID) return;
    try {
        const userId = match[1].trim(); 
        const response = await setLicense(userId, 'blocked_user', '2000-01-01');
        bot.sendMessage(msg.chat.id, `User ${userId} diblokir.`);
    } catch (err) { bot.sendMessage(msg.chat.id, `Error: ${err.message}`); }
});

bot.onText(/\/hapus (.+)/, async (msg, match) => {
    if (msg.from.id.toString() !== ADMIN_USER_ID) return;
    try {
        const userId = match[1].trim(); 
        const response = await deleteUser(userId);
        bot.sendMessage(msg.chat.id, response);
    } catch (err) { bot.sendMessage(msg.chat.id, `Error: ${err.message}`); }
});

bot.onText(/\/listusers/, async (msg) => {
    if (msg.from.id.toString() !== ADMIN_USER_ID) return;
    try {
        const users = await getActiveUsersOnly();
        if (users.length === 0) { bot.sendMessage(msg.chat.id, "Tidak ada pengguna aktif."); return; }
        let message = `✅ **User AKTIF** (${users.length}):\n\n`;
        users.forEach(user => { message += `👤 ID: \`${user.userId}\`\n🗓️ Exp: ${user.expirationDate}\n🎁 Kredit: ${user.credits}\n\n`; });
        bot.sendMessage(msg.chat.id, message.substring(0, 4096), { parse_mode: 'Markdown' });
    } catch (err) { bot.sendMessage(msg.chat.id, `Error: ${err.message}`); }
});

bot.onText(/\/mt (.+)/, (msg, match) => {
    if (msg.from.id.toString() !== ADMIN_USER_ID) return;
    const action = match[1].toLowerCase().trim();
    if (action === 'on') { isMaintenanceMode = true; bot.sendMessage(msg.chat.id, "🛠️ MAINTENANCE ON"); } 
    else if (action === 'off') { isMaintenanceMode = false; bot.sendMessage(msg.chat.id, "✅ MAINTENANCE OFF"); }
});

// --- LOGIKA GENERATE ---

bot.on('photo', async (msg) => {
    if (isMaintenanceMode && msg.from.id.toString() !== ADMIN_USER_ID) return;
    const chatId = msg.chat.id;
    const state = userState.get(chatId);

    try { await checkUserAccess(msg.from.id.toString()); } 
    catch (err) { bot.sendMessage(chatId, `❌ Akses Ditolak: ${err.message}`); return; }

    if (state && state.step === 'awaiting_photo_i2v') {
        const photo = msg.photo[msg.photo.length - 1];
        userState.set(chatId, { step: 'awaiting_prompt_i2v', fileId: photo.file_id }); 
        bot.sendMessage(chatId, `✅ Gambar diterima.\nSekarang, kirimkan prompt video...`, { reply_markup: { force_reply: true } });
    }
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    if (isMaintenanceMode && userId !== ADMIN_USER_ID) return;
    if (!msg.text || msg.text.startsWith('/')) return; 

    const state = userState.get(chatId);
    if (!state) return; 

    const promptText = msg.text;

    // ALUR T2V
    if (state.step === 'awaiting_prompt_t2v') { 
        try { await checkUserAccess(userId); } catch (err) {
            bot.sendMessage(chatId, `❌ Akses Ditolak: ${err.message}`);
            userState.delete(chatId);
            return; 
        }
        
        try {
            const jsonInput = JSON.parse(promptText);
            if (jsonInput.prompt && jsonInput.aspectRatio) {
                userState.delete(chatId);
                const statusMsg = await bot.sendMessage(chatId, `✅ JSON T2V diterima. Memulai...`);
                const settings = { prompt: jsonInput.prompt, aspectRatio: jsonInput.aspectRatio, quality: jsonInput.quality || '720p', seed: jsonInput.seed, videoModelKey: jsonInput.videoModelKey, muteAudio: false };
                startTextGeneration(chatId, settings, statusMsg.message_id);
                return; 
            }
        } catch (e) {
            const prompt = promptText;
            userState.set(chatId, { step: 'awaiting_ratio_t2v', prompt: prompt });
            bot.sendMessage(chatId, `✅ Prompt diterima. Pilih rasio:`, {
                reply_markup: { inline_keyboard: [[ { text: '16:9', callback_data: 'ratio_t2v_16:9' }, { text: '9:16', callback_data: 'ratio_t2v_9:16' } ], [ { text: '❌ Batal', callback_data: 'cancel_process' } ]] }
            });
        }
    } 
    // ALUR I2V
    else if (state.step === 'awaiting_prompt_i2v') {
        const fileId = state.fileId;
        try {
            const jsonInput = JSON.parse(promptText);
            if (jsonInput.prompt && jsonInput.aspectRatio) {
                userState.delete(chatId);
                const statusMsg = await bot.sendMessage(chatId, `✅ JSON I2V diterima. Memulai...`);
                const settings = { prompt: jsonInput.prompt, aspectRatio: jsonInput.aspectRatio, quality: jsonInput.quality || '720p', seed: jsonInput.seed, videoModelKey: jsonInput.videoModelKey, muteAudio: false };
                startImageGeneration(chatId, settings, fileId, statusMsg.message_id);
                return;
            }
        } catch (e) {
            const prompt = promptText;
            userState.set(chatId, { step: 'awaiting_ratio_i2v', prompt: prompt, fileId: fileId });
            bot.sendMessage(chatId, `✅ Prompt diterima. Pilih rasio:`, {
                reply_markup: { inline_keyboard: [[ { text: '16:9', callback_data: 'ratio_i2v_16:9' }, { text: '9:16', callback_data: 'ratio_i2v_9:16' } ], [ { text: '❌ Batal', callback_data: 'cancel_process' } ]] }
            });
        }
    }
});

// Callback Query Listener
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id.toString(); 
    const data = query.data;
    const state = userState.get(chatId);
    const msgId = query.message.message_id;

    if (isMaintenanceMode && userId !== ADMIN_USER_ID) return bot.answerCallbackQuery(query.id, { text: "Maintenance.", show_alert: true });
    bot.answerCallbackQuery(query.id).catch(err => {});

    if (data === 'cancel_process') {
        userState.delete(chatId);
        bot.editMessageText("Dibatalkan.", { chat_id: chatId, message_id: msgId }).catch(err => {});
        return;
    }

    if (data === 'mode_t2v') {
        try { await checkUserAccess(userId); } catch (err) { return bot.sendMessage(chatId, err.message); }
        userState.set(chatId, { step: 'awaiting_prompt_t2v' });
        bot.editMessageText("Mode: ✏️ Text to Video\nKirim prompt Anda...", { chat_id: chatId, message_id: msgId });
        return;
    }

    if (data === 'mode_i2v') {
        try { await checkUserAccess(userId); } catch (err) { return bot.sendMessage(chatId, err.message); }
        userState.set(chatId, { step: 'awaiting_photo_i2v' });
        bot.editMessageText("Mode: 🖼️ Image to Video\nKirim satu gambar...", { chat_id: chatId, message_id: msgId });
        return;
    }
    
    if (!state) return;

    if (data.startsWith('ratio_t2v_') && state.step === 'awaiting_ratio_t2v') {
        state.aspectRatio = data.split('_')[2];
        state.step = 'awaiting_quality_t2v';
        userState.set(chatId, state);
        bot.editMessageText(`Rasio ${state.aspectRatio}. Pilih kualitas:`, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [[ { text: '720p', callback_data: 'quality_t2v_720p' } ],[ { text: '1080p', callback_data: 'quality_t2v_1080p' } ],[ { text: '❌ Batal', callback_data: 'cancel_process' } ]] } });
    }
    if (data.startsWith('quality_t2v_') && state.step === 'awaiting_quality_t2v') {
        const quality = data.split('_')[2];
        const { prompt, aspectRatio } = state;
        userState.delete(chatId);
        bot.editMessageText(`✅ Proses T2V...`, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } });
        startTextGeneration(chatId, { prompt, aspectRatio, quality, muteAudio: false }, msgId);
    }
    
    if (data.startsWith('ratio_i2v_') && state.step === 'awaiting_ratio_i2v') {
        state.aspectRatio = data.split('_')[2];
        state.step = 'awaiting_quality_i2v';
        userState.set(chatId, state);
        bot.editMessageText(`Rasio ${state.aspectRatio}. Pilih kualitas:`, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [[ { text: '720p', callback_data: 'quality_i2v_720p' } ],[ { text: '1080p', callback_data: 'quality_i2v_1080p' } ],[ { text: '❌ Batal', callback_data: 'cancel_process' } ]] } });
    }
    if (data.startsWith('quality_i2v_') && state.step === 'awaiting_quality_i2v') {
        const quality = data.split('_')[2];
        const { prompt, aspectRatio, fileId } = state;
        userState.delete(chatId);
        bot.editMessageText(`✅ Proses I2V...`, { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } });
        startImageGeneration(chatId, { prompt, aspectRatio, quality, muteAudio: false }, fileId, msgId);
    }
});

// ========================================================
// 3. FUNGSI GENERATE (DENGAN PENGURANGAN KREDIT)
// ========================================================

async function startTextGeneration(chatId, settings, statusMessageId) {
    const onStatusUpdate = (text) => {
        bot.editMessageText(`Status: ${text}`, { chat_id: chatId, message_id: statusMessageId, reply_markup: { inline_keyboard: [] } }).catch(err => {});
    };
    try {
        const videoPath = await generateVideo(settings, onStatusUpdate); 
        const stats = fs.statSync(videoPath);
        const fileSizeInMB = stats.size / (1024 * 1024);
        if (fileSizeInMB > 50) { 
            bot.sendMessage(chatId, `❌ Video terlalu besar.`); 
        } else {
            onStatusUpdate("Mengunggah video ke Telegram...");
            
            // --- POTONG KREDIT JIKA TRIAL ---
            await deductCredit(chatId.toString());
            // --------------------------------

            await bot.sendVideo(chatId, videoPath, { caption: `✅ Selesai (T2V - ${settings.quality})!\nPrompt: "${settings.prompt.substring(0, 900)}"` });
            await bot.deleteMessage(chatId, statusMessageId).catch(err => {});
        }
        fs.unlinkSync(videoPath);
    } catch (error) {
        bot.editMessageText(`❌ Error: ${error.message}`, { chat_id: chatId, message_id: statusMessageId });
    } finally { userState.delete(chatId); await sendModeSelection(chatId); }
}

async function startImageGeneration(chatId, settings, fileId, statusMessageId) {
    const onStatusUpdate = (text) => {
        bot.editMessageText(`Status: ${text}`, { chat_id: chatId, message_id: statusMessageId, reply_markup: { inline_keyboard: [] } }).catch(err => {});
    };
    try {
        onStatusUpdate("Mengunduh gambar...");
        const fileStream = bot.getFileStream(fileId);
        const chunks = [];
        for await (const chunk of fileStream) chunks.push(chunk);
        settings.imageBuffer = Buffer.concat(chunks);

        const videoPath = await generateVideoFromImage(settings, onStatusUpdate);
        const stats = fs.statSync(videoPath);
        const fileSizeInMB = stats.size / (1024 * 1024);
        if (fileSizeInMB > 50) { 
            bot.sendMessage(chatId, `❌ Video terlalu besar.`); 
        } else {
            onStatusUpdate("Mengunggah video ke Telegram...");

            // --- POTONG KREDIT JIKA TRIAL ---
            await deductCredit(chatId.toString());
            // --------------------------------

            await bot.sendVideo(chatId, videoPath, { caption: `✅ Selesai (I2V - ${settings.quality})!\nPrompt: "${settings.prompt.substring(0, 900)}"` });
            await bot.deleteMessage(chatId, statusMessageId).catch(err => {});
        }
        fs.unlinkSync(videoPath);
    } catch (error) {
        bot.editMessageText(`❌ Error: ${error.message}`, { chat_id: chatId, message_id: statusMessageId });
    } finally { userState.delete(chatId); await sendModeSelection(chatId); }
}
