#!/usr/bin/env node
// =============================================================
// AIオフィス 画像生成ツール（gen-image.mjs）
// デザイナー社員が「写真クオリティ」の画像を生成するための部品。
// Replicate API 経由で複数の画像生成モデルを呼び出す。
//
// 使い方（単発）:
//   node gen-image.mjs --prompt "a cat" --out ./cat.png --model flux-1.1-pro --aspect 9:16
//   node gen-image.mjs --prompt-file ./prompt.txt --out ./poster.png --model ideogram-v2 --aspect 9:16
//
// 使い方（3モデル並列比較・デザイナー標準）:
//   node gen-image.mjs --prompt-file ./prompt.txt --outdir ./out --name poster \
//        --models flux-1.1-pro,ideogram-v2,recraft-v3 --aspect 9:16
//   → out/poster-flux-1.1-pro.png / out/poster-ideogram-v2.png / out/poster-recraft-v3.png
//
// APIキーの読み込み順（最初に見つかったものを使う）:
//   1) 環境変数 REPLICATE_API_TOKEN
//   2) $OFFICE_HOME/.image-api-key （ファイルの1行目にトークンを書く）
//   3) このスクリプトと同じ階層 / ひとつ上の .image-api-key
// セットアップ手順は docs/IMAGE-GEN-SETUP.md 参照。
// =============================================================

import { writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- モデル定義（Replicateのモデルスラッグ＋入力の組み立て方）-----------------
// フレンドリー名 → { slug, build(prompt, aspect) }
// aspect は "9:16" 等。写真=flux系、文字重視=ideogram/recraft。
const MODELS = {
  // 写真クオリティ・最有力（やや高コスト）
  'flux-1.1-pro': {
    slug: 'black-forest-labs/flux-1.1-pro',
    build: (prompt, aspect) => ({ prompt, aspect_ratio: aspect, output_format: 'png', prompt_upsampling: true }),
  },
  // 写真クオリティ・安価
  'flux-dev': {
    slug: 'black-forest-labs/flux-dev',
    build: (prompt, aspect) => ({ prompt, aspect_ratio: aspect, output_format: 'png' }),
  },
  // 最速・最安（下書き用）
  'flux-schnell': {
    slug: 'black-forest-labs/flux-schnell',
    build: (prompt, aspect) => ({ prompt, aspect_ratio: aspect, output_format: 'png' }),
  },
  // 文字（ロゴ・タイポ）が崩れにくい
  'ideogram-v2': {
    slug: 'ideogram-ai/ideogram-v2',
    build: (prompt, aspect) => ({ prompt, aspect_ratio: toIdeogramAspect(aspect), resolution: 'None', magic_prompt_option: 'Auto' }),
  },
  // ポスター・グラフィック＋文字に強い
  'recraft-v3': {
    slug: 'recraft-ai/recraft-v3',
    build: (prompt, aspect) => ({ prompt, size: toRecraftSize(aspect) }),
  },
};

// Ideogram の aspect 表記（例: 9:16 → "ASPECT_9_16"）
function toIdeogramAspect(aspect) {
  const map = {
    '1:1': 'ASPECT_1_1', '16:9': 'ASPECT_16_9', '9:16': 'ASPECT_9_16',
    '4:3': 'ASPECT_4_3', '3:4': 'ASPECT_3_4', '3:2': 'ASPECT_3_2', '2:3': 'ASPECT_2_3',
  };
  return map[aspect] || 'ASPECT_1_1';
}

// Recraft はサイズ文字列指定（近い比率にマッピング）
function toRecraftSize(aspect) {
  const map = {
    '1:1': '1024x1024', '9:16': '1024x1820', '16:9': '1820x1024',
    '3:4': '1024x1365', '4:3': '1365x1024', '2:3': '1024x1536', '3:2': '1536x1024',
  };
  return map[aspect] || '1024x1024';
}

// --- 引数パース --------------------------------------------------------------
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) { args[key] = true; }
      else { args[key] = next; i++; }
    }
  }
  return args;
}

// --- APIキー解決 -------------------------------------------------------------
async function resolveToken() {
  if (process.env.REPLICATE_API_TOKEN) return process.env.REPLICATE_API_TOKEN.trim();
  const candidates = [
    process.env.OFFICE_HOME ? join(process.env.OFFICE_HOME, '.image-api-key') : null,
    join(__dirname, '.image-api-key'),
    join(__dirname, '..', '.image-api-key'),
    join(__dirname, '..', 'config', '.image-api-key'),
  ].filter(Boolean);
  for (const p of candidates) {
    if (existsSync(p)) {
      const t = (await readFile(p, 'utf8')).split('\n')[0].trim();
      if (t) return t;
    }
  }
  return null;
}

// --- Replicate 呼び出し（Prefer: wait で同期待ち＋念のためポーリング）--------
async function generateOne({ token, model, prompt, aspect, outPath }) {
  const def = MODELS[model];
  if (!def) throw new Error(`未知のモデル: ${model}（使えるモデル: ${Object.keys(MODELS).join(', ')}）`);
  const input = def.build(prompt, aspect);

  const res = await fetch(`https://api.replicate.com/v1/models/${def.slug}/predictions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Prefer': 'wait',
    },
    body: JSON.stringify({ input }),
  });

  if (res.status === 401) throw new Error('APIキーが無効です（401）。docs/IMAGE-GEN-SETUP.md を確認してください。');
  if (res.status === 402) throw new Error('課金設定が必要です（402）。Replicateにカード登録／クレジット追加をしてください。');
  if (!res.ok) throw new Error(`Replicate APIエラー（${res.status}）: ${(await res.text()).slice(0, 300)}`);

  let pred = await res.json();

  // Prefer:wait でも未完了なら getUrl をポーリング（最大5分）
  const started = Date.now();
  while (pred.status && !['succeeded', 'failed', 'canceled'].includes(pred.status)) {
    if (Date.now() - started > 5 * 60 * 1000) throw new Error('生成がタイムアウトしました（5分）。');
    await new Promise(r => setTimeout(r, 2000));
    const getUrl = pred.urls && pred.urls.get;
    if (!getUrl) break;
    pred = await (await fetch(getUrl, { headers: { 'Authorization': `Bearer ${token}` } })).json();
  }

  if (pred.status === 'failed') throw new Error(`生成失敗: ${pred.error || '不明なエラー'}`);

  // output は string / string[] / {url} の可能性がある
  let url = pred.output;
  if (Array.isArray(url)) url = url[0];
  if (url && typeof url === 'object' && url.url) url = url.url;
  if (!url || typeof url !== 'string') throw new Error(`画像URLが取得できませんでした（output: ${JSON.stringify(pred.output).slice(0, 200)}）`);

  const imgRes = await fetch(url);
  if (!imgRes.ok) throw new Error(`画像ダウンロード失敗（${imgRes.status}）`);
  const buf = Buffer.from(await imgRes.arrayBuffer());
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, buf);
  return outPath;
}

// --- メイン ------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.h) {
    console.log('使い方はファイル冒頭のコメント、または docs/IMAGE-GEN-SETUP.md を参照。');
    console.log('使えるモデル:', Object.keys(MODELS).join(', '));
    process.exit(0);
  }

  const token = await resolveToken();
  if (!token) {
    console.error('❌ APIキーが見つかりません。');
    console.error('   $OFFICE_HOME/.image-api-key にReplicateのトークンを1行で保存してください。');
    console.error('   手順: docs/IMAGE-GEN-SETUP.md');
    process.exit(2);
  }

  // プロンプト（文字列 or ファイル）
  let prompt = args.prompt;
  if (args['prompt-file']) prompt = (await readFile(args['prompt-file'], 'utf8')).trim();
  if (!prompt || prompt === true) { console.error('❌ --prompt か --prompt-file が必要です。'); process.exit(2); }

  const aspect = (typeof args.aspect === 'string') ? args.aspect : '1:1';

  // 複数モデル or 単発
  const models = args.models ? String(args.models).split(',').map(s => s.trim()).filter(Boolean)
                             : [ (typeof args.model === 'string') ? args.model : 'flux-1.1-pro' ];

  const results = [];
  for (const model of models) {
    // 出力パス決定
    let outPath;
    if (models.length > 1 || args.outdir) {
      const outdir = (typeof args.outdir === 'string') ? args.outdir : '.';
      const name = (typeof args.name === 'string') ? args.name : 'image';
      outPath = join(outdir, `${name}-${model}.png`);
    } else {
      outPath = (typeof args.out === 'string') ? args.out : `./${model}.png`;
    }

    try {
      console.log(`🎨 生成中: model=${model} aspect=${aspect} → ${outPath}`);
      const saved = await generateOne({ token, model, prompt, aspect, outPath });
      console.log(`✅ 完成: ${saved}`);
      results.push({ model, ok: true, path: saved });
    } catch (e) {
      console.error(`⚠️ ${model} 失敗: ${e.message}`);
      results.push({ model, ok: false, error: e.message });
    }
  }

  const okCount = results.filter(r => r.ok).length;
  console.log(`\n=== 完了: ${okCount}/${results.length} 成功 ===`);
  results.filter(r => r.ok).forEach(r => console.log(`  ✅ ${r.path}`));
  if (okCount === 0) process.exit(1);
}

main().catch(e => { console.error('❌ エラー:', e.message); process.exit(1); });
