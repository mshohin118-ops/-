require("dotenv").config();

const express = require("express");
const { google } = require("googleapis");
const XLSX = require("xlsx");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

const TELEGRAM_BOT_TOKEN =
    process.env.TELEGRAM_BOT_TOKEN;

const GOOGLE_CLIENT_EMAIL =
    process.env.GOOGLE_CLIENT_EMAIL;

const GOOGLE_PRIVATE_KEY =
    process.env.GOOGLE_PRIVATE_KEY
        ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n")
        : "";

const SPREADSHEET_ID =
    process.env.GOOGLE_SHEET_ID;

const TELEGRAM_WEBHOOK_SECRET =
    process.env.TELEGRAM_WEBHOOK_SECRET;

const PUBLIC_URL =
    process.env.PUBLIC_URL;

const CAPACITY = 19;
const PAGE_SIZE = 8;

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
    "Забронирован",
    "Подтвержден",
    "Отменен"
];

const REQUIRED_EXCEL_HEADERS = [
    "Фамилия",
    "Имя",
    "Отчество",
    "Дата рождения",
    "Паспорт",
    "Гражданство",
    "Контакт 1",
    "Контакт 2",
    "Дата рейса",
    "Маршрут",
    "Статус"
];

const states = new Map();

let cachedSheetTitle = null;


/* =========================================================
   TELEGRAM
========================================================= */

async function telegramRequest(method, body = {}) {
    if (!TELEGRAM_BOT_TOKEN) {
        throw new Error(
            "TELEGRAM_BOT_TOKEN не установлен"
        );
    }

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

    const result = await response.json();

    if (!result.ok) {
        console.error(
            `❌ Telegram ${method}:`,
            result
        );
    }

    return result;
}

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

    return telegramRequest(
        "sendMessage",
        body
    );
}

async function editMessage(
    chatId,
    messageId,
    text,
    replyMarkup = null
) {
    const body = {
        chat_id: chatId,
        message_id: messageId,
        text,
        reply_markup:
            replyMarkup || {
                inline_keyboard: []
            }
    };

    return telegramRequest(
        "editMessageText",
        body
    );
}

async function answerCallbackQuery(
    callbackQueryId,
    text = ""
) {
    return telegramRequest(
        "answerCallbackQuery",
        {
            callback_query_id:
                callbackQueryId,
            text
        }
    );
}

async function deleteUserMessage(
    chatId,
    messageId
) {
    if (!messageId) return;

    try {
        const result =
            await telegramRequest(
                "deleteMessage",
                {
                    chat_id: chatId,
                    message_id: messageId
                }
            );

        if (!result.ok) {
            console.warn(
                "⚠️ Не удалось удалить сообщение:",
                result.description
            );
        }
    } catch (error) {
        console.warn(
            "⚠️ Ошибка удаления сообщения:",
            error.message
        );
    }
}


/* =========================================================
   GOOGLE SHEETS
========================================================= */

function getGoogleAuth() {
    if (
        !GOOGLE_CLIENT_EMAIL ||
        !GOOGLE_PRIVATE_KEY ||
        !SPREADSHEET_ID
    ) {
        throw new Error(
            "Не настроены Google переменные окружения. Проверь GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY и GOOGLE_SHEET_ID."
        );
    }

    return new google.auth.JWT(
        GOOGLE_CLIENT_EMAIL,
        null,
        GOOGLE_PRIVATE_KEY,
        [
            "https://www.googleapis.com/auth/spreadsheets"
        ]
    );
}

async function getSheets() {
    const auth =
        getGoogleAuth();

    return google.sheets({
        version: "v4",
        auth
    });
}

async function getSheetTitle() {
    if (cachedSheetTitle) {
        return cachedSheetTitle;
    }

    const sheets =
        await getSheets();

    const spreadsheet =
        await sheets.spreadsheets.get({
            spreadsheetId:
                SPREADSHEET_ID
        });

    if (
        !spreadsheet.data.sheets ||
        !spreadsheet.data.sheets.length
    ) {
        throw new Error(
            "В Google таблице нет листов."
        );
    }

    cachedSheetTitle =
        spreadsheet.data.sheets[0]
            .properties.title;

    console.log(
        "📄 Используется лист:",
        cachedSheetTitle
    );

    return cachedSheetTitle;
}

async function getAllPassengers() {
    const sheets =
        await getSheets();

    const sheetTitle =
        await getSheetTitle();

    const result =
        await sheets.spreadsheets.values.get({
            spreadsheetId:
                SPREADSHEET_ID,

            range:
                `${sheetTitle}!A:L`
        });

    return result.data.values || [];
}


/* =========================================================
   HELPERS
========================================================= */

function normalizeText(value) {
    return String(value || "").trim();
}

function normalizePassport(value) {
    return String(value || "")
        .trim()
        .replace(/\s+/g, "")
        .toUpperCase();
}

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

        viewMode: null,
        viewPage: 0,
        viewPassengers: [],
        viewDate: null,
        viewRoute: null
    };
}

function getState(chatId) {
    if (!states.has(chatId)) {
        states.set(
            chatId,
            createState()
        );
    }

    return states.get(chatId);
}

function generatePassengerId(
    existingIds = new Set()
) {
    let id;

    do {
        id =
            "P" +
            Date.now()
                .toString()
                .slice(-8) +
            Math.floor(
                Math.random() * 1000
            )
                .toString()
                .padStart(3, "0");
    } while (
        existingIds.has(id)
    );

    return id;
}

function validateTajikPhone(phone) {
    phone = String(phone || "")
        .trim()
        .replace(/\s+/g, "");

    if (/^\d{9}$/.test(phone)) {
        phone = "+992" + phone;
    }

    if (!/^\+992\d{9}$/.test(phone)) {
        return null;
    }

    return phone;
}

function isValidDateString(date) {
    if (
        !/^\d{2}\.\d{2}\.\d{4}$/.test(date)
    ) {
        return false;
    }

    const parts =
        date.split(".").map(Number);

    const day = parts[0];
    const month = parts[1];
    const year = parts[2];

    const d =
        new Date(
            year,
            month - 1,
            day
        );

    return (
        d.getFullYear() === year &&
        d.getMonth() === month - 1 &&
        d.getDate() === day
    );
}


/* =========================================================
   MAIN MENU
========================================================= */

function getMainMenuKeyboard() {
    return {
        inline_keyboard: [
            [
                {
                    text:
                        "➕ Добавить пассажира",
                    callback_data:
                        "main_add_passenger"
                }
            ],
            [
                {
                    text:
                        "📥 Загрузить Excel",
                    callback_data:
                        "main_upload_excel"
                }
            ],
            [
                {
                    text:
                        "👤 Посмотреть данные",
                    callback_data:
                        "main_view_data"
                }
            ],
            [
                {
                    text:
                        "🔎 Найти пассажира",
                    callback_data:
                        "main_find_passenger"
                }
            ],
            [
                {
                    text:
                        "✈️ Пассажиры рейса",
                    callback_data:
                        "main_flight_passengers"
                }
            ],
            [
                {
                    text:
                        "📊 Статистика",
                    callback_data:
                        "main_statistics"
                }
            ]
        ]
    };
}

async function showMainMenu(
    chatId,
    messageId = null
) {
    if (messageId) {
        return editMessage(
            chatId,
            messageId,
            "🏠 Главное меню",
            getMainMenuKeyboard()
        );
    }

    return sendMessage(
        chatId,
        "🏠 Главное меню",
        getMainMenuKeyboard()
    );
}


/* =========================================================
   REGISTRATION
========================================================= */

async function startRegistration(chatId) {
    const state =
        createState();

    states.set(
        chatId,
        state
    );

    const result =
        await sendMessage(
            chatId,
            "Введите фамилию:"
        );

    if (result.ok) {
        state.messageId =
            result.result.message_id;
    }
}

async function askRegistrationStep(
    chatId,
    state
) {
    if (state.step === 0) {
        await editMessage(
            chatId,
            state.messageId,
            "Введите фамилию:"
        );
        return;
    }

    if (state.step === 1) {
        await editMessage(
            chatId,
            state.messageId,
            "Введите имя:"
        );
        return;
    }

    if (state.step === 2) {
        await editMessage(
            chatId,
            state.messageId,
            "Введите отчество:"
        );
        return;
    }

    if (state.step === 3) {
        state.calendarType = "birth";
        state.calendarPage = 0;

        await showCalendar(
            chatId,
            state,
            "year"
        );

        return;
    }

    if (state.step === 4) {
        await editMessage(
            chatId,
            state.messageId,
            "Введите номер паспорта:"
        );
        return;
    }

    if (state.step === 5) {
        await showCitizenshipMenu(
            chatId,
            state
        );
        return;
    }

    if (state.step === 6) {
        await showContact1Menu(
            chatId,
            state
        );
        return;
    }

    if (state.step === 7) {
        state.calendarType = "flight";
        state.calendarPage = 0;

        await showCalendar(
            chatId,
            state,
            "year"
        );

        return;
    }

    if (state.step === 8) {
        await showRouteMenu(
            chatId,
            state
        );
        return;
    }

    if (state.step === 9) {
        await showStatusMenu(
            chatId,
            state
        );
    }
}


/* =========================================================
   CITIZENSHIP
========================================================= */

function getCitizenshipKeyboard() {
    return {
        inline_keyboard: [
            [
                {
                    text: "🇹🇯 TJ",
                    callback_data:
                        "citizenship_TJ"
                },
                {
                    text: "🇷🇺 RU",
                    callback_data:
                        "citizenship_RU"
                }
            ],
            [
                {
                    text: "🌍 Другое",
                    callback_data:
                        "registration_citizenship_other"
                }
            ]
        ]
    };
}

async function showCitizenshipMenu(
    chatId,
    state
) {
    await editMessage(
        chatId,
        state.messageId,
        "Выберите гражданство:",
        getCitizenshipKeyboard()
    );
}


/* =========================================================
   CONTACTS
========================================================= */

function getContact1Keyboard() {
    return {
        inline_keyboard: [
            [
                {
                    text: "🌍 Другое",
                    callback_data:
                        "contact1_other"
                }
            ]
        ]
    };
}

function getContact2Keyboard() {
    return {
        inline_keyboard: [
            [
                {
                    text: "🌍 Другое",
                    callback_data:
                        "contact2_other"
                }
            ]
        ]
    };
}

async function showContact1Menu(
    chatId,
    state
) {
    await editMessage(
        chatId,
        state.messageId,
        "Введите контакт 1:\n\nМожно ввести номер Таджикистана.\nНапример: 900000000",
        getContact1Keyboard()
    );
}

async function showContact2Menu(
    chatId,
    state
) {
    await editMessage(
        chatId,
        state.messageId,
        "Введите контакт 2:",
        getContact2Keyboard()
    );
}

function getContactsMenuKeyboard() {
    return {
        inline_keyboard: [
            [
                {
                    text:
                        "➕ Добавить ещё один номер",
                    callback_data:
                        "add_contact2"
                }
            ],
            [
                {
                    text:
                        "➡️ Продолжить",
                    callback_data:
                        "contacts_continue"
                }
            ]
        ]
    };
}

async function showContactMenu(
    chatId,
    state
) {
    await editMessage(
        chatId,
        state.messageId,
        "📞 Контакты\n\n" +
        `Контакт 1: ${
            state.data.contact1 ||
            "не указан"
        }\n` +
        `Контакт 2: ${
            state.data.contact2 ||
            "не указан"
        }`,
        getContactsMenuKeyboard()
    );
}


/* =========================================================
   ROUTES
========================================================= */

function getRouteKeyboard() {
    return {
        inline_keyboard: [
            [
                {
                    text:
                        "ДШБ — ХРГ",
                    callback_data:
                        "route_DSHB_XRG"
                }
            ],
            [
                {
                    text:
                        "ХРГ — ДШБ",
                    callback_data:
                        "route_XRG_DSHB"
                }
            ]
        ]
    };
}

async function showRouteMenu(
    chatId,
    state
) {
    await editMessage(
        chatId,
        state.messageId,
        "Выберите маршрут:",
        getRouteKeyboard()
    );
}


/* =========================================================
   STATUS
========================================================= */

function getStatusKeyboard() {
    return {
        inline_keyboard: [
            [
                {
                    text:
                        "Забронирован",
                    callback_data:
                        "status_booked"
                }
            ],
            [
                {
                    text:
                        "Подтвержден",
                    callback_data:
                        "status_confirmed"
                }
            ],
            [
                {
                    text:
                        "Отменен",
                    callback_data:
                        "status_cancelled"
                }
            ]
        ]
    };
}

async function showStatusMenu(
    chatId,
    state
) {
    await editMessage(
        chatId,
        state.messageId,
        "Выберите статус:",
        getStatusKeyboard()
    );
}


/* =========================================================
   CALENDAR
========================================================= */

function getBaseCalendarType(type) {
    if (type === "birth_edit") {
        return "birth";
    }

    if (type === "flight_edit") {
        return "flight";
    }

    return type;
}

function getCalendarTitle(
    type,
    level
) {
    const base =
        getBaseCalendarType(type);

    if (base === "birth") {
        if (level === "year") {
            return "🎂 Выберите год рождения:";
        }

        if (level === "month") {
            return "🎂 Выберите месяц рождения:";
        }

        return "🎂 Выберите день рождения:";
    }

    if (base === "flight") {
        return "📅 Выберите дату рейса:";
    }

    if (type === "view_date") {
        return "📅 Выберите дату рейса:";
    }

    return "📅 Выберите дату:";
}

function getBirthYears(page) {
    const currentYear =
        new Date().getFullYear();

    const start =
        currentYear -
        page * 12;

    const result = [];

    for (
        let i = 0;
        i < 12;
        i++
    ) {
        const year =
            start - i;

        if (year < 1940) {
            break;
        }

        result.push(year);
    }

    return result;
}

function getFlightYears(page) {
    const currentYear =
        new Date().getFullYear();

    const start =
        currentYear +
        page * 12;

    const result = [];

    for (
        let i = 0;
        i < 12;
        i++
    ) {
        const year =
            start + i;

        if (
            year >
            currentYear + 5
        ) {
            break;
        }

        result.push(year);
    }

    return result;
}

function getYearsKeyboard(
    type,
    page
) {
    const base =
        getBaseCalendarType(type);

    const years =
        base === "birth"
            ? getBirthYears(page)
            : getFlightYears(page);

    const keyboard = [];

    for (
        let i = 0;
        i < years.length;
        i += 3
    ) {
        const row = [];

        for (
            let j = i;
            j <
            Math.min(
                i + 3,
                years.length
            );
            j++
        ) {
            row.push({
                text:
                    String(years[j]),
                callback_data:
                    `calendar_year_${years[j]}`
            });
        }

        keyboard.push(row);
    }

    const navigation = [];

    if (page > 0) {
        navigation.push({
            text: "⬅️ Назад",
            callback_data:
                `calendar_year_page_${page - 1}`
        });
    }

    const nextYears =
        base === "birth"
            ? getBirthYears(page + 1)
            : getFlightYears(page + 1);

    if (nextYears.length > 0) {
        navigation.push({
            text: "➡️ Далее",
            callback_data:
                `calendar_year_page_${page + 1}`
        });
    }

    if (navigation.length) {
        keyboard.push(navigation);
    }

    return {
        inline_keyboard:
            keyboard
    };
}

function getMonthsKeyboard() {
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
                    `calendar_month_${j}`
            });
        }

        keyboard.push(row);
    }

    keyboard.push([
        {
            text: "⬅️ Назад",
            callback_data:
                "calendar_back_years"
        }
    ]);

    return {
        inline_keyboard:
            keyboard
    };
}

function getDaysKeyboard(
    year,
    month
) {
    const firstDay =
        new Date(
            year,
            month,
            1
        );

    let weekday =
        firstDay.getDay();

    weekday =
        weekday === 0
            ? 6
            : weekday - 1;

    const daysInMonth =
        new Date(
            year,
            month + 1,
            0
        ).getDate();

    const keyboard = [];

    keyboard.push(
        WEEKDAYS.map(
            day => ({
                text: day,
                callback_data:
                    "calendar_ignore"
            })
        )
    );

    let row = [];

    for (
        let i = 0;
        i < weekday;
        i++
    ) {
        row.push({
            text: " ",
            callback_data:
                "calendar_ignore"
        });
    }

    for (
        let day = 1;
        day <= daysInMonth;
        day++
    ) {
        if (row.length === 7) {
            keyboard.push(row);
            row = [];
        }

        row.push({
            text: String(day),
            callback_data:
                `calendar_day_${day}`
        });
    }

    if (row.length) {
        while (row.length < 7) {
            row.push({
                text: " ",
                callback_data:
                    "calendar_ignore"
            });
        }

        keyboard.push(row);
    }

    keyboard.push([
        {
            text: "⬅️ Назад",
            callback_data:
                "calendar_back_months"
        }
    ]);

    return {
        inline_keyboard:
            keyboard
    };
}

async function showCalendar(
    chatId,
    state,
    level
) {
    if (level === "year") {
        await editMessage(
            chatId,
            state.messageId,
            getCalendarTitle(
                state.calendarType,
                "year"
            ),
            getYearsKeyboard(
                state.calendarType,
                state.calendarPage
            )
        );

        return;
    }

    if (level === "month") {
        await editMessage(
            chatId,
            state.messageId,
            getCalendarTitle(
                state.calendarType,
                "month"
            ),
            getMonthsKeyboard()
        );

        return;
    }

    if (level === "day") {
        await editMessage(
            chatId,
            state.messageId,
            getCalendarTitle(
                state.calendarType,
                "day"
            ),
            getDaysKeyboard(
                state.calendarYear,
                state.calendarMonth
            )
        );
    }
}


/* =========================================================
   OCCUPANCY
========================================================= */

async function calculateRouteOccupancy(
    flightDate,
    route,
    excludeRowNumber = null
) {
    const rows =
        await getAllPassengers();

    let count = 0;

    for (
        let i = 1;
        i < rows.length;
        i++
    ) {
        const rowNumber =
            i + 1;

        if (
            excludeRowNumber &&
            Number(excludeRowNumber) ===
                rowNumber
        ) {
            continue;
        }

        const row =
            rows[i];

        if (
            (row[9] || "") === flightDate &&
            (row[10] || "") === route &&
            (row[11] || "") !== "Отменен"
        ) {
            count++;
        }
    }

    return count;
}


/* =========================================================
   SAVE / UPDATE
========================================================= */

async function savePassenger(data) {
    const sheets =
        await getSheets();

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

    await sheets.spreadsheets.values.append({
        spreadsheetId:
            SPREADSHEET_ID,

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

    const rows =
        await getAllPassengers();

    data.rowNumber =
        rows.length;

    return true;
}

async function updatePassenger(
    rowNumber,
    data
) {
    const sheets =
        await getSheets();

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

    return sheets.spreadsheets.values.update({
        spreadsheetId:
            SPREADSHEET_ID,

        range:
            `${sheetTitle}!A${rowNumber}:L${rowNumber}`,

        valueInputOption:
            "USER_ENTERED",

        requestBody: {
            values: [values]
        }
    });
}


/* =========================================================
   PASSENGER CARD
========================================================= */

function buildPassengerCard(data) {
    return (
        "👤 Данные пассажира\n\n" +
        `🆔 ID: ${data.passengerId || "—"}\n` +
        `Фамилия: ${data.surname || "—"}\n` +
        `Имя: ${data.name || "—"}\n` +
        `Отчество: ${data.patronymic || "—"}\n` +
        `Дата рождения: ${data.birthDate || "—"}\n` +
        `Паспорт: ${data.passport || "—"}\n` +
        `Гражданство: ${data.citizenship || "—"}\n` +
        `Контакт 1: ${data.contact1 || "—"}\n` +
        `Контакт 2: ${data.contact2 || "—"}\n` +
        `Дата рейса: ${data.flightDate || "—"}\n` +
        `Маршрут: ${data.route || "—"}\n` +
        `Статус: ${data.status || "—"}`
    );
}

function getPassengerCardKeyboard() {
    return {
        inline_keyboard: [
            [
                {
                    text:
                        "✏️ Изменить данные",
                    callback_data:
                        "passenger_edit"
                }
            ],
            [
                {
                    text:
                        "➕ Добавить ещё одного",
                    callback_data:
                        "passenger_add_another"
                }
            ],
            [
                {
                    text:
                        "🏠 Главное меню",
                    callback_data:
                        "passenger_main_menu"
                }
            ]
        ]
    };
}

async function showPassengerCard(
    chatId,
    state
) {
    await editMessage(
        chatId,
        state.messageId,
        buildPassengerCard(
            state.data
        ),
        getPassengerCardKeyboard()
    );
}


/* =========================================================
   EDIT MENU
========================================================= */

function getEditMenuKeyboard() {
    return {
        inline_keyboard: [
            [
                {
                    text: "✏️ Фамилия",
                    callback_data:
                        "edit_surname"
                },
                {
                    text: "✏️ Имя",
                    callback_data:
                        "edit_name"
                }
            ],
            [
                {
                    text: "✏️ Отчество",
                    callback_data:
                        "edit_patronymic"
                }
            ],
            [
                {
                    text: "✏️ Дата рождения",
                    callback_data:
                        "edit_birthDate"
                }
            ],
            [
                {
                    text: "✏️ Паспорт",
                    callback_data:
                        "edit_passport"
                }
            ],
            [
                {
                    text: "✏️ Гражданство",
                    callback_data:
                        "edit_citizenship"
                }
            ],
            [
                {
                    text: "✏️ Контакт 1",
                    callback_data:
                        "edit_contact1"
                }
            ],
            [
                {
                    text: "✏️ Контакт 2",
                    callback_data:
                        "edit_contact2"
                }
            ],
            [
                {
                    text: "✏️ Дата рейса",
                    callback_data:
                        "edit_flightDate"
                }
            ],
            [
                {
                    text: "✏️ Маршрут",
                    callback_data:
                        "edit_route"
                }
            ],
            [
                {
                    text: "✏️ Статус",
                    callback_data:
                        "edit_status"
                }
            ],
            [
                {
                    text: "↩️ Назад",
                    callback_data:
                        "edit_menu_back"
                }
            ]
        ]
    };
}

async function showEditMenu(
    chatId,
    state
) {
    state.editingField = null;

    await editMessage(
        chatId,
        state.messageId,
        "✏️ Что хотите изменить?",
        getEditMenuKeyboard()
    );
}


/* =========================================================
   EDIT CITIZENSHIP
========================================================= */

function getEditCitizenshipKeyboard() {
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
                    text: "🌍 Другое",
                    callback_data:
                        "edit_citizenship_other"
                }
            ],
            [
                {
                    text: "↩️ Назад",
                    callback_data:
                        "edit_back"
                }
            ]
        ]
    };
}

async function showEditCitizenship(
    chatId,
    state
) {
    await editMessage(
        chatId,
        state.messageId,
        "Выберите гражданство:",
        getEditCitizenshipKeyboard()
    );
}


/* =========================================================
   EDIT CONTACT
========================================================= */

function getEditContactKeyboard(number) {
    return {
        inline_keyboard: [
            [
                {
                    text: "🌍 Другое",
                    callback_data:
                        `edit_contact${number}_other`
                }
            ],
            [
                {
                    text: "↩️ Назад",
                    callback_data:
                        "edit_back"
                }
            ]
        ]
    };
}

async function showEditContact(
    chatId,
    state,
    number
) {
    await editMessage(
        chatId,
        state.messageId,
        `Введите контакт ${number}:`,
        getEditContactKeyboard(number)
    );
}


/* =========================================================
   FINISH REGISTRATION
========================================================= */

async function finishRegistration(
    chatId,
    state
) {
    if (
        state.data.status !==
        "Отменен"
    ) {
        const occupancy =
            await calculateRouteOccupancy(
                state.data.flightDate,
                state.data.route
            );

        if (occupancy >= CAPACITY) {
            await editMessage(
                chatId,
                state.messageId,
                `❌ На дату ${state.data.flightDate} маршрут ${state.data.route} заполнен: ${CAPACITY}/${CAPACITY}.`,
                {
                    inline_keyboard: [
                        [
                            {
                                text:
                                    "↩️ Выбрать другой маршрут",
                                callback_data:
                                    "registration_back_route"
                            }
                        ]
                    ]
                }
            );

            return;
        }
    }

    try {
        const rows =
            await getAllPassengers();

        const existingIds =
            new Set(
                rows
                    .slice(1)
                    .map(row => row[0])
                    .filter(Boolean)
            );

        state.data.passengerId =
            generatePassengerId(
                existingIds
            );

        await savePassenger(
            state.data
        );

        await showPassengerCard(
            chatId,
            state
        );
    } catch (error) {
        console.error(
            "❌ Ошибка сохранения:",
            error
        );

        await editMessage(
            chatId,
            state.messageId,
            "❌ Не удалось сохранить пассажира в Google Sheets.",
            {
                inline_keyboard: [
                    [
                        {
                            text:
                                "🏠 Главное меню",
                            callback_data:
                                "passenger_main_menu"
                        }
                    ]
                ]
            }
        );
    }
}


/* =========================================================
   VIEW DATA
========================================================= */

function getViewDataKeyboard() {
    return {
        inline_keyboard: [
            [
                {
                    text:
                        "📋 Все пассажиры",
                    callback_data:
                        "view_all"
                }
            ],
            [
                {
                    text:
                        "📅 По дате рейса",
                    callback_data:
                        "view_by_date"
                }
            ],
            [
                {
                    text:
                        "✈️ По маршруту",
                    callback_data:
                        "view_by_route"
                }
            ],
            [
                {
                    text:
                        "🔎 Найти по паспорту",
                    callback_data:
                        "view_by_passport"
                }
            ],
            [
                {
                    text:
                        "🆔 Найти по ID",
                    callback_data:
                        "view_by_id"
                }
            ],
            [
                {
                    text:
                        "↩️ Назад",
                    callback_data:
                        "view_data_back"
                }
            ]
        ]
    };
}

async function showViewDataMenu(
    chatId,
    state
) {
    state.viewMode = null;
    state.viewPage = 0;
    state.editingField = null;
    state.viewDate = null;
    state.viewRoute = null;

    await editMessage(
        chatId,
        state.messageId,
        "👤 Посмотреть данные\n\nЧто хотите посмотреть?",
        getViewDataKeyboard()
    );
}

function rowToPassenger(
    row,
    rowNumber
) {
    return {
        rowNumber,

        passengerId: row[0] || "",
        surname: row[1] || "",
        name: row[2] || "",
        patronymic: row[3] || "",
        birthDate: row[4] || "",
        passport: row[5] || "",
        citizenship: row[6] || "",
        contact1: row[7] || "",
        contact2: row[8] || "",
        flightDate: row[9] || "",
        route: row[10] || "",
        status: row[11] || ""
    };
}

async function getPassengerObjects() {
    const rows =
        await getAllPassengers();

    const result = [];

    for (
        let i = 1;
        i < rows.length;
        i++
    ) {
        result.push(
            rowToPassenger(
                rows[i],
                i + 1
            )
        );
    }

    return result;
}

function getPassengerListText(
    passengers,
    page,
    title
) {
    const total =
        passengers.length;

    const totalPages =
        Math.max(
            1,
            Math.ceil(
                total /
                PAGE_SIZE
            )
        );

    const safePage =
        Math.min(
            page,
            totalPages - 1
        );

    const start =
        safePage * PAGE_SIZE;

    const pagePassengers =
        passengers.slice(
            start,
            start + PAGE_SIZE
        );

    let text =
        `${title}\n\n`;

    if (!pagePassengers.length) {
        return text +
            "Пассажиров нет.";
    }

    pagePassengers.forEach(
        (passenger, index) => {
            const number =
                start + index + 1;

            text +=
                `${number}. ` +
                `${passenger.surname} ` +
                `${passenger.name}`;

            if (
                passenger.patronymic
            ) {
                text +=
                    ` ${passenger.patronymic}`;
            }

            text += "\n";

            text +=
                `   🆔 ${
                    passenger.passengerId ||
                    "—"
                }\n`;

            text +=
                `   📅 ${
                    passenger.flightDate ||
                    "—"
                } | ${
                    passenger.route ||
                    "—"
                }\n`;

            text +=
                `   ${
                    passenger.status ||
                    "—"
                }\n\n`;
        }
    );

    text +=
        `Страница ${
            safePage + 1
        } из ${totalPages}`;

    return text;
}

function getPassengerListKeyboard(
    passengers,
    page,
    prefix = "view"
) {
    const totalPages =
        Math.max(
            1,
            Math.ceil(
                passengers.length /
                PAGE_SIZE
            )
        );

    const keyboard = [];

    const start =
        page * PAGE_SIZE;

    const current =
        passengers.slice(
            start,
            start + PAGE_SIZE
        );

    current.forEach(
        (passenger, index) => {
            const number =
                start + index + 1;

            keyboard.push([
                {
                    text:
                        `${number}. ${passenger.surname} ${passenger.name}`,
                    callback_data:
                        `${prefix}_passenger_${passenger.rowNumber}`
                }
            ]);
        }
    );

    const navigation = [];

    if (page > 0) {
        navigation.push({
            text: "⬅️",
            callback_data:
                `${prefix}_page_${page - 1}`
        });
    }

    if (
        page <
        totalPages - 1
    ) {
        navigation.push({
            text: "➡️",
            callback_data:
                `${prefix}_page_${page + 1}`
        });
    }

    if (navigation.length) {
        keyboard.push(
            navigation
        );
    }

    keyboard.push([
        {
            text: "↩️ Назад",
            callback_data:
                "view_data_menu"
        }
    ]);

    return {
        inline_keyboard:
            keyboard
    };
}

async function showAllPassengers(
    chatId,
    state,
    page = 0
) {
    const passengers =
        await getPassengerObjects();

    state.viewMode = "all";
    state.viewPassengers =
        passengers;
    state.viewPage = page;

    await editMessage(
        chatId,
        state.messageId,
        getPassengerListText(
            passengers,
            page,
            "📋 Все пассажиры"
        ),
        getPassengerListKeyboard(
            passengers,
            page,
            "all"
        )
    );
}


/* =========================================================
   FILTERS
========================================================= */

async function showViewDateCalendar(
    chatId,
    state
) {
    state.calendarType =
        "view_date";

    state.calendarPage = 0;

    await showCalendar(
        chatId,
        state,
        "year"
    );
}

function getViewRouteKeyboard() {
    return {
        inline_keyboard: [
            [
                {
                    text:
                        "ДШБ — ХРГ",
                    callback_data:
                        "view_route_DSHB_XRG"
                }
            ],
            [
                {
                    text:
                        "ХРГ — ДШБ",
                    callback_data:
                        "view_route_XRG_DSHB"
                }
            ],
            [
                {
                    text:
                        "↩️ Назад",
                    callback_data:
                        "view_data_menu"
                }
            ]
        ]
    };
}

async function showViewRouteMenu(
    chatId,
    state
) {
    await editMessage(
        chatId,
        state.messageId,
        "✈️ Выберите маршрут:",
        getViewRouteKeyboard()
    );
}

async function showPassengersFiltered(
    chatId,
    state,
    passengers,
    title,
    prefix
) {
    state.viewPassengers =
        passengers;

    state.viewPage = 0;

    await editMessage(
        chatId,
        state.messageId,
        getPassengerListText(
            passengers,
            0,
            title
        ),
        getPassengerListKeyboard(
            passengers,
            0,
            prefix
        )
    );
}


/* =========================================================
   SEARCH
========================================================= */

async function showPassportSearch(
    chatId,
    state
) {
    state.viewMode =
        "passport_search";

    await editMessage(
        chatId,
        state.messageId,
        "🔎 Введите номер паспорта:"
    );
}

async function showIdSearch(
    chatId,
    state
) {
    state.viewMode =
        "id_search";

    await editMessage(
        chatId,
        state.messageId,
        "🆔 Введите ID пассажира:"
    );
}

async function showViewedPassenger(
    chatId,
    state,
    rowNumber
) {
    const rows =
        await getAllPassengers();

    const index =
        Number(rowNumber) - 1;

    if (
        index < 1 ||
        index >= rows.length
    ) {
        await editMessage(
            chatId,
            state.messageId,
            "❌ Пассажир не найден.",
            {
                inline_keyboard: [
                    [
                        {
                            text:
                                "↩️ Назад",
                            callback_data:
                                "view_data_menu"
                        }
                    ]
                ]
            }
        );

        return;
    }

    const passenger =
        rowToPassenger(
            rows[index],
            Number(rowNumber)
        );

    state.data =
        passenger;

    state.rowNumber =
        passenger.rowNumber;

    await editMessage(
        chatId,
        state.messageId,
        buildPassengerCard(
            passenger
        ),
        {
            inline_keyboard: [
                [
                    {
                        text:
                            "✏️ Изменить данные",
                        callback_data:
                            "view_passenger_edit"
                    }
                ],
                [
                    {
                        text:
                            "↩️ Назад к списку",
                        callback_data:
                            "view_back_to_list"
                    }
                ],
                [
                    {
                        text:
                            "🏠 Главное меню",
                        callback_data:
                            "view_main_menu"
                    }
                ]
            ]
        }
    );
}


/* =========================================================
   EXCEL HELPERS
========================================================= */

function normalizeExcelHeader(value) {
    return String(value || "")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
}

function normalizeExcelPhone(value) {
    let phone =
        String(value || "")
            .trim()
            .replace(/\s+/g, "")
            .replace(/-/g, "")
            .replace(/\(/g, "")
            .replace(/\)/g, "");

    if (!phone) {
        return "";
    }

    if (/^\d{9}$/.test(phone)) {
        return "+992" + phone;
    }

    if (/^992\d{9}$/.test(phone)) {
        return "+" + phone;
    }

    return phone;
}

function excelDateToString(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return "";
    }

    if (value instanceof Date) {
        const day =
            String(
                value.getDate()
            ).padStart(2, "0");

        const month =
            String(
                value.getMonth() + 1
            ).padStart(2, "0");

        const year =
            value.getFullYear();

        return `${day}.${month}.${year}`;
    }

    const text =
        String(value).trim();

    if (!text) {
        return "";
    }

    if (
        /^\d{2}\.\d{2}\.\d{4}$/.test(
            text
        )
    ) {
        return text;
    }

    if (
        /^\d{2}\/\d{2}\/\d{4}$/.test(
            text
        )
    ) {
        return text.replace(
            /\//g,
            "."
        );
    }

    if (
        /^\d{4}-\d{2}-\d{2}$/.test(
            text
        )
    ) {
        const parts =
            text.split("-");

        return (
            `${parts[2]}.${parts[1]}.${parts[0]}`
        );
    }

    if (
        /^\d+(\.\d+)?$/.test(text)
    ) {
        const serial =
            Number(text);

        if (
            serial > 1 &&
            serial < 100000
        ) {
            const date =
                new Date(
                    Date.UTC(
                        1899,
                        11,
                        30
                    ) +
                    serial *
                    86400000
                );

            const day =
                String(
                    date.getUTCDate()
                ).padStart(2, "0");

            const month =
                String(
                    date.getUTCMonth() + 1
                ).padStart(2, "0");

            const year =
                date.getUTCFullYear();

            return `${day}.${month}.${year}`;
        }
    }

    return "";
}

function normalizeExcelRoute(value) {
    const text =
        String(value || "")
            .trim()
            .toUpperCase()
            .replace(/–/g, "-")
            .replace(/—/g, "-")
            .replace(/\s+/g, "");

    if (
        text === "ДШБ-ХРГ"
    ) {
        return "ДШБ — ХРГ";
    }

    if (
        text === "ХРГ-ДШБ"
    ) {
        return "ХРГ — ДШБ";
    }

    return "";
}

function normalizeExcelStatus(value) {
    const text =
        String(value || "")
            .trim()
            .toLowerCase();

    if (
        text === "забронирован" ||
        text === "забронировано" ||
        text === "booked"
    ) {
        return "Забронирован";
    }

    if (
        text === "подтвержден" ||
        text === "подтверждён" ||
        text === "confirmed"
    ) {
        return "Подтвержден";
    }

    if (
        text === "отменен" ||
        text === "отменён" ||
        text === "cancelled" ||
        text === "canceled"
    ) {
        return "Отменен";
    }

    return "";
}


/* =========================================================
   EXCEL IMPORT
========================================================= */

async function handleExcelDocument(
    message
) {
    const chatId =
        message.chat.id;

    const document =
        message.document;

    if (!document) {
        return;
    }

    const fileName =
        document.file_name || "";

    if (
        !fileName
            .toLowerCase()
            .endsWith(".xlsx")
    ) {
        await sendMessage(
            chatId,
            "❌ Поддерживается только Excel-файл формата .xlsx."
        );

        return;
    }

    try {
        await sendMessage(
            chatId,
            "⏳ Excel получен.\n\nПроверяю данные..."
        );

        /* =========================================
           DOWNLOAD FILE FROM TELEGRAM
        ========================================= */

        const fileResult =
            await telegramRequest(
                "getFile",
                {
                    file_id:
                        document.file_id
                }
            );

        if (
            !fileResult.ok ||
            !fileResult.result.file_path
        ) {
            throw new Error(
                "Telegram не вернул путь к Excel-файлу."
            );
        }

        const filePath =
            fileResult.result.file_path;

        const fileResponse =
            await fetch(
                `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`
            );

        if (!fileResponse.ok) {
            throw new Error(
                "Не удалось скачать Excel-файл."
            );
        }

        const arrayBuffer =
            await fileResponse.arrayBuffer();

        const buffer =
            Buffer.from(arrayBuffer);

        /* =========================================
           READ EXCEL
        ========================================= */

        const workbook =
            XLSX.read(
                buffer,
                {
                    type: "buffer",
                    cellDates: true
                }
            );

        if (
            !workbook.SheetNames ||
            !workbook.SheetNames.length
        ) {
            throw new Error(
                "В Excel нет листов."
            );
        }

        const firstSheet =
            workbook.Sheets[
                workbook.SheetNames[0]
            ];

        const rows =
            XLSX.utils.sheet_to_json(
                firstSheet,
                {
                    header: 1,
                    defval: ""
                }
            );

        if (!rows.length) {
            throw new Error(
                "Excel-файл пустой."
            );
        }

        /* =========================================
           HEADERS
        ========================================= */

        const headers =
            rows[0].map(
                header =>
                    String(
                        header || ""
                    ).trim()
            );

        const normalizedHeaders =
            headers.map(
                normalizeExcelHeader
            );

        const missingHeaders = [];

        for (
            const required
            of REQUIRED_EXCEL_HEADERS
        ) {
            if (
                !normalizedHeaders.includes(
                    normalizeExcelHeader(
                        required
                    )
                )
            ) {
                missingHeaders.push(
                    required
                );
            }
        }

        if (
            missingHeaders.length
        ) {
            await sendMessage(
                chatId,
                "❌ Неверный формат Excel.\n\n" +
                "Отсутствуют колонки:\n\n" +
                missingHeaders
                    .map(
                        item =>
                            `• ${item}`
                    )
                    .join("\n") +
                "\n\n" +
                "Правильный формат:\n" +
                REQUIRED_EXCEL_HEADERS.join(
                    " | "
                )
            );

            return;
        }

        /* =========================================
           COLUMN INDEXES
        ========================================= */

        const columnIndexes = {};

        for (
            const header
            of REQUIRED_EXCEL_HEADERS
        ) {
            columnIndexes[header] =
                normalizedHeaders.indexOf(
                    normalizeExcelHeader(
                        header
                    )
                );
        }

        /* =========================================
           CURRENT PASSENGERS
        ========================================= */

        const existingPassengers =
            await getPassengerObjects();

        const existingPassports =
            new Set();

        const existingIds =
            new Set();

        const occupancyMap =
            new Map();

        for (
            const passenger
            of existingPassengers
        ) {
            const passport =
                normalizePassport(
                    passenger.passport
                );

            if (passport) {
                existingPassports.add(
                    passport
                );
            }

            if (
                passenger.passengerId
            ) {
                existingIds.add(
                    passenger.passengerId
                );
            }

            if (
                passenger.status !==
                "Отменен"
            ) {
                const key =
                    `${passenger.flightDate}|${passenger.route}`;

                occupancyMap.set(
                    key,
                    (
                        occupancyMap.get(
                            key
                        ) || 0
                    ) + 1
                );
            }
        }

        /* =========================================
           RESULT COUNTERS
        ========================================= */

        let added = 0;
        let duplicates = 0;
        let capacityFull = 0;
        let errors = 0;

        const errorRows = [];
        const rowsToInsert = [];

        /* =========================================
           PROCESS EXCEL
        ========================================= */

        for (
            let i = 1;
            i < rows.length;
            i++
        ) {
            const excelRow =
                rows[i];

            const excelRowNumber =
                i + 1;

            const getValue =
                header => {
                    const index =
                        columnIndexes[
                            header
                        ];

                    return (
                        excelRow[index] ??
                        ""
                    );
                };

            const empty =
                excelRow.every(
                    value =>
                        String(
                            value || ""
                        ).trim() === ""
                );

            if (empty) {
                continue;
            }

            const surname =
                normalizeText(
                    getValue("Фамилия")
                );

            const name =
                normalizeText(
                    getValue("Имя")
                );

            const patronymic =
                normalizeText(
                    getValue("Отчество")
                );

            const birthDate =
                excelDateToString(
                    getValue(
                        "Дата рождения"
                    )
                );

            const passport =
                normalizeText(
                    getValue("Паспорт")
                );

            const passportKey =
                normalizePassport(
                    passport
                );

            const citizenship =
                normalizeText(
                    getValue(
                        "Гражданство"
                    )
                );

            const contact1 =
                normalizeExcelPhone(
                    getValue("Контакт 1")
                );

            const contact2 =
                normalizeExcelPhone(
                    getValue("Контакт 2")
                );

            const flightDate =
                excelDateToString(
                    getValue(
                        "Дата рейса"
                    )
                );

            const route =
                normalizeExcelRoute(
                    getValue("Маршрут")
                );

            const status =
                normalizeExcelStatus(
                    getValue("Статус")
                );

            const rowErrors = [];

            if (!surname) {
                rowErrors.push(
                    "не указана фамилия"
                );
            }

            if (!name) {
                rowErrors.push(
                    "не указано имя"
                );
            }

            if (!birthDate) {
                rowErrors.push(
                    "не указана дата рождения"
                );
            } else if (
                !isValidDateString(
                    birthDate
                )
            ) {
                rowErrors.push(
                    "неверная дата рождения"
                );
            }

            if (!passport) {
                rowErrors.push(
                    "не указан паспорт"
                );
            }

            if (!citizenship) {
                rowErrors.push(
                    "не указано гражданство"
                );
            }

            if (!flightDate) {
                rowErrors.push(
                    "не указана дата рейса"
                );
            } else if (
                !isValidDateString(
                    flightDate
                )
            ) {
                rowErrors.push(
                    "неверная дата рейса"
                );
            }

            if (!route) {
                rowErrors.push(
                    "неверный маршрут"
                );
            }

            if (!status) {
                rowErrors.push(
                    "неверный статус"
                );
            }

            if (rowErrors.length) {
                errors++;

                errorRows.push(
                    `Строка ${excelRowNumber}: ${rowErrors.join(", ")}`
                );

                continue;
            }

            /* =====================================
               DUPLICATE PASSPORT
            ===================================== */

            if (
                existingPassports.has(
                    passportKey
                )
            ) {
                duplicates++;

                errorRows.push(
                    `Строка ${excelRowNumber}: паспорт ${passport} уже существует`
                );

                continue;
            }

            /*
             * Добавляем паспорт в Set сразу.
             * Поэтому дубликаты внутри самого Excel
             * тоже будут обнаружены.
             */
            existingPassports.add(
                passportKey
            );

            /* =====================================
               CAPACITY
            ===================================== */

            const occupancyKey =
                `${flightDate}|${route}`;

            const currentOccupancy =
                occupancyMap.get(
                    occupancyKey
                ) || 0;

            if (
                status !== "Отменен" &&
                currentOccupancy >=
                    CAPACITY
            ) {
                capacityFull++;

                errorRows.push(
                    `Строка ${excelRowNumber}: ${flightDate} ${route} заполнен (${CAPACITY}/${CAPACITY})`
                );

                continue;
            }

            /* =====================================
               GENERATE ID
            ===================================== */

            const passengerId =
                generatePassengerId(
                    existingIds
                );

            existingIds.add(
                passengerId
            );

            /* =====================================
               ADD TO BUFFER
            ===================================== */

            rowsToInsert.push([
                passengerId,
                surname,
                name,
                patronymic,
                birthDate,
                passport,
                citizenship,
                contact1,
                contact2,
                flightDate,
                route,
                status
            ]);

            added++;

            if (
                status !== "Отменен"
            ) {
                occupancyMap.set(
                    occupancyKey,
                    currentOccupancy + 1
                );
            }
        }

        /* =========================================
           INSERT ALL VALID ROWS
        ========================================= */

        if (
            rowsToInsert.length
        ) {
            const sheets =
                await getSheets();

            const sheetTitle =
                await getSheetTitle();

            await sheets.spreadsheets.values.append({
                spreadsheetId:
                    SPREADSHEET_ID,

                range:
                    `${sheetTitle}!A:L`,

                valueInputOption:
                    "USER_ENTERED",

                insertDataOption:
                    "INSERT_ROWS",

                requestBody: {
                    values:
                        rowsToInsert
                }
            });

            console.log(
                `✅ Excel: добавлено строк: ${rowsToInsert.length}`
            );
        }

        /* =========================================
           REPORT
        ========================================= */

        let resultText =
            "✅ Excel обработан\n\n" +
            `➕ Добавлено: ${added}\n` +
            `🔁 Дубликаты паспортов: ${duplicates}\n` +
            `💺 Заполненные рейсы: ${capacityFull}\n` +
            `⚠️ Ошибки строк: ${errors}`;

        if (
            errorRows.length
        ) {
            resultText +=
                "\n\n📋 Подробности:\n\n";

            const details =
                errorRows.join("\n");

            resultText +=
                details.slice(
                    0,
                    3000
                );

            if (
                details.length > 3000
            ) {
                resultText +=
                    "\n\n... список ошибок сокращён.";
            }
        }

        await sendMessage(
            chatId,
            resultText,
            {
                inline_keyboard: [
                    [
                        {
                            text:
                                "🏠 Главное меню",
                            callback_data:
                                "main_menu_back"
                        }
                    ]
                ]
            }
        );

    } catch (error) {
        console.error(
            "❌ ОШИБКА EXCEL:",
            error
        );

        await sendMessage(
            chatId,
            "❌ Не удалось обработать Excel.\n\n" +
            error.message,
            {
                inline_keyboard: [
                    [
                        {
                            text:
                                "🏠 Главное меню",
                            callback_data:
                                "main_menu_back"
                        }
                    ]
                ]
            }
        );
    }
}


/* =========================================================
   TEXT HANDLER
========================================================= */

async function handleTextMessage(
    message
) {
    const chatId =
        message.chat.id;

    const text =
        normalizeText(
            message.text
        );

    if (!text) {
        return;
    }

    if (text === "/start") {
        states.delete(chatId);

        const result =
            await sendMessage(
                chatId,
                "🏠 Главное меню",
                getMainMenuKeyboard()
            );

        if (result.ok) {
            console.log(
                "✅ Главное меню отправлено"
            );
        }

        return;
    }

    const state =
        getState(chatId);

    await deleteUserMessage(
        chatId,
        message.message_id
    );


    /* =========================================
       REGISTRATION OTHER CITIZENSHIP
    ========================================= */

    if (
        state.editingField ===
        "registration_citizenship_other"
    ) {
        state.data.citizenship =
            text;

        state.editingField = null;
        state.step = 6;

        await showContact1Menu(
            chatId,
            state
        );

        return;
    }


    /* =========================================
       REGISTRATION CONTACT 1 OTHER
    ========================================= */

    if (
        state.editingField ===
        "registration_contact1_other"
    ) {
        state.data.contact1 =
            text;

        state.editingField = null;

        await showContactMenu(
            chatId,
            state
        );

        return;
    }


    /* =========================================
       REGISTRATION CONTACT 2 OTHER
    ========================================= */

    if (
        state.editingField ===
        "registration_contact2_other"
    ) {
        state.data.contact2 =
            text;

        state.editingField = null;

        await showContactMenu(
            chatId,
            state
        );

        return;
    }


    /* =========================================
       EDIT CITIZENSHIP OTHER
    ========================================= */

    if (
        state.editingField ===
        "citizenship_other"
    ) {
        state.data.citizenship =
            text;

        await updatePassenger(
            state.rowNumber,
            state.data
        );

        state.editingField = null;

        await showEditMenu(
            chatId,
            state
        );

        return;
    }


    /* =========================================
       EDIT CONTACT
    ========================================= */

    if (
        state.editingField ===
        "contact1_other"
    ) {
        state.data.contact1 =
            text;

        await updatePassenger(
            state.rowNumber,
            state.data
        );

        state.editingField = null;

        await showEditMenu(
            chatId,
            state
        );

        return;
    }

    if (
        state.editingField ===
        "contact2_other"
    ) {
        state.data.contact2 =
            text;

        await updatePassenger(
            state.rowNumber,
            state.data
        );

        state.editingField = null;

        await showEditMenu(
            chatId,
            state
        );

        return;
    }


    /* =========================================
       SEARCH PASSPORT
    ========================================= */

    if (
        state.viewMode ===
        "passport_search"
    ) {
        const passengers =
            await getPassengerObjects();

        const searchPassport =
            normalizePassport(text);

        const found =
            passengers.filter(
                passenger =>
                    normalizePassport(
                        passenger.passport
                    ) === searchPassport
            );

        if (!found.length) {
            await editMessage(
                chatId,
                state.messageId,
                "❌ Пассажир с таким номером паспорта не найден.",
                {
                    inline_keyboard: [
                        [
                            {
                                text:
                                    "↩️ Назад",
                                callback_data:
                                    "view_data_menu"
                            }
                        ]
                    ]
                }
            );

            return;
        }

        state.viewMode =
            "search_result";

        state.viewPassengers =
            found;

        state.viewPage = 0;

        await editMessage(
            chatId,
            state.messageId,
            getPassengerListText(
                found,
                0,
                "🔎 Результат поиска"
            ),
            getPassengerListKeyboard(
                found,
                0,
                "search"
            )
        );

        return;
    }


    /* =========================================
       SEARCH ID
    ========================================= */

    if (
        state.viewMode ===
        "id_search"
    ) {
        const passengers =
            await getPassengerObjects();

        const found =
            passengers.filter(
                passenger =>
                    String(
                        passenger.passengerId
                    ).toLowerCase() ===
                    text.toLowerCase()
            );

        if (!found.length) {
            await editMessage(
                chatId,
                state.messageId,
                "❌ Пассажир с таким ID не найден.",
                {
                    inline_keyboard: [
                        [
                            {
                                text:
                                    "↩️ Назад",
                                callback_data:
                                    "view_data_menu"
                            }
                        ]
                    ]
                }
            );

            return;
        }

        state.viewMode =
            "search_result";

        state.viewPassengers =
            found;

        state.viewPage = 0;

        await editMessage(
            chatId,
            state.messageId,
            getPassengerListText(
                found,
                0,
                "🆔 Результат поиска"
            ),
            getPassengerListKeyboard(
                found,
                0,
                "search"
            )
        );

        return;
    }


    /* =========================================
       EDIT TEXT
    ========================================= */

    if (
        [
            "surname",
            "name",
            "patronymic",
            "passport"
        ].includes(
            state.editingField
        )
    ) {
        state.data[
            state.editingField
        ] = text;

        await updatePassenger(
            state.rowNumber,
            state.data
        );

        state.editingField = null;

        await showEditMenu(
            chatId,
            state
        );

        return;
    }


    /* =========================================
       REGISTRATION
    ========================================= */

    if (state.step === 0) {
        state.data.surname =
            text;

        state.step = 1;

        await askRegistrationStep(
            chatId,
            state
        );

        return;
    }

    if (state.step === 1) {
        state.data.name =
            text;

        state.step = 2;

        await askRegistrationStep(
            chatId,
            state
        );

        return;
    }

    if (state.step === 2) {
        state.data.patronymic =
            text;

        state.step = 3;

        await askRegistrationStep(
            chatId,
            state
        );

        return;
    }

    if (state.step === 4) {
        state.data.passport =
            text;

        state.step = 5;

        await askRegistrationStep(
            chatId,
            state
        );

        return;
    }

    if (state.step === 6) {
        const phone =
            validateTajikPhone(
                text
            );

        if (!phone) {
            await editMessage(
                chatId,
                state.messageId,
                "❌ Неверный номер.\n\nВведите номер Таджикистана в формате 900000000 или +992900000000:",
                getContact1Keyboard()
            );

            return;
        }

        state.data.contact1 =
            phone;

        await showContactMenu(
            chatId,
            state
        );

        return;
    }
}


/* =========================================================
   CALLBACK HANDLER
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

    const state =
        getState(chatId);

    state.messageId =
        messageId;

    await answerCallbackQuery(
        callbackQuery.id
    );


    /* =========================================
       MAIN MENU
    ========================================= */

    if (
        data ===
        "main_menu_back"
    ) {
        await showMainMenu(
            chatId,
            messageId
        );

        return;
    }

    if (
        data ===
        "main_add_passenger"
    ) {
        await startRegistration(
            chatId
        );

        return;
    }


    /* =========================================
       UPLOAD EXCEL
    ========================================= */

    if (
        data ===
        "main_upload_excel"
    ) {
        await editMessage(
            chatId,
            messageId,
            "📥 Загрузить Excel\n\n" +
            "Отправьте сюда Excel-файл в формате .xlsx.\n\n" +
            "Обязательные колонки:\n\n" +
            "Фамилия\n" +
            "Имя\n" +
            "Отчество\n" +
            "Дата рождения\n" +
            "Паспорт\n" +
            "Гражданство\n" +
            "Контакт 1\n" +
            "Контакт 2\n" +
            "Дата рейса\n" +
            "Маршрут\n" +
            "Статус",
            {
                inline_keyboard: [
                    [
                        {
                            text:
                                "🏠 Главное меню",
                            callback_data:
                                "main_menu_back"
                        }
                    ]
                ]
            }
        );

        return;
    }


    /* =========================================
       VIEW DATA
    ========================================= */

    if (
        data ===
        "main_view_data" ||
        data ===
        "main_find_passenger" ||
        data ===
        "main_flight_passengers"
    ) {
        await showViewDataMenu(
            chatId,
            state
        );

        return;
    }


    /* =========================================
       STATISTICS
    ========================================= */

    if (
        data ===
        "main_statistics"
    ) {
        const passengers =
            await getPassengerObjects();

        const total =
            passengers.length;

        const booked =
            passengers.filter(
                p =>
                    p.status ===
                    "Забронирован"
            ).length;

        const confirmed =
            passengers.filter(
                p =>
                    p.status ===
                    "Подтвержден"
            ).length;

        const cancelled =
            passengers.filter(
                p =>
                    p.status ===
                    "Отменен"
            ).length;

        await editMessage(
            chatId,
            messageId,
            "📊 Статистика\n\n" +
            `👥 Всего пассажиров: ${total}\n` +
            `🟡 Забронировано: ${booked}\n` +
            `🟢 Подтверждено: ${confirmed}\n` +
            `🔴 Отменено: ${cancelled}`,
            {
                inline_keyboard: [
                    [
                        {
                            text:
                                "🏠 Главное меню",
                            callback_data:
                                "main_menu_back"
                        }
                    ]
                ]
            }
        );

        return;
    }


    /* =========================================
       VIEW MENU
    ========================================= */

    if (
        data ===
        "view_data_menu"
    ) {
        await showViewDataMenu(
            chatId,
            state
        );

        return;
    }

    if (
        data ===
        "view_data_back"
    ) {
        await showMainMenu(
            chatId,
            messageId
        );

        return;
    }


    /* =========================================
       ALL PASSENGERS
    ========================================= */

    if (
        data ===
        "view_all"
    ) {
        await showAllPassengers(
            chatId,
            state,
            0
        );

        return;
    }

    if (
        data.startsWith(
            "all_page_"
        )
    ) {
        const page =
            Number(
                data.replace(
                    "all_page_",
                    ""
                )
            );

        await showAllPassengers(
            chatId,
            state,
            page
        );

        return;
    }

    if (
        data.startsWith(
            "all_passenger_"
        )
    ) {
        await showViewedPassenger(
            chatId,
            state,
            data.replace(
                "all_passenger_",
                ""
            )
        );

        return;
    }


    /* =========================================
       VIEW BY DATE
    ========================================= */

    if (
        data ===
        "view_by_date"
    ) {
        await showViewDateCalendar(
            chatId,
            state
        );

        return;
    }


    /* =========================================
       VIEW BY ROUTE
    ========================================= */

    if (
        data ===
        "view_by_route"
    ) {
        await showViewRouteMenu(
            chatId,
            state
        );

        return;
    }


    /* =========================================
       VIEW BY PASSPORT
    ========================================= */

    if (
        data ===
        "view_by_passport"
    ) {
        await showPassportSearch(
            chatId,
            state
        );

        return;
    }


    /* =========================================
       VIEW BY ID
    ========================================= */

    if (
        data ===
        "view_by_id"
    ) {
        await showIdSearch(
            chatId,
            state
        );

        return;
    }


    /* =========================================
       ROUTE FILTER
    ========================================= */

    if (
        data ===
        "view_route_DSHB_XRG" ||
        data ===
        "view_route_XRG_DSHB"
    ) {
        const route =
            data ===
            "view_route_DSHB_XRG"
                ? "ДШБ — ХРГ"
                : "ХРГ — ДШБ";

        const passengers =
            await getPassengerObjects();

        const filtered =
            passengers.filter(
                p =>
                    p.route ===
                    route
            );

        state.viewRoute =
            route;

        await showPassengersFiltered(
            chatId,
            state,
            filtered,
            `✈️ Пассажиры: ${route}`,
            "route"
        );

        return;
    }

    if (
        data.startsWith(
            "route_page_"
        )
    ) {
        const page =
            Number(
                data.replace(
                    "route_page_",
                    ""
                )
            );

        const passengers =
            state.viewPassengers || [];

        state.viewPage =
            page;

        await editMessage(
            chatId,
            state.messageId,
            getPassengerListText(
                passengers,
                page,
                `✈️ Пассажиры: ${
                    state.viewRoute || ""
                }`
            ),
            getPassengerListKeyboard(
                passengers,
                page,
                "route"
            )
        );

        return;
    }

    if (
        data.startsWith(
            "route_passenger_"
        )
    ) {
        await showViewedPassenger(
            chatId,
            state,
            data.replace(
                "route_passenger_",
                ""
            )
        );

        return;
    }


    /* =========================================
       SEARCH RESULT
    ========================================= */

    if (
        data.startsWith(
            "search_page_"
        )
    ) {
        const page =
            Number(
                data.replace(
                    "search_page_",
                    ""
                )
            );

        const passengers =
            state.viewPassengers || [];

        state.viewPage =
            page;

        await editMessage(
            chatId,
            state.messageId,
            getPassengerListText(
                passengers,
                page,
                "🔎 Результат поиска"
            ),
            getPassengerListKeyboard(
                passengers,
                page,
                "search"
            )
        );

        return;
    }

    if (
        data.startsWith(
            "search_passenger_"
        )
    ) {
        await showViewedPassenger(
            chatId,
            state,
            data.replace(
                "search_passenger_",
                ""
            )
        );

        return;
    }


    /* =========================================
       VIEW PASSENGER NAVIGATION
    ========================================= */

    if (
        data ===
        "view_back_to_list"
    ) {
        if (
            state.viewMode ===
            "all"
        ) {
            await showAllPassengers(
                chatId,
                state,
                state.viewPage || 0
            );

            return;
        }

        const passengers =
            state.viewPassengers || [];

        await editMessage(
            chatId,
            state.messageId,
            getPassengerListText(
                passengers,
                state.viewPage || 0,
                "🔎 Результат поиска"
            ),
            getPassengerListKeyboard(
                passengers,
                state.viewPage || 0,
                "search"
            )
        );

        return;
    }

    if (
        data ===
        "view_main_menu"
    ) {
        await showMainMenu(
            chatId,
            messageId
        );

        return;
    }


    /* =========================================
       CALENDAR
    ========================================= */

    if (
        data.startsWith(
            "calendar_year_page_"
        )
    ) {
        state.calendarPage =
            Number(
                data.replace(
                    "calendar_year_page_",
                    ""
                )
            );

        await showCalendar(
            chatId,
            state,
            "year"
        );

        return;
    }

    if (
        data.startsWith(
            "calendar_year_"
        )
    ) {
        state.calendarYear =
            Number(
                data.replace(
                    "calendar_year_",
                    ""
                )
            );

        await showCalendar(
            chatId,
            state,
            "month"
        );

        return;
    }

    if (
        data.startsWith(
            "calendar_month_"
        )
    ) {
        state.calendarMonth =
            Number(
                data.replace(
                    "calendar_month_",
                    ""
                )
            );

        await showCalendar(
            chatId,
            state,
            "day"
        );

        return;
    }

    if (
        data.startsWith(
            "calendar_day_"
        )
    ) {
        const day =
            Number(
                data.replace(
                    "calendar_day_",
                    ""
                )
            );

        const date =
            `${String(day).padStart(2, "0")}.` +
            `${String(
                state.calendarMonth + 1
            ).padStart(2, "0")}.` +
            `${state.calendarYear}`;

        const base =
            getBaseCalendarType(
                state.calendarType
            );

        /* BIRTH */

        if (
            base ===
            "birth"
        ) {
            const selected =
                new Date(
                    state.calendarYear,
                    state.calendarMonth,
                    day
                );

            const today =
                new Date();

            selected.setHours(
                0, 0, 0, 0
            );

            today.setHours(
                0, 0, 0, 0
            );

            if (
                selected > today
            ) {
                await answerCallbackQuery(
                    callbackQuery.id,
                    "❌ Дата рождения не может быть в будущем"
                );

                return;
            }

            state.data.birthDate =
                date;

            if (
                state.calendarType ===
                "birth_edit"
            ) {
                await updatePassenger(
                    state.rowNumber,
                    state.data
                );

                await showEditMenu(
                    chatId,
                    state
                );

                return;
            }

            state.step = 4;

            await askRegistrationStep(
                chatId,
                state
            );

            return;
        }

        /* FLIGHT */

        if (
            base ===
            "flight"
        ) {
            state.data.flightDate =
                date;

            if (
                state.calendarType ===
                "flight_edit"
            ) {
                const occupancy =
                    await calculateRouteOccupancy(
                        state.data.flightDate,
                        state.data.route,
                        state.rowNumber
                    );

                if (
                    state.data.status !==
                        "Отменен" &&
                    occupancy >=
                        CAPACITY
                ) {
                    await editMessage(
                        chatId,
                        state.messageId,
                        `❌ На дату ${date} маршрут ${state.data.route} заполнен: ${CAPACITY}/${CAPACITY}.`,
                        {
                            inline_keyboard: [
                                [
                                    {
                                        text:
                                            "↩️ Назад",
                                        callback_data:
                                            "edit_back"
                                    }
                                ]
                            ]
                        }
                    );

                    return;
                }

                await updatePassenger(
                    state.rowNumber,
                    state.data
                );

                await showEditMenu(
                    chatId,
                    state
                );

                return;
            }

            state.step = 8;

            await askRegistrationStep(
                chatId,
                state
            );

            return;
        }

        /* VIEW DATE */

        if (
            state.calendarType ===
            "view_date"
        ) {
            state.viewDate =
                date;

            const passengers =
                await getPassengerObjects();

            const filtered =
                passengers.filter(
                    p =>
                        p.flightDate ===
                        date
                );

            await showPassengersFiltered(
                chatId,
                state,
                filtered,
                `📅 Пассажиры на ${date}`,
                "date"
            );

            return;
        }

        return;
    }

    if (
        data ===
        "calendar_back_years"
    ) {
        await showCalendar(
            chatId,
            state,
            "year"
        );

        return;
    }

    if (
        data ===
        "calendar_back_months"
    ) {
        await showCalendar(
            chatId,
            state,
            "month"
        );

        return;
    }

    if (
        data ===
        "calendar_ignore"
    ) {
        return;
    }


    /* =========================================
       CITIZENSHIP
    ========================================= */

    if (
        data ===
        "citizenship_TJ" ||
        data ===
        "citizenship_RU"
    ) {
        state.data.citizenship =
            data ===
            "citizenship_TJ"
                ? "TJ"
                : "RU";

        state.step = 6;

        await showContact1Menu(
            chatId,
            state
        );

        return;
    }

    if (
        data ===
        "registration_citizenship_other"
    ) {
        state.editingField =
            "registration_citizenship_other";

        await editMessage(
            chatId,
            messageId,
            "🌍 Введите гражданство:"
        );

        return;
    }


    /* =========================================
       CONTACTS
    ========================================= */

    if (
        data ===
        "contact1_other"
    ) {
        state.editingField =
            "registration_contact1_other";

        await editMessage(
            chatId,
            messageId,
            "🌍 Введите контакт 1:"
        );

        return;
    }

    if (
        data ===
        "contact2_other"
    ) {
        state.editingField =
            "registration_contact2_other";

        await editMessage(
            chatId,
            messageId,
            "🌍 Введите контакт 2:"
        );

        return;
    }

    if (
        data ===
        "add_contact2"
    ) {
        await showContact2Menu(
            chatId,
            state
        );

        return;
    }

    if (
        data ===
        "contacts_continue"
    ) {
        state.step = 7;
        state.calendarType =
            "flight";
        state.calendarPage = 0;

        await showCalendar(
            chatId,
            state,
            "year"
        );

        return;
    }


    /* =========================================
       ROUTE
    ========================================= */

    if (
        state.step === 8 &&
        data ===
        "route_DSHB_XRG"
    ) {
        state.data.route =
            "ДШБ — ХРГ";

        state.step = 9;

        await showStatusMenu(
            chatId,
            state
        );

        return;
    }

    if (
        state.step === 8 &&
        data ===
        "route_XRG_DSHB"
    ) {
        state.data.route =
            "ХРГ — ДШБ";

        state.step = 9;

        await showStatusMenu(
            chatId,
            state
        );

        return;
    }


    /* =========================================
       STATUS
    ========================================= */

    if (
        state.step === 9 &&
        (
            data ===
                "status_booked" ||
            data ===
                "status_confirmed" ||
            data ===
                "status_cancelled"
        )
    ) {
        if (
            data ===
            "status_booked"
        ) {
            state.data.status =
                "Забронирован";
        }

        if (
            data ===
            "status_confirmed"
        ) {
            state.data.status =
                "Подтвержден";
        }

        if (
            data ===
            "status_cancelled"
        ) {
            state.data.status =
                "Отменен";
        }

        await finishRegistration(
            chatId,
            state
        );

        return;
    }

    if (
        data ===
        "registration_back_route"
    ) {
        state.step = 8;

        await showRouteMenu(
            chatId,
            state
        );

        return;
    }


    /* =========================================
       PASSENGER CARD
    ========================================= */

    if (
        data ===
        "passenger_edit"
    ) {
        await showEditMenu(
            chatId,
            state
        );

        return;
    }

    if (
        data ===
        "passenger_add_another"
    ) {
        await startRegistration(
            chatId
        );

        return;
    }

    if (
        data ===
        "passenger_main_menu"
    ) {
        await showMainMenu(
            chatId,
            messageId
        );

        return;
    }

    if (
        data ===
        "view_passenger_edit"
    ) {
        await showEditMenu(
            chatId,
            state
        );

        return;
    }


    /* =========================================
       EDIT TEXT
    ========================================= */

    if (
        data ===
        "edit_surname" ||
        data ===
        "edit_name" ||
        data ===
        "edit_patronymic" ||
        data ===
        "edit_passport"
    ) {
        const fieldMap = {
            edit_surname:
                "surname",
            edit_name:
                "name",
            edit_patronymic:
                "patronymic",
            edit_passport:
                "passport"
        };

        state.editingField =
            fieldMap[data];

        const textMap = {
            surname:
                "Введите новую фамилию:",
            name:
                "Введите новое имя:",
            patronymic:
                "Введите новое отчество:",
            passport:
                "Введите новый номер паспорта:"
        };

        await editMessage(
            chatId,
            messageId,
            textMap[
                state.editingField
            ]
        );

        return;
    }


    /* =========================================
       EDIT BIRTH DATE
    ========================================= */

    if (
        data ===
        "edit_birthDate"
    ) {
        state.calendarType =
            "birth_edit";

        state.calendarPage = 0;

        await showCalendar(
            chatId,
            state,
            "year"
        );

        return;
    }


    /* =========================================
       EDIT FLIGHT DATE
    ========================================= */

    if (
        data ===
        "edit_flightDate"
    ) {
        state.calendarType =
            "flight_edit";

        state.calendarPage = 0;

        await showCalendar(
            chatId,
            state,
            "year"
        );

        return;
    }


    /* =========================================
       EDIT CITIZENSHIP
    ========================================= */

    if (
        data ===
        "edit_citizenship"
    ) {
        await showEditCitizenship(
            chatId,
            state
        );

        return;
    }

    if (
        data ===
        "edit_citizenship_TJ" ||
        data ===
        "edit_citizenship_RU"
    ) {
        state.data.citizenship =
            data ===
            "edit_citizenship_TJ"
                ? "TJ"
                : "RU";

        await updatePassenger(
            state.rowNumber,
            state.data
        );

        await showEditMenu(
            chatId,
            state
        );

        return;
    }

    if (
        data ===
        "edit_citizenship_other"
    ) {
        state.editingField =
            "citizenship_other";

        await editMessage(
            chatId,
            messageId,
            "🌍 Введите гражданство:"
        );

        return;
    }


    /* =========================================
       EDIT CONTACT
    ========================================= */

    if (
        data ===
        "edit_contact1"
    ) {
        await showEditContact(
            chatId,
            state,
            1
        );

        return;
    }

    if (
        data ===
        "edit_contact2"
    ) {
        await showEditContact(
            chatId,
            state,
            2
        );

        return;
    }

    if (
        data ===
        "edit_contact1_other" ||
        data ===
        "edit_contact2_other"
    ) {
        state.editingField =
            data ===
            "edit_contact1_other"
                ? "contact1_other"
                : "contact2_other";

        await editMessage(
            chatId,
            messageId,
            data ===
                "edit_contact1_other"
                ? "🌍 Введите контакт 1:"
                : "🌍 Введите контакт 2:"
        );

        return;
    }


    /* =========================================
       EDIT ROUTE
    ========================================= */

    if (
        data ===
        "edit_route"
    ) {
        await editMessage(
            chatId,
            messageId,
            "Выберите новый маршрут:",
            {
                inline_keyboard: [
                    [
                        {
                            text:
                                "ДШБ — ХРГ",
                            callback_data:
                                "edit_route_DSHB_XRG"
                        }
                    ],
                    [
                        {
                            text:
                                "ХРГ — ДШБ",
                            callback_data:
                                "edit_route_XRG_DSHB"
                        }
                    ],
                    [
                        {
                            text:
                                "↩️ Назад",
                            callback_data:
                                "edit_back"
                        }
                    ]
                ]
            }
        );

        return;
    }

    if (
        data ===
        "edit_route_DSHB_XRG" ||
        data ===
        "edit_route_XRG_DSHB"
    ) {
        const newRoute =
            data ===
            "edit_route_DSHB_XRG"
                ? "ДШБ — ХРГ"
                : "ХРГ — ДШБ";

        const occupancy =
            await calculateRouteOccupancy(
                state.data.flightDate,
                newRoute,
                state.rowNumber
            );

        if (
            state.data.status !==
                "Отменен" &&
            occupancy >= CAPACITY
        ) {
            await editMessage(
                chatId,
                messageId,
                `❌ На дату ${state.data.flightDate} маршрут ${newRoute} заполнен: ${CAPACITY}/${CAPACITY}.`,
                {
                    inline_keyboard: [
                        [
                            {
                                text:
                                    "↩️ Назад",
                                callback_data:
                                    "edit_back"
                            }
                        ]
                    ]
                }
            );

            return;
        }

        state.data.route =
            newRoute;

        await updatePassenger(
            state.rowNumber,
            state.data
        );

        await showEditMenu(
            chatId,
            state
        );

        return;
    }


    /* =========================================
       EDIT STATUS
    ========================================= */

    if (
        data ===
        "edit_status"
    ) {
        await editMessage(
            chatId,
            messageId,
            "Выберите новый статус:",
            {
                inline_keyboard: [
                    [
                        {
                            text:
                                "Забронирован",
                            callback_data:
                                "edit_status_booked"
                        }
                    ],
                    [
                        {
                            text:
                                "Подтвержден",
                            callback_data:
                                "edit_status_confirmed"
                        }
                    ],
                    [
                        {
                            text:
                                "Отменен",
                            callback_data:
                                "edit_status_cancelled"
                        }
                    ],
                    [
                        {
                            text:
                                "↩️ Назад",
                            callback_data:
                                "edit_back"
                        }
                    ]
                ]
            }
        );

        return;
    }

    if (
        data ===
            "edit_status_booked" ||
        data ===
            "edit_status_confirmed"
    ) {
        const occupancy =
            await calculateRouteOccupancy(
                state.data.flightDate,
                state.data.route,
                state.rowNumber
            );

        if (
            occupancy >= CAPACITY
        ) {
            await editMessage(
                chatId,
                messageId,
                `❌ На дату ${state.data.flightDate} маршрут ${state.data.route} заполнен: ${CAPACITY}/${CAPACITY}.`,
                {
                    inline_keyboard: [
                        [
                            {
                                text:
                                    "↩️ Назад",
                                callback_data:
                                    "edit_back"
                            }
                        ]
                    ]
                }
            );

            return;
        }

        state.data.status =
            data ===
            "edit_status_booked"
                ? "Забронирован"
                : "Подтвержден";

        await updatePassenger(
            state.rowNumber,
            state.data
        );

        await showEditMenu(
            chatId,
            state
        );

        return;
    }

    if (
        data ===
        "edit_status_cancelled"
    ) {
        state.data.status =
            "Отменен";

        await updatePassenger(
            state.rowNumber,
            state.data
        );

        await showEditMenu(
            chatId,
            state
        );

        return;
    }


    /* =========================================
       EDIT BACK
    ========================================= */

    if (
        data ===
        "edit_menu_back"
    ) {
        await showPassengerCard(
            chatId,
            state
        );

        return;
    }

    if (
        data ===
        "edit_back"
    ) {
        await showEditMenu(
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
        console.log(
            "📡 Telegram отправил update"
        );

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
                "🚫 Неверный webhook secret"
            );

            return res.sendStatus(403);
        }

        const update =
            req.body;

        res.sendStatus(200);

        try {
            /* =====================================
               DOCUMENT / EXCEL
            ===================================== */

            if (
                update.message &&
                update.message.document
            ) {
                await handleExcelDocument(
                    update.message
                );
            }

            /* =====================================
               TEXT
            ===================================== */

            else if (
                update.message
            ) {
                await handleTextMessage(
                    update.message
                );
            }

            /* =====================================
               CALLBACK
            ===================================== */

            if (
                update.callback_query
            ) {
                await handleCallbackQuery(
                    update.callback_query
                );
            }
        } catch (error) {
            console.error(
                "❌ Ошибка обработки update:",
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
        res.send(
            "KMRN Passenger Bot работает."
        );
    }
);


/* =========================================================
   WEBHOOK SETUP
========================================================= */

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
                "🔐 Telegram Webhook успешно установлен"
            );
        } else {
            console.error(
                "❌ Ошибка установки Webhook:",
                result.description
            );
        }
    } catch (error) {
        console.error(
            "❌ Ошибка установки Webhook:",
            error.message
        );
    }
}


/* =========================================================
   ENV CHECK
========================================================= */

console.log(
    "=============================="
);

console.log(
    "🔍 Проверка переменных:"
);

console.log(
    "TELEGRAM_BOT_TOKEN:",
    TELEGRAM_BOT_TOKEN
        ? "OK"
        : "НЕТ"
);

console.log(
    "GOOGLE_CLIENT_EMAIL:",
    GOOGLE_CLIENT_EMAIL
        ? "OK"
        : "НЕТ"
);

console.log(
    "GOOGLE_PRIVATE_KEY:",
    GOOGLE_PRIVATE_KEY
        ? "OK"
        : "НЕТ"
);

console.log(
    "GOOGLE_SHEET_ID:",
    SPREADSHEET_ID
        ? "OK"
        : "НЕТ"
);

console.log(
    "TELEGRAM_WEBHOOK_SECRET:",
    TELEGRAM_WEBHOOK_SECRET
        ? "OK"
        : "НЕТ"
);

console.log(
    "PUBLIC_URL:",
    PUBLIC_URL
        ? "OK"
        : "НЕТ"
);

console.log(
    "=============================="
);


/* =========================================================
   START SERVER
========================================================= */

app.listen(
    PORT,
    async () => {
        console.log(
            `🚀 KMRN Passenger Bot запущен на порту ${PORT}`
        );

        await setupWebhook();
    }
);
