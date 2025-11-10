import { getRandomBirdData, saveBirdFacts, getWeeklyBirds, getAllBirdFacts, getBirdFacts } from '../lib/birds.js';
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
    console.log('🦜 Manual post request...');
    
    const birdData = await getRandomBirdData();
    console.log(`✅ Bird data received: ${birdData.name}`);
    
    // ✅ СОХРАНЯЕМ ФАКТЫ ДЛЯ ВИКТОРИН
    saveBirdFacts(birdData.name, birdData.facts);
    console.log(`💾 Сохранены факты для ${birdData.name}: ${birdData.facts.length} фактов`);
    
    // ✅ ПРОВЕРЯЕМ ИСТОРИЮ
    const weeklyBirds = getWeeklyBirds();
    const allFacts = getAllBirdFacts();
    console.log(`📊 История после сохранения: ${weeklyBirds.length} птиц, ${allFacts.size} фактов`);
    
    // ✅ ДЕТАЛЬНАЯ ДИАГНОСТИКА
    weeklyBirds.forEach(bird => {
      const facts = allFacts.get(bird) || [];
      console.log(`🦜 ${bird}: ${facts.length} фактов`);
    });
    
    const result = await sendBirdPostToChannel(birdData);
    console.log(`✅ Posted to Telegram: ${birdData.name}`);
    
    // ✅ ТЕСТИРУЕМ ВИКТОРИНУ СРАЗУ ПОСЛЕ ПОСТА
    console.log('🎯 Тестируем викторину...');
    const { sendSundayQuiz } = await import('../lib/telegram.js');
    const quizResult = await sendSundayQuiz();
    
    let quizMessage = '❌ Викторина не отправлена';
    let hasQuiz = false;
    
    if (quizResult) {
      console.log('✅ Викторина отправлена!');
      quizMessage = '✅ Викторина отправлена!';
      hasQuiz = true;
    } else {
      console.log('❌ Викторина не отправлена (мало данных)');
      
      // Диагностика почему не отправилась
      const currentBirds = getWeeklyBirds();
      const currentFacts = getAllBirdFacts();
      console.log(`📊 На момент викторины: ${currentBirds.length} птиц, ${currentFacts.size} фактов`);
    }
    
    // ✅ УСПЕШНОЕ СООБЩЕНИЕ
    console.log('🚀 Всё успешно! Ручной пост отправлен!');
    
    return res.status(200).json({
      success: true,
      message: '🚀 Всё успешно! Пост отправлен в Telegram канал!',
      bird: birdData.name,
      hasImage: !!birdData.imageUrl,
      factsCount: birdData.facts.length,
      quiz: {
        sent: hasQuiz,
        message: quizMessage
      },
      history: {
        birdsCount: weeklyBirds.length,
        factsCount: allFacts.size,
        birds: weeklyBirds.map(bird => ({
          name: bird,
          factsCount: (allFacts.get(bird) || []).length
        }))
      },
      timestamp: new Date().toISOString(),
      telegramResult: result
    });
    
  } catch (error) {
    console.error('❌ Manual post error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      message: 'Ошибка при отправке поста'
    });
  }
}