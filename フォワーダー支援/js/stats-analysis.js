/* 統計タブ（PC）の分析の見直し（Design 29・案B 段階 ⑤）。既存の DOM・id・描画は変えず、表示だけ足す薄い層。
   ①数字カード 6 枚は PC では隠す ②サブタブは左のグループ分けメニュー ③受注分析：大きな数字→気づきの札→粗利率の帯の横棒→お客様別。説明帯は［ⓘ］の中へ。
   601px 以上だけ（スマホは stats-mobile.js の「今日の確認」）。 */
(function () {
  'use strict';
  var GROUPS = [
    ['受注・粗利', ['winrate', 'margindiff', 'pattern']],
    ['取引の見え方', ['svport', 'custitem', 'ledger']],
    ['指標', ['data', 'kpi']]
  ];
  var phone = function () { return window.matchMedia && window.matchMedia('(max-width: 600px)').matches; };
  var busy = false;

  function groupMenu() {
    var bar = document.querySelector('#tab-stats > .stats-tabs'); if (!bar || bar.dataset.saGrouped === '1') return;
    var old = bar.querySelector('.stats-tab-group-label'); if (old) old.style.display = 'none';
    GROUPS.forEach(function (g) {
      var first = null;
      g[1].forEach(function (id) { var b = document.getElementById('statsTabBtn-' + id); if (b && !first) first = b; });
      if (!first) return;
      var h = document.createElement('div'); h.className = 'sa-group'; h.textContent = g[0];
      bar.insertBefore(h, first);
      g[1].forEach(function (id) { var b = document.getElementById('statsTabBtn-' + id); if (b) bar.appendChild(b); });
    });
    // 並べ替えで追加したグループ見出しが先頭に集まらないよう、見出し→ボタンの順に組み直す
    var frag = document.createDocumentFragment();
    GROUPS.forEach(function (g) {
      var h = [].slice.call(bar.querySelectorAll('.sa-group')).filter(function (x) { return x.textContent === g[0]; })[0]; if (h) frag.appendChild(h);
      g[1].forEach(function (id) { var b = document.getElementById('statsTabBtn-' + id); if (b) frag.appendChild(b); });
    });
    bar.appendChild(frag);
    bar.dataset.saGrouped = '1';
  }

  function num(t) { var m = String(t || '').replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; }

  function enhanceWinrate() {
    var pane = document.getElementById('statsPane-winrate'); if (!pane || !pane.firstElementChild) return;
    // 説明の帯（.stats-syn-hint）は［ⓘ］の中へ
    pane.querySelectorAll('.stats-syn-hint').forEach(function (p) {
      if (p.dataset.saInfo === '1') return; p.dataset.saInfo = '1'; p.classList.add('sa-hint');
      var b = document.createElement('button'); b.type = 'button'; b.className = 'sa-info'; b.textContent = 'ⓘ'; b.title = '説明を見る'; b.setAttribute('aria-label', '説明を見る');
      b.addEventListener('click', function () { p.classList.toggle('is-open'); });
      p.parentNode.insertBefore(b, p);
    });
    // 粗利率の帯：受注率の横棒
    var th = [].slice.call(pane.querySelectorAll('h3')).filter(function (h) { return /粗利率の帯/.test(h.textContent); })[0];
    var tbl = th && th.parentNode.querySelector('table.stats-table');
    if (tbl && tbl.dataset.saBars !== '1') {
      tbl.dataset.saBars = '1';
      [].forEach.call(tbl.tBodies[0].rows, function (r) {
        var c = r.cells[r.cells.length - 1], p = num(c && c.textContent); if (p == null) return;
        var bar = document.createElement('span'); bar.className = 'sa-bar'; var i = document.createElement('i'); i.style.width = Math.max(0, Math.min(100, p)) + '%'; bar.appendChild(i);
        c.classList.add('sa-ratecell'); c.insertBefore(bar, c.firstChild);
      });
    }
    // お客様別の歩留まり：受注率の横棒（受注率は 6 列目）
    var ch = [].slice.call(pane.querySelectorAll('h3')).filter(function (h) { return /お客様別/.test(h.textContent); })[0];
    var ct = ch && ch.parentNode.querySelector('table.stats-table');
    if (ct && ct.dataset.saBars !== '1') {
      ct.dataset.saBars = '1';
      [].forEach.call(ct.tBodies[0].rows, function (r) {
        var c = r.cells[5], p = num(c && c.textContent); if (p == null) return;
        var bar = document.createElement('span'); bar.className = 'sa-bar'; var i = document.createElement('i'); i.style.width = Math.max(0, Math.min(100, p)) + '%'; bar.appendChild(i);
        c.classList.add('sa-ratecell'); c.insertBefore(bar, c.firstChild);
      });
    }
    // 大きな数字・気づきの札（先頭に 1 回だけ作り、描き直しのたびに更新）
    var s = typeof window.statsTodaySummary === 'function' ? window.statsTodaySummary() : null; var w = s && s.win;
    var head = document.getElementById('saHead');
    if (!head) { head = document.createElement('div'); head.id = 'saHead'; pane.insertBefore(head, pane.firstChild); }
    var html;
    if (!w || !w.sent) {
      html = '<div class="sa-empty"><b>📭 まだ分析できるデータがありません</b><span>見積を「提示済み」にすると、受注率・粗利率がここに出ます。</span><button type="button" onclick="switchCategory(\'quote\', document.querySelector(\'.cat-btn[aria-controls=tab-quote-make]\'))">見積を作る</button></div>';
    } else {
      var pend = Math.max(0, w.sent - w.won - (w.lost || 0));
      html = '<div class="sa-big"><div><i>受注率</i><b>' + (w.rate == null ? '—' : w.rate + '%') + '</b><small>' + w.won + ' / ' + w.sent + ' 件</small></div>' +
             '<div><i>結果待ち</i><b>' + pend + '</b><small>提示済み・提出済みなど</small></div>' +
             '<div><i>平均粗利率</i><b>' + (w.avgMargin == null ? '—' : w.avgMargin.toFixed(1) + '%') + '</b><small>提示後の案件</small></div>' +
             '<div><i>失注</i><b>' + (w.lost || 0) + '</b><small>' + (w.topReason ? '最多：' + w.topReason : '理由の記録なし') + '</small></div></div>';
      var watch = [].slice.call(pane.querySelectorAll('.stats-variant-badge')).filter(function (b) { return /歩留まり/.test(b.textContent); });
      if (watch.length) {
        html += '<div class="sa-notes">' + watch.slice(0, 5).map(function (b, i) {
          var tr = b.closest('tr'), nm = tr && tr.querySelector('.stats-val'); var rate = tr && tr.cells[tr.cells.length - 1];
          return '<button type="button" class="sa-note" data-i="' + i + '">⚠ ' + ((nm && nm.textContent) || '').replace(/歩留まり注意/, '').trim().slice(0, 24) + '：受注率 ' + ((rate && rate.textContent) || '').replace(/[^\d.%—]/g, '') + '</button>';
        }).join('') + '</div>';
        head.__watch = watch;
      }
    }
    if (head.dataset.h !== html) { head.dataset.h = html; head.innerHTML = html; }
  }

  function onClick(e) {
    var n = e.target.closest && e.target.closest('.sa-note'); if (!n) return;
    var head = document.getElementById('saHead'), b = head && head.__watch && head.__watch[+n.dataset.i]; var tr = b && b.closest('tr');
    if (tr) { tr.scrollIntoView({ behavior: 'smooth', block: 'center' }); tr.classList.add('sa-flash'); setTimeout(function () { tr.classList.remove('sa-flash'); }, 1600); }
  }

  // Design 42-5：スマホも受注率の横棒だけは出す（数字のカード・メニューはスマホ版 stats-mobile.js のまま）
  function barsOnly() {
    var pane = document.getElementById('statsPane-winrate'); if (!pane) return;
    var add = function (re, col) {
      var h = [].slice.call(pane.querySelectorAll('h3')).filter(function (x) { return re.test(x.textContent); })[0];
      var t = h && h.parentNode.querySelector('table.stats-table');
      if (!t || t.dataset.saBars === '1' || !t.tBodies[0]) return;
      t.dataset.saBars = '1';
      [].forEach.call(t.tBodies[0].rows, function (r) {
        var c = col == null ? r.cells[r.cells.length - 1] : r.cells[col], p = num(c && c.textContent); if (p == null) return;
        var bar = document.createElement('span'); bar.className = 'sa-bar'; var i = document.createElement('i'); i.style.width = Math.max(0, Math.min(100, p)) + '%'; bar.appendChild(i);
        c.classList.add('sa-ratecell'); c.insertBefore(bar, c.firstChild);
      });
    };
    add(/粗利率の帯/, null); add(/お客様別/, 5);
  }
  function run() {
    if (busy) return; busy = true;
    try { if (phone()) barsOnly(); else { groupMenu(); enhanceWinrate(); } } finally { busy = false; }
  }
  function boot() {
    var tab = document.getElementById('tab-stats'); if (!tab) return;
    document.addEventListener('click', onClick);
    var t = 0; new MutationObserver(function () { clearTimeout(t); t = setTimeout(run, 40); }).observe(tab, { childList: true, subtree: true });
    run();
  }
  window.saEnhance = run;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
