// lib/birds.js - ОПТИМИЗИРОВАННАЯ ВЕРСИЯ БЕЗ ДУБЛИКАТОВ И НЕНУЖНОГО КОДА
import { fetch } from 'undici';
import * as supabase from './supabase.js';

// ====== КОНФИГИ ======
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AIzaSyAZ5IYaQ81lm-QEYQyTb_cJRmuCxc0WyoA";
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent";

// ====== УТИЛИТЫ ======
function getCurrentTime() {
  const now = new Date();
  return now.toLocaleTimeString('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getCurrentDateTime() {
  const now = new Date();
  return now.toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour12: false,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function getCurrentISODate() {
  return new Date().toISOString();
}

export function normalizeBirdName(birdName) { 
  if (!birdName) return '';
  
  const normalized = birdName.toLowerCase().trim().replace(/\s+/g, ' ');
  const cleaned = normalized.replace(/[^\w\sа-яё-]/gi, '');
  
  return cleaned.split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ====== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ======

function isRealPhoto(imageUrl) {
  if (!imageUrl) return false;
  
  const url = imageUrl.toLowerCase();
  
  // Проверяем расширение файла
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
  const hasAllowedExt = allowedExtensions.some(ext => url.includes(ext));
  
  if (!hasAllowedExt) {
    console.log(`⚠️ Неподдерживаемое расширение: ${url}`);
    return false;
  }
  
  // Проверяем, что это не рисунок/иллюстрация
  const illustrationWords = [
    'drawing', 'illustration', 'painting', 'vector', 'sketch',
    'diagram', 'poster', 'logo', 'icon', 'clipart', 'cartoon',
    'schematic', 'silhouette', 'graphic', 'map', 'chart',
    'artwork', 'art_work', 'coloring', 'pattern', 'design'
  ];
  
  for (const word of illustrationWords) {
    if (url.includes(word)) {
      console.log(`⚠️ Это иллюстрация: содержит "${word}"`);
      return false;
    }
  }
  
  // Проверяем качество фото по размерам в URL
  if (url.includes('px-')) {
    const sizeMatch = url.match(/(\d+)px-/);
    if (sizeMatch) {
      const size = parseInt(sizeMatch[1]);
      if (size < 400) { // Минимум 400px для хорошего качества
        console.log(`⚠️ Слишком маленькое фото: ${size}px`);
        return false;
      }
    }
  }
  
  // Проверяем домены
  const goodDomains = [
    'upload.wikimedia.org',
    'commons.wikimedia.org',
    'wikipedia.org',
    'wikimedia.org'
  ];
  
  const hasGoodDomain = goodDomains.some(domain => url.includes(domain));
  
  if (!hasGoodDomain) {
    console.log(`⚠️ Неизвестный домен: ${url}`);
    return false;
  }
  
  // Проверяем на плохие паттерны
  const badPatterns = [
    '/transcoded/', '/temp/', 'Ogg_', '.svg', '.gif',
    '_icon', '_badge', '_emblem', 'stub', 'placeholder',
    'default', 'missing', 'no_image', 'question_mark'
  ];
  
  for (const pattern of badPatterns) {
    if (url.includes(pattern)) {
      console.log(`⚠️ Проблемный паттерн: "${pattern}"`);
      return false;
    }
  }
  
  return true;
}

export function isGeneralFamilyName(birdName) {
  const lowerName = birdName.toLowerCase();
  
  const generalFamilies = [
    'попугай', 'синица', 'воробей', 'снегирь', 'дрозд', 
    'утка', 'голубь', 'сова', 'дятел', 'ворона', 'сокол',
    'орёл', 'чайка', 'ласточка', 'соловей', 'жаворонок'
  ];
  
  for (const family of generalFamilies) {
    if (lowerName === family) {
      return true;
    }
    
    if (lowerName.startsWith(family + ' ') && 
        lowerName.length > family.length + 2) {
      return false;
    }
  }
  
  return false;
}

function isExoticBird(birdName) {
  const lowerName = birdName.toLowerCase();
  
  const exoticKeywords = [
    "амазон", "ара", "какаду", "лори", "попугай", "тукан", "колибри",
    "птица-носорог", "райская", "тропическ", "экватор", "африканск",
    "южноамериканск", "австралийск", "гавайск", "соломонов", "папуа",
    "мадагаскар", "индонезийск", "филиппинск", "карибск"
  ];
  
  return exoticKeywords.some(keyword => lowerName.includes(keyword));
}

// ====== ОСНОВНЫЕ ФУНКЦИИ ДЛЯ РАБОТЫ С БАЗОЙ ======

export async function isBirdInAllBirds(birdName) {
  const normalizedName = normalizeBirdName(birdName);
  return await supabase.isBirdInDatabase(normalizedName);
}

export async function addBirdToAllBirds(birdName) {
  const normalizedName = normalizeBirdName(birdName);
  await supabase.addBird(normalizedName);
}

export async function getAllBirdsFromRedis() {
  const birds = await supabase.getAllBirds();
  return birds.map(bird => normalizeBirdName(bird));
}

export async function getBirdFacts(birdName) {
  return await supabase.getBirdFacts(birdName);
}

export async function saveBirdFacts(birdName, facts) {
  await supabase.saveBirdFacts(birdName, facts);
}

export async function getAllBirdFacts() {
  return await supabase.getAllBirdFacts();
}

export async function getWeeklyBirds() {
  const birdsWithDates = await supabase.getWeeklyBirds();
  return birdsWithDates.map(bird => {
    const match = bird.match(/^([^(]+)/);
    return match ? match[1].trim() : bird;
  });
}

export async function updateBirdHistory(birdName) {
  await supabase.updateBirdHistory(birdName);
}

export async function getBirdsCount() {
  return await supabase.getBirdsCount();
}

// ====== ФУНКЦИИ ДЛЯ ПРЕДЛОЖЕНИЙ ======
export async function saveBirdSuggestion(userId, username, birdName) {
  return await supabase.saveBirdSuggestion(userId, username, birdName);
}

export async function getPendingSuggestions() {
  return await supabase.getPendingSuggestions();
}

export async function getUserSuggestions(userId) {
  return await supabase.getUserSuggestions(userId);
}

export async function approveSuggestion(suggestionId, adminId) {
  return await supabase.approveSuggestion(suggestionId, adminId);
}

export async function rejectSuggestion(suggestionId, adminId, reason = null) {
  return await supabase.rejectSuggestion(suggestionId, adminId, reason);
}

export async function getSuggestionById(suggestionId) {
  return await supabase.getSuggestionById(suggestionId);
}

export async function isDuplicateSuggestion(userId, birdName) {
  return await supabase.isDuplicateSuggestion(userId, birdName);
}

export async function getSuggestionsStats() {
  return await supabase.getSuggestionsStats();
}

// ====== ФУНКЦИИ ДЛЯ ПРИОРИТЕТНЫХ ПТИЦ ======
export async function getPriorityBird() {
  return await supabase.getPriorityBird();
}

export async function markPriorityBirdAsUsed(suggestionId) {
  return await supabase.markPriorityBirdAsUsed(suggestionId);
}

// ====== ИНИЦИАЛИЗАЦИЯ ======
export async function initializeRedis() {
  console.log('🔗 [SUPABASE] Инициализация PostgreSQL через Supabase');
  return await supabase.initializeSupabase();
}

// ====== ПОИСК ИЗОБРАЖЕНИЙ ======

async function getBirdWikiImage(birdName) {
  try {
    const encodedName = encodeURIComponent(birdName);
    
    // Ищем через русскую Википедию
    const url = `https://ru.wikipedia.org/w/api.php?action=query&titles=${encodedName}&prop=pageimages&format=json&piprop=original&pilicense=any`;
    
    const response = await fetch(url);
    if (!response.ok) return null;
    
    const data = await response.json();
    const pages = data.query.pages;
    const pageId = Object.keys(pages)[0];
    
    // Пробуем оригинальное фото
    if (pageId !== "-1" && pages[pageId].original) {
      const originalUrl = pages[pageId].original.source;
      if (isRealPhoto(originalUrl)) {
        return originalUrl;
      }
    }
    
    // Пробуем thumbnail
    const thumbUrl = `https://ru.wikipedia.org/w/api.php?action=query&titles=${encodedName}&prop=pageimages&format=json&pithumbsize=1200&pilicense=any`;
    
    const thumbResponse = await fetch(thumbUrl);
    if (!thumbResponse.ok) return null;
    
    const thumbData = await thumbResponse.json();
    const thumbPages = thumbData.query.pages;
    const thumbPageId = Object.keys(thumbPages)[0];
    
    if (thumbPageId !== "-1" && thumbPages[thumbPageId].thumbnail) {
      const thumbImageUrl = thumbPages[thumbPageId].thumbnail.source;
      if (isRealPhoto(thumbImageUrl)) {
        return thumbImageUrl;
      }
    }
    
    return null;
  } catch (err) {
    console.log(`⚠️ Wikipedia API error: ${err.message}`);
    return null;
  }
}

async function searchWikidataImage(birdName) {
  try {
    const encodedName = encodeURIComponent(birdName);
    const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodedName}&language=ru&format=json&limit=5`;
    
    const response = await fetch(url);
    if (!response.ok) return null;
    
    const data = await response.json();
    
    for (const entity of data.search || []) {
      if (entity.description?.toLowerCase().includes('птиц') || 
          entity.description?.toLowerCase().includes('bird') ||
          entity.description?.toLowerCase().includes('species')) {
        
        // Получаем информацию о сущности
        const entityUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${entity.id}&format=json&props=claims`;
        const entityResponse = await fetch(entityUrl);
        const entityData = await entityResponse.json();
        
        // Ищем свойство P18 (изображение)
        const claims = entityData.entities?.[entity.id]?.claims;
        if (claims?.P18) {
          const imageName = claims.P18[0]?.mainsnak?.datavalue?.value;
          if (imageName) {
            // Формируем URL изображения
            const formattedName = imageName.replace(/ /g, '_');
            const imageUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${formattedName}?width=1024`;
            return imageUrl;
          }
        }
      }
    }
    
    return null;
  } catch (error) {
    console.log(`   ⚠️ Wikidata error: ${error.message}`);
    return null;
  }
}

async function searchBirdImageWithGemini(birdName) {
  try {
    const prompt = `
Найди ПРЯМУЮ ссылку на качественную фотографию птицы "${birdName}" на Wikimedia Commons.

ВОТ КОНКРЕТНЫЕ ТРЕБОВАНИЯ:
1. Ссылка должна быть НАПРЯМУЮ на изображение (заканчиваться на .jpg, .jpeg, .png)
2. Изображение должно быть с сайта upload.wikimedia.org
3. Фотография должна быть реальной, а не рисунком
4. Птица должна быть хорошо видна
5. Разрешение минимум 800x600 пикселей

ПРИМЕРЫ ПРАВИЛЬНЫХ ССЫЛОК:
- https://upload.wikimedia.org/wikipedia/commons/thumb/d/d1/Common_Kingfisher_%28Alcedo_atthis%29.jpg/1024px-Common_Kingfisher_%28Alcedo_atthis%29.jpg
- https://upload.wikimedia.org/wikipedia/commons/8/8a/Great_Tit_%28Parus_major%29.jpg
- https://upload.wikimedia.org/wikipedia/commons/b/b9/European_Robin_%28Erithacus_rubecula%29.jpg

ЕСЛИ НАЙДЕШЬ ФОТО - верни ТОЛЬКО прямую ссылку.
ЕСЛИ НЕ НАЙДЕШЬ - верни "NO_PHOTO".

Сейчас найди фото для птицы: "${birdName}"
`;

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 200,
        topP: 0.1
      }
    };

    const res = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      console.log(`   ❌ Gemini request failed: ${res.status}`);
      return null;
    }

    const data = await res.json();
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    let imageUrl = responseText.trim();
    
    // Проверяем что это действительно ссылка на фото
    if (imageUrl.startsWith('http') && 
        (imageUrl.includes('upload.wikimedia.org') || 
         imageUrl.includes('wikimedia.org')) &&
        (imageUrl.includes('.jpg') || imageUrl.includes('.jpeg') || imageUrl.includes('.png')) &&
        !imageUrl.includes('/thumb/') &&
        imageUrl !== 'NO_PHOTO') {
      
      console.log(`   ✅ Gemini предложил фото: ${imageUrl.substring(0, 80)}...`);
      return imageUrl;
    }
    
    return null;
    
  } catch (error) {
    console.log(`   ❌ Gemini image search error: ${error.message}`);
    return null;
  }
}

function getLatinNameForBird(birdName) {
  const latinNames = {
    // Основные птицы
    "Большая синица": "Parus major",
    "Полевой воробей": "Passer montanus",
    "Обыкновенный снегирь": "Pyrrhula pyrrhula",
    "Сизый голубь": "Columba livia",
    "Кряква": "Anas platyrhynchos",
    "Чёрный стриж": "Apus apus",
    "Обыкновенный скворец": "Sturnus vulgaris",
    "Обыкновенная лазоревка": "Cyanistes caeruleus",
    "Обыкновенный поползень": "Sitta europaea",
    "Зарянка": "Erithacus rubecula",
    "Дрозд-рябинник": "Turdus pilaris",
    "Певчий дрозд": "Turdus philomelos",
    "Обыкновенная чечётка": "Acanthis flammea",
    "Обыкновенный свиристель": "Bombycilla garrulus",
    "Обыкновенная овсянка": "Emberiza citrinella",
    "Желтоголовый королёк": "Regulus regulus",
    "Обыкновенная пищуха": "Certhia familiaris",
    "Ушастая сова": "Asio otus",
    "Большой пёстрый дятел": "Dendrocopos major",
    "Серая ворона": "Corvus cornix",
    "Сорока": "Pica pica",
    "Озёрная чайка": "Larus ridibundus",
    "Зелёный дятел": "Picus viridis",
    "Московка": "Periparus ater",
    "Чиж": "Spinus spinus",
    "Щегол": "Carduelis carduelis",
    "Коноплянка": "Linaria cannabina",
    "Белобровик": "Turdus iliacus",
    "Пухляк": "Poecile montanus",
    "Зяблик": "Fringilla coelebs",
    "Пеночка-теньковка": "Phylloscopus collybita",
    "Варакушка": "Luscinia svecica",
    "Гоголь": "Bucephala clangula",
    "Красношейная поганка": "Podiceps auritus",
    "Серый сорокопут": "Lanius excubitor",
    "Амурский кобчик": "Falco amurensis",
    "Каменушка": "Histrionicus histrionicus",
    "Мородунка": "Xenus cinereus",
    "Дубонос": "Coccothraustes coccothraustes",
    "Обыкновенная пустельга": "Falco tinnunculus",
    "Серый журавль": "Grus grus",
    "Кулик-сорока": "Haematopus ostralegus",
    "Вальдшнеп": "Scolopax rusticola",
    "Бекас": "Gallinago gallinago",
    "Чибис": "Vanellus vanellus",
    "Травник": "Tringa totanus",
    "Большой улит": "Tringa nebularia",
    "Фифи": "Tringa glareola",
    "Красноголовый нырок": "Aythya ferina",
    "Хохлатая чернеть": "Aythya fuligula",
    "Серая утка": "Mareca strepera",
    "Шилохвость": "Anas acuta",
    "Свиязь": "Mareca penelope",
    "Широконоска": "Spatula clypeata",
    "Лысуха": "Fulica atra"
  };
  
  return latinNames[birdName] || null;
}

function getEnglishNameForBird(birdName) {
  const englishNames = {
    "Большая синица": "Great Tit",
    "Полевой воробей": "Eurasian Tree Sparrow",
    "Обыкновенный снегирь": "Eurasian Bullfinch",
    "Сизый голубь": "Rock Dove",
    "Кряква": "Mallard",
    "Чёрный стриж": "Common Swift",
    "Обыкновенный скворец": "Common Starling",
    "Обыкновенная лазоревка": "Eurasian Blue Tit",
    "Обыкновенный поползень": "Eurasian Nuthatch",
    "Зарянка": "European Robin",
    "Дрозд-рябинник": "Fieldfare",
    "Певчий дрозд": "Song Thrush",
    "Обыкновенная чечётка": "Common Redpoll",
    "Обыкновенный свиристель": "Bohemian Waxwing",
    "Обыкновенная овсянка": "Yellowhammer",
    "Желтоголовый королёк": "Goldcrest",
    "Обыкновенная пищуха": "Eurasian Treecreeper",
    "Ушастая сова": "Long-eared Owl",
    "Большой пёстрый дятел": "Great Spotted Woodpecker",
    "Серая ворона": "Hooded Crow",
    "Сорока": "Eurasian Magpie",
    "Озёрная чайка": "Black-headed Gull",
    "Зелёный дятел": "European Green Woodpecker",
    "Московка": "Coal Tit",
    "Чиж": "Eurasian Siskin",
    "Щегол": "European Goldfinch",
    "Коноплянка": "Common Linnet",
    "Белобровик": "Redwing",
    "Пухляк": "Willow Tit",
    "Зяблик": "Common Chaffinch",
    "Пеночка-теньковка": "Common Chiffchaff",
    "Варакушка": "Bluethroat",
    "Гоголь": "Common Goldeneye",
    "Красношейная поганка": "Red-necked Grebe",
    "Серый сорокопут": "Great Grey Shrike",
    "Амурский кобчик": "Amur Falcon",
    "Каменушка": "Harlequin Duck",
    "Мородунка": "Terek Sandpiper",
    "Дубонос": "Hawfinch"
  };
  
  return englishNames[birdName] || null;
}

function findSimilarBirds(birdName) {
  const lowerName = birdName.toLowerCase();
  
  const similarityMap = {
    "гологлаз": ["сипуха", "сова", "неясыть", "сыч"],
    "кобчик": ["сокол", "чеглок", "дербник", "пустельга"],
    "сорокопут": ["жулан", "сорокопут серый", "сорокопут чернолобый"],
    "поганка": ["чомга", "поганка большая", "поганка малая"],
    "мухоловка": ["мухоловка-пеструшка", "серая мухоловка", "малая мухоловка"],
    "пеночка": ["пеночка-теньковка", "пеночка-весничка", "пеночка-трещотка"],
    "овсянка": ["овсянка обыкновенная", "овсянка садовая", "овсянка камышовая"],
    "славка": ["славка серая", "славка садовая", "славка черноголовая"],
    "зяблик": ["зяблик обыкновенный", "вьюрок", "юрок"],
    "скворец": ["скворец обыкновенный", "майна", "розовый скворец"]
  };
  
  for (const [key, similar] of Object.entries(similarityMap)) {
    if (lowerName.includes(key)) {
      return similar;
    }
  }
  
  return [];
}

function generateSearchVariants(birdName) {
  const variants = new Set();
  
  // 1. Оригинальное название
  variants.add(birdName);
  
  // 2. Научное название если известно
  const latinName = getLatinNameForBird(birdName);
  if (latinName) {
    variants.add(latinName);
  }
  
  // 3. Английское название
  const englishName = getEnglishNameForBird(birdName);
  if (englishName) {
    variants.add(englishName);
  }
  
  // 4. Убираем общие слова для более точного поиска
  const cleanName = birdName.replace(/^(Обыкновенный|Большой|Малый|Серый|Чёрный|Белый)\s+/i, '');
  if (cleanName !== birdName) {
    variants.add(cleanName);
  }
  
  return Array.from(variants).filter(v => v && v.length > 2);
}

async function searchImageForVariant(variantName) {
  try {
    // Пробуем Wikipedia API
    const wikiImage = await getBirdWikiImage(variantName);
    if (wikiImage && isRealPhoto(wikiImage)) {
      return wikiImage;
    }
    
    await delay(200);
    
    // Пробуем Wikidata
    const wikidataImage = await searchWikidataImage(variantName);
    if (wikidataImage && isRealPhoto(wikidataImage)) {
      return wikidataImage;
    }
    
    return null;
  } catch (error) {
    console.log(`   ⚠️ Ошибка поиска для "${variantName}": ${error.message}`);
    return null;
  }
}

async function findBirdImage(birdName) {
  console.log(`🔍 Поиск фото для: "${birdName}"`);
  
  // Сначала пробуем получить фото из базы (если у нас есть кеш)
  try {
    // Проверяем кешированные фото
    const cachedImage = await getCachedBirdImage(birdName);
    if (cachedImage) {
      console.log(`✅ Использую кешированное фото для ${birdName}`);
      return cachedImage;
    }
  } catch (error) {
    console.log(`⚠️ Ошибка проверки кеша: ${error.message}`);
  }
  
  try {
    // Шаг 1: Пробуем разные варианты названий
    const searchVariants = generateSearchVariants(birdName);
    
    console.log(`🔍 Поисковые варианты: ${searchVariants.join(', ')}`);
    
    for (const variant of searchVariants) {
      console.log(`   🔍 Вариант: "${variant}"`);
      const imageUrl = await searchImageForVariant(variant);
      if (imageUrl) {
        console.log(`   ✅ Нашел фото для варианта "${variant}"`);
        
        // Сохраняем в кеш
        await cacheBirdImage(birdName, imageUrl);
        
        return imageUrl;
      }
      await delay(200);
    }
    
    // Шаг 2: Используем Wikimedia Commons API напрямую
    console.log(`🔄 Пробую прямой поиск в Wikimedia Commons`);
    const wikimediaImage = await searchWikimediaCommons(birdName);
    if (wikimediaImage) {
      console.log(`✅ Wikimedia Commons нашел фото`);
      
      await cacheBirdImage(birdName, wikimediaImage);
      return wikimediaImage;
    }
    
    // Шаг 3: Если не нашли, просим Gemini найти фото
    console.log(`🤖 Запрашиваю у Gemini поиск фото для: "${birdName}"`);
    const geminiImage = await searchBirdImageWithGemini(birdName);
    if (geminiImage) {
      console.log(`✅ Gemini нашел фото`);
      
      await cacheBirdImage(birdName, geminiImage);
      return geminiImage;
    }
    
    // Шаг 4: Ищем фото похожих птиц
    console.log(`🔄 Ищу фото похожей птицы для: "${birdName}"`);
    const similarBirds = findSimilarBirds(birdName);
    for (const similarBird of similarBirds) {
      console.log(`   🔍 Похожая птица: "${similarBird}"`);
      const similarImage = await searchImageForVariant(similarBird);
      if (similarImage) {
        console.log(`   ✅ Нашел фото похожей птицы`);
        
        await cacheBirdImage(birdName, similarImage);
        return similarImage;
      }
      await delay(200);
    }
    
    // Шаг 5: Используем дефолтное фото птицы
    console.log(`❌ Фото не найдено, использую дефолтное`);
    const defaultImage = getDefaultBirdImage(birdName);
    
    await cacheBirdImage(birdName, defaultImage);
    return defaultImage;
    
  } catch (error) {
    console.error(`❌ Ошибка поиска фото: ${error.message}`);
    
    // Аварийное фото
    const emergencyImage = "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/European_Robin_%28Erithacus_rubecula%29.jpg/1024px-European_Robin_%28Erithacus_rubecula%29.jpg";
    
    await cacheBirdImage(birdName, emergencyImage);
    return emergencyImage;
  }
}

// Новая функция для поиска в Wikimedia Commons
async function searchWikimediaCommons(birdName) {
  try {
    const encodedName = encodeURIComponent(birdName);
    const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodedName}+bird&gsrlimit=5&prop=pageimages&pithumbsize=1024&format=json&piprop=thumbnail`;
    
    const response = await fetch(url);
    if (!response.ok) return null;
    
    const data = await response.json();
    
    if (data.query && data.query.pages) {
      const pages = Object.values(data.query.pages);
      
      // Ищем страницы с фотографиями
      for (const page of pages) {
        if (page.thumbnail && page.thumbnail.source) {
          const imageUrl = page.thumbnail.source;
          if (isRealPhoto(imageUrl)) {
            console.log(`✅ Wikimedia Commons: ${page.title}`);
            return imageUrl;
          }
        }
      }
    }
    
    return null;
  } catch (error) {
    console.log(`⚠️ Wikimedia Commons error: ${error.message}`);
    return null;
  }
}

// Функция для получения дефолтного фото в зависимости от типа птицы
function getDefaultBirdImage(birdName) {
  const lowerName = birdName.toLowerCase();
  
  const defaultImages = {
    "синица": "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7e/Parus_major_-Hampshire%2C_England-8.jpg/1024px-Parus_major_-Hampshire%2C_England-8.jpg",
    "воробей": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9b/Passer_montanus_1_%28Marek_Szczepanek%29.jpg/1024px-Passer_montanus_1_%28Marek_Szczepanek%29.jpg",
    "голубь": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Columba_livia_%28Warszawa%29.jpg/1024px-Columba_livia_%28Warszawa%29.jpg",
    "утка": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/59/Anas_platyrhynchos_male_female_quadrat.jpg/1024px-Anas_platyrhynchos_male_female_quadrat.jpg",
    "дрозд": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/Song_Thrush_Turdus_philomelos.jpg/1024px-Song_Thrush_Turdus_philomelos.jpg",
    "сова": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/Bubo_bubo_Wrocław_ZOO_1.jpg/1024px-Bubo_bubo_Wrocław_ZOO_1.jpg",
    "дятел": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6e/Dendrocopos_major_2_%28Marek_Szczepanek%29.jpg/1024px-Dendrocopos_major_2_%28Marek_Szczepanek%29.jpg",
    "снегирь": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/95/Pyrrhula_pyrrhula_-Hokkaido%2C_Japan-8.jpg/1024px-Pyrrhula_pyrrhula_-Hokkaido%2C_Japan-8.jpg"
  };
  
  // Ищем ключевые слова в названии
  for (const [keyword, imageUrl] of Object.entries(defaultImages)) {
    if (lowerName.includes(keyword)) {
      return imageUrl;
    }
  }
  
  // Если не нашли, возвращаем общее фото птицы
  return "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/European_Robin_%28Erithacus_rubecula%29.jpg/1024px-European_Robin_%28Erithacus_rubecula%29.jpg";
}

// ====== ГЕНЕРАЦИЯ ФАКТОВ ======

async function generateBirdFactsWithGeminiOnce(birdName) {
  try {
    const prompt = `
Дай ровно 3 научных факта ТОЛЬКО об одной птице: "${birdName}".

ТРЕБОВАНИЯ:
- Факты должны относиться ТОЛЬКО к конкретному виду "${birdName}"
- Факты должны быть реальными, проверяемыми
- Каждый факт — одно предложение 10–25 слов
- Без вступлений, нумераций, выводов, пояснений
- Просто три строки, каждая — отдельный факт
`;
    
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.6,
        maxOutputTokens: 300
      }
    };
    
    const res = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!res.ok) return null;
    
    const data = await res.json();
    if (!data.candidates?.[0]?.content?.parts?.[0]?.text) return null;
    
    const text = data.candidates[0].content.parts[0].text;
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const facts = lines
      .map(l => l.replace(/^[\d\.\)\-]+\s*/, '').trim())
      .filter(l => l.length >= 30 && l.length <= 200)
      .slice(0, 3);
    
    return facts.length === 0 ? null : facts;
  } catch (err) {
    console.log('❌ Gemini fetch error:', err?.message);
    return null;
  }
}

function getQualityFacts(birdName) {
  const qualityFacts = {
    "Большая синица": [
      "Питается насекомыми и семенами, часто посещает кормушки зимой.",
      "Самцы и самки похожи, но самцы немного крупнее.",
      "Гнездится в дуплах, иногда использует готовые скворечники."
    ],
    "Полевой воробей": [
      "Полевой воробей предпочитает сельскохозяйственные поля и опушки.",
      "Стайная птица, часто кормится на земле.",
      "Самцы поют короткие трели во время брачного сезона."
    ],
    "Певчий дрозд": [
      "Известен своим сложным и разнообразным репертуаром песен.",
      "Часто имитирует звуки окружающей среды в своих песнях.",
      "Зимой мигрирует на юг, преодолевая значительные расстояния."
    ],
    "Кряква": [
      "Самый распространенный вид уток в Северном полушарии.",
      "Самцы имеют яркое оперение с зеленой головой, самки коричневые.",
      "Часто встречается в городских парках и водоемах."
    ],
    "Сизый голубь": [
      "Произошел от скалистого голубя, одомашнен более 5000 лет назад.",
      "Обладает отличной пространственной памятью и навигацией.",
      "Может развивать скорость до 100 км/ч в полете."
    ],
    "Вальдшнеп": [
      "Вальдшнеп известен своими замысловатыми брачными полетами на закате и рассвете.",
      "Эта птица имеет длинный клюв, который использует для поиска червей в мягкой почве.",
      "Вальдшнепы хорошо маскируются благодаря покровительственной окраске под опавшие листья."
    ],
    "Дубонос": [
      "Дубонос обладает массивным клювом, способным раскалывать твердые косточки вишни и черешни.",
      "Эта птица имеет яркую окраску: самцы - розовато-коричневые, самки - более скромные.",
      "Дубоносы предпочитают лиственные леса, где питаются семенами деревьев и ягодами."
    ],
    "Красношейная поганка": [
      "Красношейная поганка получила свое название за ярко-рыжие перья на шее в брачном наряде.",
      "Эти птицы отличные ныряльщики и могут находиться под водой до 30 секунд.",
      "Красношейные поганки строят плавучие гнезда из водных растений на тихих водоемах."
    ]
  };
  
   return qualityFacts[birdName] || [
    `${birdName} имеет уникальные особенности строения и поведения.`,
    `Эта птица отличается специализированным способом питания и добычи пищи.`,
    `${birdName} обитает в различных типах ландшафтов и адаптирована к местным условиям.`
  ];
}

async function generateReliableFacts(birdName, options = {}) {
  const { maxAttempts = 3 } = options;
  const defaultFacts = getQualityFacts(birdName);
  
  console.log(`🔍 Генерация фактов для "${birdName}"`);
  
  try {
    // Проверяем существующие факты
    const existing = await getBirdFacts(birdName);
    if (existing && Array.isArray(existing) && existing.length >= 3) {
      console.log('✅ Использую существующие факты из базы');
      return existing;
    }
  } catch (err) {
    console.log('⚠️ Ошибка проверки базы фактов:', err.message);
  }
  
  // Пробуем сгенерировать новые факты
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`🔄 Попытка ${attempt}/${maxAttempts} для ${birdName}`);
      
      const candidate = await generateBirdFactsWithGeminiOnce(birdName);
      
      if (!candidate || candidate.length === 0) {
        console.log(`⚠️ Факты не сгенерированы в попытке ${attempt}`);
        await delay(1000);
        continue;
      }
      
      // Более гибкая проверка качества фактов
      const validFacts = candidate.filter(fact => 
        fact && 
        fact.length >= 20 && 
        fact.length <= 250 &&
        !fact.includes('не могу') &&
        !fact.includes('не знаю') &&
        !fact.includes('как')
      );
      
      if (validFacts.length >= 2) { // Требуем минимум 2 хороших факта
        console.log(`✅ Получены качественные факты от Gemini (${validFacts.length} из 3)`);
        
        // Дополняем дефолтными фактами если нужно
        const finalFacts = validFacts.length >= 3 
          ? validFacts.slice(0, 3)
          : [...validFacts, ...defaultFacts.slice(0, 3 - validFacts.length)];
        
        await saveBirdFacts(birdName, finalFacts);
        return finalFacts;
      }
      
      await delay(1000);
      
    } catch (err) {
      console.log(`⚠️ Ошибка в попытке ${attempt}:`, err.message);
      await delay(1000);
    }
  }
  
  console.log('❌ Не удалось получить факты от Gemini, использую дефолтные');
  await saveBirdFacts(birdName, defaultFacts);
  return defaultFacts;
}

// ====== ГЕНЕРАЦИЯ ОПИСАНИЯ ======

async function generateBirdDescription(birdName, facts) {
  try {
    const prompt = `
Напиши КРАТКОЕ описание птицы "${birdName}" для Telegram канала.

ВАЖНЫЕ ТРЕБОВАНИЯ:
1. 2-3 предложения (не более 250 символов)
2. Только научная информация: семейство, отряд, особенности
3. Без эмоций и восклицаний
4. Простой, понятный язык
5. Обязательно поставь ударения в сложных словах (используй знак ударения: ́)
6. Пример: "Кули́к-соро́ка — крупный кулик с длинным оранжевым клювом и чёрно-белым контрастным оперением. Относится к семейству куликов-сорок."

Просто верни краткое описание.
`;

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 150,
        topP: 0.7
      }
    };

    const res = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const data = await res.json();
      let description = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      
      description = description
        .trim()
        .replace(/^["']|["']$/g, '')
        .replace(/\.{2,}/g, '.')
        .replace(/\s+/g, ' ')
        .replace(/[""]/g, '"');
      
      if (description && description.length > 10) {
        console.log(`✅ Описание сгенерировано: "${description.substring(0, 80)}..."`);
        return description;
      }
    }
    
    // Fallback: используем первый факт как описание
    console.log(`📝 Использую факт как описание для: ${birdName}`);
    if (facts && facts.length > 0) {
      return facts[0];
    }
    
    // Минимальное описание
    return `${birdName} — птица из нашей коллекции.`;
    
  } catch (error) {
    console.log(`❌ Ошибка генерации описания: ${error.message}`);
    return `${birdName} — птица из нашей коллекции.`;
  }
}

// ====== ФИНАЛЬНАЯ ПРОВЕРКА И ГЕНЕРАЦИЯ ======

async function generateCompleteBirdPost(birdName) {
  console.log(`🎨 Генерирую полный пост для: "${birdName}"`);
  
  try {
    // Параллельно получаем факты и ищем фото
    const [facts, imageUrl] = await Promise.all([
      generateReliableFacts(birdName),
      findBirdImage(birdName)
    ]);
    
    // Генерируем описание
    const description = await generateBirdDescription(birdName, facts);
    
    const finalData = {
      name: birdName,
      description: description,
      imageUrl: imageUrl,
      facts: facts,
      timestamp: getCurrentDateTime(),
      hasPhoto: !!imageUrl
    };
    
    console.log(`✅ Полный пост сгенерирован для: ${birdName} (фото: ${!!imageUrl})`);
    return finalData;
    
  } catch (error) {
    console.error(`❌ Ошибка генерации поста:`, error);
    return await getFallbackBirdData(birdName);
  }
}

// ====== ОСНОВНАЯ ФУНКЦИЯ ПОЛУЧЕНИЯ ПТИЦЫ ======

async function generateNewBirdWithGemini(existingBirdsSet) {
  try {
    const existingBirdsList = Array.from(existingBirdsSet).slice(0, 30);
    
    const prompt = `
Сгенерируй название РЕАЛЬНОЙ птицы, которая ОБИТАЕТ НА ТЕРРИТОРИИ РОССИИ или СНГ.

ВАЖНЫЕ ПРАВИЛА:
1. Птица ДОЛЖНА ВСТРЕЧАТЬСЯ В РОССИИ (не экзотическая!)
2. Название должно быть на РУССКОМ языке
3. Должно быть КОНКРЕТНОЕ название ВИДА
4. Птица НЕ ДОЛЖНА БЫТЬ в этом списке: ${existingBirdsList.join(', ') || 'список пуст'}
5. Избегай экзотических, тропических или океанических птиц

ПРИМЕРЫ ПРАВИЛЬНЫХ ОТВЕТОВ (птицы России):
• Обыкновенная пустельга
• Серая мухоловка
• Большой улит
• Хохлатая чернеть
• Белая лазоревка
• Желтоголовый королёк

Верни ТОЛЬКО название птицы, без кавычек, без пояснений.
`;

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 50,
        topP: 0.8,
        topK: 20
      }
    };
    
    const res = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!res.ok) {
      console.log(`❌ Gemini не ответил: ${res.status}`);
      return null;
    }
    
    const data = await res.json();
    let birdName = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    if (!birdName || birdName.trim().length === 0) {
      console.log('❌ Gemini вернул пустой ответ');
      return null;
    }
    
    birdName = birdName
      .trim()
      .replace(/^["'`]|["'`]$/g, '')
      .replace(/\.+$/g, '')
      .replace(/^[0-9\.\-\s]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    // Проверка на общее название
    if (isGeneralFamilyName(birdName)) {
      console.log(`⚠️ Слишком общее название: "${birdName}"`);
      return null;
    }
    
    // Проверка на экзотическую птицу
    if (isExoticBird(birdName)) {
      console.log(`⚠️ Экзотическая птица: "${birdName}"`);
      return null;
    }
    
    // Проверяем наличие фото
    console.log(`🔍 Проверяю фото для: ${birdName}`);
    const hasPhoto = await hasRealPhoto(birdName);
    
    if (!hasPhoto) {
      console.log(`⚠️ У птицы нет фото: "${birdName}"`);
      
      // Пробуем найти похожую птицу с фото
      const similarBirds = findSimilarBirds(birdName);
      for (const similarBird of similarBirds) {
        const normalizedSimilar = normalizeBirdName(similarBird);
        if (!existingBirdsSet.has(normalizedSimilar)) {
          const hasSimilarPhoto = await hasRealPhoto(similarBird);
          if (hasSimilarPhoto) {
            console.log(`✅ Нашел похожую птицу с фото: ${similarBird}`);
            return similarBird;
          }
        }
      }
      
      return null;
    }
    
    const normalizedBird = normalizeBirdName(birdName);
    if (existingBirdsSet.has(normalizedBird)) {
      console.log(`⚠️ Птица "${birdName}" уже есть в базе`);
      return null;
    }
    
    console.log(`✅ Gemini сгенерировал подходящую птицу с фото: "${birdName}"`);
    return birdName;
    
  } catch (error) {
    console.error('❌ Ошибка генерации новой птицы:', error);
    return null;
  }
}

async function hasRealPhoto(birdName) {
  try {
    const imageUrl = await getBirdWikiImage(birdName);
    return !!(imageUrl && isRealPhoto(imageUrl));
  } catch (err) {
    return false;
  }
}

async function getNewBirdFromGuaranteedList(existingBirdsSet) {
  console.log('🔍 Ищу новую птицу в гарантированном списке...');
  
  const guaranteedBirds = [
    "Большая синица", "Полевой воробей", "Сизый голубь", "Кряква",
    "Обыкновенный скворец", "Сорока", "Серая ворона", "Озёрная чайка",
    "Зарянка", "Дрозд-рябинник", "Певчий дрозд", "Чёрный стриж",
    "Обыкновенная лазоревка", "Обыкновенный поползень", "Обыкновенный снегирь",
    "Ушастая сова", "Большой пёстрый дятел", "Зелёный дятел", "Чиж",
    "Щегол", "Зяблик", "Коноплянка", "Варакушка", "Обыкновенная овсянка",
    "Обыкновенная чечётка", "Обыкновенный свиристель", "Чибис", "Бекас",
    "Вальдшнеп", "Красноголовый нырок", "Хохлатая чернеть", "Гоголь",
    "Лысуха", "Большая поганка", "Серая утка", "Шилохвость", "Свиязь"
  ];
  
  // Перемешиваем
  const shuffledBirds = [...guaranteedBirds].sort(() => Math.random() - 0.5);
  
  // Ищем птицу, которой нет в базе
  for (const bird of shuffledBirds) {
    const normalizedBird = normalizeBirdName(bird);
    if (!existingBirdsSet.has(normalizedBird)) {
      console.log(`✅ Нашел гарантированную птицу: ${bird}`);
      return bird;
    }
  }
  
  console.log('❌ Все гарантированные птицы уже есть в базе');
  return null;
}

export async function getRandomBirdData() {
  try {
    console.log('🚀 ИЩУ СОВЕРШЕННО НОВУЮ ПТИЦУ С ФОТО...');
    
    const allExistingBirds = await getAllBirdsFromRedis();
    console.log(`📊 В базе уже есть ${allExistingBirds.length} птиц`);
    
    const allBirdsSet = new Set(allExistingBirds.map(bird => normalizeBirdName(bird)));
    
    // Сначала пробуем гарантированный список
    console.log('🔍 Пробую гарантированный список птиц России...');
    const guaranteedBird = await getNewBirdFromGuaranteedList(allBirdsSet);
    
    if (guaranteedBird) {
      console.log(`✨ НАШЕЛ ГАРАНТИРОВАННУЮ ПТИЦУ: "${guaranteedBird}"`);
      
      await addBirdToAllBirds(guaranteedBird);
      await updateBirdHistory(guaranteedBird);
      
      const birdData = await generateCompleteBirdPost(guaranteedBird);
      return {
        ...birdData,
        source: 'guaranteed_list'
      };
    }
    
    // Затем пробуем Gemini
    console.log('🤖 Пытаюсь сгенерировать новую птицу через Gemini...');
    
    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`🔄 Попытка ${attempt}/3 генерации новой птицы...`);
      
      const newBirdName = await generateNewBirdWithGemini(allBirdsSet);
      
      if (newBirdName) {
        console.log(`✨ СГЕНЕРИРОВАНА НОВАЯ ПТИЦА С ФОТО: "${newBirdName}"`);
        
        await addBirdToAllBirds(newBirdName);
        await updateBirdHistory(newBirdName);
        
        const birdData = await generateCompleteBirdPost(newBirdName);
        return {
          ...birdData,
          generatedByAI: true,
          generationAttempt: attempt
        };
      }
      
      await delay(1000);
    }
    
    // Если всё сломалось
    console.log('🚨 Все методы не сработали, использую запасную птицу с фото');
    return await getFallbackBirdWithPhoto(allBirdsSet);
    
  } catch (error) {
    console.error('❌ Критическая ошибка в getRandomBirdData:', error);
    return await getFallbackBirdData();
  }
}

async function getFallbackBirdWithPhoto(existingBirdsSet) {
  const fallbackBirds = [
    "Большая синица", "Полевой воробей", "Сизый голубь", "Кряква",
    "Обыкновенный скворец", "Сорока", "Серая ворона", "Озёрная чайка"
  ];
  
  for (const bird of fallbackBirds) {
    const normalizedBird = normalizeBirdName(bird);
    if (!existingBirdsSet.has(normalizedBird)) {
      console.log(`🔄 Запасная птица: ${bird}`);
      return await generateCompleteBirdPost(bird);
    }
  }
  
  console.log(`🔄 Все запасные птицы уже есть, беру: ${fallbackBirds[0]}`);
  return await generateCompleteBirdPost(fallbackBirds[0]);
}

async function getFallbackBirdData(birdName = null) {
  try {
    const allBirds = await getAllBirdsFromRedis();
    
    if (allBirds.length > 0) {
      const shuffledBirds = [...allBirds].sort(() => Math.random() - 0.5);
      const randomBird = shuffledBirds[0];
      
      console.log(`🔄 Аварийный режим: использую случайную птицу из базы - ${randomBird}`);
      
      const facts = await generateReliableFacts(randomBird);
      
      return {
        name: randomBird,
        description: `${randomBird} — интересная птица из нашей коллекции.`,
        imageUrl: null,
        facts: facts || [
          "Эта птица обладает уникальными особенностями.",
          "Имеет специализированный способ питания.",
          "Встречается в различных регионах."
        ],
        timestamp: getCurrentDateTime(),
        isFallback: true
      };
    }
  } catch (error) {
    console.error('❌ Ошибка в аварийном режиме:', error);
  }
  
  const finalBirdName = birdName || "Большая синица";
  const facts = [
    "Питается насекомыми и семенами, часто посещает кормушки зимой.",
    "Самцы и самки похожи, но самцы немного крупнее.",
    "Гнездится в дуплах, иногда использует готовые скворечники."
  ];
  
  return {
    name: finalBirdName,
    description: `${finalBirdName} — хорошо известная птица, встречающаяся во многих регионах.`,
    imageUrl: null,
    facts: facts,
    timestamp: getCurrentDateTime(),
    isFallback: true
  };
}

// ====== ВИКТОРИНЫ ======

async function generateQuizQuestion(birdName, facts) {
  try {
    // Фильтруем факты, чтобы убрать слишком короткие или неинформативные
    const filteredFacts = facts.filter(fact => 
      fact && 
      fact.length > 30 && 
      fact.length < 200 &&
      !fact.includes(birdName) // Убираем факты, содержащие название птицы
    );
    
    if (filteredFacts.length === 0) {
      console.log(`⚠️ Нет подходящих фактов для викторины: ${birdName}`);
      return null;
    }
    
    // Выбираем наиболее интересный факт
    const selectedFact = filteredFacts[0];
    
    const prompt = `
Создай интересный вопрос для викторины о птицах на основе этого факта:

"${selectedFact}"

ВОТ ТРЕБОВАНИЯ К ВОПРОСУ:
1. Вопрос должен быть про ПТИЦУ, соответствующую этому факту
2. НЕ упоминай название птицы "${birdName}" в вопросе
3. Вопрос должен быть понятным и интересным
4. Формулируй вопрос так, чтобы ответ не был очевиден
5. Вопрос должен состоять из 1-2 предложений

ПРИМЕРЫ ПРАВИЛЬНЫХ ВОПРОСОВ:
• "Какая птица известна тем, что строит гнезда из глины и слюны?"
• "У какой птицы самый длинный клюв относительно размеров тела?"
• "Какая птица может поворачивать голову на 270 градусов?"

ПРИМЕР ПЛОХОГО ВОПРОСА:
• "Какая из этих птиц наиболее известна своим пением?"

Создай вопрос на основе факта выше.

Верни ТОЛЬКО вопрос, без дополнительного текста.
`;
    
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 100,
        topP: 0.8
      }
    };
    
    const res = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!res.ok) return null;
    
    const data = await res.json();
    const question = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    if (question && question.length > 20) {
      // Убираем кавычки и лишние пробелы
      const cleanedQuestion = question
        .trim()
        .replace(/^["']|["']$/g, '')
        .replace(/^["']|["']$/g, '')
        .replace(/\s+/g, ' ');
      
      console.log(`✅ Вопрос сгенерирован для: ${birdName}`);
      console.log(`   Факт: ${selectedFact.substring(0, 60)}...`);
      console.log(`   Вопрос: ${cleanedQuestion}`);
      
      return cleanedQuestion;
    }
    
    return null;
    
  } catch (error) {
    console.error('❌ Ошибка генерации вопроса:', error);
    return `Какая птица соответствует этому описанию?`;
  }
}

async function generateFallbackQuiz() {
  try {
    const weeklyBirds = await getWeeklyBirds();
    
    if (weeklyBirds.length < 4) {
      console.log('❌ Недостаточно птиц для резервной викторины');
      return null;
    }
    
    const shuffledBirds = [...weeklyBirds]
      .sort(() => Math.random() - 0.5)
      .slice(0, 4);
    
    const correctBird = shuffledBirds[0];
    const options = [...shuffledBirds].sort(() => Math.random() - 0.5);
    const correctIndex = options.indexOf(correctBird);
    
    return {
      question: "🎯 Какая из этих птиц наиболее известна своим пением?",
      options: options,
      correctIndex: correctIndex,
      correctBird: correctBird,
      hasQualityData: false
    };
  } catch (error) {
    console.error('❌ Ошибка резервной викторины:', error);
    return null;
  }
}

export async function generateQuiz() {
  try {
    console.log('🎯 Генерация викторины');
    
    const history = await getWeeklyBirds();
    
    if (history.length < 4) {
      console.log('❌ Недостаточно птиц в истории для викторины');
      return await generateFallbackQuiz();
    }
    
    console.log(`📊 В истории: ${history.length} птиц`);
    
    // Собираем птиц с качественными фактами
    const birdsWithQualityFacts = [];
    
    for (const bird of history) {
      try {
        const facts = await getBirdFacts(bird);
        if (facts && Array.isArray(facts) && facts.length >= 3) {
          // Проверяем качество фактов
          const qualityFacts = facts.filter(fact => 
            fact && fact.length > 40 && fact.length < 250
          );
          
          if (qualityFacts.length >= 2) {
            birdsWithQualityFacts.push({
              name: bird,
              facts: qualityFacts
            });
          }
        }
      } catch (error) {
        console.log(`⚠️ Ошибка получения фактов для "${bird}": ${error.message}`);
      }
    }
    
    if (birdsWithQualityFacts.length < 4) {
      console.log(`❌ Недостаточно птиц с качественными фактами (нужно 4, есть ${birdsWithQualityFacts.length})`);
      return await generateFallbackQuiz();
    }
    
    console.log(`✅ Птиц с качественными фактами: ${birdsWithQualityFacts.length}`);
    
    // Выбираем случайную птицу для вопроса
    const shuffledBirds = [...birdsWithQualityFacts].sort(() => Math.random() - 0.5);
    const selectedBird = shuffledBirds[0];
    
    console.log(`🎯 Выбрана птица для викторины: ${selectedBird.name}`);
    
    // Генерируем вопрос
    const question = await generateQuizQuestion(selectedBird.name, selectedBird.facts);
    
    if (!question || question.length < 25 || question.includes(selectedBird.name)) {
      console.log('❌ Не удалось сгенерировать хороший вопрос');
      
      // Используем запасной вопрос
      const fallbackQuestion = generateFallbackQuestion(selectedBird.name, selectedBird.facts);
      return await createQuizWithQuestion(selectedBird.name, shuffledBirds, fallbackQuestion);
    }
    
    return await createQuizWithQuestion(selectedBird.name, shuffledBirds, question);
    
  } catch (error) {
    console.error('❌ Ошибка генерации викторины:', error);
    return await generateFallbackQuiz();
  }
}

// Вспомогательная функция для создания викторины
async function createQuizWithQuestion(correctBird, allBirds, question) {
  try {
    // Выбираем 3 другие птицы в качестве неправильных ответов
    const otherBirds = allBirds
      .filter(bird => bird.name !== correctBird)
      .slice(0, 3)
      .map(bird => bird.name);
    
    if (otherBirds.length < 3) {
      console.log('❌ Недостаточно других птиц для вариантов');
      return await generateFallbackQuiz();
    }
    
    // Создаем варианты ответов
    const options = [correctBird, ...otherBirds]
      .sort(() => Math.random() - 0.5);
    
    const correctIndex = options.indexOf(correctBird);
    
    if (correctIndex === -1) {
      console.log('❌ Правильная птица не попала в варианты');
      return await generateFallbackQuiz();
    }
    
    const quizData = {
      question: `🎯 <b>ВОСКРЕСНАЯ ВИКТОРИНА!</b>\n\n${question}`,
      options: options,
      correctIndex: correctIndex,
      correctBird: correctBird,
      hasQualityData: true
    };
    
    console.log(`✅ Викторина сгенерирована успешно!`);
    console.log(`   Вопрос: ${question.substring(0, 80)}...`);
    console.log(`   Правильный ответ: ${quizData.correctBird} (позиция ${quizData.correctIndex + 1})`);
    
    return quizData;
    
  } catch (error) {
    console.error('❌ Ошибка создания викторины:', error);
    return await generateFallbackQuiz();
  }
}

// Функция для генерации запасного вопроса
function generateFallbackQuestion(birdName, facts) {
  const birdTypes = {
    "синица": "небольшая певчая птица",
    "воробей": "мелкая птица, часто встречающаяся в городах",
    "голубь": "птица, хорошо приспособленная к жизни в городах",
    "сова": "ночная хищная птица с большими глазами",
    "дятел": "птица, долбящая дерево клювом",
    "снегирь": "птица с яркой красной грудкой у самцов",
    "утка": "водоплавающая птица",
    "дрозд": "певчая птица семейства дроздовых"
  };
  
  const lowerName = birdName.toLowerCase();
  let birdType = "птица";
  
  for (const [key, value] of Object.entries(birdTypes)) {
    if (lowerName.includes(key)) {
      birdType = value;
      break;
    }
  }
  
  const fallbackQuestions = [
    `Какая ${birdType} наиболее известна своим пением?`,
    `У какой ${birdType} самое интересное поведение во время брачного сезона?`,
    `Какая ${birdType} имеет наиболее специфический способ добычи пищи?`,
    `Какую ${birdType} чаще всего можно встретить в городских парках?`
  ];
  
  return fallbackQuestions[Math.floor(Math.random() * fallbackQuestions.length)];
}

// ====== ЭКСПОРТ ======

export default {
  initializeRedis,
  getRandomBirdData,
  generateQuiz,
  getWeeklyBirds,
  getAllBirdFacts,
  getBirdsCount,
  saveBirdSuggestion,
  getPendingSuggestions,
  getUserSuggestions,
  approveSuggestion,
  rejectSuggestion,
  getSuggestionById,
  isDuplicateSuggestion,
  getSuggestionsStats,
  normalizeBirdName,
  isBirdInAllBirds,
  addBirdToAllBirds,
  getAllBirdsFromRedis,
  getBirdFacts,
  saveBirdFacts,
  updateBirdHistory,
  getPriorityBird,
  markPriorityBirdAsUsed
};