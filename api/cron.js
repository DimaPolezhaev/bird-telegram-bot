import { getRandomBirdData, getWeeklyBirds, getRandomBirdFromHistory, getBirdsCount, saveBirdFacts } from '../lib/birds.js';
import { sendBirdPostToChannel, sendSundayQuiz } from '../lib/telegram.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false,
      error: 'Method allowed',
      message: 'Используйте POST запрос'
    });
  }

  try {
    const today = new Date();
    const isSunday = today.getDay() === 0; // 0 = воскресенье
    
    // В ВОСКРЕСЕНЬЕ - ТОЛЬКО ОПРОСЫ, без обычных постов
    if (isSunday) {
      console.log('📅 Воскресенье - день викторин!');
      
      const quizResult = await sendSundayQuiz();
      
      if (quizResult) {
        return res.status(200).json({
          success: true,
          message: '🎯 Воскресная викторина отправлена!',
          hasQuiz: true,
          isSunday: true,
          timestamp: new Date().toISOString()
        });
      } else {
        return res.status(200).json({
          success: true,
          message: 'ℹ️ Воскресенье, но викторина не отправлена (мало данных)',
          hasQuiz: false,
          isSunday: true,
          timestamp: new Date().toISOString()
        });
      }
    }
    
    // В остальные дни - обычные посты
    console.log('🦜 Starting automatic bird post...');
    
    const birdData = await getRandomBirdData();
    console.log(`✅ Bird data received: ${birdData.name}`);
    
    // Сохраняем факты для будущих викторин
    saveBirdFacts(birdData.name, birdData.facts);
    
    const result = await sendBirdPostToChannel(birdData);
    console.log(`✅ Posted to Telegram: ${birdData.name}`);
    
    console.log('🚀 Всё успешно! Пост отправлен в Telegram канал!');
    
    return res.status(200).json({
      success: true,
      message: '🚀 Всё успешно! Пост отправлен в Telegram канал!',
      bird: birdData.name,
      hasImage: !!birdData.imageUrl,
      factsCount: birdData.facts.length,
      isSunday: false,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Cron error:', error);
    return res.status(500).json({ 
      success: false,
      error: error.message,
      message: 'Ошибка при отправке поста'
    });
  }
}