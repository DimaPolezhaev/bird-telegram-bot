import fetch from 'node-fetch';
import { Redis } from '@upstash/redis';

const GEMINI_API_KEY = "AIzaSyBU4Qvoc_gBsJ_EjD6OeToGl9cDrInANSg";
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

// Инициализация Redis
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Список проверенных птиц
const BACKUP_BIRDS = [
  "Большая синица", "Обыкновенный скворец", "Полевой воробей", "Домовый воробей", 
  "Обыкновенный снегирь", "Ушастая сова", "Серая ворона", "Сорока", "Озёрная чайка",
  "Большой пёстрый дятел", "Зелёный дятел", "Обыкновенная лазоревка", "Чёрный стриж",
  "Деревенская ласточка", "Обыкновенный поползень", "Зарянка", "Обыкновенная пищуха",
  "Обыкновенный жулан", "Обыкновенная иволга", "Обыкновенный соловей"
];

// Ключи для Redis
const BIRDS_HISTORY_KEY = 'birds:history';
const BIRDS_FACTS_KEY = 'birds:facts';

export async function getRandomBirdData() {
  try {
    let birdName;
    let attempts = 0;
    const maxAttempts = 8;
    
    do {
      attempts++;
      
      // 70% chance - брать из Wikipedia, 30% - из резервного списка
      const useWikipedia = Math.random() < 0.70;
      
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
      
      // Корректируем название для Wikipedia
      birdName = correctBirdName(birdName);
      
      // Проверяем что это конкретная птица
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
    
    // ГЕНЕРАЦИЯ ФАКТОВ - ОСНОВНАЯ ЛОГИКА
    console.log(`🚀 Начинаем генерацию фактов для: ${birdName}`);
    let facts = await generateBirdFactsWithGemini(birdName, wikiData.extract);
    
    // Сохраняем факты независимо от их качества
    await saveBirdFacts(birdName, facts);
    
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

// ПРОВЕРКА ЧТО ЭТО КОНКРЕТНАЯ ПТИЦА
async function isConcreteBird(birdName) {
  const lowerName = birdName.toLowerCase();
  
  // Запрещенные слова - таксономические группы
  const forbiddenWords = [
    'образные', 'iformes', 'подотряд', 'семейство', 'род ', 'отряд',
    'список', 'таблица', 'категория', 'классификация'
  ];
  
  if (forbiddenWords.some(word => lowerName.includes(word))) {
    return false;
  }
  
  // Проверяем через Wikipedia API
  try {
    const wikiData = await getBirdWikiData(birdName);
    
    if (!wikiData || !wikiData.extract) {
      return false;
    }
    
    const content = wikiData.extract.toLowerCase();
    
    // Ключевые слова для конкретных птиц
    const concreteKeywords = [
      'длина тела', 'размах крыльев', 'весит', 'окрас', 'гнездится',
      'откладывает яйца', 'питается', 'мигрирует', 'самец', 'самка'
    ];
    
    const isConcrete = concreteKeywords.some(keyword => content.includes(keyword));
    
    if (isConcrete) {
      console.log(`✅ "${birdName}" подтверждена как конкретная птица`);
    }
    
    return isConcrete;
  } catch (error) {
    return false;
  }
}

// Проверка что для птицы есть реальное фото
async function hasRealPhoto(birdName) {
  try {
    const wikiData = await getBirdWikiData(birdName);
    if (wikiData.thumbnail && isRealPhoto(wikiData.thumbnail.source)) {
      return true;
    }
    
    const backupImage = getBackupBirdImage(birdName);
    return !!backupImage;
    
  } catch (error) {
    return false;
  }
}

// Проверка что это реальное фото
function isRealPhoto(imageUrl) {
  if (!imageUrl) return false;
  
  const url = imageUrl.toLowerCase();
  const excluded = ['svg', 'drawing', 'illustration', 'vector', 'icon'];
  
  const isExcluded = excluded.some(word => url.includes(word));
  const isReal = url.includes('.jpg') || url.includes('.jpeg') || url.includes('.png');
  
  return isReal && !isExcluded;
}

function getRandomBackupBird() {
  return BACKUP_BIRDS[Math.floor(Math.random() * BACKUP_BIRDS.length)];
}

function getGuaranteedBird() {
  const guaranteedBirds = ["Большая синица", "Полевой воробей", "Озёрная чайка", "Серая ворона"];
  return guaranteedBirds[Math.floor(Math.random() * guaranteedBirds.length)];
}

// Коррекция названий птиц
function correctBirdName(birdName) {
  const corrections = {
    "Воробей домовый": "Домовый воробей",
    "Воробей полевой": "Полевой воробей",
    "Синица большая": "Большая синица", 
    "Снегирь обыкновенный": "Обыкновенный снегирь",
    "Сова ушастая": "Ушастая сова",
    "Ворона серая": "Серая ворона",
    "Чайка озёрная": "Озёрная чайка",
    "Дятел большой пёстрый": "Большой пёстрый дятел",
    "Синица лазоревка": "Обыкновенная лазоревка",
    "Ласточка деревенская": "Деревенская ласточка"
  };
  
  return corrections[birdName] || birdName;
}

// Поиск случайной птицы в Wikipedia
async function findRandomBirdInWikipedia() {
  try {
    const categories = [
      "Категория:Птицы_России",
      "Категория:Птицы_Европы", 
      "Категория:Певчие_птицы",
      "Категория:Воробьинообразные",
      "Категория:Хищные_птицы"
    ];
    
    const randomCategory = categories[Math.floor(Math.random() * categories.length)];
    const categoryUrl = `https://ru.wikipedia.org/w/api.php?action=query&list=categorymembers&cmtitle=${randomCategory}&cmtype=page&cmlimit=100&format=json`;
    
    const response = await fetch(categoryUrl);
    const data = await response.json();
    
    if (data.query?.categorymembers?.length > 0) {
      const birds = data.query.categorymembers;
      const shuffledBirds = [...birds].sort(() => Math.random() - 0.5);
      
      for (const bird of shuffledBirds.slice(0, 10)) {
        if (bird.title.length < 50 && 
            !bird.title.includes('(значения)') &&
            !bird.title.includes('список')) {
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

// Получение данных из Wikipedia
async function getBirdWikiData(birdName) {
  try {
    const response = await fetch(
      `https://ru.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(birdName)}`
    );
    
    if (response.ok) {
      return await response.json();
    } else {
      throw new Error(`Wikipedia API error: ${response.status}`);
    }
  } catch (error) {
    console.log(`❌ Ошибка Wikipedia для ${birdName}:`, error.message);
    return { 
      extract: generateDefaultDescription(birdName),
      thumbnail: null 
    };
  }
}

// Поиск лучшего изображения
async function findBestBirdImage(birdName) {
  try {
    const wikiData = await getBirdWikiData(birdName);
    if (wikiData.thumbnail && isRealPhoto(wikiData.thumbnail.source)) {
      return wikiData.thumbnail.source;
    }
    
    const backupImage = getBackupBirdImage(birdName);
    if (backupImage) {
      return backupImage;
    }
    
    return null;
  } catch (error) {
    return getBackupBirdImage(birdName);
  }
}

// Резервные изображения
function getBackupBirdImage(birdName) {
  const backupImages = {
    "Большая синица": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Parus_major_-_London_-_England-8.jpg/800px-Parus_major_-_London_-_England-8.jpg",
    "Полевой воробей": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Passer_domesticus_male_%2815%29.jpg/800px-Passer_domesticus_male_%2815%29.jpg",
    "Домовый воробей": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Passer_domesticus_male_%2815%29.jpg/800px-Passer_domesticus_male_%2815%29.jpg",
    "Обыкновенный снегирь": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/33/Pyrrhula_pyrrhula_-Rila_Mountains%2C_Bulgaria_-male-8.jpg/800px-Pyrrhula_pyrrhula_-Rila_Mountains%2C_Bulgaria_-male-8.jpg",
    "Ушастая сова": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3c/Bubo_bubo_-_Eagle_Owl_-_Uhu.jpg/800px-Bubo_bubo_-_Eagle_Owl_-_Uhu.jpg",
    "Серая ворона": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/Corvus_corone_-_England_-_adult-8.jpg/800px-Corvus_corone_-_England_-_adult-8.jpg",
    "Сорока": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5b/Pica_pica_-_England_-_adult-8.jpg/800px-Pica_pica_-_England_-_adult-8.jpg",
    "Озёрная чайка": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/29/Chroicocephalus_ridibundus_%28summer%29.jpg/800px-Chroicocephalus_ridibundus_%28summer%29.jpg",
    "Большой пёстрый дятел": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/be/Dendrocopos_major_-_01.jpg/800px-Dendrocopos_major_-_01.jpg",
    "Обыкновенный скворец": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Sturnus_vulgaris_-_England_-_adult-8.jpg/800px-Sturnus_vulgaris_-_England_-_adult-8.jpg",
    "Зелёный дятел": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Picus_viridis_-_01.jpg/800px-Picus_viridis_-_01.jpg",
    "Обыкновенная лазоревка": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1e/Cyanistes_caeruleus_-_England_-_adult-8.jpg/800px-Cyanistes_caeruleus_-_England_-_adult-8.jpg",
    "Чёрный стриж": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6d/Apus_apus_-_England-8.jpg/800px-Apus_apus_-_England-8.jpg",
    "Деревенская ласточка": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/Hirundo_rustica_-_England-8.jpg/800px-Hirundo_rustica_-_England-8.jpg",
    "Обыкновенный поползень": "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7e/Sitta_europaea_-_England-8.jpg/800px-Sitta_europaea_-_England-8.jpg",
    "Зарянка": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5b/Erithacus_rubecula_-_England-8.jpg/800px-Erithacus_rubecula_-_England-8.jpg",
    "Обыкновенная пищуха": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6c/Certhia_familiaris_-_England-8.jpg/800px-Certhia_familiaris_-_England-8.jpg",
    "Обыкновенный жулан": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4c/Lanius_collurio_-_England-8.jpg/800px-Lanius_collurio_-_England-8.jpg",
    "Обыкновенная иволга": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6c/Oriolus_oriolus_-_England-8.jpg/800px-Oriolus_oriolus_-_England-8.jpg",
    "Обыкновенный соловей": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5b/Luscinia_megarhynchos_-_England-8.jpg/800px-Luscinia_megarhynchos_-_England-8.jpg"
  };
  
  return backupImages[birdName] || null;
}

function generateDefaultDescription(birdName) {
  return `${birdName} - интересный представитель мира птиц со своими особенностями поведения и внешнего вида.`;
}

// ГЛАВНАЯ ФУНКЦИЯ ГЕНЕРАЦИИ ФАКТОВ - УПРОЩЕННАЯ И НАДЕЖНАЯ
async function generateBirdFactsWithGemini(birdName, description) {
  try {
    console.log(`🧠 Запрос к Gemini для: ${birdName}`);
    
    const prompt = `Создай 3 точных и интересных факта о птице "${birdName}".

${description ? `Информация: ${description.substring(0, 300)}` : ''}

Требования:
- Каждый факт начинается с "•"
- Факты 20-70 символов
- Только конкретные научные факты
- Русский язык

Формат:
• Факт 1
• Факт 2
• Факт 3

Пример для "Большая синица":
• За день съедает насекомых больше своего веса
• Зимой активно посещает кормушки
• Гнездится в дуплах и скворечниках`;

    const payload = {
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 250,
      }
    };
    
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    // ПРОСТАЯ И НАДЕЖНАЯ ПРОВЕРКА ОТВЕТА
    let text = '';
    
    if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
      text = data.candidates[0].content.parts[0].text;
    } else {
      console.log('❌ Нестандартная структура ответа:', JSON.stringify(data).substring(0, 200));
      return getSimpleFacts(birdName);
    }
    
    console.log(`✅ Ответ Gemini получен: ${text.substring(0, 100)}...`);
    
    // ПРОСТОЙ ПАРСИНГ ФАКТОВ
    const facts = text.split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('•'))
      .map(fact => fact.replace(/^•\s*/, '').trim())
      .filter(fact => fact.length >= 15 && fact.length <= 80)
      .slice(0, 3);
    
    console.log(`📊 Извлечено фактов: ${facts.length}`);
    
    // ВСЕГДА возвращаем факты от Gemini, даже если их мало
    if (facts.length > 0) {
      return facts;
    } else {
      // Если фактов нет, используем простые сгенерированные
      return getSimpleFacts(birdName);
    }
    
  } catch (error) {
    console.error('❌ Ошибка Gemini:', error.message);
    // При ошибке все равно возвращаем сгенерированные факты
    return getSimpleFacts(birdName);
  }
}

// ПРОСТЫЕ СГЕНЕРИРОВАННЫЕ ФАКТЫ (не дефолтные общие)
function getSimpleFacts(birdName) {
  console.log(`🔧 Генерируем простые факты для: ${birdName}`);
  
  // Базовые факты для разных типов птиц
  if (birdName.includes('синица')) {
    return [
      "Полезный уничтожитель насекомых-вредителей",
      "Гнездится в дуплах деревьев и скворечниках", 
      "Зимой нуждается в подкормке человеком"
    ];
  }
  
  if (birdName.includes('воробей')) {
    return [
      "Тесно связан с человеческими поселениями",
      "Питается семенами и пищевыми отходами",
      "Гнездится под крышами и в щелях зданий"
    ];
  }
  
  if (birdName.includes('чайка')) {
    return [
      "Гнездится колониями на озёрных островах",
      "Питается рыбой, насекомыми и отбросами",
      "Имеет крепкий клюв для разрывания пищи"
    ];
  }
  
  if (birdName.includes('ворона')) {
    return [
      "Одна из самых умных птиц в мире",
      "Может использовать простые инструменты",
      "Обладает отличной памятью"
    ];
  }
  
  if (birdName.includes('дятел')) {
    return [
      "Долбит кору деревьев в поисках насекомых",
      "Имеет жесткий хвост для опоры при долблении",
      "Создает барабанную дробь для общения"
    ];
  }
  
  if (birdName.includes('сова')) {
    return [
      "Охотится преимущественно в ночное время",
      "Имеет бесшумный полёт благодаря оперению",
      "Может поворачивать голову на 270 градусов"
    ];
  }
  
  if (birdName.includes('снегирь')) {
    return [
      "Самцы имеют ярко-красную окраску грудки",
      "Зимой часто прилетает в города за ягодами",
      "Питается почками, семенами и ягодами"
    ];
  }
  
  if (birdName.includes('ласточка')) {
    return [
      "Ловит насекомых на лету в воздухе",
      "Строит гнёзда из глины и грязи",
      "Совершает сезонные миграции на юг"
    ];
  }
  
  if (birdName.includes('скворец')) {
    return [
      "Отличный имитатор различных звуков",
      "Гнездится в дуплах и скворечниках",
      "Образует большие стаи во время миграций"
    ];
  }
  
  if (birdName.includes('соловей')) {
    return [
      "Обладает одним из самых красивых певчих голосов",
      "Поёт преимущественно ночью и на рассвете",
      "Обитает в густых кустарниковых зарослях"
    ];
  }
  
  // Универсальные, но конкретные факты
  return [
    "Имеет специфические особенности оперения",
    "Обладает специализированным способом питания",
    "Сезонно меняет места обитания и поведение"
  ];
}

// Резервные данные
async function getFallbackBirdData() {
  const fallbackBirds = [
    { 
      name: "Большая синица", 
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Parus_major_-_London_-_England-8.jpg/800px-Parus_major_-_London_-_England-8.jpg",
      description: "Большая синица - полезная лесная птица, активно уничтожающая насекомых-вредителей."
    },
    { 
      name: "Озёрная чайка", 
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/29/Chroicocephalus_ridibundus_%28summer%29.jpg/800px-Chroicocephalus_ridibundus_%28summer%29.jpg",
      description: "Озёрная чайка - распространённая водоплавающая птица, обитающая на внутренних водоёмах."
    }
  ];
  
  const bird = fallbackBirds[Math.floor(Math.random() * fallbackBirds.length)];
  const facts = getSimpleFacts(bird.name);
  
  return {
    name: bird.name,
    description: bird.description,
    imageUrl: bird.image,
    facts: facts
  };
}