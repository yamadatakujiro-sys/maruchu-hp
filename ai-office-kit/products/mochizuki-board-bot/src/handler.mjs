// =============================================================
//  メッセージ処理の中核
//  LINEテキスト → Claudeで解釈 → シートを更新 → 返信文を作る
//  返信文はコード側で確定的に組み立てる（実際に起きた結果を返す＝ズレない）。
// =============================================================
import { interpret } from './claude.mjs';
import {
  listCars, activeCars, findById, moveCar, addCar,
  isValidStage, STAGES,
} from './board.mjs';

// テキスト1件を処理して、返信すべき文字列を返す。
export async function handleText(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;

  const cars = await listCars();
  const intent = await interpret(trimmed, cars);

  switch (intent.action) {
    case 'move': {
      const car = findById(cars, intent.carId);
      if (!car) {
        return intent.reply || 'どの車か特定できませんでした🙏 お名前か車種を教えてください。';
      }
      if (!isValidStage(intent.toStage)) {
        return `工程が分かりませんでした🙏 いまの工程は〈${car.stage}〉です。「塗装終わった」のように送ってください。`;
      }
      if (intent.toStage === car.stage) {
        return `${car.cust}様の${car.car}は、すでに〈${car.stage}〉です👍`;
      }
      const from = car.stage;
      await moveCar(car, intent.toStage);
      return `✅ ${car.cust}様の${car.car}\n〈${from}〉→〈${intent.toStage}〉に動かしました。`;
    }

    case 'add': {
      const nc = intent.newCar || {};
      if (!nc.cust && !nc.car) {
        return '新規の入庫ですね。お客様名と車種を教えてください（例：田中さんのハイエース 入庫）。';
      }
      const stage = isValidStage(intent.toStage) ? intent.toStage
        : (isValidStage(nc.stage) ? nc.stage : STAGES[0]);
      const added = await addCar(cars, {
        cust: nc.cust || '(未入力)',
        car: nc.car || '(未入力)',
        number: nc.number || '',
        due: nc.due || '',
        stage,
      });
      return `✅ 新しく〈${added.stage}〉に追加しました。\n${added.cust}様の${added.car}`;
    }

    case 'status': {
      // Claudeが作った要約をそのまま返す。空なら自前で一覧を組む。
      if (intent.reply && intent.reply.trim()) return intent.reply.trim();
      return buildStatusSummary(cars);
    }

    default:
      return intent.reply || 'すみません、うまく読み取れませんでした🙏 「田中さんのハイエース 塗装終わった」のように送ってください。';
  }
}

// 状況確認用のフォールバック要約
function buildStatusSummary(cars) {
  const act = activeCars(cars);
  if (act.length === 0) return 'いま作業中の車はありません🚗';
  const byStage = {};
  for (const c of act) (byStage[c.stage] ||= []).push(c);
  const lines = ['📋 いまの工程ボード'];
  for (const st of STAGES) {
    const arr = byStage[st];
    if (!arr || arr.length === 0) continue;
    lines.push(`〈${st}〉${arr.map((c) => `${c.cust}様の${c.car}`).join('、')}`);
  }
  return lines.join('\n');
}
