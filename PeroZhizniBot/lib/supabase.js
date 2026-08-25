// lib/supabase.js - ИСПРАВЛЕННАЯ ВЕРСИЯ С ФУНКЦИЕЙ УДАЛЕНИЯ ПОСТОВ
import { createClient } from '@supabase/supabase-js';
import { fetch } from 'undici';

const supabaseUrl = process.env.SUPABASE_URL1;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);

// ====== КОНФИГУРАЦИЯ ======
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN1 || "8581175313:AAFWIjJDnFbbWCyCGsHE0M3U2GfWzSkomWs";
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL || "@PeroZhizni";

// ====== ФУНКЦИИ ВРЕМЕНИ ======
function getCurrentMoscowTime() {
  return new Date();
}

function getFormattedTime() {
  const moscowTime = new Date();
  return moscowTime.toLocaleTimeString('ru-RU', {
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

function getVCRTime() {
  const moscowTime = new Date();
  return moscowTime.toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour12: false,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function getCurrentISODate() {
  return new Date().toISOString();
}

// ====== УТИЛИТЫ ======
async function initializeSupabase() {
  console.log('🔗 [SUPABASE] Подключение к PostgreSQL через Supabase');
  console.log(`🕐 [SUPABASE] Текущее время VCR: ${getVCRTime()}`);
  return supabase;
}

// ====== ФУНКЦИИ ДЛЯ ПТИЦ ======
async function getAllBirds() {
  try {
    const { data, error } = await supabase
      .from('birds')
      .select('name')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data.map(item => item.name) || [];
  } catch (err) {
    console.error('❌ getAllBirds error:', err);
    return [];
  }
}

async function addBird(birdName) {
  try {
    const { data, error } = await supabase
      .from('birds')
      .insert([{
        name: birdName,
        created_at: getCurrentISODate()
      }])
      .select();

    if (error) {
      if (error.code === '23505') return;
      throw error;
    }

    console.log(`✅ Птица добавлена: ${birdName} (${getFormattedTime()})`);
    return data[0];
  } catch (err) {
    console.error('❌ addBird error:', err);
  }
}

async function isBirdInDatabase(birdName) {
  try {
    const { data, error } = await supabase
      .from('birds')
      .select('id')
      .ilike('name', birdName)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    return !!data;
  } catch (err) {
    console.error('❌ isBirdInDatabase error:', err);
    return false;
  }
}

// ====== ФУНКЦИИ ДЛЯ ФАКТОВ ======
async function saveBirdFacts(birdName, facts) {
  try {
    if (!birdName || !Array.isArray(facts) || facts.length === 0) return;

    let birdData;
    const { data: bird, error: birdError } = await supabase
      .from('birds')
      .select('id')
      .eq('name', birdName)
      .single();

    if (birdError) {
      await addBird(birdName);
      const { data: newBird } = await supabase
        .from('birds')
        .select('id')
        .ilike('name', birdName)
        .single();

      if (!newBird) return;
      birdData = newBird;
    } else {
      birdData = bird;
    }
    // Убираем удаление старых фактов, чтобы накапливать историю для проверки на уникальность
    // await supabase
    //   .from('bird_facts')
    //   .delete()
    //   .eq('bird_id', birdData.id);

    const factsToInsert = facts.map(fact => ({
      bird_id: birdData.id,
      fact: fact,
      created_at: getCurrentISODate()
    }));

    const { error } = await supabase
      .from('bird_facts')
      .insert(factsToInsert);

    if (error) {
      if (error.code === '23505') {
        console.log(`⚠️ Факты уже существуют для: ${birdName}`);
        return;
      }
      throw error;
    }

    console.log(`✅ Сохранено ${facts.length} фактов для ${birdName} (${getFormattedTime()})`);

  } catch (err) {
    console.error('❌ saveBirdFacts error:', err);
  }
}

async function getBirdFacts(birdName) {
  try {
    const { data: bird, error: birdError } = await supabase
      .from('birds')
      .select('id')
      .ilike('name', birdName)
      .single();

    if (birdError) return null;

    const { data: facts, error } = await supabase
      .from('bird_facts')
      .select('fact')
      .eq('bird_id', bird.id)
      .order('created_at', { ascending: true });

    if (error) throw error;

    return facts.map(item => item.fact);
  } catch (err) {
    console.error('❌ getBirdFacts error:', err);
    return null;
  }
}

async function getAllBirdFacts() {
  try {
    const { data, error } = await supabase
      .from('bird_facts')
      .select(`
        fact,
        birds (
          name
        )
      `);

    if (error) throw error;

    const map = new Map();
    data.forEach(item => {
      if (item.birds && item.birds.name) {
        if (!map.has(item.birds.name)) {
          map.set(item.birds.name, []);
        }
        map.get(item.birds.name).push(item.fact);
      }
    });

    return map;
  } catch (err) {
    console.error('❌ getAllBirdFacts error:', err);
    return new Map();
  }
}

// ====== ФУНКЦИИ ДЛЯ ИСТОРИИ ======
// lib/supabase.js - УЛУЧШЕННАЯ ФУНКЦИЯ getWeeklyBirds
async function getWeeklyBirds(limit = 30) {
  try {
    // Получаем дату 7 дней назад
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const { data, error } = await supabase
      .from('bird_history')
      .select(`
        birds (
          name
        ),
        posted_at
      `)
      .gte('posted_at', weekAgo.toISOString())
      .order('posted_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    const birds = data.map(item => {
      return item.birds?.name || '';
    }).filter(name => name) || [];

    console.log(`📊 getWeeklyBirds: найдено ${birds.length} птиц за последнюю неделю`);

    return birds;
  } catch (err) {
    console.error('❌ getWeeklyBirds error:', err);
    return [];
  }
}

async function getAllTimeBirds(limit = 1000) {
  try {
    const { data, error } = await supabase
      .from('bird_history')
      .select(`
        birds (
          name
        ),
        posted_at
      `)
      .order('posted_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    const birds = data.map(item => {
      if (item.birds && item.birds.name) {
        return item.birds.name;
      }
      return null;
    }).filter(name => name !== null);

    // Убираем дубликаты
    return [...new Set(birds)];
  } catch (err) {
    console.error('❌ getAllTimeBirds error:', err);
    return [];
  }
}

export async function getPublishedBirds(limit = 20) {
  try {
    const { data, error } = await supabase
      .from('channel_messages')
      .select('bird_name, posted_at, message_id, chat_id')
      .eq('is_deleted', false)
      .order('posted_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('❌ getPublishedBirds error:', err);
    return [];
  }
}

async function updateBirdHistory(birdName) {
  try {
    let birdData;
    const { data: bird, error: birdError } = await supabase
      .from('birds')
      .select('id')
      .eq('name', birdName)
      .single();

    if (birdError) {
      await addBird(birdName);
      const { data: newBird } = await supabase
        .from('birds')
        .select('id')
        .eq('name', birdName)
        .single();

      if (!newBird) return;
      birdData = newBird;
    } else {
      birdData = bird;
    }

    const { error } = await supabase
      .from('bird_history')
      .insert([{
        bird_id: birdData.id,
        posted_at: getCurrentISODate()
      }]);

    if (error) throw error;
    console.log(`✅ История обновлена: ${birdName} (${getFormattedTime()})`);

  } catch (err) {
    console.error('❌ updateBirdHistory error:', err);
  }
}

async function getBirdsCount() {
  try {
    const { count, error } = await supabase
      .from('bird_history')
      .select('*', { count: 'exact', head: true });

    if (error) throw error;
    return count || 0;
  } catch (err) {
    console.error('❌ getBirdsCount error:', err);
    return 0;
  }
}

async function getDeletedPostsStats() {
  try {
    // Проверяем, существует ли таблица
    const { error: checkError } = await supabase
      .from('deleted_posts')
      .select('id')
      .limit(1);

    if (checkError && checkError.code === '42P01') {
      return 0;
    }

    const { count, error } = await supabase
      .from('deleted_posts')
      .select('*', { count: 'exact', head: true });

    if (error) throw error;
    return count || 0;
  } catch (err) {
    console.error('❌ getDeletedPostsStats error:', err);
    return 0;
  }
}

// ====== ФУНКЦИИ ДЛЯ СООБЩЕНИЙ КАНАЛА ======

// Вспомогательная функция для удаления сообщения из Telegram
async function deleteMessageFromTelegram(chatId, messageId) {
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
        console.log(`ℹ️ Сделайте бота администратором в канале с правом удаления сообщений`);
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

async function saveChannelMessage(birdName, messageId, chatId = null) {
  try {
    // Используем переданный chatId или дефолтный из конфигурации
    const targetChatId = chatId || CHANNEL_ID;

    const { data, error } = await supabase
      .from('channel_messages')
      .insert([{
        bird_name: birdName,
        message_id: messageId,
        chat_id: targetChatId,
        posted_at: getCurrentISODate()
      }])
      .select()
      .single();

    if (error) throw error;

    console.log(`✅ Сохранено message_id ${messageId} для птицы "${birdName}" (чат: ${targetChatId})`);
    return data;
  } catch (err) {
    console.error('❌ saveChannelMessage error:', err);
    return null;
  }
}

async function getLastChannelMessage() {
  try {
    // Используем таблицу channel_messages для получения последнего поста
    const { data: channelMessage, error } = await supabase
      .from('channel_messages')
      .select('*')
      .eq('is_deleted', false)
      .order('posted_at', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        console.log('📭 Нет сохраненных сообщений в channel_messages');
        return null;
      }
      throw error;
    }

    if (channelMessage) {
      return {
        name: channelMessage.bird_name,
        posted_at: channelMessage.posted_at,
        message_id: channelMessage.message_id,
        chat_id: channelMessage.chat_id
      };
    }

    return null;

  } catch (error) {
    console.error('❌ Ошибка получения последней птицы:', error);
    return null;
  }
}

async function getChannelMessageByBirdName(birdName) {
  try {
    const { data, error } = await supabase
      .from('channel_messages')
      .select('*')
      .ilike('bird_name', birdName)
      .eq('is_deleted', false)
      .order('posted_at', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      throw error;
    }

    return data;
  } catch (err) {
    console.error('❌ getChannelMessageByBirdName error:', err);
    return null;
  }
}

async function markChannelMessageAsDeleted(messageId) {
  try {
    const { error } = await supabase
      .from('channel_messages')
      .update({
        is_deleted: true,
        deleted_at: getCurrentISODate()
      })
      .eq('message_id', messageId);

    if (error) throw error;

    console.log(`✅ Сообщение ${messageId} помечено как удаленное`);
    return true;
  } catch (err) {
    console.error('❌ markChannelMessageAsDeleted error:', err);
    return false;
  }
}

async function deleteChannelMessageRecord(messageId) {
  try {
    const { error } = await supabase
      .from('channel_messages')
      .delete()
      .eq('message_id', messageId);

    if (error) throw error;

    console.log(`✅ Запись о сообщении ${messageId} удалена из базы`);
    return true;
  } catch (err) {
    console.error('❌ deleteChannelMessageRecord error:', err);
    return false;
  }
}

// Обновленная функция deleteBirdFromChannel с удалением из Telegram
async function deleteBirdFromChannel() {
  try {
    console.log('🗑️ Начинаю удаление последнего поста...');

    // 1. Получаем последнее сообщение из channel_messages
    const { data: lastMessage, error: messageError } = await supabase
      .from('channel_messages')
      .select('*')
      .eq('is_deleted', false)
      .order('posted_at', { ascending: false })
      .limit(1)
      .single();

    if (messageError || !lastMessage) {
      console.log('⚠️ Нет сохраненных сообщений в channel_messages');
      return {
        success: false,
        error: 'Нет сообщений для удаления',
        deletedRecord: false
      };
    }

    const { bird_name, message_id, chat_id } = lastMessage;

    if (!bird_name || bird_name === 'undefined') {
      console.log('❌ Ошибка: bird_name is undefined');
      return {
        success: false,
        error: 'Некорректное название птицы',
        deletedRecord: false
      };
    }

    console.log(`🗑️ Удаляю пост: "${bird_name}" (message_id: ${message_id}, chat: ${chat_id})`);

    // 2. Удаляем сообщение из Telegram
    let telegramDeleted = false;
    try {
      const telegramResult = await deleteMessageFromTelegram(chat_id, message_id);
      telegramDeleted = telegramResult.ok;
    } catch (telegramError) {
      console.error('❌ Ошибка удаления из Telegram:', telegramError.message);
    }

    // 3. Помечаем сообщение как удаленное в базе
    const marked = await markChannelMessageAsDeleted(message_id);

    // 4. Удаляем птицу из истории публикаций
    let historyDeleted = false;
    try {
      historyDeleted = await deleteBirdFromHistory(bird_name);
    } catch (historyError) {
      console.error('❌ Ошибка удаления из истории:', historyError.message);
    }

    // 5. Сохраняем запись об удалении
    let deletedRecord = false;
    try {
      // Проверяем, существует ли таблица deleted_posts
      const { error: checkError } = await supabase
        .from('deleted_posts')
        .select('id')
        .limit(1);

      if (checkError && checkError.code === '42P01') {
        console.log('📋 Таблица deleted_posts не существует, пропускаем архивацию');
      } else {
        // Получаем ID птицы
        const { data: birdData } = await supabase
          .from('birds')
          .select('id')
          .eq('name', bird_name)
          .single();

        const birdId = birdData?.id || 0;

        // Добавляем запись
        const { error: archiveError } = await supabase
          .from('deleted_posts')
          .insert([{
            bird_name: bird_name,
            bird_id: birdId,
            message_id: message_id,
            telegram_deleted: telegramDeleted,
            history_deleted: historyDeleted,
            deleted_at: getCurrentISODate(),
            reason: 'Удалено администратором'
          }]);

        if (!archiveError) {
          deletedRecord = true;
          console.log(`📋 Удаление заархивировано в deleted_posts`);
        } else {
          console.error('❌ Ошибка архивации:', archiveError);
        }
      }
    } catch (archiveException) {
      console.warn('⚠️ Ошибка при попытке архивации:', archiveException.message);
    }

    return {
      success: true,
      birdName: bird_name,
      messageId: message_id,
      telegramDeleted: telegramDeleted,
      historyDeleted: historyDeleted,
      deletedRecord: deletedRecord, // ← ВАЖНО: передаем эту переменную
      timestamp: getCurrentISODate()
    };

  } catch (error) {
    console.error('❌ Критическая ошибка удаления:', error);
    return {
      success: false,
      error: error.message || 'Неизвестная ошибка при удалении',
      deletedRecord: false
    };
  }
}

// Вспомогательная функция: удаление только из истории (если нет message_id)
async function deleteBirdFromHistoryOnly() {
  try {
    console.log('🔄 Пробую удалить только из истории...');

    // Простой запрос без сложного JOIN
    const { data: lastHistory, error: historyError } = await supabase
      .from('bird_history')
      .select('id, bird_id, posted_at')
      .order('posted_at', { ascending: false })
      .limit(1)
      .single();

    if (historyError) {
      console.error('❌ Ошибка получения истории:', historyError);
      return { success: false, error: 'Не удалось получить историю' };
    }

    if (!lastHistory) {
      return { success: false, error: 'Нет истории для удаления' };
    }

    const historyId = lastHistory.id;

    // Получаем название птицы
    const { data: birdData } = await supabase
      .from('birds')
      .select('name')
      .eq('id', lastHistory.bird_id)
      .single();

    const birdName = birdData?.name || 'Неизвестная птица';

    // Удаляем из истории
    const { error: deleteError } = await supabase
      .from('bird_history')
      .delete()
      .eq('id', historyId);

    if (deleteError) {
      console.error('❌ Ошибка удаления из истории:', deleteError);
      return { success: false, error: `Не удалось удалить из истории: ${deleteError.message}` };
    }

    console.log(`✅ Птица удалена из истории: ${birdName} (${getFormattedTime()})`);

    return {
      success: true,
      birdName: birdName,
      historyDeleted: true,
      telegramDeleted: false,
      timestamp: getCurrentISODate()
    };

  } catch (error) {
    console.error('❌ Ошибка удаления из истории:', error);
    return { success: false, error: error.message };
  }
}

// Вспомогательная функция: удаление птицы из истории
async function deleteBirdFromHistory(birdName) {
  try {
    // Сначала находим ID птицы
    const { data: birdData } = await supabase
      .from('birds')
      .select('id')
      .eq('name', birdName)
      .single();

    if (!birdData) {
      console.log(`⚠️ Птица "${birdName}" не найдена в таблице birds`);
      return false;
    }

    // Удаляем из истории
    const { error } = await supabase
      .from('bird_history')
      .delete()
      .eq('bird_id', birdData.id);

    if (error) {
      console.error(`❌ Ошибка удаления птицы "${birdName}" из истории:`, error);
      return false;
    }

    console.log(`✅ Птица "${birdName}" удалена из истории`);
    return true;
  } catch (err) {
    console.error(`❌ Ошибка удаления из истории для "${birdName}":`, err);
    return false;
  }
}

// ====== ФУНКЦИИ ДЛЯ ПРЕДЛОЖЕНИЙ ======
async function saveBirdSuggestion(userId, username, birdName) {
  try {
    console.log(`🦜 Сохранение предложения от ${userId}: ${birdName}`);

    // Проверяем, не спамит ли пользователь
    const lastHour = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const { count: recentCount, error: countError } = await supabase
      .from('bird_suggestions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', lastHour);

    if (countError) throw countError;

    if (recentCount >= 5) {
      return {
        success: false,
        error: 'Вы отправили слишком много предложений за последний час. Подождите немного.',
        suggestionId: null
      };
    }

    const suggestionId = `sug_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    const suggestion = {
      id: suggestionId,
      user_id: userId,
      username: username || `user_${userId}`,
      bird_name: birdName.trim(),
      status: 'pending',
      created_at: getCurrentISODate()
    };

    const { data, error } = await supabase
      .from('bird_suggestions')
      .insert([suggestion])
      .select();

    if (error) throw error;

    console.log(`✅ Предложение сохранено: ${suggestionId}`);
    return {
      success: true,
      suggestionId: suggestionId,
      suggestion: data[0]
    };

  } catch (err) {
    console.error('❌ saveBirdSuggestion error:', err);
    return {
      success: false,
      error: 'Не удалось сохранить предложение',
      suggestionId: null
    };
  }
}

async function getPendingSuggestions() {
  try {
    const { data, error } = await supabase
      .from('bird_suggestions')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('❌ getPendingSuggestions error:', err);
    return [];
  }
}

async function getUserSuggestions(userId) {
  try {
    const { data, error } = await supabase
      .from('bird_suggestions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const suggestions = data || [];
    suggestions.forEach(suggestion => {
      if (suggestion.created_at) {
        suggestion.display_date = getFormattedDate(suggestion.created_at);
      }
    });

    return suggestions;
  } catch (err) {
    console.error('❌ getUserSuggestions error:', err);
    return [];
  }
}

async function approveSuggestion(suggestionId, adminId) {
  try {
    console.log(`✅ Одобрение предложения: ${suggestionId}`);

    const { data: suggestion, error: updateError } = await supabase
      .from('bird_suggestions')
      .update({
        status: 'approved',
        admin_action: 'approved',
        admin_id: adminId,
        updated_at: getCurrentISODate()
      })
      .eq('id', suggestionId)
      .eq('status', 'pending')
      .select()
      .single();

    if (updateError) {
      console.error('❌ Ошибка обновления suggestion:', updateError);
      return { success: false, error: updateError.message };
    }

    if (!suggestion) {
      return { success: false, error: 'NOT_FOUND' };
    }

    const priorityBird = {
      suggestion_id: suggestionId,
      bird_name: suggestion.bird_name,
      user_id: suggestion.user_id,
      username: suggestion.username,
      used: false,
      created_at: getCurrentISODate()
    };

    const { error: priorityError } = await supabase
      .from('priority_birds')
      .insert([priorityBird]);

    if (priorityError) {
      console.error('❌ Ошибка создания priority bird:', priorityError);
      return { success: false, error: priorityError.message };
    }

    console.log(`✅ Предложение одобрено: ${suggestion.bird_name}`);

    return {
      success: true,
      birdName: suggestion.bird_name,
      suggestion: suggestion,
      priorityBird: priorityBird
    };

  } catch (error) {
    console.error('❌ approveSuggestion error:', error);
    return { success: false, error: error.message };
  }
}

async function rejectSuggestion(suggestionId, adminId, reason = null) {
  try {
    console.log(`❌ Отклонение предложения: ${suggestionId}`);

    const { data: suggestion, error } = await supabase
      .from('bird_suggestions')
      .update({
        status: 'rejected',
        admin_action: 'rejected',
        admin_id: adminId,
        rejection_reason: reason,
        updated_at: getCurrentISODate()
      })
      .eq('id', suggestionId)
      .eq('status', 'pending')
      .select()
      .single();

    if (error) throw error;

    if (!suggestion) {
      return { success: false, error: 'NOT_FOUND' };
    }

    console.log(`✅ Предложение отклонено: ${suggestion.bird_name}`);
    return {
      success: true,
      birdName: suggestion.bird_name,
      suggestion: suggestion
    };

  } catch (err) {
    console.error('❌ rejectSuggestion error:', err);
    return { success: false, error: err.message };
  }
}

async function getSuggestionById(suggestionId) {
  try {
    const { data, error } = await supabase
      .from('bird_suggestions')
      .select('*')
      .eq('id', suggestionId)
      .single();

    if (error) throw error;
    return data;
  } catch (err) {
    console.error('❌ getSuggestionById error:', err);
    return null;
  }
}

async function isDuplicateSuggestion(userId, birdName) {
  try {
    const { data, error } = await supabase
      .from('bird_suggestions')
      .select('*')
      .eq('user_id', userId)
      .eq('bird_name', birdName)
      .in('status', ['pending', 'approved']);

    if (error) throw error;
    return data && data.length > 0;
  } catch (err) {
    console.error('❌ isDuplicateSuggestion error:', err);
    return false;
  }
}

async function getSuggestionsStats() {
  try {
    const [
      { count: pendingCount },
      { count: approvedCount },
      { count: rejectedCount }
    ] = await Promise.all([
      supabase
        .from('bird_suggestions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending'),
      supabase
        .from('bird_suggestions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'approved'),
      supabase
        .from('bird_suggestions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'rejected')
    ]);

    const total = pendingCount + approvedCount + rejectedCount;

    return {
      pending: pendingCount,
      approved: approvedCount,
      rejected: rejectedCount,
      total: total
    };

  } catch (err) {
    console.error('❌ getSuggestionsStats error:', err);
    return { pending: 0, approved: 0, rejected: 0, total: 0 };
  }
}

// ====== ФУНКЦИИ ДЛЯ ПРИОРИТЕТНЫХ ПТИЦ ======
async function getPriorityBird() {
  try {
    console.log('🎯 Получаю приоритетную птицу...');

    const { data, error } = await supabase
      .from('priority_birds')
      .select(`
        id,
        suggestion_id,
        bird_name,
        user_id,
        username,
        used,
        used_at,
        created_at,
        bird_suggestions!left (
          id,
          user_id,
          username,
          bird_name,
          status
        )
      `)
      .eq('used', false)
      .order('created_at', { ascending: true })
      .limit(1);

    if (error) {
      console.error('❌ Ошибка SQL при получении приоритетной птицы:', error);
      throw error;
    }

    if (!data || data.length === 0) {
      console.log('📝 Приоритетных птиц не найдено');
      return null;
    }

    const priorityBird = data[0];

    console.log(`✅ Найдена приоритетная птица: ${priorityBird.bird_name}`);

    return priorityBird;

  } catch (error) {
    console.error('❌ Критическая ошибка в getPriorityBird:', error);
    return null;
  }
}

/**
 * Получить приоритетную птицу с одобренным пользовательским фото
 */
async function getPriorityBirdWithPhoto() {
  try {
    console.log('🎯📸 Получаю приоритетную птицу с фото...');

    // Получаем все неиспользованные приоритетные птицы
    const { data: priorityBirds, error: priorityError } = await supabase
      .from('priority_birds')
      .select('*')
      .eq('used', false)
      .order('created_at', { ascending: true });

    if (priorityError) {
      console.error('❌ Ошибка получения приоритетных птиц:', priorityError);
      return null;
    }

    if (!priorityBirds || priorityBirds.length === 0) {
      console.log('📝 Приоритетных птиц не найдено');
      return null;
    }

    // Проверяем каждую приоритетную птицу на наличие одобренного фото
    for (const bird of priorityBirds) {
      // Ищем одобренное фото для этой птицы
      // Используем ilike для регистронезависимого поиска
      const { data: photos, error: photoError } = await supabase
        .from('user_submitted_photos')
        .select('*')
        .ilike('bird_name', bird.bird_name)
        .eq('status', 'approved')
        .eq('used_in_post', false)
        .order('reviewed_at', { ascending: true })
        .limit(1);

      if (photoError) {
        console.warn(`⚠️ Ошибка поиска фото для ${bird.bird_name}:`, photoError.message);
        continue;
      }

      if (photos && photos.length > 0) {
        const photo = photos[0];
        console.log(`✅ Найдена приоритетная птица с фото: ${bird.bird_name} (Photo ID: ${photo.id})`);
        return {
          ...bird,
          userPhoto: photo
        };
      }
    }

    console.log('📝 Приоритетных птиц с фото не найдено');
    return null;

  } catch (error) {
    console.error('❌ Критическая ошибка в getPriorityBirdWithPhoto:', error);
    return null;
  }
}


async function markPriorityBirdAsUsed(priorityBirdId) {
  try {
    console.log(`🎯 Помечаю приоритетную птицу как использованную: ${priorityBirdId}`);

    // Определяем тип идентификатора
    let updateResult;

    // Если передан объект с id (из getPriorityBird)
    if (typeof priorityBirdId === 'object' && priorityBirdId !== null && priorityBirdId.id) {
      console.log(`   Использую ID из объекта: ${priorityBirdId.id}`);
      updateResult = await supabase
        .from('priority_birds')
        .update({
          used: true,
          used_at: getCurrentISODate()
        })
        .eq('id', priorityBirdId.id);
    }
    // Если передано число - это ID из priority_birds
    else if (typeof priorityBirdId === 'number' || (!isNaN(parseInt(priorityBirdId)) && priorityBirdId !== null)) {
      const id = typeof priorityBirdId === 'number' ? priorityBirdId : parseInt(priorityBirdId);
      console.log(`   Использую числовой ID: ${id}`);
      updateResult = await supabase
        .from('priority_birds')
        .update({
          used: true,
          used_at: getCurrentISODate()
        })
        .eq('id', id);
    }
    // Если передана строка suggestion_id (sug_... или photo_...)
    else if (typeof priorityBirdId === 'string' && (priorityBirdId.startsWith('sug_') || priorityBirdId.startsWith('photo_'))) {
      console.log(`   Использую suggestion_id: ${priorityBirdId}`);
      updateResult = await supabase
        .from('priority_birds')
        .update({
          used: true,
          used_at: getCurrentISODate()
        })
        .eq('suggestion_id', priorityBirdId);
    }
    // Fallback: используем как название птицы (только первую неиспользованную)
    else if (priorityBirdId) {
      console.log(`   Использую название птицы: ${priorityBirdId}`);
      // Сначала находим первую неиспользованную птицу с таким названием
      const { data: birds } = await supabase
        .from('priority_birds')
        .select('id')
        .eq('bird_name', priorityBirdId)
        .eq('used', false)
        .order('created_at', { ascending: true })
        .limit(1);

      if (birds && birds.length > 0) {
        updateResult = await supabase
          .from('priority_birds')
          .update({
            used: true,
            used_at: getCurrentISODate()
          })
          .eq('id', birds[0].id);
      } else {
        console.warn(`⚠️ Не найдена неиспользованная приоритетная птица с названием: ${priorityBirdId}`);
        return false;
      }
    }
    else {
      console.error('❌ Некорректный идентификатор приоритетной птицы:', priorityBirdId);
      return false;
    }

    if (updateResult.error) {
      console.error('❌ Ошибка обновления priority_birds:', updateResult.error);
      throw updateResult.error;
    }

    console.log(`✅ Приоритетная птица помечена как использованная`);
    return true;

  } catch (error) {
    console.error('❌ Ошибка в markPriorityBirdAsUsed:', error);
    return false;
  }
}

// ====== ФУНКЦИИ ДЛЯ ПОЛЬЗОВАТЕЛЬСКИХ ФОТО ======

/**
 * Сохранить фото, отправленное пользователем
 */
async function saveUserPhoto(userId, username, birdName, photoFileId, photoUrl = null) {
  try {
    console.log(`📸 Сохранение фото от ${username}: ${birdName}`);

    const photoData = {
      user_id: userId.toString(),
      username: username || `user_${userId}`,
      bird_name: birdName.trim(),
      photo_file_id: photoFileId,
      photo_url: photoUrl,
      status: 'pending',
      created_at: getCurrentISODate()
    };

    const { data, error } = await supabase
      .from('user_submitted_photos')
      .insert([photoData])
      .select()
      .single();

    if (error) throw error;

    console.log(`✅ Фото сохранено: ID ${data.id}`);
    return {
      success: true,
      photoId: data.id,
      photo: data
    };

  } catch (err) {
    console.error('❌ saveUserPhoto error:', err);
    return {
      success: false,
      error: 'Не удалось сохранить фото',
      photoId: null
    };
  }
}

/**
 * Получить ожидающие фото для модерации
 */
async function getPendingPhotoSubmissions() {
  try {
    const { data, error } = await supabase
      .from('user_submitted_photos')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('❌ getPendingPhotoSubmissions error:', err);
    return [];
  }
}

/**
 * Получить фото пользователя
 */
async function getUserPhotoSubmissions(userId) {
  try {
    const { data, error } = await supabase
      .from('user_submitted_photos')
      .select('*')
      .eq('user_id', userId.toString())
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('❌ getUserPhotoSubmissions error:', err);
    return [];
  }
}

/**
 * Одобрить фото
 */
async function approvePhotoSubmission(photoId, adminId) {
  try {
    console.log(`✅ Одобрение фото: ${photoId}`);

    const { data: photo, error } = await supabase
      .from('user_submitted_photos')
      .update({
        status: 'approved',
        admin_id: adminId.toString(),
        reviewed_at: getCurrentISODate()
      })
      .eq('id', photoId)
      .eq('status', 'pending')
      .select()
      .single();

    if (error) throw error;

    // Автоматически создаем приоритетную птицу для одобренного фото
    console.log(`🎯 Создаю приоритетную птицу для: ${photo.bird_name}`);

    // Проверяем, нет ли уже такой приоритетной птицы
    const { data: existingPriority } = await supabase
      .from('priority_birds')
      .select('id')
      .eq('bird_name', photo.bird_name)
      .eq('used', false)
      .limit(1);

    if (!existingPriority || existingPriority.length === 0) {
      // 1. Сначала создаем запись в bird_suggestions, чтобы соблюсти FK
      const suggestionId = `photo_${photo.id}`;

      const { error: suggestionError } = await supabase
        .from('bird_suggestions')
        .insert([{
          id: suggestionId,
          user_id: photo.user_id,
          username: photo.username,
          bird_name: photo.bird_name,
          status: 'approved',
          created_at: getCurrentISODate()
        }]);

      if (suggestionError) {
        // Если ошибка дубликата - игнорируем, иначе логируем
        if (suggestionError.code !== '23505') {
          console.warn(`⚠️ Ошибка создания suggestion для фото:`, suggestionError.message);
        }
      }

      // 2. Создаем новую приоритетную птицу
      const { error: priorityError } = await supabase
        .from('priority_birds')
        .insert([{
          bird_name: photo.bird_name,
          user_id: photo.user_id,
          username: photo.username,
          suggestion_id: suggestionId,
          used: false,
          created_at: getCurrentISODate()
        }]);

      if (priorityError) {
        console.warn(`⚠️ Не удалось создать priority_bird для ${photo.bird_name}:`, priorityError.message);
        // Не критично, продолжаем
      } else {
        console.log(`✅ Приоритетная птица создана: ${photo.bird_name}`);
      }
    } else {
      console.log(`ℹ️ Приоритетная птица уже существует: ${photo.bird_name} (ID: ${existingPriority[0].id})`);
    }

    console.log(`✅ Фото одобрено: ${photo.bird_name}`);
    return {
      success: true,
      photo: photo
    };

  } catch (error) {
    console.error('❌ approvePhotoSubmission error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Отклонить фото
 */
async function rejectPhotoSubmission(photoId, adminId, reason = null) {
  try {
    console.log(`❌ Отклонение фото: ${photoId}`);

    const { data: photo, error } = await supabase
      .from('user_submitted_photos')
      .update({
        status: 'rejected',
        admin_id: adminId.toString(),
        rejection_reason: reason,
        reviewed_at: getCurrentISODate()
      })
      .eq('id', photoId)
      .eq('status', 'pending')
      .select()
      .single();

    if (error) throw error;

    console.log(`❌ Фото отклонено: ${photo.bird_name}`);
    return {
      success: true,
      photo: photo
    };

  } catch (error) {
    console.error('❌ rejectPhotoSubmission error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Получить одобренное фото для птицы
 */
async function getApprovedPhotoForBird(birdName) {
  try {
    const { data, error } = await supabase
      .from('user_submitted_photos')
      .select('*')
      .eq('bird_name', birdName)
      .eq('status', 'approved')
      .eq('used_in_post', false)
      .order('reviewed_at', { ascending: true })
      .limit(1)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null; // Нет фото
      }
      throw error;
    }

    return data;
  } catch (err) {
    console.error('❌ getApprovedPhotoForBird error:', err);
    return null;
  }
}

/**
 * Отметить фото как использованное
 */
async function markPhotoAsUsed(photoId) {
  try {
    const { error } = await supabase
      .from('user_submitted_photos')
      .update({
        used_in_post: true,
        used_at: getCurrentISODate()
      })
      .eq('id', photoId);

    if (error) throw error;

    console.log(`✅ Фото ${photoId} отмечено как использованное`);
    return true;
  } catch (err) {
    console.error('❌ markPhotoAsUsed error:', err);
    return false;
  }
}

/**
 * Получить статистику по фото
 */
async function getPhotoSubmissionsStats() {
  try {
    const { count: totalCount, error: totalError } = await supabase
      .from('user_submitted_photos')
      .select('*', { count: 'exact', head: true });

    const { count: pendingCount, error: pendingError } = await supabase
      .from('user_submitted_photos')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    const { count: approvedCount, error: approvedError } = await supabase
      .from('user_submitted_photos')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'approved');

    const { count: usedCount, error: usedError } = await supabase
      .from('user_submitted_photos')
      .select('*', { count: 'exact', head: true })
      .eq('used_in_post', true);

    if (totalError || pendingError || approvedError || usedError) {
      throw totalError || pendingError || approvedError || usedError;
    }

    return {
      total: totalCount || 0,
      pending: pendingCount || 0,
      approved: approvedCount || 0,
      used: usedCount || 0
    };
  } catch (err) {
    console.error('❌ getPhotoSubmissionsStats error:', err);
    return {
      total: 0,
      pending: 0,
      approved: 0,
      used: 0
    };
  }
}


// ====== ФУНКЦИИ ДЛЯ ИСТОРИИ СООБЩЕНИЙ ======
async function saveBotMessage(chatId, userId, messageText, messageType, context = null, messageId = null) {
  try {
    const { data, error } = await supabase
      .from('bot_message_history')
      .insert([{
        chat_id: chatId,
        user_id: userId,
        message_text: messageText,
        message_type: messageType,
        context: context,
        message_id: messageId,
        created_at: getCurrentISODate()
      }])
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (err) {
    console.error('❌ saveBotMessage error:', err);
    return null;
  }
}

async function getMessageContext(chatId, messageTypes = ['bot_reply', 'user_message'], limit = 10) {
  try {
    const { data, error } = await supabase
      .from('bot_message_history')
      .select('*')
      .eq('chat_id', chatId)
      .in('message_type', messageTypes)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return data || [];
  } catch (err) {
    console.error('❌ getMessageContext error:', err);
    return [];
  }
}

async function clearOldMessages(daysToKeep = 7) {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const { error } = await supabase
      .from('bot_message_history')
      .delete()
      .lt('created_at', cutoffDate.toISOString());

    if (error) throw error;

    console.log(`✅ Удалены старые сообщения (старше ${daysToKeep} дней)`);
    return true;
  } catch (err) {
    console.error('❌ clearOldMessages error:', err);
    return false;
  }
}

// Логирование

async function cacheBirdImage(birdName, imageUrl, source = 'unknown') {
  try {
    const { error } = await supabase
      .from('bird_images_cache')
      .upsert({
        bird_name: birdName,
        image_url: imageUrl,
        source: source,
        cached_at: getCurrentISODate(),
        last_used: getCurrentISODate(),
        use_count: 1
      }, {
        onConflict: 'bird_name,image_url',
        ignoreDuplicates: false
      });

    if (error) throw error;

    console.log(`💾 Кешировано фото для "${birdName}" (источник: ${source})`);
    return true;
  } catch (error) {
    console.log('⚠️ Ошибка кеширования фото:', error.message);
    return false;
  }
}

async function getCachedBirdImage(birdName) {
  try {
    const { data, error } = await supabase
      .from('bird_images_cache')
      .select('image_url, source, use_count')
      .eq('bird_name', birdName)
      .order('cached_at', { ascending: false })
      .limit(3);

    if (error) throw error;

    if (data && data.length > 0) {
      // Выбираем наиболее подходящее фото
      const bestImage = selectBestCachedImage(data);

      // Обновляем счетчик использования
      await supabase
        .from('bird_images_cache')
        .update({
          last_used: getCurrentISODate(),
          use_count: (bestImage.use_count || 0) + 1
        })
        .eq('bird_name', birdName)
        .eq('image_url', bestImage.image_url);

      console.log(`✅ Использую кешированное фото для ${birdName} (источник: ${bestImage.source})`);
      return bestImage.image_url;
    }

    return null;
  } catch (error) {
    console.log('⚠️ Ошибка получения кешированного фото:', error.message);
    return null;
  }
}

function selectBestCachedImage(images) {
  // Сортируем по приоритету: последние > популярные > качественные источники
  const sourcePriority = {
    'wikipedia': 3,
    'wikimedia': 3,
    'inaturalist': 2,
    'gemini': 1,
    'default': 0
  };

  return images.sort((a, b) => {
    const aPriority = sourcePriority[a.source] || 0;
    const bPriority = sourcePriority[b.source] || 0;

    if (aPriority !== bPriority) return bPriority - aPriority;
    return (b.use_count || 0) - (a.use_count || 0);
  })[0];
}

async function logImageSourceStat(source, birdName, success, responseTime) {
  try {
    await supabase
      .from('image_source_stats')
      .insert({
        source: source,
        bird_name: birdName,
        success: success,
        response_time_ms: responseTime,
        accessed_at: getCurrentISODate()
      });
  } catch (error) {
    console.log('⚠️ Ошибка логирования статистики:', error.message);
  }
}

async function logBirdSelection(birdName, source, hasPhoto, success = true) {
  try {
    await supabase
      .from('bird_selection_history')
      .insert({
        bird_name: birdName,
        source: source,
        has_photo: hasPhoto,
        success: success,
        selected_at: getCurrentISODate()
      });
  } catch (error) {
    console.log('⚠️ Ошибка логирования выбора птицы:', error.message);
  }
}

// ====== ФУНКЦИИ ДЛЯ GEMINI ALTERNATIVES ======

/**
 * Сохранить альтернативное название птицы от Gemini
 */
async function saveGeminiAlternative(birdName) {
  try {
    const { error } = await supabase
      .from('gemini_alternatives')
      .insert({
        bird_name: birdName,
        created_at: getCurrentISODate()
      });

    if (error) {
      // Игнорируем ошибку дубликата (UNIQUE constraint)
      if (error.code !== '23505') {
        console.log('⚠️ Ошибка сохранения альтернативы Gemini:', error.message);
      }
    } else {
      console.log(`✅ Сохранена альтернатива Gemini: ${birdName}`);
    }
  } catch (error) {
    console.log('⚠️ Ошибка saveGeminiAlternative:', error.message);
  }
}

/**
 * Получить все альтернативные названия от Gemini
 */
async function getGeminiAlternatives(limit = 100) {
  try {
    const { data, error } = await supabase
      .from('gemini_alternatives')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.log('⚠️ Ошибка getGeminiAlternatives:', error.message);
    return [];
  }
}

/**
 * Проверить, есть ли птица в альтернативах Gemini
 */
async function isGeminiAlternative(birdName) {
  try {
    const { data, error } = await supabase
      .from('gemini_alternatives')
      .select('id')
      .eq('bird_name', birdName)
      .limit(1);

    if (error) throw error;
    return data && data.length > 0;
  } catch (error) {
    console.log('⚠️ Ошибка isGeminiAlternative:', error.message);
    return false;
  }
}

// ====== ЭКСПОРТ ======
export {
  initializeSupabase,
  getAllBirds,
  addBird,
  isBirdInDatabase,
  saveBirdFacts,
  getBirdFacts,
  getAllBirdFacts,
  getWeeklyBirds,
  updateBirdHistory,
  getBirdsCount,
  saveBirdSuggestion,
  getPendingSuggestions,
  getUserSuggestions,
  approveSuggestion,
  rejectSuggestion,
  getSuggestionById,
  isDuplicateSuggestion,
  getSuggestionsStats,
  getAllTimeBirds,
  getPriorityBird,
  getPriorityBirdWithPhoto,
  markPriorityBirdAsUsed,
  deleteBirdFromChannel,
  getDeletedPostsStats,
  saveBotMessage,
  getMessageContext,
  clearOldMessages,
  saveChannelMessage,
  getLastChannelMessage,
  getChannelMessageByBirdName,
  markChannelMessageAsDeleted,
  deleteChannelMessageRecord,
  deleteBirdFromHistoryOnly,
  deleteBirdFromHistory,
  // User photo functions
  saveUserPhoto,
  getPendingPhotoSubmissions,
  getUserPhotoSubmissions,
  approvePhotoSubmission,
  rejectPhotoSubmission,
  getApprovedPhotoForBird,
  markPhotoAsUsed,
  getPhotoSubmissionsStats,
  logImageSourceStat,
  logBirdSelection,
  cacheBirdImage,
  getCachedBirdImage
};