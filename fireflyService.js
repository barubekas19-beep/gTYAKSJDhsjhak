const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// --- URL API ---
const API_GENERATE_TEXT_URL = 'https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoText';
const API_UPLOAD_URL = 'https://aisandbox-pa.googleapis.com/v1:uploadUserImage';
const API_GENERATE_IMAGE_URL = 'https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoStartImage';
const API_STATUS_URL = 'https://aisandbox-pa.googleapis.com/v1/video:batchCheckAsyncVideoGenerationStatus';
const API_UPSCALE_URL = 'https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoUpsampleVideo'; 
// ===================================

// ===== TOKEN LOKAL ANDA =====
const ALL_TOKENS = [
  "ya29.a0ATi6K2vF_DsC6cQguEKaL4w2acRYDInrUpYr1bHeJ01FbD45XAWdkHSz9QZf00j1qQ0AVToOHQAAJU8hohcCj5RhjY17iONYgaxQGdm3wTrjssUgn_UKzKb8omd9CLsy8LEuA25eTzlOvPo6amUM_-SMsWE6AV2MnBLe0rW-0rxCM-t_bJMSJR8hiuS3Zra9QBUOp2O1pXmH242EyGmltVKof4X_ux7n4GbYEi2zE02fXVr0NYI4KQNW47iUKMd-S-XBSF587MEcBFpfa7BiMaTYZmUGq8HfgghnxZVm1LJRwZwnRtDVab6bIQPELvHhTPcgmcwusogbJgNEBC84QNs2hGs_MP8FIEiC0UXa-QaCgYKAV4SARcSFQHGX2Mi7IL6PmjtUkqwk3LhxmQSQg0369"
];
// ===================================

// PROJEK ID MASTER (Yang terbukti jalan di T2V)
const MASTER_PROJECT_ID = "d4b08afb-1a05-4513-a216-f3a7ffaf6147";

// === FUNGSI UTILITAS ===
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


// --- FUNGSI T2V (Text to Video) ---
async function generateVideo(settings, onStatusUpdate) {
    const { prompt, aspectRatio, quality, seed: seedInput, videoModelKey: modelKeyInput } = settings;
    const savePath = path.join(__dirname, 'downloads');
    if (!fs.existsSync(savePath)) fs.mkdirSync(savePath);

    const isUpscale = quality === '1080p'; 

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

            onStatusUpdate(`Memulai T2V (${tokenIdentifier}): "${cleanPrompt.substring(0, 30)}..." (Tahap 1: Generate 720p)`);
            
            const generateBody = {
              "clientContext": { "projectId": MASTER_PROJECT_ID, "tool": "PINHOLE", "userPaygateTier": "PAYGATE_TIER_TWO" },
              "requests": [ {
                  "aspectRatio": apiAspectRatio, 
                  "seed": seed, 
                  "textInput": { "prompt": cleanPrompt },
                  "videoModelKey": apiVideoModelKey, 
                  "metadata": { "sceneId": sceneId }
              } ]
            };

            const genResponse = await axios.post(API_GENERATE_TEXT_URL, generateBody, { headers: googleHeaders });
            
            let operationName = genResponse.data?.operations?.[0]?.operation?.name;
            let responseSceneId = genResponse.data?.operations?.[0]?.sceneId;
            if (!operationName || !responseSceneId) throw new Error(`Gagal memulai generate: ${JSON.stringify(genResponse.data)}`);
            
            onStatusUpdate("Menunggu video dasar (720p)... (1-2 menit)");
            let videoUrl = null;
            let fullMetadata = null; 

            for (let attempts = 1; attempts <= 30; attempts++) {
                await new Promise(resolve => setTimeout(resolve, 10000));
                const statusBody = { "operations": [ { "operation": { "name": operationName }, "sceneId": responseSceneId, "status": "MEDIA_GENERATION_STATUS_PENDING" } ] };
                const statusResponse = await axios.post(API_STATUS_URL, statusBody, { headers: googleHeaders });
                
                const opResult = statusResponse.data?.operations?.[0];
                const fifeUrl = opResult?.operation?.metadata?.video?.fifeUrl;
                
                if (fifeUrl) { 
                    videoUrl = fifeUrl; 
                    fullMetadata = opResult.operation.metadata; 
                    break; 
                }
                const failStatus = opResult?.status;
                if (failStatus === 'MEDIA_GENERATION_STATUS_FAILED') throw new Error(opResult.operation?.error?.message || "Server Google gagal memproses video.");
            }
            if (!videoUrl) throw new Error('Waktu tunggu habis saat menunggu video dasar.');


            // --- TAHAP 2: UPSCALE ---
            if (isUpscale && fullMetadata) {
                const idToUse = fullMetadata.video?.mediaGenerationId || fullMetadata.video?.mediaId || fullMetadata.id || fullMetadata.name;
                if (idToUse) {
                    onStatusUpdate(`🎬 Memulai Upscale ke 1080p...`);
                    const upscaleBody = {
                        "clientContext": { "projectId": MASTER_PROJECT_ID, "tool": "PINHOLE", "userPaygateTier": "PAYGATE_TIER_TWO" },
                        "requests": [{
                            "aspectRatio": apiAspectRatio, 
                            "seed": Math.floor(Math.random() * 20000), 
                            "videoModelKey": "veo_2_1080p_upsampler_8s", 
                            "videoInput": { "mediaId": idToUse },
                            "metadata": { "sceneId": responseSceneId }
                        }]
                    };
                    try {
                        const upscaleResponse = await axios.post(API_UPSCALE_URL, upscaleBody, { headers: googleHeaders });
                        if (upscaleResponse.data?.operations?.[0]) {
                            operationName = upscaleResponse.data.operations[0].operation.name;
                            responseSceneId = upscaleResponse.data.operations[0].sceneId || responseSceneId;
                            onStatusUpdate("Menunggu render 1080p... (1-2 menit lagi)");
                            let upscaleSuccess = false;
                            for (let upAttempts = 1; upAttempts <= 60; upAttempts++) {
                                await new Promise(resolve => setTimeout(resolve, 10000));
                                const upStatusBody = { "operations": [ { "operation": { "name": operationName }, "sceneId": responseSceneId, "status": "MEDIA_GENERATION_STATUS_PENDING" } ] };
                                const upStatusResponse = await axios.post(API_STATUS_URL, upStatusBody, { headers: googleHeaders });
                                const upOpResult = upStatusResponse.data?.operations?.[0];
                                const upFifeUrl = upOpResult?.operation?.metadata?.video?.fifeUrl;
                                if (upFifeUrl) {
                                    videoUrl = upFifeUrl; 
                                    upscaleSuccess = true;
                                    break;
                                }
                                if (upOpResult?.status === 'MEDIA_GENERATION_STATUS_FAILED') break; 
                            }
                            if (!upscaleSuccess) onStatusUpdate("⚠️ Upscale timeout. Mengirim versi 720p.");
                            else onStatusUpdate("✅ Upscale 1080p Berhasil!");
                        }
                    } catch (errUpscale) {
                        console.error("Upscale Request Error:", errUpscale.message);
                        onStatusUpdate("⚠️ Gagal Upscale. Mengirim versi 720p.");
                    }
                }
            }

            onStatusUpdate("Mengunduh video final...");
            const videoResponse = await axios.get(videoUrl, { responseType: 'arraybuffer' });
            const finalFilename = sanitizeFilename(prompt, '.mp4');
            const finalPath = path.join(savePath, finalFilename);
            fs.writeFileSync(finalPath, videoResponse.data);
            onStatusUpdate("Selesai!");
            return finalPath; 

        } catch (error) {
            let errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
            let statusCode = error.response ? error.response.status : 0;
            lastError = new Error(`(${tokenIdentifier}): ${errorMsg}`); 
            if (statusCode === 401 || statusCode === 403 || statusCode === 429) {
                onStatusUpdate(`${tokenIdentifier} gagal (Token Mati/Limit). Pindah ke token berikutnya...`);
            } else {
                if (errorMsg.includes("video_unsafe") || errorMsg.includes("PROMPT_REJECTED")) throw new Error(`Prompt ditolak oleh Google karena tidak aman (unsafe).`);
                throw new Error(errorMsg || "Terjadi error tidak dikenal.");
            }
        }
    }
    throw lastError;
}

// --- FUNGSI I2V (Image to Video - RESTORE ORIGINAL UPLOAD LOGIC) ---
async function generateVideoFromImage(settings, onStatusUpdate) {
    const { prompt, aspectRatio, imageBuffer, quality, seed: seedInput, videoModelKey: modelKeyInput } = settings;
    const savePath = path.join(__dirname, 'downloads');
    if (!fs.existsSync(savePath)) fs.mkdirSync(savePath);

    const isUpscale = quality === '1080p';

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
            // KEMBALI KE ASAL: Hapus Project ID di sini agar gambar tidak nyasar ke folder private
            onStatusUpdate(`(${tokenIdentifier}) Mengunggah gambar referensi...`);
            const imageBase64 = imageBuffer.toString('base64');
            const uploadBody = {
              "imageInput": { "rawImageBytes": imageBase64, "mimeType": "image/jpeg", "isUserUploaded": true, "aspectRatio": "IMAGE_ASPECT_RATIO_LANDSCAPE" },
              "clientContext": { "tool": "ASSET_MANAGER" } // TANPA Project ID
            };
            const uploadResponse = await axios.post(API_UPLOAD_URL, uploadBody, { headers: googleHeaders });
            const mediaId = uploadResponse.data?.mediaGenerationId?.mediaGenerationId;
            if (!mediaId) throw new Error("Gagal mendapatkan Media ID dari gambar yang diupload.");

            // --- LANGKAH B: GENERATE VIDEO (720p) ---
            const i2vPrompt = prompt || "best camera movement base on picture"; 
            onStatusUpdate(`Memulai I2V (${tokenIdentifier}): "${i2vPrompt.substring(0, 30)}..." (Tahap 1: Generate 720p)`);
            const generateBody = {
              "clientContext": { "projectId": MASTER_PROJECT_ID, "tool": "PINHOLE", "userPaygateTier": "PAYGATE_TIER_TWO" },
              "requests": [ {
                  "aspectRatio": generateAspectRatio, "seed": seed, "textInput": { "prompt": i2vPrompt },
                  // HAPUS promptExpansionInput (Template) KARENA SERING MENYEBABKAN 404 JIKA ID TIDAK COCOK
                  "videoModelKey": apiVideoModelKey, "startImage": { "mediaId": mediaId }, "metadata": { "sceneId": sceneId }
              } ]
            };

            const genResponse = await axios.post(API_GENERATE_IMAGE_URL, generateBody, { headers: googleHeaders });
            
            let operationName = genResponse.data?.operations?.[0]?.operation?.name;
            let responseSceneId = genResponse.data?.operations?.[0]?.sceneId;
            if (!operationName || !responseSceneId) throw new Error(`Gagal memulai generate: ${JSON.stringify(genResponse.data)}`);
            
            onStatusUpdate("Menunggu video dasar (720p)... (1-3 menit)");
            let videoUrl = null;
            let fullMetadata = null;

            for (let attempts = 1; attempts <= 30; attempts++) {
                await new Promise(resolve => setTimeout(resolve, 10000));
                const statusBody = { "operations": [ { "operation": { "name": operationName }, "sceneId": responseSceneId, "status": "MEDIA_GENERATION_STATUS_PENDING" } ] };
                const statusResponse = await axios.post(API_STATUS_URL, statusBody, { headers: googleHeaders });
                
                const opResult = statusResponse.data?.operations?.[0];
                const fifeUrl = opResult?.operation?.metadata?.video?.fifeUrl;
                
                if (fifeUrl) { 
                    videoUrl = fifeUrl; 
                    fullMetadata = opResult.operation.metadata;
                    break; 
                }
                const failStatus = opResult?.status;
                if (failStatus === 'MEDIA_GENERATION_STATUS_FAILED') throw new Error(statusResponse.data.operations[0].operation?.message || "Server Google gagal memproses video.");
            }
            if (!videoUrl) throw new Error('Waktu tunggu habis saat menunggu Google Veo.');


            // --- TAHAP 2: UPSCALE ---
            if (isUpscale && fullMetadata) {
                const idToUse = fullMetadata.video?.mediaGenerationId || fullMetadata.video?.mediaId || fullMetadata.id || fullMetadata.name;
                
                if (idToUse) {
                    onStatusUpdate(`🎬 Memulai Upscale ke 1080p...`);
                    const upscaleBody = {
                        "clientContext": { "projectId": MASTER_PROJECT_ID, "tool": "PINHOLE", "userPaygateTier": "PAYGATE_TIER_TWO" },
                        "requests": [{
                            "aspectRatio": generateAspectRatio, 
                            "seed": Math.floor(Math.random() * 20000), 
                            "videoModelKey": "veo_2_1080p_upsampler_8s", 
                            "videoInput": { "mediaId": idToUse },
                            "metadata": { "sceneId": responseSceneId }
                        }]
                    };

                    try {
                        const upscaleResponse = await axios.post(API_UPSCALE_URL, upscaleBody, { headers: googleHeaders });
                        if (upscaleResponse.data?.operations?.[0]) {
                            operationName = upscaleResponse.data.operations[0].operation.name;
                            responseSceneId = upscaleResponse.data.operations[0].sceneId || responseSceneId;
                            onStatusUpdate("Menunggu render 1080p... (1-2 menit lagi)");
                            let upscaleSuccess = false;
                            for (let upAttempts = 1; upAttempts <= 60; upAttempts++) {
                                await new Promise(resolve => setTimeout(resolve, 10000));
                                const upStatusBody = { "operations": [ { "operation": { "name": operationName }, "sceneId": responseSceneId, "status": "MEDIA_GENERATION_STATUS_PENDING" } ] };
                                const upStatusResponse = await axios.post(API_STATUS_URL, upStatusBody, { headers: googleHeaders });
                                const upOpResult = upStatusResponse.data?.operations?.[0];
                                const upFifeUrl = upOpResult?.operation?.metadata?.video?.fifeUrl;
                                if (upFifeUrl) {
                                    videoUrl = upFifeUrl; 
                                    upscaleSuccess = true;
                                    break;
                                }
                                if (upOpResult?.status === 'MEDIA_GENERATION_STATUS_FAILED') break;
                            }
                            if (!upscaleSuccess) onStatusUpdate("⚠️ Upscale timeout. Mengirim versi 720p.");
                            else onStatusUpdate("✅ Upscale 1080p Berhasil!");
                        }
                    } catch (errUpscale) {
                        console.error("Upscale I2V Error:", errUpscale.message);
                        onStatusUpdate("⚠️ Gagal Upscale. Mengirim versi 720p.");
                    }
                }
            }

            onStatusUpdate("Mengunduh video final...");
            const videoResponse = await axios.get(videoUrl, { responseType: 'arraybuffer' });
            const finalFilename = sanitizeFilename(i2vPrompt, '.mp4');
            const finalPath = path.join(savePath, finalFilename);
            fs.writeFileSync(finalPath, videoResponse.data);
            
            onStatusUpdate("Selesai!");
            return finalPath; 

        } catch (error) {
            let errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
            let statusCode = error.response ? error.response.status : 0;
            lastError = new Error(`(${tokenIdentifier}): ${errorMsg}`);

            if (statusCode === 401 || statusCode === 403 || statusCode === 429) {
                onStatusUpdate(`${tokenIdentifier} gagal (Token Mati/Limit). Pindah ke token berikutnya...`);
            } else {
                if (errorMsg.includes("video_unsafe") || errorMsg.includes("PROMPT_REJECTED")) {
                    throw new Error(`Prompt ditolak oleh Google karena tidak aman (unsafe).`);
                }
                throw new Error(errorMsg || "Terjadi error tidak dikenal.");
            }
        }
    }
    throw lastError;
}

module.exports = {
    generateVideo,
    generateVideoFromImage
};



