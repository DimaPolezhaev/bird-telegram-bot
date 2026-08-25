import { fetchWithRetry } from '../lib/utils.js';

export default async function handler(req, res) {
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN1 || process.env.TELEGRAM_BOT_TOKEN;

    if (!BOT_TOKEN) {
        return res.status(500).json({ error: "Токен бота не найден. Установите TELEGRAM_BOT_TOKEN1" });
    }

    try {
        const hostUrl = `https://${req.headers.host}`;
        const webhookUrl = `${hostUrl}/api/webhook`;

        console.log(`🔗 Устанавливаю Webhook Telegram на URL: ${webhookUrl}`);

        const telegramApi = `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`;

        const response = await fetchWithRetry(telegramApi, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: webhookUrl })
        });

        const result = await response.json();

        if (result.ok) {
            return res.status(200).json({
                success: true,
                message: "Webhook успешно установлен!",
                url: webhookUrl
            });
        } else {
            return res.status(500).json({
                success: false,
                error: result.description
            });
        }

    } catch (error) {
        console.error('❌ Ошибка установки Webhook:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
