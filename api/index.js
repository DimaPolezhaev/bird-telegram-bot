// api/index.js - Главный эндпоинт
export default async function handler(req, res) {
  console.log('🌐 [ROOT] Корневой эндпоинт вызван');
  
  return res.status(200).json({
    success: true,
    message: '🚀 Всё успешно! Сервер работает отлично!',
    project: 'Автоматический Telegram канал о птицах',
    version: '3.0 (полностью переработанная версия)',
    endpoints: {
      root: 'GET /',
      cron: 'POST /api/cron',
      post: 'POST /api/post',
      bot: 'POST /api/bot'
    },
    timestamp: new Date().toISOString(),
    nextPost: 'Следующий пост скоро появится',
    status: '🦜 Бот активен и готов к работе!'
  });
}