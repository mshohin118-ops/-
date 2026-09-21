require("dotenv").config();

const express = require("express");
const { google } = require("googleapis");
const XLSX = require("xlsx");

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

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

const TELEGRAM_WEBHOOK_SECRET =
  process.env.TELEGRAM_WEBHOOK_SECRET || "";

const PUBLIC_URL = process.env.PUBLIC_URL;

/* =========================================================
   SETTINGS
========================================================= */

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
  "Декабрь",
];

const WEEKDAYS = [
  "Вс",
  "Пн",
  "Вт",
  "Ср",
  "Чт",
  "Пт",
  "Сб",
];

const ROUTES = [
  "ДШБ — ХРГ",
  "ХРГ — ДШБ",
];

const STATUSES = [
  "Забронирован",
  "Подтвержден",
  "Отменен",
];

/* =========================================================
   EXCEL
========================================================= */

const EXCEL_HEADERS = [
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
  "Статус",
];

/* =========================================================
   STATES
========================================================= */

const states = new Map();

let cachedSheetTitle = null;

/* =========================================================
   TELEGRAM
========================================================= */

async function telegramRequest(method, body = {}) {
  const response = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  const data = await response.json();

  if (!data.ok) {
    console.error(`Telegram ${method} error:`, data);
  }

  return data;
}

async function sendMessage(chatId, text, replyMarkup = null) {
  const body = {
    chat_id: chatId,
    text,
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
    text,
  };

  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }

  return telegramRequest("editMessageText", body);
}

async function answerCallbackQuery(callbackQueryId, text = "") {
  return telegramRequest("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
  });
}

async function deleteUserMessage(chatId, messageId) {
  try {
    await telegramRequest("deleteMessage", {
      chat_id: chatId,
      message_id: messageId,
    });
  } catch (error) {
    console.error("Ошибка удаления сообщения:", error);
  }
}

/* =========================================================
   GOOGLE SHEETS
========================================================= */

function getGoogleAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: GOOGLE_CLIENT_EMAIL,
      private_key: GOOGLE_PRIVATE_KEY,
    },
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
    ],
  });
}

async function getSheets() {
  const auth = getGoogleAuth();

  return google.sheets({
    version: "v4",
    auth,
  });
}

async function getSheetTitle() {
  if (cachedSheetTitle) {
    return cachedSheetTitle;
  }

  const sheets = await getSheets();

  const response =
    await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
      fields: "sheets.properties",
    });

  const sheet =
    response.data.sheets &&
    response.data.sheets[0];

  if (!sheet) {
    throw new Error("В Google Sheets нет листов.");
  }

  cachedSheetTitle = sheet.properties.title;

  return cachedSheetTitle;
}

async function getAllPassengers() {
  const sheets = await getSheets();
  const sheetTitle = await getSheetTitle();

  const response =
    await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetTitle}!A:L`,
    });

  const values = response.data.values || [];

  return values;
}

/* =========================================================
   HELPERS
========================================================= */

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizePassport(value) {
  return normalizeText(value)
    .replace(/\s+/g, "")
    .toUpperCase();
}

function createState(chatId, data = {}) {
  const state = {
    chatId,
    mode: null,
    step: null,
    data: {},
    ...data,
  };

  states.set(chatId, state);

  return state;
}

function getState(chatId) {
  return states.get(chatId);
}

function generatePassengerId() {
  const now = new Date();

  const part1 = String(now.getTime()).slice(-8);

  const part2 = Math.floor(
    100 + Math.random() * 900
  );

  return `P${part1}${part2}`;
}

function validateTajikPhone(phone) {
  const value = normalizeText(phone);

  return /^(\+992\d{9}|992\d{9}|9\d{8})$/.test(
    value.replace(/[\s()-]/g, "")
  );
}

function isValidDateString(value) {
  const text = normalizeText(value);

  if (!/^\d{2}\.\d{2}\.\d{4}$/.test(text)) {
    return false;
  }

  const [day, month, year] = text
    .split(".")
    .map(Number);

  const date = new Date(
    year,
    month - 1,
    day
  );

  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function formatDate(value) {
  if (!value) return "";

  if (value instanceof Date) {
    const day = String(value.getDate()).padStart(2, "0");
    const month = String(
      value.getMonth() + 1
    ).padStart(2, "0");
    const year = value.getFullYear();

    return `${day}.${month}.${year}`;
  }

  return normalizeText(value);
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
          callback_data: "main_add",
        },
      ],
      [
        {
          text: "📥 Загрузить Excel",
          callback_data: "main_upload_excel",
        },
      ],
      [
        {
          text: "👤 Посмотреть данные",
          callback_data: "main_view",
        },
      ],
      [
        {
          text: "🔎 Найти пассажира",
          callback_data: "main_find",
        },
      ],
      [
        {
          text: "✈️ Пассажиры рейса",
          callback_data: "main_flight",
        },
      ],
      [
        {
          text: "📊 Статистика",
          callback_data: "main_statistics",
        },
      ],
    ],
  };
}

async function showMainMenu(chatId, messageId = null) {
  const text =
    "✈️ KMRN Passenger Bot\n\n" +
    "Выберите необходимое действие:";

  if (messageId) {
    return editMessage(
      chatId,
      messageId,
      text,
      getMainMenuKeyboard()
    );
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

function startRegistration(chatId) {
  createState(chatId, {
    mode: "registration",
    step: 0,
    data: {},
  });

  return askRegistrationStep(chatId);
}

async function askRegistrationStep(chatId) {
  const state = getState(chatId);

  if (!state) return;

  switch (state.step) {
    case 0:
      return sendMessage(
        chatId,
        "Введите фамилию:"
      );

    case 1:
      return sendMessage(
        chatId,
        "Введите имя:"
      );

    case 2:
      return sendMessage(
        chatId,
        "Введите отчество:\n\n" +
          "Если отчества нет, напишите: —"
      );

    case 3:
      return showCalendar(
        chatId,
        "birth",
        state.data.birthDate
      );

    case 4:
      return sendMessage(
        chatId,
        "Введите номер паспорта:"
      );

    case 5:
      return showCitizenshipMenu(chatId);

    case 6:
      return showContact1Menu(chatId);

    case 7:
      return showContact2Menu(chatId);

    case 8:
      return showCalendar(
        chatId,
        "flight",
        state.data.flightDate
      );

    case 9:
      return showRouteMenu(chatId);

    case 10:
      return showStatusMenu(chatId);

    default:
      return finishRegistration(chatId);
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
          text: "🇹🇯 Таджикистан",
          callback_data: "reg_cit_TJ",
        },
      ],
      [
        {
          text: "🇷🇺 Россия",
          callback_data: "reg_cit_RU",
        },
      ],
      [
        {
          text: "🇺🇿 Узбекистан",
          callback_data: "reg_cit_UZ",
        },
      ],
      [
        {
          text: "🌍 Другое",
          callback_data: "reg_cit_other",
        },
      ],
      [
        {
          text: "⬅️ Назад",
          callback_data: "reg_back_4",
        },
      ],
    ],
  };
}

async function showCitizenshipMenu(chatId) {
  return sendMessage(
    chatId,
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
          text: "📱 Ввести номер",
          callback_data: "reg_contact1_enter",
        },
      ],
      [
        {
          text: "⏭ Пропустить",
          callback_data: "reg_contact1_skip",
        },
      ],
      [
        {
          text: "⬅️ Назад",
          callback_data: "reg_back_5",
        },
      ],
    ],
  };
}

function getContact2Keyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: "📱 Ввести номер",
          callback_data: "reg_contact2_enter",
        },
      ],
      [
        {
          text: "⏭ Пропустить",
          callback_data: "reg_contact2_skip",
        },
      ],
      [
        {
          text: "⬅️ Назад",
          callback_data: "reg_back_6",
        },
      ],
    ],
  };
}

async function showContact1Menu(chatId) {
  return sendMessage(
    chatId,
    "Введите первый контакт:",
    getContact1Keyboard()
  );
}

async function showContact2Menu(chatId) {
  return sendMessage(
    chatId,
    "Введите второй контакт:",
    getContact2Keyboard()
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
          text: ROUTES[0],
          callback_data: "reg_route_0",
        },
      ],
      [
        {
          text: ROUTES[1],
          callback_data: "reg_route_1",
        },
      ],
      [
        {
          text: "⬅️ Назад",
          callback_data: "reg_back_8",
        },
      ],
    ],
  };
}

async function showRouteMenu(chatId) {
  return sendMessage(
    chatId,
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
          text: "🟡 Забронирован",
          callback_data: "reg_status_0",
        },
      ],
      [
        {
          text: "🟢 Подтвержден",
          callback_data: "reg_status_1",
        },
      ],
      [
        {
          text: "🔴 Отменен",
          callback_data: "reg_status_2",
        },
      ],
      [
        {
          text: "⬅️ Назад",
          callback_data: "reg_back_9",
        },
      ],
    ],
  };
}

async function showStatusMenu(chatId) {
  return sendMessage(
    chatId,
    "Выберите статус:",
    getStatusKeyboard()
  );
}

/* =========================================================
   CALENDAR
========================================================= */

function getCalendarTitle(type, year, month) {
  if (type === "birth") {
    return `Дата рождения\n\n${MONTHS[month]} ${year}`;
  }

  return `Дата рейса\n\n${MONTHS[month]} ${year}`;
}

function getBirthYears() {
  const currentYear = new Date().getFullYear();

  const years = [];

  for (
    let year = currentYear - 100;
    year <= currentYear;
    year++
  ) {
    years.push(year);
  }

  return years;
}

function getFlightYears() {
  const currentYear = new Date().getFullYear();

  return [
    currentYear,
    currentYear + 1,
    currentYear + 2,
  ];
}

function getYearsKeyboard(type) {
  const years =
    type === "birth"
      ? getBirthYears()
      : getFlightYears();

  const rows = [];

  for (let i = 0; i < years.length; i += 4) {
    rows.push(
      years.slice(i, i + 4).map((year) => ({
        text: String(year),
        callback_data:
          `cal_${type}_year_${year}`,
      }))
    );
  }

  rows.push([
    {
      text: "❌ Отмена",
      callback_data: "main_menu",
    },
  ]);

  return {
    inline_keyboard: rows,
  };
}

function getMonthsKeyboard(type, year) {
  const rows = [];

  for (let i = 0; i < 12; i += 3) {
    rows.push(
      [i, i + 1, i + 2].map((month) => ({
        text: MONTHS[month],
        callback_data:
          `cal_${type}_month_${year}_${month}`,
      }))
    );
  }

  rows.push([
    {
      text: "⬅️ Назад",
      callback_data:
        `cal_${type}_back_year`,
    },
  ]);

  return {
    inline_keyboard: rows,
  };
}

function getDaysKeyboard(type, year, month) {
  const date = new Date(
    year,
    month + 1,
    0
  );

  const daysInMonth = date.getDate();

  const firstDay = new Date(
    year,
    month,
    1
  ).getDay();

  const rows = [];

  rows.push(
    WEEKDAYS.map((day) => ({
      text: day,
      callback_data: "noop",
    }))
  );

  let row = [];

  for (let i = 0; i < firstDay; i++) {
    row.push({
      text: " ",
      callback_data: "noop",
    });
  }

  for (let day = 1; day <= daysInMonth; day++) {
    row.push({
      text: String(day),
      callback_data:
        `cal_${type}_day_${year}_${month}_${day}`,
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
        callback_data: "noop",
      });
    }

    rows.push(row);
  }

  rows.push([
    {
      text: "⬅️ Назад",
      callback_data:
        `cal_${type}_back_month_${year}`,
    },
  ]);

  return {
    inline_keyboard: rows,
  };
}

async function showCalendar(
  chatId,
  type,
  currentValue = ""
) {
  let text =
    type === "birth"
      ? "Выберите год рождения:"
      : "Выберите год рейса:";

  return sendMessage(
    chatId,
    text,
    getYearsKeyboard(type)
  );
}

/* =========================================================
   OCCUPANCY
========================================================= */

async function calculateRouteOccupancy(
  flightDate,
  route,
  excludeRowNumber = null
) {
  const values = await getAllPassengers();

  let count = 0;

  for (let i = 1; i < values.length; i++) {
    const row = values[i];

    const rowNumber = i + 1;

    if (
      excludeRowNumber &&
      rowNumber === excludeRowNumber
    ) {
      continue;
    }

    const rowFlightDate = normalizeText(
      row[9]
    );

    const rowRoute = normalizeText(
      row[10]
    );

    const rowStatus = normalizeText(
      row[11]
    );

    if (
      rowFlightDate === flightDate &&
      rowRoute === route &&
      rowStatus !== "Отменен"
    ) {
      count++;
    }
  }

  return count;
}

/* =========================================================
   SAVE PASSENGER
========================================================= */

async function savePassenger(data) {
  const sheets = await getSheets();
  const sheetTitle = await getSheetTitle();

  const id = data.id || generatePassengerId();

  const values = [
    [
      id,
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
      data.status || "",
    ],
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetTitle}!A:L`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values,
    },
  });

  return id;
}

async function updatePassenger(
  rowNumber,
  data
) {
  const sheets = await getSheets();
  const sheetTitle = await getSheetTitle();

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetTitle}!A${rowNumber}:L${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [
          data.id || "",
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
          data.status || "",
        ],
      ],
    },
  });
}

/* =========================================================
   PASSENGER CARD
========================================================= */

function buildPassengerCard(
  passenger
) {
  return (
    `👤 Данные пассажира\n\n` +
    `🆔 ID: ${passenger.id || "—"}\n` +
    `Фамилия: ${passenger.surname || "—"}\n` +
    `Имя: ${passenger.name || "—"}\n` +
    `Отчество: ${passenger.patronymic || "—"}\n` +
    `Дата рождения: ${passenger.birthDate || "—"}\n` +
    `Паспорт: ${passenger.passport || "—"}\n` +
    `Гражданство: ${passenger.citizenship || "—"}\n` +
    `Контакт 1: ${passenger.contact1 || "—"}\n` +
    `Контакт 2: ${passenger.contact2 || "—"}\n` +
    `Дата рейса: ${passenger.flightDate || "—"}\n` +
    `Маршрут: ${passenger.route || "—"}\n` +
    `Статус: ${passenger.status || "—"}`
  );
}

function getPassengerCardKeyboard(
  rowNumber
) {
  return {
    inline_keyboard: [
      [
        {
          text: "✏️ Редактировать",
          callback_data:
            `edit_passenger_${rowNumber}`,
        },
      ],
      [
        {
          text: "⬅️ Назад",
          callback_data: "view_back",
        },
      ],
    ],
  };
}

async function showPassengerCard(
  chatId,
  passenger,
  rowNumber,
  messageId = null
) {
  const text = buildPassengerCard(
    passenger
  );

  const keyboard =
    getPassengerCardKeyboard(rowNumber);

  if (messageId) {
    return editMessage(
      chatId,
      messageId,
      text,
      keyboard
    );
  }

  return sendMessage(
    chatId,
    text,
    keyboard
  );
}

function rowToPassenger(row) {
  return {
    id: row[0] || "",
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
    status: row[11] || "",
  };
}

/* =========================================================
   GET PASSENGER BY ROW
========================================================= */

async function getPassengerByRowNumber(
  rowNumber
) {
  const values = await getAllPassengers();

  const index = Number(rowNumber) - 1;

  if (
    index < 1 ||
    index >= values.length
  ) {
    return null;
  }

  return rowToPassenger(values[index]);
}

async function showPassengerCardByRow(
  chatId,
  rowNumber,
  messageId = null
) {
  const passenger =
    await getPassengerByRowNumber(
      rowNumber
    );

  if (!passenger) {
    return sendMessage(
      chatId,
      "❌ Пассажир не найден."
    );
  }

  return showPassengerCard(
    chatId,
    passenger,
    rowNumber,
    messageId
  );
}

/* =========================================================
   EDIT MENU
========================================================= */

function getEditMenuKeyboard(
  rowNumber
) {
  return {
    inline_keyboard: [
      [
        {
          text: "Фамилия",
          callback_data:
            `edit_field_surname_${rowNumber}`,
        },
        {
          text: "Имя",
          callback_data:
            `edit_field_name_${rowNumber}`,
        },
      ],
      [
        {
          text: "Отчество",
          callback_data:
            `edit_field_patronymic_${rowNumber}`,
        },
      ],
      [
        {
          text: "Дата рождения",
          callback_data:
            `edit_field_birthDate_${rowNumber}`,
        },
      ],
      [
        {
          text: "Паспорт",
          callback_data:
            `edit_field_passport_${rowNumber}`,
        },
      ],
      [
        {
          text: "Гражданство",
          callback_data:
            `edit_field_citizenship_${rowNumber}`,
        },
      ],
      [
        {
          text: "Контакт 1",
          callback_data:
            `edit_field_contact1_${rowNumber}`,
        },
        {
          text: "Контакт 2",
          callback_data:
            `edit_field_contact2_${rowNumber}`,
        },
      ],
      [
        {
          text: "Дата рейса",
          callback_data:
            `edit_field_flightDate_${rowNumber}`,
        },
      ],
      [
        {
          text: "Маршрут",
          callback_data:
            `edit_field_route_${rowNumber}`,
        },
      ],
      [
        {
          text: "Статус",
          callback_data:
            `edit_field_status_${rowNumber}`,
        },
      ],
      [
        {
          text: "⬅️ Назад",
          callback_data:
            `edit_back_${rowNumber}`,
        },
      ],
    ],
  };
}

async function showEditMenu(
  chatId,
  rowNumber,
  messageId = null
) {
  const text =
    "✏️ Выберите поле для редактирования:";

  if (messageId) {
    return editMessage(
      chatId,
      messageId,
      text,
      getEditMenuKeyboard(rowNumber)
    );
  }

  return sendMessage(
    chatId,
    text,
    getEditMenuKeyboard(rowNumber)
  );
}

/* =========================================================
   UPDATE FIELD
========================================================= */

async function updatePassengerField(
  chatId,
  rowNumber,
  field,
  value
) {
  const passenger =
    await getPassengerByRowNumber(
      rowNumber
    );

  if (!passenger) {
    await sendMessage(
      chatId,
      "❌ Пассажир не найден."
    );

    return;
  }

  if (field === "passport") {
    const values = await getAllPassengers();

    const newPassport =
      normalizePassport(value);

    for (let i = 1; i < values.length; i++) {
      const currentRowNumber = i + 1;

      if (
        currentRowNumber === Number(rowNumber)
      ) {
        continue;
      }

      const existingPassport =
        normalizePassport(values[i][5]);

      if (
        existingPassport &&
        existingPassport === newPassport
      ) {
        await sendMessage(
          chatId,
          "❌ Такой номер паспорта уже существует."
        );

        return;
      }
    }
  }

  if (
    field === "flightDate" ||
    field === "birthDate"
  ) {
    if (!isValidDateString(value)) {
      await sendMessage(
        chatId,
        "❌ Неверная дата. Используйте формат ДД.ММ.ГГГГ."
      );

      return;
    }
  }

  if (field === "contact1" || field === "contact2") {
    if (
      value &&
      !validateTajikPhone(value)
    ) {
      await sendMessage(
        chatId,
        "❌ Неверный номер телефона."
      );

      return;
    }
  }

  if (field === "flightDate") {
    if (passenger.route) {
      const occupancy =
        await calculateRouteOccupancy(
          value,
          passenger.route,
          Number(rowNumber)
        );

      if (
        passenger.status !== "Отменен" &&
        occupancy >= CAPACITY
      ) {
        await sendMessage(
          chatId,
          `❌ На рейсе ${value}, ${passenger.route} уже ${occupancy}/${CAPACITY} пассажиров.`
        );

        return;
      }
    }
  }

  if (field === "route") {
    const occupancy =
      await calculateRouteOccupancy(
        passenger.flightDate,
        value,
        Number(rowNumber)
      );

    if (
      passenger.status !== "Отменен" &&
      occupancy >= CAPACITY
    ) {
      await sendMessage(
        chatId,
        `❌ На рейсе ${passenger.flightDate}, ${value} уже ${occupancy}/${CAPACITY} пассажиров.`
      );

      return;
    }
  }

  if (field === "status") {
    if (!STATUSES.includes(value)) {
      await sendMessage(
        chatId,
        "❌ Неверный статус."
      );

      return;
    }

    if (
      value !== "Отменен"
    ) {
      const occupancy =
        await calculateRouteOccupancy(
          passenger.flightDate,
          passenger.route,
          Number(rowNumber)
        );

      if (occupancy >= CAPACITY) {
        await sendMessage(
          chatId,
          `❌ Нельзя активировать пассажира. Рейс заполнен ${occupancy}/${CAPACITY}.`
        );

        return;
      }
    }
  }

  passenger[field] = value;

  await updatePassenger(
    Number(rowNumber),
    passenger
  );

  await sendMessage(
    chatId,
    "✅ Данные пассажира обновлены."
  );

  await showPassengerCardByRow(
    chatId,
    rowNumber
  );
}

/* =========================================================
   VIEW DATA
========================================================= */

function getViewDataKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: "👥 Все пассажиры",
          callback_data: "view_all",
        },
      ],
      [
        {
          text: "📅 По дате",
          callback_data: "view_date",
        },
      ],
      [
        {
          text: "✈️ По маршруту",
          callback_data: "view_route",
        },
      ],
      [
        {
          text: "🔎 По паспорту / ID",
          callback_data: "view_search",
        },
      ],
      [
        {
          text: "⬅️ Назад",
          callback_data: "main_menu",
        },
      ],
    ],
  };
}

async function showViewDataMenu(
  chatId,
  messageId = null
) {
  const text =
    "👤 Просмотр данных\n\n" +
    "Выберите способ просмотра:";

  if (messageId) {
    return editMessage(
      chatId,
      messageId,
      text,
      getViewDataKeyboard()
    );
  }

  return sendMessage(
    chatId,
    text,
    getViewDataKeyboard()
  );
}

async function getPassengerObjects() {
  const values = await getAllPassengers();

  const result = [];

  for (let i = 1; i < values.length; i++) {
    result.push({
      rowNumber: i + 1,
      passenger: rowToPassenger(
        values[i]
      ),
    });
  }

  return result;
}

function getPassengerListText(
  passengers,
  title = "👥 Пассажиры"
) {
  if (!passengers.length) {
    return `${title}\n\nПассажиры не найдены.`;
  }

  let text = `${title}\n\n`;

  passengers.forEach(
    (item, index) => {
      const p = item.passenger;

      text +=
        `${index + 1}. ` +
        `${p.surname} ${p.name}` +
        `${
          p.patronymic
            ? " " + p.patronymic
            : ""
        }\n` +
        `🆔 ${p.id || "—"} | ` +
        `Паспорт: ${p.passport || "—"}\n` +
        `✈️ ${p.flightDate || "—"} | ` +
        `${p.route || "—"}\n` +
        `Статус: ${p.status || "—"}\n\n`;
    }
  );

  return text;
}

function getPassengerListKeyboard(
  passengers,
  page = 0,
  prefix = "view_passenger"
) {
  const start =
    page * PAGE_SIZE;

  const pagePassengers =
    passengers.slice(
      start,
      start + PAGE_SIZE
    );

  const rows = pagePassengers.map(
    (item) => [
      {
        text:
          `${item.passenger.surname} ` +
          `${item.passenger.name}`,
        callback_data:
          `${prefix}_${item.rowNumber}`,
      },
    ]
  );

  const navigation = [];

  if (page > 0) {
    navigation.push({
      text: "⬅️",
      callback_data:
        `${prefix}_page_${page - 1}`,
    });
  }

  if (
    start + PAGE_SIZE <
    passengers.length
  ) {
    navigation.push({
      text: "➡️",
      callback_data:
        `${prefix}_page_${page + 1}`,
    });
  }

  if (navigation.length) {
    rows.push(navigation);
  }

  rows.push([
    {
      text: "⬅️ Назад",
      callback_data: "view_back",
    },
  ]);

  return {
    inline_keyboard: rows,
  };
}

async function showAllPassengers(
  chatId,
  page = 0,
  messageId = null
) {
  const passengers =
    await getPassengerObjects();

  const start =
    page * PAGE_SIZE;

  const pagePassengers =
    passengers.slice(
      start,
      start + PAGE_SIZE
    );

  const text =
    getPassengerListText(
      pagePassengers,
      `👥 Все пассажиры\nСтраница ${
        page + 1
      }`
    );

  const keyboard =
    getPassengerListKeyboard(
      passengers,
      page,
      "view_passenger"
    );

  if (messageId) {
    return editMessage(
      chatId,
      messageId,
      text,
      keyboard
    );
  }

  return sendMessage(
    chatId,
    text,
    keyboard
  );
}

/* =========================================================
   VIEW DATE
========================================================= */

async function showViewDateCalendar(
  chatId,
  year = null,
  month = null,
  messageId = null
) {
  if (year === null) {
    const years =
      getFlightYears();

    const rows = years.map(
      (y) => [
        {
          text: String(y),
          callback_data:
            `view_date_year_${y}`,
        },
      ]
    );

    rows.push([
      {
        text: "⬅️ Назад",
        callback_data:
          "view_back",
      },
    ]);

    const keyboard = {
      inline_keyboard: rows,
    };

    if (messageId) {
      return editMessage(
        chatId,
        messageId,
        "📅 Выберите год:",
        keyboard
      );
    }

    return sendMessage(
      chatId,
      "📅 Выберите год:",
      keyboard
    );
  }

  if (month === null) {
    const rows = [];

    for (let i = 0; i < 12; i += 3) {
      rows.push(
        [i, i + 1, i + 2].map(
          (m) => ({
            text: MONTHS[m],
            callback_data:
              `view_date_month_${year}_${m}`,
          })
        )
      );
    }

    rows.push([
      {
        text: "⬅️ Назад",
        callback_data:
          "view_date_year_back",
      },
    ]);

    const keyboard = {
      inline_keyboard: rows,
    };

    return editMessage(
      chatId,
      messageId,
      `📅 ${year}\n\nВыберите месяц:`,
      keyboard
    );
  }

  const date =
    new Date(
      year,
      month + 1,
      0
    );

  const days =
    date.getDate();

  const rows = [];

  for (
    let day = 1;
    day <= days;
    day += 7
  ) {
    const row = [];

    for (
      let d = day;
      d < day + 7 && d <= days;
      d++
    ) {
      row.push({
        text: String(d),
        callback_data:
          `view_date_day_${year}_${month}_${d}`,
      });
    }

    rows.push(row);
  }

  rows.push([
    {
      text: "⬅️ Назад",
      callback_data:
        `view_date_month_back_${year}`,
    },
  ]);

  return editMessage(
    chatId,
    messageId,
    `📅 ${MONTHS[month]} ${year}\n\nВыберите день:`,
    {
      inline_keyboard: rows,
    }
  );
}

async function showPassengersByDate(
  chatId,
  dateString,
  messageId = null
) {
  const passengers =
    await getPassengerObjects();

  const filtered =
    passengers.filter(
      (item) =>
        item.passenger.flightDate ===
        dateString
    );

  const text =
    getPassengerListText(
      filtered,
      `📅 Пассажиры на ${dateString}`
    );

  const keyboard =
    getPassengerListKeyboard(
      filtered,
      0,
      "view_passenger"
    );

  if (messageId) {
    return editMessage(
      chatId,
      messageId,
      text,
      keyboard
    );
  }

  return sendMessage(
    chatId,
    text,
    keyboard
  );
}

/* =========================================================
   VIEW ROUTE
========================================================= */

async function showViewRouteMenu(
  chatId,
  messageId = null
) {
  const keyboard = {
    inline_keyboard: [
      [
        {
          text: ROUTES[0],
          callback_data:
            "view_route_0",
        },
      ],
      [
        {
          text: ROUTES[1],
          callback_data:
            "view_route_1",
        },
      ],
      [
        {
          text: "⬅️ Назад",
          callback_data:
            "view_back",
        },
      ],
    ],
  };

  if (messageId) {
    return editMessage(
      chatId,
      messageId,
      "✈️ Выберите маршрут:",
      keyboard
    );
  }

  return sendMessage(
    chatId,
    "✈️ Выберите маршрут:",
    keyboard
  );
}

async function showPassengersByRoute(
  chatId,
  route,
  page = 0,
  messageId = null
) {
  const passengers =
    await getPassengerObjects();

  const filtered =
    passengers.filter(
      (item) =>
        item.passenger.route ===
        route
    );

  const start =
    page * PAGE_SIZE;

  const pagePassengers =
    filtered.slice(
      start,
      start + PAGE_SIZE
    );

  const text =
    getPassengerListText(
      pagePassengers,
      `✈️ ${route}\nСтраница ${
        page + 1
      }`
    );

  const keyboard =
    getPassengerListKeyboard(
      filtered,
      page,
      "view_passenger"
    );

  if (messageId) {
    return editMessage(
      chatId,
      messageId,
      text,
      keyboard
    );
  }

  return sendMessage(
    chatId,
    text,
    keyboard
  );
}

/* =========================================================
   FIND PASSENGER
========================================================= */

async function startPassengerSearch(
  chatId
) {
  createState(chatId, {
    mode: "search",
  });

  return sendMessage(
    chatId,
    "🔎 Введите номер паспорта или ID пассажира:"
  );
}

async function searchPassenger(
  chatId,
  query
) {
  const values =
    await getAllPassengers();

  const normalized =
    normalizePassport(query);

  for (let i = 1; i < values.length; i++) {
    const passenger =
      rowToPassenger(values[i]);

    if (
      normalizePassport(
        passenger.passport
      ) === normalized ||
      normalizeText(
        passenger.id
      ).toUpperCase() ===
        normalizeText(query).toUpperCase()
    ) {
      return showPassengerCard(
        chatId,
        passenger,
        i + 1
      );
    }
  }

  return sendMessage(
    chatId,
    "❌ Пассажир не найден."
  );
}

/* =========================================================
   FLIGHT PASSENGERS
========================================================= */

async function showFlightPassengersMenu(
  chatId,
  messageId = null
) {
  const years =
    getFlightYears();

  const rows = years.map(
    (year) => [
      {
        text: String(year),
        callback_data:
          `flight_passengers_year_${year}`,
      },
    ]
  );

  rows.push([
    {
      text: "⬅️ Назад",
      callback_data:
        "main_menu",
    },
  ]);

  const keyboard = {
    inline_keyboard: rows,
  };

  if (messageId) {
    return editMessage(
      chatId,
      messageId,
      "✈️ Пассажиры рейса\n\nВыберите год:",
      keyboard
    );
  }

  return sendMessage(
    chatId,
    "✈️ Пассажиры рейса\n\nВыберите год:",
    keyboard
  );
}

async function showFlightPassengersRoutes(
  chatId,
  year,
  month,
  day,
  messageId = null
) {
  const dateString =
    `${String(day).padStart(2, "0")}.` +
    `${String(month + 1).padStart(2, "0")}.` +
    `${year}`;

  const keyboard = {
    inline_keyboard: [
      [
        {
          text: ROUTES[0],
          callback_data:
            `flight_route_0_${dateString}`,
        },
      ],
      [
        {
          text: ROUTES[1],
          callback_data:
            `flight_route_1_${dateString}`,
        },
      ],
      [
        {
          text: "⬅️ Назад",
          callback_data:
            `flight_passengers_month_back_${year}`,
        },
      ],
    ],
  };

  if (messageId) {
    return editMessage(
      chatId,
      messageId,
      `✈️ ${dateString}\n\nВыберите маршрут:`,
      keyboard
    );
  }

  return sendMessage(
    chatId,
    `✈️ ${dateString}\n\nВыберите маршрут:`,
    keyboard
  );
}

async function showFlightPassengers(
  chatId,
  dateString,
  route,
  messageId = null
) {
  const passengers =
    await getPassengerObjects();

  const filtered =
    passengers.filter(
      (item) =>
        item.passenger.flightDate ===
          dateString &&
        item.passenger.route ===
          route
    );

  const active =
    filtered.filter(
      (item) =>
        item.passenger.status !==
        "Отменен"
    );

  let text =
    `✈️ ${dateString}\n` +
    `${route}\n\n` +
    `Загрузка: ${active.length}/${CAPACITY}\n\n`;

  if (!filtered.length) {
    text +=
      "Пассажиров нет.";
  } else {
    filtered.forEach(
      (item, index) => {
        const p = item.passenger;

        text +=
          `${index + 1}. ` +
          `${p.surname} ${p.name}\n` +
          `🆔 ${p.id}\n` +
          `Паспорт: ${p.passport}\n` +
          `Статус: ${p.status}\n\n`;
      }
    );
  }

  const keyboard = {
    inline_keyboard: [
      [
        {
          text: "⬅️ Назад",
          callback_data:
            "main_flight",
        },
      ],
    ],
  };

  if (messageId) {
    return editMessage(
      chatId,
      messageId,
      text,
      keyboard
    );
  }

  return sendMessage(
    chatId,
    text,
    keyboard
  );
}

/* =========================================================
   STATISTICS
========================================================= */

async function showStatistics(
  chatId,
  messageId = null
) {
  const passengers =
    await getPassengerObjects();

  const total =
    passengers.length;

  const confirmed =
    passengers.filter(
      (item) =>
        item.passenger.status ===
        "Подтвержден"
    ).length;

  const booked =
    passengers.filter(
      (item) =>
        item.passenger.status ===
        "Забронирован"
    ).length;

  const cancelled =
    passengers.filter(
      (item) =>
        item.passenger.status ===
        "Отменен"
    ).length;

  const route1 =
    passengers.filter(
      (item) =>
        item.passenger.route ===
        ROUTES[0] &&
        item.passenger.status !==
          "Отменен"
    ).length;

  const route2 =
    passengers.filter(
      (item) =>
        item.passenger.route ===
        ROUTES[1] &&
        item.passenger.status !==
          "Отменен"
    ).length;

  const text =
    "📊 Статистика\n\n" +
    `👥 Всего пассажиров: ${total}\n` +
    `🟢 Подтверждено: ${confirmed}\n` +
    `🟡 Забронировано: ${booked}\n` +
    `🔴 Отменено: ${cancelled}\n\n` +
    `✈️ ${ROUTES[0]}: ${route1}\n` +
    `✈️ ${ROUTES[1]}: ${route2}`;

  const keyboard = {
    inline_keyboard: [
      [
        {
          text: "⬅️ Назад",
          callback_data:
            "main_menu",
        },
      ],
    ],
  };

  if (messageId) {
    return editMessage(
      chatId,
      messageId,
      text,
      keyboard
    );
  }

  return sendMessage(
    chatId,
    text,
    keyboard
  );
}

/* =========================================================
   FINISH REGISTRATION
========================================================= */

async function finishRegistration(
  chatId
) {
  const state = getState(chatId);

  if (!state) return;

  const data = state.data;

  if (
    !data.surname ||
    !data.name ||
    !data.birthDate ||
    !data.passport ||
    !data.citizenship ||
    !data.flightDate ||
    !data.route ||
    !data.status
  ) {
    await sendMessage(
      chatId,
      "❌ Не все обязательные поля заполнены."
    );

    return;
  }

  const values =
    await getAllPassengers();

  const passport =
    normalizePassport(
      data.passport
    );

  for (let i = 1; i < values.length; i++) {
    const existing =
      normalizePassport(
        values[i][5]
      );

    if (
      existing &&
      existing === passport
    ) {
      await sendMessage(
        chatId,
        "❌ Пассажир с таким паспортом уже существует."
      );

      states.delete(chatId);

      return;
    }
  }

  if (
    data.status !== "Отменен"
  ) {
    const occupancy =
      await calculateRouteOccupancy(
        data.flightDate,
        data.route
      );

    if (occupancy >= CAPACITY) {
      await sendMessage(
        chatId,
        `❌ Рейс заполнен: ${occupancy}/${CAPACITY}.`
      );

      states.delete(chatId);

      return;
    }
  }

  const id =
    await savePassenger(data);

  data.id = id;

  states.delete(chatId);

  await sendMessage(
    chatId,
    "✅ Пассажир успешно добавлен."
  );

  await showPassengerCard(
    chatId,
    data,
    null
  );

  await showMainMenu(chatId);
}

/* =========================================================
   EXCEL HELPERS
========================================================= */

function excelSerialToDate(
  serial
) {
  const utcDays =
    Math.floor(
      Number(serial)
    );

  const date =
    new Date(
      Date.UTC(
        1899,
        11,
        30
      )
    );

  date.setUTCDate(
    date.getUTCDate() +
      utcDays
  );

  return date;
}

function normalizeExcelDate(
  value
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "";
  }

  if (
    value instanceof Date &&
    !isNaN(value.getTime())
  ) {
    return formatDate(value);
  }

  if (
    typeof value === "number" &&
    isFinite(value)
  ) {
    return formatDate(
      excelSerialToDate(value)
    );
  }

  let text =
    normalizeText(value);

  if (!text) {
    return "";
  }

  text = text.replace(
    /\//g,
    "."
  );

  if (
    /^\d{4}-\d{2}-\d{2}$/.test(text)
  ) {
    const [
      year,
      month,
      day,
    ] = text.split("-");

    text =
      `${day}.${month}.${year}`;
  }

  if (
    /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(
      text
    )
  ) {
    const [
      day,
      month,
      year,
    ] = text.split(".");

    text =
      `${String(day).padStart(2, "0")}.` +
      `${String(month).padStart(2, "0")}.` +
      `${year}`;
  }

  return text;
}

function normalizeExcelHeader(
  value
) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/ё/g, "е");
}

function getExcelHeaderMap(
  headers
) {
  const map = {};

  headers.forEach(
    (header, index) => {
      const normalized =
        normalizeExcelHeader(
          header
        );

      if (normalized) {
        map[normalized] =
          index;
      }
    }
  );

  return map;
}

function getExcelValue(
  row,
  headerMap,
  headerName
) {
  const index =
    headerMap[
      normalizeExcelHeader(
        headerName
      )
    ];

  if (
    index === undefined
  ) {
    return "";
  }

  return row[index] ?? "";
}

function normalizeExcelStatus(
  value
) {
  const text =
    normalizeText(value)
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
    text === "подтверждено" ||
    text === "confirmed"
  ) {
    return "Подтвержден";
  }

  if (
    text === "отменен" ||
    text === "отменено" ||
    text === "cancelled" ||
    text === "canceled"
  ) {
    return "Отменен";
  }

  return "";
}

function normalizeExcelRoute(
  value
) {
  const text =
    normalizeText(value)
      .replace(/–/g, "—")
      .replace(/-/g, "—")
      .replace(/\s*—\s*/g, " — ");

  if (
    text === "ДШБ — ХРГ" ||
    text.toUpperCase() ===
      "ДШБ — ХРГ"
  ) {
    return ROUTES[0];
  }

  if (
    text === "ХРГ — ДШБ" ||
    text.toUpperCase() ===
      "ХРГ — ДШБ"
  ) {
    return ROUTES[1];
  }

  const compact =
    normalizeText(value)
      .toUpperCase()
      .replace(/\s+/g, "")
      .replace(/-/g, "—");

  if (
    compact === "ДШБ—ХРГ"
  ) {
    return ROUTES[0];
  }

  if (
    compact === "ХРГ—ДШБ"
  ) {
    return ROUTES[1];
  }

  return "";
}

function validateExcelPassenger(
  passenger
) {
  const errors = [];

  if (!passenger.surname) {
    errors.push(
      "не указана фамилия"
    );
  }

  if (!passenger.name) {
    errors.push(
      "не указано имя"
    );
  }

  if (!passenger.birthDate) {
    errors.push(
      "не указана дата рождения"
    );
  } else if (
    !isValidDateString(
      passenger.birthDate
    )
  ) {
    errors.push(
      "неверная дата рождения"
    );
  }

  if (!passenger.passport) {
    errors.push(
      "не указан паспорт"
    );
  }

  if (!passenger.citizenship) {
    errors.push(
      "не указано гражданство"
    );
  }

  if (!passenger.flightDate) {
    errors.push(
      "не указана дата рейса"
    );
  } else if (
    !isValidDateString(
      passenger.flightDate
    )
  ) {
    errors.push(
      "неверная дата рейса"
    );
  }

  if (!passenger.route) {
    errors.push(
      "неверный маршрут"
    );
  }

  if (!passenger.status) {
    errors.push(
      "неверный статус"
    );
  }

  if (
    passenger.contact1 &&
    !validateTajikPhone(
      passenger.contact1
    )
  ) {
    errors.push(
      "неверный Контакт 1"
    );
  }

  if (
    passenger.contact2 &&
    !validateTajikPhone(
      passenger.contact2
    )
  ) {
    errors.push(
      "неверный Контакт 2"
    );
  }

  return errors;
}

/* =========================================================
   EXCEL MENU
========================================================= */

async function showExcelUploadMenu(
  chatId,
  messageId = null
) {
  const text =
    "📥 Загрузка пассажиров из Excel\n\n" +
    "Подготовьте файл .xlsx с колонками:\n\n" +
    "Фамилия | Имя | Отчество | Дата рождения | Паспорт | Гражданство | Контакт 1 | Контакт 2 | Дата рейса | Маршрут | Статус\n\n" +
    "ID указывать не нужно — он будет создан автоматически.\n\n" +
    `Максимальная вместимость одного рейса: ${CAPACITY} пассажиров.\n` +
    "Отмененные пассажиры место не занимают.\n\n" +
    "Отправьте Excel-файл сюда.";

  const keyboard = {
    inline_keyboard: [
      [
        {
          text: "⬅️ Назад",
          callback_data:
            "main_menu",
        },
      ],
    ],
  };

  if (messageId) {
    return editMessage(
      chatId,
      messageId,
      text,
      keyboard
    );
  }

  return sendMessage(
    chatId,
    text,
    keyboard
  );
}

/* =========================================================
   TELEGRAM FILE
========================================================= */

async function getTelegramFilePath(
  fileId
) {
  const response =
    await telegramRequest(
      "getFile",
      {
        file_id: fileId,
      }
    );

  if (
    !response ||
    !response.ok ||
    !response.result ||
    !response.result.file_path
  ) {
    throw new Error(
      "Не удалось получить файл Telegram."
    );
  }

  return response.result.file_path;
}

async function downloadTelegramFile(
  filePath
) {
  const response =
    await fetch(
      `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`
    );

  if (!response.ok) {
    throw new Error(
      `Ошибка загрузки файла: ${response.status}`
    );
  }

  const arrayBuffer =
    await response.arrayBuffer();

  return Buffer.from(
    arrayBuffer
  );
}

/* =========================================================
   EXCEL UPLOAD
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

  const lowerName =
    fileName.toLowerCase();

  if (
    !lowerName.endsWith(".xlsx")
  ) {
    await sendMessage(
      chatId,
      "❌ Поддерживается только Excel-файл формата .xlsx."
    );

    return;
  }

  await sendMessage(
    chatId,
    "⏳ Загружаю и проверяю Excel-файл..."
  );

  try {
    const filePath =
      await getTelegramFilePath(
        document.file_id
      );

    const buffer =
      await downloadTelegramFile(
        filePath
      );

    const workbook =
      XLSX.read(buffer, {
        type: "buffer",
        cellDates: true,
      });

    if (
      !workbook.SheetNames.length
    ) {
      throw new Error(
        "В Excel-файле нет листов."
      );
    }

    const sheet =
      workbook.Sheets[
        workbook.SheetNames[0]
      ];

    const rows =
      XLSX.utils.sheet_to_json(
        sheet,
        {
          header: 1,
          defval: "",
        }
      );

    if (
      !rows.length
    ) {
      throw new Error(
        "Excel-файл пустой."
      );
    }

    const headers =
      rows[0] || [];

    const headerMap =
      getExcelHeaderMap(
        headers
      );

    const missingHeaders =
      EXCEL_HEADERS.filter(
        (header) =>
          headerMap[
            normalizeExcelHeader(
              header
            )
          ] === undefined
      );

    if (
      missingHeaders.length
    ) {
      await sendMessage(
        chatId,
        "❌ В Excel отсутствуют обязательные колонки:\n\n" +
          missingHeaders.join(
            "\n"
          )
      );

      return;
    }

    const existingValues =
      await getAllPassengers();

    const existingPassports =
      new Set();

    const existingIds =
      new Set();

    const occupancyMap =
      new Map();

    for (
      let i = 1;
      i < existingValues.length;
      i++
    ) {
      const row =
        existingValues[i];

      const passport =
        normalizePassport(
          row[5]
        );

      if (passport) {
        existingPassports.add(
          passport
        );
      }

      const id =
        normalizeText(row[0]);

      if (id) {
        existingIds.add(id);
      }

      const flightDate =
        normalizeText(row[9]);

      const route =
        normalizeExcelRoute(
          row[10]
        );

      const status =
        normalizeExcelStatus(
          row[11]
        );

      if (
        flightDate &&
        route &&
        status !== "Отменен"
      ) {
        const key =
          `${flightDate}|${route}`;

        occupancyMap.set(
          key,
          (occupancyMap.get(key) ||
            0) + 1
        );
      }
    }

    const acceptedValues = [];

    const filePassports =
      new Set();

    const duplicateRows = [];

    const capacityRows = [];

    const errorRows = [];

    let added = 0;

    for (
      let i = 1;
      i < rows.length;
      i++
    ) {
      const row =
        rows[i] || [];

      const excelRowNumber =
        i + 1;

      const isEmpty =
        row.every(
          (cell) =>
            normalizeText(cell) === ""
        );

      if (isEmpty) {
        continue;
      }

      const passenger = {
        surname:
          normalizeText(
            getExcelValue(
              row,
              headerMap,
              "Фамилия"
            )
          ),

        name:
          normalizeText(
            getExcelValue(
              row,
              headerMap,
              "Имя"
            )
          ),

        patronymic:
          normalizeText(
            getExcelValue(
              row,
              headerMap,
              "Отчество"
            )
          ),

        birthDate:
          normalizeExcelDate(
            getExcelValue(
              row,
              headerMap,
              "Дата рождения"
            )
          ),

        passport:
          normalizePassport(
            getExcelValue(
              row,
              headerMap,
              "Паспорт"
            )
          ),

        citizenship:
          normalizeText(
            getExcelValue(
              row,
              headerMap,
              "Гражданство"
            )
          ),

        contact1:
          normalizeText(
            getExcelValue(
              row,
              headerMap,
              "Контакт 1"
            )
          ),

        contact2:
          normalizeText(
            getExcelValue(
              row,
              headerMap,
              "Контакт 2"
            )
          ),

        flightDate:
          normalizeExcelDate(
            getExcelValue(
              row,
              headerMap,
              "Дата рейса"
            )
          ),

        route:
          normalizeExcelRoute(
            getExcelValue(
              row,
              headerMap,
              "Маршрут"
            )
          ),

        status:
          normalizeExcelStatus(
            getExcelValue(
              row,
              headerMap,
              "Статус"
            )
          ),
      };

      const errors =
        validateExcelPassenger(
          passenger
        );

      if (errors.length) {
        errorRows.push(
          `Строка ${excelRowNumber}: ${errors.join(
            ", "
          )}`
        );

        continue;
      }

      if (
        existingPassports.has(
          passenger.passport
        ) ||
        filePassports.has(
          passenger.passport
        )
      ) {
        duplicateRows.push(
          `Строка ${excelRowNumber}: паспорт ${passenger.passport}`
        );

        continue;
      }

      const key =
        `${passenger.flightDate}|${passenger.route}`;

      const currentOccupancy =
        occupancyMap.get(key) || 0;

      if (
        passenger.status !==
          "Отменен" &&
        currentOccupancy >=
          CAPACITY
      ) {
        capacityRows.push(
          `Строка ${excelRowNumber}: ${passenger.flightDate}, ${passenger.route} — ${currentOccupancy}/${CAPACITY}`
        );

        continue;
      }

      let id =
        generatePassengerId();

      while (
        existingIds.has(id)
      ) {
        id =
          generatePassengerId();
      }

      existingIds.add(id);

      filePassports.add(
        passenger.passport
      );

      if (
        passenger.status !==
        "Отменен"
      ) {
        occupancyMap.set(
          key,
          currentOccupancy + 1
        );
      }

      acceptedValues.push([
        id,
        passenger.surname,
        passenger.name,
        passenger.patronymic,
        passenger.birthDate,
        passenger.passport,
        passenger.citizenship,
        passenger.contact1,
        passenger.contact2,
        passenger.flightDate,
        passenger.route,
        passenger.status,
      ]);

      added++;
    }

    if (
      acceptedValues.length
    ) {
      const sheets =
        await getSheets();

      const sheetTitle =
        await getSheetTitle();

      await sheets.spreadsheets.values.append(
        {
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
              acceptedValues,
          },
        }
      );
    }

    let report =
      "✅ Excel обработан\n\n" +
      `➕ Добавлено: ${added}\n` +
      `♻️ Дубли паспортов: ${duplicateRows.length}\n` +
      `🚫 Рейс заполнен: ${capacityRows.length}\n` +
      `⚠️ Ошибки строк: ${errorRows.length}`;

    if (
      duplicateRows.length
    ) {
      report +=
        "\n\n♻️ Дубли:\n" +
        duplicateRows
          .slice(0, 20)
          .join("\n");
    }

    if (
      capacityRows.length
    ) {
      report +=
        "\n\n🚫 Заполненные рейсы:\n" +
        capacityRows
          .slice(0, 20)
          .join("\n");
    }

    if (
      errorRows.length
    ) {
      report +=
        "\n\n⚠️ Ошибки:\n" +
        errorRows
          .slice(0, 30)
          .join("\n");
    }

    if (
      report.length > 3500
    ) {
      report =
        report.slice(0, 3450) +
        "\n\n... список сокращен.";
    }

    await sendMessage(
      chatId,
      report
    );

    await showMainMenu(
      chatId
    );
  } catch (error) {
    console.error(
      "Ошибка Excel:",
      error
    );

    await sendMessage(
      chatId,
      "❌ Не удалось обработать Excel-файл.\n\n" +
        `Причина: ${error.message}`
    );
  }
}

async function handleDocumentMessage(
  message
) {
  const chatId =
    message.chat.id;

  const document =
    message.document;

  if (!document) {
    return;
  }

  await handleExcelDocument(
    message
  );
}

/* =========================================================
   TEXT MESSAGE
========================================================= */

async function handleTextMessage(
  message
) {
  const chatId =
    message.chat.id;

  const text =
    normalizeText(
      message.text || ""
    );

  if (!text) {
    return;
  }

  if (
    text === "/start"
  ) {
    states.delete(chatId);

    await deleteUserMessage(
      chatId,
      message.message_id
    );

    return showMainMenu(
      chatId
    );
  }

  const state =
    getState(chatId);

  if (!state) {
    await deleteUserMessage(
      chatId,
      message.message_id
    );

    return showMainMenu(
      chatId
    );
  }

  await deleteUserMessage(
    chatId,
    message.message_id
  );

  /* =====================================================
     SEARCH
  ===================================================== */

  if (
    state.mode === "search"
  ) {
    states.delete(chatId);

    return searchPassenger(
      chatId,
      text
    );
  }

  /* =====================================================
     EDIT TEXT
  ===================================================== */

  if (
    state.mode === "edit_text"
  ) {
    const rowNumber =
      state.editRowNumber;

    const field =
      state.editField;

    if (
      field === "citizenship" &&
      state.awaitingCustomCitizenship
    ) {
      await updatePassengerField(
        chatId,
        rowNumber,
        "citizenship",
        text
      );

      states.delete(chatId);

      return;
    }

    if (
      field === "surname" ||
      field === "name" ||
      field === "patronymic"
    ) {
      await updatePassengerField(
        chatId,
        rowNumber,
        field,
        text
      );

      states.delete(chatId);

      return;
    }

    if (
      field === "passport"
    ) {
      await updatePassengerField(
        chatId,
        rowNumber,
        field,
        text
      );

      states.delete(chatId);

      return;
    }

    if (
      field === "contact1" ||
      field === "contact2"
    ) {
      if (
        !validateTajikPhone(
          text
        )
      ) {
        return sendMessage(
          chatId,
          "❌ Неверный номер телефона.\n\nПример: +992900000000"
        );
      }

      await updatePassengerField(
        chatId,
        rowNumber,
        field,
        text
      );

      states.delete(chatId);

      return;
    }
  }

  /* =====================================================
     REGISTRATION
  ===================================================== */

  if (
    state.mode === "registration"
  ) {
    switch (state.step) {
      case 0:
        state.data.surname =
          text;

        state.step = 1;

        return askRegistrationStep(
          chatId
        );

      case 1:
        state.data.name =
          text;

        state.step = 2;

        return askRegistrationStep(
          chatId
        );

      case 2:
        state.data.patronymic =
          text === "—"
            ? ""
            : text;

        state.step = 3;

        return askRegistrationStep(
          chatId
        );

      case 4:
        state.data.passport =
          normalizePassport(
            text
          );

        if (
          !state.data.passport
        ) {
          return sendMessage(
            chatId,
            "❌ Введите номер паспорта."
          );
        }

        state.step = 5;

        return askRegistrationStep(
          chatId
        );

      default:
        return;
    }
  }

  /* =====================================================
     DEFAULT
  ===================================================== */

  return sendMessage(
    chatId,
    "Используйте кнопки меню."
  );
}

/* =========================================================
   CALLBACK QUERY
========================================================= */

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

  /* =====================================================
     MAIN
  ===================================================== */

  if (
    data === "main_menu"
  ) {
    states.delete(chatId);

    return showMainMenu(
      chatId,
      messageId
    );
  }

  if (
    data === "main_add"
  ) {
    return startRegistration(
      chatId
    );
  }

  if (
    data === "main_upload_excel"
  ) {
    states.delete(chatId);

    return showExcelUploadMenu(
      chatId,
      messageId
    );
  }

  if (
    data === "main_view"
  ) {
    return showViewDataMenu(
      chatId,
      messageId
    );
  }

  if (
    data === "main_find"
  ) {
    return startPassengerSearch(
      chatId
    );
  }

  if (
    data === "main_flight"
  ) {
    return showFlightPassengersMenu(
      chatId,
      messageId
    );
  }

  if (
    data === "main_statistics"
  ) {
    return showStatistics(
      chatId,
      messageId
    );
  }

  /* =====================================================
     VIEW
  ===================================================== */

  if (
    data === "view_back"
  ) {
    return showViewDataMenu(
      chatId,
      messageId
    );
  }

  if (
    data === "view_all"
  ) {
    return showAllPassengers(
      chatId,
      0,
      messageId
    );
  }

  if (
    data.startsWith(
      "view_passenger_page_"
    )
  ) {
    const page = Number(
      data.replace(
        "view_passenger_page_",
        ""
      )
    );

    return showAllPassengers(
      chatId,
      page,
      messageId
    );
  }

  if (
    data.startsWith(
      "view_passenger_"
    )
  ) {
    const rowNumber =
      Number(
        data.replace(
          "view_passenger_",
          ""
        )
      );

    if (
      Number.isFinite(
        rowNumber
      )
    ) {
      return showPassengerCardByRow(
        chatId,
        rowNumber,
        messageId
      );
    }
  }

  if (
    data === "view_date"
  ) {
    return showViewDateCalendar(
      chatId,
      null,
      null,
      messageId
    );
  }

  if (
    data.startsWith(
      "view_date_year_"
    )
  ) {
    const year =
      Number(
        data.replace(
          "view_date_year_",
          ""
        )
      );

    return showViewDateCalendar(
      chatId,
      year,
      null,
      messageId
    );
  }

  if (
    data ===
    "view_date_year_back"
  ) {
    return showViewDateCalendar(
      chatId,
      null,
      null,
      messageId
    );
  }

  if (
    data.startsWith(
      "view_date_month_"
    )
  ) {
    const parts =
      data.split("_");

    const year =
      Number(parts[3]);

    const month =
      Number(parts[4]);

    return showViewDateCalendar(
      chatId,
      year,
      month,
      messageId
    );
  }

  if (
    data.startsWith(
      "view_date_month_back_"
    )
  ) {
    const year =
      Number(
        data.replace(
          "view_date_month_back_",
          ""
        )
      );

    return showViewDateCalendar(
      chatId,
      year,
      null,
      messageId
    );
  }

  if (
    data.startsWith(
      "view_date_day_"
    )
  ) {
    const parts =
      data.split("_");

    const year =
      Number(parts[3]);

    const month =
      Number(parts[4]);

    const day =
      Number(parts[5]);

    const dateString =
      `${String(day).padStart(2, "0")}.` +
      `${String(month + 1).padStart(2, "0")}.` +
      `${year}`;

    return showPassengersByDate(
      chatId,
      dateString,
      messageId
    );
  }

  if (
    data === "view_route"
  ) {
    return showViewRouteMenu(
      chatId,
      messageId
    );
  }

  if (
    data.startsWith(
      "view_route_"
    )
  ) {
    const index =
      Number(
        data.replace(
          "view_route_",
          ""
        )
      );

    if (
      ROUTES[index]
    ) {
      return showPassengersByRoute(
        chatId,
        ROUTES[index],
        0,
        messageId
      );
    }
  }

  /* =====================================================
     SEARCH
  ===================================================== */

  if (
    data === "view_search"
  ) {
    return startPassengerSearch(
      chatId
    );
  }

  /* =====================================================
     FLIGHT PASSENGERS
  ===================================================== */

  if (
    data === "main_flight"
  ) {
    return showFlightPassengersMenu(
      chatId,
      messageId
    );
  }

  if (
    data.startsWith(
      "flight_passengers_year_"
    )
  ) {
    const year =
      Number(
        data.replace(
          "flight_passengers_year_",
          ""
        )
      );

    const rows = [];

    for (let i = 0; i < 12; i += 3) {
      rows.push(
        [i, i + 1, i + 2].map(
          (month) => ({
            text: MONTHS[month],
            callback_data:
              `flight_passengers_month_${year}_${month}`,
          })
        )
      );
    }

    rows.push([
      {
        text: "⬅️ Назад",
        callback_data:
          "main_flight",
      },
    ]);

    return editMessage(
      chatId,
      messageId,
      `✈️ ${year}\n\nВыберите месяц:`,
      {
        inline_keyboard: rows,
      }
    );
  }

  if (
    data.startsWith(
      "flight_passengers_month_"
    )
  ) {
    const parts =
      data.split("_");

    const year =
      Number(parts[3]);

    const month =
      Number(parts[4]);

    const date =
      new Date(
        year,
        month + 1,
        0
      );

    const days =
      date.getDate();

    const rows = [];

    for (
      let day = 1;
      day <= days;
      day += 7
    ) {
      const row = [];

      for (
        let d = day;
        d < day + 7 &&
        d <= days;
        d++
      ) {
        row.push({
          text: String(d),
          callback_data:
            `flight_passengers_day_${year}_${month}_${d}`,
        });
      }

      rows.push(row);
    }

    rows.push([
      {
        text: "⬅️ Назад",
        callback_data:
          `flight_passengers_year_${year}`,
      },
    ]);

    return editMessage(
      chatId,
      messageId,
      `✈️ ${MONTHS[month]} ${year}\n\nВыберите день:`,
      {
        inline_keyboard: rows,
      }
    );
  }

  if (
    data.startsWith(
      "flight_passengers_day_"
    )
  ) {
    const parts =
      data.split("_");

    const year =
      Number(parts[3]);

    const month =
      Number(parts[4]);

    const day =
      Number(parts[5]);

    return showFlightPassengersRoutes(
      chatId,
      year,
      month,
      day,
      messageId
    );
  }

  if (
    data.startsWith(
      "flight_route_"
    )
  ) {
    const parts =
      data.split("_");

    const routeIndex =
      Number(parts[2]);

    const dateString =
      parts.slice(3).join("_");

    if (
      ROUTES[routeIndex]
    ) {
      return showFlightPassengers(
        chatId,
        dateString,
        ROUTES[routeIndex],
        messageId
      );
    }
  }

  /* =====================================================
     REGISTRATION
  ===================================================== */

  if (
    data.startsWith(
      "reg_cit_"
    )
  ) {
    const state =
      getState(chatId);

    if (!state) {
      return;
    }

    const value =
      data.replace(
        "reg_cit_",
        ""
      );

    if (
      value === "other"
    ) {
      state.awaitingCustomCitizenship =
        true;

      return sendMessage(
        chatId,
        "Введите гражданство:"
      );
    }

    const citizenshipMap = {
      TJ: "Таджикистан",
      RU: "Россия",
      UZ: "Узбекистан",
    };

    state.data.citizenship =
      citizenshipMap[value] ||
      value;

    state.awaitingCustomCitizenship =
      false;

    state.step = 6;

    return askRegistrationStep(
      chatId
    );
  }

  if (
    data === "reg_contact1_enter"
  ) {
    const state =
      getState(chatId);

    if (!state) return;

    state.awaitingContact1 =
      true;

    return sendMessage(
      chatId,
      "Введите номер первого контакта:\n\nПример: +992900000000"
    );
  }

  if (
    data === "reg_contact1_skip"
  ) {
    const state =
      getState(chatId);

    if (!state) return;

    state.data.contact1 =
      "";

    state.step = 7;

    return askRegistrationStep(
      chatId
    );
  }

  if (
    data === "reg_contact2_enter"
  ) {
    const state =
      getState(chatId);

    if (!state) return;

    state.awaitingContact2 =
      true;

    return sendMessage(
      chatId,
      "Введите номер второго контакта:\n\nПример: +992900000000"
    );
  }

  if (
    data === "reg_contact2_skip"
  ) {
    const state =
      getState(chatId);

    if (!state) return;

    state.data.contact2 =
      "";

    state.step = 8;

    return askRegistrationStep(
      chatId
    );
  }

  if (
    data === "reg_route_0" ||
    data === "reg_route_1"
  ) {
    const state =
      getState(chatId);

    if (!state) return;

    const index =
      Number(
        data.replace(
          "reg_route_",
          ""
        )
      );

    state.data.route =
      ROUTES[index];

    state.step = 10;

    return askRegistrationStep(
      chatId
    );
  }

  if (
    data === "reg_status_0" ||
    data === "reg_status_1" ||
    data === "reg_status_2"
  ) {
    const state =
      getState(chatId);

    if (!state) return;

    const index =
      Number(
        data.replace(
          "reg_status_",
          ""
        )
      );

    state.data.status =
      STATUSES[index];

    return finishRegistration(
      chatId
    );
  }

  /* =====================================================
     CALENDAR REGISTRATION
  ===================================================== */

  if (
    data.startsWith(
      "cal_birth_year_"
    )
  ) {
    const year =
      Number(
        data.replace(
          "cal_birth_year_",
          ""
        )
      );

    return editMessage(
      chatId,
      messageId,
      `Дата рождения\n\nВыберите месяц ${year}:`,
      getMonthsKeyboard(
        "birth",
        year
      )
    );
  }

  if (
    data.startsWith(
      "cal_flight_year_"
    )
  ) {
    const year =
      Number(
        data.replace(
          "cal_flight_year_",
          ""
        )
      );

    return editMessage(
      chatId,
      messageId,
      `Дата рейса\n\nВыберите месяц ${year}:`,
      getMonthsKeyboard(
        "flight",
        year
      )
    );
  }

  if (
    data.startsWith(
      "cal_birth_month_"
    )
  ) {
    const parts =
      data.split("_");

    const year =
      Number(parts[3]);

    const month =
      Number(parts[4]);

    return editMessage(
      chatId,
      messageId,
      getCalendarTitle(
        "birth",
        year,
        month
      ),
      getDaysKeyboard(
        "birth",
        year,
        month
      )
    );
  }

  if (
    data.startsWith(
      "cal_flight_month_"
    )
  ) {
    const parts =
      data.split("_");

    const year =
      Number(parts[3]);

    const month =
      Number(parts[4]);

    return editMessage(
      chatId,
      messageId,
      getCalendarTitle(
        "flight",
        year,
        month
      ),
      getDaysKeyboard(
        "flight",
        year,
        month
      )
    );
  }

  if (
    data.startsWith(
      "cal_birth_day_"
    )
  ) {
    const parts =
      data.split("_");

    const year =
      Number(parts[3]);

    const month =
      Number(parts[4]);

    const day =
      Number(parts[5]);

    const state =
      getState(chatId);

    if (!state) return;

    const dateString =
      `${String(day).padStart(2, "0")}.` +
      `${String(month + 1).padStart(2, "0")}.` +
      `${year}`;

    state.data.birthDate =
      dateString;

    state.step = 4;

    return askRegistrationStep(
      chatId
    );
  }

  if (
    data.startsWith(
      "cal_flight_day_"
    )
  ) {
    const parts =
      data.split("_");

    const year =
      Number(parts[3]);

    const month =
      Number(parts[4]);

    const day =
      Number(parts[5]);

    const state =
      getState(chatId);

    if (!state) return;

    const dateString =
      `${String(day).padStart(2, "0")}.` +
      `${String(month + 1).padStart(2, "0")}.` +
      `${year}`;

    state.data.flightDate =
      dateString;

    state.step = 9;

    return askRegistrationStep(
      chatId
    );
  }

  if (
    data === "cal_birth_back_year"
  ) {
    return editMessage(
      chatId,
      messageId,
      "Выберите год рождения:",
      getYearsKeyboard("birth")
    );
  }

  if (
    data === "cal_flight_back_year"
  ) {
    return editMessage(
      chatId,
      messageId,
      "Выберите год рейса:",
      getYearsKeyboard("flight")
    );
  }

  /* =====================================================
     REGISTRATION BACK
  ===================================================== */

  if (
    data.startsWith(
      "reg_back_"
    )
  ) {
    const step =
      Number(
        data.replace(
          "reg_back_",
          ""
        )
      );

    const state =
      getState(chatId);

    if (!state) return;

    state.step =
      Math.max(0, step);

    return askRegistrationStep(
      chatId
    );
  }

  /* =====================================================
     EDIT
  ===================================================== */

  if (
    data.startsWith(
      "edit_passenger_"
    )
  ) {
    const rowNumber =
      Number(
        data.replace(
          "edit_passenger_",
          ""
        )
      );

    return showEditMenu(
      chatId,
      rowNumber,
      messageId
    );
  }

  if (
    data.startsWith(
      "edit_back_"
    )
  ) {
    const rowNumber =
      Number(
        data.replace(
          "edit_back_",
          ""
        )
      );

    return showPassengerCardByRow(
      chatId,
      rowNumber,
      messageId
    );
  }

  if (
    data.startsWith(
      "edit_field_"
    )
  ) {
    const parts =
      data.split("_");

    const field =
      parts[2];

    const rowNumber =
      Number(parts[3]);

    const editableTextFields = [
      "surname",
      "name",
      "patronymic",
      "passport",
      "contact1",
      "contact2",
    ];

    if (
      editableTextFields.includes(
        field
      )
    ) {
      createState(chatId, {
        mode: "edit_text",
        editField: field,
        editRowNumber:
          rowNumber,
      });

      const fieldNames = {
        surname: "фамилию",
        name: "имя",
        patronymic: "отчество",
        passport: "номер паспорта",
        contact1: "Контакт 1",
        contact2: "Контакт 2",
      };

      return sendMessage(
        chatId,
        `Введите ${fieldNames[field]}:`
      );
    }

    if (
      field === "citizenship"
    ) {
      createState(chatId, {
        mode: "edit_text",
        editField:
          "citizenship",
        editRowNumber:
          rowNumber,
      });

      return sendMessage(
        chatId,
        "Выберите гражданство:",
        {
          inline_keyboard: [
            [
              {
                text:
                  "🇹🇯 Таджикистан",
                callback_data:
                  `edit_cit_TJ_${rowNumber}`,
              },
            ],
            [
              {
                text:
                  "🇷🇺 Россия",
                callback_data:
                  `edit_cit_RU_${rowNumber}`,
              },
            ],
            [
              {
                text:
                  "🇺🇿 Узбекистан",
                callback_data:
                  `edit_cit_UZ_${rowNumber}`,
              },
            ],
            [
              {
                text: "🌍 Другое",
                callback_data:
                  `edit_cit_other_${rowNumber}`,
              },
            ],
          ],
        }
      );
    }

    if (
      field === "route"
    ) {
      return sendMessage(
        chatId,
        "Выберите маршрут:",
        {
          inline_keyboard: [
            [
              {
                text: ROUTES[0],
                callback_data:
                  `edit_route_0_${rowNumber}`,
              },
            ],
            [
              {
                text: ROUTES[1],
                callback_data:
                  `edit_route_1_${rowNumber}`,
              },
            ],
          ],
        }
      );
    }

    if (
      field === "status"
    ) {
      return sendMessage(
        chatId,
        "Выберите статус:",
        {
          inline_keyboard: [
            [
              {
                text:
                  "🟡 Забронирован",
                callback_data:
                  `edit_status_0_${rowNumber}`,
              },
            ],
            [
              {
                text:
                  "🟢 Подтвержден",
                callback_data:
                  `edit_status_1_${rowNumber}`,
              },
            ],
            [
              {
                text:
                  "🔴 Отменен",
                callback_data:
                  `edit_status_2_${rowNumber}`,
              },
            ],
          ],
        }
      );
    }

    if (
      field === "birthDate" ||
      field === "flightDate"
    ) {
      createState(chatId, {
        mode: "edit_date",
        editField: field,
        editRowNumber:
          rowNumber,
      });

      const type =
        field === "birthDate"
          ? "birth"
          : "flight";

      return showCalendar(
        chatId,
        type
      );
    }
  }

  /* =====================================================
     EDIT CITIZENSHIP
  ===================================================== */

  if (
    data.startsWith(
      "edit_cit_"
    )
  ) {
    const parts =
      data.split("_");

    const value =
      parts[2];

    const rowNumber =
      Number(parts[3]);

    if (
      value === "other"
    ) {
      createState(chatId, {
        mode: "edit_text",
        editField:
          "citizenship",
        editRowNumber:
          rowNumber,
        awaitingCustomCitizenship:
          true,
      });

      return sendMessage(
        chatId,
        "Введите гражданство:"
      );
    }

    const citizenshipMap = {
      TJ: "Таджикистан",
      RU: "Россия",
      UZ: "Узбекистан",
    };

    states.delete(chatId);

    return updatePassengerField(
      chatId,
      rowNumber,
      "citizenship",
      citizenshipMap[value]
    );
  }

  /* =====================================================
     EDIT ROUTE
  ===================================================== */

  if (
    data.startsWith(
      "edit_route_"
    )
  ) {
    const parts =
      data.split("_");

    const routeIndex =
      Number(parts[2]);

    const rowNumber =
      Number(parts[3]);

    states.delete(chatId);

    return updatePassengerField(
      chatId,
      rowNumber,
      "route",
      ROUTES[routeIndex]
    );
  }

  /* =====================================================
     EDIT STATUS
  ===================================================== */

  if (
    data.startsWith(
      "edit_status_"
    )
  ) {
    const parts =
      data.split("_");

    const statusIndex =
      Number(parts[2]);

    const rowNumber =
      Number(parts[3]);

    states.delete(chatId);

    return updatePassengerField(
      chatId,
      rowNumber,
      "status",
      STATUSES[statusIndex]
    );
  }

  /* =====================================================
     EDIT DATE
  ===================================================== */

  if (
    data.startsWith(
      "cal_edit_birth_day_"
    )
  ) {
    const parts =
      data.split("_");

    const year =
      Number(parts[4]);

    const month =
      Number(parts[5]);

    const day =
      Number(parts[6]);

    const state =
      getState(chatId);

    if (!state) return;

    const dateString =
      `${String(day).padStart(2, "0")}.` +
      `${String(month + 1).padStart(2, "0")}.` +
      `${year}`;

    const rowNumber =
      state.editRowNumber;

    const field =
      state.editField;

    states.delete(chatId);

    return updatePassengerField(
      chatId,
      rowNumber,
      field,
      dateString
    );
  }

  if (
    data.startsWith(
      "cal_edit_flight_day_"
    )
  ) {
    const parts =
      data.split("_");

    const year =
      Number(parts[4]);

    const month =
      Number(parts[5]);

    const day =
      Number(parts[6]);

    const state =
      getState(chatId);

    if (!state) return;

    const dateString =
      `${String(day).padStart(2, "0")}.` +
      `${String(month + 1).padStart(2, "0")}.` +
      `${year}`;

    const rowNumber =
      state.editRowNumber;

    const field =
      state.editField;

    states.delete(chatId);

    return updatePassengerField(
      chatId,
      rowNumber,
      field,
      dateString
    );
  }

  /* =====================================================
     NOOP
  ===================================================== */

  if (
    data === "noop"
  ) {
    return;
  }
}

/* =========================================================
   SPECIAL EDIT CALENDAR CALLBACKS
========================================================= */

async function handleEditCalendarCallback(
  callbackQuery
) {
  const chatId =
    callbackQuery.message.chat.id;

  const messageId =
    callbackQuery.message.message_id;

  const data =
    callbackQuery.data;

  if (
    !data.startsWith(
      "editcal_"
    )
  ) {
    return false;
  }

  return true;
}

/* =========================================================
   WEBHOOK
========================================================= */

app.post(
  "/telegram/webhook",
  async (req, res) => {
    try {
      if (
        TELEGRAM_WEBHOOK_SECRET &&
        req.headers[
          "x-telegram-bot-api-secret-token"
        ] !==
          TELEGRAM_WEBHOOK_SECRET
      ) {
        return res
          .status(403)
          .send("Forbidden");
      }

      const update =
        req.body;

      if (
        update.message
      ) {
        if (
          update.message.document
        ) {
          await handleDocumentMessage(
            update.message
          );
        } else {
          await handleTextMessage(
            update.message
          );
        }
      }

      if (
        update.callback_query
      ) {
        await handleCallbackQuery(
          update.callback_query
        );
      }

      return res
        .status(200)
        .send("OK");
    } catch (error) {
      console.error(
        "Webhook error:",
        error
      );

      return res
        .status(200)
        .send("OK");
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
   SET WEBHOOK
========================================================= */

async function setupWebhook() {
  if (
    !PUBLIC_URL ||
    !TELEGRAM_BOT_TOKEN
  ) {
    console.log(
      "Webhook не настроен: отсутствует PUBLIC_URL или TELEGRAM_BOT_TOKEN."
    );

    return;
  }

  const webhookUrl =
    `${PUBLIC_URL}/telegram/webhook`;

  const result =
    await telegramRequest(
      "setWebhook",
      {
        url: webhookUrl,
        secret_token:
          TELEGRAM_WEBHOOK_SECRET ||
          undefined,
        allowed_updates: [
          "message",
          "callback_query",
        ],
      }
    );

  console.log(
    "Webhook:",
    result
  );
}

/* =========================================================
   START SERVER
========================================================= */

app.listen(
  PORT,
  async () => {
    console.log(
      `KMRN Passenger Bot запущен на порту ${PORT}`
    );

    try {
      await setupWebhook();
    } catch (error) {
      console.error(
        "Ошибка настройки webhook:",
        error
      );
    }
  }
);
