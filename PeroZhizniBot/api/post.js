// api/post.js - Ручные посты
import { getRandomBirdData, getWeeklyBirds, getAllBirdFacts } from '../lib/birds.js';
import { sendBirdPostToChannel, sendAdminMessage } from '../lib/telegram.js';

export default async function handler(req, res) {
  console.log('🖱️ [MANUAL] Запрос на ручной пост');

  if (req.method !== 'POST') {
    console.log('❌ [MANUAL] Неверный метод');
    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
      message: 'Используйте POST запрос'
    });
  }

  try {
    console.log('🦜 [MANUAL] Начинаю выбор птицы');

    const birdData = await getRandomBirdData();

    if (!birdData) {
      throw new Error('Не удалось получить данные о птице');
    }

    console.log(`✅ [MANUAL] Данные получены: ${birdData.name}`);
    console.log(`💾 [MANUAL] Фактов для отправки: ${birdData.facts?.length || 0}`);

    const result = await sendBirdPostToChannel(birdData);
    console.log(`✅ [MANUAL] Пост отправлен: ${birdData.name}`);

    if (result && result.ok) {
      console.log('🚀 [MANUAL] Ручной пост успешно отправлен');
      return res.status(200).json({
        success: true,
        message: '🚀 Всё успешно! Пост отправлен в Telegram канал!',
        bird: birdData.name,
        hasImage: !!birdData.imageUrl,
        factsCount: birdData.facts?.length || 0,
        timestamp: new Date().toISOString(),
        telegramResult: result
      });
    } else {
      throw new Error(`Ошибка отправки: ${result?.description || 'Неизвестная ошибка'}`);
    }

  } catch (error) {
    console.error('❌ [MANUAL] Ошибка:', error);
    try {
      await sendAdminMessage(`<b>Ошибка в post.js (Ручной пост):</b>\n\n<code>${error.message}</code>\n\nПроверьте логи Vercel.`);
    } catch (e) { console.error('Не удалось отправить админу', e); }
    return res.status(500).json({
      success: false,
      error: error.message,
      message: 'Ошибка при отправке поста'
    });
  }
}