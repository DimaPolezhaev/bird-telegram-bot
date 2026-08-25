// lib/utils.js - Утилитарные функции

/**
 * Нормализует название птицы
 */
export function normalizeBirdName(birdName) {
  if (!birdName) return '';

  // Убираем символы ударения (U+0301 — комбинируемый акцент)
  // чтобы "Овся́нка" и "Овсянка" считались одним и тем же видом
  const withoutAccents = birdName
    .normalize('NFD')
    .replace(/\u0301/g, '')
    .normalize('NFC');

  const normalized = withoutAccents.toLowerCase().trim().replace(/\s+/g, ' ');
  const cleaned = normalized.replace(/[^\w\sа-яё-]/gi, '');

  return cleaned.split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Обертка над fetch с механизмом повторных попыток (Exponential Backoff)
 * Добавлены заголовки браузера для обхода блокировок
 */
export async function fetchWithRetry(url, options = {}, retries = 3, backoff = 1000) {
  // Заголовки, имитирующие реальный браузер (обход блокировки Kupidonia и других сайтов)
  const defaultHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0'
  };

  // Объединяем переданные заголовки с заголовками по умолчанию
  const finalOptions = {
    ...options,
    headers: {
      ...defaultHeaders,
      ...(options.headers || {})
    }
  };

  try {
    const { fetch } = await import('undici');
    const response = await fetch(url, finalOptions);

    // Если всё отлично, или это ошибка клиента (400, 401, 403, 404), возвращаем сразу (кроме 429)
    if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
      return response;
    }

    // Если это серверная ошибка (5xx) или 429 Too Many Requests, пробуем снова
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  } catch (error) {
    if (retries > 0) {
      console.log(`⚠️ Ошибка сети (${error.message}) для ${url.substring(0, 60)}... Попыток осталось: ${retries}. Ждем ${backoff}ms...`);
      await new Promise(resolve => setTimeout(resolve, backoff));
      return fetchWithRetry(url, options, retries - 1, backoff * 2);
    } else {
      console.error(`❌ Исчерпаны попытки запроса к ${url.split('?')[0]}: ${error.message}`);
      throw error;
    }
  }
}