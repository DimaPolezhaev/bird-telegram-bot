/**
 * Умный парсер дат для ProvinceBot
 * Поддерживает форматы:
 *   - 15 мая / 15 мая 2026
 *   - 15.05 / 15.05.2026
 *   - 15/05 / 15/05/2026
 *   - 15-05 / 15-05-2026
 *   - 15 05 / 15 05 2026
 *   - май / май 2026
 *   - 5 (просто число = день)
 *   - 2026 (просто год)
 */

const MONTH_MAP = {
    'январь': 1, 'январе': 1, 'января': 1, 'янв': 1,
    'февраль': 2, 'феврале': 2, 'февраля': 2, 'фев': 2,
    'март': 3, 'марте': 3, 'марта': 3, 'мар': 3,
    'апрель': 4, 'апреле': 4, 'апреля': 4, 'апр': 4,
    'май': 5, 'маи': 5, 'мая': 5, 'мае': 5,
    'июнь': 6, 'июне': 6, 'июня': 6, 'июн': 6,
    'июль': 7, 'июле': 7, 'июля': 7, 'июл': 7,
    'август': 8, 'августе': 8, 'августа': 8, 'авг': 8,
    'сентябрь': 9, 'сентябре': 9, 'сентября': 9, 'сен': 9, 'сент': 9,
    'октябрь': 10, 'октябре': 10, 'октября': 10, 'окт': 10,
    'ноябрь': 11, 'ноябре': 11, 'ноября': 11, 'ноя': 11,
    'декабрь': 12, 'декабре': 12, 'декабря': 12, 'дек': 12,
};

const MONTH_NAMES_RU = [
    '', 'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
    'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'
];

/**
 * Парсит строку и возвращает объект { day, month, year }
 * Любое поле может быть null если не распознано.
 * 
 * @param {string} input
 * @returns {{ day: number|null, month: number|null, year: number|null, readable: string, isValid: boolean }}
 */
export function parseDate(input) {
    if (!input) return { day: null, month: null, year: null, readable: '', isValid: false };

    const text = input.trim().toLowerCase();
    let day = null, month = null, year = null;

    // Формат: DD.MM.YYYY или DD.MM или DD/MM/YYYY или DD/MM или DD-MM-YYYY или DD-MM
    const sepMatch = text.match(/^(\d{1,2})[.\-\/](\d{1,2})(?:[.\-\/](\d{4}))?$/);
    if (sepMatch) {
        day = parseInt(sepMatch[1]);
        month = parseInt(sepMatch[2]);
        if (sepMatch[3]) year = parseInt(sepMatch[3]);
        return buildResult(day, month, year);
    }

    // Формат: DD MM YYYY или DD MM (числа через пробел)
    const numSpaceMatch = text.match(/^(\d{1,2})\s+(\d{1,2})(?:\s+(\d{4}))?$/);
    if (numSpaceMatch) {
        day = parseInt(numSpaceMatch[1]);
        month = parseInt(numSpaceMatch[2]);
        if (numSpaceMatch[3]) year = parseInt(numSpaceMatch[3]);
        return buildResult(day, month, year);
    }

    // Формат: DD <месяц> YYYY или DD <месяц>
    const dayMonthMatch = text.match(/^(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?$/);
    if (dayMonthMatch) {
        day = parseInt(dayMonthMatch[1]);
        month = resolveMonth(dayMonthMatch[2]);
        if (dayMonthMatch[3]) year = parseInt(dayMonthMatch[3]);
        return buildResult(day, month, year);
    }

    // Формат: <месяц> YYYY или просто <месяц>
    const monthOnlyMatch = text.match(/^([а-яё]+)(?:\s+(\d{4}))?$/);
    if (monthOnlyMatch) {
        month = resolveMonth(monthOnlyMatch[1]);
        if (monthOnlyMatch[2]) year = parseInt(monthOnlyMatch[2]);
        if (month) return buildResult(null, month, year);
    }

    // Просто год (4 цифры)
    const yearOnly = text.match(/^(\d{4})$/);
    if (yearOnly) {
        year = parseInt(yearOnly[1]);
        if (year >= 1800 && year <= 2100) return buildResult(null, null, year);
    }

    // Просто число (день)
    const dayOnly = text.match(/^(\d{1,2})$/);
    if (dayOnly) {
        day = parseInt(dayOnly[1]);
        if (day >= 1 && day <= 31) return buildResult(day, null, null);
    }

    return { day: null, month: null, year: null, readable: text, isValid: false };
}

function resolveMonth(str) {
    return MONTH_MAP[str] || null;
}

function buildResult(day, month, year) {
    // Валидация диапазонов
    if (day !== null && (day < 1 || day > 31)) day = null;
    if (month !== null && (month < 1 || month > 12)) month = null;
    if (year !== null && (year < 1800 || year > 2100)) year = null;

    const isValid = (day !== null || month !== null || year !== null);

    let parts = [];
    if (day !== null) parts.push(`${day}`);
    if (month !== null) parts.push(MONTH_NAMES_RU[month]);
    if (year !== null) parts.push(`${year}`);
    const readable = parts.join(' ');

    return { day, month, year, readable, isValid };
}

/**
 * Строит Supabase-фильтр для поиска событий
 * @param {object} query - Supabase query builder
 * @param {{ day, month, year }} parsed
 * @returns query с применёнными фильтрами
 */
export function applyDateFilter(query, parsed) {
    if (parsed.day !== null) query = query.eq('day', parsed.day);
    if (parsed.month !== null) query = query.eq('month', parsed.month);
    if (parsed.year !== null) query = query.eq('year', parsed.year);
    return query;
}

/**
 * Описание того, что было распознано
 */
export function describeParsed(parsed) {
    if (!parsed.isValid) return null;
    let parts = [];
    if (parsed.day !== null) parts.push(`день: ${parsed.day}`);
    if (parsed.month !== null) parts.push(`месяц: ${MONTH_NAMES_RU[parsed.month]}`);
    if (parsed.year !== null) parts.push(`год: ${parsed.year}`);
    return parts.join(', ');
}
