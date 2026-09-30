const { getState, normalizeFlight, rowToPassenger, createState, states } = require('./helpers');
const { answerCallbackQuery, editMessage } = require('./telegram');
const { showMainMenu, startRegistration, showViewDataMenu, showFlightPassengersStart, showFlightFilterNumber, getPassengerObjects, showAllPassengers, showViewedPassenger, showViewDateCalendar, showViewRouteMenu, showPassportSearch, showIdSearch, showPassengersFiltered, getPassengerListText, getPassengerListKeyboard, showEditMenu, askRegistrationStep, showFlightFilterRoute, showContact1Menu, showContact2Menu, showFlightNumberMenu, showStatusMenu, finishRegistration, showRouteMenu, showPassengerCard, showEditFlightMenu, showEditCitizenship, showEditContact } = require('./menus');
const { showCalendar, getBaseCalendarType, isPastFlightDate } = require('./calendar');
const { updatePassenger, calculateRouteOccupancy, getAllPassengers, isInactiveStatus } = require('./sheets');
const { CAPACITY } = require('./config');
const { finishStatusWithComment } = require('./messages');

async function handleCallbackQuery( callbackQuery) {
    const chatId = callbackQuery.message.chat.id;

    const messageId = callbackQuery.message.message_id;

    const data = callbackQuery.data;

    const state = getState(chatId);

    state.messageId = messageId;

    // Подтверждение нажатия и работа с кнопкой выполняются параллельно.
    void answerCallbackQuery(callbackQuery.id).catch(error => {
        console.warn("Не удалось подтвердить нажатие кнопки:", error.message);
    });


    // MAIN MENU

    if ( data === "main_menu_back") {
        await showMainMenu( chatId,
            messageId);

        return;
    }

    if ( data === "main_add_passenger") {
        await startRegistration( chatId);

        return;
    }


    // UPLOAD EXCEL

    if ( data === "main_upload_excel") {
        await editMessage( chatId,
            messageId,
            "📥 Загрузить Excel\n\n" + "Отправьте сюда Excel-файл в формате .xlsx.\n\n" +
            "Обязательные колонки:\n\n" + "Фамилия\n" + "Имя\n" + "Отчество\n" + "Дата рождения\n" +
            "Паспорт\n" + "Гражданство\n" + "Контакт 1\n" + "Контакт 2\n" + "Дата рейса\n" + "Маршрут\n" +
            "Рейс\n" + "Статус",
            {
                inline_keyboard: [ [ {
                            text: "🏠 Главное меню",
                            callback_data: "main_menu_back"
                        }]]
            });

        return;
    }


    // VIEW DATA

    if ( data === "main_view_data" || data === "main_find_passenger") {
        await showViewDataMenu( chatId,
            state);

        return;
    }


    // PASSENGERS BY FLIGHT

    if ( data === "main_flight_passengers") {
        await showFlightPassengersStart( chatId,
            state);

        return;
    }

    if ( data === "flight_filter_route_DSHB_XRG" || data === "flight_filter_route_XRG_DSHB") {
        const route = data === "flight_filter_route_DSHB_XRG"
                ? "ДШБ — ХРГ"
                : "ХРГ — ДШБ";

        state.viewRoute = route;

        state.viewMode = "flight_filter_number";

        await showFlightFilterNumber( chatId,
            state);

        return;
    }


    // STATISTICS

    if ( data === "main_statistics") {
        const passengers = await getPassengerObjects();

        const total = passengers.length;

        const booked = passengers.filter( p =>
                    p.status === "Забронирован").length;

        const confirmed = passengers.filter( p =>
                    p.status === "Подтвержден").length;

        const cancelled = passengers.filter( p =>
                    p.status === "Отменен").length;

        const flightMap = new Map();

        passengers.forEach( passenger => {
                const key = `${passenger.flightDate}|${passenger.route}|${normalizeFlight(passenger.flight)}`;

                if ( !flightMap.has(key)) {
                    flightMap.set( key,
                        {
                            date: passenger.flightDate,
                            route: passenger.route,
                            flight: passenger.flight,
                            total: 0,
                            booked: 0,
                            confirmed: 0,
                            cancelled: 0
                        });
                }

                const item = flightMap.get(key);

                item.total++;

                if ( passenger.status === "Забронирован") {
                    item.booked++;
                }

                if ( passenger.status === "Подтвержден") {
                    item.confirmed++;
                }

                if ( passenger.status === "Отменен") {
                    item.cancelled++;
                }
            });

        let flightStatistics = "";

        for ( const item
            of flightMap.values()) {
            flightStatistics +=
                `\n✈️ ${item.flight || "—"} | ${item.date || "—"}\n` + `${item.route || "—"}\n` + `👥 ${item.total} | 🟡 ${item.booked} | 🟢 ${item.confirmed} | 🔴 ${item.cancelled}\n`;
        }

        await editMessage( chatId,
            messageId,
            "📊 Статистика\n\n" + `👥 Всего пассажиров: ${total}\n` + `🟡 Забронировано: ${booked}\n` + `🟢 Подтверждено: ${confirmed}\n` +
            `🔴 Отменено: ${cancelled}\n\n` + "━━━━━━━━━━━━━━\n" + "✈️ По рейсам:" + ( flightStatistics ||
                "\n\nРейсов пока нет."),
            {
                inline_keyboard: [ [ {
                            text: "🏠 Главное меню",
                            callback_data: "main_menu_back"
                        }]]
            });

        return;
    }


    // VIEW MENU

    if ( data === "view_data_menu") {
        await showViewDataMenu( chatId,
            state);

        return;
    }

    if ( data === "view_data_back") {
        await showMainMenu( chatId,
            messageId);

        return;
    }


    // ALL PASSENGERS

    if ( data === "view_all") {
        await showAllPassengers( chatId,
            state,
            0);

        return;
    }

    if ( data.startsWith( "all_page_")) {
        const page = Number( data.replace( "all_page_",
                    ""));

        await showAllPassengers( chatId,
            state,
            page);

        return;
    }

    if ( data.startsWith( "all_passenger_")) {
        await showViewedPassenger( chatId,
            state,
            data.replace( "all_passenger_",
                ""));

        return;
    }


    // VIEW BY DATE

    if ( data === "view_by_date") {
        await showViewDateCalendar( chatId,
            state);

        return;
    }


    // VIEW BY ROUTE

    if ( data === "view_by_route") {
        await showViewRouteMenu( chatId,
            state);

        return;
    }


    // VIEW BY PASSPORT

    if ( data === "view_by_passport") {
        await showPassportSearch( chatId,
            state);

        return;
    }


    // VIEW BY ID

    if ( data === "view_by_id") {
        await showIdSearch( chatId,
            state);

        return;
    }


    // ROUTE FILTER

    if ( data === "view_route_DSHB_XRG" || data === "view_route_XRG_DSHB") {
        const route = data === "view_route_DSHB_XRG"
                ? "ДШБ — ХРГ"
                : "ХРГ — ДШБ";

        const passengers = await getPassengerObjects();

        const filtered = passengers.filter( p =>
                    p.route === route);

        state.viewRoute = route;

        await showPassengersFiltered( chatId,
            state,
            filtered,
            `✈️ Пассажиры: ${route}`,
            "route");

        return;
    }

    if ( data.startsWith( "route_page_")) {
        const page = Number( data.replace( "route_page_",
                    ""));

        const passengers = state.viewPassengers || [];

        state.viewPage = page;

        await editMessage( chatId,
            state.messageId,
            getPassengerListText( passengers,
                page,
                `✈️ Пассажиры: ${
                    state.viewRoute || ""
                }`),
            getPassengerListKeyboard( passengers,
                page,
                "route"));

        return;
    }

    if ( data.startsWith( "route_passenger_")) {
        await showViewedPassenger( chatId,
            state,
            data.replace( "route_passenger_",
                ""));

        return;
    }


    // DATE FILTER

    if ( data.startsWith( "date_page_")) {
        const page = Number( data.replace( "date_page_",
                    ""));

        const passengers = state.viewPassengers || [];

        state.viewPage = page;

        await editMessage( chatId,
            state.messageId,
            getPassengerListText( passengers,
                page,
                `📅 Пассажиры на ${
                    state.viewDate || ""
                }`),
            getPassengerListKeyboard( passengers,
                page,
                "date"));

        return;
    }

    if ( data.startsWith( "date_passenger_")) {
        await showViewedPassenger( chatId,
            state,
            data.replace( "date_passenger_",
                ""));

        return;
    }


    // FLIGHT FILTER RESULT

    if ( data.startsWith( "flight_page_")) {
        const page = Number( data.replace( "flight_page_",
                    ""));

        const passengers = state.viewPassengers || [];

        state.viewPage = page;

        await editMessage( chatId,
            state.messageId,
            getPassengerListText( passengers,
                page,
                `✈️ Рейс ${state.viewFlight || ""}\n📅 ${state.viewDate || ""}\n🛫 ${state.viewRoute || ""}`
            ),
            getPassengerListKeyboard( passengers,
                page,
                "flight"));

        return;
    }

    if ( data.startsWith( "flight_passenger_")) {
        await showViewedPassenger( chatId,
            state,
            data.replace( "flight_passenger_",
                ""));

        return;
    }


    // SEARCH RESULT

    if ( data.startsWith( "search_page_")) {
        const page = Number( data.replace( "search_page_",
                    ""));

        const passengers = state.viewPassengers || [];

        state.viewPage = page;

        await editMessage( chatId,
            state.messageId,
            getPassengerListText( passengers,
                page,
                "🔎 Результат поиска"),
            getPassengerListKeyboard( passengers,
                page,
                "search"));

        return;
    }

    if ( data.startsWith( "search_passenger_")) {
        await showViewedPassenger( chatId,
            state,
            data.replace( "search_passenger_",
                ""));

        return;
    }


    // VIEW PASSENGER NAVIGATION

    if ( data === "view_back_to_list") {
        if ( state.viewMode === "all") {
            await showAllPassengers( chatId,
                state,
                state.viewPage || 0);

            return;
        }

        const passengers = state.viewPassengers || [];

        let title = "🔎 Результат поиска";

        let prefix = "search";

        if ( state.viewMode === "flight_result") {
            title = `✈️ Рейс ${state.viewFlight || ""}\n📅 ${state.viewDate || ""}\n🛫 ${state.viewRoute || ""}`;

            prefix = "flight";
        } else if ( state.viewDate) {
            title = `📅 Пассажиры на ${state.viewDate}`;

            prefix = "date";
        } else if ( state.viewRoute) {
            title = `✈️ Пассажиры: ${state.viewRoute}`;

            prefix = "route";
        }

        await editMessage( chatId,
            state.messageId,
            getPassengerListText( passengers,
                state.viewPage || 0,
                title),
            getPassengerListKeyboard( passengers,
                state.viewPage || 0,
                prefix));

        return;
    }

    if ( data === "view_main_menu") {
        await showMainMenu( chatId,
            messageId);

        return;
    }


    // CALENDAR

    if ( data.startsWith( "calendar_year_page_")) {
        state.calendarPage = Number( data.replace( "calendar_year_page_",
                    ""));

        await showCalendar( chatId,
            state,
            "year");

        return;
    }

    if ( data.startsWith( "calendar_year_")) {
        state.calendarYear = Number( data.replace( "calendar_year_",
                    ""));

        await showCalendar( chatId,
            state,
            "month");

        return;
    }

    if ( data.startsWith( "calendar_month_")) {
        state.calendarMonth = Number( data.replace( "calendar_month_",
                    ""));

        await showCalendar( chatId,
            state,
            "day");

        return;
    }

    if ( data.startsWith( "calendar_day_")) {
        const day = Number( data.replace( "calendar_day_",
                    ""));

        const date = `${String(day).padStart(2, "0")}.` + `${String( state.calendarMonth + 1).padStart(2, "0")}.` +
            `${state.calendarYear}`;

        const base = getBaseCalendarType( state.calendarType);

        /* BIRTH */

        if ( base === "birth") {
            const selected = new Date( state.calendarYear,
                    state.calendarMonth,
                    day);

            const today = new Date();

            selected.setHours( 0, 0, 0, 0);

            today.setHours( 0, 0, 0, 0);

            if ( selected > today) {
                await answerCallbackQuery( callbackQuery.id,
                    "❌ Дата рождения не может быть в будущем");

                return;
            }

            state.data.birthDate = date;

            if ( state.calendarType === "birth_edit") {
                await updatePassenger( state.rowNumber,
                    state.data);

                await showEditMenu( chatId,
                    state);

                return;
            }

            state.step = 4;

            await askRegistrationStep( chatId,
                state);

            return;
        }

        /* FLIGHT */

        if ( base === "flight") {
            if (isPastFlightDate(state.calendarYear, state.calendarMonth, day)) {
                await answerCallbackQuery(callbackQuery.id,
                    "❌ Нельзя выбрать прошедшую дату рейса");
                return;
            }

            state.data.flightDate = date;

            if ( state.calendarType === "flight_edit") {
                const occupancy = await calculateRouteOccupancy( state.data.flightDate,
                        state.data.route,
                        state.data.flight,
                        state.rowNumber);

                if ( state.data.status !== "Отменен" && occupancy >=
                        CAPACITY) {
                    await editMessage( chatId,
                        state.messageId,
                        `❌ Рейс ${state.data.flight} на дату ${date} по маршруту ${state.data.route} заполнен: ${CAPACITY}/${CAPACITY}.`,
                        {
                            inline_keyboard: [ [ {
                                        text: "↩️ Назад",
                                        callback_data: "edit_back"
                                    }]]
                        });

                    return;
                }

                await updatePassenger( state.rowNumber,
                    state.data);

                await showEditMenu( chatId,
                    state);

                return;
            }

            state.step = 8;

            await askRegistrationStep( chatId,
                state);

            return;
        }

        /* VIEW DATE */

        if ( state.calendarType === "view_date") {
            state.viewDate = date;

            const passengers = await getPassengerObjects();

            const filtered = passengers.filter( p =>
                        p.flightDate === date);

            await showPassengersFiltered( chatId,
                state,
                filtered,
                `📅 Пассажиры на ${date}`,
                "date");

            return;
        }

        /* FLIGHT FILTER DATE */

        if ( state.calendarType === "flight_filter_date") {
            state.viewDate = date;

            state.viewMode = "flight_filter_route";

            await showFlightFilterRoute( chatId,
                state);

            return;
        }

        return;
    }

    if ( data === "calendar_back_years") {
        await showCalendar( chatId,
            state,
            "year");

        return;
    }

    if ( data === "calendar_back_months") {
        await showCalendar( chatId,
            state,
            "month");

        return;
    }

    if ( data === "calendar_ignore") {
        return;
    }


    // CITIZENSHIP

    if ( data === "citizenship_TJ" || data === "citizenship_RU") {
        state.data.citizenship = data === "citizenship_TJ"
                ? "TJ"
                : "RU";

        state.step = 6;

        await showContact1Menu( chatId,
            state);

        return;
    }

    if ( data === "registration_citizenship_other") {
        state.editingField = "registration_citizenship_other";

        await editMessage( chatId,
            messageId,
            "🌍 Введите гражданство:");

        return;
    }


    // CONTACTS

    if ( data === "contact1_other") {
        state.editingField = "registration_contact1_other";

        await editMessage( chatId,
            messageId,
            "🌍 Введите контакт 1:");

        return;
    }

    if ( data === "contact2_other") {
        state.editingField = "registration_contact2_other";

        await editMessage( chatId,
            messageId,
            "🌍 Введите контакт 2:");

        return;
    }

    if ( data === "add_contact2") {
        await showContact2Menu( chatId,
            state);

        return;
    }

    if ( data === "contacts_continue") {
        state.step = 7;
        state.calendarType = "flight";
        state.calendarPage = 0;

        await showCalendar( chatId,
            state,
            "year");

        return;
    }


    // ROUTE

    if ( state.step === 8 && data === "route_DSHB_XRG") {
        state.data.route = "ДШБ — ХРГ";

        state.step = 9;

        await showFlightNumberMenu( chatId,
            state);

        return;
    }

    if ( state.step === 8 && data === "route_XRG_DSHB") {
        state.data.route = "ХРГ — ДШБ";

        state.step = 9;

        await showFlightNumberMenu( chatId,
            state);

        return;
    }


    // REGISTRATION BACK TO FLIGHT

    if ( data === "registration_back_flight") {
        state.step = 9;

        await showFlightNumberMenu( chatId,
            state);

        return;
    }

    if (state.step === 9 && data.startsWith("registration_flight_")) {
        const flight = data.slice("registration_flight_".length);
        const allowed = state.data.route === "ДШБ — ХРГ"
            ? ["DW101", "DW103"] : ["DW102", "DW104"];
        if (!allowed.includes(flight)) return;
        state.data.flight = flight;
        state.step = 10;
        await showStatusMenu(chatId, state);
        return;
    }


    // STATUS

    if ((data === "status_booked" || data === "status_confirmed" || data === "status_cancelled") &&
        (state.registrationSaving || state.registrationSaved)) return;

    if ( state.step === 10 && ( data === "status_booked" || data === "status_confirmed" || data ===
                "status_cancelled")) {
        if ( data === "status_booked") {
            state.data.status = "Забронирован";
        }

        if ( data === "status_confirmed") {
            state.data.status = "Подтвержден";
        }

        if ( data === "status_cancelled") {
            state.data.status = "Отменен";
        }

        await finishRegistration( chatId,
            state);

        return;
    }

    if ( data === "registration_back_route") {
        state.step = 8;

        await showRouteMenu( chatId,
            state);

        return;
    }


    // PASSENGER CARD

    if (data === "passenger_no_show" || data === "passenger_refund") {
        const rows = await getAllPassengers();
        const rowNumber = Number(state.rowNumber);
        const row = rows[rowNumber - 1];
        if (!row || !state.data.passengerId || row[0] !== state.data.passengerId) {
            await editMessage(chatId, messageId, "❌ Запись изменилась. Найдите пассажира заново.");
            return;
        }
        const passenger = rowToPassenger(row, rowNumber);
        if (isInactiveStatus(passenger.status)) {
            await editMessage(chatId, messageId, `Статус пассажира: ${passenger.status}.`);
            return;
        }
        state.pendingStatusComment = {
            passengerId: passenger.passengerId,
            rowNumber,
            status: data === "passenger_no_show" ? "Не явился" : "Возврат"
        };
        await editMessage(chatId, messageId,
            `Статус «${state.pendingStatusComment.status}».\n\nНапишите комментарий или нажмите «Без комментария»:`, {
                inline_keyboard: [[{ text: "Без комментария", callback_data: "status_comment_skip" }],
                    [{ text: "↩️ Отмена", callback_data: "status_comment_cancel" }]]
            });
        return;
    }

    if (data === "status_comment_skip" && state.pendingStatusComment) {
        await finishStatusWithComment(chatId, state, "");
        return;
    }

    if (data === "status_comment_cancel" && state.pendingStatusComment) {
        state.pendingStatusComment = null;
        await showPassengerCard(chatId, state);
        return;
    }

    if (data === "no_show_replace") {
        const old = state.data;
        if (!old || old.status !== "Не явился" || !old.passengerId) {
            await showMainMenu(chatId, messageId);
            return;
        }
        const replacement = createState();
        replacement.messageId = messageId;
        replacement.data = {
            flightDate: old.flightDate,
            route: old.route,
            flight: old.flight,
            replacesPassengerId: old.passengerId
        };
        states.set(chatId, replacement);
        await editMessage(chatId, messageId,
            `➕ Замена пассажира ID ${old.passengerId}\n${old.flightDate} · ${old.route} · ${old.flight}\n\nВведите фамилию нового пассажира:`);
        return;
    }

    if ( data === "passenger_edit") {
        await showEditMenu( chatId,
            state);

        return;
    }

    if ( data === "passenger_add_another") {
        await startRegistration( chatId);

        return;
    }

    if ( data === "passenger_main_menu") {
        await showMainMenu( chatId,
            messageId);

        return;
    }

    if ( data === "view_passenger_edit") {
        await showEditMenu( chatId,
            state);

        return;
    }


    // EDIT TEXT

    if ( data === "edit_surname" || data === "edit_name" || data === "edit_patronymic" || data ===
        "edit_passport") {
        const fieldMap = {
            edit_surname: "surname",
            edit_name: "name",
            edit_patronymic: "patronymic",
            edit_passport: "passport"
        };

        state.editingField = fieldMap[data];

        const textMap = {
            surname: "Введите новую фамилию:",
            name: "Введите новое имя:",
            patronymic: "Введите новое отчество:",
            passport: "Введите новый номер паспорта:"
        };

        await editMessage( chatId,
            messageId,
            textMap[ state.editingField]);

        return;
    }


    // EDIT BIRTH DATE

    if ( data === "edit_birthDate") {
        state.calendarType = "birth_edit";

        state.calendarPage = 0;

        await showCalendar( chatId,
            state,
            "year");

        return;
    }


    // EDIT FLIGHT DATE

    if ( data === "edit_flightDate") {
        state.calendarType = "flight_edit";

        state.calendarPage = 0;

        await showCalendar( chatId,
            state,
            "year");

        return;
    }


    // EDIT FLIGHT NUMBER

    if ( data === "edit_flight") {
        state.pendingEditRoute = null;
        await showEditFlightMenu(chatId, state);
        return;
    }


    // EDIT CITIZENSHIP

    if ( data === "edit_citizenship") {
        await showEditCitizenship( chatId,
            state);

        return;
    }

    if ( data === "edit_citizenship_TJ" || data === "edit_citizenship_RU") {
        state.data.citizenship = data === "edit_citizenship_TJ"
                ? "TJ"
                : "RU";

        await updatePassenger( state.rowNumber,
            state.data);

        await showEditMenu( chatId,
            state);

        return;
    }

    if ( data === "edit_citizenship_other") {
        state.editingField = "citizenship_other";

        await editMessage( chatId,
            messageId,
            "🌍 Введите гражданство:");

        return;
    }


    // EDIT CONTACT

    if ( data === "edit_contact1") {
        await showEditContact( chatId,
            state,
            1);

        return;
    }

    if ( data === "edit_contact2") {
        await showEditContact( chatId,
            state,
            2);

        return;
    }

    if ( data === "edit_contact1_other" || data === "edit_contact2_other") {
        state.editingField = data === "edit_contact1_other"
                ? "contact1_other"
                : "contact2_other";

        await editMessage( chatId,
            messageId,
            data === "edit_contact1_other"
                ? "🌍 Введите контакт 1:"
                : "🌍 Введите контакт 2:");

        return;
    }


    // EDIT ROUTE

    if ( data === "edit_route") {
        await editMessage( chatId,
            messageId,
            "Выберите новый маршрут:",
            {
                inline_keyboard: [ [ {
                            text: "ДШБ — ХРГ",
                            callback_data: "edit_route_DSHB_XRG"
                        }],
                    [ {
                            text: "ХРГ — ДШБ",
                            callback_data: "edit_route_XRG_DSHB"
                        }],
                    [ {
                            text: "↩️ Назад",
                            callback_data: "edit_back"
                        }]]
            });

        return;
    }

    if ( data === "edit_route_DSHB_XRG" || data === "edit_route_XRG_DSHB") {
        const newRoute = data === "edit_route_DSHB_XRG"
                ? "ДШБ — ХРГ"
                : "ХРГ — ДШБ";

        state.pendingEditRoute = newRoute;
        await showEditFlightMenu(chatId, state, newRoute);
        return;
    }

    if (data.startsWith("edit_select_flight_")) {
        const route = state.pendingEditRoute || state.data.route;
        const flight = data.slice("edit_select_flight_".length);
        const allowed = route === "ДШБ — ХРГ"
            ? ["DW101", "DW103"] : ["DW102", "DW104"];
        if (!allowed.includes(flight) || !state.data.passengerId) return;
        if (!isInactiveStatus(state.data.status)) {
            const occupancy = await calculateRouteOccupancy( state.data.flightDate, route, flight, state.rowNumber
            );
            if (occupancy >= CAPACITY) {
                await editMessage(chatId, messageId,
                    `❌ Рейс ${flight} на дату ${state.data.flightDate} заполнен: ${CAPACITY}/${CAPACITY}.`, {
                        inline_keyboard: [[{ text: "↩️ Назад", callback_data: "edit_back" }]]
                    });
                return;
            }
        }
        state.data.route = route;
        state.data.flight = flight;
        await updatePassenger(state.rowNumber, state.data);
        state.pendingEditRoute = null;
        await showEditMenu(chatId, state);
        return;
    }


    // EDIT STATUS

    if ( data === "edit_status") {
        await editMessage( chatId,
            messageId,
            "Выберите новый статус:",
            {
                inline_keyboard: [ [ {
                            text: "Забронирован",
                            callback_data: "edit_status_booked"
                        }],
                    [ {
                            text: "Подтвержден",
                            callback_data: "edit_status_confirmed"
                        }],
                    [ {
                            text: "Отменен",
                            callback_data: "edit_status_cancelled"
                        }],
                    [ {
                            text: "↩️ Назад",
                            callback_data: "edit_back"
                        }]]
            });

        return;
    }

    if ( data === "edit_status_booked" || data === "edit_status_confirmed") {
        const newStatus = data === "edit_status_booked"
                ? "Забронирован"
                : "Подтвержден";

        /*
         * Если пассажир уже был активным,
         * исключаем его строку.
         *
         * Если пассажир был Отменен,
         * он раньше не занимал место,
         * поэтому строку тоже исключаем —
         * это правильно.
         */
        const occupancy = await calculateRouteOccupancy( state.data.flightDate,
                state.data.route,
                state.data.flight,
                state.rowNumber);

        if ( occupancy >= CAPACITY) {
            await editMessage( chatId,
                messageId,
                `❌ Рейс ${state.data.flight} на дату ${state.data.flightDate} по маршруту ${state.data.route} заполнен: ${CAPACITY}/${CAPACITY}.`,
                {
                    inline_keyboard: [ [ {
                                text: "↩️ Назад",
                                callback_data: "edit_back"
                            }]]
                });

            return;
        }

        state.data.status = newStatus;

        await updatePassenger( state.rowNumber,
            state.data);

        await showEditMenu( chatId,
            state);

        return;
    }

    if ( data === "edit_status_cancelled") {
        state.data.status = "Отменен";

        await updatePassenger( state.rowNumber,
            state.data);

        await showEditMenu( chatId,
            state);

        return;
    }


    // EDIT BACK

    if ( data === "edit_menu_back") {
        await showPassengerCard( chatId,
            state);

        return;
    }

    if ( data === "edit_back") {
        await showEditMenu( chatId,
            state);

        return;
    }
}

module.exports = { handleCallbackQuery };
