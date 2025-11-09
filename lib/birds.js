import fetch from 'node-fetch';

const GEMINI_API_KEY = "AIzaSyBU4Qvoc_gBsJ_EjD6OeToGl9cDrInANSg";
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

// Минимальный резервный список проверенных птиц
const BACKUP_BIRDS = [
  "Воробей", "Синица", "Снегирь", "Сова", "Голубь", "Ворона", "Сорока",
  "Скворец", "Ласточка", "Дятел", "Орёл", "Сокол", "Попугай", "Колибри",
  "Фламинго", "Павлин", "Лебедь", "Аист", "Пингвин", "Чайка", "Утка"
];

// История последних птиц для избежания повторов
let postedBirdsHistory = [];
const MAX_HISTORY = 30;

export async function getRandomBirdData() {
  try {
    let birdName;
    let attempts = 0;
    const maxAttempts = 10;
    
    do {
      attempts++;
      
      // 85% chance - брать из Wikipedia, 15% - из резервного списка
      const useWikipedia = Math.random() < 0.85;
      
      if (useWikipedia) {
        birdName = await findRandomBirdInWikipedia();
        if (birdName) {
          console.log(`🌐 Найдена птица из Wikipedia: ${birdName}`);
        } else {
          birdName = getRandomBackupBird();
          console.log(`🔄 Wikipedia не дала результат, используем резерв: ${birdName}`);
        }
      } else {
        birdName = getRandomBackupBird();
        console.log(`🎯 Выбрана птица из резерва: ${birdName}`);
      }
      
      // Строгая проверка что это точно птица
      if (birdName && !await isDefinitelyBird(birdName)) {
        console.log(`❌ "${birdName}" не птица, ищем другую`);
        birdName = null;
        continue;
      }
      
      // Проверяем что есть реальное фото
      if (birdName && !await hasRealPhoto(birdName)) {
        console.log(`❌ Для "${birdName}" нет реального фото, ищем другую`);
        birdName = null;
        continue;
      }
      
      if (attempts >= maxAttempts) {
        console.log('🔄 Достигнут лимит попыток, берем гарантированную птицу');
        birdName = getGuaranteedBird();
        break;
      }
      
    } while ((!birdName || postedBirdsHistory.includes(birdName)) && attempts < maxAttempts);
    
    if (!birdName) {
      birdName = getGuaranteedBird();
      console.log(`🆘 Используем гарантированную птицу: ${birdName}`);
    }
    
    updateBirdHistory(birdName);
    console.log(`📊 История последних птиц (${postedBirdsHistory.length}): ${postedBirdsHistory.slice(0, 10).join(', ')}...`);
    
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

// Строгая проверка что это птица
async function isDefinitelyBird(birdName) {
  const notBirds = [
    'коммуна', 'департамент', 'кантон', 'округ', 'франция', 'регион',
    'пероб', 'муниципалитет', 'город', 'деревня', 'посёлок', 
    'населённый пункт', 'административный', 'территориальная',
    'район', 'провинция', 'область', 'кантона', 'кантоны', 'община',
    'значения', 'фильм', 'село', 'поселение', 'улица', 'площадь'
  ];
  
  const lowerName = birdName.toLowerCase();
  
  // Быстрая проверка по названию
  if (notBirds.some(notBird => lowerName.includes(notBird))) {
    return false;
  }
  
  // Проверяем через Wikipedia API
  try {
    const wikiData = await getBirdWikiData(birdName);
    const content = (wikiData.extract || '').toLowerCase();
    
    const birdKeywords = [
      'птица', 'воробьино', 'хищная', 'певчая', 'водоплавающ',
      'орнитолог', 'гнездо', 'клюв', 'крыло', 'перо', 'пение',
      'отряд', 'семейство', 'вид птиц', 'ареал обитания', 'миграция',
      'самец', 'самка', 'оперение', 'кладка яиц', 'выводок'
    ];
    
    const isBird = birdKeywords.some(keyword => content.includes(keyword));
    
    if (!isBird) {
      console.log(`⚠️  Не найдено ключевых слов птицы для: ${birdName}`);
      console.log(`📝 Контент: ${content.substring(0, 200)}...`);
    }
    
    return isBird;
  } catch (error) {
    return false;
  }
}

// Проверка что для птицы есть реальное фото
async function hasRealPhoto(birdName) {
  try {
    // Сначала проверяем Wikipedia
    const wikiData = await getBirdWikiData(birdName);
    if (wikiData.thumbnail && isRealPhoto(wikiData.thumbnail.source)) {
      return true;
    }
    
    // Затем проверяем Commons
    const testCommons = await findCommonsImage(birdName);
    if (testCommons) {
      return true;
    }
    
    // Проверяем резервные фото
    if (getBackupBirdImage(birdName)) {
      return true;
    }
    
    return false;
  } catch (error) {
    return false;
  }
}

// Проверка что это реальное фото (не рисунок)
function isRealPhoto(imageUrl) {
  if (!imageUrl) return false;
  
  const url = imageUrl.toLowerCase();
  
  // Исключаем рисунки, иконки, SVG
  const excluded = [
    'svg', 'drawing', 'illustration', 'vector', 'icon', 'silhouette',
    'cartoon', 'artwork', 'graphic', 'diagram', 'map', 'chart',
    'рисунок', 'иллюстрация', 'иконка', 'вектор', 'схема', 'карта'
  ];
  
  const isExcluded = excluded.some(word => url.includes(word));
  const isReal = url.includes('.jpg') || url.includes('.jpeg') || 
                url.includes('.png') || (url.includes('upload.wikimedia.org') && !isExcluded);
  
  return isReal;
}

function getRandomBackupBird() {
  return BACKUP_BIRDS[Math.floor(Math.random() * BACKUP_BIRDS.length)];
}

function getGuaranteedBird() {
  const guaranteedBirds = ["Воробей", "Синица", "Снегирь", "Сова", "Голубь", "Ворона"];
  return guaranteedBirds[Math.floor(Math.random() * guaranteedBirds.length)];
}

function updateBirdHistory(birdName) {
  postedBirdsHistory.unshift(birdName);
  if (postedBirdsHistory.length > MAX_HISTORY) {
    postedBirdsHistory = postedBirdsHistory.slice(0, MAX_HISTORY);
  }
}

async function findRandomBirdInWikipedia() {
  try {
    const categories = [
      "Категория:Птицы_по_алфавиту",
      "Категория:Певчие_птицы", 
      "Категория:Хищные_птицы",
      "Категория:Водоплавающие_птицы",
      "Категория:Птицы_Европы",
      "Категория:Птицы_Азии",
      "Категория:Птицы_Африки",
      "Категория:Птицы_Северной_Америки"
    ];
    
    const randomCategory = categories[Math.floor(Math.random() * categories.length)];
    const categoryUrl = `https://ru.wikipedia.org/w/api.php?action=query&list=categorymembers&cmtitle=${randomCategory}&cmtype=page&cmlimit=100&format=json`;
    
    const response = await fetch(categoryUrl);
    const data = await response.json();
    
    if (data.query && data.query.categorymembers && data.query.categorymembers.length > 0) {
      const birds = data.query.categorymembers;
      
      // Пробуем несколько случайных птиц из списка
      for (let i = 0; i < 8; i++) {
        const randomBird = birds[Math.floor(Math.random() * birds.length)];
        
        // Проверяем что это не слишком длинное название
        if (randomBird.title.length < 50 && 
            !randomBird.title.includes('(') && 
            !randomBird.title.includes(')') &&
            await quickBirdCheck(randomBird.title)) {
          return randomBird.title;
        }
      }
      
      return birds[0].title;
    }
    
    return null;
    
  } catch (error) {
    console.log('Ошибка поиска в Wikipedia:', error);
    return null;
  }
}

async function quickBirdCheck(birdName) {
  const notBirds = [
    'коммуна', 'департамент', 'кантон', 'округ', 'франция', 'регион',
    'пероб', 'муниципалитет', 'город', 'деревня', 'посёлок', 'община'
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
    return { 
      extract: generateDefaultDescription(birdName),
      thumbnail: null 
    };
  }
}

async function findBestBirdImage(birdName) {
  try {
    console.log(`🔍 Ищу РЕАЛЬНОЕ фото для: ${birdName}`);
    
    // 1. Пробуем Wikipedia
    const wikiData = await getBirdWikiData(birdName);
    if (wikiData.thumbnail && isRealPhoto(wikiData.thumbnail.source)) {
      console.log(`📸 Найдено реальное фото в Wikipedia: ${wikiData.thumbnail.source}`);
      return wikiData.thumbnail.source;
    }
    
    // 2. Пробуем Wikimedia Commons с улучшенным поиском
    const commonsImage = await findCommonsImage(birdName);
    if (commonsImage) {
      return commonsImage;
    }
    
    // 3. Используем резервные фото (все они реальные)
    const backupImage = getBackupBirdImage(birdName);
    if (backupImage) {
      console.log(`📸 Используем резервное реальное фото: ${backupImage}`);
      return backupImage;
    }
    
    console.log(`❌ Не найдено реальных фото для: ${birdName}`);
    return null;
    
  } catch (error) {
    console.log('Ошибка поиска изображения:', error);
    return getBackupBirdImage(birdName);
  }
}

async function findCommonsImage(birdName) {
  try {
    // Ключевые слова для поиска РЕАЛЬНЫХ фото
    const searchQueries = [
      `${birdName} bird photo wildlife`,
      `${birdName} птица фото природа`,
      `${birdName} in natural habitat`,
      `${birdName} wild bird`,
      `${birdName} -drawing -illustration -vector -svg`,
      `${birdName} photograph`
    ];
    
    const excludedWords = [
      'drawing', 'illustration', 'vector', 'svg', 'cartoon', 
      'art', 'painting', 'sketch', 'graphic', 'diagram', 'map',
      'рисунок', 'иллюстрация', 'вектор', 'арт', 'картина', 'схема'
    ];
    
    for (const query of searchQueries) {
      const commonsUrl = `https://commons.wikimedia.org/w/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(query)}&srnamespace=6&srlimit=20`;
      const response = await fetch(commonsUrl);
      const data = await response.json();
      
      if (data.query && data.query.search.length > 0) {
        // Ищем реальные фото, исключая рисунки
        const realPhotos = data.query.search.filter(img => {
          const title = img.title.toLowerCase();
          const isDrawing = excludedWords.some(word => title.includes(word));
          const isRealPhoto = title.includes('.jpg') || title.includes('.jpeg') || 
                             title.includes('.png') || title.includes('photo') ||
                             title.includes('photograph') || title.includes('wildlife') ||
                             title.includes('nature') || title.includes('natural');
          
          return !isDrawing && isRealPhoto;
        });
        
        if (realPhotos.length > 0) {
          // Берем лучшее фото (с "photo" или "wildlife" в названии)
          const bestPhoto = realPhotos.find(img => 
            img.title.toLowerCase().includes('photo') ||
            img.title.toLowerCase().includes('wildlife')
          ) || realPhotos[0];
          
          const filename = bestPhoto.title.replace('File:', '');
          const imageUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=800`;
          
          console.log(`📸 Найдено реальное фото в Commons: ${bestPhoto.title}`);
          
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
    "Колибри": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/07/Colibri-thalassinus-001.jpg/800px-Colibri-thalassinus-001.jpg",
    "Фламинго": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3b/Flamingos_Los_Roquetes.jpg/800px-Flamingos_Los_Roquetes.jpg",
    "Павлин": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/Peacock_Plumage.jpg/800px-Peacock_Plumage.jpg",
    "Лебедь": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/38/CygneVaires.jpg/800px-CygneVaires.jpg",
    "Аист": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/61/White_Stork_-_Ciconia_ciconia.jpg/800px-White_Stork_-_Ciconia_ciconia.jpg",
    "Пингвин": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/07/Emperor_Penguin_Manchot_empereur.jpg/800px-Emperor_Penguin_Manchot_empereur.jpg",
    "Чайка": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/81/Larus_argentatus_CA2.jpg/800px-Larus_argentatus_CA2.jpg",
    "Утка": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bf/Anas_platyrhynchos_maryland.jpg/800px-Anas_platyrhynchos_maryland.jpg"
  };
  
  return backupImages[birdName] || null;
}

function generateDefaultDescription(birdName) {
  const descriptions = [
    `${birdName} - удивительная птица с уникальными особенностями и поведением.`,
    `Птица ${birdName} обладает прекрасными адаптациями к своей среде обитания.`,
    `${birdName} относится к удивительному миру птиц с разнообразными повадками.`
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
    
    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
      return getDefaultFacts(birdName);
    }
    
    const text = data.candidates[0].content.parts[0].text;
    console.log(`✅ Gemini ответ получен: ${text.substring(0, 100)}...`);
    
    const facts = text.split('\n')
      .filter(line => line.trim().startsWith('•'))
      .map(fact => fact.replace(/^•\s*/, '').trim())
      .filter(fact => fact.length > 10 && fact.length < 100)
      .slice(0, 3);
    
    if (facts.length === 0) {
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

// Функции для работы с историей и викторинами
export function getWeeklyBirds() {
  return [...postedBirdsHistory];
}

export function getRandomBirdFromHistory() {
  if (postedBirdsHistory.length === 0) return null;
  return postedBirdsHistory[Math.floor(Math.random() * postedBirdsHistory.length)];
}

export function getBirdsCount() {
  return postedBirdsHistory.length;
}

// Хранилище фактов для каждой птицы (чтобы не путать)
const birdFactsHistory = new Map();

export function saveBirdFacts(birdName, facts) {
  birdFactsHistory.set(birdName, facts);
  console.log(`💾 Сохранены факты для ${birdName}: ${facts.length} фактов`);
}

export function getBirdFacts(birdName) {
  return birdFactsHistory.get(birdName) || [];
}

export function getAllBirdFacts() {
  return birdFactsHistory;
}