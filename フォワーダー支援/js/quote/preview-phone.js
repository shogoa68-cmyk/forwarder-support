/* ==========================================================================
   プレビュー／PDF 出力のスマホ版（Design 41-H・2026-11）
   〜600px：書類（または表）を先に出し、スイッチ・設定は［⚙ 設定］で下から出るシートへ。
   PDF 出力は、御見積書を画面幅に縮めて出し、下は［PDF 出力］［閉じる］だけ。
   既存の DOM・id・onclick は変えない（ボタンを 1 つ足し、クラスで出し分けるだけ）。
   ========================================================================== */
(function () {
  'use strict';
  const mq = window.matchMedia('(max-width: 600px)');
  const A4_W = 794;

  function ensurePreviewBtn() {
    const head = document.querySelector('#previewBox .pv-main-head');
    if (!head || document.getElementById('pvSetBtn')) return;
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'pvSetBtn'; b.className = 'pv-set-btn';
    b.textContent = '⚙ 設定';
    b.title = '表示する列・セクションを選ぶ';
    b.addEventListener('click', () => {
      const box = document.getElementById('previewBox');
      box && box.classList.toggle('pv-rail-open');
    });
    head.insertBefore(b, head.querySelector('.pv-btns'));
  }

  // Design 42-2：スマホの上部は 1 行（題・⚙ 設定・⋯・PDF 出力・✕ 閉じる）。
  // メール本文・Excel は［⋯］の中、印刷（横／縦）はスマホでは出さない。
  function ensurePhoneHead() {
    const head = document.querySelector('#previewBox .pv-main-head');
    if (!head || document.getElementById('pvMoreBtn')) return;
    const t = document.createElement('span');
    t.className = 'pv-ph-title'; t.textContent = '📋 プレビュー';
    head.insertBefore(t, head.firstChild);
    const more = document.createElement('button');
    more.type = 'button'; more.id = 'pvMoreBtn'; more.className = 'pv-more-btn';
    more.textContent = '⋯'; more.title = 'メール本文・Excel'; more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false');
    const menu = document.createElement('div');
    menu.id = 'pvMoreMenu'; menu.className = 'pv-more-menu'; menu.setAttribute('role', 'menu'); menu.hidden = true;
    [['.pv-btn-email-plain', '✉ メール本文'], ['.pv-btn-excel', '📊 Excel']].forEach(([sel, label]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'menuitem'); b.textContent = label;
      b.addEventListener('click', () => { closeMore(); const o = head.querySelector(sel); o && o.click(); });
      menu.appendChild(b);
    });
    more.addEventListener('click', e => { e.stopPropagation(); menu.hidden ? openMore() : closeMore(); });
    const set = document.getElementById('pvSetBtn');
    head.insertBefore(more, set ? set.nextSibling : head.querySelector('.pv-btns'));
    head.appendChild(menu);
    document.addEventListener('click', e => { if (!menu.hidden && !menu.contains(e.target) && e.target !== more) closeMore(); });
    // Esc は［⋯］だけ閉じる（プレビュー自体は閉じない）
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) { e.preventDefault(); e.stopImmediatePropagation(); closeMore(); more.focus(); } }, true);
    const cl = head.querySelector('.pv-btn-close');
    if (cl) { cl.title = cl.title || '閉じる'; cl.setAttribute('aria-label', '閉じる'); }
    const sum = document.createElement('div');
    sum.id = 'pvPhSum'; sum.className = 'pv-ph-sum';
    head.parentNode.insertBefore(sum, head.nextSibling);
  }
  function openMore() { const m = document.getElementById('pvMoreMenu'), b = document.getElementById('pvMoreBtn'); if (m) m.hidden = false; if (b) b.setAttribute('aria-expanded', 'true'); }
  function closeMore() { const m = document.getElementById('pvMoreMenu'), b = document.getElementById('pvMoreBtn'); if (m) m.hidden = true; if (b) b.setAttribute('aria-expanded', 'false'); }
  // 見積番号・お客様・有効期限を 1 行の要約に
  function fillSum() {
    const sum = document.getElementById('pvPhSum');
    if (!sum) return;
    const v = id => { const e = document.getElementById(id); return e ? String(e.value || '').trim() : ''; };
    const valid = v('qf-valid-until') || v('pvDocValid');
    // Design 42r-1：題名は要約の行の頭（「プレビュー · 番号 · お客様 · 有効 11/30」・題名だけ太字）
    const vd = valid ? valid.replace(/^\d{4}-0?(\d+)-0?(\d+)$/, '$1/$2') : '';
    const parts = [v('qf-ref'), v('qf-customer'), vd ? '有効 ' + vd : ''].filter(Boolean);
    sum.innerHTML = '';
    const b = document.createElement('b'); b.textContent = 'プレビュー'; sum.appendChild(b);
    if (parts.length) sum.appendChild(document.createTextNode(' · ' + parts.join(' · ')));
    sum.hidden = false;
  }
  // 発行日・有効期限の欄は、スマホでは［⚙ 設定］のシートの中へ（PC では元の場所）
  function placeDates() {
    const de = document.getElementById('pvDateEdit');
    const rail = document.querySelector('#previewBox .pv-rail');
    if (!de || !rail) return;
    if (!de.__home) { de.__home = de.parentNode; de.__next = de.nextSibling; }
    if (mq.matches) { if (de.parentNode !== rail) rail.appendChild(de); }
    else if (de.parentNode !== de.__home) de.__home.insertBefore(de, de.__next);
  }

  function ensureDocBtn() {
    const foot = document.querySelector('#quoteDocOverlay .qd-panel-foot');
    if (!foot || document.getElementById('qdSetBtn')) return;
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'qdSetBtn'; b.className = 'qd-btn-ghost qd-set-btn';
    b.textContent = '⚙ 設定';
    b.title = 'ファイル名・英語で出力・発行元などの設定';
    b.addEventListener('click', () => {
      const p = document.querySelector('#quoteDocOverlay .qd-panel');
      p && p.classList.toggle('qd-panel-open');
    });
    foot.insertBefore(b, foot.firstChild);
  }

  // 御見積書（A4 幅 794px）をスマホの画面幅に縮める。PC では元の大きさ
  function fitDoc() {
    const o = document.getElementById('quoteDocOverlay');
    const pv = document.getElementById('qdPreview');
    if (!o || !pv) return;
    if (!mq.matches || !o.classList.contains('open')) { pv.style.zoom = ''; return; }
    const stage = o.querySelector('.qd-stage');
    const w = (stage ? stage.clientWidth : window.innerWidth) - 24;
    pv.style.zoom = String(Math.max(0.3, Math.min(1, w / A4_W)));
  }

  function sync() {
    ensurePreviewBtn(); ensurePhoneHead(); ensureDocBtn(); fitDoc(); placeDates(); fillSum();
    if (!mq.matches) closeMore();
    if (!mq.matches) {
      const box = document.getElementById('previewBox'); box && box.classList.remove('pv-rail-open');
      const p = document.querySelector('#quoteDocOverlay .qd-panel'); p && p.classList.remove('qd-panel-open');
    }
  }

  // 開いたとき（open クラスの付け外し）に追従する
  const obs = new MutationObserver(() => sync());
  function watch() {
    ['previewOverlay', 'quoteDocOverlay'].forEach(id => {
      const el = document.getElementById(id);
      if (el && !el.__pvPhoneWatch) { el.__pvPhoneWatch = 1; obs.observe(el, { attributes: true, attributeFilter: ['class'] }); }
    });
  }
  new MutationObserver(() => { watch(); sync(); }).observe(document.body, { childList: true });
  if (mq.addEventListener) mq.addEventListener('change', sync); else mq.addListener(sync);
  window.addEventListener('resize', fitDoc);
  window.addEventListener('beforeprint', () => { const pv = document.getElementById('qdPreview'); if (pv) pv.style.zoom = ''; });
  window.addEventListener('afterprint', fitDoc);
  document.addEventListener('DOMContentLoaded', () => { watch(); sync(); });
  if (document.readyState !== 'loading') { watch(); sync(); }
  window.pvPhoneSync = sync;
})();
