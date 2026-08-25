import { sendAdminMessage, sendDetailedAdminError } from '../lib/telegram.js';
import { handleTelegramUpdate } from '../lib/botManager.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const update = req.body;

        // Special handling for admin /force_post command
        if (update.message && update.message.text) {
            const chatId = update.message.chat.id.toString();
            const text = update.message.text.trim();
            const adminId = process.env.ADMIN_ID;

            if (text === '/force_post' && (!adminId || chatId === adminId)) {
                await sendAdminMessage('⏳ Запускаю процесс публикации (force_post)... Ожидайте, это займет около 30-40 секунд.');

                // В фоне вызываем внутренний API для генерации поста
                const hostUrl = `https://${req.headers.host}`;
                fetch(`${hostUrl}/api/post`, { method: 'POST' })
                    .then(async (response) => {
                        if (response.ok) {
                            const data = await response.json();
                            await sendAdminMessage(`✅ Пост успешно опубликован!\nПтица: <b>${data.bird}</b>\nФото: ${data.hasImage ? '✅' : '❌'}`);
                        } else {
                            const errorData = await response.text();
                            await sendAdminMessage(`❌ Ошибка публикации: ${response.status}\n\n<code>${errorData}</code>`);
                        }
                    })
                    .catch(async (e) => {
                        await sendAdminMessage(`❌ Сетевая ошибка при вызове /api/post: ${e.message}`);
                    });

                return res.status(200).json({ ok: true });
            }
        }

        // Delegate everything else to the main bot manager
        await handleTelegramUpdate(update);

        return res.status(200).json({ ok: true });
    } catch (error) {
        console.error('❌ Ошибка Webhook:', error);

        // Уведомляем администратора о подробностях ошибки
        try {
            await sendDetailedAdminError(error, 'Webhook Handler (api/webhook.js)');
        } catch (e) {
            console.error('❌ Не удалось отправить детальную ошибку админу:', e.message);
        }

        return res.status(200).json({ ok: true }); // Всегда отвечаем 200 Telegram, чтобы он не спамил повторами
    }
}
