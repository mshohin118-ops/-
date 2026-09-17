const express = require("express");
const { google } = require("googleapis");

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = "Пассажиры";

// ===============================
// GOOGLE SHEETS
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
// ВРЕМЕННОЕ СОСТОЯНИЕ ПОЛЬЗОВАТЕЛЕЙ
// ===============================

const userStates = {};

// ===============================
// ОТПРАВКА СООБЩЕНИЯ В TELEGRAM
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
// ДОБАВЛЕНИЕ ПАССАЖИРА В GOOGLE SHEETS
// ===============================

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

// ===============================
// ГЛАВНАЯ СТРАНИЦА
// ===============================

app.get("/", (req, res) => {
    res.send("Shohin Airlines Bot работает");
});

// ===============================
// TELEGRAM WEBHOOK
// ===============================

app.post("/telegram/webhook", async (req, res) => {

    try {

        const update = req.body;

        if (!update.message) {
            return res.status(200).send("OK");
        }

        const chatId = update.message.chat.id;
        const text = update.message.text || "";

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

            return res.status(200).send("OK");
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

            return res.status(200).send("OK");
        }

        // ===============================
        // ADD
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

            return res.status(200).send("OK");
        }

        // ===============================
        // ДОБАВЛЕНИЕ ПАССАЖИРА
        // ===============================

        if (userStates[chatId]) {

            const state = userStates[chatId];

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

            // Если это еще не последний вопрос

            if (state.step < 11) {

                state.step++;

                await sendMessage(
                    chatId,

                    `Шаг ${state.step} из 11\n\n` +
                    questions[state.step - 2]
                );

                return res.status(200).send("OK");
            }

            // ===============================
            // СОЗДАЕМ ID
            // ===============================

            const passengerId = Date.now();

            // ===============================
            // ФОРМИРУЕМ СТРОКУ
            // ===============================

            const row = [

                passengerId,

                state.data[0],  // Фамилия

                state.data[1],  // Имя

                state.data[2],  // Отчество

                state.data[3],  // Дата рождения

                state.data[4],  // Паспорт

                state.data[5],  // Гражданство

                state.data[6],  // Рейс

                state.data[7],  // Дата рейса

                state.data[8],  // Маршрут

                state.data[9],  // Багаж

                state.data[10]  // Статус

            ];

            // ===============================
            // ЗАПИСЫВАЕМ В GOOGLE SHEETS
            // ===============================

            await addPassenger(row);

            delete userStates[chatId];

            // ===============================
            // ПОДТВЕРЖДЕНИЕ
            // ===============================

            await sendMessage(
                chatId,

                "✅ Пассажир успешно добавлен!\n\n" +

                `ID пассажира: ${passengerId}\n\n` +

                "Данные сохранены в Google Таблицу."
            );

            return res.status(200).send("OK");
        }

        // ===============================
        // НЕИЗВЕСТНАЯ КОМАНДА
        // ===============================

        await sendMessage(
            chatId,

            "❓ Неизвестная команда.\n\n" +

            "Используйте /help для просмотра доступных команд."
        );

        return res.status(200).send("OK");

    } catch (error) {

        console.error("BOT ERROR:", error);

        return res.status(200).send("OK");
    }
});

// ===============================
// ЗАПУСК СЕРВЕРА
// ===============================

app.listen(PORT, () => {

    console.log(
        `Shohin Airlines Bot запущен на порту ${PORT}`
    );

});
