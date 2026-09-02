// =============================================================
//  LINE Messaging API 部品（署名検証・返信・push）
//  依存ゼロ（node:crypto と global fetch のみ）。
// =============================================================
import crypto from 'node:crypto';
import { CONFIG } from './config.mjs';

// --- Webhook署名検証 ---
// LINEは本文(生バイト)をchannel secretでHMAC-SHA256→base64したものを
// X-Line-Signature に入れてくる。改ざん/なりすまし防止のため必ず検証する。
export function verifySignature(rawBody, signature) {
  if (!signature) return false;
  const mac = crypto
    .createHmac('sha256', CONFIG.lineChannelSecret())
    .update(rawBody)
    .digest('base64');
  // タイミング攻撃対策で timingSafeEqual
  const a = Buffer.from(mac);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function linePost(pathname, payload) {
  const res = await fetch(`https://api.line.me/v2/bot/${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${CONFIG.lineChannelToken()}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`LINE API ${pathname} 失敗: ${res.status} ${t}`);
  }
  return res;
}

// replyToken を使った返信（無料・約30秒以内）。同じイベントに1回だけ。
export async function reply(replyToken, text) {
  return linePost('message/reply', {
    replyToken,
    messages: [{ type: 'text', text }],
  });
}

// 任意のタイミングで送るpush（通知に使う）。従量にカウントされる。
export async function push(to, text) {
  return linePost('message/push', {
    to,
    messages: [{ type: 'text', text }],
  });
}

// イベントの送信元から「返信/pushの宛先ID」を取り出す。
// グループなら groupId、1:1なら userId。
export function sourceTarget(source) {
  if (!source) return null;
  if (source.type === 'group') return source.groupId;
  if (source.type === 'room') return source.roomId;
  return source.userId || null;
}
