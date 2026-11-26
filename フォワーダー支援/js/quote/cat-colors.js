// 見積もりテーブル：カテゴリの色分けの凡例（2026-11）
//   色そのものは css/cat-colors.css（行の cat-* クラス＝row.js onCatChange が付ける）。
//   ここでは表の上に「カテゴリ：■ 海上運賃 3 ■ 国内作業 2 …」を、使っているカテゴリだけ出す。
//   新しい画面では行にカテゴリの欄が出ないので、色の意味をここで示す。保存データは変えない。
(function () {
  'use strict';
  let timer = 0;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function host() {
    let el = document.getElementById('catLegend');
    if (el) return el;
    const wrap = document.getElementById('tableScrollWrap');
    if (!wrap || !wrap.parentNode) return null;
    el = document.createElement('div');
    el.id = 'catLegend';
    el.hidden = true;
    el.setAttribute('aria-label', 'カテゴリの色');
    wrap.parentNode.insertBefore(el, wrap);
    return el;
  }

  function render() {
    timer = 0;
    const el = host();
    if (!el) return;
    const cats = typeof window.getAllCategories === 'function' ? window.getAllCategories() : [];
    const counts = new Map();
    document.querySelectorAll('#tableBody > tr[id^="row-"]:not([data-virtual]):not([data-type])').forEach(tr => {
      const v = tr.querySelector('select.w-cat')?.value || '';
      if (v) counts.set(v, (counts.get(v) || 0) + 1);
    });
    if (!counts.size) { if (!el.hidden) { el.hidden = true; el.innerHTML = ''; } return; }
    const items = [];
    cats.forEach(c => { if (c.value && counts.has(c.value)) items.push(c); });
    counts.forEach((n, v) => { if (!items.some(c => c.value === v)) items.push({ value: v, label: v, cls: 'cat-' + v }); });
    const html = '<span class="cat-lg-h">カテゴリ：</span>' + items.map(c =>
      '<span class="cat-lg-i" data-cat-lg="' + esc(c.value) + '"><span class="cat-sw ' + esc(c.cls || '') + '"></span>' +
      esc(String(c.label || '').replace(/^\S*[☀-⟿\u{1F300}-\u{1FAFF}]️?\s*/u, '')) +
      ' <span class="cat-lg-n">' + counts.get(c.value) + '</span></span>').join('');
    if (el.innerHTML !== html) el.innerHTML = html;
    el.hidden = false;
  }
  function schedule() { if (!timer) timer = setTimeout(render, 120); }

  function init() {
    const tb = document.getElementById('tableBody');
    if (!tb) { setTimeout(init, 500); return; }
    new MutationObserver(schedule).observe(tb, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    tb.addEventListener('change', e => { if (e.target && e.target.classList && e.target.classList.contains('w-cat')) schedule(); });
    schedule();
  }
  window.catLegendRefresh = render;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
