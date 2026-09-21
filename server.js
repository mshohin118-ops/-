require("dotenv").config();

const express = require("express");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY
    ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n")
    : "";
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const PUBLIC_URL = process.env.PUBLIC_URL;

const CAPACITY = 19;

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
   TELEGRAM API
========================================================= */

async function telegramRequest(method, body = {}) {
    if (!TELEGRAM_BOT_TOKEN) {
        throw new Error("TELEGRAM_BOT_TOKEN не установлен");
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

    const data = await response.json();

    if (!data.ok) {
        console.error(`Telegram API ${method}:`, data);
    }

    return data;
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

async function editMessage(
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

    return telegramRequest("editMessageText", body);
}

async function answerCallbackQuery(callbackQueryId, text = "") {
    return telegramRequest("answerCallbackQuery", {
        callback_query_id: callbackQueryId,
        text
    });
}

async function deleteUserMessage(chatId, messageId) {
    if (!messageId) return;

    try {
        const result = await telegramRequest("deleteMessage", {
            chat_id: chatId,
            message_id: messageId
        });

        if (!result.ok) {
            console.warn(
                "⚠️ Не удалось удалить сообщение пользователя:",
                result.description
            );
        }
    } catch (error) {
        console.warn(
            "⚠️ Ошибка удаления сообщения пользователя:",
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
            "Не настроены GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY или GOOGLE_SHEET_ID"
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

    const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID
    });

    const firstSheet = spreadsheet.data.sheets[0];

    if (!firstSheet) {
        throw new Error("В Google Sheets нет листов");
    }

    cachedSheetTitle = firstSheet.properties.title;

    return cachedSheetTitle;
}

async function getAllPassengers() {
    const sheets = await getSheets();
    const sheetTitle = await getSheetTitle();

    const result = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetTitle}!A:L`
    });

    return result.data.values || [];
}


/* =========================================================
   HELPERS
========================================================= */

function normalizeText(value) {
    return String(value || "").trim();
}

function isValidDateString(date) {
    if (!/^\d{2}\.\d{2}\.\d{4}$/.test(date)) {
        return false;
    }

    const [day, month, year] = date.split(".").map(Number);

    const d = new Date(year, month - 1, day);

    return (
        d.getFullYear() === year &&
        d.getMonth() === month - 1 &&
        d.getDate() === day
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

function formatPassengerDate(value) {
    return value || "—";
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
        contactNumberBeingAdded: 1
    };
}

function getState(chatId) {
    if (!states.has(chatId)) {
        states.set(chatId, createState());
    }

    return states.get(chatId);
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
        const result = await editMessage(
            chatId,
            messageId,
            text,
            getMainMenuKeyboard()
        );

        return result;
    }

    return sendMessage(
        chatId,
        text,
        getMainMenuKeyboard()
    );
}


/* =========================================================
   REGISTRATION
========================================================= */

async function startRegistration(chatId) {
    const state = createState();

    states.set(chatId, state);

    const result = await sendMessage(
        chatId,
        "Введите фамилию:"
    );

    if (result.ok) {
        state.messageId = result.result.message_id;
    }
}

async function askRegistrationStep(chatId, state) {
    let text = "";

    switch (state.step) {
        case 0:
            text = "Введите фамилию:";
            break;

        case 1:
            text = "Введите имя:";
            break;

        case 2:
            text = "Введите отчество:";
            break;

        case 3:
            state.calendarType = "birth";
            state.calendarPage = 0;

            await showCalendar(
                chatId,
                state,
                "year"
            );
            return;

        case 4:
            text = "Введите номер паспорта:";
            break;

        case 5:
            await showCitizenshipMenu(
                chatId,
                state
            );
            return;

        case 6:
            await showContact1Menu(
                chatId,
                state
            );
            return;

        case 7:
            state.calendarType = "flight";
            state.calendarPage = 0;

            await showCalendar(
                chatId,
                state,
                "year"
            );
            return;

        case 8:
            await showRouteMenu(
                chatId,
                state
            );
            return;

        case 9:
            await showStatusMenu(
                chatId,
                state
            );
            return;
    }

    if (state.messageId) {
        await editMessage(
            chatId,
            state.messageId,
            text
        );
    } else {
        const result = await sendMessage(
            chatId,
            text
        );

        if (result.ok) {
            state.messageId =
                result.result.message_id;
        }
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
                    callback_data: "citizenship_TJ"
                },
                {
                    text: "🇷🇺 RU",
                    callback_data: "citizenship_RU"
                }
            ],
            [
                {
                    text: "🌍 Другое",
                    callback_data: "registration_citizenship_other"
                }
            ]
        ]
    };
}

async function showCitizenshipMenu(chatId, state) {
    const text = "Выберите гражданство:";

    if (state.messageId) {
        await editMessage(
            chatId,
            state.messageId,
            text,
            getCitizenshipKeyboard()
        );
    } else {
        const result = await sendMessage(
            chatId,
            text,
            getCitizenshipKeyboard()
        );

        if (result.ok) {
            state.messageId =
                result.result.message_id;
        }
    }
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
                    callback_data: "contact1_other"
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
                    callback_data: "contact2_other"
                }
            ]
        ]
    };
}

async function showContact1Menu(chatId, state) {
    const text =
        "Введите контакт 1:\n\n" +
        "Можно ввести номер Таджикистана.\n" +
        "Например: 900000000";

    await editMessage(
        chatId,
        state.messageId,
        text,
        getContact1Keyboard()
    );
}

async function showContact2Menu(chatId, state) {
    const text =
        "Введите контакт 2:";

    await editMessage(
        chatId,
        state.messageId,
        text,
        getContact2Keyboard()
    );
}

function getContactsMenuKeyboard() {
    return {
        inline_keyboard: [
            [
                {
                    text: "➕ Добавить ещё один номер",
                    callback_data: "add_contact2"
                }
            ],
            [
                {
                    text: "➡️ Продолжить",
                    callback_data: "contacts_continue"
                }
            ]
        ]
    };
}

async function showContactMenu(chatId, state) {
    let text = "📞 Контакты\n\n";

    text += `Контакт 1: ${
        state.data.contact1 || "не указан"
    }\n`;

    text += `Контакт 2: ${
        state.data.contact2 || "не указан"
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
                    callback_data: "route_DSHB_XRG"
                }
            ],
            [
                {
                    text: "ХРГ — ДШБ",
                    callback_data: "route_XRG_DSHB"
                }
            ]
        ]
    };
}

async function showRouteMenu(chatId, state) {
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
                    callback_data: "status_booked"
                }
            ],
            [
                {
                    text: "Подтвержден",
                    callback_data: "status_confirmed"
                }
            ],
            [
                {
                    text: "Отменен",
                    callback_data: "status_cancelled"
                }
            ]
        ]
    };
}

async function showStatusMenu(chatId, state) {
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

function getCalendarTitle(type, level) {
    const baseType = getBaseCalendarType(type);

    if (baseType === "birth") {
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

    if (baseType === "flight") {
        return "📅 Выберите дату рейса:";
    }

    return "📅 Выберите дату:";
}

function getBirthYears(page) {
    const currentYear = new Date().getFullYear();

    const start =
        currentYear - page * 12;

    const years = [];

    for (let i = 0; i < 12; i++) {
        const year = start - i;

        if (year < 1940) {
            break;
        }

        years.push(year);
    }

    return years;
}

function getFlightYears(page) {
    const currentYear = new Date().getFullYear();

    const start =
        currentYear + page * 12;

    const years = [];

    for (let i = 0; i < 12; i++) {
        const year = start + i;

        if (year > currentYear + 5) {
            break;
        }

        years.push(year);
    }

    return years;
}

function getYearsKeyboard(type, page) {
    const baseType = getBaseCalendarType(type);

    const years =
        baseType === "birth"
            ? getBirthYears(page)
            : getFlightYears(page);

    const keyboard = [];

    for (let i = 0; i < years.length; i += 3) {
        const row = [];

        for (
            let j = i;
            j < Math.min(i + 3, years.length);
            j++
        ) {
            row.push({
                text: String(years[j]),
                callback_data:
                    `calendar_year_${years[j]}`
            });
        }

        keyboard.push(row);
    }

    const navigation = [];

    if (baseType === "birth") {
        if (page > 0) {
            navigation.push({
                text: "⬅️ Назад",
                callback_data:
                    `calendar_year_page_${page - 1}`
            });
        }

        if (getBirthYears(page + 1).length > 0) {
            navigation.push({
                text: "➡️ Далее",
                callback_data:
                    `calendar_year_page_${page + 1}`
            });
        }
    }

    if (baseType === "flight") {
        if (page > 0) {
            navigation.push({
                text: "⬅️ Назад",
                callback_data:
                    `calendar_year_page_${page - 1}`
            });
        }

        if (getFlightYears(page + 1).length > 0) {
            navigation.push({
                text: "➡️ Далее",
                callback_data:
                    `calendar_year_page_${page + 1}`
            });
        }
    }

    if (navigation.length > 0) {
        keyboard.push(navigation);
    }

    return {
        inline_keyboard: keyboard
    };
}

function getMonthsKeyboard() {
    const keyboard = [];

    for (let i = 0; i < 12; i += 3) {
        const row = [];

        for (let j = i; j < i + 3; j++) {
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
            callback_data: "calendar_back_years"
        }
    ]);

    return {
        inline_keyboard: keyboard
    };
}

function getDaysKeyboard(year, month) {
    const firstDay = new Date(
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
            callback_data: "calendar_ignore"
        }))
    );

    let row = [];

    for (let i = 0; i < weekday; i++) {
        row.push({
            text: " ",
            callback_data: "calendar_ignore"
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

    while (row.length > 0 && row.length < 7) {
        row.push({
            text: " ",
            callback_data: "calendar_ignore"
        });
    }

    if (row.length) {
        keyboard.push(row);
    }

    keyboard.push([
        {
            text: "⬅️ Назад",
            callback_data: "calendar_back_months"
        }
    ]);

    return {
        inline_keyboard: keyboard
    };
}

async function showCalendar(
    chatId,
    state,
    level
) {
    const type = state.calendarType;

    if (level === "year") {
        await editMessage(
            chatId,
            state.messageId,
            getCalendarTitle(
                type,
                "year"
            ),
            getYearsKeyboard(
                type,
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
                type,
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
                type,
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
   OCCUPANCY / CAPACITY
========================================================= */

async function calculateRouteOccupancy(
    flightDate,
    route,
    excludeRowNumber = null
) {
    const rows = await getAllPassengers();

    let count = 0;

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
            count++;
        }
    }

    return count;
}

async function isSeatAvailable(
    flightDate,
    route,
    excludeRowNumber = null
) {
    const occupancy =
        await calculateRouteOccupancy(
            flightDate,
            route,
            excludeRowNumber
        );

    return occupancy < CAPACITY;
}


/* =========================================================
   SAVE PASSENGER
========================================================= */

async function savePassenger(data) {
    const sheets = await getSheets();
    const sheetTitle = await getSheetTitle();

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
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheetTitle}!A:L`,
            valueInputOption: "USER_ENTERED",
            requestBody: {
                values: [values]
            }
        });

    const rows = await getAllPassengers();

    data.rowNumber =
        rows.length;

    return result;
}

async function updatePassenger(
    rowNumber,
    data
) {
    const sheets = await getSheets();
    const sheetTitle = await getSheetTitle();

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
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetTitle}!A${rowNumber}:L${rowNumber}`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
            values: [values]
        }
    });
}


/* =========================================================
   PASSENGER ID
========================================================= */

function generatePassengerId() {
    return (
        "P" +
        Date.now().toString().slice(-8)
    );
}


/* =========================================================
   PASSENGER CARD
========================================================= */

function buildPassengerCard(data) {
    let text = "👤 Данные пассажира\n\n";

    text += `🆔 ID: ${
        data.passengerId || "—"
    }\n`;

    text += `Фамилия: ${
        data.surname || "—"
    }\n`;

    text += `Имя: ${
        data.name || "—"
    }\n`;

    text += `Отчество: ${
        data.patronymic || "—"
    }\n`;

    text += `Дата рождения: ${
        formatPassengerDate(
            data.birthDate
        )
    }\n`;

    text += `Паспорт: ${
        data.passport || "—"
    }\n`;

    text += `Гражданство: ${
        data.citizenship || "—"
    }\n`;

    text += `Контакт 1: ${
        data.contact1 || "—"
    }\n`;

    text += `Контакт 2: ${
        data.contact2 || "—"
    }\n`;

    text += `Дата рейса: ${
        data.flightDate || "—"
    }\n`;

    text += `Маршрут: ${
        data.route || "—"
    }\n`;

    text += `Статус: ${
        data.status || "—"
    }`;

    return text;
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
                        "edit_back"
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
   EDIT CONTACTS
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
    state.data.passengerId =
        generatePassengerId();

    const occupied =
        await calculateRouteOccupancy(
            state.data.flightDate,
            state.data.route
        );

    if (occupied >= CAPACITY) {
        await editMessage(
            chatId,
            state.messageId,
            `❌ На рейсе ${state.data.route} на дату ${state.data.flightDate} уже занято ${CAPACITY} мест.`
        );

        setTimeout(async () => {
            try {
                await showRouteMenu(
                    chatId,
                    state
                );
            } catch (error) {
                console.error(error);
            }
        }, 1500);

        return;
    }

    await savePassenger(
        state.data
    );

    await showPassengerCard(
        chatId,
        state
    );
}


/* =========================================================
   TEXT MESSAGE HANDLER
========================================================= */

async function handleTextMessage(
    message
) {
    const chatId =
        message.chat.id;

    const text =
        normalizeText(message.text);

    if (!text) {
        return;
    }

    if (text === "/start") {
        console.log(
            `🚀 Запуск бота для ${chatId}`
        );

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

    /* -----------------------------------------
       EDITING TEXT FIELD
    ----------------------------------------- */

    if (state.editingField) {

        const field =
            state.editingField;

        if (
            field === "contact1_other" ||
            field === "contact2_other"
        ) {
            const number =
                field === "contact1_other"
                    ? 1
                    : 2;

            state.data[
                `contact${number}`
            ] = text;

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
            field === "contact1" ||
            field === "contact2"
        ) {
            let contact =
                validateTajikPhone(
                    text
                );

            if (!contact) {
                await editMessage(
                    chatId,
                    state.messageId,
                    "❌ Неверный номер.\n\nВведите номер Таджикистана в формате 900000000 или +992900000000."
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

        if (
            field === "surname" ||
            field === "name" ||
            field === "patronymic" ||
            field === "passport"
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
    }


    /* -----------------------------------------
       REGISTRATION
    ----------------------------------------- */

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

    if (state.step === 5) {
        state.data.citizenship =
            text;

        state.step = 6;

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
                "❌ Неверный номер.\n\nВведите номер Таджикистана в формате 900000000 или +992900000000."
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

    if (state.step === 7) {
        return;
    }

    if (state.step === 8) {
        return;
    }

    if (state.step === 9) {
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

    if (data === "main_add_passenger") {
        await startRegistration(
            chatId
        );
        return;
    }

    if (data === "main_view_data") {
        await editMessage(
            chatId,
            messageId,
            "👤 Посмотреть данные\n\nФункция будет добавлена."
        );
        return;
    }

    if (data === "main_find_passenger") {
        await editMessage(
            chatId,
            messageId,
            "🔎 Найти пассажира\n\nФункция будет добавлена."
        );
        return;
    }

    if (
        data === "main_flight_passengers"
    ) {
        await editMessage(
            chatId,
            messageId,
            "✈️ Пассажиры рейса\n\nФункция будет добавлена."
        );
        return;
    }

    if (data === "main_statistics") {
        await editMessage(
            chatId,
            messageId,
            "📊 Статистика\n\nФункция будет добавлена."
        );
        return;
    }


    /* =========================================
       CITIZENSHIP
    ========================================= */

    if (data === "citizenship_TJ") {
        state.data.citizenship =
            "TJ";

        state.step = 6;

        await showContact1Menu(
            chatId,
            state
        );

        return;
    }

    if (data === "citizenship_RU") {
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
       CONTACT 1
    ========================================= */

    if (data === "contact1_other") {
        state.editingField =
            "registration_contact1_other";

        await editMessage(
            chatId,
            messageId,
            "Введите контакт 1:"
        );

        return;
    }

    /* =========================================
       CONTACT 2
    ========================================= */

    if (data === "add_contact2") {
        state.editingField = null;

        await showContact2Menu(
            chatId,
            state
        );

        return;
    }

    if (data === "contact2_other") {
        state.editingField =
            "registration_contact2_other";

        await editMessage(
            chatId,
            messageId,
            "Введите контакт 2:"
        );

        return;
    }

    if (data === "contacts_continue") {
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
       CALENDAR YEAR PAGE
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


    /* =========================================
       CALENDAR YEAR
    ========================================= */

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

        if (
            Number.isNaN(year)
        ) {
            return;
        }

        state.calendarYear =
            year;

        await showCalendar(
            chatId,
            state,
            "month"
        );

        return;
    }


    /* =========================================
       CALENDAR MONTH
    ========================================= */

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


    /* =========================================
       CALENDAR DAY
    ========================================= */

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

        const type =
            getBaseCalendarType(
                state.calendarType
            );

        if (
            type === "birth" &&
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

        if (
            state.calendarType ===
            "flight"
        ) {
            const route =
                state.data.route;

            state.data.flightDate =
                dateString;

            state.step = 8;

            await askRegistrationStep(
                chatId,
                state
            );

            return;
        }

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

        if (
            state.calendarType ===
            "flight_edit"
        ) {
            const occupancy =
                await calculateRouteOccupancy(
                    dateString,
                    state.data.route,
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
                    `❌ На рейсе ${state.data.route} на дату ${dateString} уже занято ${CAPACITY} мест.`,
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

        return;
    }


    /* =========================================
       CALENDAR BACK
    ========================================= */

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
       ROUTE
    ========================================= */

    if (
        data ===
        "route_DSHB_XRG"
    ) {
        const route =
            "ДШБ — ХРГ";

        const occupancy =
            await calculateRouteOccupancy(
                state.data.flightDate,
                route
            );

        if (
            occupancy >= CAPACITY
        ) {
            await editMessage(
                chatId,
                messageId,
                `❌ На дату ${state.data.flightDate} маршрут ${route} заполнен: ${CAPACITY}/${CAPACITY}.`
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

    if (
        data ===
        "route_XRG_DSHB"
    ) {
        const route =
            "ХРГ — ДШБ";

        const occupancy =
            await calculateRouteOccupancy(
                state.data.flightDate,
                route
            );

        if (
            occupancy >= CAPACITY
        ) {
            await editMessage(
                chatId,
                messageId,
                `❌ На дату ${state.data.flightDate} маршрут ${route} заполнен: ${CAPACITY}/${CAPACITY}.`
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
       STATUS
    ========================================= */

    if (
        data ===
        "status_booked"
    ) {
        state.data.status =
            "Забронирован";

        await finishRegistration(
            chatId,
            state
        );

        return;
    }

    if (
        data ===
        "status_confirmed"
    ) {
        state.data.status =
            "Подтвержден";

        await finishRegistration(
            chatId,
            state
        );

        return;
    }

    if (
        data ===
        "status_cancelled"
    ) {
        state.data.status =
            "Отменен";

        await finishRegistration(
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


    /* =========================================
       EDIT MENU
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

    if (
        data ===
        "edit_surname"
    ) {
        state.editingField =
            "surname";

        await editMessage(
            chatId,
            messageId,
            "Введите новую фамилию:"
        );

        return;
    }

    if (
        data ===
        "edit_name"
    ) {
        state.editingField =
            "name";

        await editMessage(
            chatId,
            messageId,
            "Введите новое имя:"
        );

        return;
    }

    if (
        data ===
        "edit_patronymic"
    ) {
        state.editingField =
            "patronymic";

        await editMessage(
            chatId,
            messageId,
            "Введите новое отчество:"
        );

        return;
    }

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

    if (
        data ===
        "edit_passport"
    ) {
        state.editingField =
            "passport";

        await editMessage(
            chatId,
            messageId,
            "Введите новый номер паспорта:"
        );

        return;
    }

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

    if (
        data ===
        "edit_route"
    ) {
        await editMessage(
            chatId,
            messageId,
            "Выберите новый маршрут:",
            getRouteKeyboard()
        );

        state.editingField =
            "route";

        return;
    }

    if (
        data ===
        "edit_status"
    ) {
        await editMessage(
            chatId,
            messageId,
            "Выберите новый статус:",
            getStatusKeyboard()
        );

        state.editingField =
            "status";

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
        state.editingField ===
        "route"
    ) {
        let route = null;

        if (
            data ===
            "route_DSHB_XRG"
        ) {
            route =
                "ДШБ — ХРГ";
        }

        if (
            data ===
            "route_XRG_DSHB"
        ) {
            route =
                "ХРГ — ДШБ";
        }

        if (route) {
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
                    occupancy >= CAPACITY
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
    }


    /* =========================================
       EDIT STATUS
    ========================================= */

    if (
        state.editingField ===
        "status"
    ) {
        let status = null;

        if (
            data ===
            "status_booked"
        ) {
            status =
                "Забронирован";
        }

        if (
            data ===
            "status_confirmed"
        ) {
            status =
                "Подтвержден";
        }

        if (
            data ===
            "status_cancelled"
        ) {
            status =
                "Отменен";
        }

        if (status) {
            if (
                status !==
                "Отменен"
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
                        `❌ На дату ${state.data.flightDate} маршрут ${state.data.route} уже заполнен: ${CAPACITY}/${CAPACITY}.`,
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
    }
}


/* =========================================================
   SPECIAL TEXT EDIT CALLBACKS
========================================================= */

async function handleSpecialTextEditing(
    chatId,
    state,
    text
) {
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

        return true;
    }

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

        return true;
    }

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

        return true;
    }

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

        return true;
    }

    return false;
}


/* =========================================================
   ORIGINAL TEXT HANDLER WRAPPER
========================================================= */

const originalHandleTextMessage =
    handleTextMessage;

handleTextMessage =
    async function(message) {
        const chatId =
            message.chat.id;

        const text =
            normalizeText(
                message.text
            );

        if (!text) {
            return;
        }

        if (
            text !== "/start"
        ) {
            const state =
                getState(chatId);

            if (
                state.editingField ===
                    "registration_citizenship_other" ||
                state.editingField ===
                    "registration_contact1_other" ||
                state.editingField ===
                    "registration_contact2_other" ||
                state.editingField ===
                    "citizenship_other"
            ) {
                await deleteUserMessage(
                    chatId,
                    message.message_id
                );

                const handled =
                    await handleSpecialTextEditing(
                        chatId,
                        state,
                        text
                    );

                if (handled) {
                    return;
                }
            }
        }

        await originalHandleTextMessage(
            message
        );
    };


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

        console.log(
            "📡 Telegram отправил update"
        );

        console.log(
            "🔐 Webhook secret подтверждён"
        );

        console.log(
            "📨 Получен update:",
            JSON.stringify(req.body)
        );

        res.sendStatus(200);

        try {
            const update =
                req.body;

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
            "❌ Ошибка подключения Webhook:",
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
   START SERVER
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
