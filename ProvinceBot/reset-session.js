/**
 * Сброс сессии пользователя в province_sessions
 * Запуск: node ProvinceBot/reset-session.js <chat_id>
 * Или без аргументов — сбросит все сессии (кроме is_admin: true)
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL2, process.env.SUPABASE_KEY);

const chatId = process.argv[2];

if (chatId) {
    // Сбросить конкретного пользователя
    const { error } = await supabase
        .from('province_sessions')
        .update({ state: 'IDLE_ADMIN', data: { photos: [] } })
        .eq('chat_id', parseInt(chatId));
    if (error) console.error('❌ Ошибка:', error);
    else console.log(`✅ Сессия ${chatId} сброшена в IDLE_ADMIN`);
} else {
    // Показать все сессии
    const { data, error } = await supabase
        .from('province_sessions')
        .select('chat_id, state, is_admin, updated_at');
    if (error) console.error('❌ Ошибка:', error);
    else {
        console.log('Текущие сессии:');
        data.forEach(s => console.log(`  chat_id=${s.chat_id} state=${s.state} is_admin=${s.is_admin} updated=${s.updated_at}`));
    }
}
process.exit(0);
