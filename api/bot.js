// api/bot.js - Webhook для Telegram
import { handleTelegramUpdate } from '../lib/botManager.js';

export default async function handler(req, res) {
  console.log('🤖 [BOT] Webhook получен');
  
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  
  try {
    const update = req.body;
    console.log('🔄 Update ID:', update.update_id);
    
    // Обрабатываем обновление от Telegram
    await handleTelegramUpdate(update);
    
    res.status(200).json({ ok: true });
    
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(200).json({ ok: false, error: error.message });
  }
}