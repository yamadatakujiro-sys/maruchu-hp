/* ===============================
   藤波直樹税理士事務所
   AIチャットボット + ページUI制御
   =============================== */

// APIキーは config.js で設定（.gitignore 対象 / 未設定でも動作する）

// 事務所情報をシステムプロンプトに設定
const SYSTEM_PROMPT = `あなたは「藤波直樹税理士事務所」のAI相談窓口です。

【事務所情報】
- 名称: 藤波直樹税理士事務所
- 所在地: 兵庫県神戸市中央区加納町1-1-1 フジナミビル 5F（各線「三宮駅」徒歩5分）
- 電話: 078-000-0000
- 営業時間: 平日 9:00〜18:00（事前予約で時間外・土日も対応）
- 対応エリア: 神戸市・阪神間を中心に全国（オンライン対応可）
- 初回相談: 無料（約60分、オンライン面談可）

【代表プロフィール】
- 代表税理士 藤波 直樹: 地方銀行で10年間融資審査を担当後、税理士法人勤務を経て2018年開業
- 認定経営革新等支援機関 / 創業融資サポート実績120件超・採択率95%
- 信条: 「税理士は、数字を整える人ではなく、経営者の意思決定を支える人」

【サービスと料金（税込・目安）】
- 法人顧問（月次面談・税務相談込）: 月額 ¥33,000〜
- 個人事業主顧問: 月額 ¥16,500〜
- 記帳代行: 月額 ¥11,000〜
- 法人決算申告（スポット）: ¥165,000〜
- 個人確定申告: ¥55,000〜
- 創業融資サポート: 着手金¥33,000＋成功報酬 融資額の2%（顧問契約で着手金無料）
- 相続税申告: ¥330,000〜
- クラウド会計（freee・マネーフォワード）導入支援も対応

【対応方針】
- 具体的な税務判断・個別の税額計算はせず、「初回無料相談でくわしくお伺いします」と来所・オンライン面談へ誘導してください。
- サービス内容・料金・相談の流れの質問には丁寧に回答してください。
- ご予約はお電話（078-000-0000）へ誘導してください。
- 回答は簡潔に、2〜3文程度でまとめてください。
- 日本語で、誠実で落ち着いた信頼感のあるトーンで回答してください。`;

class TaxChat {
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
      this.addBotMessage('こんにちは。藤波直樹税理士事務所のAI相談窓口です。\nサービス内容・料金・ご相談の流れなど、お気軽にお尋ねください。');
    }
    setTimeout(() => this.inputEl.focus(), 300);
  }

  close() {
    this.isOpen = false;
    this.window.classList.remove('open');
    this.fab.textContent = '💬';
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

    // APIキー未設定時（デモ公開時）は定型文で案内
    if (!ANTHROPIC_API_KEY) {
      this.inputEl.value = '';
      this.addUserMessage(text);
      this.addBotMessage('デモサイトのためAI応答は停止中です。\n実際の導入時には、事務所の情報を学習したAIが24時間ご質問にお答えします。\n初回相談（無料）のご予約はお電話（078-000-0000）にて承ります。');
      return;
    }

    // 入力欄をクリア（ブラウザに強制反映）
    this.inputEl.value = '';
    this.inputEl.dispatchEvent(new Event('input'));
    this.addUserMessage(text);
    this.isTyping = true;
    this.sendBtn.disabled = true;
    this.showTyping();

    // APIに送るメッセージ（直近20件、返答前のassistantは除外）
    const apiMessages = this.messages.slice(-20).filter((m, i, arr) => {
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
          model: 'claude-haiku-4-5-20251001',
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
      const reply = data.content?.[0]?.text || '申し訳ございません。もう一度お試しください。';
      this.hideTyping();
      this.addBotMessage(reply);
    } catch (e) {
      this.hideTyping();
      console.error('Chat error:', e);
      this.addBotMessage('通信エラーが発生しました。お手数ですが、お電話（078-000-0000）にてお問い合わせください。');
    } finally {
      this.isTyping = false;
      this.sendBtn.disabled = false;
      this.inputEl.value = '';
      this.inputEl.focus();
    }
  }
}

/* ---------- ページUI制御 ---------- */
document.addEventListener('DOMContentLoaded', () => {
  const chat = new TaxChat();

  // 無料相談セクションの「AIチャットで相談する」ボタン
  const openChatBtn = document.getElementById('openChatBtn');
  if (openChatBtn) {
    openChatBtn.addEventListener('click', () => chat.open());
  }

  // ハンバーガーメニュー
  const toggle = document.getElementById('navToggle');
  const navLinks = document.getElementById('navLinks');
  if (toggle && navLinks) {
    toggle.addEventListener('click', () => {
      toggle.classList.toggle('open');
      navLinks.classList.toggle('open');
    });
    navLinks.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        toggle.classList.remove('open');
        navLinks.classList.remove('open');
      });
    });
  }

  // ヘッダー：スクロールで背景を付ける
  const header = document.getElementById('header');
  const onScroll = () => {
    header.classList.toggle('scrolled', window.scrollY > 40);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // スクロールで現れるアニメーション
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });
  document.querySelectorAll('.fade-up').forEach(el => observer.observe(el));
});
