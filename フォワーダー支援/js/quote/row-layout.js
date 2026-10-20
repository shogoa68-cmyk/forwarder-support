/* row-layout.js — 見積テーブル「行レイアウト」の補助（Industry テーマの 3 段固定行・「その他 ▾」パネル・状態チップ）
 *
 * 役割
 *  1. 状態チップ（.st-state）と「その他 ▾」パネルの状態一覧（.rd-state）・金額の内訳（.rd-breakdown）・使用中バッジを描く
 *  2. tr[data-ccy-diff="1"]（仕入通貨≠売値通貨）と .cd-flag を更新する
 *  3. Industry のときだけ、有効期間（.w-valid）・フラグ群（.row-mode-btns）・% 入力（.pct-group）・ミニマム（.min-group）・CD（.row-cd）を
 *     パネルの中へ「要素ごと」移す（id・onclick・data-* は変えない）。classic に戻すと元の場所へ戻す
 *  4. パネルの開閉（その他 ▾／状態チップのクリック／Esc／外側クリック）
 *
 * 保存・計算は一切変えない（表示の整理のみ）。小計・利益の書き出し（.st-main 等）は row.js の calc()。
 * classic では .row-detail-btn・.row-detail-panel・.st-state・.cd-flag・.pr-rate は CSS で隠れる（css/quote.css）。
 */
(function () {
  'use strict';

  const root = document.documentElement;
  const isInd = () => root.classList.contains('theme-industry');
  const isDataRow = tr => !!tr && tr.tagName === 'TR' && /^row-\d+$/.test(tr.id || '') && !tr.dataset.virtual && !tr.dataset.type;
  const fv = (id, f) => document.getElementById(`${f}-${id}`)?.value || '';

  // ===== 1. 要素の置き場所（Industry のときだけパネルへ） =====
  const MOVES = [['.w-valid', 'valid'], ['.row-mode-btns', 'mode'], ['.pct-group', 'pct'], ['.min-group', 'min'], ['.row-cd', 'cd']];

  // 有効期間（.w-valid）：期間が入っている行・サーチャージの行は、「その他 ▾」を開かなくても見て直せるよう、行の中（品名セルの 3 段目の上）に出す。
  // それ以外の行は、従来どおりパネルの中。classic は常に元の場所（syncPlacement が戻す）
  function validInline(tr, id) {
    return !!(fv(id, 'vf') || fv(id, 'vt') || fv(id, 'cat') === 'surcharge');
  }
  function placeValid(tr, id) {
    if (!isInd() || tr._rdPlaced !== true) return;
    const el = tr.querySelector('.w-valid');
    if (!el) return;
    const inline = validInline(tr, id);
    tr.classList.toggle('has-valid-inline', inline);
    const slot = tr.querySelector('[data-rd-slot="valid"]');
    const inSlot = !!slot && slot.contains(el);
    if (inline === !inSlot) return;   // すでに望みの場所
    const hadFocus = el.contains(document.activeElement) ? document.activeElement : null;   // 入力中に動かしても焦点を保つ
    if (inline) { if (el._rdHome && el._rdHome.parentNode) el._rdHome.parentNode.insertBefore(el, el._rdHome); }
    else if (slot) slot.appendChild(el);
    if (hadFocus) { try { hadFocus.focus(); } catch (e) {} }
  }

  function syncPlacement(tr) {
    const ind = isInd();
    if (tr._rdPlaced === ind) return;
    MOVES.forEach(([sel, slotName]) => {
      const el = tr.querySelector(sel);
      if (!el) return;
      if (ind) {
        const slot = tr.querySelector(`[data-rd-slot="${slotName}"]`);
        if (!slot) return;
        if (!el._rdHome && el.parentNode) {
          el._rdHome = document.createComment('rd-home');
          el.parentNode.insertBefore(el._rdHome, el);
        }
        slot.appendChild(el);
      } else if (el._rdHome && el._rdHome.parentNode) {
        el._rdHome.parentNode.insertBefore(el, el._rdHome);
      }
    });
    // Tab の順を見た目（サブコン → パターン → カテゴリ）に合わせる：Industry のときだけカテゴリを最後へ。classic は元（先頭）に戻す
    const stk = tr.querySelector('td.catsv-cell .stk'), cat = stk && stk.querySelector(':scope > .w-cat');
    if (cat) { if (ind) stk.appendChild(cat); else stk.insertBefore(cat, stk.firstChild); }
    tr._rdPlaced = ind;
    if (ind) { const rid = (tr.id || '').replace('row-', ''); if (rid) placeValid(tr, rid); }
    else { tr.classList.remove('has-valid-inline'); closePanel(tr); }
  }

  // ===== 2. 状態チップ・内訳・バッジ =====
  // 優先順：出力しない → 要調査 → あえて¥0 → 必要時 → 実費 → PS → 参考 → 概算 → % 計算 → 入力完了
  const STATES = [
    { label: '出力しない', cls: 'is-solid', tip: '見積書（客先表示・PDF・Excel・CSV）に出さない行', on: tr => tr.classList.contains('row-hidden-quote') },
    { label: '要調査', cls: 'is-warn', tip: '後で調べて記入する行（要調査）', on: tr => tr.classList.contains('row-pending') },
    { label: 'あえて¥0', cls: '', tip: '0円であることを確認済み', on: (tr, id) => fv(id, 'zc') === '1' },
    { label: '必要時', cls: 'is-warn', tip: '必要時のみ請求（合計に加算しない）', on: (tr, id) => fv(id, 'co') === '1' },
    { label: '実費', cls: '', tip: '実費（金額未確定・合計から除外）', on: (tr, id) => fv(id, 'ac') === '1' },
    { label: 'PS', cls: '', tip: 'PROFIT SHARE（客先非表示・社内利益に計上）', on: (tr, id) => fv(id, 'ps') === '1' },
    { label: '参考', cls: '', tip: '参考情報（合計に加算しない）', on: (tr, id) => fv(id, 'ri') === '1' },
    { label: '概算', cls: '', tip: '概算（金額は目安）', on: (tr, id) => fv(id, 'es') === '1' },
    { label: 'MIN 適用', cls: 'is-warn', tip: '最低料金（ミニマム）が「数量 × 単価」を上回るため、最低料金で計算している行', on: tr => tr.dataset.minApplied === '1' },
    { label: '% 計算', cls: '', tip: '仕入単価を「基準額 × %」で計算する行。率と基準額は「その他 ▾」で入力', on: tr => tr.classList.contains('row-pct-mode') },
    { label: '入力完了', cls: 'is-done', tip: '入力完了の目印', on: tr => tr.classList.contains('row-input-done') },
  ];

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const chipHtml = s => `<span class="state-chip ${s.cls}" title="${esc(s.tip)}">${esc(s.label)}</span>`;

  function breakdownHtml(tr, st) {
    const rows = [];
    const jpy = st?.querySelector('.jpy-conv-hint')?.textContent.trim().replace(/^\(|\)$/g, '');
    const tax = st?.querySelector('.tax-hint')?.textContent.trim().replace(/^（消費税：/, '').replace(/）$/, '');
    const hint = tr.querySelector('.bp-base-hint');
    const base = hint && !hint.hidden ? hint.textContent.trim().replace(/^原価換算\s*/, '') : '';
    if (jpy) rows.push(['円換算の目安', jpy]);
    if (tax) rows.push(['消費税の目安', tax]);
    if (base) rows.push(['原価換算（売通貨）', base]);
    if (!rows.length) return '<dt>—</dt><dd></dd>';
    return rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  }

  function refresh(tr) {
    if (!isDataRow(tr)) return;
    const id = tr.id.replace('row-', '');
    // 仕入通貨≠売値通貨 → CD の出し分け（.cd-flag と、パネル内の .row-cd）
    const pc = fv(id, 'pc'), bc = fv(id, 'bc');
    placeValid(tr, id);
    const diff = !!pc && !!bc && pc !== bc;
    if (diff) { if (tr.dataset.ccyDiff !== '1') tr.dataset.ccyDiff = '1'; } else if (tr.dataset.ccyDiff) delete tr.dataset.ccyDiff;
    const cdv = fv(id, 'cd').trim();
    const flag = tr.querySelector('.cd-flag');
    if (flag) { const t = cdv ? 'CD ' + cdv : 'CD'; if (flag.textContent !== t) flag.textContent = t; }

    // 状態チップ（小計セルの 3 段目＝1 つ＋「＋n」／パネルには全件）
    const on = STATES.filter(s => s.on(tr, id));
    const st = tr.querySelector('td.subtotal-cell');
    let box = st && st.querySelector('.st-state');
    if (st && !box) { box = document.createElement('div'); box.className = 'st-state'; st.appendChild(box); }
    const inline = on.length ? chipHtml(on[0]) + (on.length > 1 ? `<span class="state-more" title="${esc(on.slice(1).map(s => s.label).join('・'))}">＋${on.length - 1}</span>` : '') : '';
    if (box && box._rdHtml !== inline) { box.innerHTML = inline; box._rdHtml = inline; }
    const all = tr.querySelector('.rd-state');
    const allHtml = on.length ? on.map(chipHtml).join('') : '<span class="state-more">なし</span>';
    if (all && all._rdHtml !== allHtml) { all.innerHTML = allHtml; all._rdHtml = allHtml; }

    // 金額の内訳
    const bd = tr.querySelector('.rd-breakdown');
    if (bd) { const h = breakdownHtml(tr, st); if (bd._rdHtml !== h) { bd.innerHTML = h; bd._rdHtml = h; } }

    // 使用中バッジ（パネルの中で値が入っている項目の数）
    let n = 0;
    if ((fv(id, 'vf') || fv(id, 'vt')) && !(isInd() && validInline(tr, id))) n++;   // 有効期間を行の中に出しているときは、パネルの中身ではないので数えない
    ['zc', 'ac', 'ps', 'co', 'ri', 'es'].forEach(f => { if (fv(id, f) === '1') n++; });
    if (fv(id, 'ppmode')) n++;
    if ((parseFloat(fv(id, 'ppmin')) || 0) > 0 || (parseFloat(fv(id, 'bpmin')) || 0) > 0) n++;
    if (diff && cdv) n++;
    const badge = tr.querySelector('.row-detail-btn .used-badge');
    if (badge) {
      const t = n ? String(n) : '';
      if (badge.textContent !== t) badge.textContent = t;
      badge.dataset.n = String(n);
    }
  }
  window._rowStateRefresh = refresh;

  // ===== 3. パネルの開閉 =====
  function openPanel(tr) {
    if (!isInd() || !isDataRow(tr)) return;
    document.querySelectorAll('#tableBody tr.is-detail-open').forEach(x => { if (x !== tr) closePanel(x); });
    refresh(tr);
    tr.classList.remove('is-flip');
    tr.classList.add('is-detail-open');
    tr.querySelector('.row-detail-btn')?.setAttribute('aria-expanded', 'true');
    // 下に収まらず、上には収まるときだけ上向き（表のスクロール領域の端で切れないように）
    const panel = tr.querySelector('.row-detail-panel');
    const wrap = document.getElementById('tableScrollWrap');
    if (panel && wrap) {
      const r = tr.getBoundingClientRect(), w = wrap.getBoundingClientRect(), h = panel.offsetHeight;
      const below = w.bottom - r.bottom, above = r.top - w.top;
      if (below < h && above >= h) tr.classList.add('is-flip');
    }
  }
  function closePanel(tr) {
    if (!tr) return;
    tr.classList.remove('is-detail-open', 'is-flip');
    tr.querySelector('.row-detail-btn')?.setAttribute('aria-expanded', 'false');
  }
  function closeAll(except) {
    document.querySelectorAll('#tableBody tr.is-detail-open').forEach(x => { if (x !== except) closePanel(x); });
  }
  window.rowDetailToggle = function (tr, force) {
    const open = force === undefined ? !tr.classList.contains('is-detail-open') : !!force;
    if (open) openPanel(tr); else closePanel(tr);
  };

  function init() {
    const tb = document.getElementById('tableBody');
    if (!tb || tb._rdInit) return;
    tb._rdInit = true;

    tb.addEventListener('click', e => {
      const btn = e.target.closest && e.target.closest('.row-detail-btn');
      const chip = !btn && e.target.closest && e.target.closest('td.subtotal-cell .st-state');
      if (!btn && !chip) return;
      const tr = e.target.closest('tr');
      if (!isDataRow(tr)) return;
      if (btn) window.rowDetailToggle(tr); else if (chip.children.length) window.rowDetailToggle(tr, true);
    });
    // 値が変わったら、バッジ・内訳を更新（有効期間の入力など。% や % フラグは calc() 経由でも呼ばれる）
    ['input', 'change'].forEach(ev => tb.addEventListener(ev, e => { const tr = e.target.closest && e.target.closest('tr'); if (isDataRow(tr)) refresh(tr); }));

    // 行の追加・並べ替え：新しい行を整える
    new MutationObserver(muts => {
      muts.forEach(m => m.addedNodes.forEach(n => { if (isDataRow(n)) { syncPlacement(n); refresh(n); } }));
    }).observe(tb, { childList: true });
    // 状態（要調査・入力完了・出力しない＝tr の class）が変わったらチップを更新
    new MutationObserver(muts => {
      const seen = new Set();
      muts.forEach(m => {
        const tr = m.target.closest && m.target.closest('tr');
        if (!tr || seen.has(tr) || !isDataRow(tr)) return;
        seen.add(tr); refresh(tr);
      });
    }).observe(tb, { attributes: true, attributeFilter: ['class'], subtree: true });

    // Esc・外側クリックで閉じる
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      const open = document.querySelector('#tableBody tr.is-detail-open');
      if (!open) return;
      const btn = open.querySelector('.row-detail-btn');
      closeAll();
      if (document.activeElement && open.contains(document.activeElement)) btn?.focus();
    });
    document.addEventListener('pointerdown', e => {
      const open = document.querySelector('#tableBody tr.is-detail-open');
      if (!open || open.contains(e.target)) return;
      closeAll();
    });

    // テーマが切り替わったら、既存の全行を整え直す
    new MutationObserver(() => {
      tb.querySelectorAll('tr').forEach(tr => { if (isDataRow(tr)) { syncPlacement(tr); refresh(tr); } });
    }).observe(root, { attributes: true, attributeFilter: ['class'] });

    tb.querySelectorAll('tr').forEach(tr => { if (isDataRow(tr)) { syncPlacement(tr); refresh(tr); } });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
