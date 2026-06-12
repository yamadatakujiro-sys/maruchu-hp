/* ===============================
   Lino hair
   AIチャットボット + ページUI制御
   =============================== */

// APIキーは config.js で設定（.gitignore 対象 / 未設定でも動作する）

// サロン情報をシステムプロンプトに設定
const SYSTEM_PROMPT = `あなたは千葉県の髪質改善特化美容室「Lino hair（リノヘア）」のAIサポートです。

【サロン情報】
- 店名: Lino hair（リノヘア）/ 髪質改善専門サロン
- コンセプト: 「通うほど、髪はきれいに。」くり返すたびに艶を重ねるLino式髪質改善。
- 営業時間: 9:30〜19:30（最終受付 19:00）
- 定休日: 毎週月曜・第3火曜

【店舗】
- 船橋本店: 千葉県船橋市本町1-2-3 リノビル2F / JR船橋駅 南口 徒歩4分 / TEL 047-000-0000
- 津田沼店: 千葉県習志野市津田沼2-3-4 グランビル3F / JR津田沼駅 北口 徒歩3分 / TEL 047-000-0001
- 柏店: 千葉県柏市柏3-4-5 サニープレイス1F / JR柏駅 東口 徒歩5分 / TEL 04-0000-0002

【主なメニュー（税込）】
- カット（シャンプー・ブロー込）: ¥4,950
- カット＋カラー: ¥9,900〜
- Lino式髪質改善トリートメント（人気No.1）: ¥9,900〜
- 髪質改善＋カット: ¥13,750〜
- 酸性ストレート（カット込）: ¥19,800〜
- プレミアムヘッドスパ（40分）: ¥6,050

【オリジナルプロダクト LINOTE】
- モイストシャンプー 300mL ¥3,080 / リペアトリートメント 240g ¥3,520 / シルクヘアオイル 100mL ¥2,860

【対応方針】
- ご予約は各店舗のお電話へ誘導してください。
- 髪質改善と縮毛矯正の違いなど、髪の悩み相談には分かりやすく回答し、来店カウンセリングをおすすめしてください。
- 回答は簡潔に、2〜3文程度でまとめてください。
- 日本語で、明るく親しみやすい接客トーンで回答してください。絵文字を適度に使ってください。`;

class SalonChat {
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
      this.addBotMessage('こんにちは！Lino hair のAIサポートです🌸\nメニュー・料金・店舗のこと、髪のお悩みなど、お気軽にご相談ください！');
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
      this.addBotMessage('デモサイトのためAI応答は停止中です🙇\n実際の導入時には、サロン情報を学習したAIが24時間ご質問にお答えします。\nご予約は各店舗のお電話にて承ります📞');
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
      this.addBotMessage('通信エラーが発生しました。お手数ですが、各店舗のお電話にてお問い合わせください🙇');
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
  const chat = new SalonChat();

  // 予約セクションの「AIチャットで相談する」ボタン
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

  // ヒーロー：クロスフェードスライドショー
  const slides = document.querySelectorAll('.hero-slide');
  const dotsWrap = document.getElementById('heroDots');
  let current = 0;
  let slideTimer = null;

  const goTo = (index) => {
    slides[current].classList.remove('is-active');
    dotsWrap.children[current].classList.remove('is-active');
    current = (index + slides.length) % slides.length;
    slides[current].classList.add('is-active');
    dotsWrap.children[current].classList.add('is-active');
  };
  const startAuto = () => {
    clearInterval(slideTimer);
    slideTimer = setInterval(() => goTo(current + 1), 5000);
  };

  if (slides.length > 0 && dotsWrap) {
    // ドットを生成
    slides.forEach((_, i) => {
      const dot = document.createElement('button');
      dot.setAttribute('aria-label', `スライド${i + 1}を表示`);
      if (i === 0) dot.classList.add('is-active');
      dot.addEventListener('click', () => { goTo(i); startAuto(); });
      dotsWrap.appendChild(dot);
    });
    startAuto();
  }

  // メニューガイド：カテゴリタブ切り替え
  const tabs = document.querySelectorAll('.menu-tab');
  const panels = document.querySelectorAll('.menu-panel');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('is-active'));
      panels.forEach(p => p.classList.remove('is-active'));
      tab.classList.add('is-active');
      const panel = document.querySelector(`.menu-panel[data-panel="${tab.dataset.tab}"]`);
      if (panel) panel.classList.add('is-active');
    });
  });

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
