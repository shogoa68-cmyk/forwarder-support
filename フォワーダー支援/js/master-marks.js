/* マスター一覧のカード：印は優先順位の上位 2 つ＋「他 N」（Design 29・案B ③）。
   既存の印（要素）は消さず、3 つ目以降を .mm-hide で隠して「他 N」ボタンで開閉する薄い層。 */
(function () {
  'use strict';
  var RANK = [
    function (e) { return e.classList.contains('cr-chip') && e.classList.contains('has-strict'); },
    function (e) { return e.classList.contains('cr-chip'); },
    function (e) { return e.classList.contains('stats-md-via') && !e.classList.contains('stats-md-refd'); },
    function (e) { return e.classList.contains('cc-chip'); },
    function (e) { return e.classList.contains('stats-md-refd'); },
    function (e) { return e.classList.contains('mn-chip'); },
    function (e) { return e.classList.contains('stats-md-both'); }
  ];
  var KEEP = 2, busy = false;
  function rank(e) { for (var i = 0; i < RANK.length; i++) if (RANK[i](e)) return i; return -1; }
  function enhanceCell(td) {
    if (td.dataset.mmDone === '1') return;
    var marks = [].slice.call(td.querySelectorAll('.cr-chip,.mn-chip,.cc-chip,.stats-md-via,.stats-md-both')).filter(function (e) { return rank(e) >= 0; });
    if (marks.length <= KEEP) { td.dataset.mmDone = '1'; return; }
    marks.sort(function (a, b) { return rank(a) - rank(b); });
    var rest = marks.slice(KEEP);
    rest.forEach(function (e) { e.classList.add('mm-hide'); });
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'mm-more'; b.textContent = '他' + rest.length;
    b.title = '優先度の低い印を表示します';
    b.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var open = td.classList.toggle('mm-open');
      b.textContent = open ? '閉じる' : '他' + rest.length;
    });
    td.appendChild(b);
    td.dataset.mmDone = '1';
  }
  // ゆらぎのあるマスターには［ゆらぎ ▸ 直す］（押すと「ゆらぎ・未登録」の該当種別へ）。サブコン・お客様のカードだけ
  function drift(td) {
    var f = window.statsMasterFieldFilter && window.statsMasterFieldFilter(); if (f !== 'sv' && f !== 'customer') return;
    if (td.querySelector('.mm-fix') || td.closest('.master-nest')) return;
    var nm = td.querySelector('.master-name-toggle') || td; var name = (nm.firstChild && nm.firstChild.nodeType === 3 ? nm.firstChild.textContent : nm.textContent || '').trim();
    var tg = td.querySelector('.master-name-toggle'); if (tg) name = tg.textContent.trim();
    if (!name || !window.statsMasterHasDrift || !window.statsMasterHasDrift(f, name)) return;
    var b = document.createElement('button'); b.type = 'button'; b.className = 'mm-fix'; b.textContent = 'ゆらぎ ▸ 直す'; b.title = '表記のゆらぎを「ゆらぎ・未登録」で整理します';
    b.addEventListener('click', function (ev) { ev.stopPropagation(); if (typeof window.masterSetPane === 'function') window.masterSetPane('fix'); if (typeof window.fixSetKind === 'function') window.fixSetKind(f); });
    td.appendChild(b);
  }
  function run() {
    if (busy) return; busy = true;
    try {
      var root = document.getElementById('statsPane-master'); if (!root) return;
      root.querySelectorAll('table.master-grid td.stats-val').forEach(function (td) { enhanceCell(td); drift(td); });
    } finally { busy = false; }
  }
  window.mmMarksEnhance = run;
  function boot() {
    var root = document.getElementById('statsPane-master'); if (!root) return;
    var t = 0;
    new MutationObserver(function () { clearTimeout(t); t = setTimeout(run, 30); }).observe(root, { childList: true, subtree: true });
    run();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
