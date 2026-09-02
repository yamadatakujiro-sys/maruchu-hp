// =============================================================
//  Webhookサーバー（LINE → ここ → Claude → Sheets → 返信）
//  LINEは3秒以内の200応答を求めるので、署名検証後すぐ200を返し、
//  実処理は非同期で行う（返信は replyToken で行う）。
// =============================================================
import http from 'node:http';
import { CONFIG } from './config.mjs';
import { verifySignature, reply, sourceTarget } from './line.mjs';
import { handleText } from './handler.mjs';

async function processEvent(ev) {
  try {
    // テキストメッセージのみ対象
    if (ev.type !== 'message' || ev.message?.type !== 'text') return;

    const text = ev.message.text;
    const target = sourceTarget(ev.source);
    // セットアップ時に宛先IDを拾えるようログに出す（NOTIFY_TARGET に使う）
    console.log(`[recv] ${ev.source?.type} target=${target} text=${JSON.stringify(text)}`);

    const answer = await handleText(text);
    if (answer && ev.replyToken) {
      await reply(ev.replyToken, answer);
    }
  } catch (e) {
    console.error('[event] 処理失敗:', e.message);
    // 失敗しても現場を沈黙させない
    try {
      if (ev.replyToken) {
        await reply(ev.replyToken, 'すみません、いま処理に失敗しました🙏 もう一度送ってください。');
      }
    } catch {}
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'mochizuki-board-bot' }));
    return;
  }

  if (req.method === 'POST' && req.url === '/webhook') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks);
      const sig = req.headers['x-line-signature'];

      if (!verifySignature(rawBody, sig)) {
        console.warn('[webhook] 署名検証NG。破棄します。');
        res.writeHead(401); res.end('bad signature');
        return;
      }

      // 先に200を返す（LINEのタイムアウト対策）
      res.writeHead(200); res.end('ok');

      let payload;
      try { payload = JSON.parse(rawBody.toString('utf8')); }
      catch { console.error('[webhook] JSON解析失敗'); return; }

      for (const ev of (payload.events || [])) {
        processEvent(ev); // fire and forget
      }
    });
    return;
  }

  res.writeHead(404); res.end('not found');
});

server.listen(CONFIG.port, () => {
  console.log(`工程ボードBot 起動: http://127.0.0.1:${CONFIG.port}`);
  console.log(`Webhook: POST /webhook  ヘルスチェック: GET /health`);
  console.log(`モデル: ${CONFIG.anthropicModel} / タブ: ${CONFIG.sheetTab}`);
});
