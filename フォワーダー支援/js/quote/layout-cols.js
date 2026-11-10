// 見積入力の 2 カラム配置（広い画面）：本体の幅が十分あるとき、条件のセクションを 2 列 × 2 段に並べる。
//   1 段目＝管理番号入力 ｜ 貿易条件・輸送モード、2 段目＝貨物情報（＋作業範囲）｜ 物量情報。
//   その下に見積もりテーブル（全幅）、さらにその下に全体リマーク・免責事項（1 カラム）。
// セクションの要素そのものを移すだけ（id・中身は変えない）。狭くなったら元の縦並び（…→リマーク→見積もりテーブル）に戻す。
(function () {
  'use strict';
  const CELLS = { qmCellA: ['section-ref'], qmCellB: ['section-cond'], qmCellC: ['section-cargo', 'section-scope'], qmCellD: ['section-volume'] };
  const ALL = ['section-ref', 'section-cond', 'section-cargo', 'section-volume', 'section-scope', 'section-remark'];   // 元の並び（上から順）
  const ENTER = 1120, LEAVE = 1060;   // quote-main の幅（px）。出入りで揺れないよう少しずらす
  let wrap = null, on = false, main = null;
  const $ = id => document.getElementById(id);

  function build() {
    if (wrap) return;
    wrap = document.createElement('div'); wrap.id = 'qmCols'; wrap.className = 'qm-cols';
    wrap.innerHTML = Object.keys(CELLS).map(id => '<div class="qm-col" id="' + id + '"></div>').join('');
  }
  function two() {
    const first = $('section-ref'); if (!first || on) return; build();
    first.before(wrap);
    Object.keys(CELLS).forEach(c => CELLS[c].forEach(id => { const e = $(id); e && $(c).appendChild(e); }));
    const rm = $('section-remark'), tb = $('section-table'); if (rm && tb) tb.after(rm);   // 全体リマークは見積もりテーブルの下（1 カラム）
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
