// api/cron.js - Автоматические посты
import { getRandomBirdData } from '../lib/birds.js';
import { sendBirdPostToChannel, sendSundayQuiz } from '../lib/telegram.js';

export default async function handler(req, res) {
  console.log('⏰ [CRON] Запуск автоматического поста');
  
  if (req.method !== 'POST') {
    console.log('❌ [CRON] Неверный метод');
    return res.status(405).json({ 
      success: false,
      error: 'Method not allowed',
      message: 'Используйте POST запрос'
    });
  }

  try {
    const today = new Date();
    const isSunday = today.getDay() === 0; // 0 = воскресенье
    console.log(`📅 [CRON] День недели: ${today.getDay()} (воскресенье: ${isSunday})`);

    // В ВОСКРЕСЕНЬЕ - ТОЛЬКО ОПРОСЫ
    if (isSunday) {
      console.log('📅 [CRON] Воскресенье - отправляем викторину');
      
      const quizResult = await sendSundayQuiz();
      
      if (quizResult && quizResult.ok) {
        console.log('✅ [CRON] Викторина успешно отправлена');
        return res.status(200).json({
          success: true,
          message: '🎯 Воскресная викторина отправлена!',
          hasQuiz: true,
          isSunday: true,
          timestamp: new Date().toISOString()
        });
      } else {
        console.log('⚠️ [CRON] Викторина не отправлена');
        return res.status(200).json({
          success: true,
          message: 'ℹ️ Воскресенье, но викторина не отправлена',
          hasQuiz: false,
          isSunday: true,
          timestamp: new Date().toISOString()
        });
      }
    }
    
    // В остальные дни - обычные посты
    console.log('🦜 [CRON] Начинаю выбор птицы для поста');
    
    const birdData = await getRandomBirdData();
    
    if (!birdData) {
      throw new Error('Не удалось получить данные о птице');
    }
    
    console.log(`✅ [CRON] Данные получены: ${birdData.name}`);
    console.log(`📸 [CRON] Есть фото: ${!!birdData.imageUrl}`);
    console.log(`📝 [CRON] Количество фактов: ${birdData.facts?.length || 0}`);
    
    const result = await sendBirdPostToChannel(birdData);
    
    if (result && result.ok) {
      console.log(`✅ [CRON] Пост успешно отправлен: ${birdData.name}`);
      return res.status(200).json({
        success: true,
        message: '🚀 Всё успешно! Пост отправлен в Telegram канал!',
        bird: birdData.name,
        hasImage: !!birdData.imageUrl,
        factsCount: birdData.facts?.length || 0,
        isSunday: false,
        timestamp: new Date().toISOString()
      });
    } else {
      throw new Error(`Ошибка отправки: ${result?.description || 'Неизвестная ошибка'}`);
    }
    
  } catch (error) {
    console.error('❌ [CRON] Ошибка:', error);
    return res.status(500).json({ 
      success: false,
      error: error.message,
      message: 'Ошибка при отправке поста'
    });
  }
}

export async function cleanupOldMessages() {
  try {
    console.log('🧹 [CLEANUP] Очистка старых сообщений истории');
    
    const result = await clearOldMessages(7);
    
    if (result) {
      console.log('✅ [CLEANUP] Очистка завершена');
      return { success: true, message: 'Очистка старых сообщений выполнена' };
    } else {
      return { success: false, message: 'Ошибка очистки' };
    }
    
  } catch (error) {
    console.error('❌ [CLEANUP] Ошибка:', error);
    return { success: false, error: error.message };
  }
}