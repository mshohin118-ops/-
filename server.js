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
// SEND INLINE BUTTONS
// =====================================

async function sendInlineMessage(chatId, text, buttons) {

    const url =
        `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;

    const body = {

        chat_id: chatId,

        text: text,

        reply_markup: {
            inline_keyboard: buttons
        }

    };

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
// ANSWER CALLBACK
// =====================================

async function answerCallbackQuery(callbackId) {

    const url =
        `https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`;

    await fetch(url, {

        method: "POST",

        headers: {
            "Content-Type": "application/json"
        },

        body: JSON.stringify({

            callback_query_id: callbackId

        })

    });
}


// =====================================
// REMOVE INLINE BUTTONS
// =====================================

async function removeInlineButtons(chatId, messageId) {

    const url =
        `https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageReplyMarkup`;

    await fetch(url, {

        method: "POST",

        headers: {
            "Content-Type": "application/json"
        },

        body: JSON.stringify({

            chat_id: chatId,

            message_id: messageId,

            reply_markup: {
                inline_keyboard: []
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

        "Шаг 1 из 9\n\n" +

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


    const spreadsheet =
        await sheets.spreadsheets.get({

            spreadsheetId: SPREADSHEET_ID

        });


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


    await sheets.spreadsheets.values.append({

        spreadsheetId: SPREADSHEET_ID,

        range: `${sheetTitle}!A:J`,

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


// =====================================
// CALLBACK QUERY — INLINE BUTTONS
// =====================================

        if (update.callback_query) {

            const callback =
                update.callback_query;

            const chatId =
                callback.message.chat.id;

            const messageId =
                callback.message.message_id;

            const data =
                callback.data;


            const state =
                userStates[chatId];


            await answerCallbackQuery(
                callback.id
            );


            if (!state) {

                await removeInlineButtons(
                    chatId,
                    messageId
                );

                return res
                    .status(200)
                    .send("OK");

            }


// =====================================
// ROUTE BUTTONS — STEP 8
// =====================================

            if (
                state.step === 8 &&
                (
                    data === "route_dshb_khrg" ||
                    data === "route_khrg_dshb"
                )
            ) {

                let route = "";

                if (data === "route_dshb_khrg") {

                    route = "✈️ ДШБ — ХРГ";

                }

                if (data === "route_khrg_dshb") {

                    route = "✈️ ХРГ — ДШБ";

                }


                state.data.push(route);

                state.step = 9;


                await removeInlineButtons(
                    chatId,
                    messageId
                );


                await sendInlineMessage(

                    chatId,

                    "Шаг 9 из 9\n\n" +
                    "📋 Выберите статус пассажира:",

                    [

                        [
                            {
                                text: "✅ Подтвержден",
                                callback_data: "status_confirmed"
                            }
                        ],

                        [
                            {
                                text: "⏳ Ожидание",
                                callback_data: "status_waiting"
                            }
                        ],

                        [
                            {
                                text: "❌ Отменен",
                                callback_data: "status_cancelled"
                            }
                        ]

                    ]

                );


                return res
                    .status(200)
                    .send("OK");

            }


// =====================================
// STATUS BUTTONS — STEP 9
// =====================================

            if (
                state.step === 9 &&
                (
                    data === "status_confirmed" ||
                    data === "status_waiting" ||
                    data === "status_cancelled"
                )
            ) {

                let status = "";


                if (data === "status_confirmed") {

                    status = "✅ Подтвержден";

                }

                if (data === "status_waiting") {

                    status = "⏳ Ожидание";

                }

                if (data === "status_cancelled") {

                    status = "❌ Отменен";

                }


                state.data.push(status);


                await removeInlineButtons(
                    chatId,
                    messageId
                );


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
// H = Дата рейса
// I = Маршрут
// J = Статус
//
// =====================================

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
                    state.data[8]

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

                    flightDate: state.data[6],

                    route: state.data[7],

                    status: state.data[8]

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


            return res
                .status(200)
                .send("OK");

        }


// =====================================
// NORMAL MESSAGE
// =====================================

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
// ADD PASSENGER
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
// ADD ANOTHER PASSENGER
// =====================================

        if (text === "➕ Добавить ещё одного") {

            await startAddPassenger(chatId);

            return res
                .status(200)
                .send("OK");

        }


// =====================================
// MAIN MENU
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

                `📅 Дата рейса: ${passenger.flightDate}\n` +

                `🗺 Маршрут: ${passenger.route}\n` +

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

                    "Шаг 2 из 9\n\n" +
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

                    "Шаг 3 из 9\n\n" +
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

                    "Шаг 4 из 9\n\n" +
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

                    "Шаг 5 из 9\n\n" +
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

                    "Шаг 6 из 9\n\n" +
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

                    "Шаг 7 из 9\n\n" +
                    "Введите дату рейса:"

                );

                return res
                    .status(200)
                    .send("OK");

            }


// =====================================
// STEP 7 — FLIGHT DATE
// =====================================

            if (state.step === 7) {

                state.data.push(text);

                state.step = 8;


                await sendInlineMessage(

                    chatId,

                    "Шаг 8 из 9\n\n" +
                    "✈️ Выберите маршрут:",

                    [

                        [
                            {
                                text: "✈️ ДШБ — ХРГ",
                                callback_data: "route_dshb_khrg"
                            }
                        ],

                        [
                            {
                                text: "✈️ ХРГ — ДШБ",
                                callback_data: "route_khrg_dshb"
                            }
                        ]

                    ]

                );


                return res
                    .status(200)
                    .send("OK");

            }


// =====================================
// STEP 8
// =====================================
//
// Выбор маршрута теперь происходит
// через Inline Keyboard.
// Поэтому обычный текст здесь
// не принимаем.
//
// =====================================

            if (state.step === 8) {

                await sendMessage(

                    chatId,

                    "❗ Пожалуйста, выберите маршрут с помощью кнопки под сообщением."

                );

                return res
                    .status(200)
                    .send("OK");

            }


// =====================================
// STEP 9
// =====================================
//
// Выбор статуса также происходит
// через Inline Keyboard.
//
// =====================================

            if (state.step === 9) {

                await sendMessage(

                    chatId,

                    "❗ Пожалуйста, выберите статус с помощью кнопки под сообщением."

                );

                return res
                    .status(200)
                    .send("OK");

            }

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
