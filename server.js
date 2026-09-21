const express = require("express");
const { google } = require("googleapis");

const app = express();

app.use(express.json());


// =====================================================
// ENV
// =====================================================

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;

const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY
    ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n")
    : "";

const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;

const TELEGRAM_WEBHOOK_SECRET =
    process.env.TELEGRAM_WEBHOOK_SECRET;

const PUBLIC_URL = process.env.PUBLIC_URL;


// =====================================================
// GOOGLE SHEETS
// =====================================================

const auth = new google.auth.GoogleAuth({
    credentials: {
        client_email: GOOGLE_CLIENT_EMAIL,
        private_key: GOOGLE_PRIVATE_KEY
    },
    scopes: [
        "https://www.googleapis.com/auth/spreadsheets"
    ]
});

const sheets = google.sheets({
    version: "v4",
    auth
});


// =====================================================
// TELEGRAM
// =====================================================

async function telegramRequest(method, body = {}) {

    const response = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        }
    );

    return await response.json();
}


async function sendMessage(chatId, text, replyMarkup = null) {

    const body = {
        chat_id: chatId,
        text
    };

    if (replyMarkup) {
        body.reply_markup = replyMarkup;
    }

    return telegramRequest("sendMessage", body);
}


async function editInlineMessage(
    chatId,
    messageId,
    text,
    replyMarkup = null
) {

    const body = {
        chat_id: chatId,
        message_id: messageId,
        text
    };

    if (replyMarkup) {
        body.reply_markup = replyMarkup;
    }

    return telegramRequest("editMessageText", body);
}


async function answerCallbackQuery(callbackQueryId) {

    return telegramRequest("answerCallbackQuery", {
        callback_query_id: callbackQueryId
    });
}


// =====================================================
// USER STATES
// =====================================================

const userStates = {};


// =====================================================
// MONTHS / WEEKDAYS
// =====================================================

const MONTHS = [
    "Январь",
    "Февраль",
    "Март",
    "Апрель",
    "Май",
    "Июнь",
    "Июль",
    "Август",
    "Сентябрь",
    "Октябрь",
    "Ноябрь",
    "Декабрь"
];

const WEEKDAYS = [
    "Пн",
    "Вт",
    "Ср",
    "Чт",
    "Пт",
    "Сб",
    "Вс"
];


// =====================================================
// STATE
// =====================================================

function createState() {

    return {
        step: 0,

        data: {},

        calendarType: null,

        calendarPage: 0,

        editingField: null,

        rowNumber: null,

        calendarYear: null,

        calendarMonth: null
    };
}


// =====================================================
// MAIN MENU
// =====================================================

function mainMenuKeyboard() {

    return {
        inline_keyboard: [
            [
                {
                    text: "➕ Добавить пассажира",
                    callback_data: "main_add_passenger"
                }
            ],
            [
                {
                    text: "👤 Посмотреть данные",
                    callback_data: "main_view_data"
                }
            ],
            [
                {
                    text: "🔎 Найти пассажира",
                    callback_data: "main_find_passenger"
                }
            ],
            [
                {
                    text: "✈️ Пассажиры рейса",
                    callback_data: "main_flight_passengers"
                }
            ],
            [
                {
                    text: "📊 Статистика",
                    callback_data: "main_statistics"
                }
            ]
        ]
    };
}


async function showMainMenu(chatId, messageId = null) {

    const text = "🏠 Главное меню";

    if (messageId) {

        await editInlineMessage(
            chatId,
            messageId,
            text,
            mainMenuKeyboard()
        );

    } else {

        await sendMessage(
            chatId,
            text,
            mainMenuKeyboard()
        );
    }
}


// =====================================================
// PREVIOUS STEP BUTTON
// =====================================================

function previousStepKeyboard(step) {

    return {
        inline_keyboard: [
            [
                {
                    text: "↩️ Изменить предыдущий шаг",
                    callback_data: "previous_step"
                }
            ]
        ]
    };
}


// =====================================================
// BIRTH CALENDAR TITLE
// =====================================================

function getCalendarTitle(type, level) {

    if (type === "birth") {

        if (level === "year") {
            return "🎂 Выберите год рождения:";
        }

        if (level === "month") {
            return "🎂 Выберите месяц рождения:";
        }

        if (level === "day") {
            return "🎂 Выберите день рождения:";
        }
    }

    if (type === "flight") {

        return "📅 Выберите дату рейса:";
    }

    return "📅 Выберите дату:";
}


// =====================================================
// FORMAT DATE
// =====================================================

function formatDate(day, month, year) {

    const d = String(day).padStart(2, "0");

    const m = String(month + 1).padStart(2, "0");

    return `${d}.${m}.${year}`;
}


// =====================================================
// YEARS CALENDAR
// =====================================================

async function showYears(
    chatId,
    messageId,
    type,
    page = 0
) {

    const currentYear = new Date().getFullYear();

    let startYear;
    let endYear;

    if (type === "birth") {

        startYear = currentYear - (page + 1) * 12 + 1;

        endYear = currentYear - page * 12;

        if (startYear < 1940) {
            startYear = 1940;
        }

    } else {

        startYear = currentYear + page * 12;

        endYear = currentYear + 5;

        if (startYear > endYear) {
            startYear = endYear;
        }
    }

    const keyboard = [];

    let row = [];

    for (
        let year = startYear;
        year <= endYear;
        year++
    ) {

        row.push({
            text: String(year),
            callback_data: `calendar_year:${type}:${year}`
        });

        if (row.length === 3) {

            keyboard.push(row);

            row = [];
        }
    }

    if (row.length > 0) {
        keyboard.push(row);
    }


    const navigation = [];

    if (type === "birth") {

        if (startYear > 1940) {

            navigation.push({
                text: "⬅️ Старше",
                callback_data: `calendar_year_page:${type}:${page + 1}`
            });
        }

        if (page > 0) {

            navigation.push({
                text: "➡️ Новее",
                callback_data: `calendar_year_page:${type}:${page - 1}`
            });
        }

    } else {

        if (page > 0) {

            navigation.push({
                text: "⬅️ Назад",
                callback_data: `calendar_year_page:${type}:${page - 1}`
            });
        }

        if (startYear + 11 < endYear) {

            navigation.push({
                text: "➡️ Далее",
                callback_data: `calendar_year_page:${type}:${page + 1}`
            });
        }
    }

    if (navigation.length > 0) {
        keyboard.push(navigation);
    }


    await editInlineMessage(
        chatId,
        messageId,
        getCalendarTitle(type, "year"),
        {
            inline_keyboard: keyboard
        }
    );
}


// =====================================================
// MONTH CALENDAR
// =====================================================

async function showMonths(
    chatId,
    messageId,
    type,
    year
) {

    const keyboard = [];

    let row = [];

    for (let month = 0; month < 12; month++) {

        row.push({
            text: MONTHS[month],
            callback_data:
                `calendar_month:${type}:${year}:${month}`
        });

        if (row.length === 3) {

            keyboard.push(row);

            row = [];
        }
    }

    if (row.length > 0) {
        keyboard.push(row);
    }


    keyboard.push([
        {
            text: "⬅️ Назад",
            callback_data:
                `calendar_back_year:${type}`
        }
    ]);


    await editInlineMessage(
        chatId,
        messageId,
        `${getCalendarTitle(type, "month")}\n\n${year} год`,
        {
            inline_keyboard: keyboard
        }
    );
}


// =====================================================
// DAYS CALENDAR
// =====================================================

async function showDays(
    chatId,
    messageId,
    type,
    year,
    month
) {

    const keyboard = [];

    keyboard.push(
        WEEKDAYS.map(day => ({
            text: day,
            callback_data: "ignore"
        }))
    );


    const firstDay = new Date(
        year,
        month,
        1
    );

    let startDay = firstDay.getDay();

    if (startDay === 0) {
        startDay = 7;
    }

    startDay -= 1;


    const daysInMonth = new Date(
        year,
        month + 1,
        0
    ).getDate();


    let row = [];

    for (let i = 0; i < startDay; i++) {

        row.push({
            text: " ",
            callback_data: "ignore"
        });
    }


    for (
        let day = 1;
        day <= daysInMonth;
        day++
    ) {

        row.push({
            text: String(day),
            callback_data:
                `calendar_day:${type}:${year}:${month}:${day}`
        });

        if (row.length === 7) {

            keyboard.push(row);

            row = [];
        }
    }


    if (row.length > 0) {

        while (row.length < 7) {

            row.push({
                text: " ",
                callback_data: "ignore"
            });
        }

        keyboard.push(row);
    }


    keyboard.push([
        {
            text: "⬅️ Назад",
            callback_data:
                `calendar_back_month:${type}:${year}`
        }
    ]);


    await editInlineMessage(
        chatId,
        messageId,
        `${getCalendarTitle(type, "day")}\n\n${MONTHS[month]} ${year}`,
        {
            inline_keyboard: keyboard
        }
    );
}


// =====================================================
// BIRTH CALENDAR
// =====================================================

async function showBirthCalendar(
    chatId,
    messageId
) {

    const state = userStates[chatId];

    state.calendarType = "birth";

    state.calendarPage = 0;

    await showYears(
        chatId,
        messageId,
        "birth",
        0
    );
}


// =====================================================
// FLIGHT CALENDAR
// =====================================================

async function showFlightCalendar(
    chatId,
    messageId
) {

    const state = userStates[chatId];

    state.calendarType = "flight";

    state.calendarPage = 0;

    await showYears(
        chatId,
        messageId,
        "flight",
        0
    );
}


// =====================================================
// CITIZENSHIP
// =====================================================

async function showCitizenship(
    chatId,
    messageId = null
) {

    const keyboard = {
        inline_keyboard: [
            [
                {
                    text: "🇹🇯 TJ",
                    callback_data: "citizenship:TJ"
                },
                {
                    text: "🇷🇺 RU",
                    callback_data: "citizenship:RU"
                }
            ],
            [
                {
                    text: "↩️ Изменить предыдущий шаг",
                    callback_data: "previous_step"
                }
            ]
        ]
    };


    if (messageId) {

        await editInlineMessage(
            chatId,
            messageId,
            "🌍 Выберите гражданство:",
            keyboard
        );

    } else {

        await sendMessage(
            chatId,
            "🌍 Выберите гражданство:",
            keyboard
        );
    }
}


// =====================================================
// ROUTES
// =====================================================

async function getRouteOccupancy(
    flightDate,
    route,
    excludeRowNumber = null
) {

    const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId: GOOGLE_SHEET_ID
    });

    const firstSheet =
        spreadsheet.data.sheets[0];

    const sheetTitle =
        firstSheet.properties.title;


    const result =
        await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEET_ID,
            range: `${sheetTitle}!A:K`
        });


    const rows = result.data.values || [];

    let occupied = 0;


    for (
        let i = 1;
        i < rows.length;
        i++
    ) {

        const rowNumber = i + 1;

        if (
            excludeRowNumber &&
            rowNumber === Number(excludeRowNumber)
        ) {
            continue;
        }


        const row = rows[i];


        const passengerFlightDate = row[8];

        const passengerRoute = row[9];

        const passengerStatus = row[10];


        if (
            passengerFlightDate === flightDate &&
            passengerRoute === route &&
            passengerStatus !== "Отменен"
        ) {

            occupied++;
        }
    }


    return occupied;
}


// =====================================================
// ROUTE AVAILABILITY
// =====================================================

async function checkRouteAvailability(
    flightDate,
    route,
    excludeRowNumber = null
) {

    const capacity = 19;


    const occupied =
        await getRouteOccupancy(
            flightDate,
            route,
            excludeRowNumber
        );


    const free = Math.max(
        capacity - occupied,
        0
    );


    return {
        occupied,
        free,
        available: free > 0
    };
}


// =====================================================
// ROUTE BUTTONS
// =====================================================

async function showRoutes(
    chatId,
    messageId,
    flightDate,
    excludeRowNumber = null
) {

    const route1 =
        "ДШБ — ХРГ";

    const route2 =
        "ХРГ — ДШБ";


    const availability1 =
        await checkRouteAvailability(
            flightDate,
            route1,
            excludeRowNumber
        );


    const availability2 =
        await checkRouteAvailability(
            flightDate,
            route2,
            excludeRowNumber
        );


    let text =
        "✈️ Выберите маршрут:";


    const keyboard = [];


    if (availability1.available) {

        keyboard.push([
            {
                text:
                    `✈️ ${route1} (${availability1.occupied}/19)`,
                callback_data:
                    `route:${route1}`
            }
        ]);

    } else {

        keyboard.push([
            {
                text:
                    `🔴 ${route1} (Мест нет)`,
                callback_data:
                    "route_full"
            }
        ]);
    }


    if (availability2.available) {

        keyboard.push([
            {
                text:
                    `✈️ ${route2} (${availability2.occupied}/19)`,
                callback_data:
                    `route:${route2}`
            }
        ]);

    } else {

        keyboard.push([
            {
                text:
                    `🔴 ${route2} (Мест нет)`,
                callback_data:
                    "route_full"
            }
        ]);
    }


    keyboard.push([
        {
            text: "↩️ Изменить предыдущий шаг",
            callback_data: "previous_step"
        }
    ]);


    await editInlineMessage(
        chatId,
        messageId,
        text,
        {
            inline_keyboard: keyboard
        }
    );
}


// =====================================================
// STATUS
// =====================================================

async function showStatus(
    chatId,
    messageId
) {

    await editInlineMessage(
        chatId,
        messageId,
        "📌 Выберите статус:",
        {
            inline_keyboard: [
                [
                    {
                        text: "✅ Подтвержден",
                        callback_data:
                            "status:Подтвержден"
                    }
                ],
                [
                    {
                        text: "⏳ Ожидание",
                        callback_data:
                            "status:Ожидание"
                    }
                ],
                [
                    {
                        text: "❌ Отменен",
                        callback_data:
                            "status:Отменен"
                    }
                ],
                [
                    {
                        text:
                            "↩️ Изменить предыдущий шаг",
                        callback_data:
                            "previous_step"
                    }
                ]
            ]
        }
    );
}


// =====================================================
// PASSENGER CARD
// =====================================================

function passengerText(data) {

    return (
        "👤 Данные пассажира\n\n" +

        `🆔 ID: ${data.passengerId || "-"}\n` +

        `Фамилия: ${data.surname || "-"}\n` +

        `Имя: ${data.name || "-"}\n` +

        `Отчество: ${data.patronymic || "-"}\n` +

        `🎂 Дата рождения: ${data.birthDate || "-"}\n` +

        `🛂 Паспорт: ${data.passport || "-"}\n` +

        `🌍 Гражданство: ${data.citizenship || "-"}\n` +

        `📞 Контакт: ${data.contact || "-"}\n` +

        `📅 Дата рейса: ${data.flightDate || "-"}\n` +

        `✈️ Маршрут: ${data.route || "-"}\n` +

        `📌 Статус: ${data.status || "-"}`
    );
}


// =====================================================
// SAVE PASSENGER
// =====================================================

async function savePassenger(data) {

    const spreadsheet =
        await sheets.spreadsheets.get({
            spreadsheetId: GOOGLE_SHEET_ID
        });


    const firstSheet =
        spreadsheet.data.sheets[0];


    const sheetTitle =
        firstSheet.properties.title;


    const passengerId =
        `P${Date.now()}`;


    const values = [

        passengerId,

        data.surname,

        data.name,

        data.patronymic,

        data.birthDate,

        data.passport,

        data.citizenship,

        data.contact,

        data.flightDate,

        data.route,

        data.status
    ];


    await sheets.spreadsheets.values.append({

        spreadsheetId: GOOGLE_SHEET_ID,

        range: `${sheetTitle}!A:K`,

        valueInputOption: "USER_ENTERED",

        requestBody: {
            values: [values]
        }
    });


    data.passengerId =
        passengerId;


    return passengerId;
}


// =====================================================
// UPDATE PASSENGER
// =====================================================

async function updatePassenger(
    rowNumber,
    data
) {

    const spreadsheet =
        await sheets.spreadsheets.get({
            spreadsheetId: GOOGLE_SHEET_ID
        });


    const firstSheet =
        spreadsheet.data.sheets[0];


    const sheetTitle =
        firstSheet.properties.title;


    const values = [

        data.passengerId,

        data.surname,

        data.name,

        data.patronymic,

        data.birthDate,

        data.passport,

        data.citizenship,

        data.contact,

        data.flightDate,

        data.route,

        data.status
    ];


    await sheets.spreadsheets.values.update({

        spreadsheetId: GOOGLE_SHEET_ID,

        range:
            `${sheetTitle}!A${rowNumber}:K${rowNumber}`,

        valueInputOption: "USER_ENTERED",

        requestBody: {
            values: [values]
        }
    });
}


// =====================================================
// EDIT MENU
// =====================================================

async function showEditMenu(
    chatId,
    messageId
) {

    await editInlineMessage(
        chatId,
        messageId,
        "✏️ Что хотите изменить?",
        {
            inline_keyboard: [

                [
                    {
                        text: "✏️ Фамилия",
                        callback_data:
                            "edit_field:surname"
                    }
                ],

                [
                    {
                        text: "✏️ Имя",
                        callback_data:
                            "edit_field:name"
                    }
                ],

                [
                    {
                        text: "✏️ Отчество",
                        callback_data:
                            "edit_field:patronymic"
                    }
                ],

                [
                    {
                        text: "✏️ Дата рождения",
                        callback_data:
                            "edit_field:birthDate"
                    }
                ],

                [
                    {
                        text: "✏️ Паспорт",
                        callback_data:
                            "edit_field:passport"
                    }
                ],

                [
                    {
                        text: "✏️ Гражданство",
                        callback_data:
                            "edit_field:citizenship"
                    }
                ],

                [
                    {
                        text: "✏️ Контакт",
                        callback_data:
                            "edit_field:contact"
                    }
                ],

                [
                    {
                        text: "✏️ Дата рейса",
                        callback_data:
                            "edit_field:flightDate"
                    }
                ],

                [
                    {
                        text: "✏️ Маршрут",
                        callback_data:
                            "edit_field:route"
                    }
                ],

                [
                    {
                        text: "✏️ Статус",
                        callback_data:
                            "edit_field:status"
                    }
                ],

                [
                    {
                        text: "↩️ Назад",
                        callback_data:
                            "back_to_passenger"
                    }
                ]
            ]
        }
    );
}


// =====================================================
// SAVED PASSENGER
// =====================================================

async function showSavedPassenger(
    chatId,
    data,
    messageId = null
) {

    const text =
        "✅ Данные пассажира сохранены!\n\n" +
        passengerText(data);


    const keyboard = {

        inline_keyboard: [

            [
                {
                    text: "✏️ Изменить данные",
                    callback_data:
                        "edit_passenger"
                }
            ],

            [
                {
                    text: "➕ Добавить ещё одного",
                    callback_data:
                        "main_add_passenger"
                }
            ],

            [
                {
                    text: "🏠 Главное меню",
                    callback_data:
                        "main_menu"
                }
            ]
        ]
    };


    if (messageId) {

        await editInlineMessage(
            chatId,
            messageId,
            text,
            keyboard
        );

    } else {

        await sendMessage(
            chatId,
            text,
            keyboard
        );
    }
}


// =====================================================
// START REGISTRATION
// =====================================================

async function startRegistration(
    chatId,
    messageId = null
) {

    userStates[chatId] =
        createState();


    const text =
        "👤 Введите фамилию:";


    if (messageId) {

        await editInlineMessage(
            chatId,
            messageId,
            text
        );

    } else {

        await sendMessage(
            chatId,
            text
        );
    }
}


// =====================================================
// PREVIOUS STEP
// =====================================================

async function goToPreviousStep(
    chatId,
    messageId
) {

    const state =
        userStates[chatId];


    if (!state) {
        return;
    }


    if (state.editingField) {

        state.editingField = null;

        await showSavedPassenger(
            chatId,
            state.data,
            messageId
        );

        return;
    }


    if (state.step <= 0) {

        await showMainMenu(
            chatId,
            messageId
        );

        return;
    }


    state.step--;


    // -------------------------------------------------
    // Фамилия
    // -------------------------------------------------

    if (state.step === 0) {

        await editInlineMessage(
            chatId,
            messageId,
            "👤 Введите фамилию:"
        );

        return;
    }


    // -------------------------------------------------
    // Имя
    // -------------------------------------------------

    if (state.step === 1) {

        await editInlineMessage(
            chatId,
            messageId,
            "👤 Введите имя:",
            previousStepKeyboard(1)
        );

        return;
    }


    // -------------------------------------------------
    // Отчество
    // -------------------------------------------------

    if (state.step === 2) {

        await editInlineMessage(
            chatId,
            messageId,
            "👤 Введите отчество:",
            previousStepKeyboard(2)
        );

        return;
    }


    // -------------------------------------------------
    // Дата рождения
    // -------------------------------------------------

    if (state.step === 3) {

        await showBirthCalendar(
            chatId,
            messageId
        );

        return;
    }


    // -------------------------------------------------
    // Паспорт
    // -------------------------------------------------

    if (state.step === 4) {

        await editInlineMessage(
            chatId,
            messageId,
            "🛂 Введите номер паспорта:",
            previousStepKeyboard(4)
        );

        return;
    }


    // -------------------------------------------------
    // Гражданство
    // -------------------------------------------------

    if (state.step === 5) {

        await showCitizenship(
            chatId,
            messageId
        );

        return;
    }


    // -------------------------------------------------
    // Контакт
    // -------------------------------------------------

    if (state.step === 6) {

        await editInlineMessage(
            chatId,
            messageId,
            "📞 Введите контактный номер:\n\n+992XXXXXXXXX",
            previousStepKeyboard(6)
        );

        return;
    }


    // -------------------------------------------------
    // Дата рейса
    // -------------------------------------------------

    if (state.step === 7) {

        await showFlightCalendar(
            chatId,
            messageId
        );

        return;
    }


    // -------------------------------------------------
    // Маршрут
    // -------------------------------------------------

    if (state.step === 8) {

        await showRoutes(
            chatId,
            messageId,
            state.data.flightDate,
            state.rowNumber
        );

        return;
    }


    // -------------------------------------------------
    // Статус
    // -------------------------------------------------

    if (state.step === 9) {

        await showStatus(
            chatId,
            messageId
        );

        return;
    }
}


// =====================================================
// TEXT MESSAGE
// =====================================================

async function handleTextMessage(
    message
) {

    const chatId =
        message.chat.id;


    const text =
        message.text
            ? message.text.trim()
            : "";


    // -------------------------------------------------
    // /start
    // -------------------------------------------------

    if (text === "/start") {

        await showMainMenu(chatId);

        return;
    }


    // -------------------------------------------------
    // CREATE STATE
    // -------------------------------------------------

    if (!userStates[chatId]) {

        userStates[chatId] =
            createState();
    }


    const state =
        userStates[chatId];


    // =================================================
    // EDIT TEXT FIELD
    // =================================================

    if (state.editingField) {

        const field =
            state.editingField;


        // ---------------------------------------------
        // CONTACT
        // ---------------------------------------------

        if (field === "contact") {

            let contact = text;


            if (/^\d{9}$/.test(contact)) {

                contact =
                    "+992" + contact;
            }


            if (!/^\+992\d{9}$/.test(contact)) {

                await sendMessage(
                    chatId,
                    "❌ Неверный формат номера.\n\n" +
                    "Введите таджикский номер:\n" +
                    "+992XXXXXXXXX"
                );

                return;
            }


            state.data.contact =
                contact;


            await updatePassenger(
                state.rowNumber,
                state.data
            );


            state.editingField = null;


            await showSavedPassenger(
                chatId,
                state.data
            );


            return;
        }


        // ---------------------------------------------
        // OTHER TEXT FIELDS
        // ---------------------------------------------

        if (
            field === "surname" ||
            field === "name" ||
            field === "patronymic" ||
            field === "passport"
        ) {

            if (!text) {

                await sendMessage(
                    chatId,
                    "❌ Поле не может быть пустым."
                );

                return;
            }


            state.data[field] =
                text;


            await updatePassenger(
                state.rowNumber,
                state.data
            );


            state.editingField = null;


            await showSavedPassenger(
                chatId,
                state.data
            );


            return;
        }
    }


    // =================================================
    // NORMAL REGISTRATION
    // =================================================


    // -------------------------------------------------
    // SURNAME
    // -------------------------------------------------

    if (state.step === 0) {

        if (!text) {

            await sendMessage(
                chatId,
                "❌ Фамилия не может быть пустой.\n\n" +
                "Введите фамилию:"
            );

            return;
        }


        state.data.surname =
            text;


        state.step = 1;


        await sendMessage(
            chatId,
            "👤 Введите имя:",
            previousStepKeyboard(1)
        );

        return;
    }


    // -------------------------------------------------
    // NAME
    // -------------------------------------------------

    if (state.step === 1) {

        if (!text) {

            await sendMessage(
                chatId,
                "❌ Имя не может быть пустым.\n\n" +
                "Введите имя:"
            );

            return;
        }


        state.data.name =
            text;


        state.step = 2;


        await sendMessage(
            chatId,
            "👤 Введите отчество:",
            previousStepKeyboard(2)
        );

        return;
    }


    // -------------------------------------------------
    // PATRONYMIC
    // -------------------------------------------------

    if (state.step === 2) {

        if (!text) {

            await sendMessage(
                chatId,
                "❌ Отчество не может быть пустым.\n\n" +
                "Введите отчество:"
            );

            return;
        }


        state.data.patronymic =
            text;


        state.step = 3;


        await sendMessage(
            chatId,
            "🎂 Выберите дату рождения:",
            previousStepKeyboard(3)
        );


        // Получаем ID последнего сообщения
        // через отдельное сообщение нельзя редактировать.
        // Поэтому отправляем календарь новым сообщением.

        const result =
            await sendMessage(
                chatId,
                "🎂 Выберите год рождения:"
            );


        if (result.ok) {

            await showBirthCalendar(
                chatId,
                result.result.message_id
            );
        }

        return;
    }


    // -------------------------------------------------
    // PASSPORT
    // -------------------------------------------------

    if (state.step === 4) {

        if (!text) {

            await sendMessage(
                chatId,
                "❌ Номер паспорта не может быть пустым.\n\n" +
                "Введите номер паспорта:"
            );

            return;
        }


        state.data.passport =
            text;


        state.step = 5;


        await showCitizenship(chatId);

        return;
    }


    // -------------------------------------------------
    // CITIZENSHIP
    // -------------------------------------------------

    if (state.step === 5) {

        await sendMessage(
            chatId,
            "🌍 Пожалуйста, выберите гражданство кнопкой TJ или RU."
        );

        return;
    }


    // -------------------------------------------------
    // CONTACT
    // -------------------------------------------------

    if (state.step === 6) {

        let contact =
            text;


        // Если пользователь ввёл
        // только 9 цифр

        if (/^\d{9}$/.test(contact)) {

            contact =
                "+992" + contact;
        }


        // Проверяем полный номер

        if (!/^\+992\d{9}$/.test(contact)) {

            await sendMessage(
                chatId,
                "❌ Неверный формат номера.\n\n" +
                "Введите таджикский номер:\n" +
                "+992XXXXXXXXX"
            );

            return;
        }


        state.data.contact =
            contact;


        state.step = 7;


        const result =
            await sendMessage(
                chatId,
                "📅 Выберите дату рейса:"
            );


        if (result.ok) {

            await showFlightCalendar(
                chatId,
                result.result.message_id
            );
        }


        return;
    }


    // -------------------------------------------------
    // FLIGHT DATE
    // -------------------------------------------------

    if (state.step === 7) {

        await sendMessage(
            chatId,
            "📅 Пожалуйста, выберите дату рейса кнопкой."
        );

        return;
    }


    // -------------------------------------------------
    // ROUTE
    // -------------------------------------------------

    if (state.step === 8) {

        await sendMessage(
            chatId,
            "✈️ Пожалуйста, выберите маршрут кнопкой."
        );

        return;
    }


    // -------------------------------------------------
    // STATUS
    // -------------------------------------------------

    if (state.step === 9) {

        await sendMessage(
            chatId,
            "📌 Пожалуйста, выберите статус кнопкой."
        );

        return;
    }
}


// =====================================================
// CALLBACK QUERY
// =====================================================

async function handleCallbackQuery(
    callbackQuery
) {

    const chatId =
        callbackQuery.message.chat.id;

    const messageId =
        callbackQuery.message.message_id;

    const data =
        callbackQuery.data;


    await answerCallbackQuery(
        callbackQuery.id
    );


    if (!userStates[chatId]) {

        userStates[chatId] =
            createState();
    }


    const state =
        userStates[chatId];


    // =================================================
    // MAIN MENU
    // =================================================

    if (data === "main_menu") {

        userStates[chatId] =
            createState();

        await showMainMenu(
            chatId,
            messageId
        );

        return;
    }


    // =================================================
    // ADD PASSENGER
    // =================================================

    if (data === "main_add_passenger") {

        await startRegistration(
            chatId,
            messageId
        );

        return;
    }


    // =================================================
    // PLACEHOLDER FUNCTIONS
    // =================================================

    if (data === "main_view_data") {

        await editInlineMessage(
            chatId,
            messageId,
            "👤 Функция просмотра данных будет использоваться здесь.",
            {
                inline_keyboard: [
                    [
                        {
                            text: "🏠 Главное меню",
                            callback_data: "main_menu"
                        }
                    ]
                ]
            }
        );

        return;
    }


    if (data === "main_find_passenger") {

        await editInlineMessage(
            chatId,
            messageId,
            "🔎 Функция поиска пассажира будет использоваться здесь.",
            {
                inline_keyboard: [
                    [
                        {
                            text: "🏠 Главное меню",
                            callback_data: "main_menu"
                        }
                    ]
                ]
            }
        );

        return;
    }


    if (data === "main_flight_passengers") {

        await editInlineMessage(
            chatId,
            messageId,
            "✈️ Функция пассажиров рейса будет использоваться здесь.",
            {
                inline_keyboard: [
                    [
                        {
                            text: "🏠 Главное меню",
                            callback_data: "main_menu"
                        }
                    ]
                ]
            }
        );

        return;
    }


    if (data === "main_statistics") {

        await editInlineMessage(
            chatId,
            messageId,
            "📊 Функция статистики будет использоваться здесь.",
            {
                inline_keyboard: [
                    [
                        {
                            text: "🏠 Главное меню",
                            callback_data: "main_menu"
                        }
                    ]
                ]
            }
        );

        return;
    }


    // =================================================
    // PREVIOUS STEP
    // =================================================

    if (data === "previous_step") {

        await goToPreviousStep(
            chatId,
            messageId
        );

        return;
    }


    // =================================================
    // CALENDAR YEAR PAGE
    // =================================================

    if (data.startsWith("calendar_year_page:")) {

        const parts =
            data.split(":");


        const type =
            parts[1];

        const page =
            Number(parts[2]);


        state.calendarType =
            type;

        state.calendarPage =
            page;


        await showYears(
            chatId,
            messageId,
            type,
            page
        );

        return;
    }


    // =================================================
    // CALENDAR YEAR
    // =================================================

    if (data.startsWith("calendar_year:")) {

        const parts =
            data.split(":");


        const type =
            parts[1];

        const year =
            Number(parts[2]);


        state.calendarType =
            type;

        state.calendarYear =
            year;


        await showMonths(
            chatId,
            messageId,
            type,
            year
        );

        return;
    }


    // =================================================
    // CALENDAR BACK YEAR
    // =================================================

    if (data.startsWith("calendar_back_year:")) {

        const type =
            data.split(":")[1];


        await showYears(
            chatId,
            messageId,
            type,
            state.calendarPage || 0
        );

        return;
    }


    // =================================================
    // CALENDAR MONTH
    // =================================================

    if (data.startsWith("calendar_month:")) {

        const parts =
            data.split(":");


        const type =
            parts[1];

        const year =
            Number(parts[2]);

        const month =
            Number(parts[3]);


        state.calendarType =
            type;

        state.calendarYear =
            year;

        state.calendarMonth =
            month;


        await showDays(
            chatId,
            messageId,
            type,
            year,
            month
        );

        return;
    }


    // =================================================
    // CALENDAR BACK MONTH
    // =================================================

    if (data.startsWith("calendar_back_month:")) {

        const parts =
            data.split(":");


        const type =
            parts[1];

        const year =
            Number(parts[2]);


        await showMonths(
            chatId,
            messageId,
            type,
            year
        );

        return;
    }


    // =================================================
    // CALENDAR DAY
    // =================================================

    if (data.startsWith("calendar_day:")) {

        const parts =
            data.split(":");


        const type =
            parts[1];

        const year =
            Number(parts[2]);

        const month =
            Number(parts[3]);

        const day =
            Number(parts[4]);


        const selectedDate =
            formatDate(
                day,
                month,
                year
            );


        // ---------------------------------------------
        // BIRTH DATE
        // ---------------------------------------------

        if (type === "birth") {

            const today =
                new Date();


            const selected =
                new Date(
                    year,
                    month,
                    day
                );


            today.setHours(
                0,
                0,
                0,
                0
            );


            if (selected > today) {

                await editInlineMessage(
                    chatId,
                    messageId,
                    "❌ Дата рождения не может быть в будущем.\n\n" +
                    "🎂 Выберите день рождения:",
                    {
                        inline_keyboard: [
                            [
                                {
                                    text: "⬅️ Назад",
                                    callback_data:
                                        `calendar_back_month:birth:${year}`
                                }
                            ]
                        ]
                    }
                );

                await showDays(
                    chatId,
                    messageId,
                    "birth",
                    year,
                    month
                );

                return;
            }


            state.data.birthDate =
                selectedDate;


            state.step = 4;


            await editInlineMessage(
                chatId,
                messageId,
                "🛂 Введите номер паспорта:",
                previousStepKeyboard(4)
            );

            return;
        }


        // ---------------------------------------------
        // FLIGHT DATE
        // ---------------------------------------------

        if (type === "flight") {

            state.data.flightDate =
                selectedDate;


            state.step = 8;


            await showRoutes(
                chatId,
                messageId,
                selectedDate
            );

            return;
        }
    }


    // =================================================
    // IGNORE
    // =================================================

    if (data === "ignore") {
        return;
    }


    // =================================================
    // CITIZENSHIP
    // =================================================

    if (data.startsWith("citizenship:")) {

        const citizenship =
            data.split(":")[1];


        state.data.citizenship =
            citizenship;


        // ---------------------------------------------
        // EDIT CITIZENSHIP
        // ---------------------------------------------

        if (
            state.editingField ===
            "citizenship"
        ) {

            await updatePassenger(
                state.rowNumber,
                state.data
            );


            state.editingField =
                null;


            await showSavedPassenger(
                chatId,
                state.data,
                messageId
            );

            return;
        }


        // ---------------------------------------------
        // NORMAL REGISTRATION
        // ---------------------------------------------

        state.step = 6;


        await editInlineMessage(
            chatId,
            messageId,
            "📞 Введите контактный номер:\n\n+992XXXXXXXXX",
            previousStepKeyboard(6)
        );

        return;
    }


    // =================================================
    // ROUTE FULL
    // =================================================

    if (data === "route_full") {

        await telegramRequest(
            "answerCallbackQuery",
            {
                callback_query_id:
                    callbackQuery.id,

                text:
                    "❌ На этом маршруте нет свободных мест.",

                show_alert: true
            }
        );

        return;
    }


    // =================================================
    // ROUTE
    // =================================================

    if (data.startsWith("route:")) {

        const route =
            data.substring(
                "route:".length
            );


        // ---------------------------------------------
        // EDIT ROUTE
        // ---------------------------------------------

        if (
            state.editingField ===
            "route"
        ) {

            const availability =
                await checkRouteAvailability(
                    state.data.flightDate,
                    route,
                    state.rowNumber
                );


            if (!availability.available) {

                await sendMessage(
                    chatId,
                    "❌ На этом маршруте нет свободных мест."
                );

                return;
            }


            state.data.route =
                route;


            await updatePassenger(
                state.rowNumber,
                state.data
            );


            state.editingField =
                null;


            await showSavedPassenger(
                chatId,
                state.data
            );

            return;
        }


        // ---------------------------------------------
        // NORMAL REGISTRATION
        // ---------------------------------------------

        const availability =
            await checkRouteAvailability(
                state.data.flightDate,
                route
            );


        if (!availability.available) {

            await sendMessage(
                chatId,
                "❌ На этом маршруте больше нет свободных мест."
            );

            return;
        }


        state.data.route =
            route;


        state.step = 9;


        await showStatus(
            chatId,
            messageId
        );

        return;
    }


    // =================================================
    // STATUS
    // =================================================

    if (data.startsWith("status:")) {

        const status =
            data.substring(
                "status:".length
            );


        // ---------------------------------------------
        // EDIT STATUS
        // ---------------------------------------------

        if (
            state.editingField ===
            "status"
        ) {

            state.data.status =
                status;


            await updatePassenger(
                state.rowNumber,
                state.data
            );


            state.editingField =
                null;


            await showSavedPassenger(
                chatId,
                state.data
            );

            return;
        }


        // ---------------------------------------------
        // NORMAL REGISTRATION
        // ---------------------------------------------

        state.data.status =
            status;


        // ---------------------------------------------
        // FINAL CAPACITY CHECK
        // ---------------------------------------------

        if (
            status !==
            "Отменен"
        ) {

            const availability =
                await checkRouteAvailability(
                    state.data.flightDate,
                    state.data.route
                );


            if (!availability.available) {

                await sendMessage(
                    chatId,
                    "❌ К сожалению, пока вы заполняли данные, " +
                    "на этом маршруте закончилось свободное место."
                );

                state.step = 8;


                await showRoutes(
                    chatId,
                    messageId,
                    state.data.flightDate
                );

                return;
            }
        }


        // ---------------------------------------------
        // SAVE
        // ---------------------------------------------

        await savePassenger(
            state.data
        );


        // ---------------------------------------------
        // OCCUPANCY
        // ---------------------------------------------

        const occupancy =
            await getRouteOccupancy(
                state.data.flightDate,
                state.data.route
            );


        const free =
            Math.max(
                19 - occupancy,
                0
            );


        await editInlineMessage(
            chatId,
            messageId,
            passengerText(
                state.data
            ) +

            `\n\n💺 Загрузка маршрута: ${occupancy}/19` +

            `\n🟢 Свободно: ${free}`,

            {
                inline_keyboard: [

                    [
                        {
                            text:
                                "✏️ Изменить данные",
                            callback_data:
                                "edit_passenger"
                        }
                    ],

                    [
                        {
                            text:
                                "➕ Добавить ещё одного",
                            callback_data:
                                "main_add_passenger"
                        }
                    ],

                    [
                        {
                            text:
                                "🏠 Главное меню",
                            callback_data:
                                "main_menu"
                        }
                    ]
                ]
            }
        );


        return;
    }


    // =================================================
    // EDIT PASSENGER
    // =================================================

    if (data === "edit_passenger") {

        await showEditMenu(
            chatId,
            messageId
        );

        return;
    }


    // =================================================
    // BACK TO PASSENGER
    // =================================================

    if (data === "back_to_passenger") {

        await showSavedPassenger(
            chatId,
            state.data,
            messageId
        );

        return;
    }


    // =================================================
    // EDIT FIELD
    // =================================================

    if (data.startsWith("edit_field:")) {

        const field =
            data.substring(
                "edit_field:".length
            );


        state.editingField =
            field;


        // ---------------------------------------------
        // TEXT FIELDS
        // ---------------------------------------------

        if (
            field === "surname" ||
            field === "name" ||
            field === "patronymic" ||
            field === "passport"
        ) {

            const titles = {

                surname:
                    "✏️ Введите новую фамилию:",

                name:
                    "✏️ Введите новое имя:",

                patronymic:
                    "✏️ Введите новое отчество:",

                passport:
                    "✏️ Введите новый номер паспорта:"
            };


            await editInlineMessage(
                chatId,
                messageId,
                titles[field]
            );

            return;
        }


        // ---------------------------------------------
        // CONTACT
        // ---------------------------------------------

        if (field === "contact") {

            await editInlineMessage(
                chatId,
                messageId,
                "📞 Введите новый контактный номер:\n\n+992XXXXXXXXX"
            );

            return;
        }


        // ---------------------------------------------
        // BIRTH DATE
        // ---------------------------------------------

        if (field === "birthDate") {

            await showBirthCalendar(
                chatId,
                messageId
            );

            return;
        }


        // ---------------------------------------------
        // CITIZENSHIP
        // ---------------------------------------------

        if (field === "citizenship") {

            await showCitizenship(
                chatId,
                messageId
            );

            return;
        }


        // ---------------------------------------------
        // FLIGHT DATE
        // ---------------------------------------------

        if (field === "flightDate") {

            await showFlightCalendar(
                chatId,
                messageId
            );

            return;
        }


        // ---------------------------------------------
        // ROUTE
        // ---------------------------------------------

        if (field === "route") {

            await showRoutes(
                chatId,
                messageId,
                state.data.flightDate,
                state.rowNumber
            );

            return;
        }


        // ---------------------------------------------
        // STATUS
        // ---------------------------------------------

        if (field === "status") {

            await showStatus(
                chatId,
                messageId
            );

            return;
        }
    }
}


// =====================================================
// WEBHOOK
// =====================================================

app.post(
    "/telegram/webhook",
    async (req, res) => {

        const incomingSecret =
            req.headers[
                "x-telegram-bot-api-secret-token"
            ];


        if (
            !TELEGRAM_WEBHOOK_SECRET ||
            incomingSecret !==
            TELEGRAM_WEBHOOK_SECRET
        ) {

            console.warn(
                "🚫 Заблокирован запрос с неверным webhook secret"
            );

            return res.sendStatus(403);
        }


        res.sendStatus(200);


        try {

            const update =
                req.body;


            if (
                update.message
            ) {

                await handleTextMessage(
                    update.message
                );
            }


            if (
                update.callback_query
            ) {

                await handleCallbackQuery(
                    update.callback_query
                );
            }

        } catch (error) {

            console.error(
                "❌ Ошибка обработки Telegram:",
                error.message
            );
        }
    }
);


// =====================================================
// HEALTH CHECK
// =====================================================

app.get(
    "/",
    (req, res) => {

        res.send(
            "KMRN Passenger Bot is running."
        );
    }
);


// =====================================================
// WEBHOOK SETUP
// =====================================================

async function setupWebhook() {

    if (!TELEGRAM_WEBHOOK_SECRET) {

        console.error(
            "❌ TELEGRAM_WEBHOOK_SECRET не установлен!"
        );

        return;
    }


    if (!PUBLIC_URL) {

        console.error(
            "❌ PUBLIC_URL не установлен!"
        );

        return;
    }


    try {

        const result =
            await telegramRequest(
                "setWebhook",
                {
                    url:
                        `${PUBLIC_URL}/telegram/webhook`,

                    secret_token:
                        TELEGRAM_WEBHOOK_SECRET,

                    allowed_updates: [
                        "message",
                        "callback_query"
                    ]
                }
            );


        if (result.ok) {

            console.log(
                "🔐 Защищённый Telegram Webhook успешно установлен"
            );

        } else {

            console.error(
                "❌ Ошибка установки Webhook:",
                result.description
            );
        }

    } catch (error) {

        console.error(
            "❌ Ошибка подключения Webhook:",
            error.message
        );
    }
}


// =====================================================
// START SERVER
// =====================================================

const PORT =
    process.env.PORT || 10000;


app.listen(
    PORT,
    async () => {

        console.log(
            `KMRN Passenger Bot запущен на порту ${PORT}`
        );


        await setupWebhook();
    }
);
