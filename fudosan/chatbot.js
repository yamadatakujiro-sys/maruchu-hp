/* ===============================
   株式会社クレアシティ
   AIチャットボット + ページUI制御
   =============================== */

// APIキーは config.js で設定（.gitignore 対象 / 未設定でも動作する）

// 会社情報をシステムプロンプトに設定
const SYSTEM_PROMPT = `あなたは総合不動産会社「株式会社クレアシティ」のAIコンシェルジュです。

【会社情報】
- 商号: 株式会社クレアシティ（CREACITY Co., Ltd.）
- 本社: 東京都中央区京橋1-1-1 クレアシティビル
- 設立: 1974年4月 / 資本金: 120億円
- 代表者: 代表取締役社長 神崎 亮一
- 従業員数: 312名
- 代表電話: 03-0000-0000（平日 9:00〜17:30）
- ブランドメッセージ: 「街に、つぎの物語を。」

【事業内容】
- オフィス事業: 都心駅近のオフィスビルを開発・保有・賃貸（入居率99.2%）
- 商業施設事業: 地域密着型商業施設の企画・運営（例: クレアモール川崎）
- 住宅事業: 都市型賃貸レジデンスの開発・運営（例: クレアレジデンス代官山）
- 都市開発事業: 再開発・建替えプロジェクト（例: 日本橋三丁目プロジェクト、2028年竣工予定）

【サステナビリティ】
- 保有全ビルで再生可能エネルギー由来電力を導入、2030年カーボンニュートラル目標
- 健康経営優良法人認定

【対応方針】
- テナント入居・物件の問い合わせは代表電話（03-0000-0000）または問い合わせフォームへ誘導してください。
- 事業内容・会社情報の質問には丁寧に回答してください。
- 採用に関する質問には「採用情報ページをご確認ください」と案内してください。
- 回答は簡潔に、2〜3文程度でまとめてください。
- 日本語で、誠実で落ち着いたビジネストーンで回答してください。`;

class CorporateChat {
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
      this.addBotMessage('こんにちは。株式会社クレアシティのAIコンシェルジュです。\n事業内容・物件・会社情報について、お気軽にご質問ください。');
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
      this.addBotMessage('デモサイトのためAI応答は停止中です。\n実際の導入時には、会社情報を学習したAIが24時間お問い合わせにお答えします。\nお問い合わせは代表電話（03-0000-0000 / 平日9:00〜17:30）にて承ります。');
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
      this.addBotMessage('通信エラーが発生しました。お手数ですが、代表電話（03-0000-0000）にてお問い合わせください。');
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
  const chat = new CorporateChat();

  // お問い合わせセクションの「AIコンシェルジュに質問する」ボタン
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

  // 数字カウントアップ（画面に入ったら開始）
  const counters = document.querySelectorAll('.count');
  const countObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      countObserver.unobserve(el);
      const target = parseFloat(el.dataset.count);
      const decimals = parseInt(el.dataset.decimal || '0', 10);
      const duration = 1600;
      const start = performance.now();
      const tick = (now) => {
        const progress = Math.min((now - start) / duration, 1);
        // イージング（最後ゆっくり）
        const eased = 1 - Math.pow(1 - progress, 3);
        const value = target * eased;
        el.textContent = decimals > 0
          ? value.toFixed(decimals)
          : Math.round(value).toLocaleString();
        if (progress < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, { threshold: 0.4 });
  counters.forEach(el => countObserver.observe(el));

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
