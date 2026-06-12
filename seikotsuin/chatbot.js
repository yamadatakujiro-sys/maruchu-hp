/* ===============================
   ルクス鍼灸接骨院 日本橋
   AIチャットボット + ページUI制御
   =============================== */

// APIキーは config.js で設定（.gitignore 対象 / 未設定でも動作する）

// 院情報をシステムプロンプトに設定
const SYSTEM_PROMPT = `あなたは「ルクス鍼灸接骨院 日本橋」のAI受付です。

【院情報】
- 院名: ルクス鍼灸接骨院 日本橋
- 住所: 東京都中央区日本橋2-1-1 ルクスビル B1F
- アクセス: 東京メトロ「日本橋駅」B3出口 徒歩3分 / JR「東京駅」八重洲北口 徒歩8分
- 電話: 03-0000-0000
- 受付時間: 平日 11:00〜20:30 / 土曜 10:00〜18:00
- 定休日: 日曜・祝日
- 特長: 国家資格保有率100%（柔道整復師・はり師・きゅう師）、完全予約制、保険診療対応

【対応症状・メニュー】
- 肩こり・首の痛み / 腰痛・ぎっくり腰 / 骨盤矯正（産後対応）/ スポーツ外傷 / 鍼灸治療 / 交通事故施術（自賠責保険対応）

【料金（税込）】
- 保険診療: 初診 ¥800〜2,400程度（1〜3割負担）/ 2回目以降 ¥400〜1,200程度
- 全身整体（40分）: ¥6,600
- 骨盤矯正（初回体験）: ¥4,950
- 鍼灸治療（40分）: ¥5,500
- 美容鍼（50分・人気）: ¥7,700
- 回数券（全身整体5回）: ¥29,700

【スタッフ】
- 三浦 健吾（院長 / 柔道整復師・はり師・きゅう師）: 整形外科勤務経験あり
- 沢村 あかね（副院長 / 柔道整復師）: 産後骨盤矯正・女性の骨格ケア担当
- 葉山 つむぎ（はり師・きゅう師）: 美容鍼・自律神経ケア専門

【対応方針】
- ご予約はお電話（03-0000-0000）へ誘導してください。
- 症状の相談には共感しつつ一般的な情報を伝え、診断はせず、来院での検査・カウンセリングをおすすめしてください。
- 保険適用の可否は症状により異なるため「来院時にご確認ください」と案内してください。
- 回答は簡潔に、2〜3文程度でまとめてください。
- 日本語で、丁寧で安心感のあるトーンで回答してください。`;

class ClinicChat {
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
      this.addBotMessage('こんにちは。ルクス鍼灸接骨院 日本橋のAI受付です。\n症状のご相談・料金・ご予約について、お気軽にお尋ねください。');
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
      this.addBotMessage('デモサイトのためAI応答は停止中です🙇\n実際の導入時には、院の情報を学習したAIが24時間ご質問にお答えします。\nご予約はお電話（03-0000-0000）にて承ります。');
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
      this.addBotMessage('通信エラーが発生しました。お手数ですが、お電話（03-0000-0000）にてお問い合わせください🙇');
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
  const chat = new ClinicChat();

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

  // お客様の声カルーセル
  const track = document.getElementById('voiceTrack');
  if (track) {
    const cards = track.children;
    const dotsWrap = document.getElementById('voiceDots');
    let index = 0;
    let timer = null;

    const update = () => {
      track.style.transform = `translateX(-${index * 100}%)`;
      [...dotsWrap.children].forEach((d, i) => d.classList.toggle('is-active', i === index));
    };
    const goTo = (i) => {
      index = (i + cards.length) % cards.length;
      update();
    };
    const startAuto = () => {
      clearInterval(timer);
      timer = setInterval(() => goTo(index + 1), 6000);
    };

    // ドット生成
    [...cards].forEach((_, i) => {
      const dot = document.createElement('button');
      dot.setAttribute('aria-label', `${i + 1}件目の声を表示`);
      dot.addEventListener('click', () => { goTo(i); startAuto(); });
      dotsWrap.appendChild(dot);
    });
    document.getElementById('voicePrev').addEventListener('click', () => { goTo(index - 1); startAuto(); });
    document.getElementById('voiceNext').addEventListener('click', () => { goTo(index + 1); startAuto(); });
    update();
    startAuto();
  }

  // 料金タブ切り替え
  const tabs = document.querySelectorAll('.price-tab');
  const panels = document.querySelectorAll('.price-panel');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('is-active'));
      panels.forEach(p => p.classList.remove('is-active'));
      tab.classList.add('is-active');
      const panel = document.querySelector(`.price-panel[data-panel="${tab.dataset.tab}"]`);
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
