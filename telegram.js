const { TELEGRAM_BOT_TOKEN } = require('./config');

async function telegramRequest(method, body = {}) {
    if (!TELEGRAM_BOT_TOKEN) {
        throw new Error( "TELEGRAM_BOT_TOKEN не установлен");
    }

    const response = await fetch( `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        });

    const result = await response.json();

    if (!result.ok) {
        console.error( `❌ Telegram ${method}:`,
            result);
    }

    return result;
}

async function sendMessage( chatId,
    text,
    replyMarkup = null) {
    const body = {
        chat_id: chatId,
        text
    };

    if (replyMarkup) {
        body.reply_markup = replyMarkup;
    }

    return telegramRequest( "sendMessage",
        body);
}

async function editMessage( chatId,
    messageId,
    text,
    replyMarkup = null) {
    const body = {
        chat_id: chatId,
        message_id: messageId,
        text,
        reply_markup: replyMarkup || {
                inline_keyboard: []
            }
    };

    return telegramRequest( "editMessageText",
        body);
}

async function answerCallbackQuery( callbackQueryId,
    text = "") {
    return telegramRequest( "answerCallbackQuery",
        {
            callback_query_id: callbackQueryId,
            text
        });
}

async function deleteUserMessage( chatId,
    messageId) {
    if (!messageId) return;

    try {
        const result = await telegramRequest( "deleteMessage",
                {
                    chat_id: chatId,
                    message_id: messageId
                });

        if (!result.ok) {
            console.warn( "⚠️ Не удалось удалить сообщение:",
                result.description);
        }
    } catch (error) {
        console.warn( "⚠️ Ошибка удаления сообщения:",
            error.message);
    }
}

module.exports = { telegramRequest, sendMessage, editMessage, answerCallbackQuery, deleteUserMessage };
