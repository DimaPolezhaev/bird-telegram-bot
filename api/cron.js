import { getRandomBirdData } from '../lib/birds.js';
import { sendBirdPostToChannel } from '../lib/telegram.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('🦜 Starting automatic bird post...');
    
    const birdData = await getRandomBirdData();
    console.log(`✅ Bird data received: ${birdData.name}`);
    
    const result = await sendBirdPostToChannel(birdData);
    console.log(`✅ Posted to Telegram: ${birdData.name}`);
    
    res.status(200).json({
      success: true,
      bird: birdData.name,
      hasImage: !!birdData.imageUrl,
      factsCount: birdData.facts.length,
      message: `Пост о ${birdData.name} успешно отправлен!`
    });
    
  } catch (error) {
    console.error('❌ Cron error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
}