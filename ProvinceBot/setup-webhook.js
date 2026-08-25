import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Указываем точный путь к .env файлу в папке ProvinceBot
dotenv.config({ path: path.join(__dirname, '.env') });

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN2;
// Замените YOUR_VERCEL_PROJECT_URL на настоящий URL вашего Vercel проекта 
// (Например: https://bird-telegram-bot.vercel.app/api/province-bot)
const WEBHOOK_URL = 'https://bird-telegram-bot.vercel.app/api/province-bot';

if (!BOT_TOKEN) {
    console.error('❌ Ошибка: Не указан TELEGRAM_BOT_TOKEN2 в файле .env');
    process.exit(1);
}

const telegramApiUrl = `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`;

async function setupWebhook() {
    console.log(`Настройка вебхука для ProvinceBot...`);
    console.log(`URL: ${WEBHOOK_URL}`);

    try {
        const response = await fetch(telegramApiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                url: WEBHOOK_URL,
                drop_pending_updates: true
            }),
        });

        const data = await response.json();

        if (data.ok) {
            console.log('✅ Вебхук ProvinceBot успешно установлен!');
            console.log('Ответ Telegram:', data.description);
        } else {
            console.error('❌ Ошибка установки вебхука:', data.description);
        }
    } catch (error) {
        console.error('❌ Сетевая ошибка при установке вебхука:', error.message);
    }
}

setupWebhook();