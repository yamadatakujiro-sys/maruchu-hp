// =============================================================
//  解釈エンジン（本番のAI＝Claude / Haiku）
//  現場の一言＋今の車一覧を渡し、「どの車をどの工程へ」の意図をJSONで返させる。
//  実際のシート更新はコード側が確定的に行う（AIには判断だけさせる＝安全）。
// =============================================================
import { CONFIG } from './config.mjs';
import { STAGES } from './board.mjs';

const SYSTEM = `あなたは自動車の板金塗装工場の「工程ボード」担当アシスタントです。
現場の社員がLINEに打つ短いメッセージ（例：「田中さんのハイエース塗装終わった」）を読み、
どの車を・どの工程に動かすか（または新規入庫・状況確認）を判断します。

工程はこの順番です（左が最初、右が最後）：
${STAGES.map((s, i) => `${i}:${s}`).join(' / ')}

必ず次のJSONだけを返してください（前後に説明文やコードフェンスを付けない）：
{
  "action": "move" | "add" | "status" | "unknown",
  "carId": 該当車のID(文字列) または null,
  "toStage": 工程名(上のいずれか) または null,
  "newCar": {"cust":"お客様名","car":"車種","number":"","due":""} または null,
  "reply": "現場へ返すごく短い日本語メッセージ"
}

判断ルール：
- 「〈工程〉終わった/上がった/完了/できた/OK」→ その工程の【次】の工程へ move。
  例：塗装終わった → toStage は「塗装」の次の工程。
- 「〈工程〉に入った/〈工程〉始めた」→ その工程へ move。
- 「納車した/引き渡した/納めた」→ toStage は「納車済」。
- メッセージ中の名前・車種は、渡された car 一覧と照合して carId を特定する。表記ゆれ（さん/様、ひらがな/カタカナ、車種の一部）も汲む。
- 一覧に無い名前で「入庫/預かった/新しく入った」→ action は "add"、newCar を埋める（stageは指定なければ入庫）。
- 「今どうなってる」「〈名前〉の状況」など様子を聞くもの → action "status"、reply に一覧や該当車の工程を簡潔にまとめる。
- どの車か特定できない/工程が曖昧 → action "unknown"、reply で何を教えてほしいか短く聞き返す。
- 勝手に複数台を動かさない。1メッセージ＝1台が原則。`;

// メッセージ本文をエスケープ不要のプレーンで渡す
export async function interpret(text, cars) {
  const carList = cars.map((c) => ({ id: c.id, cust: c.cust, car: c.car, stage: c.stage, due: c.due }));
  const userContent =
    `今ボードにある車の一覧（JSON）：\n${JSON.stringify(carList, null, 0)}\n\n` +
    `現場からのメッセージ：\n「${text}」\n\n` +
    `上のJSON形式だけで答えてください。`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': CONFIG.anthropicKey(),
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: CONFIG.anthropicModel,
      max_tokens: 500,
      temperature: 0,
      system: SYSTEM,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Anthropic API 失敗: ${res.status} ${t}`);
  }
  const json = await res.json();
  const raw = (json.content || []).map((b) => b.text || '').join('').trim();
  return extractJson(raw);
}

// Claudeの出力から最初のJSONオブジェクトを取り出す（前後にゴミがあっても拾う）
function extractJson(raw) {
  let s = raw.trim();
  // ```json ... ``` を剥がす
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1) {
    return { action: 'unknown', carId: null, toStage: null, newCar: null, reply: 'すみません、うまく読み取れませんでした🙏 もう一度お願いします。' };
  }
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return { action: 'unknown', carId: null, toStage: null, newCar: null, reply: 'すみません、うまく読み取れませんでした🙏 もう一度お願いします。' };
  }
}
