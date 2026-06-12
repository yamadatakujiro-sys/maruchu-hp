/* ===============================
   nail salon Lino AIコンシェルジュ
   Claude API 連携チャットボット
   =============================== */

// APIキーは config.js で設定してください（.gitignore 対象）
// config.js が無い環境でも動作するようにガードする
const LINO_API_KEY = (typeof ANTHROPIC_API_KEY !== 'undefined') ? ANTHROPIC_API_KEY : '';

// 店舗情報をシステムプロンプトに設定
const LINO_SYSTEM_PROMPT = `あなたはネイルサロン「nail salon Lino（リノ）」のAIコンシェルジュです。

【サロン情報】
- サロン名: nail salon Lino（ネイルサロン リノ）。Linoはハワイ語で「輝く」の意味
- コンセプト: 「指先から、わたしが輝く。」南青山の隠れ家ネイルサロン。爪を傷めない丁寧なケアと上品な大人デザイン
- 住所: 東京都港区南青山1-2-3 リノビル2F（外苑前駅 1a出口より徒歩4分）
- 電話: 03-0000-0000
- 営業時間: 平日 10:00〜20:00／土日祝 10:00〜19:00（最終受付は目安として閉店2時間前）
- 定休日: 毎週水曜日・年末年始
- 座席: 半個室2席（完全予約制）
- 支払い: 現金・各種クレジットカード・交通系IC・QRコード決済

【主なメニュー（税込）】
- ハンドジェル: ワンカラー ¥6,600／グラデーション ¥7,150／フレンチ ¥7,700／定額デザインA ¥8,800／定額デザインB ¥9,900／アートやり放題 ¥12,100
- ケア&ポリッシュ: ネイルケア ¥3,850／ケア+カラー ¥5,500
- フット: ワンカラー ¥7,700／デザイン ¥9,350／フットケア ¥4,950
- その他: 他店オフ ¥1,650（付け替えなら無料）／長さ出し1本 ¥550
- 初回特典: 他店ジェルオフ無料＋施術料金20%OFF
- 保証: 施術後1週間以内の浮き・欠けは無料お直し

【スタッフ】
- 店長・トップネイリスト 桜井美月（JNEC1級・JNA認定講師、オフィスネイル・ブライダルが得意）
- ネイリスト 高梨結衣（JNEC1級、ニュアンスアート・シアーカラーが得意）

【対応方針】
- ご予約はページ内の予約フォームまたはお電話（03-0000-0000）へご案内してください
- 上品で柔らかい、丁寧な接客トーンで応対してください（高級サロンのコンシェルジュのイメージ）
- 回答は簡潔に2〜3文程度。絵文字は控えめに（使っても1つまで）
- 日本語で回答してください
- メニュー・料金・営業時間・アクセスのご質問には正確に回答してください
- 爪のお悩み相談には一般的なアドバイスをしつつ、来店時のカウンセリングをおすすめしてください`;

class LinoChat {
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
    // 送信はボタンクリックのみ（日本語IME変換のEnterと競合するため）
  }

  toggle() {
    this.isOpen ? this.close() : this.open();
  }

  open() {
    this.isOpen = true;
    this.window.classList.add('open');
    this.fab.textContent = '✕';
    if (this.messages.length === 0) {
      this.addBotMessage('こんにちは、nail salon Lino です🤍\nご予約やメニュー、爪のお悩みなど、お気軽にご相談ください。');
    }
    setTimeout(() => this.inputEl.focus(), 300);
  }

  close() {
    this.isOpen = false;
    this.window.classList.remove('open');
    this.fab.textContent = '💅';
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

    if (!LINO_API_KEY) {
      this.inputEl.value = '';
      this.addUserMessage(text);
      this.addBotMessage('申し訳ございません、ただいまチャットでのご案内を休止しております。お手数ですが、お電話（03-0000-0000）またはご予約フォームよりお問い合わせくださいませ。');
      return;
    }

    // 入力欄をクリア（ブラウザに強制反映）
    this.inputEl.value = '';
    this.inputEl.dispatchEvent(new Event('input'));
    this.addUserMessage(text);
    this.isTyping = true;
    this.sendBtn.disabled = true;
    this.showTyping();

    // APIに送るメッセージ（直近20件。末尾がassistantの場合は除外）
    const apiMessages = this.messages.slice(-20).filter((m, i, arr) => {
      if (i === arr.length - 1 && m.role === 'assistant') return false;
      return true;
    });

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': LINO_API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-opus-4-8',
          max_tokens: 512,
          system: LINO_SYSTEM_PROMPT,
          messages: apiMessages,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      const reply = data.content?.[0]?.text || '申し訳ございません。もう一度お試しくださいませ。';
      this.hideTyping();
      this.addBotMessage(reply);
    } catch (e) {
      this.hideTyping();
      console.error('Chat error:', e);
      this.addBotMessage('通信エラーが発生いたしました。お手数ですが、お電話（03-0000-0000）またはご予約フォームよりご連絡くださいませ。');
    } finally {
      this.isTyping = false;
      this.sendBtn.disabled = false;
      this.inputEl.value = '';
      this.inputEl.focus();
    }
  }
}

// DOM準備完了後に初期化
document.addEventListener('DOMContentLoaded', () => {
  new LinoChat();

  // ハンバーガーメニュー（全ページ共通）
  const toggle = document.getElementById('navToggle');
  const gnav = document.getElementById('gnav');
  if (toggle && gnav) {
    toggle.addEventListener('click', () => {
      gnav.classList.toggle('open');
      toggle.classList.toggle('open');
    });
    gnav.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        gnav.classList.remove('open');
        toggle.classList.remove('open');
      });
    });
  }

  // 予約フォーム（デモ：送信せず完了メッセージのみ表示）
  const form = document.getElementById('reserveForm');
  const result = document.getElementById('formResult');
  if (form && result) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      result.classList.add('show');
      result.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
});
