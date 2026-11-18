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
    ensurePreviewBtn(); ensureDocBtn(); fitDoc();
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
