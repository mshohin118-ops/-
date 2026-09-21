require("dotenv").config();

const express = require("express");
const { google } = require("googleapis");
const XLSX = require("xlsx");

const app = express();
app.use(express.json({ limit: "10mb" }));

// ======================================================
// ENV
// ======================================================

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

// Максимальное количество пассажиров на рейс
const CAPACITY = 19;

// ======================================================
// ПРОВЕРКА ENV
// ======================================================

if (!TELEGRAM_BOT_TOKEN) {
  console.error("❌ TELEGRAM_BOT_TOKEN не задан.");
} else {
  console.log("✅ TELEGRAM_BOT_TOKEN найден.");
}

if (!GOOGLE_CLIENT_EMAIL) {
  console.error("❌ GOOGLE_CLIENT_EMAIL не задан.");
} else {
  console.log("✅ GOOGLE_CLIENT_EMAIL найден.");
}

if (!GOOGLE_PRIVATE_KEY) {
  console.error("❌ GOOGLE_PRIVATE_KEY не задан.");
} else {
  console.log("✅ GOOGLE_PRIVATE_KEY найден.");
}

if (!SPREADSHEET_ID) {
  console.error(
    "❌ SPREADSHEET_ID не задан в Environment Variables Render."
  );
} else {
  console.log("✅ SPREADSHEET_ID найден.");
}

if (!TELEGRAM_BOT_TOKEN) {
  console.error("❌ TELEGRAM_BOT_TOKEN отсутствует.");
}

// ======================================================
// GOOGLE SHEETS
// ======================================================

let cachedSheetTitle = null;

function getGoogleAuth() {
  if (!GOOGLE_CLIENT_EMAIL) {
    throw new Error(
      "GOOGLE_CLIENT_EMAIL не задан в Environment Variables Render."
    );
  }

  if (!GOOGLE_PRIVATE_KEY) {
    throw new Error(
      "GOOGLE_PRIVATE_KEY не задан в Environment Variables Render."
    );
  }

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
  if (!SPREADSHEET_ID) {
    throw new Error(
      "SPREADSHEET_ID не задан в Environment Variables Render."
    );
  }

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

  if (!SPREADSHEET_ID) {
    throw new Error(
      "SPREADSHEET_ID не задан в Environment Variables Render."
    );
  }

  const sheets = await getSheets();

  const response = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: "sheets.properties",
  });

  const sheet =
    response.data.sheets &&
    response.data.sheets[0];

  if (!sheet) {
    throw new Error(
      "В Google Sheets нет ни одного листа."
    );
  }

  cachedSheetTitle = sheet.properties.title;

  return cachedSheetTitle;
}

// ======================================================
// GOOGLE SHEETS DATA
// ======================================================

async function getAllPassengers() {
  const sheets = await getSheets();
  const sheetTitle = await getSheetTitle();

  const response =
    await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetTitle}!A:L`,
    });

  const rows = response.data.values || [];

  if (rows.length <= 1) {
    return [];
  }

  return rows.slice(1).map((row, index) => ({
    rowNumber: index + 2,

    id: row[0] || "",
    lastName: row[1] || "",
    firstName: row[2] || "",
    middleName: row[3] || "",
    birthDate: row[4] || "",
    passport: row[5] || "",
    citizenship: row[6] || "",
    contact1: row[7] || "",
    contact2: row[8] || "",
    flightDate: row[9] || "",
    route: row[10] || "",
    status: row[11] || "",
  }));
}

// ======================================================
// TELEGRAM
// ======================================================

async function telegramRequest(method, body = {}) {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN не задан."
    );
  }

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
    console.error(
      `Telegram API error ${method}:`,
      data
    );

    throw new Error(
      data.description ||
        `Telegram API error: ${method}`
    );
  }

  return data.result;
}

async function sendMessage(
  chatId,
  text,
  reply_markup = undefined
) {
  const body = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
  };

  if (reply_markup) {
    body.reply_markup = reply_markup;
  }

  return telegramRequest("sendMessage", body);
}

async function editMessageText(
  chatId,
  messageId,
  text,
  reply_markup = undefined
) {
  const body = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
  };

  if (reply_markup) {
    body.reply_markup = reply_markup;
  }

  try {
    return await telegramRequest(
      "editMessageText",
      body
    );
  } catch (error) {
    if (
      error.message &&
      error.message.includes(
        "message is not modified"
      )
    ) {
      return null;
    }

    throw error;
  }
}

async function answerCallbackQuery(
  callbackQueryId,
  text = ""
) {
  return telegramRequest(
    "answerCallbackQuery",
    {
      callback_query_id: callbackQueryId,
      text,
      show_alert: false,
    }
  );
}

async function deleteMessage(
  chatId,
  messageId
) {
  try {
    return await telegramRequest(
      "deleteMessage",
      {
        chat_id: chatId,
        message_id: messageId,
      }
    );
  } catch (error) {
    return null;
  }
}

// ======================================================
// MAIN MENU
// ======================================================

function mainMenuKeyboard() {
  return {
    keyboard: [
      [
        {
          text: "➕ Добавить пассажира",
        },
      ],
      [
        {
          text: "📥 Загрузить Excel",
        },
        {
          text: "👤 Посмотреть данные",
        },
      ],
      [
        {
          text: "🔎 Найти пассажира",
        },
        {
          text: "✈️ Пассажиры рейса",
        },
      ],
      [
        {
          text: "📊 Статистика",
        },
      ],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

async function showMainMenu(chatId) {
  await sendMessage(
    chatId,
    "🏠 <b>Главное меню</b>\n\nВыберите действие:",
    mainMenuKeyboard()
  );
}

// ======================================================
// USER STATES
// ======================================================

const userStates = new Map();

function getState(chatId) {
  if (!userStates.has(chatId)) {
    userStates.set(chatId, {
      mode: "idle",
      step: 0,
      data: {},
    });
  }

  return userStates.get(chatId);
}

function resetState(chatId) {
  userStates.set(chatId, {
    mode: "idle",
    step: 0,
    data: {},
  });
}

// ======================================================
// HELPERS
// ======================================================

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizePassport(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function normalizePhone(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeDate(value) {
  return String(value || "").trim();
}

function normalizeRoute(value) {
  let route = String(value || "")
    .trim()
    .toUpperCase();

  route = route
    .replace(/→/g, "—")
    .replace(/–/g, "—")
    .replace(/-/g, "—")
    .replace(/\s+/g, " ");

  route = route
    .replace(/\s*—\s*/g, " — ");

  if (
    route === "ДШБ — ХРГ" ||
    route === "ДШБ—ХРГ"
  ) {
    return "ДШБ — ХРГ";
  }

  if (
    route === "ХРГ — ДШБ" ||
    route === "ХРГ—ДШБ"
  ) {
    return "ХРГ — ДШБ";
  }

  return "";
}

function normalizeStatus(value) {
  const status = String(value || "")
    .trim()
    .toLowerCase();

  if (status === "забронирован") {
    return "Забронирован";
  }

  if (status === "подтвержден") {
    return "Подтвержден";
  }

  if (status === "отменен") {
    return "Отменен";
  }

  if (status === "отменён") {
    return "Отменен";
  }

  return "";
}

function isValidPhone(value) {
  const clean = String(value || "")
    .replace(/[^\d+]/g, "");

  return clean.length >= 7;
}

function isActivePassenger(passenger) {
  return passenger.status !== "Отменен";
}

function generatePassengerId(existingPassengers) {
  const existingIds = new Set(
    existingPassengers.map((p) => p.id)
  );

  let id;

  do {
    id =
      "P" +
      Date.now().toString(36).toUpperCase() +
      Math.floor(
        100 + Math.random() * 900
      );
  } while (existingIds.has(id));

  return id;
}

// ======================================================
// CAPACITY
// ======================================================

function calculateRouteOccupancy(
  passengers,
  flightDate,
  route,
  excludeRowNumber = null
) {
  return passengers.filter((p) => {
    if (
      excludeRowNumber !== null &&
      p.rowNumber === excludeRowNumber
    ) {
      return false;
    }

    if (!isActivePassenger(p)) {
      return false;
    }

    return (
      p.flightDate === flightDate &&
      p.route === route
    );
  }).length;
}

// ======================================================
// SAVE / UPDATE GOOGLE SHEETS
// ======================================================

async function appendPassenger(data) {
  const sheets = await getSheets();
  const sheetTitle = await getSheetTitle();

  const passengers = await getAllPassengers();

  const id = generatePassengerId(
    passengers
  );

  const values = [
    [
      id,
      data.lastName,
      data.firstName,
      data.middleName,
      data.birthDate,
      data.passport,
      data.citizenship,
      data.contact1,
      data.contact2,
      data.flightDate,
      data.route,
      data.status,
    ],
  ];

  const response =
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetTitle}!A:L`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values,
      },
    });

  let rowNumber = null;

  if (
    response.data &&
    response.data.updates &&
    response.data.updates.updatedRange
  ) {
    const match =
      response.data.updates.updatedRange.match(
        /![A-Z]+(\d+):/
      );

    if (match) {
      rowNumber = Number(match[1]);
    }
  }

  return {
    id,
    rowNumber,
  };
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
          data.id,
          data.lastName,
          data.firstName,
          data.middleName,
          data.birthDate,
          data.passport,
          data.citizenship,
          data.contact1,
          data.contact2,
          data.flightDate,
          data.route,
          data.status,
        ],
      ],
    },
  });
}

// ======================================================
// REGISTRATION
// ======================================================

async function startRegistration(chatId) {
  resetState(chatId);

  const state = getState(chatId);

  state.mode = "registration";
  state.step = 1;
  state.data = {};

  await sendMessage(
    chatId,
    "➕ <b>Добавление пассажира</b>\n\nВведите <b>фамилию</b>:"
  );
}

function registrationBackKeyboard(step) {
  if (step <= 1) {
    return undefined;
  }

  return {
    inline_keyboard: [
      [
        {
          text: "⬅️ Назад",
          callback_data: `reg_back_${step - 1}`,
        },
      ],
      [
        {
          text: "❌ Отмена",
          callback_data: "reg_cancel",
        },
      ],
    ],
  };
}

async function askRegistrationStep(
  chatId
) {
  const state = getState(chatId);

  switch (state.step) {
    case 1:
      await sendMessage(
        chatId,
        "Введите <b>фамилию</b>:",
        registrationBackKeyboard(1)
      );
      break;

    case 2:
      await sendMessage(
        chatId,
        "Введите <b>имя</b>:",
        registrationBackKeyboard(2)
      );
      break;

    case 3:
      await sendMessage(
        chatId,
        "Введите <b>отчество</b>.\n\nЕсли отчества нет — нажмите «Пропустить».",
        {
          inline_keyboard: [
            [
              {
                text: "⏭️ Пропустить",
                callback_data:
                  "reg_middle_skip",
              },
            ],
            [
              {
                text: "⬅️ Назад",
                callback_data: "reg_back_2",
              },
            ],
            [
              {
                text: "❌ Отмена",
                callback_data:
                  "reg_cancel",
              },
            ],
          ],
        }
      );
      break;

    case 4:
      await showCalendar(
        chatId,
        "birth",
        state.data.birthDate || "",
        false
      );
      break;

    case 5:
      await sendMessage(
        chatId,
        "Введите <b>номер паспорта</b>:",
        registrationBackKeyboard(5)
      );
      break;

    case 6:
      await sendMessage(
        chatId,
        "Введите <b>гражданство</b>:",
        registrationBackKeyboard(6)
      );
      break;

    case 7:
      await sendMessage(
        chatId,
        "Введите <b>контактный номер 1</b>:\n\nНапример: +992900000000",
        {
          inline_keyboard: [
            [
              {
                text: "⏭️ Пропустить",
                callback_data:
                  "reg_contact1_skip",
              },
            ],
            [
              {
                text: "⬅️ Назад",
                callback_data:
                  "reg_back_6",
              },
            ],
            [
              {
                text: "❌ Отмена",
                callback_data:
                  "reg_cancel",
              },
            ],
          ],
        }
      );
      break;

    case 8:
      await sendMessage(
        chatId,
        "Введите <b>контактный номер 2</b>.\n\nМожно пропустить:",
        {
          inline_keyboard: [
            [
              {
                text: "⏭️ Пропустить",
                callback_data:
                  "reg_contact2_skip",
              },
            ],
            [
              {
                text: "⬅️ Назад",
                callback_data:
                  "reg_back_7",
              },
            ],
            [
              {
                text: "❌ Отмена",
                callback_data:
                  "reg_cancel",
              },
            ],
          ],
        }
      );
      break;

    case 9:
      await showCalendar(
        chatId,
        "flight",
        state.data.flightDate || "",
        false
      );
      break;

    case 10:
      await sendMessage(
        chatId,
        "Введите <b>маршрут</b>:",
        {
          inline_keyboard: [
            [
              {
                text: "ДШБ — ХРГ",
                callback_data:
                  "reg_route_DSB_KRG",
              },
            ],
            [
              {
                text: "ХРГ — ДШБ",
                callback_data:
                  "reg_route_KRG_DSB",
              },
            ],
            [
              {
                text: "⬅️ Назад",
                callback_data:
                  "reg_back_9",
              },
            ],
            [
              {
                text: "❌ Отмена",
                callback_data:
                  "reg_cancel",
              },
            ],
          ],
        }
      );
      break;

    case 11:
      await sendMessage(
        chatId,
        "Выберите <b>статус</b>:",
        {
          inline_keyboard: [
            [
              {
                text: "Забронирован",
                callback_data:
                  "reg_status_booked",
              },
            ],
            [
              {
                text: "Подтвержден",
                callback_data:
                  "reg_status_confirmed",
              },
            ],
            [
              {
                text: "Отменен",
                callback_data:
                  "reg_status_cancelled",
              },
            ],
            [
              {
                text: "⬅️ Назад",
                callback_data:
                  "reg_back_10",
              },
            ],
            [
              {
                text: "❌ Отмена",
                callback_data:
                  "reg_cancel",
              },
            ],
          ],
        }
      );
      break;
  }
}

// ======================================================
// CALENDAR
// ======================================================

function monthName(month) {
  const names = [
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

  return names[month - 1];
}

function getYearsKeyboard(
  type,
  edit = false
) {
  const now = new Date();
  const currentYear =
    now.getFullYear();

  const years =
    type === "birth"
      ? [
          currentYear - 100,
          currentYear - 80,
          currentYear - 60,
          currentYear - 40,
          currentYear - 20,
          currentYear,
        ]
      : [
          currentYear,
          currentYear + 1,
          currentYear + 2,
        ];

  const rows = [];

  for (let i = 0; i < years.length; i += 3) {
    rows.push(
      years.slice(i, i + 3).map(
        (year) => ({
          text: String(year),
          callback_data: edit
            ? `editcal_${type}_year_${year}`
            : `cal_${type}_year_${year}`,
        })
      )
    );
  }

  rows.push([
    {
      text: "❌ Отмена",
      callback_data: edit
        ? "edit_cancel"
        : "reg_cancel",
    },
  ]);

  return {
    inline_keyboard: rows,
  };
}

function getMonthsKeyboard(
  type,
  year,
  edit = false
) {
  const rows = [];

  for (let i = 1; i <= 12; i += 3) {
    const row = [];

    for (
      let month = i;
      month < i + 3 && month <= 12;
      month++
    ) {
      row.push({
        text: monthName(month),
        callback_data: edit
          ? `editcal_${type}_month_${year}_${month}`
          : `cal_${type}_month_${year}_${month}`,
      });
    }

    rows.push(row);
  }

  rows.push([
    {
      text: "⬅️ Год",
      callback_data: edit
        ? `editcal_${type}_back_year`
        : `cal_${type}_back_year`,
    },
  ]);

  return {
    inline_keyboard: rows,
  };
}

function getDaysKeyboard(
  type,
  year,
  month,
  edit = false
) {
  const rows = [];

  rows.push([
    { text: "Пн", callback_data: "noop" },
    { text: "Вт", callback_data: "noop" },
    { text: "Ср", callback_data: "noop" },
    { text: "Чт", callback_data: "noop" },
    { text: "Пт", callback_data: "noop" },
    { text: "Сб", callback_data: "noop" },
    { text: "Вс", callback_data: "noop" },
  ]);

  const firstDay = new Date(
    year,
    month - 1,
    1
  );

  let weekday =
    firstDay.getDay();

  if (weekday === 0) {
    weekday = 7;
  }

  let row = [];

  for (let i = 1; i < weekday; i++) {
    row.push({
      text: " ",
      callback_data: "noop",
    });
  }

  const daysInMonth =
    new Date(
      year,
      month,
      0
    ).getDate();

  for (
    let day = 1;
    day <= daysInMonth;
    day++
  ) {
    row.push({
      text: String(day),
      callback_data: edit
        ? `editcal_${type}_day_${year}_${month}_${day}`
        : `cal_${type}_day_${year}_${month}_${day}`,
    });

    if (row.length === 7) {
      rows.push(row);
      row = [];
    }
  }

  while (
    row.length > 0 &&
    row.length < 7
  ) {
    row.push({
      text: " ",
      callback_data: "noop",
    });
  }

  if (row.length) {
    rows.push(row);
  }

  rows.push([
    {
      text: "⬅️ Месяц",
      callback_data: edit
        ? `editcal_${type}_back_month_${year}`
        : `cal_${type}_back_month_${year}`,
    },
  ]);

  return {
    inline_keyboard: rows,
  };
}

async function showCalendar(
  chatId,
  type,
  currentValue = "",
  edit = false
) {
  await sendMessage(
    chatId,
    type === "birth"
      ? "📅 Выберите <b>год рождения</b>:"
      : "📅 Выберите <b>год рейса</b>:",
    getYearsKeyboard(type, edit)
  );
}

// ======================================================
// FINISH REGISTRATION
// ======================================================

async function finishRegistration(
  chatId
) {
  const state = getState(chatId);
  const data = state.data;

  const passengers =
    await getAllPassengers();

  const duplicate =
    passengers.find(
      (p) =>
        normalizePassport(
          p.passport
        ) ===
        normalizePassport(
          data.passport
        )
    );

  if (duplicate) {
    await sendMessage(
      chatId,
      "❌ Пассажир с таким номером паспорта уже существует."
    );

    resetState(chatId);
    await showMainMenu(chatId);
    return;
  }

  const occupancy =
    calculateRouteOccupancy(
      passengers,
      data.flightDate,
      data.route
    );

  if (
    data.status !== "Отменен" &&
    occupancy >= CAPACITY
  ) {
    await sendMessage(
      chatId,
      `❌ На рейс <b>${escapeHtml(
        data.route
      )}</b> на дату <b>${escapeHtml(
        data.flightDate
      )}</b> уже зарегистрировано ${occupancy}/${CAPACITY} пассажиров.`
    );

    resetState(chatId);
    await showMainMenu(chatId);
    return;
  }

  const result =
    await appendPassenger(data);

  await sendMessage(
    chatId,
    `✅ <b>Пассажир успешно добавлен.</b>\n\n` +
      `ID: <b>${escapeHtml(
        result.id
      )}</b>\n` +
      `ФИО: <b>${escapeHtml(
        data.lastName
      )} ${escapeHtml(
        data.firstName
      )} ${escapeHtml(
        data.middleName
      )}</b>\n` +
      `Дата рождения: <b>${escapeHtml(
        data.birthDate
      )}</b>\n` +
      `Паспорт: <b>${escapeHtml(
        data.passport
      )}</b>\n` +
      `Гражданство: <b>${escapeHtml(
        data.citizenship
      )}</b>\n` +
      `Рейс: <b>${escapeHtml(
        data.flightDate
      )}</b>\n` +
      `Маршрут: <b>${escapeHtml(
        data.route
      )}</b>\n` +
      `Статус: <b>${escapeHtml(
        data.status
      )}</b>`
  );

  resetState(chatId);
  await showMainMenu(chatId);
}

// ======================================================
// VIEW DATA
// ======================================================

const VIEW_PAGE_SIZE = 8;

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
          VIEW_PAGE_SIZE
      )
    );

  const start =
    page * VIEW_PAGE_SIZE;

  const pagePassengers =
    passengers.slice(
      start,
      start + VIEW_PAGE_SIZE
    );

  const keyboard = [];

  for (const passenger of pagePassengers) {
    keyboard.push([
      {
        text:
          `${passenger.lastName} ` +
          `${passenger.firstName} ` +
          `(${passenger.flightDate})`,
        callback_data:
          `${prefix}_${passenger.rowNumber}`,
      },
    ]);
  }

  const navigation = [];

  if (page > 0) {
    navigation.push({
      text: "⬅️",
      callback_data:
        `${prefix}_page_${page - 1}`,
    });
  }

  navigation.push({
    text: `${page + 1}/${totalPages}`,
    callback_data: "noop",
  });

  if (page < totalPages - 1) {
    navigation.push({
      text: "➡️",
      callback_data:
        `${prefix}_page_${page + 1}`,
    });
  }

  if (navigation.length) {
    keyboard.push(navigation);
  }

  keyboard.push([
    {
      text: "🏠 Главное меню",
      callback_data: "main_menu",
    },
  ]);

  return {
    inline_keyboard: keyboard,
  };
}

async function showPassengers(
  chatId,
  page = 0
) {
  const passengers =
    await getAllPassengers();

  if (!passengers.length) {
    await sendMessage(
      chatId,
      "📭 В базе пока нет пассажиров.",
      mainMenuKeyboard()
    );
    return;
  }

  await sendMessage(
    chatId,
    `👤 <b>Пассажиры</b>\n\nВсего: ${passengers.length}`,
    getPassengerListKeyboard(
      passengers,
      page,
      "view_passenger"
    )
  );
}

// ======================================================
// PASSENGER CARD
// ======================================================

function passengerCardText(
  passenger
) {
  return (
    `👤 <b>Данные пассажира</b>\n\n` +
    `ID: <b>${escapeHtml(
      passenger.id
    )}</b>\n` +
    `Фамилия: <b>${escapeHtml(
      passenger.lastName
    )}</b>\n` +
    `Имя: <b>${escapeHtml(
      passenger.firstName
    )}</b>\n` +
    `Отчество: <b>${escapeHtml(
      passenger.middleName || "—"
    )}</b>\n` +
    `Дата рождения: <b>${escapeHtml(
      passenger.birthDate
    )}</b>\n` +
    `Паспорт: <b>${escapeHtml(
      passenger.passport
    )}</b>\n` +
    `Гражданство: <b>${escapeHtml(
      passenger.citizenship
    )}</b>\n` +
    `Контакт 1: <b>${escapeHtml(
      passenger.contact1 || "—"
    )}</b>\n` +
    `Контакт 2: <b>${escapeHtml(
      passenger.contact2 || "—"
    )}</b>\n` +
    `Дата рейса: <b>${escapeHtml(
      passenger.flightDate
    )}</b>\n` +
    `Маршрут: <b>${escapeHtml(
      passenger.route
    )}</b>\n` +
    `Статус: <b>${escapeHtml(
      passenger.status
    )}</b>`
  );
}

async function showPassengerCard(
  chatId,
  passenger,
  messageId = null
) {
  const keyboard = {
    inline_keyboard: [
      [
        {
          text: "✏️ Редактировать",
          callback_data:
            `edit_passenger_${passenger.rowNumber}`,
        },
      ],
      [
        {
          text: "⬅️ Назад",
          callback_data:
            "back_to_passengers",
        },
      ],
      [
        {
          text: "🏠 Главное меню",
          callback_data:
            "main_menu",
        },
      ],
    ],
  };

  if (messageId) {
    await editMessageText(
      chatId,
      messageId,
      passengerCardText(passenger),
      keyboard
    );
  } else {
    await sendMessage(
      chatId,
      passengerCardText(passenger),
      keyboard
    );
  }
}

// ======================================================
// EDITING
// ======================================================

async function startEditPassenger(
  chatId,
  passenger
) {
  const state = getState(chatId);

  state.mode = "edit";
  state.step = 1;
  state.data = {
    ...passenger,
  };
  state.editRowNumber =
    passenger.rowNumber;

  await sendMessage(
    chatId,
    `✏️ <b>Редактирование пассажира</b>\n\n` +
      `Что хотите изменить?`,
    {
      inline_keyboard: [
        [
          {
            text: "Фамилия",
            callback_data:
              "edit_field_lastName",
          },
          {
            text: "Имя",
            callback_data:
              "edit_field_firstName",
          },
        ],
        [
          {
            text: "Отчество",
            callback_data:
              "edit_field_middleName",
          },
        ],
        [
          {
            text: "Дата рождения",
            callback_data:
              "edit_field_birthDate",
          },
        ],
        [
          {
            text: "Паспорт",
            callback_data:
              "edit_field_passport",
          },
        ],
        [
          {
            text: "Гражданство",
            callback_data:
              "edit_field_citizenship",
          },
        ],
        [
          {
            text: "Контакт 1",
            callback_data:
              "edit_field_contact1",
          },
          {
            text: "Контакт 2",
            callback_data:
              "edit_field_contact2",
          },
        ],
        [
          {
            text: "Дата рейса",
            callback_data:
              "edit_field_flightDate",
          },
        ],
        [
          {
            text: "Маршрут",
            callback_data:
              "edit_field_route",
          },
        ],
        [
          {
            text: "Статус",
            callback_data:
              "edit_field_status",
          },
        ],
        [
          {
            text: "❌ Отмена",
            callback_data:
              "edit_cancel",
          },
        ],
      ],
    }
  );
}

async function saveEditedPassenger(
  chatId
) {
  const state = getState(chatId);
  const data = state.data;

  const passengers =
    await getAllPassengers();

  const current =
    passengers.find(
      (p) =>
        p.rowNumber ===
        state.editRowNumber
    );

  if (!current) {
    await sendMessage(
      chatId,
      "❌ Пассажир не найден."
    );

    resetState(chatId);
    await showMainMenu(chatId);
    return;
  }

  if (
    normalizePassport(
      data.passport
    ) !==
    normalizePassport(
      current.passport
    )
  ) {
    const duplicate =
      passengers.find(
        (p) =>
          p.rowNumber !==
            state.editRowNumber &&
          normalizePassport(
            p.passport
          ) ===
            normalizePassport(
              data.passport
            )
      );

    if (duplicate) {
      await sendMessage(
        chatId,
        "❌ Такой номер паспорта уже существует."
      );
      return;
    }
  }

  if (
    data.status !== "Отменен"
  ) {
    const occupancy =
      calculateRouteOccupancy(
        passengers,
        data.flightDate,
        data.route,
        state.editRowNumber
      );

    if (
      occupancy >= CAPACITY
    ) {
      await sendMessage(
        chatId,
        `❌ На рейсе уже ${occupancy}/${CAPACITY} пассажиров.`
      );
      return;
    }
  }

  await updatePassenger(
    state.editRowNumber,
    data
  );

  await sendMessage(
    chatId,
    "✅ Данные пассажира успешно изменены."
  );

  resetState(chatId);
  await showMainMenu(chatId);
}

// ======================================================
// SEARCH
// ======================================================

async function startSearch(
  chatId
) {
  resetState(chatId);

  const state = getState(chatId);

  state.mode = "search";

  await sendMessage(
    chatId,
    "🔎 Введите <b>фамилию, имя, паспорт или ID</b> пассажира:"
  );
}

async function performSearch(
  chatId,
  query
) {
  const passengers =
    await getAllPassengers();

  const q =
    String(query || "")
      .trim()
      .toLowerCase();

  const passportQuery =
    normalizePassport(query);

  const results =
    passengers.filter((p) => {
      return (
        String(p.id)
          .toLowerCase()
          .includes(q) ||
        String(p.lastName)
          .toLowerCase()
          .includes(q) ||
        String(p.firstName)
          .toLowerCase()
          .includes(q) ||
        String(p.middleName)
          .toLowerCase()
          .includes(q) ||
        normalizePassport(
          p.passport
        ).includes(passportQuery)
      );
    });

  if (!results.length) {
    await sendMessage(
      chatId,
      "❌ Пассажир не найден.",
      mainMenuKeyboard()
    );
    resetState(chatId);
    return;
  }

  if (results.length === 1) {
    resetState(chatId);
    await showPassengerCard(
      chatId,
      results[0]
    );
    return;
  }

  await sendMessage(
    chatId,
    `🔎 Найдено пассажиров: <b>${results.length}</b>`,
    getPassengerListKeyboard(
      results,
      0,
      "search_passenger"
    )
  );

  resetState(chatId);
}

// ======================================================
// FLIGHT PASSENGERS
// ======================================================

async function showFlightPassengers(
  chatId
) {
  const passengers =
    await getAllPassengers();

  if (!passengers.length) {
    await sendMessage(
      chatId,
      "📭 В базе нет пассажиров.",
      mainMenuKeyboard()
    );
    return;
  }

  const dates = [
    ...new Set(
      passengers
        .filter(
          (p) =>
            p.flightDate &&
            p.route
        )
        .map(
          (p) =>
            `${p.flightDate}|${p.route}`
        )
    ),
  ];

  if (!dates.length) {
    await sendMessage(
      chatId,
      "📭 Нет данных по рейсам.",
      mainMenuKeyboard()
    );
    return;
  }

  const keyboard = [];

  for (const item of dates) {
    const [
      date,
      route,
    ] = item.split("|");

    keyboard.push([
      {
        text: `${date} — ${route}`,
        callback_data:
          `flight_show_${encodeURIComponent(
            date
          )}_${encodeURIComponent(
            route
          )}`,
      },
    ]);
  }

  keyboard.push([
    {
      text: "🏠 Главное меню",
      callback_data:
        "main_menu",
    },
  ]);

  await sendMessage(
    chatId,
    "✈️ <b>Пассажиры рейса</b>\n\nВыберите рейс:",
    {
      inline_keyboard:
        keyboard,
    }
  );
}

async function showFlightPassengersByDateRoute(
  chatId,
  date,
  route
) {
  const passengers =
    await getAllPassengers();

  const result =
    passengers.filter(
      (p) =>
        p.flightDate === date &&
        p.route === route
    );

  if (!result.length) {
    await sendMessage(
      chatId,
      "📭 Пассажиров нет."
    );
    return;
  }

  let text =
    `✈️ <b>${escapeHtml(
      date
    )}</b>\n` +
    `<b>${escapeHtml(
      route
    )}</b>\n\n`;

  result.forEach(
    (p, index) => {
      text +=
        `${index + 1}. ` +
        `<b>${escapeHtml(
          p.lastName
        )} ${escapeHtml(
          p.firstName
        )}</b>\n` +
        `Паспорт: ${escapeHtml(
          p.passport
        )}\n` +
        `Статус: ${escapeHtml(
          p.status
        )}\n\n`;
    }
  );

  await sendMessage(
    chatId,
    text,
    {
      inline_keyboard: [
        [
          {
            text: "⬅️ Назад",
            callback_data:
              "flight_passengers_back",
          },
        ],
        [
          {
            text: "🏠 Главное меню",
            callback_data:
              "main_menu",
          },
        ],
      ],
    }
  );
}

// ======================================================
// STATISTICS
// ======================================================

async function showStatistics(
  chatId
) {
  const passengers =
    await getAllPassengers();

  const total =
    passengers.length;

  const active =
    passengers.filter(
      (p) =>
        p.status !==
        "Отменен"
    ).length;

  const cancelled =
    passengers.filter(
      (p) =>
        p.status ===
        "Отменен"
    ).length;

  const booked =
    passengers.filter(
      (p) =>
        p.status ===
        "Забронирован"
    ).length;

  const confirmed =
    passengers.filter(
      (p) =>
        p.status ===
        "Подтвержден"
    ).length;

  const flights =
    new Set(
      passengers
        .filter(
          (p) =>
            p.flightDate &&
            p.route
        )
        .map(
          (p) =>
            `${p.flightDate}|${p.route}`
        )
    ).size;

  await sendMessage(
    chatId,
    `📊 <b>Статистика</b>\n\n` +
      `👥 Всего пассажиров: <b>${total}</b>\n` +
      `✅ Активных: <b>${active}</b>\n` +
      `🟢 Забронировано: <b>${booked}</b>\n` +
      `🔵 Подтверждено: <b>${confirmed}</b>\n` +
      `🔴 Отменено: <b>${cancelled}</b>\n` +
      `✈️ Рейсов: <b>${flights}</b>`,
    mainMenuKeyboard()
  );
}

// ======================================================
// EXCEL
// ======================================================

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
  "Статус",
];

function excelSerialToDate(
  serial
) {
  const utcDays =
    Math.floor(serial - 25569);

  const utcValue =
    utcDays * 86400 * 1000;

  const date =
    new Date(utcValue);

  return date;
}

function formatDate(date) {
  const day = String(
    date.getDate()
  ).padStart(2, "0");

  const month = String(
    date.getMonth() + 1
  ).padStart(2, "0");

  const year =
    date.getFullYear();

  return `${day}.${month}.${year}`;
}

function parseExcelDate(value) {
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

  const str = String(
    value || ""
  ).trim();

  if (!str) {
    return "";
  }

  let match =
    str.match(
      /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/
    );

  if (match) {
    return `${match[1].padStart(
      2,
      "0"
    )}.${match[2].padStart(
      2,
      "0"
    )}.${match[3]}`;
  }

  match =
    str.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
    );

  if (match) {
    return `${match[1].padStart(
      2,
      "0"
    )}.${match[2].padStart(
      2,
      "0"
    )}.${match[3]}`;
  }

  match =
    str.match(
      /^(\d{4})-(\d{1,2})-(\d{1,2})$/
    );

  if (match) {
    return `${match[3].padStart(
      2,
      "0"
    )}.${match[2].padStart(
      2,
      "0"
    )}.${match[1]}`;
  }

  return "";
}

function normalizeExcelRoute(
  value
) {
  const route =
    String(value || "")
      .trim()
      .toUpperCase()
      .replace(/–/g, "—")
      .replace(/-/g, "—")
      .replace(/\s+/g, "")
      .replace(/—/g, "—");

  if (
    route === "ДШБ—ХРГ"
  ) {
    return "ДШБ — ХРГ";
  }

  if (
    route === "ХРГ—ДШБ"
  ) {
    return "ХРГ — ДШБ";
  }

  return "";
}

function validateExcelPassenger(
  row,
  rowNumber
) {
  const data = {
    lastName: String(
      row["Фамилия"] || ""
    ).trim(),

    firstName: String(
      row["Имя"] || ""
    ).trim(),

    middleName: String(
      row["Отчество"] || ""
    ).trim(),

    birthDate:
      parseExcelDate(
        row["Дата рождения"]
      ),

    passport: normalizePassport(
      row["Паспорт"]
    ),

    citizenship: String(
      row["Гражданство"] || ""
    ).trim(),

    contact1: normalizePhone(
      row["Контакт 1"]
    ),

    contact2: normalizePhone(
      row["Контакт 2"]
    ),

    flightDate:
      parseExcelDate(
        row["Дата рейса"]
      ),

    route:
      normalizeExcelRoute(
        row["Маршрут"]
      ),

    status:
      normalizeStatus(
        row["Статус"]
      ),
  };

  const errors = [];

  if (!data.lastName) {
    errors.push(
      "не указана фамилия"
    );
  }

  if (!data.firstName) {
    errors.push(
      "не указано имя"
    );
  }

  if (!data.birthDate) {
    errors.push(
      "неверная дата рождения"
    );
  }

  if (!data.passport) {
    errors.push(
      "не указан паспорт"
    );
  }

  if (!data.citizenship) {
    errors.push(
      "не указано гражданство"
    );
  }

  if (!data.flightDate) {
    errors.push(
      "неверная дата рейса"
    );
  }

  if (!data.route) {
    errors.push(
      "неверный маршрут"
    );
  }

  if (!data.status) {
    errors.push(
      "неверный статус"
    );
  }

  if (
    data.contact1 &&
    !isValidPhone(
      data.contact1
    )
  ) {
    errors.push(
      "неверный Контакт 1"
    );
  }

  if (
    data.contact2 &&
    !isValidPhone(
      data.contact2
    )
  ) {
    errors.push(
      "неверный Контакт 2"
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    data,
    rowNumber,
  };
}

async function handleExcelDocument(
  message
) {
  const chatId =
    message.chat.id;

  try {
    const document =
      message.document;

    if (!document) {
      return;
    }

    const fileName =
      document.file_name ||
      "";

    if (
      !fileName
        .toLowerCase()
        .endsWith(".xlsx")
    ) {
      await sendMessage(
        chatId,
        "❌ Пожалуйста, загрузите файл в формате <b>.xlsx</b>."
      );
      return;
    }

    await sendMessage(
      chatId,
      "⏳ Excel получен. Проверяю данные..."
    );

    const fileInfo =
      await telegramRequest(
        "getFile",
        {
          file_id:
            document.file_id,
        }
      );

    if (
      !fileInfo ||
      !fileInfo.file_path
    ) {
      throw new Error(
        "Не удалось получить путь к Excel-файлу."
      );
    }

    const fileResponse =
      await fetch(
        `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${fileInfo.file_path}`
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

    const workbook =
      XLSX.read(buffer, {
        type: "buffer",
        cellDates: true,
      });

    const sheetName =
      workbook.SheetNames[0];

    if (!sheetName) {
      throw new Error(
        "Excel-файл не содержит листов."
      );
    }

    const worksheet =
      workbook.Sheets[
        sheetName
      ];

    const rawRows =
      XLSX.utils.sheet_to_json(
        worksheet,
        {
          defval: "",
        }
      );

    if (!rawRows.length) {
      await sendMessage(
        chatId,
        "❌ Excel-файл пустой."
      );
      return;
    }

    // Проверяем заголовки
    const firstRow =
      rawRows[0];

    const headers =
      Object.keys(firstRow);

    const missingHeaders =
      REQUIRED_EXCEL_HEADERS.filter(
        (header) =>
          !headers.includes(header)
      );

    if (
      missingHeaders.length
    ) {
      await sendMessage(
        chatId,
        "❌ В Excel отсутствуют обязательные столбцы:\n\n" +
          missingHeaders
            .map(
              (h) => `• ${h}`
            )
            .join("\n")
      );

      return;
    }

    const passengers =
      await getAllPassengers();

    const existingPassports =
      new Set(
        passengers.map(
          (p) =>
            normalizePassport(
              p.passport
            )
        )
      );

    const importedPassports =
      new Set();

    const flightOccupancy =
      new Map();

    for (const passenger of passengers) {
      if (
        !isActivePassenger(
          passenger
        )
      ) {
        continue;
      }

      const key =
        `${passenger.flightDate}|${passenger.route}`;

      flightOccupancy.set(
        key,
        (flightOccupancy.get(
          key
        ) || 0) + 1
      );
    }

    const validRows = [];

    const duplicates = [];

    const capacityFull = [];

    const errors = [];

    for (
      let i = 0;
      i < rawRows.length;
      i++
    ) {
      const excelRowNumber =
        i + 2;

      const validation =
        validateExcelPassenger(
          rawRows[i],
          excelRowNumber
        );

      if (!validation.valid) {
        errors.push({
          row:
            excelRowNumber,
          errors:
            validation.errors,
        });

        continue;
      }

      const data =
        validation.data;

      const passport =
        normalizePassport(
          data.passport
        );

      if (
        existingPassports.has(
          passport
        ) ||
        importedPassports.has(
          passport
        )
      ) {
        duplicates.push({
          row:
            excelRowNumber,
          passport,
        });

        continue;
      }

      const key =
        `${data.flightDate}|${data.route}`;

      const currentOccupancy =
        flightOccupancy.get(
          key
        ) || 0;

      if (
        data.status !==
          "Отменен" &&
        currentOccupancy >=
          CAPACITY
      ) {
        capacityFull.push({
          row:
            excelRowNumber,
          flightDate:
            data.flightDate,
          route:
            data.route,
        });

        continue;
      }

      if (
        data.status !==
        "Отменен"
      ) {
        flightOccupancy.set(
          key,
          currentOccupancy + 1
        );
      }

      importedPassports.add(
        passport
      );

      validRows.push(
        data
      );
    }

    // ==================================================
    // ДОБАВЛЕНИЕ В GOOGLE SHEETS
    // ==================================================

    if (validRows.length) {
      const sheets =
        await getSheets();

      const sheetTitle =
        await getSheetTitle();

      const rowsToAppend =
        [];

      let existing =
        await getAllPassengers();

      const usedIds =
        new Set(
          existing.map(
            (p) => p.id
          )
        );

      for (
        const data of validRows
      ) {
        let id;

        do {
          id =
            "P" +
            Date.now()
              .toString(36)
              .toUpperCase() +
            Math.floor(
              100 +
                Math.random() *
                  900
            );
        } while (
          usedIds.has(id)
        );

        usedIds.add(id);

        rowsToAppend.push([
          id,
          data.lastName,
          data.firstName,
          data.middleName,
          data.birthDate,
          data.passport,
          data.citizenship,
          data.contact1,
          data.contact2,
          data.flightDate,
          data.route,
          data.status,
        ]);
      }

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
              rowsToAppend,
          },
        }
      );
    }

    // ==================================================
    // ОТЧЕТ
    // ==================================================

    let report =
      `📥 <b>Результат загрузки Excel</b>\n\n`;

    report +=
      `✅ Добавлено: <b>${validRows.length}</b>\n`;

    report +=
      `🔁 Дубликаты паспортов: <b>${duplicates.length}</b>\n`;

    report +=
      `🚫 Рейс заполнен: <b>${capacityFull.length}</b>\n`;

    report +=
      `⚠️ Ошибки строк: <b>${errors.length}</b>\n`;

    if (duplicates.length) {
      report +=
        `\n<b>Дубликаты:</b>\n`;

      duplicates
        .slice(0, 20)
        .forEach((item) => {
          report +=
            `• строка ${item.row}: ${escapeHtml(
              item.passport
            )}\n`;
        });
    }

    if (capacityFull.length) {
      report +=
        `\n<b>Заполненные рейсы:</b>\n`;

      capacityFull
        .slice(0, 20)
        .forEach((item) => {
          report +=
            `• строка ${item.row}: ${escapeHtml(
              item.flightDate
            )} — ${escapeHtml(
              item.route
            )}\n`;
        });
    }

    if (errors.length) {
      report +=
        `\n<b>Ошибки:</b>\n`;

      errors
        .slice(0, 20)
        .forEach((item) => {
          report +=
            `• строка ${item.row}: ${escapeHtml(
              item.errors.join(
                ", "
              )
            )}\n`;
        });
    }

    await sendMessage(
      chatId,
      report,
      mainMenuKeyboard()
    );
  } catch (error) {
    console.error(
      "Ошибка Excel:",
      error
    );

    await sendMessage(
      chatId,
      "❌ <b>Ошибка при обработке Excel.</b>\n\n" +
        escapeHtml(
          error.message ||
            "Неизвестная ошибка"
        ),
      mainMenuKeyboard()
    );
  }
}

// ======================================================
// TEXT MESSAGE HANDLER
// ======================================================

async function handleTextMessage(
  message
) {
  const chatId =
    message.chat.id;

  const text =
    String(
      message.text || ""
    ).trim();

  if (!text) {
    return;
  }

  // Главное меню
  if (
    text ===
    "➕ Добавить пассажира"
  ) {
    await startRegistration(
      chatId
    );
    return;
  }

  if (
    text ===
    "📥 Загрузить Excel"
  ) {
    resetState(chatId);

    await sendMessage(
      chatId,
      "📥 <b>Загрузка Excel</b>\n\n" +
        "Отправьте Excel-файл в формате <b>.xlsx</b>.\n\n" +
        "Обязательные столбцы:\n" +
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
        "Статус"
    );

    return;
  }

  if (
    text ===
    "👤 Посмотреть данные"
  ) {
    resetState(chatId);
    await showPassengers(
      chatId,
      0
    );
    return;
  }

  if (
    text ===
    "🔎 Найти пассажира"
  ) {
    await startSearch(
      chatId
    );
    return;
  }

  if (
    text ===
    "✈️ Пассажиры рейса"
  ) {
    resetState(chatId);
    await showFlightPassengers(
      chatId
    );
    return;
  }

  if (
    text ===
    "📊 Статистика"
  ) {
    resetState(chatId);
    await showStatistics(
      chatId
    );
    return;
  }

  if (
    text === "/start"
  ) {
    resetState(chatId);

    await sendMessage(
      chatId,
      "👋 <b>Добро пожаловать в KMRN Passenger Bot</b>\n\n" +
        "Система учета пассажиров.",
      mainMenuKeyboard()
    );

    return;
  }

  const state =
    getState(chatId);

  // ==================================================
  // ПОИСК
  // ==================================================

  if (
    state.mode === "search"
  ) {
    await performSearch(
      chatId,
      text
    );
    return;
  }

  // ==================================================
  // РЕДАКТИРОВАНИЕ
  // ==================================================

  if (
    state.mode ===
    "edit_text"
  ) {
    const field =
      state.editField;

    if (
      field === "passport"
    ) {
      state.data.passport =
        normalizePassport(
          text
        );
    } else if (
      field === "contact1" ||
      field === "contact2"
    ) {
      if (
        !isValidPhone(text)
      ) {
        await sendMessage(
          chatId,
          "❌ Введите корректный номер телефона."
        );
        return;
      }

      state.data[field] =
        normalizePhone(text);
    } else {
      state.data[field] =
        text;
    }

    state.mode = "edit";

    await saveEditedPassenger(
      chatId
    );

    return;
  }

  // ==================================================
  // РЕГИСТРАЦИЯ
  // ==================================================

  if (
    state.mode ===
    "registration"
  ) {
    switch (
      state.step
    ) {
      case 1:
        state.data.lastName =
          text;
        state.step = 2;
        await askRegistrationStep(
          chatId
        );
        return;

      case 2:
        state.data.firstName =
          text;
        state.step = 3;
        await askRegistrationStep(
          chatId
        );
        return;

      case 3:
        state.data.middleName =
          text;
        state.step = 4;
        await askRegistrationStep(
          chatId
        );
        return;

      case 5:
        state.data.passport =
          normalizePassport(
            text
          );

        const passengers =
          await getAllPassengers();

        const duplicate =
          passengers.find(
            (p) =>
              normalizePassport(
                p.passport
              ) ===
              normalizePassport(
                text
              )
          );

        if (duplicate) {
          await sendMessage(
            chatId,
            "❌ Такой номер паспорта уже зарегистрирован.\n\nВведите другой номер паспорта:"
          );
          return;
        }

        state.step = 6;

        await askRegistrationStep(
          chatId
        );
        return;

      case 6:
        state.data.citizenship =
          text;

        state.step = 7;

        await askRegistrationStep(
          chatId
        );
        return;

      case 7:
        if (
          !isValidPhone(text)
        ) {
          await sendMessage(
            chatId,
            "❌ Неверный номер телефона.\n\nВведите корректный номер:"
          );
          return;
        }

        state.data.contact1 =
          normalizePhone(
            text
          );

        state.step = 8;

        await askRegistrationStep(
          chatId
        );
        return;

      case 8:
        if (
          !isValidPhone(text)
        ) {
          await sendMessage(
            chatId,
            "❌ Неверный номер телефона.\n\nВведите корректный номер или нажмите «Пропустить»."
          );
          return;
        }

        state.data.contact2 =
          normalizePhone(
            text
          );

        state.step = 9;

        await askRegistrationStep(
          chatId
        );
        return;
    }
  }
}

// ======================================================
// CALLBACK HANDLER
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
  // NOOP
  // ==================================================

  if (data === "noop") {
    return;
  }

  // ==================================================
  // MAIN MENU
  // ==================================================

  if (data === "main_menu") {
    resetState(chatId);

    await deleteMessage(
      chatId,
      messageId
    );

    await showMainMenu(chatId);
    return;
  }

  // ==================================================
  // REGISTRATION CANCEL
  // ==================================================

  if (
    data === "reg_cancel"
  ) {
    resetState(chatId);

    await deleteMessage(
      chatId,
      messageId
    );

    await showMainMenu(chatId);
    return;
  }

  // ==================================================
  // REGISTRATION MIDDLE NAME SKIP
  // ==================================================

  if (
    data ===
    "reg_middle_skip"
  ) {
    const state =
      getState(chatId);

    state.data.middleName =
      "";

    state.step = 4;

    await deleteMessage(
      chatId,
      messageId
    );

    await askRegistrationStep(
      chatId
    );

    return;
  }

  // ==================================================
  // REGISTRATION CONTACT 1 SKIP
  // ==================================================

  if (
    data ===
    "reg_contact1_skip"
  ) {
    const state =
      getState(chatId);

    state.data.contact1 =
      "";

    state.step = 8;

    await deleteMessage(
      chatId,
      messageId
    );

    await askRegistrationStep(
      chatId
    );

    return;
  }

  // ==================================================
  // REGISTRATION CONTACT 2 SKIP
  // ==================================================

  if (
    data ===
    "reg_contact2_skip"
  ) {
    const state =
      getState(chatId);

    state.data.contact2 =
      "";

    state.step = 9;

    await deleteMessage(
      chatId,
      messageId
    );

    await askRegistrationStep(
      chatId
    );

    return;
  }

  // ==================================================
  // REGISTRATION BACK
  // ==================================================

  if (
    data.startsWith(
      "reg_back_"
    )
  ) {
    const step = Number(
      data.replace(
        "reg_back_",
        ""
      )
    );

    if (!isNaN(step)) {
      const state =
        getState(chatId);

      state.step = step;

      await deleteMessage(
        chatId,
        messageId
      );

      await askRegistrationStep(
        chatId
      );
    }

    return;
  }

  // ==================================================
  // REGISTRATION CALENDAR
  // ==================================================

  if (
    data.startsWith(
      "cal_birth_year_"
    )
  ) {
    const year = Number(
      data.replace(
        "cal_birth_year_",
        ""
      )
    );

    await editMessageText(
      chatId,
      messageId,
      "📅 Выберите месяц:",
      getMonthsKeyboard(
        "birth",
        year,
        false
      )
    );

    return;
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

    await editMessageText(
      chatId,
      messageId,
      `📅 ${monthName(
        month
      )} ${year}\n\nВыберите день:`,
      getDaysKeyboard(
        "birth",
        year,
        month,
        false
      )
    );

    return;
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

    state.data.birthDate =
      `${String(day).padStart(
        2,
        "0"
      )}.${String(
        month
      ).padStart(
        2,
        "0"
      )}.${year}`;

    state.step = 5;

    await deleteMessage(
      chatId,
      messageId
    );

    await askRegistrationStep(
      chatId
    );

    return;
  }

  if (
    data.startsWith(
      "cal_flight_year_"
    )
  ) {
    const year = Number(
      data.replace(
        "cal_flight_year_",
        ""
      )
    );

    await editMessageText(
      chatId,
      messageId,
      "📅 Выберите месяц:",
      getMonthsKeyboard(
        "flight",
        year,
        false
      )
    );

    return;
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

    await editMessageText(
      chatId,
      messageId,
      `📅 ${monthName(
        month
      )} ${year}\n\nВыберите день:`,
      getDaysKeyboard(
        "flight",
        year,
        month,
        false
      )
    );

    return;
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

    state.data.flightDate =
      `${String(day).padStart(
        2,
        "0"
      )}.${String(
        month
      ).padStart(
        2,
        "0"
      )}.${year}`;

    state.step = 10;

    await deleteMessage(
      chatId,
      messageId
    );

    await askRegistrationStep(
      chatId
    );

    return;
  }

  // ==================================================
  // REGISTRATION ROUTE
  // ==================================================

  if (
    data ===
    "reg_route_DSB_KRG"
  ) {
    const state =
      getState(chatId);

    state.data.route =
      "ДШБ — ХРГ";

    state.step = 11;

    await deleteMessage(
      chatId,
      messageId
    );

    await askRegistrationStep(
      chatId
    );

    return;
  }

  if (
    data ===
    "reg_route_KRG_DSB"
  ) {
    const state =
      getState(chatId);

    state.data.route =
      "ХРГ — ДШБ";

    state.step = 11;

    await deleteMessage(
      chatId,
      messageId
    );

    await askRegistrationStep(
      chatId
    );

    return;
  }

  // ==================================================
  // REGISTRATION STATUS
  // ==================================================

  if (
    data.startsWith(
      "reg_status_"
    )
  ) {
    const state =
      getState(chatId);

    if (
      data ===
      "reg_status_booked"
    ) {
      state.data.status =
        "Забронирован";
    }

    if (
      data ===
      "reg_status_confirmed"
    ) {
      state.data.status =
        "Подтвержден";
    }

    if (
      data ===
      "reg_status_cancelled"
    ) {
      state.data.status =
        "Отменен";
    }

    await deleteMessage(
      chatId,
      messageId
    );

    await finishRegistration(
      chatId
    );

    return;
  }

  // ==================================================
  // VIEW PASSENGERS
  // ==================================================

  if (
    data ===
    "back_to_passengers"
  ) {
    await showPassengers(
      chatId,
      0
    );
    return;
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

    const passengers =
      await getAllPassengers();

    await editMessageText(
      chatId,
      messageId,
      `👤 <b>Пассажиры</b>\n\nВсего: ${passengers.length}`,
      getPassengerListKeyboard(
        passengers,
        page,
        "view_passenger"
      )
    );

    return;
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
      !isNaN(rowNumber)
    ) {
      const passengers =
        await getAllPassengers();

      const passenger =
        passengers.find(
          (p) =>
            p.rowNumber ===
            rowNumber
        );

      if (passenger) {
        await showPassengerCard(
          chatId,
          passenger,
          messageId
        );
      }
    }

    return;
  }

  // ==================================================
  // SEARCH RESULT
  // ==================================================

  if (
    data.startsWith(
      "search_passenger_page_"
    )
  ) {
    const page = Number(
      data.replace(
        "search_passenger_page_",
        ""
      )
    );

    const passengers =
      await getAllPassengers();

    await editMessageText(
      chatId,
      messageId,
      "🔎 Результаты поиска:",
      getPassengerListKeyboard(
        passengers,
        page,
        "search_passenger"
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

    const passengers =
      await getAllPassengers();

    const passenger =
      passengers.find(
        (p) =>
          p.rowNumber ===
          rowNumber
      );

    if (passenger) {
      await showPassengerCard(
        chatId,
        passenger,
        messageId
      );
    }

    return;
  }

  // ==================================================
  // EDIT PASSENGER
  // ==================================================

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

    const passengers =
      await getAllPassengers();

    const passenger =
      passengers.find(
        (p) =>
          p.rowNumber ===
          rowNumber
      );

    if (!passenger) {
      await sendMessage(
        chatId,
        "❌ Пассажир не найден."
      );
      return;
    }

    await startEditPassenger(
      chatId,
      passenger
    );

    return;
  }

  // ==================================================
  // EDIT FIELD
  // ==================================================

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

    const state =
      getState(chatId);

    state.editField =
      field;

    if (
      field ===
        "birthDate" ||
      field ===
        "flightDate"
    ) {
      state.mode =
        "edit_calendar";

      await deleteMessage(
        chatId,
        messageId
      );

      await showCalendar(
        chatId,
        field ===
          "birthDate"
          ? "birth"
          : "flight",
        state.data[field],
        true
      );

      return;
    }

    if (
      field === "route"
    ) {
      state.mode =
        "edit";

      await editMessageText(
        chatId,
        messageId,
        "✈️ Выберите маршрут:",
        {
          inline_keyboard: [
            [
              {
                text:
                  "ДШБ — ХРГ",
                callback_data:
                  "edit_route_DSB_KRG",
              },
            ],
            [
              {
                text:
                  "ХРГ — ДШБ",
                callback_data:
                  "edit_route_KRG_DSB",
              },
            ],
            [
              {
                text:
                  "❌ Отмена",
                callback_data:
                  "edit_cancel",
              },
            ],
          ],
        }
      );

      return;
    }

    if (
      field === "status"
    ) {
      state.mode =
        "edit";

      await editMessageText(
        chatId,
        messageId,
        "Выберите статус:",
        {
          inline_keyboard: [
            [
              {
                text:
                  "Забронирован",
                callback_data:
                  "edit_status_booked",
              },
            ],
            [
              {
                text:
                  "Подтвержден",
                callback_data:
                  "edit_status_confirmed",
              },
            ],
            [
              {
                text:
                  "Отменен",
                callback_data:
                  "edit_status_cancelled",
              },
            ],
            [
              {
                text:
                  "❌ Отмена",
                callback_data:
                  "edit_cancel",
              },
            ],
          ],
        }
      );

      return;
    }

    state.mode =
      "edit_text";

    await deleteMessage(
      chatId,
      messageId
    );

    await sendMessage(
      chatId,
      `Введите новое значение для поля <b>${escapeHtml(
        field
      )}</b>:`
    );

    return;
  }

  // ==================================================
  // EDIT CALENDAR
  // ==================================================

  if (
    data.startsWith(
      "editcal_birth_year_"
    )
  ) {
    const year =
      Number(
        data.replace(
          "editcal_birth_year_",
          ""
        )
      );

    await editMessageText(
      chatId,
      messageId,
      "📅 Выберите месяц:",
      getMonthsKeyboard(
        "birth",
        year,
        true
      )
    );

    return;
  }

  if (
    data.startsWith(
      "editcal_birth_month_"
    )
  ) {
    const parts =
      data.split("_");

    const year =
      Number(parts[3]);

    const month =
      Number(parts[4]);

    await editMessageText(
      chatId,
      messageId,
      `📅 ${monthName(
        month
      )} ${year}\n\nВыберите день:`,
      getDaysKeyboard(
        "birth",
        year,
        month,
        true
      )
    );

    return;
  }

  if (
    data.startsWith(
      "editcal_birth_day_"
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

    state.data.birthDate =
      `${String(day).padStart(
        2,
        "0"
      )}.${String(
        month
      ).padStart(
        2,
        "0"
      )}.${year}`;

    state.mode = "edit";

    await deleteMessage(
      chatId,
      messageId
    );

    await sendMessage(
      chatId,
      "📅 Дата рождения изменена.\n\nСохранение..."
    );

    await saveEditedPassenger(
      chatId
    );

    return;
  }

  if (
    data.startsWith(
      "editcal_flight_year_"
    )
  ) {
    const year =
      Number(
        data.replace(
          "editcal_flight_year_",
          ""
        )
      );

    await editMessageText(
      chatId,
      messageId,
      "📅 Выберите месяц:",
      getMonthsKeyboard(
        "flight",
        year,
        true
      )
    );

    return;
  }

  if (
    data.startsWith(
      "editcal_flight_month_"
    )
  ) {
    const parts =
      data.split("_");

    const year =
      Number(parts[3]);

    const month =
      Number(parts[4]);

    await editMessageText(
      chatId,
      messageId,
      `📅 ${monthName(
        month
      )} ${year}\n\nВыберите день:`,
      getDaysKeyboard(
        "flight",
        year,
        month,
        true
      )
    );

    return;
  }

  if (
    data.startsWith(
      "editcal_flight_day_"
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

    state.data.flightDate =
      `${String(day).padStart(
        2,
        "0"
      )}.${String(
        month
      ).padStart(
        2,
        "0"
      )}.${year}`;

    state.mode = "edit";

    await deleteMessage(
      chatId,
      messageId
    );

    await sendMessage(
      chatId,
      "📅 Дата рейса изменена.\n\nСохранение..."
    );

    await saveEditedPassenger(
      chatId
    );

    return;
  }

  // ==================================================
  // EDIT ROUTE
  // ==================================================

  if (
    data ===
    "edit_route_DSB_KRG"
  ) {
    const state =
      getState(chatId);

    state.data.route =
      "ДШБ — ХРГ";

    state.mode = "edit";

    await deleteMessage(
      chatId,
      messageId
    );

    await saveEditedPassenger(
      chatId
    );

    return;
  }

  if (
    data ===
    "edit_route_KRG_DSB"
  ) {
    const state =
      getState(chatId);

    state.data.route =
      "ХРГ — ДШБ";

    state.mode = "edit";

    await deleteMessage(
      chatId,
      messageId
    );

    await saveEditedPassenger(
      chatId
    );

    return;
  }

  // ==================================================
  // EDIT STATUS
  // ==================================================

  if (
    data.startsWith(
      "edit_status_"
    )
  ) {
    const state =
      getState(chatId);

    if (
      data ===
      "edit_status_booked"
    ) {
      state.data.status =
        "Забронирован";
    }

    if (
      data ===
      "edit_status_confirmed"
    ) {
      state.data.status =
        "Подтвержден";
    }

    if (
      data ===
      "edit_status_cancelled"
    ) {
      state.data.status =
        "Отменен";
    }

    state.mode = "edit";

    await deleteMessage(
      chatId,
      messageId
    );

    await saveEditedPassenger(
      chatId
    );

    return;
  }

  // ==================================================
  // EDIT CANCEL
  // ==================================================

  if (
    data === "edit_cancel"
  ) {
    resetState(chatId);

    await deleteMessage(
      chatId,
      messageId
    );

    await showMainMenu(chatId);

    return;
  }

  // ==================================================
  // FLIGHT PASSENGERS
  // ==================================================

  if (
    data ===
    "flight_passengers_back"
  ) {
    await showFlightPassengers(
      chatId
    );
    return;
  }

  if (
    data.startsWith(
      "flight_show_"
    )
  ) {
    const encoded =
      data.replace(
        "flight_show_",
        ""
      );

    const separator =
      encoded.indexOf("_");

    if (separator === -1) {
      return;
    }

    const date =
      decodeURIComponent(
        encoded.substring(
          0,
          separator
        )
      );

    const route =
      decodeURIComponent(
        encoded.substring(
          separator + 1
        )
      );

    await showFlightPassengersByDateRoute(
      chatId,
      date,
      route
    );

    return;
  }
}

// ======================================================
// UPDATE HANDLER
// ======================================================

async function handleUpdate(
  update
) {
  try {
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
      const message =
        update.message;

      if (
        message.document
      ) {
        await handleExcelDocument(
          message
        );
        return;
      }

      if (
        message.text
      ) {
        await handleTextMessage(
          message
        );
        return;
      }
    }
  } catch (error) {
    console.error(
      "Ошибка обработки update:",
      error
    );

    try {
      const chatId =
        update.message?.chat?.id ||
        update.callback_query?.message
          ?.chat?.id;

      if (chatId) {
        await sendMessage(
          chatId,
          "❌ Произошла ошибка при обработке запроса.",
          mainMenuKeyboard()
        );
      }
    } catch (sendError) {
      console.error(
        "Ошибка отправки сообщения:",
        sendError
      );
    }
  }
}

// ======================================================
// HEALTH CHECK
// ======================================================

app.get("/", (req, res) => {
  res.status(200).send(
    "KMRN Passenger Bot is running."
  );
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    bot: "KMRN Passenger Bot",
    spreadsheetConfigured:
      Boolean(SPREADSHEET_ID),
  });
});

// ======================================================
// TELEGRAM WEBHOOK
// ======================================================

app.post(
  "/telegram/webhook",
  async (req, res) => {
    try {
      if (
        TELEGRAM_WEBHOOK_SECRET
      ) {
        const secret =
          req.headers[
            "x-telegram-bot-api-secret-token"
          ];

        if (
          secret !==
          TELEGRAM_WEBHOOK_SECRET
        ) {
          return res
            .status(403)
            .send("Forbidden");
        }
      }

      res.sendStatus(200);

      await handleUpdate(
        req.body
      );
    } catch (error) {
      console.error(
        "Webhook error:",
        error
      );

      if (!res.headersSent) {
        res.sendStatus(500);
      }
    }
  }
);

// ======================================================
// START SERVER
// ======================================================

app.listen(
  PORT,
  async () => {
    console.log(
      `KMRN Passenger Bot запущен на порту ${PORT}`
    );

    console.log(
      `SPREADSHEET_ID: ${
        SPREADSHEET_ID
          ? "настроен"
          : "НЕ НАСТРОЕН"
      }`
    );

    if (
      PUBLIC_URL &&
      TELEGRAM_BOT_TOKEN
    ) {
      try {
        const webhookUrl =
          `${PUBLIC_URL.replace(
            /\/$/,
            ""
          )}/telegram/webhook`;

        const result =
          await telegramRequest(
            "setWebhook",
            {
              url: webhookUrl,
              ...(TELEGRAM_WEBHOOK_SECRET
                ? {
                    secret_token:
                      TELEGRAM_WEBHOOK_SECRET,
                  }
                : {}),
              allowed_updates: [
                "message",
                "callback_query",
              ],
            }
          );

        console.log(
          "✅ Telegram webhook установлен:",
          webhookUrl
        );

        console.log(
          "Telegram webhook result:",
          result
        );
      } catch (error) {
        console.error(
          "❌ Не удалось установить Telegram webhook:",
          error.message
        );
      }
    } else {
      console.log(
        "⚠️ PUBLIC_URL или TELEGRAM_BOT_TOKEN не настроен — webhook автоматически не устанавливается."
      );
    }
  }
);
