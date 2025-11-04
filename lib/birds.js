import fetch from 'node-fetch';

const GEMINI_API_KEY = "AIzaSyBU4Qvoc_gBsJ_EjD6OeToGl9cDrInANSg";
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

// Большой список известных птиц для гарантии
const KNOWN_BIRDS = [
  "Снегирь", "Синица", "Воробей", "Сова", "Орёл", "Попугай", "Колибри", 
  "Фламинго", "Павлин", "Лебедь", "Аист", "Голубь", "Сокол", "Ястреб",
  "Пингвин", "Чайка", "Утка", "Кукушка", "Дятел", "Ласточка", "Стриж",
  "Скворец", "Грач", "Ворона", "Сорока", "Иволга", "Соловей", "Дрозд",
  "Журавль", "Цапля", "Пеликан", "Гриф", "Кондор", "Канюк", "Пустельга",
  "Филин", "Сыч", "Неясыть", "Зимородок", "Удод", "Щегол", "Зяблик",
  "Чиж", "Клест", "Свиристель", "Овсянка", "Чечетка", "Чеглок", "Кобчик",
  "Дербник", "Лунь", "Коршун", "Беркут", "Сапсан", "Балобан", "Кречет",
  "Тетерев", "Глухарь", "Рябчик", "Куропатка", "Перепел", "Фазан",
  "Тукан", "Птица-носорог", "Райская птица", "Кетцаль", "Мандаринка",
  "Гага", "Казарка", "Гусь", "Лебедь-шипун", "Лебедь-кликун",
  "Поганка", "Гагара", "Баклан", "Олуша", "Фрегат", "Буревестник",
  "Альбатрос", "Качурка", "Крачка", "Погоныш", "Лысуха", "Пастушок",
  "Серпоклюв", "Шилоклювка", "Ходулочник", "Кулик-сорока", "Веретенник",
  "Кроншнеп", "Вальдшнеп", "Бекас", "Дупель", "Гаршнеп", "Турухтан",
  "Песочник", "Черныш", "Фифи", "Перевозчик", "Мородунка", "Камнешарка",
  "Кваква", "Выпь", "Волчок", "Цапля серая", "Цапля белая", "Цапля рыжая",
  "Каравайка", "Колпица", "Ибис", "Фламинго розовый", "Аист белый",
  "Аист черный", "Марабу", "Пеликан розовый", "Пеликан кудрявый",
  "Баклан большой", "Баклан хохлатый", "Змееяд", "Орлан-белохвост",
  "Орлан-долгохвост", "Скопа", "Осоед", "Зимняк", "Курганник", "Канюк"
];

export async function getRandomBirdData() {
  try {
    // 80% chance - использовать известную птицу, 20% - случайную из Wikipedia
    const useKnownBird = Math.random() < 0.8;
    
    let birdName;
    if (useKnownBird) {
      // Берем случайную птицу из известного списка
      birdName = KNOWN_BIRDS[Math.floor(Math.random() * KNOWN_BIRDS.length)];
      console.log(`🎯 Выбрана известная птица: ${birdName}`);
    } else {
      // Пробуем найти случайную птицу в Wikipedia
      birdName = await findRandomBirdInWikipedia();
      if (!birdName) {
        // Если не нашли, берем из известного списка
        birdName = KNOWN_BIRDS[Math.floor(Math.random() * KNOWN_BIRDS.length)];
        console.log(`🔄 Не нашли в Wikipedia, используем известную: ${birdName}`);
      }
    }
    
    // Получаем данные о птице
    const wikiData = await getBirdWikiData(birdName);
    const facts = await generateBirdFactsWithGemini(birdName, wikiData.extract);
    const imageUrl = await findBestBirdImage(birdName);
    
    return {
      name: birdName,
      description: wikiData.extract || generateDefaultDescription(birdName),
      imageUrl: imageUrl,
      facts: facts
    };
    
  } catch (error) {
    console.error('Ошибка:', error);
    return await getFallbackBirdData();
  }
}

async function findRandomBirdInWikipedia() {
  try {
    // Ищем страницы из категории птиц
    const categoryUrl = `https://ru.wikipedia.org/w/api.php?action=query&list=categorymembers&cmtitle=Категория:Птицы_по_алфавиту&cmtype=page&cmlimit=50&format=json`;
    const response = await fetch(categoryUrl);
    const data = await response.json();
    
    // ✅ ДОБАВЬ ПРОВЕРКУ ФОРМАТА ОТВЕТА
    if (data.query && data.query.categorymembers && data.query.categorymembers.length > 0) {
      const birds = data.query.categorymembers;
      const randomBird = birds[Math.floor(Math.random() * birds.length)];
      return randomBird.title;
    }
    
    console.log('❌ Не найдено птиц в Wikipedia категории');
    return null;
    
  } catch (error) {
    console.log('Ошибка поиска в Wikipedia:', error);
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
    console.log('Ошибка получения данных Wikipedia:', error);
    return { 
      extract: generateDefaultDescription(birdName),
      thumbnail: null 
    };
  }
}

async function findBestBirdImage(birdName) {
  try {
    // 1. Пробуем Wikipedia
    const wikiData = await getBirdWikiData(birdName);
    if (wikiData.thumbnail) {
      console.log(`📸 Найдено фото в Wikipedia: ${birdName}`);
      return wikiData.thumbnail.source;
    }
    
    // 2. Пробуем Wikimedia Commons
    const commonsImage = await findCommonsImage(birdName);
    if (commonsImage) {
      console.log(`📸 Найдено фото в Commons: ${birdName}`);
      return commonsImage;
    }
    
    // 3. Используем резервные фото для известных птиц
    const backupImage = getBackupBirdImage(birdName);
    if (backupImage) {
      console.log(`📸 Используем резервное фото: ${birdName}`);
      return backupImage;
    }
    
    console.log(`❌ Не найдено фото для: ${birdName}`);
    return null;
    
  } catch (error) {
    console.log('Ошибка поиска изображения:', error);
    return getBackupBirdImage(birdName);
  }
}

async function findCommonsImage(birdName) {
  try {
    const commonsUrl = `https://commons.wikimedia.org/w/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(birdName)}&srnamespace=6&srlimit=5`;
    const response = await fetch(commonsUrl);
    const data = await response.json();
    
    if (data.query.search.length > 0) {
      // Ищем лучшее изображение (с "bird" в названии)
      const bestImage = data.query.search.find(img => 
        img.title.toLowerCase().includes('bird') || 
        img.title.toLowerCase().includes('птиц')
      ) || data.query.search[0];
      
      const filename = bestImage.title.replace('File:', '');
      return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=800`;
    }
    return null;
  } catch (error) {
    return null;
  }
}

function getBackupBirdImage(birdName) {
  const backupImages = {
    "Снегирь": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/33/Pyrrhula_pyrrhula_-Rila_Mountains%2C_Bulgaria_-male-8.jpg/800px-Pyrrhula_pyrrhula_-Rila_Mountains%2C_Bulgaria_-male-8.jpg",
    "Сова": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3c/Bubo_bubo_-_Eagle_Owl_-_Uhu.jpg/800px-Bubo_bubo_-_Eagle_Owl_-_Uhu.jpg",
    "Орёл": "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Aquila_chrysaetos_-_01.jpg/800px-Aquila_chrysaetos_-_01.jpg",
    "Попугай": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1e/Melopsittacus_undulatus_-Atlanta_Zoo%2C_Georgia%2C_USA-8a.jpg/800px-Melopsittacus_undulatus_-Atlanta_Zoo%2C_Georgia%2C_USA-8a.jpg",
    "Колибри": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/09/Hummingbird.jpg/800px-Hummingbird.jpg",
    "Фламинго": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3b/Flamingos_Los_Roquetes.jpg/800px-Flamingos_Los_Roquetes.jpg",
    "Павлин": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/Peacock_Plumage.jpg/800px-Peacock_Plumage.jpg",
    "Лебедь": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/38/CygneVaires.jpg/800px-CygneVaires.jpg",
    "Аист": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/61/White_Stork_-_Ciconia_ciconia.jpg/800px-White_Stork_-_Ciconia_ciconia.jpg",
    "Пингвин": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/07/Emperor_Penguin_Manchot_empereur.jpg/800px-Emperor_Penguin_Manchot_empereur.jpg",
    "Сокол": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8e/Falco_peregrinus_-_01.jpg/800px-Falco_peregrinus_-_01.jpg",
    "Дятел": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/be/Dendrocopos_major_-_01.jpg/800px-Dendrocopos_major_-_01.jpg"
  };
  
  return backupImages[birdName] || null;
}

function generateDefaultDescription(birdName) {
  const descriptions = [
    `${birdName} - удивительная птица с уникальными особенностями и поведением.`,
    `Птица ${birdName} обладает прекрасными адаптациями к своей среде обитания.`,
    `${birdName} относится к удивительному миру птиц с разнообразными повадками.`,
    `Интересная птица ${birdName} демонстрирует разнообразие животного мира.`
  ];
  
  return descriptions[Math.floor(Math.random() * descriptions.length)];
}

async function generateBirdFactsWithGemini(birdName, description) {
  try {
    const prompt = `Придумай 3 интересных и достоверных факта о птице "${birdName}". 
    ${description ? `Контекст: ${description}` : ''}
    
    Требования:
    - Только проверенные научные факты
    - Коротко и увлекательно (максимум 80 символов на факт)
    - Формат: каждый факт с новой строки начинается с •
    - Язык: русский
    - Темы: особенности поведения, анатомия, среда обитания, питание`;
    
    // ✅ ИСПРАВЛЕННЫЙ PAYLOAD (как в твоем рабочем коде)
    const payload = {
      contents: [{
        role: "user",
        parts: [{
          text: prompt
        }]
      }]
    };
    
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });
    
    const data = await response.json();
    console.log('🔍 Raw Gemini response:', JSON.stringify(data, null, 2));
    
    // Проверка ответа
    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
      console.log('❌ Неверный формат ответа от Gemini');
      return getDefaultFacts(birdName);
    }
    
    const text = data.candidates[0].content.parts[0].text;
    console.log(`✅ Gemini ответ получен: ${text.substring(0, 100)}...`);
    
    // Обрабатываем ответ
    const facts = text.split('\n')
      .filter(line => line.trim().startsWith('•'))
      .map(fact => fact.replace(/^•\s*/, '').trim())
      .filter(fact => fact.length > 10 && fact.length < 100)
      .slice(0, 3);
    
    if (facts.length === 0) {
      console.log('❌ Не удалось извлечь факты');
      return getDefaultFacts(birdName);
    }
    
    return facts;
    
  } catch (error) {
    console.error('Gemini error:', error);
    return getDefaultFacts(birdName);
  }
}

// ✅ ДОБАВЬ ЭТУ ФУНКЦИЮ ДЛЯ РЕЗЕРВНЫХ ФАКТОВ
function getDefaultFacts(birdName) {
  const defaultFacts = {
    "Клест": [
      "Имеет уникальный перекрещенный клюв для извлечения семян",
      "Может гнездоваться даже зимой в сильные морозы",
      "Питается почти исключительно семенами хвойных деревьев"
    ],
    "Сова": [
      "Может поворачивать голову на 270 градусов",
      "Имеет бесшумный полет благодаря особому оперению",
      "Охотится преимущественно ночью"
    ],
    "Колибри": [
      "Единственная птица, способная летать задом наперед",
      "Делает до 100 взмахов крыльями в секунду",
      "Питается нектаром цветов"
    ],
    "Пингвин": [
      "Не умеет летать, но отлично плавает",
      "Может выдерживать температуры до -60°C",
      "Совершает длительные миграции в поисках пищи"
    ],
    "Дрозд": [
      "Обладает красивым мелодичным пением",
      "Питается насекомыми, червями и ягодами",
      "Строит прочные гнезда из глины и травы"
    ],
    "Снегирь": [
      "Самцы имеют ярко-красную грудку, самки - серую",
      "Зимой часто прилетают в города в поисках пищи",
      "Питаются семенами, почками и ягодами"
    ],
    "Синица": [
      "Одна из самых полезных птиц для садоводов",
      "Может делать до 1000 кормовых вылетов в день",
      "Зимой нуждается в подкормке от людей"
    ],
    "Воробей": [
      "Живут большими стаями рядом с человеком",
      "За день съедают пищи больше собственного веса",
      "Распространены по всему миру, кроме Антарктиды"
    ]
  };
  
  // Если есть специальные факты для этой птицы - используем их
  if (defaultFacts[birdName]) {
    return defaultFacts[birdName];
  }
  
  // Иначе общие факты
  return [
    "Обладает уникальными адаптациями к среде обитания",
    "Играет важную роль в экосистеме", 
    "Имеет интересные особенности поведения"
  ];
}

async function getFallbackBirdData() {
  // Всегда возвращаем известную птицу с фото
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
      name: "Колибри", 
      image: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/09/Hummingbird.jpg/800px-Hummingbird.jpg",
      description: "Колибри - самые маленькие птицы в мире. Могут летать задом наперед и зависать в воздухе."
    }
  ];
  
  const bird = fallbackBirds[Math.floor(Math.random() * fallbackBirds.length)];
  const facts = await generateBirdFactsWithGemini(bird.name, bird.description);
  
  return {
    name: bird.name,
    description: bird.description,
    imageUrl: bird.image,
    facts: facts
  };
}