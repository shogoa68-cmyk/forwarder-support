// 見積入力の 2 カラム配置（広い画面）：本体の幅が十分あるとき、条件のセクションを 2 列に並べる。
//   左＝① 条件（管理番号入力・貿易条件／幹線輸送）、右＝② 貨物（貨物情報・物量情報・作業範囲・全体リマーク）。見積もりテーブルは全幅のまま下。
// セクションの要素そのものを移すだけ（id・中身・並び順の取り決めは変えない）。狭くなったら元の縦並びに戻す。
(function () {
  'use strict';
  const LEFT = ['section-ref', 'section-cond'], RIGHT = ['section-cargo', 'section-volume', 'section-scope', 'section-remark'];
  const ALL = LEFT.concat(RIGHT);
  const ENTER = 1120, LEAVE = 1060;   // quote-main の幅（px）。出入りで揺れないよう少しずらす
  let wrap = null, on = false, main = null;
  const $ = id => document.getElementById(id);

  function build() {
    if (wrap) return;
    wrap = document.createElement('div'); wrap.id = 'qmCols'; wrap.className = 'qm-cols';
    wrap.innerHTML = '<div class="qm-col qm-col-l" id="qmColL"></div><div class="qm-col qm-col-r" id="qmColR"></div>';
  }
  function two() {
    const first = $('section-ref'); if (!first || on) return; build();
    first.before(wrap);
    LEFT.forEach(id => { const e = $(id); e && $('qmColL').appendChild(e); });
    RIGHT.forEach(id => { const e = $(id); e && $('qmColR').appendChild(e); });
    on = true; document.body.classList.add('qm-2col');
  }
  function one() {
    if (!on) return;
    const anchor = wrap; ALL.forEach(id => { const e = $(id); e && anchor.before(e); });   // 元の並び（上から順）で wrap の前へ
    wrap.remove(); on = false; document.body.classList.remove('qm-2col');
  }
  function check() {
    if (!main) return;
    const w = main.getBoundingClientRect().width; if (!w) return;   // 非表示（他のタブ）のときは何もしない
    if (!on && w >= ENTER) two(); else if (on && w < LEAVE) one();
  }
  function init() {
    main = document.querySelector('#tab-quote-make .quote-main'); if (!main || main.dataset.lcInit) return; main.dataset.lcInit = '1';
    if (window.ResizeObserver) new ResizeObserver(check).observe(main); window.addEventListener('resize', check);
    check();
  }
  window.lcCheck = check;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.addEventListener('load', init);
})();
