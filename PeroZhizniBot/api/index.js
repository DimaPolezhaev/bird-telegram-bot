// api/index.js - Главная страница проекта
export default async function handler(req, res) {
  console.log('🌐 [ROOT] Показ красивой главной страницы');

  const html = `
  <!DOCTYPE html>
  <html lang="ru">
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>PeroZhizni — Птицы в Telegram</title>
      <style>
          :root {
              --primary: #22c55e;
              --primary-dark: #16a34a;
              --bg: #052e16;
              --card: rgba(255, 255, 255, 0.05);
              --text: #f0fdf4;
          }
          body {
              font-family: 'Inter', system-ui, sans-serif;
              background: radial-gradient(circle at top right, #064e3b, var(--bg));
              color: var(--text);
              margin: 0;
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 20px;
          }
          .card {
              background: var(--card);
              backdrop-filter: blur(12px);
              border: 1px solid rgba(255, 255, 255, 0.1);
              padding: 40px;
              border-radius: 24px;
              max-width: 600px;
              width: 100%;
              box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
              text-align: center;
          }
          .badge {
              background: rgba(34, 197, 94, 0.2);
              color: var(--primary);
              padding: 6px 12px;
              border-radius: 99px;
              font-size: 0.8rem;
              font-weight: 600;
              display: inline-block;
              margin-bottom: 20px;
          }
          h1 {
              font-size: 2.5rem;
              margin: 0 0 10px 0;
              letter-spacing: -1px;
          }
          p {
              color: #a7f3d0;
              line-height: 1.6;
              margin-bottom: 30px;
          }
          .grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 15px;
              text-align: left;
          }
          .item {
              background: rgba(255,255,255,0.03);
              padding: 15px;
              border-radius: 12px;
              border: 1px solid rgba(255,255,255,0.05);
          }
          .item-title {
              font-size: 0.7rem;
              color: #6ee7b7;
              text-transform: uppercase;
              margin-bottom: 5px;
          }
          .item-value {
              font-weight: 500;
              font-size: 0.9rem;
          }
          .btn {
              display: inline-block;
              margin-top: 30px;
              background: var(--primary);
              color: var(--bg);
              text-decoration: none;
              padding: 12px 30px;
              border-radius: 12px;
              font-weight: bold;
              transition: 0.2s;
          }
          .btn:hover {
              background: #4ade80;
              transform: translateY(-2px);
          }
      </style>
  </head>
  <body>
      <div class="card">
          <div class="badge">Version 5.0 (AI Vision)</div>
          <h1>PeroZhizniBot 🦜</h1>
          <p>Автоматическая система публикации контента о птицах с использованием нейросетей Gemini для анализа и валидации.</p>
          
          <div class="grid">
              <div class="item">
                  <div class="item-title">Monitoring</div>
                  <div class="item-value">Sentry Active ✅</div>
              </div>
              <div class="item">
                  <div class="item-title">Processing</div>
                  <div class="item-value">Sharp WebP ✅</div>
              </div>
              <div class="item">
                  <div class="item-title">AI Valdiation</div>
                  <div class="item-value">Gemini Vision ✅</div>
              </div>
              <div class="item">
                  <div class="item-title">Admin Panel</div>
                  <div class="item-value"><a href="/admin" style="color:white">Go to Admin</a></div>
              </div>
          </div>

          <a href="https://t.me/PeroZhizni" class="btn">Открыть канал</a>
      </div>
  </body>
  </html>
  `;

  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(html);
}