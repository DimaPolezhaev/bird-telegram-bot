import fetch from 'node-fetch';

const BOT_TOKEN = "8549980803:AAG6OKU_Kh8DYhoTbCydkxylClYKWlk8H7o";
const CHANNEL_ID = "@PeroZhizni";
const GEMINI_API_KEY = "AIzaSyBU4Qvoc_gBsJ_EjD6OeToGl9cDrInANSg";
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

import { getWeeklyBirds, getRandomBirdFromHistory, getBirdFacts, getAllBirdFacts } from './birds.js';

// Основная функция отправки поста с птицей
export async function sendBirdPostToChannel(birdData) {
  const { name, description, imageUrl, facts } = birdData;
  
  // Формируем текст поста
  let caption = `👉🏻 ${name.toUpperCase()} 👈🏻\n\n`;
  
  // Обрезаем описание если слишком длинное
  const shortDescription = description.length > 400 
    ? description.substring(0, 400) + '...' 
    : description;
  
  caption += `${shortDescription}\n\n`;
  caption += `🔍 ИНТЕРЕСНЫЕ ФАКТЫ:\n`;
  
  facts.forEach((fact, index) => {
    caption += `• ${fact}\n`;
  });
  
  caption += `\n#${name.replace(/[^a-zA-Zа-яА-Я]/g, '')} #птицы #природа #ПероЖизни`;
  
  try {
    if (imageUrl) {
      console.log(`📸 Отправляю фото: ${imageUrl}`);
      
      // Отправка с фото
      const photoUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`;
      const response = await fetch(photoUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: CHANNEL_ID,
          photo: imageUrl,
          caption: caption,
          parse_mode: 'HTML'
        })
      });
      
      const result = await response.json();
      
      if (!result.ok) {
        console.log('❌ Ошибка отправки фото, пробую текст:', result);
        // Если не удалось отправить с фото, отправляем текстом
        return await sendTextPost(caption);
      }
      
      return result;
    } else {
      console.log('📝 Отправляю текстовый пост');
      return await sendTextPost(caption);
    }
  } catch (error) {
    console.error('Ошибка отправки в Telegram:', error);
    throw error;
  }
}

// Функция для воскресных викторин
export async function sendSundayQuiz() {
  try {
    const weeklyBirds = getWeeklyBirds();
    
    if (weeklyBirds.length < 1) {
      console.log('❌ Недостаточно птиц в истории для воскресной викторины');
      return null;
    }
    
    // Выбираем случайную птицу из истории недели
    const quizBird = getRandomBirdFromHistory();
    const birdFacts = getBirdFacts(quizBird);
    
    if (birdFacts.length === 0) {
      console.log(`❌ Нет сохраненных фактов для птицы: ${quizBird}`);
      return null;
    }
    
    console.log(`🎯 Создаю воскресную викторину для: ${quizBird}`);
    console.log(`📚 Факты для викторины: ${birdFacts.join(', ')}`);
    
    // Генерируем варианты ответов через Gemini
    let quizData = await generateQuizWithGemini(quizBird, birdFacts);
    
    // Если Gemini не сработал, используем резервную викторину
    if (!quizData) {
      console.log('🔄 Gemini не сработал, использую резервную викторину');
      quizData = await generateBackupQuiz(quizBird, birdFacts);
    }
    
    if (!quizData) {
      console.log('❌ Не удалось сгенерировать викторину');
      return null;
    }
    
    const pollUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendPoll`;
    
    const response = await fetch(pollUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: CHANNEL_ID,
        question: `🎯 ВОСКРЕСНАЯ ВИКТОРИНА!\n\n${quizData.question}`,
        options: quizData.options,
        is_anonymous: true,
        type: "quiz",
        correct_option_id: quizData.correctIndex,
        explanation: quizData.explanation
      })
    });
    
    const result = await response.json();
    
    if (!result.ok) {
      console.log('❌ Ошибка отправки викторины:', result);
      return null;
    }
    
    console.log(`✅ Воскресная викторина отправлена: ${quizBird}`);
    return result;
    
  } catch (error) {
    console.error('Ошибка отправки воскресной викторины:', error);
    return null;
  }
}

// Генерация викторины через Gemini с правильными фактами
async function generateQuizWithGemini(birdName, correctFacts) {
  try {
    const prompt = `Создай интересную викторину о птице "${birdName}". 

ВАЖНО: Используй ТОЛЬКО эти реальные факты, которые были опубликованы:
${correctFacts.map(fact => `• ${fact}`).join('\n')}

Требования к викторине:
1. Придумай интересный вопрос о птице на основе реальных фактов
2. Создай 4 варианта ответа
3. Один вариант ДОЛЖЕН БЫТЬ ПРАВИЛЬНЫМ (используй ТОЛЬКО факты из списка выше)
4. Три варианта должны быть НЕПРАВИЛЬНЫМИ (но правдоподобными)
5. НЕ ИСПОЛЬЗУЙ факты которых нет в списке выше
6. Напиши объяснение почему правильный ответ верный

Верни ответ в формате JSON:
{
  "question": "твой вопрос",
  "options": ["вариант1", "вариант2", "вариант3", "вариант4"],
  "correctIndex": 0,
  "explanation": "объяснение с указанием реального факта"
}

ПРИМЕР для птицы "Сова":
{
  "question": "Какая уникальная особенность есть у совы?",
  "options": [
    "Может поворачивать голову на 270 градусов",
    "Охотится преимущественно днём",
    "Питается в основном растительной пищей", 
    "Строит гнезда на земле"
  ],
  "correctIndex": 0,
  "explanation": "Правильно! Совы действительно могут поворачивать голову на 270 градусов благодаря особому строению шеи"
}`;

    const payload = {
      contents: [{
        role: "user",
        parts: [{
          text: prompt
        }]
      }]
    };
    
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });
    
    const data = await response.json();
    
    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
      console.log('❌ Неверный формат ответа от Gemini для викторины');
      return null;
    }
    
    const text = data.candidates[0].content.parts[0].text;
    console.log(`✅ Gemini сгенерировал викторину: ${text.substring(0, 150)}...`);
    
    // Парсим JSON ответ
    try {
      // Ищем JSON в тексте (иногда Gemini добавляет пояснения)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const jsonText = jsonMatch ? jsonMatch[0] : text;
      
      const quizData = JSON.parse(jsonText);
      
      // Проверяем что правильный ответ соответствует нашим фактам (более гибкая проверка)
      const correctAnswer = quizData.options[quizData.correctIndex];
      const isAnswerValid = correctFacts.some(fact => {
        // Берем ключевые слова из факта (первые 3-4 слова)
        const factKeywords = fact.toLowerCase().split(' ').slice(0, 4).join(' ');
        const answerLower = correctAnswer.toLowerCase();
        
        // Проверяем что в ответе есть ключевые слова из факта
        return factKeywords.split(' ').some(keyword => 
          keyword.length > 3 && answerLower.includes(keyword)
        );
      });
      
      if (!isAnswerValid) {
        console.log('❌ Gemini сгенерировал неправильный ответ. Ожидались факты:', correctFacts);
        console.log('❌ Получен ответ:', correctAnswer);
        return null;
      }
      
      console.log(`✅ Викторина прошла проверку: ${quizData.question}`);
      return quizData;
      
    } catch (parseError) {
      console.log('❌ Ошибка парсинга JSON от Gemini:', parseError);
      console.log('📝 Полученный текст:', text);
      return null;
    }
    
  } catch (error) {
    console.error('Gemini error при генерации викторины:', error);
    return null;
  }
}

// Резервная функция викторины если Gemini не сработал
async function generateBackupQuiz(birdName, correctFacts) {
  const questions = [
    "Какая уникальная особенность есть у этой птицы?",
    "Что из перечисленного правда об этой птице?",
    "Какой факт соответствует действительности для этой птицы?",
    "Что характерно для этой птицы?"
  ];
  
  const wrongAnswers = [
    "Охотится преимущественно днём",
    "Питается в основном растительной пищей",
    "Строит гнезда на земле", 
    "Мигрирует в Африку на зимовку",
    "Имеет размах крыльев более 3 метров",
    "Может прожить более 100 лет",
    "Обитает только в тропических лесах",
    "Не умеет летать"
  ];
  
  const question = questions[Math.floor(Math.random() * questions.length)];
  const correctFact = correctFacts[Math.floor(Math.random() * correctFacts.length)];
  
  // Выбираем 3 случайных неправильных ответа
  const selectedWrong = [...wrongAnswers]
    .sort(() => 0.5 - Math.random())
    .slice(0, 3);
  
  const allOptions = [correctFact, ...selectedWrong].sort(() => 0.5 - Math.random());
  const correctIndex = allOptions.indexOf(correctFact);
  
  return {
    question: question,
    options: allOptions,
    correctIndex: correctIndex,
    explanation: `Правильно! ${correctFact}`
  };
}

// Вспомогательная функция для отправки текстовых постов
async function sendTextPost(text) {
  const messageUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const response = await fetch(messageUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: CHANNEL_ID,
      text: text,
      parse_mode: 'HTML'
    })
  });
  
  return await response.json();
}

export { generateQuizWithGemini, generateBackupQuiz };