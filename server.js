const express = require("express");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

// ==========================================
// ENV
// ==========================================

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

// ==========================================
// GOOGLE SHEETS AUTH
// ==========================================

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

// ==========================================
// USER STATES
// ==========================================

const userStates = {};
const lastPassengers = {};

// ==========================================
// TELEGRAM API
// ==========================================

async function telegramRequest(method, data) {
    const response = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`,
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

// ==========================================
// SEND MESSAGE
// ==========================================

async function sendMessage(
    chatId,
    text,
    reply_markup = undefined
) {
    const data = {
        chat_id: chatId,
        text: text
    };

    if (reply_markup) {
        data.reply_markup = reply_markup;
    }

    return await telegramRequest(
        "sendMessage",
        data
    );
}

// ==========================================
// SEND INLINE MESSAGE
// ==========================================

async function sendInlineMessage(
    chatId,
    text,
    buttons
) {
    return await telegramRequest(
        "sendMessage",
        {
            chat_id: chatId,
            text: text,
            reply_markup: {
                inline_keyboard: buttons
            }
        }
    );
}

// ==========================================
// EDIT INLINE MESSAGE
// ==========================================

async function editInlineMessage(
    chatId,
    messageId,
    text,
    buttons
) {
    const data = {
        chat_id: chatId,
        message_id: messageId,
        text: text
    };

    if (buttons) {
        data.reply_markup = {
            inline_keyboard: buttons
        };
    } else {
        data.reply_markup = {
            inline_keyboard: []
        };
    }

    return await telegramRequest(
        "editMessageText",
        data
    );
}

// ==========================================
// ANSWER CALLBACK
// ==========================================

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

// ==========================================
// MAIN MENU
// ==========================================

async function showMainMenu(chatId) {
    userStates[chatId] = {
        step: 0,
        data: []
    };

    await sendInlineMessage(
        chatId,
        "🏠 Главное меню:",
        [
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
    );
}

// ==========================================
// START REGISTRATION
// ==========================================

async function startPassengerRegistration(
    chatId
) {
    userStates[chatId] = {
        step: 0,
        data: []
    };

    await sendMessage(
        chatId,
        "Введите фамилию пассажира:"
    );
}

// ==========================================
// GET GOOGLE SHEET DATA
// ==========================================

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
            "В Google Sheets не найден лист"
        );
    }

    const sheetTitle =
        firstSheet.properties.title;

    const result =
        await sheets.spreadsheets.values.get({
            spreadsheetId:
                SPREADSHEET_ID,
            range:
                `${sheetTitle}!A:J`
        });

    return {
        sheetTitle,
        rows:
            result.data.values || []
    };
}

// ==========================================
// SAVE PASSENGER
// ==========================================

async function savePassenger(
    passenger
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
            "В Google Sheets не найден лист"
        );
    }

    const sheetTitle =
        firstSheet.properties.title;

    const values = [
        passenger.id,
        passenger.surname,
        passenger.name,
        passenger.patronymic,
        passenger.birthDate,
        passenger.passport,
        passenger.citizenship,
        passenger.flightDate,
        passenger.route,
        passenger.status
    ];

    await sheets.spreadsheets.values.append({
        spreadsheetId:
            SPREADSHEET_ID,

        range:
            `${sheetTitle}!A:J`,

        valueInputOption:
            "USER_ENTERED",

        requestBody: {
            values: [values]
        }
    });
}

// ==========================================
// GET ROUTE OCCUPANCY
// ==========================================

async function getRouteOccupancy(
    flightDate,
    route
) {
    const { rows } =
        await getSheetData();

    if (rows.length <= 1) {
        return 0;
    }

    let count = 0;

    for (
        let i = 1;
        i < rows.length;
        i++
    ) {
        const row = rows[i];

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

// ==========================================
// CHECK ROUTE AVAILABILITY
// ==========================================

async function checkRouteAvailability(
    flightDate,
    route
) {
    const occupancy =
        await getRouteOccupancy(
            flightDate,
            route
        );

    return {
        occupancy:
            occupancy,

        freeSeats:
            Math.max(
                0,
                MAX_SEATS - occupancy
            ),

        isFull:
            occupancy >= MAX_SEATS
    };
}

// ==========================================
// CALENDAR
// ==========================================

const monthNames = [
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

const weekDays = [
    "Пн",
    "Вт",
    "Ср",
    "Чт",
    "Пт",
    "Сб",
    "Вс"
];

// ==========================================
// SHOW YEARS
// ==========================================

async function showYears(
    chatId,
    messageId,
    currentPage = 0
) {
    const currentYear =
        new Date().getFullYear();

    const maxYear =
        currentYear;

    const minYear =
        1940;

    const yearsPerPage =
        12;

    const startYear =
        maxYear -
        currentPage *
            yearsPerPage;

    const endYear =
        Math.max(
            minYear,
            startYear -
                yearsPerPage +
                1
        );

    const buttons = [];

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
                `birth_year_${year}`
        });

        if (
            row.length === 3
        ) {
            buttons.push(row);
            row = [];
        }
    }

    if (row.length > 0) {
        buttons.push(row);
    }

    const navigation = [];

    if (
        startYear -
            yearsPerPage >=
        minYear
    ) {
        navigation.push({
            text: "⬅️ Старше",

            callback_data:
                `birth_years_${
                    currentPage + 1
                }`
        });
    }

    if (currentPage > 0) {
        navigation.push({
            text: "➡️ Новее",

            callback_data:
                `birth_years_${
                    currentPage - 1
                }`
        });
    }

    if (
        navigation.length > 0
    ) {
        buttons.push(
            navigation
        );
    }

    await editInlineMessage(
        chatId,
        messageId,
        "📅 Выберите год рождения:",
        buttons
    );
}

// ==========================================
// SHOW MONTHS
// ==========================================

async function showMonths(
    chatId,
    messageId,
    year
) {
    const buttons = [];

    let row = [];

    for (
        let month = 0;
        month < 12;
        month++
    ) {
        row.push({
            text:
                monthNames[month],

            callback_data:
                `birth_month_${year}_${month}`
        });

        if (
            row.length === 3
        ) {
            buttons.push(row);
            row = [];
        }
    }

    if (row.length > 0) {
        buttons.push(row);
    }

    buttons.push([
        {
            text: "⬅️ Назад",

            callback_data:
                "birth_back_years"
        }
    ]);

    await editInlineMessage(
        chatId,
        messageId,
        `📅 ${year} год\n\nВыберите месяц:`,
        buttons
    );
}

// ==========================================
// SHOW DAYS
// ==========================================

async function showDays(
    chatId,
    messageId,
    year,
    month
) {
    const buttons = [];

    buttons.push(
        weekDays.map(
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
        );

    let dayOfWeek =
        firstDay.getDay();

    if (
        dayOfWeek === 0
    ) {
        dayOfWeek = 7;
    }

    const daysInMonth =
        new Date(
            year,
            month + 1,
            0
        ).getDate();

    let row = [];

    for (
        let i = 1;
        i < dayOfWeek;
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

        const isFuture =
            selectedDate >
            today;

        row.push({
            text:
                String(day),

            callback_data:
                isFuture
                    ? "ignore"
                    : `birth_day_${year}_${month}_${day}`
        });

        if (
            row.length === 7
        ) {
            buttons.push(row);
            row = [];
        }
    }

    if (row.length > 0) {
        while (
            row.length < 7
        ) {
            row.push({
                text: " ",
                callback_data:
                    "ignore"
            });
        }

        buttons.push(row);
    }

    buttons.push([
        {
            text: "⬅️ Назад",

            callback_data:
                `birth_back_months_${year}`
        }
    ]);

    await editInlineMessage(
        chatId,
        messageId,
        `📅 ${monthNames[month]} ${year}\n\nВыберите день:`,
        buttons
    );
}

// ==========================================
// SHOW BIRTH CALENDAR
// ==========================================

async function showBirthCalendar(
    chatId
) {
    const result =
        await sendInlineMessage(
            chatId,
            "📅 Выберите год рождения:",
            []
        );

    if (
        result &&
        result.ok &&
        result.result
    ) {
        await showYears(
            chatId,
            result.result.message_id,
            0
        );
    }
}

// ==========================================
// ASK FLIGHT DATE
// ==========================================

async function askFlightDate(
    chatId
) {
    await sendMessage(
        chatId,
        "Введите дату рейса в формате ДД.ММ.ГГГГ:"
    );
}

// ==========================================
// VALIDATE DATE
// ==========================================

function isValidDate(
    dateString
) {
    const match =
        dateString.match(
            /^(\d{2})\.(\d{2})\.(\d{4})$/
        );

    if (!match) {
        return false;
    }

    const day =
        Number(match[1]);

    const month =
        Number(match[2]);

    const year =
        Number(match[3]);

    const date =
        new Date(
            year,
            month - 1,
            day
        );

    return (
        date.getFullYear() ===
            year &&
        date.getMonth() ===
            month - 1 &&
        date.getDate() ===
            day
    );
}

// ==========================================
// FORMAT DATE
// ==========================================

function formatDate(
    year,
    month,
    day
) {
    return `${String(day).padStart(
        2,
        "0"
    )}.${String(
        month + 1
    ).padStart(
        2,
        "0"
    )}.${year}`;
}

// ==========================================
// SHOW ROUTES
// ==========================================

async function showRoutes(
    chatId
) {
    const state =
        userStates[chatId];

    if (!state) {
        await showMainMenu(
            chatId
        );
        return;
    }

    const flightDate =
        state.data[6];

    const route1 =
        "ДШБ — ХРГ";

    const route2 =
        "ХРГ — ДШБ";

    const availability1 =
        await checkRouteAvailability(
            flightDate,
            route1
        );

    const availability2 =
        await checkRouteAvailability(
            flightDate,
            route2
        );

    const buttons = [];

    if (
        !availability1.isFull
    ) {
        buttons.push([
            {
                text:
                    "✈️ ДШБ — ХРГ",

                callback_data:
                    "route_dsb_khr"
            }
        ]);
    } else {
        buttons.push([
            {
                text:
                    "🚫 ДШБ — ХРГ (мест нет)",

                callback_data:
                    "route_full"
            }
        ]);
    }

    if (
        !availability2.isFull
    ) {
        buttons.push([
            {
                text:
                    "✈️ ХРГ — ДШБ",

                callback_data:
                    "route_khr_dsb"
            }
        ]);
    } else {
        buttons.push([
            {
                text:
                    "🚫 ХРГ — ДШБ (мест нет)",

                callback_data:
                    "route_full"
            }
        ]);
    }

    await sendInlineMessage(
        chatId,
        `✈️ Выберите маршрут\n\n📅 Дата рейса: ${flightDate}`,
        buttons
    );
}

// ==========================================
// SHOW STATUSES
// ==========================================

async function showStatuses(
    chatId
) {
    await sendInlineMessage(
        chatId,
        "📌 Выберите статус пассажира:",
        [
            [
                {
                    text:
                        "✅ Подтвержден",

                    callback_data:
                        "status_confirmed"
                }
            ],
            [
                {
                    text:
                        "⏳ Ожидание",

                    callback_data:
                        "status_waiting"
                }
            ],
            [
                {
                    text:
                        "❌ Отменен",

                    callback_data:
                        "status_cancelled"
                }
            ]
        ]
    );
}

// ==========================================
// ADD PASSENGER
// ==========================================

async function addPassenger(
    chatId
) {
    const state =
        userStates[chatId];

    if (!state) {
        await showMainMenu(
            chatId
        );
        return;
    }

    const passenger = {
        id:
            String(chatId),

        surname:
            state.data[0],

        name:
            state.data[1],

        patronymic:
            state.data[2],

        birthDate:
            state.data[3],

        passport:
            state.data[4],

        citizenship:
            state.data[5],

        flightDate:
            state.data[6],

        route:
            state.data[7],

        status:
            state.data[8]
    };

    // ======================================
    // FINAL CAPACITY CHECK
    // ======================================

    if (
        passenger.status !==
        "Отменен"
    ) {
        const availability =
            await checkRouteAvailability(
                passenger.flightDate,
                passenger.route
            );

        if (
            availability.isFull
        ) {
            await sendMessage(
                chatId,
                `❌ К сожалению, рейс уже заполнен.\n\n` +
                `📅 Дата: ${passenger.flightDate}\n` +
                `✈️ Маршрут: ${passenger.route}\n\n` +
                `💺 Загрузка: ${availability.occupancy}/${MAX_SEATS}`
            );

            await showRoutes(
                chatId
            );

            return;
        }
    }

    // ======================================
    // SAVE
    // ======================================

    await savePassenger(
        passenger
    );

    lastPassengers[chatId] =
        passenger;

    const occupancy =
        await getRouteOccupancy(
            passenger.flightDate,
            passenger.route
        );

    const freeSeats =
        Math.max(
            0,
            MAX_SEATS -
                occupancy
        );

    let message =
        "✅ Пассажир успешно зарегистрирован!\n\n" +
        `👤 ${passenger.surname} ${passenger.name} ${passenger.patronymic}\n` +
        `📅 Дата рождения: ${passenger.birthDate}\n` +
        `🛂 Паспорт: ${passenger.passport}\n` +
        `🌍 Гражданство: ${passenger.citizenship}\n` +
        `📅 Дата рейса: ${passenger.flightDate}\n` +
        `✈️ Маршрут: ${passenger.route}\n` +
        `📌 Статус: ${passenger.status}\n\n` +
        `💺 Загрузка маршрута: ${occupancy}/${MAX_SEATS}\n` +
        `🟢 Свободно: ${freeSeats}`;

    if (
        occupancy >=
        MAX_SEATS
    ) {
        message +=
            "\n\n⚠️ На данный маршрут и дату больше нет свободных мест.";
    }

    await sendInlineMessage(
        chatId,
        message,
        [
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
                        "👤 Посмотреть данные",

                    callback_data:
                        "main_view_data"
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

    userStates[chatId] = {
        step: 0,
        data: []
    };
}

// ==========================================
// CALLBACK HANDLER
// ==========================================

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

    // ======================================
    // MAIN MENU
    // ======================================

    if (
        data === "main_menu"
    ) {
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

    if (
        data ===
        "main_view_data"
    ) {
        const passenger =
            lastPassengers[chatId];

        if (!passenger) {
            await sendMessage(
                chatId,
                "ℹ️ Данных о последнем зарегистрированном пассажире пока нет."
            );
            return;
        }

        await sendMessage(
            chatId,
            "👤 Данные последнего зарегистрированного пассажира:\n\n" +
            `🆔 ID: ${passenger.id}\n` +
            `Фамилия: ${passenger.surname}\n` +
            `Имя: ${passenger.name}\n` +
            `Отчество: ${passenger.patronymic}\n` +
            `Дата рождения: ${passenger.birthDate}\n` +
            `Паспорт: ${passenger.passport}\n` +
            `Гражданство: ${passenger.citizenship}\n` +
            `Дата рейса: ${passenger.flightDate}\n` +
            `Маршрут: ${passenger.route}\n` +
            `Статус: ${passenger.status}`
        );

        return;
    }

    if (
        data ===
        "main_find_passenger"
    ) {
        await sendMessage(
            chatId,
            "🔎 Функция поиска пассажира будет добавлена на следующем этапе."
        );

        return;
    }

    if (
        data ===
        "main_flight_passengers"
    ) {
        await sendMessage(
            chatId,
            "✈️ Функция просмотра пассажиров рейса будет добавлена на следующем этапе."
        );

        return;
    }

    if (
        data ===
        "main_statistics"
    ) {
        await sendMessage(
            chatId,
            "📊 Функция статистики будет добавлена на следующем этапе."
        );

        return;
    }

    // ======================================
    // STATE
    // ======================================

    const state =
        userStates[chatId];

    if (!state) {
        await showMainMenu(
            chatId
        );
        return;
    }

    // ======================================
    // YEARS PAGINATION
    // ======================================

    if (
        data.startsWith(
            "birth_years_"
        )
    ) {
        const page =
            Number(
                data.replace(
                    "birth_years_",
                    ""
                )
            );

        await showYears(
            chatId,
            messageId,
            page
        );

        return;
    }

    // ======================================
    // BACK TO YEARS
    // ======================================

    if (
        data ===
        "birth_back_years"
    ) {
        await showYears(
            chatId,
            messageId,
            0
        );

        return;
    }

    // ======================================
    // SELECT YEAR
    // ======================================

    if (
        data.startsWith(
            "birth_year_"
        )
    ) {
        const year =
            Number(
                data.replace(
                    "birth_year_",
                    ""
                )
            );

        await showMonths(
            chatId,
            messageId,
            year
        );

        return;
    }

    // ======================================
    // BACK TO MONTHS
    // ======================================

    if (
        data.startsWith(
            "birth_back_months_"
        )
    ) {
        const year =
            Number(
                data.replace(
                    "birth_back_months_",
                    ""
                )
            );

        await showMonths(
            chatId,
            messageId,
            year
        );

        return;
    }

    // ======================================
    // SELECT MONTH
    // ======================================

    if (
        data.startsWith(
            "birth_month_"
        )
    ) {
        const parts =
            data.split("_");

        const year =
            Number(parts[2]);

        const month =
            Number(parts[3]);

        await showDays(
            chatId,
            messageId,
            year,
            month
        );

        return;
    }

    // ======================================
    // SELECT DAY
    // ======================================

    if (
        data.startsWith(
            "birth_day_"
        )
    ) {
        const parts =
            data.split("_");

        const year =
            Number(parts[2]);

        const month =
            Number(parts[3]);

        const day =
            Number(parts[4]);

        const selectedDate =
            new Date(
                year,
                month,
                day
            );

        const today =
            new Date();

        if (
            selectedDate >
            today
        ) {
            await sendMessage(
                chatId,
                "❌ Дата рождения не может быть в будущем."
            );

            return;
        }

        const birthDate =
            formatDate(
                year,
                month,
                day
            );

        // ==================================
        // ВАЖНО:
        // Сохраняем дату рождения
        // И ПЕРЕХОДИМ НА ШАГ ПАСПОРТА
        // ==================================

        state.data[3] =
            birthDate;

        state.step = 4;

        // Закрываем календарь
        await editInlineMessage(
            chatId,
            messageId,
            `📅 Дата рождения: ${birthDate}`,
            []
        );

        await sendMessage(
            chatId,
            "Введите номер паспорта:"
        );

        return;
    }

    // ======================================
    // ROUTE FULL
    // ======================================

    if (
        data === "route_full"
    ) {
        await sendMessage(
            chatId,
            "❌ На этом маршруте нет свободных мест."
        );

        return;
    }

    // ======================================
    // ROUTE DSB -> KHR
    // ======================================

    if (
        data ===
        "route_dsb_khr"
    ) {
        const route =
            "ДШБ — ХРГ";

        const flightDate =
            state.data[6];

        const availability =
            await checkRouteAvailability(
                flightDate,
                route
            );

        if (
            availability.isFull
        ) {
            await sendMessage(
                chatId,
                "❌ К сожалению, этот рейс уже заполнен."
            );

            await showRoutes(
                chatId
            );

            return;
        }

        state.data[7] =
            route;

        state.step = 8;

        await sendMessage(
            chatId,
            `✈️ Маршрут выбран: ${route}\n\n` +
            `💺 Свободно: ${availability.freeSeats}/${MAX_SEATS}`
        );

        await showStatuses(
            chatId
        );

        return;
    }

    // ======================================
    // ROUTE KHR -> DSB
    // ======================================

    if (
        data ===
        "route_khr_dsb"
    ) {
        const route =
            "ХРГ — ДШБ";

        const flightDate =
            state.data[6];

        const availability =
            await checkRouteAvailability(
                flightDate,
                route
            );

        if (
            availability.isFull
        ) {
            await sendMessage(
                chatId,
                "❌ К сожалению, этот рейс уже заполнен."
            );

            await showRoutes(
                chatId
            );

            return;
        }

        state.data[7] =
            route;

        state.step = 8;

        await sendMessage(
            chatId,
            `✈️ Маршрут выбран: ${route}\n\n` +
            `💺 Свободно: ${availability.freeSeats}/${MAX_SEATS}`
        );

        await showStatuses(
            chatId
        );

        return;
    }

    // ======================================
    // STATUS CONFIRMED
    // ======================================

    if (
        data ===
        "status_confirmed"
    ) {
        state.data[8] =
            "Подтвержден";

        await addPassenger(
            chatId
        );

        return;
    }

    // ======================================
    // STATUS WAITING
    // ======================================

    if (
        data ===
        "status_waiting"
    ) {
        state.data[8] =
            "Ожидание";

        await addPassenger(
            chatId
        );

        return;
    }

    // ======================================
    // STATUS CANCELLED
    // ======================================

    if (
        data ===
        "status_cancelled"
    ) {
        state.data[8] =
            "Отменен";

        await addPassenger(
            chatId
        );

        return;
    }

    // ======================================
    // IGNORE
    // ======================================

    if (
        data === "ignore"
    ) {
        return;
    }
}

// ==========================================
// TEXT MESSAGE HANDLER
// ==========================================

async function handleTextMessage(
    message
) {
    if (
        !message ||
        !message.chat
    ) {
        return;
    }

    const chatId =
        message.chat.id;

    const text =
        (
            message.text ||
            ""
        ).trim();

    // ======================================
    // START
    // ======================================

    if (
        text === "/start" ||
        text === "/menu"
    ) {
        await showMainMenu(
            chatId
        );

        return;
    }

    // ======================================
    // OLD TEXT MENU SUPPORT
    // ======================================

    if (
        text ===
        "➕ Добавить пассажира"
    ) {
        await startPassengerRegistration(
            chatId
        );

        return;
    }

    if (
        text ===
        "👤 Посмотреть данные"
    ) {
        const passenger =
            lastPassengers[chatId];

        if (!passenger) {
            await sendMessage(
                chatId,
                "ℹ️ Данных о последнем зарегистрированном пассажире пока нет."
            );

            return;
        }

        await sendMessage(
            chatId,
            "👤 Данные последнего зарегистрированного пассажира:\n\n" +
            `🆔 ID: ${passenger.id}\n` +
            `Фамилия: ${passenger.surname}\n` +
            `Имя: ${passenger.name}\n` +
            `Отчество: ${passenger.patronymic}\n` +
            `Дата рождения: ${passenger.birthDate}\n` +
            `Паспорт: ${passenger.passport}\n` +
            `Гражданство: ${passenger.citizenship}\n` +
            `Дата рейса: ${passenger.flightDate}\n` +
            `Маршрут: ${passenger.route}\n` +
            `Статус: ${passenger.status}`
        );

        return;
    }

    if (
        text ===
        "🔎 Найти пассажира"
    ) {
        await sendMessage(
            chatId,
            "🔎 Функция поиска пассажира будет добавлена на следующем этапе."
        );

        return;
    }

    if (
        text ===
        "✈️ Пассажиры рейса"
    ) {
        await sendMessage(
            chatId,
            "✈️ Функция просмотра пассажиров рейса будет добавлена на следующем этапе."
        );

        return;
    }

    if (
        text ===
        "📊 Статистика"
    ) {
        await sendMessage(
            chatId,
            "📊 Функция статистики будет добавлена на следующем этапе."
        );

        return;
    }

    // ======================================
    // USER STATE
    // ======================================

    const state =
        userStates[chatId];

    if (!state) {
        await showMainMenu(
            chatId
        );

        return;
    }

    // ======================================
    // STEP 0 — SURNAME
    // ======================================

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

        state.data[0] =
            text;

        state.step = 1;

        await sendMessage(
            chatId,
            "Введите имя пассажира:"
        );

        return;
    }

    // ======================================
    // STEP 1 — NAME
    // ======================================

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

        state.data[1] =
            text;

        state.step = 2;

        await sendMessage(
            chatId,
            "Введите отчество пассажира:"
        );

        return;
    }

    // ======================================
    // STEP 2 — PATRONYMIC
    // ======================================

    if (
        state.step === 2
    ) {
        state.data[2] =
            text;

        state.step = 3;

        await showBirthCalendar(
            chatId
        );

        return;
    }

    // ======================================
    // STEP 3 — BIRTH DATE
    // ======================================

    if (
        state.step === 3
    ) {
        // Дата выбирается
        // только через календарь
        return;
    }

    // ======================================
    // STEP 4 — PASSPORT
    // ======================================

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

        state.data[4] =
            text;

        state.step = 5;

        await sendMessage(
            chatId,
            "Введите гражданство:"
        );

        return;
    }

    // ======================================
    // STEP 5 — CITIZENSHIP
    // ======================================

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

        state.data[5] =
            text;

        state.step = 6;

        await askFlightDate(
            chatId
        );

        return;
    }

    // ======================================
    // STEP 6 — FLIGHT DATE
    // ======================================

    if (
        state.step === 6
    ) {
        if (
            !isValidDate(text)
        ) {
            await sendMessage(
                chatId,
                "❌ Неверный формат даты.\n\nВведите дату в формате ДД.ММ.ГГГГ:"
            );

            return;
        }

        state.data[6] =
            text;

        state.step = 7;

        await showRoutes(
            chatId
        );

        return;
    }

    // ======================================
    // STEP 7 — ROUTE
    // ======================================

    if (
        state.step === 7
    ) {
        return;
    }

    // ======================================
    // STEP 8 — STATUS
    // ======================================

    if (
        state.step === 8
    ) {
        return;
    }
}

// ==========================================
// TELEGRAM WEBHOOK
// ==========================================

app.post(
    "/telegram/webhook",
    async (req, res) => {
        const incomingSecret =
            req.headers[
                "x-telegram-bot-api-secret-token"
            ];

        // ======================================
        // WEBHOOK SECURITY
        // ======================================

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

        // Telegram получает
        // быстрый ответ
        res.sendStatus(200);

        try {
            const update =
                req.body;

            // ==================================
            // CALLBACK QUERY
            // ==================================

            if (
                update.callback_query
            ) {
                await handleCallbackQuery(
                    update.callback_query
                );

                return;
            }

            // ==================================
            // MESSAGE
            // ==================================

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

// ==========================================
// HEALTH CHECK
// ==========================================

app.get(
    "/",
    (req, res) => {
        res.send(
            "KMRN Passenger Bot is running"
        );
    }
);

// ==========================================
// SETUP WEBHOOK
// ==========================================

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

// ==========================================
// START SERVER
// ==========================================

app.listen(
    PORT,
    async () => {
        console.log(
            `KMRN Passenger Bot запущен на порту ${PORT}`
        );

        await setupWebhook();
    }
);
