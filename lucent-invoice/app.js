/* ===== Lucent 請求書管理：アプリ本体 =====
 * 起動用サーバー（tools/server.py）経由で開いた場合、データはMacの ~/.lucent-invoice/data.json に保存され、
 * Mac・スマホで同じデータを使える（ブラウザの localStorage は表示を速くするための控え）。
 * ファイルを直接開いた場合は、この端末のブラウザ内だけに保存される。
 */
(function () {
  'use strict';

  const STORE_KEY = 'lucent-invoice-v1';

  // ---------- 初期データ（自社情報は添付の請求書より。振込先は設定画面で入力） ----------
  const DEFAULT_STATE = {
    settings: {
      companyName: 'Lucent',
      postal: '360-0037',
      address: '埼玉県熊谷市筑波3-53\nダイコー第二ビル40A',
      tel: '048-524-1616',
      fax: '',
      email: '',
      registrationNo: '', // 適格請求書発行事業者の登録番号（T＋13桁）
      bank: '',           // 例：〇〇銀行 〇〇支店 普通 1234567 カナメイギ
      notes: 'この度はご注文いただき、誠にありがとうございました。またのご利用をお待ちしております。\n\n銀行からの振り込み手数料は貴社ご負担にて宜しくお願い致します。',
      taxRate: 10,
      rounding: 'floor', // floor=切り捨て / round=四捨五入 / ceil=切り上げ
      dueRule: 'nextMonthEnd', // nextMonthEnd=翌月末 / monthEnd=当月末 / none=記載なし
      nextNumber: 346,         // 請求書の次の番号
      nextQuoteNumber: 1,      // 見積書（Q0001〜）
      nextDeliveryNumber: 1,   // 納品書（D0001〜）
      quoteNotes: 'お見積りの有効期限は発行日より30日間です。\nご不明な点がございましたらお気軽にお問い合わせください。',
      deliveryNotes: '上記の通り納品いたしました。ご査収のほどよろしくお願い申し上げます。'
    },
    customers: [],
    invoices: [],   // 請求書・見積書・納品書（docType で区別）
    deleted: {}     // 削除した記録のID → 削除日時（他の端末にも削除を伝えるため）
  };

  // ---------- 保存・読み込み ----------
  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        return normalizeState(s);
      }
    } catch (e) { console.warn('読み込み失敗', e); }
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }

  function normalizeState(s) {
    return {
      settings: Object.assign({}, DEFAULT_STATE.settings, (s && s.settings) || {}),
      customers: (s && s.customers) || [],
      invoices: (s && s.invoices) || [],
      deleted: (s && s.deleted) || {}
    };
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      if (!SERVER) { alert('保存に失敗しました。ブラウザの保存領域を確認してください。\n' + e.message); return false; }
    }
    if (SERVER) schedulePush();
    return true;
  }
  const nowIso = () => new Date().toISOString();
  // 変更した記録に更新日時を付ける（端末間で新しい方を採用するため）
  function touch(obj) { obj.updatedAt = nowIso(); return obj; }
  function touchSettings() { state.settings.updatedAt = nowIso(); }
  function markDeleted(id) { if (id) state.deleted[id] = nowIso(); }

  // ---------- サーバー（Mac）とのデータ共有 ----------
  const SERVER = location.protocol === 'http:' || location.protocol === 'https:';
  let serverRev = 0, pushTimer = null, pushing = null, authRequired = false;
  async function api(path, body) {
    const res = await fetch(path, body === undefined ? { credentials: 'same-origin' } : {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Lucent': '1' }, body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && data.error === 'login') { authRequired = true; renderLogin(data.pinSet); throw new Error('ログインが必要です'); }
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }
  function schedulePush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushState, 300);
  }
  async function pushState() {
    if (authRequired) return;
    if (pushing) { schedulePush(); return; }
    pushing = (async () => {
      try {
        const r = await api('/api/data', { state });
        serverRev = r.rev;
        adoptState(r.state);
        setSyncBadge('');
      } catch (e) {
        setSyncBadge('⚠ Macに保存できていません（' + e.message + '）');
      } finally { pushing = null; }
    })();
    return pushing;
  }
  async function pullState() {
    if (authRequired || pushing || pushTimer && document.querySelector('#f')) return;
    try {
      const r = await api('/api/data');
      if (r.rev !== serverRev && r.state) {
        serverRev = r.rev;
        if (adoptState(r.state)) rerenderIfIdle();
      }
      setSyncBadge('');
    } catch (e) { setSyncBadge('⚠ Macと通信できません'); }
  }
  // サーバーのデータを取り込む。既存の記録は同じオブジェクトのまま中身を更新する（表示中の画面が壊れないように）
  function adoptState(ns) {
    ns = normalizeState(ns);
    let changed = JSON.stringify(ns.settings) !== JSON.stringify(state.settings);
    Object.keys(state.settings).forEach((k) => { if (!(k in ns.settings)) delete state.settings[k]; });
    Object.assign(state.settings, ns.settings);
    ['invoices', 'customers'].forEach((coll) => {
      const byId = new Map(state[coll].map((r) => [r.id, r]));
      const next = ns[coll].map((r) => {
        const cur = byId.get(r.id);
        if (!cur) { changed = true; return r; }
        if (JSON.stringify(cur) !== JSON.stringify(r)) {
          changed = true;
          Object.keys(cur).forEach((k) => { if (!(k in r)) delete cur[k]; });
          Object.assign(cur, r);
        }
        return cur;
      });
      if (next.length !== state[coll].length) changed = true;
      state[coll] = next;
    });
    state.deleted = ns.deleted;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* 控えなので失敗しても続行 */ }
    return changed;
  }
  function isEditing() {
    const h = location.hash;
    return /\/(new|edit)(\?|$)/.test(h) || h.startsWith('#/customers/') || h.startsWith('#/settings') || !!document.querySelector('.send-panel:not([hidden])');
  }
  function rerenderIfIdle() { if (!isEditing()) route(); }
  function setSyncBadge(msg) {
    let el = $('#syncBadge');
    if (!el) { el = document.createElement('div'); el.id = 'syncBadge'; el.className = 'sync-badge no-print'; document.body.appendChild(el); }
    el.textContent = msg; el.hidden = !msg;
  }

  // ---------- ユーティリティ ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const yen = (n) => '¥' + Math.round(n || 0).toLocaleString('ja-JP');
  const num = (n) => Math.round(n || 0).toLocaleString('ja-JP');
  const toInt = (v) => { const n = parseInt(String(v).replace(/[^\d-]/g, ''), 10); return isNaN(n) ? 0 : n; };

  function pad(n) { return String(n).padStart(2, '0'); }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today() { return ymd(new Date()); }
  function fmtDate(s) { return s ? s.replace(/-/g, '/') : ''; }
  function md(s) { if (!s) return ''; const [, m, d] = s.split('-'); return Number(m) + '/' + Number(d); }
  function ym(s) { return s ? s.slice(0, 7) : ''; }

  function calcDue(issueDate, rule) {
    if (!issueDate || rule === 'none') return '';
    const [y, m] = issueDate.split('-').map(Number);
    // 当月末＝翌月0日、翌月末＝翌々月0日
    const d = new Date(y, m - 1 + (rule === 'nextMonthEnd' ? 2 : 1), 0);
    return ymd(d);
  }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ---------- 金額計算 ----------
  function roundTax(x) {
    const r = state.settings.rounding;
    return r === 'ceil' ? Math.ceil(x) : r === 'round' ? Math.round(x) : Math.floor(x);
  }
  function lineAmount(it) { return toInt(it.qty) * toInt(it.price); }
  function calcTotals(inv) {
    // MakeLeapsから取り込んだ請求書は、明細を編集するまで元の金額をそのまま使う
    if (inv.importedTotals) {
      const t = inv.importedTotals;
      return { subtotal: t.subtotal, tax: t.tax, total: t.total, rate: state.settings.taxRate };
    }
    const subtotal = inv.items.reduce((s, it) => s + lineAmount(it), 0);
    const rate = inv.taxRate != null ? inv.taxRate : state.settings.taxRate;
    const tax = roundTax(subtotal * rate / 100);
    return { subtotal, tax, total: subtotal + tax, rate };
  }
  // 税込合計 target になる小計を探す（端数調整用）
  function subtotalForTotal(target, rate) {
    const base = Math.floor(target / (1 + rate / 100));
    let best = null;
    for (let s = base - 3; s <= base + 3; s++) {
      const t = s + roundTax(s * rate / 100);
      if (t === target) return { subtotal: s, exact: true };
      if (best === null || Math.abs(t - target) < Math.abs(best.t - target)) best = { subtotal: s, t };
    }
    return { subtotal: best.subtotal, exact: false };
  }
  // 明細1行の表示名（例：8/5マークX GRX130 左フェンダー）
  function itemLabel(it) {
    return [md(it.date) + (it.car || ''), it.part || ''].filter(Boolean).join(' ').trim();
  }

  // ---------- 書類の種類（請求書・見積書・納品書） ----------
  const DOC = {
    invoice: { label: '請求書', title: '御請求書', numKey: 'nextNumber', prefix: '', dateLabel: '発行日', dueLabel: 'お支払期限', lead: '下記の通りご請求申し上げます。', totalLabel: 'ご請求金額（税込）' },
    quote: { label: '見積書', title: '御見積書', numKey: 'nextQuoteNumber', prefix: 'Q', dateLabel: '見積日', dueLabel: '有効期限', lead: '下記の通り御見積申し上げます。', totalLabel: '御見積金額（税込）' },
    delivery: { label: '納品書', title: '納品書', numKey: 'nextDeliveryNumber', prefix: 'D', dateLabel: '納品日', dueLabel: '', lead: '下記の通り納品いたしました。', totalLabel: '合計金額（税込）' }
  };
  const typeOf = (inv) => (inv && DOC[inv.docType]) ? inv.docType : 'invoice';
  const isInvoice = (inv) => typeOf(inv) === 'invoice';
  const formatNumber = (type, n) => DOC[type].prefix ? DOC[type].prefix + String(n).padStart(4, '0') : String(n);
  const nextNumberFor = (type) => formatNumber(type, state.settings[DOC[type].numKey] || 1);
  function bumpNumber(type, number) {
    const n = toInt(number), k = DOC[type].numKey;
    if (n && n < 1e9 && n >= (state.settings[k] || 0)) { state.settings[k] = n + 1; touchSettings(); }
  }
  function addDays(dateStr, days) { const d = new Date(dateStr + 'T00:00:00'); d.setDate(d.getDate() + days); return ymd(d); }
  function defaultDue(type, issueDate) {
    if (type === 'quote') return addDays(issueDate, 30);
    if (type === 'delivery') return '';
    return calcDue(issueDate, state.settings.dueRule);
  }
  const defaultNotes = (type) => type === 'quote' ? state.settings.quoteNotes : type === 'delivery' ? state.settings.deliveryNotes : state.settings.notes;

  // ---------- 状態判定 ----------
  function statusOf(inv) {
    const t = typeOf(inv);
    if (inv.status === 'draft') return 'draft';
    if (t === 'quote') return inv.status === 'accepted' ? 'accepted' : inv.status === 'lost' ? 'lost' : 'submitted';
    if (t === 'delivery') return 'delivered';
    if (inv.status === 'paid') return 'paid';
    if (inv.dueDate && inv.dueDate < today()) return 'overdue';
    return 'issued';
  }
  const STATUS_LABEL = { draft: '下書き', issued: '未入金', overdue: '期限超過', paid: '入金済', submitted: '提出済', accepted: '受注', lost: '失注', delivered: '納品済' };
  const STATUS_CLASS = { submitted: 'issued', accepted: 'paid', lost: 'draft', delivered: 'paid' };
  const badge = (inv) => { const s = statusOf(inv); return `<span class="badge ${STATUS_CLASS[s] || s}">${STATUS_LABEL[s]}</span>`; };
  const typeTag = (inv) => isInvoice(inv) ? '' : `<span class="badge type-${typeOf(inv)}">${DOC[typeOf(inv)].label}</span> `;

  function findCustomer(id) { return state.customers.find((c) => c.id === id); }
  function findInvoice(id) { return state.invoices.find((i) => i.id === id); }
  function sortedInvoices() {
    return state.invoices.slice().sort((a, b) => (b.issueDate || '').localeCompare(a.issueDate || '') || toInt(b.number) - toInt(a.number));
  }

  // ---------- ルーター ----------
  const app = $('#app');
  function hashQuery() { return new URLSearchParams((location.hash.split('?')[1]) || ''); }
  function route() {
    if (authRequired) return;
    const parts = (location.hash.replace(/^#\/?/, '').split('?')[0] || '').split('/').filter(Boolean);
    const [a, b, c] = parts;
    let nav = 'dashboard';
    if (!a) renderDashboard();
    else if (a === 'invoices' && !b) { nav = 'invoices'; renderInvoiceList(); }
    else if (a === 'invoices' && b === 'new') { nav = 'new'; renderEditor(null); }
    else if (a === 'invoices' && c === 'edit') { nav = 'invoices'; renderEditor(b); }
    else if (a === 'invoices' && b) { nav = 'invoices'; renderInvoiceView(b); }
    else if (a === 'customers' && !b) { nav = 'customers'; renderCustomerList(); }
    else if (a === 'customers' && b) { nav = 'customers'; renderCustomerForm(b === 'new' ? null : b); }
    else if (a === 'settings') { nav = 'settings'; renderSettings(); }
    else renderDashboard();
    $$('#nav a').forEach((el) => el.classList.toggle('active', el.dataset.nav === nav));
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);

  // ================= ダッシュボード =================
  function renderDashboard() {
    const now = today();
    const thisMonth = ym(now);
    const issued = state.invoices.filter((i) => isInvoice(i) && i.status !== 'draft');
    const openQuotes = state.invoices.filter((i) => typeOf(i) === 'quote' && statusOf(i) === 'submitted');
    const monthSales = issued.filter((i) => ym(i.issueDate) === thisMonth).reduce((s, i) => s + calcTotals(i).total, 0);
    const unpaid = issued.filter((i) => i.status !== 'paid');
    const unpaidSum = unpaid.reduce((s, i) => s + calcTotals(i).total, 0);
    const overdue = unpaid.filter((i) => statusOf(i) === 'overdue');
    const overdueSum = overdue.reduce((s, i) => s + calcTotals(i).total, 0);
    const yearStart = now.slice(0, 4) + '-01-01';
    const yearSales = issued.filter((i) => i.issueDate >= yearStart).reduce((s, i) => s + calcTotals(i).total, 0);

    // 直近12か月の月別売上
    const months = [];
    const d = new Date();
    for (let k = 11; k >= 0; k--) {
      const m = new Date(d.getFullYear(), d.getMonth() - k, 1);
      months.push(m.getFullYear() + '-' + pad(m.getMonth() + 1));
    }
    const byMonth = months.map((m) => ({ m, v: issued.filter((i) => ym(i.issueDate) === m).reduce((s, i) => s + calcTotals(i).total, 0) }));
    const maxM = Math.max(1, ...byMonth.map((x) => x.v));

    // 取引先別（今年）
    const byCust = {};
    issued.filter((i) => i.issueDate >= yearStart).forEach((i) => {
      const k = i.customerName || '（未設定）';
      byCust[k] = (byCust[k] || 0) + calcTotals(i).total;
    });
    const custRank = Object.entries(byCust).sort((a, b) => b[1] - a[1]).slice(0, 8);

    const unpaidList = unpaid.slice().sort((a, b) => (a.dueDate || '9').localeCompare(b.dueDate || '9'));

    app.innerHTML = `
      <div class="page-head">
        <div><h1>ホーム</h1><div class="muted small">${fmtDate(now)} 現在${state.settings.lastMakeLeapsImport ? '・MakeLeaps同期 ' + new Date(state.settings.lastMakeLeapsImport).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</div></div>
        <div class="btn-row">
          ${SERVER ? `<button class="btn" data-sync>🔄 MakeLeapsと同期</button>` : ''}
          <a class="btn" href="#/invoices/new?type=quote">＋ 見積書</a>
          <a class="btn primary" href="#/invoices/new">＋ 請求書を作成</a>
        </div>
      </div>
      ${openQuotes.length ? `<div class="card small">📝 提出中の見積書が <a href="#/invoices?type=quote">${openQuotes.length}件</a> あります（${yen(openQuotes.reduce((s, i) => s + calcTotals(i).total, 0))}）</div>` : ''}
      ${!state.invoices.length ? `<div class="card" style="background:var(--orange-soft)">
        <h2>はじめに：MakeLeapsのデータを読み込みましょう</h2>
        <p class="small" style="margin:0 0 10px">${SERVER ? '「設定」でMakeLeapsのクライアントIDとシークレットを入力して「接続設定を保存」を押すと、今年の請求書（内訳・入金状態つき）が読み込まれます。設定済みなら右上の「🔄 MakeLeapsと同期」を押してください。' : '「Lucent請求書.command」をダブルクリックして開くと、MakeLeapsと同期できます。'}</p>
        ${SERVER ? '<a class="btn primary" href="#/settings">設定を開く</a>' : ''}
      </div>` : ''}
      <div class="stats">
        <div class="stat"><div class="label">今月の売上（税込）</div><div class="value">${yen(monthSales)}</div></div>
        <div class="stat"><div class="label">今年の売上（税込）</div><div class="value">${yen(yearSales)}</div></div>
        <div class="stat"><div class="label">未入金</div><div class="value">${yen(unpaidSum)}</div><div class="sub">${unpaid.length}件</div></div>
        <div class="stat ${overdue.length ? 'alert' : ''}"><div class="label">期限超過</div><div class="value">${yen(overdueSum)}</div><div class="sub">${overdue.length}件</div></div>
      </div>

      <div class="card">
        <h2>入金待ちの請求書</h2>
        ${unpaidList.length ? `<ul class="list">${unpaidList.map((i) => invoiceRow(i, true)).join('')}</ul>` : '<div class="empty">入金待ちはありません 🎉</div>'}
      </div>

      <div class="grid-2">
        <div class="card">
          <h2>月別売上（直近12か月）</h2>
          <table class="tbl">
            ${byMonth.map((x) => `<tr><td style="width:70px">${x.m.replace('-', '/')}</td>
              <td><div class="bar" style="width:${(x.v / maxM * 100).toFixed(1)}%;${x.v ? '' : 'opacity:.15'}"></div></td>
              <td class="num" style="width:110px">${num(x.v)}</td></tr>`).join('')}
          </table>
        </div>
        <div class="card">
          <h2>取引先別売上（今年）</h2>
          ${custRank.length ? `<table class="tbl">${custRank.map(([n, v]) => `<tr><td>${esc(n)}</td><td class="num">${yen(v)}</td></tr>`).join('')}</table>` : '<div class="empty">データがまだありません</div>'}
        </div>
      </div>`;
  }

  function invoiceRow(inv, withPay) {
    const t = calcTotals(inv);
    const payBtn = withPay === true && isInvoice(inv) && inv.status !== 'paid' ? `<button class="btn sm primary pay-btn" data-pay="${inv.id}">入金</button>` : '';
    const lastSent = (inv.sent || [])[inv.sent ? inv.sent.length - 1 : 0];
    return `<li class="${payBtn ? 'has-action' : ''}"><a class="row" href="#/invoices/${inv.id}">
      <span class="title">${typeTag(inv)}No.${esc(inv.number)}　${esc(inv.customerName || '（取引先未設定）')}</span>
      <span class="amount">${yen(t.total)}</span>
      <span class="meta">${fmtDate(inv.issueDate)} ${DOC[typeOf(inv)].dateLabel.replace('日', '')}${inv.dueDate ? '・期限 ' + fmtDate(inv.dueDate) : ''}${inv.paidDate ? '・入金 ' + fmtDate(inv.paidDate) : ''}${lastSent ? '・送付 ' + fmtDate(lastSent.at.slice(0, 10)) : ''}${inv.source === 'makeleaps' ? '・MakeLeaps' : ''}</span>
      <span>${badge(inv)}</span>
    </a>${payBtn}</li>`;
  }

  // ---------- 入金の消し込み（入金日・入金額を入れて入金済にする） ----------
  function markPaid(inv) {
    const total = calcTotals(inv).total;
    const d = prompt(`No.${inv.number} ${inv.customerName}（${yen(total)}）\n\n入金日（YYYY-MM-DD）`, today());
    if (d === null) return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { toast('日付の形式が正しくありません（例：2026-10-01）'); return false; }
    const amt = prompt('入金額（振込手数料を引かれていたら実際の入金額）', total);
    if (amt === null) return false;
    Object.assign(inv, { status: 'paid', paidDate: d, paidAmount: toInt(amt), updatedAt: new Date().toISOString() });
    if (toInt(amt) !== total) inv.memo = (inv.memo ? inv.memo + ' / ' : '') + `入金差額 ${num(toInt(amt) - total)}円`;
    save(); toast(`No.${inv.number} を入金済にしました`);
    return true;
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-sync]')) { e.preventDefault(); syncMakeLeaps(); }
  });
  // 一覧の「入金」ボタン（どの画面でも共通で拾う）
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pay]');
    if (!b) return;
    e.preventDefault();
    const inv = findInvoice(b.dataset.pay);
    if (inv && !isInvoice(inv)) return;
    if (inv && markPaid(inv)) route();
  });

  // ---------- MakeLeaps 同期（起動用サーバー経由） ----------
  let syncing = false;
  async function syncMakeLeaps(opts = {}) {
    if (!SERVER) { alert('同期は「Lucent請求書.command」から開いたときに使えます。'); return; }
    if (syncing) return;
    syncing = true;
    $$('[data-sync]').forEach((b) => { b.dataset.label = b.dataset.label || b.textContent; b.disabled = true; b.textContent = '同期中…'; });
    if (!opts.silent) toast('MakeLeapsからデータを取得しています…');
    try {
      const d = await api('/api/sync', { all: !!opts.all });
      const res = importMakeLeaps(d);
      state.settings.lastMakeLeapsImport = new Date().toISOString();
      save();
      const g = d.diagnostics || {};
      let msg = `同期完了：新規 ${res.added}件／更新 ${res.updated}件`;
      const missing = state.invoices.filter((i) => i.source === 'makeleaps' && !(i.items || []).some((it) => it.part || toInt(it.price)));
      if (missing.length) msg += `\n\n⚠ 内訳が入っていない請求書：${missing.length}件（No.${missing.map((i) => i.number).join(', No.')}）\n請求書を開くと「原因を調べる」ボタンがあります。`;
      if (missing.length && g.invoices && g.withItems) {
        alert(msg);
      } else if (g.invoices && !g.withItems) {
        alert(msg + '\n\n⚠ 明細（内訳）が取得できませんでした。この画面のスクリーンショットを送ってください。\n診断：' + JSON.stringify(g.lineitems) + '\n項目：' + JSON.stringify(g.itemFields));
      } else if (!opts.silent || res.added) toast(msg);
    } catch (err) {
      if (!opts.silent) alert('同期できませんでした：' + err.message);
    } finally {
      syncing = false;
      $$('[data-sync]').forEach((b) => { b.disabled = false; if (b.dataset.label) b.textContent = b.dataset.label; });
      // 入力中の画面（作成・編集・取引先・設定）は描き直さない
      const h = location.hash;
      if (!/\/(new|edit)$/.test(h) && !h.startsWith('#/customers/') && !h.startsWith('#/settings')) route();
    }
  }

  // ================= 請求書一覧 =================
  function renderInvoiceList() {
    const type = DOC[hashQuery().get('type')] ? hashQuery().get('type') : 'invoice';
    const docs = state.invoices.filter((i) => typeOf(i) === type);
    const months = Array.from(new Set(docs.map((i) => ym(i.issueDate)).filter(Boolean))).sort().reverse();
    const statusOpts = type === 'invoice'
      ? [['unpaid', '未入金（期限超過含む）'], ['overdue', '期限超過'], ['paid', '入金済'], ['draft', '下書き']]
      : type === 'quote' ? [['submitted', '提出済'], ['accepted', '受注'], ['lost', '失注'], ['draft', '下書き']]
        : [['delivered', '納品済'], ['draft', '下書き']];
    app.innerHTML = `
      <div class="page-head">
        <div><h1>書類</h1><div class="muted small">${DOC[type].label} ${docs.length}件</div></div>
        <div class="btn-row">
          <button class="btn" id="csv">CSV出力</button>
          <a class="btn primary" href="#/invoices/new?type=${type}">＋ ${DOC[type].label}を作成</a>
        </div>
      </div>
      <div class="tabs">${Object.keys(DOC).map((k) => `<a href="#/invoices?type=${k}" class="${k === type ? 'active' : ''}">${DOC[k].label}<span>${state.invoices.filter((i) => typeOf(i) === k).length}</span></a>`).join('')}</div>
      <div class="card">
        <div class="filters">
          <input class="search" id="q" type="search" placeholder="取引先・番号・車種・部品で検索">
          <select id="fs">
            <option value="">すべての状態</option>
            ${statusOpts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
          </select>
          <select id="fm"><option value="">すべての月</option>${months.map((m) => `<option value="${m}">${m.replace('-', '年')}月</option>`).join('')}</select>
        </div>
        <ul class="list" id="list"></ul>
        <div class="muted small" id="sum" style="text-align:right;margin-top:8px"></div>
      </div>`;

    const draw = () => {
      const q = $('#q').value.trim().toLowerCase();
      const fs = $('#fs').value, fm = $('#fm').value;
      const rows = sortedInvoices().filter((inv) => typeOf(inv) === type).filter((inv) => {
        const s = statusOf(inv);
        if (fs === 'unpaid' && !(s === 'issued' || s === 'overdue')) return false;
        if (fs && fs !== 'unpaid' && s !== fs) return false;
        if (fm && ym(inv.issueDate) !== fm) return false;
        if (q) {
          const hay = [inv.number, inv.customerName, ...inv.items.map((it) => it.car + ' ' + it.part)].join(' ').toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
      $('#list').innerHTML = rows.length ? rows.map((r) => invoiceRow(r)).join('') : `<li class="empty">該当する${DOC[type].label}はありません</li>`;
      $('#sum').textContent = rows.length ? `${rows.length}件　合計 ${yen(rows.reduce((s, i) => s + calcTotals(i).total, 0))}` : '';
      draw.rows = rows;
    };
    ['q', 'fs', 'fm'].forEach((id) => $('#' + id).addEventListener('input', draw));
    $('#csv').addEventListener('click', () => exportCsv(draw.rows || [], DOC[type].label));
    draw();
  }

  function exportCsv(rows, label = '請求書') {
    const head = [label + '番号', '日付', '期限', '取引先', '小計', '消費税', '合計', '状態', '入金日', '入金額', '明細'];
    const lines = [head].concat(rows.map((inv) => {
      const t = calcTotals(inv);
      return [inv.number, fmtDate(inv.issueDate), fmtDate(inv.dueDate), inv.customerName, t.subtotal, t.tax, t.total,
        STATUS_LABEL[statusOf(inv)], fmtDate(inv.paidDate), inv.paidAmount || '', inv.items.map((it) => itemLabel(it) + (it.condition ? `（${it.condition.replace(/\s+/g, ' ')}）` : '')).join(' / ')];
    }));
    const csv = lines.map((r) => r.map((v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    download('﻿' + csv, `${label}一覧_${today()}.csv`, 'text/csv');
  }

  function download(text, name, type) {
    const blob = new Blob([text], { type: type + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ================= 請求書エディタ =================
  function newInvoice(type = 'invoice') {
    const issueDate = today();
    return {
      id: null, docType: type, number: nextNumberFor(type), issueDate, dueDate: defaultDue(type, issueDate),
      customerId: '', customerName: '', honorific: '御中', customerPostal: '', customerAddress: '', customerTel: '', customerFax: '', customerEmail: '',
      items: [{ date: issueDate, car: '', part: '', qty: 1, price: 0 }],
      notes: defaultNotes(type), status: 'issued', paidDate: '', paidAmount: '', memo: ''
    };
  }
  // 別の書類から新しい書類を作る（見積→納品書・請求書、納品書→請求書、複製）
  function draftFrom(src, type) {
    const d = newInvoice(type);
    Object.assign(d, {
      customerId: src.customerId, customerName: src.customerName, honorific: src.honorific,
      customerPostal: src.customerPostal, customerAddress: src.customerAddress, customerTel: src.customerTel,
      customerFax: src.customerFax, customerEmail: src.customerEmail || '',
      items: src.items.map((it) => Object.assign({}, it)), sourceId: src.id
    });
    return d;
  }

  function renderEditor(id) {
    const src = id ? findInvoice(id) : null;
    if (id && !src) { app.innerHTML = '<div class="empty">請求書が見つかりません</div>'; return; }
    // 編集はコピーに対して行い、保存時に反映する
    const qType = DOC[hashQuery().get('type')] ? hashQuery().get('type') : 'invoice';
    const inv = src ? JSON.parse(JSON.stringify(src)) : (renderEditor.draft || newInvoice(qType));
    renderEditor.draft = null;
    const type = typeOf(inv), D = DOC[type];
    const quoteItems = type === 'quote'; // 見積書は「商品の状態」欄＋金額だけ。請求書・納品書は数量・単価あり
    const statusOpts = type === 'invoice' ? [['draft', '下書き'], ['issued', '発行済（未入金）'], ['paid', '入金済']]
      : type === 'quote' ? [['draft', '下書き'], ['issued', '提出済'], ['accepted', '受注'], ['lost', '失注']]
        : [['draft', '下書き'], ['issued', '納品済']];

    app.innerHTML = `
      <div class="page-head">
        <div><h1>${D.label}の${src ? '編集' : '作成'}</h1><div class="muted small">No.${esc(inv.number)}</div></div>
      </div>
      ${src ? '' : `<div class="tabs">${Object.keys(DOC).map((k) => `<a href="#/invoices/new?type=${k}" data-type="${k}" class="${k === type ? 'active' : ''}">${DOC[k].label}</a>`).join('')}</div>`}
      <form id="f" autocomplete="off">
        <div class="card">
          <h2>宛先</h2>
          <div class="grid-2">
            <label class="field"><span>取引先名（候補から選択 or 新しく入力）</span>
              <input name="customerName" list="custlist" value="${esc(inv.customerName)}" placeholder="例：有限会社 〇〇自動車" required>
              <datalist id="custlist">${state.customers.map((c) => `<option value="${esc(c.name)}">`).join('')}</datalist>
            </label>
            <label class="field"><span>敬称</span>
              <select name="honorific">${['御中', '様', '殿'].map((h) => `<option ${inv.honorific === h ? 'selected' : ''}>${h}</option>`).join('')}</select>
            </label>
          </div>
          <div class="grid-3">
            <label class="field"><span>郵便番号</span><input name="customerPostal" value="${esc(inv.customerPostal)}" placeholder="366-0051"></label>
            <label class="field"><span>TEL</span><input name="customerTel" value="${esc(inv.customerTel)}" inputmode="tel"></label>
            <label class="field"><span>FAX</span><input name="customerFax" value="${esc(inv.customerFax)}" inputmode="tel"></label>
          </div>
          <label class="field"><span>住所</span><textarea name="customerAddress" rows="2" style="min-height:56px">${esc(inv.customerAddress)}</textarea></label>
          <label class="field"><span>メールアドレス（メール送付用・任意）</span><input name="customerEmail" type="email" value="${esc(inv.customerEmail || '')}" placeholder="example@example.com"></label>
        </div>

        <div class="card">
          <h2>${D.label}の情報</h2>
          <div class="grid-3">
            <label class="field"><span>${D.label}番号</span><input name="number" value="${esc(inv.number)}" required></label>
            <label class="field"><span>${D.dateLabel}</span><input name="issueDate" type="date" value="${esc(inv.issueDate)}" required></label>
            ${D.dueLabel ? `<label class="field"><span>${D.dueLabel}（空欄で記載なし）</span><input name="dueDate" type="date" value="${esc(inv.dueDate)}"></label>` : '<input type="hidden" name="dueDate" value="">'}
          </div>
        </div>

        <div class="card">
          <h2>明細</h2>
          <div class="items-wrap ${quoteItems ? 'mode-quote' : 'mode-full'}">
            ${quoteItems
              ? '<div class="items-head"><span>日付</span><span>車種・型式</span><span>部品・品名</span><span>商品の状態（色・傷の場所など）</span><span>金額</span><span></span></div>'
              : '<div class="items-head"><span>日付</span><span>車種・型式</span><span>部品・品名</span><span>数量</span><span>単価</span><span>金額</span><span></span></div>'}
            <div class="items" id="items"></div>
          </div>
          <div class="btn-row" style="margin-top:10px">
            <button type="button" class="btn" id="addItem">＋ 行を追加</button>
            <span class="muted small" style="align-self:center">新しい行は前の行の日付・車種を引き継ぎます</span>
          </div>

          <div class="totals" id="totals" style="margin-top:16px"></div>
          <div class="adjust">
            <span>税込合計を</span><input id="target" inputmode="numeric" placeholder="80000">
            <span>円にそろえる</span>
            <button type="button" class="btn sm" id="doAdjust">最終行の単価で調整</button>
          </div>
        </div>

        <div class="card">
          <h2>備考・状態</h2>
          <label class="field"><span>備考（${D.label}に印字）</span><textarea name="notes" rows="4">${esc(inv.notes)}</textarea></label>
          <div class="grid-3">
            <label class="field"><span>状態</span>
              <select name="status">${statusOpts.map(([v, l]) => `<option value="${v}" ${inv.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
            </label>
            ${type === 'invoice' ? `<label class="field"><span>入金日</span><input name="paidDate" type="date" value="${esc(inv.paidDate)}"></label>
            <label class="field"><span>入金額</span><input name="paidAmount" inputmode="numeric" value="${esc(inv.paidAmount)}"></label>` : ''}
          </div>
          <label class="field"><span>社内メモ（印字されません）</span><input name="memo" value="${esc(inv.memo)}"></label>
        </div>

        <div class="sticky-actions">
          <a class="btn" href="${src ? '#/invoices/' + src.id : '#/invoices?type=' + type}">キャンセル</a>
          <button type="submit" class="btn primary">保存してプレビュー</button>
        </div>
      </form>`;

    const f = $('#f');
    const itemsEl = $('#items');
    $$('.tabs [data-type]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(f).entries());
      const d = newInvoice(a.dataset.type);
      ['customerName', 'honorific', 'customerPostal', 'customerAddress', 'customerTel', 'customerFax', 'customerEmail'].forEach((k) => { d[k] = fd[k] || ''; });
      d.items = inv.items;
      renderEditor.draft = d;
      history.replaceState(null, '', '#/invoices/new?type=' + a.dataset.type);
      route();
    }));

    function drawItems() {
      itemsEl.innerHTML = inv.items.map((it, i) => `
        <div class="item" data-i="${i}">
          <label class="f-date"><span class="lbl">日付</span><input type="date" data-k="date" value="${esc(it.date)}"></label>
          <label class="f-car"><span class="lbl">車種・型式</span><input data-k="car" value="${esc(it.car)}" placeholder="マークX GRX130"></label>
          <label class="f-part"><span class="lbl">部品・品名</span><input data-k="part" value="${esc(it.part)}" placeholder="左フェンダー"></label>
          ${quoteItems ? `<label class="f-cond"><span class="lbl">商品の状態（色・傷の場所など）</span><textarea data-k="condition" rows="2" placeholder="例：カラー070 パール。先端に小キズ2か所、裏側に補修跡あり">${esc(it.condition || '')}</textarea></label>
          <label class="f-amount"><span class="lbl">金額</span><input data-k="amount" inputmode="numeric" value="${lineAmount(it) || ''}" class="num" placeholder="0"></label>`
          : `<label class="f-qty"><span class="lbl">数量</span><input data-k="qty" inputmode="numeric" value="${esc(it.qty)}" class="num"></label>
          <label class="f-price"><span class="lbl">単価</span><input data-k="price" inputmode="numeric" value="${esc(it.price || '')}" class="num" placeholder="0"></label>
          <div class="f-total num" data-amt>${num(lineAmount(it))}</div>`}
          <div class="f-del"><button type="button" class="btn sm danger" data-del title="この行を削除">✕</button></div>
        </div>`).join('');
      $$('[data-k="condition"]', itemsEl).forEach((ta) => { if (ta.value) autoGrow(ta); });
      drawTotals();
    }
    function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, 320) + 'px'; }
    function drawTotals() {
      const t = calcTotals(inv);
      $('#totals').innerHTML = `
        <div><span>小計</span><span class="num">${yen(t.subtotal)}</span></div>
        <div><span>消費税（${t.rate}%）</span><span class="num">${yen(t.tax)}</span></div>
        <div class="grand"><span>合計金額</span><span class="num">${yen(t.total)}</span></div>`;
    }

    itemsEl.addEventListener('input', (e) => {
      const row = e.target.closest('.item'); const k = e.target.dataset.k;
      if (!row || !k) return;
      const it = inv.items[+row.dataset.i];
      if (k === 'condition') { it.condition = e.target.value; autoGrow(e.target); return; }
      delete inv.importedTotals;
      if (k === 'amount') { it.qty = 1; it.price = toInt(e.target.value); } else it[k] = (k === 'qty' || k === 'price') ? toInt(e.target.value) : e.target.value;
      const amt = $('[data-amt]', row); if (amt) amt.textContent = num(lineAmount(it));
      drawTotals();
    });
    itemsEl.addEventListener('click', (e) => {
      if (!e.target.closest('[data-del]')) return;
      const i = +e.target.closest('.item').dataset.i;
      delete inv.importedTotals;
      inv.items.splice(i, 1);
      if (!inv.items.length) inv.items.push({ date: f.issueDate.value, car: '', part: '', qty: 1, price: 0 });
      drawItems();
    });
    $('#addItem').addEventListener('click', () => {
      const last = inv.items[inv.items.length - 1] || {};
      delete inv.importedTotals;
      inv.items.push({ date: last.date || f.issueDate.value, car: last.car || '', part: '', qty: 1, price: 0 });
      drawItems();
      const inputs = $$('.item:last-child [data-k="part"]', itemsEl);
      if (inputs[0]) inputs[0].focus();
    });

    // 税込合計を指定して最終行の単価を調整（例：80,000円ぴったりにする）
    $('#doAdjust').addEventListener('click', () => {
      const target = toInt($('#target').value);
      if (!target) { toast('そろえたい税込合計を入力してください'); return; }
      const last = inv.items[inv.items.length - 1];
      const qty = toInt(last.qty) || 1;
      const rate = state.settings.taxRate;
      const { subtotal, exact } = subtotalForTotal(target, rate);
      const others = inv.items.slice(0, -1).reduce((s, it) => s + lineAmount(it), 0);
      const need = subtotal - others;
      if (need <= 0) { toast('他の行の合計が大きすぎて調整できません'); return; }
      if (need % qty !== 0) { toast('最終行の数量を1にしてから調整してください'); return; }
      delete inv.importedTotals;
      last.price = need / qty;
      drawItems();
      toast(exact ? `税込 ${yen(target)} にそろえました` : `端数の都合で ${yen(calcTotals(inv).total)} が最も近い金額です`);
    });

    // 取引先を選んだら住所などを自動入力
    f.customerName.addEventListener('change', () => {
      const c = state.customers.find((x) => x.name === f.customerName.value.trim());
      if (!c) return;
      f.honorific.value = c.honorific || '御中';
      f.customerPostal.value = c.postal || '';
      f.customerAddress.value = c.address || '';
      f.customerTel.value = c.tel || '';
      f.customerFax.value = c.fax || '';
      f.customerEmail.value = c.email || '';
    });
    // 発行日を変えたら支払期限も追従（新規作成時のみ）
    let prevIssue = inv.issueDate;
    f.issueDate.addEventListener('change', () => {
      if (!src) f.dueDate.value = defaultDue(type, f.issueDate.value);
      // 発行日と同じ日付だった明細は新しい発行日に追従させる
      let changed = false;
      inv.items.forEach((it) => { if (!it.date || it.date === prevIssue) { it.date = f.issueDate.value; changed = true; } });
      prevIssue = f.issueDate.value;
      if (changed) drawItems();
    });
    f.status.addEventListener('change', () => {
      if (f.status.value === 'paid' && f.paidDate && !f.paidDate.value) {
        f.paidDate.value = today();
        if (!f.paidAmount.value) f.paidAmount.value = calcTotals(inv).total;
      }
    });

    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(f).entries());
      const number = fd.number.trim();
      if (state.invoices.some((x) => typeOf(x) === type && x.number === number && x.id !== inv.id)) {
        if (!confirm(`${D.label}番号 ${number} は既に使われています。このまま保存しますか？`)) return;
      }
      inv.items = inv.items.filter((it) => it.part || it.car || it.condition || toInt(it.price));
      if (!inv.items.length) { toast('明細を1行以上入力してください'); drawItems(); return; }
      Object.assign(inv, {
        number, issueDate: fd.issueDate, dueDate: fd.dueDate,
        customerName: fd.customerName.trim(), honorific: fd.honorific,
        customerPostal: fd.customerPostal.trim(), customerAddress: fixPrefecture(fd.customerAddress.trim()),
        customerTel: fd.customerTel.trim(), customerFax: fd.customerFax.trim(), customerEmail: (fd.customerEmail || '').trim(),
        notes: fd.notes, status: fd.status, paidDate: fd.status === 'paid' ? fd.paidDate : '',
        paidAmount: fd.status === 'paid' ? toInt(fd.paidAmount) || '' : '', memo: fd.memo,
        docType: type, updatedAt: nowIso()
      });

      // 取引先マスタに自動登録・更新（メールは入力があるときだけ上書き）
      let c = state.customers.find((x) => x.name === inv.customerName);
      if (!c) { c = { id: uid(), name: inv.customerName }; state.customers.push(c); }
      Object.assign(c, { honorific: inv.honorific, postal: inv.customerPostal, address: inv.customerAddress, tel: inv.customerTel, fax: inv.customerFax });
      if (inv.customerEmail) c.email = inv.customerEmail;
      touch(c);
      inv.customerId = c.id;

      // 編集開始後に他の端末の同期で入れ替わっていても、IDで最新の記録を探して反映する
      const cur = src && findInvoice(src.id);
      if (cur) {
        if (!inv.importedTotals) delete cur.importedTotals; // 明細を編集したら再計算に切り替え
        Object.assign(cur, inv);
      } else {
        inv.id = inv.id || uid();
        inv.createdAt = inv.updatedAt;
        state.invoices.push(inv);
        bumpNumber(type, number); // 次の番号を進める
        // 見積書から作った書類なら、見積書を「受注」にする
        const from = inv.sourceId && findInvoice(inv.sourceId);
        if (from && typeOf(from) === 'quote' && from.status !== 'accepted') { from.status = 'accepted'; touch(from); }
      }
      if (save()) { toast('保存しました'); location.hash = '#/invoices/' + inv.id; }
    });

    drawItems();
  }

  // ================= 請求書プレビュー（印刷） =================
  function paperHtml(inv) {
    const s = state.settings;
    const t = calcTotals(inv);
    const type = typeOf(inv), D = DOC[type];
    const simple = type === 'quote' && inv.items.every((it) => toInt(it.qty) <= 1);
    const name = (it) => esc(itemLabel(it)) + (type === 'quote' && it.condition ? `<div class="cond">状態：${esc(it.condition)}</div>` : '');
    const rows = inv.items.map((it) => simple
      ? `<tr><td>${name(it)}</td><td class="c-amt">${toInt(it.price) ? num(lineAmount(it) || it.price) : ''}</td></tr>`
      : (!toInt(it.qty) && !toInt(it.price))
      ? `<tr><td>${name(it)}</td><td></td><td></td><td></td></tr>`
      : `<tr><td>${name(it)}</td><td class="c-qty">${num(it.qty)}</td><td class="c-price">${num(it.price)}</td><td class="c-amt">${num(lineAmount(it))}</td></tr>`);
    // 空行で紙面を整える（状態の説明が長いぶんは空行を減らして1枚に収める）
    const extraLines = type !== 'quote' ? 0 : inv.items.reduce((n, it) => n + (it.condition ? it.condition.split('\n').reduce((m, l) => m + Math.max(1, Math.ceil(l.length / 42)), 0) * 0.6 : 0), 0);
    while (rows.length + extraLines < 8) rows.push(simple ? '<tr><td></td><td></td></tr>' : '<tr><td></td><td></td><td></td><td></td></tr>');
    const br = (v) => esc(v).replace(/\n/g, '<br>');
    return `
      <div class="paper">
        <h1 class="doc-title">${D.title}</h1>
        <div class="head">
          <div>
            <div class="to-name">${esc(inv.customerName)}<small>${esc(inv.honorific)}</small></div>
            ${inv.customerPostal ? `<div>〒${esc(inv.customerPostal)}</div>` : ''}
            ${inv.customerAddress ? `<div>${br(inv.customerAddress)}</div>` : ''}
            ${inv.customerTel ? `<div>Tel：${esc(inv.customerTel)}</div>` : ''}
            ${inv.customerFax ? `<div>Fax：${esc(inv.customerFax)}</div>` : ''}
          </div>
          <div>
            <table class="meta-tbl">
              <tr><td>${D.label}番号</td><td>${esc(inv.number)}</td></tr>
              <tr><td>${D.dateLabel}</td><td>${fmtDate(inv.issueDate)}</td></tr>
              ${inv.dueDate && D.dueLabel ? `<tr><td>${D.dueLabel}</td><td>${fmtDate(inv.dueDate)}</td></tr>` : ''}
            </table>
            <div class="from-name">${esc(s.companyName)}</div>
            ${s.postal ? `<div>〒${esc(s.postal)}</div>` : ''}
            ${s.address ? `<div>${br(s.address)}</div>` : ''}
            ${s.tel ? `<div>Tel：${esc(s.tel)}</div>` : ''}
            ${s.fax ? `<div>Fax：${esc(s.fax)}</div>` : ''}
            ${s.email ? `<div>${esc(s.email)}</div>` : ''}
            ${s.registrationNo ? `<div>登録番号：${esc(s.registrationNo)}</div>` : ''}
          </div>
        </div>
        <p class="lead">${D.lead}</p>
        <div class="total-box"><span class="t">${D.totalLabel}</span><span class="v">${yen(t.total)}</span></div>
        <table class="lines">
          <thead><tr><th>項目</th>${simple ? '' : '<th class="c-qty">数量</th><th class="c-price">単価</th>'}<th class="c-amt">金額</th></tr></thead>
          <tbody>${rows.join('')}</tbody>
        </table>
        <table class="sum-tbl">
          <tr><td>小計</td><td>${num(t.subtotal)}</td></tr>
          <tr><td>消費税（${t.rate}%）</td><td>${num(t.tax)}</td></tr>
          <tr class="grand"><td>合計金額</td><td>${num(t.total)}</td></tr>
        </table>
        <div class="foot">
          ${s.bank && type === 'invoice' ? `<div><h3>お振込先</h3><p>${esc(s.bank)}</p></div>` : ''}
          ${inv.notes ? `<div><h3>備考</h3><p>${esc(inv.notes)}</p></div>` : ''}
        </div>
      </div>`;
  }

  function renderInvoiceView(id) {
    const inv = findInvoice(id);
    if (!inv) { app.innerHTML = '<div class="empty">書類が見つかりません。<a href="#/invoices">一覧へ</a></div>'; return; }
    const t = calcTotals(inv);
    const s = statusOf(inv);
    const type = typeOf(inv), D = DOC[type];
    const from = inv.sourceId && findInvoice(inv.sourceId);
    const children = state.invoices.filter((x) => x.sourceId === inv.id);
    app.innerHTML = `
      <div class="page-head">
        <div><h1>${typeTag(inv)}No.${esc(inv.number)}　${esc(inv.customerName)}</h1>
          <div class="small">${badge(inv)} <span class="muted">${yen(t.total)}${inv.paidDate ? '・' + fmtDate(inv.paidDate) + ' 入金' : ''}${inv.memo ? '・メモ：' + esc(inv.memo) : ''}</span></div></div>
      </div>
      <div class="btn-row" style="margin-bottom:12px">
        <button class="btn primary" id="send">📤 送る（LINE・メール）</button>
        <button class="btn navy" id="print">🖨 印刷 / PDF</button>
        ${type === 'invoice' && (s === 'issued' || s === 'overdue') ? '<button class="btn primary" id="pay">✓ 入金済にする</button>' : ''}
        ${type === 'invoice' && s === 'paid' ? '<button class="btn" id="unpay">未入金に戻す</button>' : ''}
        ${s === 'draft' ? `<button class="btn" id="issue">${type === 'quote' ? '提出済' : type === 'delivery' ? '納品済' : '発行済'}にする</button>` : ''}
        ${type === 'quote' && s === 'submitted' ? '<button class="btn" id="lost">失注にする</button>' : ''}
        <a class="btn" href="#/invoices/${inv.id}/edit">✎ 編集</a>
      </div>
      <div class="btn-row" style="margin-bottom:16px">
        ${type === 'quote' ? '<button class="btn" data-convert="delivery">→ 納品書を作る</button><button class="btn" data-convert="invoice">→ 請求書を作る</button>' : ''}
        ${type === 'delivery' ? '<button class="btn" data-convert="invoice">→ 請求書を作る</button>' : ''}
        <button class="btn" id="dup">⧉ 複製して新規</button>
        <button class="btn danger" id="del">削除</button>
      </div>
      ${from || children.length ? `<div class="card small">🔗 ${from ? `元の書類：<a href="#/invoices/${from.id}">${DOC[typeOf(from)].label} No.${esc(from.number)}</a>　` : ''}${children.map((c) => `作成済み：<a href="#/invoices/${c.id}">${DOC[typeOf(c)].label} No.${esc(c.number)}</a>`).join('　')}</div>` : ''}
      ${(inv.sent || []).length ? `<div class="card small">📤 送付履歴：${inv.sent.map((x) => `${new Date(x.at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} ${esc(x.via)}${x.to ? '（' + esc(x.to) + '）' : ''}`).join(' ／ ')}</div>` : ''}
      <section class="card send-panel" id="sendPanel" hidden></section>
      ${inv.source === 'makeleaps' && !(inv.items || []).some((it) => it.part || toInt(it.price)) ? `<div class="card small" style="background:var(--warn-soft)">⚠ この請求書はMakeLeapsから内訳が取り込めていません。
        ${SERVER ? '<button class="btn sm" id="inspect">原因を調べる</button><pre id="inspectOut" style="white-space:pre-wrap;font-size:11px;max-height:320px;overflow:auto;margin:8px 0 0"></pre>' : '「Lucent請求書.command」から開くと原因を調べられます。'}</div>` : ''}
      ${type === 'invoice' && !state.settings.bank ? '<div class="card small" style="background:var(--warn-soft)">⚠ 振込先が未設定です。<a href="#/settings">設定</a>で入力すると請求書に印字されます。</div>' : ''}
      <div class="paper-wrap">${paperHtml(inv)}</div>`;

    $('#print').addEventListener('click', () => {
      const old = document.title;
      document.title = docFileName(inv).replace(/\.pdf$/, ''); // PDF保存時のファイル名になる
      fitPrint();
      window.print();
      setTimeout(() => { document.title = old; }, 1000);
    });
    $('#send').addEventListener('click', () => openSendPanel(inv));
    const on = (sel, fn) => { const el = $(sel); if (el) el.addEventListener('click', fn); };
    on('#pay', () => { if (markPaid(inv)) route(); });
    on('#inspect', async () => {
      $('#inspectOut').textContent = '調査中…';
      try {
        const r = await api('/api/inspect?doc=' + encodeURIComponent(inv.externalId));
        $('#inspectOut').textContent = 'No.' + inv.number + '\n' + JSON.stringify(r, null, 1);
      } catch (err) { $('#inspectOut').textContent = 'エラー：' + err.message; }
    });
    on('#unpay', () => { Object.assign(inv, { status: 'issued', paidDate: '', paidAmount: '' }); touch(inv); save(); route(); });
    on('#issue', () => { inv.status = 'issued'; touch(inv); save(); route(); });
    on('#lost', () => { inv.status = 'lost'; touch(inv); save(); route(); });
    $$('[data-convert]').forEach((b) => b.addEventListener('click', () => {
      const to = b.dataset.convert;
      const d = draftFrom(inv, to);
      renderEditor.draft = d;
      location.hash = '#/invoices/new?type=' + to;
    }));
    on('#dup', () => {
      const d = draftFrom(inv, type);
      delete d.sourceId;
      d.items = d.items.map((it) => Object.assign(it, { date: it.date ? d.issueDate : '' }));
      d.notes = inv.notes;
      renderEditor.draft = d;
      location.hash = '#/invoices/new?type=' + type;
    });
    on('#del', () => {
      if (!confirm(`${D.label} No.${inv.number} を削除します。元に戻せません。よろしいですか？`)) return;
      state.invoices = state.invoices.filter((x) => x.id !== inv.id);
      markDeleted(inv.id);
      save(); toast('削除しました'); location.hash = '#/invoices?type=' + type;
    });
  }

  // ---------- 印刷を必ずA4・1枚に収める ----------
  // 印刷範囲（A4から余白8mmを除いた 約733×1062px）に入るよう、紙面の縮小率を決める
  function fitPrint() {
    const paper = $('.paper-wrap .paper');
    if (!paper) return;
    paper.classList.add('measure');
    const h = paper.scrollHeight;
    paper.classList.remove('measure');
    const zoom = Math.min(733 / 794, 1050 / h);
    paper.style.setProperty('--print-zoom', zoom.toFixed(3));
  }
  window.addEventListener('beforeprint', fitPrint); // ⌘P で印刷したときも同じように収める

  // ================= 送付（LINE・メール・PDF） =================
  const docFileName = (inv) => `${DOC[typeOf(inv)].label}_${inv.number}_${(inv.customerName || '').replace(/[\\/:*?"<>|\s]+/g, '')}.pdf`;
  function loadScript(src) {
    return new Promise((ok, ng) => {
      if (document.querySelector(`script[src="${src}"]`)) return ok();
      const el = document.createElement('script');
      el.src = src; el.onload = ok; el.onerror = () => ng(new Error(src + ' を読み込めませんでした'));
      document.head.appendChild(el);
    });
  }
  // 紙面をA4のPDFにする（画面の見た目そのまま）
  async function makePdf(inv) {
    await loadScript('vendor/html2pdf.bundle.min.js');
    const holder = document.createElement('div');
    // 画面の左上に（見えないよう背面に）置いて撮影する。画面外に置くと位置がずれるため
    holder.style.cssText = 'position:fixed;left:0;top:0;width:794px;background:#fff;z-index:-1;pointer-events:none';
    // A4（794×1123px）の枠の中に紙面を入れ、はみ出す長さなら縮小して1枚に収める
    holder.innerHTML = `<div style="width:794px;height:1123px;overflow:hidden;background:#fff">${paperHtml(inv)}</div>`;
    document.body.appendChild(holder);
    const page = holder.firstElementChild, paper = page.firstElementChild;
    paper.style.boxShadow = 'none';
    const h = paper.scrollHeight;
    if (h > 1123) { paper.style.transformOrigin = 'top center'; paper.style.transform = `scale(${(1123 / h).toFixed(4)})`; }
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      return await window.html2pdf().set({
        margin: 0, filename: docFileName(inv),
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', windowWidth: 794, scrollX: 0, scrollY: 0, x: 0, y: 0 },
        jsPDF: { unit: 'px', format: [794, 1123], orientation: 'portrait', hotfixes: ['px_scaling'] }
      }).from(page).outputPdf('blob');
    } finally { holder.remove(); }
  }
  function blobToBase64(blob) {
    return new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.readAsDataURL(blob); });
  }
  function downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function messageFor(inv) {
    const s = state.settings, t = calcTotals(inv), type = typeOf(inv), D = DOC[type];
    const lines = [
      `${inv.customerName} ${inv.honorific}`, '',
      `いつもお世話になっております。${s.companyName}です。`,
      `${D.label}（No.${inv.number}）をお送りいたします。`, '',
      `${type === 'quote' ? '御見積金額' : type === 'invoice' ? 'ご請求金額' : '合計金額'}：${yen(t.total)}（税込）`
    ];
    if (type === 'invoice' && inv.dueDate) lines.push(`お支払期限：${fmtDate(inv.dueDate)}`);
    if (type === 'quote' && inv.dueDate) lines.push(`有効期限：${fmtDate(inv.dueDate)}`);
    if (type === 'invoice' && s.bank) lines.push('', '【お振込先】', s.bank);
    lines.push('', 'ご確認のほど、よろしくお願いいたします。', '', s.companyName);
    if (s.tel) lines.push('TEL ' + s.tel);
    return lines.join('\n');
  }
  function recordSent(inv, via, to) {
    inv.sent = (inv.sent || []).concat([{ at: nowIso(), via, to: to || '' }]);
    if (inv.status === 'draft') inv.status = 'issued'; // 送ったら発行済扱い
    touch(inv); save();
  }

  async function openSendPanel(inv) {
    const panel = $('#sendPanel');
    const D = DOC[typeOf(inv)];
    const cust = findCustomer(inv.customerId) || {};
    let mailUser = '';
    if (SERVER) { try { mailUser = (await api('/api/status')).mail || ''; } catch (e) { /* 未設定扱い */ } }
    const canShareFiles = !!(navigator.canShare && navigator.canShare({ files: [new File([''], 'a.pdf', { type: 'application/pdf' })] }));
    panel.hidden = false;
    panel.innerHTML = `
      <h2>📤 ${D.label}を送る</h2>
      <label class="field"><span>メッセージ（LINE・メール本文。自由に直せます）</span><textarea id="sendMsg" rows="10">${esc(messageFor(inv))}</textarea></label>
      <div class="send-grid">
        <div class="send-box">
          <h3>LINEで送る</h3>
          ${canShareFiles
            ? '<p class="small muted">「共有」を押して、出てきた一覧から<b>LINE</b>を選び、送り先のトークを選びます（PDFとメッセージが送られます）。</p><button class="btn primary" id="shareBtn">📱 共有（LINEなど）</button>'
            : '<p class="small muted">① PDFを保存 → ② メッセージをコピー → ③ LINEを開いてトークにPDFをドラッグ＆メッセージを貼り付け。<br>※スマホで開くと「共有」ボタンから直接LINEに送れます。</p><button class="btn primary" id="lineBtn">LINE用に準備する</button>'}
        </div>
        <div class="send-box">
          <h3>メールで送る</h3>
          <label class="field"><span>宛先</span><input id="sendTo" type="email" value="${esc(inv.customerEmail || cust.email || '')}" placeholder="example@example.com"></label>
          <label class="field"><span>件名</span><input id="sendSubject" value="${esc(`【${state.settings.companyName}】${D.label}送付のご案内（No.${inv.number}）`)}"></label>
          ${mailUser
            ? `<label class="small" style="display:block;margin-bottom:8px"><input type="checkbox" id="bccSelf" checked style="width:auto"> 自分（${esc(mailUser)}）にも控えを送る</label><button class="btn primary" id="mailBtn">✉️ PDFを添付して送信</button>`
            : `<p class="small muted">PDFを保存してメールソフトを開きます。PDFは手で添付してください。${SERVER ? '<br>Macの<a href="#/settings">設定</a>でGmailを登録すると、ここからPDF付きで直接送信できます。' : ''}</p><button class="btn primary" id="mailtoBtn">✉️ メールを作成</button>`}
        </div>
      </div>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn" id="pdfBtn">⬇ PDFだけ保存</button>
        <button class="btn" id="copyBtn">📋 メッセージをコピー</button>
        <button class="btn" id="closeSend">閉じる</button>
      </div>
      <p class="small muted" id="sendStatus"></p>`;
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const status = (m) => { $('#sendStatus').textContent = m; };
    const msg = () => $('#sendMsg').value;
    let pdfCache = null;
    const getPdf = async () => { status('PDFを作成しています…'); pdfCache = pdfCache || await makePdf(inv); status(''); return pdfCache; };
    const copy = async () => { try { await navigator.clipboard.writeText(msg()); return true; } catch (e) { return false; } };
    const guard = (fn) => async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try { await fn(); } catch (err) { if (err.name !== 'AbortError') { status('⚠ ' + err.message); alert(err.message); } } finally { b.disabled = false; }
    };
    const on = (sel, fn) => { const el = $(sel, panel); if (el) el.addEventListener('click', guard(fn)); };

    on('#shareBtn', async () => {
      const pdf = await getPdf();
      const file = new File([pdf], docFileName(inv), { type: 'application/pdf' });
      await copy(); // LINEによっては本文が渡らないので、念のためコピーしておく
      await navigator.share({ files: [file], text: msg(), title: `${D.label} No.${inv.number}` });
      recordSent(inv, '共有（LINE等）'); toast('送付履歴に記録しました'); route();
    });
    on('#lineBtn', async () => {
      downloadBlob(await getPdf(), docFileName(inv));
      const copied = await copy();
      status(`PDFを保存しました${copied ? '・メッセージをコピーしました' : ''}。LINEでトークを開き、PDFをドラッグしてメッセージを貼り付けてください。`);
      try { window.location.href = 'line://'; } catch (e) { /* LINEアプリが無い場合は何もしない */ }
      if (confirm('LINEで送り終わったら「OK」を押してください（送付履歴に記録します）')) { recordSent(inv, 'LINE'); route(); }
    });
    on('#mailBtn', async () => {
      const to = $('#sendTo').value.trim();
      if (!to) throw new Error('宛先のメールアドレスを入力してください');
      const pdf = await getPdf();
      status('送信しています…');
      await api('/api/send-mail', { to, subject: $('#sendSubject').value, text: msg(), pdf: await blobToBase64(pdf), filename: docFileName(inv), bcc_self: $('#bccSelf') && $('#bccSelf').checked });
      // 宛先を取引先に覚えておく
      const c = findCustomer(inv.customerId);
      if (c && c.email !== to) { c.email = to; touch(c); }
      if (inv.customerEmail !== to) inv.customerEmail = to;
      recordSent(inv, 'メール', to); toast(`${to} に送信しました`); route();
    });
    on('#mailtoBtn', async () => {
      const to = $('#sendTo').value.trim();
      downloadBlob(await getPdf(), docFileName(inv));
      location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent($('#sendSubject').value)}&body=${encodeURIComponent(msg())}`;
      status('PDFを保存しました。開いたメールにPDFを添付して送信してください。');
      setTimeout(() => { if (confirm('メールを送り終わったら「OK」を押してください（送付履歴に記録します）')) { recordSent(inv, 'メール', to); route(); } }, 1500);
    });
    on('#pdfBtn', async () => { downloadBlob(await getPdf(), docFileName(inv)); status('PDFを保存しました'); });
    on('#copyBtn', async () => { status((await copy()) ? 'メッセージをコピーしました' : 'コピーできませんでした。手で選択してコピーしてください'); });
    on('#closeSend', async () => { panel.hidden = true; });
  }

  // ================= 取引先 =================
  function renderCustomerList() {
    const stats = {};
    state.invoices.filter(isInvoice).forEach((i) => {
      const k = i.customerId; if (!k) return;
      const st = stats[k] || (stats[k] = { count: 0, total: 0, unpaid: 0, last: '' });
      const t = calcTotals(i).total;
      if (i.status !== 'draft') { st.count++; st.total += t; if (i.status !== 'paid') st.unpaid += t; }
      if ((i.issueDate || '') > st.last) st.last = i.issueDate;
    });
    const list = state.customers.slice().sort((a, b) => (stats[b.id] ? stats[b.id].last : '').localeCompare(stats[a.id] ? stats[a.id].last : '') || a.name.localeCompare(b.name, 'ja'));
    app.innerHTML = `
      <div class="page-head">
        <div><h1>取引先</h1><div class="muted small">${state.customers.length}社　※請求書を保存すると自動で登録されます</div></div>
        <a class="btn primary" href="#/customers/new">＋ 取引先を追加</a>
      </div>
      <div class="card">
        <input id="q" type="search" placeholder="取引先名で検索" style="margin-bottom:8px">
        <ul class="list" id="list"></ul>
      </div>`;
    const draw = () => {
      const q = $('#q').value.trim();
      const rows = list.filter((c) => !q || c.name.includes(q));
      $('#list').innerHTML = rows.length ? rows.map((c) => {
        const st = stats[c.id] || { count: 0, total: 0, unpaid: 0, last: '' };
        return `<li><a class="row" href="#/customers/${c.id}">
          <span class="title">${esc(c.name)}</span><span class="amount">${yen(st.total)}</span>
          <span class="meta">${st.count}件${st.last ? '・最終 ' + fmtDate(st.last) : ''}${c.tel ? '・' + esc(c.tel) : ''}</span>
          <span>${st.unpaid ? `<span class="badge issued">未入金 ${yen(st.unpaid)}</span>` : ''}</span>
        </a></li>`;
      }).join('') : '<li class="empty">取引先はまだありません</li>';
    };
    $('#q').addEventListener('input', draw);
    draw();
  }

  function renderCustomerForm(id) {
    const c = id ? findCustomer(id) : { id: null, name: '', honorific: '御中', postal: '', address: '', tel: '', fax: '', email: '', memo: '' };
    if (!c) { app.innerHTML = '<div class="empty">取引先が見つかりません</div>'; return; }
    const invs = id ? sortedInvoices().filter((i) => i.customerId === id) : [];
    app.innerHTML = `
      <div class="page-head"><h1>${id ? esc(c.name) : '取引先の追加'}</h1>
        ${id ? `<div class="btn-row"><button class="btn" data-newdoc="quote">＋ 見積書</button><button class="btn" data-newdoc="delivery">＋ 納品書</button><button class="btn primary" data-newdoc="invoice">＋ 請求書</button></div>` : ''}</div>
      <form class="card" id="f" autocomplete="off">
        <div class="grid-2">
          <label class="field"><span>取引先名</span><input name="name" value="${esc(c.name)}" required></label>
          <label class="field"><span>敬称</span><select name="honorific">${['御中', '様', '殿'].map((h) => `<option ${c.honorific === h ? 'selected' : ''}>${h}</option>`).join('')}</select></label>
        </div>
        <div class="grid-3">
          <label class="field"><span>郵便番号</span><input name="postal" value="${esc(c.postal)}"></label>
          <label class="field"><span>TEL</span><input name="tel" value="${esc(c.tel)}" inputmode="tel"></label>
          <label class="field"><span>FAX</span><input name="fax" value="${esc(c.fax)}" inputmode="tel"></label>
        </div>
        <label class="field"><span>住所</span><textarea name="address" rows="2">${esc(c.address)}</textarea></label>
        <label class="field"><span>メールアドレス（請求書のメール送付用）</span><input name="email" type="email" value="${esc(c.email || '')}"></label>
        <label class="field"><span>メモ（担当者・締め日など）</span><input name="memo" value="${esc(c.memo)}"></label>
        <div class="btn-row" style="justify-content:space-between">
          ${id ? '<button type="button" class="btn danger" id="del">削除</button>' : '<span></span>'}
          <div class="btn-row"><a class="btn" href="#/customers">戻る</a><button class="btn primary">保存</button></div>
        </div>
      </form>
      ${id ? `<div class="card"><h2>書類の履歴</h2>${invs.length ? `<ul class="list">${invs.map((r) => invoiceRow(r)).join('')}</ul>` : '<div class="empty">まだ書類はありません</div>'}</div>` : ''}`;

    const f = $('#f');
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(f).entries());
      const name = fd.name.trim();
      if (state.customers.some((x) => x.name === name && x.id !== c.id)) { toast('同じ名前の取引先があります'); return; }
      const oldName = c.name;
      Object.assign(c, fd, { name });
      touch(c);
      if (!c.id) { c.id = uid(); state.customers.push(c); }
      // 社名変更は下書きの書類にだけ反映（発行済の控えは当時のまま残す）
      if (oldName && oldName !== name) state.invoices.forEach((i) => { if (i.customerId === c.id && i.status === 'draft') { i.customerName = name; touch(i); } });
      save(); toast('保存しました'); location.hash = '#/customers';
    });
    if (id) {
      $('#del').addEventListener('click', () => {
        if (!confirm(`${c.name} を削除しますか？（発行済の請求書は残ります）`)) return;
        state.customers = state.customers.filter((x) => x.id !== c.id);
        markDeleted(c.id);
        save(); location.hash = '#/customers';
      });
      $$('[data-newdoc]').forEach((b) => b.addEventListener('click', () => {
        const d = newInvoice(b.dataset.newdoc);
        Object.assign(d, { customerId: c.id, customerName: c.name, honorific: c.honorific, customerPostal: c.postal, customerAddress: c.address, customerTel: c.tel, customerFax: c.fax, customerEmail: c.email || '' });
        renderEditor.draft = d;
        location.hash = '#/invoices/new?type=' + b.dataset.newdoc;
      }));
    }
  }

  // ================= 設定 =================
  function renderSettings() {
    const s = state.settings;
    app.innerHTML = `
      <div class="page-head"><h1>設定</h1></div>
      <form id="f" autocomplete="off">
        <div class="card">
          <h2>自社情報（請求書の発行元）</h2>
          <div class="grid-2">
            <label class="field"><span>会社名・屋号</span><input name="companyName" value="${esc(s.companyName)}"></label>
            <label class="field"><span>登録番号（インボイス制度：T＋13桁）</span><input name="registrationNo" value="${esc(s.registrationNo)}" placeholder="T1234567890123"></label>
          </div>
          <div class="grid-3">
            <label class="field"><span>郵便番号</span><input name="postal" value="${esc(s.postal)}"></label>
            <label class="field"><span>TEL</span><input name="tel" value="${esc(s.tel)}"></label>
            <label class="field"><span>FAX</span><input name="fax" value="${esc(s.fax)}"></label>
          </div>
          <label class="field"><span>住所</span><textarea name="address" rows="2">${esc(s.address)}</textarea></label>
          <label class="field"><span>メール（任意）</span><input name="email" value="${esc(s.email)}"></label>
          <label class="field"><span>お振込先（改行可）</span><textarea name="bank" rows="4" placeholder="〇〇銀行\n〇〇支店\n普通 1234567\nカナメイギ">${esc(s.bank)}</textarea></label>
          <label class="field"><span>備考の初期文（請求書）</span><textarea name="notes" rows="4">${esc(s.notes)}</textarea></label>
          <label class="field"><span>備考の初期文（見積書）</span><textarea name="quoteNotes" rows="3">${esc(s.quoteNotes)}</textarea></label>
          <label class="field"><span>備考の初期文（納品書）</span><textarea name="deliveryNotes" rows="2">${esc(s.deliveryNotes)}</textarea></label>
        </div>
        <div class="card">
          <h2>計算・採番</h2>
          <div class="grid-2">
            <label class="field"><span>消費税率（%）</span><input name="taxRate" inputmode="numeric" value="${esc(s.taxRate)}"></label>
            <label class="field"><span>消費税の端数</span><select name="rounding">
              ${[['floor', '切り捨て'], ['round', '四捨五入'], ['ceil', '切り上げ']].map(([v, l]) => `<option value="${v}" ${s.rounding === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select></label>
            <label class="field"><span>支払期限の初期値</span><select name="dueRule">
              ${[['nextMonthEnd', '翌月末'], ['monthEnd', '当月末'], ['none', '記載しない']].map(([v, l]) => `<option value="${v}" ${s.dueRule === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select></label>
            <label class="field"><span>次の請求書番号</span><input name="nextNumber" inputmode="numeric" value="${esc(s.nextNumber)}"></label>
            <label class="field"><span>次の見積書番号（Q＋4桁）</span><input name="nextQuoteNumber" inputmode="numeric" value="${esc(s.nextQuoteNumber)}"></label>
            <label class="field"><span>次の納品書番号（D＋4桁）</span><input name="nextDeliveryNumber" inputmode="numeric" value="${esc(s.nextDeliveryNumber)}"></label>
          </div>
          <p class="muted small" style="margin:0">※税率・端数の変更は、税率を個別に持たない既存の請求書の表示にも反映されます。</p>
        </div>
        <div class="sticky-actions"><button class="btn primary">設定を保存</button></div>
      </form>

      <div class="card">
        <h2>バックアップ</h2>
        <p class="small muted" style="margin-top:0">${SERVER ? 'データはMacの中（~/.lucent-invoice/data.json）に保存され、毎日自動で控え（30日分）も残しています。念のため手元にも控えを取りたいときに使ってください。' : 'データはこの端末のブラウザ内に保存されています。念のための控えとして定期的に書き出してください。'}</p>
        <div class="btn-row">
          <button class="btn navy" id="exp">⬇ バックアップを書き出す</button>
          <label class="btn">⬆ バックアップを読み込む<input type="file" id="imp" accept="application/json,.json" hidden></label>
        </div>
      </div>

      <div id="localOnly"></div>
      <div class="card">
        <h2>MakeLeaps連携</h2>
        ${SERVER ? `
          <p class="small muted" style="margin-top:0">MakeLeapsの「APIキー」画面のクライアントIDとシークレットを一度だけ入力してください。以後はホームの「🔄 MakeLeapsと同期」を押すだけで、請求書・明細・入金状態が反映されます（起動時にも自動で同期します）。</p>
          <p class="small" id="mlstatus">接続状態を確認中…</p>
          <div class="grid-2">
            <label class="field"><span>クライアントID</span><input id="mlid" autocomplete="off"></label>
            <label class="field"><span>クライアントシークレット</span><input id="mlsecret" type="password" autocomplete="new-password"></label>
          </div>
          <div class="btn-row" style="margin-bottom:12px">
            <button class="btn" id="mlsave">接続設定を保存</button>
            <button class="btn navy" data-sync>🔄 今年分を同期</button>
            <button class="btn" id="mlall">全期間を同期</button>
          </div>
          <p class="small muted">※ID・シークレットはこのMacの中（~/.lucent-invoice）にだけ保存され、GitHubには上がりません。</p>
          <details class="small"><summary class="muted">ファイルから取り込む（予備の方法）</summary>` : `
          <p class="small" style="margin-top:0;background:var(--warn-soft);padding:8px;border-radius:8px">⚠ 今はファイルを直接開いているため、同期ボタンが使えません。<b>lucent-invoice フォルダの「Lucent請求書.command」をダブルクリック</b>して開いてください。</p>
          <details class="small"><summary class="muted">ファイルから取り込む（予備の方法）</summary>`}
        <p class="small muted">MacでMakeLeaps書き出しスクリプト（<code>tools/makeleaps_export.py</code>）を実行してできた <code>makeleaps-export.json</code> を選んでください。今のデータは消えず<b>追加</b>されます。同じ請求書を2回取り込んでも重複せず、MakeLeaps側の最新内容に更新されます。</p>
        ${s.lastMakeLeapsImport ? `<p class="small" style="margin-top:0">最終取り込み：${new Date(s.lastMakeLeapsImport).toLocaleString('ja-JP')}</p>` : ''}
        <label class="btn">⬆ MakeLeapsデータを取り込む<input type="file" id="mlimp" accept="application/json,.json" hidden></label>
        </details>
      </div>`;

    if (SERVER) {
      api('/api/status').then((st) => {
        $('#mlstatus').innerHTML = st.configured ? '✅ MakeLeapsに接続設定済みです' : '⚠ まだ接続設定されていません';
        if (st.local) renderLocalSettings(st);
        else $('#mlstatus').innerHTML += '<br>※接続設定・スマホ共有・メール設定はMacの画面から変更できます。';
      }).catch(() => { $('#mlstatus').textContent = '⚠ 起動用サーバーに接続できません。「Lucent請求書.command」から開き直してください。'; });
      $('#mlsave').addEventListener('click', async () => {
        const client_id = $('#mlid').value.trim(), client_secret = $('#mlsecret').value.trim();
        if (!client_id || !client_secret) { toast('クライアントIDとシークレットを入力してください'); return; }
        $('#mlsave').disabled = true; $('#mlsave').textContent = '確認中…';
        try {
          await api('/api/credentials', { client_id, client_secret });
          toast('接続できました。同期を始めます');
          syncMakeLeaps();
        } catch (err) {
          alert('保存できませんでした：' + err.message);
          $('#mlsave').disabled = false; $('#mlsave').textContent = '接続設定を保存';
        }
      });
      $('#mlall').addEventListener('click', () => syncMakeLeaps({ all: true }));
    }

    $('#f').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target).entries());
      Object.keys(fd).forEach((k) => { if (typeof fd[k] === 'string' && k !== 'notes' && k !== 'quoteNotes' && k !== 'deliveryNotes' && k !== 'address' && k !== 'bank') fd[k] = fd[k].trim(); });
      Object.assign(s, fd, {
        taxRate: toInt(fd.taxRate), nextNumber: toInt(fd.nextNumber) || s.nextNumber,
        nextQuoteNumber: toInt(fd.nextQuoteNumber) || s.nextQuoteNumber, nextDeliveryNumber: toInt(fd.nextDeliveryNumber) || s.nextDeliveryNumber
      });
      touchSettings();
      if (save()) toast('設定を保存しました');
    });
    $('#exp').addEventListener('click', () => {
      download(JSON.stringify(Object.assign({ exportedAt: new Date().toISOString(), app: 'lucent-invoice' }, state), null, 2), `請求書バックアップ_${today()}.json`, 'application/json');
    });
    $('#imp').addEventListener('change', (e) => {
      const file = e.target.files[0]; if (!file) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          const d = JSON.parse(r.result);
          if (!Array.isArray(d.invoices) || !Array.isArray(d.customers)) throw new Error('形式が違います');
          if (!confirm(`請求書${d.invoices.length}件・取引先${d.customers.length}社を読み込みます。\n今のデータは上書きされます。よろしいですか？`)) return;
          // 読み込んだ内容を最新として扱う（Macの共有データにも反映）
          const stamp = nowIso();
          d.invoices.forEach((x) => { x.updatedAt = stamp; });
          d.customers.forEach((x) => { x.updatedAt = stamp; });
          state.invoices.forEach((x) => { if (!d.invoices.some((y) => y.id === x.id)) markDeleted(x.id); });
          state.customers.forEach((x) => { if (!d.customers.some((y) => y.id === x.id)) markDeleted(x.id); });
          state = Object.assign(normalizeState(d), { deleted: state.deleted });
          touchSettings();
          save(); toast('読み込みました'); route();
        } catch (err) { alert('読み込めませんでした：' + err.message); }
      };
      r.readAsText(file);
    });
    $('#mlimp').addEventListener('change', (e) => {
      const file = e.target.files[0]; if (!file) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          const d = JSON.parse(r.result);
          if (d.kind !== 'makeleaps-import' || !Array.isArray(d.invoices)) throw new Error('MakeLeaps書き出しファイルではありません');
          const res = importMakeLeaps(d);
          state.settings.lastMakeLeapsImport = new Date().toISOString();
          save();
          alert(`取り込み完了\n新規 ${res.added}件／更新 ${res.updated}件（手で編集済みのため保護 ${res.kept}件）\n取引先 新規 ${res.newCustomers}社`);
          location.hash = '#/';
        } catch (err) { alert('取り込めませんでした：' + err.message); }
        e.target.value = '';
      };
      r.readAsText(file);
    });
  }

  async function renderLocalSettings(st) {
    const box = $('#localOnly'); if (!box) return;
    let net = { ips: [], port: 8787, pinSet: false, devices: 0 };
    try { net = await api('/api/network'); } catch (e) { /* 表示だけ省略 */ }
    const url = net.ips.length ? `http://${net.ips[0]}:${net.port}/` : '';
    box.innerHTML = `
      <div class="card">
        <h2>📱 スマホで使う（データ共有）</h2>
        <p class="small muted" style="margin-top:0">スマホを<b>Macと同じWi-Fi</b>につないで、下のQRコードを読み取るかアドレスを開き、暗証番号を入れるとMacと同じデータを見たり、請求書を作ったり送ったりできます。</p>
        <div class="grid-2">
          <div>
            <label class="field"><span>暗証番号（4〜8桁の数字）${net.pinSet ? '：✅ 設定済み' : '：未設定（スマホからは使えません）'}</span><input id="pin" inputmode="numeric" type="password" autocomplete="new-password" placeholder="${net.pinSet ? '変更するときだけ入力' : '例：1234'}"></label>
            <div class="btn-row"><button class="btn primary" id="pinSave">${net.pinSet ? '暗証番号を変更' : 'スマホ共有をオンにする'}</button>${net.pinSet ? '<button class="btn danger" id="pinOff">スマホ共有をオフ</button>' : ''}</div>
            <p class="small muted">ログイン中のスマホ：${net.devices}台（暗証番号を変えると全てログアウトされます）</p>
          </div>
          <div>
            ${net.pinSet && url ? `<div id="qr" class="qr"></div><p class="small" style="word-break:break-all">${net.ips.map((ip) => `http://${ip}:${net.port}/`).join('<br>')}</p>
              <p class="small muted">開いたら「ホーム画面に追加」（iPhoneは共有ボタン→ホーム画面に追加）でアプリのように使えます。</p>` : '<p class="small muted">暗証番号を設定するとQRコードが表示されます。</p>'}
          </div>
        </div>
        <p class="small muted">※Macがスリープ中・電源オフのときはスマホから使えません。外出先からも使いたい場合は相談してください。初回に「受信接続を許可しますか？」と出たら「許可」を押してください。</p>
      </div>
      <div class="card">
        <h2>✉️ メール送信（Gmail）</h2>
        <p class="small muted" style="margin-top:0">登録すると、書類画面の「送る」からPDF付きメールを直接送信できます（Mac・スマホどちらからでも）。Gmailの<b>アプリパスワード</b>（Googleアカウント → セキュリティ → 2段階認証 → アプリパスワード で作る16文字）を使います。普段のパスワードではありません。</p>
        <p class="small">${st.mail ? `✅ ${esc(st.mail)} から送信します` : '⚠ まだ設定されていません'}</p>
        <div class="grid-3">
          <label class="field"><span>Gmailアドレス</span><input id="mailUser" type="email" value="${esc(st.mail || '')}" placeholder="example@gmail.com"></label>
          <label class="field"><span>アプリパスワード（16文字）</span><input id="mailPass" type="password" autocomplete="new-password" placeholder="${st.mail ? '変更するときだけ入力' : 'xxxx xxxx xxxx xxxx'}"></label>
          <label class="field"><span>差出人名</span><input id="mailName" value="${esc(state.settings.companyName)}"></label>
        </div>
        <div class="btn-row"><button class="btn primary" id="mailSave">確認して保存</button>${st.mail ? '<button class="btn danger" id="mailOff">メール送信をオフ</button>' : ''}</div>
      </div>`;
    if (net.pinSet && url) {
      try {
        await loadScript('vendor/qrcode.js');
        const qr = window.qrcode(0, 'M'); qr.addData(url); qr.make();
        $('#qr').innerHTML = qr.createSvgTag({ cellSize: 5, margin: 2 });
      } catch (e) { /* QRが出なくてもアドレスで開ける */ }
    }
    const busy = async (btn, fn) => { btn.disabled = true; try { await fn(); } catch (err) { alert(err.message); } finally { btn.disabled = false; } };
    $('#pinSave').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      const pin = $('#pin').value.trim();
      if (!/^\d{4,8}$/.test(pin)) throw new Error('暗証番号は4〜8桁の数字で入力してください');
      await api('/api/pin', { pin }); toast('スマホ共有をオンにしました'); renderLocalSettings(st);
    }));
    if ($('#pinOff')) $('#pinOff').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      if (!confirm('スマホ共有をオフにします。ログイン中のスマホからは使えなくなります。')) return;
      await api('/api/pin', { pin: '' }); toast('スマホ共有をオフにしました'); renderLocalSettings(st);
    }));
    $('#mailSave').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      const user = $('#mailUser').value.trim(), password = $('#mailPass').value.trim();
      if (!user || !password) throw new Error('Gmailアドレスとアプリパスワードを入力してください');
      e.currentTarget.textContent = '確認中…';
      await api('/api/mail-settings', { user, password, from_name: $('#mailName').value.trim() });
      toast('メール送信を設定しました'); st.mail = user; renderLocalSettings(st);
    }));
    if ($('#mailOff')) $('#mailOff').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      await api('/api/mail-settings', { user: '' }); st.mail = ''; toast('メール送信をオフにしました'); renderLocalSettings(st);
    }));
  }

  // ---------- スマホのログイン画面 ----------
  function renderLogin(pinSet) {
    $$('#nav a').forEach((el) => el.classList.remove('active'));
    app.innerHTML = `
      <div class="card login">
        <h1>🔒 Lucent 請求書管理</h1>
        ${pinSet ? `<p class="small muted">Macで設定した暗証番号を入力してください。</p>
          <form id="lf"><input id="lpin" inputmode="numeric" type="password" autocomplete="current-password" placeholder="暗証番号" autofocus>
          <button class="btn primary" style="width:100%;margin-top:10px">ログイン</button></form>`
          : '<p class="small">スマホ共有がオフになっています。Macの「設定 → スマホで使う」で暗証番号を設定してください。</p>'}
        <p class="small" id="lmsg" style="color:var(--danger)"></p>
      </div>`;
    const lf = $('#lf');
    if (lf) lf.addEventListener('submit', async (e) => {
      e.preventDefault();
      const res = await fetch('/api/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Lucent': '1' }, body: JSON.stringify({ pin: $('#lpin').value }) });
      const d = await res.json().catch(() => ({}));
      if (res.ok) { authRequired = false; startServerSync(); } else $('#lmsg').textContent = d.error || 'ログインできませんでした';
    });
  }

  // MakeLeapsデータを既存データに追加（externalIdで重複判定）
  function importMakeLeaps(d) {
    const res = { added: 0, updated: 0, kept: 0, newCustomers: 0 };
    (d.customers || []).forEach((mc) => {
      if (!mc.name) return;
      let c = state.customers.find((x) => x.name === mc.name);
      if (!c) {
        c = { id: uid(), name: mc.name, honorific: mc.honorific || '御中', postal: mc.postal || '', address: mc.address || '', tel: mc.tel || '', fax: mc.fax || '', memo: '' };
        touch(c); state.customers.push(c); res.newCustomers++;
      } else {
        // 空欄だけ補う（手入力した情報は上書きしない）
        let filled = false;
        ['postal', 'address', 'tel', 'fax'].forEach((k) => { if (!c[k] && mc[k]) { c[k] = mc[k]; filled = true; } });
        if (filled) touch(c);
      }
    });
    const now = new Date().toISOString();
    d.invoices.forEach((mi) => {
      const c = state.customers.find((x) => x.name === mi.customerName);
      const data = Object.assign({}, mi, { docType: 'invoice', customerId: c ? c.id : '', importedAt: now });
      const ex = mi.externalId && state.invoices.find((x) => x.externalId === mi.externalId);
      if (ex) {
        // このアプリで編集した請求書は上書きしない（入金状態だけはMakeLeaps側が入金済なら反映）
        if (ex.updatedAt && ex.importedAt && ex.updatedAt > ex.importedAt) {
          let changed = false;
          if (mi.status === 'paid' && ex.status !== 'paid') { Object.assign(ex, { status: 'paid', paidDate: mi.paidDate, paidAmount: mi.paidAmount }); changed = true; }
          if (!(ex.items || []).some((it) => it.part || toInt(it.price)) && (mi.items || []).length) { Object.assign(ex, { items: mi.items, importedTotals: mi.importedTotals }); changed = true; }
          if (changed) touch(ex); // importedAt はそのまま（手で編集した扱いを保つ）
          res.kept++;
        } else {
          const keepPaid = ex.status === 'paid' && data.status !== 'paid' ? { status: 'paid', paidDate: ex.paidDate, paidAmount: ex.paidAmount } : {};
          const keepLocal = { sent: ex.sent, customerEmail: ex.customerEmail, sourceId: ex.sourceId };
          if (JSON.stringify(Object.assign({}, ex, data, keepPaid, keepLocal, { id: ex.id, updatedAt: ex.updatedAt, importedAt: ex.importedAt })) !== JSON.stringify(ex)) {
            Object.assign(ex, data, keepPaid, keepLocal, { id: ex.id, updatedAt: now }); res.updated++;
          }
        }
      } else {
        state.invoices.push(Object.assign(data, { id: uid(), createdAt: now, updatedAt: now })); res.added++;
      }
      bumpNumber('invoice', mi.number);
    });
    fixAllAddresses();
    return res;
  }

  // ---------- 住所の都道府県（ローマ字 → 漢字） ----------
  // MakeLeapsから取り込んだ住所が「saitamaさいたま市…」のようになるのを「埼玉県さいたま市…」に直す
  const PREFECTURES = { hokkaido: '北海道', aomori: '青森県', iwate: '岩手県', miyagi: '宮城県', akita: '秋田県', yamagata: '山形県', fukushima: '福島県', ibaraki: '茨城県', tochigi: '栃木県', gunma: '群馬県', saitama: '埼玉県', chiba: '千葉県', tokyo: '東京都', kanagawa: '神奈川県', niigata: '新潟県', toyama: '富山県', ishikawa: '石川県', fukui: '福井県', yamanashi: '山梨県', nagano: '長野県', gifu: '岐阜県', shizuoka: '静岡県', aichi: '愛知県', mie: '三重県', shiga: '滋賀県', kyoto: '京都府', osaka: '大阪府', hyogo: '兵庫県', nara: '奈良県', wakayama: '和歌山県', tottori: '鳥取県', shimane: '島根県', okayama: '岡山県', hiroshima: '広島県', yamaguchi: '山口県', tokushima: '徳島県', kagawa: '香川県', ehime: '愛媛県', kochi: '高知県', fukuoka: '福岡県', saga: '佐賀県', nagasaki: '長崎県', kumamoto: '熊本県', oita: '大分県', miyazaki: '宮崎県', kagoshima: '鹿児島県', okinawa: '沖縄県' };
  function fixPrefecture(addr) {
    if (!addr) return addr;
    return String(addr).replace(/^\s*([A-Za-zōū]+)(?:[\s-]*(?:ken|to|fu|do)\b)?[\s,、]*/, (m, w) => {
      const key = w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/^hokkai$/, 'hokkaido');
      return PREFECTURES[key] || m;
    });
  }
  // 保存済みの取引先・書類の住所をまとめて直す（直した件数を返す）
  function fixAllAddresses() {
    let n = 0;
    state.customers.forEach((c) => { const v = fixPrefecture(c.address); if (v !== c.address) { c.address = v; touch(c); n++; } });
    state.invoices.forEach((i) => {
      const v = fixPrefecture(i.customerAddress);
      if (v === i.customerAddress) return;
      const pristine = i.importedAt && !(i.updatedAt > i.importedAt); // 手で編集していない取り込み分は、編集扱いにしない
      i.customerAddress = v; touch(i); n++;
      if (pristine) i.importedAt = i.updatedAt;
    });
    return n;
  }

  // ---------- 起動 ----------
  let pollTimer = null;
  async function startServerSync() {
    try {
      // この端末の控えとMacのデータを合わせる（初回はこの端末のデータがMacに入る）
      const r = await api('/api/data', { state });
      serverRev = r.rev;
      adoptState(r.state);
      if (fixAllAddresses()) save();
    } catch (e) {
      if (authRequired) return;
      setSyncBadge('⚠ Macと通信できません。この端末の控えを表示しています');
    }
    route();
    clearInterval(pollTimer);
    pollTimer = setInterval(() => { if (document.visibilityState === 'visible') pullState(); }, 15000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pullState(); });
    try {
      const st = await api('/api/status');
      const last = Date.parse(state.settings.lastMakeLeapsImport || 0) || 0;
      if (st.configured && Date.now() - last > 30 * 60 * 1000) syncMakeLeaps({ silent: true });
    } catch (e) { /* 同期できなくても画面は使える */ }
  }
  if (SERVER) { app.innerHTML = '<div class="empty">読み込み中…</div>'; startServerSync(); } else { if (fixAllAddresses()) save(); route(); }
})();
