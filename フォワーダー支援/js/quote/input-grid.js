/* ==========================================================================
   見積入力（新画面）の入力欄の並び（Design 40 F1・2026-11）
   CSS（css/input-grid.css）で並べ替えられない分だけをここで行う。新画面のときだけ動き、
   旧画面へ戻すと元に戻す（要素の移動は戻し、readOnly を外す）。id・onclick・保存データは変えない。
   - 見積もり番号：値があるときは表示だけ（自動）にし、［変更］で欄を開く
   - ② 貿易条件：上の帯の「貿易条件・方向・モード」を押すと選び直せる（下の要約は CSS で隠す）
   - ③ 「クリア」は貨物情報の見出しの右へ（名前は「貨物・ルートの入力をクリア」）
   - ③ 輸送モードが LCL・航空のときは、荷姿を先に出す（#section-volume.ig-pack-first）
   - ① ［📝 社内メモ］は案件名の見出しの右へ
   ========================================================================== */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const on = () => document.documentElement.classList.contains('editor-v2');
  let refEditing = false;
  const homes = {};   // 移した要素の元の場所 { key: {el, p, n} }

  function moveTo(key, el, parent, before) {
    if (!el || !parent) return;
    if (!homes[key]) homes[key] = { el, p: el.parentNode, n: el.nextSibling };
    if (el.parentNode !== parent || (before && el.nextSibling !== before)) parent.insertBefore(el, before || null);
  }
  function restore(key) {
    const h = homes[key]; if (!h) return;
    h.p.insertBefore(h.el, h.n && h.n.parentNode === h.p ? h.n : null);
    delete homes[key];
  }

  // --- 見積もり番号：表示だけ＋［変更］ ---
  function ensureRefEdit() {
    const row = document.querySelector('#section-ref .qf-ref-row'), inp = $('qf-ref');
    if (!row || !inp) return null;
    let b = $('ciRefEdit');
    if (!b) {
      b = document.createElement('button'); b.type = 'button'; b.id = 'ciRefEdit'; b.textContent = '変更';
      b.title = '見積もり番号を直す';
      b.addEventListener('click', () => { refEditing = true; syncRef(); inp.focus(); inp.select && inp.select(); });
      row.appendChild(b);
      inp.addEventListener('blur', () => { refEditing = false; setTimeout(syncRef, 0); });
      inp.addEventListener('focus', () => { if (!inp.readOnly) refEditing = true; });
    }
    return { row, inp };
  }
  function syncRef() {
    const r = ensureRefEdit(); if (!r) return;
    const lock = on() && !refEditing && !!r.inp.value.trim() && document.activeElement !== r.inp;
    r.row.classList.toggle('ci-ref-locked', lock);
    if (lock) { r.inp.readOnly = true; r.inp.dataset.igLock = '1'; }
    else if (r.inp.dataset.igLock) { r.inp.readOnly = false; delete r.inp.dataset.igLock; }
  }

  // --- ② 帯の項目から選び直す ---
  const CF = { '貿易条件': 'inco', '方向': 'dir', 'モード': 'mode' };
  function markChips() {
    const band = $('e2Chips2'); if (!band) return;
    band.querySelectorAll(':scope > span').forEach(s => {
      const k = CF[(s.querySelector('i') || {}).textContent || ''];
      const has = k && document.querySelector('#cfCrumbs .cf-crumb[data-cf="' + k + '"]');
      if (has) { s.dataset.cf = k; s.title = '押すと選び直せます'; } else if (s.dataset.cf) { delete s.dataset.cf; s.removeAttribute('title'); }
    });
  }
  document.addEventListener('click', e => {
    const s = e.target.closest && e.target.closest('#e2Chips2 > span[data-cf]'); if (!s || !on()) return;
    const c = document.querySelector('#cfCrumbs .cf-crumb[data-cf="' + s.dataset.cf + '"]'); if (c) c.click();
  });

  // --- ③ クリア・荷姿を先に ---
  function syncCargo() {
    const body = $('cargoBody'), act = body && body.querySelector('.cond-actions');
    const btn = act && act.querySelector('.btn-cond-clear');
    if (on() && act) {
      act.classList.add('ig-clear-row');
      moveTo('clear', act, body, body.firstElementChild);
      if (btn && !btn.dataset.igText) { btn.dataset.igText = btn.textContent; btn.textContent = '貨物・ルートの入力をクリア'; btn.title = '貨物情報と引き合い条件（ルート）の入力を消します'; }
    } else if (act) {
      act.classList.remove('ig-clear-row'); restore('clear');
      if (btn && btn.dataset.igText) { btn.textContent = btn.dataset.igText; delete btn.dataset.igText; btn.removeAttribute('title'); }
    }
    const vol = $('section-volume'), m = ($('cond-mode') || {}).value || '';
    if (vol) vol.classList.toggle('ig-pack-first', on() && /LCL|航空|AIR/i.test(m));
  }

  // --- ① 社内メモのボタンを案件名の見出しの右へ ---
  function syncMemo() {
    const btn = $('ciMemoBtn'), lab = document.querySelector('#section-ref .ci-cell-case .quote-field > label');
    if (on() && btn && lab) { moveTo('memo', btn, lab, null); btn.classList.add('ig-in-label'); }
    else if (btn) { btn.classList.remove('ig-in-label'); restore('memo'); }
  }

  function sync() { syncRef(); markChips(); syncCargo(); syncMemo(); }
  let t = 0;
  const kick = () => { clearTimeout(t); t = setTimeout(sync, 60); };
  function init() {
    sync();
    new MutationObserver(kick).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    const band = () => $('e2Chips2');
    const tab = $('tab-quote-make');
    if (tab) new MutationObserver(ms => { if (ms.some(m => m.target === band() || (m.target.closest && m.target.closest('#e2Chips2, #cfCrumbs')))) kick(); })
      .observe(tab, { childList: true, subtree: true });
    document.addEventListener('change', e => { if (e.target && (e.target.id === 'cond-mode' || e.target.id === 'qf-ref')) kick(); }, true);
    setInterval(() => { if (on()) { syncRef(); syncCargo(); } }, 1500);   // 案件を開く・新規にする（値を直接入れる）ときの追従
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.igSync = sync;
})();
