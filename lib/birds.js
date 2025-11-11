import fetch from 'node-fetch';
import { Redis } from '@upstash/redis';

const GEMINI_API_KEY = "AIzaSyBU4Qvoc_gBsJ_EjD6OeToGl9cDrInANSg";
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

// Инициализация Redis
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Расширенный резервный список КОНКРЕТНЫХ птиц
const BACKUP_BIRDS = [
  "Большой пёстрый дятел", "Белоспинный дятел", "Зелёный дятел", "Желна", "Вертишейка",
  "Воробей полевой", "Воробей домовый", "Синица большая", "Синица лазоревка", "Синица московка",
  "Снегирь обыкновенный", "Сова ушастая", "Сова болотная", "Неясыть серая", "Сыч домовый",
  "Голубь сизый", "Голубь скалистый", "Ворона серая", "Ворона чёрная", "Сорока обыкновенная",
  "Скворец обыкновенный", "Ласточка деревенская", "Ласточка городская", "Стриж чёрный",
  "Орлан-белохвост", "Орёл беркут", "Орёл могильник", "Сокол сапсан", "Сокол чеглок",
  "Попугай волнистый", "Попугай жако", "Попугай ара", "Колибри рубиногорлый", "Колибри аннийский",
  "Фламинго розовый", "Фламинго чилийский", "Павлин обыкновенный", "Лебедь-шипун", "Лебедь-кликун",
  "Аист белый", "Аист чёрный", "Пингвин императорский", "Пингвин адели", "Чайка серебристая",
  "Чайка озёрная", "Утка кряква", "Утка серая", "Гоголь обыкновенный", "Кряква обыкновенная"
];

// Ключи для Redis
const BIRDS_HISTORY_KEY = 'birds:history';
const BIRDS_FACTS_KEY = 'birds:facts';

// ЗАПРЕЩЕННЫЕ СЛОВА - таксономические группы и не-птицы
const FORBIDDEN_WORDS = [
  // Таксономические группы
  'образные', 'iformes', 'подотряд', 'надсемейство', 'семейство', 'род ', 'триба ',
  'отряд', 'подвид', 'вид ', 'класс', 'порядок', 'таксон', 'группа', 'подгруппа',
  'дятлообразные', 'воробьинообразные', 'соколообразные', 'совообразные', 'гусеобразные',
  'курообразные', 'голубеобразные', 'ржанкообразные', 'аистообразные', 'пеликанообразные',
  
  // Не-птицы
  'коммуна', 'департамент', 'кантон', 'округ', 'франция', 'регион', 'пероб',
  'муниципалитет', 'город', 'деревня', 'посёлок', 'населённый пункт', 'административный',
  'территориальная', 'район', 'провинция', 'область', 'кантона', 'кантоны', 'община',
  'значения', 'фильм', 'село', 'поселение', 'улица', 'площадь', 'список', 'перечень',
  'таблица', 'категория', 'классификация', 'систематика', 'эволюция', 'филогения'
];

export async function getRandomBirdData() {
  try {
    let birdName;
    let attempts = 0;
    const maxAttempts = 12;
    
    do {
      attempts++;
      
      // 75% chance - брать из Wikipedia, 25% - из резервного списка
      const useWikipedia = Math.random() < 0.75;
      
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
      
      // СТРОГАЯ проверка что это КОНКРЕТНАЯ птица
      if (birdName && !await isConcreteBird(birdName)) {
        console.log(`❌ "${birdName}" не конкретная птица, ищем другую`);
        birdName = null;
        continue;
      }
      
      // Проверяем что есть реальное фото
      if (birdName && !await hasRealPhoto(birdName)) {
        console.log(`❌ Для "${birdName}" нет реального фото, ищем другую`);
        birdName = null;
        continue;
      }
      
      // Проверяем историю
      if (birdName && await isBirdInHistory(birdName)) {
        console.log(`🔄 "${birdName}" уже была в истории, ищем другую`);
        birdName = null;
        continue;
      }
      
      if (attempts >= maxAttempts) {
        console.log('🔄 Достигнут лимит попыток, берем гарантированную птицу');
        birdName = getGuaranteedBird();
        break;
      }
      
    } while (!birdName && attempts < maxAttempts);
    
    if (!birdName) {
      birdName = getGuaranteedBird();
      console.log(`🆘 Используем гарантированную птицу: ${birdName}`);
    }
    
    await updateBirdHistory(birdName);
    
    const wikiData = await getBirdWikiData(birdName);
    
    // ГЕНЕРАЦИЯ ФАКТОВ С ГАРАНТИЕЙ
    let facts = await generateBirdFactsWithGemini(birdName, wikiData.extract);
    
    // Если факты плохие, пробуем еще раз
    if (facts.length < 2 || facts.some(fact => !fact || fact.length < 10 || isGenericFact(fact))) {
      console.log(`🔄 Плохие факты, пробуем еще раз для: ${birdName}`);
      facts = await generateBirdFactsWithGemini(birdName, wikiData.extract);
    }
    
    // Если все еще плохо, используем дефолтные КОНКРЕТНЫЕ факты
    if (facts.length < 2 || facts.some(fact => isGenericFact(fact))) {
      console.log(`🔄 Используем дефолтные факты для: ${birdName}`);
      facts = getDefaultFacts(birdName);
    }
    
    const imageUrl = await findBestBirdImage(birdName);
    
    return {
      name: birdName,
      description: wikiData.extract || generateDefaultDescription(birdName),
      imageUrl: imageUrl,
      facts: facts
    };
    
  } catch (error) {
    console.error('❌ Критическая ошибка в getRandomBirdData:', error);
    return await getFallbackBirdData();
  }
}

// Функции для работы с историей через Upstash Redis
export async function getWeeklyBirds() {
  try {
    const birds = await redis.lrange(BIRDS_HISTORY_KEY, 0, -1);
    return birds || [];
  } catch (error) {
    console.error('Ошибка получения истории из Redis:', error);
    return [];
  }
}

export async function getRandomBirdFromHistory() {
  const birds = await getWeeklyBirds();
  if (birds.length === 0) return null;
  return birds[Math.floor(Math.random() * birds.length)];
}

export async function saveBirdFacts(birdName, facts) {
  try {
    // Добавляем птицу в историю
    await redis.lpush(BIRDS_HISTORY_KEY, birdName);
    // Ограничиваем историю 30 птицами
    await redis.ltrim(BIRDS_HISTORY_KEY, 0, 29);
    
    // Сохраняем факты
    await redis.hset(BIRDS_FACTS_KEY, { [birdName]: JSON.stringify(facts) });
    
    console.log(`💾 Сохранены факты для ${birdName} в Upstash Redis: ${facts.length} фактов`);
  } catch (error) {
    console.error('Ошибка сохранения в Redis:', error);
  }
}

export async function getBirdFacts(birdName) {
  try {
    const factsJson = await redis.hget(BIRDS_FACTS_KEY, birdName);
    return factsJson ? JSON.parse(factsJson) : [];
  } catch (error) {
    console.error('Ошибка получения фактов из Redis:', error);
    return [];
  }
}

export async function getAllBirdFacts() {
  try {
    const allFacts = await redis.hgetall(BIRDS_FACTS_KEY);
    const result = new Map();
    
    if (allFacts) {
      for (const [bird, factsJson] of Object.entries(allFacts)) {
        result.set(bird, JSON.parse(factsJson));
      }
    }
    
    return result;
  } catch (error) {
    console.error('Ошибка получения всех фактов из Redis:', error);
    return new Map();
  }
}

export async function getBirdsCount() {
  const birds = await getWeeklyBirds();
  return birds.length;
}

// Вспомогательные функции
async function isBirdInHistory(birdName) {
  const birds = await getWeeklyBirds();
  return birds.includes(birdName);
}

async function updateBirdHistory(birdName) {
  const birds = await getWeeklyBirds();
  const updatedBirds = [birdName, ...birds.filter(b => b !== birdName)].slice(0, 30);
  
  // Очищаем и перезаписываем список
  await redis.del(BIRDS_HISTORY_KEY);
  if (updatedBirds.length > 0) {
    await redis.lpush(BIRDS_HISTORY_KEY, ...updatedBirds);
  }
}

// СТРОГАЯ ПРОВЕРКА ЧТО ЭТО КОНКРЕТНАЯ ПТИЦА
async function isConcreteBird(birdName) {
  const lowerName = birdName.toLowerCase();
  
  // 1. Проверка на запрещенные слова (таксономические группы)
  if (FORBIDDEN_WORDS.some(forbidden => lowerName.includes(forbidden))) {
    console.log(`❌ "${birdName}" содержит запрещенное слово`);
    return false;
  }
  
  // 2. Проверка что это не научная классификация
  if (lowerName.includes('(род') || lowerName.includes('(семейство') || 
      lowerName.includes('(отряд') || lowerName.includes('(подотряд')) {
    return false;
  }
  
  // 3. Проверка через Wikipedia API
  try {
    const wikiData = await getBirdWikiData(birdName);
    
    if (!wikiData || !wikiData.extract) {
      console.log(`❌ Нет данных Wikipedia для: ${birdName}`);
      return false;
    }
    
    const content = wikiData.extract.toLowerCase();
    
    // Ключевые слова для КОНКРЕТНЫХ птиц
    const concreteBirdKeywords = [
      'длина тела', 'размах крыльев', 'весит', 'весом', 'окрас', 'окраска',
      'гнездится', 'откладывает', 'яйца', 'питается', 'рацион', 'мигрирует',
      'обитает в', 'встречается', 'ареал', 'самец', 'самка', 'пение',
      'голос', 'крик', 'сезон размножения', 'выводок', 'продолжительность жизни'
    ];
    
    // Слова указывающие на таксономическую группу
    const taxonomicKeywords = [
      'отряд', 'семейство', 'род ', 'подсемейство', 'триба', 'клада',
      'классификация', 'систематика', 'филогения', 'эволюция', 'таксон',
      'включает виды', 'насчитывает видов', 'распространены', 'представители'
    ];
    
    const isConcrete = concreteBirdKeywords.some(keyword => content.includes(keyword));
    const isTaxonomic = taxonomicKeywords.some(keyword => content.includes(keyword));
    
    if (isTaxonomic && !isConcrete) {
      console.log(`❌ "${birdName}" - таксономическая группа, а не конкретная птица`);
      return false;
    }
    
    if (!isConcrete) {
      console.log(`⚠️  Не найдено признаков конкретной птицы для: ${birdName}`);
      console.log(`📝 Контент: ${content.substring(0, 200)}...`);
    } else {
      console.log(`✅ "${birdName}" подтверждена как конкретная птица`);
    }
    
    return isConcrete;
  } catch (error) {
    console.log(`❌ Ошибка проверки птицы ${birdName}:`, error.message);
    return false;
  }
}

// Проверка что факт не общий
function isGenericFact(fact) {
  const genericFacts = [
    'обладает уникальными адаптациями',
    'играет важную роль',
    'имеет интересные особенности',
    'уникальные особенности поведения',
    'важная роль в экосистеме',
    'адаптации к среде обитания'
  ];
  
  const lowerFact = fact.toLowerCase();
  return genericFacts.some(generic => lowerFact.includes(generic));
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
    console.log(`❌ Ошибка проверки фото для ${birdName}:`, error.message);
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
  const guaranteedBirds = ["Большой пёстрый дятел", "Синица большая", "Снегирь обыкновенный", "Сова ушастая", "Голубь сизый", "Ворона серая"];
  return guaranteedBirds[Math.floor(Math.random() * guaranteedBirds.length)];
}

// УЛУЧШЕННЫЙ ПОИСК КОНКРЕТНЫХ ПТИЦ
async function findRandomBirdInWikipedia() {
  try {
    // Используем конкретные категории с КОНКРЕТНЫМИ птицами
    const categories = [
      "Категория:Птицы_Европы",
      "Категория:Птицы_России", 
      "Категория:Птицы_Сибири",
      "Категория:Птицы_Дальнего_Востока",
      "Категория:Птицы_Северной_Америки",
      "Категория:Птицы_Южной_Америки",
      "Категория:Птицы_Африки",
      "Категория:Птицы_Азии",
      "Категория:Певчие_птицы",
      "Категория:Хищные_птицы",
      "Категория:Водоплавающие_птицы",
      "Категория:Лесные_птицы"
    ];
    
    const randomCategory = categories[Math.floor(Math.random() * categories.length)];
    const categoryUrl = `https://ru.wikipedia.org/w/api.php?action=query&list=categorymembers&cmtitle=${randomCategory}&cmtype=page&cmlimit=200&format=json`;
    
    const response = await fetch(categoryUrl);
    const data = await response.json();
    
    if (data.query && data.query.categorymembers && data.query.categorymembers.length > 0) {
      const birds = data.query.categorymembers;
      
      // Перемешиваем и пробуем несколько случайных птиц
      const shuffledBirds = [...birds].sort(() => Math.random() - 0.5);
      
      for (let i = 0; i < Math.min(20, shuffledBirds.length); i++) {
        const bird = shuffledBirds[i];
        
        // Строгая проверка названия
        if (bird.title.length < 50 && 
            !bird.title.includes('(значения)') &&
            !bird.title.includes('список') &&
            !bird.title.includes('таблица') &&
            !bird.title.includes('Категория:') &&
            !FORBIDDEN_WORDS.some(word => bird.title.toLowerCase().includes(word))) {
          
          return bird.title;
        }
      }
    }
    
    return null;
    
  } catch (error) {
    console.log('❌ Ошибка поиска в Wikipedia:', error.message);
    return null;
  }
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
    console.log(`❌ Ошибка получения данных Wikipedia для ${birdName}:`, error.message);
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
    console.log('❌ Ошибка поиска изображения:', error.message);
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
      
      try {
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
      } catch (error) {
        console.log(`❌ Ошибка поиска в Commons для запроса "${query}":`, error.message);
        continue;
      }
    }
    
    return null;
    
  } catch (error) {
    console.log('❌ Общая ошибка поиска в Commons:', error.message);
    return null;
  }
}

function getBackupBirdImage(birdName) {
  const backupImages = {
    "Большой пёстрый дятел": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/be/Dendrocopos_major_-_01.jpg/800px-Dendrocopos_major_-_01.jpg",
    "Белоспинный дятел": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4c/Dendrocopos_leucotos_-_01.jpg/800px-Dendrocopos_leucotos_-_01.jpg",
    "Зелёный дятел": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Picus_viridis_-_01.jpg/800px-Picus_viridis_-_01.jpg",
    "Воробей полевой": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Passer_domesticus_male_%2815%29.jpg/800px-Passer_domesticus_male_%2815%29.jpg",
    "Синица большая": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Parus_major_-_London_-_England-8.jpg/800px-Parus_major_-_London_-_England-8.jpg",
    "Снегирь обыкновенный": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/33/Pyrrhula_pyrrhula_-Rila_Mountains%2C_Bulgaria_-male-8.jpg/800px-Pyrrhula_pyrrhula_-Rila_Mountains%2C_Bulgaria_-male-8.jpg",
    "Сова ушастая": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3c/Bubo_bubo_-_Eagle_Owl_-_Uhu.jpg/800px-Bubo_bubo_-_Eagle_Owl_-_Uhu.jpg",
    "Голубь сизый": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/56/Columba_livia_-_England_-_free_flying-8.jpg/800px-Columba_livia_-_England_-_free_flying-8.jpg",
    "Ворона серая": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/Corvus_corone_-_England_-_adult-8.jpg/800px-Corvus_corone_-_England_-_adult-8.jpg",
    "Сорока обыкновенная": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5b/Pica_pica_-_England_-_adult-8.jpg/800px-Pica_pica_-_England_-_adult-8.jpg"
  };
  
  return backupImages[birdName] || null;
}

function generateDefaultDescription(birdName) {
  const descriptions = [
    `${birdName} - удивительная птица с уникальными особенностями и поведением.`,
    `Птица ${birdName} обладает прекрасными адаптациями к своей среде обитания.`,
    `${birdName} относится к удивительному миру птиц с разнообразными повадками.`,
    `${birdName} - представитель пернатых, имеющий свои особенности внешнего вида и образа жизни.`
  ];
  
  return descriptions[Math.floor(Math.random() * descriptions.length)];
}

// УЛУЧШЕННАЯ ФУНКЦИЯ ГЕНЕРАЦИИ ФАКТОВ
async function generateBirdFactsWithGemini(birdName, description) {
  try {
    const prompt = `Создай 3 точных и интересных факта о птице "${birdName}".

${description ? `Информация о птице: ${description.substring(0, 500)}` : ''}

ТРЕБОВАНИЯ:
- Каждый факт должен начинаться с "•"
- Факты должны быть 20-80 символов
- Только проверенные научные факты
- Конкретные факты об этой птице, не общие
- Русский язык
- Формат:
• Факт 1
• Факт 2  
• Факт 3

Пример для "Большой пёстрый дятел":
• Делает до 12000 ударов клювом в день
• Имеет язык длиной до 10 см с колючками
• Выбивает шишки в специальных "кузницах"

ВАЖНО: Только конкретные факты, без общих фраз!`;

    const payload = {
      contents: [{
        parts: [{
          text: prompt
        }]
      }],
      generationConfig: {
        temperature: 0.3,
        topK: 40,
        topP: 0.8,
        maxOutputTokens: 300,
      }
    };
    
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }
    
    const data = await response.json();
    
    // ЗАЩИЩЕННАЯ ПРОВЕРКА СТРУКТУРЫ ОТВЕТА
    if (!data || 
        !data.candidates || 
        !Array.isArray(data.candidates) || 
        data.candidates.length === 0 ||
        !data.candidates[0] ||
        !data.candidates[0].content ||
        !data.candidates[0].content.parts ||
        !Array.isArray(data.candidates[0].content.parts) ||
        data.candidates[0].content.parts.length === 0 ||
        !data.candidates[0].content.parts[0].text) {
      console.log('❌ Неверная структура ответа от Gemini');
      return getDefaultFacts(birdName);
    }
    
    const text = data.candidates[0].content.parts[0].text;
    console.log(`✅ Ответ Gemini: ${text.substring(0, 100)}...`);
    
    // УЛУЧШЕННЫЙ ПАРСИНГ
    const facts = text.split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('•') || line.startsWith('-') || line.match(/^\d+\./))
      .map(fact => {
        // Убираем маркеры списка
        return fact.replace(/^[•\-]\s*/, '')
                  .replace(/^\d+\.\s*/, '')
                  .trim();
      })
      .filter(fact => fact.length > 10 && fact.length < 100 && !isGenericFact(fact))
      .slice(0, 3);
    
    console.log(`📊 Получено фактов после парсинга: ${facts.length}`, facts);
    
    if (facts.length === 0) {
      console.log('🔄 Используем дефолтные факты из-за пустого результата');
      return getDefaultFacts(birdName);
    }
    
    return facts;
    
  } catch (error) {
    console.error('❌ Ошибка Gemini:', error.message);
    return getDefaultFacts(birdName);
  }
}

function getDefaultFacts(birdName) {
  // КОНКРЕТНЫЕ факты для конкретных птиц
  const defaultFacts = {
    "Большой пёстрый дятел": [
      "Делает до 12000 ударов клювом в день",
      "Имеет язык длиной до 10 см с колючками",
      "Выбивает шишки в специальных 'кузницах'"
    ],
    "Синица большая": [
      "Может делать до 1000 кормовых вылетов в день",
      "За сутки съедает насекомых больше своего веса",
      "Зимой образует смешанные стаи с другими синицами"
    ],
    "Снегирь обыкновенный": [
      "Самцы имеют ярко-красную грудку, самки - серую",
      "Зимой часто прилетают в города за ягодами",
      "Питаются почками, семенами и ягодами рябины"
    ],
    "Сова ушастая": [
      "Поворачивает голову на 270 градусов",
      "Имеет асимметричные ушные отверстия для точной локации",
      "Летает практически бесшумно благодаря особому оперению"
    ],
    "Голубь сизый": [
      "Может развивать скорость до 100 км/ч",
      "Обладает феноменальной способностью находить дорогу",
      "Пьёт воду, всасывая её как через соломинку"
    ],
    "Ворона серая": [
      "Одна из самых умных птиц в мире",
      "Может использовать простые инструменты для добычи пищи",
      "Обладает отличной памятью и обучаемостью"
    ]
  };
  
  if (defaultFacts[birdName]) {
    return defaultFacts[birdName];
  }
  
  // Для неизвестных птиц - пытаемся сгенерировать что-то конкретное
  if (birdName.includes('дятел')) {
    return [
      "Долбит кору деревьев в поисках насекомых",
      "Имеет жесткий хвост для опоры при долблении",
      "Создает барабанную дробь для общения"
    ];
  }
  
  if (birdName.includes('синица')) {
    return [
      "Полезный уничтожитель насекомых-вредителей",
      "Гнездится в дуплах и искусственных гнездовьях",
      "Активно посещает кормушки зимой"
    ];
  }
  
  return [
    "Обладает уникальным оперением и окраской",
    "Имеет специальные адаптации для добычи пищи",
    "Сезонно мигрирует в поисках лучших условий"
  ];
}

async function getFallbackBirdData() {
  const fallbackBirds = [
    { 
      name: "Большой пёстрый дятел", 
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/be/Dendrocopos_major_-_01.jpg/800px-Dendrocopos_major_-_01.jpg",
      description: "Большой пёстрый дятел - одна из самых известных птиц лесов России. Обитает в лиственных и хвойных лесах."
    },
    { 
      name: "Синица большая", 
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Parus_major_-_London_-_England-8.jpg/800px-Parus_major_-_London_-_England-8.jpg",
      description: "Синица большая - полезная лесная птица, активно уничтожающая насекомых-вредителей."
    },
    { 
      name: "Снегирь обыкновенный", 
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/33/Pyrrhula_pyrrhula_-Rila_Mountains%2C_Bulgaria_-male-8.jpg/800px-Pyrrhula_pyrrhula_-Rila_Mountains%2C_Bulgaria_-male-8.jpg",
      description: "Снегирь обыкновенный - красивая птица с ярким оперением, часто посещающая города зимой."
    }
  ];
  
  const bird = fallbackBirds[Math.floor(Math.random() * fallbackBirds.length)];
  const facts = getDefaultFacts(bird.name);
  
  return {
    name: bird.name,
    description: bird.description,
    imageUrl: bird.image,
    facts: facts
  };
}