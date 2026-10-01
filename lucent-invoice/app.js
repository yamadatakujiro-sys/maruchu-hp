/* ===== Lucent 請求書管理：アプリ本体 =====
 * データはブラウザ（localStorage）に保存する。サーバー不要。
 * 端末をまたぐ場合・バックアップは「設定 → バックアップ」のJSON書き出し／読み込みを使う。
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
      nextNumber: 346
    },
    customers: [],
    invoices: []
  };

  // ---------- 保存・読み込み ----------
  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        return {
          settings: Object.assign({}, DEFAULT_STATE.settings, s.settings || {}),
          customers: s.customers || [],
          invoices: s.invoices || []
        };
      }
    } catch (e) { console.warn('読み込み失敗', e); }
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      alert('保存に失敗しました。ブラウザの保存領域を確認してください。\n' + e.message);
      return false;
    }
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

  // ---------- 状態判定 ----------
  function statusOf(inv) {
    if (inv.status === 'paid') return 'paid';
    if (inv.status === 'draft') return 'draft';
    if (inv.dueDate && inv.dueDate < today()) return 'overdue';
    return 'issued';
  }
  const STATUS_LABEL = { draft: '下書き', issued: '未入金', overdue: '期限超過', paid: '入金済' };
  const badge = (inv) => { const s = statusOf(inv); return `<span class="badge ${s}">${STATUS_LABEL[s]}</span>`; };

  function findCustomer(id) { return state.customers.find((c) => c.id === id); }
  function findInvoice(id) { return state.invoices.find((i) => i.id === id); }
  function sortedInvoices() {
    return state.invoices.slice().sort((a, b) => (b.issueDate || '').localeCompare(a.issueDate || '') || toInt(b.number) - toInt(a.number));
  }

  // ---------- ルーター ----------
  const app = $('#app');
  function route() {
    const parts = (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean);
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
    const issued = state.invoices.filter((i) => i.status !== 'draft');
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
          <a class="btn primary" href="#/invoices/new">＋ 請求書を作成</a>
        </div>
      </div>
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
    const payBtn = withPay === true && inv.status !== 'paid' ? `<button class="btn sm primary pay-btn" data-pay="${inv.id}">入金</button>` : '';
    return `<li class="${payBtn ? 'has-action' : ''}"><a class="row" href="#/invoices/${inv.id}">
      <span class="title">No.${esc(inv.number)}　${esc(inv.customerName || '（取引先未設定）')}</span>
      <span class="amount">${yen(t.total)}</span>
      <span class="meta">${fmtDate(inv.issueDate)} 発行${inv.dueDate ? '・期限 ' + fmtDate(inv.dueDate) : ''}${inv.paidDate ? '・入金 ' + fmtDate(inv.paidDate) : ''}${inv.source === 'makeleaps' ? '・MakeLeaps' : ''}</span>
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
    if (inv && markPaid(inv)) route();
  });

  // ---------- MakeLeaps 同期（起動用サーバー経由） ----------
  const SERVER = location.protocol === 'http:' || location.protocol === 'https:';
  async function api(path, body) {
    const res = await fetch(path, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Lucent': '1' }, body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }
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
    const months = Array.from(new Set(state.invoices.map((i) => ym(i.issueDate)).filter(Boolean))).sort().reverse();
    app.innerHTML = `
      <div class="page-head">
        <div><h1>請求書</h1><div class="muted small">全${state.invoices.length}件</div></div>
        <div class="btn-row">
          <button class="btn" id="csv">CSV出力</button>
          <a class="btn primary" href="#/invoices/new">＋ 新規作成</a>
        </div>
      </div>
      <div class="card">
        <div class="filters">
          <input class="search" id="q" type="search" placeholder="取引先・番号・車種・部品で検索">
          <select id="fs">
            <option value="">すべての状態</option>
            <option value="unpaid">未入金（期限超過含む）</option>
            <option value="overdue">期限超過</option>
            <option value="paid">入金済</option>
            <option value="draft">下書き</option>
          </select>
          <select id="fm"><option value="">すべての月</option>${months.map((m) => `<option value="${m}">${m.replace('-', '年')}月</option>`).join('')}</select>
        </div>
        <ul class="list" id="list"></ul>
        <div class="muted small" id="sum" style="text-align:right;margin-top:8px"></div>
      </div>`;

    const draw = () => {
      const q = $('#q').value.trim().toLowerCase();
      const fs = $('#fs').value, fm = $('#fm').value;
      const rows = sortedInvoices().filter((inv) => {
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
      $('#list').innerHTML = rows.length ? rows.map(invoiceRow).join('') : '<li class="empty">該当する請求書はありません</li>';
      $('#sum').textContent = rows.length ? `${rows.length}件　合計 ${yen(rows.reduce((s, i) => s + calcTotals(i).total, 0))}` : '';
      draw.rows = rows;
    };
    ['q', 'fs', 'fm'].forEach((id) => $('#' + id).addEventListener('input', draw));
    $('#csv').addEventListener('click', () => exportCsv(draw.rows || []));
    draw();
  }

  function exportCsv(rows) {
    const head = ['請求書番号', '発行日', '支払期限', '取引先', '小計', '消費税', '合計', '状態', '入金日', '入金額', '明細'];
    const lines = [head].concat(rows.map((inv) => {
      const t = calcTotals(inv);
      return [inv.number, fmtDate(inv.issueDate), fmtDate(inv.dueDate), inv.customerName, t.subtotal, t.tax, t.total,
        STATUS_LABEL[statusOf(inv)], fmtDate(inv.paidDate), inv.paidAmount || '', inv.items.map(itemLabel).join(' / ')];
    }));
    const csv = lines.map((r) => r.map((v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    download('﻿' + csv, `請求書一覧_${today()}.csv`, 'text/csv');
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
  function newInvoice() {
    const s = state.settings;
    const issueDate = today();
    return {
      id: null, number: String(s.nextNumber), issueDate, dueDate: calcDue(issueDate, s.dueRule),
      customerId: '', customerName: '', honorific: '御中', customerPostal: '', customerAddress: '', customerTel: '', customerFax: '',
      items: [{ date: issueDate, car: '', part: '', qty: 1, price: 0 }],
      notes: s.notes, status: 'issued', paidDate: '', paidAmount: '', memo: ''
    };
  }

  function renderEditor(id) {
    const src = id ? findInvoice(id) : null;
    if (id && !src) { app.innerHTML = '<div class="empty">請求書が見つかりません</div>'; return; }
    // 編集はコピーに対して行い、保存時に反映する
    const inv = src ? JSON.parse(JSON.stringify(src)) : (renderEditor.draft || newInvoice());
    renderEditor.draft = null;

    app.innerHTML = `
      <div class="page-head">
        <div><h1>${src ? '請求書の編集' : '請求書の作成'}</h1><div class="muted small">No.${esc(inv.number)}</div></div>
      </div>
      <form id="f" autocomplete="off">
        <div class="card">
          <h2>請求先</h2>
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
        </div>

        <div class="card">
          <h2>請求情報</h2>
          <div class="grid-3">
            <label class="field"><span>請求書番号</span><input name="number" value="${esc(inv.number)}" required></label>
            <label class="field"><span>発行日</span><input name="issueDate" type="date" value="${esc(inv.issueDate)}" required></label>
            <label class="field"><span>支払期限（空欄で記載なし）</span><input name="dueDate" type="date" value="${esc(inv.dueDate)}"></label>
          </div>
        </div>

        <div class="card">
          <h2>明細</h2>
          <div class="items-head"><span>日付</span><span>車種・型式</span><span>部品・品名</span><span>数量</span><span>単価</span><span>金額</span><span></span></div>
          <div class="items" id="items"></div>
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
          <label class="field"><span>備考（請求書に印字）</span><textarea name="notes" rows="4">${esc(inv.notes)}</textarea></label>
          <div class="grid-3">
            <label class="field"><span>状態</span>
              <select name="status">
                <option value="draft" ${inv.status === 'draft' ? 'selected' : ''}>下書き</option>
                <option value="issued" ${inv.status === 'issued' ? 'selected' : ''}>発行済（未入金）</option>
                <option value="paid" ${inv.status === 'paid' ? 'selected' : ''}>入金済</option>
              </select>
            </label>
            <label class="field"><span>入金日</span><input name="paidDate" type="date" value="${esc(inv.paidDate)}"></label>
            <label class="field"><span>入金額</span><input name="paidAmount" inputmode="numeric" value="${esc(inv.paidAmount)}"></label>
          </div>
          <label class="field"><span>社内メモ（印字されません）</span><input name="memo" value="${esc(inv.memo)}"></label>
        </div>

        <div class="sticky-actions">
          <a class="btn" href="${src ? '#/invoices/' + src.id : '#/invoices'}">キャンセル</a>
          <button type="submit" class="btn primary">保存してプレビュー</button>
        </div>
      </form>`;

    const f = $('#f');
    const itemsEl = $('#items');

    function drawItems() {
      itemsEl.innerHTML = inv.items.map((it, i) => `
        <div class="item" data-i="${i}">
          <label class="f-date"><span class="lbl">日付</span><input type="date" data-k="date" value="${esc(it.date)}"></label>
          <label class="f-car"><span class="lbl">車種・型式</span><input data-k="car" value="${esc(it.car)}" placeholder="マークX GRX130"></label>
          <label class="f-part"><span class="lbl">部品・品名</span><input data-k="part" value="${esc(it.part)}" placeholder="左フェンダー"></label>
          <label class="f-qty"><span class="lbl">数量</span><input data-k="qty" inputmode="numeric" value="${esc(it.qty)}" class="num"></label>
          <label class="f-price"><span class="lbl">単価</span><input data-k="price" inputmode="numeric" value="${esc(it.price || '')}" class="num" placeholder="0"></label>
          <div class="f-amount num" data-amt>${num(lineAmount(it))}</div>
          <div class="f-del"><button type="button" class="btn sm danger" data-del title="この行を削除">✕</button></div>
        </div>`).join('');
      drawTotals();
    }
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
      delete inv.importedTotals;
      const it = inv.items[+row.dataset.i];
      it[k] = (k === 'qty' || k === 'price') ? toInt(e.target.value) : e.target.value;
      $('[data-amt]', row).textContent = num(lineAmount(it));
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
    });
    // 発行日を変えたら支払期限も追従（新規作成時のみ）
    let prevIssue = inv.issueDate;
    f.issueDate.addEventListener('change', () => {
      if (!src) f.dueDate.value = calcDue(f.issueDate.value, state.settings.dueRule);
      // 発行日と同じ日付だった明細は新しい発行日に追従させる
      let changed = false;
      inv.items.forEach((it) => { if (!it.date || it.date === prevIssue) { it.date = f.issueDate.value; changed = true; } });
      prevIssue = f.issueDate.value;
      if (changed) drawItems();
    });
    f.status.addEventListener('change', () => {
      if (f.status.value === 'paid' && !f.paidDate.value) {
        f.paidDate.value = today();
        if (!f.paidAmount.value) f.paidAmount.value = calcTotals(inv).total;
      }
    });

    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(f).entries());
      const number = fd.number.trim();
      if (state.invoices.some((x) => x.number === number && x.id !== inv.id)) {
        if (!confirm(`請求書番号 ${number} は既に使われています。このまま保存しますか？`)) return;
      }
      inv.items = inv.items.filter((it) => it.part || it.car || toInt(it.price));
      if (!inv.items.length) { toast('明細を1行以上入力してください'); drawItems(); return; }
      Object.assign(inv, {
        number, issueDate: fd.issueDate, dueDate: fd.dueDate,
        customerName: fd.customerName.trim(), honorific: fd.honorific,
        customerPostal: fd.customerPostal.trim(), customerAddress: fd.customerAddress.trim(),
        customerTel: fd.customerTel.trim(), customerFax: fd.customerFax.trim(),
        notes: fd.notes, status: fd.status, paidDate: fd.status === 'paid' ? fd.paidDate : '',
        paidAmount: fd.status === 'paid' ? toInt(fd.paidAmount) || '' : '', memo: fd.memo,
        updatedAt: new Date().toISOString()
      });

      // 取引先マスタに自動登録・更新
      let c = state.customers.find((x) => x.name === inv.customerName);
      if (!c) { c = { id: uid(), name: inv.customerName }; state.customers.push(c); }
      Object.assign(c, { honorific: inv.honorific, postal: inv.customerPostal, address: inv.customerAddress, tel: inv.customerTel, fax: inv.customerFax });
      inv.customerId = c.id;

      if (src) {
        if (!inv.importedTotals) delete src.importedTotals; // 明細を編集したら再計算に切り替え
        Object.assign(src, inv);
      } else {
        inv.id = uid();
        inv.createdAt = inv.updatedAt;
        state.invoices.push(inv);
        // 次の番号を進める
        const n = toInt(number);
        if (n >= state.settings.nextNumber) state.settings.nextNumber = n + 1;
      }
      if (save()) { toast('保存しました'); location.hash = '#/invoices/' + inv.id; }
    });

    drawItems();
  }

  // ================= 請求書プレビュー（印刷） =================
  function paperHtml(inv) {
    const s = state.settings;
    const t = calcTotals(inv);
    const rows = inv.items.map((it) => (!toInt(it.qty) && !toInt(it.price))
      ? `<tr><td>${esc(itemLabel(it))}</td><td></td><td></td><td></td></tr>`
      : `<tr><td>${esc(itemLabel(it))}</td><td class="c-qty">${num(it.qty)}</td><td class="c-price">${num(it.price)}</td><td class="c-amt">${num(lineAmount(it))}</td></tr>`);
    while (rows.length < 8) rows.push('<tr><td></td><td></td><td></td><td></td></tr>'); // 空行で紙面を整える
    const br = (v) => esc(v).replace(/\n/g, '<br>');
    return `
      <div class="paper">
        <h1 class="doc-title">御請求書</h1>
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
              <tr><td>請求書番号</td><td>${esc(inv.number)}</td></tr>
              <tr><td>発行日</td><td>${fmtDate(inv.issueDate)}</td></tr>
              ${inv.dueDate ? `<tr><td>お支払期限</td><td>${fmtDate(inv.dueDate)}</td></tr>` : ''}
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
        <div class="total-box"><span class="t">合計金額（税込）</span><span class="v">${yen(t.total)}</span></div>
        <table class="lines">
          <thead><tr><th>項目</th><th class="c-qty">数量</th><th class="c-price">単価</th><th class="c-amt">金額</th></tr></thead>
          <tbody>${rows.join('')}</tbody>
        </table>
        <table class="sum-tbl">
          <tr><td>小計</td><td>${num(t.subtotal)}</td></tr>
          <tr><td>消費税（${t.rate}%）</td><td>${num(t.tax)}</td></tr>
          <tr class="grand"><td>合計金額</td><td>${num(t.total)}</td></tr>
        </table>
        <div class="foot">
          ${s.bank ? `<div><h3>お振込先</h3><p>${esc(s.bank)}</p></div>` : ''}
          ${inv.notes ? `<div><h3>備考</h3><p>${esc(inv.notes)}</p></div>` : ''}
        </div>
      </div>`;
  }

  function renderInvoiceView(id) {
    const inv = findInvoice(id);
    if (!inv) { app.innerHTML = '<div class="empty">請求書が見つかりません。<a href="#/invoices">一覧へ</a></div>'; return; }
    const t = calcTotals(inv);
    const s = statusOf(inv);
    app.innerHTML = `
      <div class="page-head">
        <div><h1>No.${esc(inv.number)}　${esc(inv.customerName)}</h1>
          <div class="small">${badge(inv)} <span class="muted">${yen(t.total)}${inv.paidDate ? '・' + fmtDate(inv.paidDate) + ' 入金' : ''}${inv.memo ? '・メモ：' + esc(inv.memo) : ''}</span></div></div>
      </div>
      <div class="btn-row" style="margin-bottom:16px">
        <button class="btn navy" id="print">🖨 印刷 / PDF保存</button>
        ${s === 'issued' || s === 'overdue' ? '<button class="btn primary" id="pay">✓ 入金済にする</button>' : ''}
        ${s === 'paid' ? '<button class="btn" id="unpay">未入金に戻す</button>' : ''}
        ${s === 'draft' ? '<button class="btn primary" id="issue">発行済にする</button>' : ''}
        <a class="btn" href="#/invoices/${inv.id}/edit">✎ 編集</a>
        <button class="btn" id="dup">⧉ 複製して新規</button>
        <button class="btn danger" id="del">削除</button>
      </div>
      ${inv.source === 'makeleaps' && !(inv.items || []).some((it) => it.part || toInt(it.price)) ? `<div class="card small" style="background:var(--warn-soft)">⚠ この請求書はMakeLeapsから内訳が取り込めていません。
        ${SERVER ? '<button class="btn sm" id="inspect">原因を調べる</button><pre id="inspectOut" style="white-space:pre-wrap;font-size:11px;max-height:320px;overflow:auto;margin:8px 0 0"></pre>' : '「Lucent請求書.command」から開くと原因を調べられます。'}</div>` : ''}
      ${!state.settings.bank ? '<div class="card small" style="background:var(--warn-soft)">⚠ 振込先が未設定です。<a href="#/settings">設定</a>で入力すると請求書に印字されます。</div>' : ''}
      <div class="paper-wrap">${paperHtml(inv)}</div>`;

    $('#print').addEventListener('click', () => {
      const old = document.title;
      document.title = `請求書_${inv.number}_${inv.customerName}`; // PDF保存時のファイル名になる
      window.print();
      setTimeout(() => { document.title = old; }, 1000);
    });
    const on = (sel, fn) => { const el = $(sel); if (el) el.addEventListener('click', fn); };
    on('#pay', () => { if (markPaid(inv)) route(); });
    on('#inspect', async () => {
      $('#inspectOut').textContent = '調査中…';
      try {
        const r = await api('/api/inspect?doc=' + encodeURIComponent(inv.externalId));
        $('#inspectOut').textContent = 'No.' + inv.number + '\n' + JSON.stringify(r, null, 1);
      } catch (err) { $('#inspectOut').textContent = 'エラー：' + err.message; }
    });
    on('#unpay', () => { Object.assign(inv, { status: 'issued', paidDate: '', paidAmount: '', updatedAt: new Date().toISOString() }); save(); route(); });
    on('#issue', () => { Object.assign(inv, { status: 'issued', updatedAt: new Date().toISOString() }); save(); route(); });
    on('#dup', () => {
      const d = newInvoice();
      Object.assign(d, {
        customerId: inv.customerId, customerName: inv.customerName, honorific: inv.honorific,
        customerPostal: inv.customerPostal, customerAddress: inv.customerAddress, customerTel: inv.customerTel, customerFax: inv.customerFax,
        items: inv.items.map((it) => Object.assign({}, it, { date: d.issueDate })), notes: inv.notes
      });
      renderEditor.draft = d;
      if (location.hash === '#/invoices/new') route(); else location.hash = '#/invoices/new';
    });
    on('#del', () => {
      if (!confirm(`請求書 No.${inv.number} を削除します。元に戻せません。よろしいですか？`)) return;
      state.invoices = state.invoices.filter((x) => x.id !== inv.id);
      save(); toast('削除しました'); location.hash = '#/invoices';
    });
  }

  // ================= 取引先 =================
  function renderCustomerList() {
    const stats = {};
    state.invoices.forEach((i) => {
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
    const c = id ? findCustomer(id) : { id: null, name: '', honorific: '御中', postal: '', address: '', tel: '', fax: '', memo: '' };
    if (!c) { app.innerHTML = '<div class="empty">取引先が見つかりません</div>'; return; }
    const invs = id ? sortedInvoices().filter((i) => i.customerId === id) : [];
    app.innerHTML = `
      <div class="page-head"><h1>${id ? esc(c.name) : '取引先の追加'}</h1>
        ${id ? `<button class="btn primary" id="newInv">＋ この取引先で請求書を作成</button>` : ''}</div>
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
        <label class="field"><span>メモ（担当者・締め日など）</span><input name="memo" value="${esc(c.memo)}"></label>
        <div class="btn-row" style="justify-content:space-between">
          ${id ? '<button type="button" class="btn danger" id="del">削除</button>' : '<span></span>'}
          <div class="btn-row"><a class="btn" href="#/customers">戻る</a><button class="btn primary">保存</button></div>
        </div>
      </form>
      ${id ? `<div class="card"><h2>請求履歴</h2>${invs.length ? `<ul class="list">${invs.map(invoiceRow).join('')}</ul>` : '<div class="empty">まだ請求書はありません</div>'}</div>` : ''}`;

    const f = $('#f');
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(f).entries());
      const name = fd.name.trim();
      if (state.customers.some((x) => x.name === name && x.id !== c.id)) { toast('同じ名前の取引先があります'); return; }
      const oldName = c.name;
      Object.assign(c, fd, { name });
      if (!c.id) { c.id = uid(); state.customers.push(c); }
      // 社名変更は未入金・下書きの請求書にだけ反映（発行済の控えは当時のまま残す）
      if (oldName && oldName !== name) state.invoices.forEach((i) => { if (i.customerId === c.id && i.status === 'draft') i.customerName = name; });
      save(); toast('保存しました'); location.hash = '#/customers';
    });
    if (id) {
      $('#del').addEventListener('click', () => {
        if (!confirm(`${c.name} を削除しますか？（発行済の請求書は残ります）`)) return;
        state.customers = state.customers.filter((x) => x.id !== c.id);
        save(); location.hash = '#/customers';
      });
      $('#newInv').addEventListener('click', () => {
        const d = newInvoice();
        Object.assign(d, { customerId: c.id, customerName: c.name, honorific: c.honorific, customerPostal: c.postal, customerAddress: c.address, customerTel: c.tel, customerFax: c.fax });
        renderEditor.draft = d;
        location.hash = '#/invoices/new';
      });
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
          <label class="field"><span>備考の初期文</span><textarea name="notes" rows="4">${esc(s.notes)}</textarea></label>
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
          </div>
          <p class="muted small" style="margin:0">※税率・端数の変更は、税率を個別に持たない既存の請求書の表示にも反映されます。</p>
        </div>
        <div class="sticky-actions"><button class="btn primary">設定を保存</button></div>
      </form>

      <div class="card">
        <h2>バックアップ</h2>
        <p class="small muted" style="margin-top:0">データはこの端末のブラウザ内に保存されています。別の端末で使う時や、念のための控えとして定期的に書き出してください。</p>
        <div class="btn-row">
          <button class="btn navy" id="exp">⬇ バックアップを書き出す</button>
          <label class="btn">⬆ バックアップを読み込む<input type="file" id="imp" accept="application/json,.json" hidden></label>
        </div>
      </div>

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
      Object.assign(s, fd, { taxRate: toInt(fd.taxRate), nextNumber: toInt(fd.nextNumber) || s.nextNumber });
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
          state = { settings: Object.assign({}, DEFAULT_STATE.settings, d.settings || {}), customers: d.customers, invoices: d.invoices };
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

  // MakeLeapsデータを既存データに追加（externalIdで重複判定）
  function importMakeLeaps(d) {
    const res = { added: 0, updated: 0, kept: 0, newCustomers: 0 };
    (d.customers || []).forEach((mc) => {
      if (!mc.name) return;
      let c = state.customers.find((x) => x.name === mc.name);
      if (!c) {
        c = { id: uid(), name: mc.name, honorific: mc.honorific || '御中', postal: mc.postal || '', address: mc.address || '', tel: mc.tel || '', fax: mc.fax || '', memo: '' };
        state.customers.push(c); res.newCustomers++;
      } else {
        // 空欄だけ補う（手入力した情報は上書きしない）
        ['postal', 'address', 'tel', 'fax'].forEach((k) => { if (!c[k] && mc[k]) c[k] = mc[k]; });
      }
    });
    const now = new Date().toISOString();
    d.invoices.forEach((mi) => {
      const c = state.customers.find((x) => x.name === mi.customerName);
      const data = Object.assign({}, mi, { customerId: c ? c.id : '', importedAt: now });
      const ex = mi.externalId && state.invoices.find((x) => x.externalId === mi.externalId);
      if (ex) {
        // このアプリで編集した請求書は上書きしない（入金状態だけはMakeLeaps側が入金済なら反映）
        if (ex.updatedAt && ex.importedAt && ex.updatedAt > ex.importedAt) {
          if (mi.status === 'paid' && ex.status !== 'paid') Object.assign(ex, { status: 'paid', paidDate: mi.paidDate, paidAmount: mi.paidAmount });
          if (!(ex.items || []).some((it) => it.part || toInt(it.price)) && (mi.items || []).length) Object.assign(ex, { items: mi.items, importedTotals: mi.importedTotals });
          res.kept++;
        } else {
          const keepPaid = ex.status === 'paid' && data.status !== 'paid' ? { status: 'paid', paidDate: ex.paidDate, paidAmount: ex.paidAmount } : {};
          Object.assign(ex, data, keepPaid, { id: ex.id, updatedAt: now }); res.updated++;
        }
      } else {
        state.invoices.push(Object.assign(data, { id: uid(), createdAt: now, updatedAt: now })); res.added++;
      }
      const n = toInt(mi.number);
      if (n && n < 1e9 && n >= state.settings.nextNumber) state.settings.nextNumber = n + 1;
    });
    return res;
  }

  route();
  if (SERVER) {
    api('/api/status').then((st) => {
      const last = Date.parse(state.settings.lastMakeLeapsImport || 0) || 0;
      if (st.configured && Date.now() - last > 30 * 60 * 1000) syncMakeLeaps({ silent: true });
    }).catch(() => {});
  }
})();
