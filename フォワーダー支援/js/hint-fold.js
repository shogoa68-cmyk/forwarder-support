/* 欄ごとの説明書き（小さな補足文）を「？」アイコンにしまい、マウスを乗せる／タップすると読めるようにする。
   画面をすっきりさせるための表示だけの変更：説明の要素は DOM に残し（文言の更新・保存・出力は従来どおり）、見た目だけ隠す。
   ・対象は下の SELECTORS（見積入力の欄ラベルの補足・日付の補足・貨物のサブ見出しの補足など）
   ・「？」にマウスを乗せる（0.25 秒）／押す・タップすると吹き出しを開く。外側のクリック・Esc・スクロールで閉じる
   ・説明が空のとき（動的に出す補足が無いとき）は「？」も出さない */
(function () {
  'use strict';
  // [セレクタ, 「？」の置き場所] inline＝説明の位置にそのまま／field＝欄（.quote-field など）の先頭ラベルの末尾
  var SELECTORS = [
    ['.qf-memo-note', 'inline'],
    ['.cond-sub-note', 'inline'],
    ['.rfx-sub', 'inline'],
    ['.remark-img-hint', 'inline'],
    ['.ci-head > span', 'inline'],
    ['.ci-hint', 'field']
  ];
  var pop = null, openFor = null, timer = null;

  function ensurePop() {
    if (pop) return pop;
    pop = document.createElement('div');
    pop.className = 'hint-pop'; pop.id = 'hintPop'; pop.setAttribute('role', 'tooltip'); pop.hidden = true;
    document.body.appendChild(pop);
    return pop;
  }
  function textOf(note) { return (note.textContent || '').replace(/\s+/g, ' ').trim(); }

  function show(btn) {
    var note = btn._hintNote; var t = note ? textOf(note) : ''; if (!t) return;
    ensurePop(); pop.textContent = t; pop.hidden = false; openFor = btn;
    btn.setAttribute('aria-expanded', 'true'); btn.setAttribute('aria-describedby', 'hintPop');
    var r = btn.getBoundingClientRect(), vw = document.documentElement.clientWidth;
    var w = Math.min(320, vw - 16); pop.style.maxWidth = w + 'px';
    var pw = pop.offsetWidth, ph = pop.offsetHeight;
    var left = Math.max(8, Math.min(r.left + r.width / 2 - pw / 2, vw - pw - 8));
    var top = r.bottom + 6; if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
  }
  function hide() {
    clearTimeout(timer); timer = null;
    if (pop) pop.hidden = true;
    if (openFor) { openFor.setAttribute('aria-expanded', 'false'); openFor.removeAttribute('aria-describedby'); }
    openFor = null;
  }

  function makeBtn(note) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'hint-q'; b.setAttribute('aria-label', '説明を見る'); b.setAttribute('aria-expanded', 'false');
    b.textContent = '?'; b._hintNote = note;
    b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); if (openFor === b) hide(); else { hide(); show(b); } });
    b.addEventListener('mouseenter', function () { clearTimeout(timer); timer = setTimeout(function () { if (openFor !== b) { hide(); show(b); } }, 250); });
    b.addEventListener('mouseleave', function () { clearTimeout(timer); timer = setTimeout(function () { if (openFor === b && !b._pinned) hide(); }, 150); });
    b.addEventListener('focus', function () { /* キーボードで来たときも読めるように */ if (openFor !== b) { hide(); show(b); } });
    b.addEventListener('blur', function () { if (openFor === b) hide(); });
    return b;
  }
  function sync(note, btn) { btn.hidden = !textOf(note); }

  function fold(note, mode) {
    if (note._hintBtn) return;
    var btn = makeBtn(note); note._hintBtn = btn; note.classList.add('hint-folded');
    if (mode === 'field') {
      var host = note.closest('.quote-field, .ci-field, .ci-col') || note.parentElement;
      var label = host && host.querySelector('label, .ci-head b');
      if (label) label.appendChild(btn); else note.parentNode.insertBefore(btn, note);
    } else {
      note.parentNode.insertBefore(btn, note);
    }
    sync(note, btn);
    new MutationObserver(function () { sync(note, btn); }).observe(note, { childList: true, characterData: true, subtree: true });
  }

  function scan(root) {
    SELECTORS.forEach(function (s) {
      [].forEach.call((root || document).querySelectorAll(s[0]), function (n) { fold(n, s[1]); });
    });
  }

  function init() {
    scan(document);
    document.addEventListener('click', function (e) { if (pop && !pop.hidden && !(e.target.closest && e.target.closest('.hint-q'))) hide(); }, true);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    // 後から描かれる欄にも効かせる（少し間をおいてまとめて）
    var t = null;
    new MutationObserver(function () { clearTimeout(t); t = setTimeout(function () { scan(document); }, 200); })
      .observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
