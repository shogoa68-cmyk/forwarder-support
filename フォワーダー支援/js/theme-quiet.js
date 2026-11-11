/* Quiet テーマの「置き場所だけ変える」処理（html.theme-quiet のときだけ。外すと元の場所へ戻す）。
   ①ヘッダーのボタン群（改修予定・不具合報告・アイデア・デザイン）を「ヘルプ・フィードバック ▾」にまとめる
   ②見出しの先頭のカラー絵文字を包んで隠す（文字は残る・Quiet 以外では見える）
   ボタンの id／onclick／機能は変えない（要素ごと移すだけ）。 */
(function () {
  'use strict';
  var h = document.documentElement;
  var HDR_IDS = null, panel = null, wrap = null, btn = null, order = [];

  function hdrLinks() { return [].slice.call(document.querySelectorAll('.header > a.hdr-roadmap, #hdrHelpPanel > a.hdr-roadmap')); }

  function buildHelp() {
    if (wrap) return;
    var header = document.querySelector('.header'); if (!header) return;
    var anchor = header.querySelector('.header-auth');
    order = [].slice.call(header.querySelectorAll(':scope > a.hdr-roadmap'));
    if (!order.length) return;
    wrap = document.createElement('div'); wrap.className = 'hdr-help'; wrap.id = 'hdrHelp';
    btn = document.createElement('button'); btn.type = 'button'; btn.className = 'hdr-help-btn'; btn.id = 'hdrHelpBtn';
    btn.setAttribute('aria-haspopup', 'true'); btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = 'ヘルプ・フィードバック <span aria-hidden="true">▾</span>';
    panel = document.createElement('div'); panel.className = 'hdr-help-panel'; panel.id = 'hdrHelpPanel'; panel.hidden = true;
    wrap.appendChild(btn); wrap.appendChild(panel);
    header.insertBefore(wrap, anchor || null);
    btn.addEventListener('click', function (e) { e.stopPropagation(); toggle(); });
    document.addEventListener('click', function (e) { if (panel && !panel.hidden && !wrap.contains(e.target)) toggle(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && panel && !panel.hidden) { toggle(false); btn.focus(); } });
    panel.addEventListener('click', function () { toggle(false); });
  }
  function toggle(open) {
    if (!panel) return;
    var on = open === undefined ? panel.hidden : !!open;
    panel.hidden = !on; btn.setAttribute('aria-expanded', on ? 'true' : 'false');
  }
  function toQuiet() {
    buildHelp(); if (!wrap) return;
    order.forEach(function (a) { panel.appendChild(a); });
    wrap.hidden = false;
  }
  function fromQuiet() {
    if (!wrap) return;
    var header = document.querySelector('.header'), anchor = wrap;
    order.forEach(function (a) { header.insertBefore(a, anchor); });
    toggle(false); wrap.hidden = true;
  }

  var EMOJI = /^(\s*(?:[☀-➿]|[\uD83C-\uD83E][\uDC00-\uDFFF]|⭐|⬆|️|‍)+\s*)/;
  function stripHeadingEmoji() {
    [].forEach.call(document.querySelectorAll('h1, h2, h3, .section-toggle-title, .md-modal-title, .master-admin-title'), function (el) {
      if (el.closest('.header') && el.tagName === 'H1') return; // サイト名は残す
      var n = el.firstChild;
      while (n && n.nodeType === 3 && !n.nodeValue.trim()) n = n.nextSibling;
      if (!n || n.nodeType !== 3) return;
      var m = EMOJI.exec(n.nodeValue); if (!m) return;
      var span = document.createElement('span'); span.className = 'q-emoji'; span.textContent = m[1];
      n.nodeValue = n.nodeValue.slice(m[1].length);
      el.insertBefore(span, n);
    });
  }

  function sync() {
    if (h.classList.contains('theme-quiet')) { toQuiet(); stripHeadingEmoji(); } else fromQuiet();
  }
  function init() {
    sync();
    new MutationObserver(sync).observe(h, { attributes: true, attributeFilter: ['class'] });
    // 見出しは後から描かれる画面もあるので、Quiet 中は少し遅れて 1 回かけ直す（タブ切替など）
    document.addEventListener('click', function () { if (h.classList.contains('theme-quiet')) setTimeout(stripHeadingEmoji, 300); }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
