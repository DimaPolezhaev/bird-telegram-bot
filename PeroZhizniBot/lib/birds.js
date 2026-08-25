import { fetch } from 'undici';
import * as supabase from './supabase.js';
import * as imageSearch from './imageSearch.js';
import { getRussianBirdsFromWikipedia, getRussianBirdsWithPhotos, getKupidoniaBirds } from './russianBirdsList.js';
import { normalizeBirdName, fetchWithRetry } from './utils.js';

// ====== КОНФИГИ ======
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// Резервный API для генерации фактов (например, альтернативный ключ или совместимый endpoint)
// Пример: https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=XXX
const ReserveAPI = process.env.RESERVE_API || null;
// Используем ОДНУ стабильную модель Gemini
const GEMINI_MODEL = "gemini-2.5-flash-lite";
const GEMINI_VISION_MODEL = "gemini-1.5-flash"; // Модель с поддержкой Vision

// Базовая часть URL
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

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
    'artwork', 'art_work', 'coloring', 'pattern', 'design',
    'range', 'distribution', 'habitat', 'area', 'location',
    'spread', 'extent', 'atlas', 'geography', 'territory'
  ];

  let decodedUrl = url;
  try { decodedUrl = decodeURIComponent(url); } catch (e) { }

  for (const word of illustrationWords) {
    const regex = new RegExp(`(?:^|[^a-zа-яё0-9])${word}(?:[^a-zа-яё0-9]|$)`, 'iu');
    if (regex.test(decodedUrl)) {
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

function isGeneralFamilyName(birdName) {
  const lowerName = birdName.toLowerCase();

  // Проверка на окончания семейств и отрядов
  if (lowerName.endsWith('вые') ||
    lowerName.endsWith('ные') ||
    lowerName.endsWith('образные') ||
    lowerName.endsWith('вые)') ||
    lowerName.endsWith('ные)') ||
    lowerName.endsWith('образные)')) {
    return true;
  }

  const generalFamilies = [
    'попугай', 'синица', 'воробей', 'снегирь', 'дрозд',
    'утка', 'голубь', 'сова', 'дятел', 'ворона', 'сокол',
    'орёл', 'чайка', 'ласточка', 'соловей', 'жаворонок',
    'тукан', 'пеликан', 'лебедь', 'гусь', 'журавль', 'аист',
    'фламинго', 'цапля', 'пингвин', 'кулик', 'стриж', 'кукушка',
    'коростель', 'фазан', 'куропатка', 'рябчик', 'глухарь', 'тетерев',
    'сип', 'гриф', 'стервятник', 'беркут', 'ястреб', 'коршун',
    'лунь', 'сапсан', 'осоед', 'выпь', 'ибис', 'баклан', 'поганка',
    'гагара', 'альбатрос', 'буревестник', 'киви', 'страус', 'эму',
    'казуар', 'дрофа', 'стрепет', 'горлица'
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

async function isBirdInAllBirds(birdName) {
  const normalizedName = normalizeBirdName(birdName);
  return await supabase.isBirdInDatabase(normalizedName);
}

async function addBirdToAllBirds(birdName) {
  const normalizedName = normalizeBirdName(birdName);
  await supabase.addBird(normalizedName);
}

async function getAllBirdsFromRedis() {
  const birds = await supabase.getAllBirds();
  return birds.map(bird => normalizeBirdName(bird));
}

async function getBirdFacts(birdName) {
  return await supabase.getBirdFacts(birdName);
}

async function saveBirdFacts(birdName, facts) {
  await supabase.saveBirdFacts(birdName, facts);
}

async function getAllBirdFacts() {
  return await supabase.getAllBirdFacts();
}

async function getWeeklyBirds() {
  const birdsWithDates = await supabase.getWeeklyBirds();
  return birdsWithDates.map(bird => {
    const match = bird.match(/^([^(]+)/);
    return match ? match[1].trim() : bird;
  });
}

async function updateBirdHistory(birdName) {
  await supabase.updateBirdHistory(birdName);
}

async function getBirdsCount() {
  return await supabase.getBirdsCount();
}

// ====== ФУНКЦИИ ДЛЯ ПРЕДЛОЖЕНИЙ ======
async function saveBirdSuggestion(userId, username, birdName) {
  return await supabase.saveBirdSuggestion(userId, username, birdName);
}

async function getPendingSuggestions() {
  return await supabase.getPendingSuggestions();
}

async function getUserSuggestions(userId) {
  return await supabase.getUserSuggestions(userId);
}

async function approveSuggestion(suggestionId, adminId) {
  return await supabase.approveSuggestion(suggestionId, adminId);
}

async function rejectSuggestion(suggestionId, adminId, reason = null) {
  return await supabase.rejectSuggestion(suggestionId, adminId, reason);
}

async function getSuggestionById(suggestionId) {
  return await supabase.getSuggestionById(suggestionId);
}

async function isDuplicateSuggestion(userId, birdName) {
  return await supabase.isDuplicateSuggestion(userId, birdName);
}

async function getSuggestionsStats() {
  return await supabase.getSuggestionsStats();
}


// ====== ФУНКЦИИ ДЛЯ ПРИОРИТЕТНЫХ ПТИЦ ======
async function getPriorityBird() {
  return await supabase.getPriorityBird();
}

async function getPriorityBirdWithPhoto() {
  return await supabase.getPriorityBirdWithPhoto();
}

async function markPriorityBirdAsUsed(suggestionId) {
  return await supabase.markPriorityBirdAsUsed(suggestionId);
}

// ====== ИНИЦИАЛИЗАЦИЯ ======
async function initializeRedis() {
  console.log('🔗 [SUPABASE] Инициализация PostgreSQL через Supabase');
  return await supabase.initializeSupabase();
}

// ====== ПОИСК ИЗОБРАЖЕНИЙ ======

async function getBirdWikiImage(birdName) {
  const startTime = Date.now();
  const { logImageSourceStat } = supabase;


  // Внутренняя функция для выполнения запроса
  const performWikiSearch = async (name) => {
    try {
      console.log(`🌐 Ищу фото в Википедии для: "${name}"`);
      const encodedName = encodeURIComponent(name);

      // 1. Первый подход: через pageimages
      const url1 = `https://ru.wikipedia.org/w/api.php?action=query&titles=${encodedName}&prop=pageimages&format=json&piprop=original&pilicense=any`;

      // console.log(`   🔍 Запрос 1: pageimages original`);
      const response1 = await fetchWithRetry(url1, {
        headers: { 'User-Agent': 'BirdTelegramBot/1.0 (https://t.me/PeroZhizni; admin@example.com)' }
      });
      if (response1.ok) {
        const data1 = await response1.json();
        const pages1 = data1.query.pages;
        const pageId1 = Object.keys(pages1)[0];

        if (pageId1 !== "-1" && pages1[pageId1].original) {
          const originalUrl = pages1[pageId1].original.source;
          if (isValidImageUrl(originalUrl)) {
            console.log(`   ✅ Нашел оригинальное фото (${name}): ${getShortUrl(originalUrl)}`);
            await logImageSourceStat('wikipedia', birdName, true, Date.now() - startTime);
            return originalUrl;
          }
        }
      }

      await delay(300);

      // 2. Второй подход: через thumbnail (чаще работает)
      const url2 = `https://ru.wikipedia.org/w/api.php?action=query&titles=${encodedName}&prop=pageimages&format=json&pithumbsize=1200&pilicense=any`;

      // console.log(`   🔍 Запрос 2: thumbnail 1200px`);
      const response2 = await fetchWithRetry(url2, {
        headers: { 'User-Agent': 'BirdTelegramBot/1.0 (https://t.me/PeroZhizni; admin@example.com)' }
      });
      if (response2.ok) {
        const data2 = await response2.json();
        const pages2 = data2.query.pages;
        const pageId2 = Object.keys(pages2)[0];

        if (pageId2 !== "-1" && pages2[pageId2].thumbnail) {
          const thumbUrl = pages2[pageId2].thumbnail.source;
          if (isValidImageUrl(thumbUrl)) {
            console.log(`   ✅ Нашел thumbnail фото (${name}): ${getShortUrl(thumbUrl)}`);
            await logImageSourceStat('wikipedia', birdName, true, Date.now() - startTime);
            return thumbUrl;
          }
        }
      }

      // 3. Третий подход: через английскую Википедию (только если это исходное имя, чтобы не спамить)
      if (name === birdName) {
        await delay(300);
        const url3 = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodedName}&prop=pageimages&format=json&pithumbsize=1200`;

        // console.log(`   🔍 Запрос 3: English Wikipedia`);
        const response3 = await fetchWithRetry(url3, {
          headers: { 'User-Agent': 'BirdTelegramBot/1.0 (https://t.me/PeroZhizni; admin@example.com)' }
        });
        if (response3.ok) {
          const data3 = await response3.json();
          const pages3 = data3.query.pages;
          const pageId3 = Object.keys(pages3)[0];

          if (pageId3 !== "-1" && pages3[pageId3].thumbnail) {
            const thumbUrl = pages3[pageId3].thumbnail.source;
            if (isValidImageUrl(thumbUrl)) {
              console.log(`   ✅ Нашел фото в английской Вики: ${getShortUrl(thumbUrl)}`);
              await logImageSourceStat('wikipedia', birdName, true, Date.now() - startTime);
              return thumbUrl;
            }
          }
        }
      }

      return null;

    } catch (error) {
      console.log(`   ⚠️ Wikipedia API error (${name}): ${error.message}`);
      return null;
    }
  };

  // Формируем список вариантов для поиска
  const variations = [birdName];

  // Добавляем инвертированный вариант для имен из двух слов
  // Пример: "Фазан Обыкновенный" -> "Обыкновенный фазан"
  const parts = birdName.split(' ');
  if (parts.length === 2) {
    // Обычная инверсия "Обыкновенный Фазан"
    variations.push(`${parts[1]} ${parts[0]}`);

    // Инверсия с lowercase "Обыкновенный фазан" (наиболее вероятно для Вики)
    variations.push(`${parts[1]} ${parts[0].toLowerCase()}`);

    // Прямой порядок с lowercase "Фазан обыкновенный"
    variations.push(`${parts[0]} ${parts[1].toLowerCase()}`);
  }

  // Убираем дубликаты
  const uniqueVariations = [...new Set(variations)];

  // Пробуем каждый вариант
  for (const variant of uniqueVariations) {
    const image = await performWikiSearch(variant);
    if (image) return image;

    // Небольшая задержка между вариантами, если их несколько
    if (uniqueVariations.length > 1) await delay(200);
  }

  console.log(`   ❌ Не нашел фото в Википедии (проверено ${uniqueVariations.length} вариантов)`);
  await logImageSourceStat('wikipedia', birdName, false, Date.now() - startTime);
  return null;
}

/**
 * Валидация URL изображения (улучшенная)
 */
function isValidImageUrl(url) {
  if (!url || typeof url !== 'string') return false;

  const lowerUrl = url.toLowerCase();

  // Проверяем что это действительно ссылка на изображение
  const validExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
  const hasValidExtension = validExtensions.some(ext => lowerUrl.includes(ext));

  if (!hasValidExtension) {
    console.log(`   ⚠️ Невалидное расширение: ${url.substring(0, 50)}...`);
    return false;
  }

  // Проверяем что это не HTML страница (убрана проверка на символ '?', 
  // так как Wikimedia Commons часто использует валидные query параметры)
  if (lowerUrl.includes('.php') || lowerUrl.includes('.html')) {
    console.log(`   ⚠️ Подозрительный URL (возможно HTML): ${url.substring(0, 50)}...`);
    return false;
  }

  // Проверяем домен
  if (!lowerUrl.includes('wikimedia.org') && !lowerUrl.includes('wikipedia.org')) {
    console.log(`   ⚠️ Неизвестный домен: ${getShortUrl(url)}`);
    return false;
  }

  return true;
}

function getShortUrl(url) {
  if (!url) return '';
  if (url.length <= 60) return url;
  return url.substring(0, 57) + '...';
}

async function searchWikidataImage(birdName) {
  const startTime = Date.now();
  const { logImageSourceStat } = supabase;


  try {
    const encodedName = encodeURIComponent(birdName);
    const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodedName}&language=ru&format=json&limit=5`;

    const response = await fetchWithRetry(url, {
      headers: { 'User-Agent': 'BirdTelegramBot/1.0 (https://t.me/PeroZhizni; admin@example.com)' }
    });
    if (!response.ok) return null;

    const data = await response.json();

    for (const entity of data.search || []) {
      if (entity.description?.toLowerCase().includes('птиц') ||
        entity.description?.toLowerCase().includes('bird') ||
        entity.description?.toLowerCase().includes('species')) {

        // Получаем информацию о сущности
        const entityUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${entity.id}&format=json&props=claims`;
        const entityResponse = await fetchWithRetry(entityUrl, {
          headers: { 'User-Agent': 'BirdTelegramBot/1.0 (https://t.me/PeroZhizni; admin@example.com)' }
        });
        const entityData = await entityResponse.json();

        // Ищем свойство P18 (изображение)
        const claims = entityData.entities?.[entity.id]?.claims;
        if (claims?.P18) {
          const imageName = claims.P18[0]?.mainsnak?.datavalue?.value;
          if (imageName) {
            // Получаем прямой URL через Wikimedia Commons imageinfo API
            // (Special:FilePath возвращает HTML-редирект, который Telegram не принимает)
            const encodedImageName = encodeURIComponent(imageName.replace(/ /g, '_'));
            const commonsApiUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=File:${encodedImageName}&prop=imageinfo&iiprop=url&iiurlwidth=1024&format=json`;
            try {
              const commonsRes = await fetchWithRetry(commonsApiUrl, {
                headers: { 'User-Agent': 'BirdTelegramBot/1.0 (https://t.me/PeroZhizni; admin@example.com)' }
              });
              if (commonsRes.ok) {
                const commonsData = await commonsRes.json();
                const cPages = commonsData.query?.pages;
                const cPageId = cPages ? Object.keys(cPages)[0] : null;
                const thumburl = cPages?.[cPageId]?.imageinfo?.[0]?.thumburl;
                const directUrl = cPages?.[cPageId]?.imageinfo?.[0]?.url;
                // Предпочitаем thumburl (масштабированный), иначе оригинал
                const finalUrl = thumburl || directUrl;
                if (finalUrl && (finalUrl.includes('.jpg') || finalUrl.includes('.jpeg') || finalUrl.includes('.png') || finalUrl.includes('.webp'))) {
                  await logImageSourceStat('wikidata', birdName, true, Date.now() - startTime);
                  return finalUrl;
                }
              }
            } catch (commonsErr) {
              console.log(`   ⚠️ Commons API error: ${commonsErr.message}`);
            }
          }
        }
      }
    }

    await logImageSourceStat('wikidata', birdName, false, Date.now() - startTime);
    return null;
  } catch (error) {
    console.log(`   ⚠️ Wikidata error: ${error.message}`);
    return null;
  }
}

async function searchBirdImageWithGemini(birdName, customPrompt = null) {
  const startTime = Date.now();
  const { logImageSourceStat } = supabase;


  try {
    const prompt = customPrompt || `
Найди ПРЯМУЮ ссылку на качественную фотографию птицы "${birdName}" на Wikimedia Commons, если не смог там используй обычный Wikimedia.

ВАЖНЫЕ ТРЕБОВАНИЯ:
1. Ссылка должна быть НАПРЯМУЮ на изображение (заканчиваться на .jpg, .jpeg, .png)
2. Изображение должно быть с сайта upload.wikimedia.org
3. Фотография должна быть реальной, а не рисунком
4. Птица должна быть хорошо видна
5. Это должна быть именно птица "${birdName}", а не другая птица
6. Разрешение минимум 800x600 пикселей

ПРИМЕРЫ ПРАВИЛЬНЫХ ССЫЛОК:
- https://upload.wikimedia.org/wikipedia/commons/thumb/d/d1/Common_Kingfisher_%28Alcedo_atthis%29.jpg/1024px-Common_Kingfisher_%28Alcedo_atthis%29.jpg
- https://upload.wikimedia.org/wikipedia/commons/8/8a/Great_Tit_%28Parus_major%29.jpg
- https://upload.wikimedia.org/wikipedia/commons/b/b9/European_Robin_%28Erithacus_rubecula%29.jpg

ЕСЛИ НЕ НАЙДЕШЬ ТОЧНОЕ ФОТО "${birdName}" - верни "NO_PHOTO".
Ссылка должна начинаться с https:// и заканчиваться расширением изображения.

Сейчас найди точное фото для птицы: "${birdName}"
`;

    // Используем ОДНУ стабильную модель
    const model = GEMINI_MODEL;
    try {
      const modelUrl = `${GEMINI_BASE_URL}/${model}:generateContent?key=${GEMINI_API_KEY}`;

      const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 200,
          topP: 0.1
        }
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const res = await fetch(modelUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        console.log(`   ⚠️ Модель ${model} не ответила: ${res.status}`);
        return null;
      }

      const data = await res.json();
      const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      let imageUrl = responseText.trim();

      console.log(`   🔍 Модель ${model} ответила: ${imageUrl.substring(0, 100)}...`);

      // Проверяем что это действительно ссылка на фото И НЕ NO_PHOTO
      if (imageUrl === 'NO_PHOTO') {
        console.log(`   ❌ Модель ${model}: фото не найдено`);
        return null;
      }

      if (!validateBirdPhoto(imageUrl, birdName)) {
        console.log(`   ⚠️ Модель ${model}: фото не подходит по валидации`);
        return null;
      }

      if (imageUrl.startsWith('http') &&
        (imageUrl.includes('upload.wikimedia.org') ||
          imageUrl.includes('wikimedia.org')) &&
        (imageUrl.includes('.jpg') || imageUrl.includes('.jpeg') || imageUrl.includes('.png')) &&
        !imageUrl.includes('/thumb/') &&
        imageUrl.length > 20) {

        // Дополнительная проверка: не должно быть другой птицы в названии
        const lowerUrl = imageUrl.toLowerCase();
        const lowerBirdName = birdName.toLowerCase();

        // Проверяем на явно неправильные фото
        const wrongBirdKeywords = {
          'поганка': ['cormorant', 'баклан', 'цапля', 'heron', 'утка', 'duck'],
          'сыч': ['сова', 'owl', 'филин', 'eagle'],
          'синица': ['воробей', 'sparrow', 'зяблик', 'finch']
        };

        let isWrongPhoto = false;
        for (const [birdType, wrongKeywords] of Object.entries(wrongBirdKeywords)) {
          if (lowerBirdName.includes(birdType)) {
            for (const wrongKeyword of wrongKeywords) {
              if (lowerUrl.includes(wrongKeyword)) {
                console.log(`   ⚠️ Модель ${model}: нашла неправильную птицу (${wrongKeyword}) вместо ${birdType}`);
                isWrongPhoto = true;
                break;
              }
            }
          }
        }

        if (!isWrongPhoto) {
          console.log(`   ✅ Модель ${model} нашла фото: ${imageUrl.substring(0, 80)}...`);
          await logImageSourceStat('gemini_image', birdName, true, Date.now() - startTime);
          return imageUrl;
        }
      }

      console.log(`   ⚠️ Модель ${model}: некорректная ссылка`);
      await logImageSourceStat('gemini_image', birdName, false, Date.now() - startTime);

    } catch (modelError) {
      if (modelError.name === 'AbortError') {
        console.log(`   ⏰ Модель ${model} превысила таймаут`);
        await logImageSourceStat('gemini_image', birdName, false, Date.now() - startTime);
        return null;
      } else {
        console.log(`   ⚠️ Ошибка модели ${model}: ${modelError.message}`);
        await logImageSourceStat('gemini_image', birdName, false, Date.now() - startTime);
        return null;
      }
    }

    console.log('   ❌ Модель не нашла подходящее фото');
    await logImageSourceStat('gemini_image', birdName, false, Date.now() - startTime);
    return null;

  } catch (error) {
    console.log(`   ❌ Ошибка поиска фото через Gemini: ${error.message}`);
    return null;
  }
}

/**
 * Поиск фото через родственные птицы
 */
async function searchPhotoThroughFamily(birdName) {
  try {
    const family = getBirdFamily(birdName);
    if (!family) return null;

    console.log(`   📋 Семейство: ${family}`);

    const familyMembers = getFamilyMembers(family);

    for (const member of familyMembers) {
      if (member.toLowerCase() === birdName.toLowerCase()) continue;

      try {
        const imageUrl = await getBirdWikiImage(member);
        if (imageUrl && isValidImageUrl(imageUrl)) {
          console.log(`   ✅ Нашел фото родственной птицы: ${member}`);
          return imageUrl;
        }
      } catch (error) {
        continue;
      }
    }

    return null;
  } catch (error) {
    console.log(`   ⚠️ Ошибка поиска по семейству: ${error.message}`);
    return null;
  }
}

/**
 * Специальная обработка для птиц с дефисами
 */
async function searchBirdWithHyphen(birdName) {
  if (!birdName.includes('-')) {
    return null;
  }

  console.log(`➖ Обрабатываю птицу с дефисом: "${birdName}"`);

  try {
    // Вариант 1: Пробуем как есть
    let imageUrl = await getBirdWikiImage(birdName);
    if (imageUrl && isRealPhoto(imageUrl)) {
      return imageUrl;
    }

    // Вариант 2: Убираем дефис
    const withoutHyphen = birdName.replace('-', ' ');
    imageUrl = await getBirdWikiImage(withoutHyphen);
    if (imageUrl && isRealPhoto(imageUrl)) {
      return imageUrl;
    }

    // Вариант 3: Ищем только первое слово (часто основное название)
    const firstWord = birdName.split('-')[0].trim();
    imageUrl = await getBirdWikiImage(firstWord);
    if (imageUrl && isRealPhoto(imageUrl)) {
      return imageUrl;
    }

    // Вариант 4: Ищем на английском через латинское название
    const latinName = getLatinNameForBird(birdName);
    if (latinName) {
      imageUrl = await getBirdWikiImage(latinName);
      if (imageUrl && isRealPhoto(imageUrl)) {
        return imageUrl;
      }
    }

    // Вариант 5: Ищем в Wikimedia Commons напрямую
    const encodedName = encodeURIComponent(birdName);
    const commonsUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=File:${encodedName}&prop=imageinfo&iiprop=url&format=json`;

    const response = await fetchWithRetry(commonsUrl, {
      headers: { 'User-Agent': 'BirdTelegramBot/1.0 (https://t.me/PeroZhizni; admin@example.com)' }
    });
    if (response.ok) {
      const data = await response.json();
      const pages = data.query.pages;
      const pageId = Object.keys(pages)[0];

      if (pageId !== "-1" && pages[pageId].imageinfo) {
        const url = pages[pageId].imageinfo[0].url;
        if (isRealPhoto(url)) {
          return url;
        }
      }
    }

    return null;

  } catch (error) {
    console.log(`   ⚠️ Ошибка поиска для птицы с дефисом: ${error.message}`);
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
    "Лысуха": "Fulica atra",

    // Добавим новые
    "Тетерев-косач": "Lyrurus tetrix",
    "Фазан Обыкновенный": "Phasianus colchicus",
    "Лебедь-шипун": "Cygnus olor",
    "Белоглазый Нырок": "Aythya nyroca",
    "Краснозобая Гагара": "Gavia stellata",
    "Красный Коршун": "Milvus milvus",
    "Чёрная Кряква": "Anas rubripes",
    "Глупыш": "Fulmarus glacialis",
    "Каравайка": "Plegadis falcinellus",
    "Колпица": "Platalea leucorodia",
    "Ибис": "Threskiornis aethiopicus",

    // Тетеревиные
    "Тетерев": "Lyrurus tetrix",
    "Глухарь": "Tetrao urogallus",
    "Рябчик": "Bonasa bonasia",
    "Куропатка белая": "Lagopus lagopus",
    "Куропатка серая": "Perdix perdix",

    // Утиные
    "Кряква": "Anas platyrhynchos",
    "Чирок-свистунок": "Anas crecca",
    "Свиязь": "Mareca penelope",
    "Шилохвость": "Anas acuta",
    "Гоголь": "Bucephala clangula"
  };
  // Сначала ищем точное совпадение
  if (latinNames[birdName]) {
    return latinNames[birdName];
  }

  // Ищем по ключевым словам
  const lowerName = birdName.toLowerCase();
  for (const [rusName, latName] of Object.entries(latinNames)) {
    if (lowerName.includes(rusName.toLowerCase()) ||
      rusName.toLowerCase().includes(lowerName)) {
      return latName;
    }
  }

  return null;
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
  const similarBirds = [];

  // Словарь похожих птиц
  const similarityMap = {
    'тетерев': ['глухарь', 'рябчик', 'куропатка', 'белая куропатка'],
    'косач': ['тетерев', 'глухарь', 'рябчик'],
    'глухарь': ['тетерев', 'рябчик', 'косач'],
    'рябчик': ['тетерев', 'глухарь'],
    'фазан': ['перепел', 'куропатка', 'тетерев'],
    'перепел': ['фазан', 'куропатка'],
    'альбатрос': ['буревестник', 'омела', 'глупыш'],
    'буревестник': ['альбатрос', 'омела', 'глупыш', 'тайфунник'],
    'тайфунник': ['буревестник', 'альбатрос'],
    'глупыш': ['буревестник', 'альбатрос'],
    'цапля': ['выпь', 'кваква', 'чепура'],
    'ибис': ['каравайка', 'колпица', 'ложноклюв'],
    'каравайка': ['ибис', 'колпица'],
    'колпица': ['ибис', 'каравайка'],
    'утка': ['кряква', 'чирок', 'нырок', 'гоголь', 'гага'],
    'лебедь': ['гусь', 'казарка'],
    'гагара': ['поганка', 'нырок'],
    'поганка': ['гагара', 'нырок', 'чомга'],
    'сокол': ['кобчик', 'чеглок', 'дербник', 'пустельга'],
    'орёл': ['ястреб', 'канюк', 'лунь', 'коршун'],
    'коршун': ['орёл', 'ястреб', 'канюк'],
    'сова': ['сыч', 'сипуха', 'неясыть', 'филин'],
    'дятел': ['вертишейка', 'желна'],
    'воробей': ['зяблик', 'юрок', 'вьюрок', 'коноплянка'],
    'синица': ['гаичка', 'московка', 'пухляк', 'лазоревка'],
    'ворона': ['ворон', 'галка', 'грач', 'сойка', 'сорока']
  };

  // Для тайфунника
  if (lowerName.includes('тайфунник')) {
    similarBirds.push('глупыш', 'буревестник', 'альбатрос', 'омела');
  }

  // Для буревестниковых
  if (lowerName.includes('буревестник') || lowerName.includes('глупыш')) {
    similarBirds.push('тайфунник', 'альбатрос', 'омела', 'буревестник');
  }

  // Проверяем по ключевым словам
  for (const [keyword, similar] of Object.entries(similarityMap)) {
    if (lowerName.includes(keyword)) {
      similarBirds.push(...similar);
      break;
    }
  }

  // Также добавляем птиц из того же семейства
  const family = getBirdFamily(birdName);
  if (family) {
    // Для каждого семейства добавляем представителей
    const familyBirds = {
      'тетеревиные': ['тетерев', 'глухарь', 'рябчик', 'куропатка', 'белая куропатка'],
      'фазановые': ['фазан', 'перепел', 'куропатка'],
      'альбатросовые': ['альбатрос', 'дымчатый альбатрос'],
      'буревестниковые': ['буревестник', 'тайфунник', 'глупыш', 'омела'],
      'цаплевые': ['цапля', 'выпь', 'кваква', 'чепура', 'белая цапля', 'серая цапля'],
      'ибиcовые': ['ибис', 'каравайка', 'колпица', 'ложноклюв'],
      'утковые': ['утка', 'кряква', 'чирок', 'нырок', 'гоголь', 'гага', 'лебедь', 'гусь']
    };

    if (familyBirds[family]) {
      similarBirds.push(...familyBirds[family]);
    }
  }

  // Убираем дубликаты и саму птицу
  return [...new Set(similarBirds.filter(bird =>
    bird.toLowerCase() !== lowerName
  ))];
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

async function cacheBirdImage(birdName, imageUrl) {
  try {
    console.log(`💾 Кеширую фото для "${birdName}"`);
    // Здесь должна быть логика сохранения в Supabase
    // Пока просто логируем
    return true;
  } catch (error) {
    console.log('⚠️ Ошибка кеширования фото:', error.message);
    return false;
  }
}

async function getFileUrl(fileId) {
  try {
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN1;
    if (!BOT_TOKEN) return null;

    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
    const data = await response.json();

    if (data.ok && data.result.file_path) {
      return `https://api.telegram.org/file/bot${BOT_TOKEN}/${data.result.file_path}`;
    }
    return null;
  } catch (error) {
    console.error('❌ Ошибка getFileUrl:', error.message);
    return null;
  }
}

async function getCachedBirdImage(birdName) {
  try {
    console.log(`🔍 Ищу кешированное фото для "${birdName}"`);
    // Здесь должна быть логика получения из Supabase
    // Пока возвращаем null чтобы искать заново
    return null;
  } catch (error) {
    console.log('⚠️ Ошибка получения кешированного фото:', error.message);
    return null;
  }
}

/**
 * Верификация фото через Gemini Vision API (inlineData — правильный подход).
 * Скачивает фото и отправляет как base64 inlineData.
 * При ошибке/таймауте возвращает true (graceful degradation).
 */
async function verifyBirdPhotoWithGemini(imageUrl, birdName) {
  try {
    console.log(`🔎 [VISION] Проверяю фото для "${birdName}"...`);

    // Шаг 1: Скачиваем изображение
    const imgController = new AbortController();
    const imgTimeout = setTimeout(() => imgController.abort(), 7000);

    let imageBuffer;
    let mimeType = 'image/jpeg';

    try {
      const imgRes = await fetchWithRetry(imageUrl, {
        signal: imgController.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      clearTimeout(imgTimeout);

      if (!imgRes.ok) {
        console.log(`⚠️ [VISION] Не удалось скачать фото (${imgRes.status}), ищу другое`);
        return false;
      }

      const contentType = imgRes.headers.get('content-type') || '';
      if (contentType.includes('png')) mimeType = 'image/png';
      else if (contentType.includes('webp')) mimeType = 'image/webp';

      const arrayBuffer = await imgRes.arrayBuffer();
      imageBuffer = Buffer.from(arrayBuffer).toString('base64');
    } catch (downloadError) {
      clearTimeout(imgTimeout);
      console.log(`⚠️ [VISION] Ошибка скачивания фото: ${downloadError.message}, ищу другое`);
      return false;
    }

    // Шаг 2: Отправляем в Gemini Vision
    const model = GEMINI_MODEL;
    const modelUrl = `${GEMINI_BASE_URL}/${model}:generateContent?key=${GEMINI_API_KEY}`;

    const prompt = `На этом фото изображена птица "${birdName}"?
Ответь ТОЛЬКО одним словом: YES если это действительно птица "${birdName}" (или очень похожий вид), NO если это другая птица, человек, рисунок или неразборчивое изображение.
Не добавляй никаких объяснений, только YES или NO.`;

    const payload = {
      contents: [{
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: mimeType,
              data: imageBuffer
            }
          }
        ]
      }],
      generationConfig: {
        temperature: 0.0,
        maxOutputTokens: 10,
        topP: 0.1
      }
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(modelUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.log(`⚠️ [VISION] Gemini Vision вернул ошибку (${res.status}): ${errText.substring(0, 100)}, доверяю фото`);
      return true;
    }

    const data = await res.json();
    const answer = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim().toUpperCase();

    if (answer.startsWith('YES')) {
      console.log(`✅ [VISION] Gemini подтвердил фото для "${birdName}"`);
      return true;
    } else if (answer.startsWith('NO')) {
      console.log(`❌ [VISION] Gemini отверг фото для "${birdName}" (ответ: ${answer})`);
      return false;
    } else {
      // Неожиданный или пустой ответ — не рискуем
      console.log(`⚠️ [VISION] Неожиданный ответ Gemini: "${answer}", ищу другое фото`);
      return false;
    }

  } catch (error) {
    // При любой ошибке (таймаут, сеть) — ищем другое фото
    console.log(`⚠️ [VISION] Ошибка верификации: ${error.message}, ищу другое фото`);
    return false;
  }
}

async function findBirdImage(birdName) {
  console.log(`🔍 ПОИСК ФОТО ДЛЯ: "${birdName}"`);

  // ПРИОРИТЕТ 0: Фото от пользователей (одобренные)
  try {
    const { getApprovedPhotoForBird, markPhotoAsUsed } = supabase;
    const userPhoto = await getApprovedPhotoForBird(birdName);
    if (userPhoto && userPhoto.photo_file_id) {
      console.log(`📸 Использую фото от пользователя @${userPhoto.username} для "${birdName}"`);

      // Получаем URL фото через Telegram API
      const photoUrl = await getFileUrl(userPhoto.photo_file_id);
      if (photoUrl) {
        // Отмечаем фото как использованное
        await markPhotoAsUsed(userPhoto.id);
        console.log(`✅ Фото пользователя использовано: ID ${userPhoto.id}`);
        return photoUrl;
      }
    }
  } catch (error) {
    console.log(`⚠️ Ошибка получения фото пользователя: ${error.message}`);
  }

  // 1. КЭШ
  try {
    const cachedImage = await getCachedBirdImage(birdName);
    if (cachedImage) {
      console.log(`✅ Использую кешированное фото для "${birdName}"`);
      return cachedImage;
    }
  } catch (error) {
    console.log(`⚠️ Ошибка кеша: ${error.message}`);
  }

  // 2. ОСНОВНОЙ ПОИСК
  try {
    // ПРИОРИТЕТ 1: Прямой поиск в Википедии
    console.log(`📚 Прямой поиск в Википедии`);
    let imageUrl = await getBirdWikiImage(birdName);

    if (imageUrl && isValidImageUrl(imageUrl)) {
      console.log(`✅ Нашел фото в Википедии`);
      // Верифицируем через Gemini Vision
      const isVerified = await verifyBirdPhotoWithGemini(imageUrl, birdName);
      if (isVerified) {
        await cacheBirdImage(birdName, imageUrl, 'wikipedia');
        return imageUrl;
      }
      console.log(`⚠️ Фото из Википедии не прошло верификацию, ищу другое`);
      imageUrl = null;
    }

    // ПРИОРИТЕТ 2: Если название с дефисом, пробуем варианты
    if (birdName.includes('-')) {
      console.log(`➖ Пробую варианты для названия с дефисом`);

      // Вариант 1: Без дефиса
      const noHyphen = birdName.replace('-', ' ');
      imageUrl = await getBirdWikiImage(noHyphen);
      if (imageUrl && isValidImageUrl(imageUrl)) {
        const isVerified = await verifyBirdPhotoWithGemini(imageUrl, birdName);
        if (isVerified) {
          console.log(`✅ Нашел фото без дефиса`);
          await cacheBirdImage(birdName, imageUrl, 'no_hyphen');
          return imageUrl;
        }
      }

      // Вариант 2: Только первое слово
      const firstWord = birdName.split('-')[0].trim();
      if (firstWord && firstWord.length > 2) {
        imageUrl = await getBirdWikiImage(firstWord);
        if (imageUrl && isValidImageUrl(imageUrl)) {
          const isVerified = await verifyBirdPhotoWithGemini(imageUrl, birdName);
          if (isVerified) {
            console.log(`✅ Нашел фото по первому слову`);
            await cacheBirdImage(birdName, imageUrl, 'first_word');
            return imageUrl;
          }
        }
      }
    }

    // ПРИОРИТЕТ 3: Поиск через семейство
    console.log(`👨‍👩‍👧‍👦 Ищу через семейство`);
    const familyImage = await searchPhotoThroughFamily(birdName);
    if (familyImage && isValidImageUrl(familyImage)) {
      console.log(`✅ Нашел фото через семейство`);
      await cacheBirdImage(birdName, familyImage, 'family');
      return familyImage; // семейство не верифицируем — это заведомо другая птица
    }

    // ПРИОРИТЕТ 4: Поиск похожих птиц
    console.log(`🔄 Ищу похожие птицы`);
    const similarBirds = findSimilarBirds(birdName);
    for (const similarBird of similarBirds.slice(0, 3)) {
      try {
        imageUrl = await getBirdWikiImage(similarBird);
        if (imageUrl && isValidImageUrl(imageUrl)) {
          console.log(`✅ Нашел фото похожей птицы: ${similarBird}`);
          await cacheBirdImage(birdName, imageUrl, 'similar');
          return imageUrl; // для похожих птиц не верифицируем
        }
      } catch (error) {
        continue;
      }
    }

    // ПРИОРИТЕТ 5: Wikimedia Commons
    console.log(`🌐 Ищу в Wikimedia Commons`);
    const commonsImage = await searchWikimediaCommons(birdName);
    if (commonsImage && isValidImageUrl(commonsImage)) {
      console.log(`✅ Нашел фото в Commons`);
      const isVerified = await verifyBirdPhotoWithGemini(commonsImage, birdName);
      if (isVerified) {
        await cacheBirdImage(birdName, commonsImage, 'commons');
        return commonsImage;
      }
      console.log(`⚠️ Фото из Commons не прошло верификацию`);
    }

    // ПРИОРИТЕТ 6: Дефолтное фото
    console.log(`🎯 Использую умное дефолтное фото`);
    const defaultImage = getSmartDefaultImage(birdName);

    if (defaultImage) {
      await cacheBirdImage(birdName, defaultImage, 'default');
      return defaultImage;
    }

    console.log(`⚠️ Дефолтное фото не определено, будет отправлен текстовый пост`);
    return null;

  } catch (error) {
    console.error(`❌ Ошибка поиска фото: ${error.message}`);

    // Аварийное фото - возвращаем null для текстового поста
    return null;
  }
}

/**
 * НОВЫЙ УЛУЧШЕННЫЙ ПОИСК (imageSearch.js)
 */
async function improvedImageSearch(birdName) {
  try {
    console.log(`🚀 Запускаю новый улучшенный поиск...`);

    // Импортируем динамически
    const imageSearchModule = await import('./imageSearch.js');

    const imageUrl = await imageSearchModule.findBirdImage(birdName, {
      useCache: false, // Мы уже проверили кэш
      timeout: 15000,
      maxAttempts: 3
    });

    return imageUrl;

  } catch (error) {
    console.log(`⚠️ Новый поиск не сработал: ${error.message}`);
    return null;
  }
}

/**
 * УЛУЧШЕННЫЙ СТАРЫЙ ПОДХОД
 */
async function legacyImageSearch(birdName) {
  try {
    console.log(`🔧 Запускаю улучшенный старый поиск...`);

    // УЛУЧШЕНИЕ 1: Предварительная проверка наличия птицы в Википедии
    const hasWikiPage = await checkWikipediaPageExists(birdName);
    if (!hasWikiPage) {
      console.log(`⚠️ У птицы "${birdName}" нет страницы в Википедии, пробую альтернативы`);
    }

    // УЛУЧШЕНИЕ 2: Расширенный список вариантов поиска
    const searchVariants = await generateEnhancedSearchVariants(birdName);

    console.log(`🔍 Улучшенные поисковые варианты (${searchVariants.length}):`);
    searchVariants.forEach((v, i) => console.log(`   ${i + 1}. "${v}"`));

    // УЛУЧШЕНИЕ 3: Параллельный поиск по всем вариантам с ограничением времени
    const searchPromises = searchVariants.map(variant =>
      searchImageForVariantWithTimeout(variant, 3000)
    );

    const variantResults = await Promise.allSettled(searchPromises);

    // Ищем первый успешный результат
    for (let i = 0; i < variantResults.length; i++) {
      const result = variantResults[i];
      if (result.status === 'fulfilled' && result.value) {
        console.log(`✅ Нашел фото для варианта "${searchVariants[i]}"`);
        return result.value;
      }
    }

    // УЛУЧШЕНИЕ 4: Улучшенный поиск в Wikimedia Commons
    console.log(`🔄 Пробую улучшенный поиск в Wikimedia Commons`);
    const wikimediaImage = await searchWikimediaCommonsEnhanced(birdName);
    if (wikimediaImage) {
      console.log(`✅ Wikimedia Commons нашел фото`);
      return wikimediaImage;
    }

    // УЛУЧШЕНИЕ 5: Умный поиск через Gemini с контекстом
    console.log(`🤖 Запрашиваю у Gemini поиск фото для: "${birdName}"`);
    const geminiImage = await searchBirdImageWithGeminiEnhanced(birdName, searchVariants);
    if (geminiImage) {
      console.log(`✅ Gemini нашел фото`);
      return geminiImage;
    }

    // УЛУЧШЕНИЕ 6: Расширенный поиск похожих птиц
    console.log(`🔄 Ищу фото похожих птиц для: "${birdName}"`);
    const similarBirds = findEnhancedSimilarBirds(birdName);

    for (const similarBird of similarBirds.slice(0, 5)) {
      console.log(`   🔍 Похожая птица: "${similarBird}"`);
      try {
        const similarImage = await searchImageForVariantWithTimeout(similarBird, 2000);
        if (similarImage && validateBirdPhoto(similarImage, birdName)) {
          console.log(`   ✅ Нашел фото похожей птицы: ${similarBird}`);
          return similarImage;
        }
      } catch (error) {
        continue;
      }
    }

    // УЛУЧШЕНИЕ 7: Категоризированные дефолтные фото
    console.log(`❌ Фото не найдено, использую улучшенное дефолтное фото`);
    return getEnhancedDefaultBirdImage(birdName);

  } catch (error) {
    console.error(`❌ Ошибка в старом поиске: ${error.message}`);
    return getDefaultBirdImage(birdName);
  }
}

/**
 * ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ УЛУЧШЕННОГО ПОИСКА
 */

// Проверка существования страницы в Википедии
async function checkWikipediaPageExists(birdName) {
  try {
    const encodedName = encodeURIComponent(birdName);
    const url = `https://ru.wikipedia.org/w/api.php?action=query&titles=${encodedName}&format=json`;

    const response = await fetch(url);
    const data = await response.json();
    const pages = data.query.pages;
    const pageId = Object.keys(pages)[0];

    return pageId !== "-1";
  } catch (error) {
    return false;
  }
}

/**
 * Генерация расширенных вариантов поиска
 */
async function generateEnhancedSearchVariants(birdName) {
  const variants = new Set();

  // 1. Оригинальное название
  variants.add(birdName);

  // 2. Без общих прилагательных
  const cleanedName = birdName.replace(/^(Обыкновенный|Большой|Малый|Серый|Чёрный|Белый|Рыжий|Пёстрый)\s+/i, '');
  if (cleanedName !== birdName) {
    variants.add(cleanedName);
    variants.add(`${cleanedName} (птица)`);
  }

  // 3. Латинское название
  const latinName = getLatinNameForBird(birdName);
  if (latinName) {
    variants.add(latinName);
    variants.add(`${latinName} bird`);
  }

  // 4. Английское название
  const englishName = getEnglishNameForBird(birdName);
  if (englishName) {
    variants.add(englishName);
    variants.add(`${englishName} bird`);
  }

  // 5. Альтернативные формулировки
  if (birdName.includes('-')) {
    variants.add(birdName.replace('-', ' '));
  }

  if (birdName.includes('ий') && birdName.endsWith('ий')) {
    variants.add(birdName.replace('ий', 'ая'));
  }

  // 6. Добавляем "птица" в конец если короткое название
  if (birdName.split(' ').length === 1 && birdName.length < 15) {
    variants.add(`${birdName} птица`);
  }

  return Array.from(variants).filter(v => v && v.length > 2);
}

/**
 * Поиск с таймаутом
 */
async function searchImageForVariantWithTimeout(variant, timeout) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const imageUrl = await searchImageForVariant(variant);
    clearTimeout(timeoutId);
    return imageUrl;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Улучшенный поиск в Wikimedia Commons
 */
async function searchWikimediaCommonsEnhanced(birdName) {
  try {
    // Поиск по нескольким категориям
    const categories = [
      encodeURIComponent(birdName),
      encodeURIComponent(getLatinNameForBird(birdName) || birdName),
      encodeURIComponent(`Bird ${birdName}`),
      encodeURIComponent(`Птица ${birdName}`)
    ];

    for (const category of categories) {
      if (!category) continue;

      const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${category}&gsrnamespace=6&gsrlimit=5&prop=imageinfo&iiprop=url&iiurlwidth=1024&format=json`;

      try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.query && data.query.pages) {
          const pages = Object.values(data.query.pages);
          for (const page of pages) {
            if (page.imageinfo && page.imageinfo[0] && page.imageinfo[0].url) {
              const imageUrl = page.imageinfo[0].url;
              if (validateBirdPhoto(imageUrl, birdName)) {
                return imageUrl;
              }
            }
          }
        }
      } catch (error) {
        continue;
      }

      await delay(300);
    }

    return null;
  } catch (error) {
    console.log(`⚠️ Wikimedia Commons enhanced error: ${error.message}`);
    return null;
  }
}

/**
 * Улучшенный поиск через Gemini
 */
async function searchBirdImageWithGeminiEnhanced(birdName, searchVariants) {
  try {
    const variantsText = searchVariants.slice(0, 5).join(', ');

    const prompt = `
Найди ПРЯМУЮ ссылку на качественную фотографию птицы.
Птица может быть известна под разными названиями: ${variantsText}

ВАЖНЫЕ ТРЕБОВАНИЯ:
1. Ссылка должна быть НАПРЯМУЮ на изображение (.jpg, .jpeg, .png)
2. Изображение должно быть с сайта upload.wikimedia.org или других надежных источников
3. Фотография должна быть реальной, а не рисунком
4. Птица должна быть хорошо видна
5. Разрешение минимум 800x600 пикселей
6. Предпочтительно фото в естественной среде обитания

Если не найдешь точное фото - найди фото похожей птицы из того же семейства.
Если совсем не найдешь - верни "NO_PHOTO".

Ссылка должна начинаться с https:// и заканчиваться расширением изображения.
`;

    // Используем существующую функцию searchBirdImageWithGemini, но с улучшенным промптом
    // Передаем наш улучшенный промпт как параметр
    const geminiImage = await searchBirdImageWithGemini(birdName, prompt);

    if (geminiImage && geminiImage !== 'NO_PHOTO' && geminiImage.startsWith('https://')) {
      // Дополнительная валидация
      if (validateBirdPhoto(geminiImage, birdName)) {
        return geminiImage;
      }
    }

    return null;
  } catch (error) {
    console.log(`⚠️ Gemini enhanced error: ${error.message}`);
    return null;
  }
}

/**
 * Расширенный поиск похожих птиц
 */
function findEnhancedSimilarBirds(birdName) {
  const lowerName = birdName.toLowerCase();
  const similarBirds = [];

  // Словарь похожих птиц (расширенный)
  const similarityMap = {
    "гоголь": ["гоголь обыкновенный", "нырок", "утка нырковая"],
    "кобчик": ["сокол", "чеглок", "дербник", "пустельга", "сокол кобчик"],
    "поганка": ["чомга", "поганка большая", "поганка малая", "поганка красношейная"],
    "мухоловка": ["мухоловка-пеструшка", "серая мухоловка", "малая мухоловка", "мухоловка"],
    "пеночка": ["пеночка-теньковка", "пеночка-весничка", "пеночка-трещотка", "пеночка"],
    "овсянка": ["овсянка обыкновенная", "овсянка садовая", "овсянка камышовая", "овсянка"],
    "славка": ["славка серая", "славка садовая", "славка черноголовая", "славка"],
    "зяблик": ["зяблик обыкновенный", "вьюрок", "юрок"],
    "скворец": ["скворец обыкновенный", "майна", "розовый скворец"],
    "синица": ["большая синица", "лазоревка", "московка", "пухляк", "гаичка"],
    "воробей": ["полевой воробей", "домовый воробей", "каменный воробей"],
    "голубь": ["сизый голубь", "вяхирь", "клинтух", "горлица"],
    "утка": ["кряква", "чирок", "свиязь", "шилохвость", "нырок"]
  };

  // Проверяем по ключевым словам
  for (const [keyword, similar] of Object.entries(similarityMap)) {
    if (lowerName.includes(keyword)) {
      similarBirds.push(...similar);
    }
  }

  // Добавляем общие категории
  if (lowerName.includes('кулик')) similarBirds.push('кулик-сорока', 'фифи', 'черныш');
  if (lowerName.includes('сова')) similarBirds.push('неясыть', 'сыч', 'сипуха');
  if (lowerName.includes('дятел')) similarBirds.push('желна', 'вертишейка');
  if (lowerName.includes('ворон')) similarBirds.push('грач', 'галка', 'сойка');
  if (lowerName.includes('чайк')) similarBirds.push('крачка', 'поморник');

  // Убираем дубликаты и саму птицу
  return [...new Set(similarBirds.filter(bird =>
    bird.toLowerCase() !== lowerName
  ))];
}

/**
 * Улучшенные дефолтные фото
 */
function getEnhancedDefaultBirdImage(birdName) {
  const lowerName = birdName.toLowerCase();

  // Расширенная база дефолтных фото
  const defaultImages = {
    "синица": "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7e/Parus_major_-Hampshire%2C_England-8.jpg/1024px-Parus_major_-Hampshire%2C_England-8.jpg",
    "воробей": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9b/Passer_montanus_1_%28Marek_Szczepanek%29.jpg/1024px-Passer_montanus_1_%28Marek_Szczepanek%29.jpg",
    "голубь": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Columba_livia_%28Warszawa%29.jpg/1024px-Columba_livia_%28Warszawa%29.jpg",
    "утка": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/59/Anas_platyrhynchos_male_female_quadrat.jpg/1024px-Anas_platyrhynchos_male_female_quadrat.jpg",
    "дрозд": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/Song_Thrush_Turdus_philomelos.jpg/1024px-Song_Thrush_Turdus_philomelos.jpg",
    "сова": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/Bubo_bubo_Wrocław_ZOO_1.jpg/1024px-Bubo_bubo_Wrocław_ZOO_1.jpg",
    "дятел": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6e/Dendrocopos_major_2_%28Marek_Szczepanek%29.jpg/1024px-Dendrocopos_major_2_%28Marek_Szczepanek%29.jpg",
    "снегирь": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/95/Pyrrhula_pyrrhula_-Hokkaido%2C_Japan-8.jpg/1024px-Pyrrhula_pyrrhula_-Hokkaido%2C_Japan-8.jpg",
    "скворец": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8c/Common_Starling_%28Sturnus_vulgaris%29.jpg/1024px-Common_Starling_%28Sturnus_vulgaris%29.jpg",
    "сорока": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5b/Pica_pica_-near_Killary_Harbour%2C_Connemara%2C_Ireland-8.jpg/1024px-Pica_pica_-near_Killary_Harbour%2C_Connemara%2C_Ireland-8.jpg",
    "чайка": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/Black-headed_Gull_%28Larus_ridibundus%29_in_Tateyama%2C_Japan.jpg/1024px-Black-headed_Gull_%28Larus_ridibundus%29_in_Tateyama%2C_Japan.jpg",
    "сокол": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6a/Falco_peregrinus_good_-_Christopher_Watson.jpg/1024px-Falco_peregrinus_good_-_Christopher_Watson.jpg",
    "орёл": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/43/Golden_Eagle_in_flight_-_5.jpg/1024px-Golden_Eagle_in_flight_-_5.jpg",
    "лебедь": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6e/Mute_Swan_%28Cygnus_olor%29_%288625124890%29.jpg/1024px-Mute_Swan_%28Cygnus_olor%29_%288625124890%29.jpg",
    "журавль": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/Common_crane_%28Grus_grus%29_2.jpg/1024px-Common_crane_%28Grus_grus%29_2.jpg"
  };

  // Ищем по ключевым словам
  for (const [keyword, imageUrl] of Object.entries(defaultImages)) {
    if (lowerName.includes(keyword)) {
      return imageUrl;
    }
  }

  // Используем существующую функцию getDefaultBirdImage
  return getDefaultBirdImage(birdName);
}

/**
 * Проверка доступности фото для птицы (простая версия)
 */
async function checkBirdPhotoAvailability(birdName) {
  try {
    // Используем существующую функцию поиска фото
    const imageUrl = await getBirdWikiImage(birdName);
    return !!(imageUrl && isRealPhoto(imageUrl));
  } catch (error) {
    return false;
  }
}

/**
 * Получение семейства птицы
 */
function getBirdFamily(birdName) {
  const familyMap = {
    'тетерев': 'тетеревиные',
    'глухарь': 'тетеревиные',
    'рябчик': 'тетеревиные',
    'куропатка': 'тетеревиные',
    'фазан': 'фазановые',
    'перепел': 'фазановые',
    'альбатрос': 'альбатросовые',
    'буревестник': 'буревестниковые',
    'тайфунник': 'буревестниковые',
    'цапля': 'цаплевые',
    'ибис': 'ибиcовые',
    'каравайка': 'ибиcовые',
    'колпица': 'ибиcовые',
    'утка': 'утковые',
    'лебедь': 'утковые',
    'гусь': 'утковые',
    'гагара': 'гагаровые',
    'поганка': 'поганковые',
    'чайка': 'чайковые',
    'крачка': 'чайковые',
    'сокол': 'соколиные',
    'орёл': 'ястребиные',
    'ястреб': 'ястребиные',
    'коршун': 'ястребиные',
    'сова': 'совиные',
    'сыч': 'совиные',
    'филин': 'совиные',
    'дятел': 'дятловые',
    'воробей': 'воробьиные',
    'синица': 'синицевые',
    'ворона': 'врановые',
    'сорока': 'врановые',
    'галка': 'врановые',
    'грач': 'врановые',
    'скворец': 'скворцовые',
    'дрозд': 'дроздовые',
    'соловей': 'мухоловковые',
    'мухоловка': 'мухоловковые',
    'жаворонок': 'жаворонковые',
    'ласточка': 'ласточковые',
    'стриж': 'стрижиные',
    'зимородок': 'зимородковые',
    'удод': 'удодовые',
    'кукушка': 'кукушковые'
  };

  const lowerName = birdName.toLowerCase();
  for (const [keyword, family] of Object.entries(familyMap)) {
    if (lowerName.includes(keyword)) {
      return family;
    }
  }

  return null;
}

function validateBirdPhoto(imageUrl, birdName) {
  if (!imageUrl) return false;

  const lowerUrl = imageUrl.toLowerCase();
  const lowerBirdName = birdName.toLowerCase();

  // Список неправильных соответствий
  const wrongMatches = {
    'поганка': ['cormorant', 'баклан', 'цапля', 'heron'],
    'поганка большая': ['cormorant', 'баклан'],
    'сыч': ['eagle', 'орёл', 'hawk', 'ястреб'],
    'сипуха': ['owl', 'сова обыкновенная'],
    'кобчик': ['falcon', 'сокол обыкновенный'],
    'сорокопут': ['shrike', 'жулан']
  };

  // Проверяем на неправильные соответствия
  for (const [birdType, wrongKeywords] of Object.entries(wrongMatches)) {
    if (lowerBirdName.includes(birdType)) {
      for (const wrongKeyword of wrongKeywords) {
        if (lowerUrl.includes(wrongKeyword)) {
          console.log(`❌ Найдено неправильное фото: ${wrongKeyword} вместо ${birdType}`);
          return false;
        }
      }
    }
  }

  return true;
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

  // Если не нашли, возвращаем null, чтобы бот переключился в текстовый режим
  // Мы больше не используем захардкоженный URL European Robin, так как он часто ломается
  return null;
}

function generateSmartFallbackDescription(birdName) {
  const lowerName = birdName.toLowerCase();

  // Расширенная информация о семействах и отрядах
  const familyInfo = {
    'синиц': { order: 'воробьинообразных', family: 'синицевых', habitat: 'лесах и парках', trait: 'активная и подвижная птица с характерным ярким оперением' },
    'воробь': { order: 'воробьинообразных', family: 'воробьиных', habitat: 'антропогенных ландшафтах', trait: 'широко распространённая небольшая птица' },
    'дятел': { order: 'дятлообразных', family: 'дятловых', habitat: 'лесных массивах', trait: 'специализированная птица, приспособленная к добыванию пищи из-под коры деревьев' },
    'утк': { order: 'гусеобразных', family: 'утиных', habitat: 'разнообразных водоёмах', trait: 'водоплавающая птица с характерным широким клювом' },
    'гус': { order: 'гусеобразных', family: 'утиных', habitat: 'лугах и водоёмах', trait: 'крупная водоплавающая птица с мощным клювом' },
    'лебед': { order: 'гусеобразных', family: 'утиных', habitat: 'крупных водоёмах', trait: 'грациозная и крупная водоплавающая птица' },
    'чайк': { order: 'ржанкообразных', family: 'чайковых', habitat: 'морских и внутренних водоёмах', trait: 'околоводная птица, отличающаяся мастерством полёта' },
    'сов': { order: 'совообразных', family: 'совиных', habitat: 'лесах и открытых пространствах', trait: 'ночная хищная птица с бесшумным полётом и отличным слухом' },
    'сыч': { order: 'совообразных', family: 'совиных', habitat: 'лесах и парках', trait: 'небольшая хищная птица с компактным телосложением' },
    'сокол': { order: 'соколообразных', family: 'соколиных', habitat: 'открытых пространствах', trait: 'стремительная хищная птица, известная своими скоростными качествами' },
    'ястреб': { order: 'ястребообразных', family: 'ястребиных', habitat: 'лесных массивах', trait: 'маневренная хищная птица, охотящаяся в густых зарослях' },
    'орёл': { order: 'ястребообразных', family: 'ястребиных', habitat: 'горах, лесах и степях', trait: 'величественная крупная хищная птица' },
    'ворон': { order: 'воробьинообразных', family: 'врановых', habitat: 'самых разнообразных биотопах', trait: 'интеллектуальная и высокоадаптивная птица' },
    'сорок': { order: 'воробьинообразных', family: 'врановых', habitat: 'лесах, садах и парках', trait: 'заметная птица с контрастным оперением и длинным ступенчатым хвостом' },
    'галк': { order: 'воробьинообразных', family: 'врановых', habitat: 'населённых пунктах и скалах', trait: 'небольшая общественная птица с серым оперением на шее' },
    'стриж': { order: 'стрижеобразных', family: 'стрижиных', habitat: 'воздушном пространстве', trait: 'превосходный летун, проводящий большую часть жизни в воздухе' },
    'ласточк': { order: 'воробьинообразных', family: 'ласточковых', habitat: 'открытых пространствах', trait: 'изящная перелётная птица с длинными узкими крыльями' },
    'скворец': { order: 'воробьинообразных', family: 'скворцовых', habitat: 'редколесьях и населённых пунктах', trait: 'талантливая певчая птица с блестящим оперением' },
    'дрозд': { order: 'воробьинообразных', family: 'дроздовых', habitat: 'лесах, садах и городских парках', trait: 'активная певчая птица с мелодичным голосом' },
    'соловь': { order: 'воробьинообразных', family: 'мухоловковых', habitat: 'густых прибрежных зарослях', trait: 'выдающийся певец, отличающийся скромным внешним видом' },
    'снегир': { order: 'воробьинообразных', family: 'вьюрковых', habitat: 'хвойных и смешанных лесах', trait: 'птица с характерным ярким обликом, особенно заметная зимой' },
    'щегол': { order: 'воробьинообразных', family: 'вьюрковых', habitat: 'опушках, садах и перелесках', trait: 'очень красочная и подвижная вьюрковая птица' },
    'зябл': { order: 'воробьинообразных', family: 'вьюрковых', habitat: 'разнообразных лесах и парках', trait: 'одна из самых массовых и красивых лесных птиц' },
    'кулик': { order: 'ржанкообразных', family: 'куликовых', habitat: 'берегах водоёмов и болотах', trait: 'околоводная птица с длинными ногами и клювом' },
    'цапл': { order: 'аистообразных', family: 'цаплевых', habitat: 'мелководьях водоёмов и болотах', trait: 'крупная птица, приспособленная к охоте в воде' },
    'журавл': { order: 'журавлеобразных', family: 'журавлиных', habitat: 'обширных болотах и лугах', trait: 'величественная крупная птица с длинными шеей и ногами' },
    'голуб': { order: 'голубеобразных', family: 'голубиных', habitat: 'городах, скалах и лесах', trait: 'хорошо известная птица, встречающаяся практически повсеместно' },
    'поганк': { order: 'поганкообразных', family: 'поганковых', habitat: 'стоячих и слабопроточных водоёмах', trait: 'превосходный ныряльщик, проводящий почти всё время на воде' },
    'гагар': { order: 'гагарообразных', family: 'гагаровых', habitat: 'крупных северных озёрах', trait: 'древняя водоплавающая птица с мощным обтекаемым телом' },
    'буревестник': { order: 'буревестникообразных', family: 'буревестниковых', habitat: 'открытом океане', trait: 'настоящая морская птица, способная подолгу парить над волнами' },
    'крачк': { order: 'ржанкообразных', family: 'чайковых', habitat: 'морских побережьях и пресных водах', trait: 'изящная околоводная птица с вильчатым хвостом' }
  };

  // Ищем совпадение по ключевым словам
  let info = null;
  for (const [keyword, data] of Object.entries(familyInfo)) {
    if (lowerName.includes(keyword)) {
      info = data;
      break;
    }
  }

  // Определяем размер по ключевым словам
  let sizePrefix = '';
  if (lowerName.includes('больш')) {
    sizePrefix = 'крупная ';
  } else if (lowerName.includes('мал') || lowerName.includes('малень')) {
    sizePrefix = 'небольшая ';
  } else if (lowerName.includes('средн')) {
    sizePrefix = 'средних размеров ';
  }

  // Определяем цветовые особенности
  let colorInfo = '';
  if (lowerName.includes('чёрн') || lowerName.includes('черн')) {
    colorInfo = ' с преобладанием тёмных тонов в оперении';
  } else if (lowerName.includes('бел')) {
    colorInfo = ' с белоснежным оперением';
  } else if (lowerName.includes('сер')) {
    colorInfo = ' с сероватым окрасом';
  } else if (lowerName.includes('рыж') || lowerName.includes('красн')) {
    colorInfo = ' с яркими деталями в окраске';
  } else if (lowerName.includes('пёстр') || lowerName.includes('пестр')) {
    colorInfo = ' с пёстрым, камуфлирующим рисунком';
  }

  // Генерируем описание
  if (info) {
    const templates = [
      `${birdName} — ${sizePrefix}${info.trait} из отряда ${info.order}, семейства ${info.family}${colorInfo}.`,
      `${birdName} — представитель семейства ${info.family}, обитающий преимущественно в ${info.habitat}. Характеризуется как ${info.trait}${colorInfo}.`,
      `${birdName} относится к семейству ${info.family}. Это ${sizePrefix}${info.trait}${colorInfo}, типичная для своего биотопа.`
    ];

    // Выбираем случайный шаблон
    return templates[Math.floor(Math.random() * templates.length)];
  }

  // Если не нашли семейство, используем более солидное общее описание
  const genericTemplates = [
    `${birdName} — ${sizePrefix}птица, широко встречающаяся на территории России. Относится к представителям местной орнитофауны${colorInfo}.`,
    `${birdName} — ${sizePrefix}характерный представитель фауны северных широт, обладающий рядом уникальных адаптаций к среде обитания${colorInfo}.`,
    `${birdName} — ${sizePrefix}вид птиц, играющий важную роль в экосистемах своего ареала обитания${colorInfo}.`
  ];

  return genericTemplates[Math.floor(Math.random() * genericTemplates.length)];
}

// ====== ГЕНЕРАЦИЯ ФАКТОВ ======

async function generateBirdFactsWithGeminiOnce(birdName, existingFacts = []) {
  try {
    let existingFactsText = '';
    if (existingFacts && existingFacts.length > 0) {
      // Передаем боту до 30 старых фактов для исключения дубликатов
      existingFactsText = `
ВАЖНО! ПРЕДЫДУЩИЕ ФАКТЫ О ПТИЦЕ:
Бот уже публиковал следующие факты об этой птице. НОВЫЕ ФАКТЫ НЕ ДОЛЖНЫ ПОВТОРЯТЬ ИХ:
${existingFacts.slice(-20).map(f => `- ${f}`).join('\n')}

УБЕДИСЬ, ЧТО ТВОИ НОВЫЕ ФАКТЫ ОТЛИЧАЮТСЯ И НЕ ДУБЛИРУЮТ ПРЕДЫДУЩИЕ.
`;
    }

    const prompt = `
Составь ровно 3 научно-популярных факта о птице "${birdName}" в деловом стиле.
${existingFactsText}
ТРЕБОВАНИЯ К ФАКТАМ:
- Факты должны относиться ТОЛЬКО к конкретному виду "${birdName}"
- Каждый факт — 15–30 слов
- ДЕЛОВОЙ, ИНФОРМАТИВНЫЙ стиль без эмоциональных слов
- ОБЯЗАТЕЛЬНО используй КОНКРЕТНЫЕ данные: размеры, цифры, измерения
- Без вступлений, нумераций, выводов — просто три строки фактов
- Избегай слов: "удивительно", "невероятно", "интересно", "замечательно"

ОБЯЗАТЕЛЬНО ВКЛЮЧАЙ:
✅ Конкретные числа и измерения (скорость, размер, вес, глубина, высота)
✅ Научные данные о поведении, питании, миграции
✅ Объективные характеристики внешности и биологии
✅ Географическое распространение и места обитания

ПРИМЕРЫ ПРАВИЛЬНОГО ДЕЛОВОГО СТИЛЯ:
✅ "Развивает скорость до 389 км/ч в пикирующем полёте, являясь самым быстрым живым существом на планете."
✅ "Запоминает расположение до 30 000 тайников с семенами и находит их под метровым слоем снега."
✅ "Летает задом наперёд благодаря уникальному строению плечевого сустава, совершая до 80 взмахов крыльев в секунду."
✅ "Строит гнёзда высотой до 2 метров и весом более 200 кг, используя до 1500 веток."
✅ "Ныряет на глубину до 60 метров и остаётся под водой до 3 минут при охоте на рыбу."

ПРИМЕРЫ НЕПРАВИЛЬНОГО СТИЛЯ (так писать НЕЛЬЗЯ):
❌ "Удивительно, но эта птица имеет уникальные особенности строения и поведения"
❌ "Невероятно интересная птица с особыми адаптациями к среде обитания"
❌ "Обладает замечательной способностью к специализированному питанию"
❌ "Питается насекомыми и семенами" (слишком общо, нет конкретики)

Теперь дай 3 факта о "${birdName}" в ДЕЛОВОм стиле с конкретными данными:
`;

    // Используем одну стабильную модель
    const model = GEMINI_MODEL;
    try {
      const modelUrl = `${GEMINI_BASE_URL}/${model}:generateContent?key=${GEMINI_API_KEY}`;

      const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: 500
        }
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const res = await fetchWithRetry(modelUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

        if (text) {
          const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
          const facts = lines
            .map(l => l.replace(/^[\d\.\)\-]+\s*/, '').trim())
            .filter(l => l.length >= 40 && l.length <= 300)
            .slice(0, 3);

          if (facts.length > 0) {
            console.log(`✅ Факты сгенерированы моделью ${model}`);
            return facts;
          }
        }
      }

      console.log(`⚠️ Модель ${model} не сработала для генерации фактов`);
      await delay(500);

    } catch (error) {
      console.log(`⚠️ Ошибка модели ${model} для фактов: ${error.message}`);
      await delay(500);
    }

    // Если основной Gemini не сработал, пробуем резервный API (если он настроен)
    if (ReserveAPI) {
      try {
        console.log(`🔁 Основной API не сработал, пробую ReserveAPI для фактов`);

        const payload = {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.6,
            maxOutputTokens: 500
          }
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000);

        const res = await fetchWithRetry(ReserveAPI, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

          if (text) {
            const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            const facts = lines
              .map(l => l.replace(/^[\d\.\)\-]+\s*/, '').trim())
              .filter(l => l.length >= 40 && l.length <= 300)
              .slice(0, 3);

            if (facts.length > 0) {
              console.log(`✅ Факты сгенерированы через ReserveAPI`);
              return facts;
            }
          }
        }

        console.log('⚠️ ReserveAPI не вернул корректных фактов');
      } catch (reserveError) {
        console.log(`⚠️ Ошибка ReserveAPI для фактов: ${reserveError.message}`);
      }
    }

    return null;

  } catch (err) {
    console.log('❌ Все модели не сработали для фактов:', err?.message);
    return null;
  } finally {
    console.log('✅ GenerateBirdFactsWithGeminiOnce завершен');
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
    `${birdName} обитает преимущественно в лесных зонах, предпочитая смешанные и лиственные леса.`,
    `Питается насекомыми, семенами и растительной пищей в зависимости от сезона.`,
    `Имеет характерную окраску оперения, помогающую маскироваться среди растительности.`
  ];
}

async function generateReliableFacts(birdName, options = {}) {
  const { requireGemini = false } = options;
  const defaultFacts = getQualityFacts(birdName);

  console.log(`🔍 Генерация фактов для "${birdName}"`);

  let existing = [];
  try {
    // Получаем существующие факты для использования как контекст от повторений
    const data = await getBirdFacts(birdName);
    if (data && Array.isArray(data)) {
      existing = data;
    }
  } catch (err) {
    console.log('⚠️ Ошибка проверки базы фактов:', err.message);
  }

  // Пробуем сгенерировать факты несколько раз
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`🔄 Попытка ${attempt}/${maxAttempts} для ${birdName}. Передано старых фактов: ${existing.length}`);

      // Передаем existing в генератор, чтобы избежать дубликатов
      const candidate = await generateBirdFactsWithGeminiOnce(birdName, existing);

      if (!candidate || candidate.length === 0) {
        console.log(`⚠️ Факты не сгенерированы в попытке ${attempt}`);
        if (attempt < maxAttempts) {
          await delay(1000);
          continue;
        }
      } else {
        // Проверка качества фактов
        const validFacts = candidate.filter(fact =>
          fact &&
          fact.length >= 30 &&
          fact.length <= 300 &&
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

        console.log(`⚠️ Недостаточно качественных фактов в попытке ${attempt}: ${validFacts.length}`);
        if (attempt < maxAttempts) {
          await delay(1000);
          continue;
        }
      }
    } catch (err) {
      console.log(`⚠️ Ошибка в попытке ${attempt}:`, err.message);
      if (attempt < maxAttempts) {
        await delay(1000);
        continue;
      }
    }
  }

  console.log('❌ Не удалось сгенерировать новые факты от Gemini');

  // Если строго требуем новые факты от Gemini — сообщаем об ошибке наверх,
  // чтобы можно было полностью отменить публикацию.
  if (requireGemini) {
    throw new Error('NO_GEMINI_FACTS');
  }

  // В обычном (нестрогом) режиме: не используем старые факты из базы как fallback,
  // чтобы не публиковать одни и те же факты повторно, а возвращаем дефолтные шаблонные факты.
  console.log('❌ Новые факты не получены, возвращаю дефолтные факты без переиспользования сохранённых');
  return defaultFacts;
}

/**
 * Генерирует умное fallback-описание на основе анализа названия птицы
 */
/*
function generateSmartFallbackDescription_OLD(birdName) {
  const lowerName = birdName.toLowerCase();

  // Определяем семейство по ключевым словам в названии
  const familyInfo = {
    'синиц': { family: 'синицевых', habitat: 'лесах и парках', trait: 'активная и подвижная' },
    'воробь': { family: 'воробьиных', habitat: 'городах и сёлах', trait: 'широко распространённая' },
    'дятел': { family: 'дятловых', habitat: 'лесных массивах', trait: 'лазающая по деревьям' },
    'утк': { family: 'утиных', habitat: 'водоёмах', trait: 'водоплавающая' },
    'гус': { family: 'утиных', habitat: 'водоёмах и болотах', trait: 'крупная водоплавающая' },
    'лебед': { family: 'утиных', habitat: 'озёрах и реках', trait: 'крупная водоплавающая' },
    'чайк': { family: 'чайковых', habitat: 'водоёмах', trait: 'морская и околоводная' },
    'сов': { family: 'совиных', habitat: 'лесах', trait: 'ночная хищная' },
    'сыч': { family: 'совиных', habitat: 'лесах и парках', trait: 'небольшая хищная' },
    'сокол': { family: 'соколиных', habitat: 'открытых пространствах', trait: 'быстрая хищная' },
    'ястреб': { family: 'ястребиных', habitat: 'лесах', trait: 'хищная' },
    'орёл': { family: 'ястребиных', habitat: 'горах и степях', trait: 'крупная хищная' },
    'ворон': { family: 'врановых', habitat: 'различных биотопах', trait: 'умная' },
    'сорок': { family: 'врановых', habitat: 'лесах и парках', trait: 'заметная' },
    'галк': { family: 'врановых', habitat: 'городах', trait: 'стайная' },
    'стриж': { family: 'стрижиных', habitat: 'воздухе', trait: 'быстрая летающая' },
    'ласточк': { family: 'ласточковых', habitat: 'открытых пространствах', trait: 'перелётная' },
    'скворец': { family: 'скворцовых', habitat: 'парках и садах', trait: 'певчая' },
    'дрозд': { family: 'дроздовых', habitat: 'лесах и парках', trait: 'певчая' },
    'соловь': { family: 'мухоловковых', habitat: 'зарослях', trait: 'известная своим пением' },
    'снегир': { family: 'вьюрковых', habitat: 'лесах', trait: 'яркая зимняя' },
    'щегол': { family: 'вьюрковых', habitat: 'опушках и садах', trait: 'красочная' },
    'зябл': { family: 'вьюрковых', habitat: 'лесах', trait: 'певчая' },
    'кулик': { family: 'куликов', habitat: 'берегах водоёмов', trait: 'околоводная' },
    'цапл': { family: 'цаплевых', habitat: 'болотах и водоёмах', trait: 'длинноногая' },
    'журавл': { family: 'журавлиных', habitat: 'болотах', trait: 'крупная' },
    'голуб': { family: 'голубиных', habitat: 'городах и лесах', trait: 'распространённая' },
    'поганк': { family: 'поганковых', habitat: 'водоёмах', trait: 'ныряющая' },
    'гагар': { family: 'гагаровых', habitat: 'северных водоёмах', trait: 'водоплавающая' },
    'буревестник': { family: 'буревестниковых', habitat: 'морях', trait: 'морская' },
    'крачк': { family: 'чайковых', habitat: 'водоёмах', trait: 'изящная' }
  };

  // Ищем совпадение по ключевым словам
  let info = null;
  for (const [keyword, data] of Object.entries(familyInfo)) {
    if (lowerName.includes(keyword)) {
      info = data;
      break;
    }
  }

  // Определяем размер по ключевым словам
  let sizePrefix = '';
  if (lowerName.includes('больш')) {
    sizePrefix = 'крупная ';
  } else if (lowerName.includes('мал') || lowerName.includes('малень')) {
    sizePrefix = 'небольшая ';
  } else if (lowerName.includes('средн')) {
    sizePrefix = 'средних размеров ';
  }

  // Определяем цветовые особенности
  let colorInfo = '';
  if (lowerName.includes('чёрн') || lowerName.includes('черн')) {
    colorInfo = ' с тёмным оперением';
  } else if (lowerName.includes('бел')) {
    colorInfo = ' со светлым оперением';
  } else if (lowerName.includes('сер')) {
    colorInfo = ' с серым оперением';
  } else if (lowerName.includes('рыж') || lowerName.includes('красн')) {
    colorInfo = ' с ярким оперением';
  } else if (lowerName.includes('пёстр') || lowerName.includes('пестр')) {
    colorInfo = ' с пёстрым оперением';
  }

  // Генерируем описание
  if (info) {
    const templates = [
      `${birdName} — ${sizePrefix}${info.trait} птица из семейства ${info.family}${colorInfo}.`,
      `${birdName} — птица из семейства ${info.family}, обитающая в ${info.habitat}${colorInfo}.`,
      `${birdName} относится к семейству ${info.family}. ${sizePrefix.charAt(0).toUpperCase() + sizePrefix.slice(1)}${info.trait} птица${colorInfo}.`
    ];

    // Выбираем случайный шаблон
    return templates[Math.floor(Math.random() * templates.length)];
  }

  // Если не нашли семейство, используем общее описание
  const genericTemplates = [
    `${birdName} — ${sizePrefix}птица, встречающаяся на территории России${colorInfo}.`,
    `${birdName} — интересная птица из нашей коллекции${colorInfo}.`,
    `${birdName} — ${sizePrefix}представитель российской орнитофауны${colorInfo}.`
  ];

  return genericTemplates[Math.floor(Math.random() * genericTemplates.length)];
}
*/

async function generateBirdDescription(birdName, facts) {
  try {
    const factsList = Array.isArray(facts) ? facts.join('\n- ') : 'Информация отсутствует';
    const prompt = `
Напиши профессиональное орнитологическое описание птицы "${birdName}".
ПИШИ СТРОГО ПО СТИЛЮ И СТРУКТУРЕ ПРИМЕРА В КОНЦЕ ИНСТРУКЦИИ.

ИСПОЛЬЗУЙ СЛЕДУЮЩИЕ ФАКТЫ ТОЛЬКО ДЛЯ СПРАВКИ (НЕ ПОВТОРЯЙ ЦИФРЫ В ТЕКСТЕ):
- ${factsList}

СТРУКТУРА (РОВНО 2 ПРЕДЛОЖЕНИЯ):
1. Первая строка: Название (Latin) — вид птиц из отряда соответствующего отряда, семейства соответствующего семейства.
2. Вторая строка: Опиши ключевую визуальную особенность и принадлежность к роду/группе.

ВАЖНЫЕ ТРЕБОВАНИЯ:
1. КАТЕГОРИЧЕСКИ БЕЗ ЦИФР (вес, размер, числа) — они уже есть в фактах.
2. Тон: Профессиональный, энциклопедический.
3. Обязательно расставь ударения ( ́ ) во всех сложных и ключевых словах.
4. Объем: около 200-250 символов.

ПРИМЕР (ИДЕАЛЬНЫЙ ФОРМАТ):
Китайская зелену́шка (Chloropsar chloris) — вид птиц из отряда воробьинообра́зных, семейства вьюрковых. Характеризуется ярким зелёным оперением и относится к роду зелену́шек.
`;

    // Используем одну стабильную модель
    const model = GEMINI_MODEL;
    try {
      const modelUrl = `${GEMINI_BASE_URL}/${model}:generateContent?key=${GEMINI_API_KEY}`;

      const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2, // Уменьшаем для большей точности
          maxOutputTokens: 300, // Возвращаем комфортный лимит для классического стиля
          topP: 0.8
        }
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const res = await fetch(modelUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        let description = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

        description = description
          .trim()
          .replace(/^["']|["']$/g, '')
          .replace(/\.{2,}/g, '.')
          .replace(/\s+/g, ' ')
          .replace(/[""]/g, '"');

        // --- УЛУЧШЕННАЯ ВАЛИДАЦИЯ ОПИСАНИЯ ---
        const isValidDescription = description &&
          description.length > 20 && // Достаточная длина
          /[.!?]$/.test(description) && // Заканчивается пунктуацией
          !description.toLowerCase().includes('не могу') && // Не содержит ошибок генерации
          !description.toLowerCase().includes('не знаю');

        if (isValidDescription) {
          console.log(`✅ Описание сгенерировано моделью ${model}: "${description.substring(0, 80)}..."`);
          return description;
        }
      }

      console.log(`⚠️ Модель ${model} не сработала для описания`);

    } catch (modelError) {
      if (modelError.name === 'AbortError') {
        console.log(`⏰ Модель ${model} превысила таймаут для описания`);
      } else {
        console.log(`⚠️ Ошибка модели ${model} для описания: ${modelError.message}`);
      }
    }

    // Fallback: генерируем умное описание на основе названия
    console.log(`📝 Модель не сработала, генерирую умное описание для: ${birdName}`);
    return generateSmartFallbackDescription(birdName);

  } catch (error) {
    console.log(`❌ Ошибка генерации описания: ${error.message}`);
    return generateSmartFallbackDescription(birdName);
  }
}

// ====== ФИНАЛЬНАЯ ПРОВЕРКА И ГЕНЕРАЦИЯ ======

async function generateCompleteBirdPost(birdName) {
  console.log(`🎨 Генерирую полный пост для: "${birdName}"`);

  try {
    // Параллельно получаем факты и ищем фото
    const [facts, imageUrl] = await Promise.all([
      generateReliableFacts(birdName, { requireGemini: true }),
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

    // Если не удалось получить новые факты от Gemini — пробрасываем ошибку выше,
    // чтобы можно было полностью отменить публикацию.
    if (error && error.message === 'NO_GEMINI_FACTS') {
      throw error;
    }

    // Для прочих ошибок продолжаем использовать аварийный fallback.
    return await getFallbackBirdData(birdName);
  }
}

/**
 * Генерирует пост с пользовательским фото
 */
async function generateCompleteBirdPostWithUserPhoto(birdName, userPhoto) {
  console.log(`🎨📸 Генерирую пост с пользовательским фото для: "${birdName}"`);

  try {
    // Параллельно генерируем факты и описание
    const facts = await generateReliableFacts(birdName, { requireGemini: true });
    const description = await generateBirdDescription(birdName, facts);

    // Получаем URL фото из Telegram
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN1;
    const fileInfoUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${userPhoto.photo_file_id}`;

    const fileInfoResponse = await fetch(fileInfoUrl);
    const fileInfo = await fileInfoResponse.json();

    let photoUrl = null;
    if (fileInfo.ok && fileInfo.result.file_path) {
      photoUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.result.file_path}`;
      console.log(`✅ Получен URL пользовательского фото: ${photoUrl}`);
    } else {
      console.error('❌ Не удалось получить URL фото, использую поиск');
      photoUrl = await findBirdImage(birdName);
    }

    const finalData = {
      name: birdName,
      description: description,
      imageUrl: userPhoto.photo_file_id, // Use file_id directly for sending
      facts: facts,
      timestamp: getCurrentDateTime(),
      hasPhoto: true,
      userSubmitted: true,
      photoId: userPhoto.id,
      debugUrl: photoUrl // Keep URL for debugging if needed
    };

    console.log(`✅ Пост с пользовательским фото сгенерирован: ${birdName} (File ID: ${userPhoto.photo_file_id})`);
    return finalData;

  } catch (error) {
    console.error(`❌ Ошибка генерации поста с пользовательским фото:`, error);

    // Если не удалось получить новые факты от Gemini — пробрасываем ошибку выше,
    // чтобы можно было полностью отменить публикацию.
    if (error && error.message === 'NO_GEMINI_FACTS') {
      throw error;
    }

    // Для прочих ошибок продолжаем использовать аварийный fallback.
    return await getFallbackBirdData(birdName);
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
    "Лысуха", "Серая утка", "Шилохвость", "Свиязь", "Широконоска"
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

async function getRandomBirdData() {
  try {
    // 1. ПРОВЕРЯЕМ ОБА ТИПА ПРИОРИТЕТОВ ПАРАЛЛЕЛЬНО
    console.log('🔍 Проверяю приоритетные птицы...');
    const [priorityWithPhoto, priorityWithoutPhoto] = await Promise.all([
      getPriorityBirdWithPhoto(),
      getPriorityBird()
    ]);

    // 2. ЕСЛИ ЕСТЬ ОБА ТИПА - ВЫБИРАЕМ СЛУЧАЙНО (50/50)
    if (priorityWithPhoto && priorityWithoutPhoto) {
      const usePhoto = Math.random() < 0.5;
      const selectedPriority = usePhoto ? priorityWithPhoto : priorityWithoutPhoto;

      console.log(`🎲 Найдены оба типа приоритетов! Выбираю: ${usePhoto ? 'С ФОТО' : 'БЕЗ ФОТО'}`);
      console.log(`✨ ПРИОРИТЕТНАЯ ПТИЦА: "${selectedPriority.bird_name}" (ID: ${selectedPriority.suggestion_id})`);

      // Обрабатываем птицу с пользовательским фото или без
      const birdData = await processSelectedBird(
        selectedPriority.bird_name,
        usePhoto ? 'priority_with_photo' : 'priority_queue',
        usePhoto ? selectedPriority.userPhoto : null
      );

      // Помечаем приоритетную птицу как использованную
      await markPriorityBirdAsUsed(selectedPriority.id);

      // Если использовали фото - помечаем его тоже
      if (usePhoto && selectedPriority.userPhoto) {
        const { markPhotoAsUsed } = supabase;
        await markPhotoAsUsed(selectedPriority.userPhoto.id);
        console.log(`✅ Пользовательское фото ${selectedPriority.userPhoto.id} помечено как использованное`);
      }

      console.log(`✅ Приоритетная птица "${selectedPriority.bird_name}" помечена как использованная`);
      return birdData;
    }

    // 3. ЕСЛИ ЕСТЬ ТОЛЬКО ПРИОРИТЕТ С ФОТО
    if (priorityWithPhoto) {
      const birdName = priorityWithPhoto.bird_name;
      console.log(`✨ НАЙДЕНА ПРИОРИТЕТНАЯ ПТИЦА С ФОТО: "${birdName}" (ID: ${priorityWithPhoto.suggestion_id})`);

      // Обрабатываем птицу с пользовательским фото
      const birdData = await processSelectedBird(birdName, 'priority_with_photo', priorityWithPhoto.userPhoto);

      // Помечаем приоритетную птицу и фото как использованные
      await markPriorityBirdAsUsed(priorityWithPhoto.id);
      await supabase.markPhotoAsUsed(priorityWithPhoto.userPhoto.id);

      console.log(`✅ Приоритетная птица "${birdName}" и фото помечены как использованные`);
      return birdData;
    }

    // 4. ЕСЛИ ЕСТЬ ТОЛЬКО ОБЫЧНЫЙ ПРИОРИТЕТ
    if (priorityWithoutPhoto) {
      const birdName = priorityWithoutPhoto.bird_name;
      console.log(`✨ НАЙДЕНА ПРИОРИТЕТНАЯ ПТИЦА: "${birdName}" (ID: ${priorityWithoutPhoto.suggestion_id})`);

      // Обрабатываем птицу
      const birdData = await processSelectedBird(birdName, 'priority_queue');

      // Помечаем приоритетную птицу как использованную
      await markPriorityBirdAsUsed(priorityWithoutPhoto.id);
      console.log(`✅ Приоритетная птица "${birdName}" помечена как использованная`);

      return birdData;
    }

    console.log('📋 Приоритетных птиц нет, выбираю источник (50/50)...');

    const existingBirds = await supabase.getAllBirds();
    const existingSet = new Set(existingBirds.map(bird => normalizeBirdName(bird)));

    const useKupidonia = Math.random() < 0.5;
    let selectedBird = null;
    let sourceName = "";

    // Функция для получения птицы из Kupidonia
    const tryKupidonia = async () => {
      console.log('🌐 Источник: Kupidonia');
      const kupidoniaBirds = await getKupidoniaBirds();
      const news = kupidoniaBirds.filter(b => !existingSet.has(normalizeBirdName(b)));
      if (news.length > 0) {
        sourceName = 'kupidonia';
        return news[Math.floor(Math.random() * news.length)];
      }
      return null;
    };

    // Функция для получения птицы из Wikipedia
    const tryWikipedia = async () => {
      console.log('🌐 Источник: Wikipedia (Россия - HTML)');
      const wikipediaBirds = await getRussianBirdsFromWikipedia();
      const news = wikipediaBirds.filter(b => !existingSet.has(normalizeBirdName(b)));
      if (news.length > 0) {
        sourceName = 'russian_list_html';
        return news[Math.floor(Math.random() * news.length)];
      }
      return null;
    };

    if (useKupidonia) {
      selectedBird = await tryKupidonia();
      if (!selectedBird) {
        console.log('🔄 Kupidonia не дала новых птиц, пробую Wikipedia...');
        selectedBird = await tryWikipedia();
      }
    } else {
      selectedBird = await tryWikipedia();
      if (!selectedBird) {
        console.log('🔄 Wikipedia не дала новых птиц, пробую Kupidonia...');
        selectedBird = await tryKupidonia();
      }
    }

    if (!selectedBird) {
      console.log('📭 Оба источника не дали новых птиц, ищу в гарантированном списке');
      const guaranteedBird = await getNewBirdFromGuaranteedList(existingSet);
      if (guaranteedBird) {
        return await processSelectedBird(guaranteedBird, 'guaranteed_list');
      }
      return await getFallbackBirdData();
    }

    console.log(`✨ ВЫБРАНА НОВАЯ ПТИЦА (${sourceName}): "${selectedBird}"`);

    // 5. ДВОЙНАЯ ПРОВЕРКА ПЕРЕД ПУБЛИКАЦИЕЙ: убеждаемся что птица не в базе
    // (нормализация может не совпасть между строкой из Wikipedia и тем что в базе)
    const alreadyExists = await isBirdInAllBirds(selectedBird);
    if (alreadyExists) {
      console.log(`⚠️ ДУБЛЬ ОБНАРУЖЕН! "${selectedBird}" уже есть в базе (несовпадение нормализации). Ищу другую птицу...`);
      // Принудительно добавляем в existingSet чтобы не выбрать снова
      existingSet.add(normalizeBirdName(selectedBird));
      // Пытаемся взять следующую птицу из Wikipedia
      const fallbackBird = await tryWikipedia();
      if (fallbackBird && !await isBirdInAllBirds(fallbackBird)) {
        console.log(`✅ Запасная птица: "${fallbackBird}"`);
        return await processSelectedBird(fallbackBird, sourceName + '_fallback');
      }
      // Совсем нет вариантов — гарантированный список
      const guaranteedBird = await getNewBirdFromGuaranteedList(existingSet);
      if (guaranteedBird) {
        return await processSelectedBird(guaranteedBird, 'guaranteed_list');
      }
      return await getFallbackBirdData();
    }

    // 5. Обрабатываем выбранную птицу
    return await processSelectedBird(selectedBird, sourceName);

  } catch (error) {
    console.error('❌ Ошибка выбора птицы:', error);

    // Если не удалось получить новые факты от Gemini — полностью отменяем пост,
    // чтобы не публиковать запись без свежей информации.
    if (error && error.message === 'NO_GEMINI_FACTS') {
      console.error('❌ Останавливаю автоматический пост: Gemini не вернул новые факты');

      try {
        const { sendAdminMessage } = await import('./telegram.js');
        await sendAdminMessage(`❌ <b>Остановка публикации:</b>\nGemini не смог сгенерировать уникальные факты для выбранной птицы после нескольких попыток.\n\n<i>Пост отменён, чтобы избежать публикации некачественного контента.</i>`);
      } catch (e) {
        console.error('Не удалось отправить уведомление об отмене поста админу:', e.message);
      }

      return null;
    }

    // Для всех прочих ошибок продолжаем использовать аварийный fallback.
    return await getFallbackBirdData();
  }
}

/**
 * Фильтрует птиц, проверяя наличие фото
 */
async function filterBirdsWithPhotos(birds) {
  const birdsWithPhotos = [];

  for (const bird of birds) {
    try {
      const hasPhoto = await checkBirdPhotoAvailability(bird);
      if (hasPhoto) {
        birdsWithPhotos.push(bird);
        console.log(`✅ ${bird} - фото доступно`);
      }
    } catch (error) {
      console.log(`⚠️ Ошибка проверки фото для "${bird}":`, error.message);
    }

    // Делаем паузу между запросами
    await delay(200);
  }

  return birdsWithPhotos;
}

/**
 * Алгоритм выбора птицы (приоритеты)
 */
function selectBirdByAlgorithm(birds) {
  if (birds.length === 0) return null;

  // Приоритет 1: Птицы с конкретными названиями (не "синица", а "большая синица")
  const specificBirds = birds.filter(bird =>
    bird.split(' ').length >= 2 &&
    !isGeneralFamilyName(bird)
  );

  if (specificBirds.length > 0) {
    // Выбираем ту, что давно не публиковалась (если есть история)
    return specificBirds[Math.floor(Math.random() * specificBirds.length)];
  }

  // Приоритет 2: Остальные птицы
  return birds[Math.floor(Math.random() * birds.length)];
}

/**
 * Обрабатывает выбранную птицу
 */
async function processSelectedBird(birdName, source, userPhoto = null) {
  // Добавляем в базу
  await addBirdToAllBirds(birdName);
  await updateBirdHistory(birdName);

  // Генерируем полный пост
  let birdData;
  if (userPhoto) {
    birdData = await generateCompleteBirdPostWithUserPhoto(birdName, userPhoto);
  } else {
    birdData = await generateCompleteBirdPost(birdName);
  }

  // Логируем выбор птицы
  const hasPhoto = !!birdData.imageUrl;
  const { logBirdSelection } = supabase;
  await logBirdSelection(birdName, source, hasPhoto, true);

  return {
    ...birdData,
    source: source,
    isRussianBird: true,
    timestamp: getCurrentDateTime()
  };
}

/**
 * Запасная функция для гарантированного списка
 */
async function getBirdFromGuaranteedList() {
  const guaranteedBirds = [
    "Большая синица", "Полевой воробей", "Сизый голубь", "Кряква",
    "Обыкновенный скворец", "Сорока", "Серая ворона", "Озёрная чайка"
  ];

  const existingBirds = await getAllBirdsFromRedis();
  const existingSet = new Set(existingBirds.map(bird => normalizeBirdName(bird)));

  for (const bird of guaranteedBirds) {
    if (!existingSet.has(normalizeBirdName(bird))) {
      return await processSelectedBird(bird, 'guaranteed_fallback');
    }
  }

  // Если все гарантированные уже были, берем первую
  return await processSelectedBird(guaranteedBirds[0], 'guaranteed_repeat');
}

/**
 * Расширенный поиск по семейству
 */
async function extendedFamilySearch(birdName) {
  try {
    console.log(`🔍 Расширенный поиск по семейству для: "${birdName}"`);

    const family = getBirdFamily(birdName);
    if (!family) return null;

    // Получаем всех птиц из базы, относящихся к этому семейству
    const allBirds = await getAllBirdsFromRedis();
    const familyKeywords = getFamilyKeywords(family);

    const familyBirds = allBirds.filter(bird => {
      const lowerBird = bird.toLowerCase();
      return familyKeywords.some(keyword => lowerBird.includes(keyword));
    });

    console.log(`   Найдено ${familyBirds.length} птиц из семейства в базе`);

    // Ищем фото у существующих птиц из того же семейства
    for (const familyBird of familyBirds.slice(0, 10)) {
      try {
        const image = await getCachedBirdImage(familyBird);
        if (image) {
          console.log(`✅ Нашел кешированное фото родственной птицы: ${familyBird}`);
          return image;
        }
      } catch (error) {
        continue;
      }
    }

    return null;
  } catch (error) {
    console.log(`⚠️ Расширенный поиск по семейству не сработал: ${error.message}`);
    return null;
  }
}

/**
 * Умное дефолтное фото
 */
function getSmartDefaultImage(birdName) {
  const lowerName = birdName.toLowerCase();

  // Определяем тип птицы
  let birdType = 'general';

  if (lowerName.includes('утк') || lowerName.includes('лебед') || lowerName.includes('гусь')) {
    birdType = 'waterfowl';
  } else if (lowerName.includes('сокол') || lowerName.includes('орёл') || lowerName.includes('ястреб')) {
    birdType = 'raptor';
  } else if (lowerName.includes('сова') || lowerName.includes('сыч') || lowerName.includes('филин')) {
    birdType = 'owl';
  } else if (lowerName.includes('вороб') || lowerName.includes('синиц') || lowerName.includes('зябл')) {
    birdType = 'passerine';
  } else if (lowerName.includes('чайк') || lowerName.includes('крачк')) {
    birdType = 'gull';
  } else if (lowerName.includes('буревестник') || lowerName.includes('тайфунник') || lowerName.includes('альбатрос')) {
    birdType = 'seabird';
  }

  // Возвращаем соответствующее дефолтное фото
  const defaultImages = {
    'waterfowl': 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/59/Anas_platyrhynchos_male_female_quadrat.jpg/1024px-Anas_platyrhynchos_male_female_quadrat.jpg',
    'raptor': 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/43/Golden_Eagle_in_flight_-_5.jpg/1024px-Golden_Eagle_in_flight_-_5.jpg',
    'owl': 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/Bubo_bubo_Wrocław_ZOO_1.jpg/1024px-Bubo_bubo_Wrocław_ZOO_1.jpg',
    'passerine': 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9b/Passer_montanus_1_%28Marek_Szczepanek%29.jpg/1024px-Passer_montanus_1_%28Marek_Szczepanek%29.jpg',
    'gull': 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/Black-headed_Gull_%28Larus_ridibundus%29_in_Tateyama%2C_Japan.jpg/1024px-Black-headed_Gull_%28Larus_ridibundus%29_in_Tateyama%2C_Japan.jpg',
    'seabird': 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/European_Storm_Petrel_%28Hydrobates_pelagicus%29.jpg/1024px-European_Storm_Petrel_%28Hydrobates_pelagicus%29.jpg',
    'general': null
  };

  return defaultImages[birdType] || defaultImages.general;
}

/**
 * Приоритеты стратегий (чем выше, тем лучше)
 */
function getStrategyPriority(strategyIndex) {
  const priorities = [10, 9, 8, 7, 6, 5, 4, 3]; // Прямой поиск самый приоритетный
  return priorities[strategyIndex] || 1;
}

/**
 * Названия стратегий
 */
function getStrategyName(strategyIndex) {
  const names = [
    'wikipedia_direct',
    'latin_name',
    'family_search',
    'similar_birds',
    'wikimedia_commons',
    'improved_search',
    'gemini_ai',
    'legacy_fallback'
  ];
  return names[strategyIndex] || 'unknown';
}

/**
 * Получение членов семейства
 */
function getFamilyMembers(family) {
  const familyMap = {
    'буревестниковые': ['Буревестник', 'Тайфунник', 'Глупыш', 'Альбатрос'],
    'тетеревиные': ['Тетерев', 'Глухарь', 'Рябчик', 'Куропатка'],
    'утковые': ['Кряква', 'Чирок', 'Свиязь', 'Шилохвость', 'Гоголь'],
    'соколиные': ['Сокол', 'Кобчик', 'Чеглок', 'Дербник', 'Пустельга'],
    'ястребиные': ['Ястреб', 'Орёл', 'Канюк', 'Лунь', 'Коршун'],
    'совиные': ['Сова', 'Сыч', 'Сипуха', 'Неясыть', 'Филин'],
    'врановые': ['Ворона', 'Сорока', 'Галка', 'Грач', 'Сойка'],
    'дятловые': ['Дятел', 'Вертишейка', 'Желна'],
    'синицевые': ['Синица', 'Лазоревка', 'Московка', 'Пухляк'],
    'воробьиные': ['Воробей', 'Зяблик', 'Юрок', 'Щегол', 'Коноплянка']
  };

  return familyMap[family] || [];
}

/**
 * Поиск через Gemini AI
 */
async function searchWithGeminiAI(birdName) {
  try {
    console.log(`🤖 Поиск через Gemini AI: "${birdName}"`);

    // Используем существующую функцию или заглушку
    if (typeof searchBirdImageWithGemini === 'function') {
      return await searchBirdImageWithGemini(birdName);
    }

    // Заглушка если функция не определена
    console.log(`⚠️ Функция searchBirdImageWithGemini не определена`);
    return null;

  } catch (error) {
    console.log(`⚠️ Gemini AI не сработал: ${error.message}`);
    return null;
  }
}

/**
 * Ключевые слова для семейств
 */
function getFamilyKeywords(family) {
  const keywordMap = {
    'тетеревиные': ['тетерев', 'глухарь', 'рябчик', 'куропатка'],
    'утковые': ['утка', 'кряква', 'чирок', 'нырок', 'гоголь', 'гага', 'лебедь', 'гусь'],
    'соколиные': ['сокол', 'кобчик', 'чеглок', 'дербник', 'пустельга'],
    'ястребиные': ['ястреб', 'орёл', 'канюк', 'лунь', 'коршун', 'осоед'],
    'совиные': ['сова', 'сыч', 'сипуха', 'неясыть', 'филин'],
    'врановые': ['ворона', 'ворон', 'сорока', 'галка', 'грач', 'сойка'],
    'дятловые': ['дятел', 'вертишейка', 'желна'],
    'синицевые': ['синица', 'лазоревка', 'московка', 'пухляк', 'гаичка'],
    'воробьиные': ['воробей', 'зяблик', 'юрок', 'щегол', 'коноплянка', 'чечётка']
  };

  return keywordMap[family] || [];
}

/**
 * Дефолтные фото для семейств
 */
function getFamilyDefaultImage(family) {
  const defaultImages = {
    'тетеревиные': 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/Black_Grouse_Nationalpark_Bayerischer_Wald.jpg/1024px-Black_Grouse_Nationalpark_Bayerischer_Wald.jpg',
    'утковые': 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/59/Anas_platyrhynchos_male_female_quadrat.jpg/1024px-Anas_platyrhynchos_male_female_quadrat.jpg',
    'соколиные': 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6a/Falco_peregrinus_good_-_Christopher_Watson.jpg/1024px-Falco_peregrinus_good_-_Christopher_Watson.jpg',
    'ястребиные': 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/43/Golden_Eagle_in_flight_-_5.jpg/1024px-Golden_Eagle_in_flight_-_5.jpg',
    'совиные': 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/Bubo_bubo_Wrocław_ZOO_1.jpg/1024px-Bubo_bubo_Wrocław_ZOO_1.jpg',
    'врановые': 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5b/Pica_pica_-near_Killary_Harbour%2C_Connemara%2C_Ireland-8.jpg/1024px-Pica_pica_-near_Killary_Harbour%2C_Connemara%2C_Ireland-8.jpg',
    'дятловые': 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6e/Dendrocopos_major_2_%28Marek_Szczepanek%29.jpg/1024px-Dendrocopos_major_2_%28Marek_Szczepanek%29.jpg',
    'синицевые': 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7e/Parus_major_-Hampshire%2C_England-8.jpg/1024px-Parus_major_-Hampshire%2C_England-8.jpg',
    'воробьиные': 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9b/Passer_montanus_1_%28Marek_Szczepanek%29.jpg/1024px-Passer_montanus_1_%28Marek_Szczepanek%29.jpg'
  };

  return defaultImages[family] || null;
}

/**
 * Старый подход как запасной вариант
 */
async function legacyImageSearchFallback(birdName) {
  try {
    console.log(`🔧 Запасной старый поиск: "${birdName}"`);

    const searchVariants = generateSearchVariants(birdName);

    for (const variant of searchVariants) {
      try {
        const image = await searchImageForVariant(variant);
        if (image) {
          console.log(`✅ Старый подход нашел фото для варианта: ${variant}`);
          return image;
        }
      } catch (error) {
        continue;
      }
    }

    return null;
  } catch (error) {
    console.log(`⚠️ Старый подход не сработал: ${error.message}`);
    return null;
  }
}

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

/**
 * Прямой поиск в Википедии
 */
async function searchWikipediaDirect(birdName) {
  try {
    console.log(`📚 Прямой поиск в Википедии: "${birdName}"`);
    return await getBirdWikiImage(birdName);
  } catch (error) {
    console.log(`⚠️ Прямой поиск не сработал: ${error.message}`);
    return null;
  }
}

/**
 * Поиск через латинское название
 */
async function searchViaLatinName(birdName) {
  try {
    const latinName = getLatinNameForBird(birdName);
    if (!latinName) return null;

    console.log(`🔬 Поиск через латинское название: "${latinName}"`);
    return await getBirdWikiImage(latinName);
  } catch (error) {
    return null;
  }
}

/**
 * Поиск через семейство птиц
 */
async function searchThroughFamily(birdName) {
  try {
    const family = getBirdFamily(birdName);
    if (!family) return null;

    console.log(`👨‍👩‍👧‍👦 Поиск через семейство: "${family}"`);

    // Основные представители семейства
    const familyMembers = getFamilyMembers(family);

    for (const member of familyMembers) {
      if (member.toLowerCase() === birdName.toLowerCase()) continue;

      try {
        const image = await getBirdWikiImage(member);
        if (image && isRealPhoto(image)) {
          console.log(`✅ Нашел фото представителя семейства: ${member}`);
          return image;
        }
      } catch (error) {
        continue;
      }
    }

    return null;
  } catch (error) {
    console.log(`⚠️ Поиск по семейству не сработал: ${error.message}`);
    return null;
  }
}

/**
 * Поиск похожих птиц
 */
async function searchSimilarBirds(birdName) {
  try {
    console.log(`🔄 Поиск похожих птиц для: "${birdName}"`);

    const similarBirds = findSimilarBirds(birdName);
    if (similarBirds.length === 0) return null;

    console.log(`   Найдено ${similarBirds.length} похожих птиц`);

    for (const similarBird of similarBirds.slice(0, 5)) {
      try {
        const image = await getBirdWikiImage(similarBird);
        if (image && isRealPhoto(image) && validateBirdPhoto(image, birdName)) {
          console.log(`✅ Нашел фото похожей птицы: ${similarBird}`);
          return image;
        }
      } catch (error) {
        continue;
      }
    }

    return null;
  } catch (error) {
    console.log(`⚠️ Поиск похожих птиц не сработал: ${error.message}`);
    return null;
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
      const post = await generateCompleteBirdPost(bird);
      if (!post.imageUrl) {
        console.log(`⚠️ Запасная птица без фото, добавляю дефолтное`);
        post.imageUrl = getEnhancedDefaultBirdImage(bird);
        post.hasPhoto = true;
      }
      return post;
    }
  }

  console.log(`🔄 Все запасные птицы уже есть, беру: ${fallbackBirds[0]}`);
  const post = await generateCompleteBirdPost(fallbackBirds[0]);
  if (!post.imageUrl) {
    post.imageUrl = getEnhancedDefaultBirdImage(fallbackBirds[0]);
    post.hasPhoto = true;
  }
  return post;
}

async function getFallbackBirdData(birdName = null) {
  try {
    const allBirds = await getAllBirdsFromRedis();

    if (allBirds.length > 0) {
      // Пытаемся по возможности не брать птиц, которые уже были недавно
      let recentBirds = [];
      try {
        recentBirds = await getWeeklyBirds();
      } catch (e) {
        console.log('⚠️ Не удалось получить список птиц за неделю для fallback:', e.message);
      }

      const recentSet = new Set(
        (recentBirds || []).map(bird => normalizeBirdName(bird))
      );

      const candidates = allBirds.filter(bird => !recentSet.has(normalizeBirdName(bird)));
      const pool = candidates.length > 0 ? candidates : allBirds;

      const shuffledBirds = [...pool].sort(() => Math.random() - 0.5);
      const randomBird = shuffledBirds[0];

      console.log(`🔄 Аварийный режим: использую случайную птицу из базы - ${randomBird}`);

      // Пытаемся найти фото, даже для аварийной птицы
      let imageUrl = await findBirdImage(randomBird);
      if (!imageUrl) {
        console.log(`⚠️ Не нашел фото для аварийной птицы, использую дефолтное`);
        imageUrl = getEnhancedDefaultBirdImage(randomBird);
      }

      const facts = await generateReliableFacts(randomBird);

      // Генерируем описание на основе фактов
      let description = `${randomBird} — интересная птица из нашей коллекции.`;
      try {
        const genDesc = await generateBirdDescription(randomBird, facts);
        if (genDesc) description = genDesc;
      } catch (e) {
        console.log(`⚠️ Ошибка генерации описания для аварийной птицы:`, e.message);
      }

      return {
        name: randomBird,
        description: description,
        imageUrl: imageUrl,
        facts: facts || [
          "Обитает в лесных и парковых зонах, адаптируясь к различным типам растительности.",
          "Питается разнообразной пищей: насекомыми летом и семенами зимой.",
          "Имеет характерные размеры и окраску, типичные для своего семейства."
        ],
        timestamp: getCurrentDateTime(),
        isFallback: true
      };
    }
  } catch (error) {
    console.error('❌ Ошибка в аварийном режиме:', error);
  }

  const finalBirdName = birdName || "Большая синица";

  // Пытаемся найти фото для финального фоллбека
  let fallbackImage = null;
  try {
    fallbackImage = await findBirdImage(finalBirdName);
  } catch (e) { }

  if (!fallbackImage) {
    fallbackImage = getEnhancedDefaultBirdImage(finalBirdName);
  }

  const facts = [
    "Питается насекомыми и семенами, часто посещает кормушки зимой.",
    "Самцы и самки похожи, но самцы немного крупнее.",
    "Гнездится в дуплах, иногда использует готовые скворечники."
  ];

  // Генерируем описание на основе фактов
  let description = `${finalBirdName} — хорошо известная птица, встречающаяся во многих регионах.`;
  try {
    const genDesc = await generateBirdDescription(finalBirdName, facts);
    if (genDesc) description = genDesc;
  } catch (e) { }

  return {
    name: finalBirdName,
    description: description,
    imageUrl: fallbackImage,
    facts: facts,
    timestamp: getCurrentDateTime(),
    isFallback: true
  };
}

// ====== ВИКТОРИНЫ ======

async function generateQuizQuestion(birdName, facts) {
  try {
    if (!facts || !Array.isArray(facts) || facts.length === 0) {
      console.log(`⚠️ Нет фактов для птицы: ${birdName}`);
      return null;
    }

    // Выбираем лучший факт для викторины (самый информативный)
    const selectedFact = selectBestFactForQuiz(facts, birdName);

    if (!selectedFact) {
      console.log(`⚠️ Не удалось выбрать подходящий факт для: ${birdName}`);
      return null;
    }

    // Перефразируем факт через Gemini
    const rephrasedFact = await rephraseFactForQuiz(birdName, selectedFact);

    if (!rephrasedFact || rephrasedFact.length < 20) {
      console.log(`⚠️ Не удалось перефразировать факт для: ${birdName}`);
      return null;
    }

    // Создаем стандартный вопрос
    const question = `Какая птица соответствует этому факту? "${rephrasedFact}"`;

    console.log(`✅ Вопрос сгенерирован для: ${birdName}`);
    console.log(`   Оригинальный факт: ${selectedFact.substring(0, 80)}...`);
    console.log(`   Перефразированный: ${rephrasedFact.substring(0, 80)}...`);

    return question;

  } catch (error) {
    console.error('❌ Ошибка генерации вопроса:', error);
    return null;
  }
}

// Функция для выбора лучшего факта
function selectBestFactForQuiz(facts, birdName) {
  // Сортируем факты по приоритету
  const scoredFacts = facts.map(fact => {
    let score = 0;

    // Плюсы
    if (fact.length > 40 && fact.length < 150) score += 3;
    if (/\d+/.test(fact)) score += 2; // Есть числа
    if (/самый|самая|самое/i.test(fact)) score += 2; // Есть сравнения
    if (/уникальн|особен|специфическ/i.test(fact)) score += 2; // Есть уникальность

    // Минусы
    if (fact.toLowerCase().includes(birdName.toLowerCase())) score -= 5;
    if (fact.length < 20) score -= 3;
    if (fact.length > 200) score -= 2;

    return { fact, score };
  });

  // Выбираем факт с максимальным score
  scoredFacts.sort((a, b) => b.score - a.score);

  return scoredFacts.length > 0 ? scoredFacts[0].fact : facts[0];
}

// Функция для перефразирования факта

async function rephraseFactForQuiz(birdName, originalFact) {
  try {
    console.log(`🔄 Перефразирую факт для викторины: ${birdName}`);

    const prompt = `
Перефразируй этот факт о птице "${birdName}" для викторины:

ФАКТ: "${originalFact}"

ТРЕБОВАНИЯ К ПЕРЕФРАЗИРОВАНИЮ:
1. Сохрани смысл и ключевые детали
2. НЕ упоминай название птицы "${birdName}"
3. Замени "птица" на "она/он" или "этот вид"
4. Сделай текст более загадочным, но узнаваемым
5. Сохрани числовые данные и конкретные особенности
6. Сделай факт короче если нужно (не более 120 символов)
7. Используй разнообразные формулировки

ПРИМЕРЫ:
• Было: "Сокол-сапсан развивает скорость до 389 км/ч в пикировании"
• Стало: "В пикирующем полёте может достигать скорости до 389 км/ч"

• Было: "Колибри делает до 80 взмахов крыльев в секунду"
• Стало: "Совершает до 80 взмахов крыльев каждую секунду"

• Было: "Пингвин императорский высиживает яйцо на лапах в течение 2 месяцев"
• Стало: "Высиживает потомство на лапах около двух месяцев в условиях антарктической зимы"

Теперь перефразируй этот факт: "${originalFact}"

Верни ТОЛЬКО перефразированный факт, без кавычек.
`;

    // Используем одну стабильную модель
    const model = GEMINI_MODEL;
    try {
      console.log(`🤖 Пробую модель: ${model}`);

      const modelUrl = `${GEMINI_BASE_URL}/${model}:generateContent?key=${GEMINI_API_KEY}`;

      const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 120,
          topP: 0.8
        }
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 секунд таймаут

      const res = await fetch(modelUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        console.log(`⚠️ Модель ${model} не ответила (${res.status})`);
        await delay(500); // Ждем 500ms перед следующей попыткой
        return await smartSimpleRephrase(originalFact, birdName);
      }

      const data = await res.json();
      let rephrasedFact = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      if (rephrasedFact && rephrasedFact.length > 20) {
        // Очищаем
        rephrasedFact = rephrasedFact
          .trim()
          .replace(/^["']|["']$/g, '')
          .replace(/^["']|["']$/g, '')
          .replace(/\s+/g, ' ')
          .trim();

        // Проверяем, что в факте нет названия птицы
        const lowerFact = rephrasedFact.toLowerCase();
        const lowerBirdName = birdName.toLowerCase();

        if (lowerFact.includes(lowerBirdName)) {
          console.log(`⚠️ Модель ${model} вернула факт с названием птицы`);
          return await smartSimpleRephrase(originalFact, birdName);
        }

        // Проверяем длину
        if (rephrasedFact.length < 25 || rephrasedFact.length > 150) {
          console.log(`⚠️ Модель ${model} вернула факт неправильной длины: ${rephrasedFact.length}`);
          return await smartSimpleRephrase(originalFact, birdName);
        }

        // Добавляем точку если нет
        if (!/[.!?]$/.test(rephrasedFact)) {
          rephrasedFact += '.';
        }

        console.log(`✅ Успех с моделью ${model}`);
        console.log(`   Оригинал: ${originalFact.substring(0, 80)}...`);
        console.log(`   Перефразировано: ${rephrasedFact}`);

        return rephrasedFact;
      }

      console.log(`⚠️ Модель ${model} вернула пустой ответ`);
      return await smartSimpleRephrase(originalFact, birdName);

    } catch (modelError) {
      if (modelError.name === 'AbortError') {
        console.log(`⏰ Модель ${model} превысила таймаут`);
      } else {
        console.log(`⚠️ Ошибка модели ${model}: ${modelError.message}`);
      }
      return await smartSimpleRephrase(originalFact, birdName);
    }
  } catch (error) {
    console.error('❌ Критическая ошибка перефразирования:', error);
    return await smartSimpleRephrase(originalFact, birdName);
  }
}

// Простое перефразирование без Gemini
async function smartSimpleRephrase(originalFact, birdName) {
  console.log(`🔄 Умное перефразирование для: ${birdName}`);

  let rephrased = originalFact;

  // Список замен для разных частей названий птиц
  const birdNameReplacements = [
    // Общие слова
    ['погоныш', 'эта птица'],
    ['зяблик', 'он'],
    ['дятел', 'этот вид'],
    ['цапля', 'она'],
    ['сова', 'эта хищница'],
    ['голубь', 'этот пернатый'],
    ['воробей', 'эта маленькая птичка'],
    ['синица', 'она'],
    ['снегирь', 'эта красногрудая птица'],
    ['скворец', 'этот певец'],
    ['ласточка', 'эта быстрокрылая птица'],
    ['чайка', 'эта морская птица'],
    ['ворона', 'этот умный вид'],
    ['сорока', 'эта говорливая птица'],
    ['журавль', 'этот длинноногий вид'],
    ['аист', 'эта перелётная птица'],
    ['лебедь', 'этот грациозный вид'],
    ['гоголь', 'эта нырковая утка'],
    ['бекас', 'этот болотный житель'],
    ['вальдшнеп', 'этот лесной обитатель'],
    ['чибис', 'эта птица с хохолком'],
    ['перепел', 'эта полевая птица'],
    ['фазан', 'этот яркий вид'],
    ['кеклик', 'эта горная птица'],
    ['удод', 'этот птица с хохолком'],
    ['зимородок', 'этот рыболов'],
    ['щегол', 'этот красочный вид'],
    ['свиристель', 'эта ягодная птица'],
    ['чечетка', 'эта стайная птица'],
    ['овсянка', 'этот полевой вид']
  ];

  // Заменяем название птицы
  let foundReplacement = false;
  for (const [birdWord, replacement] of birdNameReplacements) {
    const regex = new RegExp(`\\b${birdWord}\\b`, 'gi');
    if (regex.test(rephrased)) {
      rephrased = rephrased.replace(regex, replacement);
      foundReplacement = true;
      break;
    }
  }

  // Если не нашли конкретное название, заменяем общее
  if (!foundReplacement) {
    rephrased = rephrased.replace(new RegExp(birdName, 'gi'), 'эта птица');
  }

  // Заменяем общие слова "птица/птицы"
  const generalReplacements = [
    ['птица', 'он'],
    ['птица', 'она'],
    ['птиц', 'этих пернатых'],
    ['птицы', 'они'],
    ['птичек', 'этих маленьких созданий'],
    ['пернатый', 'крылатый'],
    ['пернатых', 'крылатых']
  ];

  for (const [from, to] of generalReplacements) {
    const regex = new RegExp(`\\b${from}\\b`, 'gi');
    if (regex.test(rephrased)) {
      rephrased = rephrased.replace(regex, to);
      break;
    }
  }

  // Удаляем возможные дубли
  rephrased = rephrased.replace(/эта птица эта птица/gi, 'эта птица');
  rephrased = rephrased.replace(/он он/gi, 'он');
  rephrased = rephrased.replace(/она она/gi, 'она');

  // Убираем лишние слова в начале
  rephrased = rephrased.replace(/^(Эта птица|Он|Она)\s+(является|это|–|—)\s+/i, '$1 ');

  // Укорачиваем если слишком длинный
  if (rephrased.length > 120) {
    // Пробуем разбить на предложения
    const sentences = rephrased.split(/[.!?]+/);
    if (sentences.length > 0 && sentences[0].length > 25) {
      rephrased = sentences[0].trim();
      if (!/[.!?]$/.test(rephrased)) {
        rephrased += '.';
      }
    } else {
      // Просто обрезаем
      rephrased = rephrased.substring(0, 117) + '...';
    }
  }

  // Первая буква заглавная, точка в конце
  if (rephrased.length > 0) {
    rephrased = rephrased.charAt(0).toUpperCase() + rephrased.slice(1);
    if (!/[.!?]$/.test(rephrased)) {
      rephrased += '.';
    }
  }

  // Убираем двойные пробелы
  rephrased = rephrased.replace(/\s+/g, ' ').trim();

  console.log(`✅ Умное перефразирование:`);
  console.log(`   Было: ${originalFact.substring(0, 80)}...`);
  console.log(`   Стало: ${rephrased}`);

  return rephrased;
}

// Функция для проверки плохих вопросов
function isBadQuestion(question) {
  const lowerQuestion = question.toLowerCase();

  const badPatterns = [
    'о какой птице идет речь',
    'угадайте птицу по описанию',
    'какая птица соответствует',
    'описание птицы',
    'факт о птице',
    'характеристика птицы',
    'эта птица',
    'данный факт',
    'следующее описание'
  ];

  return badPatterns.some(pattern => lowerQuestion.includes(pattern));
}

// Функция для генерации креативных вопросов
function generateCreativeQuestion(fact) {
  // Извлекаем ключевые слова из факта
  const keywords = extractKeywords(fact);

  const creativeQuestions = [
    `Какая птица ${keywords.verb || 'известна'} ${keywords.feature || 'своими уникальными особенностями'}?`,
    `У какой птицы ${keywords.trait || 'самые необычные характеристики'}?`,
    `Чьи ${keywords.behavior || 'повадки'} считаются самыми ${keywords.adjective || 'удивительными'}?`,
    `Какая птица-${keywords.noun || 'рекордсмен'} ${keywords.action || 'выделяется среди других'}?`,
    `Чья ${keywords.ability || 'уникальная способность'} поражает исследователей?`
  ];

  return creativeQuestions[Math.floor(Math.random() * creativeQuestions.length)];
}

// Функция для извлечения ключевых слов из факта
function extractKeywords(fact) {
  const lowerFact = fact.toLowerCase();

  const keywords = {
    verb: '',
    feature: '',
    trait: '',
    behavior: '',
    adjective: '',
    noun: '',
    action: '',
    ability: ''
  };

  // Ищем ключевые слова
  const keywordPatterns = {
    verb: /(имеет|обладает|совершает|делает|строит|издает|мигрирует|питается)/,
    feature: /(клюв|оперение|голос|пение|гнезд[оа]|миграци[яию])/,
    trait: /(особенност[ьи]|характеристик[аи]|свойств[оа])/,
    behavior: /(поведен[ие]|повадк[иа]|брачн[ыйаяое]|охот[аы])/,
    adjective: /(уникальн[ыйаяое]|необычн[ыйаяое]|редк[ийаяое]|специфическ[ийаяое])/,
    noun: /(рекордсмен|мастер|эксперт|специалист)/,
    action: /(выделяется|отличается|поражает|удивляет)/,
    ability: /(способност[ьи]|умение|навык[иа])/
  };

  for (const [key, pattern] of Object.entries(keywordPatterns)) {
    const match = lowerFact.match(pattern);
    if (match) {
      keywords[key] = match[1];
    }
  }

  return keywords;
}

// Вспомогательная функция для простых вопросов
function createSimpleQuestion(birdName, fact) {
  const questionTypes = [
    "Какая птица соответствует этому описанию?",
    "О какой птице идет речь в этом факте?",
    "Угадайте птицу по описанию:",
    "Какая птица обладает такими характеристиками?"
  ];

  const randomType = questionTypes[Math.floor(Math.random() * questionTypes.length)];

  // Укорочиваем факт если нужно
  let shortFact = fact;
  if (fact.length > 100) {
    shortFact = fact.substring(0, 100) + '...';
  }

  return `${randomType}\n${shortFact}`;
}

// Добавьте эту функцию для улучшенной проверки фактов
async function getQuizReadyFacts(birdName) {
  try {
    const facts = await getBirdFacts(birdName);

    if (!facts || !Array.isArray(facts)) {
      return null;
    }

    // Фильтруем факты: убираем слишком короткие/длинные и содержащие название птицы
    const quizFacts = facts.filter(fact => {
      if (!fact) return false;

      // Проверяем длину
      if (fact.length < 30 || fact.length > 180) {
        return false;
      }

      // Проверяем, что факт не начинается с названия птицы
      const lowerFact = fact.toLowerCase();
      const birdLower = birdName.toLowerCase();

      if (lowerFact.startsWith(birdLower)) {
        return false;
      }

      // Проверяем, что факт содержит конкретные детали
      const hasDetails =
        /\d+/.test(fact) || // числа
        /(способен|может|умеет|имеет)/i.test(fact) || // способности
        /(достигает|развивает)/i.test(fact) || // достижения
        /(питается|охотится)/i.test(fact) || // питание
        /(гнездится|размножается)/i.test(fact); // размножение

      return hasDetails;
    });

    return quizFacts.length > 0 ? quizFacts : null;

  } catch (error) {
    console.log(`⚠️ Ошибка получения фактов для викторины: ${birdName}`, error.message);
    return null;
  }
}

async function generateQuiz() {
  try {
    console.log('🎯 Генерация викторины из ВСЕЙ истории публикаций');

    // Получаем птиц из всей истории (опубликованных за все время)
    const historyBirds = await supabase.getAllTimeBirds();

    // Если птиц в истории мало, попробуем взять из всей базы
    let candidateBirds = historyBirds;

    if (candidateBirds.length < 10) {
      console.log('⚠️ Мало птиц в истории за неделю, беру из всей базы');
      const allBirds = await getAllBirdsFromRedis();
      candidateBirds = allBirds;
    }

    if (candidateBirds.length < 4) {
      console.log('❌ Недостаточно птиц для викторины');
      return await generateFallbackQuiz();
    }

    console.log(`📊 Кандидатов для викторины: ${candidateBirds.length}`);

    // Выбираем случайных 4 птицы
    const shuffledBirds = [...candidateBirds]
      .sort(() => Math.random() - 0.5)
      .slice(0, 4);

    // Выбираем правильную птицу
    const correctBird = shuffledBirds[0];

    // Получаем факты для правильной птицы
    let facts = await getBirdFacts(correctBird);

    if (!facts || facts.length === 0) {
      console.log(`⚠️ Нет фактов для ${correctBird}, генерирую...`);
      let newFacts = await generateReliableFacts(correctBird);
      if (!newFacts || newFacts.length === 0) {
        return await generateFallbackQuiz();
      }
      facts = newFacts;
    }

    // Выбираем лучший факт для викторины
    const selectedFact = selectBestFactForQuiz(facts, correctBird);

    if (!selectedFact) {
      console.log(`⚠️ Не удалось выбрать факт для ${correctBird}`);
      return await generateFallbackQuiz();
    }

    // Перефразируем факт
    const rephrasedFact = await rephraseFactForQuiz(correctBird, selectedFact);

    if (!rephrasedFact) {
      console.log(`⚠️ Не удалось перефразировать факт для ${correctBird}`);
      return await generateFallbackQuiz();
    }

    // Создаем вопрос для викторины
    const question = `Какая птица соответствует этому описанию? "${rephrasedFact}"`;

    const options = [...shuffledBirds].sort(() => Math.random() - 0.5);
    const correctIndex = options.indexOf(correctBird);

    return {
      question: question,
      options: options,
      correctIndex: correctIndex,
      correctBird: correctBird,
      fact: rephrasedFact,
      source: 'full_database'
    };

  } catch (error) {
    console.error('❌ Ошибка генерации викторины:', error);
    return await generateFallbackQuiz();
  }
}

async function generateQuizExplanation(birdName, fact) {
  try {
    const prompt = `
Объясни, почему именно птица "${birdName}" подходит под это описание: "${fact}".
Напиши это как ОЧЕНЬ КРАТКОЕ объяснение для правильного ответа.

ТРЕБОВАНИЯ:
1. Максимум 1 предложение.
2. Не более 100 символов.
3. Без занудства, можно с юмором или эмодзи.
4. Суть: подтверди правильность ответа фактом.

Пример:
"Да! Стрижи даже спят в полете, отключая половину мозга. 😴✈️"

Напиши объяснение для "${birdName}":
`;

    // Используем одну стабильную модель
    const model = GEMINI_MODEL;

    try {
      const modelUrl = `${GEMINI_BASE_URL}/${model}:generateContent?key=${GEMINI_API_KEY}`;

      const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 100
        }
      };

      const res = await fetch(modelUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const data = await res.json();
        const explanation = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (explanation.length > 10) {
          return explanation.trim();
        }
      }
    } catch (e) {
      console.log(`⚠️ Ошибка модели ${model}: ${e.message}`);
    }

    // Fallback если Gemini не ответил
    return `Это действительно ${birdName}! ${fact}`;
  } catch (error) {
    console.error('❌ Ошибка генерации объяснения:', error);
    return `Это действительно ${birdName}! ${fact}`;
  }
}

// Вспомогательная функция для создания викторины
async function createQuizWithQuestion(correctBird, allBirds, question) {
  try {
    // Очищаем вопрос от возможных заголовков
    let cleanQuestion = question.trim();
    cleanQuestion = cleanQuestion.replace(/^🎯\s*/g, '');
    cleanQuestion = cleanQuestion.replace(/^ВОСКРЕСНАЯ ВИКТОРИНА!\s*/gi, '');

    // Выбираем 3 другие птицы
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
      question: cleanQuestion, // БЕЗ заголовка
      options: options,
      correctIndex: correctIndex,
      correctBird: correctBird
    };

    console.log(`✅ Викторина сгенерирована успешно!`);
    console.log(`   Вопрос: "${cleanQuestion.substring(0, 80)}..."`);
    console.log(`   Правильный ответ: ${quizData.correctBird} (позиция ${quizData.correctIndex + 1})`);

    return quizData;

  } catch (error) {
    console.error('❌ Ошибка создания викторины:', error);
    return await generateFallbackQuiz();
  }
}

// Функция для генерации запасного вопроса
async function generateFallbackQuiz() {
  try {
    console.log('🔄 Генерация резервной викторины');

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

    // Простой стандартный вопрос
    const question = `Какая птица соответствует этому описанию?`;

    return {
      question: question,
      options: options,
      correctIndex: correctIndex,
      correctBird: correctBird,
      explanation: `Это распространённая птица в наших краях.`,
      isFallback: true
    };

  } catch (error) {
    console.error('❌ Ошибка резервной викторины:', error);
    return null;
  }
}

// ====== ЭКСПОРТ ======

export {
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
  isBirdInAllBirds,
  addBirdToAllBirds,
  getAllBirdsFromRedis,
  getBirdFacts,
  saveBirdFacts,
  updateBirdHistory,
  getPriorityBird,
  markPriorityBirdAsUsed,
  generateCompleteBirdPost
};