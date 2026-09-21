require("dotenv").config();

const express = require("express");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const PUBLIC_URL = process.env.PUBLIC_URL;

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

const userStates = {};
let cachedSheetTitle = null;

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

async function getSheetTitle() {
    if (cachedSheetTitle) {
        return cachedSheetTitle;
    }

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

async function getAllRows() {
    const sheetTitle = await getSheetTitle();

    const result = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetTitle}!A:L`
    });

    return result.data.values || [];
}

// =====================================================
// TELEGRAM API
// =====================================================

async function telegramRequest(method, data = {}) {
    const response = await fetch(
        `${TELEGRAM_API}/${method}`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(data)
        }
    );

    return await response.json();
}

async function sendMessage(chatId, text, replyMarkup = null) {
    const data = {
        chat_id: chatId,
        text
    };

    if (replyMarkup) {
        data.reply_markup = replyMarkup;
    }

    const result = await telegramRequest(
        "sendMessage",
        data
    );

    if (!result.ok) {
        console.error(
            "❌ Telegram sendMessage:",
            result.description
        );
        return null;
    }

    return result.result;
}

async function editInlineMessage(
    chatId,
    messageId,
    text,
    replyMarkup = null
) {
    const data = {
        chat_id: chatId,
        message_id: messageId,
        text
    };

    if (replyMarkup) {
        data.reply_markup = replyMarkup;
    }

    const result = await telegramRequest(
        "editMessageText",
        data
    );

    if (!result.ok) {
        console.error(
            "❌ Telegram editMessageText:",
            result.description
        );
    }

    return result;
}

async function answerCallbackQuery(callbackQueryId) {
    try {
        await telegramRequest(
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

// =====================================================
// УДАЛЕНИЕ СООБЩЕНИЯ ПОЛЬЗОВАТЕЛЯ
// =====================================================

async function deleteUserMessage(chatId, messageId) {
    if (!messageId) {
        return;
    }

    try {
        const result = await telegramRequest(
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
            "⚠️ Ошибка удаления сообщения пользователя:",
            error.message
        );
    }
}

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

    const message = await sendMessage(
        chatId,
        text,
        mainMenuKeyboard()
    );

    return message ? message.message_id : null;
}

// =====================================================
// REGISTRATION
// =====================================================

async function startPassengerRegistration(
    chatId,
    state
) {
    state.step = 0;
    state.data = {};
    state.editingField = null;
    state.calendarType = null;
    state.contactNumberBeingAdded = 1;

    const text =
        "➕ Добавление пассажира\n\n" +
        "Введите фамилию:";

    if (state.messageId) {
        const result = await editInlineMessage(
            chatId,
            state.messageId,
            text
        );

        if (result.ok) {
            return;
        }
    }

    const message = await sendMessage(
        chatId,
        text
    );

    if (message) {
        state.messageId = message.message_id;
    }
}

// =====================================================
// CALENDAR
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

function getBirthYears() {
    const currentYear = new Date().getFullYear();
    const years = [];

    for (
        let year = currentYear;
        year >= 1940;
        year--
    ) {
        years.push(year);
    }

    return years;
}

function getFlightYears() {
    const currentYear = new Date().getFullYear();
    const years = [];

    for (
        let year = currentYear;
        year <= currentYear + 5;
        year++
    ) {
        years.push(year);
    }

    return years;
}

function chunkArray(array, size) {
    const result = [];

    for (let i = 0; i < array.length; i += size) {
        result.push(array.slice(i, i + size));
    }

    return result;
}

function calendarYearsKeyboard(type, page = 0) {
    const years =
        getBaseCalendarType(type) === "birth"
            ? getBirthYears()
            : getFlightYears();

    const pageSize = 12;

    const pages = Math.ceil(
        years.length / pageSize
    );

    const currentPage =
        Math.max(0, Math.min(page, pages - 1));

    const pageYears = years.slice(
        currentPage * pageSize,
        currentPage * pageSize + pageSize
    );

    const rows = [];

    for (
        let i = 0;
        i < pageYears.length;
        i += 3
    ) {
        rows.push(
            pageYears
                .slice(i, i + 3)
                .map((year) => ({
                    text: String(year),
                    callback_data:
                        `calendar_year_${type}_${year}`
                }))
        );
    }

    const navigation = [];

    if (currentPage > 0) {
        navigation.push({
            text: "⬅️ Назад",
            callback_data:
                `calendar_year_page_${type}_${currentPage - 1}`
        });
    }

    if (currentPage < pages - 1) {
        navigation.push({
            text: "➡️ Далее",
            callback_data:
                `calendar_year_page_${type}_${currentPage + 1}`
        });
    }

    if (navigation.length) {
        rows.push(navigation);
    }

    return {
        inline_keyboard: rows
    };
}

function calendarMonthsKeyboard(type, year) {
    const rows = [];

    for (let i = 0; i < 12; i += 3) {
        rows.push(
            [0, 1, 2]
                .map((offset) => {
                    const monthIndex = i + offset;

                    return {
                        text: MONTHS[monthIndex],
                        callback_data:
                            `calendar_month_${type}_${year}_${monthIndex}`
                    };
                })
        );
    }

    rows.push([
        {
            text: "⬅️ Назад к годам",
            callback_data:
                `calendar_back_year_${type}`
        }
    ]);

    return {
        inline_keyboard: rows
    };
}

function daysInMonth(year, month) {
    return new Date(
        year,
        month + 1,
        0
    ).getDate();
}

function calendarDaysKeyboard(type, year, month) {
    const rows = [];

    rows.push(
        WEEKDAYS.map((day) => ({
            text: day,
            callback_data: "calendar_noop"
        }))
    );

    const firstDay = new Date(
        year,
        month,
        1
    ).getDay();

    const mondayIndex =
        firstDay === 0
            ? 6
            : firstDay - 1;

    const totalDays =
        daysInMonth(year, month);

    let row = [];

    for (let i = 0; i < mondayIndex; i++) {
        row.push({
            text: " ",
            callback_data: "calendar_noop"
        });
    }

    for (
        let day = 1;
        day <= totalDays;
        day++
    ) {
        row.push({
            text: String(day),
            callback_data:
                `calendar_day_${type}_${year}_${month}_${day}`
        });

        if (row.length === 7) {
            rows.push(row);
            row = [];
        }
    }

    if (row.length) {
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
            text: "⬅️ Назад к месяцам",
            callback_data:
                `calendar_back_month_${type}_${year}`
        }
    ]);

    return {
        inline_keyboard: rows
    };
}

async function showBirthCalendar(
    chatId,
    state,
    type = "birth"
) {
    state.calendarType = type;
    state.calendarPage = 0;

    const title = getCalendarTitle(
        type,
        "year"
    );

    const keyboard =
        calendarYearsKeyboard(
            type,
            0
        );

    if (state.messageId) {
        await editInlineMessage(
            chatId,
            state.messageId,
            title,
            keyboard
        );
    }
}

async function showFlightCalendar(
    chatId,
    state,
    type = "flight"
) {
    state.calendarType = type;
    state.calendarPage = 0;

    const title = getCalendarTitle(
        type,
        "year"
    );

    const keyboard =
        calendarYearsKeyboard(
            type,
            0
        );

    if (state.messageId) {
        await editInlineMessage(
            chatId,
            state.messageId,
            title,
            keyboard
        );
    }
}

// =====================================================
// CONTACTS
// =====================================================

function contactsKeyboard() {
    return {
        inline_keyboard: [
            [
                {
                    text: "➕ Добавить ещё один номер",
                    callback_data:
                        "add_second_contact"
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

async function showContactMenu(
    chatId,
    state
) {
    let text =
        "📱 Контакты\n\n" +
        `Контакт 1: ${
            state.data.contact1 || "—"
        }\n` +
        `Контакт 2: ${
            state.data.contact2 || "—"
        }\n\n` +
        "Выберите действие:";

    await editInlineMessage(
        chatId,
        state.messageId,
        text,
        contactsKeyboard()
    );
}

// =====================================================
// ROUTES
// =====================================================

const ROUTES = [
    "ДШБ — ХРГ",
    "ХРГ — ДШБ"
];

function routeKeyboard() {
    return {
        inline_keyboard: [
            ROUTES.map((route, index) => ({
                text: route,
                callback_data:
                    `route_${index}`
            }))
        ]
    };
}

async function showRouteSelection(
    chatId,
    state
) {
    await editInlineMessage(
        chatId,
        state.messageId,
        "✈️ Выберите маршрут:",
        routeKeyboard()
    );
}

// =====================================================
// STATUS
// =====================================================

function statusKeyboard() {
    return {
        inline_keyboard: [
            [
                {
                    text: "✅ Подтвержден",
                    callback_data:
                        "status_Подтвержден"
                },
                {
                    text: "❌ Отменен",
                    callback_data:
                        "status_Отменен"
                }
            ]
        ]
    };
}

async function showStatusSelection(
    chatId,
    state
) {
    await editInlineMessage(
        chatId,
        state.messageId,
        "📌 Выберите статус:",
        statusKeyboard()
    );
}

// =====================================================
// PASSENGER CARD
// =====================================================

function formatPassengerCard(data) {
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

function passengerCardKeyboard() {
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
                        "main_menu"
                }
            ]
        ]
    };
}

async function showPassengerCard(
    chatId,
    state
) {
    await editInlineMessage(
        chatId,
        state.messageId,
        formatPassengerCard(
            state.data
        ),
        passengerCardKeyboard()
    );
}

// =====================================================
// CAPACITY
// =====================================================

async function calculateRouteOccupancy(
    flightDate,
    route
) {
    const rows = await getAllRows();

    let count = 0;

    for (let i = 1; i < rows.length; i++) {
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

// =====================================================
// SAVE PASSENGER
// =====================================================

async function savePassenger(
    data
) {
    const sheetTitle =
        await getSheetTitle();

    const rows =
        await getAllRows();

    let maxId = 0;

    for (let i = 1; i < rows.length; i++) {
        const id =
            parseInt(rows[i][0], 10);

        if (!isNaN(id) && id > maxId) {
            maxId = id;
        }
    }

    const passengerId =
        maxId + 1;

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

    await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetTitle}!A${rowNumber}:L${rowNumber}`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
            values: [values]
        }
    });
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
                },
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
                },
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
                },
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
                },
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
                        "back_passenger_card"
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
        "✏️ Что хотите изменить?",
        editMenuKeyboard()
    );
}

// =====================================================
// TEXT MESSAGE HANDLER
// =====================================================

async function handleTextMessage(message) {
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

    console.log(
        `📩 Получено сообщение от ${chatId}: ${text}`
    );

    // ---------------------------------------------
    // START
    // ---------------------------------------------

    if (
        text === "/start" ||
        text.startsWith("/start ")
    ) {
        console.log(
            `🚀 Запуск бота для ${chatId}`
        );

        userStates[chatId] =
            createState();

        const messageId =
            await showMainMenu(
                chatId
            );

        if (messageId) {
            userStates[chatId].messageId =
                messageId;

            console.log(
                `✅ Главное меню отправлено. messageId=${messageId}`
            );
        } else {
            console.error(
                "❌ Не удалось отправить главное меню"
            );
        }

        return;
    }

    const state =
        userStates[chatId];

    if (!state) {
        console.log(
            `⚠️ Нет состояния для пользователя ${chatId}`
        );

        await sendMessage(
            chatId,
            "Пожалуйста, нажмите /start"
        );

        return;
    }

    // ---------------------------------------------
    // УДАЛЯЕМ ТЕКСТ ПОЛЬЗОВАТЕЛЯ
    // ---------------------------------------------

    await deleteUserMessage(
        chatId,
        message.message_id
    );

    // ---------------------------------------------
    // РЕДАКТИРОВАНИЕ ТЕКСТОВЫХ ПОЛЕЙ
    // ---------------------------------------------

    if (state.editingField) {
        const field =
            state.editingField;

        let value = text;

        if (
            field === "contact1" ||
            field === "contact2"
        ) {
            value =
                validateTajikPhone(
                    text
                );

            if (!value) {
                await editInlineMessage(
                    chatId,
                    state.messageId,
                    "❌ Неверный номер.\n\n" +
                    "Введите номер в формате:\n" +
                    "+992XXXXXXXXX"
                );

                return;
            }
        }

        if (
            field === "surname" ||
            field === "name"
        ) {
            if (!value) {
                return;
            }
        }

        state.data[field] =
            value;

        await updatePassenger(
            state.rowNumber,
            state.data
        );

        state.editingField =
            null;

        await showPassengerCard(
            chatId,
            state
        );

        return;
    }

    // ---------------------------------------------
    // ОБЫЧНАЯ РЕГИСТРАЦИЯ
    // ---------------------------------------------

    switch (state.step) {
        case 0:
            state.data.surname =
                text;

            state.step = 1;

            await editInlineMessage(
                chatId,
                state.messageId,
                "Введите имя:"
            );

            break;

        case 1:
            state.data.name =
                text;

            state.step = 2;

            await editInlineMessage(
                chatId,
                state.messageId,
                "Введите отчество:"
            );

            break;

        case 2:
            state.data.patronymic =
                text;

            state.step = 3;

            await showBirthCalendar(
                chatId,
                state,
                "birth"
            );

            break;

        case 4:
            state.data.passport =
                text;

            state.step = 5;

            await editInlineMessage(
                chatId,
                state.messageId,
                "🌍 Выберите гражданство:",
                {
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
                        ]
                    ]
                }
            );

            break;

        case 6: {
            const phone =
                validateTajikPhone(
                    text
                );

            if (!phone) {
                await editInlineMessage(
                    chatId,
                    state.messageId,
                    "❌ Неверный номер.\n\n" +
                    "Введите номер в формате:\n" +
                    "+992XXXXXXXXX"
                );

                return;
            }

            if (
                state.contactNumberBeingAdded ===
                2
            ) {
                state.data.contact2 =
                    phone;

                state.contactNumberBeingAdded =
                    1;

                await showContactMenu(
                    chatId,
                    state
                );
            } else {
                state.data.contact1 =
                    phone;

                await showContactMenu(
                    chatId,
                    state
                );
            }

            break;
        }

        default:
            break;
    }
}

// =====================================================
// CALLBACK HANDLER
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

    const state =
        userStates[chatId] ||
        createState();

    state.messageId =
        messageId;

    userStates[chatId] =
        state;

    answerCallbackQuery(
        callbackQuery.id
    );

    console.log(
        `🔘 Callback ${chatId}: ${data}`
    );

    // =================================================
    // MAIN MENU
    // =================================================

    if (data === "main_menu") {
        userStates[chatId] =
            createState();

        userStates[chatId].messageId =
            messageId;

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
        data === "main_add_passenger"
    ) {
        await startPassengerRegistration(
            chatId,
            state
        );

        return;
    }

    // =================================================
    // PLACEHOLDERS
    // =================================================

    if (
        data === "main_view_data"
    ) {
        await editInlineMessage(
            chatId,
            messageId,
            "👤 Посмотреть данные\n\n" +
            "Функция пока находится в разработке.",
            {
                inline_keyboard: [
                    [
                        {
                            text: "🏠 Главное меню",
                            callback_data:
                                "main_menu"
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
            "🔎 Найти пассажира\n\n" +
            "Функция пока находится в разработке.",
            {
                inline_keyboard: [
                    [
                        {
                            text: "🏠 Главное меню",
                            callback_data:
                                "main_menu"
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
            "✈️ Пассажиры рейса\n\n" +
            "Функция пока находится в разработке.",
            {
                inline_keyboard: [
                    [
                        {
                            text: "🏠 Главное меню",
                            callback_data:
                                "main_menu"
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
            "📊 Статистика\n\n" +
            "Функция пока находится в разработке.",
            {
                inline_keyboard: [
                    [
                        {
                            text: "🏠 Главное меню",
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
    // BIRTH CALENDAR
    // =================================================

    if (
        data.startsWith(
            "calendar_year_page_"
        )
    ) {
        const parts =
            data.split("_");

        const type =
            parts[3];

        const page =
            parseInt(parts[4], 10);

        state.calendarType =
            type;

        state.calendarPage =
            page;

        await editInlineMessage(
            chatId,
            messageId,
            getCalendarTitle(
                type,
                "year"
            ),
            calendarYearsKeyboard(
                type,
                page
            )
        );

        return;
    }

    if (
        data.startsWith(
            "calendar_year_"
        )
    ) {
        const parts =
            data.split("_");

        const type =
            parts[2];

        const year =
            parseInt(parts[3], 10);

        state.calendarType =
            type;

        state.calendarYear =
            year;

        await editInlineMessage(
            chatId,
            messageId,
            getCalendarTitle(
                type,
                "month"
            ),
            calendarMonthsKeyboard(
                type,
                year
            )
        );

        return;
    }

    if (
        data.startsWith(
            "calendar_month_"
        )
    ) {
        const parts =
            data.split("_");

        const type =
            parts[2];

        const year =
            parseInt(parts[3], 10);

        const month =
            parseInt(parts[4], 10);

        state.calendarType =
            type;

        state.calendarYear =
            year;

        state.calendarMonth =
            month;

        await editInlineMessage(
            chatId,
            messageId,
            getCalendarTitle(
                type,
                "day"
            ),
            calendarDaysKeyboard(
                type,
                year,
                month
            )
        );

        return;
    }

    if (
        data.startsWith(
            "calendar_day_"
        )
    ) {
        const parts =
            data.split("_");

        const type =
            parts[2];

        const year =
            parseInt(parts[3], 10);

        const month =
            parseInt(parts[4], 10);

        const day =
            parseInt(parts[5], 10);

        const date = new Date(
            year,
            month,
            day
        );

        const formatted =
            `${String(day).padStart(2, "0")}.${String(month + 1).padStart(2, "0")}.${year}`;

        const baseType =
            getBaseCalendarType(
                type
            );

        // -------------------------------
        // ДАТА РОЖДЕНИЯ
        // -------------------------------

        if (baseType === "birth") {
            const today =
                new Date();

            today.setHours(
                0,
                0,
                0,
                0
            );

            if (date > today) {
                await editInlineMessage(
                    chatId,
                    messageId,
                    "❌ Дата рождения не может быть в будущем."
                );

                return;
            }

            state.data.birthDate =
                formatted;

            state.step = 4;

            await editInlineMessage(
                chatId,
                messageId,
                "Введите номер паспорта:"
            );

            return;
        }

        // -------------------------------
        // ДАТА РЕЙСА
        // -------------------------------

        if (baseType === "flight") {
            state.data.flightDate =
                formatted;

            state.step = 8;

            await showRouteSelection(
                chatId,
                state
            );

            return;
        }

        return;
    }

    if (
        data.startsWith(
            "calendar_back_year_"
        )
    ) {
        const type =
            data.replace(
                "calendar_back_year_",
                ""
            );

        await editInlineMessage(
            chatId,
            messageId,
            getCalendarTitle(
                type,
                "year"
            ),
            calendarYearsKeyboard(
                type,
                0
            )
        );

        return;
    }

    if (
        data.startsWith(
            "calendar_back_month_"
        )
    ) {
        const parts =
            data.split("_");

        const type =
            parts[3];

        const year =
            parseInt(parts[4], 10);

        await editInlineMessage(
            chatId,
            messageId,
            getCalendarTitle(
                type,
                "month"
            ),
            calendarMonthsKeyboard(
                type,
                year
            )
        );

        return;
    }

    if (
        data === "calendar_noop"
    ) {
        return;
    }

    // =================================================
    // CITIZENSHIP
    // =================================================

    if (
        data.startsWith(
            "citizenship_"
        )
    ) {
        const citizenship =
            data.replace(
                "citizenship_",
                ""
            );

        state.data.citizenship =
            citizenship;

        state.step = 6;

        state.contactNumberBeingAdded =
            1;

        await editInlineMessage(
            chatId,
            messageId,
            "📱 Введите контактный номер:\n\n" +
            "Формат: +992XXXXXXXXX"
        );

        return;
    }

    // =================================================
    // CONTACTS
    // =================================================

    if (
        data === "add_second_contact"
    ) {
        state.contactNumberBeingAdded =
            2;

        await editInlineMessage(
            chatId,
            messageId,
            "📱 Введите второй контактный номер:\n\n" +
            "Формат: +992XXXXXXXXX"
        );

        return;
    }

    if (
        data === "contacts_continue"
    ) {
        state.step = 7;

        await showFlightCalendar(
            chatId,
            state,
            "flight"
        );

        return;
    }

    // =================================================
    // ROUTE
    // =================================================

    if (
        data.startsWith(
            "route_"
        )
    ) {
        const index =
            parseInt(
                data.replace(
                    "route_",
                    ""
                ),
                10
            );

        if (
            !ROUTES[index]
        ) {
            return;
        }

        state.data.route =
            ROUTES[index];

        state.step = 9;

        await showStatusSelection(
            chatId,
            state
        );

        return;
    }

    // =================================================
    // STATUS
    // =================================================

    if (
        data.startsWith(
            "status_"
        )
    ) {
        const status =
            data.replace(
                "status_",
                ""
            );

        state.data.status =
            status;

        // Проверяем вместимость
        const occupancy =
            await calculateRouteOccupancy(
                state.data.flightDate,
                state.data.route
            );

        const capacity = 19;

        if (
            status !== "Отменен" &&
            occupancy >= capacity
        ) {
            await editInlineMessage(
                chatId,
                messageId,
                "❌ На данный рейс уже зарегистрировано максимальное количество пассажиров.\n\n" +
                `Вместимость: ${capacity}\n` +
                `Занято: ${occupancy}`,
                {
                    inline_keyboard: [
                        [
                            {
                                text: "🏠 Главное меню",
                                callback_data:
                                    "main_menu"
                            }
                        ]
                    ]
                }
            );

            return;
        }

        await savePassenger(
            state.data
        );

        await showPassengerCard(
            chatId,
            state
        );

        return;
    }

    // =================================================
    // EDIT PASSENGER
    // =================================================

    if (
        data === "edit_passenger"
    ) {
        await showEditMenu(
            chatId,
            state
        );

        return;
    }

    // =================================================
    // EDIT TEXT FIELD
    // =================================================

    if (
        data.startsWith(
            "edit_field_"
        )
    ) {
        const field =
            data.replace(
                "edit_field_",
                ""
            );

        state.editingField =
            field;

        const titles = {
            surname:
                "Введите новую фамилию:",
            name:
                "Введите новое имя:",
            patronymic:
                "Введите новое отчество:",
            passport:
                "Введите новый номер паспорта:",
            contact1:
                "📱 Введите новый контакт 1:\n\nФормат: +992XXXXXXXXX",
            contact2:
                "📱 Введите новый контакт 2:\n\nФормат: +992XXXXXXXXX"
        };

        if (
            titles[field]
        ) {
            await editInlineMessage(
                chatId,
                messageId,
                titles[field]
            );

            return;
        }

        // -------------------------------
        // BIRTH DATE EDIT
        // -------------------------------

        if (
            field === "birthDate"
        ) {
            state.calendarType =
                "birth_edit";

            await showBirthCalendar(
                chatId,
                state,
                "birth_edit"
            );

            return;
        }

        // -------------------------------
        // CITIZENSHIP EDIT
        // -------------------------------

        if (
            field === "citizenship"
        ) {
            await editInlineMessage(
                chatId,
                messageId,
                "🌍 Выберите гражданство:",
                {
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
                        ]
                    ]
                }
            );

            return;
        }

        // -------------------------------
        // FLIGHT DATE EDIT
        // -------------------------------

        if (
            field === "flightDate"
        ) {
            state.calendarType =
                "flight_edit";

            await showFlightCalendar(
                chatId,
                state,
                "flight_edit"
            );

            return;
        }

        // -------------------------------
        // ROUTE EDIT
        // -------------------------------

        if (
            field === "route"
        ) {
            await editInlineMessage(
                chatId,
                messageId,
                "✈️ Выберите маршрут:",
                routeKeyboard()
            );

            state.editingField =
                "route";

            return;
        }

        // -------------------------------
        // STATUS EDIT
        // -------------------------------

        if (
            field === "status"
        ) {
            await editInlineMessage(
                chatId,
                messageId,
                "📌 Выберите статус:",
                statusKeyboard()
            );

            state.editingField =
                "status";

            return;
        }

        return;
    }

    // =================================================
    // EDIT CITIZENSHIP
    // =================================================

    if (
        data.startsWith(
            "edit_citizenship_"
        )
    ) {
        const citizenship =
            data.replace(
                "edit_citizenship_",
                ""
            );

        state.data.citizenship =
            citizenship;

        await updatePassenger(
            state.rowNumber,
            state.data
        );

        state.editingField =
            null;

        await showPassengerCard(
            chatId,
            state
        );

        return;
    }

    // =================================================
    // EDIT ROUTE
    // =================================================

    if (
        data.startsWith(
            "route_"
        ) &&
        state.editingField === "route"
    ) {
        const index =
            parseInt(
                data.replace(
                    "route_",
                    ""
                ),
                10
            );

        if (
            !ROUTES[index]
        ) {
            return;
        }

        state.data.route =
            ROUTES[index];

        await updatePassenger(
            state.rowNumber,
            state.data
        );

        state.editingField =
            null;

        await showPassengerCard(
            chatId,
            state
        );

        return;
    }

    // =================================================
    // EDIT STATUS
    // =================================================

    if (
        data.startsWith(
            "status_"
        ) &&
        state.editingField === "status"
    ) {
        const status =
            data.replace(
                "status_",
                ""
            );

        if (
            status !== "Отменен"
        ) {
            const occupancy =
                await calculateRouteOccupancy(
                    state.data.flightDate,
                    state.data.route
                );

            const capacity = 19;

            // Текущий пассажир уже занимает одно место,
            // поэтому вычитаем его из проверки.
            let currentOccupiesSeat =
                state.data.status !== "Отменен";

            let effectiveOccupancy =
                occupancy -
                (currentOccupiesSeat
                    ? 1
                    : 0);

            if (
                effectiveOccupancy >=
                capacity
            ) {
                await editInlineMessage(
                    chatId,
                    messageId,
                    "❌ На данный рейс уже зарегистрировано максимальное количество пассажиров.\n\n" +
                    `Вместимость: ${capacity}\n` +
                    `Занято: ${occupancy}`
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

        state.editingField =
            null;

        await showPassengerCard(
            chatId,
            state
        );

        return;
    }

    // =================================================
    // BACK TO CARD
    // =================================================

    if (
        data === "back_passenger_card"
    ) {
        state.editingField =
            null;

        await showPassengerCard(
            chatId,
            state
        );

        return;
    }
}

// =====================================================
// WEBHOOK
// =====================================================

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
                "🚫 Заблокирован запрос с неверным webhook secret"
            );

            return res.sendStatus(
                403
            );
        }

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

            console.log(
                "⚠️ Update не содержит message или callback_query"
            );
        } catch (error) {
            console.error(
                "❌ Ошибка обработки Telegram update:",
                error
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
            "KMRN Passenger Bot работает ✅"
        );
    }
);

// =====================================================
// WEBHOOK SETUP
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
// WEBHOOK INFO
// =====================================================

async function getWebhookInfo() {
    try {
        const result =
            await telegramRequest(
                "getWebhookInfo"
            );

        console.log(
            "🌐 Telegram Webhook Info:",
            JSON.stringify(
                result,
                null,
                2
            )
        );
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

app.listen(
    PORT,
    async () => {
        console.log(
            `🚀 KMRN Passenger Bot запущен на порту ${PORT}`
        );

        try {
            await getSheetTitle();

            console.log(
                "📊 Google Sheets подключён"
            );
        } catch (error) {
            console.error(
                "❌ Ошибка подключения Google Sheets:",
                error.message
            );
        }

        await setupWebhook();
        await getWebhookInfo();
    }
);
