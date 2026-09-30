const { google } = require("googleapis");
const { AsyncLocalStorage } = require("async_hooks");
const { GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY, SPREADSHEET_ID } = require('./config');
const { normalizeFlight } = require('./helpers');

const auditContext = new AsyncLocalStorage();

const AUDIT_SHEET_TITLE = "Журнал_бота";

const AUDIT_HEADERS = [ "Время (Душанбе)", "Telegram ID", "Действие", "ID пассажира",
    "Строка", "Дата рейса", "Маршрут", "Рейс",
    "Статус до", "Статус после", "Изменённые поля", "Примечание"];

let auditSheetReadyPromise = null;

let cachedSheetTitle = null;

function getGoogleAuth() {
    if ( !GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY || !SPREADSHEET_ID) {
        throw new Error(
            "Не настроены Google переменные окружения. Проверь GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY и GOOGLE_SHEET_ID."
        );
    }

    return new google.auth.JWT( GOOGLE_CLIENT_EMAIL,
        null,
        GOOGLE_PRIVATE_KEY,
        [ "https://www.googleapis.com/auth/spreadsheets"]);
}

let sharedSheetsClient = null;

async function getSheets() {
    // Один клиент сохраняет токен Google между запросами вместо новой авторизации.
    if (!sharedSheetsClient) {
        sharedSheetsClient = google.sheets({ version: "v4", auth: getGoogleAuth() });
    }
    return sharedSheetsClient;
}

async function getSheetTitle() {
    if (cachedSheetTitle) {
        return cachedSheetTitle;
    }

    const sheets = await getSheets();

    const spreadsheet = await sheets.spreadsheets.get({
            spreadsheetId: SPREADSHEET_ID
        });

    if ( !spreadsheet.data.sheets || !spreadsheet.data.sheets.length) {
        throw new Error( "В Google таблице нет листов.");
    }

    const passengerSheet = spreadsheet.data.sheets.find( sheet => sheet.properties.title !== AUDIT_SHEET_TITLE
    );
    if (!passengerSheet) {
        throw new Error("Лист с пассажирами не найден.");
    }
    cachedSheetTitle = passengerSheet.properties.title;

    console.log( "📄 Используется лист:",
        cachedSheetTitle);

    return cachedSheetTitle;
}

function invalidatePassengerSnapshot() {
    const context = auditContext.getStore();
    if (context) context.passengerRowsPromise = null;
}

async function getAllPassengers(forceFresh = false) {
    const context = auditContext.getStore();
    if (forceFresh) invalidatePassengerSnapshot();
    const readRows = async () => {
        const sheets = await getSheets();
        const sheetTitle = await getSheetTitle();
        const result = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheetTitle}!A:P`
        });
        return result.data.values || [];
    };
    // Снимок живёт только в рамках одного Telegram update, между нажатиями не хранится.
    if (context && !context.passengerRowsPromise) {
        context.passengerRowsPromise = readRows().catch(error => {
            context.passengerRowsPromise = null;
            throw error;
        });
    }
    const rows = await (context ? context.passengerRowsPromise : readRows());
    return rows.map(row => [...row]);
}

async function ensureAuditSheet() {
    if (!auditSheetReadyPromise) {
        auditSheetReadyPromise = (async () => {
            const sheets = await getSheets();
            const metadata = await sheets.spreadsheets.get({
                spreadsheetId: SPREADSHEET_ID,
                fields: "sheets.properties.title"
            });
            const exists = (metadata.data.sheets || []).some( sheet => sheet.properties.title === AUDIT_SHEET_TITLE
            );
            if (!exists) {
                try {
                    await sheets.spreadsheets.batchUpdate({
                        spreadsheetId: SPREADSHEET_ID,
                        requestBody: { requests: [{ addSheet: {
                            properties: { title: AUDIT_SHEET_TITLE }
                        } }] }
                    });
                } catch (error) {
                    // Another request may have created the sheet concurrently.
                    const check = await sheets.spreadsheets.get({
                        spreadsheetId: SPREADSHEET_ID,
                        fields: "sheets.properties.title"
                    });
                    if (!(check.data.sheets || []).some( sheet => sheet.properties.title === AUDIT_SHEET_TITLE
                    )) throw error;
                }
            }
            const header = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${AUDIT_SHEET_TITLE}!A1:L1`
            });
            const current = header.data.values?.[0] || [];
            if (current.length && current.join("|") !== AUDIT_HEADERS.join("|")) {
                throw new Error("Лист журнала уже существует с другими заголовками");
            }
            if (!current.length) {
                await sheets.spreadsheets.values.update({
                    spreadsheetId: SPREADSHEET_ID,
                    range: `${AUDIT_SHEET_TITLE}!A1:L1`,
                    valueInputOption: "RAW",
                    requestBody: { values: [AUDIT_HEADERS] }
                });
            }
        })().catch(error => {
            auditSheetReadyPromise = null;
            throw error;
        });
    }
    return auditSheetReadyPromise;
}

function dushanbeTimestamp() {
    return new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Dushanbe", year: "numeric", month: "2-digit",
        day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
        hourCycle: "h23"
    }).format(new Date());
}

async function appendAudit(event) {
    const actorId = auditContext.getStore()?.userId;
    if (!actorId) throw new Error("Отсутствует Telegram ID для журнала");
    await ensureAuditSheet();
    const sheets = await getSheets();
    const row = [ dushanbeTimestamp(), actorId, event.action || "", event.passengerId || "",
        event.rowNumber || "", event.flightDate || "", event.route || "",
        event.flight || "", event.oldStatus || "", event.newStatus || "",
        event.changedFields || "", event.note || ""];
    await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${AUDIT_SHEET_TITLE}!A:L`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [row] }
    });
}

async function auditSafely(event) {
    try {
        await appendAudit(event);
    } catch (error) {
        // Passenger write has already succeeded. Do not tell the operator it failed.
        console.error("❌ Не удалось записать действие в журнал:", error);
    }
}

const AUDITED_FIELDS = [ [1, "Фамилия"], [2, "Имя"], [3, "Отчество"],
    [4, "Дата рождения"], [5, "Паспорт"], [6, "Гражданство"],
    [7, "Контакт 1"], [8, "Контакт 2"], [9, "Дата рейса"],
    [10, "Маршрут"], [11, "Рейс"], [12, "Статус"],
    [13, "Вместо пассажира ID"], [14, "Заменён пассажиром ID"],
    [15, "Комментарий"]];

function isInactiveStatus(status) {
    return status === "Отменен" || status === "Не явился" || status === "Возврат";
}

async function calculateRouteOccupancy( flightDate,
    route,
    flight,
    excludeRowNumber = null) {
    const rows = await getAllPassengers();

    let count = 0;

    /*
     * Вместимость считается отдельно для:
     * Дата + Маршрут + Рейс
     */
    for ( let i = 1;
        i < rows.length;
        i++) {
        const rowNumber = i + 1;

        if ( excludeRowNumber && Number(excludeRowNumber) === rowNumber) {
            continue;
        }

        const row = rows[i];

        if ( (row[9] || "") === flightDate && (row[10] || "") === route && normalizeFlight(row[11]) ===
                normalizeFlight(flight) && !isInactiveStatus(row[12])) {
            count++;
        }
    }

    return count;
}

let passengerSaveQueue = Promise.resolve();

async function savePassenger(data) {
    const operation = passengerSaveQueue.then(() => savePassengerInSheet(data));
    passengerSaveQueue = operation.catch(() => {});
    return operation;
}

async function savePassengerInSheet(data) {
    const values = [ data.passengerId || "",
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
        data.flight || "",
        data.status || "",
        data.replacesPassengerId || "",
        data.replacedByPassengerId || "",
        data.comment || ""];

    const sheets = await getSheets();
    const sheetTitle = await getSheetTitle();
    const existingRows = await getAllPassengers(true);
    // Повтор той же операции возвращает уже сохранённую запись.
    if (data.passengerId) {
        const existingIndex = existingRows.findIndex((row, index) =>
            index > 0 && String(row[0] || "") === String(data.passengerId));
        if (existingIndex > 0) {
            data.rowNumber = existingIndex + 1;
            return true;
        }
    }
    const isBlank = row => !row || row.every(cell =>
        cell === null || cell === undefined || String(cell).trim() === "");

    // Строка 1 зарезервирована для заголовков: весь остальной код читает с 2-й.
    if (isBlank(existingRows[0])) {
        const headerRange = `${sheetTitle}!A1:P1`;
        const currentHeader = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID, range: headerRange
        });
        if (!isBlank(currentHeader.data.values?.[0])) {
            throw new Error("Первая строка таблицы изменилась. Повторите добавление.");
        }
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: headerRange,
            valueInputOption: "RAW",
            requestBody: { values: [[ "ID", "Фамилия", "Имя", "Отчество", "Дата рождения",
                "Паспорт", "Гражданство", "Контакт 1", "Контакт 2",
                "Дата рейса", "Маршрут", "Рейс", "Статус",
                "Заменяет ID", "Заменён ID", "Комментарий"]] }
        });
        existingRows[0] = ["ID"];
    }

    // Sheets values.get обрезает пустые строки в конце ответа. Проверяем
    // также первую строку сразу после последней возвращённой строки.
    let emptyIndex = -1;
    for (let index = 1; index <= existingRows.length; index++) {
        if (isBlank(existingRows[index])) {
            emptyIndex = index;
            break;
        }
    }

    const rowNumber = emptyIndex + 1;
    const range = `${sheetTitle}!A${rowNumber}:P${rowNumber}`;
    const metadata = await sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID,
        fields: "sheets(properties(sheetId,title,gridProperties(rowCount)))"
    });
    const passengerSheet = (metadata.data.sheets || []).find( sheet => sheet.properties.title === sheetTitle
    );
    if (!passengerSheet) {
        throw new Error("Лист пассажиров не найден");
    }
    const rowCount = passengerSheet.properties.gridProperties?.rowCount || 0;
    if (rowNumber > rowCount) {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            requestBody: { requests: [{ appendDimension: {
                sheetId: passengerSheet.properties.sheetId,
                dimension: "ROWS", length: rowNumber - rowCount
            } }] }
        });
    }

    // Проверяем все 16 колонок, затем записываем именно в выбранную строку.
    const current = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID, range
    });
    if (!isBlank(current.data.values?.[0])) {
        throw new Error("Свободная строка уже занята. Повторите добавление пассажира.");
    }
    await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range,
        valueInputOption: "RAW",
        requestBody: { values: [values] }
    });
    data.rowNumber = rowNumber;
    invalidatePassengerSnapshot();

    // Номер строки берём по уникальному ID, а не из предположения о пустых строках.
    const rows = await getAllPassengers();
    const index = rows.findIndex((row, i) =>
        i > 0 && String(row[0] || "") === String(data.passengerId));
    if (index < 1) {
        throw new Error(`Пассажир ID ${data.passengerId} сохранён, но его строка не найдена`);
    }
    data.rowNumber = index + 1;

    await auditSafely({
        action: data.replacesPassengerId ? "Добавлена замена" : "Добавлен пассажир",
        passengerId: data.passengerId,
        rowNumber: data.rowNumber,
        flightDate: data.flightDate,
        route: data.route,
        flight: data.flight,
        newStatus: data.status,
        note: data.replacesPassengerId ? `Вместо ID ${data.replacesPassengerId}` : ""
    });

    return true;
}

async function updatePassenger( rowNumber,
    data) {
    const sheets = await getSheets();

    const sheetTitle = await getSheetTitle();

    const values = [ data.passengerId || "",
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
        data.flight || "",
        data.status || "",
        data.replacesPassengerId || "",
        data.replacedByPassengerId || "",
        data.comment || ""];

    const previous = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetTitle}!A${rowNumber}:P${rowNumber}`
    });
    const old = previous.data.values?.[0] || [];
    if (!data.passengerId || String(old[0] || "") !== String(data.passengerId)) {
        throw new Error("Строка пассажира изменилась. Найдите пассажира заново по ID.");
    }

    const result = await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,

        range: `${sheetTitle}!A${rowNumber}:P${rowNumber}`,

        valueInputOption: "USER_ENTERED",

        requestBody: {
            values: [values]
        }
    });

    invalidatePassengerSnapshot();
    const changes = AUDITED_FIELDS.filter(([index]) => String(old[index] || "") !== String(values[index] || ""))
        .map(([, label]) => label);
    if (changes.length) {
        await auditSafely({
            action: old[12] !== values[12] && values[12] === "Не явился"
                ? "Не явился"
                : old[12] !== values[12] && values[12] === "Возврат"
                    ? "Возврат"
                : changes.length === 1 && changes[0] === "Статус"
                    ? "Изменён статус" : "Изменён пассажир",
            passengerId: data.passengerId,
            rowNumber, flightDate: data.flightDate,
            route: data.route, flight: data.flight,
            oldStatus: old[12] || "", newStatus: data.status,
            changedFields: changes.join(", "),
            note: data.replacedByPassengerId && old[14] !== values[14]
                ? `Заменён ID ${data.replacedByPassengerId}` : ""
        });
    }
    return result;
}

module.exports = { auditContext, AUDIT_SHEET_TITLE, AUDIT_HEADERS, getGoogleAuth, getSheets, getSheetTitle, invalidatePassengerSnapshot, getAllPassengers, ensureAuditSheet, dushanbeTimestamp, appendAudit, auditSafely, AUDITED_FIELDS, isInactiveStatus, calculateRouteOccupancy, savePassenger, savePassengerInSheet, updatePassenger };
