import { getRandomBirdData } from '../lib/birds.js';
import { sendBirdPostToChannel } from '../lib/telegram.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false,
      error: 'Method not allowed',
      message: 'Используйте POST запрос'
    });
  }

  try {
    console.log('🦜 Starting automatic bird post...');
    
    const birdData = await getRandomBirdData();
    console.log(`✅ Bird data received: ${birdData.name}`);
    
    const result = await sendBirdPostToChannel(birdData);
    console.log(`✅ Posted to Telegram: ${birdData.name}`);
    
    // ✅ УСПЕШНОЕ СООБЩЕНИЕ В ЛОГАХ
    console.log('🚀 Всё успешно! Пост отправлен в Telegram канал!');
    
    return res.status(200).json({
      success: true,
      message: '🚀 Всё успешно! Пост отправлен в Telegram канал!',
      bird: birdData.name,
      hasImage: !!birdData.imageUrl,
      factsCount: birdData.facts.length,
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