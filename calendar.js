const { MONTHS, WEEKDAYS } = require('./config');
const { editMessage } = require('./telegram');

function getBaseCalendarType(type) {
    if (type === "birth_edit") {
        return "birth";
    }

    if (type === "flight_edit") {
        return "flight";
    }

    if (type === "flight_filter_date") {
        return "flight_filter_date";
    }

    return type;
}

function getCalendarTitle( type,
    level) {
    const base = getBaseCalendarType(type);

    if (base === "birth") {
        if (level === "year") {
            return "🎂 Выберите год рождения:";
        }

        if (level === "month") {
            return "🎂 Выберите месяц рождения:";
        }

        return "🎂 Выберите день рождения:";
    }

    if ( base === "flight" || base === "flight_filter_date") {
        return "📅 Выберите дату рейса:";
    }

    if (type === "view_date") {
        return "📅 Выберите дату рейса:";
    }

    return "📅 Выберите дату:";
}

function getBirthYears(page) {
    const currentYear = new Date().getFullYear();

    const start = currentYear -
        page * 12;

    const result = [];

    for ( let i = 0;
        i < 12;
        i++) {
        const year = start - i;

        if (year < 1940) {
            break;
        }

        result.push(year);
    }

    return result;
}

function getDushanbeToday() {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Dushanbe",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(new Date());
    const value = type => Number(parts.find(part => part.type === type).value);
    return { year: value("year"), month: value("month") - 1, day: value("day") };
}

function isPastFlightDate(year, month, day) {
    const today = getDushanbeToday();
    return year < today.year || (year === today.year && month < today.month) || (year === today.year && month === today.month && day < today.day);
}

function getFlightYears(page) {
    const currentYear = getDushanbeToday().year;

    const start = currentYear + page * 12;

    const result = [];

    for ( let i = 0;
        i < 12;
        i++) {
        const year = start + i;

        if ( year >
            currentYear + 5) {
            break;
        }

        result.push(year);
    }

    return result;
}

function getYearsKeyboard( type,
    page) {
    const base = getBaseCalendarType(type);

    const years = base === "birth"
            ? getBirthYears(page)
            : getFlightYears(page);

    const keyboard = [];

    for ( let i = 0;
        i < years.length;
        i += 3) {
        const row = [];

        for ( let j = i;
            j <
            Math.min( i + 3,
                years.length);
            j++) {
            row.push({
                text: String(years[j]),
                callback_data: `calendar_year_${years[j]}`
            });
        }

        keyboard.push(row);
    }

    const navigation = [];

    if (page > 0) {
        navigation.push({
            text: "⬅️ Назад",
            callback_data: `calendar_year_page_${page - 1}`
        });
    }

    const nextYears = base === "birth"
            ? getBirthYears(page + 1)
            : getFlightYears(page + 1);

    if (nextYears.length > 0) {
        navigation.push({
            text: "➡️ Далее",
            callback_data: `calendar_year_page_${page + 1}`
        });
    }

    if (navigation.length) {
        keyboard.push(navigation);
    }

    return {
        inline_keyboard: keyboard
    };
}

function getMonthsKeyboard(type, year) {
    const keyboard = [];
    const flightDateSelection = getBaseCalendarType(type) === "flight";

    for ( let i = 0;
        i < 12;
        i += 3) {
        const row = [];

        for ( let j = i;
            j < i + 3;
            j++) {
            row.push({
                text: MONTHS[j],
                callback_data: flightDateSelection && (year < getDushanbeToday().year || (year === getDushanbeToday().year && j < getDushanbeToday().month))
                    ? "calendar_ignore"
                    : `calendar_month_${j}`
            });
        }

        keyboard.push(row);
    }

    keyboard.push([ {
            text: "⬅️ Назад",
            callback_data: "calendar_back_years"
        }]);

    return {
        inline_keyboard: keyboard
    };
}

function getDaysKeyboard( year,
    month,
    type) {
    const firstDay = new Date( year,
            month,
            1);

    let weekday = firstDay.getDay();

    weekday = weekday === 0
            ? 6
            : weekday - 1;

    const daysInMonth = new Date( year,
            month + 1,
            0).getDate();

    const keyboard = [];

    keyboard.push( WEEKDAYS.map( day => ({
                text: day,
                callback_data: "calendar_ignore"
            })));

    let row = [];

    for ( let i = 0;
        i < weekday;
        i++) {
        row.push({
            text: " ",
            callback_data: "calendar_ignore"
        });
    }

    for ( let day = 1;
        day <= daysInMonth;
        day++) {
        if (row.length === 7) {
            keyboard.push(row);
            row = [];
        }

        row.push({
            text: String(day),
            callback_data: getBaseCalendarType(type) === "flight" && isPastFlightDate(year, month, day)
                ? "calendar_ignore"
                : `calendar_day_${day}`
        });
    }

    if (row.length) {
        while (row.length < 7) {
            row.push({
                text: " ",
                callback_data: "calendar_ignore"
            });
        }

        keyboard.push(row);
    }

    keyboard.push([ {
            text: "⬅️ Назад",
            callback_data: "calendar_back_months"
        }]);

    return {
        inline_keyboard: keyboard
    };
}

async function showCalendar( chatId,
    state,
    level) {
    if (level === "year") {
        await editMessage( chatId,
            state.messageId,
            getCalendarTitle( state.calendarType,
                "year"),
            getYearsKeyboard( state.calendarType,
                state.calendarPage));

        return;
    }

    if (level === "month") {
        await editMessage( chatId,
            state.messageId,
            getCalendarTitle( state.calendarType,
                "month"),
            getMonthsKeyboard(state.calendarType, state.calendarYear));

        return;
    }

    if (level === "day") {
        await editMessage( chatId,
            state.messageId,
            getCalendarTitle( state.calendarType,
                "day"),
            getDaysKeyboard( state.calendarYear,
                state.calendarMonth,
                state.calendarType));
    }
}

module.exports = { getBaseCalendarType, getCalendarTitle, getBirthYears, getDushanbeToday, isPastFlightDate, getFlightYears, getYearsKeyboard, getMonthsKeyboard, getDaysKeyboard, showCalendar };
