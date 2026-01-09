// setup-webhook.js - Настройка вебхука
import { fetch } from 'undici';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "8549980803:AAG6OKU_Kh8DYhoTbCydkxylClYKWlk8H7o";
const WEBHOOK_URL = process.env.WEBHOOK_URL || "https://bird-telegram-bot.vercel.app/api/bot";
const ADMIN_ID = process.env.ADMIN_ID || "923086138";

function getFormattedTime() {
  const now = new Date();
  const moscowTime = new Date(now.getTime() + (3 * 60 * 60 * 1000));
  return moscowTime.toLocaleTimeString('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function getFullDateTime() {
  const now = new Date();
  const moscowTime = new Date(now.getTime() + (3 * 60 * 60 * 1000));
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

console.log(`🌐 [WEBHOOK] ${getFormattedTime()} - Начинаю настройку вебхука...`);
console.log(`🤖 [WEBHOOK] Бот: ${BOT_TOKEN.substring(0, 10)}...`);
console.log(`🔗 [WEBHOOK] URL: ${WEBHOOK_URL}`);

async function deleteWebhook() {
  try {
    console.log(`🗑️ [WEBHOOK] ${getFormattedTime()} - Удаляю текущий вебхук`);
    
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`;
    const response = await fetch(url);
    const result = await response.json();
    
    if (result.ok) {
      console.log(`✅ [WEBHOOK] ${getFormattedTime()} - Вебхук удалён`);
    } else {
      console.log(`⚠️ [WEBHOOK] ${getFormattedTime()} - Вебхук уже удалён или не существует`);
    }
    
    return result;
  } catch (error) {
    console.error(`❌ [WEBHOOK] ${getFormattedTime()} - Ошибка удаления:`, error.message);
    return { ok: false };
  }
}

async function setWebhook() {
  try {
    console.log(`🌐 [WEBHOOK] ${getFormattedTime()} - Устанавливаю новый вебхук`);
    
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: WEBHOOK_URL,
        max_connections: 40,
        allowed_updates: ["message", "callback_query", "edited_message"]
      })
    });
    
    const result = await response.json();
    
    if (result.ok) {
      console.log(`✅ [WEBHOOK] ${getFormattedTime()} - Вебхук успешно установлен!`);
      console.log(`🔗 URL: ${WEBHOOK_URL}`);
      console.log(`📊 Max connections: 40`);
      console.log(`🔄 Allowed updates: message, callback_query, edited_message`);
    } else {
      console.log(`❌ [WEBHOOK] ${getFormattedTime()} - Ошибка установки:`, result.description);
    }
    
    return result;
  } catch (error) {
    console.error(`❌ [WEBHOOK] ${getFormattedTime()} - Ошибка установки:`, error.message);
    return { ok: false };
  }
}

async function getWebhookInfo() {
  try {
    console.log(`ℹ️ [WEBHOOK] ${getFormattedTime()} - Получаю информацию о вебхуке`);
    
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`;
    const response = await fetch(url);
    const result = await response.json();
    
    if (result.ok) {
      console.log(`📊 [WEBHOOK] ${getFormattedTime()} - Информация о вебхуке:`);
      console.log(`🔗 URL: ${result.result.url || 'Не установлен'}`);
      console.log(`✅ Работает: ${result.result.has_custom_certificate ? 'Да' : 'Нет'}`);
      console.log(`📊 Ожидающих обновлений: ${result.result.pending_update_count}`);
      console.log(`⏰ Последняя ошибка: ${result.result.last_error_date ? new Date(result.result.last_error_date * 1000).toLocaleString('ru-RU') : 'Нет'}`);
      console.log(`❌ Последнее сообщение об ошибке: ${result.result.last_error_message || 'Нет'}`);
    }
    
    return result;
  } catch (error) {
    console.error(`❌ [WEBHOOK] ${getFormattedTime()} - Ошибка получения информации:`, error.message);
  }
}

async function testWebhook() {
  try {
    console.log(`🧪 [WEBHOOK] ${getFormattedTime()} - Тестирую вебхук`);
    
    const testMessage = {
      message: {
        message_id: 999999,
        from: {
          id: parseInt(ADMIN_ID),
          is_bot: false,
          first_name: "Test",
          username: "test_user"
        },
        chat: {
          id: parseInt(ADMIN_ID),
          first_name: "Test",
          username: "test_user",
          type: "private"
        },
        date: Math.floor(Date.now() / 1000),
        text: "/test"
      }
    };
    
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testMessage)
    });
    
    const result = await response.json();
    
    if (result.ok) {
      console.log(`✅ [WEBHOOK] ${getFormattedTime()} - Вебхук работает корректно!`);
    } else {
      console.log(`⚠️ [WEBHOOK] ${getFormattedTime()} - Вебхук ответил с ошибкой:`, result);
    }
    
    return result;
  } catch (error) {
    console.error(`❌ [WEBHOOK] ${getFormattedTime()} - Ошибка тестирования:`, error.message);
    return { ok: false };
  }
}

async function setup() {
  console.log(`🚀 [WEBHOOK] ${getFormattedTime()} - Начинаю настройку вебхука`);
  console.log(`📅 Текущее время (Москва): ${getFullDateTime()}`);
  
  try {
    await getWebhookInfo();
    await deleteWebhook();
    await setWebhook();
    await getWebhookInfo();
    
    console.log(`\n🎉 [WEBHOOK] ${getFormattedTime()} - Настройка вебхука завершена!`);
    console.log(`\n📋 Сводка:`);
    console.log(`• Вебхук установлен: ${WEBHOOK_URL}`);
    console.log(`• Максимальное количество соединений: 40`);
    console.log(`• Разрешённые обновления: сообщения, callback-запросы, редактированные сообщения`);
    console.log(`• Текущее время сервера (Москва): ${getFullDateTime()}`);
    
    console.log(`\n⚠️ Важно:`);
    console.log(`• Убедитесь, что URL вебхука доступен из интернета`);
    console.log(`• Проверьте, что сервер может принимать POST-запросы`);
    console.log(`• Время настроено на московское (UTC+3)`);
    
  } catch (error) {
    console.error(`❌ [WEBHOOK] ${getFormattedTime()} - Критическая ошибка:`, error);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  setup().catch(console.error);
}

export default {
  deleteWebhook,
  setWebhook,
  getWebhookInfo,
  testWebhook
};