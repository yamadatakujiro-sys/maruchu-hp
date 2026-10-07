// =============================================================
//  メッセージ処理の中核
//  LINEテキスト → Claudeで解釈 → ホワイトボードを更新 → 返信文を作る
//  返信文はコード側で確定的に組み立てる（実際に起きた結果を返す＝ズレない）。
// =============================================================
import { interpret } from './claude.mjs';
import {
  loadAll, activeCars, findById, moveCar, addCar, updateFields, addReservation,
  removeReservation, setSchedule, findStaff, isValidStage, STAGES, DONE, INTAKE, FIELD_LABEL,
} from './board.mjs';
import { BOARD_STAGES } from './layout.mjs';

const label = (c) => (c.cust ? `${c.cust}様の${c.car}` : c.car);
const ASK = '「青木さんのシエンタ 鈑金終わった」のように送ってください。';

// テキスト1件を処理して、返信すべき文字列を返す。
export async function handleText(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;

  const state = await loadAll();
  const { cars, reservations, schedule } = state;
  const intent = await interpret(trimmed, state);

  switch (intent.action) {
    case 'move': {
      const car = findById(cars, intent.carId);
      if (!car) return intent.reply || `どの車か分かりませんでした🙏 ${ASK}`;
      if (!isValidStage(intent.toStage)) {
        return `工程が分かりませんでした🙏 いまは〈${car.stage}〉です。${ASK}`;
      }
      const staff = intent.staff || null;
      if (intent.toStage === car.stage && !staff) {
        return `${label(car)}は、すでに〈${car.stage}〉です👍`;
      }
      const from = car.stage;
      const moved = await moveCar(car, intent.toStage, staff);
      if (intent.toStage === DONE) {
        return `✅ ${label(car)}\n納車済にしました🚗\nボードの${car.id}番を空けて、「納車済」タブに記録しました。`;
      }
      const who = moved.staff ? `（担当：${moved.staff}）` : '';
      return `✅ ${label(car)}\n〈${from}〉→〈${intent.toStage}〉${who}`;
    }

    case 'assign': {
      const car = findById(cars, intent.carId);
      if (!car) return intent.reply || `どの車か分かりませんでした🙏 ${ASK}`;
      if (!intent.staff) return '担当者の名前を教えてください🙏（例：青木さんのシエンタ 担当は松本）';
      const to = isValidStage(intent.toStage) && BOARD_STAGES.includes(intent.toStage)
        ? intent.toStage : car.stage;
      if (!BOARD_STAGES.includes(to)) {
        return `${label(car)}はまだ作業前（入庫）です。どの工程から始めますか？（例：${intent.staff}が鈑金始めた）`;
      }
      await moveCar(car, to, intent.staff);
      return `✅ ${label(car)}\n〈${to}〉の担当を「${intent.staff}」にしました。`;
    }

    case 'update': {
      const car = findById(cars, intent.carId);
      if (!car) return intent.reply || `どの車か分かりませんでした🙏 ${ASK}`;
      const changed = await updateFields(car, intent.fields);
      if (!changed.length) return intent.reply || '何を変えるか分かりませんでした🙏（例：納車10/12に変更／バンパー届いた）';
      const lines = changed.map(([k, v]) => `・${FIELD_LABEL[k]}：${v}`);
      return `✅ ${label(car)}\n${lines.join('\n')}`;
    }

    case 'add': {
      const nc = intent.newCar || {};
      if (!nc.cust && !nc.car) {
        return '新しい入庫ですね。お客様名と車種を教えてください（例：石田さんのアクア 入庫 ナンバー1234 納車10/20）。';
      }
      const stage = BOARD_STAGES.includes(intent.toStage) ? intent.toStage : INTAKE;
      const added = await addCar(cars, nc, { stage, staff: intent.staff || '' });
      // 入庫予定に同じお客様がいれば消す（予定→ボードへ移った）
      const custKey = (nc.cust || '').replace(/(様|さん)$/, '');
      const res = custKey && reservations.find((x) => x.cust.replace(/様$/, '').includes(custKey));
      if (res) await removeReservation(res);
      const where = stage === INTAKE ? '' : `〈${stage}〉から`;
      return `✅ ${added.id}番に入庫しました${where ? `（${where}）` : ''}\n${label(added)}${nc.due ? `\n納車予定：${nc.due}` : ''}${res ? '\n（入庫予定から外しました）' : ''}`;
    }

    case 'reserve': {
      const r = intent.reserve || {};
      if (!r.cust && !r.car) return '入庫予定ですね。お客様名・車種・内容を教えてください（例：近藤様 ハイエース リヤバンパー 10/20予定）。';
      await addReservation(reservations, r);
      const who = r.cust ? `${r.cust.replace(/様$/, '')}様` : '';
      return `📝 入庫予定に追加しました\n${[who, r.car, r.content].filter(Boolean).join(' ')}`;
    }

    case 'schedule': {
      const s = intent.schedule || {};
      const person = findStaff(schedule.staff, s.name);
      if (!person) {
        const names = schedule.staff.map((x) => x.name).join('・');
        return `予定表に「${s.name || '?'}」さんが見つかりませんでした🙏\n予定表の名前：${names}`;
      }
      const slot = ['午前', '午後', '終日'].includes(s.slot) ? s.slot : '終日';
      const t = (s.text || '').trim() || '休み';
      await setSchedule(person, slot, t);
      return `🗓 予定表に書きました\n${person.name}：${slot === '終日' ? '' : `${slot} `}${t}`;
    }

    case 'status': {
      if (intent.reply && intent.reply.trim()) return intent.reply.trim();
      return buildStatusSummary(cars);
    }

    default:
      return intent.reply || `すみません、うまく読み取れませんでした🙏 ${ASK}`;
  }
}

// 状況確認用のフォールバック要約（工程順に、担当者つき）
export function buildStatusSummary(cars) {
  const act = activeCars(cars);
  if (act.length === 0) return 'いまボードに車はありません🚗';
  const lines = [`📋 いまのボード（${act.length}台）`];
  for (const st of STAGES) {
    const arr = act.filter((c) => c.stage === st);
    if (!arr.length) continue;
    const items = arr.map((c) => `${c.id}.${label(c)}${c.staff ? `(${c.staff})` : ''}`);
    lines.push(`〈${st}〉${items.join('、')}`);
  }
  return lines.join('\n');
}
