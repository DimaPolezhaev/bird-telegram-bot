// api/admin/queue.js
import { getPublishedBirds } from '../../lib/supabase.js';
import { initSentry, Sentry } from '../../lib/sentry.js';

export default async function handler(req, res) {
    initSentry();

    try {
        console.log('📑 [ADMIN] Запрос очереди постов');

        // Получаем последние 20 птиц из истории
        const birds = await getPublishedBirds(20);

        return res.status(200).json({
            success: true,
            data: birds,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        Sentry.captureException(error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
}
