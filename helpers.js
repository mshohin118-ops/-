

const states = new Map();

function normalizeText(value) {
    return String(value || "").trim();
}

function normalizePassport(value) {
    return String(value || "").trim().replace(/\s+/g, "").toUpperCase();
}

function normalizeFlight(value) {
    return String(value || "").trim().replace(/\s+/g, "").toUpperCase();
}

function createState() {
    return {
        step: 0,
        data: {},

        calendarType: null,
        calendarPage: 0,
        calendarYear: null,
        calendarMonth: null,

        editingField: null,
        pendingStatusComment: null,
        pendingEditRoute: null,
        rowNumber: null,
        messageId: null,

        viewMode: null,
        viewPage: 0,
        viewPassengers: [],
        viewDate: null,
        viewRoute: null,
        viewFlight: null
    };
}

function getState(chatId) {
    if (!states.has(chatId)) {
        states.set( chatId,
            createState());
    }

    return states.get(chatId);
}

function generatePassengerId( existingIds = new Set()) {
    let id;

    do {
        id = "P" + Date.now().toString().slice(-8) + Math.floor( Math.random() * 1000).toString().padStart(3, "0");
    } while ( existingIds.has(id));

    return id;
}

function validateTajikPhone(phone) {
    phone = String(phone || "").trim().replace(/\s+/g, "");

    if (/^\d{9}$/.test(phone)) {
        phone = "+992" + phone;
    }

    if (!/^\+992\d{9}$/.test(phone)) {
        return null;
    }

    return phone;
}

function isValidDateString(date) {
    if ( !/^\d{2}\.\d{2}\.\d{4}$/.test(date)) {
        return false;
    }

    const parts = date.split(".").map(Number);

    const day = parts[0];
    const month = parts[1];
    const year = parts[2];

    const d = new Date( year,
            month - 1,
            day);

    return ( d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day);
}

function rowToPassenger( row,
    rowNumber) {
    return {
        rowNumber,

        passengerId: row[0] || "",
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
        flight: row[11] || "",
        status: row[12] || "",
        replacesPassengerId: row[13] || "",
        replacedByPassengerId: row[14] || "",
        comment: row[15] || ""
    };
}

module.exports = { states, normalizeText, normalizePassport, normalizeFlight, createState, getState, generatePassengerId, validateTajikPhone, isValidDateString, rowToPassenger };
