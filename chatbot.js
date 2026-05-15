/* ===============================
   バッチコイ酒場 まるちゅう
   AI案内（Claude API 連携）
   =============================== */

// APIキーは config.js で設定してください（.gitignore 対象）
// ANTHROPIC_API_KEY は config.js で定義されています

// 店舗情報をシステムプロンプトに設定
const SYSTEM_PROMPT = `あなたは熊谷の大衆酒場「バッチコイ酒場 まるちゅう」のオンライン案内係です。
温かく、丁寧で、少し気さくな女将のような口調で答えてください。

【店舗情報】
- 店名: バッチコイ酒場 まるちゅう
- 住所: 〒360-0037 埼玉県熊谷市筑波3-46 ダイコービル 1F
- 電話: 048-577-7677
- 営業時間: 月〜土 18:00〜24:00（料理ラストオーダー 23:00）
- 定休日: 毎週日曜日
- 席数: 20席（カウンター・座敷あり、個室なし）
- お支払い: 現金のみ（クレジットカード・電子マネー不可）
- 駐車場: なし（近隣にコインパーキングあり）
- アクセス: JR熊谷駅 北口より徒歩5分
- Instagram: https://www.instagram.com/maruchu88/

【名物五品】
1. まるちゅう餃子 - ニンニク不使用、皮はパリッと餡はやさしい味（看板の一品）
2. 塩ホルモン煮込み - 丁寧に下処理したホルモンを澄んだ塩のスープで
3. 鳥の唐揚げ - 衣はサクッ、肉汁ジュッ。定番の安心
4. ふわトロチーズオムレツ - ふんわり卵にとろけるチーズを忍ばせて
5. ガーリックシュリンプ - 香ばしいガーリックバター仕立ての海老
※詳細は店頭の品書きにてご案内しております。

※基本価格はホームページ「お品書き」に税込みで掲載しております。当日のおすすめや黒板メニューは仕入れ・季節で変動するため、詳細はお電話（048-577-7677）でお気軽にお尋ねください。

【対応方針】
- ご予約はお電話（048-577-7677）へご案内してください。Webフォームはありません。
- お支払いは現金のみであることを、予約・来店相談時には必ずお伝えください。
- 営業時間・定休日・席数・アクセスなど事実情報は正確に答えてください。
- 知らない情報や不確かなことは推測せず、「お電話でお気軽にお尋ねください」とご案内してください。
- 回答は2〜3文を目安に、簡潔で読みやすく。
- 日本語で、絵文字は控えめに（提灯🏮や徳利など、和の雰囲気に合うものを時々）。`;

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
    this.fab.innerHTML = '<span class="chat-fab-icon">×</span>';
    if (this.messages.length === 0) {
      this.addBotMessage('いらっしゃいませ。バッチコイ酒場 まるちゅうへようこそ。\n営業時間・お席のご相談・名物のご案内など、お気軽にどうぞ。');
    }
    setTimeout(() => this.inputEl.focus(), 300);
  }

  close() {
    this.isOpen = false;
    this.window.classList.remove('open');
    this.fab.innerHTML = '<img class="chat-fab-logo" src="images/logo-maruchu.jpg" alt="まるちゅう">';
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

    // APIキー未設定（空 or プレースホルダー）の場合はAPI呼び出しを行わずに案内
    const keyConfigured =
      typeof ANTHROPIC_API_KEY === 'string' &&
      ANTHROPIC_API_KEY.startsWith('sk-ant-') &&
      ANTHROPIC_API_KEY.length > 60 &&
      /^[\x00-\x7F]+$/.test(ANTHROPIC_API_KEY); // 非ASCII（プレースホルダー和文）を除外
    if (!keyConfigured) {
      this.addUserMessage(text);
      this.inputEl.value = '';
      this.addBotMessage('ただいま案内サービスをご利用いただけません。お電話（048-577-7677）にてお気軽にお問い合わせください。');
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
      this.addBotMessage('通信に失敗してしまいました。お手数ですが、お電話（048-577-7677）にてご連絡ください。');
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

  // お品書きタブ切り替え
  const tabs = document.querySelectorAll('.menu-tab');
  const panes = document.querySelectorAll('.menu-pane');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      tabs.forEach(t => t.classList.toggle('is-active', t === tab));
      panes.forEach(p => p.classList.toggle('is-active', p.dataset.pane === target));
    });
  });

  // ===============================
  // スクロール連動アニメーション
  // 可視時に .is-revealed を付与（CSS側で transition）
  // prefers-reduced-motion なら全要素を即時表示
  // ===============================
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const revealTargets = document.querySelectorAll(
    '.section-title, .section-label, .section-desc, ' +
    '.sig-card, .menu-tabs, .menu-pane, ' +
    '.info-table tr, .info-cta, ' +
    '.concept-image, .concept-text, ' +
    '.gallery .g, ' +
    '.access-map, .footer-inner'
  );
  if (reduce || !('IntersectionObserver' in window)) {
    revealTargets.forEach(el => el.classList.add('is-revealed'));
  } else {
    // Signatureカードに順序遅延を付与
    document.querySelectorAll('.signature-grid .sig-card').forEach((el, i) => {
      el.style.setProperty('--reveal-delay', `${i * 90}ms`);
    });
    document.querySelectorAll('.info-table tr').forEach((el, i) => {
      el.style.setProperty('--reveal-delay', `${i * 60}ms`);
    });
    document.querySelectorAll('.gallery .g').forEach((el, i) => {
      el.style.setProperty('--reveal-delay', `${i * 70}ms`);
    });

    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-revealed');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });

    revealTargets.forEach(el => io.observe(el));
  }
});
