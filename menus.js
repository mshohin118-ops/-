const { editMessage, sendMessage } = require('./telegram');
const { createState, states, generatePassengerId, rowToPassenger } = require('./helpers');
const { showCalendar } = require('./calendar');
const { calculateRouteOccupancy, isInactiveStatus, getAllPassengers, savePassenger, updatePassenger } = require('./sheets');
const { CAPACITY, PAGE_SIZE } = require('./config');

function getMainMenuKeyboard() {
    return {
        inline_keyboard: [ [ {
                    text: "➕ Добавить пассажира",
                    callback_data: "main_add_passenger"
                }],
            [ {
                    text: "📥 Загрузить Excel",
                    callback_data: "main_upload_excel"
                }],
            [ {
                    text: "👤 Посмотреть данные",
                    callback_data: "main_view_data"
                }],
            [ {
                    text: "🔎 Найти пассажира",
                    callback_data: "main_find_passenger"
                }],
            [ {
                    text: "✈️ Пассажиры рейса",
                    callback_data: "main_flight_passengers"
                }],
            [ {
                    text: "📊 Статистика",
                    callback_data: "main_statistics"
                }]]
    };
}

async function showMainMenu( chatId,
    messageId = null) {
    if (messageId) {
        return editMessage( chatId,
            messageId,
            "🏠 Главное меню",
            getMainMenuKeyboard());
    }

    return sendMessage( chatId,
        "🏠 Главное меню",
        getMainMenuKeyboard());
}

async function startRegistration(chatId) {
    const state = createState();

    states.set( chatId,
        state);

    const result = await sendMessage( chatId,
            "Введите фамилию:");

    if (result.ok) {
        state.messageId = result.result.message_id;
    }
}

async function askRegistrationStep( chatId,
    state) {
    if (state.step === 0) {
        await editMessage( chatId,
            state.messageId,
            "Введите фамилию:");
        return;
    }

    if (state.step === 1) {
        await editMessage( chatId,
            state.messageId,
            "Введите имя:");
        return;
    }

    if (state.step === 2) {
        await editMessage( chatId,
            state.messageId,
            "Введите отчество:");
        return;
    }

    if (state.step === 3) {
        state.calendarType = "birth";
        state.calendarPage = 0;

        await showCalendar( chatId,
            state,
            "year");

        return;
    }

    if (state.step === 4) {
        await editMessage( chatId,
            state.messageId,
            "Введите номер паспорта:");
        return;
    }

    if (state.step === 5) {
        await showCitizenshipMenu( chatId,
            state);
        return;
    }

    if (state.step === 6) {
        await showContact1Menu( chatId,
            state);
        return;
    }

    if (state.step === 7 && state.data.replacesPassengerId) {
        state.step = 10;
        await showStatusMenu(chatId, state);
        return;
    }

    if (state.step === 7) {
        state.calendarType = "flight";
        state.calendarPage = 0;

        await showCalendar( chatId,
            state,
            "year");

        return;
    }

    if (state.step === 8) {
        await showRouteMenu( chatId,
            state);

        return;
    }

    if (state.step === 9) {
        await showFlightNumberMenu( chatId,
            state);

        return;
    }

    if (state.step === 10) {
        await showStatusMenu( chatId,
            state);
    }
}

function getCitizenshipKeyboard() {
    return {
        inline_keyboard: [ [ {
                    text: "🇹🇯 TJ",
                    callback_data: "citizenship_TJ"
                },
                {
                    text: "🇷🇺 RU",
                    callback_data: "citizenship_RU"
                }],
            [ {
                    text: "🌍 Другое",
                    callback_data: "registration_citizenship_other"
                }]]
    };
}

async function showCitizenshipMenu( chatId,
    state) {
    await editMessage( chatId,
        state.messageId,
        "Выберите гражданство:",
        getCitizenshipKeyboard());
}

function getContact1Keyboard() {
    return {
        inline_keyboard: [ [ {
                    text: "🌍 Другое",
                    callback_data: "contact1_other"
                }]]
    };
}

function getContact2Keyboard() {
    return {
        inline_keyboard: [ [ {
                    text: "🌍 Другое",
                    callback_data: "contact2_other"
                }]]
    };
}

async function showContact1Menu( chatId,
    state) {
    await editMessage( chatId,
        state.messageId,
        "Введите контакт 1:\n\nМожно ввести номер Таджикистана.\nНапример: 900000000",
        getContact1Keyboard());
}

async function showContact2Menu( chatId,
    state) {
    await editMessage( chatId,
        state.messageId,
        "Введите контакт 2:",
        getContact2Keyboard());
}

function getContactsMenuKeyboard() {
    return {
        inline_keyboard: [ [ {
                    text: "➕ Добавить ещё один номер",
                    callback_data: "add_contact2"
                }],
            [ {
                    text: "➡️ Продолжить",
                    callback_data: "contacts_continue"
                }]]
    };
}

async function showContactMenu( chatId,
    state) {
    await editMessage( chatId,
        state.messageId,
        "📞 Контакты\n\n" + `Контакт 1: ${
            state.data.contact1 || "не указан"
        }\n` + `Контакт 2: ${
            state.data.contact2 || "не указан"
        }`,
        getContactsMenuKeyboard());
}

function getRouteKeyboard() {
    return {
        inline_keyboard: [ [ {
                    text: "ДШБ — ХРГ",
                    callback_data: "route_DSHB_XRG"
                }],
            [ {
                    text: "ХРГ — ДШБ",
                    callback_data: "route_XRG_DSHB"
                }]]
    };
}

async function showRouteMenu( chatId,
    state) {
    await editMessage( chatId,
        state.messageId,
        "Выберите маршрут:",
        getRouteKeyboard());
}

async function showFlightNumberMenu( chatId,
    state) {
    const flights = state.data.route === "ДШБ — ХРГ"
        ? [["DW101", "08:00"], ["DW103", "12:00"]]
        : state.data.route === "ХРГ — ДШБ"
            ? [["DW102", "10:00"], ["DW104", "14:00"]]
            : [];
    await editMessage( chatId,
        state.messageId,
        "✈️ Выберите рейс:",
        { inline_keyboard: [ ...flights.map(([flight, time]) => [{
                text: `${flight} — ${time}`,
                callback_data: `registration_flight_${flight}`
            }]),
            [{ text: "↩️ К маршрутам", callback_data: "registration_back_route" }]] });
}

async function showEditFlightMenu(chatId, state, route = state.data.route) {
    const flights = route === "ДШБ — ХРГ"
        ? [["DW101", "08:00"], ["DW103", "12:00"]]
        : [["DW102", "10:00"], ["DW104", "14:00"]];
    await editMessage(chatId, state.messageId, "✈️ Выберите рейс:", {
        inline_keyboard: [ ...flights.map(([flight, time]) => [{
                text: `${flight} — ${time}`,
                callback_data: `edit_select_flight_${flight}`
            }]),
            [{ text: "↩️ Назад", callback_data: "edit_back" }]]
    });
}

function getStatusKeyboard() {
    return {
        inline_keyboard: [ [ {
                    text: "Забронирован",
                    callback_data: "status_booked"
                }],
            [ {
                    text: "Подтвержден",
                    callback_data: "status_confirmed"
                }],
            [ {
                    text: "Отменен",
                    callback_data: "status_cancelled"
                }]]
    };
}

async function showStatusMenu( chatId,
    state) {
    const { flightDate, route, flight } = state.data;
    let occupancyText = "";

    if (flightDate && route && flight) {
        const occupied = await calculateRouteOccupancy(flightDate, route, flight);
        const available = Math.max(0, CAPACITY - occupied);
        occupancyText = `📅 ${flightDate}\n` + `🛫 ${route} · ${flight}\n` + `💺 Занято: ${occupied} из ${CAPACITY}\n` +
            `Свободно: ${available}\n\n`;
    }

    await editMessage( chatId,
        state.messageId,
        occupancyText + "Выберите статус:",
        getStatusKeyboard());
}

function buildPassengerCard(data) {
    return ( "👤 Данные пассажира\n\n" + `🆔 ID: ${data.passengerId || "—"}\n` + `Фамилия: ${data.surname || "—"}\n` +
        `Имя: ${data.name || "—"}\n` + `Отчество: ${data.patronymic || "—"}\n` + `Дата рождения: ${data.birthDate || "—"}\n` +
        `Паспорт: ${data.passport || "—"}\n` + `Гражданство: ${data.citizenship || "—"}\n` + `Контакт 1: ${data.contact1 || "—"}\n` +
        `Контакт 2: ${data.contact2 || "—"}\n` + `Дата рейса: ${data.flightDate || "—"}\n` + `Маршрут: ${data.route || "—"}\n` +
        `✈️ Рейс: ${data.flight || "—"}\n` + `Статус: ${data.status || "—"}` + (data.replacesPassengerId ? `\nВместо пассажира ID: ${data.replacesPassengerId}` : "") +
        (data.replacedByPassengerId ? `\nЗамена: ID ${data.replacedByPassengerId}` : "") + (data.comment ? `\nКомментарий: ${data.comment}` : "")
    );
}

function getPassengerCardKeyboard(data) {
    return {
        inline_keyboard: [ [ {
                    text: "✏️ Изменить данные",
                    callback_data: "passenger_edit"
                }],
            ...(data && !isInactiveStatus(data.status) ? [[{
                text: "🚫 Не явился",
                callback_data: "passenger_no_show"
            }], [{
                text: "💸 Возврат",
                callback_data: "passenger_refund"
            }]] : []),
            [ {
                    text: "➕ Добавить ещё одного",
                    callback_data: "passenger_add_another"
                }],
            [ {
                    text: "🏠 Главное меню",
                    callback_data: "passenger_main_menu"
                }]]
    };
}

async function showPassengerCard( chatId,
    state) {
    await editMessage( chatId,
        state.messageId,
        buildPassengerCard( state.data),
        getPassengerCardKeyboard(state.data));
}

function getEditMenuKeyboard() {
    return {
        inline_keyboard: [ [ {
                    text: "✏️ Фамилия",
                    callback_data: "edit_surname"
                },
                {
                    text: "✏️ Имя",
                    callback_data: "edit_name"
                }],
            [ {
                    text: "✏️ Отчество",
                    callback_data: "edit_patronymic"
                }],
            [ {
                    text: "✏️ Дата рождения",
                    callback_data: "edit_birthDate"
                }],
            [ {
                    text: "✏️ Паспорт",
                    callback_data: "edit_passport"
                }],
            [ {
                    text: "✏️ Гражданство",
                    callback_data: "edit_citizenship"
                }],
            [ {
                    text: "✏️ Контакт 1",
                    callback_data: "edit_contact1"
                }],
            [ {
                    text: "✏️ Контакт 2",
                    callback_data: "edit_contact2"
                }],
            [ {
                    text: "✏️ Дата рейса",
                    callback_data: "edit_flightDate"
                }],
            [ {
                    text: "✏️ Маршрут",
                    callback_data: "edit_route"
                }],
            [ {
                    text: "✏️ Рейс",
                    callback_data: "edit_flight"
                }],
            [ {
                    text: "✏️ Статус",
                    callback_data: "edit_status"
                }],
            [ {
                    text: "↩️ Назад",
                    callback_data: "edit_menu_back"
                }]]
    };
}

async function showEditMenu( chatId,
    state) {
    state.editingField = null;

    await editMessage( chatId,
        state.messageId,
        "✏️ Что хотите изменить?",
        getEditMenuKeyboard());
}

function getEditCitizenshipKeyboard() {
    return {
        inline_keyboard: [ [ {
                    text: "🇹🇯 TJ",
                    callback_data: "edit_citizenship_TJ"
                },
                {
                    text: "🇷🇺 RU",
                    callback_data: "edit_citizenship_RU"
                }],
            [ {
                    text: "🌍 Другое",
                    callback_data: "edit_citizenship_other"
                }],
            [ {
                    text: "↩️ Назад",
                    callback_data: "edit_back"
                }]]
    };
}

async function showEditCitizenship( chatId,
    state) {
    await editMessage( chatId,
        state.messageId,
        "Выберите гражданство:",
        getEditCitizenshipKeyboard());
}

function getEditContactKeyboard(number) {
    return {
        inline_keyboard: [ [ {
                    text: "🌍 Другое",
                    callback_data: `edit_contact${number}_other`
                }],
            [ {
                    text: "↩️ Назад",
                    callback_data: "edit_back"
                }]]
    };
}

async function showEditContact( chatId,
    state,
    number) {
    await editMessage( chatId,
        state.messageId,
        `Введите контакт ${number}:`,
        getEditContactKeyboard(number));
}

async function finishRegistration( chatId,
    state) {
    if (state.registrationSaving || state.registrationSaved) return;
    state.registrationSaving = true;
    try {
    if (!isInactiveStatus(state.data.status)) {
        const occupancy = await calculateRouteOccupancy( state.data.flightDate,
                state.data.route,
                state.data.flight);

        if (occupancy >= CAPACITY) {
            await editMessage( chatId,
                state.messageId,
                `❌ Рейс ${state.data.flight} на дату ${state.data.flightDate} по маршруту ${state.data.route} заполнен: ${CAPACITY}/${CAPACITY}.`,
                {
                    inline_keyboard: [ [ {
                                text: "↩️ Выбрать другой рейс",
                                callback_data: "registration_back_flight"
                            }]]
                });

            return;
        }
    }

    try {
        const rows = await getAllPassengers();

        const existingIds = new Set( rows.slice(1).map(row => row[0]).filter(Boolean));

        if (!state.data.passengerId) {
            state.data.passengerId = generatePassengerId(existingIds);
        }
        await editMessage(chatId, state.messageId,
            "⏳ Сохраняю пассажира…", { inline_keyboard: [] });

        await savePassenger( state.data);
        state.rowNumber = state.data.rowNumber;
        state.registrationSaved = true;
        state.step = 11;

        // Связь видна в колонках N и O. Ошибка связи не теряет новую запись.
        if (state.data.replacesPassengerId) {
            try {
                const oldRows = await getAllPassengers();
                const oldIndex = oldRows.findIndex((row, index) =>
                    index > 0 && row[0] === state.data.replacesPassengerId);
                if (oldIndex > 0) {
                    const oldPassenger = rowToPassenger(oldRows[oldIndex], oldIndex + 1);
                    oldPassenger.replacedByPassengerId = state.data.passengerId;
                    await updatePassenger(oldPassenger.rowNumber, oldPassenger);
                }
            } catch (linkError) {
                console.error("Не удалось связать замену:", linkError);
            }
        }

        await showPassengerCard( chatId,
            state);
    } catch (error) {
        console.error( "❌ Ошибка сохранения:",
            error);

        await editMessage( chatId,
            state.messageId,
            "❌ Не удалось сохранить пассажира в Google Sheets.",
            {
                inline_keyboard: [ [ {
                            text: "🏠 Главное меню",
                            callback_data: "passenger_main_menu"
                        }]]
            });
    }
    } finally {
        state.registrationSaving = false;
    }

}

function getViewDataKeyboard() {
    return {
        inline_keyboard: [ [ {
                    text: "📋 Все пассажиры",
                    callback_data: "view_all"
                }],
            [ {
                    text: "📅 По дате рейса",
                    callback_data: "view_by_date"
                }],
            [ {
                    text: "✈️ По маршруту",
                    callback_data: "view_by_route"
                }],
            [ {
                    text: "🔎 Найти по паспорту",
                    callback_data: "view_by_passport"
                }],
            [ {
                    text: "🆔 Найти по ID",
                    callback_data: "view_by_id"
                }],
            [ {
                    text: "↩️ Назад",
                    callback_data: "view_data_back"
                }]]
    };
}

async function showViewDataMenu( chatId,
    state) {
    state.viewMode = null;
    state.viewPage = 0;
    state.editingField = null;
    state.viewDate = null;
    state.viewRoute = null;
    state.viewFlight = null;

    await editMessage( chatId,
        state.messageId,
        "👤 Посмотреть данные\n\nЧто хотите посмотреть?",
        getViewDataKeyboard());
}

async function getPassengerObjects() {
    const rows = await getAllPassengers();

    const result = [];

    for ( let i = 1;
        i < rows.length;
        i++) {
        result.push( rowToPassenger( rows[i],
                i + 1));
    }

    return result;
}

function getPassengerListText( passengers,
    page,
    title) {
    const total = passengers.length;

    const totalPages = Math.max( 1,
            Math.ceil( total /
                PAGE_SIZE));

    const safePage = Math.min( page,
            totalPages - 1);

    const start = safePage * PAGE_SIZE;

    const pagePassengers = passengers.slice( start,
            start + PAGE_SIZE);

    let text = `${title}\n\n`;

    if (!pagePassengers.length) {
        return text + "Пассажиров нет.";
    }

    pagePassengers.forEach( (passenger, index) => {
            const number = start + index + 1;

            text +=
                `${number}. ` + `${passenger.surname} ` + `${passenger.name}`;

            if ( passenger.patronymic) {
                text +=
                    ` ${passenger.patronymic}`;
            }

            text += "\n";

            text +=
                `   🆔 ${
                    passenger.passengerId || "—"
                }\n`;

            text +=
                `   📅 ${
                    passenger.flightDate || "—"
                } | ${
                    passenger.route || "—"
                }\n`;

            text +=
                `   ✈️ Рейс: ${
                    passenger.flight || "—"
                }\n`;

            text +=
                `   ${
                    passenger.status || "—"
                }\n\n`;
        });

    text +=
        `Страница ${
            safePage + 1
        } из ${totalPages}`;

    return text;
}

function getPassengerListKeyboard( passengers,
    page,
    prefix = "view") {
    const totalPages = Math.max( 1,
            Math.ceil( passengers.length /
                PAGE_SIZE));

    const keyboard = [];

    const start = page * PAGE_SIZE;

    const current = passengers.slice( start,
            start + PAGE_SIZE);

    current.forEach( (passenger, index) => {
            const number = start + index + 1;

            keyboard.push([ {
                    text: `${number}. ${passenger.surname} ${passenger.name}`,
                    callback_data: `${prefix}_passenger_${passenger.rowNumber}`
                }]);
        });

    const navigation = [];

    if (page > 0) {
        navigation.push({
            text: "⬅️",
            callback_data: `${prefix}_page_${page - 1}`
        });
    }

    if ( page <
        totalPages - 1) {
        navigation.push({
            text: "➡️",
            callback_data: `${prefix}_page_${page + 1}`
        });
    }

    if (navigation.length) {
        keyboard.push( navigation);
    }

    keyboard.push([ {
            text: "↩️ Назад",
            callback_data: "view_data_menu"
        }]);

    return {
        inline_keyboard: keyboard
    };
}

async function showAllPassengers( chatId,
    state,
    page = 0) {
    const passengers = await getPassengerObjects();

    state.viewMode = "all";
    state.viewPassengers = passengers;
    state.viewPage = page;

    await editMessage( chatId,
        state.messageId,
        getPassengerListText( passengers,
            page,
            "📋 Все пассажиры"),
        getPassengerListKeyboard( passengers,
            page,
            "all"));
}

async function showViewDateCalendar( chatId,
    state) {
    state.calendarType = "view_date";

    state.calendarPage = 0;

    await showCalendar( chatId,
        state,
        "year");
}

function getViewRouteKeyboard() {
    return {
        inline_keyboard: [ [ {
                    text: "ДШБ — ХРГ",
                    callback_data: "view_route_DSHB_XRG"
                }],
            [ {
                    text: "ХРГ — ДШБ",
                    callback_data: "view_route_XRG_DSHB"
                }],
            [ {
                    text: "↩️ Назад",
                    callback_data: "view_data_menu"
                }]]
    };
}

async function showViewRouteMenu( chatId,
    state) {
    await editMessage( chatId,
        state.messageId,
        "✈️ Выберите маршрут:",
        getViewRouteKeyboard());
}

async function showPassengersFiltered( chatId,
    state,
    passengers,
    title,
    prefix) {
    state.viewPassengers = passengers;

    state.viewPage = 0;

    await editMessage( chatId,
        state.messageId,
        getPassengerListText( passengers,
            0,
            title),
        getPassengerListKeyboard( passengers,
            0,
            prefix));
}

async function showFlightPassengersStart( chatId,
    state) {
    state.viewMode = "flight_filter_date";

    state.calendarType = "flight_filter_date";

    state.calendarPage = 0;

    await showCalendar( chatId,
        state,
        "year");
}

async function showFlightFilterRoute( chatId,
    state) {
    await editMessage( chatId,
        state.messageId,
        "✈️ Выберите маршрут:",
        {
            inline_keyboard: [ [ {
                        text: "ДШБ — ХРГ",
                        callback_data: "flight_filter_route_DSHB_XRG"
                    }],
                [ {
                        text: "ХРГ — ДШБ",
                        callback_data: "flight_filter_route_XRG_DSHB"
                    }],
                [ {
                        text: "↩️ Назад",
                        callback_data: "main_menu_back"
                    }]]
        });
}

async function showFlightFilterNumber( chatId,
    state) {
    await editMessage( chatId,
        state.messageId,
        "✈️ Введите номер рейса:");
}

async function showPassportSearch( chatId,
    state) {
    state.viewMode = "passport_search";

    await editMessage( chatId,
        state.messageId,
        "🔎 Введите номер паспорта:");
}

async function showIdSearch( chatId,
    state) {
    state.viewMode = "id_search";

    await editMessage( chatId,
        state.messageId,
        "🆔 Введите ID пассажира:");
}

async function showViewedPassenger( chatId,
    state,
    rowNumber) {
    const rows = await getAllPassengers();

    const index = Number(rowNumber) - 1;

    if ( index < 1 || index >= rows.length) {
        await editMessage( chatId,
            state.messageId,
            "❌ Пассажир не найден.",
            {
                inline_keyboard: [ [ {
                            text: "↩️ Назад",
                            callback_data: "view_data_menu"
                        }]]
            });

        return;
    }

    const passenger = rowToPassenger( rows[index],
            Number(rowNumber));

    state.data = passenger;

    state.rowNumber = passenger.rowNumber;

    await editMessage( chatId,
        state.messageId,
        buildPassengerCard( passenger),
        {
            inline_keyboard: [ [ {
                        text: "✏️ Изменить данные",
                        callback_data: "view_passenger_edit"
                    }],
                ...(!isInactiveStatus(passenger.status) ? [[{
                    text: "🚫 Не явился",
                    callback_data: "passenger_no_show"
                }], [{
                    text: "💸 Возврат",
                    callback_data: "passenger_refund"
                }]] : []),
                [ {
                        text: "↩️ Назад к списку",
                        callback_data: "view_back_to_list"
                    }],
                [ {
                        text: "🏠 Главное меню",
                        callback_data: "view_main_menu"
                    }]]
        });
}

module.exports = { getMainMenuKeyboard, showMainMenu, startRegistration, askRegistrationStep, getCitizenshipKeyboard, showCitizenshipMenu, getContact1Keyboard, getContact2Keyboard, showContact1Menu, showContact2Menu, getContactsMenuKeyboard, showContactMenu, getRouteKeyboard, showRouteMenu, showFlightNumberMenu, showEditFlightMenu, getStatusKeyboard, showStatusMenu, buildPassengerCard, getPassengerCardKeyboard, showPassengerCard, getEditMenuKeyboard, showEditMenu, getEditCitizenshipKeyboard, showEditCitizenship, getEditContactKeyboard, showEditContact, finishRegistration, getViewDataKeyboard, showViewDataMenu, getPassengerObjects, getPassengerListText, getPassengerListKeyboard, showAllPassengers, showViewDateCalendar, getViewRouteKeyboard, showViewRouteMenu, showPassengersFiltered, showFlightPassengersStart, showFlightFilterRoute, showFlightFilterNumber, showPassportSearch, showIdSearch, showViewedPassenger };
