// lib/botManager.js - ИСПРАВЛЕННАЯ ВЕРСИЯ С УЛУЧШЕННЫМ ИНТЕРФЕЙСОМ И КОПИРУЕМЫМ ТЕКСТОМ
import { fetch } from 'undici';
import {
  saveBirdSuggestion,
  getPendingSuggestions,
  approveSuggestion,
  rejectSuggestion,
  getSuggestionById,
  getUserSuggestions,
  initializeRedis,
  getBirdsCount,
  getWeeklyBirds
} from './birds.js';
import { normalizeBirdName } from './utils.js';
import {
  saveBotMessage,
  getMessageContext,
  deleteBirdFromChannel,
  getLastChannelMessage,
  saveUserPhoto,
  getPendingPhotoSubmissions,
  getUserPhotoSubmissions,
  approvePhotoSubmission,
  rejectPhotoSubmission,
  getPhotoSubmissionsStats
} from './supabase.js';
import { sendDetailedAdminError } from './telegram.js';

// ====== КОНФИГУРАЦИЯ ======
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN1 || "8581175313:AAFWIjJDnFbbWCyCGsHE0M3U2GfWzSkomWs";
const BOT_USERNAME = process.env.BOT_USERNAME || "PeroZhizniBot";
const ADMIN_ID = (process.env.ADMIN_ID || "923086138").toString();
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL || "@PeroZhizni";

// ====== УТИЛИТЫ ======

/**
 * Проверяет, обращаются ли к боту в сообщении
 * @param {Object} message - Объект сообщения от Telegram
 * @returns {boolean} - true если бот упомянут или это ответ на его сообщение
 */
function isBotMentioned(message) {
  // Проверяем, является ли это ответом на сообщение бота
  if (message.reply_to_message && message.reply_to_message.from && message.reply_to_message.from.is_bot) {
    return true;
  }

  // Проверяем упоминания в тексте
  if (message.text) {
    const mentions = [`@${BOT_USERNAME}`, `@${BOT_USERNAME.toLowerCase()}`];
    if (mentions.some(mention => message.text.includes(mention))) {
      return true;
    }
  }

  // Проверяем entities (упоминания)
  if (message.entities) {
    for (const entity of message.entities) {
      if (entity.type === 'mention' || entity.type === 'text_mention') {
        const mentionText = message.text.substring(entity.offset, entity.offset + entity.length);
        if (mentionText.toLowerCase().includes(BOT_USERNAME.toLowerCase())) {
          return true;
        }
      }
    }
  }

  // Проверяем caption для фото
  if (message.caption) {
    const mentions = [`@${BOT_USERNAME}`, `@${BOT_USERNAME.toLowerCase()}`];
    if (mentions.some(mention => message.caption.includes(mention))) {
      return true;
    }
  }

  return false;
}

function getFormattedTime() {
  const now = new Date();
  return now.toLocaleTimeString('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getFormattedDate(date) {
  if (!date) return '';
  const d = new Date(date);
  return d.toLocaleDateString('ru-RU', {
    timeZone: 'Europe/Moscow'
  });
}

// Функция для создания копируемого текста (inline)
function createCopyableText(text) {
  if (!text) return '';
  return `<code>${escapeHtml(text)}</code>`;
}

// Функция для создания списка копируемых примеров
function createCopyableExamples(examples) {
  if (!Array.isArray(examples) || examples.length === 0) return '';

  return examples.map(example => `<code>${escapeHtml(example)}</code>`).join('\n');
}

// Экранирование HTML
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Функция для создания блока кода (многострочного)
function createCodeBlock(text) {
  if (!text) return '';
  return `<pre><code>${escapeHtml(text)}</code></pre>`;
}

// Функция для создания команды с описанием
function createCommandExample(command, description) {
  return `${createCopyableText(command)} - ${description}`;
}

async function sendTelegramMessage(chatId, text, options = {}) {
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

    const body = {
      chat_id: chatId,
      text: text,
      parse_mode: "HTML",
      disable_web_page_preview: options.disable_web_page_preview !== false,
      ...options
    };

    if (options.reply_markup && options.reply_markup.inline_keyboard) {
      body.reply_markup = options.reply_markup;
    } else if (options.reply_markup) {
      body.reply_markup = options.reply_markup;
    }

    console.log(`📤 Отправка в ${chatId}: ${text.substring(0, 50)}...`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (data.ok) {
      const context = options.context || 'bot_reply';
      const userId = options.userId || null;
      const messageId = data.result.message_id;

      const truncatedText = text.length > 500 ? text.substring(0, 500) + '...' : text;

      await saveBotMessage(chatId, userId, truncatedText, 'bot_reply', context, messageId);

      console.log(`✅ Сообщение сохранено (контекст: ${context})`);
    } else {
      console.error('❌ Ошибка отправки:', data.description);
      await saveBotMessage(chatId, null, `[ERROR] ${data.description}`, 'bot_error', 'send_failed', null);
    }

    return data;

  } catch (error) {
    console.error('❌ Ошибка сети:', error.message);
    await saveBotMessage(chatId, null, `[NETWORK ERROR] ${error.message}`, 'bot_error', 'network_failed', null);
    return { ok: false };
  }
}

async function answerCallbackQuery(callbackQueryId, text = null) {
  try {
    const body = { callback_query_id: callbackQueryId };
    if (text) body.text = text;

    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (error) {
    console.error('❌ Ошибка callback:', error.message);
  }
}

/**
 * Получить URL файла из Telegram
 */
export async function getFileUrl(fileId) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
    const data = await response.json();

    if (data.ok && data.result.file_path) {
      const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${data.result.file_path}`;
      console.log(`✅ Получен URL файла`);
      return fileUrl;
    }

    return null;
  } catch (error) {
    console.error('❌ Ошибка getFileUrl:', error);
    return null;
  }
}

// ====== КЛАВИАТУРЫ ======

function getMainKeyboard(userId) {
  const isAdmin = userId.toString() === ADMIN_ID;

  const keyboard = {
    keyboard: [
      [
        { text: "🦜 Предложить птицу" },
        { text: "📋 Мои предложения" }
      ],
      [
        { text: "📸 Отправить фото" },
        { text: "🖼️ Мои фото" }
      ],
      [
        { text: "📊 Статистика канала" },
        { text: "❓ Помощь" }
      ]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  };

  if (isAdmin) {
    keyboard.keyboard.push([
      { text: "👑 Ожидающие предложения" },
      { text: "🗑️ Удалить последний пост" }
    ]);
    keyboard.keyboard.push([
      { text: "🖼️ Ожидающие фото" }
    ]);
  }

  return keyboard;
}

function getInlineAdminKeyboard(suggestionId) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Одобрить', callback_data: `approve:${suggestionId}` },
        { text: '❌ Отклонить', callback_data: `reject:${suggestionId}` }
      ],
      [
        { text: '📋 Все ожидающие', callback_data: 'pending_list' }
      ]
    ]
  };
}

function getInlineHelpKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '📝 Как предложить птицу', callback_data: 'help_suggest' },
        { text: '📊 Проверить статус', callback_data: 'help_status' }
      ],
      [
        { text: '📈 Статистика канала', callback_data: 'help_stats' },
        { text: '🎯 Воскресные викторины', callback_data: 'help_quiz' }
      ]
    ]
  };
}

function getDeletePostKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '✅ Да, удалить пост', callback_data: 'delete_post_confirm' },
        { text: '❌ Нет, отменить', callback_data: 'delete_post_cancel' }
      ]
    ]
  };
}

// ====== ОСНОВНОЙ ОБРАБОТЧИК ======

export async function handleTelegramUpdate(update) {
  console.log('🔄 Обновление получено');

  try {
    await initializeRedis();

    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
      return;
    }

    const message = update.message || update.edited_message;
    if (!message) {
      console.log('⚠️ Нет сообщения');
      return;
    }

    const chatId = message.chat.id;
    const userId = message.from.id;
    const text = (message.text || '').trim();
    const username = message.from.username || message.from.first_name || `user_${userId}`;

    console.log(`📩 От @${username}: ${text} (время: ${getFormattedTime()})`);

    // Определяем тип чата
    const isChannelMessage = message.chat.type === 'channel' || chatId.toString() === CHANNEL_ID.replace('@', '-100');
    const isGroupMessage = message.chat.type === 'group' || message.chat.type === 'supergroup';
    const isPrivateChat = message.chat.type === 'private';

    // Проверяем, обращаются ли к боту в группе
    const botMentioned = isBotMentioned(message);

    // Проверяем, есть ли фото в сообщении
    if (message.photo && message.photo.length > 0) {
      // В группах обрабатываем фото только если бот упомянут
      if (isGroupMessage && !botMentioned) {
        console.log(`📸 Игнорирую фото в группе без упоминания бота`);
        return;
      }

      // В приватных чатах или когда бот упомянут - обрабатываем
      console.log(`📸 Обрабатываю фото от @${username}`);
      await handlePhotoUpload(chatId, userId, username, message.photo, message.caption);
      return;
    }

    let messageContext = 'user_message';
    let messageType = 'user_message';

    if (text.startsWith('/')) {
      messageContext = 'command';
    } else if (['🦜 Предложить птицу', '📋 Мои предложения', '📊 Статистика канала',
      '❓ Помощь', '👑 Ожидающие предложения', '🗑️ Удалить последний пост',
      '📸 Отправить фото', '🖼️ Мои фото', '🖼️ Ожидающие фото'].includes(text)) {
      messageContext = 'button_click';
      messageType = 'button_press';
    }

    if (text && text.length > 0) {
      await saveBotMessage(chatId, userId, text, messageType, messageContext, message.message_id);
      console.log(`💾 Сообщение сохранено: ${messageContext}`);
    }

    // Фильтруем сообщения в каналах и группах
    if (isChannelMessage || isGroupMessage) {
      // В группах/каналах обрабатываем только:
      // 1. Команды (начинаются с /)
      // 2. Сообщения с упоминанием бота
      // 3. Кнопки интерфейса
      const buttonCommands = ['🦜 Предложить птицу', '📋 Мои предложения', '📊 Статистика канала',
        '❓ Помощь', '👑 Ожидающие предложения', '🗑️ Удалить последний пост',
        '📸 Отправить фото', '🖼️ Мои фото', '🖼️ Ожидающие фото'];

      const isCommand = text.startsWith('/');
      const isButton = buttonCommands.includes(text);

      if (!isCommand && !isButton && !botMentioned) {
        console.log(`📢 Игнорирую сообщение в ${isGroupMessage ? 'группе' : 'канале'} без упоминания: "${text.substring(0, 30)}..."`);
        return;
      }

      if (botMentioned && !isCommand && !isButton) {
        console.log(`🤖 Бот упомянут в группе, обрабатываю сообщение`);
      }
    }

    const lastContext = await getMessageContext(chatId, ['bot_reply', 'user_message', 'button_press'], 5);

    if (text.startsWith('/')) {
      await handleSlashCommand(chatId, userId, username, text, lastContext);
    } else {
      await handleButtonCommand(chatId, userId, username, text, lastContext);
    }

  } catch (error) {
    console.error('❌ Ошибка обработки:', error);

    // Уведомляем администратора о подробностях ошибки
    try {
      const username = update.message?.from?.username || update.callback_query?.from?.username || "Неизвестный";
      await sendDetailedAdminError(error, `Обработка обновления от @${username}`);
    } catch (e) {
      console.error('❌ Не удалось отправить детальную ошибку админу:', e.message);
    }

    try {
      const message = update.message || update.edited_message;
      if (message) {
        await sendTelegramMessage(message.chat.id,
          "❌ <b>Произошла ошибка при обработке</b>\n\n" +
          "Пожалуйста, попробуйте еще раз или свяжитесь с администратором.\n\n" +
          `<i>Ошибка: ${escapeHtml(error.message.substring(0, 100))}</i>`,
          { reply_markup: getMainKeyboard(message.from.id) }
        );
      }
    } catch (sendError) {
      console.error('❌ Не удалось отправить сообщение об ошибке:', sendError);
    }
  }
}

// ====== ОБРАБОТЧИКИ КОМАНД ======

async function handleSlashCommand(chatId, userId, username, text, lastContext = []) {
  const command = text.split(' ')[0].toLowerCase();

  console.log(`🔤 Команда: ${command} от @${username}`);

  const lastBotMessage = lastContext.find(msg => msg.message_type === 'bot_reply');

  switch (command) {
    case '/start':
      await sendTelegramMessage(chatId,
        `👋 <b>Добро пожаловать в бот "Перо Жизни"!</b>\n\n` +
        `Я помогу вам предложить птицу для публикации в канале <a href="https://t.me/PeroZhizni">@PeroZhizni</a>\n\n` +
        `🐦 <b>Каждый день - новая птица!</b>\n` +
        `🎯 <b>Воскресенье - день викторин!</b>\n\n` +

        `<b>Основные команды (копируйте):</b>\n` +
        `${createCodeBlock('/bird Название_птицы\n/mysuggestions\n/stats\n/help')}\n\n` +

        `<b>Примеры названий птиц:</b>\n` +
        `${createCopyableExamples(['Кулик-сорока', 'Ушастая сова', 'Варакушка', 'Обыкновенный поползень'])}\n\n` +

        `🕒 <i>Текущее время: ${getFormattedTime()}</i>`,
        {
          reply_markup: getMainKeyboard(userId),
          context: 'welcome_message',
          userId: userId
        }
      );
      break;

    case '/help':
      await handleHelpCommand(chatId, userId);
      break;

    case '/bird':
      const birdName = text.replace(/^\/bird\s*/i, '').trim();
      if (birdName) {
        await handleBirdSuggestion(chatId, userId, username, birdName, lastContext);
      } else {
        await sendTelegramMessage(chatId,
          "🦜 <b>Предложить птицу</b>\n\n" +
          "Напишите название птицы после команды:\n" +
          `${createCodeBlock('/bird Название_птицы')}\n\n` +

          "<b>✅ Правильные примеры (копируйте):</b>\n" +
          `${createCodeBlock('Кулик-сорока\nУшастая сова\nВаракушка\nОбыкновенный поползень\nСизый голубь\nБольшая синица')}\n\n` +

          "<b>❌ Неправильные примеры:</b>\n" +
          `${createCopyableExamples(['синица', 'воробей', 'попугай'])} - слишком общие\n` +
          `${createCopyableExamples(['птица', 'красная птица'])} - не конкретные\n\n` +

          "Или просто нажмите кнопку \"🦜 Предложить птицу\".",
          {
            reply_markup: getMainKeyboard(userId),
            context: 'suggestion_instruction'
          }
        );
      }
      break;

    case '/mysuggestions':
      await handleMySuggestionsCommand(chatId, userId, lastContext);
      break;

    case '/stats':
      await handleStatsCommand(chatId, lastContext);
      break;

    case '/myphotos':
      await handleMyPhotos(chatId, userId);
      break;

    case '/pending':
      if (userId.toString() === ADMIN_ID) {
        await handlePendingCommand(chatId, userId);
      } else {
        await sendTelegramMessage(chatId,
          "⛔ <b>Недостаточно прав</b>\n\n" +
          "Эта команда доступна только администраторам.\n\n" +
          `<i>Ваши команды: ${createCodeBlock('/bird\n/mysuggestions\n/stats\n/help')}</i>`,
          {
            reply_markup: getMainKeyboard(userId),
            context: 'admin_only'
          }
        );
      }
      break;

    case '/delete':
      if (userId.toString() === ADMIN_ID) {
        await handleDeletePostCommand(chatId, userId);
      } else {
        await sendTelegramMessage(chatId,
          "⛔ <b>Недостаточно прав</b>\n\n" +
          "Эта команда доступна только администраторам.",
          { reply_markup: getMainKeyboard(userId), context: 'admin_only' }
        );
      }
      break;

    default:
      if (lastBotMessage && lastBotMessage.context === 'suggestion_request') {
        await handleBirdSuggestion(chatId, userId, username, text, lastContext);
      } else {
        await sendTelegramMessage(chatId,
          "❓ <b>Неизвестная команда</b>\n\n" +
          `Команда ${createCopyableText(command)} не распознана.\n\n` +

          "<b>Доступные команды (копируйте):</b>\n" +
          `${createCodeBlock('/start\n/bird Название_птицы\n/mysuggestions\n/myphotos\n/stats\n/help')}\n\n` +

          "<b>Примеры использования:</b>\n" +
          `${createCopyableText('/bird Кулик-сорока')} - предложить птицу\n` +
          `${createCopyableText('/mysuggestions')} - проверить свои предложения\n` +
          `${createCopyableText('/myphotos')} - проверить свои фото\n\n` +

          "Или используйте кнопки меню ниже ↓",
          {
            reply_markup: getMainKeyboard(userId),
            context: 'unknown_command'
          }
        );
      }
      break;
  }
}

async function handleButtonCommand(chatId, userId, username, text, lastContext = []) {
  console.log(`🔘 Нажата кнопка: ${text} от @${username}`);

  const lastBotMessage = lastContext.find(msg => msg.message_type === 'bot_reply');
  const contextRequiresResponse = lastBotMessage && (
    lastBotMessage.context === 'suggestion_request' ||
    lastBotMessage.context === 'awaiting_custom_reason'
  );

  switch (text) {
    case '🦜 Предложить птицу':
      await sendTelegramMessage(chatId,
        "🦜 <b>Предложить птицу</b>\n\n" +
        "Отправьте название птицы, которую хотите предложить для публикации.\n\n" +

        "<b>✅ Правильные примеры (копируйте):</b>\n" +
        `${createCodeBlock('Кулик-сорока\nУшастая сова\nВаракушка\nОбыкновенный поползень\nСизый голубь\nБольшая синица\nПолевой воробей')}\n\n` +

        "<b>❌ Неправильные примеры:</b>\n" +
        `${createCopyableExamples(['синица', 'воробей', 'попугай'])} - слишком общие\n` +
        `${createCopyableExamples(['птица', 'красная птица'])} - не конкретные\n` +
        `${createCopyableExamples(['ворона серая'])} - нестандартный порядок слов\n\n` +

        "<b>📝 Правила:</b>\n" +
        "• Используйте правильное русское название вида\n" +
        "• Птица должна быть реальной\n" +
        "• Не предлагайте уже опубликованных птиц\n\n" +

        "<b>Просто отправьте название одним сообщением.</b>\n\n" +
        `🕒 <i>Текущее время: ${getFormattedTime()}</i>`,
        {
          reply_markup: getMainKeyboard(userId),
          context: 'suggestion_request',
          userId: userId
        }
      );
      break;

    case '📋 Мои предложения':
      await handleMySuggestionsCommand(chatId, userId, lastContext);
      break;

    case '📊 Статистика канала':
      await handleStatsCommand(chatId, lastContext);
      break;

    case '❓ Помощь':
      await handleHelpCommand(chatId, userId);
      break;

    case '👑 Ожидающие предложения':
      if (userId.toString() === ADMIN_ID) {
        await handlePendingCommand(chatId, userId);
      } else {
        await sendTelegramMessage(chatId,
          "⛔ <b>Недостаточно прав</b>\n\n" +
          "Эта функция доступна только администраторам.\n\n" +
          `<i>Ваши функции: ${createCodeBlock('🦜 Предложить птицу\n📋 Мои предложения\n📊 Статистика канала\n❓ Помощь')}</i>`,
          {
            reply_markup: getMainKeyboard(userId),
            context: 'admin_button_denied'
          }
        );
      }
      break;

    case '🗑️ Удалить последний пост':
      if (userId.toString() === ADMIN_ID) {
        await handleDeletePostCommand(chatId, userId);
      } else {
        await sendTelegramMessage(chatId,
          "⛔ <b>Недостаточно прав</b>\n\n" +
          "Эта функция доступна только администраторам.",
          {
            reply_markup: getMainKeyboard(userId),
            context: 'admin_button_denied'
          }
        );
      }
      break;

    case '📸 Отправить фото':
      await handlePhotoSubmissionRequest(chatId, userId, username);
      break;

    case '🖼️ Мои фото':
      await handleMyPhotos(chatId, userId);
      break;

    case '🖼️ Ожидающие фото':
      if (userId.toString() === ADMIN_ID) {
        await handlePendingPhotos(chatId);
      } else {
        await sendTelegramMessage(chatId,
          "⛔ <b>Недостаточно прав</b>\n\n" +
          "Эта функция доступна только администраторам.",
          {
            reply_markup: getMainKeyboard(userId),
            context: 'admin_button_denied'
          }
        );
      }
      break;

    default:
      if (contextRequiresResponse) {
        if (lastBotMessage.context === 'suggestion_request') {
          await handleBirdSuggestion(chatId, userId, username, text, lastContext);
        } else if (lastBotMessage.context === 'awaiting_custom_reason') {
          const msgText = lastBotMessage.message_text || '';
          const match = msgText.match(/^awaiting_rejection_reason:(.+)$/);
          if (match && text.trim().length >= 3) {
            const suggestionId = match[1].trim();
            await processRejection(chatId, suggestionId, userId, text.trim());
          } else {
            await sendTelegramMessage(chatId,
              "⚠️ <b>Укажите причину отклонения</b>\n\nМинимум 3 символа. Или нажмите «❌ Отменить отклонение» в предыдущем сообщении.",
              { reply_markup: getMainKeyboard(userId) }
            );
          }
        }
      } else if (text.length > 0) {
        if (text.startsWith('/')) {
          await handleSlashCommand(chatId, userId, username, text, lastContext);
        } else {
          const isPrivateChat = chatId > 0;

          if (isPrivateChat) {
            await sendTelegramMessage(chatId,
              "🤔 <b>Не понял ваше сообщение</b>\n\n" +
              "Используйте кнопки меню или команды:\n\n" +

              `<b>Кнопки (нажмите):</b>\n` +
              `${createCodeBlock('🦜 Предложить птицу\n📋 Мои предложения\n📊 Статистика канала\n❓ Помощь')}\n\n` +

              `<b>Команды (копируйте):</b>\n` +
              `${createCodeBlock('/bird Название_птицы\n/mysuggestions\n/stats\n/help')}\n\n` +

              `🕒 <i>Текущее время: ${getFormattedTime()}</i>`,
              {
                reply_markup: getMainKeyboard(userId),
                context: 'unclear_message'
              }
            );
          }
        }
      }
      break;
  }
}

async function handleCallbackQuery(callbackQuery) {
  const { id, data, message, from } = callbackQuery;

  console.log(`🔘 Кнопка: ${data}, от: ${from.id}`);

  const chatId = message.chat.id;
  const userId = from.id;

  try {
    await answerCallbackQuery(id, 'Обработка...');

    if (data.startsWith('approve:')) {
      const suggestionId = data.replace('approve:', '').trim();
      await handleApproveFromButton(chatId, suggestionId, userId);
    }
    else if (data.startsWith('reject:')) {
      const suggestionId = data.replace('reject:', '').trim();
      await handleRejectFromButton(chatId, suggestionId, userId);
    }
    else if (data.startsWith('quick_reject:')) {
      const parts = data.split(':');
      if (parts.length >= 3) {
        const suggestionId = parts[1];
        const reasonType = parts[2];

        const reasonMap = {
          'already_exists': 'Уже была опубликована ранее',
          'not_a_bird': 'Не является птицей или некорректное название',
          'spam': 'Спам или нерелевантное предложение',
          'duplicate': 'Дубликат существующего предложения',
          'default': 'Не соответствует требованиям канала'
        };

        const reason = reasonMap[reasonType] || 'Не соответствует требованиям канала';
        await processRejection(chatId, suggestionId, userId, reason);
      }
    }
    else if (data.startsWith('custom_reject:')) {
      const suggestionId = data.replace('custom_reject:', '').trim();
      await askForCustomRejectionReason(chatId, suggestionId, userId);
    }
    else if (data === 'pending_list') {
      await handlePendingCommand(chatId, userId);
    }
    else if (data.startsWith('help_')) {
      const helpType = data.replace('help_', '');
      await handleHelpDetail(chatId, helpType);
    }
    else if (data === 'delete_post_confirm') {
      await handleDeletePostConfirm(chatId, userId);
    }
    else if (data === 'delete_post_cancel') {
      await sendTelegramMessage(chatId,
        "❌ <b>Удаление отменено</b>\n\n" +
        "Пост не был удалён.",
        { reply_markup: getMainKeyboard(userId) }
      );
    }
    else if (data.startsWith('approve_photo:')) {
      const photoId = parseInt(data.replace('approve_photo:', '').trim());
      await handlePhotoApproval(chatId, photoId, userId);
    }
    else if (data.startsWith('reject_photo:')) {
      const photoId = parseInt(data.replace('reject_photo:', '').trim());
      await handlePhotoRejection(chatId, photoId, userId);
    }
    else if (data === 'cancel_rejection') {
      await sendTelegramMessage(chatId,
        "❌ <b>Отклонение отменено</b>\n\n" +
        "Операция отклонения отменена.",
        { reply_markup: getMainKeyboard(userId) }
      );
    }

  } catch (error) {
    console.error('❌ Ошибка обработки callback:', error);
    await sendTelegramMessage(chatId,
      `❌ Ошибка обработки: ${escapeHtml(error.message.substring(0, 100))}`,
      { reply_markup: getMainKeyboard(userId) }
    );
  }
}

// ====== ФУНКЦИИ УДАЛЕНИЯ ПОСТА ======

async function handleDeletePostCommand(chatId, userId) {
  try {
    const effectiveUserId = userId || chatId;
    console.log(`🗑️ Админ ${effectiveUserId} запросил удаление поста`);

    const lastBird = await getLastChannelBird();

    if (!lastBird) {
      await sendTelegramMessage(chatId,
        "📭 <b>Нет данных о последнем посте</b>\n\n" +
        "Не удалось найти информацию о последнем посте в канале.",
        { reply_markup: getMainKeyboard(effectiveUserId) }
      );
      return;
    }

    await sendTelegramMessage(chatId,
      `🗑️ <b>Удаление поста</b>\n\n` +
      `<b>Последний пост в канале:</b>\n` +
      `🦜 <b>Птица:</b> ${escapeHtml(lastBird.name)}\n` +
      `📅 <b>Дата:</b> ${getFormattedDate(lastBird.posted_at)}\n` +
      `🕒 <b>Время:</b> ${getFormattedTime()}\n\n` +
      `<b>Внимание!</b> Удаление поста также удалит птицу из истории публикаций.\n\n` +
      `<i>Вы уверены, что хотите удалить этот пост?</i>`,
      {
        reply_markup: getDeletePostKeyboard(),
        context: 'delete_post_confirmation'
      }
    );

  } catch (error) {
    console.error('❌ Ошибка удаления поста:', error);
    await sendTelegramMessage(chatId,
      `❌ <b>Ошибка при обработке запроса</b>\n\n` +
      `${escapeHtml(error.message)}`,
      { reply_markup: getMainKeyboard(effectiveUserId) }
    );
  }
}

async function handleDeletePostConfirm(chatId, userId) {
  try {
    console.log(`🗑️ Подтверждение удаления поста от ${userId}`);

    const result = await deleteBirdFromChannel();

    if (result.success) {
      await sendTelegramMessage(chatId,
        `✅ <b>Пост успешно удалён!</b>\n\n` +
        `Птица <b>"${escapeHtml(result.birdName)}"</b> удалена из канала и истории публикаций.\n\n` +
        `📝 <b>Запись сохранена:</b> ${result.deletedRecord ? '✅ Да' : '❌ Нет'}\n` +
        `📱 <b>Telegram удаление:</b> ${result.telegramDeleted ? '✅ Успешно' : '❌ Не удалось'}\n` +
        `📚 <b>История очищена:</b> ${result.historyDeleted ? '✅ Да' : '❌ Нет'}\n` +
        `🕒 <b>Время удаления:</b> ${getFormattedTime()}\n\n` +
        `<i>Пост больше не отображается в канале.</i>`,
        { reply_markup: getMainKeyboard(userId) }
      );
    } else {
      await sendTelegramMessage(chatId,
        `❌ <b>Ошибка при удалении поста</b>\n\n` +
        `${escapeHtml(result.error || 'Неизвестная ошибка')}\n\n` +
        `<b>Статус архивации:</b> ${result.deletedRecord ? '✅ Записано' : '❌ Не записано'}`,
        { reply_markup: getMainKeyboard(userId) }
      );
    }

  } catch (error) {
    console.error('❌ Ошибка подтверждения удаления:', error);
    await sendTelegramMessage(chatId,
      `❌ <b>Критическая ошибка</b>\n\n` +
      `${escapeHtml(error.message)}\n\n` +
      `<i>Попробуйте удалить вручную через интерфейс Telegram.</i>`,
      { reply_markup: getMainKeyboard(userId) }
    );
  }
}

async function getLastChannelBird() {
  try {
    const lastMessage = await getLastChannelMessage();
    if (!lastMessage || !lastMessage.name) {
      console.log('⚠️ Нет сохраненных сообщений в channel_messages');
      return null;
    }
    if (lastMessage.name === 'undefined') {
      console.log('❌ Ошибка: bird_name is undefined');
      return null;
    }
    console.log(`✅ Получена последняя птица из channel_messages: "${lastMessage.name}"`);
    return {
      name: lastMessage.name,
      posted_at: lastMessage.posted_at || new Date()
    };
  } catch (error) {
    console.error('❌ Ошибка получения последней птицы:', error);
    return null;
  }
}

// ====== ОСНОВНЫЕ ФУНКЦИИ КОМАНД ======

async function handleHelpCommand(chatId, userId) {
  const helpText =
    `🎯 <b>Бот "Перо Жизни"</b>\n\n` +
    `<b>Основные функции:</b>\n` +
    `🦜 ${createCommandExample('Предложить птицу', 'отправить новую птицу для поста')}\n` +
    `📋 ${createCommandExample('Мои предложения', 'посмотреть статус предложений')}\n` +
    `📸 ${createCommandExample('Отправить фото', 'отправить фото птицы для поста')}\n` +
    `🖼️ ${createCommandExample('Мои фото', 'посмотреть статус ваших фото')}\n` +
    `📊 ${createCommandExample('Статистика канала', 'статистика канала и бота')}\n` +
    `❓ ${createCommandExample('Помощь', 'это сообщение')}\n\n` +

    `<b>Команды через / (копируйте):</b>\n` +
    `${createCodeBlock('/bird Название_птицы\n/mysuggestions\n/myphotos\n/stats\n/help')}\n\n` +

    `<b>Как отправить фото:</b>\n` +
    `1. Нажмите "📸 Отправить фото"\n` +
    `2. Отправьте фото с подписью (название птицы)\n` +
    `3. Дождитесь одобрения администратором\n` +
    `4. Ваше фото будет использовано в посте!\n\n` +

    `<b>Примеры правильных названий птиц:</b>\n` +
    `${createCodeBlock('Кулик-сорока\nУшастая сова\nВаракушка\nОбыкновенный поползень\nСизый голубь\nБольшая синица')}\n\n` +

    `<b>❌ Примеры НЕправильных названий:</b>\n` +
    `${createCopyableExamples(['синица', 'воробей', 'попугай'])} - слишком общие\n` +
    `${createCopyableExamples(['птица', 'красная птица'])} - не конкретные\n\n` +

    `<b>О канале:</b>\n` +
    `🐦 Каждый день новая птица в канале <a href="https://t.me/PeroZhizni">@PeroZhizni</a>\n` +
    `🎯 Воскресенье - день викторин!\n` +
    `📸 Вы можете отправлять свои фото птиц!\n` +
    `👥 Присоединяйтесь к нашему сообществу любителей птиц!\n\n` +
    `🕒 <i>Текущее время: ${getFormattedTime()}</i>`;

  await sendTelegramMessage(chatId, helpText, {
    reply_markup: getMainKeyboard(userId),
    disable_web_page_preview: false
  });
}

async function handleHelpDetail(chatId, helpType) {
  let helpText = '';

  switch (helpType) {
    case 'suggest':
      helpText =
        `🦜 <b>Как предложить птицу</b>\n\n` +
        `1. Нажмите кнопку ${createCopyableText('🦜 Предложить птицу')}\n` +
        `2. Отправьте название птицы\n` +
        `3. Ждите проверки администратором\n\n` +

        `<b>✅ Правильные примеры (копируйте):</b>\n` +
        `${createCodeBlock('Кулик-сорока\nУшастая сова\nВаракушка\nОбыкновенный поползень\nСизый голубь')}\n\n` +

        `<b>❌ Неправильные примеры:</b>\n` +
        `${createCopyableExamples(['синица', 'воробей'])} - слишком общие\n` +
        `${createCopyableExamples(['птица', 'красная птица'])} - не конкретные\n\n` +

        `<b>Требования:</b>\n` +
        `✓ Используйте правильное русское название вида\n` +
        `✓ Птица должна быть реальной\n` +
        `✓ Не предлагайте повторно одобренных птиц\n\n` +

        `После одобрения птица будет опубликована в канале!\n\n` +
        `🕒 <i>Текущее время: ${getFormattedTime()}</i>`;
      break;

    case 'status':
      helpText =
        `📋 <b>Проверить статус предложений</b>\n\n` +
        `Нажмите кнопку "📋 Мои предложения" или отправьте команду ${createCopyableText('/mysuggestions')}\n\n` +
        `<b>Статусы предложений:</b>\n` +
        `⏳ <b>Ожидает</b> - на модерации\n` +
        `✅ <b>Одобрено</b> - будет опубликовано\n` +
        `❌ <b>Отклонено</b> - смотрите причину\n\n` +
        `Каждое предложение получает уникальный ID для отслеживания.\n\n` +
        `🕒 <i>Текущее время: ${getFormattedTime()}</i>`;
      break;

    case 'stats':
      helpText =
        `📊 <b>Статистика канала</b>\n\n` +
        `Нажмите кнопку "📊 Статистика канала" или отправьте команду ${createCopyableText('/stats')}\n\n` +
        `<b>Вы увидите:</b>\n` +
        `• Количество птиц в базе\n` +
        `• Птиц за последнюю неделю\n` +
        `• Последние опубликованные птицы\n\n` +
        `Статистика обновляется автоматически.\n\n` +
        `🕒 <i>Текущее время: ${getFormattedTime()}</i>`;
      break;

    case 'quiz':
      helpText =
        `🎯 <b>Воскресные викторины</b>\n\n` +
        `Каждое воскресенье в канале <a href="https://t.me/PeroZhizni">@PeroZhizni</a> проходит викторина!\n\n` +
        `<b>Как участвовать:</b>\n` +
        `1. Подпишитесь на канал\n` +
        `2. В воскресенье появится опрос\n` +
        `3. Выберите правильный вариант\n` +
        `4. Узнайте результат сразу!\n\n` +
        `Викторины основаны на птицах, опубликованных на прошлой неделе.\n\n` +
        `🕒 <i>Текущее время: ${getFormattedTime()}</i>`;
      break;

    default:
      helpText = `Выберите тему помощи из списка выше.\n\n🕒 <i>Текущее время: ${getFormattedTime()}</i>`;
  }

  await sendTelegramMessage(chatId, helpText, {
    reply_markup: getInlineHelpKeyboard(),
    disable_web_page_preview: false
  });
}

async function handleStatsCommand(chatId) {
  try {
    console.log(`📊 Запрос статистики от ${chatId}`);

    const [birdsCount, weeklyBirds] = await Promise.all([
      getBirdsCount(),
      getWeeklyBirds()
    ]);

    const statsMessage =
      `📊 <b>СТАТИСТИКА КАНАЛА "ПЕРО ЖИЗНИ"</b>\n\n` +
      `📈 <b>Общая статистика:</b>\n` +
      `🦜 <b>Всего птиц в базе:</b> ${birdsCount}\n` +
      `📅 <b>Птиц за неделю:</b> ${weeklyBirds.length}\n` +
      `🏆 <b>Активность:</b> Каждый день новая птица!\n\n` +
      `📝 <b>Последние птицы в канале:</b>\n`;

    let birdsList = '';
    weeklyBirds.slice(0, 5).forEach((bird, index) => {
      birdsList += `${index + 1}. ${escapeHtml(bird)}\n`;
    });

    if (weeklyBirds.length > 5) {
      birdsList += `... и ещё ${weeklyBirds.length - 5} птиц\n`;
    }

    const fullMessage = statsMessage + birdsList +
      `\n👥 <b>Присоединяйтесь:</b> <a href="https://t.me/PeroZhizni">@PeroZhizni</a>\n` +
      `📈 <i>Статистика обновляется ежедневно</i>\n\n` +
      `🕒 <i>Текущее время: ${getFormattedTime()}</i>`;

    await sendTelegramMessage(chatId, fullMessage, {
      disable_web_page_preview: false
    });

  } catch (error) {
    console.error('❌ Ошибка статистики:', error);
    await sendTelegramMessage(chatId,
      `❌ <b>Ошибка при получении статистики</b>\n` +
      `${escapeHtml(error.message)}\n\n` +
      `🕒 <i>Текущее время: ${getFormattedTime()}</i>`
    );
  }
}

async function handleBirdSuggestion(chatId, userId, username, birdName) {
  if (!birdName) {
    await sendTelegramMessage(chatId,
      "🦜 <b>Предложить птицу</b>\n\n" +
      "Отправьте название птицы, которую хотите предложить.\n\n" +
      "<b>Примеры названий (кликните, чтобы скопировать):</b>\n" +
      `${createCopyableExamples(['Синяя птица', 'Обыкновенный снегирь', 'Большая синица', 'Полевой воробей', 'Ушастая сова'])}\n\n` +
      `🕒 <i>Текущее время: ${getFormattedTime()}</i>`,
      { reply_markup: getMainKeyboard(userId) }
    );
    return;
  }

  if (birdName.length < 2 || birdName.length > 100) {
    await sendTelegramMessage(chatId,
      "❌ <b>Некорректное название</b>\n\n" +
      "Название птицы должно быть от 2 до 100 символов.\n\n" +

      "<b>✅ Пример правильного названия:</b>\n" +
      `${createCopyableText('Кулик-сорока')}\n\n` +

      "<b>❌ Пример неправильного названия:</b>\n" +
      `${createCopyableText('к')} - слишком короткое\n` +
      `${createCopyableText('Очень-очень-очень длинное название птицы которое превышает лимит символов')} - слишком длинное\n\n` +

      "Пожалуйста, отправьте правильное название.\n\n" +
      `🕒 <i>Текущее время: ${getFormattedTime()}</i>`,
      { reply_markup: getMainKeyboard(userId) }
    );
    return;
  }

  console.log(`🦜 Предложение: "${birdName}" от @${username}`);

  try {
    const result = await saveBirdSuggestion(userId, username, birdName);

    if (!result.success) {
      if (result.error === 'DUPLICATE') {
        await sendTelegramMessage(chatId,
          "⚠️ <b>Такое предложение уже есть</b>\n\n" +
          `Птица <b>"${escapeHtml(birdName)}"</b> уже была предложена вами ранее.\n\n` +

          `<b>Что делать:</b>\n` +
          `• Используйте ${createCopyableText('📋 Мои предложения')} для проверки статуса\n` +
          `• Предложите другую птицу\n` +
          `• Пример: ${createCopyableText('Варакушка')}\n\n` +

          `<i>Каждую птицу можно предложить только один раз</i>\n\n` +
          `🕒 <i>Текущее время: ${getFormattedTime()}</i>`,
          { reply_markup: getMainKeyboard(userId) }
        );
      } else {
        await sendTelegramMessage(chatId,
          "❌ <b>Ошибка при сохранении</b>\n\n" +
          `${escapeHtml(result.error || 'Неизвестная ошибка')}\n\n` +
          `Попробуйте позже или свяжитесь с администратором.\n\n` +
          `🕒 <i>Текущее время: ${getFormattedTime()}</i>`,
          { reply_markup: getMainKeyboard(userId) }
        );
      }
      return;
    }

    await sendTelegramMessage(chatId,
      `✅ <b>Спасибо за предложение!</b>\n\n` +
      `Птица <b>"${escapeHtml(birdName)}"</b> отправлена на модерацию.\n\n` +

      `<b>📋 ID предложения:</b> ${createCopyableText(result.suggestionId)}\n` +
      `<b>⏳ Статус:</b> Ожидает проверки\n\n` +

      `<b>Для отслеживания используйте:</b>\n` +
      `${createCopyableText('📋 Мои предложения')} - кнопка в меню\n` +
      `${createCopyableText('/mysuggestions')} - команда\n\n` +

      `<i>Администратор получил уведомление и скоро проверит ваше предложение.</i>\n\n` +
      `🕒 <i>Текущее время: ${getFormattedTime()}</i>`,
      { reply_markup: getMainKeyboard(userId) }
    );

    await sendTelegramMessage(ADMIN_ID,
      `🦜 <b>НОВОЕ ПРЕДЛОЖЕНИЕ ПТИЦЫ</b>\n\n` +
      `<b>👤 От пользователя:</b> @${username}\n` +
      `<b>🆔 ID пользователя:</b> ${createCopyableText(userId)}\n` +
      `<b>🐦 Название птицы:</b> ${escapeHtml(birdName)}\n` +
      `<b>📋 ID предложения:</b> ${createCopyableText(result.suggestionId)}\n` +
      `<b>⏰ Время:</b> ${getFormattedTime()}\n\n` +
      `<i>Используйте кнопки ниже для быстрого действия</i>`,
      { reply_markup: getInlineAdminKeyboard(result.suggestionId) }
    );

    console.log(`✅ Предложение сохранено: ${result.suggestionId}`);

  } catch (error) {
    console.error('❌ Ошибка предложения:', error);
    await sendTelegramMessage(chatId,
      "❌ <b>Ошибка при обработке предложения</b>\n\n" +
      `${escapeHtml(error.message)}\n\n` +
      `Пожалуйста, попробуйте позже или свяжитесь с администратором.\n\n` +
      `🕒 <i>Текущее время: ${getFormattedTime()}</i>`,
      { reply_markup: getMainKeyboard(userId) }
    );
  }
}

async function handleApproveFromButton(chatId, suggestionId, adminId) {
  console.log(`✅ Одобрение: ${suggestionId}`);

  try {
    const result = await approveSuggestion(suggestionId, adminId);

    if (!result.success) {
      let errorMsg = "Ошибка при одобрении";
      if (result.error === 'NOT_FOUND') errorMsg = "Предложение не найдено";
      if (result.error === 'ALREADY_APPROVED') errorMsg = "Уже одобрено";

      await sendTelegramMessage(chatId,
        `❌ <b>${escapeHtml(errorMsg)}</b>\n\n` +
        `ID: ${createCopyableText(suggestionId)}\n\n` +
        `<i>Проверьте правильность ID или статус предложения.</i>\n\n` +
        `🕒 <i>Текущее время: ${getFormattedTime()}</i>`,
        { reply_markup: getMainKeyboard(adminId) }
      );
      return;
    }

    await sendTelegramMessage(chatId,
      `✅ <b>Предложение одобрено!</b>\n\n` +
      `<b>Птица:</b> ${escapeHtml(result.birdName)}\n` +
      `<b>ID:</b> ${createCopyableText(suggestionId)}\n\n` +
      `🐦 <b>Добавлено в приоритетную очередь!</b>\n` +
      `📅 Будет опубликована в ближайшее время.\n\n` +
      `<i>Птицы из приоритетной очереди публикуются раньше остальных.</i>\n\n` +
      `🕒 <i>Текущее время: ${getFormattedTime()}</i>`,
      { reply_markup: getMainKeyboard(adminId) }
    );

    if (result.suggestion && result.suggestion.user_id !== adminId.toString()) {
      await sendTelegramMessage(result.suggestion.user_id,
        `🎉 <b>Ваше предложение одобрено!</b>\n\n` +
        `Птица <b>"${escapeHtml(result.suggestion.bird_name)}"</b> одобрена администратором.\n\n` +
        `✅ <b>Добавлено в приоритетную очередь публикаций!</b>\n` +
        `📅 Будет опубликована в канале в ближайшее время!\n\n` +
        `Спасибо за участие в развитии канала! 🐦\n\n` +
        `<i>Следите за публикациями в <a href="https://t.me/PeroZhizni">@PeroZhizni</a></i>\n\n` +
        `🕒 <i>Текущее время: ${getFormattedTime()}</i>`,
        {
          reply_markup: getMainKeyboard(result.suggestion.user_id),
          disable_web_page_preview: false
        }
      );
    }

  } catch (error) {
    console.error('❌ Ошибка одобрения:', error);
    await sendTelegramMessage(chatId,
      `❌ <b>Ошибка при одобрении</b>\n\n` +
      `ID: ${createCopyableText(suggestionId)}\n` +
      `Ошибка: ${escapeHtml(error.message)}\n\n` +
      `<i>Попробуйте позже или проверьте вручную.</i>\n\n` +
      `🕒 <i>Текущее время: ${getFormattedTime()}</i>`,
      { reply_markup: getMainKeyboard(adminId) }
    );
  }
}

async function handleRejectFromButton(chatId, suggestionId, adminId) {
  console.log(`❌ Отклонение: ${suggestionId}`);

  try {
    const suggestion = await getSuggestionById(suggestionId);

    if (!suggestion) {
      await sendTelegramMessage(chatId,
        `❌ <b>Предложение не найдено</b>\n\n` +
        `ID: ${createCopyableText(suggestionId)}\n\n` +
        `🕒 <i>Текущее время: ${getFormattedTime()}</i>`,
        { reply_markup: getMainKeyboard(adminId) }
      );
      return;
    }

    const quickReasonsKeyboard = {
      inline_keyboard: [
        [
          { text: '❌ Уже была', callback_data: `quick_reject:${suggestionId}:already_exists` },
          { text: '❌ Не птица', callback_data: `quick_reject:${suggestionId}:not_a_bird` }
        ],
        [
          { text: '❌ Спам', callback_data: `quick_reject:${suggestionId}:spam` },
          { text: '❌ Дубликат', callback_data: `quick_reject:${suggestionId}:duplicate` }
        ],
        [
          { text: '❌ Дефолтная причина', callback_data: `quick_reject:${suggestionId}:default` },
          { text: '📝 Своя причина', callback_data: `custom_reject:${suggestionId}` }
        ]
      ]
    };

    await sendTelegramMessage(chatId,
      `❌ <b>Отклонение предложения</b>\n\n` +
      `Птица: <b>${escapeHtml(suggestion.bird_name)}</b>\n` +
      `От: @${suggestion.username}\n` +
      `ID: ${createCopyableText(suggestionId)}\n\n` +
      `<b>Выберите причину:</b>\n` +
      `• <i>Уже была</i> - птица уже есть в канале\n` +
      `• <i>Не птица</i> - не является птицей\n` +
      `• <i>Спам</i> - нерелевантное предложение\n` +
      `• <i>Дубликат</i> - дубликат существующего\n` +
      `• <i>Дефолтная причина</i> - не соответствует требованиям\n\n` +
      `<i>Или напишите свою причину текстом</i>\n\n` +
      `🕒 <i>Текущее время: ${getFormattedTime()}</i>`,
      {
        reply_markup: quickReasonsKeyboard,
        context: 'rejection_request'
      }
    );

  } catch (error) {
    console.error('❌ Ошибка отклонения:', error);
    await sendTelegramMessage(chatId,
      `❌ <b>Ошибка при отклонении</b>\n\n` +
      `${escapeHtml(error.message)}\n\n` +
      `🕒 <i>Текущее время: ${getFormattedTime()}</i>`,
      { reply_markup: getMainKeyboard(adminId) }
    );
  }
}

async function processRejection(chatId, suggestionId, adminId, reason, birdName = null) {
  try {
    console.log(`❌ Отклонение: ${suggestionId}, причина: ${reason}`);

    const result = await rejectSuggestion(suggestionId, adminId, reason);

    if (result.success) {
      const finalBirdName = birdName || result.birdName || 'Неизвестная птица';

      await sendTelegramMessage(chatId,
        `✅ <b>Предложение отклонено</b>\n\n` +
        `Птица: <b>${escapeHtml(finalBirdName)}</b>\n` +
        `ID: ${createCopyableText(suggestionId)}\n` +
        `Причина: ${escapeHtml(reason)}\n\n` +
        `<i>Пользователь получил уведомление.</i>\n\n` +
        `🕒 <i>Текущее время: ${getFormattedTime()}</i>`,
        { reply_markup: getMainKeyboard(adminId) }
      );

      if (result.suggestion && result.suggestion.user_id !== adminId.toString()) {
        await sendTelegramMessage(result.suggestion.user_id,
          `😔 <b>Ваше предложение отклонено</b>\n\n` +
          `Птица <b>"${escapeHtml(finalBirdName)}"</b> не подошла для публикации.\n\n` +
          `<b>Причина:</b> ${escapeHtml(reason)}\n\n` +
          `<b>Что можно сделать:</b>\n` +
          `• Проверьте правильность названия птицы\n` +
          `• Убедитесь, что птица реально существует\n` +
          `• Попробуйте предложить другую птицу\n\n` +
          `<i>Спасибо за понимание и участие!</i>\n\n` +
          `🕒 <i>Текущее время: ${getFormattedTime()}</i>`,
          { reply_markup: getMainKeyboard(result.suggestion.user_id) }
        );
      }

      console.log(`✅ Предложение отклонено: ${suggestionId}`);

      return { success: true, birdName: finalBirdName };
    } else {
      let errorMessage = result.error || 'Неизвестная ошибка';

      if (result.error === 'NOT_FOUND') {
        errorMessage = 'Предложение не найдено или уже обработано';
      } else if (result.error === 'ALREADY_PROCESSED') {
        errorMessage = 'Предложение уже было обработано ранее';
      }

      await sendTelegramMessage(chatId,
        `❌ <b>Ошибка при отклонении</b>\n\n` +
        `ID: ${createCopyableText(suggestionId)}\n` +
        `Ошибка: ${escapeHtml(errorMessage)}\n\n` +
        `<i>Проверьте, возможно предложение уже было обработано.</i>\n\n` +
        `🕒 <i>Текущее время: ${getFormattedTime()}</i>`,
        { reply_markup: getMainKeyboard(adminId) }
      );

      return { success: false, error: errorMessage };
    }

  } catch (error) {
    console.error('❌ Ошибка обработки отклонения:', error);
    await sendTelegramMessage(chatId,
      `❌ <b>Ошибка при отклонении</b>\n\n` +
      `ID: ${createCopyableText(suggestionId)}\n` +
      `Ошибка: ${escapeHtml(error.message)}\n\n` +
      `<i>Попробуйте позже или проверьте вручную.</i>\n\n` +
      `🕒 <i>Текущее время: ${getFormattedTime()}</i>`,
      { reply_markup: getMainKeyboard(adminId) }
    );

    return { success: false, error: error.message };
  }
}

async function askForCustomRejectionReason(chatId, suggestionId, adminId) {
  try {
    const suggestion = await getSuggestionById(suggestionId);

    if (!suggestion) {
      await sendTelegramMessage(chatId,
        `❌ <b>Предложение не найдено</b>\n\n` +
        `ID: ${createCopyableText(suggestionId)}\n\n` +
        `🕒 <i>Текущее время: ${getFormattedTime()}</i>`,
        { reply_markup: getMainKeyboard(adminId) }
      );
      return;
    }

    await saveBotMessage(chatId, adminId,
      `awaiting_rejection_reason:${suggestionId}`,
      'bot_reply',
      'awaiting_custom_reason',
      null
    );

    const cancelKeyboard = {
      inline_keyboard: [
        [{ text: '❌ Отменить отклонение', callback_data: 'cancel_rejection' }]
      ]
    };

    await sendTelegramMessage(chatId,
      `📝 <b>Укажите причину отклонения</b>\n\n` +
      `Птица: <b>${escapeHtml(suggestion.bird_name)}</b>\n` +
      `От: @${suggestion.username}\n` +
      `ID: ${createCopyableText(suggestionId)}\n\n` +
      `<i>Просто отправьте текст с причиной отклонения.</i>\n\n` +
      `<b>Требования к причине:</b>\n` +
      `• Минимум 3 символа\n` +
      `• Понятное объяснение\n` +
      `• Вежливый тон\n\n` +
      `<i>Или нажмите кнопку ниже для отмена</i>\n\n` +
      `🕒 <i>Текущее время: ${getFormattedTime()}</i>`,
      {
        reply_markup: cancelKeyboard,
        context: 'awaiting_custom_reason'
      }
    );

  } catch (error) {
    console.error('❌ Ошибка запроса причины:', error);
    await sendTelegramMessage(chatId,
      `❌ <b>Ошибка</b>\n\n` + escapeHtml(error.message) + `\n\n` +
      `🕒 <i>Текущее время: ${getFormattedTime()}</i>`,
      { reply_markup: getMainKeyboard(adminId) }
    );
  }
}

async function handleMySuggestionsCommand(chatId, userId) {
  console.log(`📋 Мои предложения для ${userId}`);

  try {
    const suggestions = await getUserSuggestions(userId);

    if (!suggestions || suggestions.length === 0) {
      await sendTelegramMessage(chatId,
        "📭 <b>У вас пока нет предложений</b>\n\n" +
        "Используйте кнопку \"🦜 Предложить птицу\" или команду " + createCopyableText('/bird') + " чтобы предложить птицу.\n\n" +
        "<i>Каждое предложение проходит модерацию перед публикацией.</i>\n\n" +
        `🕒 <i>Текущее время: ${getFormattedTime()}</i>`,
        { reply_markup: getMainKeyboard(userId) }
      );
      return;
    }

    let message = `<b>📋 Ваши предложения (${suggestions.length})</b>\n\n`;

    const pending = suggestions.filter(s => s.status === 'pending');
    const approved = suggestions.filter(s => s.status === 'approved');
    const rejected = suggestions.filter(s => s.status === 'rejected');

    if (pending.length > 0) {
      message += `<b>⏳ Ожидают модерации (${pending.length}):</b>\n`;
      pending.slice(0, 3).forEach((s, i) => {
        const date = getFormattedDate(s.created_at);
        message += `${i + 1}. <b>${escapeHtml(s.bird_name)}</b>\n   ID: ${createCopyableText(s.id)}\n   📅 ${date}\n\n`;
      });
      if (pending.length > 3) message += `... и еще ${pending.length - 3}\n\n`;
    }

    if (approved.length > 0) {
      message += `<b>✅ Одобрены (${approved.length}):</b>\n`;
      approved.slice(0, 3).forEach((s, i) => {
        const date = getFormattedDate(s.created_at);
        message += `${i + 1}. <b>${escapeHtml(s.bird_name)}</b>\n   ID: ${createCopyableText(s.id)}\n   📅 ${date}\n\n`;
      });
      if (approved.length > 3) message += `... и еще ${approved.length - 3}\n\n`;
    }

    if (rejected.length > 0) {
      message += `<b>❌ Отклонены (${rejected.length}):</b>\n`;
      rejected.slice(0, 3).forEach((s, i) => {
        const date = getFormattedDate(s.created_at);
        const reason = s.rejection_reason ? `\n   📝 Причина: ${escapeHtml(s.rejection_reason)}` : '';
        message += `${i + 1}. <b>${escapeHtml(s.bird_name)}</b>\n   ID: ${createCopyableText(s.id)}\n   📅 ${date}${reason}\n\n`;
      });
      if (rejected.length > 3) message += `... и еще ${rejected.length - 3}\n`;
    }

    message += `\n<i>Используйте "🦜 Предложить птицу" для нового предложения</i>\n\n` +
      `🕒 <i>Текущее время: ${getFormattedTime()}</i>`;

    await sendTelegramMessage(chatId, message, { reply_markup: getMainKeyboard(userId) });

  } catch (error) {
    console.error('❌ Ошибка моих предложений:', error);
    await sendTelegramMessage(chatId,
      "❌ <b>Ошибка при загрузке предложений</b>\n\n" +
      `${escapeHtml(error.message)}\n\n` +
      `<i>Попробуйте позже или свяжитесь с администратором.</i>\n\n` +
      `🕒 <i>Текущее время: ${getFormattedTime()}</i>`,
      { reply_markup: getMainKeyboard(userId) }
    );
  }
}

async function handlePendingCommand(chatId, userId) {
  const effectiveUserId = userId || chatId;
  console.log(`👑 Ожидающие предложения для админа ${effectiveUserId}`);

  try {
    const suggestions = await getPendingSuggestions();

    if (suggestions.length === 0) {
      await sendTelegramMessage(chatId,
        "📭 <b>Нет ожидающих предложений</b>\n\n" +
        "Все предложения обработаны! Отличная работа! 🎉\n\n" +
        "<i>Пользователи могут отправлять новые предложения в любое время.</i>\n\n" +
        `🕒 <i>Текущее время: ${getFormattedTime()}</i>`,
        { reply_markup: getMainKeyboard(effectiveUserId) }
      );
      return;
    }

    let message = `<b>⏳ Ожидающие предложения (${suggestions.length})</b>\n\n`;

    suggestions.slice(0, 8).forEach((suggestion, index) => {
      const date = getFormattedDate(suggestion.created_at);
      message += `<b>${index + 1}. ${escapeHtml(suggestion.bird_name)}</b>\n`;
      message += `👤 @${suggestion.username}\n`;
      message += `🆔 ${createCopyableText(suggestion.id)}\n`;
      message += `📅 ${date}\n\n`;
    });

    if (suggestions.length > 8) {
      message += `... и еще ${suggestions.length - 8} предложений\n\n`;
    }

    message += `<i>Для быстрого одобрения используйте кнопки в уведомлениях</i>\n\n` +
      `🕒 <i>Текущее время: ${getFormattedTime()}</i>`;

    await sendTelegramMessage(chatId, message, { reply_markup: getMainKeyboard(effectiveUserId) });

  } catch (error) {
    console.error('❌ Ошибка ожидающих предложений:', error);
    await sendTelegramMessage(chatId,
      "❌ <b>Ошибка при загрузке ожидающих предложений</b>\n\n" +
      `${escapeHtml(error.message)}\n\n` +
      `🕒 <i>Текущее время: ${getFormattedTime()}</i>`,
      { reply_markup: getMainKeyboard(effectiveUserId) }
    );
  }
}

// ====== ФУНКЦИИ ДЛЯ РАБОТЫ С ФОТО ======

/**
 * Обработка запроса на отправку фото
 */
async function handlePhotoSubmissionRequest(chatId, userId, username) {
  console.log(`📸 Пользователь ${username} запросил отправку фото`);

  await sendTelegramMessage(chatId,
    "📸 <b>Отправка фото птицы</b>\n\n" +
    "Отправьте фотографию птицы с подписью, указав название птицы.\n\n" +
    "<b>Формат:</b>\n" +
    "1. Прикрепите фото\n" +
    "2. В подписи напишите название птицы\n\n" +
    "<b>✅ Правильные примеры подписи:</b>\n" +
    `${createCodeBlock('Большая синица\nКулик-сорока\nУшастая сова\nВаракушка')}` + "\n\n" +
    "<b>Требования к фото:</b>\n" +
    "• Реальная фотография (не рисунок)\n" +
    "• Птица хорошо видна\n" +
    "• Хорошее качество\n\n" +
    "<b>После отправки:</b>\n" +
    "• Фото будет проверено администратором\n" +
    "• При одобрении будет использовано в посте\n" +
    "• Вы получите уведомление о статусе\n\n" +
    `🕒 <i>Текущее время: ${getFormattedTime()}</i>`,
    {
      reply_markup: getMainKeyboard(userId),
      context: 'photo_submission_request',
      userId: userId
    }
  );
}

/**
 * Обработка загруженного фото
 */
async function handlePhotoUpload(chatId, userId, username, photos, caption) {
  console.log(`📸 Получено фото от ${username}, подпись: "${caption}"`);

  try {
    // Проверяем наличие подписи
    if (!caption || caption.trim().length === 0) {
      await sendTelegramMessage(chatId,
        "⚠️ <b>Не указано название птицы</b>\n\n" +
        "Пожалуйста, отправьте фото ещё раз с подписью, указав название птицы.\n\n" +
        "<b>Пример:</b>\n" +
        "Прикрепите фото и в подписи напишите:\n" +
        `${createCopyableText('Большая синица')}` + "\n\n" +
        "Или нажмите кнопку \"📸 Отправить фото\" для инструкции.",
        {
          reply_markup: getMainKeyboard(userId),
          context: 'photo_no_caption'
        }
      );
      return;
    }

    const birdName = caption.trim();

    // Проверяем длину названия
    if (birdName.length < 3) {
      await sendTelegramMessage(chatId,
        "⚠️ <b>Слишком короткое название</b>\n\n" +
        "Название птицы должно быть не менее 3 символов.\n\n" +
        `Вы указали: ${createCopyableText(birdName)}`,
        {
          reply_markup: getMainKeyboard(userId),
          context: 'photo_short_name'
        }
      );
      return;
    }

    // Получаем самое большое фото
    const largestPhoto = photos[photos.length - 1];
    const photoFileId = largestPhoto.file_id;

    // Сохраняем фото в базу данных
    const result = await saveUserPhoto(userId, username, birdName, photoFileId);

    if (result.success) {
      await sendTelegramMessage(chatId,
        "✅ <b>Фото успешно отправлено!</b>\n\n" +
        `🦜 <b>Птица:</b> ${escapeHtml(birdName)}\n` +
        `📸 <b>ID фото:</b> ${result.photoId}\n` +
        `👤 <b>От:</b> @${escapeHtml(username)}\n\n` +
        "<b>Статус:</b> ⏳ Ожидает проверки администратором\n\n" +
        "Вы получите уведомление, когда фото будет проверено.\n\n" +
        "Проверить статус: нажмите \"🖼️ Мои фото\"\n\n" +
        `🕒 <i>Время отправки: ${getFormattedTime()}</i>`,
        {
          reply_markup: getMainKeyboard(userId),
          context: 'photo_submitted',
          userId: userId
        }
      );

      // Уведомляем админа
      if (ADMIN_ID) {
        const { sendTelegramPhoto } = await import('./telegram.js');

        // Используем file_id напрямую, так как наша функция sendTelegramPhoto теперь это поддерживает
        const caption =
          "📸 <b>Новое фото от пользователя!</b>\n\n" +
          `🦜 <b>Птица:</b> ${escapeHtml(birdName)}\n` +
          `👤 <b>От:</b> @${escapeHtml(username)} (ID: ${userId})\n` +
          `📸 <b>ID фото:</b> ${result.photoId}\n\n` +
          "Проверьте фото: \"🖼️ Ожидающие фото\"";

        const keyboard = {
          inline_keyboard: [
            [
              { text: '✅ Одобрить', callback_data: `approve_photo:${result.photoId}` },
              { text: '❌ Отклонить', callback_data: `reject_photo:${result.photoId}` }
            ]
          ]
        };

        if (photoFileId) {
          await sendTelegramPhoto(ADMIN_ID, photoFileId, caption, { reply_markup: keyboard });
        } else {
          await sendTelegramMessage(ADMIN_ID, caption, { reply_markup: keyboard });
        }
      }

    } else {
      await sendTelegramMessage(chatId,
        "❌ <b>Ошибка при сохранении фото</b>\n\n" +
        `${escapeHtml(result.error || 'Неизвестная ошибка')}\n\n` +
        "Попробуйте ещё раз или свяжитесь с администратором.",
        {
          reply_markup: getMainKeyboard(userId),
          context: 'photo_save_error'
        }
      );
    }

  } catch (error) {
    console.error('❌ Ошибка обработки фото:', error);
    await sendTelegramMessage(chatId,
      "❌ <b>Произошла ошибка</b>\n\n" +
      "Не удалось обработать фото. Попробуйте ещё раз.",
      {
        reply_markup: getMainKeyboard(userId),
        context: 'photo_error'
      }
    );
  }
}

/**
 * Показать фото пользователя
 */
async function handleMyPhotos(chatId, userId) {
  console.log(`🖼️ Пользователь ${userId} запросил свои фото`);

  try {
    const photos = await getUserPhotoSubmissions(userId);

    if (photos.length === 0) {
      await sendTelegramMessage(chatId,
        "📭 <b>У вас пока нет отправленных фото</b>\n\n" +
        "Отправьте фото птицы, нажав кнопку \"📸 Отправить фото\"\n\n" +
        `🕒 <i>Текущее время: ${getFormattedTime()}</i>`,
        {
          reply_markup: getMainKeyboard(userId),
          context: 'my_photos_empty'
        }
      );
      return;
    }

    const stats = {
      pending: photos.filter(p => p.status === 'pending').length,
      approved: photos.filter(p => p.status === 'approved').length,
      rejected: photos.filter(p => p.status === 'rejected').length,
      used: photos.filter(p => p.used_in_post).length
    };

    let message = `🖼️ <b>Ваши фото (${photos.length})</b>\n\n`;
    message += `⏳ Ожидают: ${stats.pending}\n`;
    message += `✅ Одобрено: ${stats.approved}\n`;
    message += `❌ Отклонено: ${stats.rejected}\n`;
    message += `📰 Использовано в постах: ${stats.used}\n\n`;
    message += `<b>Последние фото:</b>\n\n`;

    photos.slice(0, 10).forEach((photo, index) => {
      const statusEmoji = photo.status === 'pending' ? '⏳' :
        photo.status === 'approved' ? '✅' : '❌';
      const usedMark = photo.used_in_post ? ' 📰' : '';

      message += `${index + 1}. ${statusEmoji} <b>${escapeHtml(photo.bird_name)}</b>${usedMark}\n`;
      message += `   ID: ${photo.id}, ${getFormattedDate(photo.created_at)}\n`;

      if (photo.status === 'rejected' && photo.rejection_reason) {
        message += `   Причина: ${escapeHtml(photo.rejection_reason)}\n`;
      }
      message += '\n';
    });

    if (photos.length > 10) {
      message += `<i>... и ещё ${photos.length - 10} фото</i>\n\n`;
    }

    message += `🕒 <i>Текущее время: ${getFormattedTime()}</i>`;

    await sendTelegramMessage(chatId, message, {
      reply_markup: getMainKeyboard(userId),
      context: 'my_photos_list'
    });

  } catch (error) {
    console.error('❌ Ошибка получения фото пользователя:', error);
    await sendTelegramMessage(chatId,
      "❌ <b>Ошибка</b>\n\n" +
      "Не удалось загрузить список фото.",
      {
        reply_markup: getMainKeyboard(userId),
        context: 'my_photos_error'
      }
    );
  }
}

/**
 * Показать ожидающие фото (для админа)
 */
async function handlePendingPhotos(chatId) {
  console.log(`🖼️ Админ ${chatId} запросил ожидающие фото`);

  try {
    const photos = await getPendingPhotoSubmissions();

    if (photos.length === 0) {
      await sendTelegramMessage(chatId,
        "📭 <b>Нет ожидающих фото</b>\n\n" +
        "Все фото обработаны! 🎉\n\n" +
        `🕒 <i>Текущее время: ${getFormattedTime()}</i>`,
        {
          reply_markup: getMainKeyboard(chatId),
          context: 'pending_photos_empty'
        }
      );
      return;
    }

    let message = `🖼️ <b>Ожидающие фото (${photos.length})</b>\n\n`;

    photos.slice(0, 10).forEach((photo, index) => {
      message += `${index + 1}. <b>${escapeHtml(photo.bird_name)}</b>\n`;
      message += `   👤 От: @${escapeHtml(photo.username)} (ID: ${photo.user_id})\n`;
      message += `   📸 ID фото: ${photo.id}\n`;
      message += `   📅 ${getFormattedDate(photo.created_at)}\n\n`;
    });

    if (photos.length > 10) {
      message += `<i>... и ещё ${photos.length - 10} фото</i>\n\n`;
    }

    message += `🕒 <i>Текущее время: ${getFormattedTime()}</i>`;

    // Добавляем кнопки для первого фото
    const firstPhoto = photos[0];
    const keyboard = {
      inline_keyboard: [
        [
          { text: `✅ Одобрить "${firstPhoto.bird_name}"`, callback_data: `approve_photo:${firstPhoto.id}` },
          { text: `❌ Отклонить`, callback_data: `reject_photo:${firstPhoto.id}` }
        ]
      ]
    };

    // V2: Отправляем ФОТО, а не текст, если это возможно
    const { sendTelegramPhoto } = await import('./telegram.js');

    if (firstPhoto.photo_file_id) {
      await sendTelegramPhoto(chatId, firstPhoto.photo_file_id, message, {
        reply_markup: keyboard
      });
    } else {
      // Fallback если нет file_id
      await sendTelegramMessage(chatId, message, {
        reply_markup: keyboard,
        context: 'pending_photos_list'
      });
    }

  } catch (error) {
    console.error('❌ Ошибка получения ожидающих фото:', error);
    await sendTelegramMessage(chatId,
      "❌ <b>Ошибка</b>\n\n" +
      "Не удалось загрузить список фото.",
      {
        reply_markup: getMainKeyboard(chatId),
        context: 'pending_photos_error'
      }
    );
  }
}

/**
 * Одобрение фото админом
 */
async function handlePhotoApproval(chatId, photoId, adminId) {
  console.log(`✅ Админ ${adminId} одобряет фото ${photoId}`);

  try {
    const result = await approvePhotoSubmission(photoId, adminId);

    if (result.success) {
      const photo = result.photo;

      await sendTelegramMessage(chatId,
        "✅ <b>Фото одобрено!</b>\n\n" +
        `🦜 <b>Птица:</b> ${escapeHtml(photo.bird_name)}\n` +
        `👤 <b>От:</b> @${escapeHtml(photo.username)}\n` +
        `📸 <b>ID:</b> ${photo.id}\n\n` +
        "Фото будет использовано в следующем посте для этой птицы.\n\n" +
        `🕒 <i>Время одобрения: ${getFormattedTime()}</i>`,
        {
          reply_markup: getMainKeyboard(chatId),
          context: 'photo_approved'
        }
      );

      // Уведомляем пользователя
      if (photo.user_id) {
        await sendTelegramMessage(photo.user_id,
          "🎉 <b>Ваше фото одобрено!</b>\n\n" +
          `🦜 <b>Птица:</b> ${escapeHtml(photo.bird_name)}\n` +
          `📸 <b>ID:</b> ${photo.id}\n\n` +
          "Ваше фото будет использовано в посте для этой птицы!\n" +
          "Спасибо за вклад в канал! 🙏\n\n" +
          `🕒 <i>Время одобрения: ${getFormattedTime()}</i>`,
          {
            context: 'photo_approved_notification'
          }
        );
      }

    } else {
      await sendTelegramMessage(chatId,
        "❌ <b>Ошибка одобрения</b>\n\n" +
        `${escapeHtml(result.error || 'Неизвестная ошибка')}`,
        {
          reply_markup: getMainKeyboard(chatId),
          context: 'photo_approval_error'
        }
      );
    }

  } catch (error) {
    console.error('❌ Ошибка одобрения фото:', error);
    await sendTelegramMessage(chatId,
      "❌ <b>Произошла ошибка</b>\n\n" +
      "Не удалось одобрить фото.",
      {
        reply_markup: getMainKeyboard(chatId),
        context: 'photo_approval_exception'
      }
    );
  }
}

/**
 * Отклонение фото админом
 */
async function handlePhotoRejection(chatId, photoId, adminId, reason = 'Не соответствует требованиям') {
  console.log(`❌ Админ ${adminId} отклоняет фото ${photoId}`);

  try {
    const result = await rejectPhotoSubmission(photoId, adminId, reason);

    if (result.success) {
      const photo = result.photo;

      await sendTelegramMessage(chatId,
        "❌ <b>Фото отклонено</b>\n\n" +
        `🦜 <b>Птица:</b> ${escapeHtml(photo.bird_name)}\n` +
        `👤 <b>От:</b> @${escapeHtml(photo.username)}\n` +
        `📸 <b>ID:</b> ${photo.id}\n` +
        `📝 <b>Причина:</b> ${escapeHtml(reason)}\n\n` +
        `🕒 <i>Время отклонения: ${getFormattedTime()}</i>`,
        {
          reply_markup: getMainKeyboard(chatId),
          context: 'photo_rejected'
        }
      );

      // Уведомляем пользователя
      if (photo.user_id) {
        await sendTelegramMessage(photo.user_id,
          "❌ <b>Ваше фото отклонено</b>\n\n" +
          `🦜 <b>Птица:</b> ${escapeHtml(photo.bird_name)}\n` +
          `📸 <b>ID:</b> ${photo.id}\n` +
          `📝 <b>Причина:</b> ${escapeHtml(reason)}\n\n` +
          "Вы можете отправить другое фото.\n\n" +
          `🕒 <i>Время отклонения: ${getFormattedTime()}</i>`,
          {
            context: 'photo_rejected_notification'
          }
        );
      }

    } else {
      await sendTelegramMessage(chatId,
        "❌ <b>Ошибка отклонения</b>\n\n" +
        `${escapeHtml(result.error || 'Неизвестная ошибка')}`,
        {
          reply_markup: getMainKeyboard(chatId),
          context: 'photo_rejection_error'
        }
      );
    }

  } catch (error) {
    console.error('❌ Ошибка отклонения фото:', error);
    await sendTelegramMessage(chatId,
      "❌ <b>Произошла ошибка</b>\n\n" +
      "Не удалось отклонить фото.",
      {
        reply_markup: getMainKeyboard(chatId),
        context: 'photo_rejection_exception'
      }
    );
  }
}

// ====== ЭКСПОРТ ======

export default { handleTelegramUpdate };