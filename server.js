const express = require("express");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

const telegramApi = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

// =====================================================
// НАСТРОЙКИ
// =====================================================

const MAX_SEATS = 19;

// =====================================================
// GOOGLE SHEETS
// =====================================================

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

// =====================================================
// СОСТОЯНИЕ ПОЛЬЗОВАТЕЛЕЙ
// =====================================================

const userStates = {};
const lastPassengers = {};

// =====================================================
// TELEGRAM API
// =====================================================

async function telegramRequest(method, body) {
    const response = await fetch(`${telegramApi}/${method}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });

    return await response.json();
}

// =====================================================
// ОТПРАВИТЬ СООБЩЕНИЕ
// =====================================================

async function sendMessage(chatId, text, keyboard = null) {
    const body = {
        chat_id: chatId,
        text
    };

    if (keyboard) {
        body.reply_markup = {
            keyboard,
            resize_keyboard: true
        };
    }

    return await telegramRequest("sendMessage", body);
}

// =====================================================
// УДАЛИТЬ ОБЫЧНУЮ КЛАВИАТУРУ
// =====================================================

async function removeKeyboard(chatId) {
    return await telegramRequest("sendMessage", {
        chat_id: chatId,
        text: " ",
        reply_markup: {
            remove_keyboard: true
        }
    });
}

// =====================================================
// INLINE MESSAGE
// =====================================================

async function sendInlineMessage(chatId, text, buttons) {
    return await telegramRequest("sendMessage", {
        chat_id: chatId,
        text,
        reply_markup: {
            inline_keyboard: buttons
        }
    });
}

// =====================================================
// ИЗМЕНИТЬ INLINE MESSAGE
// =====================================================

async function editInlineMessage(chatId, messageId, text, buttons = []) {
    return await telegramRequest("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text,
        reply_markup: {
            inline_keyboard: buttons
        }
    });
}

// =====================================================
// CALLBACK
// =====================================================

async function answerCallbackQuery(callbackQueryId, text = null) {
    const body = {
        callback_query_id: callbackQueryId
    };

    if (text) {
        body.text = text;
        body.show_alert = true;
    }

    return await telegramRequest("answerCallbackQuery", body);
}

// =====================================================
// ГЛАВНОЕ МЕНЮ
// =====================================================

async function showMainMenu(chatId) {
    userStates[chatId] = {
        step: 0,
        data: []
    };

    await sendMessage(chatId, "🏠 Главное меню:", [
        ["➕ Добавить пассажира"],
        ["👤 Посмотреть данные"],
        ["🔎 Найти пассажира"],
        ["✈️ Пассажиры рейса"],
        ["📊 Статистика"]
    ]);
}

// =====================================================
// НАЧАЛО РЕГИСТРАЦИИ
// =====================================================

async function startPassengerRegistration(chatId) {
    userStates[chatId] = {
        step: 1,
        data: []
    };

    await removeKeyboard(chatId);

    await sendMessage(
        chatId,
        "Шаг 1 из 9\n\nВведите фамилию пассажира:"
    );
}

// =====================================================
// ПОЛУЧИТЬ НАЗВАНИЕ ПЕРВОГО ЛИСТА
// =====================================================

async function getSheetTitle() {
    const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID
    });

    return spreadsheet.data.sheets[0].properties.title;
}

// =====================================================
// ПОЛУЧИТЬ ВСЕХ ПАССАЖИРОВ ИЗ GOOGLE SHEETS
// =====================================================

async function getAllPassengers() {
    const sheetTitle = await getSheetTitle();

    const result = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetTitle}!A:J`
    });

    return result.data.values || [];
}

// =====================================================
// ПРОВЕРКА ЗАГРУЗКИ КОНКРЕТНОГО РЕЙСА
//
// Учитываем:
// Дата рейса + Маршрут
//
// Отменённые пассажиры места НЕ занимают.
// =====================================================

async function getFlightOccupancy(flightDate, route) {
    try {
        const rows = await getAllPassengers();

        let count = 0;

        // Первая строка — заголовки
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];

            const passengerFlightDate = row[7];
            const passengerRoute = row[8];
            const passengerStatus = row[9];

            if (
                passengerFlightDate === flightDate &&
                passengerRoute === route &&
                passengerStatus !== "Отменен"
            ) {
                count++;
            }
        }

        return count;

    } catch (error) {
        console.error("Ошибка проверки загрузки:", error);
        throw error;
    }
}

// =====================================================
// ПРОВЕРИТЬ, ЕСТЬ ЛИ СВОБОДНЫЕ МЕСТА
// =====================================================

async function checkFlightAvailability(flightDate, route) {
    const count = await getFlightOccupancy(
        flightDate,
        route
    );

    return {
        count,
        available: MAX_SEATS - count,
        isFull: count >= MAX_SEATS
    };
}

// =====================================================
// КАЛЕНДАРЬ ДАТЫ РОЖДЕНИЯ
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

const MIN_BIRTH_YEAR = 1940;
const YEARS_PER_PAGE = 12;

// =====================================================
// ПОКАЗАТЬ ГОДЫ
// =====================================================

async function showBirthYears(
    chatId,
    messageId = null,
    pageEndYear = new Date().getFullYear()
) {
    const currentYear = new Date().getFullYear();

    if (pageEndYear > currentYear) {
        pageEndYear = currentYear;
    }

    if (pageEndYear < MIN_BIRTH_YEAR) {
        pageEndYear = MIN_BIRTH_YEAR;
    }

    const startYear = Math.max(
        MIN_BIRTH_YEAR,
        pageEndYear - YEARS_PER_PAGE + 1
    );

    const years = [];

    for (
        let year = pageEndYear;
        year >= startYear;
        year--
    ) {
        years.push(year);
    }

    const buttons = [];

    for (let i = 0; i < years.length; i += 3) {
        const row = [];

        for (
            let j = i;
            j < Math.min(i + 3, years.length);
            j++
        ) {
            row.push({
                text: String(years[j]),
                callback_data: `birth_year_${years[j]}`
            });
        }

        buttons.push(row);
    }

    const navigation = [];

    if (startYear > MIN_BIRTH_YEAR) {
        navigation.push({
            text: "⬅️ Старше",
            callback_data: `birth_year_page_${startYear - 1}`
        });
    }

    if (pageEndYear < currentYear) {
        navigation.push({
            text: "Новее ➡️",
            callback_data: `birth_year_page_${pageEndYear + YEARS_PER_PAGE}`
        });
    }

    if (navigation.length > 0) {
        buttons.push(navigation);
    }

    const text =
        "Шаг 4 из 9 🎂\n\n" +
        "Выберите год рождения:";

    if (messageId) {
        return await editInlineMessage(
            chatId,
            messageId,
            text,
            buttons
        );
    }

    return await sendInlineMessage(
        chatId,
        text,
        buttons
    );
}

// =====================================================
// ПОКАЗАТЬ МЕСЯЦЫ
// =====================================================

async function showBirthMonths(chatId, messageId, year) {
    const buttons = [];

    for (let i = 0; i < 12; i += 2) {
        buttons.push([
            {
                text: MONTHS[i],
                callback_data: `birth_month_${year}_${i + 1}`
            },
            {
                text: MONTHS[i + 1],
                callback_data: `birth_month_${year}_${i + 2}`
            }
        ]);
    }

    buttons.push([
        {
            text: "⬅️ К годам",
            callback_data: "birth_change_year"
        }
    ]);

    return await editInlineMessage(
        chatId,
        messageId,
        `🎂 Год рождения: ${year}\n\nВыберите месяц:`,
        buttons
    );
}

// =====================================================
// ПОКАЗАТЬ ДНИ
// =====================================================

async function showBirthDays(
    chatId,
    messageId,
    year,
    month
) {
    const buttons = [];

    buttons.push(
        WEEKDAYS.map(day => ({
            text: day,
            callback_data: "calendar_none"
        }))
    );

    const firstDay = new Date(
        year,
        month - 1,
        1
    );

    let firstWeekday = firstDay.getDay() - 1;

    if (firstWeekday < 0) {
        firstWeekday = 6;
    }

    const daysInMonth = new Date(
        year,
        month,
        0
    ).getDate();

    let row = [];

    for (let i = 0; i < firstWeekday; i++) {
        row.push({
            text: "·",
            callback_data: "calendar_none"
        });
    }

    for (
        let day = 1;
        day <= daysInMonth;
        day++
    ) {
        row.push({
            text: String(day),
            callback_data: `birth_day_${year}_${month}_${day}`
        });

        if (row.length === 7) {
            buttons.push(row);
            row = [];
        }
    }

    if (row.length > 0) {
        while (row.length < 7) {
            row.push({
                text: "·",
                callback_data: "calendar_none"
            });
        }

        buttons.push(row);
    }

    buttons.push([
        {
            text: "⬅️ К месяцам",
            callback_data: `birth_change_month_${year}`
        }
    ]);

    return await editInlineMessage(
        chatId,
        messageId,
        `🎂 ${MONTHS[month - 1]} ${year}\n\nВыберите день:`,
        buttons
    );
}

// =====================================================
// ПРОВЕРКА ДАТЫ РОЖДЕНИЯ
// =====================================================

function isValidBirthDate(year, month, day) {
    const date = new Date(
        year,
        month - 1,
        day
    );

    if (
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day
    ) {
        return false;
    }

    const today = new Date();

    if (date > today) {
        return false;
    }

    return true;
}

// =====================================================
// СОХРАНЕНИЕ ПАССАЖИРА
// =====================================================

async function addPassenger(chatId) {
    const state = userStates[chatId];

    if (!state || !state.data) {
        return;
    }

    try {
        const flightDate = state.data[6];
        const route = state.data[7];
        const status = state.data[8];

        // =============================================
        // ПОВТОРНАЯ ПРОВЕРКА ПЕРЕД СОХРАНЕНИЕМ
        // =============================================

        if (status !== "Отменен") {
            const occupancy = await checkFlightAvailability(
                flightDate,
                route
            );

            if (occupancy.isFull) {
                await sendMessage(
                    chatId,
                    "🔴 Рейс заполнен.\n\n" +
                    `✈️ Маршрут: ${route}\n` +
                    `📅 Дата: ${flightDate}\n\n` +
                    `👥 Занято: ${occupancy.count}/${MAX_SEATS}\n` +
                    "Регистрация нового пассажира невозможна."
                );

                await showMainMenu(chatId);

                return;
            }
        }

        // =============================================
        // ПОЛУЧАЕМ ЛИСТ
        // =============================================

        const sheetTitle = await getSheetTitle();

        const passengerId = `P-${Date.now()}`;

        const values = [
            passengerId,
            state.data[0], // Фамилия
            state.data[1], // Имя
            state.data[2], // Отчество
            state.data[3], // Дата рождения
            state.data[4], // Паспорт
            state.data[5], // Гражданство
            state.data[6], // Дата рейса
            state.data[7], // Маршрут
            state.data[8]  // Статус
        ];

        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheetTitle}!A:J`,
            valueInputOption: "USER_ENTERED",
            requestBody: {
                values: [values]
            }
        });

        // =============================================
        // СОХРАНЯЕМ ПОСЛЕДНЕГО ПАССАЖИРА
        // =============================================

        lastPassengers[chatId] = {
            id: passengerId,
            surname: state.data[0],
            name: state.data[1],
            patronymic: state.data[2],
            birthDate: state.data[3],
            passport: state.data[4],
            citizenship: state.data[5],
            flightDate: state.data[6],
            route: state.data[7],
            status: state.data[8]
        };

        // =============================================
        // ПОЛУЧАЕМ НОВУЮ ЗАГРУЗКУ
        // =============================================

        const newOccupancy = await getFlightOccupancy(
            flightDate,
            route
        );

        await removeKeyboard(chatId);

        await sendMessage(
            chatId,
            "✅ Пассажир успешно зарегистрирован!\n\n" +
            `🆔 ID: ${passengerId}\n` +
            `👤 ${state.data[0]} ${state.data[1]}\n` +
            `📅 Дата рождения: ${state.data[3]}\n` +
            `✈️ Дата рейса: ${state.data[6]}\n` +
            `🛫 Маршрут: ${state.data[7]}\n` +
            `📌 Статус: ${state.data[8]}\n\n` +
            `💺 Загрузка маршрута: ${newOccupancy}/${MAX_SEATS}\n` +
            `🟢 Свободно: ${MAX_SEATS - newOccupancy}\n\n` +
            "Что хотите сделать дальше?",
            [
                ["➕ Добавить ещё одного"],
                ["👤 Посмотреть данные"],
                ["🏠 Главное меню"]
            ]
        );

        // =============================================
        // ЕСЛИ РЕЙС ЗАПОЛНИЛСЯ
        // =============================================

        if (
            newOccupancy >= MAX_SEATS &&
            status !== "Отменен"
        ) {
            await sendMessage(
                chatId,
                "🔴 Внимание!\n\n" +
                `Рейс ${route} на ${flightDate} полностью заполнен.\n` +
                `💺 ${MAX_SEATS}/${MAX_SEATS}\n\n` +
                "Новые пассажиры на этот маршрут и дату зарегистрированы быть не смогут."
            );
        }

        userStates[chatId] = {
            step: 0,
            data: []
        };

    } catch (error) {
        console.error(
            "Ошибка Google Sheets:",
            error
        );

        await sendMessage(
            chatId,
            "❌ Произошла ошибка при сохранении пассажира.\n\nПопробуйте ещё раз."
        );
    }
}

// =====================================================
// INLINE CALLBACK
// =====================================================

async function handleCallbackQuery(callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    const data = callbackQuery.data;

    await answerCallbackQuery(
        callbackQuery.id
    );

    const state = userStates[chatId];

    if (!state) {
        await sendMessage(
            chatId,
            "Сессия регистрации закончилась. Нажмите /start."
        );

        return;
    }

    // =================================================
    // НЕАКТИВНАЯ КНОПКА
    // =================================================

    if (data === "calendar_none") {
        return;
    }

    // =================================================
    // СТРАНИЦА ГОДОВ
    // =================================================

    if (data.startsWith("birth_year_page_")) {
        const pageEndYear = Number(
            data.replace(
                "birth_year_page_",
                ""
            )
        );

        await showBirthYears(
            chatId,
            messageId,
            pageEndYear
        );

        return;
    }

    // =================================================
    // ВЫБОР ГОДА
    // =================================================

    if (data.startsWith("birth_year_")) {
        const year = Number(
            data.replace(
                "birth_year_",
                ""
            )
        );

        state.birthYear = year;

        await showBirthMonths(
            chatId,
            messageId,
            year
        );

        return;
    }

    // =================================================
    // ВЕРНУТЬСЯ К ГОДАМ
    // =================================================

    if (data === "birth_change_year") {
        const year =
            state.birthYear ||
            new Date().getFullYear();

        await showBirthYears(
            chatId,
            messageId,
            year
        );

        return;
    }

    // =================================================
    // ВЫБОР МЕСЯЦА
    // =================================================

    if (data.startsWith("birth_month_")) {
        const parts = data.split("_");

        const year = Number(parts[2]);
        const month = Number(parts[3]);

        state.birthYear = year;
        state.birthMonth = month;

        await showBirthDays(
            chatId,
            messageId,
            year,
            month
        );

        return;
    }

    // =================================================
    // ВЕРНУТЬСЯ К МЕСЯЦАМ
    // =================================================

    if (
        data.startsWith(
            "birth_change_month_"
        )
    ) {
        const year = Number(
            data.replace(
                "birth_change_month_",
                ""
            )
        );

        await showBirthMonths(
            chatId,
            messageId,
            year
        );

        return;
    }

    // =================================================
    // ВЫБОР ДНЯ
    // =================================================

    if (data.startsWith("birth_day_")) {
        const parts = data.split("_");

        const year = Number(parts[2]);
        const month = Number(parts[3]);
        const day = Number(parts[4]);

        if (
            !isValidBirthDate(
                year,
                month,
                day
            )
        ) {
            await answerCallbackQuery(
                callbackQuery.id,
                "❌ Некорректная дата."
            );

            return;
        }

        const formattedDate =
            String(day).padStart(2, "0") +
            "." +
            String(month).padStart(2, "0") +
            "." +
            year;

        state.data[3] = formattedDate;

        // Меняем ТО ЖЕ сообщение
        await editInlineMessage(
            chatId,
            messageId,
            `🎂 Дата рождения\n\n✅ ${formattedDate}`,
            []
        );

        state.step = 5;

        await sendMessage(
            chatId,
            "Шаг 5 из 9\n\nВведите номер паспорта:"
        );

        return;
    }

    // =================================================
    // МАРШРУТ ДШБ — ХРГ
    // =================================================

    if (
        data ===
        "route_dushanbe_khorog"
    ) {
        const route = "ДШБ — ХРГ";
        const flightDate = state.data[6];

        try {
            const occupancy =
                await checkFlightAvailability(
                    flightDate,
                    route
                );

            if (occupancy.isFull) {
                await editInlineMessage(
                    chatId,
                    messageId,
                    "🔴 Рейс заполнен\n\n" +
                    `✈️ ${route}\n` +
                    `📅 ${flightDate}\n\n` +
                    `💺 ${occupancy.count}/${MAX_SEATS}\n\n` +
                    "Регистрация новых пассажиров на этот маршрут и дату закрыта.",
                    []
                );

                await showMainMenu(chatId);

                return;
            }

            state.data[7] = route;
            state.step = 9;

            await editInlineMessage(
                chatId,
                messageId,
                `🛫 Маршрут: ${route}\n\n` +
                `💺 Занято: ${occupancy.count}/${MAX_SEATS}\n` +
                `🟢 Свободно: ${occupancy.available}`,
                []
            );

            await showStatusButtons(chatId);

        } catch (error) {
            console.error(
                "Ошибка проверки рейса:",
                error
            );

            await sendMessage(
                chatId,
                "❌ Не удалось проверить количество свободных мест."
            );
        }

        return;
    }

    // =================================================
    // МАРШРУТ ХРГ — ДШБ
    // =================================================

    if (
        data ===
        "route_khorog_dushanbe"
    ) {
        const route = "ХРГ — ДШБ";
        const flightDate = state.data[6];

        try {
            const occupancy =
                await checkFlightAvailability(
                    flightDate,
                    route
                );

            if (occupancy.isFull) {
                await editInlineMessage(
                    chatId,
                    messageId,
                    "🔴 Рейс заполнен\n\n" +
                    `✈️ ${route}\n` +
                    `📅 ${flightDate}\n\n` +
                    `💺 ${occupancy.count}/${MAX_SEATS}\n\n` +
                    "Регистрация новых пассажиров на этот маршрут и дату закрыта.",
                    []
                );

                await showMainMenu(chatId);

                return;
            }

            state.data[7] = route;
            state.step = 9;

            await editInlineMessage(
                chatId,
                messageId,
                `🛬 Маршрут: ${route}\n\n` +
                `💺 Занято: ${occupancy.count}/${MAX_SEATS}\n` +
                `🟢 Свободно: ${occupancy.available}`,
                []
            );

            await showStatusButtons(chatId);

        } catch (error) {
            console.error(
                "Ошибка проверки рейса:",
                error
            );

            await sendMessage(
                chatId,
                "❌ Не удалось проверить количество свободных мест."
            );
        }

        return;
    }

    // =================================================
    // СТАТУС
    // =================================================

    if (data === "status_confirmed") {
        state.data[8] = "Подтвержден";
    }

    if (data === "status_waiting") {
        state.data[8] = "Ожидание";
    }

    if (data === "status_cancelled") {
        state.data[8] = "Отменен";
    }

    if (
        data === "status_confirmed" ||
        data === "status_waiting" ||
        data === "status_cancelled"
    ) {
        await editInlineMessage(
            chatId,
            messageId,
            `📌 Статус: ${state.data[8]}`,
            []
        );

        await addPassenger(chatId);

        return;
    }
}

// =====================================================
// КНОПКИ СТАТУСА
// =====================================================

async function showStatusButtons(chatId) {
    await sendInlineMessage(
        chatId,
        "Шаг 9 из 9\n\nВыберите статус пассажира:",
        [
            [
                {
                    text: "✅ Подтвержден",
                    callback_data: "status_confirmed"
                }
            ],
            [
                {
                    text: "⏳ Ожидание",
                    callback_data: "status_waiting"
                }
            ],
            [
                {
                    text: "❌ Отменен",
                    callback_data: "status_cancelled"
                }
            ]
        ]
    );
}

// =====================================================
// ОБРАБОТКА ТЕКСТА
// =====================================================

async function handleTextMessage(message) {
    const chatId = message.chat.id;
    const text = message.text;

    // =================================================
    // START
    // =================================================

    if (text === "/start") {
        await showMainMenu(chatId);
        return;
    }

    // =================================================
    // ДОБАВИТЬ ПАССАЖИРА
    // =================================================

    if (text === "➕ Добавить пассажира") {
        await startPassengerRegistration(chatId);
        return;
    }

    if (text === "➕ Добавить ещё одного") {
        await startPassengerRegistration(chatId);
        return;
    }

    // =================================================
    // ГЛАВНОЕ МЕНЮ
    // =================================================

    if (text === "🏠 Главное меню") {
        await showMainMenu(chatId);
        return;
    }

    // =================================================
    // ПРОСМОТР ДАННЫХ
    // =================================================

    if (text === "👤 Посмотреть данные") {
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
            "👤 Последний зарегистрированный пассажир:\n\n" +
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

    // =================================================
    // ПОИСК
    // =================================================

    if (text === "🔎 Найти пассажира") {
        await sendMessage(
            chatId,
            "🔎 Функция поиска пассажира будет подключена следующим этапом."
        );

        return;
    }

    // =================================================
    // ПАССАЖИРЫ РЕЙСА
    // =================================================

    if (text === "✈️ Пассажиры рейса") {
        await sendMessage(
            chatId,
            "✈️ Функция списка пассажиров рейса будет подключена следующим этапом."
        );

        return;
    }

    // =================================================
    // СТАТИСТИКА
    // =================================================

    if (text === "📊 Статистика") {
        await sendMessage(
            chatId,
            "📊 Функция статистики будет подключена следующим этапом."
        );

        return;
    }

    const state = userStates[chatId];

    if (!state) {
        await sendMessage(
            chatId,
            "Нажмите /start для начала работы."
        );

        return;
    }

    // =================================================
    // ШАГ 1 — ФАМИЛИЯ
    // =================================================

    if (state.step === 1) {
        state.data[0] = text;
        state.step = 2;

        await sendMessage(
            chatId,
            "Шаг 2 из 9\n\nВведите имя пассажира:"
        );

        return;
    }

    // =================================================
    // ШАГ 2 — ИМЯ
    // =================================================

    if (state.step === 2) {
        state.data[1] = text;
        state.step = 3;

        await sendMessage(
            chatId,
            "Шаг 3 из 9\n\nВведите отчество пассажира:"
        );

        return;
    }

    // =================================================
    // ШАГ 3 — ОТЧЕСТВО
    // =================================================

    if (state.step === 3) {
        state.data[2] = text;
        state.step = 4;

        await removeKeyboard(chatId);

        // Календарь создаётся один раз
        await showBirthYears(chatId);

        return;
    }

    // =================================================
    // ШАГ 5 — ПАСПОРТ
    // =================================================

    if (state.step === 5) {
        state.data[4] = text;
        state.step = 6;

        await sendMessage(
            chatId,
            "Шаг 6 из 9\n\nВведите гражданство:"
        );

        return;
    }

    // =================================================
    // ШАГ 6 — ГРАЖДАНСТВО
    // =================================================

    if (state.step === 6) {
        state.data[5] = text;
        state.step = 7;

        await sendMessage(
            chatId,
            "Шаг 7 из 9\n\nВведите дату рейса:"
        );

        return;
    }

    // =================================================
    // ШАГ 7 — ДАТА РЕЙСА
    // =================================================

    if (state.step === 7) {
        state.data[6] = text;
        state.step = 8;

        await sendInlineMessage(
            chatId,
            "Шаг 8 из 9\n\nВыберите маршрут:",
            [
                [
                    {
                        text: "✈️ ДШБ — ХРГ",
                        callback_data:
                            "route_dushanbe_khorog"
                    }
                ],
                [
                    {
                        text: "✈️ ХРГ — ДШБ",
                        callback_data:
                            "route_khorog_dushanbe"
                    }
                ]
            ]
        );

        return;
    }
}

// =====================================================
// WEBHOOK
// =====================================================

app.post("/telegram/webhook", async (req, res) => {
    res.sendStatus(200);

    try {
        const update = req.body;

        if (update.callback_query) {
            await handleCallbackQuery(
                update.callback_query
            );

            return;
        }

        if (
            update.message &&
            update.message.text
        ) {
            await handleTextMessage(
                update.message
            );

            return;
        }

    } catch (error) {
        console.error(
            "Ошибка обработки Telegram:",
            error
        );
    }
});

// =====================================================
// HEALTH CHECK
// =====================================================

app.get("/", (req, res) => {
    res.send(
        "KMRN Passenger Bot is running"
    );
});

// =====================================================
// SERVER
// =====================================================

app.listen(PORT, () => {
    console.log(
        `KMRN Passenger Bot запущен на порту ${PORT}`
    );
});
