import { supabase, uploadImage } from '../lib/supabase.js';

const token = process.env.TELEGRAM_BOT_TOKEN2;
const adminPassword = process.env.ADMIN_PASSWORD || 'secret';
const TELEGRAM_API = `https://api.telegram.org/bot${token}`;

// Нормализация команды: /delete_event@BotName -> /delete_event
function parseCommand(text) {
    if (!text || !text.startsWith('/')) return null;
    return text.split('@')[0].toLowerCase();
}

// Reply-клавиатура для авторизованных
const ADMIN_KEYBOARD = {
    reply_markup: {
        keyboard: [
            [{ text: '📝 Создать событие' }, { text: '🗑 Удалить событие' }]
        ],
        resize_keyboard: true,
        persistent: true
    }
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(200).send('ProvinceBot is running (Webhook mode).');
    }

    try {
        const update = req.body;

        if (update.message) {
            await handleMessage(update.message);
        } else if (update.callback_query) {
            await handleCallbackQuery(update.callback_query);
        }

        return res.status(200).send('OK');
    } catch (err) {
        console.error("Webhook error:", err);
        return res.status(500).send('Internal Server Error');
    }
}

// ─────────────────────────────────────────────
// States
// ─────────────────────────────────────────────
const STATES = {
    START: 'START',
    AWAIT_PASSWORD: 'AWAIT_PASSWORD',
    IDLE_ADMIN: 'IDLE_ADMIN',
    AWAIT_DATE: 'AWAIT_DATE',
    AWAIT_TITLE: 'AWAIT_TITLE',
    AWAIT_DESC: 'AWAIT_DESC',
    AWAIT_PHOTOS: 'AWAIT_PHOTOS',
    AWAIT_SOURCE: 'AWAIT_SOURCE',
    CONFIRMATION: 'CONFIRMATION',
    AWAIT_DELETE_DATE: 'AWAIT_DELETE_DATE',
};

const MAX_ATTEMPTS = 5;

// ─────────────────────────────────────────────
// Smart Date Parser (inline, no extra import)
// ─────────────────────────────────────────────
const MONTH_MAP = {
    'январь': 1, 'январе': 1, 'января': 1, 'янв': 1,
    'февраль': 2, 'феврале': 2, 'февраля': 2, 'фев': 2,
    'март': 3, 'марте': 3, 'марта': 3, 'мар': 3,
    'апрель': 4, 'апреле': 4, 'апреля': 4, 'апр': 4,
    'май': 5, 'маи': 5, 'мая': 5, 'мае': 5,
    'июнь': 6, 'июне': 6, 'июня': 6, 'июн': 6,
    'июль': 7, 'июле': 7, 'июля': 7, 'июл': 7,
    'август': 8, 'августе': 8, 'августа': 8, 'авг': 8,
    'сентябрь': 9, 'сентябре': 9, 'сентября': 9, 'сен': 9, 'сент': 9,
    'октябрь': 10, 'октябре': 10, 'октября': 10, 'окт': 10,
    'ноябрь': 11, 'ноябре': 11, 'ноября': 11, 'ноя': 11,
    'декабрь': 12, 'декабре': 12, 'декабря': 12, 'дек': 12,
};

const MONTH_NAMES_RU = ['', 'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
    'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

const MONTH_NAMES_SHORT = ['', 'янв', 'фев', 'мар', 'апр', 'май', 'июн',
    'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

function parseDate(input) {
    if (!input) return { day: null, month: null, year: null, isValid: false };
    const text = input.trim().toLowerCase();
    let day = null, month = null, year = null;

    // DD.MM.YYYY | DD/MM/YYYY | DD-MM-YYYY | DD.MM | DD/MM | DD-MM
    const sepMatch = text.match(/^(\d{1,2})[.\-\/](\d{1,2})(?:[.\-\/](\d{4}))?$/);
    if (sepMatch) {
        day = parseInt(sepMatch[1]);
        month = parseInt(sepMatch[2]);
        if (sepMatch[3]) year = parseInt(sepMatch[3]);
        return buildDateResult(day, month, year);
    }

    // DD MM YYYY | DD MM
    const numSpaceMatch = text.match(/^(\d{1,2})\s+(\d{1,2})(?:\s+(\d{4}))?$/);
    if (numSpaceMatch) {
        day = parseInt(numSpaceMatch[1]);
        month = parseInt(numSpaceMatch[2]);
        if (numSpaceMatch[3]) year = parseInt(numSpaceMatch[3]);
        return buildDateResult(day, month, year);
    }

    // DD <месяц> YYYY | DD <месяц>
    const dayMonthMatch = text.match(/^(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?$/);
    if (dayMonthMatch) {
        day = parseInt(dayMonthMatch[1]);
        month = MONTH_MAP[dayMonthMatch[2]] || null;
        if (dayMonthMatch[3]) year = parseInt(dayMonthMatch[3]);
        return buildDateResult(day, month, year);
    }

    // <месяц> YYYY | <месяц>
    const monthOnlyMatch = text.match(/^([а-яё]+)(?:\s+(\d{4}))?$/);
    if (monthOnlyMatch) {
        month = MONTH_MAP[monthOnlyMatch[1]] || null;
        if (monthOnlyMatch[2]) year = parseInt(monthOnlyMatch[2]);
        if (month) return buildDateResult(null, month, year);
    }

    // Просто год (4 цифры)
    const yearOnly = text.match(/^(\d{4})$/);
    if (yearOnly) {
        year = parseInt(yearOnly[1]);
        if (year >= 1800 && year <= 2100) return buildDateResult(null, null, year);
    }

    // Просто день (1-2 цифры)
    const dayOnly = text.match(/^(\d{1,2})$/);
    if (dayOnly) {
        day = parseInt(dayOnly[1]);
        if (day >= 1 && day <= 31) return buildDateResult(day, null, null);
    }

    return { day: null, month: null, year: null, isValid: false };
}

function buildDateResult(day, month, year) {
    if (day !== null && (day < 1 || day > 31)) day = null;
    if (month !== null && (month < 1 || month > 12)) month = null;
    if (year !== null && (year < 1800 || year > 2100)) year = null;
    const isValid = day !== null || month !== null || year !== null;
    return { day, month, year, isValid };
}

function describeParsed(parsed) {
    const parts = [];
    if (parsed.day !== null) parts.push(`${parsed.day}`);
    if (parsed.month !== null) parts.push(MONTH_NAMES_RU[parsed.month]);
    if (parsed.year !== null) parts.push(`${parsed.year}`);
    return parts.join(' ') || '?';
}

function applyDateFilter(query, parsed) {
    if (parsed.day !== null) query = query.eq('day', parsed.day);
    if (parsed.month !== null) query = query.eq('month', parsed.month);
    if (parsed.year !== null) query = query.eq('year', parsed.year);
    return query;
}

// ─────────────────────────────────────────────
// Session Management (Supabase)
// ─────────────────────────────────────────────
async function getSession(chatId) {
    const { data, error } = await supabase
        .from('province_sessions')
        .select('*')
        .eq('chat_id', chatId)
        .single();

    if (error && error.code === 'PGRST116') {
        const newSession = {
            chat_id: chatId,
            state: STATES.START,
            data: { photos: [] },
            attempts: 0,
            is_blocked: false,
            is_admin: false
        };
        await saveSession(newSession);
        return newSession;
    }

    if (error) throw error;
    return data;
}

async function saveSession(session) {
    session.updated_at = new Date().toISOString();
    const { error } = await supabase.from('province_sessions').upsert(session);
    if (error) console.error("Error saving session:", error);
}

// ─────────────────────────────────────────────
// Telegram API Helpers
// ─────────────────────────────────────────────
async function sendMessage(chatId, text, options = {}) {
    await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, ...options })
    });
}

async function editMessageReplyMarkup(chatId, messageId, replyMarkup) {
    await fetch(`${TELEGRAM_API}/editMessageReplyMarkup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, message_id: messageId, reply_markup: replyMarkup })
    });
}

async function answerCallbackQuery(callbackQueryId, options = {}) {
    await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackQueryId, ...options })
    });
}

async function getFileLink(fileId) {
    const res = await fetch(`${TELEGRAM_API}/getFile?file_id=${fileId}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.description);
    return `https://api.telegram.org/file/bot${token}/${data.result.file_path}`;
}

// ─────────────────────────────────────────────
// Message Handler
// ─────────────────────────────────────────────
async function handleMessage(msg) {
    if (!msg.chat || !msg.chat.id) return;
    const chatId = msg.chat.id;
    const text = msg.text || '';

    let session = await getSession(chatId);

    if (session.is_blocked) {
        if (text === '/start') await sendMessage(chatId, 'Вы заблокированы за слишком большое количество неверных попыток.');
        return;
    }

    const cmd = parseCommand(text);

    // ── /start ────────────────────────────────
    if (cmd === '/start') {
        if (session.is_admin) {
            session.state = STATES.IDLE_ADMIN;
            await saveSession(session);
            return await sendMessage(chatId, 'Вы уже авторизованы. Используйте кнопки ниже:', ADMIN_KEYBOARD);
        }
        session.state = STATES.AWAIT_PASSWORD;
        await saveSession(session);
        return await sendMessage(chatId, 'Добро пожаловать в ProvinceBot.\nПожалуйста, введите пароль для доступа:');
    }

    // ── /new_event или кнопка ─────────────────
    if (cmd === '/new_event' || text === '📝 Создать событие') {
        if (!session.is_admin) return;
        session.state = STATES.AWAIT_DATE;
        session.data = { photos: [] };
        await saveSession(session);
        return await sendMessage(chatId,
            '📅 Введите дату события.\n\n' +
            'Поддерживаемые форматы:\n' +
            '• <code>15 мая 2026</code>\n' +
            '• <code>15.05.2026</code> или <code>15.05</code>\n' +
            '• <code>15/05/2026</code>\n' +
            '• <code>15-05-2026</code>\n' +
            '• Просто <code>15 мая</code> (без года)\n\n' +
            'Или напишите <b>отмена</b> для отмены.',
            { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } }
        );
    }

    // ── /delete_event или кнопка ──────────────
    if (cmd === '/delete_event' || text === '🗑 Удалить событие') {
        if (!session.is_admin) return;
        session.state = STATES.AWAIT_DELETE_DATE;
        session.data = { photos: [] };
        await saveSession(session);
        return await sendMessage(chatId,
            '🗑 Введите дату события, которое хотите удалить.\n\n' +
            'Поддерживаемые форматы:\n' +
            '• <code>15 мая 2026</code>\n' +
            '• <code>15.05.2026</code> или <code>15.05</code>\n' +
            '• <code>15/05/2026</code>\n' +
            '• <code>15-05</code>\n' +
            '• Просто <code>май 2026</code> (весь месяц)\n' +
            '• Просто <code>2026</code> (весь год)\n\n' +
            'Или напишите <b>отмена</b> для отмены.',
            { parse_mode: 'HTML', reply_markup: { remove_keyboard: true } }
        );
    }

    // ── Отмена ────────────────────────────────
    if (text.toLowerCase() === 'отмена' && session.is_admin) {
        session.state = STATES.IDLE_ADMIN;
        session.data = { photos: [] };
        await saveSession(session);
        return await sendMessage(chatId, 'Действие отменено. Используйте кнопки ниже:', ADMIN_KEYBOARD);
    }

    // ── State machine ─────────────────────────
    switch (session.state) {

        case STATES.AWAIT_PASSWORD:
            if (text === adminPassword) {
                session.is_admin = true;
                session.state = STATES.IDLE_ADMIN;
                session.attempts = 0;
                await saveSession(session);
                await sendMessage(chatId, '✅ Пароль принят. Вы авторизованы!\nИспользуйте кнопки ниже:', ADMIN_KEYBOARD);
            } else {
                session.attempts++;
                if (session.attempts >= MAX_ATTEMPTS) {
                    session.is_blocked = true;
                    await saveSession(session);
                    await sendMessage(chatId, 'Слишком много неверных попыток. Вы заблокированы.');
                } else {
                    await saveSession(session);
                    await sendMessage(chatId, `Неверный пароль. Осталось попыток: ${MAX_ATTEMPTS - session.attempts}`);
                }
            }
            break;

        // ── Создание: дата ────────────────────
        case STATES.AWAIT_DATE: {
            const parsed = parseDate(text);
            if (!parsed.isValid) {
                return await sendMessage(chatId,
                    '❌ Не удалось распознать дату. Попробуйте снова.\n\n' +
                    'Примеры: <code>15 мая 2026</code>, <code>15.05.2026</code>, <code>15/05</code>',
                    { parse_mode: 'HTML' }
                );
            }
            session.data.day = parsed.day;
            session.data.month = parsed.month;
            session.data.year = parsed.year;
            session.state = STATES.AWAIT_TITLE;
            await saveSession(session);
            await sendMessage(chatId,
                `✅ Дата принята: <b>${describeParsed(parsed)}</b>\n\nВведите заголовок события:`,
                { parse_mode: 'HTML' }
            );
            break;
        }

        // ── Создание: заголовок ───────────────
        case STATES.AWAIT_TITLE:
            session.data.title = text;
            session.state = STATES.AWAIT_DESC;
            await saveSession(session);
            await sendMessage(chatId, 'Введите описание (текст) события:');
            break;

        // ── Создание: описание ────────────────
        case STATES.AWAIT_DESC:
            session.data.description = text;
            session.state = STATES.AWAIT_PHOTOS;
            await saveSession(session);
            await sendMessage(chatId,
                'Отправьте фотографии для этого события (можно альбомом).\nКогда отправите все фотографии, нажмите «Готово»',
                {
                    reply_markup: {
                        keyboard: [[{ text: 'Готово' }]],
                        resize_keyboard: true,
                        one_time_keyboard: true
                    }
                }
            );
            break;

        // ── Создание: фото ────────────────────
        case STATES.AWAIT_PHOTOS:
            if (text === 'Готово') {
                session.state = STATES.AWAIT_SOURCE;
                await saveSession(session);
                await sendMessage(chatId, 'Отлично. Введите источник (подпись / автор):', {
                    reply_markup: { remove_keyboard: true }
                });
            } else if (msg.photo) {
                const photo = msg.photo[msg.photo.length - 1];
                session.data.photos.push(photo.file_id);
                await saveSession(session);
            }
            break;

        // ── Создание: источник → предпросмотр ──
        case STATES.AWAIT_SOURCE: {
            session.data.source = text;
            session.state = STATES.CONFIRMATION;
            await saveSession(session);

            const d = session.data;
            let previewText = `📢 <b>ПРЕДПРОСМОТР СОБЫТИЯ</b>\n\n`;
            previewText += `<b>Дата:</b> ${describeParsed({ day: d.day, month: d.month, year: d.year, isValid: true })}\n`;
            previewText += `<b>Заголовок:</b> ${d.title}\n`;
            previewText += `<b>Описание:</b> ${d.description}\n`;
            previewText += `<b>Источник:</b> ${d.source}\n`;
            previewText += `<b>Фотографий:</b> ${d.photos.length}\n\n`;
            previewText += `Опубликовать в базу данных?`;

            await sendMessage(chatId, previewText, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ Да, сохранить', callback_data: 'confirm_event' }],
                        [{ text: '❌ Отменить', callback_data: 'cancel_event' }],
                    ]
                }
            });
            break;
        }

        // ── Удаление: ввод даты ───────────────
        case STATES.AWAIT_DELETE_DATE: {
            const parsed = parseDate(text);
            if (!parsed.isValid) {
                return await sendMessage(chatId,
                    '❌ Не удалось распознать дату. Попробуйте снова.\n\n' +
                    'Примеры: <code>15 мая 2026</code>, <code>15.05</code>, <code>май 2026</code>, <code>2026</code>',
                    { parse_mode: 'HTML' }
                );
            }

            const desc = describeParsed(parsed);
            await sendMessage(chatId, `🔍 Ищу события: <b>${desc}</b>...`, { parse_mode: 'HTML' });

            try {
                let query = supabase
                    .from('history_events')
                    .select('id, day, month, year, title')
                    .order('year', { ascending: false })
                    .order('month', { ascending: false })
                    .order('day', { ascending: false });

                query = applyDateFilter(query, parsed);

                const { data: events, error } = await query.limit(20);
                if (error) throw error;

                session.state = STATES.IDLE_ADMIN;
                await saveSession(session);

                if (!events || events.length === 0) {
                    return await sendMessage(chatId,
                        `😔 Событий по запросу «<b>${desc}</b>» не найдено.\n\nПопробуйте другой формат или дату.`,
                        { ...ADMIN_KEYBOARD, parse_mode: 'HTML' }
                    );
                }

                await sendMessage(chatId,
                    `Найдено событий: <b>${events.length}</b>\nВыберите, какое удалить:`,
                    { ...ADMIN_KEYBOARD, parse_mode: 'HTML' }
                );

                for (const event of events) {
                    const monthName = event.month ? MONTH_NAMES_SHORT[event.month] : '?';
                    const dateStr = [event.day || '?', monthName, event.year || '?'].join(' ');
                    const eventText = `📌 <b>${event.title || '(без заголовка)'}</b>\n📅 ${dateStr}`;

                    await sendMessage(chatId, eventText, {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '🗑 Удалить', callback_data: `del:${event.id}` }
                            ]]
                        }
                    });
                }

            } catch (err) {
                console.error('Ошибка поиска событий:', err);
                session.state = STATES.IDLE_ADMIN;
                await saveSession(session);
                await sendMessage(chatId, '❌ Ошибка при поиске: ' + err.message);
            }
            break;
        }
    }
}

// ─────────────────────────────────────────────
// Callback Query Handler
// ─────────────────────────────────────────────
async function handleCallbackQuery(query) {
    if (!query.message) return;
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    let session = await getSession(chatId);

    // ── Отмена создания ───────────────────────
    if (data === 'cancel_event') {
        session.state = STATES.IDLE_ADMIN;
        session.data = { photos: [] };
        await saveSession(session);
        await answerCallbackQuery(query.id, { text: 'Отменено' });
        await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
        await sendMessage(chatId, 'Событие отменено. Для создания нового используйте /new_event');
        return;
    }

    // ── Подтверждение создания ────────────────
    if (data === 'confirm_event') {
        if (session.state !== STATES.CONFIRMATION) {
            return await answerCallbackQuery(query.id, { text: 'Это действие уже недоступно.', show_alert: true });
        }
        await answerCallbackQuery(query.id, { text: 'Сохраняем...' });
        await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
        await sendMessage(chatId, '⏳ Сохраняем фотографии и данные...');

        try {
            const imageUrls = [];
            for (let i = 0; i < session.data.photos.length; i++) {
                const fileId = session.data.photos[i];
                const fileLink = await getFileLink(fileId);
                const response = await fetch(fileLink);
                const arrayBuffer = await response.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                const filename = `event_${Date.now()}_${i}.jpg`;
                const url = await uploadImage(buffer, filename, 'image/jpeg');
                imageUrls.push(url);
            }

            const { error } = await supabase
                .from('history_events')
                .insert({
                    month: session.data.month,
                    day: session.data.day,
                    year: session.data.year,
                    title: session.data.title,
                    description: session.data.description,
                    image_urls: imageUrls,
                    image_source: session.data.source
                });

            if (error) throw error;

            session.state = STATES.IDLE_ADMIN;
            session.data = { photos: [] };
            await saveSession(session);
            await sendMessage(chatId, '✅ Событие успешно сохранено!');

        } catch (err) {
            console.error(err);
            await sendMessage(chatId, '❌ Ошибка при сохранении: ' + err.message);
        }
        return;
    }

    // ── Удаление конкретного события ──────────
    if (data.startsWith('del:')) {
        const eventId = data.split(':')[1];
        if (!eventId) return await answerCallbackQuery(query.id, { text: 'Ошибка: нет ID.' });

        try {
            const { error } = await supabase
                .from('history_events')
                .delete()
                .eq('id', eventId);

            if (error) throw error;

            await answerCallbackQuery(query.id, { text: '✅ Удалено!' });
            await editMessageReplyMarkup(chatId, messageId, {
                inline_keyboard: [[{ text: '✅ Удалено', callback_data: 'noop' }]]
            });

        } catch (err) {
            console.error('Ошибка удаления:', err);
            await answerCallbackQuery(query.id, { text: '❌ Ошибка: ' + err.message, show_alert: true });
        }
        return;
    }

    // noop
    await answerCallbackQuery(query.id);
}
