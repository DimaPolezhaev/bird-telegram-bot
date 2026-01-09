// set-bot-commands.js - Настройка команд бота
import { fetch } from 'undici';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "8549980803:AAG6OKU_Kh8DYhoTbCydkxylClYKWlk8H7o";
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

console.log(`🛠 [COMMANDS] ${getFormattedTime()} - Настраиваю команды бота...`);

async function setBotCommands() {
  try {
    const commands = [
      { command: "bird", description: "🦜 Предложить птицу для поста" },
      { command: "mysuggestions", description: "📋 Мои предложения и их статус" },
      { command: "stats", description: "📊 Статистика бота и предложений" },
      { command: "help", description: "❓ Помощь и список команд" }
    ];
    
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/setMyCommands`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commands: commands,
        language_code: "ru"
      })
    });
    
    const result = await response.json();
    
    if (result.ok) {
      console.log(`✅ [COMMANDS] ${getFormattedTime()} - Основные команды установлены!`);
      console.log('┌─────────────────┬──────────────────────┐');
      console.log('│ 🦜 /bird        │ 📋 /mysuggestions    │');
      console.log('├─────────────────┼──────────────────────┤');
      console.log('│ 📊 /stats       │ ❓ /help             │');
      console.log('└─────────────────┴──────────────────────┘');
    } else {
      console.log(`❌ [COMMANDS] ${getFormattedTime()} - Ошибка:`, result.description);
    }
    
    return result;
    
  } catch (error) {
    console.error(`❌ [COMMANDS] ${getFormattedTime()} - Ошибка:`, error.message);
    return { ok: false };
  }
}

async function setAdminCommands() {
  try {
    const adminCommands = [
      { command: "bird", description: "🦜 Предложить птицу" },
      { command: "mysuggestions", description: "📋 Мои предложения" },
      { command: "stats", description: "📊 Статистика" },
      { command: "help", description: "❓ Помощь" },
      { command: "pending", description: "👑 Ожидающие предложения" }
    ];
    
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/setMyCommands`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commands: adminCommands,
        language_code: "ru",
        scope: {
          type: "chat",
          chat_id: parseInt(ADMIN_ID)
        }
      })
    });
    
    const result = await response.json();
    
    if (result.ok) {
      console.log(`✅ [COMMANDS] ${getFormattedTime()} - Админские команды установлены!`);
      console.log('Админские команды:');
      console.log('• /pending - посмотреть ожидающие предложения');
    } else {
      console.log(`⚠️ [COMMANDS] ${getFormattedTime()} - Не удалось установить админские команды`);
    }
    
    return result;
    
  } catch (error) {
    console.log(`⚠️ [COMMANDS] ${getFormattedTime()} - Ошибка админских команд:`, error.message);
    return { ok: false };
  }
}

async function getCurrentCommands() {
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getMyCommands`;
    const response = await fetch(url);
    const result = await response.json();
    
    if (result.ok) {
      console.log(`📋 [COMMANDS] ${getFormattedTime()} - Текущие команды:`);
      result.result.forEach(cmd => {
        console.log(`  /${cmd.command} - ${cmd.description}`);
      });
    }
    
    return result;
  } catch (error) {
    console.error(`❌ [COMMANDS] ${getFormattedTime()} - Ошибка получения команд:`, error.message);
  }
}

async function checkBotPermissions() {
  try {
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "8549980803:AAG6OKU_Kh8DYhoTbCydkxylClYKWlk8H7o";
    const CHANNEL_ID = process.env.TELEGRAM_CHANNEL || "@PeroZhizni";
    
    console.log(`🔐 ${getFormattedTime()} - Проверяю права бота в канале...`);
    console.log(`🤖 Бот ID: ${BOT_TOKEN.split(':')[0]}`);
    console.log(`📢 Канал: ${CHANNEL_ID}`);
    
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember`;
    const botId = BOT_TOKEN.split(':')[0];
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHANNEL_ID,
        user_id: parseInt(botId)
      })
    });
    
    const result = await response.json();
    
    if (result.ok) {
      const member = result.result;
      console.log(`📊 ${getFormattedTime()} - Статус бота в канале:`);
      console.log(`   Статус: ${member.status}`);
      console.log(`   Права на удаление: ${member.can_delete_messages ? '✅ Есть' : '❌ Нет'}`);
      console.log(`   Права на публикацию: ${member.can_post_messages ? '✅ Есть' : '❌ Нет'}`);
      console.log(`   Права на закрепление: ${member.can_pin_messages ? '✅ Есть' : '❌ Нет'}`);
      
      if (member.status !== 'administrator' && member.status !== 'creator') {
        console.log(`\n⚠️ ${getFormattedTime()} - ВНИМАНИЕ: Бот не является администратором!`);
        console.log(`   Для удаления сообщений сделайте бота администратором в канале.`);
        console.log(`   Инструкция:`);
        console.log(`   1. Зайдите в настройки канала @PeroZhizni`);
        console.log(`   2. "Администраторы" → "Добавить администратора"`);
        console.log(`   3. Найдите бота по имени`);
        console.log(`   4. Включите права "Delete messages"`);
        console.log(`   5. Сохраните изменения\n`);
      } else if (!member.can_delete_messages) {
        console.log(`\n⚠️ ${getFormattedTime()} - ВНИМАНИЕ: Бот не может удалять сообщения!`);
        console.log(`   Дайте боту права "Delete messages" в настройках канала.\n`);
      } else {
        console.log(`\n✅ ${getFormattedTime()} - Отлично! Бот может удалять сообщения.\n`);
      }
    } else {
      console.log(`⚠️ ${getFormattedTime()} - Не удалось проверить права бота:`, result.description);
      console.log(`   Возможно, бот не добавлен в канал или неверный chat_id.`);
    }
    
    return result;
  } catch (error) {
    console.error(`❌ ${getFormattedTime()} - Ошибка проверки прав:`, error.message);
    return { ok: false };
  }
}

async function setup() {
  console.log(`🚀 [COMMANDS] ${getFormattedTime()} - Начинаю настройку команд бота`);
  console.log(`🤖 [COMMANDS] Бот: ${BOT_TOKEN.substring(0, 10)}...`);
  console.log(`👑 [COMMANDS] Админ: ${ADMIN_ID}`);
  console.log(`📢 [COMMANDS] Канал: ${CHANNEL_ID}`);
  
  await checkBotPermissions();
  await getCurrentCommands();
  await setBotCommands();
  await setAdminCommands();
  await getCurrentCommands();
  
  console.log(`\n🎉 [COMMANDS] ${getFormattedTime()} - Настройка команд завершена!`);
  console.log('\n📚 Краткая справка:');
  console.log('• Пользователи видят 4 основные команды в меню');
  console.log('• Админ видит дополнительную команду /pending');
  console.log('• Команды /approve и /reject скрыты от обычных пользователей');
  console.log('• Для быстрого действия админ может использовать кнопки в уведомлениях');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  setup().catch(console.error);
}

export default {
  setBotCommands,
  setAdminCommands,
  getCurrentCommands
};