export default async function handler(req, res) {
  console.log('✅ Корневой эндпоинт вызван');
  
  return res.status(200).json({
    success: true,
    message: '🚀 Всё успешно! Сервер работает отлично!',
    project: 'Автоматический Telegram канал о птицах',
    endpoints: {
      root: 'GET /',
      cron: 'POST /api/cron',
      post: 'POST /api/post'
    },
    timestamp: new Date().toISOString(),
    nextPost: 'Следующий пост скоро появится',
    status: '🦜 Бот активен и готов к работе!'
  });
}