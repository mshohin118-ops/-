const express = require("express");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

/* =========================================================
   ENV
========================================================= */

const PORT = process.env.PORT || 10000;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY
    ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n")
    : null;

const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;

const TELEGRAM_WEBHOOK_SECRET =
    process.env.TELEGRAM_WEBHOOK_SECRET;

const PUBLIC_URL =
    process.env.PUBLIC_URL;


/* =========================================================
   CHECK ENV
========================================================= */

const requiredEnv = [
    ["TELEGRAM_BOT_TOKEN", TELEGRAM_BOT_TOKEN],
    ["GOOGLE_CLIENT_EMAIL", GOOGLE_CLIENT_EMAIL],
    ["GOOGLE_PRIVATE_KEY", GOOGLE_PRIVATE_KEY],
    ["GOOGLE_SHEET_ID", GOOGLE_SHEET_ID],
    ["TELEGRAM_WEBHOOK_SECRET", TELEGRAM_WEBHOOK_SECRET],
    ["PUBLIC_URL", PUBLIC_URL]
];

for (const [name, value] of requiredEnv) {
    if (!value) {
        console.error(`❌ Не установлена переменная ${name}`);
    }
}


/* =========================================================
   GOOGLE SHEETS
========================================================= */

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


/* =========================================================
   CACHE SHEET TITLE
========================================================= */

let cachedSheetTitle = null;

async function getSheetTitle() {
    if (cachedSheetTitle) {
        return cachedSheetTitle;
    }

    const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId: GOOGLE_SHEET_ID
    });

    if (
        !spreadsheet.data.sheets ||
        !spreadsheet.data.sheets.length
    ) {
        throw new Error("В Google таблице нет листов");
    }

    cachedSheetTitle =
        spreadsheet.data.sheets[0].properties.title;

    console.log(
        `📄 Используется лист: ${cachedSheetTitle}`
    );

    return cachedSheetTitle;
}


/* =========================================================
   GET ALL PASSENGER ROWS
========================================================= */

async function getAllRows() {
    const sheetTitle = await getSheetTitle();

    const result = await sheets.spreadsheets.values.get({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: `${sheetTitle}!A:L`
    });

    return result.data.values || [];
}


/* =========================================================
   TELEGRAM REQUEST
========================================================= */

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


/* =========================================================
   TELEGRAM HELPERS
========================================================= */

async function sendMessage(
    chatId,
    text,
    replyMarkup = null
) {
    const body = {
        chat_id: chatId,
        text
    };

    if (replyMarkup) {
        body.reply_markup = replyMarkup;
    }

    return await telegramRequest(
        "sendMessage",
        body
    );
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
    } else {
        body.reply_markup = {
            inline_keyboard: []
        };
    }

    const result = await telegramRequest(
        "editMessageText",
        body
    );

    if (
        !result.ok &&
        !String(result.description || "").includes(
            "message is not modified"
        )
    ) {
        console.error(
            "❌ Telegram editMessageText:",
            result.description
        );
    }

    return result;
}


async function answerCallbackQuery(
    callbackQueryId
) {
    try {
        return await telegramRequest(
            "answerCallbackQuery",
            {
                callback_query_id: callbackQueryId
            }
        );
    } catch (error) {
        console.error(
            "❌ answerCallbackQuery:",
            error.message
        );
    }
}


/* =========================================================
   USER STATES
========================================================= */

const userStates = {};


function createState() {
    return {
        step: 0,
        data: {},

        calendarType: null,
        calendarPage: 0,
        calendarYear: null,
        calendarMonth: null,

        editingField: null,
        rowNumber: null,

        messageId: null,

        contactNumberBeingAdded: 1
    };
}


/* =========================================================
   MAIN MENU
========================================================= */

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


async function showMainMenu(
    chatId,
    messageId = null
) {
    const text = "🏠 Главное меню";

    if (messageId) {
        const result = await editInlineMessage(
            chatId,
            messageId,
            text,
            mainMenuKeyboard()
        );

        if (result.ok) {
            return messageId;
        }
    }

    const result = await sendMessage(
        chatId,
        text,
        mainMenuKeyboard()
    );

    if (result.ok) {
        return result.result.message_id;
    }

    return null;
}


/* =========================================================
   START REGISTRATION
========================================================= */

async function startRegistration(
    chatId,
    messageId
) {
    const newState = createState();

    newState.messageId = messageId;

    userStates[chatId] = newState;

    await editInlineMessage(
        chatId,
        messageId,
        "👤 Введите фамилию:"
    );
}


/* =========================================================
   PREVIOUS STEP KEYBOARD
========================================================= */

function previousStepKeyboard() {
    return {
        inline_keyboard: [
            [
                {
                    text: "↩️ Изменить предыдущий шаг",
                    callback_data: "previous_step"
                }
            ],
            [
                {
                    text: "🏠 Главное меню",
                    callback_data: "go_main_menu"
                }
            ]
        ]
    };
}


/* =========================================================
   REGISTRATION PROMPTS
========================================================= */

async function showStepPrompt(
    chatId,
    state
) {
    const prompts = {
        0: "👤 Введите фамилию:",
        1: "👤 Введите имя:",
        2: "👤 Введите отчество:",
        4: "🛂 Введите номер паспорта:"
    };

    if (!prompts[state.step]) {
        return;
    }

    await editInlineMessage(
        chatId,
        state.messageId,
        prompts[state.step],
        previousStepKeyboard()
    );
}


/* =========================================================
   CITIZENSHIP
========================================================= */

function citizenshipKeyboard() {
    return {
        inline_keyboard: [
            [
                {
                    text: "🇹🇯 TJ",
                    callback_data: "citizenship_TJ"
                },
                {
                    text: "🇷🇺 RU",
                    callback_data: "citizenship_RU"
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
}


async function showCitizenshipStep(
    chatId,
    state
) {
    await editInlineMessage(
        chatId,
        state.messageId,
        "🌍 Выберите гражданство:",
        citizenshipKeyboard()
    );
}


/* =========================================================
   CONTACTS
========================================================= */

function contactKeyboard(state) {
    const buttons = [];

    if (state.data.contact1) {
        buttons.push([
            {
                text: "✏️ Изменить контакт 1",
                callback_data: "edit_contact1_current"
            }
        ]);
    }

    if (state.data.contact2) {
        buttons.push([
            {
                text: "✏️ Изменить контакт 2",
                callback_data: "edit_contact2_current"
            }
        ]);
    }

    if (
        state.data.contact1 &&
        !state.data.contact2
    ) {
        buttons.push([
            {
                text: "➕ Добавить ещё один номер",
                callback_data: "add_second_contact"
            }
        ]);
    }

    if (state.data.contact1) {
        buttons.push([
            {
                text: "➡️ Продолжить",
                callback_data: "continue_after_contact"
            }
        ]);
    }

    buttons.push([
        {
            text: "↩️ Изменить предыдущий шаг",
            callback_data: "previous_step"
        }
    ]);

    buttons.push([
        {
            text: "🏠 Главное меню",
            callback_data: "go_main_menu"
        }
    ]);

    return {
        inline_keyboard: buttons
    };
}


async function showContactStep(
    chatId,
    state
) {
    let text;

    if (!state.data.contact1) {
        text =
            "📞 Укажите контактный номер:\n\n" +
            "+992XXXXXXXXX";
    } else if (
        state.data.contact1 &&
        !state.data.contact2
    ) {
        text =
            "📞 Контактные номера:\n\n" +
            `1️⃣ ${state.data.contact1}\n\n` +
            "Хотите добавить ещё один номер?";
    } else {
        text =
            "📞 Контактные номера:\n\n" +
            `1️⃣ ${state.data.contact1}\n` +
            `2️⃣ ${state.data.contact2}`;
    }

    await editInlineMessage(
        chatId,
        state.messageId,
        text,
        contactKeyboard(state)
    );
}


function normalizeTajikPhone(value) {
    let phone = String(value || "")
        .trim()
        .replace(/[\s()-]/g, "");

    if (/^\d{9}$/.test(phone)) {
        phone = "+992" + phone;
    }

    return phone;
}


function isValidTajikPhone(phone) {
    return /^\+992\d{9}$/.test(phone);
}


/* =========================================================
   CALENDAR
========================================================= */

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


function getCalendarTitle(
    type,
    level
) {
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


/* =========================================================
   YEAR RANGE
========================================================= */

function getYearRange(type) {
    const currentYear =
        new Date().getFullYear();

    if (type === "birth") {
        return {
            from: 1940,
            to: currentYear
        };
    }

    return {
        from: currentYear,
        to: currentYear + 5
    };
}


/* =========================================================
   YEAR CALENDAR
========================================================= */

async function showYearCalendar(
    chatId,
    state,
    type
) {
    const range = getYearRange(type);

    const years = [];

    for (
        let year = range.to;
        year >= range.from;
        year--
    ) {
        years.push(year);
    }

    const pageSize = 12;

    const totalPages =
        Math.ceil(years.length / pageSize);

    if (
        state.calendarPage < 0
    ) {
        state.calendarPage = 0;
    }

    if (
        state.calendarPage >= totalPages
    ) {
        state.calendarPage =
            totalPages - 1;
    }

    const start =
        state.calendarPage * pageSize;

    const pageYears =
        years.slice(
            start,
            start + pageSize
        );

    const keyboard = [];

    for (
        let i = 0;
        i < pageYears.length;
        i += 3
    ) {
        const row = [];

        for (
            let j = i;
            j < i + 3 &&
            j < pageYears.length;
            j++
        ) {
            row.push({
                text: String(pageYears[j]),
                callback_data:
                    `calendar_${type}_year_${pageYears[j]}`
            });
        }

        keyboard.push(row);
    }

    const navigation = [];

    if (state.calendarPage > 0) {
        navigation.push({
            text: "⬅️",
            callback_data:
                `calendar_${type}_year_page_${state.calendarPage - 1}`
        });
    }

    if (
        state.calendarPage <
        totalPages - 1
    ) {
        navigation.push({
            text: "➡️",
            callback_data:
                `calendar_${type}_year_page_${state.calendarPage + 1}`
        });
    }

    if (navigation.length) {
        keyboard.push(navigation);
    }

    keyboard.push([
        {
            text: "🏠 Главное меню",
            callback_data: "go_main_menu"
        }
    ]);

    await editInlineMessage(
        chatId,
        state.messageId,
        getCalendarTitle(
            type,
            "year"
        ),
        {
            inline_keyboard: keyboard
        }
    );
}


/* =========================================================
   MONTH CALENDAR
========================================================= */

async function showMonths(
    chatId,
    state,
    type,
    year
) {
    state.calendarYear = year;
    state.calendarType = type;

    const keyboard = [];

    for (
        let i = 0;
        i < 12;
        i += 3
    ) {
        const row = [];

        for (
            let j = i;
            j < i + 3;
            j++
        ) {
            row.push({
                text: MONTHS[j],
                callback_data:
                    `calendar_${type}_month_${j}`
            });
        }

        keyboard.push(row);
    }

    keyboard.push([
        {
            text: "⬅️ Назад",
            callback_data:
                `calendar_${type}_back_year`
        }
    ]);

    keyboard.push([
        {
            text: "🏠 Главное меню",
            callback_data: "go_main_menu"
        }
    ]);

    await editInlineMessage(
        chatId,
        state.messageId,
        `${getCalendarTitle(type, "month")}\n\n${year} год`,
        {
            inline_keyboard: keyboard
        }
    );
}


/* =========================================================
   DAY CALENDAR
========================================================= */

async function showDays(
    chatId,
    state,
    type,
    year,
    month
) {
    state.calendarYear = year;
    state.calendarMonth = month;
    state.calendarType = type;

    const firstDay =
        new Date(
            year,
            month,
            1
        );

    let weekday =
        firstDay.getDay();

    if (weekday === 0) {
        weekday = 7;
    }

    const daysInMonth =
        new Date(
            year,
            month + 1,
            0
        ).getDate();

    const keyboard = [];

    keyboard.push(
        WEEKDAYS.map(day => ({
            text: day,
            callback_data: "noop"
        }))
    );

    let row = [];

    for (
        let i = 1;
        i < weekday;
        i++
    ) {
        row.push({
            text: " ",
            callback_data: "noop"
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
                `calendar_${type}_day_${year}_${month}_${day}`
        });

        if (row.length === 7) {
            keyboard.push(row);
            row = [];
        }
    }

    if (row.length) {
        while (row.length < 7) {
            row.push({
                text: " ",
                callback_data: "noop"
            });
        }

        keyboard.push(row);
    }

    keyboard.push([
        {
            text: "⬅️ Назад",
            callback_data:
                `calendar_${type}_back_month`
        }
    ]);

    keyboard.push([
        {
            text: "🏠 Главное меню",
            callback_data: "go_main_menu"
        }
    ]);

    await editInlineMessage(
        chatId,
        state.messageId,
        `${getCalendarTitle(type, "day")}\n\n${MONTHS[month]} ${year}`,
        {
            inline_keyboard: keyboard
        }
    );
}


/* =========================================================
   FORMAT DATE
========================================================= */

function formatDate(
    year,
    month,
    day
) {
    return [
        String(day).padStart(2, "0"),
        String(month + 1).padStart(2, "0"),
        year
    ].join(".");
}


/* =========================================================
   BIRTH CALENDAR
========================================================= */

async function showBirthCalendar(
    chatId,
    state
) {
    state.calendarType = "birth";
    state.calendarPage = 0;

    await showYearCalendar(
        chatId,
        state,
        "birth"
    );
}


/* =========================================================
   FLIGHT CALENDAR
========================================================= */

async function showFlightCalendar(
    chatId,
    state
) {
    state.calendarType = "flight";
    state.calendarPage = 0;

    await showYearCalendar(
        chatId,
        state,
        "flight"
    );
}


/* =========================================================
   ROUTES
========================================================= */

const ROUTES = [
    "ДШБ — ХРГ",
    "ХРГ — ДШБ"
];

const MAX_SEATS = 19;


function calculateRouteOccupancy(
    rows,
    flightDate,
    route,
    excludeRowNumber = null
) {
    let occupied = 0;

    for (
        let i = 1;
        i < rows.length;
        i++
    ) {
        const rowNumber = i + 1;

        if (
            excludeRowNumber &&
            rowNumber === excludeRowNumber
        ) {
            continue;
        }

        const row = rows[i] || [];

        const passengerFlightDate =
            row[9] || "";

        const passengerRoute =
            row[10] || "";

        const passengerStatus =
            row[11] || "";

        if (
            passengerFlightDate === flightDate &&
            passengerRoute === route &&
            passengerStatus !== "Отменен"
        ) {
            occupied++;
        }
    }

    return {
        occupied,
        free:
            Math.max(
                0,
                MAX_SEATS - occupied
            ),
        available:
            occupied < MAX_SEATS
    };
}


/* =========================================================
   SHOW ROUTES
========================================================= */

async function showRoutes(
    chatId,
    state
) {
    const rows =
        await getAllRows();

    const keyboard = [];

    for (const route of ROUTES) {
        const occupancy =
            calculateRouteOccupancy(
                rows,
                state.data.flightDate,
                route
            );

        let text;

        if (occupancy.available) {
            text =
                `✈️ ${route} (${occupancy.occupied}/${MAX_SEATS})`;
        } else {
            text =
                `🔴 ${route} (Мест нет)`;
        }

        keyboard.push([
            {
                text,
                callback_data:
                    occupancy.available
                        ? `route_${route}`
                        : "route_full"
            }
        ]);
    }

    keyboard.push([
        {
            text: "⬅️ Изменить дату",
            callback_data:
                "change_flight_date"
        }
    ]);

    keyboard.push([
        {
            text: "🏠 Главное меню",
            callback_data: "go_main_menu"
        }
    ]);

    await editInlineMessage(
        chatId,
        state.messageId,
        `✈️ Выберите маршрут:\n\n📅 Дата рейса: ${state.data.flightDate}`,
        {
            inline_keyboard: keyboard
        }
    );
}


/* =========================================================
   STATUS
========================================================= */

const STATUSES = [
    "Подтвержден",
    "Ожидает",
    "Отменен"
];


function statusKeyboard() {
    return {
        inline_keyboard: [
            [
                {
                    text: "✅ Подтвержден",
                    callback_data:
                        "status_Подтвержден"
                }
            ],
            [
                {
                    text: "⏳ Ожидает",
                    callback_data:
                        "status_Ожидает"
                }
            ],
            [
                {
                    text: "❌ Отменен",
                    callback_data:
                        "status_Отменен"
                }
            ],
            [
                {
                    text: "⬅️ Изменить маршрут",
                    callback_data:
                        "change_route"
                }
            ],
            [
                {
                    text: "🏠 Главное меню",
                    callback_data:
                        "go_main_menu"
                }
            ]
        ]
    };
}


async function showStatusStep(
    chatId,
    state
) {
    await editInlineMessage(
        chatId,
        state.messageId,
        "📌 Выберите статус пассажира:",
        statusKeyboard()
    );
}


/* =========================================================
   PASSENGER ID
========================================================= */

function generatePassengerId() {
    const random =
        Math.floor(
            1000 +
            Math.random() * 9000
        );

    return `P-${Date.now()}-${random}`;
}


/* =========================================================
   SAVE PASSENGER
========================================================= */

async function savePassenger(
    data
) {
    const sheetTitle =
        await getSheetTitle();

    const passengerId =
        data.passengerId ||
        generatePassengerId();

    const values = [
        passengerId,
        data.surname || "",
        data.name || "",
        data.patronymic || "",
        data.birthDate || "",
        data.passport || "",
        data.citizenship || "",
        data.contact1 || "",
        data.contact2 || "",
        data.flightDate || "",
        data.route || "",
        data.status || ""
    ];

    const result =
        await sheets.spreadsheets.values.append({
            spreadsheetId:
                GOOGLE_SHEET_ID,

            range:
                `${sheetTitle}!A:L`,

            valueInputOption:
                "USER_ENTERED",

            insertDataOption:
                "INSERT_ROWS",

            requestBody: {
                values: [values]
            }
        });

    return {
        passengerId,
        result
    };
}


/* =========================================================
   UPDATE PASSENGER
========================================================= */

async function updatePassenger(
    rowNumber,
    data
) {
    const sheetTitle =
        await getSheetTitle();

    const values = [
        data.passengerId || "",
        data.surname || "",
        data.name || "",
        data.patronymic || "",
        data.birthDate || "",
        data.passport || "",
        data.citizenship || "",
        data.contact1 || "",
        data.contact2 || "",
        data.flightDate || "",
        data.route || "",
        data.status || ""
    ];

    const result =
        await sheets.spreadsheets.values.update({
            spreadsheetId:
                GOOGLE_SHEET_ID,

            range:
                `${sheetTitle}!A${rowNumber}:L${rowNumber}`,

            valueInputOption:
                "USER_ENTERED",

            requestBody: {
                values: [values]
            }
        });

    return result;
}


/* =========================================================
   PASSENGER CARD
========================================================= */

function passengerCard(data) {
    let text =
        "👤 ДАННЫЕ ПАССАЖИРА\n\n" +
        `🆔 ID: ${data.passengerId || "-"}\n` +
        `👤 Фамилия: ${data.surname || "-"}\n` +
        `👤 Имя: ${data.name || "-"}\n` +
        `👤 Отчество: ${data.patronymic || "-"}\n` +
        `🎂 Дата рождения: ${data.birthDate || "-"}\n` +
        `🛂 Паспорт: ${data.passport || "-"}\n` +
        `🌍 Гражданство: ${data.citizenship || "-"}\n`;

    if (data.contact1) {
        text +=
            `📞 Контакт 1: ${data.contact1}\n`;
    }

    if (data.contact2) {
        text +=
            `📞 Контакт 2: ${data.contact2}\n`;
    }

    text +=
        `📅 Дата рейса: ${data.flightDate || "-"}\n` +
        `✈️ Маршрут: ${data.route || "-"}\n` +
        `📌 Статус: ${data.status || "-"}`;

    return text;
}


function passengerActionsKeyboard() {
    return {
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
                        "go_main_menu"
                }
            ]
        ]
    };
}


/* =========================================================
   EDIT MENU
========================================================= */

function editMenuKeyboard() {
    return {
        inline_keyboard: [
            [
                {
                    text: "✏️ Фамилия",
                    callback_data:
                        "edit_field_surname"
                },
                {
                    text: "✏️ Имя",
                    callback_data:
                        "edit_field_name"
                }
            ],
            [
                {
                    text: "✏️ Отчество",
                    callback_data:
                        "edit_field_patronymic"
                }
            ],
            [
                {
                    text: "✏️ Дата рождения",
                    callback_data:
                        "edit_field_birthDate"
                }
            ],
            [
                {
                    text: "✏️ Паспорт",
                    callback_data:
                        "edit_field_passport"
                }
            ],
            [
                {
                    text: "✏️ Гражданство",
                    callback_data:
                        "edit_field_citizenship"
                }
            ],
            [
                {
                    text: "✏️ Контакт 1",
                    callback_data:
                        "edit_field_contact1"
                }
            ],
            [
                {
                    text: "✏️ Контакт 2",
                    callback_data:
                        "edit_field_contact2"
                }
            ],
            [
                {
                    text: "✏️ Дата рейса",
                    callback_data:
                        "edit_field_flightDate"
                }
            ],
            [
                {
                    text: "✏️ Маршрут",
                    callback_data:
                        "edit_field_route"
                }
            ],
            [
                {
                    text: "✏️ Статус",
                    callback_data:
                        "edit_field_status"
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
    };
}


async function showEditMenu(
    chatId,
    state
) {
    await editInlineMessage(
        chatId,
        state.messageId,
        "✏️ Выберите, что хотите изменить:",
        editMenuKeyboard()
    );
}


/* =========================================================
   EDIT TEXT FIELD
========================================================= */

const EDIT_TEXT_PROMPTS = {
    surname:
        "✏️ Введите новую фамилию:",

    name:
        "✏️ Введите новое имя:",

    patronymic:
        "✏️ Введите новое отчество:",

    passport:
        "✏️ Введите новый номер паспорта:",

    contact1:
        "📞 Введите новый контакт 1:\n\n+992XXXXXXXXX",

    contact2:
        "📞 Введите новый контакт 2:\n\n+992XXXXXXXXX"
};


async function startEditTextField(
    chatId,
    state,
    field
) {
    state.editingField = field;

    await editInlineMessage(
        chatId,
        state.messageId,
        EDIT_TEXT_PROMPTS[field],
        {
            inline_keyboard: [
                [
                    {
                        text: "↩️ Назад",
                        callback_data:
                            "back_to_edit_menu"
                    }
                ]
            ]
        }
    );
}


/* =========================================================
   EDIT CITIZENSHIP
========================================================= */

function editCitizenshipKeyboard() {
    return {
        inline_keyboard: [
            [
                {
                    text: "🇹🇯 TJ",
                    callback_data:
                        "edit_citizenship_TJ"
                },
                {
                    text: "🇷🇺 RU",
                    callback_data:
                        "edit_citizenship_RU"
                }
            ],
            [
                {
                    text: "↩️ Назад",
                    callback_data:
                        "back_to_edit_menu"
                }
            ]
        ]
    };
}


/* =========================================================
   EDIT DATE
========================================================= */

async function startEditBirthDate(
    chatId,
    state
) {
    state.calendarType =
        "birth_edit";

    state.calendarPage = 0;

    await showYearCalendar(
        chatId,
        state,
        "birth_edit"
    );
}


async function startEditFlightDate(
    chatId,
    state
) {
    state.calendarType =
        "flight_edit";

    state.calendarPage = 0;

    await showYearCalendar(
        chatId,
        state,
        "flight_edit"
    );
}


/* =========================================================
   EDIT ROUTE
========================================================= */

async function startEditRoute(
    chatId,
    state
) {
    const rows =
        await getAllRows();

    const keyboard = [];

    for (const route of ROUTES) {
        const occupancy =
            calculateRouteOccupancy(
                rows,
                state.data.flightDate,
                route,
                state.rowNumber
            );

        const isCurrent =
            route === state.data.route;

        let text;

        if (!occupancy.available && !isCurrent) {
            text =
                `🔴 ${route} (Мест нет)`;
        } else {
            text =
                `✈️ ${route} (${occupancy.occupied}/${MAX_SEATS})`;

            if (isCurrent) {
                text =
                    `✅ ${route} (${occupancy.occupied}/${MAX_SEATS})`;
            }
        }

        keyboard.push([
            {
                text,
                callback_data:
                    (!occupancy.available && !isCurrent)
                        ? "route_full"
                        : `edit_route_${route}`
            }
        ]);
    }

    keyboard.push([
        {
            text: "↩️ Назад",
            callback_data:
                "back_to_edit_menu"
        }
    ]);

    await editInlineMessage(
        chatId,
        state.messageId,
        `✈️ Выберите новый маршрут:\n\n📅 Дата рейса: ${state.data.flightDate}`,
        {
            inline_keyboard: keyboard
        }
    );
}


/* =========================================================
   SAVE EDITED DATA
========================================================= */

async function saveEditedData(
    chatId,
    state
) {
    try {
        await updatePassenger(
            state.rowNumber,
            state.data
        );

        state.editingField = null;

        await editInlineMessage(
            chatId,
            state.messageId,
            "✅ Данные пассажира успешно изменены.\n\n" +
            passengerCard(state.data),
            passengerActionsKeyboard()
        );
    } catch (error) {
        console.error(
            "❌ Ошибка обновления пассажира:",
            error
        );

        await editInlineMessage(
            chatId,
            state.messageId,
            "❌ Не удалось изменить данные.\n\nПопробуйте ещё раз.",
            passengerActionsKeyboard()
        );
    }
}


/* =========================================================
   GO PREVIOUS STEP
========================================================= */

async function goToPreviousStep(
    chatId,
    state
) {
    if (
        state.step === 6 &&
        state.contactNumberBeingAdded === 2
    ) {
        state.contactNumberBeingAdded = 1;

        await showContactStep(
            chatId,
            state
        );

        return;
    }

    if (state.step <= 0) {
        await showMainMenu(
            chatId,
            state.messageId
        );

        return;
    }

    state.step--;

    switch (state.step) {
        case 0:
            await showStepPrompt(
                chatId,
                state
            );
            break;

        case 1:
            await showStepPrompt(
                chatId,
                state
            );
            break;

        case 2:
            await showStepPrompt(
                chatId,
                state
            );
            break;

        case 3:
            await showBirthCalendar(
                chatId,
                state
            );
            break;

        case 4:
            await showStepPrompt(
                chatId,
                state
            );
            break;

        case 5:
            await showCitizenshipStep(
                chatId,
                state
            );
            break;

        case 6:
            await showContactStep(
                chatId,
                state
            );
            break;

        case 7:
            await showFlightCalendar(
                chatId,
                state
            );
            break;

        case 8:
            await showRoutes(
                chatId,
                state
            );
            break;

        case 9:
            await showStatusStep(
                chatId,
                state
            );
            break;
    }
}


/* =========================================================
   HANDLE TEXT MESSAGE
========================================================= */

async function handleTextMessage(
    message
) {
    if (
        !message.chat ||
        !message.text
    ) {
        return;
    }

    const chatId =
        message.chat.id;

    const text =
        message.text.trim();

    const state =
        userStates[chatId];

    if (!state) {
        return;
    }


    /* =====================================================
       EDITING TEXT FIELD
    ===================================================== */

    if (state.editingField) {
        const field =
            state.editingField;

        if (
            [
                "surname",
                "name",
                "patronymic",
                "passport"
            ].includes(field)
        ) {
            if (!text.length) {
                await editInlineMessage(
                    chatId,
                    state.messageId,
                    EDIT_TEXT_PROMPTS[field]
                );

                return;
            }

            state.data[field] =
                text;

            await saveEditedData(
                chatId,
                state
            );

            return;
        }


        if (
            field === "contact1" ||
            field === "contact2"
        ) {
            const phone =
                normalizeTajikPhone(
                    text
                );

            if (
                !isValidTajikPhone(
                    phone
                )
            ) {
                await editInlineMessage(
                    chatId,
                    state.messageId,
                    "❌ Неверный формат номера.\n\n" +
                    "Введите номер в формате:\n" +
                    "+992XXXXXXXXX"
                );

                return;
            }

            state.data[field] =
                phone;

            await saveEditedData(
                chatId,
                state
            );

            return;
        }
    }


    /* =====================================================
       NORMAL REGISTRATION
    ===================================================== */

    switch (state.step) {

        case 0:
            state.data.surname =
                text;

            state.step = 1;

            await showStepPrompt(
                chatId,
                state
            );

            return;


        case 1:
            state.data.name =
                text;

            state.step = 2;

            await showStepPrompt(
                chatId,
                state
            );

            return;


        case 2:
            state.data.patronymic =
                text;

            state.step = 3;

            await showBirthCalendar(
                chatId,
                state
            );

            return;


        case 4:
            state.data.passport =
                text;

            state.step = 5;

            await showCitizenshipStep(
                chatId,
                state
            );

            return;


        case 6:
            {
                const phone =
                    normalizeTajikPhone(
                        text
                    );

                if (
                    !isValidTajikPhone(
                        phone
                    )
                ) {
                    await editInlineMessage(
                        chatId,
                        state.messageId,
                        "❌ Неверный формат номера.\n\n" +
                        "Введите номер в формате:\n" +
                        "+992XXXXXXXXX",
                        previousStepKeyboard()
                    );

                    return;
                }

                if (
                    state.contactNumberBeingAdded === 2
                ) {
                    state.data.contact2 =
                        phone;

                    state.contactNumberBeingAdded =
                        1;
                } else {
                    state.data.contact1 =
                        phone;
                }

                await showContactStep(
                    chatId,
                    state
                );

                return;
            }


        default:
            return;
    }
}


/* =========================================================
   HANDLE CALLBACK QUERY
========================================================= */

async function handleCallbackQuery(
    callbackQuery
) {
    const chatId =
        callbackQuery.message.chat.id;

    const messageId =
        callbackQuery.message.message_id;

    const data =
        callbackQuery.data;

    answerCallbackQuery(
        callbackQuery.id
    ).catch(() => {});


    /* =====================================================
       MAIN MENU
    ===================================================== */

    if (data === "go_main_menu") {
        const state =
            userStates[chatId];

        if (state) {
            state.editingField = null;
        }

        await showMainMenu(
            chatId,
            messageId
        );

        return;
    }


    /* =====================================================
       ADD PASSENGER
    ===================================================== */

    if (
        data === "main_add_passenger"
    ) {
        await startRegistration(
            chatId,
            messageId
        );

        return;
    }


    /* =====================================================
       PLACEHOLDERS
    ===================================================== */

    if (
        data === "main_view_data"
    ) {
        await editInlineMessage(
            chatId,
            messageId,
            "👤 Раздел «Посмотреть данные» пока находится в разработке.",
            {
                inline_keyboard: [
                    [
                        {
                            text: "🏠 Главное меню",
                            callback_data:
                                "go_main_menu"
                        }
                    ]
                ]
            }
        );

        return;
    }


    if (
        data === "main_find_passenger"
    ) {
        await editInlineMessage(
            chatId,
            messageId,
            "🔎 Раздел «Найти пассажира» пока находится в разработке.",
            {
                inline_keyboard: [
                    [
                        {
                            text: "🏠 Главное меню",
                            callback_data:
                                "go_main_menu"
                        }
                    ]
                ]
            }
        );

        return;
    }


    if (
        data === "main_flight_passengers"
    ) {
        await editInlineMessage(
            chatId,
            messageId,
            "✈️ Раздел «Пассажиры рейса» пока находится в разработке.",
            {
                inline_keyboard: [
                    [
                        {
                            text: "🏠 Главное меню",
                            callback_data:
                                "go_main_menu"
                        }
                    ]
                ]
            }
        );

        return;
    }


    if (
        data === "main_statistics"
    ) {
        await editInlineMessage(
            chatId,
            messageId,
            "📊 Раздел «Статистика» пока находится в разработке.",
            {
                inline_keyboard: [
                    [
                        {
                            text: "🏠 Главное меню",
                            callback_data:
                                "go_main_menu"
                        }
                    ]
                ]
            }
        );

        return;
    }


    /* =====================================================
       STATE
    ===================================================== */

    const state =
        userStates[chatId];

    if (!state) {
        return;
    }

    state.messageId =
        messageId;


    /* =====================================================
       NOOP
    ===================================================== */

    if (data === "noop") {
        return;
    }


    /* =====================================================
       PREVIOUS STEP
    ===================================================== */

    if (
        data === "previous_step"
    ) {
        await goToPreviousStep(
            chatId,
            state
        );

        return;
    }


    /* =====================================================
       BIRTH / FLIGHT CALENDAR YEAR PAGE
    ===================================================== */

    let match =
        data.match(
            /^calendar_(birth|flight|birth_edit|flight_edit)_year_page_(\d+)$/
        );

    if (match) {
        const type =
            match[1];

        const page =
            Number(match[2]);

        state.calendarPage =
            page;

        await showYearCalendar(
            chatId,
            state,
            type
        );

        return;
    }


    /* =====================================================
       CALENDAR BACK TO YEAR
    ===================================================== */

    match =
        data.match(
            /^calendar_(birth|flight|birth_edit|flight_edit)_back_year$/
        );

    if (match) {
        const type =
            match[1];

        state.calendarPage = 0;

        await showYearCalendar(
            chatId,
            state,
            type
        );

        return;
    }


    /* =====================================================
       CALENDAR BACK TO MONTH
    ===================================================== */

    match =
        data.match(
            /^calendar_(birth|flight|birth_edit|flight_edit)_back_month$/
        );

    if (match) {
        const type =
            match[1];

        await showMonths(
            chatId,
            state,
            type,
            state.calendarYear
        );

        return;
    }


    /* =====================================================
       CALENDAR YEAR
    ===================================================== */

    match =
        data.match(
            /^calendar_(birth|flight|birth_edit|flight_edit)_year_(\d{4})$/
        );

    if (match) {
        const type =
            match[1];

        const year =
            Number(match[2]);

        await showMonths(
            chatId,
            state,
            type,
            year
        );

        return;
    }


    /* =====================================================
       CALENDAR MONTH
    ===================================================== */

    match =
        data.match(
            /^calendar_(birth|flight|birth_edit|flight_edit)_month_(\d{1,2})$/
        );

    if (match) {
        const type =
            match[1];

        const month =
            Number(match[2]);

        await showDays(
            chatId,
            state,
            type,
            state.calendarYear,
            month
        );

        return;
    }


    /* =====================================================
       CALENDAR DAY
    ===================================================== */

    match =
        data.match(
            /^calendar_(birth|flight|birth_edit|flight_edit)_day_(\d{4})_(\d{1,2})_(\d{1,2})$/
        );

    if (match) {
        const type =
            match[1];

        const year =
            Number(match[2]);

        const month =
            Number(match[3]);

        const day =
            Number(match[4]);

        const selectedDate =
            new Date(
                year,
                month,
                day
            );

        const today =
            new Date();

        today.setHours(
            0,
            0,
            0,
            0
        );

        if (
            type === "birth" ||
            type === "birth_edit"
        ) {
            if (
                selectedDate > today
            ) {
                await editInlineMessage(
                    chatId,
                    state.messageId,
                    "❌ Дата рождения не может быть в будущем."
                );

                await showDays(
                    chatId,
                    state,
                    type,
                    year,
                    month
                );

                return;
            }
        }

        const formattedDate =
            formatDate(
                year,
                month,
                day
            );


        /* ================================================
           NORMAL BIRTH DATE
        ================================================= */

        if (type === "birth") {
            state.data.birthDate =
                formattedDate;

            state.step = 4;

            await showStepPrompt(
                chatId,
                state
            );

            return;
        }


        /* ================================================
           EDIT BIRTH DATE
        ================================================= */

        if (
            type === "birth_edit"
        ) {
            state.data.birthDate =
                formattedDate;

            await saveEditedData(
                chatId,
                state
            );

            return;
        }


        /* ================================================
           NORMAL FLIGHT DATE
        ================================================= */

        if (type === "flight") {
            state.data.flightDate =
                formattedDate;

            state.step = 8;

            await showRoutes(
                chatId,
                state
            );

            return;
        }


        /* ================================================
           EDIT FLIGHT DATE
        ================================================= */

        if (
            type === "flight_edit"
        ) {
            state.data.flightDate =
                formattedDate;

            await startEditRoute(
                chatId,
                state
            );

            return;
        }
    }


    /* =====================================================
       CITIZENSHIP
    ===================================================== */

    match =
        data.match(
            /^citizenship_(TJ|RU)$/
        );

    if (match) {
        state.data.citizenship =
            match[1];

        state.step = 6;

        state.contactNumberBeingAdded =
            1;

        await showContactStep(
            chatId,
            state
        );

        return;
    }


    /* =====================================================
       ADD SECOND CONTACT
    ===================================================== */

    if (
        data === "add_second_contact"
    ) {
        state.contactNumberBeingAdded =
            2;

        await editInlineMessage(
            chatId,
            state.messageId,
            "📞 Введите второй контактный номер:\n\n" +
            "+992XXXXXXXXX",
            {
                inline_keyboard: [
                    [
                        {
                            text: "↩️ Назад",
                            callback_data:
                                "back_to_contact_step"
                        }
                    ]
                ]
            }
        );

        return;
    }


    /* =====================================================
       BACK TO CONTACT STEP
    ===================================================== */

    if (
        data === "back_to_contact_step"
    ) {
        state.contactNumberBeingAdded =
            1;

        await showContactStep(
            chatId,
            state
        );

        return;
    }


    /* =====================================================
       CURRENT CONTACT EDIT
    ===================================================== */

    if (
        data === "edit_contact1_current"
    ) {
        state.editingField =
            "contact1";

        await editInlineMessage(
            chatId,
            state.messageId,
            "📞 Введите новый контакт 1:\n\n" +
            "+992XXXXXXXXX",
            {
                inline_keyboard: [
                    [
                        {
                            text: "↩️ Назад",
                            callback_data:
                                "back_to_contact_step"
                        }
                    ]
                ]
            }
        );

        return;
    }


    if (
        data === "edit_contact2_current"
    ) {
        state.editingField =
            "contact2";

        await editInlineMessage(
            chatId,
            state.messageId,
            "📞 Введите новый контакт 2:\n\n" +
            "+992XXXXXXXXX",
            {
                inline_keyboard: [
                    [
                        {
                            text: "↩️ Назад",
                            callback_data:
                                "back_to_contact_step"
                        }
                    ]
                ]
            }
        );

        return;
    }


    /* =====================================================
       CONTINUE AFTER CONTACT
    ===================================================== */

    if (
        data === "continue_after_contact"
    ) {
        if (!state.data.contact1) {
            await showContactStep(
                chatId,
                state
            );

            return;
        }

        state.step = 7;

        await showFlightCalendar(
            chatId,
            state
        );

        return;
    }


    /* =====================================================
       CHANGE FLIGHT DATE
    ===================================================== */

    if (
        data === "change_flight_date"
    ) {
        state.step = 7;

        await showFlightCalendar(
            chatId,
            state
        );

        return;
    }


    /* =====================================================
       ROUTE FULL
    ===================================================== */

    if (
        data === "route_full"
    ) {
        await editInlineMessage(
            chatId,
            state.messageId,
            "🔴 На выбранном направлении нет свободных мест.",
            {
                inline_keyboard: [
                    [
                        {
                            text: "⬅️ Назад",
                            callback_data:
                                "change_route"
                        }
                    ]
                ]
            }
        );

        return;
    }


    /* =====================================================
       NORMAL ROUTE
    ===================================================== */

    match =
        data.match(
            /^route_(ДШБ — ХРГ|ХРГ — ДШБ)$/
        );

    if (match) {
        const route =
            match[1];

        const rows =
            await getAllRows();

        const occupancy =
            calculateRouteOccupancy(
                rows,
                state.data.flightDate,
                route
            );

        if (!occupancy.available) {
            await showRoutes(
                chatId,
                state
            );

            return;
        }

        state.data.route =
            route;

        state.step = 9;

        await showStatusStep(
            chatId,
            state
        );

        return;
    }


    if (
        data === "change_route"
    ) {
        state.step = 8;

        await showRoutes(
            chatId,
            state
        );

        return;
    }


    /* =====================================================
       NORMAL STATUS
    ===================================================== */

    match =
        data.match(
            /^status_(Подтвержден|Ожидает|Отменен)$/
        );

    if (match) {
        const status =
            match[1];

        const rows =
            await getAllRows();

        const occupancy =
            calculateRouteOccupancy(
                rows,
                state.data.flightDate,
                state.data.route
            );

        if (
            status !== "Отменен" &&
            !occupancy.available
        ) {
            await editInlineMessage(
                chatId,
                state.messageId,
                "🔴 К сожалению, все 19 мест на выбранный рейс уже заняты.\n\n" +
                "Выберите другой маршрут.",
                {
                    inline_keyboard: [
                        [
                            {
                                text: "⬅️ Выбрать маршрут",
                                callback_data:
                                    "change_route"
                            }
                        ]
                    ]
                }
            );

            return;
        }

        state.data.status =
            status;

        try {
            const saved =
                await savePassenger(
                    state.data
                );

            state.data.passengerId =
                saved.passengerId;

            await editInlineMessage(
                chatId,
                state.messageId,
                "✅ Пассажир успешно добавлен!\n\n" +
                passengerCard(state.data),
                passengerActionsKeyboard()
            );

            /*
             * После append новый пассажир уже записан.
             * Повторно читать всю таблицу здесь не нужно.
             */
        } catch (error) {
            console.error(
                "❌ Ошибка сохранения пассажира:",
                error
            );

            await editInlineMessage(
                chatId,
                state.messageId,
                "❌ Не удалось сохранить пассажира.\n\n" +
                "Попробуйте ещё раз.",
                {
                    inline_keyboard: [
                        [
                            {
                                text: "🏠 Главное меню",
                                callback_data:
                                    "go_main_menu"
                            }
                        ]
                    ]
                }
            );
        }

        return;
    }


    /* =====================================================
       EDIT PASSENGER
    ===================================================== */

    if (
        data === "edit_passenger"
    ) {
        state.editingField = null;

        await showEditMenu(
            chatId,
            state
        );

        return;
    }


    /* =====================================================
       BACK TO PASSENGER CARD
    ===================================================== */

    if (
        data === "back_to_passenger"
    ) {
        await editInlineMessage(
            chatId,
            state.messageId,
            passengerCard(
                state.data
            ),
            passengerActionsKeyboard()
        );

        return;
    }


    /* =====================================================
       BACK TO EDIT MENU
    ===================================================== */

    if (
        data === "back_to_edit_menu"
    ) {
        state.editingField = null;

        await showEditMenu(
            chatId,
            state
        );

        return;
    }


    /* =====================================================
       EDIT TEXT FIELDS
    ===================================================== */

    match =
        data.match(
            /^edit_field_(surname|name|patronymic|passport|contact1|contact2)$/
        );

    if (match) {
        await startEditTextField(
            chatId,
            state,
            match[1]
        );

        return;
    }


    /* =====================================================
       EDIT CITIZENSHIP
    ===================================================== */

    if (
        data === "edit_field_citizenship"
    ) {
        state.editingField =
            "citizenship";

        await editInlineMessage(
            chatId,
            state.messageId,
            "🌍 Выберите новое гражданство:",
            editCitizenshipKeyboard()
        );

        return;
    }


    match =
        data.match(
            /^edit_citizenship_(TJ|RU)$/
        );

    if (match) {
        state.data.citizenship =
            match[1];

        await saveEditedData(
            chatId,
            state
        );

        return;
    }


    /* =====================================================
       EDIT BIRTH DATE
    ===================================================== */

    if (
        data === "edit_field_birthDate"
    ) {
        await startEditBirthDate(
            chatId,
            state
        );

        return;
    }


    /* =====================================================
       EDIT FLIGHT DATE
    ===================================================== */

    if (
        data === "edit_field_flightDate"
    ) {
        await startEditFlightDate(
            chatId,
            state
        );

        return;
    }


    /* =====================================================
       EDIT ROUTE
    ===================================================== */

    if (
        data === "edit_field_route"
    ) {
        await startEditRoute(
            chatId,
            state
        );

        return;
    }


    /* =====================================================
       EDIT ROUTE SELECTION
    ===================================================== */

    match =
        data.match(
            /^edit_route_(ДШБ — ХРГ|ХРГ — ДШБ)$/
        );

    if (match) {
        const route =
            match[1];

        const rows =
            await getAllRows();

        const occupancy =
            calculateRouteOccupancy(
                rows,
                state.data.flightDate,
                route,
                state.rowNumber
            );

        if (
            !occupancy.available &&
            route !== state.data.route
        ) {
            await startEditRoute(
                chatId,
                state
            );

            return;
        }

        state.data.route =
            route;

        await saveEditedData(
            chatId,
            state
        );

        return;
    }


    /* =====================================================
       EDIT STATUS
    ===================================================== */

    if (
        data === "edit_field_status"
    ) {
        state.editingField =
            "status";

        await editInlineMessage(
            chatId,
            state.messageId,
            "📌 Выберите новый статус:",
            {
                inline_keyboard: [
                    [
                        {
                            text: "✅ Подтвержден",
                            callback_data:
                                "edit_status_Подтвержден"
                        }
                    ],
                    [
                        {
                            text: "⏳ Ожидает",
                            callback_data:
                                "edit_status_Ожидает"
                        }
                    ],
                    [
                        {
                            text: "❌ Отменен",
                            callback_data:
                                "edit_status_Отменен"
                        }
                    ],
                    [
                        {
                            text: "↩️ Назад",
                            callback_data:
                                "back_to_edit_menu"
                        }
                    ]
                ]
            }
        );

        return;
    }


    match =
        data.match(
            /^edit_status_(Подтвержден|Ожидает|Отменен)$/
        );

    if (match) {
        const newStatus =
            match[1];

        if (
            newStatus !== "Отменен"
        ) {
            const rows =
                await getAllRows();

            const occupancy =
                calculateRouteOccupancy(
                    rows,
                    state.data.flightDate,
                    state.data.route,
                    state.rowNumber
                );

            if (
                !occupancy.available &&
                state.data.status === "Отменен"
            ) {
                await editInlineMessage(
                    chatId,
                    state.messageId,
                    "🔴 Нельзя изменить статус на активный: все 19 мест на этом рейсе уже заняты.",
                    {
                        inline_keyboard: [
                            [
                                {
                                    text: "↩️ Назад",
                                    callback_data:
                                        "back_to_edit_menu"
                                }
                            ]
                        ]
                    }
                );

                return;
            }
        }

        state.data.status =
            newStatus;

        await saveEditedData(
            chatId,
            state
        );

        return;
    }
}


/* =========================================================
   WEBHOOK
========================================================= */

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

        /*
         * Telegram должен получить 200 максимально быстро.
         * После этого обрабатываем update.
         */
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
                "❌ Ошибка обработки Telegram update:",
                error
            );
        }
    }
);


/* =========================================================
   HEALTH CHECK
========================================================= */

app.get(
    "/",
    (req, res) => {
        res.status(200).send(
            "KMRN Passenger Bot is running"
        );
    }
);


/* =========================================================
   SET WEBHOOK
========================================================= */

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


/* =========================================================
   START SERVER
========================================================= */

app.listen(
    PORT,
    async () => {
        console.log(
            `🚀 KMRN Passenger Bot запущен на порту ${PORT}`
        );

        /*
         * Загружаем название листа заранее.
         * Благодаря этому первый пользовательский запрос
         * не будет тратить время на spreadsheets.get().
         */
        try {
            await getSheetTitle();

            console.log(
                "📊 Google Sheets подключён"
            );
        } catch (error) {
            console.error(
                "❌ Ошибка подключения к Google Sheets:",
                error.message
            );
        }

        await setupWebhook();
    }
);
