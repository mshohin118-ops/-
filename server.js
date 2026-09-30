const express = require("express");
const app = express();
app.use(express.json());
const { TELEGRAM_WEBHOOK_SECRET, allowedTelegramUserIds, PUBLIC_URL, TELEGRAM_BOT_TOKEN, GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY, SPREADSHEET_ID, PORT } = require('./config');
const { sendMessage, telegramRequest } = require('./telegram');
const { auditContext } = require('./sheets');
const { handleExcelDocument } = require('./excel');
const { handleTextMessage } = require('./messages');
const { handleCallbackQuery } = require('./callbacks');

app.post( "/telegram/webhook",
    async (req, res) => {
        console.log( "📡 Telegram отправил update");

        const incomingSecret = req.headers[ "x-telegram-bot-api-secret-token"];

        if ( !TELEGRAM_WEBHOOK_SECRET || incomingSecret !== TELEGRAM_WEBHOOK_SECRET) {
            console.warn( "🚫 Неверный webhook secret");

            return res.sendStatus(403);
        }

        const update = req.body;

        res.sendStatus(200);

        try {
            const message = update.message;
            const callback = update.callback_query;
            const actor = message?.from || callback?.from;
            const chat = message?.chat || callback?.message?.chat;
            const userId = actor?.id == null ? "" : String(actor.id);

            // Команда /id доступна в личном чате даже до выдачи доступа.
            if ( message?.text && /^\/id(?:@\w+)?(?:\s|$)/i.test(message.text) && chat?.type === "private" &&
                userId && String(chat.id) === userId) {
                await sendMessage(chat.id,
                    `Ваш Telegram ID: ${userId}\nПередайте его администратору для добавления в список сотрудников.`);
                return;
            }

            // Не обрабатываем пассажирские данные из групп и от чужих ID.
            if ( !userId || !chat || chat.type !== "private" || String(chat.id) !== userId || !allowedTelegramUserIds.has(userId)
            ) {
                if (callback) {
                    await telegramRequest("answerCallbackQuery", {
                        callback_query_id: callback.id,
                        text: "Доступ закрыт. Напишите боту /id и передайте ID администратору.",
                        show_alert: true
                    });
                } else if (message && chat?.type === "private" && userId) {
                    await sendMessage(chat.id,
                        "Доступ только для сотрудников. Напишите /id и передайте свой Telegram ID администратору.");
                }
                return;
            }

            await auditContext.run({ userId }, async () => {
            // DOCUMENT / EXCEL

            if ( update.message && update.message.document) {
                await handleExcelDocument( update.message);
            }

            // TEXT

            else if ( update.message) {
                await handleTextMessage( update.message);
            }

            // CALLBACK

            if ( update.callback_query) {
                await handleCallbackQuery( update.callback_query);
            }
            });
        } catch (error) {
            console.error( "❌ Ошибка обработки update:",
                error);
        }
    });

app.get( "/",
    (req, res) => {
        res.send( "KMRN Passenger Bot работает.");
    });

async function setupWebhook() {
    if (!TELEGRAM_WEBHOOK_SECRET) {
        console.error( "❌ TELEGRAM_WEBHOOK_SECRET не установлен!");

        return;
    }

    if (!PUBLIC_URL) {
        console.error( "❌ PUBLIC_URL не установлен!");

        return;
    }

    try {
        const result = await telegramRequest( "setWebhook",
                {
                    url: `${PUBLIC_URL}/telegram/webhook`,

                    secret_token: TELEGRAM_WEBHOOK_SECRET,

                    allowed_updates: [ "message",
                        "callback_query"]
                });

        if (result.ok) {
            console.log( "🔐 Telegram Webhook успешно установлен");
        } else {
            console.error( "❌ Ошибка установки Webhook:",
                result.description);
        }
    } catch (error) {
        console.error( "❌ Ошибка установки Webhook:",
            error.message);
    }
}

console.log( "==============================");

console.log( "🔍 Проверка переменных:");

console.log( "TELEGRAM_BOT_TOKEN:",
    TELEGRAM_BOT_TOKEN
        ? "OK"
        : "НЕТ");

console.log( "GOOGLE_CLIENT_EMAIL:",
    GOOGLE_CLIENT_EMAIL
        ? "OK"
        : "НЕТ");

console.log( "GOOGLE_PRIVATE_KEY:",
    GOOGLE_PRIVATE_KEY
        ? "OK"
        : "НЕТ");

console.log( "GOOGLE_SHEET_ID:",
    SPREADSHEET_ID
        ? "OK"
        : "НЕТ");

console.log( "TELEGRAM_WEBHOOK_SECRET:",
    TELEGRAM_WEBHOOK_SECRET
        ? "OK"
        : "НЕТ");

console.log( "PUBLIC_URL:",
    PUBLIC_URL
        ? "OK"
        : "НЕТ");

console.log( "==============================");

app.listen( PORT,
    async () => {
        console.log( `🚀 KMRN Passenger Bot запущен на порту ${PORT}`);

        await setupWebhook();
    });