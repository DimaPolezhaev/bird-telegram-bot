import fetch from 'node-fetch';

const GEMINI_API_KEY = "AIzaSyBU4Qvoc_gBsJ_EjD6OeToGl9cDrInANSg";
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

// Только минимальный резервный список для гарантии
const BACKUP_BIRDS = [
  "Воробей", "Синица", "Снегирь", "Сова", "Голубь", "Ворона", "Сорока",
  "Скворец", "Ласточка", "Дятел", "Орёл", "Сокол", "Попугай", "Колибри"
];

// История последних птиц для избежания повторов
let postedBirdsHistory = [];
const MAX_HISTORY = 20; // Увеличили историю до 20 птиц

export async function getRandomBirdData() {
  try {
    let birdName;
    let attempts = 0;
    const maxAttempts = 8;
    
    do {
      attempts++;
      
      // 90% chance - брать из Wikipedia, 10% - из резервного списка
      const useWikipedia = Math.random() < 0.9;
      
      if (useWikipedia) {
        // Пытаемся найти случайную птицу в Wikipedia
        birdName = await findRandomBirdInWikipedia();
        if (birdName) {
          console.log(`🌐 Найдена птица из Wikipedia: ${birdName}`);
        } else {
          // Если не нашли в Wikipedia, берем из резервного списка
          birdName = getRandomBackupBird();
          console.log(`🔄 Wikipedia не дала результат, используем резерв: ${birdName}`);
        }
      } else {
        // 10% chance - использовать резервный список
        birdName = getRandomBackupBird();
        console.log(`🎯 Выбрана птица из резерва: ${birdName}`);
      }
      
      // Проверяем что это точно птица
      if (birdName && !await isDefinitelyBird(birdName)) {
        console.log(`❌ "${birdName}" не птица, ищем другую`);
        birdName = null;
        continue;
      }
      
      // Если слишком много попыток, берем гарантированную птицу
      if (attempts >= maxAttempts) {
        console.log('🔄 Достигнут лимит попыток, берем гарантированную птицу');
        birdName = getGuaranteedBird();
        break;
      }
      
    } while ((!birdName || postedBirdsHistory.includes(birdName)) && attempts < maxAttempts);
    
    // Если всё еще нет птицы, берем гарантированную
    if (!birdName) {
      birdName = getGuaranteedBird();
      console.log(`🆘 Используем гарантированную птицу: ${birdName}`);
    }
    
    // Обновляем историю
    updateBirdHistory(birdName);
    
    console.log(`📊 История последних птиц (${postedBirdsHistory.length}): ${postedBirdsHistory.slice(0, 10).join(', ')}...`);
    
    // Получаем данные о птице
    const wikiData = await getBirdWikiData(birdName);
    const facts = await generateBirdFactsWithGemini(birdName, wikiData.extract);
    const imageUrl = await findBestBirdImage(birdName);
    
    return {
      name: birdName,
      description: wikiData.extract || generateDefaultDescription(birdName),
      imageUrl: imageUrl,
      facts: facts
    };
    
  } catch (error) {
    console.error('Ошибка:', error);
    return await getFallbackBirdData();
  }
}

// Получение случайной птицы из резервного списка
function getRandomBackupBird() {
  return BACKUP_BIRDS[Math.floor(Math.random() * BACKUP_BIRDS.length)];
}

// Гарантированная птица из проверенного списка
function getGuaranteedBird() {
  const guaranteedBirds = ["Воробей", "Синица", "Снегирь", "Сова", "Голубь"];
  return guaranteedBirds[Math.floor(Math.random() * guaranteedBirds.length)];
}

// Функция для проверки что это точно птица
async function isDefinitelyBird(birdName) {
  const notBirds = [
    'коммуна', 'департамент', 'кантон', 'округ', 'франция', 'регион',
    'пероб', 'муниципалитет', 'город', 'деревня', 'посёлок', 
    'населённый пункт', 'административный', 'территориальная',
    'район', 'провинция', 'область', 'кантона', 'кантоны'
  ];
  
  const lowerName = birdName.toLowerCase();
  
  // Если содержит слова не-птицы - это не птица
  if (notBirds.some(notBird => lowerName.includes(notBird))) {
    return false;
  }
  
  // Проверяем через Wikipedia API
  try {
    const wikiData = await getBirdWikiData(birdName);
    const content = (wikiData.extract || '').toLowerCase();
    
    // Ключевые слова указывающие на птицу
    const birdKeywords = [
      'птица', 'воробьино', 'хищная', 'певчая', 'водоплавающ',
      'орнитолог', 'гнездо', 'клюв', 'крыло', 'перо', 'пение',
      'отряд', 'семейство', 'вид птиц', 'ареал обитания'
    ];
    
    const isBird = birdKeywords.some(keyword => content.includes(keyword));
    
    if (!isBird) {
      console.log(`⚠️  Не найдено ключевых слов птицы для: ${birdName}`);
    }
    
    return isBird;
  } catch (error) {
    // Если ошибка, считаем что это птица
    return true;
  }
}

// Обновление истории птиц
function updateBirdHistory(birdName) {
  postedBirdsHistory.unshift(birdName);
  if (postedBirdsHistory.length > MAX_HISTORY) {
    postedBirdsHistory = postedBirdsHistory.slice(0, MAX_HISTORY);
  }
}

// Улучшенный поиск случайной птицы в Wikipedia
async function findRandomBirdInWikipedia() {
  try {
    // Используем разные категории для разнообразия
    const categories = [
      "Категория:Птицы_по_алфавиту",
      "Категория:Певчие_птицы", 
      "Категория:Хищные_птицы",
      "Категория:Водоплавающие_птицы",
      "Категория:Птицы_Европы",
      "Категория:Птицы_Азии"
    ];
    
    const randomCategory = categories[Math.floor(Math.random() * categories.length)];
    const categoryUrl = `https://ru.wikipedia.org/w/api.php?action=query&list=categorymembers&cmtitle=${randomCategory}&cmtype=page&cmlimit=100&format=json`;
    
    const response = await fetch(categoryUrl);
    const data = await response.json();
    
    if (data.query && data.query.categorymembers && data.query.categorymembers.length > 0) {
      const birds = data.query.categorymembers;
      
      // Пробуем несколько случайных птиц из списка
      for (let i = 0; i < 5; i++) {
        const randomBird = birds[Math.floor(Math.random() * birds.length)];
        
        // Проверяем что это не слишком длинное название (обычно это не виды)
        if (randomBird.title.length < 50 && !randomBird.title.includes('(')) {
          // Быстрая проверка что это птица
          if (await quickBirdCheck(randomBird.title)) {
            return randomBird.title;
          }
        }
      }
      
      // Если не нашли подходящую, берем первую
      return birds[0].title;
    }
    
    console.log('❌ Не найдено птиц в Wikipedia категории');
    return null;
    
  } catch (error) {
    console.log('Ошибка поиска в Wikipedia:', error);
    return null;
  }
}

// Быстрая проверка что это птица (без полной загрузки страницы)
async function quickBirdCheck(birdName) {
  const notBirds = [
    'коммуна', 'департамент', 'кантон', 'округ', 'франция', 'регион',
    'пероб', 'муниципалитет', 'город', 'деревня', 'посёлок'
  ];
  
  const lowerName = birdName.toLowerCase();
  return !notBirds.some(notBird => lowerName.includes(notBird));
}

async function getBirdWikiData(birdName) {
  try {
    const response = await fetch(
      `https://ru.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(birdName)}`
    );
    
    if (!response.ok) {
      throw new Error(`Wikipedia API error: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.log('Ошибка получения данных Wikipedia:', error);
    return { 
      extract: generateDefaultDescription(birdName),
      thumbnail: null 
    };
  }
}

async function findBestBirdImage(birdName) {
  try {
    console.log(`🔍 Ищу фото для: ${birdName}`);
    
    // 1. Пробуем Wikipedia (основной источник)
    const wikiData = await getBirdWikiData(birdName);
    if (wikiData.thumbnail && isValidImageUrl(wikiData.thumbnail.source)) {
      console.log(`📸 Найдено фото в Wikipedia: ${wikiData.thumbnail.source}`);
      return wikiData.thumbnail.source;
    }
    
    // 2. Пробуем Wikimedia Commons (второй источник)
    const commonsImage = await findCommonsImage(birdName);
    if (commonsImage && isValidImageUrl(commonsImage)) {
      console.log(`📸 Найдено фото в Commons: ${commonsImage}`);
      return commonsImage;
    }
    
    // 3. Используем резервные фото для известных птиц
    const backupImage = getBackupBirdImage(birdName);
    if (backupImage) {
      console.log(`📸 Используем резервное фото: ${backupImage}`);
      return backupImage;
    }
    
    console.log(`❌ Не найдено качественное фото для: ${birdName}`);
    return null;
    
  } catch (error) {
    console.log('Ошибка поиска изображения:', error);
    return getBackupBirdImage(birdName);
  }
}

// Проверка что URL изображения валидный
function isValidImageUrl(url) {
  if (!url) return false;
  
  // Проверяем что это изображение с Wikipedia/Commons
  const validDomains = [
    'upload.wikimedia.org',
    'commons.wikimedia.org',
    'wikipedia.org'
  ];
  
  return validDomains.some(domain => url.includes(domain));
}

// Улучшенный поиск в Commons
async function findCommonsImage(birdName) {
  try {
    // Ищем с более специфичными ключевыми словами
    const searchQueries = [
      birdName,
      `${birdName} bird`,
      `${birdName} птица`,
      `${birdName} (bird)`,
      `${birdName} (species)`
    ];
    
    for (const query of searchQueries) {
      const commonsUrl = `https://commons.wikimedia.org/w/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(query)}&srnamespace=6&srlimit=10`;
      const response = await fetch(commonsUrl);
      const data = await response.json();
      
      if (data.query && data.query.search.length > 0) {
        // Ищем лучшее изображение с птицей в названии
        const birdImages = data.query.search.filter(img => 
          img.title.toLowerCase().includes(birdName.toLowerCase()) ||
          img.title.toLowerCase().includes('bird') ||
          img.title.toLowerCase().includes('птиц')
        );
        
        if (birdImages.length > 0) {
          const filename = birdImages[0].title.replace('File:', '');
          const imageUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=800`;
          
          // Проверяем что изображение доступно
          const checkResponse = await fetch(imageUrl, { method: 'HEAD' });
          if (checkResponse.ok) {
            return imageUrl;
          }
        }
      }
    }
    
    return null;
  } catch (error) {
    console.log('Ошибка поиска в Commons:', error);
    return null;
  }
}

// Расширенный список резервных фото
function getBackupBirdImage(birdName) {
  const backupImages = {
    "Воробей": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Passer_domesticus_male_%2815%29.jpg/800px-Passer_domesticus_male_%2815%29.jpg",
    "Синица": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Parus_major_-_London_-_England-8.jpg/800px-Parus_major_-_London_-_England-8.jpg",
    "Снегирь": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/33/Pyrrhula_pyrrhula_-Rila_Mountains%2C_Bulgaria_-male-8.jpg/800px-Pyrrhula_pyrrhula_-Rila_Mountains%2C_Bulgaria_-male-8.jpg",
    "Сова": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3c/Bubo_bubo_-_Eagle_Owl_-_Uhu.jpg/800px-Bubo_bubo_-_Eagle_Owl_-_Uhu.jpg",
    "Голубь": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/56/Columba_livia_-_England_-_free_flying-8.jpg/800px-Columba_livia_-_England_-_free_flying-8.jpg",
    "Ворона": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/Corvus_corone_-_England_-_adult-8.jpg/800px-Corvus_corone_-_England_-_adult-8.jpg",
    "Сорока": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5b/Pica_pica_-_England_-_adult-8.jpg/800px-Pica_pica_-_England_-_adult-8.jpg",
    "Скворец": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Sturnus_vulgaris_-_England_-_adult-8.jpg/800px-Sturnus_vulgaris_-_England_-_adult-8.jpg",
    "Ласточка": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/Hirundo_rustica_-_England-8.jpg/800px-Hirundo_rustica_-_England-8.jpg",
    "Дятел": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/be/Dendrocopos_major_-_01.jpg/800px-Dendrocopos_major_-_01.jpg",
    "Орёл": "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Aquila_chrysaetos_-_01.jpg/800px-Aquila_chrysaetos_-_01.jpg",
    "Сокол": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8e/Falco_peregrinus_-_01.jpg/800px-Falco_peregrinus_-_01.jpg",
    "Попугай": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1e/Melopsittacus_undulatus_-Atlanta_Zoo%2C_Georgia%2C_USA-8a.jpg/800px-Melopsittacus_undulatus_-Atlanta_Zoo%2C_Georgia%2C_USA-8a.jpg",
    "Колибри": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/09/Hummingbird.jpg/800px-Hummingbird.jpg"
  };
  
  return backupImages[birdName] || null;
}

function generateDefaultDescription(birdName) {
  const descriptions = [
    `${birdName} - удивительная птица с уникальными особенностями и поведением.`,
    `Птица ${birdName} обладает прекрасными адаптациями к своей среде обитания.`,
    `${birdName} относится к удивительному миру птиц с разнообразными повадками.`,
    `Интересная птица ${birdName} демонстрирует разнообразие животного мира.`
  ];
  
  return descriptions[Math.floor(Math.random() * descriptions.length)];
}

async function generateBirdFactsWithGemini(birdName, description) {
  try {
    const prompt = `Придумай 3 интересных и достоверных факта о птице "${birdName}". 
    ${description ? `Контекст: ${description}` : ''}
    
    Требования:
    - Только проверенные научные факты
    - Коротко и увлекательно (максимум 80 символов на факт)
    - Формат: каждый факт с новой строки начинается с •
    - Язык: русский
    - Темы: особенности поведения, анатомия, среда обитания, питание`;
    
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
    
    // Проверка ответа
    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
      console.log('❌ Неверный формат ответа от Gemini');
      return getDefaultFacts(birdName);
    }
    
    const text = data.candidates[0].content.parts[0].text;
    console.log(`✅ Gemini ответ получен: ${text.substring(0, 100)}...`);
    
    // Обрабатываем ответ
    const facts = text.split('\n')
      .filter(line => line.trim().startsWith('•'))
      .map(fact => fact.replace(/^•\s*/, '').trim())
      .filter(fact => fact.length > 10 && fact.length < 100)
      .slice(0, 3);
    
    if (facts.length === 0) {
      console.log('❌ Не удалось извлечь факты');
      return getDefaultFacts(birdName);
    }
    
    return facts;
    
  } catch (error) {
    console.error('Gemini error:', error);
    return getDefaultFacts(birdName);
  }
}

function getDefaultFacts(birdName) {
  const defaultFacts = {
    "Воробей": [
      "Живут большими стаями рядом с человеком",
      "За день съедают пищи больше собственного веса",
      "Распространены по всему миру, кроме Антарктиды"
    ],
    "Синица": [
      "Одна из самых полезных птиц для садоводов",
      "Может делать до 1000 кормовых вылетов в день",
      "Зимой нуждается в подкормке от людей"
    ],
    "Снегирь": [
      "Самцы имеют ярко-красную грудку, самки - серую",
      "Зимой часто прилетают в города в поисках пищи",
      "Питаются семенами, почками и ягодами"
    ]
  };
  
  if (defaultFacts[birdName]) {
    return defaultFacts[birdName];
  }
  
  return [
    "Обладает уникальными адаптациями к среде обитания",
    "Играет важную роль в экосистеме", 
    "Имеет интересные особенности поведения"
  ];
}

async function getFallbackBirdData() {
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
    }
  ];
  
  const bird = fallbackBirds[Math.floor(Math.random() * fallbackBirds.length)];
  const facts = await generateBirdFactsWithGemini(bird.name, bird.description);
  
  return {
    name: bird.name,
    description: bird.description,
    imageUrl: bird.image,
    facts: facts
  };
}