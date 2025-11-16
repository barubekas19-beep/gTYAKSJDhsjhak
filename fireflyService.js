const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// --- URL API (Tidak Berubah) ---
const API_GENERATE_TEXT_URL = 'https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoText';
const API_UPLOAD_URL = 'https://aisandbox-pa.googleapis.com/v1:uploadUserImage';
const API_GENERATE_IMAGE_URL = 'https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoStartImage';
const API_STATUS_URL = 'https://aisandbox-pa.googleapis.com/v1/video:batchCheckAsyncVideoGenerationStatus';
// ===================================

// ===== TOKEN LOKAL ANDA =====
const ALL_TOKENS = [
  "ya29.a0ATi6K2sCSPjiVxyJX-z96fOk7Aonkd4MX5v7fUKjkMVmal1CyMnS7hxZYG-RQLd_JspQ0Layzkx6U2b-_ZI8tD8QGqNfkkVoIDEdEbba85_oDBer5L9sod-LkEtwTU5UfOmXiV6DMninoFFEkeMcTC4NGHEPqmkqxS_wUZL9xBgoLJdwgqOq9C9VX8PMqWESRiryfxqGb1F_USSEBHQuRzRx_ioGlX6BN--MNO-jPcgHOyPw-HY04rOacM-pYmrjp1v9Flx2H3wG_gGVVhoOIlfNTN-3tINOj-mOrrifEmrYqUc3cpe77UElJjjwh83U3fHbtqYmKQrwaSjqVLDUJM1aWw5F5pEoWRtzf0dKqhIaCgYKASESARYSFQHGX2MiycljQe6MTBfW0MCSIuPuVA0370",
  "ya29.a0ATi6K2vuUrMDWnivnx_-OZauaO_yP5V_KPip1rMuI5TAV9UneMGPbREnHbZVpX8PFlx_c-dSf2opNcYt0Cl7Lj6qQAUuWf6jR6ENpkgFAoHpt7WJFugxxLxnzL3g3g8TQVt6qtLWNcKiBDj6c4DzeSPA8MW_eyIidFxDAAPQyus8UnF2UQsySTxBRV1wnpOgXCcMH0M6blKw4iH1KOaYzlQ-hqMr6o96fIu8h2G7vbaEZvnm4zUhhVkw-5RfOHXplPRVa1PbjjuW9T39z9keJDGtUWYj_3fOZEJwlh66qrirwM27o4R1mqLAwK-smxN2grNUyE6gA-Q7hKMuaKLCI9wj3xigrOwcIctr3QaCgYKAa4SARESFQHGX2MiuP_HvqjFzGrYJC6BDnQLqg0365", // "ya29.a0A...TOKEN_ANDA_YANG_KETIGA",
];
// ===================================


// === FUNGSI UTILITAS (Tidak Berubah) ===
function sanitizeFilename(prompt, extension) {
    const truncated = prompt.length > 50 ? prompt.substring(0, 50) : prompt;
    return truncated.replace(/[^a-z0-9]/gi, '_').toLowerCase() + extension;
}
const createGoogleHeaders = (token) => ({
    'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`,
    'Content-Type': 'application/json', 'accept': '*/*', 'origin': 'https://labs.google',
    'referer': 'https://labs.google/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    'x-client-data': 'CJG2yQEIprbJAQipncoBCIeWywEIlKHLAQiFoM0BCI2OzwE='
});
// ===================================


// --- FUNGSI T2V (DIPERBARUI DENGAN CEK 401) ---
async function generateVideo(settings, onStatusUpdate) {
    const { prompt, aspectRatio, seed: seedInput, videoModelKey: modelKeyInput } = settings;
    const savePath = path.join(__dirname, 'downloads');
    if (!fs.existsSync(savePath)) fs.mkdirSync(savePath);

    let lastError = new Error("Semua token gagal atau tidak tersedia.");

    for (let i = 0; i < ALL_TOKENS.length; i++) {
        const currentToken = ALL_TOKENS[i];
        const tokenIdentifier = `Token #${i + 1}`;
        
        try {
            const googleHeaders = createGoogleHeaders(currentToken);
            
            let apiAspectRatio, apiVideoModelKey;
            if (modelKeyInput) {
                apiVideoModelKey = modelKeyInput;
                apiAspectRatio = (aspectRatio === '16:9') ? "VIDEO_ASPECT_RATIO_LANDSCAPE" : "VIDEO_ASPECT_RATIO_PORTRAIT";
            } else {
                apiAspectRatio = (aspectRatio === '16:9') ? "VIDEO_ASPECT_RATIO_LANDSCAPE" : "VIDEO_ASPECT_RATIO_PORTRAIT";
                apiVideoModelKey = (aspectRatio === '16:9') ? "veo_3_1_t2v_fast_ultra" : "veo_3_1_t2v_fast_portrait_ultra";
            }
            const seed = seedInput || Math.floor(Math.random() * 999999);
            const sceneId = uuidv4();
            const cleanPrompt = prompt.replace(/\"/g, '');

            onStatusUpdate(`Memulai T2V (${tokenIdentifier}): "${cleanPrompt.substring(0, 30)}..."`);
            
            const generateBody = {
              "clientContext": { "projectId": "d4b08afb-1a05-4513-a216-f3a7ffaf6147", "tool": "PINHOLE", "userPaygateTier": "PAYGATE_TIER_TWO" },
              "requests": [ {
                  "aspectRatio": apiAspectRatio, 
                  "seed": seed, 
                  "textInput": { "prompt": cleanPrompt },
                  // Blok 'promptExpansionInput' DIHAPUS di T2V
                  "videoModelKey": apiVideoModelKey, 
                  "metadata": { "sceneId": sceneId }
              } ]
            };

            const genResponse = await axios.post(API_GENERATE_TEXT_URL, generateBody, { headers: googleHeaders });
            
            const operationName = genResponse.data?.operations?.[0]?.operation?.name;
            const responseSceneId = genResponse.data?.operations?.[0]?.sceneId;
            if (!operationName || !responseSceneId) throw new Error(`Gagal memulai generate: ${JSON.stringify(genResponse.data)}`);
            
            onStatusUpdate("Menunggu video... (Ini bisa 1-3 menit)");
            let videoUrl = null;
            for (let attempts = 1; attempts <= 30; attempts++) {
                await new Promise(resolve => setTimeout(resolve, 10000));
                const statusBody = { "operations": [ { "operation": { "name": operationName }, "sceneId": responseSceneId, "status": "MEDIA_GENERATION_STATUS_PENDING" } ] };
                const statusResponse = await axios.post(API_STATUS_URL, statusBody, { headers: googleHeaders });
                const fifeUrl = statusResponse.data?.operations?.[0]?.operation?.metadata?.video?.fifeUrl;
                if (fifeUrl) { videoUrl = fifeUrl; break; }
                const failStatus = statusResponse.data?.operations?.[0]?.status;
                if (failStatus === 'MEDIA_GENERATION_STATUS_FAILED') throw new Error(statusResponse.data.operations[0].operation?.error?.message || "Server Google gagal memproses video.");
            }
            if (!videoUrl) throw new Error('Waktu tunggu habis saat menunggu Google Veo.');

            onStatusUpdate("Mengunduh video...");
            const videoResponse = await axios.get(videoUrl, { responseType: 'arraybuffer' });
            const finalFilename = sanitizeFilename(prompt, '.mp4');
            const finalPath = path.join(savePath, finalFilename);
            fs.writeFileSync(finalPath, videoResponse.data);
            
            onStatusUpdate("Selesai!");
            return finalPath; // SUKSES!

        } catch (error) {
            let errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
            let statusCode = error.response ? error.response.status : 0;
            lastError = new Error(`(${tokenIdentifier}): ${errorMsg}`); 

            // ===== PERBAIKAN DI SINI =====
            // Tambahkan 'statusCode === 401' (Unauthenticated) ke kondisi retry
            if (statusCode === 401 || statusCode === 403 || statusCode === 429) {
                onStatusUpdate(`${tokenIdentifier} gagal (Token Mati/Limit). Pindah ke token berikutnya...`);
            } else {
            // =============================
                if (errorMsg.includes("video_unsafe") || errorMsg.includes("PROMPT_REJECTED")) {
                    throw new Error(`Prompt ditolak oleh Google karena tidak aman (unsafe).`);
                }
                throw new Error(errorMsg || "Terjadi error tidak dikenal.");
            }
        }
    }
    throw lastError;
}

// --- FUNGSI I2V (DIPERBARUI DENGAN CEK 401) ---
async function generateVideoFromImage(settings, onStatusUpdate) {
    const { prompt, aspectRatio, imageBuffer, seed: seedInput, videoModelKey: modelKeyInput } = settings;
    const savePath = path.join(__dirname, 'downloads');
    if (!fs.existsSync(savePath)) fs.mkdirSync(savePath);

    let lastError = new Error("Semua token gagal atau tidak tersedia.");

    for (let i = 0; i < ALL_TOKENS.length; i++) {
        const currentToken = ALL_TOKENS[i];
        const tokenIdentifier = `Token #${i + 1}`;
        
        try {
            const googleHeaders = createGoogleHeaders(currentToken);
            
            let apiAspectRatio, apiVideoModelKey;
            const generateAspectRatio = (aspectRatio === '16:9') ? "VIDEO_ASPECT_RATIO_LANDSCAPE" : "VIDEO_ASPECT_RATIO_PORTRAIT";
            if (modelKeyInput) { apiVideoModelKey = modelKeyInput; }
            else { apiVideoModelKey = (aspectRatio === '16:9') ? "veo_3_1_i2v_s_fast_ultra" : "veo_3_1_i2v_s_fast_portrait_ultra"; }
            const seed = seedInput || Math.floor(Math.random() * 999999);
            const sceneId = uuidv4();
            
            // --- LANGKAH A: UPLOAD GAMBAR ---
            onStatusUpdate(`(${tokenIdentifier}) Mengunggah gambar referensi...`);
            const imageBase64 = imageBuffer.toString('base64');
            const uploadBody = {
              "imageInput": { "rawImageBytes": imageBase64, "mimeType": "image/jpeg", "isUserUploaded": true, "aspectRatio": "IMAGE_ASPECT_RATIO_LANDSCAPE" },
              "clientContext": { "tool": "ASSET_MANAGER" }
            };
            const uploadResponse = await axios.post(API_UPLOAD_URL, uploadBody, { headers: googleHeaders });
            const mediaId = uploadResponse.data?.mediaGenerationId?.mediaGenerationId;
            if (!mediaId) throw new Error("Gagal mendapatkan Media ID dari gambar yang diupload.");

            // --- LANGKAH B: GENERATE VIDEO ---
            const i2vPrompt = prompt || "best camera movement base on picture"; 
            onStatusUpdate(`Memulai I2V (${tokenIdentifier}): "${i2vPrompt.substring(0, 30)}..."`);
            const generateBody = {
              "clientContext": { "projectId": "c971e668-3a9a-4ef0-be19-12e873af1af9", "tool": "PINHOLE", "userPaygateTier": "PAYGATE_TIER_TWO" },
              "requests": [ {
                  "aspectRatio": generateAspectRatio, "seed": seed, "textInput": { "prompt": i2vPrompt },
                  "promptExpansionInput": {
                    "prompt": "best camera movement base on picture", "seed": seed,
                    "templateId": "0TNlfC6bSF", 
                    "imageInputs": [ { "mediaId": mediaId, "imageUsageType": "IMAGE_USAGE_TYPE_UNSPECIFIED" } ]
                  },
                  "videoModelKey": apiVideoModelKey, "startImage": { "mediaId": mediaId }, "metadata": { "sceneId": sceneId }
              } ]
            };

            const genResponse = await axios.post(API_GENERATE_IMAGE_URL, generateBody, { headers: googleHeaders });
            
            const operationName = genResponse.data?.operations?.[0]?.operation?.name;
            const responseSceneId = genResponse.data?.operations?.[0]?.sceneId;
            if (!operationName || !responseSceneId) throw new Error(`Gagal memulai generate: ${JSON.stringify(genResponse.data)}`);
            
            onStatusUpdate("Menunggu video... (Ini bisa 1-3 menit)");
            let videoUrl = null;
            for (let attempts = 1; attempts <= 30; attempts++) {
                await new Promise(resolve => setTimeout(resolve, 10000));
                const statusBody = { "operations": [ { "operation": { "name": operationName }, "sceneId": responseSceneId, "status": "MEDIA_GENERATION_STATUS_PENDING" } ] };
                const statusResponse = await axios.post(API_STATUS_URL, statusBody, { headers: googleHeaders });
                const fifeUrl = statusResponse.data?.operations?.[0]?.operation?.metadata?.video?.fifeUrl;
                if (fifeUrl) { videoUrl = fifeUrl; break; }
                const failStatus = statusResponse.data?.operations?.[0]?.status;
                if (failStatus === 'MEDIA_GENERATION_STATUS_FAILED') throw new Error(statusResponse.data.operations[0].operation?.message || "Server Google gagal memproses video.");
            }
            if (!videoUrl) throw new Error('Waktu tunggu habis saat menunggu Google Veo.');

            onStatusUpdate("Mengunduh video...");
            const videoResponse = await axios.get(videoUrl, { responseType: 'arraybuffer' });
            const finalFilename = sanitizeFilename(i2vPrompt, '.mp4');
            const finalPath = path.join(savePath, finalFilename);
            fs.writeFileSync(finalPath, videoResponse.data);
            
            onStatusUpdate("Selesai!");
            return finalPath; // SUKSES!

        } catch (error) {
            let errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
            let statusCode = error.response ? error.response.status : 0;
            lastError = new Error(`(${tokenIdentifier}): ${errorMsg}`);

            // ===== PERBAIKAN DI SINI =====
            // Tambahkan 'statusCode === 401' (Unauthenticated) ke kondisi retry
            if (statusCode === 401 || statusCode === 403 || statusCode === 429) {
                onStatusUpdate(`${tokenIdentifier} gagal (Token Mati/Limit). Pindah ke token berikutnya...`);
            } else {
            // =============================
                if (errorMsg.includes("video_unsafe") || errorMsg.includes("PROMPT_REJECTED")) {
                    throw new Error(`Prompt ditolak oleh Google karena tidak aman (unsafe).`);
                }
                throw new Error(errorMsg || "Terjadi error tidak dikenal.");
            }
        }
    }
    throw lastError;
}

// Ekspor kedua fungsi
module.exports = {
    generateVideo,
    generateVideoFromImage
};


















