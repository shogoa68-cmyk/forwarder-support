// ================================================================
//  コンパクト表示（常に前面の小窓）— 見積テーブルの明細を、他のアプリ・ブラウザの上に重ねて置ける小窓で入力する
//  船会社の料金表など「大画面で見る資料」を別ウィンドウで開いたまま、見積の明細を打ち込むためのもの。
//  方式：ブラウザの Document Picture-in-Picture（Chrome／Edge 116 以降）。Safari／Firefox は未対応（案内を出す）。
//  データの持ち方は変えない（mobile-sheet.js と同じ考え方）：小窓の入力は該当行の欄（data-field）へ書き込み、
//  input／change を発火して既存の計算・小計・保存をそのまま動かす。行の DOM は変えず、小窓は表示層だけ。
//  入力の範囲を絞れる：サブコンごと／サブコン→パターンごと（小窓の「範囲」）。範囲に入る行だけを出し、行の追加もその範囲へ入る。
//  入口：window.quotePipToggle()（ツールバー「⋯」とテーブル操作バーの「🪟 常に前面」）
// ================================================================
(function () {
  'use strict';
  const SIZE_KEY = 'quotePipSize_v1';
  const $ = id => document.getElementById(id);
  const rowsNow = () => Array.from(document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])'));
  const fld = (tr, k) => tr && tr.querySelector('[data-field="' + k + '"]');
  const supported = () => !!(window.documentPictureInPicture && typeof window.documentPictureInPicture.requestWindow === 'function');
  let win = null, doc = null, sig = '', timer = null, obs = null, listen = null;
  // 入力の範囲：sv＝null はすべて／''＝サブコン未設定／文字列＝そのサブコン。pt＝null はそのサブコンのすべて／''＝パターンなし／文字列＝そのパターン
  let scope = { sv: null, pt: null };
  const nk = x => String(x == null ? '' : x).replace(/\s+/g, '').toLowerCase();
  const svOf = tr => (fld(tr, 'sv')?.value || '').trim();
  const ptOf = tr => (fld(tr, 'pt')?.value || '').trim();
  const inScope = tr => (scope.sv === null || nk(svOf(tr)) === nk(scope.sv)) && (scope.pt === null || nk(ptOf(tr)) === nk(scope.pt));

  const CSS = `
    :root{color-scheme:light}
    *{box-sizing:border-box}
    body{margin:0;font:13px/1.5 "Noto Sans JP","Hiragino Sans","Segoe UI",Meiryo,sans-serif;color:#1f2a36;background:#f3f4f6}
    .top{position:sticky;top:0;z-index:3}
    .hd{background:#2f4458;color:#fff;padding:8px 10px;display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center}
    .hd b{font-size:14px}
    .tot{display:flex;gap:10px;flex:1;min-width:0;flex-wrap:wrap;font-size:13px}
    .tot span{white-space:nowrap}.tot em{font-style:normal;opacity:.75;margin-right:3px}
    .hd button{font:inherit;font-size:13px;border:1px solid rgba(255,255,255,.5);background:transparent;color:#fff;border-radius:6px;padding:3px 10px;cursor:pointer}
    .hd button:hover{background:rgba(255,255,255,.16)}
    .scope{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;padding:7px 10px;background:#e4eaf0;border-bottom:1px solid #cfd5dc}
    .scope label{font-size:12px;font-weight:700;color:#2f4458}
    .scope select{max-width:200px}
    .scope .ssum{margin-left:auto;font-size:13px;color:#2f4458;white-space:nowrap}
    .scope.on{background:#d5e6f7}
    .list{padding:8px;display:flex;flex-direction:column;gap:6px}
    .row{background:#fff;border:1px solid #cfd5dc;border-left:4px solid #5f7c98;border-radius:6px;padding:6px 8px;display:grid;gap:5px}
    .row.is-hide{opacity:.6;border-left-color:#b0b5bb}
    .row.is-pend{border-left-color:#d99a00}
    .row.is-done{border-left-color:#2f8f5b}
    .row.is-out{opacity:.55}
    .l1{display:grid;grid-template-columns:22px minmax(0,2fr) minmax(0,1.2fr) auto;gap:6px;align-items:center}
    .l2{display:flex;flex-wrap:wrap;gap:5px 8px;align-items:center}
    .n{font-size:12px;color:#6b7683;text-align:right}
    label{display:inline-flex;align-items:center;gap:3px;font-size:12px;color:#5b6672}
    input,select{font:inherit;font-size:13px;color:#1f2a36;background:#fff;border:1px solid #b9c0c8;border-radius:5px;padding:3px 6px;min-width:0}
    input:focus,select:focus{outline:2px solid #3a6ea5;outline-offset:0;border-color:#3a6ea5}
    input:disabled,input[readonly]{background:#eef0f2;color:#5b6672}
    .nm,.sv{width:100%}.pt{width:96px}
    .q{width:64px}.u{width:84px}.p{width:86px}.m{width:70px}.cc{width:68px}
    .tg{font-size:12px;border-radius:4px;padding:0 5px;white-space:nowrap}
    .tg.c{background:#e7edf3;color:#2f4458}.tg.s{background:#fbeccd;color:#6a4a00}
    .calc{margin-left:auto;font-size:13px;white-space:nowrap;color:#2f4458}
    .calc b{font-weight:700}
    .btns{display:flex;gap:3px;align-items:center}
    .btns button{font:inherit;font-size:13px;line-height:1;border:1px solid #c3cad2;background:#fff;border-radius:5px;padding:4px 6px;cursor:pointer;color:#2f4458}
    .btns button:hover{background:#eef2f6}
    .flag{font-size:12px}
    .add{margin:2px 8px 12px;font:inherit;font-size:13px;padding:8px;border:1px dashed #8d99a6;background:#fff;border-radius:6px;cursor:pointer;color:#2f4458}
    .add:hover{background:#eef2f6}
    .empty{padding:24px 12px;text-align:center;color:#6b7683}
  `;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function toast(msg) { try { (window.quoteShowToast || window.showToast || function () {})(msg); } catch (e) {} }

  // 小窓の入力 → 行の欄へ（input／change を発火して既存の計算を走らせる）
  function send(el, ev) {
    const tr = $(el.closest('.row').dataset.row), t = fld(tr, el.dataset.bind);
    if (!t) return;
    if (t.value !== el.value) t.value = el.value;
    t.dispatchEvent(new Event(ev, { bubbles: true }));
  }

  function rowHtml(tr, i) {
    const f = k => fld(tr, k);
    const sel = k => '<select class="' + (k === 'pc' || k === 'bc' ? 'cc' : '') + '" data-bind="' + k + '"></select>';
    return '<div class="row" data-row="' + esc(tr.id) + '">'
      + '<div class="l1"><span class="n">' + (i + 1) + '</span>'
      + '<input class="nm" type="text" data-bind="nm" list="nmSuggestions" autocomplete="off" placeholder="品名">'
      + (scope.sv === null ? '<input class="sv" type="text" data-bind="sv" list="svSuggestions" autocomplete="off" placeholder="サブコン">' : '<span></span>')
      + '<span class="btns"><span class="flag" data-flag></span>'
      + '<button type="button" data-act="jump" title="元の画面でこの行へ移動">↗</button>'
      + '<button type="button" data-act="add" title="この行の下に追加">＋</button>'
      + '<button type="button" data-act="del" title="この行を削除">🗑</button></span></div>'
      + '<div class="l2">'
      + (scope.pt === null ? '<label>パターン<input class="pt" type="text" data-bind="pt" autocomplete="off" placeholder="なし"></label>' : '')
      + '<label>数量<input class="q" type="number" inputmode="decimal" data-bind="pq" min="0"></label>'
      + '<label>単位<input class="u" type="text" data-bind="un" list="unit-list" autocomplete="off"></label>'
      + '<label><span class="tg c">仕</span>' + sel('pc') + '<input class="p" type="number" inputmode="decimal" data-bind="pp" min="0"></label>'
      + '<label>＋乗せ<input class="m" type="number" inputmode="decimal" data-bind="mk" min="0"></label>'
      + '<label><span class="tg s">売</span>' + sel('bc') + '</label>'
      + '<span class="calc">単価 <b data-calc="bp">—</b>　金額 <b data-calc="st">—</b></span>'
      + '</div></div>';
  }

  // 行の値を小窓へ反映する（いま入力中の欄は触らない）
  function syncRow(el) {
    const tr = $(el.dataset.row);
    if (!tr) return;
    el.querySelectorAll('[data-bind]').forEach(c => {
      const t = fld(tr, c.dataset.bind);
      if (!t) return;
      if (c.tagName === 'SELECT' && c.options.length !== t.options.length) c.innerHTML = t.innerHTML;
      if (doc.activeElement !== c && c.value !== t.value) c.value = t.value;
      c.disabled = !!t.disabled;
      c.readOnly = !!t.readOnly;
    });
    const bp = (fld(tr, 'bp')?.value || '—') + ' ' + (fld(tr, 'bc')?.value || '');
    const stRaw = (fld(tr, 'st')?.textContent || '').trim();
    const m = /^[^\d\-]*\d[\d,\.]*(?:\s*[〜~]\s*[^\d\-]*\d[\d,\.]*)?/.exec(stRaw);
    el.querySelector('[data-calc="bp"]').textContent = bp.trim() || '—';
    el.querySelector('[data-calc="st"]').textContent = (m ? m[0].trim() : stRaw || '—') + ' ' + (fld(tr, 'bc')?.value || '');
    const d = tr.dataset;
    el.classList.toggle('is-hide', d.hideQuote === '1');
    el.classList.toggle('is-pend', d.pending === '1');
    el.classList.toggle('is-done', d.done === '1');
    el.classList.toggle('is-out', !!d.outRange);
    const flags = [];
    if (d.hideQuote === '1') flags.push('🚫');
    if (d.pending === '1') flags.push('🔍');
    if (d.done === '1') flags.push('✓');
    if (d.outRange) flags.push('⏳');
    el.querySelector('[data-flag]').textContent = flags.join('');
  }

  function copyDatalists() {
    ['nmSuggestions', 'svSuggestions', 'unit-list'].forEach(id => {
      const src = $(id); if (!src) return;
      const old = doc.getElementById(id); if (old) old.remove();
      const c = doc.createElement('datalist'); c.id = id; c.innerHTML = src.innerHTML; doc.body.appendChild(c);
    });
  }

  function syncHeader() {
    const g = id => ($(id)?.textContent || '—').trim() || '—';
    doc.getElementById('pcCost').textContent = g('tot-cost');
    doc.getElementById('pcSell').textContent = g('tot-subtotal');
    doc.getElementById('pcProfit').textContent = g('tot-profit').replace(/粗利/g, '').replace(/\s+/g, ' ').trim() || '—';
  }

  // 範囲の選択肢（サブコン一覧・そのサブコンのパターン一覧）を、いまの明細から作る
  function scopeOptions() {
    const all = rowsNow();
    const svs = new Map();   // nk -> 表示名
    all.forEach(tr => { const v = svOf(tr); if (!svs.has(nk(v))) svs.set(nk(v), v); });
    if (scope.sv !== null && !svs.has(nk(scope.sv))) svs.set(nk(scope.sv), scope.sv);
    const pts = new Map();
    if (scope.sv !== null) {
      all.filter(tr => nk(svOf(tr)) === nk(scope.sv)).forEach(tr => { const v = ptOf(tr); if (!pts.has(nk(v))) pts.set(nk(v), v); });
      if (scope.pt !== null && !pts.has(nk(scope.pt))) pts.set(nk(scope.pt), scope.pt);
    }
    return { svs: [...svs.values()], pts: [...pts.values()] };
  }
  function fillSelect(sel, items, cur, allLabel, emptyLabel) {
    const html = '<option value="*">' + allLabel + '</option>' + items.map(v => '<option value="v:' + esc(v) + '">' + esc(v || emptyLabel) + '</option>').join('');
    if (sel.dataset.sig !== html) { sel.innerHTML = html; sel.dataset.sig = html; }
    const want = cur === null ? '*' : 'v:' + cur;
    if (sel.value !== want) sel.value = want;
  }
  function syncScope() {
    const o = scopeOptions();
    fillSelect(doc.getElementById('pcSv'), o.svs, scope.sv, 'すべてのサブコン', '（サブコン未設定）');
    const ptSel = doc.getElementById('pcPt');
    ptSel.hidden = doc.getElementById('pcPtLbl').hidden = scope.sv === null;
    if (scope.sv !== null) fillSelect(ptSel, o.pts, scope.pt, 'すべてのパターン', '（パターンなし）');
    doc.getElementById('pcScope').classList.toggle('on', scope.sv !== null);
    // 範囲の売合計（通貨ごと）
    const sums = {};
    rowsNow().filter(inScope).forEach(tr => {
      const m = /\d[\d,]*(?:\.\d+)?/.exec((fld(tr, 'st')?.textContent || '').trim());
      if (!m) return;
      const c = (fld(tr, 'bc')?.value || '').trim() || 'JPY';
      sums[c] = (sums[c] || 0) + parseFloat(m[0].replace(/,/g, ''));
    });
    const t = Object.keys(sums).map(c => Math.round(sums[c] * 100) / 100).length ? Object.keys(sums).map(c => sums[c].toLocaleString('ja-JP', { maximumFractionDigits: 2 }) + ' ' + c).join(' + ') : '—';
    doc.getElementById('pcScopeSum').textContent = scope.sv === null ? '' : 'この範囲の売合計 ' + t;
  }

  function sync(force) {
    if (!win || win.closed || !doc) return;
    const rows = rowsNow().filter(inScope), s = JSON.stringify([scope, rows.map(r => r.id)]);
    const list = doc.getElementById('list');
    if (force || s !== sig) {
      sig = s;
      const label = scope.sv === null ? 'まだ明細がありません。下の「＋ 行を追加」から始められます。' : 'この範囲にはまだ明細がありません。下の「＋ 行を追加」で、この範囲に追加できます。';
      list.innerHTML = rows.length ? rows.map(rowHtml).join('') : '<div class="empty">' + label + '</div>';
      copyDatalists();
    }
    list.querySelectorAll('.row').forEach(syncRow);
    syncScope();
    syncHeader();
    const n = doc.getElementById('pcCount'); if (n) n.textContent = rows.length + ' 行' + (scope.sv !== null ? '（全 ' + rowsNow().length + ' 行中）' : '');
  }

  function build() {
    doc.title = '見積（コンパクト）';
    const st = doc.createElement('style'); st.textContent = CSS; doc.head.appendChild(st);
    const vp = doc.createElement('meta'); vp.name = 'viewport'; vp.content = 'width=device-width,initial-scale=1'; doc.head.appendChild(vp);
    doc.body.innerHTML =
      '<div class="top"><div class="hd"><b>🪟 見積（コンパクト）</b><span class="tot"><span><em>行</em><span id="pcCount">—</span></span><span><em>仕</em><span id="pcCost">—</span></span><span><em>売</em><span id="pcSell">—</span></span><span><em>粗利</em><span id="pcProfit">—</span></span></span>'
      + '<button type="button" id="pcBack" title="元の画面を前面に出す">元の画面へ</button><button type="button" id="pcClose">閉じる</button></div>'
      + '<div class="scope" id="pcScope"><label for="pcSv">範囲</label><select id="pcSv"></select><label for="pcPt" id="pcPtLbl" hidden>→</label><select id="pcPt" hidden></select><span class="ssum" id="pcScopeSum"></span></div></div>'
      + '<div class="list" id="list"></div><button type="button" class="add" id="pcAdd" style="width:calc(100% - 16px)">＋ 行を追加</button>';
    const list = doc.getElementById('list');
    doc.getElementById('pcSv').addEventListener('change', e => { const v = e.target.value; scope = { sv: v === '*' ? null : v.slice(2), pt: null }; sync(true); });
    doc.getElementById('pcPt').addEventListener('change', e => { const v = e.target.value; scope = { sv: scope.sv, pt: v === '*' ? null : v.slice(2) }; sync(true); });
    list.addEventListener('input', e => { const el = e.target.closest('[data-bind]'); if (el) send(el, 'input'); });
    list.addEventListener('change', e => { const el = e.target.closest('[data-bind]'); if (el) { send(el, 'change'); setTimeout(() => sync(), 30); } });
    list.addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const row = b.closest('.row'), tr = $(row.dataset.row); if (!tr) return;
      const act = b.dataset.act;
      if (act === 'jump') { try { window.focus(); } catch (x) {} tr.scrollIntoView({ block: 'center', behavior: 'smooth' }); tr.classList.add('mc-flash'); setTimeout(() => tr.classList.remove('mc-flash'), 1600); }
      else if (act === 'add') { const before = new Set(rowsNow().map(r => r.id)); tr.querySelector('.row-add-btn')?.click(); focusNew(before); }
      else if (act === 'del') { tr.querySelector('.row-del-btn')?.click(); setTimeout(() => sync(), 80); }
    });
    doc.getElementById('pcAdd').addEventListener('click', () => {
      const before = new Set(rowsNow().map(r => r.id));
      // 範囲を選んでいるときは、その範囲（サブコン／サブコン→パターン）の末尾へ追加する
      if (scope.sv !== null && typeof window.addRowToSubconGroup === 'function') window.addRowToSubconGroup(scope.sv, scope.pt === null ? undefined : (scope.pt === '' ? window.PT_UNSET_KEY : scope.pt));
      else if (window.addRow) window.addRow();
      focusNew(before);
    });
    doc.getElementById('pcClose').addEventListener('click', () => { try { win.close(); } catch (e) {} });
    doc.getElementById('pcBack').addEventListener('click', () => { try { window.focus(); } catch (e) {} });
    doc.addEventListener('keydown', e => { if (e.key === 'Escape' && !(e.target && /^(INPUT|SELECT)$/.test(e.target.tagName))) { try { win.close(); } catch (x) {} } });
  }

  function focusNew(before) {
    setTimeout(() => {
      sync();
      const nu = rowsNow().find(r => !before.has(r.id));
      if (nu) { const inp = doc.querySelector('.row[data-row="' + nu.id + '"] [data-bind="nm"]'); if (inp) { inp.focus(); inp.scrollIntoView({ block: 'nearest' }); } }
    }, 100);
  }

  function refreshButtons() {
    const on = !!(win && !win.closed);
    document.querySelectorAll('[data-pip-btn]').forEach(b => {
      b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
      const t = b.querySelector('[data-pip-label]'); if (t) t.textContent = on ? '常に前面（表示中）' : '常に前面';
    });
  }

  function cleanup() {
    if (timer) { clearInterval(timer); timer = null; }
    if (obs) { obs.disconnect(); obs = null; }
    if (listen) { const tb = $('tableBody'); if (tb) { tb.removeEventListener('input', listen); tb.removeEventListener('change', listen); } listen = null; }
    win = null; doc = null; sig = '';
    refreshButtons();
  }

  async function open() {
    if (!supported()) {
      toast('この機能は Chrome／Edge（バージョン116以降）で使えます。Safari・Firefox では未対応です。');
      return;
    }
    let size = { width: 560, height: 640 };
    try { const s = JSON.parse(localStorage.getItem(SIZE_KEY) || 'null'); if (s && s.width >= 320 && s.height >= 240) size = s; } catch (e) {}
    try {
      win = await window.documentPictureInPicture.requestWindow({ width: size.width, height: size.height });
    } catch (e) {
      win = null; toast('小窓を開けませんでした：' + (e && e.message ? e.message : e)); return;
    }
    doc = win.document;
    build();
    sync(true);
    const tb = $('tableBody');
    listen = () => sync();
    if (tb) {
      tb.addEventListener('input', listen); tb.addEventListener('change', listen);
      obs = new MutationObserver(() => { clearTimeout(open._t); open._t = setTimeout(() => sync(), 120); });
      obs.observe(tb, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'data-pending', 'data-done', 'data-hide-quote', 'data-out-range'] });
    }
    // 合計・為替など、表の外で変わる値も拾う（小窓が見えている間だけ・軽い）
    timer = setInterval(() => sync(), 1500);
    win.addEventListener('pagehide', () => {
      try { localStorage.setItem(SIZE_KEY, JSON.stringify({ width: win.innerWidth, height: win.innerHeight })); } catch (e) {}
      cleanup();
    });
    refreshButtons();
  }

  function toggle() {
    if (win && !win.closed) { try { win.close(); } catch (e) {} return; }
    open();
  }

  window.quotePipToggle = toggle;
  window.quotePipSupported = supported;
  window.quotePipSync = () => sync(true);
  document.addEventListener('DOMContentLoaded', refreshButtons);
})();
