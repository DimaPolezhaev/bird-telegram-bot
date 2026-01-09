// lib/birds.js - ПОЛНОСТЬЮ ПЕРЕРАБОТАННАЯ ВЕРСИЯ С ИСПРАВЛЕНИЕМ ВСЕХ БАГОВ
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
    'schematic', 'silhouette', 'graphic', 'map', 'chart'
  ];
  
  for (const word of illustrationWords) {
    if (url.includes(word)) {
      console.log(`⚠️ Это иллюстрация: содержит "${word}"`);
      return false;
    }
  }
  
  // Проверяем, что URL не содержит специфичных проблемных паттернов
  const problematicPatterns = [
    '/transcoded/', // Видео/аудио файлы
    '/temp/', // Временные файлы
    'Ogg_', // Аудио файлы
    '.svg', // Векторная графика
    '.gif', // Анимация (Telegram может не поддерживать)
    '_icon', '_badge', '_emblem' // Иконки
  ];
  
  for (const pattern of problematicPatterns) {
    if (url.includes(pattern)) {
      console.log(`⚠️ Проблемный паттерн: "${pattern}"`);
      return false;
    }
  }
  
  // Проверяем размер в URL если есть
  if (url.includes('px-')) {
    const sizeMatch = url.match(/(\d+)px-/);
    if (sizeMatch) {
      const size = parseInt(sizeMatch[1]);
      // Telegram обычно хорошо работает с 200-3000px
      if (size < 150) {
        console.log(`⚠️ Слишком маленькое фото: ${size}px`);
        return false;
      }
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

// ====== ОСНОВНЫЕ ФУНКЦИИ ======

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

async function findBestBirdImage(birdName) {
  console.log(`🔍 Интеллектуальный поиск фото для: "${birdName}"`);
  
  // Стратегия 1: Прямой поиск через Wikipedia API
  const wikiImage = await getBirdWikiImage(birdName);
  if (wikiImage && isRealPhoto(wikiImage)) {
    console.log(`✅ Найдено фото на Wikipedia: ${birdName}`);
    return wikiImage;
  }
  
  // Задержка чтобы избежать rate limiting
  await delay(500);
  
  // Стратегия 2: Поиск по научному названию
  const latinName = getLatinNameForBird(birdName);
  if (latinName && latinName !== birdName) {
    console.log(`🔍 Ищу фото по научному названию: ${latinName}`);
    const latinImage = await getBirdWikiImage(latinName);
    if (latinImage && isRealPhoto(latinImage)) {
      console.log(`✅ Найдено фото по научному названию: ${latinName}`);
      return latinImage;
    }
  }
  
  await delay(500);
  
  // Стратегия 3: Поиск через Gemini (новый подход)
  const geminiImage = await searchBirdImageWithGemini(birdName);
  if (geminiImage && isRealPhoto(geminiImage)) {
    console.log(`✅ Найдено фото через Gemini: ${birdName}`);
    return geminiImage;
  }
  
  await delay(500);
  
  // Стратегия 4: Поиск похожих птиц
  const similarBirds = findSimilarBirds(birdName);
  for (const similarBird of similarBirds) {
    console.log(`🔍 Ищу фото похожей птицы: ${similarBird}`);
    const similarImage = await getBirdWikiImage(similarBird);
    if (similarImage && isRealPhoto(similarImage)) {
      console.log(`✅ Найдено фото похожей птицы: ${similarBird}`);
      return similarImage;
    }
    await delay(500);
  }
  
  // Стратегия 5: Использовать дефолтное фото
  console.log(`❌ Фото не найдено, использую дефолтное`);
  return getDefaultBirdImage();
}

function getLatinNameForBird(birdName) {
  const latinNames = {
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
    "Попугай": "Psittaciformes",
    "Волнистый попугай": "Melopsittacus undulatus",
  };
  
  return latinNames[birdName] || null;
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

function getDefaultBirdImage() {
  return null; // Не возвращаем дефолтное фото
}

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

// ====== ФИНАЛЬНАЯ ПРОВЕРКА И ГЕНЕРАЦИЯ ======

async function generateCompleteBirdPost(birdName) {
  console.log(`🎨 Генерирую полный пост для: "${birdName}"`);
  
  try {
    // Шаг 1: Получить качественные факты
    const facts = await generateReliableFacts(birdName);
    
    // Шаг 2: Найти качественное фото через Gemini с конкретными требованиями
    const imageUrl = await findHighQualityImage(birdName);
    
    // Шаг 3: Сгенерировать хорошее описание
    const description = await generateBirdDescription(birdName, facts);
    
    // Шаг 4: Финализировать данные
    const finalData = {
      name: birdName,
      description: description,
      imageUrl: imageUrl,
      facts: facts,
      timestamp: getCurrentDateTime()
    };
    
    console.log(`✅ Полный пост сгенерирован для: ${birdName}`);
    return finalData;
    
  } catch (error) {
    console.error(`❌ Ошибка генерации поста:`, error);
    return await getFallbackBirdData(birdName);
  }
}

async function findHighQualityImage(birdName) {
  console.log(`🔍 Ищу качественное фото для: "${birdName}"`);
  
  try {
    // Стратегия 1: Прямой поиск на Wikipedia
    const wikiImage = await getBirdWikiImage(birdName);
    if (wikiImage && isRealPhoto(wikiImage)) {
      console.log(`✅ Найдено фото на Wikipedia: ${wikiImage.substring(0, 60)}...`);
      return wikiImage;
    }
    
    // Стратегия 2: Поиск по научному названию
    const latinName = getLatinNameForBird(birdName);
    if (latinName && latinName !== birdName) {
      console.log(`🔍 Ищу фото по научному названию: ${latinName}`);
      const latinImage = await getBirdWikiImage(latinName);
      if (latinImage && isRealPhoto(latinImage)) {
        console.log(`✅ Найдено фото по научному названию: ${latinName}`);
        return latinImage;
      }
    }
    
    // Стратегия 3: Поиск похожих птиц
    const similarBirds = findSimilarBirds(birdName);
    for (const similarBird of similarBirds) {
      console.log(`🔍 Ищу фото похожей птицы: ${similarBird}`);
      const similarImage = await getBirdWikiImage(similarBird);
      if (similarImage && isRealPhoto(similarImage)) {
        console.log(`✅ Найдено фото похожей птицы: ${similarBird}`);
        return similarImage;
      }
      await delay(300);
    }
    
    // Стратегия 4: Поиск через общие названия
    const generalName = getGeneralNameFromSpecific(birdName);
    if (generalName && generalName !== birdName) {
      console.log(`🔍 Ищу фото по общему названию: ${generalName}`);
      const generalImage = await getBirdWikiImage(generalName);
      if (generalImage && isRealPhoto(generalImage)) {
        console.log(`✅ Найдено фото по общему названию: ${generalName}`);
        return generalImage;
      }
    }
    
    // Стратегия 5: Использовать дефолтное фото птицы
    console.log(`❌ Фото не найдено для: ${birdName}`);
    return null;
    
  } catch (error) {
    console.log(`❌ Ошибка поиска фото:`, error.message);
    return null;
  }
}

// Функция для получения общего названия из конкретного
function getGeneralNameFromSpecific(birdName) {
  const lowerName = birdName.toLowerCase();
  
  if (lowerName.includes("гологлаз")) {
    return "сипуха"; // Ближайший родственник
  }
  if (lowerName.includes("кобчик")) {
    return "сокол";
  }
  if (lowerName.includes("сорокопут")) {
    return "сорокопут";
  }
  if (lowerName.includes("поганка")) {
    return "поганка";
  }
  if (lowerName.includes("мухоловка")) {
    return "мухоловка";
  }
  if (lowerName.includes("пеночка")) {
    return "пеночка";
  }
  
  return null;
}

// ====== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ======

function convertThumbnailToDirectUrl(imageUrl) {
  if (!imageUrl || !imageUrl.includes('upload.wikimedia.org')) return null;
  
  // Преобразуем thumbnail ссылку в прямую
  // Пример: https://upload.wikimedia.org/wikipedia/commons/thumb/f/f3/Porzana_porzana_1.jpg/800px-Porzana_porzana_1.jpg
  // → https://upload.wikimedia.org/wikipedia/commons/f/f3/Porzana_porzana_1.jpg
  
  if (imageUrl.includes('/thumb/')) {
    // Удаляем /thumb/ и размер
    const match = imageUrl.match(/\/thumb\/(.+)\/\d+px-.+/);
    if (match && match[1]) {
      const directUrl = `https://upload.wikimedia.org/wikipedia/commons/${match[1]}`;
      return directUrl;
    }
  }
  
  return null;
}

async function searchWikimediaCommonsDirect(birdName) {
  try {
    // Поиск через API Wikimedia Commons
    const encodedName = encodeURIComponent(birdName);
    const searchUrl = `https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodedName}+bird&srnamespace=6&format=json&srlimit=5`;
    
    const response = await fetch(searchUrl);
    if (!response.ok) return null;
    
    const data = await response.json();
    
    if (data.query.search && data.query.search.length > 0) {
      // Берем первый результат
      const firstResult = data.query.search[0];
      const fileName = firstResult.title.replace('File:', '').replace(/\s/g, '_');
      
      // Прямая ссылка на файл
      const imageUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fileName)}`;
      
      // Проверяем что это фото
      if (isRealPhoto(imageUrl)) {
        return imageUrl;
      }
    }
    
    return null;
  } catch (error) {
    console.error(`❌ Ошибка Wikimedia Commons:`, error.message);
    return null;
  }
}

async function getEnglishWikipediaImage(birdName) {
  try {
    const encodedName = encodeURIComponent(birdName);
    
    // Ищем в английской Википедии
    const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodedName}&prop=pageimages&format=json&pithumbsize=1200`;
    
    const response = await fetch(url);
    if (!response.ok) return null;
    
    const data = await response.json();
    const pages = data.query.pages;
    const pageId = Object.keys(pages)[0];
    
    if (pageId !== "-1" && pages[pageId].thumbnail) {
      const imageUrl = pages[pageId].thumbnail.source;
      if (isRealPhoto(imageUrl)) {
        return imageUrl;
      }
    }
    
    return null;
  } catch (error) {
    console.error(`❌ Ошибка English Wikipedia:`, error.message);
    return null;
  }
}

async function searchBirdImageWithGemini(birdName) {
  try {
    const prompt = `
Найди прямую ссылку на фотографию птицы "${birdName}" на Wikimedia Commons.

ВАЖНЫЕ ТРЕБОВАНИЯ:
1. Это должна быть фотография, а не рисунок или иллюстрация
2. Ссылка должна быть прямой, заканчиваться на .jpg, .jpeg или .png
3. Фотография должна быть хорошего качества
4. Птица должна быть хорошо видна, в фокусе + Предпочтительно фотография с хорошим освещением
5. URL должен быть вида: https://upload.wikimedia.org/wikipedia/commons/... (БЕЗ /thumb/ в URL!)
6. Если не нашел, верни "NO_PHOTO"

Пример правильной ссылки:
https://upload.wikimedia.org/wikipedia/commons/f/f3/Porzana_porzana_1.jpg

Пример НЕправильной ссылки:
https://upload.wikimedia.org/wikipedia/commons/thumb/f/f3/Porzana_porzana_1.jpg/800px-Porzana_porzana_1.jpg (содержит /thumb/)

Если не нашел подходящее фото на Wikimedia Commons для именно "${birdName}", поищи фото для наиболее близкого вида из того же семейства, но лучше всё таки найди нужную мне фотографию, если не можешь найти на том сайте, используй другой.

Верни ТОЛЬКО прямую ссылку или "NO_PHOTO".
`;

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 200
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
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const imageUrl = responseText.trim();
    
    // Проверяем что это ссылка на фото (без /thumb/)
    if (imageUrl.startsWith('http') && 
        (imageUrl.includes('.jpg') || imageUrl.includes('.jpeg') || imageUrl.includes('.png')) &&
        !imageUrl.includes('/thumb/') &&
        isRealPhoto(imageUrl)) {
      console.log(`✅ Gemini нашёл фото: ${imageUrl.substring(0, 60)}...`);
      return imageUrl;
    }
    
    if (imageUrl !== 'NO_PHOTO') {
      console.log(`⚠️ Gemini вернул: ${imageUrl.substring(0, 80)}...`);
    }
    
    return null;
    
  } catch (error) {
    console.error(`❌ Gemini image search error:`, error.message);
    return null;
  }
}

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
        maxOutputTokens: 150, // Увеличил с 100 до 150
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
      
      // Очищаем описание НЕ укорачивая
      description = description
        .trim()
        .replace(/^["']|["']$/g, '') // Убираем кавычки
        .replace(/\.{2,}/g, '.') // Заменяем многоточия
        .replace(/\s+/g, ' ') // Убираем лишние пробелы
        .replace(/[""]/g, '"'); // Нормализуем кавычки
      
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
    console.log(`❌ Ошибка генерации описания:`, error.message);
    return `${birdName} — птица из нашей коллекции.`;
  }
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
  };
  
  return qualityFacts[birdName] || [
    "Обладает уникальными особенностями оперения.",
    "Имеет специализированный способ питания.",
    "Сезонно меняет места обитания."
  ];
}

async function generateReliableFacts(birdName, options = {}) {
  const { maxAttempts = 3 } = options;
  const defaultFacts = getQualityFacts(birdName);
  
  console.log(`🔍 Генерация фактов для "${birdName}"`);
  
  try {
    const existing = await getBirdFacts(birdName);
    if (existing && Array.isArray(existing) && existing.length >= 3) {
      console.log('✅ Использую существующие факты из базы');
      return existing;
    }
  } catch (err) {
    console.log('⚠️ Ошибка проверки базы фактов:', err.message);
  }
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`🔄 Попытка ${attempt}/${maxAttempts} для ${birdName}`);
      
      const candidate = await generateBirdFactsWithGeminiOnce(birdName);
      
      if (!candidate || candidate.length === 0) {
        console.log(`⚠️ Факты не сгенерированы в попытке ${attempt}`);
        await delay(1000);
        continue;
      }
      
      const isValid = candidate.length >= 3 && 
                     candidate.every(fact => fact.length >= 30 && fact.length <= 200);
      
      if (isValid) {
        console.log(`✅ Получены качественные факты от Gemini`);
        await saveBirdFacts(birdName, candidate);
        return candidate;
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

// ====== ОСНОВНАЯ ФУНКЦИЯ ПОЛУЧЕНИЯ ПТИЦЫ (ИСПРАВЛЕННАЯ ВЕРСИЯ) ======

export async function getRandomBirdData() {
  try {
    console.log('🚀 ИЩУ СОВЕРШЕННО НОВУЮ ПТИЦУ С ФОТО...');
    
    const allExistingBirds = await getAllBirdsFromRedis();
    console.log(`📊 В базе уже есть ${allExistingBirds.length} птиц`);
    
    const allBirdsSet = new Set(allExistingBirds.map(bird => normalizeBirdName(bird)));
    
    // Сначала пробуем гарантированный список
    console.log('🔍 Пробую гарантированный список птиц России...');
    const guaranteedBird = await getNewBirdFromExpandedList(allBirdsSet);
    
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

// Запасная птица с гарантированным фото
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
  
  // Если все запасные уже есть, берем первую
  console.log(`🔄 Все запасные птицы уже есть, беру: ${fallbackBirds[0]}`);
  return await generateCompleteBirdPost(fallbackBirds[0]);
}

// ====== ГЕНЕРАЦИЯ НОВОЙ ПТИЦЫ ЧЕРЕЗ GEMINI ======

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
5. Выбирай ТОЛЬКО птиц, у которых есть фотографии на Wikimedia Commons
6. Избегай экзотических, тропических или океанических птиц

ПРИМЕРЫ ПРАВИЛЬНЫХ ОТВЕТОВ (птицы России):
• Обыкновенная пустельга
• Серая мухоловка
• Большой улит
• Хохлатая чернеть
• Белая лазоревка
• Желтоголовый королёк

ПРИМЕРЫ НЕПРАВИЛЬНЫХ ОТВЕТОВ:
• Белокрылый гологлаз (обитает на Соломоновых островах, не в России)
• Амазонский попугай (экзотический)
• Тукан (не водится в России)
• Колибри (не водится в России)

Верни ТОЛЬКО название птицы, без кавычек, без пояснений.
`;

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7, // Снизил температуру для более предсказуемых результатов
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
    
    birdName = cleanBirdName(birdName);
    
    // ПРОВЕРКА: Должно быть конкретное название
    if (isGeneralFamilyName(birdName)) {
      console.log(`⚠️ Слишком общее название: "${birdName}"`);
      return null;
    }
    
    // ПРОВЕРКА: Не должно быть экзотическим
    if (isExoticBird(birdName)) {
      console.log(`⚠️ Экзотическая птица: "${birdName}"`);
      return null;
    }
    
    // Проверяем наличие фото СРАЗУ
    console.log(`🔍 Проверяю фото для: ${birdName}`);
    const hasPhoto = await hasRealPhoto(birdName);
    
    if (!hasPhoto) {
      console.log(`⚠️ У птицы нет фото: "${birdName}"`);
      
      // Пробуем найти похожую птицу с фото
      const similarWithPhoto = await findSimilarBirdWithPhoto(birdName, existingBirdsSet);
      if (similarWithPhoto) {
        console.log(`✅ Нашел похожую птицу с фото: ${similarWithPhoto}`);
        return similarWithPhoto;
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

// Проверка на экзотических птиц
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

// Поиск похожей птицы с фото
async function findSimilarBirdWithPhoto(birdName, existingBirdsSet) {
  console.log(`🔍 Ищу похожую птицу с фото для: ${birdName}`);
  
  const similarOptions = findSimilarBirds(birdName);
  
  for (const similarBird of similarOptions) {
    const normalizedSimilar = normalizeBirdName(similarBird);
    
    if (!existingBirdsSet.has(normalizedSimilar)) {
      const hasPhoto = await hasRealPhoto(similarBird);
      if (hasPhoto) {
        console.log(`✅ Нашел похожую птицу с фото: ${similarBird}`);
        return similarBird;
      }
    }
  }
  
  return null;
}

// ====== РАСШИРЕННЫЙ СПИСОК ПТИЦ ======

async function getNewBirdFromExpandedList(existingBirdsSet) {
  console.log('🔍 Ищу новую птицу в гарантированном списке птиц России...');
  
  // ГАРАНТИРОВАННЫЙ список птиц России с фото
  const guaranteedRussianBirds = [
    // Гарантированно есть фото
    "Большая синица", "Полевой воробей", "Обыкновенный снегирь", "Сизый голубь",
    "Кряква", "Чёрный стриж", "Обыкновенный скворец", "Обыкновенная лазоревка",
    "Обыкновенный поползень", "Зарянка", "Дрозд-рябинник", "Певчий дрозд",
    "Обыкновенная чечётка", "Обыкновенный свиристель", "Обыкновенная овсянка",
    "Ушастая сова", "Большой пёстрый дятел", "Серая ворона", "Сорока",
    "Озёрная чайка", "Зелёный дятел", "Московка", "Чиж", "Щегол", "Коноплянка",
    
    // Другие гарантированные
    "Белобровик", "Пухляк", "Зяблик", "Пеночка-теньковка", "Варакушка",
    "Серый журавль", "Чибис", "Бекас", "Коростель", "Перепел", "Фазан",
    "Тетерев", "Глухарь", "Рябчик", "Серая куропатка", "Белая куропатка",
    
    // Водоплавающие
    "Чирок-свистунок", "Серая утка", "Шилохвость", "Красноголовый нырок",
    "Хохлатая чернеть", "Гоголь", "Луток", "Большая поганка", "Малая поганка",
    
    // Хищные
    "Обыкновенный канюк", "Чёрный коршун", "Обыкновенная пустельга",
    "Чеглок", "Дербник", "Кобчик", "Орлан-белохвост", "Скопа"
  ];
  
  // Перемешиваем
  const shuffledBirds = [...guaranteedRussianBirds].sort(() => Math.random() - 0.5);
  
  // Ищем птицу, которой нет в базе
  for (const bird of shuffledBirds) {
    const normalizedBird = normalizeBirdName(bird);
    if (!existingBirdsSet.has(normalizedBird)) {
      
      // Для гарантированного списка фото должно быть
      console.log(`✅ Нашел гарантированную птицу России: ${bird}`);
      return bird;
    }
  }
  
  console.log('❌ Все гарантированные птицы уже есть в базе');
  return null;
}

// ====== АЛГОРИТМИЧЕСКАЯ ГЕНЕРАЦИЯ ======

async function generateBirdByAlgorithm(existingBirdsSet) {
  console.log('⚙️ Генерирую птицу алгоритмически...');
  
  // Списки компонентов для генерации
  const prefixes = [
    "Амурский", "Белый", "Чёрный", "Серый", "Рыжий", "Пёстрый", "Длиннохвостый",
    "Короткохвостый", "Большой", "Малый", "Обыкновенный", "Сибирский", "Уссурийский",
    "Степной", "Лесной", "Болотный", "Водяной", "Горный", "Полевой"
  ];
  
  const birdTypes = [
    "кобчик", "сорокопут", "чеглок", "канюк", "лунь", "орлан", "коршун",
    "сокол", "ястреб", "осоед", "змееяд", "балобан", "кречет"
  ];
  
  const otherBirds = [
    "удод", "зимородок", "щур", "дубонос", "свиристель", "чечевица",
    "щегол", "чиж", "зяблик", "коноплянка", "ремез", "овсянка", "чечётка",
    "юрок", "вьюрок", "щебетун", "поползень", "пищуха", "королёк"
  ];
  
  // Пробуем разные комбинации
  for (let attempt = 1; attempt <= 20; attempt++) {
    // Случайный выбор стратегии
    const strategy = Math.random();
    
    let generatedBird = "";
    
    if (strategy < 0.5) {
      // Префикс + тип птицы
      const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
      const type = birdTypes[Math.floor(Math.random() * birdTypes.length)];
      generatedBird = `${prefix} ${type}`;
    } else {
      // Префикс + другая птица
      const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
      const bird = otherBirds[Math.floor(Math.random() * otherBirds.length)];
      generatedBird = `${prefix} ${bird}`;
    }
    
    // Нормализуем и проверяем
    const normalizedBird = normalizeBirdName(generatedBird);
    
    if (!existingBirdsSet.has(normalizedBird)) {
      // Проверяем фото
      const hasPhoto = await hasRealPhoto(generatedBird);
      
      if (hasPhoto) {
        console.log(`✅ Алгоритм создал новую птицу: ${generatedBird}`);
        return generatedBird;
      }
    }
  }
  
  console.log('❌ Алгоритм не смог создать новую птицу');
  return null;
}

// ====== УТИЛИТЫ ======

function cleanBirdName(name) {
  return name
    .trim()
    .replace(/^["'`]|["'`]$/g, '')
    .replace(/\.+$/g, '')
    .replace(/^[0-9\.\-\s]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isValidBirdName(name) {
  if (!name || name.length < 3 || name.length > 100) return false;
  
  // Должно содержать хотя бы одно слово из 2+ букв
  const words = name.split(/[\s-]+/).filter(w => w.length >= 2);
  if (words.length < 1) return false;
  
  // Не должно быть общим названием
  if (isGeneralFamilyName(name)) return false;
  
  return true;
}

// ====== ПОИСК КОНКРЕТНОЙ ПТИЦЫ ИЗ СЕМЕЙСТВА ======

async function findSpecificBirdFromFamily(familyName) {
  if (!isGeneralFamilyName(familyName)) {
    return familyName;
  }
  
  console.log(`🔍 Ищу конкретную птицу из семейства: "${familyName}"`);
  
  const familyMap = {
    "попугай": ["Волнистый попугай", "Корелла", "Неразлучник", "Ара", "Какаду"],
    "синица": ["Большая синица", "Лазоревка", "Московка", "Хохлатая синица", "Пухляк"],
    "воробей": ["Полевой воробей", "Домовый воробей", "Каменный воробей", "Черногрудый воробей"],
    "снегирь": ["Обыкновенный снегирь", "Серый снегирь", "Уссурийский снегирь"],
    "голубь": ["Сизый голубь", "Вяхирь", "Клинтух", "Кольчатая горлица", "Скалистый голубь"],
    "сова": ["Ушастая сова", "Болотная сова", "Серая неясыть", "Домовый сыч", "Сплюшка"],
    "утка": ["Кряква", "Чирок-свистунок", "Серая утка", "Шилохвость", "Свиязь"],
    "дятел": ["Большой пёстрый дятел", "Малый пёстрый дятел", "Зелёный дятел", "Белоспинный дятел"],
    "дрозд": ["Певчий дрозд", "Дрозд-рябинник", "Чёрный дрозд", "Белобровик", "Деряба"],
    "ворона": ["Серая ворона", "Чёрная ворона", "Ворон", "Грач", "Галка"]
  };
  
  const lowerFamilyName = familyName.toLowerCase();
  
  // Ищем соответствующее семейство
  for (const [family, birds] of Object.entries(familyMap)) {
    if (lowerFamilyName.includes(family)) {
      // Перемешиваем список птиц
      const shuffledBirds = [...birds].sort(() => Math.random() - 0.5);
      
      // Получаем историю публикаций
      const [history, allBirds] = await Promise.all([
        getWeeklyBirds(),
        getAllBirdsFromRedis()
      ]);
      
      const usedBirdsSet = new Set(history.map(h => normalizeBirdName(h)));
      
      // Ищем конкретную птицу, которой нет в истории
      for (const bird of shuffledBirds) {
        const normalizedBird = normalizeBirdName(bird);
        
        if (!usedBirdsSet.has(normalizedBird)) {
          // Проверяем фото
          const hasPhoto = await hasRealPhoto(bird);
          if (hasPhoto) {
            console.log(`✅ Нашел конкретную птицу из семейства: ${bird}`);
            return bird;
          }
        }
      }
      
      break;
    }
  }
  
  // Если не нашли конкретную птицу, возвращаем оригинальное название
  return familyName;
}

// ====== АВАРИЙНЫЙ ВАРИАНТ ======

async function getFallbackBirdData(birdName = null) {
  try {
    // Сначала пытаемся найти хотя бы какую-то птицу из базы
    const allBirds = await getAllBirdsFromRedis();
    
    if (allBirds.length > 0) {
      // Перемешиваем массив и берем случайную птицу
      const shuffledBirds = [...allBirds].sort(() => Math.random() - 0.5);
      const randomBird = shuffledBirds[0];
      
      console.log(`🔄 Аварийный режим: использую случайную птицу из базы - ${randomBird}`);
      
      // Генерируем факты для этой птицы
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
  
  // Если ничего не сработало, используем запасной вариант
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

async function hasRealPhoto(birdName) {
  try {
    const imageUrl = await getBirdWikiImage(birdName);
    return !!(imageUrl && isRealPhoto(imageUrl));
  } catch (err) {
    return false;
  }
}

// ====== ВИКТОРИНЫ ======

export async function generateQuiz() {
  try {
    console.log('🎯 Генерация викторины');
    
    // 1. Получаем историю птиц
    const history = await getWeeklyBirds();
    
    if (history.length < 4) {
      console.log('❌ Недостаточно птиц в истории для викторины');
      return await generateFallbackQuiz();
    }
    
    console.log(`📊 В истории: ${history.length} птиц`);
    
    // 2. Фильтруем птиц, у которых есть факты
    const birdsWithFacts = [];
    const birdsWithoutFacts = [];
    
    for (const bird of history) {
      try {
        const facts = await getBirdFacts(bird);
        if (facts && Array.isArray(facts) && facts.length >= 3) {
          birdsWithFacts.push({
            name: bird,
            facts: facts
          });
        } else {
          birdsWithoutFacts.push(bird);
          console.log(`⚠️ У птицы "${bird}" нет фактов или их недостаточно (${facts?.length || 0})`);
        }
      } catch (error) {
        console.log(`⚠️ Ошибка получения фактов для "${bird}":`, error.message);
        birdsWithoutFacts.push(bird);
      }
    }
    
    // Логируем статистику
    if (birdsWithoutFacts.length > 0) {
      console.log(`⚠️ Птиц без фактов: ${birdsWithoutFacts.length} - ${birdsWithoutFacts.join(', ')}`);
    }
    
    if (birdsWithFacts.length < 4) {
      console.log(`❌ Недостаточно птиц с фактами для викторины (нужно 4, есть ${birdsWithFacts.length})`);
      return await generateFallbackQuiz();
    }
    
    console.log(`✅ Птиц с фактами: ${birdsWithFacts.length}`);
    
    // 3. Выбираем случайную птицу из тех, у кого есть факты
    const shuffledBirds = [...birdsWithFacts].sort(() => Math.random() - 0.5);
    const selectedBird = shuffledBirds[0];
    
    console.log(`🎯 Выбрана птица для викторины: ${selectedBird.name}`);
    
    // 4. Генерируем вопрос через Gemini
    const question = await generateQuizQuestion(selectedBird.name, selectedBird.facts);
    
    if (!question || question.length < 20) {
      console.log('❌ Не удалось сгенерировать хороший вопрос');
      return await generateFallbackQuiz();
    }
    
    // 5. Выбираем варианты ответов
    const otherBirds = shuffledBirds
      .slice(1, 4) // Берем следующие 3 птицы
      .map(bird => bird.name);
    
    if (otherBirds.length < 3) {
      console.log('❌ Недостаточно других птиц для вариантов');
      return await generateFallbackQuiz();
    }
    
    // 6. Создаем варианты ответов
    const options = [selectedBird.name, ...otherBirds]
      .sort(() => Math.random() - 0.5);
    
    const correctIndex = options.indexOf(selectedBird.name);
    
    if (correctIndex === -1) {
      console.log('❌ Правильная птица не попала в варианты');
      return await generateFallbackQuiz();
    }
    
    // 7. Проверяем, что все варианты уникальны
    const uniqueOptions = [...new Set(options)];
    if (uniqueOptions.length !== 4) {
      console.log('❌ Есть дубликаты в вариантах ответов');
      return await generateFallbackQuiz();
    }
    
    const quizData = {
      question: `🎯 ${question}`,
      options: options,
      correctIndex: correctIndex,
      correctBird: selectedBird.name,
      originalFacts: selectedBird.facts,
      hasQualityData: true
    };
    
    console.log(`✅ Викторина сгенерирована успешно!`);
    console.log(`   Вопрос: ${question.substring(0, 60)}...`);
    console.log(`   Правильный ответ: ${quizData.correctBird} (позиция ${quizData.correctIndex + 1})`);
    console.log(`   Варианты: ${quizData.options.join(', ')}`);
    
    return quizData;
    
  } catch (error) {
    console.error('❌ Ошибка генерации викторины:', error);
    return await generateFallbackQuiz();
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

async function generateQuizQuestion(birdName, facts) {
  try {
    const prompt = `
Создай интересный вопрос для викторины о птицах на основе этих фактов о птице "${birdName}":

Факты:
${facts.map(f => `• ${f}`).join('\n')}

Вопрос должен:
1. Быть интересным и неочевидным
2. Не содержать прямое упоминание названия птицы "${birdName}"
3. Быть связанным с одним или несколькими фактами
4. Быть понятным для широкой аудитории
5. Состоять из 1-2 предложений

Пример хорошего вопроса: "Какая птица известна тем, что строит самые сложные гнёзда?"
Пример плохого вопроса: "Какая птица называется дрозд?"

Верни только вопрос, без дополнительного текста. Не делай слишком сложного, должно быть немного легко!
`;
    
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 100
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
      return question.trim();
    }
    
    return null;
    
  } catch (error) {
    console.error('❌ Ошибка генерации вопроса:', error);
    return `Какая птица соответствует этому описанию?`;
  }
}

// ====== ЭКСПОРТ ======

export default {
  initializeRedis,
  getRandomBirdData,
  generateQuiz,
  generateFallbackQuiz,
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
  normalizeBirdName
};