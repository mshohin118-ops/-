const express = require("express");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = "Пассажиры";

const googleAuth = new google.auth.GoogleAuth({
    credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n")
    },
    scopes: [
        "https://www.googleapis.com/auth/spreadsheets"
    ]
});

async function sendMessage(chatId, text) {
    const url =
        `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;

    await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            chat_id: chatId,
            text: text
        })
    });
}

async function addPassenger(values) {
    const authClient = await googleAuth.getClient();

    const sheets = google.sheets({
        version: "v4",
        auth: authClient
    });

    await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A:L`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
            values: [values]
        }
    });
}

app.get("/", (req, res) => {
    res.send("KMRN Passenger Bot работает");
});

app.post("/telegram/webhook", async (req, res) => {
    try {
        const update = req.body;

        if (update.message) {
            const chatId = update.message.chat.id;
            const text = update.message.text || "";

            if (text === "/start") {
                await sendMessage(
                    chatId,
                    "✈️ Добро пожаловать в Shohin Airlines Bot!\n\n" +
                    "Бот для учета пассажиров.\n\n" +
                    "Доступные команды:\n" +
                    "/add — добавить пассажира\n" +
                    "/help — помощь"
                );
            } else if (text === "/help") {
                await sendMessage(
                    chatId,
                    "📋 Команды бота:\n\n" +
                    "/add — добавить пассажира\n" +
                    "/help — помощь"
                );
            } else {
                await sendMessage(
                    chatId,
                    "Получил сообщение: " + text
                );
            }
        }

        res.status(200).send("OK");

    } catch (error) {
        console.error("BOT ERROR:", error);
        res.status(200).send("OK");
    }
});

app.listen(PORT, () => {
    console.log(`KMRN Passenger Bot запущен на порту ${PORT}`);
});
