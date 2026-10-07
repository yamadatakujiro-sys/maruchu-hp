// =============================================================
//  解釈エンジン（本番のAI＝Claude / Haiku）
//  現場の一言＋今のボード・入庫予定・予定表を渡し、「何をどう変えるか」をJSONで返させる。
//  実際のシート更新はコード側が確定的に行う（AIには判断だけさせる＝安全）。
// =============================================================
import { CONFIG } from './config.mjs';
import { STAGES } from './board.mjs';
import { SLOTS } from './layout.mjs';

const SYSTEM = `あなたは自動車の板金塗装工場の「ホワイトボード」係のアシスタントです。
現場の社員がLINEに打つ短いメッセージを読み、ボードをどう変えるかをJSONで返します。

【工程（左→右の順）】
${STAGES.map((s, i) => `${i}:${s}`).join(' / ')}
※「入庫」＝ボードに載っただけで作業前、「納車済」＝引き渡し完了（ボードから外れる）。
※ボードでは、今いる工程のマスに担当者の名札（名前）が貼られている。

【返すJSON】これだけを返す（説明文・コードフェンスは付けない）。使わない項目は null。
{
  "action": "move" | "add" | "assign" | "update" | "reserve" | "schedule" | "status" | "unknown",
  "carId": "車のNo（文字列）" | null,
  "toStage": "工程名" | null,
  "staff": "担当者名" | null,
  "newCar": {"cust":"","car":"","number":"","due":"","source":"","insurance":"","colorCode":"","memo":"","parts":""} | null,
  "fields": {"due":"","parts":"","memo":"","colorCode":"","colorState":"","insurance":"","source":""} | null,
  "reserve": {"cust":"","car":"","content":""} | null,
  "schedule": {"name":"スタッフ名","slot":"午前|午後|終日","text":""} | null,
  "reply": "現場へ返す短い日本語"
}

【判断ルール】
- 「〈工程〉終わった/上がった/完了/OK」→ move。toStage はその【次】の工程。
- 「〈工程〉入った/始めた/やってる」→ move。toStage はその工程。
- 「納車した/引き渡した/納めた」→ move。toStage は「納車済」。
- 担当者も言われたら staff に入れる（例「塗装は清水」「井上が下地やる」）。言われなければ null（今の担当を引き継ぐ）。
- 工程はそのままで担当だけ替える（「〇〇の担当は△△」「〇〇は△△がやる」）→ assign。
- 納車予定日・部品・備考・調色・保険・入庫先を変える → update。fields には変える項目だけ入れる（他は null）。
  例「シエンタ 納車10/12に変更」→ fields.due="10/12"
  例「ヤリスのバンパー届いた」→ fields.parts="バンパー入荷済"（今の部品メモを踏まえ短く）
  例「アクア 調色終わった」→ fields.colorState="調色済"（調色は工程moveではない）
  例「色番号は3T3」→ fields.colorCode="3T3"
- ボードに無い車が「入庫した/入った/預かった」→ add。newCar を埋める（車種と登録番号は分ける。日付は M/D）。
  入庫先（ディーラー名等）・保険会社・色番号が言われたら入れる。作業を始めた工程や担当が言われた時だけ toStage/staff。
- これから来る車（「来週入庫予定」「予約入った」「仮予約」）→ reserve。content に修理内容・予定日・状態を短く。
- スタッフの予定・休み（「井上 明日休み」「あやか 午後 キャンバス納車」）→ schedule。休みは text="休み"。予定表は1日分なので日付は気にしない。
- 聞くだけ（「今どうなってる」「誰休み」「部品待ちは」「入庫予定は」「井上なにやってる」「空きある？」）→ status。
  渡したデータだけを使い、reply をLINEで読みやすく簡潔に（1行1台程度、多すぎる時は要点）。空き＝ボードの空き番号数（16台中）も答えられる。
- 名前・車種は一覧と照合して carId を特定（さん/様、ひらがな/カタカナ、車種の一部、登録番号の下4桁でもよい）。
- スタッフ名は staffNames と照合する（呼び方ゆれも汲む）。
- 特定できない・曖昧 → unknown。reply で短く聞き返す。
- 1メッセージ＝1件。勝手に複数を動かさない。`;

export async function interpret(text, { cars, reservations, schedule }) {
  const board = cars.map((c) => ({
    no: c.id, cust: c.cust, car: c.car, number: c.number, stage: c.stage, staff: c.staff,
    due: c.due, parts: c.parts, memo: c.memo, colorCode: c.colorCode, colorState: c.colorState,
    insurance: c.insurance, source: c.source, inDate: c.inDate,
  }));
  const data = {
    board,
    emptySlots: SLOTS - cars.length,
    reservations: reservations.map((r) => ({ cust: r.cust, car: r.car, content: r.content })),
    schedule: { date: schedule.date, staff: schedule.staff.map((s) => ({ name: s.name, am: s.am, pm: s.pm })), notes: schedule.notes },
    staffNames: schedule.staff.map((s) => s.name),
  };
  const userContent =
    `今のボード・入庫予定・予定表（JSON）：\n${JSON.stringify(data)}\n\n` +
    `現場からのメッセージ：\n「${text}」\n\n` +
    `決められたJSONだけで答えてください。`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': CONFIG.anthropicKey(),
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: CONFIG.anthropicModel,
      max_tokens: 900,
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

const FALLBACK = { action: 'unknown', reply: 'すみません、うまく読み取れませんでした🙏 もう一度お願いします。' };

// Claudeの出力から最初のJSONオブジェクトを取り出す（前後にゴミがあっても拾う）
export function extractJson(raw) {
  const s = (raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1) return { ...FALLBACK };
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return { ...FALLBACK };
  }
}
