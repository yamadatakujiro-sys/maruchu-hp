/**
 * バッチコイ酒場まるちゅう - Cloudflare Worker
 *
 * 役割:
 *   - /api/chat への POST を Anthropic API へ中継（APIキーをサーバー側で保持）
 *   - それ以外は静的アセット（index.html等）を配信
 *
 * 必要なシークレット:
 *   ANTHROPIC_API_KEY  …  wrangler secret put ANTHROPIC_API_KEY で登録
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // /api/chat のみ Anthropic へ中継
    if (url.pathname === '/api/chat') {
      return handleChat(request, env);
    }

    // それ以外は静的アセット（[assets] バインディングが処理）
    return env.ASSETS.fetch(request);
  },
};

async function handleChat(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  if (!env.ANTHROPIC_API_KEY) {
    return jsonError('APIキー未設定', 500);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonError('Invalid JSON', 400);
  }

  const { messages, system, max_tokens = 512, model = 'claude-opus-4-7' } = payload;
  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonError('messages が必要です', 400);
  }

  // Anthropic API に中継
  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model, max_tokens, system, messages }),
  });

  // レスポンスをそのまま返す（CORSは同一オリジンなので不要）
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
