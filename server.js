const express = require("express");
const { google } = require("googleapis");

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 10000;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;

const TELEGRAM_WEBHOOK_SECRET =
    process.env.TELEGRAM_WEBHOOK_SECRET;

const PUBLIC_URL =
    process.env.PUBLIC_URL;

const userStates = {};

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

const ROUTES = [
    "ДШБ — ХРГ",
    "ХРГ — ДШБ"
];

const STATUSES = [
    "Подтвержден",
    "Ожидание",
    "Отменен"
];

const ROUTE_CAPACITY = 19;


// =====================================================
// GOOGLE SHEETS
// =====================================================

const auth = new google.auth.GoogleAuth({
    credentials: {
        client_email: GOOGLE_CLIENT_EMAIL,
        private_key: GOOGLE_PRIVATE_KEY
            ? GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n")
            : undefined
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


async function sendMessage(chatId, text) {
    return await telegramRequest("sendMessage", {
        chat_id: chatId,
        text
    });
}


async function sendInlineMessage(
    chatId,
    text,
    keyboard
) {
    return await telegramRequest("sendMessage", {
        chat_id: chatId,
        text,
        reply_markup: {
            inline_keyboard: keyboard
        }
    });
}


async function editInlineMessage(
    chatId,
    messageId,
    text,
    keyboard
) {
    return await telegramRequest("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text,
        reply_markup: {
            inline_keyboard: keyboard
        }
    });
}


async function answerCallbackQuery(
    callbackQueryId,
    text = ""
) {
    return await telegramRequest(
        "answerCallbackQuery",
        {
            callback_query_id: callbackQueryId,
            text
        }
    );
}


// =====================================================
// MAIN MENU
// =====================================================

function mainMenuKeyboard() {
    return [
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
    ];
}


async function showMainMenu(
    chatId,
    messageId = null
) {
    const text = "🏠 Главное меню";

    if (messageId) {
        await editInlineMessage(
            chatId,
            messageId,
            text,
            mainMenuKeyboard()
        );
    } else {
        await sendInlineMessage(
            chatId,
            text,
            mainMenuKeyboard()
        );
    }
}


// =====================================================
// STATE
// =====================================================

function createNewState() {
    return {
        step: 0,
        data: {},
        calendarType: null,
        calendarPage: 0,
        editingField: null,
        rowNumber: null
    };
}


// =====================================================
// CALENDAR TITLES
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

        if (level === "year") {
            return "✈️ Выберите год рейса:";
        }

        if (level === "month") {
            return "✈️ Выберите месяц рейса:";
        }

        if (level === "day") {
            return "✈️ Выберите день рейса:";
        }
    }


    return "📅 Выберите дату:";
}


// =====================================================
// PREVIOUS STEP BUTTON
// =====================================================

function previousStepKeyboard(step) {

    if (step <= 0) {
        return [];
    }

    return [
        [
            {
                text: "↩️ Изменить предыдущий шаг",
                callback_data: "previous_step"
            }
        ]
    ];
}


// =====================================================
// DATE FORMAT
// =====================================================

function formatDate(
    day,
    month,
    year
) {
    const d = String(day).padStart(2, "0");
    const m = String(month + 1).padStart(2, "0");

    return `${d}.${m}.${year}`;
}


// =====================================================
// CALENDAR — YEARS
// =====================================================

async function showYears(
    chatId,
    messageId,
    type,
    page = 0
) {

    const now = new Date();

    const currentYear =
        now.getFullYear();

    // 12 лет на одной странице
    const yearsPerPage = 12;

    let minYear;
    let maxYear;


    if (type === "birth") {

        minYear = 1940;
        maxYear = currentYear;

    } else {

        minYear = currentYear;
        maxYear = currentYear + 5;

    }


    const startYear =
        maxYear -
        page *
            yearsPerPage;


    const endYear =
        Math.max(
            minYear,
            startYear -
                yearsPerPage +
                1
        );


    const keyboard = [];

    let row = [];


    for (
        let year = startYear;
        year >= endYear;
        year--
    ) {

        row.push({
            text: String(year),
            callback_data:
                `calendar_year:${type}:${year}`
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


    if (endYear > minYear) {

        navigation.push({
            text: "⬅️ Старше",
            callback_data:
                `calendar_year_page:${type}:${page + 1}`
        });
    }


    if (page > 0) {

        navigation.push({
            text: "➡️ Новее",
            callback_data:
                `calendar_year_page:${type}:${page - 1}`
        });
    }


    if (navigation.length > 0) {
        keyboard.push(navigation);
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
        getCalendarTitle(
            type,
            "year"
        ),
        keyboard
    );
}


// =====================================================
// CALENDAR — MONTHS
// =====================================================

async function showMonths(
    chatId,
    messageId,
    type,
    year
) {

    const keyboard = [];

    let row = [];


    for (
        let month = 0;
        month < 12;
        month++
    ) {

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
            text: "⬅️ К годам",
            callback_data:
                `calendar_back_years:${type}`
        }
    ]);


    keyboard.push([
        {
            text: "↩️ Изменить предыдущий шаг",
            callback_data: "previous_step"
        }
    ]);


    await editInlineMessage(
        chatId,
        messageId,
        getCalendarTitle(
            type,
            "month"
        ) +
        `\n\n${year} год`,
        keyboard
    );
}


// =====================================================
// CALENDAR — DAYS
// =====================================================

async function showDays(
    chatId,
    messageId,
    type,
    year,
    month
) {

    const keyboard = [];


    // Дни недели
    keyboard.push(
        WEEKDAYS.map(day => ({
            text: day,
            callback_data: "ignore"
        }))
    );


    const firstDay =
        new Date(
            year,
            month,
            1
        );


    let startDay =
        firstDay.getDay();


    // JavaScript:
    // Sunday = 0
    // Monday = 1
    // ...
    // Convert to Monday = 0
    startDay =
        (startDay + 6) % 7;


    const daysInMonth =
        new Date(
            year,
            month + 1,
            0
        ).getDate();


    const today = new Date();

    today.setHours(
        0,
        0,
        0,
        0
    );


    let row = [];


    for (
        let i = 0;
        i < startDay;
        i++
    ) {

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

        const currentDate =
            new Date(
                year,
                month,
                day
            );


        let disabled = false;


        // Для рождения нельзя выбирать будущую дату
        if (type === "birth") {

            if (currentDate > today) {
                disabled = true;
            }
        }


        if (disabled) {

            row.push({
                text: "·",
                callback_data: "ignore"
            });

        } else {

            row.push({
                text: String(day),
                callback_data:
                    `calendar_day:${type}:${year}:${month}:${day}`
            });
        }


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
            text: "⬅️ К месяцам",
            callback_data:
                `calendar_back_months:${type}:${year}`
        }
    ]);


    keyboard.push([
        {
            text: "↩️ Изменить предыдущий шаг",
            callback_data: "previous_step"
        }
    ]);


    await editInlineMessage(
        chatId,
        messageId,
        getCalendarTitle(
            type,
            "day"
        ) +
        `\n\n${MONTHS[month]} ${year}`,
        keyboard
    );
}


// =====================================================
// SHOW BIRTH CALENDAR
// =====================================================

async function showBirthCalendar(
    chatId,
    messageId = null
) {

    const state =
        userStates[chatId];

    state.calendarType = "birth";
    state.calendarPage = 0;


    if (!messageId) {

        const result =
            await sendInlineMessage(
                chatId,
                "🎂 Выберите год рождения:",
                []
            );

        if (
            result &&
            result.result
        ) {

            messageId =
                result.result.message_id;

        } else {

            return;
        }
    }


    state.calendarMessageId =
        messageId;


    await showYears(
        chatId,
        messageId,
        "birth",
        0
    );
}


// =====================================================
// SHOW FLIGHT CALENDAR
// =====================================================

async function showFlightCalendar(
    chatId,
    messageId = null
) {

    const state =
        userStates[chatId];

    state.calendarType = "flight";
    state.calendarPage = 0;


    if (!messageId) {

        const result =
            await sendInlineMessage(
                chatId,
                "✈️ Выберите год рейса:",
                []
            );

        if (
            result &&
            result.result
        ) {

            messageId =
                result.result.message_id;

        } else {

            return;
        }
    }


    state.calendarMessageId =
        messageId;


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

    const text =
        "🌍 Выберите гражданство:";


    const keyboard = [
        [
            {
                text: "🇹🇯 TJ",
                callback_data:
                    "citizenship:TJ"
            },
            {
                text: "🇷🇺 RU",
                callback_data:
                    "citizenship:RU"
            }
        ],
        [
            {
                text: "↩️ Изменить предыдущий шаг",
                callback_data:
                    "previous_step"
            }
        ]
    ];


    if (messageId) {

        await editInlineMessage(
            chatId,
            messageId,
            text,
            keyboard
        );

    } else {

        await sendInlineMessage(
            chatId,
            text,
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

    const spreadsheet =
        await sheets.spreadsheets.get({
            spreadsheetId:
                GOOGLE_SHEET_ID
        });


    const firstSheet =
        spreadsheet.data.sheets[0];


    const sheetTitle =
        firstSheet.properties.title;


    const response =
        await sheets.spreadsheets.values.get({
            spreadsheetId:
                GOOGLE_SHEET_ID,
            range:
                `${sheetTitle}!A:J`
        });


    const rows =
        response.data.values || [];


    let occupied = 0;


    for (
        let i = 1;
        i < rows.length;
        i++
    ) {

        const row =
            rows[i];


        const rowNumber =
            i + 1;


        if (
            excludeRowNumber &&
            rowNumber === excludeRowNumber
        ) {
            continue;
        }


        const passengerFlightDate =
            row[7] || "";


        const passengerRoute =
            row[8] || "";


        const passengerStatus =
            row[9] || "";


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


async function checkRouteAvailability(
    flightDate,
    route,
    excludeRowNumber = null
) {

    const occupied =
        await getRouteOccupancy(
            flightDate,
            route,
            excludeRowNumber
        );


    const free =
        Math.max(
            0,
            ROUTE_CAPACITY - occupied
        );


    return {
        occupied,
        free,
        available:
            occupied < ROUTE_CAPACITY
    };
}


async function showRoutes(
    chatId,
    flightDate,
    messageId
) {

    const keyboard = [];


    for (
        const route of ROUTES
    ) {

        const result =
            await checkRouteAvailability(
                flightDate,
                route
            );


        if (result.available) {

            keyboard.push([
                {
                    text:
                        `✈️ ${route} (${result.occupied}/${ROUTE_CAPACITY})`,
                    callback_data:
                        `route_select:${route}`
                }
            ]);

        } else {

            keyboard.push([
                {
                    text:
                        `🔴 ${route} (Мест нет)`,
                    callback_data:
                        `route_full:${route}`
                }
            ]);
        }
    }


    keyboard.push([
        {
            text:
                "↩️ Изменить предыдущий шаг",
            callback_data:
                "previous_step"
        }
    ]);


    const text =
        `📅 Дата рейса: ${flightDate}\n\n` +
        "✈️ Выберите маршрут:";


    await editInlineMessage(
        chatId,
        messageId,
        text,
        keyboard
    );
}


// =====================================================
// STATUSES
// =====================================================

async function showStatuses(
    chatId,
    messageId
) {

    const keyboard = [
        [
            {
                text: "✅ Подтвержден",
                callback_data:
                    "status_select:Подтвержден"
            }
        ],
        [
            {
                text: "⏳ Ожидание",
                callback_data:
                    "status_select:Ожидание"
            }
        ],
        [
            {
                text: "❌ Отменен",
                callback_data:
                    "status_select:Отменен"
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
    ];


    await editInlineMessage(
        chatId,
        messageId,
        "📌 Выберите статус пассажира:",
        keyboard
    );
}


// =====================================================
// PASSENGER CARD
// =====================================================

function getPassengerCard(data) {

    return (
        "📋 Данные пассажира\n\n" +

        `👤 Фамилия: ${data.surname || ""}\n` +

        `👤 Имя: ${data.name || ""}\n` +

        `👤 Отчество: ${data.patronymic || ""}\n` +

        `🎂 Дата рождения: ${data.birthDate || ""}\n` +

        `🛂 Паспорт: ${data.passport || ""}\n` +

        `🌍 Гражданство: ${data.citizenship || ""}\n` +

        `📅 Дата рейса: ${data.flightDate || ""}\n` +

        `✈️ Маршрут: ${data.route || ""}\n` +

        `📌 Статус: ${data.status || ""}`
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

    const occupancy =
        await getRouteOccupancy(
            data.flightDate,
            data.route,
            null
        );


    const free =
        Math.max(
            0,
            ROUTE_CAPACITY - occupancy
        );


    const text =
        getPassengerCard(data) +

        `\n\n💺 Загрузка маршрута: ${occupancy}/${ROUTE_CAPACITY}` +

        `\n🟢 Свободно: ${free}`;


    const keyboard = [
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
    ];


    if (messageId) {

        await editInlineMessage(
            chatId,
            messageId,
            text,
            keyboard
        );

    } else {

        await sendInlineMessage(
            chatId,
            text,
            keyboard
        );
    }
}


// =====================================================
// EDIT MENU
// =====================================================

async function showEditMenu(
    chatId,
    messageId
) {

    const keyboard = [
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
    ];


    await editInlineMessage(
        chatId,
        messageId,
        "✏️ Что хотите изменить?",
        keyboard
    );
}


// =====================================================
// TEXT EDIT
// =====================================================

async function startTextEdit(
    chatId,
    messageId,
    field
) {

    const state =
        userStates[chatId];


    state.editingField =
        field;


    const names = {

        surname:
            "фамилию",

        name:
            "имя",

        patronymic:
            "отчество",

        passport:
            "номер паспорта"
    };


    await editInlineMessage(
        chatId,
        messageId,
        `✏️ Введите ${names[field]}:`,
        [
            [
                {
                    text:
                        "↩️ Назад",
                    callback_data:
                        "edit_passenger"
                }
            ]
        ]
    );
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
            spreadsheetId:
                GOOGLE_SHEET_ID
        });


    const firstSheet =
        spreadsheet.data.sheets[0];


    const sheetTitle =
        firstSheet.properties.title;


    const values = [
        data.passengerId || "",
        data.surname || "",
        data.name || "",
        data.patronymic || "",
        data.birthDate || "",
        data.passport || "",
        data.citizenship || "",
        data.flightDate || "",
        data.route || "",
        data.status || ""
    ];


    await sheets.spreadsheets.values.update({
        spreadsheetId:
            GOOGLE_SHEET_ID,

        range:
            `${sheetTitle}!A${rowNumber}:J${rowNumber}`,

        valueInputOption:
            "USER_ENTERED",

        requestBody: {
            values: [values]
        }
    });
}


// =====================================================
// SAVE PASSENGER
// =====================================================

async function savePassenger(
    data
) {

    const spreadsheet =
        await sheets.spreadsheets.get({
            spreadsheetId:
                GOOGLE_SHEET_ID
        });


    const firstSheet =
        spreadsheet.data.sheets[0];


    const sheetTitle =
        firstSheet.properties.title;


    const passengerId =
        Date.now().toString();


    const values = [
        passengerId,
        data.surname || "",
        data.name || "",
        data.patronymic || "",
        data.birthDate || "",
        data.passport || "",
        data.citizenship || "",
        data.flightDate || "",
        data.route || "",
        data.status || ""
    ];


    await sheets.spreadsheets.values.append({
        spreadsheetId:
            GOOGLE_SHEET_ID,

        range:
            `${sheetTitle}!A:J`,

        valueInputOption:
            "USER_ENTERED",

        requestBody: {
            values: [values]
        }
    });


    data.passengerId =
        passengerId;
}


// =====================================================
// GO TO PREVIOUS STEP
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


    if (state.step === 0) {

        await showMainMenu(
            chatId,
            messageId
        );

        return;
    }


    state.step--;


    if (state.step === 0) {

        await editInlineMessage(
            chatId,
            messageId,
            "Введите фамилию:",
            previousStepKeyboard(0)
        );

        return;
    }


    if (state.step === 1) {

        await editInlineMessage(
            chatId,
            messageId,
            "Введите имя:",
            previousStepKeyboard(1)
        );

        return;
    }


    if (state.step === 2) {

        await editInlineMessage(
            chatId,
            messageId,
            "Введите отчество:",
            previousStepKeyboard(2)
        );

        return;
    }


    if (state.step === 3) {

        await showBirthCalendar(
            chatId,
            messageId
        );

        return;
    }


    if (state.step === 4) {

        await editInlineMessage(
            chatId,
            messageId,
            "Введите номер паспорта:",
            previousStepKeyboard(4)
        );

        return;
    }


    if (state.step === 5) {

        await showCitizenship(
            chatId,
            messageId
        );

        return;
    }


    if (state.step === 6) {

        await showFlightCalendar(
            chatId,
            messageId
        );

        return;
    }


    if (state.step === 7) {

        await showRoutes(
            chatId,
            state.data.flightDate,
            messageId
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

    const callbackQueryId =
        callbackQuery.id;

    const chatId =
        callbackQuery.message.chat.id;

    const messageId =
        callbackQuery.message.message_id;

    const data =
        callbackQuery.data;


    await answerCallbackQuery(
        callbackQueryId
    );


    if (!userStates[chatId]) {

        userStates[chatId] =
            createNewState();
    }


    const state =
        userStates[chatId];


    // =================================================
    // MAIN MENU
    // =================================================

    if (data === "main_menu") {

        userStates[chatId] =
            createNewState();

        await showMainMenu(
            chatId,
            messageId
        );

        return;
    }


    // =================================================
    // ADD PASSENGER
    // =================================================

    if (
        data ===
        "main_add_passenger"
    ) {

        userStates[chatId] =
            createNewState();


        await editInlineMessage(
            chatId,
            messageId,
            "Введите фамилию:",
            []
        );

        return;
    }


    // =================================================
    // PLACEHOLDER FUNCTIONS
    // =================================================

    if (
        data ===
        "main_view_data"
    ) {

        await editInlineMessage(
            chatId,
            messageId,
            "👤 Функция просмотра данных будет использоваться здесь.",
            [
                [
                    {
                        text:
                            "🏠 Главное меню",
                        callback_data:
                            "main_menu"
                    }
                ]
            ]
        );

        return;
    }


    if (
        data ===
        "main_find_passenger"
    ) {

        await editInlineMessage(
            chatId,
            messageId,
            "🔎 Функция поиска пассажира будет использоваться здесь.",
            [
                [
                    {
                        text:
                            "🏠 Главное меню",
                        callback_data:
                            "main_menu"
                    }
                ]
            ]
        );

        return;
    }


    if (
        data ===
        "main_flight_passengers"
    ) {

        await editInlineMessage(
            chatId,
            messageId,
            "✈️ Функция пассажиров рейса будет использоваться здесь.",
            [
                [
                    {
                        text:
                            "🏠 Главное меню",
                        callback_data:
                            "main_menu"
                    }
                ]
            ]
        );

        return;
    }


    if (
        data ===
        "main_statistics"
    ) {

        await editInlineMessage(
            chatId,
            messageId,
            "📊 Функция статистики будет использоваться здесь.",
            [
                [
                    {
                        text:
                            "🏠 Главное меню",
                        callback_data:
                            "main_menu"
                    }
                ]
            ]
        );

        return;
    }


    // =================================================
    // IGNORE
    // =================================================

    if (data === "ignore") {
        return;
    }


    // =================================================
    // PREVIOUS STEP
    // =================================================

    if (
        data ===
        "previous_step"
    ) {

        await goToPreviousStep(
            chatId,
            messageId
        );

        return;
    }


    // =================================================
    // EDIT PASSENGER
    // =================================================

    if (
        data ===
        "edit_passenger"
    ) {

        await showEditMenu(
            chatId,
            messageId
        );

        return;
    }


    // =================================================
    // BACK TO PASSENGER
    // =================================================

    if (
        data ===
        "back_to_passenger"
    ) {

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

    if (
        data.startsWith(
            "edit_field:"
        )
    ) {

        const field =
            data.split(":")[1];


        state.editingField =
            field;


        if (
            field === "birthDate"
        ) {

            state.step = 3;

            await showBirthCalendar(
                chatId,
                messageId
            );

            return;
        }


        if (
            field === "flightDate"
        ) {

            state.step = 6;

            await showFlightCalendar(
                chatId,
                messageId
            );

            return;
        }


        if (
            field === "citizenship"
        ) {

            await showCitizenship(
                chatId,
                messageId
            );

            return;
        }


        if (
            field === "route"
        ) {

            await showRoutes(
                chatId,
                state.data.flightDate,
                messageId
            );

            return;
        }


        if (
            field === "status"
        ) {

            await showStatuses(
                chatId,
                messageId
            );

            return;
        }


        await startTextEdit(
            chatId,
            messageId,
            field
        );

        return;
    }


    // =================================================
    // CITIZENSHIP
    // =================================================

    if (
        data.startsWith(
            "citizenship:"
        )
    ) {

        const citizenship =
            data.split(":")[1];


        state.data.citizenship =
            citizenship;


        // Если редактируем гражданство
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


        // Обычная регистрация
        state.step = 6;


        await showFlightCalendar(
            chatId,
            messageId
        );

        return;
    }


    // =================================================
    // YEAR PAGE
    // =================================================

    if (
        data.startsWith(
            "calendar_year_page:"
        )
    ) {

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
    // YEAR
    // =================================================

    if (
        data.startsWith(
            "calendar_year:"
        )
    ) {

        const parts =
            data.split(":");


        const type =
            parts[1];

        const year =
            Number(parts[2]);


        state.calendarType =
            type;

        state.selectedYear =
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
    // BACK TO YEARS
    // =================================================

    if (
        data.startsWith(
            "calendar_back_years:"
        )
    ) {

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
    // MONTH
    // =================================================

    if (
        data.startsWith(
            "calendar_month:"
        )
    ) {

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

        state.selectedYear =
            year;

        state.selectedMonth =
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
    // BACK TO MONTHS
    // =================================================

    if (
        data.startsWith(
            "calendar_back_months:"
        )
    ) {

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
    // DAY
    // =================================================

    if (
        data.startsWith(
            "calendar_day:"
        )
    ) {

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

        if (
            type === "birth" &&
            state.step === 3
        ) {

            state.data.birthDate =
                selectedDate;

            state.step = 4;


            // Если редактируем дату рождения
            if (
                state.editingField ===
                "birthDate"
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


            await editInlineMessage(
                chatId,
                messageId,
                "Введите номер паспорта:",
                previousStepKeyboard(4)
            );

            return;
        }


        // ---------------------------------------------
        // FLIGHT DATE
        // ---------------------------------------------

        if (
            type === "flight" &&
            state.step === 6
        ) {

            state.data.flightDate =
                selectedDate;

            state.step = 7;


            // Если редактируем дату рейса
            if (
                state.editingField ===
                "flightDate"
            ) {

                state.editingField =
                    null;


                await showRoutes(
                    chatId,
                    selectedDate,
                    messageId
                );

                return;
            }


            await showRoutes(
                chatId,
                selectedDate,
                messageId
            );

            return;
        }


        return;
    }


    // =================================================
    // ROUTE FULL
    // =================================================

    if (
        data.startsWith(
            "route_full:"
        )
    ) {

        await answerCallbackQuery(
            callbackQueryId,
            "❌ На этом маршруте нет свободных мест."
        );

        return;
    }


    // =================================================
    // ROUTE SELECT
    // =================================================

    if (
        data.startsWith(
            "route_select:"
        )
    ) {

        const route =
            data.substring(
                "route_select:".length
            );


        const excludeRowNumber =
            state.rowNumber || null;


        const availability =
            await checkRouteAvailability(
                state.data.flightDate,
                route,
                excludeRowNumber
            );


        if (
            !availability.available
        ) {

            await answerCallbackQuery(
                callbackQueryId,
                "❌ На этом маршруте нет свободных мест."
            );

            await showRoutes(
                chatId,
                state.data.flightDate,
                messageId
            );

            return;
        }


        state.data.route =
            route;


        state.step = 8;


        // Если редактируем маршрут
        if (
            state.editingField ===
            "route"
        ) {

            state.editingField =
                null;


            await showStatuses(
                chatId,
                messageId
            );

            return;
        }


        await showStatuses(
            chatId,
            messageId
        );

        return;
    }


    // =================================================
    // STATUS SELECT
    // =================================================

    if (
        data.startsWith(
            "status_select:"
        )
    ) {

        const status =
            data.substring(
                "status_select:".length
            );


        state.data.status =
            status;


        // ---------------------------------------------
        // EDIT STATUS
        // ---------------------------------------------

        if (
            state.editingField ===
            "status"
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
        // FINAL SAVE
        // ---------------------------------------------

        const availability =
            await checkRouteAvailability(
                state.data.flightDate,
                state.data.route
            );


        if (
            state.data.status !==
                "Отменен" &&
            !availability.available
        ) {

            await answerCallbackQuery(
                callbackQueryId,
                "❌ Места на этом маршруте уже закончились."
            );


            await showRoutes(
                chatId,
                state.data.flightDate,
                messageId
            );

            state.step = 7;

            return;
        }


        await savePassenger(
            state.data
        );


        await showSavedPassenger(
            chatId,
            state.data,
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
        (message.text || "").trim();


    // ---------------------------------------------
    // START
    // ---------------------------------------------

    if (
        text === "/start" ||
        text === "/menu"
    ) {

        userStates[chatId] =
            createNewState();


        await sendInlineMessage(
            chatId,
            "🏠 Главное меню",
            mainMenuKeyboard()
        );

        return;
    }


    // ---------------------------------------------
    // CREATE STATE
    // ---------------------------------------------

    if (!userStates[chatId]) {

        userStates[chatId] =
            createNewState();


        await sendInlineMessage(
            chatId,
            "🏠 Главное меню",
            mainMenuKeyboard()
        );

        return;
    }


    const state =
        userStates[chatId];


    // ---------------------------------------------
    // EDITING SAVED TEXT FIELD
    // ---------------------------------------------

    if (
        state.editingField &&
        [
            "surname",
            "name",
            "patronymic",
            "passport"
        ].includes(
            state.editingField
        )
    ) {

        if (!text) {

            await sendMessage(
                chatId,
                "❌ Поле не может быть пустым.\n\nВведите значение:"
            );

            return;
        }


        state.data[
            state.editingField
        ] = text;


        await updatePassenger(
            state.rowNumber,
            state.data
        );


        state.editingField =
            null;


        await sendInlineMessage(
            chatId,
            getPassengerCard(
                state.data
            ),
            [
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
                            "🏠 Главное меню",
                        callback_data:
                            "main_menu"
                    }
                ]
            ]
        );

        return;
    }


    // ---------------------------------------------
    // STEP 0 — SURNAME
    // ---------------------------------------------

    if (
        state.step === 0
    ) {

        if (!text) {

            await sendMessage(
                chatId,
                "❌ Фамилия не может быть пустой.\n\nВведите фамилию:"
            );

            return;
        }


        state.data.surname =
            text;

        state.step = 1;


        await sendMessage(
            chatId,
            "Введите имя:"
        );

        return;
    }


    // ---------------------------------------------
    // STEP 1 — NAME
    // ---------------------------------------------

    if (
        state.step === 1
    ) {

        if (!text) {

            await sendMessage(
                chatId,
                "❌ Имя не может быть пустым.\n\nВведите имя:"
            );

            return;
        }


        state.data.name =
            text;

        state.step = 2;


        await sendMessage(
            chatId,
            "Введите отчество:"
        );

        return;
    }


    // ---------------------------------------------
    // STEP 2 — PATRONYMIC
    // ---------------------------------------------

    if (
        state.step === 2
    ) {

        if (!text) {

            await sendMessage(
                chatId,
                "❌ Отчество не может быть пустым.\n\nВведите отчество:"
            );

            return;
        }


        state.data.patronymic =
            text;

        state.step = 3;


        await showBirthCalendar(
            chatId
        );

        return;
    }


    // ---------------------------------------------
    // STEP 3 — BIRTH DATE
    // ---------------------------------------------

    if (
        state.step === 3
    ) {

        await sendMessage(
            chatId,
            "📅 Пожалуйста, выберите дату рождения через календарь."
        );

        return;
    }


    // ---------------------------------------------
    // STEP 4 — PASSPORT
    // ---------------------------------------------

    if (
        state.step === 4
    ) {

        if (!text) {

            await sendMessage(
                chatId,
                "❌ Номер паспорта не может быть пустым.\n\nВведите номер паспорта:"
            );

            return;
        }


        state.data.passport =
            text;

        state.step = 5;


        // НОВОЕ:
        // вместо ручного ввода показываем
        // выбор гражданства
        await showCitizenship(
            chatId
        );

        return;
    }


    // ---------------------------------------------
    // STEP 5 — CITIZENSHIP
    // ---------------------------------------------

    if (
        state.step === 5
    ) {

        await sendMessage(
            chatId,
            "🌍 Пожалуйста, выберите гражданство кнопкой TJ или RU."
        );

        return;
    }


    // ---------------------------------------------
    // STEP 6 — FLIGHT DATE
    // ---------------------------------------------

    if (
        state.step === 6
    ) {

        await sendMessage(
            chatId,
            "📅 Пожалуйста, выберите дату рейса через календарь."
        );

        return;
    }


    // ---------------------------------------------
    // STEP 7 — ROUTE
    // ---------------------------------------------

    if (
        state.step === 7
    ) {

        await sendMessage(
            chatId,
            "✈️ Пожалуйста, выберите маршрут кнопкой."
        );

        return;
    }


    // ---------------------------------------------
    // STEP 8 — STATUS
    // ---------------------------------------------

    if (
        state.step === 8
    ) {

        await sendMessage(
            chatId,
            "📌 Пожалуйста, выберите статус кнопкой."
        );

        return;
    }
}


// =====================================================
// TELEGRAM WEBHOOK
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
                update.callback_query
            ) {

                await handleCallbackQuery(
                    update.callback_query
                );

                return;
            }


            if (
                update.message
            ) {

                await handleTextMessage(
                    update.message
                );

                return;
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
            "KMRN Passenger Bot is running"
        );
    }
);


// =====================================================
// SET WEBHOOK
// =====================================================

async function setupWebhook() {

    if (
        !TELEGRAM_WEBHOOK_SECRET
    ) {

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

app.listen(
    PORT,
    async () => {

        console.log(
            `KMRN Passenger Bot запущен на порту ${PORT}`
        );

        await setupWebhook();
    }
);
