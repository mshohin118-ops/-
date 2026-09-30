const XLSX = require("xlsx");
const { sendMessage, telegramRequest } = require('./telegram');
const { TELEGRAM_BOT_TOKEN, REQUIRED_EXCEL_HEADERS, CAPACITY } = require('./config');
const { getPassengerObjects } = require('./menus');
const { normalizePassport, normalizeFlight, normalizeText, isValidDateString, generatePassengerId } = require('./helpers');
const { isInactiveStatus, savePassenger, auditSafely, getSheetTitle } = require('./sheets');

function normalizeExcelHeader(value) {
    const normalized = String(value || "").replace(/\uFEFF/g, "").replace(/[\u00A0\u2007\u202F]/g, " ").trim()
        .replace(/\s+/g, " ").toLowerCase().replace(/[.:]+$/, "");

    // В разных шаблонах номер рейса называется по-разному.
    if (["рейс", "номер рейса", "№ рейса", "рейс №", "flight", "flight number", "flight no", "flight no."].includes(normalized)) {
        return "рейс";
    }
    return normalized;
}

function normalizeExcelPhone(value) {
    let phone = String(value || "").trim().replace(/\s+/g, "").replace(/-/g, "").replace(/\(/g, "").replace(/\)/g, "");

    if (!phone) {
        return "";
    }

    if (/^\d{9}$/.test(phone)) {
        return "+992" + phone;
    }

    if (/^992\d{9}$/.test(phone)) {
        return "+" + phone;
    }

    return phone;
}

function excelDateToString(value) {
    if ( value === null || value === undefined) {
        return "";
    }

    if (value instanceof Date) {
        const day = String( value.getDate()).padStart(2, "0");

        const month = String( value.getMonth() + 1).padStart(2, "0");

        const year = value.getFullYear();

        return `${day}.${month}.${year}`;
    }

    const text = String(value).trim();

    if (!text) {
        return "";
    }

    if ( /^\d{2}\.\d{2}\.\d{4}$/.test( text)) {
        return text;
    }

    if ( /^\d{2}\/\d{2}\/\d{4}$/.test( text)) {
        return text.replace( /\//g,
            ".");
    }

    if ( /^\d{4}-\d{2}-\d{2}$/.test( text)) {
        const parts = text.split("-");

        return ( `${parts[2]}.${parts[1]}.${parts[0]}`);
    }

    if ( /^\d+(\.\d+)?$/.test(text)) {
        const serial = Number(text);

        if ( serial > 1 && serial < 100000) {
            const date = new Date( Date.UTC( 1899,
                        11,
                        30) + serial *
                    86400000);

            const day = String( date.getUTCDate()).padStart(2, "0");

            const month = String( date.getUTCMonth() + 1).padStart(2, "0");

            const year = date.getUTCFullYear();

            return `${day}.${month}.${year}`;
        }
    }

    return "";
}

function normalizeExcelRoute(value) {
    const text = String(value || "").trim().toUpperCase().replace(/–/g, "-").replace(/—/g, "-").replace(/\s+/g, "");

    if ( text === "ДШБ-ХРГ") {
        return "ДШБ — ХРГ";
    }

    if ( text === "ХРГ-ДШБ") {
        return "ХРГ — ДШБ";
    }

    return "";
}

function normalizeExcelFlight(value) {
    return String(value || "").trim().replace(/\s+/g, "").toUpperCase();
}

function normalizeExcelStatus(value) {
    const text = String(value || "").trim().toLowerCase();

    if ( text === "забронирован" || text === "забронировано" || text === "booked") {
        return "Забронирован";
    }

    if ( text === "подтвержден" || text === "подтверждён" || text === "confirmed") {
        return "Подтвержден";
    }

    if ( text === "отменен" || text === "отменён" || text === "cancelled" || text === "canceled") {
        return "Отменен";
    }

    return "";
}

async function handleExcelDocument( message) {
    const chatId = message.chat.id;

    const document = message.document;

    if (!document) {
        return;
    }

    const fileName = document.file_name || "";

    if ( !fileName.toLowerCase().endsWith(".xlsx")) {
        await sendMessage( chatId,
            "❌ Поддерживается только Excel-файл формата .xlsx.");

        return;
    }

    try {
        await sendMessage( chatId,
            "⏳ Excel получен.\n\nПроверяю данные...");

        // DOWNLOAD FILE FROM TELEGRAM

        const fileResult = await telegramRequest( "getFile",
                {
                    file_id: document.file_id
                });

        if ( !fileResult.ok || !fileResult.result.file_path) {
            throw new Error( "Telegram не вернул путь к Excel-файлу.");
        }

        const filePath = fileResult.result.file_path;

        const fileResponse = await fetch( `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`
            );

        if (!fileResponse.ok) {
            throw new Error( "Не удалось скачать Excel-файл.");
        }

        const arrayBuffer = await fileResponse.arrayBuffer();

        const buffer = Buffer.from(arrayBuffer);

        // READ EXCEL

        const workbook = XLSX.read( buffer,
                {
                    type: "buffer",
                    cellDates: true
                });

        if ( !workbook.SheetNames || !workbook.SheetNames.length) {
            throw new Error( "В Excel нет листов.");
        }

        const firstSheet = workbook.Sheets[ workbook.SheetNames[0]];

        const rows = XLSX.utils.sheet_to_json( firstSheet,
                {
                    header: 1,
                    defval: ""
                });

        if (!rows.length) {
            throw new Error( "Excel-файл пустой.");
        }

        // HEADERS

        const headers = rows[0].map( header =>
                    String( header || "").trim());

        const normalizedHeaders = headers.map( normalizeExcelHeader);

        const missingHeaders = [];

        for ( const required
            of REQUIRED_EXCEL_HEADERS) {
            if ( !normalizedHeaders.includes( normalizeExcelHeader( required))) {
                missingHeaders.push( required);
            }
        }

        if ( missingHeaders.length) {
            await sendMessage( chatId,
                "❌ Неверный формат Excel.\n\n" + "Отсутствуют колонки:\n\n" + missingHeaders.map( item =>
                            `• ${item}`).join("\n") + "\n\n" + "Правильный формат:\n" +
                REQUIRED_EXCEL_HEADERS.join( " | ") + "\n\nНайдены заголовки в вашем файле:\n" + headers.map((item, index) => `${index + 1}. ${item || "(пусто)"}`).join(" | ")
            );

            return;
        }

        // COLUMN INDEXES

        const columnIndexes = {};

        for ( const header
            of REQUIRED_EXCEL_HEADERS) {
            columnIndexes[header] = normalizedHeaders.indexOf( normalizeExcelHeader( header));
        }

        // CURRENT PASSENGERS

        const existingPassengers = await getPassengerObjects();

        const existingPassports = new Set();

        const existingIds = new Set();

        const occupancyMap = new Map();

        for ( const passenger
            of existingPassengers) {
            const passport = normalizePassport( passenger.passport);

            if (passport) {
                existingPassports.add( passport);
            }

            if ( passenger.passengerId) {
                existingIds.add( passenger.passengerId);
            }

            if ( !isInactiveStatus(passenger.status)) {
                const key = `${passenger.flightDate}|${passenger.route}|${normalizeFlight(passenger.flight)}`;

                occupancyMap.set( key,
                    ( occupancyMap.get( key) || 0) + 1);
            }
        }

        // RESULT COUNTERS

        let added = 0;
        let duplicates = 0;
        let capacityFull = 0;
        let errors = 0;

        const errorRows = [];
        const rowsToInsert = [];

        // PROCESS EXCEL

        for ( let i = 1;
            i < rows.length;
            i++) {
            const excelRow = rows[i];

            const excelRowNumber = i + 1;

            const getValue = header => {
                    const index = columnIndexes[ header];

                    return ( excelRow[index] ??
                        "");
                };

            const empty = excelRow.every( value =>
                        String( value || "").trim() === "");

            if (empty) {
                continue;
            }

            const surname = normalizeText( getValue("Фамилия"));

            const name = normalizeText( getValue("Имя"));

            const patronymic = normalizeText( getValue("Отчество"));

            const birthDate = excelDateToString( getValue( "Дата рождения"));

            const passport = normalizeText( getValue("Паспорт"));

            const passportKey = normalizePassport( passport);

            const citizenship = normalizeText( getValue( "Гражданство"));

            const contact1 = normalizeExcelPhone( getValue("Контакт 1"));

            const contact2 = normalizeExcelPhone( getValue("Контакт 2"));

            const flightDate = excelDateToString( getValue( "Дата рейса"));

            const route = normalizeExcelRoute( getValue("Маршрут"));

            const flight = normalizeExcelFlight( getValue("Рейс"));

            const status = normalizeExcelStatus( getValue("Статус"));

            const rowErrors = [];

            if (!surname) {
                rowErrors.push( "не указана фамилия");
            }

            if (!name) {
                rowErrors.push( "не указано имя");
            }

            if (!birthDate) {
                rowErrors.push( "не указана дата рождения");
            } else if ( !isValidDateString( birthDate)) {
                rowErrors.push( "неверная дата рождения");
            }

            if (!passport) {
                rowErrors.push( "не указан паспорт");
            }

            if (!citizenship) {
                rowErrors.push( "не указано гражданство");
            }

            if (!flightDate) {
                rowErrors.push( "не указана дата рейса");
            } else if ( !isValidDateString( flightDate)) {
                rowErrors.push( "неверная дата рейса");
            }

            if (!route) {
                rowErrors.push( "неверный маршрут");
            }

            if (!flight) {
                rowErrors.push( "не указан номер рейса");
            }

            if (!status) {
                rowErrors.push( "неверный статус");
            }

            if (rowErrors.length) {
                errors++;

                errorRows.push( `Строка ${excelRowNumber}: ${rowErrors.join(", ")}`);

                continue;
            }

            // DUPLICATE PASSPORT

            if ( existingPassports.has( passportKey)) {
                duplicates++;

                errorRows.push( `Строка ${excelRowNumber}: паспорт ${passport} уже существует`);

                continue;
            }

            // CAPACITY

            const occupancyKey = `${flightDate}|${route}|${normalizeFlight(flight)}`;

            const currentOccupancy = occupancyMap.get( occupancyKey) || 0;

            if ( status !== "Отменен" && currentOccupancy >=
                    CAPACITY) {
                capacityFull++;

                errorRows.push( `Строка ${excelRowNumber}: рейс ${flight} на ${flightDate} ${route} заполнен (${CAPACITY}/${CAPACITY})`
                );

                continue;
            }

            // GENERATE ID

            const passengerId = generatePassengerId( existingIds);

            existingIds.add( passengerId);

            // ADD TO BUFFER

            rowsToInsert.push({
                excelRowNumber, passengerId, surname, name, patronymic,
                birthDate, passport, citizenship, contact1, contact2,
                flightDate, route, flight, status
            });

            existingPassports.add(passportKey);

            if ( status !== "Отменен") {
                occupancyMap.set( occupancyKey,
                    currentOccupancy + 1);
            }
        }

        // INSERT ALL VALID ROWS

        for (const passenger of rowsToInsert) {
            try {
                await savePassenger(passenger);
                added++;
            } catch (saveError) {
                errors++;
                errorRows.push( `Строка ${passenger.excelRowNumber}: не удалось записать — ${saveError.message}`
                );
                console.error("❌ Ошибка записи пассажира из Excel:", saveError);
            }
        }

        await auditSafely({
            action: "Импорт Excel",
            note: `Добавлено: ${added}; дубликаты: ${duplicates}; заполнено: ${capacityFull}; ошибки: ${errors}`
        });

        // REPORT

        const destinationSheet = await getSheetTitle();
        let resultText = (added ? "✅ Excel обработан\n\n" : "⚠️ Excel обработан, пассажиры не добавлены\n\n") +
            `Лист таблицы: ${destinationSheet}\n` + `➕ Добавлено: ${added}\n` + `🔁 Дубликаты паспортов: ${duplicates}\n` +
            `💺 Заполненные рейсы: ${capacityFull}\n` + `⚠️ Ошибки строк: ${errors}`;

        if ( errorRows.length) {
            resultText +=
                "\n\n📋 Подробности:\n\n";

            const details = errorRows.join("\n");

            resultText +=
                details.slice( 0,
                    3000);

            if ( details.length > 3000) {
                resultText +=
                    "\n\n... список ошибок сокращён.";
            }
        }

        await sendMessage( chatId,
            resultText,
            {
                inline_keyboard: [ [ {
                            text: "🏠 Главное меню",
                            callback_data: "main_menu_back"
                        }]]
            });

    } catch (error) {
        console.error( "❌ ОШИБКА EXCEL:",
            error);

        await sendMessage( chatId,
            "❌ Не удалось обработать Excel.\n\n" + error.message,
            {
                inline_keyboard: [ [ {
                            text: "🏠 Главное меню",
                            callback_data: "main_menu_back"
                        }]]
            });
    }
}

module.exports = { normalizeExcelHeader, normalizeExcelPhone, excelDateToString, normalizeExcelRoute, normalizeExcelFlight, normalizeExcelStatus, handleExcelDocument };
