// 危ないリンクを開かない（2026-11・QA）
// 入力された URL（ブックマーク・参考リンク・出典など）は画面のあちこちで <a href> にしているため、
// 「javascript:」「data:」「vbscript:」で始まる URL を入れると、押したときにスクリプトが動いてしまう。
// 1 か所ずつ直す代わりに、ページ全体で「押した／開こうとしたリンク」の行き先を確かめ、
// 危ない書き方なら開かずに止める（ふつうの http/https・mailto・tel・相対パス・# は今までどおり）。
(function () {
  'use strict';
  const BAD = /^\s*(javascript|data|vbscript)\s*:/i;
  function isBad(href) {
    if (href == null) return false;
    // 見た目をごまかす書き方（制御文字・空白・改行を挟む）も外してから確かめる
    const s = String(href).replace(/[\u0000-\u001F\u007F\s]+/g, '');
    return BAD.test(s);
  }
  window.isUnsafeUrl = isBad;
  // 入力欄の値の確認（保存の前に使う）：空・http(s)・mailto・tel・相対は OK
  window.isSafeInputUrl = function (u) { return !u || !isBad(u); };
  function guard(e) {
    const a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    if (!isBad(a.getAttribute('href'))) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    try { if (typeof window.quoteShowToast === 'function') window.quoteShowToast('⚠️ このリンクは安全でない書き方のため開きません（http:// か https:// で始まる URL に直してください）', 'warn', 5000); } catch (er) {}
  }
  // 先に確かめるため捕捉（capture）で登録。中クリック・キーボードの Enter も click／auxclick で来る
  document.addEventListener('click', guard, true);
  document.addEventListener('auxclick', guard, true);
})();
