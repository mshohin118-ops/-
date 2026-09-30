require("dotenv").config();


const PORT = process.env.PORT || 10000;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;

const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY
        ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n")
        : "";

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

const PUBLIC_URL = process.env.PUBLIC_URL;

const allowedTelegramUserIds = new Set( String(process.env.ALLOWED_TELEGRAM_USER_IDS || "").split(/[\s,;]+/)
        .filter(value => /^[1-9]\d*$/.test(value)));

const CAPACITY = 19;

const PAGE_SIZE = 8;

const MONTHS = [ "Январь",
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
    "Декабрь"];

const WEEKDAYS = [ "Пн",
    "Вт",
    "Ср",
    "Чт",
    "Пт",
    "Сб",
    "Вс"];

const ROUTES = [ "ДШБ — ХРГ",
    "ХРГ — ДШБ"];

const STATUSES = [ "Забронирован",
    "Подтвержден",
    "Отменен"];

const REQUIRED_EXCEL_HEADERS = [ "Фамилия",
    "Имя",
    "Отчество",
    "Дата рождения",
    "Паспорт",
    "Гражданство",
    "Контакт 1",
    "Контакт 2",
    "Дата рейса",
    "Маршрут",
    "Рейс",
    "Статус"];

module.exports = { PORT, TELEGRAM_BOT_TOKEN, GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY, SPREADSHEET_ID, TELEGRAM_WEBHOOK_SECRET, PUBLIC_URL, allowedTelegramUserIds, CAPACITY, PAGE_SIZE, MONTHS, WEEKDAYS, ROUTES, STATUSES, REQUIRED_EXCEL_HEADERS };
