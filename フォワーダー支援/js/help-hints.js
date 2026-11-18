// 明細テーブルの列見出しの「ⓘ」：押す（マウスを乗せても）と 1〜2 行の説明が出る（Design 35 パートB）。
// 説明の下に［📖 用語の説明を開く ▸］（ドロワーをその用語で検索した状態で開く）と［閉じる］。外側を押す／Esc でも閉じる。
// 列見出しの title は残したまま（このボタンは見出しの中に足しただけ・保存するデータは増やさない）。
(function () {
  'use strict';
  const HINTS = {
    price: { q: '仕入', lines: ['仕＝仕入。サブコンや船会社に払う金額です。', '＋＝乗せ幅。仕入に足す、自社の取り分です。', '売＝売値。お客様に請求する金額です。「仕入＋乗せ幅」で自動計算されます。'] },
    tax: { q: '', lines: ['消費税 10% がかかる行にチェックします。免税（非課税）の行は、チェックしないままにします。'] }
  };
  let pop = null, curBtn = null, hoverT = 0;
  function build() {
    pop = document.createElement('div');
    pop.id = 'hintI'; pop.className = 'hint-pop'; pop.hidden = true; pop.setAttribute('role', 'dialog');
    document.body.appendChild(pop);
    pop.addEventListener('click', e => {
      if (e.target.closest('.hp-close')) hide();
      else if (e.target.closest('.hp-gl')) { const q = pop.dataset.q || ''; hide(); if (typeof window.openQuoteGlossary === 'function') { if (q) window.openQuoteGlossary(q); else { const d = document.getElementById('glossaryDrawer'); if (!d || d.hidden) window.openQuoteGlossary(); } } }
    });
  }
  function hide() { if (pop) pop.hidden = true; curBtn = null; clearTimeout(hoverT); }
  function show(btn) {
    const h = HINTS[btn.dataset.hint]; if (!h) return;
    if (!pop) build();
    curBtn = btn; pop.dataset.q = h.q;
    pop.innerHTML = h.lines.map(l => '<p>' + l + '</p>').join('') +
      '<div class="hp-acts"><button type="button" class="hp-gl">📖 用語の説明を開く ▸</button><button type="button" class="hp-close">閉じる</button></div>';
    pop.hidden = false;
    const r = btn.getBoundingClientRect(), w = pop.offsetWidth, vw = window.innerWidth;
    pop.style.top = Math.min(window.innerHeight - pop.offsetHeight - 8, r.bottom + 6) + 'px';
    pop.style.left = Math.max(8, Math.min(vw - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
  }
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('.hint-i');
    if (b) { e.stopPropagation(); if (curBtn === b && pop && !pop.hidden) hide(); else show(b); return; }
    if (pop && !pop.hidden && !e.target.closest('#hintI')) hide();
  }, true);
  document.addEventListener('mouseover', e => {
    const b = e.target.closest && e.target.closest('.hint-i');
    if (!b || (pop && !pop.hidden && curBtn === b)) return;
    clearTimeout(hoverT); hoverT = setTimeout(() => show(b), 250);
  });
  document.addEventListener('mouseout', e => { if (e.target.closest && e.target.closest('.hint-i')) clearTimeout(hoverT); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && pop && !pop.hidden) hide(); });
  window.addEventListener('scroll', () => { if (pop && !pop.hidden) hide(); }, true);
})();
