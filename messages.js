const { getAllPassengers, isInactiveStatus, getSheets, getSheetTitle, updatePassenger, calculateRouteOccupancy } = require('./sheets');
const { editMessage, sendMessage, deleteUserMessage } = require('./telegram');
const { rowToPassenger, normalizeText, states, getState, normalizePassport, normalizeFlight, validateTajikPhone } = require('./helpers');
const { SPREADSHEET_ID, CAPACITY } = require('./config');
const { getMainMenuKeyboard, showContact1Menu, showContactMenu, showEditMenu, getPassengerObjects, getPassengerListText, getPassengerListKeyboard, showPassengersFiltered, showFlightNumberMenu, askRegistrationStep, getContact1Keyboard } = require('./menus');

async function finishStatusWithComment(chatId, state, comment) {
    const pending = state.pendingStatusComment;
    if (!pending) return;
    const rows = await getAllPassengers();
    const row = rows[pending.rowNumber - 1];
    if (!row || row[0] !== pending.passengerId) {
        state.pendingStatusComment = null;
        await editMessage(chatId, state.messageId,
            "❌ Запись изменилась. Найдите пассажира заново.");
        return;
    }
    const passenger = rowToPassenger(row, pending.rowNumber);
    if (isInactiveStatus(passenger.status)) {
        state.pendingStatusComment = null;
        await editMessage(chatId, state.messageId,
            `Статус пассажира уже изменён: ${passenger.status}.`);
        return;
    }
    passenger.status = pending.status;
    passenger.comment = comment;
    const sheets = await getSheets();
    const sheetTitle = await getSheetTitle();
    const header = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetTitle}!P1`
    });
    if (!header.data.values?.[0]?.[0]) {
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheetTitle}!P1`,
            valueInputOption: "RAW",
            requestBody: { values: [["Комментарий"]] }
        });
    }
    await updatePassenger(passenger.rowNumber, passenger);
    state.data = passenger;
    state.pendingStatusComment = null;
    const extraButtons = pending.status === "Не явился"
        ? [[{ text: "➕ Добавить пассажира на это место", callback_data: "no_show_replace" }]]
        : [];
    await editMessage(chatId, state.messageId,
        `✅ Статус: ${pending.status}.` + (comment ? `\nКомментарий: ${comment}` : "") +
        "\nМесто на рейсе освобождено.", {
            inline_keyboard: [ ...extraButtons,
                [{ text: "🏠 Главное меню", callback_data: "passenger_main_menu" }]]
        });
}

async function handleTextMessage( message) {
    const chatId = message.chat.id;

    const text = normalizeText( message.text);

    if (!text) {
        return;
    }

    if (text === "/start") {
        states.delete(chatId);

        const result = await sendMessage( chatId,
                "🏠 Главное меню",
                getMainMenuKeyboard());

        if (result.ok) {
            console.log( "✅ Главное меню отправлено");
        }

        return;
    }

    const state = getState(chatId);

    await deleteUserMessage( chatId,
        message.message_id);

    if (state.pendingStatusComment) {
        if (text.length > 500) {
            await editMessage(chatId, state.messageId,
                "Комментарий слишком длинный (максимум 500 символов). Напишите короче или нажмите «Без комментария».", {
                    inline_keyboard: [[{ text: "Без комментария", callback_data: "status_comment_skip" }]]
                });
            return;
        }
        await finishStatusWithComment(chatId, state, text);
        return;
    }


    // REGISTRATION OTHER CITIZENSHIP

    if ( state.editingField === "registration_citizenship_other") {
        state.data.citizenship = text;

        state.editingField = null;
        state.step = 6;

        await showContact1Menu( chatId,
            state);

        return;
    }


    // REGISTRATION CONTACT 1 OTHER

    if ( state.editingField === "registration_contact1_other") {
        state.data.contact1 = text;

        state.editingField = null;

        await showContactMenu( chatId,
            state);

        return;
    }


    // REGISTRATION CONTACT 2 OTHER

    if ( state.editingField === "registration_contact2_other") {
        state.data.contact2 = text;

        state.editingField = null;

        await showContactMenu( chatId,
            state);

        return;
    }


    // EDIT CITIZENSHIP OTHER

    if ( state.editingField === "citizenship_other") {
        state.data.citizenship = text;

        await updatePassenger( state.rowNumber,
            state.data);

        state.editingField = null;

        await showEditMenu( chatId,
            state);

        return;
    }


    // EDIT CONTACT

    if ( state.editingField === "contact1_other") {
        state.data.contact1 = text;

        await updatePassenger( state.rowNumber,
            state.data);

        state.editingField = null;

        await showEditMenu( chatId,
            state);

        return;
    }

    if ( state.editingField === "contact2_other") {
        state.data.contact2 = text;

        await updatePassenger( state.rowNumber,
            state.data);

        state.editingField = null;

        await showEditMenu( chatId,
            state);

        return;
    }


    // SEARCH PASSPORT

    if ( state.viewMode === "passport_search") {
        const passengers = await getPassengerObjects();

        const searchPassport = normalizePassport(text);

        const found = passengers.filter( passenger =>
                    normalizePassport( passenger.passport) === searchPassport);

        if (!found.length) {
            await editMessage( chatId,
                state.messageId,
                "❌ Пассажир с таким номером паспорта не найден.",
                {
                    inline_keyboard: [ [ {
                                text: "↩️ Назад",
                                callback_data: "view_data_menu"
                            }]]
                });

            return;
        }

        state.viewMode = "search_result";

        state.viewPassengers = found;

        state.viewPage = 0;

        await editMessage( chatId,
            state.messageId,
            getPassengerListText( found,
                0,
                "🔎 Результат поиска"),
            getPassengerListKeyboard( found,
                0,
                "search"));

        return;
    }


    // SEARCH ID

    if ( state.viewMode === "id_search") {
        const passengers = await getPassengerObjects();

        const found = passengers.filter( passenger =>
                    String( passenger.passengerId).toLowerCase() === text.toLowerCase());

        if (!found.length) {
            await editMessage( chatId,
                state.messageId,
                "❌ Пассажир с таким ID не найден.",
                {
                    inline_keyboard: [ [ {
                                text: "↩️ Назад",
                                callback_data: "view_data_menu"
                            }]]
                });

            return;
        }

        state.viewMode = "search_result";

        state.viewPassengers = found;

        state.viewPage = 0;

        await editMessage( chatId,
            state.messageId,
            getPassengerListText( found,
                0,
                "🆔 Результат поиска"),
            getPassengerListKeyboard( found,
                0,
                "search"));

        return;
    }


    // PASSENGERS BY FLIGHT

    if ( state.viewMode === "flight_filter_number") {
        const flight = normalizeFlight(text);

        if (!flight) {
            await editMessage( chatId,
                state.messageId,
                "❌ Введите номер рейса.");

            return;
        }

        const passengers = await getPassengerObjects();

        const filtered = passengers.filter( passenger =>
                    passenger.flightDate === state.viewDate && passenger.route === state.viewRoute &&
                    normalizeFlight( passenger.flight) === flight);

        state.viewFlight = flight;

        state.viewMode = "flight_result";

        await showPassengersFiltered( chatId,
            state,
            filtered,
            `✈️ Рейс ${flight}\n📅 ${state.viewDate}\n🛫 ${state.viewRoute}`,
            "flight");

        return;
    }


    // FLIGHT NUMBER REGISTRATION

    if ( state.step === 9) {
        await showFlightNumberMenu(chatId, state);
        return;
    }


    // EDIT FLIGHT

    if ( state.editingField === "flight") {
        const newFlight = normalizeFlight(text);

        if (!newFlight) {
            await editMessage( chatId,
                state.messageId,
                "❌ Номер рейса не может быть пустым.\n\nВведите номер рейса:");

            return;
        }

        if ( state.data.status !== "Отменен") {
            const occupancy = await calculateRouteOccupancy( state.data.flightDate,
                    state.data.route,
                    newFlight,
                    state.rowNumber);

            if ( occupancy >= CAPACITY) {
                await editMessage( chatId,
                    state.messageId,
                    `❌ Рейс ${newFlight} на дату ${state.data.flightDate} по маршруту ${state.data.route} заполнен: ${CAPACITY}/${CAPACITY}.`,
                    {
                        inline_keyboard: [ [ {
                                    text: "↩️ Назад",
                                    callback_data: "edit_back"
                                }]]
                    });

                return;
            }
        }

        state.data.flight = newFlight;

        await updatePassenger( state.rowNumber,
            state.data);

        state.editingField = null;

        await showEditMenu( chatId,
            state);

        return;
    }


    // EDIT TEXT

    if ( [ "surname",
            "name",
            "patronymic",
            "passport"].includes( state.editingField)) {
        state.data[ state.editingField] = text;

        await updatePassenger( state.rowNumber,
            state.data);

        state.editingField = null;

        await showEditMenu( chatId,
            state);

        return;
    }


    // REGISTRATION

    if (state.step === 0) {
        state.data.surname = text;

        state.step = 1;

        await askRegistrationStep( chatId,
            state);

        return;
    }

    if (state.step === 1) {
        state.data.name = text;

        state.step = 2;

        await askRegistrationStep( chatId,
            state);

        return;
    }

    if (state.step === 2) {
        state.data.patronymic = text;

        state.step = 3;

        await askRegistrationStep( chatId,
            state);

        return;
    }

    if (state.step === 4) {
        state.data.passport = text;

        state.step = 5;

        await askRegistrationStep( chatId,
            state);

        return;
    }

    if (state.step === 6) {
        const phone = validateTajikPhone( text);

        if (!phone) {
            await editMessage( chatId,
                state.messageId,
                "❌ Неверный номер.\n\nВведите номер Таджикистана в формате 900000000 или +992900000000:",
                getContact1Keyboard());

            return;
        }

        state.data.contact1 = phone;

        await showContactMenu( chatId,
            state);

        return;
    }
}

module.exports = { finishStatusWithComment, handleTextMessage };
