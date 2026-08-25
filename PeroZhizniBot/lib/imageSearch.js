import { fetchWithRetry } from './utils.js';
import { getCachedBirdImage, cacheBirdImage } from './supabase.js';
import { Sentry } from './sentry.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODEL = 'gemini-2.5-flash-lite';

// Множественные источники для поиска фото
const IMAGE_SOURCES = {
  WIKIPEDIA: 'wikipedia',
  WIKIMEDIA_COMMONS: 'wikimedia',
  WIKIDATA: 'wikidata',
  INATURALIST: 'inaturalist',
  EBIRD: 'ebird'
};

/**
 * Основная функция поиска фото для птицы
 */
export async function findBirdImage(birdName, options = {}) {
  const { useCache = true, timeout = 15000, maxAttempts = 3 } = options;

  console.log(`🔍 Поиск фото для: "${birdName}"`);

  // 1. Проверяем кэш
  if (useCache) {
    const cached = await getCachedImage(birdName);
    if (cached) {
      console.log(`✅ Использую кешированное фото для ${birdName}`);
      return cached;
    }
  }

  // 2. Последовательный поиск по источникам с паузой между запросами
  // (защита от rate-limit 429 Wikimedia при нескольких постах в день)
  const sources = [
    { name: 'ru_wikipedia', fn: () => searchWikipediaImage(birdName, timeout) },
    { name: 'en_wikipedia_wikidata', fn: () => searchEnWikipediaViaWikidata(birdName, timeout) },
    { name: 'ebird_macaulay', fn: () => searchEbirdImage(birdName, timeout) },
    { name: 'inaturalist_deep', fn: () => searchInaturalistImage(birdName, timeout, true) },
    { name: 'commons_fulltext', fn: () => searchCommonsFulltext(birdName, timeout) },
    { name: 'commons_categories', fn: () => searchWikimediaCommonsDirect(birdName, timeout) },
    { name: 'fallback_strategies', fn: () => searchWithFallbackStrategies(birdName, timeout) },
  ];

  for (const source of sources) {
    try {
      const result = await source.fn();
      if (result && result.url && validateImageQuality(result.url, birdName)) {
        // AI ВАЛИДАЦИЯ (Gemini Vision)
        const isCorrect = await validateImageWithVision(result.url, birdName);

        if (isCorrect) {
          console.log(`✅ Найдено и подтверждено фото [${source.name}]: ${result.url.substring(0, 80)}...`);
          await cacheImage(birdName, result.url, source.name);
          return result.url;
        } else {
          console.log(`⚠️ Удаленное подтверждение не пройдено для [${source.name}]`);
        }
      }
    } catch (e) {
      Sentry.captureException(e, { extra: { bird: birdName, source: source.name } });
      console.log(`⚠️ Источник [${source.name}] не ответил: ${e.message}`);
    }
    // Пауза между источниками — не нагружаем Wikimedia
    await delay(300);
  }

  // 3. Используем Gemini как последнее средство
  console.log(`🤖 Пробую Gemini для поиска фото: "${birdName}"`);
  const geminiImage = await searchBirdImageWithGemini(birdName);

  if (geminiImage && validateImageQuality(geminiImage, birdName)) {
    console.log(`✅ Gemini нашел фото`);
    await cacheImage(birdName, geminiImage, 'gemini');
    return geminiImage;
  }

  // 4. Дефолтное фото
  console.log(`❌ Фото не найдено, использую дефолтное`);
  const defaultImage = getDefaultBirdImage(birdName);
  await cacheImage(birdName, defaultImage, 'default');

  return defaultImage;
}

/**
 * Вспомогательная функция для поиска одного изображения в Википедии
 */
async function searchSingleWikipediaImage(name) {
  try {
    const encodedName = encodeURIComponent(name);

    // 1. Поиск через pageimages original
    const url1 = `https://ru.wikipedia.org/w/api.php?action=query&titles=${encodedName}&prop=pageimages&format=json&piprop=original&pilicense=any`;
    const response1 = await fetchWithRetry(url1, {
      headers: { 'User-Agent': 'BirdTelegramBot/1.0 (https://t.me/PeroZhizni; admin@example.com)' }
    });

    if (response1.ok) {
      const data1 = await response1.json();
      const pages1 = data1.query.pages;
      const pageId1 = Object.keys(pages1)[0];
      if (pageId1 !== "-1" && pages1[pageId1].original) {
        return pages1[pageId1].original.source;
      }
    }

    await delay(300);

    // 2. Поиск через thumbnail 1200px
    const url2 = `https://ru.wikipedia.org/w/api.php?action=query&titles=${encodedName}&prop=pageimages&format=json&pithumbsize=1200&pilicense=any`;
    const response2 = await fetchWithRetry(url2, {
      headers: { 'User-Agent': 'BirdTelegramBot/1.0 (https://t.me/PeroZhizni; admin@example.com)' }
    });

    if (response2.ok) {
      const data2 = await response2.json();
      const pages2 = data2.query.pages;
      const pageId2 = Object.keys(pages2)[0];
      if (pageId2 !== "-1" && pages2[pageId2].thumbnail) {
        return pages2[pageId2].thumbnail.source;
      }
    }

    return null;
  } catch (error) {
    console.log(`⚠️ searchSingleWikipediaImage error (${name}): ${error.message}`);
    return null;
  }
}

/**
 * Поиск в Википедии с улучшенными алгоритмами
 */
async function searchWikipediaImage(birdName, timeout = 10000) {
  try {
    // Варианты поиска с добавлением контекста "птица" для избежания неоднозначности
    const searchVariants = [
      birdName,
      `${birdName} птица`,
      getLatinNameForBird(birdName),
      getEnglishNameForBird(birdName) ? `${getEnglishNameForBird(birdName)} bird` : null,
      birdName.replace(/Обыкновенный|Большой|Малый|Серый|Чёрный\s+/gi, '').trim() + ' птица',
      birdName.replace(/-/g, ' ') + ' птица',
      birdName.split('-')[0].trim() + ' птица'
    ].filter(v => v && v.length > 2);

    for (const variant of searchVariants) {
      try {
        const imageUrl = await searchSingleWikipediaImage(variant);
        if (imageUrl && validateImageQuality(imageUrl, birdName)) {
          return { url: imageUrl, source: IMAGE_SOURCES.WIKIPEDIA, variant };
        }
        await delay(300);
      } catch (error) {
        console.log(`⚠️ Вариант "${variant}" не сработал: ${error.message}`);
      }
    }

    // АГРЕССИВНЫЙ FALLBACK: Пробуем найти любое изображение в статье, если страница существует
    try {
      const allImagesUrl = await searchAnyWikipediaImage(birdName);
      if (allImagesUrl) {
        return { url: allImagesUrl, source: 'wikipedia_all_images', variant: birdName };
      }
    } catch (e) { }

    return null;
  } catch (error) {
    throw new Error(`Wikipedia search failed: ${error.message}`);
  }
}

/**
 * Ищет любое подходящее изображение в статье Википедии
 */
async function searchAnyWikipediaImage(name) {
  try {
    const encodedName = encodeURIComponent(name);
    const url = `https://ru.wikipedia.org/w/api.php?action=query&titles=${encodedName}&prop=images&format=json`;
    const resp = await fetchWithRetry(url, {
      headers: { 'User-Agent': 'BirdTelegramBot/1.0 (https://t.me/PeroZhizni; admin@example.com)' }
    });
    if (!resp.ok) return null;

    const data = await resp.json();
    const pages = data.query.pages;
    const pageId = Object.keys(pages)[0];
    const images = pages[pageId]?.images;

    if (!images || images.length === 0) return null;

    // Сортируем изображения, чтобы исключить иконки и служебные файлы
    const filteredImages = images.filter(img => {
      const title = img.title.toLowerCase();
      return (title.includes('.jpg') || title.includes('.jpeg') || title.includes('.png')) &&
        !title.includes('stub') && !title.includes('icon') && !title.includes('wikisource') &&
        !title.includes('commons-logo') && !title.includes('wikibooks') && !title.includes('portal-logo');
    });

    for (const img of filteredImages.slice(0, 3)) {
      const imgTitle = encodeURIComponent(img.title);
      const infoUrl = `https://ru.wikipedia.org/w/api.php?action=query&titles=${imgTitle}&prop=imageinfo&iiprop=url&iiurlwidth=1200&format=json`;
      const infoResp = await fetchWithRetry(infoUrl, {
        headers: { 'User-Agent': 'BirdTelegramBot/1.0 (https://t.me/PeroZhizni; admin@example.com)' }
      });
      if (!infoResp.ok) continue;

      const infoData = await infoResp.json();
      const infoPages = infoData.query.pages;
      const infoPageId = Object.keys(infoPages)[0];
      const thumbUrl = infoPages[infoPageId]?.imageinfo?.[0]?.thumburl;

      if (thumbUrl && validateImageQuality(thumbUrl, name)) return thumbUrl;
    }
    return null;
  } catch (e) { return null; }
}

/**
 * Получает английское название птицы через Wikidata по русскому имени.
 * Например: «Длиннохвостая овсянка» → «Long-tailed bunting»
 */
async function getEnglishNameViaWikidata(birdName) {
  try {
    const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(birdName)}&language=ru&limit=5&format=json`;
    const resp = await fetchWithRetry(searchUrl, {
      headers: { 'User-Agent': 'BirdTelegramBot/1.0 (https://t.me/PeroZhizni; admin@example.com)' }
    });
    if (!resp.ok) return null;

    const data = await resp.json();
    const results = data?.search || [];

    for (const entity of results) {
      const desc = (entity.description || '').toLowerCase();
      // Фильтруем: нужны только птицы (species of bird, вид птиц и т.д.)
      if (!desc.includes('bird') && !desc.includes('птиц') && !desc.includes('species')) continue;

      // Получаем английский label сущности
      const entityUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${entity.id}&props=labels&languages=en&format=json`;
      const entityResp = await fetchWithRetry(entityUrl, {
        headers: { 'User-Agent': 'BirdTelegramBot/1.0 (https://t.me/PeroZhizni; admin@example.com)' }
      });
      if (!entityResp.ok) continue;

      const entityData = await entityResp.json();
      const enLabel = entityData?.entities?.[entity.id]?.labels?.en?.value;
      if (enLabel) {
        console.log(`🔤 Wikidata: «${birdName}» → «${enLabel}» (${entity.id})`);
        return enLabel;
      }
    }

    return null;
  } catch (e) {
    console.log(`⚠️ Wikidata english name error: ${e.message}`);
    return null;
  }
}

/**
 * Поиск в English Wikipedia через Wikidata:
 * 1. Получаем английское название птицы через Wikidata
 * 2. Ищем страницу En.Wikipedia по этому названию и берём thumbnail
 */
async function searchEnWikipediaViaWikidata(birdName, timeout = 10000) {
  try {
    // Шаг 1: получаем английское название через Wikidata
    const englishName = await getEnglishNameViaWikidata(birdName);
    if (!englishName) {
      console.log(`⚠️ Wikidata не нашёл английское название для «${birdName}»`);
      return null;
    }

    await delay(200);

    // Шаг 2: запрашиваем thumbnail страницы En.Wikipedia по английскому названию
    const imgUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(englishName)}&prop=pageimages&format=json&pithumbsize=1200&pilicense=any`;
    const imgResp = await fetchWithRetry(imgUrl, {
      headers: { 'User-Agent': 'BirdTelegramBot/1.0 (https://t.me/PeroZhizni; admin@example.com)' }
    });
    if (!imgResp.ok) return null;

    const imgData = await imgResp.json();
    const pages = imgData?.query?.pages || {};
    const page = Object.values(pages)[0];

    if (page?.thumbnail?.source) {
      const thumbUrl = page.thumbnail.source;
      if (validateImageQuality(thumbUrl, birdName)) {
        console.log(`✅ En.Wikipedia (via Wikidata) нашёл фото для «${birdName}» → «${englishName}»: ${thumbUrl.substring(0, 70)}...`);
        return { url: thumbUrl, source: 'en_wikipedia_wikidata' };
      }
    }

    return null;
  } catch (error) {
    throw new Error(`En.Wikipedia via Wikidata failed: ${error.message}`);
  }
}

/**
 * Fulltext-поиск файлов в Wikimedia Commons по названию птицы
 */
async function searchCommonsFulltext(birdName, timeout = 10000) {
  try {
    // Поиск файлов (namespace=6) по имени птицы
    const searchUrl = `https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(birdName)}&srnamespace=6&srlimit=5&format=json`;

    const searchResp = await fetchWithRetry(searchUrl, {
      headers: { 'User-Agent': 'BirdTelegramBot/1.0 (https://t.me/PeroZhizni; admin@example.com)' }
    });
    if (!searchResp.ok) return null;

    const searchData = await searchResp.json();
    const results = searchData?.query?.search || [];

    for (const result of results) {
      const fileTitle = result.title; // Например: "File:Emberiza_cioides.jpg"

      // Получаем прямой URL файла через imageinfo API
      const infoUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(fileTitle)}&prop=imageinfo&iiprop=url&iiurlwidth=1200&format=json`;
      const infoResp = await fetchWithRetry(infoUrl, {
        headers: { 'User-Agent': 'BirdTelegramBot/1.0 (https://t.me/PeroZhizni; admin@example.com)' }
      });
      if (!infoResp.ok) continue;

      const infoData = await infoResp.json();
      const pages = infoData?.query?.pages || {};
      const page = Object.values(pages)[0];
      const thumbUrl = page?.imageinfo?.[0]?.thumburl;

      if (thumbUrl && validateImageQuality(thumbUrl, birdName)) {
        console.log(`✅ Wikimedia Commons fulltext нашёл фото для "${birdName}": ${thumbUrl.substring(0, 70)}...`);
        return { url: thumbUrl, source: IMAGE_SOURCES.WIKIMEDIA_COMMONS };
      }

      await delay(200);
    }

    return null;
  } catch (error) {
    throw new Error(`Wikimedia Commons fulltext search failed: ${error.message}`);
  }
}

/**
 * Поиск фото в eBird (Macaulay Library)
 */
async function searchEbirdImage(birdName, timeout) {
  try {
    const latinName = getLatinNameForBird(birdName);
    if (!latinName) return null;

    // eBird API требует точного латинского названия (или научного кода вида)
    // Но мы можем попробовать найти через JSON-запрос к их медиа-архиву
    const encodedName = encodeURIComponent(latinName);
    const url = `https://api.ebird.org/v2/ref/taxonomy/ebird?species=${encodedName}&fmt=json`;
    const resp = await fetchWithRetry(url, {
      headers: { 'X-eBirdApiToken': process.env.EBIRD_API_KEY || '' }
    });

    if (resp.ok) {
      const taxa = await resp.json();
      if (taxa.length > 0) {
        const speciesCode = taxa[0].speciesCode;
        // Macauley Library прямой URL
        const imageUrl = `https://cdn.download.ams.birds.cornell.edu/api/v1/asset/search?taxonCode=${speciesCode}&sort=rating_rank_desc&limit=1`;
        // Примечание: eBird API сложный, часто проще найти через iNaturalist
        // Но здесь мы имитируем поиск по коду вида
      }
    }
    return null;
  } catch (e) { return null; }
}

/**
 * Прямой поиск в Wikimedia Commons
 */
async function searchWikimediaCommonsDirect(birdName, timeout) {
  try {
    // Поиск по категориям
    const categories = [
      `Category:${encodeURIComponent(birdName)}`,
      `Category:Birds of Russia`,
      `Category:${encodeURIComponent(getLatinNameForBird(birdName) || birdName)}`
    ];

    for (const category of categories) {
      const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=categorymembers&gcmtitle=${category}&gcmlimit=10&prop=imageinfo&iiprop=url&iiurlwidth=1024&format=json`;

      const response = await fetchWithRetry(url, {
        headers: { 'User-Agent': 'BirdTelegramBot/1.0 (https://t.me/PeroZhizni; admin@example.com)' }
      });
      const data = await response.json();

      if (data.query && data.query.pages) {
        const pages = Object.values(data.query.pages);
        for (const page of pages) {
          if (page.imageinfo && page.imageinfo[0] && page.imageinfo[0].url) {
            const imageUrl = page.imageinfo[0].url;
            if (validateImageQuality(imageUrl, birdName)) {
              return { url: imageUrl, source: IMAGE_SOURCES.WIKIMEDIA_COMMONS };
            }
          }
        }
      }

      await delay(300);
    }

    return null;
  } catch (error) {
    throw new Error(`Wikimedia Commons search failed: ${error.message}`);
  }
}

/**
 * Поиск на iNaturalist (отличный источник реальных фото)
 */
async function searchInaturalistImage(birdName, timeout, deepSearch = false) {
  try {
    const query = deepSearch ? birdName : getLatinNameForBird(birdName);
    if (!query) return null;

    const url = `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(query)}&rank=species&per_page=5`;

    const response = await fetchWithRetry(url, {
      headers: { 'User-Agent': 'BirdTelegramBot/1.0 (https://t.me/PeroZhizni; admin@example.com)' }
    });
    const data = await response.json();

    if (data.results && data.results.length > 0) {
      const taxon = data.results[0];
      if (taxon.default_photo && taxon.default_photo.url) {
        // Преобразуем URL в высокое качество
        const highQualityUrl = taxon.default_photo.url.replace('/square.', '/medium.')
          .replace('/thumb.', '/medium.');
        if (validateImageQuality(highQualityUrl, birdName)) {
          return { url: highQualityUrl, source: IMAGE_SOURCES.INATURALIST };
        }
      }
    }

    return null;
  } catch (error) {
    throw new Error(`iNaturalist search failed: ${error.message}`);
  }
}

/**
 * Стратегии fallback для сложных случаев
 */
async function searchWithFallbackStrategies(birdName, timeout) {
  // 1. Ищем похожие птицы
  const similarBirds = findSimilarBirds(birdName);
  for (const similarBird of similarBirds.slice(0, 3)) {
    try {
      const imageUrl = await searchSingleWikipediaImage(similarBird);
      if (imageUrl && validateImageQuality(imageUrl, birdName)) {
        console.log(`✅ Нашел фото похожей птицы: ${similarBird}`);
        return { url: imageUrl, source: 'similar_bird' };
      }
      await delay(300);
    } catch (error) {
      continue;
    }
  }

  // 2. Ищем по семейству (УЛЬТИМАТИВНЫЙ FALLBACK)
  const family = getBirdFamily(birdName);
  if (family) {
    try {
      console.log(`👨‍👩‍👦 Пробую найти фото представителя семейства: ${family}`);
      // Ищем общее фото семейства или типичного представителя
      const familyImage = await searchSingleWikipediaImage(family);
      if (familyImage && validateImageQuality(familyImage, birdName)) {
        return {
          url: familyImage,
          source: 'family_fallback',
          isFamilyPhoto: true,
          familyName: family
        };
      }
    } catch (error) { }
  }

  return null;
}

/**
 * Улучшенная валидация качества фото
 */
function validateImageQuality(imageUrl, birdName) {
  if (!imageUrl) return false;

  const url = imageUrl.toLowerCase();

  // Базовые проверки
  if (!url.startsWith('http')) return false;

  // Проверяем расширение
  const validExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
  if (!validExtensions.some(ext => url.includes(ext))) return false;

  // Проверяем на иллюстрации и людей
  const illustrationKeywords = [
    'drawing', 'illustration', 'painting', 'vector', 'sketch',
    'diagram', 'silhouette', 'graphic', 'map', 'chart',
    'artwork', 'coloring', 'pattern', 'design', 'icon',
    'logo', 'clipart', 'cartoon', 'schematic'
  ];

  // Ключевые слова для обнаружения людей (для случаев типа "адъютант")
  const humanKeywords = [
    'person', 'people', 'human', 'man', 'woman', 'portrait',
    'officer', 'soldier', 'military', 'uniform', 'adjutant',
    'адъютант', 'человек', 'люди', 'портрет', 'офицер'
  ];

  let decodedUrl = url;
  try { decodedUrl = decodeURIComponent(url); } catch (e) { }

  for (const keyword of illustrationKeywords) {
    const regex = new RegExp(`(?:^|[^a-zа-яё0-9])${keyword}(?:[^a-zа-яё0-9]|$)`, 'iu');

    if (regex.test(decodedUrl)) {
      console.log(`⚠️ Это иллюстрация: содержит "${keyword}"`);
      return false;
    }
  }

  for (const keyword of humanKeywords) {
    const regex = new RegExp(`(?:^|[^a-zа-яё0-9])${keyword}(?:[^a-zа-яё0-9]|$)`, 'iu');

    if (regex.test(decodedUrl)) {
      console.log(`⚠️ Это изображение человека: содержит "${keyword}"`);
      return false;
    }
  }

  // Проверяем размер в URL (если есть)
  const sizeMatch = url.match(/(\d+)px/);
  if (sizeMatch) {
    const size = parseInt(sizeMatch[1]);
    if (size < 400) {
      console.log(`⚠️ Слишком маленькое фото: ${size}px`);
      return false;
    }
  }

  // Проверяем домены
  const trustedDomains = [
    'upload.wikimedia.org',
    'commons.wikimedia.org',
    'inaturalist.org',
    'static.inaturalist.org',
    'media.ebird.org',
    'cdn.download.ams.birds.cornell.edu',
    'inaturalist-open-data.s3.amazonaws.com'
  ];

  const isTrustedDomain = trustedDomains.some(domain => url.includes(domain));
  if (!isTrustedDomain) {
    console.log(`⚠️ Неизвестный домен: ${url.substring(0, 50)}...`);
    return false;
  }

  return true;
}

/**
 * Получение семейства птицы
 */
function getBirdFamily(birdName) {
  const familyMap = {
    'синица': 'синицы',
    'воробей': 'воробьиные',
    'голубь': 'голубиные',
    'утка': 'утковые',
    'дрозд': 'дроздовые',
    'сова': 'совиные',
    'дятел': 'дятловые',
    'ворона': 'врановые',
    'чайка': 'чайковые',
    'сокол': 'соколиные',
    'орёл': 'ястребиные',
    'ласточка': 'ласточковые',
    'соловей': 'мухоловковые',
    'жаворонок': 'жаворонковые'
  };

  const lowerName = birdName.toLowerCase();
  for (const [keyword, family] of Object.entries(familyMap)) {
    if (lowerName.includes(keyword)) {
      return family;
    }
  }

  return null;
}

// Вспомогательные функции
async function fetchWithTimeout(url, timeout) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const headers = {
      'User-Agent': 'BirdTelegramBot/1.0 (https://t.me/PeroZhizni; admin@example.com)',
      'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://commons.wikimedia.org/'
    };

    const response = await fetchWithRetry(url, {
      signal: controller.signal,
      headers: headers
    }, 3, 1500); // 3 retries, starting with 1.5s delay
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// === Функции кэширования (используют Supabase) ===
async function getCachedImage(birdName) {
  try {
    return await getCachedBirdImage(birdName);
  } catch (e) {
    console.log(`⚠️ imageSearch getCachedImage error: ${e.message}`);
    return null;
  }
}

async function cacheImage(birdName, imageUrl, source) {
  if (!imageUrl) return;
  try {
    await cacheBirdImage(birdName, imageUrl, source);
  } catch (e) {
    console.log(`⚠️ imageSearch cacheImage error: ${e.message}`);
  }
}

/**
 * Валидация изображения с помощью Gemini Vision
 */
async function validateImageWithVision(imageUrl, birdName) {
  if (!GEMINI_API_KEY) return true; // Если ключа нет, пропускаем проверку

  try {
    const latin = getLatinNameForBird(birdName) || '';
    const prompt = `Посмотри на это изображение. Изображена ли на нем птица "${birdName}"${latin ? ' (' + latin + ')' : ''}? 
Ответь ТОЛЬКО одним словом: "YES" или "NO". 
Если на картинке не птица, а карта, человек или плохой рисунок — ответь "NO".`;

    const url = `${GEMINI_BASE_URL}/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

    const response = await fetch(url, {
      method: "POST",
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: "image/jpeg", data: await getBase64Image(imageUrl) } }
          ]
        }]
      })
    });

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toUpperCase() || '';

    return text.includes("YES");
  } catch (error) {
    console.error(`⚠️ Vision validation failed: ${error.message}`);
    return true; // В случае ошибки API пропускаем, чтобы не блокировать всё
  }
}

async function getBase64Image(url) {
  const resp = await fetch(url);
  const buffer = await resp.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
}

/**
 * Возвращает латинское название птицы по русскому (краткий список)
 */
function getLatinNameForBird(birdName) {
  const latinNames = {
    "Большая синица": "Parus major", "Полевой воробей": "Passer montanus",
    "Обыкновенный снегирь": "Pyrrhula pyrrhula", "Сизый голубь": "Columba livia",
    "Кряква": "Anas platyrhynchos", "Зарянка": "Erithacus rubecula",
    "Обыкновенный скворец": "Sturnus vulgaris", "Зяблик": "Fringilla coelebs",
    "Большой пёстрый дятел": "Dendrocopos major", "Серая ворона": "Corvus cornix",
    "Сорока": "Pica pica", "Галка": "Corvus monedula",
    "Щегол": "Carduelis carduelis", "Чиж": "Spinus spinus",
    "Зимородок": "Alcedo atthis", "Удод": "Upupa epops",
    "Ушастая сова": "Asio otus", "Филин": "Bubo bubo",
    "Малый пёстрый дятел": "Dryobates minor", "Обыкновенная овсянка": "Emberiza citrinella",
    "Длиннохвостая овсянка": "Emberiza cioides", "Длиннохвостая синица": "Aegithalos caudatus",
    "Варакушка": "Luscinia svecica", "Обыкновенный поползень": "Sitta europaea",
    "Белая трясогузка": "Motacilla alba", "Обыкновенная чечевица": "Carpodacus erythrinus"
  };
  if (latinNames[birdName]) return latinNames[birdName];
  const lower = birdName.toLowerCase();
  for (const [ru, lat] of Object.entries(latinNames)) {
    if (lower.includes(ru.toLowerCase()) || ru.toLowerCase().includes(lower)) return lat;
  }
  return null;
}

/**
 * Возвращает английское название птицы по русскому (краткий список)
 */
function getEnglishNameForBird(birdName) {
  const englishNames = {
    "Большая синица": "Great Tit", "Полевой воробей": "Eurasian Tree Sparrow",
    "Сизый голубь": "Rock Dove", "Кряква": "Mallard",
    "Зарянка": "European Robin", "Обыкновенный скворец": "Common Starling",
    "Зяблик": "Common Chaffinch", "Серая ворона": "Hooded Crow",
    "Сорока": "Eurasian Magpie", "Зимородок": "Common Kingfisher",
    "Удод": "Eurasian Hoopoe",
  };
  return englishNames[birdName] || null;
}

/**
 * Возвращает список похожих птиц для поиска альтернативных фотографий
 */
function findSimilarBirds(birdName) {
  const lower = birdName.toLowerCase();
  const similarityMap = {
    'тетерев': ['глухарь', 'рябчик'], 'глухарь': ['тетерев', 'рябчик'],
    'утка': ['кряква', 'шилохвость'], 'сова': ['сыч', 'неясыть', 'филин'],
    'дятел': ['желна', 'вертишейка'], 'воробей': ['зяблик', 'коноплянка'],
    'синица': ['лазоревка', 'московка'], 'ворона': ['ворон', 'галка', 'грач'],
  };
  for (const [key, similar] of Object.entries(similarityMap)) {
    if (lower.includes(key)) return similar;
  }
  return [];
}

/**
 * Ищет фото птицы через Gemini AI (запрашивает Wikimedia URL)
 */
async function searchBirdImageWithGemini(birdName) {
  if (!GEMINI_API_KEY) return null;
  try {
    const latin = getLatinNameForBird(birdName) || 'неизвестно';
    const prompt = `Найди ПРЯМУЮ ссылку на качественную живую фотографию птицы "${birdName}" (лат. ${latin}) на ресурсах: Wikimedia Commons, Flickr (с лицензией CC), или iNaturalist.
Ответь ТОЛЬКО ссылкой (https://...), заканчивающейся на .jpg, .jpeg или .png.
Если на Flickr — выбирай прямые ссылки на статику (live.staticflickr.com).
Если не уверен — верни "NO_PHOTO".
ВАЖНО: Изображение должно быть настоящим фото живой природы, без людей и водяных знаков.`;
    const url = `${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 150 } }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    if (text === 'NO_PHOTO' || !text.startsWith('https://upload.wikimedia.org/')) return null;
    if (text.includes('.jpg') || text.includes('.jpeg') || text.includes('.png')) return text;
    return null;
  } catch (e) {
    console.log(`⚠️ imageSearch Gemini error: ${e.message}`);
    return null;
  }
}

/**
 * Возвращает дефолтное фото птицы (заглушка — null, чтобы fallback шёл в текст)
 */
function getDefaultBirdImage(birdName) {
  // Возвращаем null чтобы бот корректно переходил в текстовый режим
  return null;
}

export default {
  findBirdImage,
  validateImageQuality,
  IMAGE_SOURCES
};
