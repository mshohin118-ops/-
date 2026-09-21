require("dotenv").config();

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
    : "";
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const PUBLIC_URL = process.env.PUBLIC_URL;

/* =========================================================
   GOOGLE SHEETS
========================================================= */

const auth = new google.auth.GoogleAuth({
    credentials: {
        client_email: GOOGLE_CLIENT_EMAIL,
        private_key: GOOGLE_PRIVATE_KEY
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const sheets = google.sheets({
    version: "v4",
    auth
});

let cachedSheetTitle = null;

async function getSheetTitle() {
    if (cachedSheetTitle) {
        return cachedSheetTitle;
    }

    const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID
    });

    const firstSheet = spreadsheet.data.sheets[0];

    if (!firstSheet) {
        throw new Error("В Google Sheets не найден лист");
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

/* =========================================================
   TELEGRAM API
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

async function sendMessage(chatId, text, replyMarkup = null) {
    const body = {
        chat_id: chatId,
        text
    };

    if (replyMarkup) {
        body.reply_markup = replyMarkup;
    }

    return await telegramRequest("sendMessage", body);
}

async function editMessage(chatId, messageId, text, replyMarkup = null) {
    const body = {
        chat_id: chatId,
        message_id: messageId,
        text
    };

    if (replyMarkup) {
        body.reply_markup = replyMarkup;
    }

    return await telegramRequest("editMessageText", body);
}

async function answerCallbackQuery(callbackQueryId) {
    return await telegramRequest("answerCallbackQuery", {
        callback_query_id: callbackQueryId
    });
}

async function deleteMessage(chatId, messageId) {
    return await telegramRequest("deleteMessage", {
        chat_id: chatId,
        message_id: messageId
    });
}

async function deleteUserMessage(chatId, messageId) {
    if (!messageId) return;

    try {
        const result = await deleteMessage(chatId, messageId);

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
   STATE
========================================================= */

const userStates = new Map();

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
    if (!userStates.has(chatId)) {
        userStates.set(chatId, createState());
    }

    return userStates.get(chatId);
}

/* =========================================================
   CONSTANTS
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

const ROUTES = [
    {
        code: "DSH-KRG",
        title: "ДШБ — ХРГ"
    },
    {
        code: "KRG-DSH",
        title: "ХРГ — ДШБ"
    }
];

const STATUSES = [
    {
        code: "Забронирован",
        title: "🟢 Забронирован"
    },
    {
        code: "Подтвержден",
        title: "🔵 Подтвержден"
    },
    {
        code: "Отменен",
        title: "🔴 Отменен"
    }
];

const CAPACITY = 19;

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

async function showMainMenu(chatId, state) {
    const text = "🏠 Главное меню";

    if (state.messageId) {
        const result = await editMessage(
            chatId,
            state.messageId,
            text,
            mainMenuKeyboard()
        );

        if (!result.ok) {
            const sent = await sendMessage(
                chatId,
                text,
                mainMenuKeyboard()
            );

            if (sent.ok) {
                state.messageId = sent.result.message_id;
            }
        }
    } else {
        const sent = await sendMessage(
            chatId,
            text,
            mainMenuKeyboard()
        );

        if (sent.ok) {
            state.messageId = sent.result.message_id;
        }
    }
}

/* =========================================================
   REGISTRATION QUESTIONS
========================================================= */

const QUESTIONS = [
    "Введите фамилию:",
    "Введите имя:",
    "Введите отчество:",
    "Введите дату рождения:",
    "Введите номер паспорта:",
    "Выберите гражданство:",
    "Введите контактный номер:",
    "Выберите дату рейса:",
    "Выберите маршрут:",
    "Выберите статус:"
];

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
                    text: "🌍 Другое",
                    callback_data: "citizenship_other"
                }
            ]
        ]
    };
}

/* =========================================================
   CONTACTS
========================================================= */

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

function contactsMenuKeyboard() {
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

/* =========================================================
   CALENDAR
========================================================= */

function getBaseCalendarType(type) {
    if (type === "birth_edit") return "birth";
    if (type === "flight_edit") return "flight";

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

function getCalendarYears(type, page) {
    const currentYear = new Date().getFullYear();
    const baseType = getBaseCalendarType(type);

    let years = [];

    if (baseType === "birth") {
        const maxYear = currentYear;
        const minYear = 1940;

        for (let year = maxYear; year >= minYear; year--) {
            years.push(year);
        }
    } else {
        const maxYear = currentYear + 5;

        for (let year = currentYear; year <= maxYear; year++) {
            years.push(year);
        }
    }

    const pageSize = 12;
    const start = page * pageSize;

    return years.slice(start, start + pageSize);
}

function calendarYearsKeyboard(type, page) {
    const years = getCalendarYears(type, page);

    const rows = [];

    for (let i = 0; i < years.length; i += 3) {
        const row = [];

        for (let j = i; j < i + 3 && j < years.length; j++) {
            row.push({
                text: String(years[j]),
                callback_data: `cal_year_${type}_${years[j]}`
            });
        }

        rows.push(row);
    }

    const navigation = [];

    if (page > 0) {
        navigation.push({
            text: "⬅️ Назад",
            callback_data: `cal_year_page_${type}_${page - 1}`
        });
    }

    if (getCalendarYears(type, page + 1).length > 0) {
        navigation.push({
            text: "Вперёд ➡️",
            callback_data: `cal_year_page_${type}_${page + 1}`
        });
    }

    if (navigation.length > 0) {
        rows.push(navigation);
    }

    return {
        inline_keyboard: rows
    };
}

function calendarMonthsKeyboard(type, year) {
    const rows = [];

    for (let i = 0; i < 12; i += 3) {
        const row = [];

        for (let j = i; j < i + 3; j++) {
            row.push({
                text: MONTHS[j],
                callback_data: `cal_month_${type}_${year}_${j}`
            });
        }

        rows.push(row);
    }

    rows.push([
        {
            text: "↩️ К годам",
            callback_data: `cal_back_year_${type}`
        }
    ]);

    return {
        inline_keyboard: rows
    };
}

function daysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
}

function calendarDaysKeyboard(type, year, month) {
    const rows = [];

    rows.push(
        WEEKDAYS.map(day => ({
            text: day,
            callback_data: "calendar_noop"
        }))
    );

    const firstDay = new Date(year, month, 1);

    let startDay = firstDay.getDay();

    if (startDay === 0) {
        startDay = 7;
    }

    const totalDays = daysInMonth(year, month);

    let row = [];

    for (let i = 1; i < startDay; i++) {
        row.push({
            text: " ",
            callback_data: "calendar_noop"
        });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let day = 1; day <= totalDays; day++) {
        const date = new Date(year, month, day);
        date.setHours(0, 0, 0, 0);

        const dateString =
            `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

        let disabled = false;

        if (getBaseCalendarType(type) === "birth") {
            if (date > today) {
                disabled = true;
            }
        }

        if (disabled) {
            row.push({
                text: "·",
                callback_data: "calendar_noop"
            });
        } else {
            row.push({
                text: String(day),
                callback_data: `cal_day_${type}_${year}_${month}_${day}`
            });
        }

        if (row.length === 7) {
            rows.push(row);
            row = [];
        }
    }

    if (row.length > 0) {
        while (row.length < 7) {
            row.push({
                text: " ",
                callback_data: "calendar_noop"
            });
        }

        rows.push(row);
    }

    rows.push([
        {
            text: "↩️ К месяцам",
            callback_data: `cal_back_month_${type}_${year}`
        }
    ]);

    return {
        inline_keyboard: rows
    };
}

async function showCalendar(chatId, state, type) {
    state.calendarType = type;
    state.calendarPage = 0;

    const title = getCalendarTitle(type, "year");

    const result = await editMessage(
        chatId,
        state.messageId,
        title,
        calendarYearsKeyboard(type, 0)
    );

    if (!result.ok) {
        const sent = await sendMessage(
            chatId,
            title,
            calendarYearsKeyboard(type, 0)
        );

        if (sent.ok) {
            state.messageId = sent.result.message_id;
        }
    }
}

async function showCalendarMonths(chatId, state, type, year) {
    state.calendarYear = year;

    await editMessage(
        chatId,
        state.messageId,
        getCalendarTitle(type, "month"),
        calendarMonthsKeyboard(type, year)
    );
}

async function showCalendarDays(chatId, state, type, year, month) {
    state.calendarYear = year;
    state.calendarMonth = month;

    await editMessage(
        chatId,
        state.messageId,
        getCalendarTitle(type, "day"),
        calendarDaysKeyboard(type, year, month)
    );
}

/* =========================================================
   ROUTE
========================================================= */

function routeKeyboard() {
    return {
        inline_keyboard: [
            [
                {
                    text: "ДШБ — ХРГ",
                    callback_data: "route_DSH-KRG"
                }
            ],
            [
                {
                    text: "ХРГ — ДШБ",
                    callback_data: "route_KRG-DSH"
                }
            ]
        ]
    };
}

/* =========================================================
   STATUS
========================================================= */

function statusKeyboard() {
    return {
        inline_keyboard: [
            [
                {
                    text: "🟢 Забронирован",
                    callback_data: "status_Забронирован"
                }
            ],
            [
                {
                    text: "🔵 Подтвержден",
                    callback_data: "status_Подтвержден"
                }
            ],
            [
                {
                    text: "🔴 Отменен",
                    callback_data: "status_Отменен"
                }
            ]
        ]
    };
}

/* =========================================================
   CAPACITY
========================================================= */

async function calculateRouteOccupancy(
    flightDate,
    route,
    excludeRowNumber = null
) {
    if (!flightDate || !route) {
        return 0;
    }

    const rows = await getAllRows();

    let occupancy = 0;

    for (let i = 1; i < rows.length; i++) {
        const rowNumber = i + 1;

        if (
            excludeRowNumber &&
            Number(excludeRowNumber) === rowNumber
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
            occupancy++;
        }
    }

    return occupancy;
}

async function checkCapacity(
    flightDate,
    route,
    excludeRowNumber = null
) {
    const occupancy = await calculateRouteOccupancy(
        flightDate,
        route,
        excludeRowNumber
    );

    return {
        occupancy,
        remaining: Math.max(0, CAPACITY - occupancy),
        available: occupancy < CAPACITY
    };
}

/* =========================================================
   SAVE PASSENGER
========================================================= */

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

    return passengerId;
}

/* =========================================================
   UPDATE PASSENGER
========================================================= */

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

/* =========================================================
   PASSENGER CARD
========================================================= */

function passengerCard(data) {
    return (
        `👤 Пассажир №${data.passengerId || ""}\n\n` +

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

function passengerAfterSaveKeyboard() {
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

/* =========================================================
   EDIT MENU
========================================================= */

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
                },
                {
                    text: "✏️ Дата рождения",
                    callback_data: "edit_birthDate"
                }
            ],
            [
                {
                    text: "✏️ Паспорт",
                    callback_data: "edit_passport"
                },
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
                },
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

/* =========================================================
   EDIT CITIZENSHIP
========================================================= */

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

/* =========================================================
   HANDLE TEXT MESSAGE
========================================================= */

async function handleTextMessage(message) {
    if (!message || !message.chat) {
        return;
    }

    const chatId = message.chat.id;
    const text = (message.text || "").trim();

    console.log(
        `📩 Получено сообщение от ${chatId}: ${text}`
    );

    if (text === "/start") {
        console.log(
            `🚀 Запуск бота для ${chatId}`
        );

        const state = createState();
        userStates.set(chatId, state);

        const result = await sendMessage(
            chatId,
            "🏠 Главное меню",
            mainMenuKeyboard()
        );

        if (result.ok) {
            state.messageId = result.result.message_id;

            console.log(
                `✅ Главное меню отправлено. messageId=${state.messageId}`
            );
        }

        return;
    }

    const state = getState(chatId);

    /*
       Удаляем текст пользователя сразу.
       Если Telegram не даст удалить — работа продолжается.
    */
    await deleteUserMessage(
        chatId,
        message.message_id
    );

    /* =====================================================
       EDIT MODE
    ===================================================== */

    if (state.editingField) {
        const field = state.editingField;

        /* ---------------------------------------------
           Гражданство — Другое
        --------------------------------------------- */

        if (field === "citizenship_other") {
            if (!text) {
                await editMessage(
                    chatId,
                    state.messageId,
                    "❌ Гражданство не может быть пустым.\n\nВведите гражданство:",
                    editCitizenshipKeyboard()
                );

                return;
            }

            state.data.citizenship = text;

            await updatePassenger(
                state.rowNumber,
                state.data
            );

            await showEditMenu(chatId, state);

            return;
        }

        /* ---------------------------------------------
           Контакт 1 — Другое
        --------------------------------------------- */

        if (field === "contact1_other") {
            if (!text) {
                await editMessage(
                    chatId,
                    state.messageId,
                    "❌ Контакт не может быть пустым.\n\nВведите контакт:",
                    editContactKeyboard(1)
                );

                return;
            }

            state.data.contact1 = text;

            await updatePassenger(
                state.rowNumber,
                state.data
            );

            await showEditMenu(chatId, state);

            return;
        }

        /* ---------------------------------------------
           Контакт 2 — Другое
        --------------------------------------------- */

        if (field === "contact2_other") {
            if (!text) {
                await editMessage(
                    chatId,
                    state.messageId,
                    "❌ Контакт не может быть пустым.\n\nВведите контакт:",
                    editContactKeyboard(2)
                );

                return;
            }

            state.data.contact2 = text;

            await updatePassenger(
                state.rowNumber,
                state.data
            );

            await showEditMenu(chatId, state);

            return;
        }

        /* ---------------------------------------------
           Обычные текстовые поля
        --------------------------------------------- */

        if (
            field === "surname" ||
            field === "name" ||
            field === "patronymic" ||
            field === "passport"
        ) {
            if (!text) {
                await editMessage(
                    chatId,
                    state.messageId,
                    "❌ Поле не может быть пустым.\n\nПопробуйте ещё раз:"
                );

                return;
            }

            state.data[field] = text;

            await updatePassenger(
                state.rowNumber,
                state.data
            );

            await showEditMenu(chatId, state);

            return;
        }

        /* ---------------------------------------------
           Обычный контакт 1
        --------------------------------------------- */

        if (field === "contact1") {
            const contact = validateTajikPhone(text);

            if (!contact) {
                await editMessage(
                    chatId,
                    state.messageId,
                    "❌ Неверный номер.\n\nВведите номер в формате:\n+992XXXXXXXXX\n\nИли выберите «🌍 Другое».",
                    editContactKeyboard(1)
                );

                return;
            }

            state.data.contact1 = contact;

            await updatePassenger(
                state.rowNumber,
                state.data
            );

            await showEditMenu(chatId, state);

            return;
        }

        /* ---------------------------------------------
           Обычный контакт 2
        --------------------------------------------- */

        if (field === "contact2") {
            const contact = validateTajikPhone(text);

            if (!contact) {
                await editMessage(
                    chatId,
                    state.messageId,
                    "❌ Неверный номер.\n\nВведите номер в формате:\n+992XXXXXXXXX\n\nИли выберите «🌍 Другое».",
                    editContactKeyboard(2)
                );

                return;
            }

            state.data.contact2 = contact;

            await updatePassenger(
                state.rowNumber,
                state.data
            );

            await showEditMenu(chatId, state);

            return;
        }

        /* ---------------------------------------------
           Добавление контакта 2
        --------------------------------------------- */

        if (field === "new_contact2") {
            const contact = validateTajikPhone(text);

            if (!contact) {
                await editMessage(
                    chatId,
                    state.messageId,
                    "❌ Неверный номер.\n\nВведите номер в формате:\n+992XXXXXXXXX\n\nИли выберите «🌍 Другое».",
                    {
                        inline_keyboard: [
                            [
                                {
                                    text: "🌍 Другое",
                                    callback_data: "contact2_other"
                                }
                            ]
                        ]
                    }
                );

                return;
            }

            state.data.contact2 = contact;

            await showContactMenu(
                chatId,
                state
            );

            return;
        }

        return;
    }

    /* =====================================================
       NORMAL REGISTRATION
    ===================================================== */

    if (state.step === 0) {
        state.data.surname = text;
        state.step = 1;

        await editMessage(
            chatId,
            state.messageId,
            QUESTIONS[1]
        );

        return;
    }

    if (state.step === 1) {
        state.data.name = text;
        state.step = 2;

        await editMessage(
            chatId,
            state.messageId,
            QUESTIONS[2]
        );

        return;
    }

    if (state.step === 2) {
        state.data.patronymic = text;
        state.step = 3;

        await showCalendar(
            chatId,
            state,
            "birth"
        );

        return;
    }

    if (state.step === 4) {
        state.data.passport = text;
        state.step = 5;

        await editMessage(
            chatId,
            state.messageId,
            "Выберите гражданство:",
            citizenshipKeyboard()
        );

        return;
    }

    if (state.step === 5) {
        /*
           Этот шаг используется только для
           ручного ввода гражданства «Другое».
        */

        if (!text) {
            await editMessage(
                chatId,
                state.messageId,
                "❌ Введите гражданство:"
            );

            return;
        }

        state.data.citizenship = text;
        state.step = 6;

        await editMessage(
            chatId,
            state.messageId,
            "Введите контактный номер:",
            contactOtherKeyboard(1)
        );

        return;
    }

    if (state.step === 6) {
        const contact = validateTajikPhone(text);

        if (!contact) {
            await editMessage(
                chatId,
                state.messageId,
                "❌ Неверный номер.\n\nВведите номер в формате:\n+992XXXXXXXXX\n\nИли выберите «🌍 Другое».",
                contactOtherKeyboard(1)
            );

            return;
        }

        state.data.contact1 = contact;

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
   CONTACT MENU
========================================================= */

async function showContactMenu(chatId, state) {
    await editMessage(
        chatId,
        state.messageId,
        `📱 Контакт 1: ${state.data.contact1 || "—"}\n` +
        `📱 Контакт 2: ${state.data.contact2 || "не указан"}\n\n` +
        `Что сделать?`,
        contactsMenuKeyboard()
    );
}

/* =========================================================
   CALLBACK HANDLER
========================================================= */

async function handleCallbackQuery(callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    const data = callbackQuery.data;

    const state = getState(chatId);

    state.messageId = messageId;

    await answerCallbackQuery(
        callbackQuery.id
    );

    console.log(
        `🔘 Callback от ${chatId}: ${data}`
    );

    /* =====================================================
       MAIN MENU
    ===================================================== */

    if (data === "main_menu") {
        userStates.set(chatId, createState());

        const newState = getState(chatId);
        newState.messageId = messageId;

        await showMainMenu(
            chatId,
            newState
        );

        return;
    }

    if (data === "main_add_passenger") {
        const newState = createState();

        userStates.set(chatId, newState);

        newState.messageId = messageId;

        await editMessage(
            chatId,
            messageId,
            QUESTIONS[0]
        );

        return;
    }

    /* =====================================================
       PLACEHOLDER MENUS
    ===================================================== */

    if (data === "main_view_data") {
        await editMessage(
            chatId,
            messageId,
            "👤 Посмотреть данные\n\nФункция будет добавлена позже.",
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
            "🔎 Найти пассажира\n\nФункция будет добавлена позже.",
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
            "✈️ Пассажиры рейса\n\nФункция будет добавлена позже.",
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
            "📊 Статистика\n\nФункция будет добавлена позже.",
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

    /* =====================================================
       CALENDAR - NOOP
    ===================================================== */

    if (data === "calendar_noop") {
        return;
    }

    /* =====================================================
       CALENDAR YEAR PAGE
    ===================================================== */

    if (data.startsWith("cal_year_page_")) {
        const parts = data.split("_");

        const type = parts[3];
        const page = Number(parts[4]);

        state.calendarType = type;
        state.calendarPage = page;

        await editMessage(
            chatId,
            messageId,
            getCalendarTitle(type, "year"),
            calendarYearsKeyboard(type, page)
        );

        return;
    }

    /* =====================================================
       CALENDAR YEAR
    ===================================================== */

    if (data.startsWith("cal_year_")) {
        const parts = data.split("_");

        const type = parts[2];
        const year = Number(parts[3]);

        state.calendarType = type;
        state.calendarYear = year;

        await showCalendarMonths(
            chatId,
            state,
            type,
            year
        );

        return;
    }

    /* =====================================================
       CALENDAR BACK YEAR
    ===================================================== */

    if (data.startsWith("cal_back_year_")) {
        const type = data.substring(
            "cal_back_year_".length
        );

        await editMessage(
            chatId,
            messageId,
            getCalendarTitle(type, "year"),
            calendarYearsKeyboard(type, 0)
        );

        return;
    }

    /* =====================================================
       CALENDAR MONTH
    ===================================================== */

    if (data.startsWith("cal_month_")) {
        const parts = data.split("_");

        const type = parts[2];
        const year = Number(parts[3]);
        const month = Number(parts[4]);

        state.calendarType = type;
        state.calendarYear = year;
        state.calendarMonth = month;

        await showCalendarDays(
            chatId,
            state,
            type,
            year,
            month
        );

        return;
    }

    /* =====================================================
       CALENDAR BACK MONTH
    ===================================================== */

    if (data.startsWith("cal_back_month_")) {
        const parts = data.split("_");

        const type = parts[3];
        const year = Number(parts[4]);

        await showCalendarMonths(
            chatId,
            state,
            type,
            year
        );

        return;
    }

    /* =====================================================
       CALENDAR DAY
    ===================================================== */

    if (data.startsWith("cal_day_")) {
        const parts = data.split("_");

        const type = parts[2];
        const year = Number(parts[3]);
        const month = Number(parts[4]);
        const day = Number(parts[5]);

        const dateString =
            `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

        const baseType = getBaseCalendarType(type);

        /* ---------------------------------------------
           Рождение — регистрация
        --------------------------------------------- */

        if (baseType === "birth" && type === "birth") {
            state.data.birthDate = dateString;
            state.step = 4;

            await editMessage(
                chatId,
                messageId,
                "Введите номер паспорта:"
            );

            return;
        }

        /* ---------------------------------------------
           Рождение — редактирование
        --------------------------------------------- */

        if (
            baseType === "birth" &&
            type === "birth_edit"
        ) {
            state.data.birthDate = dateString;

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

        /* ---------------------------------------------
           Рейс — регистрация
        --------------------------------------------- */

        if (
            baseType === "flight" &&
            type === "flight"
        ) {
            state.data.flightDate = dateString;
            state.step = 8;

            await editMessage(
                chatId,
                messageId,
                "Выберите маршрут:",
                routeKeyboard()
            );

            return;
        }

        /* ---------------------------------------------
           Рейс — редактирование
        --------------------------------------------- */

        if (
            baseType === "flight" &&
            type === "flight_edit"
        ) {
            const route = state.data.route;
            const status = state.data.status;

            if (
                route &&
                status !== "Отменен"
            ) {
                const capacity = await checkCapacity(
                    dateString,
                    route,
                    state.rowNumber
                );

                if (!capacity.available) {
                    await editMessage(
                        chatId,
                        messageId,
                        `❌ На дату ${dateString} по маршруту ${route} свободных мест нет.\n\n` +
                        `Занято: ${capacity.occupancy}/${CAPACITY}`,
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

            state.data.flightDate = dateString;

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

        return;
    }

    /* =====================================================
       CITIZENSHIP OTHER
       ВАЖНО: ДО generic citizenship_
    ===================================================== */

    if (data === "citizenship_other") {
        state.step = 5;

        await editMessage(
            chatId,
            messageId,
            "🌍 Введите гражданство:"
        );

        return;
    }

    /* =====================================================
       CITIZENSHIP
    ===================================================== */

    if (data.startsWith("citizenship_")) {
        const citizenship =
            data.replace(
                "citizenship_",
                ""
            );

        state.data.citizenship = citizenship;
        state.step = 6;

        await editMessage(
            chatId,
            messageId,
            "Введите контактный номер:",
            contactOtherKeyboard(1)
        );

        return;
    }

    /* =====================================================
       CONTACT 1 OTHER
    ===================================================== */

    if (data === "contact1_other") {
        state.editingField = "contact1_other";

        await editMessage(
            chatId,
            messageId,
            "🌍 Введите контакт в любом формате:"
        );

        return;
    }

    /* =====================================================
       CONTACT 2 OTHER
    ===================================================== */

    if (data === "contact2_other") {
        state.editingField = "contact2_other";

        await editMessage(
            chatId,
            messageId,
            "🌍 Введите второй контакт в любом формате:"
        );

        return;
    }

    /* =====================================================
       ADD CONTACT 2
    ===================================================== */

    if (data === "add_contact2") {
        state.editingField = "new_contact2";

        await editMessage(
            chatId,
            messageId,
            "Введите второй контактный номер:",
            {
                inline_keyboard: [
                    [
                        {
                            text: "🌍 Другое",
                            callback_data: "contact2_other"
                        }
                    ]
                ]
            }
        );

        return;
    }

    /* =====================================================
       CONTACTS CONTINUE
    ===================================================== */

    if (data === "contacts_continue") {
        state.editingField = null;
        state.step = 7;

        await showCalendar(
            chatId,
            state,
            "flight"
        );

        return;
    }

    /* =====================================================
       ROUTE EDIT / NEW
    ===================================================== */

    if (
        data.startsWith("route_") &&
        state.editingField !== "route"
    ) {
        const routeCode =
            data.replace("route_", "");

        const routeObject = ROUTES.find(
            route => route.code === routeCode
        );

        if (!routeObject) {
            return;
        }

        const route = routeObject.title;

        const capacity = await checkCapacity(
            state.data.flightDate,
            route
        );

        if (
            state.data.status !== "Отменен" &&
            !capacity.available
        ) {
            await editMessage(
                chatId,
                messageId,
                `❌ На ${state.data.flightDate} по маршруту ${route} мест нет.\n\n` +
                `Занято: ${capacity.occupancy}/${CAPACITY}`
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

    /* =====================================================
       STATUS NEW
    ===================================================== */

    if (
        data.startsWith("status_") &&
        state.editingField !== "status"
    ) {
        const status =
            data.replace("status_", "");

        if (
            status !== "Отменен"
        ) {
            const capacity = await checkCapacity(
                state.data.flightDate,
                state.data.route
            );

            if (!capacity.available) {
                await editMessage(
                    chatId,
                    messageId,
                    `❌ Невозможно выбрать статус.\n\n` +
                    `На ${state.data.flightDate} по маршруту ${state.data.route} ` +
                    `мест больше нет.\n\n` +
                    `Занято: ${capacity.occupancy}/${CAPACITY}`
                );

                return;
            }
        }

        state.data.status = status;

        const passengerId =
            await savePassenger(
                state.data
            );

        await editMessage(
            chatId,
            messageId,
            passengerCard(state.data),
            passengerAfterSaveKeyboard()
        );

        console.log(
            `✅ Пассажир №${passengerId} сохранён`
        );

        return;
    }

    /* =====================================================
       EDIT PASSENGER
    ===================================================== */

    if (data === "passenger_edit") {
        state.editingField = null;

        await showEditMenu(
            chatId,
            state
        );

        return;
    }

    /* =====================================================
       EDIT BACK
    ===================================================== */

    if (data === "edit_back") {
        await editMessage(
            chatId,
            messageId,
            passengerCard(state.data),
            passengerAfterSaveKeyboard()
        );

        state.editingField = null;

        return;
    }

    /* =====================================================
       EDIT TEXT FIELDS
    ===================================================== */

    const textEditFields = [
        "surname",
        "name",
        "patronymic",
        "passport"
    ];

    for (const field of textEditFields) {
        if (data === `edit_${field}`) {
            state.editingField = field;

            const names = {
                surname: "фамилию",
                name: "имя",
                patronymic: "отчество",
                passport: "номер паспорта"
            };

            await editMessage(
                chatId,
                messageId,
                `Введите ${names[field]}:`
            );

            return;
        }
    }

    /* =====================================================
       EDIT CITIZENSHIP
    ===================================================== */

    if (data === "edit_citizenship") {
        state.editingField = "citizenship";

        await editMessage(
            chatId,
            messageId,
            "Выберите гражданство:",
            editCitizenshipKeyboard()
        );

        return;
    }

    if (data === "edit_citizenship_other") {
        state.editingField = "citizenship_other";

        await editMessage(
            chatId,
            messageId,
            "🌍 Введите гражданство:"
        );

        return;
    }

    if (data === "edit_citizenship_TJ") {
        state.data.citizenship = "TJ";

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

    if (data === "edit_citizenship_RU") {
        state.data.citizenship = "RU";

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

    /* =====================================================
       EDIT CONTACT 1
    ===================================================== */

    if (data === "edit_contact1") {
        state.editingField = "contact1";

        await editMessage(
            chatId,
            messageId,
            "Введите контакт 1:",
            editContactKeyboard(1)
        );

        return;
    }

    /* =====================================================
       EDIT CONTACT 2
    ===================================================== */

    if (data === "edit_contact2") {
        state.editingField = "contact2";

        await editMessage(
            chatId,
            messageId,
            "Введите контакт 2:",
            editContactKeyboard(2)
        );

        return;
    }

    /* =====================================================
       EDIT FLIGHT DATE
    ===================================================== */

    if (data === "edit_flightDate") {
        state.editingField = "flightDate";

        await showCalendar(
            chatId,
            state,
            "flight_edit"
        );

        return;
    }

    /* =====================================================
       EDIT BIRTH DATE
    ===================================================== */

    if (data === "edit_birthDate") {
        state.editingField = "birthDate";

        await showCalendar(
            chatId,
            state,
            "birth_edit"
        );

        return;
    }

    /* =====================================================
       EDIT ROUTE
    ===================================================== */

    if (data === "edit_route") {
        state.editingField = "route";

        await editMessage(
            chatId,
            messageId,
            "Выберите новый маршрут:",
            routeKeyboard()
        );

        return;
    }

    if (
        data.startsWith("route_") &&
        state.editingField === "route"
    ) {
        const routeCode =
            data.replace("route_", "");

        const routeObject = ROUTES.find(
            route => route.code === routeCode
        );

        if (!routeObject) {
            return;
        }

        const newRoute = routeObject.title;

        if (state.data.status !== "Отменен") {
            const capacity = await checkCapacity(
                state.data.flightDate,
                newRoute,
                state.rowNumber
            );

            if (!capacity.available) {
                await editMessage(
                    chatId,
                    messageId,
                    `❌ На ${state.data.flightDate} по маршруту ${newRoute} мест нет.\n\n` +
                    `Занято: ${capacity.occupancy}/${CAPACITY}`,
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
        }

        state.data.route = newRoute;

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

    /* =====================================================
       EDIT STATUS
    ===================================================== */

    if (data === "edit_status") {
        state.editingField = "status";

        await editMessage(
            chatId,
            messageId,
            "Выберите новый статус:",
            statusKeyboard()
        );

        return;
    }

    if (
        data.startsWith("status_") &&
        state.editingField === "status"
    ) {
        const newStatus =
            data.replace("status_", "");

        if (newStatus !== "Отменен") {
            const capacity = await checkCapacity(
                state.data.flightDate,
                state.data.route,
                state.rowNumber
            );

            if (!capacity.available) {
                await editMessage(
                    chatId,
                    messageId,
                    `❌ Нельзя изменить статус.\n\n` +
                    `На ${state.data.flightDate} по маршруту ${state.data.route} мест нет.\n\n` +
                    `Занято: ${capacity.occupancy}/${CAPACITY}`,
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
        }

        state.data.status = newStatus;

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

/* =========================================================
   WEBHOOK
========================================================= */

app.post(
    "/telegram/webhook",
    async (req, res) => {
        try {
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
                    "🚫 Заблокирован запрос с неверным webhook secret"
                );

                return res.sendStatus(403);
            }

            console.log(
                "🔐 Webhook secret подтверждён"
            );

            const update = req.body;

            console.log(
                "📨 Получен update:",
                JSON.stringify(update)
            );

            res.sendStatus(200);

            if (update.message) {
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
                "❌ Ошибка обработки webhook:",
                error
            );

            if (!res.headersSent) {
                res.sendStatus(500);
            }
        }
    }
);

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get("/", (req, res) => {
    res.send(
        "KMRN Passenger Bot работает ✅"
    );
});

app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        service: "KMRN Passenger Bot"
    });
});

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
                "📡 Telegram Webhook Info:",
                JSON.stringify(
                    result.result,
                    null,
                    2
                )
            );
        } else {
            console.error(
                "❌ Не удалось получить Webhook Info:",
                result.description
            );
        }
    } catch (error) {
        console.error(
            "❌ Ошибка Webhook Info:",
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
