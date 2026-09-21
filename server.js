const express = require("express");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

const TELEGRAM_BOT_TOKEN =
    process.env.TELEGRAM_BOT_TOKEN;

const GOOGLE_CLIENT_EMAIL =
    process.env.GOOGLE_CLIENT_EMAIL;

const GOOGLE_PRIVATE_KEY =
    process.env.GOOGLE_PRIVATE_KEY;

const SPREADSHEET_ID =
    process.env.GOOGLE_SHEET_ID;

const TELEGRAM_WEBHOOK_SECRET =
    process.env.TELEGRAM_WEBHOOK_SECRET;

const PUBLIC_URL =
    process.env.PUBLIC_URL;

const MAX_SEATS = 19;

// ======================================================
// GOOGLE SHEETS
// ======================================================

const auth = new google.auth.GoogleAuth({
    credentials: {
        client_email:
            GOOGLE_CLIENT_EMAIL,

        private_key:
            GOOGLE_PRIVATE_KEY
                ? GOOGLE_PRIVATE_KEY.replace(
                    /\\n/g,
                    "\n"
                )
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

// ======================================================
// TELEGRAM REQUEST
// ======================================================

async function telegramRequest(
    method,
    body = {}
) {
    const response = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`,
        {
            method: "POST",

            headers: {
                "Content-Type":
                    "application/json"
            },

            body: JSON.stringify(body)
        }
    );

    return await response.json();
}

// ======================================================
// TELEGRAM MESSAGES
// ======================================================

async function sendMessage(
    chatId,
    text
) {
    return await telegramRequest(
        "sendMessage",
        {
            chat_id: chatId,
            text
        }
    );
}

async function sendInlineMessage(
    chatId,
    text,
    keyboard
) {
    return await telegramRequest(
        "sendMessage",
        {
            chat_id: chatId,
            text,

            reply_markup: {
                inline_keyboard:
                    keyboard
            }
        }
    );
}

async function editInlineMessage(
    chatId,
    messageId,
    text,
    keyboard
) {
    return await telegramRequest(
        "editMessageText",
        {
            chat_id: chatId,
            message_id: messageId,
            text,

            reply_markup: {
                inline_keyboard:
                    keyboard
            }
        }
    );
}

async function answerCallbackQuery(
    callbackQueryId
) {
    return await telegramRequest(
        "answerCallbackQuery",
        {
            callback_query_id:
                callbackQueryId
        }
    );
}

// ======================================================
// USER STATES
// ======================================================

const userStates = {};

// ======================================================
// MAIN MENU
// ======================================================

async function showMainMenu(
    chatId
) {
    const keyboard = [
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
    ];

    await sendInlineMessage(
        chatId,
        "🏠 Главное меню",
        keyboard
    );
}

// ======================================================
// START REGISTRATION
// ======================================================

async function startPassengerRegistration(
    chatId
) {
    userStates[chatId] = {
        step: 0,

        data: {},

        calendarType: null,

        calendarPage: 0,

        editingField: null,

        rowNumber: null
    };

    await sendMessage(
        chatId,
        "Введите фамилию:"
    );
}

// ======================================================
// GOOGLE SHEETS DATA
// ======================================================

async function getSheetData() {
    const spreadsheet =
        await sheets.spreadsheets.get({
            spreadsheetId:
                SPREADSHEET_ID
        });

    const firstSheet =
        spreadsheet.data.sheets[0];

    if (!firstSheet) {
        throw new Error(
            "В таблице нет листов"
        );
    }

    const sheetTitle =
        firstSheet.properties.title;

    const response =
        await sheets.spreadsheets.values.get(
            {
                spreadsheetId:
                    SPREADSHEET_ID,

                range:
                    `${sheetTitle}!A:J`
            }
        );

    return {
        sheetTitle,

        values:
            response.data.values || []
    };
}

// ======================================================
// SAVE PASSENGER
// ======================================================

async function savePassenger(
    data
) {
    const spreadsheet =
        await sheets.spreadsheets.get({
            spreadsheetId:
                SPREADSHEET_ID
        });

    const firstSheet =
        spreadsheet.data.sheets[0];

    if (!firstSheet) {
        throw new Error(
            "В таблице нет листов"
        );
    }

    const sheetTitle =
        firstSheet.properties.title;

    const passengerId =
        "P" +
        Date.now()
            .toString()
            .slice(-8);

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

    const result =
        await sheets.spreadsheets.values.append(
            {
                spreadsheetId:
                    SPREADSHEET_ID,

                range:
                    `${sheetTitle}!A:J`,

                valueInputOption:
                    "USER_ENTERED",

                insertDataOption:
                    "INSERT_ROWS",

                requestBody: {
                    values: [values]
                }
            }
        );

    let rowNumber = null;

    if (
        result.data &&
        result.data.updates &&
        result.data.updates.updatedRange
    ) {
        const match =
            result.data.updates.updatedRange.match(
                /![A-Z]+(\d+):/
            );

        if (match) {
            rowNumber =
                Number(match[1]);
        }
    }

    return {
        passengerId,

        rowNumber
    };
}

// ======================================================
// UPDATE PASSENGER
// ======================================================

async function updatePassenger(
    rowNumber,
    data
) {
    if (!rowNumber) {
        throw new Error(
            "Не найден номер строки пассажира"
        );
    }

    const spreadsheet =
        await sheets.spreadsheets.get({
            spreadsheetId:
                SPREADSHEET_ID
        });

    const firstSheet =
        spreadsheet.data.sheets[0];

    if (!firstSheet) {
        throw new Error(
            "В таблице нет листов"
        );
    }

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

    await sheets.spreadsheets.values.update(
        {
            spreadsheetId:
                SPREADSHEET_ID,

            range:
                `${sheetTitle}!A${rowNumber}:J${rowNumber}`,

            valueInputOption:
                "USER_ENTERED",

            requestBody: {
                values: [values]
            }
        }
    );
}

// ======================================================
// ROUTE OCCUPANCY
// ======================================================

async function getRouteOccupancy(
    flightDate,
    route,
    excludeRowNumber = null
) {
    const { values } =
        await getSheetData();

    let count = 0;

    for (
        let i = 1;
        i < values.length;
        i++
    ) {
        const row =
            values[i];

        const rowNumber =
            i + 1;

        if (
            excludeRowNumber &&
            rowNumber ===
                excludeRowNumber
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

// ======================================================
// CHECK ROUTE AVAILABILITY
// ======================================================

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

    return {
        occupied,

        free:
            Math.max(
                0,
                MAX_SEATS -
                    occupied
            ),

        available:
            occupied <
            MAX_SEATS
    };
}

// ======================================================
// DATE FORMAT
// ======================================================

function formatDate(
    day,
    month,
    year
) {
    return (
        String(day).padStart(
            2,
            "0"
        ) +
        "." +
        String(month + 1).padStart(
            2,
            "0"
        ) +
        "." +
        year
    );
}

// ======================================================
// CALENDAR DATA
// ======================================================

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

// ======================================================
// CALENDAR TITLES
// ======================================================

function getCalendarTitle(
    type,
    level
) {
    if (type === "birth") {
        if (level === "year") {
            return "📅 Выберите год рождения:";
        }

        if (level === "month") {
            return "📅 Выберите месяц рождения:";
        }

        if (level === "day") {
            return "📅 Выберите день рождения:";
        }
    }

    if (type === "flight") {
        if (level === "year") {
            return "📅 Выберите год даты рейса:";
        }

        if (level === "month") {
            return "📅 Выберите месяц даты рейса:";
        }

        if (level === "day") {
            return "📅 Выберите день даты рейса:";
        }
    }

    return "📅 Выберите дату:";
}

// ======================================================
// PREVIOUS STEP BUTTON
// ======================================================

function previousStepKeyboard(
    step
) {
    if (step <= 0) {
        return [];
    }

    return [
        [
            {
                text:
                    "↩️ Изменить предыдущий шаг",

                callback_data:
                    "previous_step"
            }
        ]
    ];
}

// ======================================================
// YEARS — 12 YEARS PER PAGE
// ======================================================

async function showYears(
    chatId,
    messageId,
    type,
    page = 0
) {
    const now =
        new Date();

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
        minYear =
            currentYear;

        maxYear =
            currentYear + 5;
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
            text:
                String(year),

            callback_data:
                `calendar_year:${type}:${year}`
        });

        if (
            row.length === 3
        ) {
            keyboard.push(
                row
            );

            row = [];
        }
    }

    if (
        row.length > 0
    ) {
        keyboard.push(
            row
        );
    }

    const navigation = [];

    if (
        endYear > minYear
    ) {
        navigation.push({
            text:
                "⬅️ Старше",

            callback_data:
                `calendar_year_page:${type}:${page + 1}`
        });
    }

    if (
        page > 0
    ) {
        navigation.push({
            text:
                "➡️ Новее",

            callback_data:
                `calendar_year_page:${type}:${page - 1}`
        });
    }

    if (
        navigation.length > 0
    ) {
        keyboard.push(
            navigation
        );
    }

    keyboard.push([
        {
            text:
                "↩️ Изменить предыдущий шаг",

            callback_data:
                "previous_step"
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

// ======================================================
// MONTHS
// ======================================================

async function showMonths(
    chatId,
    messageId,
    type,
    year
) {
    const keyboard = [];

    for (
        let i = 0;
        i < 12;
        i += 3
    ) {
        const row = [];

        for (
            let j = 0;
            j < 3;
            j++
        ) {
            const month =
                i + j;

            row.push({
                text:
                    MONTHS[month],

                callback_data:
                    `calendar_month:${type}:${year}:${month}`
            });
        }

        keyboard.push(
            row
        );
    }

    keyboard.push([
        {
            text:
                "⬅️ К годам",

            callback_data:
                `calendar_back_years:${type}`
        }
    ]);

    keyboard.push([
        {
            text:
                "↩️ Изменить предыдущий шаг",

            callback_data:
                "previous_step"
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

// ======================================================
// DAYS
// ======================================================

async function showDays(
    chatId,
    messageId,
    type,
    year,
    month
) {
    const keyboard = [];

    keyboard.push(
        WEEKDAYS.map(
            day => ({
                text: day,

                callback_data:
                    "ignore"
            })
        )
    );

    const firstDay =
        new Date(
            year,
            month,
            1
        ).getDay();

    const mondayIndex =
        firstDay === 0
            ? 6
            : firstDay - 1;

    const daysInMonth =
        new Date(
            year,
            month + 1,
            0
        ).getDate();

    let row = [];

    for (
        let i = 0;
        i < mondayIndex;
        i++
    ) {
        row.push({
            text: " ",

            callback_data:
                "ignore"
        });
    }

    const today =
        new Date();

    today.setHours(
        0,
        0,
        0,
        0
    );

    for (
        let day = 1;
        day <= daysInMonth;
        day++
    ) {
        const selectedDate =
            new Date(
                year,
                month,
                day
            );

        selectedDate.setHours(
            0,
            0,
            0,
            0
        );

        let disabled =
            false;

        // Для даты рождения
        // нельзя выбрать будущее
        if (
            type === "birth" &&
            selectedDate >
                today
        ) {
            disabled = true;
        }

        if (disabled) {
            row.push({
                text: "·",

                callback_data:
                    "ignore"
            });
        } else {
            row.push({
                text:
                    String(day),

                callback_data:
                    `calendar_day:${type}:${year}:${month}:${day}`
            });
        }

        if (
            row.length === 7
        ) {
            keyboard.push(
                row
            );

            row = [];
        }
    }

    if (
        row.length > 0
    ) {
        while (
            row.length < 7
        ) {
            row.push({
                text: " ",

                callback_data:
                    "ignore"
            });
        }

        keyboard.push(
            row
        );
    }

    keyboard.push([
        {
            text:
                "⬅️ К месяцам",

            callback_data:
                `calendar_back_months:${type}:${year}`
        }
    ]);

    keyboard.push([
        {
            text:
                "↩️ Изменить предыдущий шаг",

            callback_data:
                "previous_step"
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

// ======================================================
// BIRTH CALENDAR
// ======================================================

async function showBirthCalendar(
    chatId,
    existingMessageId = null
) {
    const keyboard = [
        [
            {
                text:
                    "Загрузка...",

                callback_data:
                    "ignore"
            }
        ]
    ];

    let result;

    if (
        existingMessageId
    ) {
        result =
            await editInlineMessage(
                chatId,
                existingMessageId,

                getCalendarTitle(
                    "birth",
                    "year"
                ),

                keyboard
            );
    } else {
        result =
            await sendInlineMessage(
                chatId,

                getCalendarTitle(
                    "birth",
                    "year"
                ),

                keyboard
            );
    }

    const messageId =
        existingMessageId ||
        result.result?.message_id;

    if (messageId) {
        await showYears(
            chatId,
            messageId,
            "birth",
            0
        );
    }
}

// ======================================================
// FLIGHT CALENDAR
// ======================================================

async function showFlightCalendar(
    chatId,
    existingMessageId = null
) {
    const keyboard = [
        [
            {
                text:
                    "Загрузка...",

                callback_data:
                    "ignore"
            }
        ]
    ];

    let result;

    if (
        existingMessageId
    ) {
        result =
            await editInlineMessage(
                chatId,
                existingMessageId,

                getCalendarTitle(
                    "flight",
                    "year"
                ),

                keyboard
            );
    } else {
        result =
            await sendInlineMessage(
                chatId,

                getCalendarTitle(
                    "flight",
                    "year"
                ),

                keyboard
            );
    }

    const messageId =
        existingMessageId ||
        result.result?.message_id;

    if (messageId) {
        await showYears(
            chatId,
            messageId,
            "flight",
            0
        );
    }
}

// ======================================================
// ROUTES
// ======================================================

async function showRoutes(
    chatId,
    flightDate,
    messageId = null,
    editing = false
) {
    const routes = [
        "ДШБ — ХРГ",
        "ХРГ — ДШБ"
    ];

    const keyboard = [];

    for (
        const route of routes
    ) {
        const occupancy =
            await checkRouteAvailability(
                flightDate,
                route,

                editing
                    ? userStates[
                        chatId
                    ]?.rowNumber
                    : null
            );

        if (
            occupancy.available
        ) {
            keyboard.push([
                {
                    text:
                        `✈️ ${route} (${occupancy.occupied}/${MAX_SEATS})`,

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
                        "route_full"
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

    if (
        messageId
    ) {
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

// ======================================================
// STATUS
// ======================================================

async function showStatuses(
    chatId,
    messageId = null
) {
    const keyboard = [
        [
            {
                text:
                    "✅ Подтвержден",

                callback_data:
                    "status_select:Подтвержден"
            }
        ],

        [
            {
                text:
                    "⏳ Ожидание",

                callback_data:
                    "status_select:Ожидание"
            }
        ],

        [
            {
                text:
                    "❌ Отменен",

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

    const text =
        "📌 Выберите статус пассажира:";

    if (
        messageId
    ) {
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

// ======================================================
// PASSENGER CARD
// ======================================================

function getPassengerCard(
    data
) {
    return (
        "📋 Данные пассажира\n\n" +

        `👤 Фамилия: ${
            data.surname || "—"
        }\n` +

        `👤 Имя: ${
            data.name || "—"
        }\n` +

        `👤 Отчество: ${
            data.patronymic || "—"
        }\n` +

        `🎂 Дата рождения: ${
            data.birthDate || "—"
        }\n` +

        `🛂 Паспорт: ${
            data.passport || "—"
        }\n` +

        `🌍 Гражданство: ${
            data.citizenship || "—"
        }\n` +

        `📅 Дата рейса: ${
            data.flightDate || "—"
        }\n` +

        `✈️ Маршрут: ${
            data.route || "—"
        }\n` +

        `📌 Статус: ${
            data.status || "—"
        }`
    );
}

// ======================================================
// SAVED PASSENGER MENU
// ======================================================

async function showSavedPassenger(
    chatId,
    data
) {
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

    await sendInlineMessage(
        chatId,

        getPassengerCard(
            data
        ),

        keyboard
    );
}

// ======================================================
// EDIT MENU
// ======================================================

async function showEditMenu(
    chatId,
    messageId = null
) {
    const keyboard = [
        [
            {
                text:
                    "✏️ Фамилия",

                callback_data:
                    "edit_field:surname"
            },

            {
                text:
                    "✏️ Имя",

                callback_data:
                    "edit_field:name"
            }
        ],

        [
            {
                text:
                    "✏️ Отчество",

                callback_data:
                    "edit_field:patronymic"
            }
        ],

        [
            {
                text:
                    "✏️ Дата рождения",

                callback_data:
                    "edit_field:birthDate"
            }
        ],

        [
            {
                text:
                    "✏️ Паспорт",

                callback_data:
                    "edit_field:passport"
            }
        ],

        [
            {
                text:
                    "✏️ Гражданство",

                callback_data:
                    "edit_field:citizenship"
            }
        ],

        [
            {
                text:
                    "✏️ Дата рейса",

                callback_data:
                    "edit_field:flightDate"
            }
        ],

        [
            {
                text:
                    "✏️ Маршрут",

                callback_data:
                    "edit_field:route"
            }
        ],

        [
            {
                text:
                    "✏️ Статус",

                callback_data:
                    "edit_field:status"
            }
        ],

        [
            {
                text:
                    "↩️ Назад",

                callback_data:
                    "back_to_passenger"
            }
        ]
    ];

    const text =
        "✏️ Что хотите изменить?\n\n" +
        "Выберите нужное поле:";

    if (
        messageId
    ) {
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

// ======================================================
// FIELD NAMES
// ======================================================

function getFieldName(
    field
) {
    const names = {
        surname:
            "фамилию",

        name:
            "имя",

        patronymic:
            "отчество",

        birthDate:
            "дату рождения",

        passport:
            "номер паспорта",

        citizenship:
            "гражданство",

        flightDate:
            "дату рейса",

        route:
            "маршрут",

        status:
            "статус"
    };

    return (
        names[field] ||
        "данные"
    );
}

// ======================================================
// EDIT TEXT FIELD
// ======================================================

async function startTextEdit(
    chatId,
    field
) {
    const state =
        userStates[chatId];

    if (!state) {
        return;
    }

    state.editingField =
        field;

    const currentValue =
        state.data[field] ||
        "не указано";

    await sendMessage(
        chatId,

        `✏️ Изменение: ${getFieldName(
            field
        )}\n\n` +

        `Текущее значение: ${currentValue}\n\n` +

        "Введите новое значение:"
    );
}

// ======================================================
// PREVIOUS STEP
// ======================================================

async function goToPreviousStep(
    chatId,
    messageId = null
) {
    const state =
        userStates[chatId];

    if (!state) {
        return;
    }

    if (
        state.step <= 0
    ) {
        return;
    }

    state.step--;

    state.editingField =
        null;

    if (
        state.step === 0
    ) {
        await sendMessage(
            chatId,

            `Текущая фамилия: ${
                state.data.surname ||
                "—"
            }\n\n` +

            "Введите фамилию заново:"
        );

        return;
    }

    if (
        state.step === 1
    ) {
        await sendMessage(
            chatId,

            `Текущее имя: ${
                state.data.name ||
                "—"
            }\n\n` +

            "Введите имя заново:"
        );

        return;
    }

    if (
        state.step === 2
    ) {
        await sendMessage(
            chatId,

            `Текущее отчество: ${
                state.data.patronymic ||
                "—"
            }\n\n` +

            "Введите отчество заново:"
        );

        return;
    }

    if (
        state.step === 3
    ) {
        await showBirthCalendar(
            chatId,
            messageId
        );

        return;
    }

    if (
        state.step === 4
    ) {
        await sendMessage(
            chatId,

            `Текущий паспорт: ${
                state.data.passport ||
                "—"
            }\n\n` +

            "Введите номер паспорта заново:"
        );

        return;
    }

    if (
        state.step === 5
    ) {
        await sendMessage(
            chatId,

            `Текущее гражданство: ${
                state.data.citizenship ||
                "—"
            }\n\n` +

            "Введите гражданство заново:"
        );

        return;
    }

    if (
        state.step === 6
    ) {
        await showFlightCalendar(
            chatId,
            messageId
        );

        return;
    }

    if (
        state.step === 7
    ) {
        await showRoutes(
            chatId,

            state.data.flightDate,

            messageId
        );

        return;
    }
}

// ======================================================
// PROCESS EDITED TEXT
// ======================================================

async function processSavedTextEdit(
    chatId,
    text
) {
    const state =
        userStates[chatId];

    if (
        !state ||
        !state.editingField
    ) {
        return false;
    }

    const field =
        state.editingField;

    if (!text) {
        await sendMessage(
            chatId,

            "❌ Значение не может быть пустым.\n\n" +

            `Введите ${getFieldName(
                field
            )} ещё раз:`
        );

        return true;
    }

    state.data[field] =
        text;

    state.editingField =
        null;

    try {
        await updatePassenger(
            state.rowNumber,
            state.data
        );

        await sendMessage(
            chatId,
            "✅ Данные успешно изменены."
        );

        await showSavedPassenger(
            chatId,
            state.data
        );
    } catch (error) {
        console.error(
            "Ошибка обновления пассажира:",
            error.message
        );

        await sendMessage(
            chatId,
            "❌ Не удалось сохранить изменение."
        );
    }

    return true;
}

// ======================================================
// CALLBACK QUERY
// ======================================================

async function handleCallbackQuery(
    callbackQuery
) {
    const chatId =
        callbackQuery.message.chat.id;

    const messageId =
        callbackQuery.message.message_id;

    const data =
        callbackQuery.data || "";

    await answerCallbackQuery(
        callbackQuery.id
    );

    // ==================================================
    // MAIN MENU
    // ==================================================

    if (
        data === "main_menu"
    ) {
        delete userStates[
            chatId
        ];

        await showMainMenu(
            chatId
        );

        return;
    }

    if (
        data ===
        "main_add_passenger"
    ) {
        await startPassengerRegistration(
            chatId
        );

        return;
    }

    // ==================================================
    // OTHER MENU ITEMS
    // ==================================================

    if (
        data ===
        "main_view_data"
    ) {
        await sendMessage(
            chatId,

            "👤 Функция просмотра данных будет использоваться здесь."
        );

        return;
    }

    if (
        data ===
        "main_find_passenger"
    ) {
        await sendMessage(
            chatId,

            "🔎 Функция поиска пассажира будет использоваться здесь."
        );

        return;
    }

    if (
        data ===
        "main_flight_passengers"
    ) {
        await sendMessage(
            chatId,

            "✈️ Функция пассажиров рейса будет использоваться здесь."
        );

        return;
    }

    if (
        data ===
        "main_statistics"
    ) {
        await sendMessage(
            chatId,

            "📊 Функция статистики будет использоваться здесь."
        );

        return;
    }

    // ==================================================
    // IGNORE
    // ==================================================

    if (
        data === "ignore"
    ) {
        return;
    }

    // ==================================================
    // PREVIOUS STEP
    // ==================================================

    if (
        data === "previous_step"
    ) {
        await goToPreviousStep(
            chatId,
            messageId
        );

        return;
    }

    // ==================================================
    // EDIT PASSENGER
    // ==================================================

    if (
        data ===
        "edit_passenger"
    ) {
        const state =
            userStates[chatId];

        if (
            !state ||
            !state.rowNumber
        ) {
            await sendMessage(
                chatId,

                "❌ Данные пассажира не найдены."
            );

            return;
        }

        await showEditMenu(
            chatId,
            messageId
        );

        return;
    }

    // ==================================================
    // BACK TO PASSENGER
    // ==================================================

    if (
        data ===
        "back_to_passenger"
    ) {
        const state =
            userStates[chatId];

        if (!state) {
            await showMainMenu(
                chatId
            );

            return;
        }

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

        await editInlineMessage(
            chatId,
            messageId,

            getPassengerCard(
                state.data
            ),

            keyboard
        );

        return;
    }

    // ==================================================
    // EDIT FIELD
    // ==================================================

    if (
        data.startsWith(
            "edit_field:"
        )
    ) {
        const field =
            data.split(":")[1];

        const state =
            userStates[chatId];

        if (!state) {
            return;
        }

        if (
            field ===
            "birthDate"
        ) {
            state.editingField =
                "birthDate";

            await showBirthCalendar(
                chatId,
                messageId
            );

            return;
        }

        if (
            field ===
            "flightDate"
        ) {
            state.editingField =
                "flightDate";

            await showFlightCalendar(
                chatId,
                messageId
            );

            return;
        }

        if (
            field ===
            "route"
        ) {
            state.editingField =
                "route";

            await showRoutes(
                chatId,

                state.data.flightDate,

                messageId,

                true
            );

            return;
        }

        if (
            field ===
            "status"
        ) {
            state.editingField =
                "status";

            await showStatuses(
                chatId,
                messageId
            );

            return;
        }

        await startTextEdit(
            chatId,
            field
        );

        return;
    }

    // ==================================================
    // YEAR PAGE
    // ==================================================

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

        await showYears(
            chatId,
            messageId,
            type,
            page
        );

        return;
    }

    // ==================================================
    // YEAR
    // ==================================================

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

        await showMonths(
            chatId,
            messageId,
            type,
            year
        );

        return;
    }

    // ==================================================
    // BACK TO YEARS
    // ==================================================

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
            0
        );

        return;
    }

    // ==================================================
    // MONTH
    // ==================================================

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

        await showDays(
            chatId,
            messageId,
            type,
            year,
            month
        );

        return;
    }

    // ==================================================
    // BACK TO MONTHS
    // ==================================================

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

    // ==================================================
    // DAY
    // ==================================================

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

        const state =
            userStates[chatId];

        if (!state) {
            return;
        }

        // ----------------------------------------------
        // EDIT BIRTH DATE
        // ----------------------------------------------

        if (
            state.editingField ===
            "birthDate"
        ) {
            state.data.birthDate =
                selectedDate;

            state.editingField =
                null;

            await updatePassenger(
                state.rowNumber,
                state.data
            );

            await editInlineMessage(
                chatId,
                messageId,

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

        // ----------------------------------------------
        // EDIT FLIGHT DATE
        // ----------------------------------------------

        if (
            state.editingField ===
            "flightDate"
        ) {
            const availability =
                await checkRouteAvailability(
                    selectedDate,

                    state.data.route,

                    state.rowNumber
                );

            if (
                availability.occupied >=
                MAX_SEATS
            ) {
                await editInlineMessage(
                    chatId,
                    messageId,

                    `❌ На дату ${selectedDate} по маршруту ${state.data.route} уже занято ${MAX_SEATS}/${MAX_SEATS} мест.\n\nВыберите другую дату:`,

                    [
                        [
                            {
                                text:
                                    "📅 Выбрать другую дату",

                                callback_data:
                                    "edit_field:flightDate"
                            }
                        ],

                        [
                            {
                                text:
                                    "↩️ Назад",

                                callback_data:
                                    "back_to_passenger"
                            }
                        ]
                    ]
                );

                return;
            }

            state.data.flightDate =
                selectedDate;

            state.editingField =
                null;

            await updatePassenger(
                state.rowNumber,
                state.data
            );

            await editInlineMessage(
                chatId,
                messageId,

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

        // ----------------------------------------------
        // NORMAL BIRTH DATE
        // ----------------------------------------------

        if (
            type === "birth" &&
            state.step === 3
        ) {
            state.data.birthDate =
                selectedDate;

            state.step = 4;

            await editInlineMessage(
                chatId,
                messageId,

                "Введите номер паспорта:",

                previousStepKeyboard(
                    4
                )
            );

            return;
        }

        // ----------------------------------------------
        // NORMAL FLIGHT DATE
        // ----------------------------------------------

        if (
            type === "flight" &&
            state.step === 6
        ) {
            state.data.flightDate =
                selectedDate;

            state.step = 7;

            await showRoutes(
                chatId,

                selectedDate,

                messageId
            );

            return;
        }

        return;
    }

    // ==================================================
    // ROUTE FULL
    // ==================================================

    if (
        data === "route_full"
    ) {
        await sendMessage(
            chatId,

            "❌ На выбранном маршруте нет свободных мест."
        );

        return;
    }

    // ==================================================
    // ROUTE SELECT
    // ==================================================

    if (
        data.startsWith(
            "route_select:"
        )
    ) {
        const route =
            data.substring(
                "route_select:"
                    .length
            );

        const state =
            userStates[chatId];

        if (!state) {
            return;
        }

        // ----------------------------------------------
        // EDIT ROUTE
        // ----------------------------------------------

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

            if (
                !availability.available
            ) {
                await sendMessage(
                    chatId,

                    "❌ На этом маршруте уже нет свободных мест."
                );

                return;
            }

            state.data.route =
                route;

            state.editingField =
                null;

            await updatePassenger(
                state.rowNumber,
                state.data
            );

            await editInlineMessage(
                chatId,
                messageId,

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

        // ----------------------------------------------
        // NORMAL REGISTRATION
        // ----------------------------------------------

        if (
            state.step !== 7
        ) {
            return;
        }

        const availability =
            await checkRouteAvailability(
                state.data.flightDate,

                route
            );

        if (
            !availability.available
        ) {
            await sendMessage(
                chatId,

                "❌ Этот маршрут уже заполнен."
            );

            return;
        }

        state.data.route =
            route;

        state.step = 8;

        await showStatuses(
            chatId,
            messageId
        );

        return;
    }

    // ==================================================
    // STATUS SELECT
    // ==================================================

    if (
        data.startsWith(
            "status_select:"
        )
    ) {
        const status =
            data.substring(
                "status_select:"
                    .length
            );

        const state =
            userStates[chatId];

        if (!state) {
            return;
        }

        // ----------------------------------------------
        // EDIT STATUS
        // ----------------------------------------------

        if (
            state.editingField ===
            "status"
        ) {
            if (
                status !==
                "Отменен"
            ) {
                const availability =
                    await checkRouteAvailability(
                        state.data.flightDate,

                        state.data.route,

                        state.rowNumber
                    );

                if (
                    !availability.available
                ) {
                    await sendMessage(
                        chatId,

                        "❌ Нельзя изменить статус: на этом рейсе уже нет свободных мест."
                    );

                    return;
                }
            }

            state.data.status =
                status;

            state.editingField =
                null;

            await updatePassenger(
                state.rowNumber,
                state.data
            );

            await editInlineMessage(
                chatId,
                messageId,

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

        // ----------------------------------------------
        // NORMAL STATUS
        // ----------------------------------------------

        if (
            state.step !== 8
        ) {
            return;
        }

        if (
            status !==
            "Отменен"
        ) {
            const availability =
                await checkRouteAvailability(
                    state.data.flightDate,

                    state.data.route
                );

            if (
                !availability.available
            ) {
                await sendMessage(
                    chatId,

                    "❌ К сожалению, во время сохранения место уже заняли. Выберите другой маршрут или дату."
                );

                state.step = 7;

                await showRoutes(
                    chatId,

                    state.data.flightDate
                );

                return;
            }
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

            state.rowNumber =
                saved.rowNumber;

            await sendMessage(
                chatId,

                "✅ Пассажир успешно сохранён!"
            );

            const occupancy =
                await getRouteOccupancy(
                    state.data.flightDate,

                    state.data.route
                );

            await sendMessage(
                chatId,

                `💺 Загрузка маршрута: ${occupancy}/${MAX_SEATS}\n` +

                `🟢 Свободно: ${
                    Math.max(
                        0,
                        MAX_SEATS -
                            occupancy
                    )
                }`
            );

            await showSavedPassenger(
                chatId,
                state.data
            );

        } catch (error) {
            console.error(
                "Ошибка сохранения:",
                error.message
            );

            await sendMessage(
                chatId,

                "❌ Не удалось сохранить пассажира. Попробуйте ещё раз."
            );
        }

        return;
    }
}

// ======================================================
// TEXT MESSAGE
// ======================================================

async function handleTextMessage(
    message
) {
    const chatId =
        message.chat.id;

    const text =
        (message.text || "")
            .trim();

    // ==================================================
    // START
    // ==================================================

    if (
        text === "/start"
    ) {
        delete userStates[
            chatId
        ];

        await showMainMenu(
            chatId
        );

        return;
    }

    // ==================================================
    // MENU
    // ==================================================

    if (
        text === "/menu"
    ) {
        delete userStates[
            chatId
        ];

        await showMainMenu(
            chatId
        );

        return;
    }

    const state =
        userStates[chatId];

    if (!state) {
        await showMainMenu(
            chatId
        );

        return;
    }

    // ==================================================
    // EDIT SAVED DATA
    // ==================================================

    if (
        state.editingField
    ) {
        const handled =
            await processSavedTextEdit(
                chatId,
                text
            );

        if (handled) {
            return;
        }
    }

    // ==================================================
    // STEP 0 — SURNAME
    // ==================================================

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

    // ==================================================
    // STEP 1 — NAME
    // ==================================================

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

    // ==================================================
    // STEP 2 — PATRONYMIC
    // ==================================================

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

    // ==================================================
    // STEP 3 — BIRTH DATE
    // ==================================================

    if (
        state.step === 3
    ) {
        await sendMessage(
            chatId,

            "📅 Пожалуйста, выберите дату рождения через календарь."
        );

        return;
    }

    // ==================================================
    // STEP 4 — PASSPORT
    // ==================================================

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

        await sendMessage(
            chatId,

            "🌍 Введите гражданство:"
        );

        return;
    }

    // ==================================================
    // STEP 5 — CITIZENSHIP
    // ==================================================

    if (
        state.step === 5
    ) {
        if (!text) {
            await sendMessage(
                chatId,

                "❌ Гражданство не может быть пустым.\n\nВведите гражданство:"
            );

            return;
        }

        state.data.citizenship =
            text;

        state.step = 6;

        // Здесь начинается именно календарь
        // даты рейса
        await showFlightCalendar(
            chatId
        );

        return;
    }

    // ==================================================
    // STEP 6 — FLIGHT DATE
    // ==================================================

    if (
        state.step === 6
    ) {
        await sendMessage(
            chatId,

            "📅 Пожалуйста, выберите дату рейса через календарь."
        );

        return;
    }

    // ==================================================
    // STEP 7 — ROUTE
    // ==================================================

    if (
        state.step === 7
    ) {
        await sendMessage(
            chatId,

            "✈️ Пожалуйста, выберите маршрут кнопкой."
        );

        return;
    }

    // ==================================================
    // STEP 8 — STATUS
    // ==================================================

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

// ======================================================
// TELEGRAM WEBHOOK
// ======================================================

app.post(
    "/telegram/webhook",

    async (
        req,
        res
    ) => {
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

        res.sendStatus(
            200
        );

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

// ======================================================
// HEALTH CHECK
// ======================================================

app.get(
    "/",

    (
        req,
        res
    ) => {
        res.send(
            "KMRN Passenger Bot is running"
        );
    }
);

// ======================================================
// WEBHOOK SETUP
// ======================================================

async function setupWebhook() {
    if (
        !TELEGRAM_WEBHOOK_SECRET
    ) {
        console.error(
            "❌ TELEGRAM_WEBHOOK_SECRET не установлен!"
        );

        return;
    }

    if (
        !PUBLIC_URL
    ) {
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

        if (
            result.ok
        ) {
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

// ======================================================
// START SERVER
// ======================================================

app.listen(
    PORT,

    async () => {
        console.log(
            `KMRN Passenger Bot запущен на порту ${PORT}`
        );

        await setupWebhook();
    }
);
