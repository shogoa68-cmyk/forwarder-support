// スマホ幅（〜600px）の見積もりテーブル（Design 2026-11-09・14-スマホ版見積もりテーブル仕様）。段階 1＝一覧。
// 右カラムの「費用テーブル（縮小表示）」のように 1 列の一覧を、表示層として別に描く（PC の表と行の DOM は変えない）。
// 行をタップすると、編集シート（段階 2）の代わりに、いまは実際の表をその行まで開く。
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const mq = window.matchMedia ? window.matchMedia('(max-width: 600px)') : null;
  let host = null, listEl = null, timer = 0, obs = null;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = s => { const n = parseFloat(String(s || '').replace(/[^\d.\-]/g, '')); return isFinite(n) ? n : 0; };
  const fmt = n => Math.round(n * 100) / 100 === Math.round(n) ? Math.round(n).toLocaleString('ja-JP') : (Math.round(n * 100) / 100).toLocaleString('ja-JP');
  const dataRows = () => Array.from(document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])'));
  const f = (tr, k) => tr.querySelector('[data-field="' + k + '"]');
  const v = (tr, k) => { const e = f(tr, k); return e ? (e.value != null && e.tagName !== 'TD' ? e.value : e.textContent) : ''; };

  // 金額欄は「4,400」のあとに「要調査」「出力しない」などの札の文字が続くので、先頭の金額（幅のあるときは「下限〜上限」）だけ取る
  function stText(tr) { const t = (f(tr, 'st')?.textContent || '').trim(); const m = /^[^\d\-]*\d[\d,\.]*(?:\s*[〜~]\s*[^\d\-]*\d[\d,\.]*)?/.exec(t); return m ? m[0].trim() : t; }
  function info(tr) {
    const hidden = tr.dataset.hideQuote === '1', pending = tr.dataset.pending === '1', done = tr.dataset.done === '1';
    const ccy = v(tr, 'bc') || 'JPY';
    return {
      tr, id: tr.id, sv: (v(tr, 'sv') || '').trim(), pt: (v(tr, 'pt') || '').trim(), nm: (v(tr, 'nm') || '').trim(),
      qty: v(tr, 'pq'), un: (v(tr, 'un') || '').trim(), bp: v(tr, 'bp'), ccy, st: stText(tr),
      hidden, pending, done, out: !!tr.dataset.outRange, amount: num(stText(tr)),
      doneText: (done && typeof window.rowDoneInfo === 'function' && window.rowDoneInfo(tr)) ? window.rowDoneInfo(tr).text : '',   // 入力完了を押した日時・ユーザー
    };
  }
  function sums(items) {
    const m = {}; items.forEach(i => { if (i.hidden || i.out) return; m[i.ccy] = (m[i.ccy] || 0) + i.amount; });
    return Object.keys(m).map(c => ({ c, n: m[c] }));
  }
  const sumHtml = s => s.length ? s.map(x => fmt(x.n) + ' ' + esc(x.c)).join(' ＋ ') : '—';

  function render() {
    timer = 0; if (!listEl) return;
    const rows = dataRows().map(info);
    if (!rows.length) { listEl.innerHTML = '<div class="mc-empty">まだ明細がありません。「＋ 行を追加」から始めます。</div>' + addBtn(); wire(); return; }
    // サブコンごと（出てきた順）→ パターン（変わったところだけ見出し）
    const groups = []; const idx = {};
    rows.forEach(r => { const k = r.sv || '\u0000'; if (!(k in idx)) { idx[k] = groups.length; groups.push({ sv: r.sv, items: [] }); } groups[idx[k]].items.push(r); });
    let h = '';
    groups.forEach(g => {
      const last = g.items[g.items.length - 1];
      h += '<div class="mc-sv"><span class="mc-sv-name">' + esc(g.sv || '（サブコン未設定）') + '</span><span class="mc-sv-sum">' + sumHtml(sums(g.items)) + '</span>' +
        '<button type="button" class="mc-add" data-add="' + esc(last.id) + '" aria-label="' + esc(g.sv || 'このグループ') + 'の末尾に行を追加">＋</button></div>';
      let curPt = null;
      g.items.forEach(r => {
        if (r.pt !== curPt && (r.pt || curPt)) h += '<div class="mc-pt">' + esc(r.pt || '（パターン設定なし）') + '</div>';
        curPt = r.pt;
        const band = r.done ? 'is-done' : r.pending ? 'is-pending' : '';
        h += '<button type="button" class="mc-row ' + band + (r.hidden ? ' is-hidden' : '') + (r.out ? ' is-out' : '') + '" data-row="' + esc(r.id) + '">' +
          '<span class="mc-main"><span class="mc-nm">' + (esc(r.nm) || '<i>（品名未入力）</i>') + '</span>' +
          '<span class="mc-sub">' + esc(r.qty) + (r.un ? ' ' + esc(r.un) : '') + ' × ' + esc(r.bp) + ' ' + esc(r.ccy) + '</span>' +
          '<span class="mc-tags">' + (r.hidden ? '<b class="mc-tag t-hide">見積書に出さない</b>' : '') + (r.pending ? '<b class="mc-tag t-pend">🔍 要調査</b>' : '') + (r.done ? '<b class="mc-tag t-done">✓ 入力完了' + (r.doneText ? ' ' + esc(r.doneText) : '') + '</b>' : '') + (r.out ? '<b class="mc-tag t-out">適用外</b>' : '') + '</span></span>' +
          '<span class="mc-amt">' + esc(r.st || '—') + '<small>' + esc(r.ccy) + '</small></span><span class="mc-go" aria-hidden="true">›</span></button>';
      });
    });
    const tot = ($('tot-subtotal')?.textContent || '').trim();
    h += addBtn() + '<div class="mc-total"><span class="mc-total-l">合計（売）</span><span class="mc-total-v">' + sumHtml(sums(rows)) + '</span>' + (tot && tot !== '—' ? '<small>見積合計 ' + esc(tot) + '</small>' : '') + '</div>';
    listEl.innerHTML = h; wire();
  }
  const addBtn = () => '<button type="button" class="mc-addrow" data-addrow="1">＋ 行を追加</button>';
  function wire() {
    listEl.querySelectorAll('[data-row]').forEach(b => b.addEventListener('click', () => openRow(b.dataset.row)));
    listEl.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); const tr = $(b.dataset.add); const btn = tr && tr.querySelector('.row-add-btn'); if (btn && window.rowAddBelow) { window.rowAddBelow(btn); schedule(); } }));
    listEl.querySelectorAll('[data-addrow]').forEach(b => b.addEventListener('click', () => { if (window.addRow) { window.addRow(); schedule(); } }));
  }
  // 段階 1：行をタップしたら、実際の表をその行まで開く（編集シートは段階 2）
  function openRow(id) {
    if (window.mcSheetOpen) { window.mcSheetOpen(id); return; }   // 段階 2：編集シート
    document.body.classList.add('mc-table-on'); setMode();
    const tr = $(id); if (!tr) return;
    setTimeout(() => { tr.scrollIntoView({ block: 'center', behavior: 'smooth' }); tr.classList.add('mc-flash'); setTimeout(() => tr.classList.remove('mc-flash'), 1600); }, 50);
  }
  function setMode() {
    const on = document.body.classList.contains('mc-table-on'); const b = $('mcModeBtn');
    if (b) { b.textContent = on ? '‹ 一覧に戻る' : '表で編集する（PC と同じ表）'; b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
  }
  function schedule() { if (!timer) timer = setTimeout(render, 120); }
  function apply() {
    const on = !!(mq && mq.matches);
    document.body.classList.toggle('mc-on', on);
    if (!on) document.body.classList.remove('mc-table-on');
    if (on) render(); setMode();
  }
  function init() {
    const wrap = $('tableScrollWrap'); if (!wrap || host) return;
    host = document.createElement('div'); host.id = 'mcHost'; host.className = 'mc-host';
    host.innerHTML = '<div id="mcList" class="mc-list" aria-label="見積もりテーブル（スマホ表示）"></div><button type="button" id="mcModeBtn" class="mc-mode-btn" aria-pressed="false"></button>';
    wrap.before(host); listEl = $('mcList');
    $('mcModeBtn').addEventListener('click', () => { document.body.classList.toggle('mc-table-on'); setMode(); });
    const tb = $('tableBody');
    if (tb) {
      obs = new MutationObserver(schedule); obs.observe(tb, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'data-pending', 'data-done', 'data-hide-quote', 'data-out-range'] });
      tb.addEventListener('input', schedule); tb.addEventListener('change', schedule);
    }
    if (mq) (mq.addEventListener ? mq.addEventListener('change', apply) : mq.addListener(apply));
    apply();
  }
  window.mcSetMode = setMode;
  window.mcRefresh = () => { if (mq && mq.matches) render(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.addEventListener('load', init);
})();
