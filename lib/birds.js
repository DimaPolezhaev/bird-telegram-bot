import fetch from 'node-fetch';

const DEEPSEEK_API_KEY = "sk-b164e134c93f477a87ff1377b2750fad";
const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";

export async function getRandomBirdData() {
  try {
    console.log('🦜 Ищу случайную птицу...');
    
    // Получаем случайную страницу из Wikipedia
    const randomPage = await getRandomWikipediaPage();
    
    // Проверяем, что это птица
    if (await isBirdPage(randomPage)) {
      console.log(`✅ Найдена птица: ${randomPage.title}`);
      
      // Получаем подробные данные
      const wikiData = await getBirdWikiData(randomPage.title);
      const facts = await generateBirdFactsWithDeepSeek(randomPage.title, wikiData.extract);
      const imageUrl = wikiData.thumbnail?.source || await findBirdImage(randomPage.title);
      
      return {
        name: randomPage.title,
        description: wikiData.extract || `Удивительная птица ${randomPage.title} с уникальными особенностями.`,
        imageUrl: imageUrl,
        facts: facts
      };
    } else {
      console.log('❌ Это не птица, ищу снова...');
      return await getRandomBirdData();
    }
    
  } catch (error) {
    console.error('Ошибка:', error);
    return await getFallbackBirdData();
  }
}

async function getRandomWikipediaPage() {
  const response = await fetch(
    'https://ru.wikipedia.org/api/rest_v1/page/random/summary'
  );
  return await response.json();
}

async function isBirdPage(pageData) {
  const birdKeywords = [
    'птица', 'воробьино', 'хищная', 'певчая', 'водоплавающ', 
    'орнитолог', 'гнездо', 'клюв', 'крыло', 'перо', 'пение',
    'аист', 'сова', 'орёл', 'сокол', 'попугай', 'лебедь', 'утка',
    'голубь', 'воробей', 'синица', 'ласточка', 'ворона', 'сорока'
  ];
  
  const content = (pageData.extract + pageData.title).toLowerCase();
  return birdKeywords.some(keyword => content.includes(keyword));
}

async function getBirdWikiData(birdName) {
  try {
    const response = await fetch(
      `https://ru.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(birdName)}`
    );
    return await response.json();
  } catch (error) {
    return { extract: '', thumbnail: null };
  }
}

async function findBirdImage(birdName) {
  try {
    // Пробуем найти через Wikimedia Commons
    const commonsUrl = `https://commons.wikimedia.org/w/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(birdName)}&srnamespace=6&srlimit=1`;
    const response = await fetch(commonsUrl);
    const data = await response.json();
    
    if (data.query.search.length > 0) {
      const filename = data.query.search[0].title.replace('File:', '');
      return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=800`;
    }
    return null;
  } catch (error) {
    return null;
  }
}

async function generateBirdFactsWithDeepSeek(birdName, description) {
  try {
    const prompt = `Придумай 3 интересных и достоверных факта о птице "${birdName}". 
    Контекст: ${description || 'нет дополнительного контекста'}
    
    Требования:
    - Только проверенные научные факты
    - Коротко и увлекательно (максимум 80 символов на факт)
    - Формат: каждый факт с новой строки начинается с •
    - Язык: русский
    - Темы: особенности поведения, анатомия, среда обитания, питание`;
    
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 500,
        temperature: 0.7
      })
    });
    
    const data = await response.json();
    const factsText = data.choices[0].message.content;
    
    // Обрабатываем ответ
    return factsText.split('\n')
      .filter(line => line.trim().startsWith('•') || line.trim().match(/^\d+[\.\)]/))
      .map(fact => fact.replace(/^[•\-\d\.\)]\s*/, '').trim())
      .filter(fact => fact.length > 0 && fact.length < 100)
      .slice(0, 3);
    
  } catch (error) {
    console.error('DeepSeek error:', error);
    return [
      "Обладает уникальными адаптациями к среде обитания",
      "Играет важную роль в экосистеме", 
      "Имеет интересные особенности поведения"
    ];
  }
}

async function getFallbackBirdData() {
  // Резервный список на случай ошибок
  const fallbackBirds = [
    { 
      name: "Снегирь", 
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/33/Pyrrhula_pyrrhula_-Rila_Mountains%2C_Bulgaria_-male-8.jpg/800px-Pyrrhula_pyrrhula_-Rila_Mountains%2C_Bulgaria_-male-8.jpg",
      description: "Снегирь - маленькая певчая птица с ярко-красной грудкой у самцов. Обитает в лесах Европы и Азии."
    },
    { 
      name: "Сова", 
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3c/Bubo_bubo_-_Eagle_Owl_-_Uhu.jpg/800px-Bubo_bubo_-_Eagle_Owl_-_Uhu.jpg",
      description: "Совы - ночные хищные птицы с отличным зрением и слухом. Способны поворачивать голову на 270 градусов."
    },
    { 
      name: "Колибри", 
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/09/Hummingbird.jpg/800px-Hummingbird.jpg",
      description: "Колибри - самые маленькие птицы в мире. Могут летать задом наперед и зависать в воздухе."
    }
  ];
  
  const bird = fallbackBirds[Math.floor(Math.random() * fallbackBirds.length)];
  const facts = await generateBirdFactsWithDeepSeek(bird.name, bird.description);
  
  return {
    name: bird.name,
    description: bird.description,
    imageUrl: bird.image,
    facts: facts
  };
}

export {
  getRandomBirdData
};