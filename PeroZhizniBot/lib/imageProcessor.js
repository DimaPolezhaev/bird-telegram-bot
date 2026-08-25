// lib/imageProcessor.js
import { fetch } from 'undici';
import sharp from 'sharp';
import { captureError } from './sentry.js';

/**
 * Скачивает изображение по URL и конвертирует его в оптимизированный WebP.
 * Возвращает Buffer.
 */
export async function processImageToWebP(imageUrl) {
    try {
        console.log(`🖼️ Начало обработки изображения: ${imageUrl.substring(0, 50)}...`);

        const response = await fetch(imageUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; BirdTelegramBot/1.0; +https://t.me/PeroZhizni)',
                'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
                'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
                'Referer': 'https://ru.wikipedia.org/'
            },
            redirect: 'follow'
        });

        if (!response.ok) {
            throw new Error(`Не удалось скачать изображение: ${response.status} ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Конвертация в WebP с оптимизацией
        const processedBuffer = await sharp(buffer)
            .resize(1280, 1280, {
                fit: 'inside',
                withoutEnlargement: true
            })
            .webp({ quality: 80 })
            .toBuffer();

        console.log(`✅ Изображение оптимизировано. Размер: ${(processedBuffer.length / 1024).toFixed(1)} KB`);

        return processedBuffer;
    } catch (error) {
        captureError(error, { imageUrl, stage: 'image_processing' });
        console.error(`❌ Ошибка обработки изображения: ${error.message}`);
        return null;
    }
}
