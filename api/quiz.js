import { getWeeklyBirds, getRandomBirdFromHistory, getBirdFacts, getAllBirdFacts } from '../lib/birds.js';
import { generateQuizWithGemini } from '../lib/telegram.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false,
      error: 'Method not allowed',
      message: 'Используйте POST запрос'
    });
  }

  try {
    console.log('🎯 Starting manual quiz test...');
    
    // Получаем историю птиц
    const weeklyBirds = getWeeklyBirds();
    const allFacts = getAllBirdFacts();
    
    console.log(`📊 История птиц: ${weeklyBirds.length} птиц`);
    console.log(`💾 Сохраненные факты: ${allFacts.size} птиц с фактами`);
    
    // Логируем детальную информацию
    weeklyBirds.forEach(bird => {
      const facts = getBirdFacts(bird);
      console.log(`🦜 ${bird}: ${facts.length} фактов`);
    });

    // Проверяем достаточно ли данных для викторины
    if (weeklyBirds.length < 3) {
      return res.status(200).json({
        success: true,
        message: 'ℹ️ Недостаточно птиц в истории для викторины',
        hasQuiz: false,
        birdsCount: weeklyBirds.length,
        factsCount: allFacts.size,
        birds: weeklyBirds,
        timestamp: new Date().toISOString()
      });
    }

    // Выбираем птицу для викторины
    const quizBird = getRandomBirdFromHistory();
    const birdFacts = getBirdFacts(quizBird);
    
    console.log(`🎯 Выбрана птица для викторины: ${quizBird}`);
    console.log(`📝 Факты для викторины:`, birdFacts);

    if (birdFacts.length === 0) {
      return res.status(200).json({
        success: true,
        message: `ℹ️ Нет сохраненных фактов для птицы: ${quizBird}`,
        hasQuiz: false,
        selectedBird: quizBird,
        factsCount: 0,
        timestamp: new Date().toISOString()
      });
    }

    // Генерируем викторину
    const quizData = await generateQuizWithGemini(quizBird, birdFacts);
    
    if (!quizData) {
      console.log('❌ Не удалось сгенерировать викторину');
      return res.status(200).json({
        success: true,
        message: '❌ Не удалось сгенерировать викторину через Gemini',
        hasQuiz: false,
        selectedBird: quizBird,
        facts: birdFacts,
        timestamp: new Date().toISOString()
      });
    }

    console.log('✅ Викторина сгенерирована:', quizData);

    // Отправляем опрос в канал
    const BOT_TOKEN = "8549980803:AAG6OKU_Kh8DYhoTbCydkxylClYKWlk8H7o";
    const CHANNEL_ID = "@PeroZhizni";
    
    const pollUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendPoll`;
    
    const response = await fetch(pollUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: CHANNEL_ID,
        question: `🎯 ТЕСТОВАЯ ВИКТОРИНА!\n\n${quizData.question}`,
        options: quizData.options,
        is_anonymous: false,
        type: "quiz",
        correct_option_id: quizData.correctIndex,
        explanation: quizData.explanation
      })
    });
    
    const result = await response.json();
    
    if (!result.ok) {
      console.log('❌ Ошибка отправки викторины:', result);
      return res.status(500).json({
        success: false,
        error: result.description,
        message: 'Ошибка при отправке опроса в Telegram',
        quizData: quizData,
        timestamp: new Date().toISOString()
      });
    }

    console.log('✅ Тестовый опрос успешно отправлен!');
    
    return res.status(200).json({
      success: true,
      message: '✅ Тестовый опрос успешно отправлен в канал!',
      hasQuiz: true,
      selectedBird: quizBird,
      quizData: quizData,
      telegramResult: result,
      birdsCount: weeklyBirds.length,
      factsCount: allFacts.size,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Quiz test error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      message: 'Ошибка при тестировании опроса'
    });
  }
}