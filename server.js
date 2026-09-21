require("dotenv").config();

const express = require("express");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const GOOGLE_CLIENT_EMAIL =
    process.env.GOOGLE_CLIENT_EMAIL;

const GOOGLE_PRIVATE_KEY =
    process.env.GOOGLE_PRIVATE_KEY
        ? process.env.GOOGLE_PRIVATE_KEY.replace(
              /\\n/g,
              "\n"
          )
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
            `Telegram ${method}:`,
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
                "⚠️ Не удалось удалить сообщение пользователя:",
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
            "Не настроены Google переменные окружения"
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
    const auth = getGoogleAuth();

    return google.sheets({
        version: "v4",
        auth
    });
}

async function getSheetTitle() {
    if (cachedSheetTitle) {
        return cachedSheetTitle;
    }

    const sheets = await getSheets();

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
            "В таблице нет листов"
        );
    }

    cachedSheetTitle =
        spreadsheet.data.sheets[0]
            .properties.title;

    return cachedSheetTitle;
}

async function getAllPassengers() {
    const sheets = await getSheets();

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

function createState() {
    return {
        step: 0,
        data: {},

        calendarType: null,
        calendarPage: 0,

        editingField: null,

        rowNumber: null,

        calendarYear: null,
        calendarMonth: null,

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

function generatePassengerId() {
    return (
        "P" +
        Date.now()
            .toString()
            .slice(-8)
    );
}

function validateTajikPhone(phone) {
    phone = phone.trim();

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
        !/^\d{2}\.\d{2}\.\d{4}$/.test(
            date
        )
    ) {
        return false;
    }

    const parts =
        date.split(".").map(Number);

    const day = parts[0];
    const month = parts[1];
    const year = parts[2];

    const d = new Date(
        year,
        month - 1,
        day
    );

    return (
        d.getFullYear() === year &&
        d.getMonth() ===
            month - 1 &&
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
                    text: "➕ Добавить пассажира",
                    callback_data:
                        "main_add_passenger"
                }
            ],
            [
                {
                    text: "👤 Посмотреть данные",
                    callback_data:
                        "main_view_data"
                }
            ],
            [
                {
                    text: "🔎 Найти пассажира",
                    callback_data:
                        "main_find_passenger"
                }
            ],
            [
                {
                    text: "✈️ Пассажиры рейса",
                    callback_data:
                        "main_flight_passengers"
                }
            ],
            [
                {
                    text: "📊 Статистика",
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
    const state = createState();

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
        state.calendarType =
            "birth";

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
                    text: "➕ Добавить ещё один номер",
                    callback_data:
                        "add_contact2"
                }
            ],
            [
                {
                    text: "➡️ Продолжить",
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
    const text =
        "📞 Контакты\n\n" +
        `Контакт 1: ${
            state.data.contact1 ||
            "не указан"
        }\n` +
        `Контакт 2: ${
            state.data.contact2 ||
            "не указан"
        }`;

    await editMessage(
        chatId,
        state.messageId,
        text,
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
                    text: "ДШБ — ХРГ",
                    callback_data:
                        "route_DSHB_XRG"
                }
            ],
            [
                {
                    text: "ХРГ — ДШБ",
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
                    text: "Забронирован",
                    callback_data:
                        "status_booked"
                }
            ],
            [
                {
                    text: "Подтвержден",
                    callback_data:
                        "status_confirmed"
                }
            ],
            [
                {
                    text: "Отменен",
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
    if (
        type ===
        "birth_edit"
    ) {
        return "birth";
    }

    if (
        type ===
        "flight_edit"
    ) {
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

        if (level === "day") {
            return "🎂 Выберите день рождения:";
        }
    }

    if (base === "flight") {
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

    for (let i = 0; i < 12; i++) {
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

    for (let i = 0; i < 12; i++) {
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
                `calendar_year_page_${
                    page - 1
                }`
        });
    }

    const nextYears =
        base === "birth"
            ? getBirthYears(
                  page + 1
              )
            : getFlightYears(
                  page + 1
              );

    if (nextYears.length > 0) {
        navigation.push({
            text: "➡️ Далее",
            callback_data:
                `calendar_year_page_${
                    page + 1
                }`
        });
    }

    if (navigation.length) {
        keyboard.push(
            navigation
        );
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
                text:
                    MONTHS[j],
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
        WEEKDAYS.map(day => ({
            text: day,
            callback_data:
                "calendar_ignore"
        }))
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
            text:
                String(day),
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
            Number(
                excludeRowNumber
            ) === rowNumber
        ) {
            continue;
        }

        const row =
            rows[i];

        const passengerFlightDate =
            row[9] || "";

        const passengerRoute =
            row[10] || "";

        const passengerStatus =
            row[11] || "";

        if (
            passengerFlightDate ===
                flightDate &&
            passengerRoute ===
                route &&
            passengerStatus !==
                "Отменен"
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
        `🆔 ID: ${
            data.passengerId || "—"
        }\n` +
        `Фамилия: ${
            data.surname || "—"
        }\n` +
        `Имя: ${
            data.name || "—"
        }\n` +
        `Отчество: ${
            data.patronymic || "—"
        }\n` +
        `Дата рождения: ${
            data.birthDate || "—"
        }\n` +
        `Паспорт: ${
            data.passport || "—"
        }\n` +
        `Гражданство: ${
            data.citizenship || "—"
        }\n` +
        `Контакт 1: ${
            data.contact1 || "—"
        }\n` +
        `Контакт 2: ${
            data.contact2 || "—"
        }\n` +
        `Дата рейса: ${
            data.flightDate || "—"
        }\n` +
        `Маршрут: ${
            data.route || "—"
        }\n` +
        `Статус: ${
            data.status || "—"
        }`
    );
}

function getPassengerCardKeyboard() {
    return {
        inline_keyboard: [
            [
                {
                    text: "✏️ Изменить данные",
                    callback_data:
                        "passenger_edit"
                }
            ],
            [
                {
                    text: "➕ Добавить ещё одного",
                    callback_data:
                        "passenger_add_another"
                }
            ],
            [
                {
                    text: "🏠 Главное меню",
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

function getEditContactKeyboard(
    number
) {
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
        getEditContactKeyboard(
            number
        )
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

        if (
            occupancy >= CAPACITY
        ) {
            await editMessage(
                chatId,
                state.messageId,
                `❌ На дату ${state.data.flightDate} маршрут ${state.data.route} заполнен: ${CAPACITY}/${CAPACITY}.`,
                {
                    inline_keyboard: [
                        [
                            {
                                text: "↩️ Выбрать другой маршрут",
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

    state.data.passengerId =
        generatePassengerId();

    await savePassenger(
        state.data
    );

    await showPassengerCard(
        chatId,
        state
    );
}


/* =========================================================
   VIEW DATA MENU
========================================================= */

function getViewDataKeyboard() {
    return {
        inline_keyboard: [
            [
                {
                    text: "📋 Все пассажиры",
                    callback_data:
                        "view_all"
                }
            ],
            [
                {
                    text: "📅 По дате рейса",
                    callback_data:
                        "view_by_date"
                }
            ],
            [
                {
                    text: "✈️ По маршруту",
                    callback_data:
                        "view_by_route"
                }
            ],
            [
                {
                    text: "🔎 Найти по паспорту",
                    callback_data:
                        "view_by_passport"
                }
            ],
            [
                {
                    text: "🆔 Найти по ID",
                    callback_data:
                        "view_by_id"
                }
            ],
            [
                {
                    text: "↩️ Назад",
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


/* =========================================================
   VIEW DATA — ALL PASSENGERS
========================================================= */

function rowToPassenger(
    row,
    rowNumber
) {
    return {
        rowNumber,

        passengerId:
            row[0] || "",

        surname:
            row[1] || "",

        name:
            row[2] || "",

        patronymic:
            row[3] || "",

        birthDate:
            row[4] || "",

        passport:
            row[5] || "",

        citizenship:
            row[6] || "",

        contact1:
            row[7] || "",

        contact2:
            row[8] || "",

        flightDate:
            row[9] || "",

        route:
            row[10] || "",

        status:
            row[11] || ""
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
                total / PAGE_SIZE
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

    if (
        !pagePassengers.length
    ) {
        text +=
            "Пассажиров нет.";

        return text;
    }

    pagePassengers.forEach(
        (
            passenger,
            index
        ) => {
            const number =
                start +
                index +
                1;

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
        (
            passenger,
            index
        ) => {
            const number =
                start +
                index +
                1;

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
                `${prefix}_page_${
                    page - 1
                }`
        });
    }

    if (
        page <
        totalPages - 1
    ) {
        navigation.push({
            text: "➡️",
            callback_data:
                `${prefix}_page_${
                    page + 1
                }`
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

    state.viewMode =
        "all";

    state.viewPassengers =
        passengers;

    state.viewPage =
        page;

    const text =
        getPassengerListText(
            passengers,
            page,
            "📋 Все пассажиры"
        );

    const keyboard =
        getPassengerListKeyboard(
            passengers,
            page,
            "all"
        );

    await editMessage(
        chatId,
        state.messageId,
        text,
        keyboard
    );
}


/* =========================================================
   VIEW DATA — BY DATE
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


/* =========================================================
   VIEW DATA — BY ROUTE
========================================================= */

function getViewRouteKeyboard() {
    return {
        inline_keyboard: [
            [
                {
                    text: "ДШБ — ХРГ",
                    callback_data:
                        "view_route_DSHB_XRG"
                }
            ],
            [
                {
                    text: "ХРГ — ДШБ",
                    callback_data:
                        "view_route_XRG_DSHB"
                }
            ],
            [
                {
                    text: "↩️ Назад",
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
   VIEW DATA — SEARCH
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


/* =========================================================
   SHOW VIEW PASSENGER
========================================================= */

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
                            text: "↩️ Назад",
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
                        text: "✏️ Изменить данные",
                        callback_data:
                            "view_passenger_edit"
                    }
                ],
                [
                    {
                        text: "↩️ Назад к списку",
                        callback_data:
                            "view_back_to_list"
                    }
                ],
                [
                    {
                        text: "🏠 Главное меню",
                        callback_data:
                            "view_main_menu"
                    }
                ]
            ]
        }
    );
}


/* =========================================================
   EDIT VIEWED PASSENGER
========================================================= */

async function editViewedPassenger(
    chatId,
    state
) {
    await showEditMenu(
        chatId,
        state
    );
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
                `✅ Главное меню отправлено. messageId=${result.result.message_id}`
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
       REGISTRATION CITIZENSHIP OTHER
    ========================================= */

    if (
        state.editingField ===
        "registration_citizenship_other"
    ) {
        state.data.citizenship =
            text;

        state.editingField =
            null;

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

        state.editingField =
            null;

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

        state.editingField =
            null;

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

        state.editingField =
            null;

        await showEditMenu(
            chatId,
            state
        );

        return;
    }


    /* =========================================
       EDIT CONTACT OTHER
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

        state.editingField =
            null;

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

        state.editingField =
            null;

        await showEditMenu(
            chatId,
            state
        );

        return;
    }


    /* =========================================
       VIEW SEARCH BY PASSPORT
    ========================================= */

    if (
        state.viewMode ===
        "passport_search"
    ) {
        const passengers =
            await getPassengerObjects();

        const found =
            passengers.filter(
                passenger =>
                    passenger.passport
                        .toLowerCase() ===
                    text.toLowerCase()
            );

        if (!found.length) {
            await editMessage(
                chatId,
                state.messageId,
                "❌ Пассажир с таким паспортом не найден.",
                {
                    inline_keyboard: [
                        [
                            {
                                text: "↩️ Назад",
                                callback_data:
                                    "view_data_menu"
                            }
                        ]
                    ]
                }
            );

            state.viewMode =
                null;

            return;
        }

        state.viewMode =
            "search_result";

        state.viewPassengers =
            found;

        await showPassengersFiltered(
            chatId,
            state,
            found,
            "🔎 Результат поиска",
            "search"
        );

        return;
    }


    /* =========================================
       VIEW SEARCH BY ID
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
                    passenger.passengerId
                        .toLowerCase() ===
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
                                text: "↩️ Назад",
                                callback_data:
                                    "view_data_menu"
                            }
                        ]
                    ]
                }
            );

            state.viewMode =
                null;

            return;
        }

        await showViewedPassenger(
            chatId,
            state,
            found[0].rowNumber
        );

        state.viewMode =
            "search_result";

        return;
    }


    /* =========================================
       EDIT TEXT FIELDS
    ========================================= */

    if (state.editingField) {
        const field =
            state.editingField;

        if (
            field ===
                "surname" ||
            field ===
                "name" ||
            field ===
                "patronymic" ||
            field ===
                "passport"
        ) {
            state.data[field] =
                text;

            await updatePassenger(
                state.rowNumber,
                state.data
            );

            state.editingField =
                null;

            await showEditMenu(
                chatId,
                state
            );

            return;
        }

        if (
            field ===
                "contact1" ||
            field ===
                "contact2"
        ) {
            const contact =
                validateTajikPhone(
                    text
                );

            if (!contact) {
                await editMessage(
                    chatId,
                    state.messageId,
                    "❌ Неверный номер.\n\nВведите номер Таджикистана в формате 900000000 или +992900000000.",
                    getEditContactKeyboard(
                        field ===
                            "contact1"
                            ? 1
                            : 2
                    )
                );

                return;
            }

            state.data[field] =
                contact;

            await updatePassenger(
                state.rowNumber,
                state.data
            );

            state.editingField =
                null;

            await showEditMenu(
                chatId,
                state
            );

            return;
        }
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
        const contact =
            validateTajikPhone(
                text
            );

        if (!contact) {
            await editMessage(
                chatId,
                state.messageId,
                "❌ Неверный номер.\n\nВведите номер Таджикистана в формате 900000000 или +992900000000.",
                getContact1Keyboard()
            );

            return;
        }

        state.data.contact1 =
            contact;

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
        "main_add_passenger"
    ) {
        await startRegistration(
            chatId
        );

        return;
    }

    if (
        data ===
        "main_view_data"
    ) {
        await showViewDataMenu(
            chatId,
            state
        );

        return;
    }

    if (
        data ===
        "main_find_passenger"
    ) {
        state.viewMode =
            "passport_search";

        await showPassportSearch(
            chatId,
            state
        );

        return;
    }

    if (
        data ===
        "main_flight_passengers"
    ) {
        state.viewMode =
            "view_date";

        await showViewDateCalendar(
            chatId,
            state
        );

        return;
    }

    if (
        data ===
        "main_statistics"
    ) {
        const passengers =
            await getPassengerObjects();

        const active =
            passengers.filter(
                p =>
                    p.status !==
                    "Отменен"
            );

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

        const dshbXrg =
            active.filter(
                p =>
                    p.route ===
                    "ДШБ — ХРГ"
            ).length;

        const xrgDshb =
            active.filter(
                p =>
                    p.route ===
                    "ХРГ — ДШБ"
            ).length;

        const text =
            "📊 Статистика\n\n" +
            `👤 Всего пассажиров: ${passengers.length}\n` +
            `🟢 Подтверждено: ${confirmed}\n` +
            `🟡 Забронировано: ${booked}\n` +
            `🔴 Отменено: ${cancelled}\n\n` +
            `✈️ ДШБ — ХРГ: ${dshbXrg}\n` +
            `✈️ ХРГ — ДШБ: ${xrgDshb}`;

        await editMessage(
            chatId,
            messageId,
            text,
            {
                inline_keyboard: [
                    [
                        {
                            text: "↩️ Назад",
                            callback_data:
                                "main_menu_back"
                        }
                    ]
                ]
            }
        );

        return;
    }

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


    /* =========================================
       VIEW DATA MENU
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
        data ===
        "view_by_date"
    ) {
        state.viewMode =
            "view_date";

        await showViewDateCalendar(
            chatId,
            state
        );

        return;
    }

    if (
        data ===
        "view_by_route"
    ) {
        state.viewMode =
            "view_route";

        await showViewRouteMenu(
            chatId,
            state
        );

        return;
    }

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
       VIEW ALL PAGINATION
    ========================================= */

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
        const rowNumber =
            Number(
                data.replace(
                    "all_passenger_",
                    ""
                )
            );

        await showViewedPassenger(
            chatId,
            state,
            rowNumber
        );

        return;
    }


    /* =========================================
       VIEW ROUTE
    ========================================= */

    if (
        data ===
        "view_route_DSHB_XRG"
    ) {
        const passengers =
            await getPassengerObjects();

        const filtered =
            passengers.filter(
                p =>
                    p.route ===
                    "ДШБ — ХРГ"
            );

        state.viewRoute =
            "ДШБ — ХРГ";

        await showPassengersFiltered(
            chatId,
            state,
            filtered,
            "✈️ ДШБ — ХРГ",
            "routeview"
        );

        return;
    }

    if (
        data ===
        "view_route_XRG_DSHB"
    ) {
        const passengers =
            await getPassengerObjects();

        const filtered =
            passengers.filter(
                p =>
                    p.route ===
                    "ХРГ — ДШБ"
            );

        state.viewRoute =
            "ХРГ — ДШБ";

        await showPassengersFiltered(
            chatId,
            state,
            filtered,
            "✈️ ХРГ — ДШБ",
            "routeview"
        );

        return;
    }

    if (
        data.startsWith(
            "routeview_page_"
        )
    ) {
        const page =
            Number(
                data.replace(
                    "routeview_page_",
                    ""
                )
            );

        await editMessage(
            chatId,
            messageId,
            getPassengerListText(
                state.viewPassengers,
                page,
                state.viewRoute ===
                    "ДШБ — ХРГ"
                    ? "✈️ ДШБ — ХРГ"
                    : "✈️ ХРГ — ДШБ"
            ),
            getPassengerListKeyboard(
                state.viewPassengers,
                page,
                "routeview"
            )
        );

        state.viewPage =
            page;

        return;
    }

    if (
        data.startsWith(
            "routeview_passenger_"
        )
    ) {
        const rowNumber =
            Number(
                data.replace(
                    "routeview_passenger_",
                    ""
                )
            );

        await showViewedPassenger(
            chatId,
            state,
            rowNumber
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

        state.viewPage =
            page;

        await editMessage(
            chatId,
            messageId,
            getPassengerListText(
                state.viewPassengers,
                page,
                "🔎 Результат поиска"
            ),
            getPassengerListKeyboard(
                state.viewPassengers,
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
        const rowNumber =
            Number(
                data.replace(
                    "search_passenger_",
                    ""
                )
            );

        await showViewedPassenger(
            chatId,
            state,
            rowNumber
        );

        return;
    }


    /* =========================================
       DATE CALENDAR
    ========================================= */

    if (
        data.startsWith(
            "calendar_year_page_"
        )
    ) {
        const page =
            Number(
                data.replace(
                    "calendar_year_page_",
                    ""
                )
            );

        state.calendarPage =
            page;

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
        const year =
            Number(
                data.replace(
                    "calendar_year_",
                    ""
                )
            );

        state.calendarYear =
            year;

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
        const month =
            Number(
                data.replace(
                    "calendar_month_",
                    ""
                )
            );

        state.calendarMonth =
            month;

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

        const year =
            state.calendarYear;

        const month =
            state.calendarMonth;

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

        const base =
            getBaseCalendarType(
                state.calendarType
            );

        if (
            base === "birth" &&
            selectedDate > today
        ) {
            await answerCallbackQuery(
                callbackQuery.id,
                "Дата рождения не может быть в будущем."
            );

            return;
        }

        const dateString =
            `${String(day).padStart(2, "0")}.` +
            `${String(month + 1).padStart(2, "0")}.` +
            `${year}`;


        /* -------------------------------------
           REGISTRATION BIRTH
        ------------------------------------- */

        if (
            state.calendarType ===
            "birth"
        ) {
            state.data.birthDate =
                dateString;

            state.step = 4;

            await askRegistrationStep(
                chatId,
                state
            );

            return;
        }


        /* -------------------------------------
           REGISTRATION FLIGHT
        ------------------------------------- */

        if (
            state.calendarType ===
            "flight"
        ) {
            state.data.flightDate =
                dateString;

            state.step = 8;

            await askRegistrationStep(
                chatId,
                state
            );

            return;
        }


        /* -------------------------------------
           EDIT BIRTH
        ------------------------------------- */

        if (
            state.calendarType ===
            "birth_edit"
        ) {
            state.data.birthDate =
                dateString;

            await updatePassenger(
                state.rowNumber,
                state.data
            );

            state.editingField =
                null;

            await showEditMenu(
                chatId,
                state
            );

            return;
        }


        /* -------------------------------------
           EDIT FLIGHT
        ------------------------------------- */

        if (
            state.calendarType ===
            "flight_edit"
        ) {
            if (
                state.data.status !==
                "Отменен"
            ) {
                const occupancy =
                    await calculateRouteOccupancy(
                        dateString,
                        state.data.route,
                        state.rowNumber
                    );

                if (
                    occupancy >=
                    CAPACITY
                ) {
                    await editMessage(
                        chatId,
                        messageId,
                        `❌ На дату ${dateString} маршрут ${state.data.route} заполнен: ${CAPACITY}/${CAPACITY}.`,
                        {
                            inline_keyboard: [
                                [
                                    {
                                        text: "↩️ Назад",
                                        callback_data:
                                            "edit_back"
                                    }
                                ]
                            ]
                        }
                    );

                    return;
                }
            }

            state.data.flightDate =
                dateString;

            await updatePassenger(
                state.rowNumber,
                state.data
            );

            state.editingField =
                null;

            await showEditMenu(
                chatId,
                state
            );

            return;
        }


        /* -------------------------------------
           VIEW DATE
        ------------------------------------- */

        if (
            state.calendarType ===
            "view_date"
        ) {
            const passengers =
                await getPassengerObjects();

            const filtered =
                passengers.filter(
                    passenger =>
                        passenger.flightDate ===
                        dateString
                );

            state.viewDate =
                dateString;

            await showPassengersFiltered(
                chatId,
                state,
                filtered,
                `📅 Пассажиры на ${dateString}`,
                "dateview"
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
       DATE VIEW PAGINATION
    ========================================= */

    if (
        data.startsWith(
            "dateview_page_"
        )
    ) {
        const page =
            Number(
                data.replace(
                    "dateview_page_",
                    ""
                )
            );

        state.viewPage =
            page;

        await editMessage(
            chatId,
            messageId,
            getPassengerListText(
                state.viewPassengers,
                page,
                `📅 Пассажиры на ${state.viewDate}`
            ),
            getPassengerListKeyboard(
                state.viewPassengers,
                page,
                "dateview"
            )
        );

        return;
    }

    if (
        data.startsWith(
            "dateview_passenger_"
        )
    ) {
        const rowNumber =
            Number(
                data.replace(
                    "dateview_passenger_",
                    ""
                )
            );

        await showViewedPassenger(
            chatId,
            state,
            rowNumber
        );

        return;
    }


    /* =========================================
       VIEWED PASSENGER
    ========================================= */

    if (
        data ===
        "view_passenger_edit"
    ) {
        await editViewedPassenger(
            chatId,
            state
        );

        return;
    }

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
                state.viewPage
            );

            return;
        }

        if (
            state.viewRoute
        ) {
            await editMessage(
                chatId,
                messageId,
                getPassengerListText(
                    state.viewPassengers,
                    state.viewPage,
                    `✈️ ${state.viewRoute}`
                ),
                getPassengerListKeyboard(
                    state.viewPassengers,
                    state.viewPage,
                    "routeview"
                )
            );

            return;
        }

        if (
            state.viewDate
        ) {
            await editMessage(
                chatId,
                messageId,
                getPassengerListText(
                    state.viewPassengers,
                    state.viewPage,
                    `📅 Пассажиры на ${state.viewDate}`
                ),
                getPassengerListKeyboard(
                    state.viewPassengers,
                    state.viewPage,
                    "dateview"
                )
            );

            return;
        }

        if (
            state.viewMode ===
            "search_result"
        ) {
            await editMessage(
                chatId,
                messageId,
                getPassengerListText(
                    state.viewPassengers,
                    state.viewPage,
                    "🔎 Результат поиска"
                ),
                getPassengerListKeyboard(
                    state.viewPassengers,
                    state.viewPage,
                    "search"
                )
            );

            return;
        }

        await showViewDataMenu(
            chatId,
            state
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
       CONTACT REGISTRATION
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
            "Введите контакт 1:"
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
            "Введите контакт 2:"
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
       CITIZENSHIP REGISTRATION
    ========================================= */

    if (
        data ===
        "citizenship_TJ"
    ) {
        state.data.citizenship =
            "TJ";

        state.step = 6;

        await showContact1Menu(
            chatId,
            state
        );

        return;
    }

    if (
        data ===
        "citizenship_RU"
    ) {
        state.data.citizenship =
            "RU";

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
            "Введите гражданство:"
        );

        return;
    }


    /* =========================================
       EDIT MENU
       ВАЖНО: ЭТОТ БЛОК ИДЁТ
       ДО REGISTRATION ROUTE/STATUS
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
        "view_passenger_edit"
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


    /* =========================================
       EDIT MENU BACK
       ГЛАВНАЯ ИСПРАВЛЕННАЯ КНОПКА
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


    /* =========================================
       BACK FROM EDIT SUBMENUS
    ========================================= */

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


    /* =========================================
       EDIT TEXT FIELDS
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
        const fields = {
            edit_surname:
                "surname",

            edit_name:
                "name",

            edit_patronymic:
                "patronymic",

            edit_passport:
                "passport"
        };

        const field =
            fields[data];

        state.editingField =
            field;

        const labels = {
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
            labels[field]
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
        state.editingField =
            "birthDate";

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
        state.editingField =
            "flightDate";

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
       EDIT CITIZENSHIP MENU
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


    /* =========================================
       EDIT CONTACT MENU
    ========================================= */

    if (
        data ===
        "edit_contact1"
    ) {
        state.editingField =
            "contact1";

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
        state.editingField =
            "contact2";

        await showEditContact(
            chatId,
            state,
            2
        );

        return;
    }


    /* =========================================
       EDIT CITIZENSHIP
    ========================================= */

    if (
        data ===
        "edit_citizenship_TJ"
    ) {
        state.data.citizenship =
            "TJ";

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
        "edit_citizenship_RU"
    ) {
        state.data.citizenship =
            "RU";

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
            "Введите гражданство:"
        );

        return;
    }


    /* =========================================
       EDIT CONTACT OTHER
    ========================================= */

    if (
        data ===
        "edit_contact1_other"
    ) {
        state.editingField =
            "contact1_other";

        await editMessage(
            chatId,
            messageId,
            "Введите контакт 1:"
        );

        return;
    }

    if (
        data ===
        "edit_contact2_other"
    ) {
        state.editingField =
            "contact2_other";

        await editMessage(
            chatId,
            messageId,
            "Введите контакт 2:"
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
        state.editingField =
            "route";

        await editMessage(
            chatId,
            messageId,
            "Выберите новый маршрут:",
            {
                inline_keyboard: [
                    [
                        {
                            text: "ДШБ — ХРГ",
                            callback_data:
                                "edit_route_DSHB_XRG"
                        }
                    ],
                    [
                        {
                            text: "ХРГ — ДШБ",
                            callback_data:
                                "edit_route_XRG_DSHB"
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
            }
        );

        return;
    }


    /* =========================================
       EDIT ROUTE — DSHB → XRG
    ========================================= */

    if (
        data ===
        "edit_route_DSHB_XRG"
    ) {
        const route =
            "ДШБ — ХРГ";

        if (
            state.data.status !==
            "Отменен"
        ) {
            const occupancy =
                await calculateRouteOccupancy(
                    state.data.flightDate,
                    route,
                    state.rowNumber
                );

            if (
                occupancy >=
                CAPACITY
            ) {
                await editMessage(
                    chatId,
                    messageId,
                    `❌ На дату ${state.data.flightDate} маршрут ${route} заполнен: ${CAPACITY}/${CAPACITY}.`,
                    {
                        inline_keyboard: [
                            [
                                {
                                    text: "↩️ Назад",
                                    callback_data:
                                        "edit_back"
                                }
                            ]
                        ]
                    }
                );

                return;
            }
        }

        state.data.route =
            route;

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
       EDIT ROUTE — XRG → DSHB
    ========================================= */

    if (
        data ===
        "edit_route_XRG_DSHB"
    ) {
        const route =
            "ХРГ — ДШБ";

        if (
            state.data.status !==
            "Отменен"
        ) {
            const occupancy =
                await calculateRouteOccupancy(
                    state.data.flightDate,
                    route,
                    state.rowNumber
                );

            if (
                occupancy >=
                CAPACITY
            ) {
                await editMessage(
                    chatId,
                    messageId,
                    `❌ На дату ${state.data.flightDate} маршрут ${route} заполнен: ${CAPACITY}/${CAPACITY}.`,
                    {
                        inline_keyboard: [
                            [
                                {
                                    text: "↩️ Назад",
                                    callback_data:
                                        "edit_back"
                                }
                            ]
                        ]
                    }
                );

                return;
            }
        }

        state.data.route =
            route;

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
        state.editingField =
            "status";

        await editMessage(
            chatId,
            messageId,
            "Выберите новый статус:",
            {
                inline_keyboard: [
                    [
                        {
                            text: "Забронирован",
                            callback_data:
                                "edit_status_booked"
                        }
                    ],
                    [
                        {
                            text: "Подтвержден",
                            callback_data:
                                "edit_status_confirmed"
                        }
                    ],
                    [
                        {
                            text: "Отменен",
                            callback_data:
                                "edit_status_cancelled"
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
            }
        );

        return;
    }


    /* =========================================
       EDIT STATUS — BOOKED
    ========================================= */

    if (
        data ===
        "edit_status_booked"
    ) {
        const status =
            "Забронирован";

        const occupancy =
            await calculateRouteOccupancy(
                state.data.flightDate,
                state.data.route,
                state.rowNumber
            );

        if (
            occupancy >=
            CAPACITY
        ) {
            await editMessage(
                chatId,
                messageId,
                `❌ На дату ${state.data.flightDate} маршрут ${state.data.route} заполнен: ${CAPACITY}/${CAPACITY}.`,
                {
                    inline_keyboard: [
                        [
                            {
                                text: "↩️ Назад",
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
            status;

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
       EDIT STATUS — CONFIRMED
    ========================================= */

    if (
        data ===
        "edit_status_confirmed"
    ) {
        const status =
            "Подтвержден";

        const occupancy =
            await calculateRouteOccupancy(
                state.data.flightDate,
                state.data.route,
                state.rowNumber
            );

        if (
            occupancy >=
            CAPACITY
        ) {
            await editMessage(
                chatId,
                messageId,
                `❌ На дату ${state.data.flightDate} маршрут ${state.data.route} заполнен: ${CAPACITY}/${CAPACITY}.`,
                {
                    inline_keyboard: [
                        [
                            {
                                text: "↩️ Назад",
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
            status;

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
       EDIT STATUS — CANCELLED
    ========================================= */

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
       REGISTRATION ROUTE
       ЭТОТ БЛОК ОСТАЁТСЯ ПОСЛЕ EDIT
    ========================================= */

    if (
        state.step === 8 &&
        (
            data ===
                "route_DSHB_XRG" ||
            data ===
                "route_XRG_DSHB"
        )
    ) {
        const route =
            data ===
                "route_DSHB_XRG"
                ? "ДШБ — ХРГ"
                : "ХРГ — ДШБ";

        const occupancy =
            await calculateRouteOccupancy(
                state.data.flightDate,
                route
            );

        if (
            occupancy >=
            CAPACITY
        ) {
            await editMessage(
                chatId,
                messageId,
                `❌ На дату ${state.data.flightDate} маршрут ${route} заполнен: ${CAPACITY}/${CAPACITY}.`,
                getRouteKeyboard()
            );

            return;
        }

        state.data.route =
            route;

        state.step = 9;

        await showStatusMenu(
            chatId,
            state
        );

        return;
    }


    /* =========================================
       REGISTRATION STATUS
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


    /* =========================================
       REGISTRATION BACK TO ROUTE
    ========================================= */

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

            return res.sendStatus(
                403
            );
        }

        console.log(
            "📡 Telegram отправил update"
        );

        console.log(
            "🔐 Webhook secret подтверждён"
        );

        res.sendStatus(200);

        try {
            const update =
                req.body;

            console.log(
                "📨 Получен update:",
                JSON.stringify(update)
            );

            if (
                update.message
            ) {
                console.log(
                    `📩 Получено сообщение от ${update.message.chat.id}: ${update.message.text || "[не текст]"}`
                );

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
        res.status(200).send(
            "KMRN Passenger Bot is running"
        );
    }
);


/* =========================================================
   WEBHOOK SETUP
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
            "❌ Ошибка установки Webhook:",
            error.message
        );
    }
}


/* =========================================================
   WEBHOOK INFO
========================================================= */

async function getWebhookInfo() {
    try {
        const result =
            await telegramRequest(
                "getWebhookInfo"
            );

        if (result.ok) {
            console.log(
                "🌐 Webhook info:",
                JSON.stringify(
                    result.result,
                    null,
                    2
                )
            );
        }
    } catch (error) {
        console.error(
            "❌ Ошибка получения Webhook info:",
            error.message
        );
    }
}


/* =========================================================
   START
========================================================= */

app.listen(
    PORT,
    async () => {
        console.log(
            `🚀 KMRN Passenger Bot запущен на порту ${PORT}`
        );

        await setupWebhook();

        await getWebhookInfo();
    }
);
