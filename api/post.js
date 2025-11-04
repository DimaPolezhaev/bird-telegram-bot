import { getRandomBirdData } from '../../lib/birds.js';
import { sendBirdPostToChannel } from '../../lib/telegram.js';

export default async function handler(req, res) {
  // Разрешаем только POST запросы
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Можно добавить проверку секретного ключа для безопасности
  const { secret } = req.body;
  if (secret && secret !== process.env.SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    console.log('🦜 Manual post request...');
    
    const birdData = await getRandomBirdData();
    console.log(`✅ Bird data received: ${birdData.name}`);
    
    const result = await sendBirdPostToChannel(birdData);
    console.log(`✅ Posted to Telegram: ${birdData.name}`);
    
    res.status(200).json({
      success: true,
      bird: birdData.name,
      hasImage: !!birdData.imageUrl,
      factsCount: birdData.facts.length,
      message: `Пост о ${birdData.name} успешно отправлен!`,
      telegramResult: result
    });
    
  } catch (error) {
    console.error('❌ Manual post error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}