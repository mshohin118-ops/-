const express = require("express");
const { google } = require("googleapis");

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

// ===============================
// GOOGLE AUTHENTICATION
// ===============================

const googleAuth = new google.auth.GoogleAuth({
    credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n")
    },
    scopes: [
        "https://www.googleapis.com/auth/spreadsheets"
    ]
});

// ===============================
// USER STATES
// ===============================

const userStates = {};

// ===============================
// TELEGRAM SEND MESSAGE
// ===============================

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

// ===============================
// ADD PASSENGER TO GOOGLE SHEETS
// ===============================

async function addPassenger(values) {

    const authClient = await googleAuth.getClient();

    const sheets = google.sheets({
        version: "v4",
        auth: authClient
    });

    // Получаем информацию о таблице
    const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID
    });

    const firstSheet = spreadsheet.data.sheets[0];

    if (!firstSheet) {
        throw new Error(
            "В Google Таблице не найден ни один лист"
        );
    }

    const sheetTitle =
        firstSheet.properties.title;

    console.log(
        "Google Sheet:",
        sheetTitle
    );

    // Записываем данные в первый лист
    await sheets.spreadsheets.values.append({

        spreadsheetId: SPREADSHEET_ID,

        range: `${sheetTitle}!A:L`,

        valueInputOption: "USER_ENTERED",

        requestBody: {
            values: [values]
        }
    });

    console.log(
        "Пассажир успешно записан в Google Sheets"
    );
}

// ===============================
// MAIN PAGE
// ===============================

app.get("/", (req, res) => {

    res.send(
        "Shohin Airlines Bot работает"
    );
});

// ===============================
// TELEGRAM WEBHOOK
// ===============================

app.post("/telegram/webhook", async (req, res) => {

    try {

        const update = req.body;

        if (!update.message) {

            return res
                .status(200)
                .send("OK");
        }

        const chatId =
            update.message.chat.id;

        const text =
            update.message.text || "";

        console.log(
            "Telegram message:",
            text
        );

        // ===============================
        // START
        // ===============================

        if (text === "/start") {

            delete userStates[chatId];

            await sendMessage(
                chatId,

                "✈️ Добро пожаловать в Shohin Airlines Bot!\n\n" +

                "Система учета пассажиров Shohin Airlines.\n\n" +

                "Доступные команды:\n\n" +

                "/add — добавить пассажира\n" +

                "/help — помощь"
            );

            return res
                .status(200)
                .send("OK");
        }

        // ===============================
        // HELP
        // ===============================

        if (text === "/help") {

            await sendMessage(
                chatId,

                "📋 Доступные команды:\n\n" +

                "/add — добавить пассажира\n" +

                "/help — помощь"
            );

            return res
                .status(200)
                .send("OK");
        }

        // ===============================
        // ADD PASSENGER
        // ===============================

        if (text === "/add") {

            userStates[chatId] = {

                step: 1,

                data: []
            };

            await sendMessage(
                chatId,

                "➕ Добавление пассажира\n\n" +

                "Шаг 1 из 11\n\n" +

                "Введите фамилию пассажира:"
            );

            return res
                .status(200)
                .send("OK");
        }

        // ===============================
        // PASSENGER DATA
        // ===============================

        if (userStates[chatId]) {

            const state =
                userStates[chatId];

            state.data.push(text);

            const questions = [

                "Введите имя пассажира:",

                "Введите отчество пассажира:",

                "Введите дату рождения:",

                "Введите номер паспорта:",

                "Введите гражданство:",

                "Введите номер рейса:",

                "Введите дату рейса:",

                "Введите маршрут:",

                "Введите количество багажа:",

                "Введите статус пассажира:"

            ];

            // ===============================
            // NEXT QUESTION
            // ===============================

            if (state.step < 11) {

                state.step++;

                await sendMessage(
                    chatId,

                    `Шаг ${state.step} из 11\n\n` +

                    questions[state.step - 2]
                );

                return res
                    .status(200)
                    .send("OK");
            }

            // ===============================
            // CREATE PASSENGER ID
            // ===============================

            const passengerId =
                Date.now();

            // ===============================
            // CREATE ROW
            // ===============================

            const row = [

                passengerId,

                state.data[0],

                state.data[1],

                state.data[2],

                state.data[3],

                state.data[4],

                state.data[5],

                state.data[6],

                state.data[7],

                state.data[8],

                state.data[9],

                state.data[10]

            ];

            console.log(
                "Добавляем пассажира с ID:",
                passengerId
            );

            // ===============================
            // SAVE TO GOOGLE SHEETS
            // ===============================

            await addPassenger(row);

            // ===============================
            // CLEAR USER STATE
            // ===============================

            delete userStates[chatId];

            // ===============================
            // SUCCESS MESSAGE
            // ===============================

            await sendMessage(
                chatId,

                "✅ Пассажир успешно добавлен!\n\n" +

                `ID пассажира: ${passengerId}\n\n` +

                "Данные сохранены в Google Таблицу."
            );

            return res
                .status(200)
                .send("OK");
        }

        // ===============================
        // UNKNOWN COMMAND
        // ===============================

        await sendMessage(
            chatId,

            "❓ Неизвестная команда.\n\n" +

            "Используйте /help."
        );

        return res
            .status(200)
            .send("OK");

    } catch (error) {

        console.error(
            "BOT ERROR:",
            error.message
        );

        console.error(
            "FULL ERROR:",
            error
        );

        return res
            .status(200)
            .send("OK");
    }
});

// ===============================
// START SERVER
// ===============================

app.listen(PORT, () => {

    console.log(
        `Shohin Airlines Bot запущен на порту ${PORT}`
    );

});
