import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN2;

if (!BOT_TOKEN) {
  console.error('❌ [ProvinceBot COMMANDS] Не задан TELEGRAM_BOT_TOKEN2 в окружении');
  process.exit(1);
}

function getFormattedTime() {
  const now = new Date();
  const moscowTime = new Date(now.getTime());
  return moscowTime.toLocaleTimeString('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

console.log(`🛠 [ProvinceBot COMMANDS] ${getFormattedTime()} - Настраиваю команды ProvinceBot...`);

async function setProvinceBotCommands() {
  try {
    const commands = [
      { command: 'new_event', description: 'Создать событие' },
      { command: 'delete_event', description: 'Удалить событие' },
    ];

    const deleteUrl = `https://api.telegram.org/bot${BOT_TOKEN}/deleteMyCommands`;

    // 1. Обязательно удаляем старые команды для `ru`, иначе они перекрывают новые глобальные
    await fetch(deleteUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language_code: 'ru' })
    });

    // 2. Удаляем старые глобальные команды
    await fetch(deleteUrl, { method: 'POST' });

    const url = `https://api.telegram.org/bot${BOT_TOKEN}/setMyCommands`;

    // 3. Устанавливаем новые команды универсально
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commands,
      })
    });

    const result = await response.json();

    if (result.ok) {
      console.log(`✅ [ProvinceBot COMMANDS] ${getFormattedTime()} - Команды успешно установлены!`);
      console.log('Текущие команды ProvinceBot:');
      commands.forEach(cmd => {
        console.log(`  /${cmd.command} - ${cmd.description}`);
      });
    } else {
      console.error(`❌ [ProvinceBot COMMANDS] ${getFormattedTime()} - Ошибка:`, result.description);
    }
  } catch (error) {
    console.error(`❌ [ProvinceBot COMMANDS] ${getFormattedTime()} - Ошибка:`, error.message);
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  setProvinceBotCommands().catch(console.error);
}

export default {
  setProvinceBotCommands,
};

