// lib/russianBirdsList.js - Получение и парсинг списка птиц России
import { fetch } from 'undici';
import * as supabase from './supabase.js';
import { normalizeBirdName, fetchWithRetry } from './utils.js';

let russianBirdsCache = null;
let lastCacheUpdate = null;
const CACHE_TTL = 24 * 60 * 60 * 1000;

// Чёрный список слов, которые не являются названиями птиц
const BLACKLIST = new Set([
  'птицы', 'россия', 'список', 'категория', 'файл', 'шаблон',
  'википедия', 'ссылки', 'примечания', 'литература', 'см. также',
  'комментарии', 'отряд', 'семейство', 'подотряд', 'триба',
  'род', 'вид', 'эндемик', 'исчезнувший', 'залётный',
  'семейства', 'отряды', 'группа', 'группы', 'подсемейство',
  // Географические и административные термины
  'автономная республика крым', 'административное деление украины',
  'республика крым', 'севастополь', 'крым', 'украина', 'россия',
  'административное деление', 'автономная республика'
]);

// Слова, которые не могут быть в названии птицы
const FORBIDDEN_PATTERNS = [
  /республика/i, /деление/i, /автономн/i, /административн/i,
  /украин/i, /росси/i, /крым/i, /севастопол/i, /область/i,
  /край/i, /округ/i, /район/i, /город/i, /поселок/i
];

// Функция проверки, является ли строка настоящим названием птицы
function isValidBirdName(name) {
  if (!name || name.length < 3 || name.length > 40) return false;

  const lowerName = name.toLowerCase();

  // Пропускаем названия, которые явно являются семействами, отрядами или группами
  // (заканчиваются на -вые, -ные, -образные)
  if (lowerName.endsWith('вые') ||
    lowerName.endsWith('ные') ||
    lowerName.endsWith('образные') ||
    lowerName.endsWith('вые)') ||
    lowerName.endsWith('ные)') ||
    lowerName.endsWith('образные)')) {
    return false;
  }

  // Проверка по чёрному списку
  for (const bad of BLACKLIST) {
    if (lowerName === bad || lowerName.includes(bad)) return false;
  }

  // Проверка по запрещённым паттернам
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(lowerName)) return false;
  }

  // Должно начинаться с заглавной буквы
  if (!/^[А-ЯЁ]/.test(name)) return false;

  // Не должно содержать специальных символов (кроме дефиса и пробела)
  if (/[0-9\(\)\[\]\{\}\<\>]/.test(name)) return false;

  // Не должно быть слишком длинным (названия птиц обычно короткие)
  if (name.length > 35) return false;

  return true;
}

// Функция очистки названия от мусора
function cleanBirdName(name) {
  return name
    .replace(/\([^)]*\)/g, '')           // Убираем скобки с содержимым
    .replace(/\[[^\]]*\]/g, '')          // Убираем квадратные скобки
    .replace(/\d+/g, '')                 // Убираем цифры
    .replace(/^\s+|\s+$/g, '')           // Убираем пробелы в начале и конце
    .replace(/\s+/g, ' ')                // Заменяем множественные пробелы на один
    .trim();
}

export async function getRussianBirdsFromWikipedia() {
  try {
    if (russianBirdsCache && lastCacheUpdate && Date.now() - lastCacheUpdate < CACHE_TTL) {
      console.log('📦 Использую кэшированный список птиц России');
      return russianBirdsCache;
    }

    console.log('🌐 Загружаю список птиц России с Википедии (HTML)...');
    const url = 'https://ru.wikipedia.org/wiki/%D0%A1%D0%BF%D0%B8%D1%81%D0%BE%D0%BA_%D0%BF%D1%82%D0%B8%D1%86_%D0%A0%D0%BE%D1%81%D1%81%D0%B8%D0%B8';
    const response = await fetchWithRetry(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const html = await response.text();
    const birds = new Set();

    const liRegex = /<li>(.*?)<\/li>/gs;
    let match;

    while ((match = liRegex.exec(html)) !== null) {
      const content = match[1];
      const cleanText = content.replace(/<[^>]*>/g, ' ').trim();

      if (/[а-яё]/i.test(cleanText) && /[a-z]/i.test(cleanText)) {
        if (cleanText.includes('Отряд') || cleanText.includes('Семейство')) continue;

        const nameMatch = cleanText.match(/^([А-ЯЁ][а-яё\s\-]+)/);
        if (nameMatch) {
          let birdName = nameMatch[1].trim();
          birdName = cleanBirdName(birdName);

          if (birdName.length > 3 && isValidBirdName(birdName)) {
            birds.add(normalizeBirdName(birdName));
          }
        }
      }
    }

    const result = [...birds];
    console.log(`📊 ПАРСЕР HTML: Найдено ${result.length} птиц из Wikipedia`);

    if (result.length > 30) {
      russianBirdsCache = result;
      lastCacheUpdate = Date.now();
      return result;
    }

    console.log('⚠️ HTML парсинг не дал результатов, пробуем API...');
    return getRussianBirdsFromWikipediaAPI();
  } catch (error) {
    console.error('❌ Wikipedia HTML parse error:', error.message);
    return getRussianBirdsFromWikipediaAPI();
  }
}

export async function getRussianBirdsFromWikipediaAPI() {
  try {
    if (russianBirdsCache && lastCacheUpdate && Date.now() - lastCacheUpdate < CACHE_TTL) {
      console.log('📦 Использую кэшированный список птиц России (API)');
      return russianBirdsCache;
    }

    console.log('🌐 Загружаю список птиц России через API Википедии...');

    // Получаем содержимое страницы через API
    const url = 'https://ru.wikipedia.org/w/api.php?action=parse&page=%D0%A1%D0%BF%D0%B8%D1%81%D0%BE%D0%BA_%D0%BF%D1%82%D0%B8%D1%86_%D0%A0%D0%BE%D1%81%D1%81%D0%B8%D0%B8&format=json&prop=text';
    const response = await fetchWithRetry(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();

    if (!data.parse || !data.parse.text) {
      throw new Error('Не удалось получить содержимое страницы');
    }

    const html = data.parse.text['*'];
    const birds = new Set();

    // Ищем все ссылки на страницы
    const linkRegex = /<a href="\/wiki\/[^"]+" title="([^"]+)">/g;
    let match;

    while ((match = linkRegex.exec(html)) !== null) {
      let title = match[1];

      // Пропускаем служебные страницы
      if (!title || title.includes(':') || title.length < 3) continue;

      // Пропускаем заголовки разделов и географические названия
      if (BLACKLIST.has(title.toLowerCase())) continue;

      // Дополнительная проверка на географические названия
      const lowerTitle = title.toLowerCase();
      if (FORBIDDEN_PATTERNS.some(p => p.test(lowerTitle))) continue;

      // Пропускаем длинные названия (это обычно описания)
      if (title.length > 35) continue;

      // Пропускаем названия, которые заканчиваются на "вые" (семейства птиц)
      if (title.endsWith('вые') || title.endsWith('вые)')) continue;

      // Пропускаем названия, которые содержат слово "вид"
      if (lowerTitle.includes('вид') && !lowerTitle.includes('птиц')) continue;

      // Очищаем название
      let cleaned = cleanBirdName(title);

      // Проверяем, что это похоже на название птицы
      if (isValidBirdName(cleaned) && /[а-яё]/i.test(cleaned)) {
        // Дополнительная проверка: не должно быть слишком длинным для птицы
        if (cleaned.split(' ').length <= 3) {
          birds.add(normalizeBirdName(cleaned));
        }
      }
    }

    // Дополнительный проход: ищем названия в ячейках таблицы
    const tdRegex = /<td[^>]*>([^<]+)<\/td>/gi;
    while ((match = tdRegex.exec(html)) !== null) {
      let candidate = match[1].trim();
      candidate = cleanBirdName(candidate);

      if (isValidBirdName(candidate) && /[а-яё]/i.test(candidate) && candidate.length > 3) {
        // Дополнительная проверка на географические названия
        const lowerCandidate = candidate.toLowerCase();
        if (!FORBIDDEN_PATTERNS.some(p => p.test(lowerCandidate))) {
          birds.add(normalizeBirdName(candidate));
        }
      }
    }

    const result = [...birds].sort();
    console.log(`📊 ПАРСЕР API: Найдено ${result.length} птиц из Wikipedia API`);
    console.log(`   Примеры: ${result.slice(0, 7).join(', ')}`);

    if (result.length > 100) {
      russianBirdsCache = result;
      lastCacheUpdate = Date.now();
      return result;
    }

    console.log('⚠️ API не дал достаточно результатов, использую резервный список');
    return getBackupRussianBirdsList();
  } catch (error) {
    console.error('❌ Wikipedia API error:', error.message);
    return getBackupRussianBirdsList();
  }
}

// Расширенный резервный список птиц
function getBackupRussianBirdsList() {
  console.log('📋 Использую резервный список птиц России');
  return [
    "Авдотка", "Азиатский кеклик", "Аист", "Альбатрос", "Альпийская галка", "Альпийская завирушка",
    "Алтайский улар", "Американский лебедь", "Амурский кобчик", "Амурский свиристель", "Арчовая чечевица",
    "Баклан", "Балобан", "Бекас", "Белая куропатка", "Белая сова", "Белая трясогузка", "Белая чайка",
    "Белобровик", "Белобрюхий рябок", "Белобрюхий стриж", "Белоголовый орлан", "Белоголовый сип",
    "Белозобый дрозд", "Белоклювая гагара", "Белокрылая крачка", "Белокрылый клёст", "Белолобый гусь",
    "Беркут", "Большая белая цапля", "Большая поганка", "Большая синица", "Большой баклан",
    "Большой крохаль", "Большой кроншнеп", "Большой пёстрый дятел", "Вальдшнеп", "Варакушка",
    "Вертишейка", "Водяной пастушок", "Воробей", "Ворон", "Ворона", "Вяхирь", "Гагара", "Галка",
    "Глухарь", "Гоголь", "Голубая сорока", "Голубь", "Горлица", "Грач", "Гусь", "Дербник",
    "Домовый воробей", "Дрозд", "Дрофа", "Дубровник", "Дятел", "Жаворонок", "Желна", "Журавль",
    "Зарянка", "Зелёная пеночка", "Зелёная щурка", "Зелёный дятел", "Зимородок", "Змееяд", "Зяблик",
    "Ибис", "Иволга", "Кайра", "Камышевка", "Камышница", "Канадская казарка", "Канюк", "Кедровка",
    "Клёст", "Клуша", "Кобчик", "Козодой", "Колибри", "Колпица", "Конёк", "Коноплянка", "Коростель",
    "Коршун", "Крапивник", "Краснозобая гагара", "Крачка", "Кречет", "Кроншнеп", "Кукушка", "Кулик",
    "Куропатка", "Ласточка", "Лебедь", "Лунь", "Лысуха", "Мандаринка", "Моевка", "Мухоловка", "Нырок",
    "Обыкновенная кукушка", "Обыкновенная овсянка", "Обыкновенная пустельга", "Обыкновенный поползень",
    "Обыкновенный скворец", "Обыкновенный соловей", "Обыкновенный стриж", "Обыкновенный фазан",
    "Овсянка", "Огарь", "Озёрная чайка", "Оляпка", "Орёл", "Орлан", "Осоед", "Павлин", "Пеликан",
    "Пеночка", "Перевозчик", "Перепел", "Песочник", "Пищуха", "Поганка", "Поморник", "Поползень",
    "Пустельга", "Ржанка", "Розовая чайка", "Розовый пеликан", "Рябчик", "Садовая камышевка",
    "Сапсан", "Свиристель", "Свиязь", "Сизоворонка", "Синица", "Сипуха", "Скворец", "Скопа", "Славка",
    "Снегирь", "Сова", "Сойка", "Соловей", "Сорока", "Сорокопут", "Сплюшка", "Стерх", "Стриж", "Сыч",
    "Тетерев", "Тетеревятник", "Травник", "Трясогузка", "Турухтан", "Удод", "Утка", "Ушастая сова",
    "Фазан", "Филин", "Фламинго", "Цапля", "Чайка", "Чеглок", "Чеграва", "Чибис", "Чиж", "Чирок", "Чомга",
    "Щегол", "Щур", "Щурка", "Юрок", "Ястреб"
  ];
}

export async function getNewRussianBirds() {
  try {
    const [all, existing] = await Promise.all([getRussianBirdsFromWikipediaAPI(), supabase.getAllBirds()]);
    const existingSet = new Set(existing.map(b => normalizeBirdName(b)));
    const newBirds = all.filter(b => !existingSet.has(normalizeBirdName(b)));
    console.log(`✨ Найдено новых птиц: ${newBirds.length}`);
    return newBirds;
  } catch (error) {
    console.error('❌ Ошибка при получении новых птиц:', error.message);
    return [];
  }
}

export async function checkBirdHasPhoto(birdName) {
  try {
    const url = `https://ru.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(birdName)}&prop=pageimages&format=json&pithumbsize=500`;
    const res = await fetchWithRetry(url);
    const data = await res.json();
    const pages = data.query.pages;
    const pageId = Object.keys(pages)[0];
    return pageId !== "-1" && pages[pageId].thumbnail;
  } catch {
    return false;
  }
}

export async function getRussianBirdsWithPhotos() {
  try {
    const all = await getRussianBirdsFromWikipediaAPI();
    const existing = await supabase.getAllBirds() || [];
    const existingSet = new Set(existing.map(b => normalizeBirdName(b)));
    const news = all.filter(b => !existingSet.has(normalizeBirdName(b)));
    const res = [];

    console.log(`📸 Проверяем наличие фото у ${Math.min(news.length, 50)} новых птиц...`);

    for (const b of news.slice(0, 50)) {
      if (await checkBirdHasPhoto(b)) {
        res.push(b);
        console.log(`✅ ${b} — есть фото`);
      }
      if (res.length >= 15) break;
      await new Promise(r => setTimeout(r, 200));
    }

    console.log(`📊 Найдено ${res.length} птиц с фото`);
    return res;
  } catch (error) {
    console.error('❌ Ошибка в getRussianBirdsWithPhotos:', error);
    return [];
  }
}

export async function getKupidoniaBirds(letter = '') {
  try {
    let url = 'https://kupidonia.ru/spisok/spisok-ptits-po-alfavitu';
    if (letter) {
      url = `https://kupidonia.ru/spisok/spisok-ptits-po-alfavitu/bukva/${encodeURIComponent(letter)}`;
    }

    console.log(`🌐 Загружаю Kupidonia: ${url}`);
    const response = await fetchWithRetry(url);
    if (!response.ok) return [];

    const html = await response.text();
    const birds = new Set();

    // Ищем названия в div с классом position_title
    const cellRegex = /<div[^>]*class="position_title"[^>]*>([^<]+)<\/div>/gi;
    let match;

    while ((match = cellRegex.exec(html)) !== null) {
      let name = match[1].trim();
      name = name.replace(/&nbsp;/g, ' ').trim();

      if (name && name.length > 2 && !name.includes('буква') && !name.includes('Перечень')) {
        let cleaned = cleanBirdName(name);
        if (isValidBirdName(cleaned)) {
          birds.add(normalizeBirdName(cleaned));
        }
      }
    }

    const result = [...birds].sort();
    console.log(`📊 Kupidonia: найдено ${result.length} птиц`);

    if (result.length > 0) {
      console.log(`   Примеры: ${result.slice(0, 5).join(', ')}`);
    }

    return result;
  } catch (error) {
    console.error('❌ Kupidonia error:', error.message);
    return [];
  }
}

export async function getAllBirdsCombined() {
  try {
    console.log('🔄 Получаю список птиц из всех источников...');

    // Пробуем получить данные из API и Kupidonia параллельно
    const [wikipediaBirds, kupidoniaBirds] = await Promise.allSettled([
      getRussianBirdsFromWikipediaAPI(),
      getKupidoniaBirds()
    ]);

    const allBirds = new Set();

    if (wikipediaBirds.status === 'fulfilled' && wikipediaBirds.value.length > 0) {
      wikipediaBirds.value.forEach(b => allBirds.add(b));
      console.log(`   ✅ Из Википедии: ${wikipediaBirds.value.length} птиц`);
    } else {
      console.log(`   ⚠️ Википедия не вернула данные, использую резервный список`);
      getBackupRussianBirdsList().forEach(b => allBirds.add(b));
    }

    if (kupidoniaBirds.status === 'fulfilled' && kupidoniaBirds.value.length > 0) {
      kupidoniaBirds.value.forEach(b => allBirds.add(b));
      console.log(`   ✅ С Kupidonia: ${kupidoniaBirds.value.length} птиц`);
    }

    const combined = [...allBirds].sort();

    console.log(`📊 ИТОГОВЫЙ СПИСОК: ${combined.length} уникальных птиц`);

    return combined;
  } catch (error) {
    console.error('❌ Ошибка при объединении списков:', error);
    return getBackupRussianBirdsList();
  }
}