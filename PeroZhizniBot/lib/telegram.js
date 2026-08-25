import undici from 'undici';
import { Blob } from 'buffer';
import { getWeeklyBirds, generateQuiz } from "./birds.js";
import { fetchWithRetry } from "./utils.js";
import * as imageSearch from './imageSearch.js';
import { processImageToWebP } from './imageProcessor.js';
import { Sentry } from './sentry.js';

const { fetch, FormData } = undici;

// ============= КОНФИГУРАЦИЯ =============
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN1 || "8581175313:AAFWIjJDnFbbWCyCGsHE0M3U2GfWzSkomWs";
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL || "@PeroZhizni";

console.log(' [TELEGRAM] Модуль загружен');
console.log(` [TELEGRAM] Канал: ${CHANNEL_ID}`);
console.log('📨 [TELEGRAM] Модуль загружен');
console.log(`📢 [TELEGRAM] Канал: ${CHANNEL_ID}`);

// ============= УТИЛИТЫ =============

function getFormattedTime() {
  const now = new Date();
  const moscowTime = new Date(now.getTime());
  return moscowTime.toLocaleTimeString('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit'
  });
}

function escapeHtml(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildCaption(name, description, facts) {
  console.log(`📝 Создаю подпись для: ${name}`);

  const MAX_LEN = 1024; // Ограничение Telegram для фото
  const rawTag = name.replace(/[^a-zA-Zа-яёА-ЯЁ0-9]+/g, "");
  const hashtagLine = `\n#${escapeHtml(rawTag)} #птицы #природа #ПероЖизни`;

  let header = `👉🏻 <b>${escapeHtml(name.toUpperCase())}</b> 👈🏻\n\n`;
  
  let factsPart = "";
  if (facts && Array.isArray(facts) && facts.length > 0) {
    factsPart = `🔍 <b>ИНТЕРЕСНЫЕ ФАКТЫ:</b>\n` + 
                facts.slice(0, 3).map(f => `• ${escapeHtml(f)}`).join('\n') + `\n`;
  } else {
    factsPart = `🔍 <b>ИНТЕРЕСНЫЙ ФАКТ:</b>\n• Это удивительная птица с уникальными особенностями!\n`;
  }

  // Сначала пробуем собрать полный пост
  let caption = header + (description ? `${escapeHtml(description)}\n\n` : '') + factsPart + hashtagLine;

  // Если превышаем лимит, укорачиваем описание
  if (caption.length > MAX_LEN) {
    console.log(`⚠️ Подпись слишком длинная: ${caption.length} символов. Укорачиваю описание.`);
    
    // Вычисляем сколько места осталось под описание
    const fixedPartsLen = header.length + factsPart.length + hashtagLine.length + 10;
    const availableForDesc = MAX_LEN - fixedPartsLen;
    
    if (availableForDesc > 50 && description) {
      const shortDesc = escapeHtml(description).substring(0, availableForDesc) + '...\n\n';
      caption = header + shortDesc + factsPart + hashtagLine;
    } else {
      // Если места совсем мало, оставляем только заголовок, факты и теги
      caption = header + factsPart + hashtagLine;
    }
    
    // Если всё еще не влезает (редкий случай), жестко режем всё
    if (caption.length > MAX_LEN) {
      caption = caption.substring(0, MAX_LEN - 3) + '...';
    }
  }

  console.log(`✅ Подпись готова: ${caption.length} символов`);
  return caption;
}

// ============= ОСНОВНЫЕ ФУНКЦИИ =============

export async function deleteMessageFromTelegram(chatId, messageId) {
  try {
    console.log(`🗑️ Пытаюсь удалить сообщение из Telegram: chat=${chatId}, message=${messageId}`);

    const url = `https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`;

    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: parseInt(messageId)
      })
    });

    const result = await response.json();

    if (!result.ok) {
      console.error(`❌ Ошибка удаления сообщения из Telegram:`, result);

      // Проверяем распространенные ошибки
      if (result.description?.includes('message to delete not found')) {
        console.log(`⚠️ Сообщение не найдено в канале (возможно уже удалено)`);
      } else if (result.description?.includes('not enough rights')) {
        console.log(`⚠️ У бота недостаточно прав для удаления сообщений`);
        console.log(`ℹ️ Проверьте, что бот является администратором в канале`);
        console.log(`ℹ️ Проверьте права бота: должен быть "Delete messages"`);
      } else if (result.description?.includes('message can\'t be deleted')) {
        console.log(`⚠️ Сообщение не может быть удалено (слишком старое)`);
      }

      return result;
    }

    console.log(`✅ Сообщение успешно удалено из Telegram канала`);
    return result;

  } catch (error) {
    console.error(`❌ Сетевая ошибка при удалении из Telegram:`, error.message);
    return { ok: false, description: error.message };
  }
}

/**
 * Получить последние сообщения из канала (из базы данных Supabase)
 * Примечание: Telegram Bot API не предоставляет метод getChatHistory для каналов.
 * Вместо этого используем нашу таблицу channel_messages.
 */
export async function getChannelMessages(limit = 10) {
  try {
    const { supabase } = await import('./supabase.js');

    const { data, error } = await supabase
      .from('channel_messages')
      .select('*')
      .eq('is_deleted', false)
      .order('posted_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error(`❌ Ошибка получения сообщений из БД:`, error);
      return { ok: false, messages: [] };
    }

    console.log(`📋 Получено ${data?.length || 0} последних сообщений канала`);
    return { ok: true, messages: data || [] };

  } catch (error) {
    console.error(`❌ Ошибка получения сообщений:`, error.message);
    return { ok: false, messages: [] };
  }
}

/**
 * Получить информацию о канале
 */
export async function getChatInfo() {
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getChat`;

    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHANNEL_ID
      })
    });

    const result = await response.json();

    if (!result.ok) {
      console.error(`❌ Ошибка получения информации о канале:`, result);
      return { ok: false };
    }

    console.log(`ℹ️ Информация о канале:`, {
      title: result.result.title,
      type: result.result.type,
      username: result.result.username,
      permissions: result.result.permissions
    });

    return result;

  } catch (error) {
    console.error(`❌ Сетевая ошибка при получении информации о канале:`, error.message);
    return { ok: false };
  }
}

/**
 * Проверить права бота в канале
 */
async function checkBotPermissions() {
  try {
    // ✅ ИСПРАВЛЕНО: используем уже объявленную глобальную переменную
    console.log(`🔐 ${getFormattedTime()} - Проверяю права бота в канале...`);
    console.log(`🤖 Бот ID: ${BOT_TOKEN.split(':')[0]}`);
    console.log(`📢 Канал: ${CHANNEL_ID}`);

    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember`;
    const botId = BOT_TOKEN.split(':')[0];

    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHANNEL_ID,
        user_id: parseInt(botId)
      })
    });

    const result = await response.json();

    if (!result.ok) {
      console.error(`❌ Ошибка проверки прав бота:`, result);
      return { ok: false };
    }

    const member = result.result;
    const isAdmin = member.status === 'administrator' || member.status === 'creator';
    const canDelete = member.can_delete_messages || member.status === 'creator';

    console.log(`🔐 Права бота в канале:`);
    console.log(`   Статус: ${member.status}`);
    console.log(`   Администратор: ${isAdmin ? '✅' : '❌'}`);
    console.log(`   Может удалять сообщения: ${canDelete ? '✅' : '❌'}`);

    return {
      ok: true,
      isAdmin: isAdmin,
      canDelete: canDelete,
      permissions: member
    };

  } catch (error) {
    console.error(`❌ Ошибка проверки прав бота:`, error.message);
    return { ok: false };
  }
}

/**
 * Отправить сообщение администратору (Логгер)
 */
export async function sendAdminMessage(text) {
  const adminId = process.env.ADMIN_ID;
  if (!adminId) {
    console.log('⚠️ ADMIN_ID не задан. Сообщение администратору пропущено.');
    return;
  }

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  try {
    await fetchWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: adminId,
        text: `🚨 <b>Уведомление от PeroZhizniBot:</b>\n\n${text}`,
        parse_mode: "HTML"
      })
    });
    console.log(`✉️ Сообщение отправлено администратору.`);
  } catch (error) {
    console.error(`❌ Ошибка отправки сообщения администратору:`, error.message);
  }
}

/**
 * Отправить детальное сообщение об ошибке администратору
 */
export async function sendDetailedAdminError(error, context = "Неизвестный контекст") {
  try {
    const stack = error.stack ? `\n\n<b>Стек вызовов:</b>\n<pre><code>${escapeHtml(error.stack.substring(0, 1500))}</code></pre>` : '';
    const message = `❌ <b>КРИТИЧЕСКАЯ ОШИБКА</b>\n` +
      `📍 <b>Контекст:</b> ${context}\n` +
      `📝 <b>Ошибка:</b> <code>${escapeHtml(error.message)}</code>` +
      `#птицы #природа #ПероЖизни`;

    await sendAdminMessage(message);
  } catch (e) {
    console.error(`❌ Не удалось отправить детальную ошибку админу:`, e.message);
  }
}

async function sendTextPost(text) {
  console.log(`📝 Отправляю текстовый пост`);

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

  try {
    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHANNEL_ID,
        text: text,
        parse_mode: "HTML",
        disable_web_page_preview: true // Добавьте это чтобы Telegram не обрезал
      })
    });

    const result = await response.json();

    if (!result.ok) {
      console.error(`❌ Ошибка отправки текста:`, result);
      return result;
    }

    console.log(`✅ Текстовый пост отправлен`);
    return result;

  } catch (error) {
    console.error(`❌ Сетевая ошибка:`, error.message);
    throw error;
  }
}


/**
 * Нормализует URL изображения Wikimedia.
 *
 * ВАЖНО: Мы НЕ конвертируем /thumb/ URL в прямой путь к оригиналу.
 * Wikimedia блокирует прямые запросы к оригинальным файлам (403 Forbidden).
 * Thumbnail URL (с /thumb/) работают стабильно — их и оставляем.
 *
 * Обрабатываем только Special:FilePath редиректы.
 */
async function normalizeWikimediaUrl(imageUrl) {
  if (!imageUrl) return imageUrl;

  // Special:FilePath — резолвим через HEAD-запрос в реальный thumb URL
  if (imageUrl.includes('Special:FilePath') || imageUrl.includes('special:filepath')) {
    try {
      console.log(`🔗 Резолвлю Special:FilePath URL...`);
      const headRes = await fetch(imageUrl, {
        method: 'HEAD',
        redirect: 'follow',
        headers: {
          'User-Agent': 'BirdTelegramBot/1.0 (https://t.me/PeroZhizni; admin@example.com)'
        }
      });
      if (headRes.ok && headRes.url && headRes.url !== imageUrl) {
        const resolvedUrl = headRes.url.split('?')[0];
        console.log(`🔗 Резолвлен FilePath URL: ${resolvedUrl.substring(0, 80)}`);
        return resolvedUrl;
      }
    } catch (e) {
      console.log(`⚠️ Не удалось резолвить FilePath URL: ${e.message}`);
    }
  }

  // Для всех остальных URL (включая /thumb/) возвращаем как есть
  return imageUrl;
}

/**
 * Generic function to send a photo to a chat (user or channel)
 */
export async function sendTelegramPhoto(chatId, imageUrl, caption, options = {}) {
  // --- Нормализуем URL перед отправкой ---
  const normalizedUrl = await normalizeWikimediaUrl(imageUrl);
  if (normalizedUrl !== imageUrl) {
    console.log(`📸 URL нормализован, отправляю прямой URL в Telegram`);
  }

  if (normalizedUrl && typeof normalizedUrl === 'string') {
    console.log(`📸 Sending photo to ${chatId}: ${normalizedUrl.substring(0, 80)}...`);
  } else {
    console.log(`📸 Sending photo to ${chatId} (URL is null or invalid)`);
  }

  // Validate URL or File ID
  const isUrl = typeof normalizedUrl === 'string' && normalizedUrl.startsWith('https://');
  const isFileId = typeof normalizedUrl === 'string' && !normalizedUrl.includes('/') && !normalizedUrl.includes(' ') && normalizedUrl.length > 20;

  if (!isUrl && !isFileId) {
    console.error(`❌ INVALID PHOTO SOURCE: ${normalizedUrl}`);
    return { ok: false, description: 'Invalid URL or File ID', needTextFallback: true };
  }

  if (isFileId) {
    console.log(`ℹ️ Sending by File ID: ${normalizedUrl}`);
  }

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`;

  // Prepare body
  const body = {
    chat_id: chatId,
    photo: normalizedUrl,
    caption: caption,
    parse_mode: "HTML",
    ...options
  };

  try {
    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const result = await response.json();

    if (!result.ok) {
      console.error(`❌ Error sending photo to ${chatId}:`, result.description);

      // При ошибках связанных с URL — переходим к скачиванию файла (без спама админу)
      if (result.description?.includes('failed to get HTTP URL content') ||
        result.description?.includes('Wrong file identifier/HTTP URL specified') ||
        result.description?.includes('wrong type of the web page content')) {
        throw new Error('URL_CONTENT_FAILED');
      }

      return result;
    }

    console.log(`✅ Photo sent successfully to ${chatId}`);
    return result;

  } catch (error) {
    if (error.message === 'URL_CONTENT_FAILED') {
      console.log(`⚠️ Telegram не принял URL напрямую. Скачиваю и отправляю как файл...`);
      // Скачиваем оригинальный URL (normalizedUrl уже без /thumb/)
      return await sendPhotoAsFile(chatId, normalizedUrl, caption, options);
    }

    console.error(`❌ Network error sending photo:`, error.message);
    return { ok: false, description: error.message, needTextFallback: true };
  }
}

/**
 * Helper to download and send photo as file (multipart/form-data)
 */
async function sendPhotoAsFile(chatId, imageUrl, caption, options = {}) {
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`;

    // Wikimedia-совместимые заголовки для обхода 403 Forbidden
    // Referer должен соответствовать домену upload.wikimedia.org
    const isWikimedia = imageUrl.includes('wikimedia.org');
    const headers = {
      'User-Agent': 'Mozilla/5.0 (compatible; BirdTelegramBot/1.0; +https://t.me/PeroZhizni)',
      'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
      'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
      'Referer': 'https://ru.wikipedia.org/'
    };

    const imageResponse = await fetch(imageUrl, { headers, redirect: 'follow' });
    if (!imageResponse.ok) {
      const errorMsg = `Не удалось скачать изображение: ${imageResponse.status} ${imageResponse.statusText}`;
      console.error(`❌ ${errorMsg} | URL: ${imageUrl.substring(0, 100)}`);
      throw new Error(errorMsg);
    }

    const contentTypeHeader = imageResponse.headers.get('content-type') || '';
    const imageArrayBuffer = await imageResponse.arrayBuffer();
    const imageBuffer = Buffer.from(imageArrayBuffer);

    if (!imageBuffer || imageBuffer.length === 0) {
      throw new Error('Downloaded image is empty');
    }

    if (contentTypeHeader && !contentTypeHeader.toLowerCase().startsWith('image/')) {
      throw new Error(`Downloaded content is not an image (content-type: ${contentTypeHeader})`);
    }

    // Determine extension/mime
    const lowerUrl = (imageUrl || '').toLowerCase();
    const mimeType = (contentTypeHeader.split(';')[0] || '').trim() || (lowerUrl.includes('.png') ? 'image/png' : 'image/jpeg');
    const fileExtension = mimeType.includes('png') ? 'png'
      : mimeType.includes('webp') ? 'webp'
        : mimeType.includes('gif') ? 'gif'
          : 'jpg';
    const fileName = `image.${fileExtension}`;

    const imageBlob = new Blob([imageBuffer], { type: mimeType });

    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append('photo', imageBlob, fileName);
    if (caption) formData.append('caption', caption);
    formData.append('parse_mode', 'HTML');

    // Append options
    for (const [key, value] of Object.entries(options)) {
      if (value === undefined || value === null) continue;
      if (typeof value === 'object') {
        formData.append(key, JSON.stringify(value));
      } else {
        formData.append(key, String(value));
      }
    }

    const response = await fetchWithRetry(url, {
      method: "POST",
      body: formData
    });

    const result = await response.json();

    if (!result.ok) {
      console.error(`❌ Error sending photo as file:`, {
        description: result.description,
        error_code: result.error_code,
        imageBytes: imageBuffer.length,
        mimeType: mimeType,
        fileName: fileName
      });

      try {
        await sendAdminMessage(`❌ Не удалось отправить скачанное фото как файл.\nTelegram API: <code>${escapeHtml(result.description)}</code>`);
      } catch (e) { }

      return { ok: false, needTextFallback: true, description: result.description };
    }

    console.log(`✅ Photo sent as file`);
    return result;

  } catch (error) {
    console.error(`❌ Error downloading/sending file:`, error.message);
    return { ok: false, needTextFallback: true, description: error.message };
  }
}

async function sendPhotoPost(imageUrl, caption) {
  // Use the new generic function, targeting the channel
  const result = await sendTelegramPhoto(CHANNEL_ID, imageUrl, caption);
  return result;
}

export async function sendBirdPostToChannel(birdData) {
  const { name, description, imageUrl, facts } = birdData;

  console.log(`🚀 Отправляю пост о птице: ${name}`);
  console.log(`📊 Данные: фото=${!!imageUrl}, фактов=${facts?.length || 0}`);

  try {
    // 2. Ищем фото или проверяем переданное
    // Если в birdData уже есть imageUrl — используем его, иначе ищем
    let targetImageUrl = birdData.imageUrl;
    let isFamilyPhoto = false;
    let familyName = '';

    // Если фото нет или оно из кеша, пробуем найти/проверить через наш ультимативный поиск
    const imageInfo = await imageSearch.findBirdImage(name, { useCache: true });

    if (imageInfo) {
      if (typeof imageInfo === 'string') {
        targetImageUrl = imageInfo;
      } else {
        targetImageUrl = imageInfo.url;
        isFamilyPhoto = imageInfo.isFamilyPhoto;
        familyName = imageInfo.familyName;
      }
    }

    const caption = buildCaption(name, description, facts);
    let finalCaption = caption;

    if (isFamilyPhoto && familyName) {
      finalCaption += `\n\n📌 <i>Примечание: На фото — представитель близкого вида или семейства (<b>${familyName}</b>), так как редкое фото данного вида недоступно.</i>`;
    }

    let result;

    if (targetImageUrl) {
      console.log(`📸 Оптимизирую фото и отправляю: ${targetImageUrl.substring(0, 60)}...`);

      // Мы больше не используем локальный буфер WebP для отправки как URL
      // Это вызывало ошибку "INVALID PHOTO SOURCE: RIFF WEBP"
      result = await sendPhotoPost(targetImageUrl, finalCaption);

      if (!result.ok && result.needTextFallback) {
        Sentry.captureMessage(`Ошибка отправки фото: ${result.description}`, {
          extra: { bird: name, url: targetImageUrl }
        });
        console.log(`❌ Фото не отправилось. Отмена поста по требованию пользователя.`);

        // Формируем детальное сообщение об ошибке для админа
        const errorMessage = `❌ <b>Ошибка отправки фото:</b>\n` +
          `Птица: <b>${name}</b>\n` +
          `URL: <code>${targetImageUrl}</code>\n` +
          `Причина: <code>${escapeHtml(result.description || 'Неизвестная ошибка')}</code>\n\n` +
          `<i>Пост НЕ был опубликован в канале.</i>`;

        try {
          await sendAdminMessage(errorMessage);
        } catch (e) { }

        // Выбрасываем ошибку, чтобы cron.js зафиксировал сбой
        throw new Error(`PHOTO_SEND_FAILED: ${result.description || 'Unknown error'}`);
      }
    } else {
      console.log(`📝 Отправляю текстовый пост (нет фото)`);
      result = await sendTextPost(caption);
    }

    // Сохраняем message_id в базу данных для возможности удаления
    if (result.ok && result.result) {
      const messageId = result.result.message_id;
      console.log(`✅ Пост отправлен, message_id: ${messageId}`);

      // Сохраняем в базу данных
      try {
        // Импортируем функцию из supabase
        const { saveChannelMessage } = await import('./supabase.js');
        await saveChannelMessage(name, messageId, CHANNEL_ID);
        console.log(`💾 Message_id сохранен в базу данных`);
      } catch (saveError) {
        console.error(`❌ Ошибка сохранения message_id:`, saveError.message);
      }
    }

    return result;

  } catch (error) {
    console.error(`❌ Критическая ошибка отправки:`, error);

    const emergencyCaption =
      `👉🏻 <b>${escapeHtml(name.toUpperCase())}</b> 👈🏻\n\n` +
      (description ? `${escapeHtml(description)}\n\n` : '') +
      `🔍 <b>ИНТЕРЕСНЫЕ ФАКТЫ:</b>\n` +
      (Array.isArray(facts) ? facts.map(f => `• ${f}`).join('\n') : `• ${facts || 'Эта птица очень интересна!'}`) + `\n\n` +
      `#${name.replace(/\s+/g, '')} #птицы #природа #ПероЖизни`;

    const result = await sendTextPost(emergencyCaption);

    // Сохраняем message_id даже для аварийного поста
    if (result.ok && result.result) {
      const messageId = result.result.message_id;
      try {
        const { saveChannelMessage } = await import('./supabase.js');
        await saveChannelMessage(name, messageId, CHANNEL_ID);
      } catch (saveError) {
        console.error(`❌ Ошибка сохранения message_id для аварийного поста:`, saveError.message);
      }
    }

    return result;
  }
}

// ============= ВИКТОРИНЫ =============

/**
 * Отправить воскресную викторину
 */
export async function sendSundayQuiz() {
  try {
    console.log('📅 Начинаю отправку воскресной викторины');

    const quizData = await generateQuiz();

    if (!quizData) {
      console.log('❌ Не удалось сгенерировать викторину');
      return null;
    }

    // Формируем вопрос С ЗАГОЛОВКОМ
    const pollQuestion = `🎯 ВОСКРЕСНАЯ ВИКТОРИНА!\n\n${quizData.question}`;

    console.log(`📨 Вопрос викторины: "${pollQuestion.substring(0, 80)}..."`);

    const pollUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendPoll`;

    // Telegram limit 200 chars total for explanation.
    // Header + Footer takes ~70 chars. 
    // We expect cleanExplanation to be < 100 chars from Gemini.

    const requestBody = {
      chat_id: CHANNEL_ID,
      question: pollQuestion,
      options: quizData.options,
      is_anonymous: true,
      type: "quiz",
      correct_option_id: quizData.correctIndex,
      explanation: `✅ <b>Правильный ответ: ${quizData.correctBird}</b>\n\n` +
        `Птицы — удивительные и многогранные создания.\n` +
        `Оставайтесь с нами и узнавайте новое каждый день! 🐦`,
      explanation_parse_mode: "HTML"
    };

    console.log('📤 Отправляю опрос в канал');
    console.log(`   Варианты: ${quizData.options.join(', ')}`);
    console.log(`   Правильный ответ: ${quizData.correctIndex + 1}. ${quizData.correctBird}`);

    const response = await fetchWithRetry(pollUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    });

    const result = await response.json();

    if (!result.ok) {
      console.error('❌ Ошибка отправки опроса:', result.description);

      // Пробуем без explanation
      const simpleBody = {
        chat_id: CHANNEL_ID,
        question: pollQuestion,
        options: quizData.options,
        is_anonymous: true,
        type: "quiz",
        correct_option_id: quizData.correctIndex
      };

      const retryResponse = await fetchWithRetry(pollUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(simpleBody)
      });

      const retryResult = await retryResponse.json();

      if (!retryResult.ok) {
        console.error('❌ Ошибка при повторной отправке:', retryResult.description);
        return null;
      }

      console.log('✅ Викторина отправлена (без explanation)');
      return retryResult;
    }

    console.log('✅ Викторина успешно отправлена!');

    // Уведомляем админа о правильном ответе
    try {
      await sendAdminMessage(`🎯 <b>Отправлена викторина!</b>\n\n✅ Правильный ответ: <b>${quizData.correctBird}</b>`);
    } catch (e) { console.error('Не удалось отправить ответ админу', e); }

    return result;

  } catch (error) {
    console.error('❌ Критическая ошибка:', error);
    return null;
  }
}

/**
 * Резервная викторина
 */
async function sendBackupQuiz() {
  try {
    console.log('🔄 Пробую резервную викторину');

    const weeklyBirds = await getWeeklyBirds();
    if (weeklyBirds.length < 4) {
      console.log('❌ Недостаточно птиц для резервной викторины');
      return null;
    }

    const shuffledBirds = [...weeklyBirds]
      .sort(() => Math.random() - 0.5)
      .slice(0, 4);

    const correctBird = shuffledBirds[0];
    const options = [...shuffledBirds].sort(() => Math.random() - 0.5);
    const correctIndex = options.indexOf(correctBird);

    const pollUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendPoll`;

    const requestBody = {
      chat_id: CHANNEL_ID,
      question: "🎯 ВОСКРЕСНАЯ ВИКТОРИНА!\n\nКакая из этих птиц наиболее известна своим пением?",
      options: options,
      is_anonymous: true,
      type: "quiz",
      correct_option_id: correctIndex,
      explanation: `✅ <b>Правильный ответ: ${correctBird}</b>\n\n` +
        `Все птицы по-своему прекрасны! 🐦`,
      explanation_parse_mode: "HTML"
    };

    const response = await fetchWithRetry(pollUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    });

    const result = await response.json();

    if (!result.ok) {
      console.error('❌ Ошибка отправки резервной викторины:', result.description);

      // Последняя попытка - максимально упрощенная
      const finalBody = {
        chat_id: CHANNEL_ID,
        question: "🎯 ВОСКРЕСНАЯ ВИКТОРИНА!\n\nКакая из этих птиц наиболее известна своим пением?",
        options: options,
        is_anonymous: true,
        type: "quiz",
        correct_option_id: correctIndex
      };

      const finalResponse = await fetchWithRetry(pollUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(finalBody)
      });

      const finalResult = await finalResponse.json();

      if (!finalResult.ok) {
        console.error('❌ Финальная ошибка викторины:', finalResult.description);
        return null;
      }

      console.log('✅ Резервная викторина отправлена (минимальная версия)');
      return finalResult;
    }

    console.log('✅ Резервная викторина отправлена');

    // Уведомляем админа о правильном ответе
    try {
      await sendAdminMessage(`🔄 <b>Отправлена РЕЗЕРВНАЯ викторина!</b>\n\n✅ Правильный ответ: <b>${correctBird}</b>`);
    } catch (e) { console.error('Не удалось отправить ответ админу', e); }

    return result;

  } catch (error) {
    console.error('❌ Ошибка резервной викторины:', error);
    return null;
  }
}

export async function testSend() {
  try {
    console.log('🧪 Тестирую отправку в Telegram');

    const testBird = {
      name: "Тестовая птица",
      description: "Это тестовое описание для проверки работы бота.",
      imageUrl: null,
      facts: [
        "Первый тестовый факт о птице.",
        "Второй тестовый факт с дополнительной информацией.",
        "Третий факт для полноты картины."
      ]
    };

    const result = await sendBirdPostToChannel(testBird);

    if (result && result.ok) {
      console.log('✅ Тест пройден успешно!');
      return { success: true, message: "Тест пройден" };
    } else {
      console.log('❌ Тест не пройден');
      return { success: false, error: result?.description || "Неизвестная ошибка" };
    }

  } catch (error) {
    console.error('❌ Ошибка теста:', error);
    return { success: false, error: error.message };
  }
}

// ============= ЭКСПОРТ =============

export default {
  sendBirdPostToChannel,
  sendSundayQuiz,
  testSend
};