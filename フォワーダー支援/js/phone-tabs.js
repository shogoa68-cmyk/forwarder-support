/* スマホ幅（〜600px）の統計・マスター管理の下 3 タブ（Design 29 ⑥）：今日やること／マスター／分析。
   既存の表示層（master-mobile.js の mmShow・stats-mobile.js の smShowHome）を呼ぶだけの薄い層。PC では出さない。 */
(function () {
  'use strict';
  var mq = window.matchMedia ? window.matchMedia('(max-width: 600px)') : { matches: false };
  var bar = null;
  function tabOn(id) { var t = document.getElementById(id); return !!t && t.classList.contains('active') && t.offsetParent !== null; }
  function cur() {
    if (tabOn('tab-stats')) return 'stats';
    if (tabOn('tab-master')) { var r = document.getElementById('tab-master'); return r.classList.contains('mm-view-home') ? 'todo' : 'master'; }
    return '';
  }
  function go(which) {
    var cat = function (c) { return document.querySelector('.cat-btn[aria-controls="tab-' + c + '"]'); };
    if (which === 'stats') { if (typeof switchCategory === 'function') switchCategory('stats', cat('stats')); if (window.smShowHome) window.smShowHome(); }
    else {
      if (typeof switchCategory === 'function') switchCategory('master', cat('master'));
      setTimeout(function () { if (window.mmShow) window.mmShow(which === 'todo' ? 'home' : 'list'); refresh(); }, 60);
    }
    refresh();
  }
  function build() {
    if (bar) return bar;
    bar = document.createElement('nav'); bar.id = 'ptBar'; bar.setAttribute('aria-label', '統計・マスターの切り替え'); bar.hidden = true;
    bar.innerHTML = '<button type="button" data-pt="todo"><span>📋</span>今日やること</button><button type="button" data-pt="master"><span>🗂</span>マスター</button><button type="button" data-pt="stats"><span>📊</span>分析</button>';
    bar.addEventListener('click', function (e) { var b = e.target.closest('button[data-pt]'); if (b) go(b.dataset.pt); });
    document.body.appendChild(bar); return bar;
  }
  function refresh() {
    var c = mq.matches ? cur() : ''; build(); bar.hidden = !c;
    document.body.classList.toggle('pt-on', !!c);
    [].forEach.call(bar.querySelectorAll('button'), function (b) { var on = b.dataset.pt === c; b.classList.toggle('is-on', on); b.setAttribute('aria-current', on ? 'page' : 'false'); });
  }
  function boot() {
    build(); refresh();
    var t = 0, sch = function () { clearTimeout(t); t = setTimeout(refresh, 60); };
    ['tab-stats', 'tab-master'].forEach(function (id) { var el = document.getElementById(id); if (el) new MutationObserver(sch).observe(el, { attributes: true, attributeFilter: ['class'] }); });
    if (mq.addEventListener) mq.addEventListener('change', sch);
    document.addEventListener('click', sch, true);
  }
  window.ptRefresh = refresh;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
