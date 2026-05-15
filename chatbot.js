/* ===============================
   野球カフェ AIチャットボット
   Claude API 連携
   =============================== */

// APIキーは config.js で設定してください（.gitignore 対象）
// ANTHROPIC_API_KEY は config.js で定義されています

// 店舗情報をシステムプロンプトに設定
const SYSTEM_PROMPT = `あなたは野球コンセプト居酒屋「バッチコイ酒場まるちゅう」のAIアシスタントです。

【店舗情報】
- 店名: バッチコイ酒場まるちゅう
- 住所: 埼玉県熊谷市筑波3-46 ダイコービル 1F
- 電話: 048-577-7677
- 営業時間: 18:00〜00:00（フードLO 23:00 / ドリンクLO 23:30）
- 定休日: 毎週日曜日
- コンセプト: 野球をテーマにしたアットホームな居酒屋。唐揚げ・焼き鳥・刺身などの定番料理と豊富なドリンクを提供。宴会・打ち上げにも対応。
- Instagram: https://www.instagram.com/maruchu88/

【メニュー（税込）】
- まるちゅう唐揚げ：¥580（人気No.1🏆 秘伝のタレに漬け込んだジューシーな自家製唐揚げ。ビールとの相性抜群）
- 焼き鳥盛り合わせ：¥780（炭火でじっくり焼いた串焼き盛り合わせ。塩・タレお好みで）
- 刺身三点盛り：¥980（その日仕入れた新鮮な魚介を丁寧に盛り合わせ）
- 生ビール：¥550（キンキンに冷えた黄金の一杯。試合後の乾杯にぴったり）
- ハイボール：¥480（スッキリ爽快なウィスキーハイボール）
- 宴会コース：¥3,500〜/人（飲み放題付き。チームの打ち上げ・歓送迎会におすすめ。要予約）
※その他、まるちゅう餃子🥟（ニンニクなし）や季節の旬メニューもあります。

【対応方針】
- 予約・お問い合わせは、ページ内の「Contact」フォームまたはお電話（048-577-7677）へ誘導してください。
- 営業時間・定休日の質問には丁寧に回答してください。
- メニューや料金を聞かれたら、上記の【メニュー】から該当する品を分かりやすく案内してください。おすすめを聞かれたら人気No.1の「まるちゅう唐揚げ」や「まるちゅう餃子」を紹介してください。
- 宴会・コースの相談には、要予約である旨を伝え、お電話またはContactフォームへ誘導してください。
- 野球に関する話題も歓迎します。
- 回答は簡潔に、2〜3文程度でまとめてください（メニューを複数案内する場合はリスト形式でもOK）。
- 日本語で回答してください。
- 絵文字を適度に使って親しみやすく回答してください。`;

class BallparkChat {
  constructor() {
    this.isOpen = false;
    this.isTyping = false;
    this.messages = [];

    this.fab = document.getElementById('chatFab');
    this.window = document.getElementById('chatWindow');
    this.closeBtn = document.getElementById('chatClose');
    this.messagesEl = document.getElementById('chatMessages');
    this.inputEl = document.getElementById('chatInput');
    this.sendBtn = document.getElementById('chatSend');

    this.init();
  }

  init() {
    this.fab.addEventListener('click', () => this.toggle());
    this.closeBtn.addEventListener('click', () => this.close());
    this.sendBtn.addEventListener('click', () => this.send());
    // 送信はボタンクリックのみ（キーボードのEnterは使わない）
    // ※日本語IME変換のEnterと競合するため
  }

  toggle() {
    this.isOpen ? this.close() : this.open();
  }

  open() {
    this.isOpen = true;
    this.window.classList.add('open');
    this.fab.textContent = '✕';
    if (this.messages.length === 0) {
      this.addBotMessage('こんにちは！⚾ バッチコイ酒場まるちゅうへようこそ。\nメニュー・料金・営業時間・ご予約など、お気軽にご質問ください！🍻');
    }
    setTimeout(() => this.inputEl.focus(), 300);
  }

  close() {
    this.isOpen = false;
    this.window.classList.remove('open');
    this.fab.textContent = '⚾';
  }

  addBotMessage(text) {
    this.messages.push({ role: 'assistant', content: text });
    this.renderMessage('bot', text);
  }

  addUserMessage(text) {
    this.messages.push({ role: 'user', content: text });
    this.renderMessage('user', text);
  }

  renderMessage(type, text) {
    const el = document.createElement('div');
    el.className = `msg msg-${type}`;
    el.textContent = text;
    this.messagesEl.appendChild(el);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  showTyping() {
    const el = document.createElement('div');
    el.className = 'msg msg-bot msg-typing';
    el.id = 'typingIndicator';
    el.innerHTML = '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';
    this.messagesEl.appendChild(el);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  hideTyping() {
    const el = document.getElementById('typingIndicator');
    if (el) el.remove();
  }

  async send() {
    const text = this.inputEl.value.trim();
    if (!text || this.isTyping) return;

    if (!ANTHROPIC_API_KEY) {
      this.addBotMessage('現在チャットサービスをご利用いただけません。お電話（048-577-7677）またはContactフォームよりお問い合わせください。');
      return;
    }

    // 入力欄をクリア（ブラウザに強制反映）
    this.inputEl.value = '';
    this.inputEl.dispatchEvent(new Event('input'));
    this.addUserMessage(text);
    this.isTyping = true;
    this.sendBtn.disabled = true;
    this.showTyping();

    // APIに送るメッセージ（最新の assistant メッセージは除外してから送る）
    const apiMessages = this.messages.slice(-20).filter((m, i, arr) => {
      // 最後のメッセージが assistant の場合は除外（まだ返答前）
      if (i === arr.length - 1 && m.role === 'assistant') return false;
      return true;
    });

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-opus-4-7',
          max_tokens: 512,
          system: SYSTEM_PROMPT,
          messages: apiMessages,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      const reply = data.content?.[0]?.text || '申し訳ありません。もう一度お試しください。';
      this.hideTyping();
      this.addBotMessage(reply);
    } catch (e) {
      this.hideTyping();
      console.error('Chat error:', e);
      this.addBotMessage('通信エラーが発生しました。お手数ですが、お電話（048-577-7677）またはContactフォームよりご連絡ください。🙇');
    } finally {
      this.isTyping = false;
      this.sendBtn.disabled = false;
      // 入力欄が残っていた場合の保険
      this.inputEl.value = '';
      this.inputEl.focus();
    }
  }
}

// DOM準備完了後に初期化
document.addEventListener('DOMContentLoaded', () => {
  new BallparkChat();

  // ハンバーガーメニュー
  const toggle = document.getElementById('navToggle');
  const navLinks = document.getElementById('navLinks');
  if (toggle && navLinks) {
    toggle.addEventListener('click', () => {
      navLinks.classList.toggle('open');
    });
    navLinks.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => navLinks.classList.remove('open'));
    });
  }
});
