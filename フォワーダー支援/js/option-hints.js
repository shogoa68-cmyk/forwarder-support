// 行の［その他 ▾］の中の設定ボタン（あえて¥0／実費／PS／必要時／…／MIN／幅）の説明を、ボタン列の下の 1 行バーに出す（Design 36 案P）。
// 押した・乗せた・フォーカスした（Tab）ボタンを「いま触れているボタン」として青い枠で示し、そのボタンの title（＝説明の本文・直す場所は 1 か所）を
// 設定名＋説明としてバー（.mode-hint）に入れる。ON/OFF の onclick は変えない（読むだけ）。バーの高さは変えない（2 行を超える説明は「…」）。
(function () {
  'use strict';
  const SEL = '.row-mode-btns > button';
  let cur = null;
  function bar(btn) { const g = btn.closest('.row-mode-btns'); return g && g.querySelector(':scope > .mode-hint'); }
  function show(btn) {
    const b = bar(btn); if (!b) return;
    if (cur && cur !== btn) cur.classList.remove('is-touch');
    cur = btn; btn.classList.add('is-touch');
    const name = (btn.textContent || '').trim(), desc = (btn.getAttribute('title') || '').trim();
    b.classList.add('has-hint');
    b.innerHTML = '';
    const n = document.createElement('div'); n.className = 'mh-name'; n.textContent = name;
    const d = document.createElement('div'); d.className = 'mh-desc'; d.textContent = desc || '（この設定の説明はまだありません）';
    b.appendChild(n); b.appendChild(d);
  }
  function target(e) { return e.target && e.target.closest ? e.target.closest(SEL) : null; }
  document.addEventListener('pointerover', e => { const b = target(e); if (b) show(b); });
  document.addEventListener('focusin', e => { const b = target(e); if (b) show(b); });
  document.addEventListener('click', e => { const b = target(e); if (b) show(b); });   // タッチは押した時
  // パネルを閉じる／別の行へ移ったら、触れている印を外す
  document.addEventListener('pointerdown', e => { if (cur && !(e.target.closest && e.target.closest('.row-mode-btns'))) { cur.classList.remove('is-touch'); cur = null; } });
})();
