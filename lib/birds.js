import fetch from 'node-fetch';
import { Redis } from '@upstash/redis';

const GEMINI_API_KEY = "AIzaSyBU4Qvoc_gBsJ_EjD6OeToGl9cDrInANSg";
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

// Инициализация Redis
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Минимальный резервный список проверенных птиц
const BACKUP_BIRDS = [
  "Воробей", "Синица", "Снегирь", "Сова", "Голубь", "Ворона", "Сорока",
  "Скворец", "Ласточка", "Дятел", "Орёл", "Сокол", "Попугай", "Колибри",
  "Фламинго", "Павлин", "Лебедь", "Аист", "Пингвин", "Чайка", "Утка"
];

// Ключи для Redis
const BIRDS_HISTORY_KEY = 'birds:history';
const BIRDS_FACTS_KEY = 'birds:facts';

export async function getRandomBirdData() {
  try {
    let birdName;
    let attempts = 0;
    const maxAttempts = 10;
    
    do {
      attempts++;
      
      // 80% chance - брать из Wikipedia, 20% - из резервного списка
      const useWikipedia = Math.random() < 0.80;
      
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
      
      // Улучшенная проверка что это точно птица
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
    
    // УЛУЧШЕННАЯ ГЕНЕРАЦИЯ ФАКТОВ
    let facts = await generateBirdFactsWithGemini(birdName, wikiData.extract);
    
    // Если факты плохие, пробуем еще раз
    if (facts.length < 2 || facts.some(fact => !fact || fact.length < 10)) {
      console.log(`🔄 Плохие факты, пробуем еще раз для: ${birdName}`);
      facts = await generateBirdFactsWithGemini(birdName, wikiData.extract);
    }
    
    // Если все еще плохо, используем дефолтные
    if (facts.length < 2) {
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

// УЛУЧШЕННАЯ СТРОГАЯ ПРОВЕРКА ЧТО ЭТО ПТИЦА
async function isDefinitelyBird(birdName) {
  const notBirds = [
    'коммуна', 'департамент', 'кантон', 'округ', 'россия', 'регион',
    'пероб', 'муниципалитет', 'город', 'деревня', 'посёлок', 
    'населённый пункт', 'административный', 'территориальная',
    'район', 'провинция', 'область', 'кантона', 'кантоны', 'община',
    'значения', 'фильм', 'село', 'поселение', 'улица', 'площадь',
    'список', 'перечень', 'таблица'
  ];
  
  const lowerName = birdName.toLowerCase();
  
  // Быстрая проверка по названию
  if (notBirds.some(notBird => lowerName.includes(notBird))) {
    return false;
  }
  
  // Явные указатели на птиц
  const birdIndicators = [
    'чайка', 'дрозд', 'воробей', 'синица', 'сова', 'орёл', 'сокол',
    'попугай', 'голубь', 'ворона', 'сорока', 'ласточка', 'дятел',
    'птица', 'птиц', 'птицы', 'воробьи', 'голуби', 'совы', 'орлы',
    'сокол', 'канюк', 'зяблик', 'щегол', 'стриж', 'жаворонок', 'перепел',
    'куропатка', 'глухарь', 'тетерев', 'рябчик', 'кукушка', 'зимородок',
    'удод', 'свиристель', 'чечетка', 'овсянка', 'завирушка', 'крапивник',
    'пересмешка', 'камышовка', 'славка', 'пеночка', 'мухоловка', 'горихвостка',
    'зарянка', 'соловей', 'вальдшнеп', 'бекас', 'дупель', 'турухтан',
    'ржанка', 'чибис', 'кулик', 'песочник', 'бекас', 'веретенник',
    'шилоклювка', 'ходулочник', 'авдотка', 'тиркушка', 'чайка', 'крачка',
    'водорез', 'чистик', 'кайра', 'гагарка', 'тупик', 'поморник',
    'баклан', 'олуша', 'фрегат', 'пеликан', 'цапля', 'выпь', 'аист',
    'ибист', 'фламинго', 'лебедь', 'гусь', 'утка', 'кряква', 'нырок',
    'гоголь', 'турпан', 'гага', 'казарка', 'пингвин', 'альбатрос',
    'буревестник', 'качурка', 'колибри', 'трогон', 'зимородок', 'щурка',
    'удод', 'птица-носорог', 'бородатка', 'тукан', 'дятл', 'медоуказчик',
    'бородач', 'серпоклюв', 'козодой', 'сплюшка', 'сипуха', 'неясыть',
    'филин', 'сыч', 'совка', 'сип', 'гриф', 'стервятник', 'орлан',
    'скопа', 'лунь', 'канюк', 'осоед', 'змееяд', 'беркут', 'могильник',
    'балобан', 'кречет', 'сапсан', 'дербник', 'кобчик', 'пустельга',
    'смеш', 'какапо', 'кеа', 'ара', 'какаду', 'лори', 'лорикет',
    'попугай', 'неразлучник', 'жако', 'амазон', 'корелла', 'волнистый'
  ];
  
  if (birdIndicators.some(indicator => lowerName.includes(indicator))) {
    console.log(`✅ "${birdName}" распознана как птица по названию`);
    return true;
  }
  
  // Проверяем через Wikipedia API
  try {
    const wikiData = await getBirdWikiData(birdName);
    
    if (!wikiData || !wikiData.extract) {
      console.log(`❌ Нет данных Wikipedia для: ${birdName}`);
      return false;
    }
    
    const content = wikiData.extract.toLowerCase();
    
    const birdKeywords = [
      'птица', 'воробьино', 'хищная', 'певчая', 'водоплавающ',
      'орнитолог', 'гнездо', 'клюв', 'крыло', 'перо', 'пение',
      'отряд', 'семейство', 'вид птиц', 'ареал обитания', 'миграция',
      'самец', 'самка', 'оперение', 'кладка яиц', 'выводок',
      'питается', 'обитает', 'размах крыльев', 'перелётная',
      'орнитологи', 'птичий', 'птичье', 'птичьих', 'пернатый',
      'крылья', 'клювом', 'гнездится', 'высиживает', 'птенц',
      'перелёт', 'зимовка', 'пение', 'голос', 'крикит'
    ];
    
    const isBird = birdKeywords.some(keyword => content.includes(keyword));
    
    if (!isBird) {
      console.log(`⚠️  Не найдено ключевых слов птицы для: ${birdName}`);
      console.log(`📝 Контент: ${content.substring(0, 150)}...`);
    } else {
      console.log(`✅ "${birdName}" подтверждена как птица по контенту`);
    }
    
    return isBird;
  } catch (error) {
    console.log(`❌ Ошибка проверки птицы ${birdName}:`, error.message);
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
  const guaranteedBirds = ["Воробей", "Синица", "Снегирь", "Сова", "Голубь", "Ворона"];
  return guaranteedBirds[Math.floor(Math.random() * guaranteedBirds.length)];
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
      "Категория:Птицы_Северной_Америки",
      "Категория:Морские_птицы",
      "Категория:Воробьинообразные",
      "Категория:Соколообразные",
      "Категория:Совообразные",
      "Категория:Гусеобразные",
      "Категория:Дятлообразные"
    ];
    
    const randomCategory = categories[Math.floor(Math.random() * categories.length)];
    const categoryUrl = `https://ru.wikipedia.org/w/api.php?action=query&list=categorymembers&cmtitle=${randomCategory}&cmtype=page&cmlimit=200&format=json`;
    
    const response = await fetch(categoryUrl);
    const data = await response.json();
    
    if (data.query && data.query.categorymembers && data.query.categorymembers.length > 0) {
      const birds = data.query.categorymembers;
      
      // Перемешиваем и пробуем несколько случайных птиц
      const shuffledBirds = [...birds].sort(() => Math.random() - 0.5);
      
      for (let i = 0; i < Math.min(15, shuffledBirds.length); i++) {
        const bird = shuffledBirds[i];
        
        // Более мягкая проверка названия
        if (bird.title.length < 50 && 
            !bird.title.includes('(значения)') &&
            !bird.title.includes('список') &&
            !bird.title.includes('таблица')) {
          
          // Быстрая проверка что это птица по названию
          const lowerTitle = bird.title.toLowerCase();
          const birdWords = ['птица', 'воробей', 'синица', 'сова', 'орёл', 'сокол', 'дрозд', 'чайка', 'голубь', 'утка', 'лебедь'];
          
          if (birdWords.some(word => lowerTitle.includes(word)) || 
              await quickBirdCheck(bird.title)) {
            return bird.title;
          }
        }
      }
      
      // Если не нашли подходящую, возвращаем первую
      return birds[0].title;
    }
    
    return null;
    
  } catch (error) {
    console.log('❌ Ошибка поиска в Wikipedia:', error.message);
    return null;
  }
}

async function quickBirdCheck(birdName) {
  const notBirds = [
    'коммуна', 'департамент', 'кантон', 'округ', 'россия', 'регион',
    'пероб', 'муниципалитет', 'город', 'деревня', 'посёлок', 'община',
    'список', 'перечень'
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
    `${birdName} относится к удивительному миру птиц с разнообразными повадками.`,
    `${birdName} - представитель пернатых, имеющий свои особенности внешнего вида и образа жизни.`
  ];
  
  return descriptions[Math.floor(Math.random() * descriptions.length)];
}

// УЛУЧШЕННАЯ ФУНКЦИЯ ГЕНЕРАЦИИ ФАКТОВ БЕЗ ОШИБОК
async function generateBirdFactsWithGemini(birdName, description) {
  try {
    const prompt = `Создай 3 точных и интересных факта о птице "${birdName}".

${description ? `Информация о птице: ${description.substring(0, 500)}` : ''}

ТРЕБОВАНИЯ:
- Каждый факт должен начинаться с "•"
- Факты должны быть 20-80 символов
- Только проверенные научные факты
- Русский язык
- Формат:
• Факт 1
• Факт 2  
• Факт 3

Пример для "Сова":
• Может поворачивать голову на 270 градусов
• Охотится преимущественно ночью
• Имеет бесшумный полёт

ВАЖНО: Только факты, без пояснений!`;

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
      .filter(fact => fact.length > 10 && fact.length < 100)
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
    ],
    "Сова": [
      "Может поворачивать голову на 270 градусов",
      "Охотится преимущественно ночью",
      "Имеет бесшумный полёт"
    ],
    "Голубь": [
      "Обладают отличной способностью ориентироваться",
      "Могут развивать скорость до 100 км/ч",
      "Живут в городах по всему миру"
    ],
    "Ворона": [
      "Одни из самых умных птиц в мире",
      "Могут использовать простые инструменты",
      "Обладают отличной памятью"
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
    },
    { 
      name: "Воробей", 
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Passer_domesticus_male_%2815%29.jpg/800px-Passer_domesticus_male_%2815%29.jpg",
      description: "Воробей - маленькая птица, живущая рядом с человеком. Распространена по всему миру."
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