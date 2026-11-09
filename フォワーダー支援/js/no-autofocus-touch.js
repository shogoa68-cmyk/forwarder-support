/* タッチ端末（スマホ・タブレット）では、ボタンをタップして欄を開く・追加するときに、
   プログラムが自動で入力欄にフォーカスを移さない（＝キーボードが勝手に出ない）。
   「経由地を追加」「提出期限を追加」「資料を追加」などは、欄の展開だけにして、入力したいときに利用者が欄をタップする。
   ・直前（0.8 秒以内）の操作が「入力欄以外のタップ」で、文字入力の欄へ .focus() されたときだけ無視する
   ・利用者が入力欄そのものをタップしたとき（ブラウザ標準のフォーカス）は、この処理を通らないので従来どおり
   ・マウスの PC では何も変えない。個別に残したい欄は data-allow-focus を付ける */
(function () {
  'use strict';
  if (!window.matchMedia || !window.matchMedia('(pointer: coarse)').matches) return;
  var TEXT_TYPES = /^(text|search|email|url|tel|number|password|)$/i;
  var lastTap = 0, lastTarget = null;
  function isTextEntry(el) {
    if (!el || !el.tagName) return false;
    var t = el.tagName;
    if (t === 'TEXTAREA') return true;
    if (t === 'INPUT') return TEXT_TYPES.test(el.getAttribute('type') || '');
    return !!el.isContentEditable;
  }
  function note(e) { lastTap = Date.now(); lastTarget = e.target; }
  document.addEventListener('touchstart', note, true);
  document.addEventListener('pointerdown', function (e) { if (e.pointerType !== 'mouse') note(e); }, true);
  var orig = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function () {
    try {
      if (isTextEntry(this) && !this.hasAttribute('data-allow-focus') &&
          Date.now() - lastTap < 800 && lastTarget && !isTextEntry(lastTarget) &&
          !(lastTarget.closest && lastTarget.closest('label') && lastTarget.closest('label').contains(this))) {
        return; // 欄の展開だけ行い、キーボードは出さない
      }
    } catch (e) {}
    return orig.apply(this, arguments);
  };
})();
