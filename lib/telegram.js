// lib/telegram.js - Улучшенная отправка постов с исправлением проблем
import { fetch } from 'undici';
import { getWeeklyBirds, generateQuiz } from "./birds.js";

// ============= КОНФИГУРАЦИЯ =============
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "8549980803:AAG6OKU_Kh8DYhoTbCydkxylClYKWlk8H7o";
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL || "@PeroZhizni";

console.log('📨 [TELEGRAM] Модуль загружен');
console.log(`📢 [TELEGRAM] Канал: ${CHANNEL_ID}`);

// ============= УТИЛИТЫ =============

function getFormattedTime() {
  const now = new Date();
  const moscowTime = new Date(now.getTime() + (3 * 60 * 60 * 1000));
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
  
  const MAX_LEN = 1024; // Telegram ограничение для подписей к фото
  
  let caption = `👉🏻 <b>${escapeHtml(name.toUpperCase())}</b> 👈🏻\n\n`;
  
  // Добавляем описание БЕЗ ОБРЕЗКИ
  if (description && description.length > 0) {
    caption += `${escapeHtml(description)}\n\n`;
  }
  
  // Добавляем факты БЕЗ ОБРЕЗКИ
  if (facts && Array.isArray(facts) && facts.length > 0) {
    caption += `🔍 <b>ИНТЕРЕСНЫЕ ФАКТЫ:</b>\n`;
    
    facts.slice(0, 3).forEach((fact, index) => {
      caption += `• ${escapeHtml(fact)}\n`;
    });
  } else {
    caption += `🔍 <b>ИНТЕРЕСНЫЙ ФАКТ:</b>\n`;
    caption += `• Это удивительная птица с уникальными особенностями!\n`;
  }
  
  // Хэштеги (сокращаем только если нужно)
  const rawTag = name.replace(/[^a-zA-Zа-яА-Я0-9]+/g, "");
  const hashtagLine = `\n#${escapeHtml(rawTag)} #птицы #природа #ПероЖизни`;
  
  // Проверяем общую длину
  const currentLength = caption.length;
  const hashtagLength = hashtagLine.length;
  
  if (currentLength + hashtagLength > MAX_LEN) {
    console.log(`⚠️ Подпись слишком длинная: ${currentLength + hashtagLength} символов`);
    
    // Если не помещается даже без хэштегов, убираем лишние пробелы
    if (currentLength > MAX_LEN) {
      // В критическом случае укорачиваем описание, но оставляем факты
      let shortCaption = `👉🏻 <b>${escapeHtml(name.toUpperCase())}</b> 👈🏻\n\n`;
      
      if (description && description.length > 0) {
        // Оставляем только первое предложение описания
        const firstSentence = description.split(/[.!?]+/)[0];
        if (firstSentence && firstSentence.length > 0) {
          shortCaption += `${escapeHtml(firstSentence)}.\n\n`;
        }
      }
      
      shortCaption += `🔍 <b>ИНТЕРЕСНЫЕ ФАКТЫ:</b>\n`;
      facts.slice(0, 2).forEach((fact, index) => { // Берем только 2 факта
        shortCaption += `• ${escapeHtml(fact)}\n`;
      });
      
      shortCaption += hashtagLine;
      
      // Если всё равно не помещается, отправляем как есть (Telegram сам обрежет)
      if (shortCaption.length > MAX_LEN) {
        console.log(`⚠️ Критически длинная подпись, отправляю как есть`);
        caption = shortCaption.substring(0, MAX_LEN - 3) + '...';
      } else {
        caption = shortCaption;
      }
    } else {
      // Если помещается без хэштегов, оставляем как есть
      caption = caption.substring(0, MAX_LEN - 3) + '...';
    }
  } else {
    // Всё помещается - добавляем хэштеги
    caption += hashtagLine;
  }
  
  console.log(`✅ Подпись готова: ${caption.length} символов (лимит: ${MAX_LEN})`);
  return caption;
}

// ============= ОСНОВНЫЕ ФУНКЦИИ =============

export async function deleteMessageFromTelegram(chatId, messageId) {
  try {
    console.log(`🗑️ Пытаюсь удалить сообщение из Telegram: chat=${chatId}, message=${messageId}`);
    
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`;
    
    const response = await fetch(url, {
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
 * Получить последние сообщения из канала
 */
export async function getChannelMessages(limit = 10) {
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getChatHistory`;
    
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHANNEL_ID,
        limit: limit
      })
    });
    
    const result = await response.json();
    
    if (!result.ok) {
      console.error(`❌ Ошибка получения сообщений:`, result);
      return { ok: false, messages: [] };
    }
    
    return { ok: true, messages: result.result || [] };
    
  } catch (error) {
    console.error(`❌ Сетевая ошибка при получении сообщений:`, error.message);
    return { ok: false, messages: [] };
  }
}

/**
 * Получить информацию о канале
 */
export async function getChatInfo() {
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getChat`;
    
    const response = await fetch(url, {
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
export async function checkBotPermissions() {
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember`;
    
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHANNEL_ID,
        user_id: parseInt(BOT_TOKEN.split(':')[0]) // Извлекаем ID бота из токена
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

async function sendTextPost(text) {
  console.log(`📝 Отправляю текстовый пост`);
  
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  
  try {
    const response = await fetch(url, {
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

async function sendPhotoPost(imageUrl, caption) {
  console.log(`📸 Отправляю фото`);
  
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`;
  
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHANNEL_ID,
        photo: imageUrl,
        caption: caption,
        parse_mode: "HTML"
      })
    });
    
    const result = await response.json();
    
    if (!result.ok) {
      console.error(`❌ Ошибка отправки фото:`, result);
      
      if (result.description && result.description.includes('failed to get HTTP URL content')) {
        console.log(`⚠️ Telegram не может загрузить фото по URL`);
        return { ok: false, needTextFallback: true };
      }
      
      return result;
    }
    
    console.log(`✅ Фото отправлено`);
    return result;
    
  } catch (error) {
    console.error(`❌ Сетевая ошибка:`, error.message);
    throw error;
  }
}

export async function sendBirdPostToChannel(birdData) {
  const { name, description, imageUrl, facts } = birdData;
  
  console.log(`🚀 Отправляю пост о птице: ${name}`);
  console.log(`📊 Данные: фото=${!!imageUrl}, фактов=${facts?.length || 0}`);
  
  try {
    const caption = buildCaption(name, description, facts);
    
    let result;
    
    if (imageUrl) {
      console.log(`📸 Пробую отправить с фото: ${imageUrl.substring(0, 60)}...`);
      result = await sendPhotoPost(imageUrl, caption);
      
      if (!result.ok && result.needTextFallback) {
        console.log(`⚠️ Фото не отправилось, пробую текст`);
        result = await sendTextPost(caption);
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
      `🔍 <b>ИНТЕРЕСНЫЙ ФАКТ:</b>\n` +
      `• ${facts?.[0] || 'Эта птица очень интересна!'}\n\n` +
      `#птицы #природа #ПероЖизни\n\n` +
      `🕒 <i>Время публикации: ${getFormattedTime()}</i>`;
    
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
      return await sendBackupQuiz();
    }
    
    // Формируем более информативное сообщение
    let pollQuestion = `🎯 <b>ВОСКРЕСНАЯ ВИКТОРИНА!</b>\n\n`;
    pollQuestion += `${quizData.question}\n\n`;
    pollQuestion += `<i>Выберите правильный вариант:</i>`;
    
    const pollUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendPoll`;
    
    console.log(`📨 Отправляю опрос в канал: ${pollQuestion.substring(0, 80)}...`);
    
    const requestBody = {
      chat_id: CHANNEL_ID,
      question: pollQuestion,
      options: quizData.options,
      is_anonymous: false, // Показываем, кто голосует
      type: "quiz",
      correct_option_id: quizData.correctIndex,
      explanation: `✅ <b>Правильный ответ: ${quizData.correctBird}</b>\n\n` +
                   `🐦 Узнавайте больше о птицах каждый день в нашем канале!\n` +
                   `📚 Каждый день - новая птица с интересными фактами!\n\n` +
                   `<i>Спасибо за участие в викторине!</i>`,
      explanation_parse_mode: "HTML"
    };
    
    console.log('📤 Тело запроса для опроса');
    console.log(`   Вопрос: ${requestBody.question.substring(0, 60)}...`);
    console.log(`   Варианты: ${requestBody.options.join(', ')}`);
    console.log(`   Правильный ответ: ${requestBody.correct_option_id + 1}. ${quizData.correctBird}`);
    
    const response = await fetch(pollUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    });
    
    const result = await response.json();
    
    if (!result.ok) {
      console.error('❌ Ошибка отправки опроса:', result);
      
      // Пробуем более простой вариант без explanation
      const simpleBody = {
        chat_id: CHANNEL_ID,
        question: pollQuestion,
        options: quizData.options,
        is_anonymous: false,
        type: "quiz",
        correct_option_id: quizData.correctIndex
      };
      
      const retryResponse = await fetch(pollUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(simpleBody)
      });
      
      const retryResult = await retryResponse.json();
      
      if (!retryResult.ok) {
        console.error('❌ Ошибка при повторной отправке:', retryResult);
        return await sendBackupQuiz();
      }
      
      console.log('✅ Викторина отправлена (упрощенная версия)');
      return retryResult;
    }
    
    console.log('✅ Викторина успешно отправлена!');
    
    return result;
    
  } catch (error) {
    console.error('❌ Критическая ошибка:', error);
    return await sendBackupQuiz();
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
      question: `🎯 <b>ВОСКРЕСНАЯ ВИКТОРИНА!</b>\n\nКакая из этих птиц наиболее известна своим пением?`,
      options: options,
      is_anonymous: true,
      type: "quiz",
      correct_option_id: correctIndex,
      explanation: `Правильный ответ: <b>${correctBird}</b>\n\n` +
                   `Все птицы по-своему прекрасны! 🐦`,
      explanation_parse_mode: "HTML"
      // УБРАНО: open_period: 86400,
      // УБРАНО: close_date: Math.floor(Date.now() / 1000) + 86400
    };
    
    const response = await fetch(pollUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    });
    
    const result = await response.json();
    
    if (!result.ok) {
      console.error('❌ Ошибка отправки резервной викторины:', result);
      return null;
    }
    
    console.log('✅ Резервная викторина отправлена');
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