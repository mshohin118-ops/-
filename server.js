const express = require("express");
const { google } = require("googleapis");

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

// =====================================
// GOOGLE AUTHENTICATION
// =====================================

const googleAuth = new google.auth.GoogleAuth({
    credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n")
    },

    scopes: [
        "https://www.googleapis.com/auth/spreadsheets"
    ]
});

// =====================================
// USER STATES
// =====================================

const userStates = {};

// Последний добавленный пассажир
const lastPassengers = {};


// =====================================
// SEND TELEGRAM MESSAGE
// =====================================

async function sendMessage(chatId, text, keyboard = null) {

    const url =
        `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;

    const body = {
        chat_id: chatId,
        text: text
    };

    if (keyboard) {

        body.reply_markup = {
            keyboard: keyboard,
            resize_keyboard: true,
            one_time_keyboard: false
        };

    }

    await fetch(url, {

        method: "POST",

        headers: {
            "Content-Type": "application/json"
        },

        body: JSON.stringify(body)

    });
}


// =====================================
// REMOVE KEYBOARD
// =====================================

async function removeKeyboard(chatId, text) {

    const url =
        `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;

    await fetch(url, {

        method: "POST",

        headers: {
            "Content-Type": "application/json"
        },

        body: JSON.stringify({

            chat_id: chatId,

            text: text,

            reply_markup: {
                remove_keyboard: true
            }

        })

    });
}


// =====================================
// MAIN MENU
// =====================================

async function showMainMenu(chatId) {

    await sendMessage(

        chatId,

        "🏠 Главное меню\n\n" +

        "Выберите необходимое действие:",

        [

            [
                "➕ Добавить пассажира"
            ],

            [
                "👤 Посмотреть данные"
            ],

            [
                "🔎 Найти пассажира"
            ],

            [
                "✈️ Пассажиры рейса"
            ],

            [
                "📊 Статистика"
            ]

        ]

    );
}


// =====================================
// START ADD PASSENGER
// =====================================

async function startAddPassenger(chatId) {

    userStates[chatId] = {

        step: 1,

        data: []

    };

    await removeKeyboard(

        chatId,

        "➕ Добавление пассажира\n\n" +

        "Шаг 1 из 11\n\n" +

        "Введите фамилию пассажира:"

    );
}


// =====================================
// ADD PASSENGER TO GOOGLE SHEETS
// =====================================

async function addPassenger(values) {

    const authClient =
        await googleAuth.getClient();

    const sheets = google.sheets({

        version: "v4",

        auth: authClient

    });

    // Получаем информацию о таблице
    const spreadsheet =
        await sheets.spreadsheets.get({

            spreadsheetId: SPREADSHEET_ID

        });

    // Берём первый лист
    const firstSheet =
        spreadsheet.data.sheets[0];

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

    // Записываем пассажира
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


// =====================================
// MAIN PAGE
// =====================================

app.get("/", (req, res) => {

    res.send(
        "Shohin Airlines Bot работает"
    );

});


// =====================================
// TELEGRAM WEBHOOK
// =====================================

app.post("/telegram/webhook", async (req, res) => {

    try {

        const update = req.body;

        // Если Telegram прислал не сообщение
        if (!update.message) {

            return res
                .status(200)
                .send("OK");

        }

        const chatId =
            update.message.chat.id;

        const text =
            update.message.text || "";


// =====================================
// START
// =====================================

        if (text === "/start") {

            delete userStates[chatId];

            await showMainMenu(chatId);

            return res
                .status(200)
                .send("OK");

        }


// =====================================
// HELP
// =====================================

        if (text === "/help") {

            delete userStates[chatId];

            await sendMessage(

                chatId,

                "📋 Помощь\n\n" +

                "➕ Добавить пассажира — регистрация нового пассажира.\n\n" +

                "👤 Посмотреть данные — просмотр последнего добавленного пассажира.\n\n" +

                "🔎 Найти пассажира — поиск пассажира.\n\n" +

                "✈️ Пассажиры рейса — список пассажиров рейса.\n\n" +

                "📊 Статистика — статистика пассажиров."

            );

            await showMainMenu(chatId);

            return res
                .status(200)
                .send("OK");

        }


// =====================================
// ADD PASSENGER BUTTON
// =====================================

        if (
            text === "➕ Добавить пассажира" ||
            text === "/add"
        ) {

            await startAddPassenger(chatId);

            return res
                .status(200)
                .send("OK");

        }


// =====================================
// MAIN MENU BUTTON
// =====================================

        if (text === "🏠 Главное меню") {

            delete userStates[chatId];

            await showMainMenu(chatId);

            return res
                .status(200)
                .send("OK");

        }


// =====================================
// VIEW LAST PASSENGER
// =====================================

        if (text === "👤 Посмотреть данные") {

            const passenger =
                lastPassengers[chatId];

            if (!passenger) {

                await sendMessage(

                    chatId,

                    "ℹ️ В этой сессии ещё не добавлен пассажир."

                );

                await showMainMenu(chatId);

                return res
                    .status(200)
                    .send("OK");

            }

            await sendMessage(

                chatId,

                "👤 Последний добавленный пассажир\n\n" +

                `🆔 ID: ${passenger.id}\n` +

                `👤 Фамилия: ${passenger.surname}\n` +

                `👤 Имя: ${passenger.name}\n` +

                `👤 Отчество: ${passenger.patronymic}\n` +

                `🎂 Дата рождения: ${passenger.birthDate}\n` +

                `🛂 Паспорт: ${passenger.passport}\n` +

                `🌍 Гражданство: ${passenger.citizenship}\n` +

                `✈️ Рейс: ${passenger.flight}\n` +

                `📅 Дата рейса: ${passenger.flightDate}\n` +

                `🗺 Маршрут: ${passenger.route}\n` +

                `🧳 Багаж: ${passenger.baggage}\n` +

                `📋 Статус: ${passenger.status}`

            );

            await showMainMenu(chatId);

            return res
                .status(200)
                .send("OK");

        }


// =====================================
// FIND PASSENGER
// =====================================

        if (text === "🔎 Найти пассажира") {

            delete userStates[chatId];

            await removeKeyboard(

                chatId,

                "🔎 Поиск пассажира\n\n" +

                "Эта функция будет подключена следующим этапом."

            );

            await showMainMenu(chatId);

            return res
                .status(200)
                .send("OK");

        }


// =====================================
// PASSENGERS BY FLIGHT
// =====================================

        if (text === "✈️ Пассажиры рейса") {

            delete userStates[chatId];

            await removeKeyboard(

                chatId,

                "✈️ Пассажиры рейса\n\n" +

                "Эта функция будет подключена следующим этапом."

            );

            await showMainMenu(chatId);

            return res
                .status(200)
                .send("OK");

        }


// =====================================
// STATISTICS
// =====================================

        if (text === "📊 Статистика") {

            delete userStates[chatId];

            await removeKeyboard(

                chatId,

                "📊 Статистика\n\n" +

                "Эта функция будет подключена следующим этапом."

            );

            await showMainMenu(chatId);

            return res
                .status(200)
                .send("OK");

        }


// =====================================
// PASSENGER REGISTRATION
// =====================================

        if (userStates[chatId]) {

            const state =
                userStates[chatId];


// =====================================
// STEP 1 — SURNAME
// =====================================

            if (state.step === 1) {

                state.data.push(text);

                state.step = 2;

                await removeKeyboard(

                    chatId,

                    "Шаг 2 из 11\n\n" +

                    "Введите имя пассажира:"

                );

                return res
                    .status(200)
                    .send("OK");

            }


// =====================================
// STEP 2 — NAME
// =====================================

            if (state.step === 2) {

                state.data.push(text);

                state.step = 3;

                await removeKeyboard(

                    chatId,

                    "Шаг 3 из 11\n\n" +

                    "Введите отчество пассажира:"

                );

                return res
                    .status(200)
                    .send("OK");

            }


// =====================================
// STEP 3 — PATRONYMIC
// =====================================

            if (state.step === 3) {

                state.data.push(text);

                state.step = 4;

                await removeKeyboard(

                    chatId,

                    "Шаг 4 из 11\n\n" +

                    "Введите дату рождения:"

                );

                return res
                    .status(200)
                    .send("OK");

            }


// =====================================
// STEP 4 — DATE OF BIRTH
// =====================================

            if (state.step === 4) {

                state.data.push(text);

                state.step = 5;

                await removeKeyboard(

                    chatId,

                    "Шаг 5 из 11\n\n" +

                    "Введите номер паспорта:"

                );

                return res
                    .status(200)
                    .send("OK");

            }


// =====================================
// STEP 5 — PASSPORT
// =====================================

            if (state.step === 5) {

                state.data.push(text);

                state.step = 6;

                await removeKeyboard(

                    chatId,

                    "Шаг 6 из 11\n\n" +

                    "Введите гражданство:"

                );

                return res
                    .status(200)
                    .send("OK");

            }


// =====================================
// STEP 6 — CITIZENSHIP
// =====================================

            if (state.step === 6) {

                state.data.push(text);

                state.step = 7;

                await removeKeyboard(

                    chatId,

                    "Шаг 7 из 11\n\n" +

                    "Введите номер рейса:"

                );

                return res
                    .status(200)
                    .send("OK");

            }


// =====================================
// STEP 7 — FLIGHT NUMBER
// =====================================

            if (state.step === 7) {

                state.data.push(text);

                state.step = 8;

                await sendMessage(

                    chatId,

                    "Шаг 8 из 11\n\n" +

                    "✈️ Выберите маршрут:",

                    [

                        [
                            "✈️ ДШБ — ХРГ",
                            "✈️ ХРГ — ДШБ"
                        ]

                    ]

                );

                return res
                    .status(200)
                    .send("OK");

            }


// =====================================
// STEP 8 — ROUTE
// =====================================

            if (state.step === 8) {

                const routes = [

                    "✈️ ДШБ — ХРГ",
                    "✈️ ХРГ — ДШБ"

                ];

                if (!routes.includes(text)) {

                    await sendMessage(

                        chatId,

                        "❗ Пожалуйста, выберите маршрут с помощью кнопки."

                    );

                    return res
                        .status(200)
                        .send("OK");

                }

                state.data.push(text);

                state.step = 9;

                await removeKeyboard(

                    chatId,

                    "Шаг 9 из 11\n\n" +

                    "Введите дату рейса:"

                );

                return res
                    .status(200)
                    .send("OK");

            }


// =====================================
// STEP 9 — FLIGHT DATE
// =====================================

            if (state.step === 9) {

                state.data.push(text);

                state.step = 10;

                await sendMessage(

                    chatId,

                    "Шаг 10 из 11\n\n" +

                    "🧳 Выберите количество багажа:",

                    [

                        [
                            "0 мест"
                        ],

                        [
                            "1 место",
                            "2 места"
                        ],

                        [
                            "3 места",
                            "4 места"
                        ]

                    ]

                );

                return res
                    .status(200)
                    .send("OK");

            }


// =====================================
// STEP 10 — BAGGAGE
// =====================================

            if (state.step === 10) {

                const baggageOptions = [

                    "0 мест",
                    "1 место",
                    "2 места",
                    "3 места",
                    "4 места"

                ];

                if (!baggageOptions.includes(text)) {

                    await sendMessage(

                        chatId,

                        "❗ Пожалуйста, выберите количество багажа с помощью кнопки."

                    );

                    return res
                        .status(200)
                        .send("OK");

                }

                state.data.push(text);

                state.step = 11;

                await sendMessage(

                    chatId,

                    "Шаг 11 из 11\n\n" +

                    "📋 Выберите статус пассажира:",

                    [

                        [
                            "✅ Подтвержден"
                        ],

                        [
                            "⏳ Ожидание"
                        ],

                        [
                            "❌ Отменен"
                        ]

                    ]

                );

                return res
                    .status(200)
                    .send("OK");

            }


// =====================================
// STEP 11 — STATUS
// =====================================

            if (state.step === 11) {

                const statusOptions = [

                    "✅ Подтвержден",
                    "⏳ Ожидание",
                    "❌ Отменен"

                ];

                if (!statusOptions.includes(text)) {

                    await sendMessage(

                        chatId,

                        "❗ Пожалуйста, выберите статус с помощью кнопки."

                    );

                    return res
                        .status(200)
                        .send("OK");

                }

                state.data.push(text);


// =====================================
// CREATE PASSENGER ID
// =====================================

                const passengerId =
                    Date.now();


// =====================================
// CREATE ROW
// =====================================
//
// A = ID
// B = Фамилия
// C = Имя
// D = Отчество
// E = Дата рождения
// F = Паспорт
// G = Гражданство
// H = Рейс
// I = Дата рейса
// J = Маршрут
// K = Багаж
// L = Статус
//
// =====================================

                const row = [

                    passengerId,

                    state.data[0],  // B — Фамилия
                    state.data[1],  // C — Имя
                    state.data[2],  // D — Отчество
                    state.data[3],  // E — Дата рождения
                    state.data[4],  // F — Паспорт
                    state.data[5],  // G — Гражданство
                    state.data[6],  // H — Рейс

                    state.data[8],  // I — Дата рейса
                    state.data[7],  // J — Маршрут

                    state.data[9],  // K — Багаж
                    state.data[10]  // L — Статус

                ];


// =====================================
// SAVE TO GOOGLE SHEETS
// =====================================

                await addPassenger(row);


// =====================================
// SAVE LAST PASSENGER
// =====================================

                lastPassengers[chatId] = {

                    id: passengerId,

                    surname: state.data[0],

                    name: state.data[1],

                    patronymic: state.data[2],

                    birthDate: state.data[3],

                    passport: state.data[4],

                    citizenship: state.data[5],

                    flight: state.data[6],

                    route: state.data[7],

                    flightDate: state.data[8],

                    baggage: state.data[9],

                    status: state.data[10]

                };


// =====================================
// CLEAR REGISTRATION
// =====================================

                delete userStates[chatId];


// =====================================
// SUCCESS + ACTION MENU
// =====================================

                await sendMessage(

                    chatId,

                    "✅ Пассажир успешно добавлен!\n\n" +

                    `🆔 ID пассажира: ${passengerId}\n\n` +

                    "Данные сохранены в Google Таблицу.\n\n" +

                    "Выберите следующее действие:",

                    [

                        [
                            "➕ Добавить ещё одного"
                        ],

                        [
                            "👤 Посмотреть данные"
                        ],

                        [
                            "🏠 Главное меню"
                        ]

                    ]

                );

                return res
                    .status(200)
                    .send("OK");

            }

        }


// =====================================
// ADD ANOTHER PASSENGER
// =====================================

        if (text === "➕ Добавить ещё одного") {

            await startAddPassenger(chatId);

            return res
                .status(200)
                .send("OK");

        }


// =====================================
// UNKNOWN COMMAND
// =====================================

        await sendMessage(

            chatId,

            "❓ Неизвестная команда.\n\n" +

            "Пожалуйста, выберите действие из меню."

        );

        await showMainMenu(chatId);

        return res
            .status(200)
            .send("OK");


    } catch (error) {

        console.error(
            "BOT ERROR:",
            error.message
        );

        return res
            .status(200)
            .send("OK");

    }

});


// =====================================
// START SERVER
// =====================================

app.listen(PORT, () => {

    console.log(
        `Shohin Airlines Bot запущен на порту ${PORT}`
    );

});
