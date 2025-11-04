import fetch from 'node-fetch';

const BOT_TOKEN = "8549980803:AAG6OKU_Kh8DYhoTbCydkxylClYKWlk8H7o";
const CHANNEL_ID = "@PeroZhizni";

export async function sendBirdPostToChannel(birdData) {
  const { name, description, imageUrl, facts } = birdData;
  
  // Формируем текст поста
  let caption = `🦜 ${name.toUpperCase()} 🦜\n\n`;
  
  // Обрезаем описание если слишком длинное
  const shortDescription = description.length > 400 
    ? description.substring(0, 400) + '...' 
    : description;
  
  caption += `${shortDescription}\n\n`;
  caption += `🔍 ИНТЕРЕСНЫЕ ФАКТЫ:\n`;
  
  facts.forEach((fact, index) => {
    caption += `• ${fact}\n`;
  });
  
  caption += `\n#${name.replace(/[^a-zA-Zа-яА-Я]/g, '')} #птицы #природа #ПероЖизни`;
  
  try {
    if (imageUrl) {
      console.log(`📸 Отправляю фото: ${imageUrl}`);
      
      // Отправка с фото
      const photoUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`;
      const response = await fetch(photoUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: CHANNEL_ID,
          photo: imageUrl,
          caption: caption,
          parse_mode: 'HTML'
        })
      });
      
      const result = await response.json();
      
      if (!result.ok) {
        console.log('❌ Ошибка отправки фото, пробую текст:', result);
        // Если не удалось отправить с фото, отправляем текстом
        return await sendTextPost(caption);
      }
      
      return result;
    } else {
      console.log('📝 Отправляю текстовый пост');
      return await sendTextPost(caption);
    }
  } catch (error) {
    console.error('Ошибка отправки в Telegram:', error);
    throw error;
  }
}

async function sendTextPost(text) {
  const messageUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const response = await fetch(messageUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: CHANNEL_ID,
      text: text,
      parse_mode: 'HTML'
    })
  });
  
  return await response.json();
}