// =============================================================
//  Google Sheets 部品（サービスアカウントで読み書き）
//  依存ゼロ。JWTを自前で署名して access token を取得し、
//  Sheets REST API を fetch で叩く（googleapis パッケージ不要）。
// =============================================================
import crypto from 'node:crypto';
import { CONFIG } from './config.mjs';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

let cachedToken = null; // { token, exp(ms) }

function base64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// サービスアカウントの秘密鍵で JWT(RS256) を作る
function buildJwt() {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: CONFIG.googleClientEmail(),
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const signature = crypto.createSign('RSA-SHA256')
    .update(unsigned)
    .sign(CONFIG.googlePrivateKey());
  return `${unsigned}.${base64url(signature)}`;
}

async function getAccessToken() {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token;
  const jwt = buildJwt();
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Google トークン取得失敗: ${res.status} ${t}`);
  }
  const json = await res.json();
  cachedToken = { token: json.access_token, exp: Date.now() + (json.expires_in || 3600) * 1000 };
  return cachedToken.token;
}

function api(pathAndQuery) {
  return `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.sheetId()}${pathAndQuery}`;
}

// range 例: "工程ボード!A2:I" 。タブ名にスペースや日本語があってもOK。
function encRange(range) {
  return encodeURIComponent(range);
}

export async function readValues(range) {
  const token = await getAccessToken();
  const res = await fetch(api(`/values/${encRange(range)}`), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Sheets 読み取り失敗(${range}): ${res.status} ${t}`);
  }
  const json = await res.json();
  return json.values || [];
}

// 指定セル範囲を上書き。values は2次元配列。
export async function updateValues(range, values) {
  const token = await getAccessToken();
  const res = await fetch(api(`/values/${encRange(range)}?valueInputOption=USER_ENTERED`), {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Sheets 更新失敗(${range}): ${res.status} ${t}`);
  }
  return res.json();
}

// 末尾に行を追加。
export async function appendValues(range, values) {
  const token = await getAccessToken();
  const res = await fetch(
    api(`/values/${encRange(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`),
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values }),
    }
  );
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Sheets 追加失敗(${range}): ${res.status} ${t}`);
  }
  return res.json();
}
