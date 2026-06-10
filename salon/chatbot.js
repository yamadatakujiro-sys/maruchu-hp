/* ===============================
   hair atelier SOIE
   AIチャットボット + ページUI制御
   =============================== */

// APIキーは config.js で設定（.gitignore 対象 / 未設定でも動作する）

// サロン情報をシステムプロンプトに設定
const SYSTEM_PROMPT = `あなたは表参道の美容室「hair atelier SOIE（ソワ）」のAIコンシェルジュです。

【サロン情報】
- 店名: hair atelier SOIE（ソワ）
- 住所: 東京都港区南青山5-1-1 ソワビル 2F（表参道駅 B1出口 徒歩3分）
- 電話: 03-0000-0000
- 営業時間: 10:00〜19:00（最終受付 18:00）
- 定休日: 毎週火曜日・第2水曜日
- 完全予約制 / セット面4席のプライベートサロン
- コンセプト: 「絹のように、しなやかに。」髪質改善とパーソナルなスタイル提案が得意。

【メニュー（税込）】
- カット（シャンプー・ブロー込）: ¥6,600
- カット＋カラー: ¥13,200〜
- カット＋パーマ: ¥14,300〜
- 髪質改善トリートメント（人気No.1）: ¥8,800〜
- 縮毛矯正（カット込）: ¥18,700〜
- ヘッドスパ（30分）: ¥5,500

【スタイリスト】
- 高瀬 美織（代表/トップスタイリスト）: 髪質改善・大人世代のスタイル提案が得意
- 桐山 蒼（スタイリスト）: ショート・ボブのカットに定評
- 小野寺 凛（カラーリスト）: 透明感カラー・似合わせカラーのスペシャリスト

【対応方針】
- ご予約はお電話（03-0000-0000）へ誘導してください。
- メニュー・料金・営業時間・アクセスの質問には丁寧に回答してください。
- 髪の悩み相談には共感しつつ、来店カウンセリングをおすすめしてください。
- 回答は簡潔に、2〜3文程度でまとめてください。
- 日本語で、上品で柔らかい接客トーンで回答してください。`;

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
      this.addBotMessage('こんにちは。hair atelier SOIE のAIコンシェルジュです🌿\nメニュー・料金・髪のお悩みなど、お気軽にご相談ください。');
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
      this.addBotMessage('デモサイトのためAI応答は停止中です🙇\n実際の導入時には、サロン情報を学習したAIが24時間ご質問にお答えします。\nご予約はお電話（03-0000-0000）にて承ります。');
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

// DOM準備完了後に初期化
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
