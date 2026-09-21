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

if (!TELEGRAM_BOT_TOKEN) {
    console.error("❌ TELEGRAM_BOT_TOKEN не установлен");
}

if (!GOOGLE_CLIENT_EMAIL) {
    console.error("❌ GOOGLE_CLIENT_EMAIL не установлен");
}

if (!GOOGLE_PRIVATE_KEY) {
    console.error("❌ GOOGLE_PRIVATE_KEY не установлен");
}

if (!SPREADSHEET_ID) {
    console.error("❌ GOOGLE_SHEET_ID не установлен");
}

const auth = new google.auth.JWT(
    GOOGLE_CLIENT_EMAIL,
    null,
    GOOGLE_PRIVATE_KEY,
    ["https://www.googleapis.com/auth/spreadsheets"]
);

const sheets = google.sheets({
    version: "v4",
    auth
});

let cachedSheetTitle = null;

const states = new Map();

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

const CAPACITY = 19;

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

function resetState(chatId) {
    const state = createState();
    states.set(chatId, state);
    return state;
}

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

    return response.json();
}

async function sendMessage(chatId, text, replyMarkup = null) {
    const body = {
        chat_id: chatId,
        text
    };

    if (replyMarkup) {
        body.reply_markup = replyMarkup;
    }

    const result = await telegramRequest("sendMessage", body);

    if (result.ok && result.result) {
        return result.result;
    }

    console.error("❌ Ошибка sendMessage:", result);
    return null;
}

async function editMessage(chatId, messageId, text, replyMarkup = null) {
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

    const result = await telegramRequest("editMessageText", body);

    if (!result.ok) {
        console.warn(
            "⚠️ Не удалось изменить сообщение:",
            result.description
        );
    }

    return result;
}

async function answerCallbackQuery(callbackQueryId) {
    try {
        await telegramRequest("answerCallbackQuery", {
            callback_query_id: callbackQueryId
        });
    } catch (error) {
        console.warn(
            "⚠️ Ошибка answerCallbackQuery:",
            error.message
        );
    }
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

// =====================================================
// GOOGLE SHEETS
// =====================================================

async function getSheetTitle() {
    if (cachedSheetTitle) {
        return cachedSheetTitle;
    }

    const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID
    });

    const firstSheet = spreadsheet.data.sheets[0];

    if (!firstSheet) {
        throw new Error("В таблице нет листов");
    }

    cachedSheetTitle = firstSheet.properties.title;

    return cachedSheetTitle;
}

async function getAllRows() {
    const sheetTitle = await getSheetTitle();

    const result = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetTitle}!A:L`
    });

    return result.data.values || [];
}

// =====================================================
// VALIDATION
// =====================================================

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

function normalizeText(value) {
    return String(value || "").trim();
}

function isValidDateString(value) {
    return /^\d{2}\.\d{2}\.\d{4}$/.test(value);
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

async function showMainMenu(chatId, state = null) {
    if (!state) {
        state = getState(chatId);
    }

    state.messageId = null;
    state.editingField = null;

    const text = "🏠 Главное меню";

    return sendMessage(
        chatId,
        text,
        mainMenuKeyboard()
    );
}

// =====================================================
// REGISTRATION
// =====================================================

async function startRegistration(chatId) {
    const state = resetState(chatId);

    state.step = 0;

    const message = await sendMessage(
        chatId,
        "Введите фамилию:"
    );

    if (message) {
        state.messageId = message.message_id;
    }
}

async function askNextRegistrationStep(chatId, state) {
    let text = "";
    let keyboard = null;

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
            await showCalendar(chatId, state, "birth");
            return;

        case 4:
            text = "Введите номер паспорта:";
            break;

        case 5:
            text = "Выберите гражданство:";
            keyboard = citizenshipKeyboard();
            break;

        case 6:
            text = "Введите контакт 1:";
            keyboard = contactOtherKeyboard(1);
            break;

        case 7:
            await showCalendar(chatId, state, "flight");
            return;

        case 8:
            text = "Выберите маршрут:";
            keyboard = routeKeyboard();
            break;

        case 9:
            text = "Выберите статус:";
            keyboard = statusKeyboard();
            break;

        default:
            await finishRegistration(chatId, state);
            return;
    }

    if (state.messageId) {
        const result = await editMessage(
            chatId,
            state.messageId,
            text,
            keyboard
        );

        if (!result.ok) {
            const message = await sendMessage(
                chatId,
                text,
                keyboard
            );

            if (message) {
                state.messageId = message.message_id;
            }
        }
    } else {
        const message = await sendMessage(
            chatId,
            text,
            keyboard
        );

        if (message) {
            state.messageId = message.message_id;
        }
    }
}

// =====================================================
// CITIZENSHIP
// =====================================================

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
                    text: "🌍 Другое",
                    callback_data: "citizenship_other"
                }
            ]
        ]
    };
}

function editCitizenshipKeyboard() {
    return {
        inline_keyboard: [
            [
                {
                    text: "🇹🇯 TJ",
                    callback_data: "edit_citizenship_TJ"
                },
                {
                    text: "🇷🇺 RU",
                    callback_data: "edit_citizenship_RU"
                }
            ],
            [
                {
                    text: "🌍 Другое",
                    callback_data: "edit_citizenship_other"
                }
            ],
            [
                {
                    text: "↩️ Назад",
                    callback_data: "edit_back"
                }
            ]
        ]
    };
}

// =====================================================
// CONTACTS
// =====================================================

function contactOtherKeyboard(contactNumber) {
    return {
        inline_keyboard: [
            [
                {
                    text: "🌍 Другое",
                    callback_data: `contact${contactNumber}_other`
                }
            ]
        ]
    };
}

function editContactKeyboard(contactNumber) {
    return {
        inline_keyboard: [
            [
                {
                    text: "🌍 Другое",
                    callback_data: `edit_contact${contactNumber}_other`
                }
            ],
            [
                {
                    text: "↩️ Назад",
                    callback_data: "edit_back"
                }
            ]
        ]
    };
}

async function showContactMenu(chatId, state) {
    let text = "📞 Контакты пассажира:\n\n";

    text += `Контакт 1: ${state.data.contact1 || "—"}\n`;
    text += `Контакт 2: ${state.data.contact2 || "—"}\n`;

    const buttons = [];

    if (!state.data.contact2) {
        buttons.push([
            {
                text: "➕ Добавить ещё один номер",
                callback_data: "add_contact2"
            }
        ]);
    }

    buttons.push([
        {
            text: "➡️ Продолжить",
            callback_data: "contacts_continue"
        }
    ]);

    await editMessage(
        chatId,
        state.messageId,
        text,
        {
            inline_keyboard: buttons
        }
    );
}

// =====================================================
// ROUTES
// =====================================================

function routeKeyboard() {
    return {
        inline_keyboard: [
            [
                {
                    text: "ДШБ — ХРГ",
                    callback_data: "route_DSB_XRG"
                }
            ],
            [
                {
                    text: "ХРГ — ДШБ",
                    callback_data: "route_XRG_DSB"
                }
            ]
        ]
    };
}

function getRouteFromCallback(data) {
    if (data === "route_DSB_XRG") {
        return "ДШБ — ХРГ";
    }

    if (data === "route_XRG_DSB") {
        return "ХРГ — ДШБ";
    }

    return null;
}

// =====================================================
// STATUS
// =====================================================

function statusKeyboard() {
    return {
        inline_keyboard: [
            [
                {
                    text: "Забронирован",
                    callback_data: "status_reserved"
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

function getStatusFromCallback(data) {
    if (data === "status_reserved") {
        return "Забронирован";
    }

    if (data === "status_confirmed") {
        return "Подтвержден";
    }

    if (data === "status_cancelled") {
        return "Отменен";
    }

    return null;
}

// =====================================================
// CALENDAR
// =====================================================

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

function getCurrentYear() {
    return new Date().getFullYear();
}

function getBirthYears(page) {
    const currentYear = getCurrentYear();

    const years = [];

    for (let year = currentYear - page * 12; year >= 1940; year--) {
        years.push(year);

        if (years.length === 12) {
            break;
        }
    }

    return years;
}

function getFlightYears(page) {
    const currentYear = getCurrentYear();

    const years = [];

    for (
        let year = currentYear + page * 12;
        year <= currentYear + 5;
        year++
    ) {
        years.push(year);

        if (years.length === 12) {
            break;
        }
    }

    return years;
}

async function showCalendar(chatId, state, type) {
    state.calendarType = type;
    state.calendarPage = 0;

    const baseType = getBaseCalendarType(type);

    const years =
        baseType === "birth"
            ? getBirthYears(0)
            : getFlightYears(0);

    const keyboard = [];

    for (let i = 0; i < years.length; i += 3) {
        const row = [];

        for (let j = i; j < i + 3 && j < years.length; j++) {
            row.push({
                text: String(years[j]),
                callback_data: `cal_year_${type}_${years[j]}`
            });
        }

        keyboard.push(row);
    }

    const navigation = [];

    if (baseType === "birth") {
        const currentYear = getCurrentYear();

        if (currentYear - 12 >= 1940) {
            navigation.push({
                text: "⬅️ Старше",
                callback_data: `cal_year_page_${type}_1`
            });
        }
    } else {
        if (getFlightYears(1).length > 0) {
            navigation.push({
                text: "➡️ Далее",
                callback_data: `cal_year_page_${type}_1`
            });
        }
    }

    if (navigation.length) {
        keyboard.push(navigation);
    }

    const title = getCalendarTitle(type, "year");

    if (state.messageId) {
        const result = await editMessage(
            chatId,
            state.messageId,
            title,
            {
                inline_keyboard: keyboard
            }
        );

        if (!result.ok) {
            const message = await sendMessage(
                chatId,
                title,
                {
                    inline_keyboard: keyboard
                }
            );

            if (message) {
                state.messageId = message.message_id;
            }
        }
    } else {
        const message = await sendMessage(
            chatId,
            title,
            {
                inline_keyboard: keyboard
            }
        );

        if (message) {
            state.messageId = message.message_id;
        }
    }
}

async function showCalendarYearPage(
    chatId,
    state,
    type,
    page
) {
    const baseType = getBaseCalendarType(type);

    const years =
        baseType === "birth"
            ? getBirthYears(page)
            : getFlightYears(page);

    if (!years.length) {
        return;
    }

    state.calendarPage = page;

    const keyboard = [];

    for (let i = 0; i < years.length; i += 3) {
        const row = [];

        for (let j = i; j < i + 3 && j < years.length; j++) {
            row.push({
                text: String(years[j]),
                callback_data: `cal_year_${type}_${years[j]}`
            });
        }

        keyboard.push(row);
    }

    const navigation = [];

    if (baseType === "birth") {
        if (page > 0) {
            navigation.push({
                text: "➡️ Новее",
                callback_data: `cal_year_page_${type}_${page - 1}`
            });
        }

        if (getBirthYears(page + 1).length) {
            navigation.push({
                text: "⬅️ Старше",
                callback_data: `cal_year_page_${type}_${page + 1}`
            });
        }
    } else {
        if (page > 0) {
            navigation.push({
                text: "⬅️ Назад",
                callback_data: `cal_year_page_${type}_${page - 1}`
            });
        }

        if (getFlightYears(page + 1).length) {
            navigation.push({
                text: "➡️ Далее",
                callback_data: `cal_year_page_${type}_${page + 1}`
            });
        }
    }

    if (navigation.length) {
        keyboard.push(navigation);
    }

    await editMessage(
        chatId,
        state.messageId,
        getCalendarTitle(type, "year"),
        {
            inline_keyboard: keyboard
        }
    );
}

async function showCalendarMonths(
    chatId,
    state,
    type,
    year
) {
    state.calendarYear = year;

    const keyboard = [];

    for (let i = 0; i < 12; i += 3) {
        const row = [];

        for (let j = i; j < i + 3; j++) {
            row.push({
                text: MONTHS[j],
                callback_data: `cal_month_${type}_${year}_${j}`
            });
        }

        keyboard.push(row);
    }

    keyboard.push([
        {
            text: "↩️ Назад",
            callback_data: `cal_back_month_${type}_${year}`
        }
    ]);

    await editMessage(
        chatId,
        state.messageId,
        getCalendarTitle(type, "month"),
        {
            inline_keyboard: keyboard
        }
    );
}

async function showCalendarDays(
    chatId,
    state,
    type,
    year,
    month
) {
    state.calendarYear = year;
    state.calendarMonth = month;

    const keyboard = [];

    keyboard.push(
        WEEKDAYS.map((day) => ({
            text: day,
            callback_data: "noop"
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

    const daysInMonth = new Date(
        year,
        month + 1,
        0
    ).getDate();

    let row = [];

    for (let i = 1; i < startDay; i++) {
        row.push({
            text: " ",
            callback_data: "noop"
        });
    }

    const today = new Date();

    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(
            year,
            month,
            day
        );

        let disabled = false;

        if (getBaseCalendarType(type) === "birth") {
            if (date > today) {
                disabled = true;
            }
        }

        row.push({
            text: String(day),
            callback_data: disabled
                ? "noop"
                : `cal_day_${type}_${year}_${month}_${day}`
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
            text: "↩️ Назад",
            callback_data: `cal_back_month_${type}_${year}`
        }
    ]);

    await editMessage(
        chatId,
        state.messageId,
        getCalendarTitle(type, "day"),
        {
            inline_keyboard: keyboard
        }
    );
}

function formatDate(day, month, year) {
    return (
        String(day).padStart(2, "0") +
        "." +
        String(month + 1).padStart(2, "0") +
        "." +
        year
    );
}

// =====================================================
// OCCUPANCY
// =====================================================

async function calculateRouteOccupancy(
    flightDate,
    route,
    excludeRowNumber = null
) {
    const rows = await getAllRows();

    let count = 0;

    for (let i = 1; i < rows.length; i++) {
        const rowNumber = i + 1;

        if (
            excludeRowNumber &&
            rowNumber === Number(excludeRowNumber)
        ) {
            continue;
        }

        const row = rows[i];

        const passengerFlightDate = row[9] || "";
        const passengerRoute = row[10] || "";
        const passengerStatus = row[11] || "";

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
    const occupancy = await calculateRouteOccupancy(
        flightDate,
        route,
        excludeRowNumber
    );

    return occupancy < CAPACITY;
}

// =====================================================
// SAVE PASSENGER
// =====================================================

async function savePassenger(data) {
    const sheetTitle = await getSheetTitle();
    const rows = await getAllRows();

    let maxId = 0;

    for (let i = 1; i < rows.length; i++) {
        const id = parseInt(rows[i][0], 10);

        if (!isNaN(id) && id > maxId) {
            maxId = id;
        }
    }

    const passengerId = maxId + 1;

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

    await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetTitle}!A:L`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
            values: [values]
        }
    });

    data.passengerId = passengerId;
    data.rowNumber = rows.length + 1;

    console.log(
        `✅ Пассажир сохранён. ID: ${passengerId}, строка: ${data.rowNumber}`
    );

    return passengerId;
}

// =====================================================
// UPDATE PASSENGER
// =====================================================

async function updatePassenger(rowNumber, data) {
    if (!rowNumber || rowNumber < 2) {
        throw new Error(
            "Не указан правильный номер строки пассажира"
        );
    }

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

    await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetTitle}!A${rowNumber}:L${rowNumber}`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
            values: [values]
        }
    });

    console.log(
        `✅ Пассажир обновлён. Строка: ${rowNumber}`
    );
}

// =====================================================
// PASSENGER CARD
// =====================================================

function passengerCard(data) {
    return (
        `👤 <b>Пассажир #${data.passengerId || "—"}</b>\n\n` +
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

function passengerCardKeyboard() {
    return {
        inline_keyboard: [
            [
                {
                    text: "✏️ Изменить данные",
                    callback_data: "passenger_edit"
                }
            ],
            [
                {
                    text: "➕ Добавить ещё одного",
                    callback_data: "main_add_passenger"
                }
            ],
            [
                {
                    text: "🏠 Главное меню",
                    callback_data: "main_menu"
                }
            ]
        ]
    };
}

async function showPassengerCard(chatId, state) {
    const text = passengerCard(state.data);

    await editMessage(
        chatId,
        state.messageId,
        text,
        passengerCardKeyboard()
    );
}

// =====================================================
// EDIT MENU
// =====================================================

function editMenuKeyboard() {
    return {
        inline_keyboard: [
            [
                {
                    text: "✏️ Фамилия",
                    callback_data: "edit_surname"
                },
                {
                    text: "✏️ Имя",
                    callback_data: "edit_name"
                }
            ],
            [
                {
                    text: "✏️ Отчество",
                    callback_data: "edit_patronymic"
                }
            ],
            [
                {
                    text: "✏️ Дата рождения",
                    callback_data: "edit_birthDate"
                }
            ],
            [
                {
                    text: "✏️ Паспорт",
                    callback_data: "edit_passport"
                }
            ],
            [
                {
                    text: "✏️ Гражданство",
                    callback_data: "edit_citizenship"
                }
            ],
            [
                {
                    text: "✏️ Контакт 1",
                    callback_data: "edit_contact1"
                },
                {
                    text: "✏️ Контакт 2",
                    callback_data: "edit_contact2"
                }
            ],
            [
                {
                    text: "✏️ Дата рейса",
                    callback_data: "edit_flightDate"
                }
            ],
            [
                {
                    text: "✏️ Маршрут",
                    callback_data: "edit_route"
                }
            ],
            [
                {
                    text: "✏️ Статус",
                    callback_data: "edit_status"
                }
            ],
            [
                {
                    text: "↩️ Назад",
                    callback_data: "edit_back"
                }
            ]
        ]
    };
}

async function showEditMenu(chatId, state) {
    state.editingField = null;

    await editMessage(
        chatId,
        state.messageId,
        "✏️ Что хотите изменить?",
        editMenuKeyboard()
    );
}

// =====================================================
// EDIT ROUTE / STATUS
// =====================================================

function editRouteKeyboard() {
    return {
        inline_keyboard: [
            [
                {
                    text: "ДШБ — ХРГ",
                    callback_data: "edit_route_DSB_XRG"
                }
            ],
            [
                {
                    text: "ХРГ — ДШБ",
                    callback_data: "edit_route_XRG_DSB"
                }
            ],
            [
                {
                    text: "↩️ Назад",
                    callback_data: "edit_back"
                }
            ]
        ]
    };
}

function editStatusKeyboard() {
    return {
        inline_keyboard: [
            [
                {
                    text: "Забронирован",
                    callback_data: "edit_status_reserved"
                }
            ],
            [
                {
                    text: "Подтвержден",
                    callback_data: "edit_status_confirmed"
                }
            ],
            [
                {
                    text: "Отменен",
                    callback_data: "edit_status_cancelled"
                }
            ],
            [
                {
                    text: "↩️ Назад",
                    callback_data: "edit_back"
                }
            ]
        ]
    };
}

// =====================================================
// FINISH REGISTRATION
// =====================================================

async function finishRegistration(chatId, state) {
    try {
        await savePassenger(state.data);

        await editMessage(
            chatId,
            state.messageId,
            passengerCard(state.data),
            passengerCardKeyboard()
        );

        state.step = 10;
    } catch (error) {
        console.error(
            "❌ Ошибка сохранения пассажира:",
            error
        );

        await editMessage(
            chatId,
            state.messageId,
            "❌ Не удалось сохранить пассажира.\n\nПопробуйте ещё раз.",
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
    }
}

// =====================================================
// TEXT MESSAGE HANDLER
// =====================================================

async function handleTextMessage(message) {
    const chatId = message.chat.id;
    const text = normalizeText(message.text);

    if (!text) {
        return;
    }

    if (text === "/start") {
        console.log(
            `📩 Получено сообщение от ${chatId}: /start`
        );

        const state = resetState(chatId);

        const menuMessage = await sendMessage(
            chatId,
            "🏠 Главное меню",
            mainMenuKeyboard()
        );

        if (menuMessage) {
            state.messageId = menuMessage.message_id;
        }

        return;
    }

    const state = getState(chatId);

    await deleteUserMessage(
        chatId,
        message.message_id
    );

    // =================================================
    // REGISTRATION - SPECIAL CONTACT OTHER
    // =================================================

    if (
        state.editingField ===
        "registration_contact1_other"
    ) {
        if (!text) {
            await editMessage(
                chatId,
                state.messageId,
                "🌍 Введите контакт 1 в любом формате:",
                contactOtherKeyboard(1)
            );
            return;
        }

        state.data.contact1 = text;
        state.editingField = null;

        await showContactMenu(chatId, state);
        return;
    }

    if (
        state.editingField ===
        "registration_contact2_other"
    ) {
        if (!text) {
            await editMessage(
                chatId,
                state.messageId,
                "🌍 Введите контакт 2 в любом формате:",
                contactOtherKeyboard(2)
            );
            return;
        }

        state.data.contact2 = text;
        state.editingField = null;

        await showContactMenu(chatId, state);
        return;
    }

    // =================================================
    // EDIT SPECIAL CONTACT OTHER
    // =================================================

    if (state.editingField === "contact1_other") {
        if (!text) {
            await editMessage(
                chatId,
                state.messageId,
                "🌍 Введите контакт 1 в любом формате:",
                editContactKeyboard(1)
            );
            return;
        }

        try {
            state.data.contact1 = text;

            await updatePassenger(
                state.rowNumber,
                state.data
            );

            state.editingField = null;

            await showEditMenu(chatId, state);
        } catch (error) {
            console.error(error);

            await editMessage(
                chatId,
                state.messageId,
                "❌ Не удалось сохранить контакт 1.\n\nПопробуйте ещё раз.",
                editContactKeyboard(1)
            );
        }

        return;
    }

    if (state.editingField === "contact2_other") {
        if (!text) {
            await editMessage(
                chatId,
                state.messageId,
                "🌍 Введите контакт 2 в любом формате:",
                editContactKeyboard(2)
            );
            return;
        }

        try {
            state.data.contact2 = text;

            await updatePassenger(
                state.rowNumber,
                state.data
            );

            state.editingField = null;

            await showEditMenu(chatId, state);
        } catch (error) {
            console.error(error);

            await editMessage(
                chatId,
                state.messageId,
                "❌ Не удалось сохранить контакт 2.\n\nПопробуйте ещё раз.",
                editContactKeyboard(2)
            );
        }

        return;
    }

    // =================================================
    // REGISTRATION CITIZENSHIP OTHER
    // =================================================

    if (
        state.editingField ===
        "registration_citizenship_other"
    ) {
        if (!text) {
            await editMessage(
                chatId,
                state.messageId,
                "🌍 Введите гражданство:",
                citizenshipKeyboard()
            );
            return;
        }

        state.data.citizenship = text;
        state.editingField = null;
        state.step = 6;

        await askNextRegistrationStep(
            chatId,
            state
        );

        return;
    }

    // =================================================
    // EDIT CITIZENSHIP OTHER
    // =================================================

    if (state.editingField === "citizenship_other") {
        if (!text) {
            await editMessage(
                chatId,
                state.messageId,
                "🌍 Введите гражданство:",
                editCitizenshipKeyboard()
            );
            return;
        }

        try {
            state.data.citizenship = text;

            await updatePassenger(
                state.rowNumber,
                state.data
            );

            state.editingField = null;

            await showEditMenu(chatId, state);
        } catch (error) {
            console.error(error);

            await editMessage(
                chatId,
                state.messageId,
                "❌ Не удалось сохранить гражданство.",
                editCitizenshipKeyboard()
            );
        }

        return;
    }

    // =================================================
    // ADD CONTACT 2
    // =================================================

    if (state.editingField === "new_contact2") {
        const contact = validateTajikPhone(text);

        if (!contact) {
            await editMessage(
                chatId,
                state.messageId,
                "❌ Неверный номер.\n\nВведите номер Таджикистана в формате 992XXXXXXXXX или 9XXXXXXXX:",
                contactOtherKeyboard(2)
            );
            return;
        }

        state.data.contact2 = contact;
        state.editingField = null;

        await showContactMenu(chatId, state);
        return;
    }

    // =================================================
    // NORMAL EDIT TEXT FIELDS
    // =================================================

    if (state.editingField) {
        const field = state.editingField;

        const textFields = [
            "surname",
            "name",
            "patronymic",
            "passport"
        ];

        if (textFields.includes(field)) {
            if (!text) {
                await editMessage(
                    chatId,
                    state.messageId,
                    "❌ Поле не может быть пустым."
                );
                return;
            }

            try {
                state.data[field] = text;

                await updatePassenger(
                    state.rowNumber,
                    state.data
                );

                state.editingField = null;

                await showEditMenu(chatId, state);
            } catch (error) {
                console.error(error);

                await editMessage(
                    chatId,
                    state.messageId,
                    "❌ Не удалось сохранить изменение.\n\nПопробуйте ещё раз."
                );
            }

            return;
        }

        if (field === "contact1") {
            const contact = validateTajikPhone(text);

            if (!contact) {
                await editMessage(
                    chatId,
                    state.messageId,
                    "❌ Неверный номер.\n\nВведите номер Таджикистана в формате 992XXXXXXXXX или 9XXXXXXXX:",
                    editContactKeyboard(1)
                );
                return;
            }

            try {
                state.data.contact1 = contact;

                await updatePassenger(
                    state.rowNumber,
                    state.data
                );

                state.editingField = null;

                await showEditMenu(chatId, state);
            } catch (error) {
                console.error(error);

                await editMessage(
                    chatId,
                    state.messageId,
                    "❌ Не удалось сохранить контакт 1.",
                    editContactKeyboard(1)
                );
            }

            return;
        }

        if (field === "contact2") {
            const contact = validateTajikPhone(text);

            if (!contact) {
                await editMessage(
                    chatId,
                    state.messageId,
                    "❌ Неверный номер.\n\nВведите номер Таджикистана в формате 992XXXXXXXXX или 9XXXXXXXX:",
                    editContactKeyboard(2)
                );
                return;
            }

            try {
                state.data.contact2 = contact;

                await updatePassenger(
                    state.rowNumber,
                    state.data
                );

                state.editingField = null;

                await showEditMenu(chatId, state);
            } catch (error) {
                console.error(error);

                await editMessage(
                    chatId,
                    state.messageId,
                    "❌ Не удалось сохранить контакт 2.",
                    editContactKeyboard(2)
                );
            }

            return;
        }
    }

    // =================================================
    // REGISTRATION TEXT
    // =================================================

    if (state.step === 0) {
        state.data.surname = text;
        state.step = 1;

        await askNextRegistrationStep(
            chatId,
            state
        );

        return;
    }

    if (state.step === 1) {
        state.data.name = text;
        state.step = 2;

        await askNextRegistrationStep(
            chatId,
            state
        );

        return;
    }

    if (state.step === 2) {
        state.data.patronymic = text;
        state.step = 3;

        await askNextRegistrationStep(
            chatId,
            state
        );

        return;
    }

    if (state.step === 4) {
        state.data.passport = text;
        state.step = 5;

        await askNextRegistrationStep(
            chatId,
            state
        );

        return;
    }

    if (state.step === 5) {
        state.data.citizenship = text;
        state.step = 6;

        await askNextRegistrationStep(
            chatId,
            state
        );

        return;
    }

    if (state.step === 6) {
        const contact = validateTajikPhone(text);

        if (!contact) {
            await editMessage(
                chatId,
                state.messageId,
                "❌ Неверный номер.\n\nВведите номер Таджикистана в формате 992XXXXXXXXX или 9XXXXXXXX:",
                contactOtherKeyboard(1)
            );
            return;
        }

        state.data.contact1 = contact;

        await showContactMenu(chatId, state);

        return;
    }
}

// =====================================================
// CALLBACK HANDLER
// =====================================================

async function handleCallbackQuery(callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    const data = callbackQuery.data;

    await answerCallbackQuery(
        callbackQuery.id
    );

    const state = getState(chatId);

    state.messageId = messageId;

    console.log(
        `🔘 Callback от ${chatId}: ${data}`
    );

    // =================================================
    // NOOP
    // =================================================

    if (data === "noop") {
        return;
    }

    // =================================================
    // MAIN MENU
    // =================================================

    if (data === "main_menu") {
        resetState(chatId);

        const newState = getState(chatId);
        newState.messageId = messageId;

        await editMessage(
            chatId,
            messageId,
            "🏠 Главное меню",
            mainMenuKeyboard()
        );

        return;
    }

    if (data === "main_add_passenger") {
        await startRegistration(chatId);
        return;
    }

    if (data === "main_view_data") {
        await editMessage(
            chatId,
            messageId,
            "👤 Посмотреть данные\n\nФункция пока находится в разработке.",
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
        await editMessage(
            chatId,
            messageId,
            "🔎 Найти пассажира\n\nФункция пока находится в разработке.",
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
        await editMessage(
            chatId,
            messageId,
            "✈️ Пассажиры рейса\n\nФункция пока находится в разработке.",
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
        await editMessage(
            chatId,
            messageId,
            "📊 Статистика\n\nФункция пока находится в разработке.",
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
    // CITIZENSHIP REGISTRATION
    // =================================================

    if (data === "citizenship_TJ") {
        state.data.citizenship = "TJ";
        state.step = 6;

        await askNextRegistrationStep(
            chatId,
            state
        );

        return;
    }

    if (data === "citizenship_RU") {
        state.data.citizenship = "RU";
        state.step = 6;

        await askNextRegistrationStep(
            chatId,
            state
        );

        return;
    }

    if (data === "citizenship_other") {
        state.editingField =
            "registration_citizenship_other";

        await editMessage(
            chatId,
            messageId,
            "🌍 Введите гражданство:",
            citizenshipKeyboard()
        );

        return;
    }

    // =================================================
    // CONTACT 1 OTHER REGISTRATION
    // =================================================

    if (data === "contact1_other") {
        state.editingField =
            "registration_contact1_other";

        await editMessage(
            chatId,
            messageId,
            "🌍 Введите контакт 1 в любом формате:",
            contactOtherKeyboard(1)
        );

        return;
    }

    // =================================================
    // CONTACT 2 OTHER REGISTRATION
    // =================================================

    if (data === "contact2_other") {
        state.editingField =
            "registration_contact2_other";

        await editMessage(
            chatId,
            messageId,
            "🌍 Введите контакт 2 в любом формате:",
            contactOtherKeyboard(2)
        );

        return;
    }

    // =================================================
    // ADD CONTACT 2
    // =================================================

    if (data === "add_contact2") {
        state.editingField = "new_contact2";

        await editMessage(
            chatId,
            messageId,
            "Введите контакт 2:",
            contactOtherKeyboard(2)
        );

        return;
    }

    // =================================================
    // CONTACTS CONTINUE
    // =================================================

    if (data === "contacts_continue") {
        state.editingField = null;
        state.step = 7;

        await askNextRegistrationStep(
            chatId,
            state
        );

        return;
    }

    // =================================================
    // CALENDAR YEAR PAGE
    // =================================================

    if (data.startsWith("cal_year_page_")) {
        const parts = data.split("_");

        const type = parts[3];
        const page = parseInt(parts[4], 10);

        if (!isNaN(page)) {
            await showCalendarYearPage(
                chatId,
                state,
                type,
                page
            );
        }

        return;
    }

    // =================================================
    // CALENDAR YEAR
    // =================================================

    if (data.startsWith("cal_year_")) {
        const parts = data.split("_");

        const type = parts[2];
        const year = parseInt(parts[3], 10);

        if (isNaN(year)) {
            return;
        }

        await showCalendarMonths(
            chatId,
            state,
            type,
            year
        );

        return;
    }

    // =================================================
    // CALENDAR BACK TO MONTH
    // =================================================

    if (data.startsWith("cal_back_month_")) {
        const parts = data.split("_");

        const type = parts[3];
        const year = parseInt(parts[4], 10);

        if (isNaN(year)) {
            return;
        }

        await showCalendarMonths(
            chatId,
            state,
            type,
            year
        );

        return;
    }

    // =================================================
    // CALENDAR MONTH
    // =================================================

    if (data.startsWith("cal_month_")) {
        const parts = data.split("_");

        const type = parts[2];
        const year = parseInt(parts[3], 10);
        const month = parseInt(parts[4], 10);

        if (
            isNaN(year) ||
            isNaN(month)
        ) {
            return;
        }

        await showCalendarDays(
            chatId,
            state,
            type,
            year,
            month
        );

        return;
    }

    // =================================================
    // CALENDAR DAY
    // =================================================

    if (data.startsWith("cal_day_")) {
        const parts = data.split("_");

        const type = parts[2];
        const year = parseInt(parts[3], 10);
        const month = parseInt(parts[4], 10);
        const day = parseInt(parts[5], 10);

        if (
            isNaN(year) ||
            isNaN(month) ||
            isNaN(day)
        ) {
            return;
        }

        const selectedDate = formatDate(
            day,
            month,
            year
        );

        const baseType = getBaseCalendarType(type);

        // =============================================
        // BIRTH REGISTRATION
        // =============================================

        if (type === "birth") {
            state.data.birthDate = selectedDate;
            state.step = 4;

            await editMessage(
                chatId,
                messageId,
                `🎂 Дата рождения: ${selectedDate}\n\nВведите номер паспорта:`
            );

            return;
        }

        // =============================================
        // FLIGHT REGISTRATION
        // =============================================

        if (type === "flight") {
            state.data.flightDate = selectedDate;
            state.step = 8;

            await editMessage(
                chatId,
                messageId,
                "Выберите маршрут:",
                routeKeyboard()
            );

            return;
        }

        // =============================================
        // BIRTH EDIT
        // =============================================

        if (type === "birth_edit") {
            try {
                state.data.birthDate = selectedDate;

                await updatePassenger(
                    state.rowNumber,
                    state.data
                );

                state.editingField = null;

                await showEditMenu(
                    chatId,
                    state
                );
            } catch (error) {
                console.error(error);

                await editMessage(
                    chatId,
                    messageId,
                    "❌ Не удалось сохранить дату рождения.",
                    {
                        inline_keyboard: [
                            [
                                {
                                    text: "↩️ Назад",
                                    callback_data: "edit_back"
                                }
                            ]
                        ]
                    }
                );
            }

            return;
        }

        // =============================================
        // FLIGHT EDIT
        // =============================================

        if (type === "flight_edit") {
            try {
                const route = state.data.route;
                const status = state.data.status;

                if (
                    route &&
                    status !== "Отменен"
                ) {
                    const available =
                        await isSeatAvailable(
                            selectedDate,
                            route,
                            state.rowNumber
                        );

                    if (!available) {
                        await editMessage(
                            chatId,
                            messageId,
                            "❌ На выбранную дату и маршрут уже заняты все 19 мест.",
                            {
                                inline_keyboard: [
                                    [
                                        {
                                            text: "↩️ Назад",
                                            callback_data: "edit_back"
                                        }
                                    ]
                                }
                            }
                        );

                        return;
                    }
                }

                state.data.flightDate =
                    selectedDate;

                await updatePassenger(
                    state.rowNumber,
                    state.data
                );

                state.editingField = null;

                await showEditMenu(
                    chatId,
                    state
                );
            } catch (error) {
                console.error(error);

                await editMessage(
                    chatId,
                    messageId,
                    "❌ Не удалось сохранить дату рейса.",
                    {
                        inline_keyboard: [
                            [
                                {
                                    text: "↩️ Назад",
                                    callback_data: "edit_back"
                                }
                            ]
                        ]
                    }
                );
            }

            return;
        }

        return;
    }

    // =================================================
    // ROUTE REGISTRATION
    // =================================================

    const route = getRouteFromCallback(data);

    if (route && state.step === 8) {
        const available =
            await isSeatAvailable(
                state.data.flightDate,
                route
            );

        if (!available) {
            await editMessage(
                chatId,
                messageId,
                `❌ На ${state.data.flightDate} по маршруту ${route} уже заняты все ${CAPACITY} мест.`,
                routeKeyboard()
            );

            return;
        }

        state.data.route = route;
        state.step = 9;

        await editMessage(
            chatId,
            messageId,
            "Выберите статус:",
            statusKeyboard()
        );

        return;
    }

    // =================================================
    // STATUS REGISTRATION
    // =================================================

    const status = getStatusFromCallback(data);

    if (status && state.step === 9) {
        if (status !== "Отменен") {
            const available =
                await isSeatAvailable(
                    state.data.flightDate,
                    state.data.route
                );

            if (!available) {
                await editMessage(
                    chatId,
                    messageId,
                    `❌ На ${state.data.flightDate} по маршруту ${state.data.route} уже заняты все ${CAPACITY} мест.`,
                    statusKeyboard()
                );

                return;
            }
        }

        state.data.status = status;

        await finishRegistration(
            chatId,
            state
        );

        return;
    }

    // =================================================
    // PASSENGER EDIT
    // =================================================

    if (data === "passenger_edit") {
        await showEditMenu(
            chatId,
            state
        );

        return;
    }

    // =================================================
    // EDIT BACK
    // =================================================

    if (data === "edit_back") {
        await showEditMenu(
            chatId,
            state
        );

        return;
    }

    // =================================================
    // EDIT TEXT FIELDS
    // =================================================

    const editTextFields = {
        edit_surname: "surname",
        edit_name: "name",
        edit_patronymic: "patronymic",
        edit_passport: "passport"
    };

    if (editTextFields[data]) {
        const field = editTextFields[data];

        state.editingField = field;

        const titles = {
            surname: "Введите новую фамилию:",
            name: "Введите новое имя:",
            patronymic: "Введите новое отчество:",
            passport: "Введите новый номер паспорта:"
        };

        await editMessage(
            chatId,
            messageId,
            titles[field],
            {
                inline_keyboard: [
                    [
                        {
                            text: "↩️ Назад",
                            callback_data: "edit_back"
                        }
                    ]
                ]
            }
        );

        return;
    }

    // =================================================
    // EDIT CITIZENSHIP
    // =================================================

    if (data === "edit_citizenship") {
        state.editingField = null;

        await editMessage(
            chatId,
            messageId,
            "Выберите гражданство:",
            editCitizenshipKeyboard()
        );

        return;
    }

    if (data === "edit_citizenship_TJ") {
        try {
            state.data.citizenship = "TJ";

            await updatePassenger(
                state.rowNumber,
                state.data
            );

            await showEditMenu(
                chatId,
                state
            );
        } catch (error) {
            console.error(error);

            await editMessage(
                chatId,
                messageId,
                "❌ Не удалось сохранить гражданство.",
                editCitizenshipKeyboard()
            );
        }

        return;
    }

    if (data === "edit_citizenship_RU") {
        try {
            state.data.citizenship = "RU";

            await updatePassenger(
                state.rowNumber,
                state.data
            );

            await showEditMenu(
                chatId,
                state
            );
        } catch (error) {
            console.error(error);

            await editMessage(
                chatId,
                messageId,
                "❌ Не удалось сохранить гражданство.",
                editCitizenshipKeyboard()
            );
        }

        return;
    }

    if (data === "edit_citizenship_other") {
        state.editingField = "citizenship_other";

        await editMessage(
            chatId,
            messageId,
            "🌍 Введите гражданство:",
            editCitizenshipKeyboard()
        );

        return;
    }

    // =================================================
    // EDIT CONTACT 1
    // =================================================

    if (data === "edit_contact1") {
        state.editingField = "contact1";

        await editMessage(
            chatId,
            messageId,
            "Введите новый Контакт 1:",
            editContactKeyboard(1)
        );

        return;
    }

    if (data === "edit_contact1_other") {
        state.editingField = "contact1_other";

        await editMessage(
            chatId,
            messageId,
            "🌍 Введите Контакт 1 в любом формате:",
            editContactKeyboard(1)
        );

        return;
    }

    // =================================================
    // EDIT CONTACT 2
    // =================================================

    if (data === "edit_contact2") {
        state.editingField = "contact2";

        await editMessage(
            chatId,
            messageId,
            "Введите новый Контакт 2:",
            editContactKeyboard(2)
        );

        return;
    }

    if (data === "edit_contact2_other") {
        state.editingField = "contact2_other";

        await editMessage(
            chatId,
            messageId,
            "🌍 Введите Контакт 2 в любом формате:",
            editContactKeyboard(2)
        );

        return;
    }

    // =================================================
    // EDIT BIRTH DATE
    // =================================================

    if (data === "edit_birthDate") {
        state.editingField = "birthDate";

        await showCalendar(
            chatId,
            state,
            "birth_edit"
        );

        return;
    }

    // =================================================
    // EDIT FLIGHT DATE
    // =================================================

    if (data === "edit_flightDate") {
        state.editingField = "flightDate";

        await showCalendar(
            chatId,
            state,
            "flight_edit"
        );

        return;
    }

    // =================================================
    // EDIT ROUTE
    // =================================================

    if (data === "edit_route") {
        await editMessage(
            chatId,
            messageId,
            "Выберите новый маршрут:",
            editRouteKeyboard()
        );

        return;
    }

    if (
        data === "edit_route_DSB_XRG" ||
        data === "edit_route_XRG_DSB"
    ) {
        const newRoute =
            data === "edit_route_DSB_XRG"
                ? "ДШБ — ХРГ"
                : "ХРГ — ДШБ";

        if (
            state.data.status !== "Отменен"
        ) {
            const available =
                await isSeatAvailable(
                    state.data.flightDate,
                    newRoute,
                    state.rowNumber
                );

            if (!available) {
                await editMessage(
                    chatId,
                    messageId,
                    `❌ На ${state.data.flightDate} по маршруту ${newRoute} уже заняты все ${CAPACITY} мест.`,
                    editRouteKeyboard()
                );

                return;
            }
        }

        try {
            state.data.route = newRoute;

            await updatePassenger(
                state.rowNumber,
                state.data
            );

            await showEditMenu(
                chatId,
                state
            );
        } catch (error) {
            console.error(error);

            await editMessage(
                chatId,
                messageId,
                "❌ Не удалось изменить маршрут.",
                editRouteKeyboard()
            );
        }

        return;
    }

    // =================================================
    // EDIT STATUS
    // =================================================

    if (data === "edit_status") {
        await editMessage(
            chatId,
            messageId,
            "Выберите новый статус:",
            editStatusKeyboard()
        );

        return;
    }

    if (
        data === "edit_status_reserved" ||
        data === "edit_status_confirmed" ||
        data === "edit_status_cancelled"
    ) {
        let newStatus = "";

        if (data === "edit_status_reserved") {
            newStatus = "Забронирован";
        }

        if (data === "edit_status_confirmed") {
            newStatus = "Подтвержден";
        }

        if (data === "edit_status_cancelled") {
            newStatus = "Отменен";
        }

        if (newStatus !== "Отменен") {
            const available =
                await isSeatAvailable(
                    state.data.flightDate,
                    state.data.route,
                    state.rowNumber
                );

            if (!available) {
                await editMessage(
                    chatId,
                    messageId,
                    `❌ На ${state.data.flightDate} по маршруту ${state.data.route} уже заняты все ${CAPACITY} мест.`,
                    editStatusKeyboard()
                );

                return;
            }
        }

        try {
            state.data.status = newStatus;

            await updatePassenger(
                state.rowNumber,
                state.data
            );

            await showEditMenu(
                chatId,
                state
            );
        } catch (error) {
            console.error(error);

            await editMessage(
                chatId,
                messageId,
                "❌ Не удалось изменить статус.",
                editStatusKeyboard()
            );
        }

        return;
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

        console.log(
            "📡 Telegram отправил update"
        );

        console.log(
            "🔐 Webhook secret подтверждён"
        );

        res.sendStatus(200);

        try {
            const update = req.body;

            console.log(
                "📨 Получен update:",
                JSON.stringify(update)
            );

            if (update.message) {
                console.log(
                    `📩 Получено сообщение от ${update.message.chat.id}: ${update.message.text || "[не текст]"}`
                );

                await handleTextMessage(
                    update.message
                );
            }

            if (update.callback_query) {
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

// =====================================================
// HEALTH CHECK
// =====================================================

app.get("/", (req, res) => {
    res.json({
        status: "ok",
        bot: "KMRN Passenger Bot"
    });
});

app.get("/health", (req, res) => {
    res.json({
        status: "ok"
    });
});

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
                    url: `${PUBLIC_URL}/telegram/webhook`,
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
// WEBHOOK INFO
// =====================================================

async function getWebhookInfo() {
    try {
        const result =
            await telegramRequest(
                "getWebhookInfo"
            );

        if (result.ok) {
            console.log(
                "📡 Webhook Info:",
                JSON.stringify(
                    result.result,
                    null,
                    2
                )
            );
        } else {
            console.error(
                "❌ Ошибка getWebhookInfo:",
                result.description
            );
        }
    } catch (error) {
        console.error(
            "❌ Ошибка getWebhookInfo:",
            error.message
        );
    }
}

// =====================================================
// START SERVER
// =====================================================

app.listen(PORT, async () => {
    console.log(
        `🚀 KMRN Passenger Bot запущен на порту ${PORT}`
    );

    await setupWebhook();
    await getWebhookInfo();
});
