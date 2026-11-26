// 上段のカテゴリナビは 4 つのまとまり（💼 見積／📦 進行／💬 情報共有／📂 その他・2026-11）。
// それぞれ .cat-more（ボタン .cat-more-btn ＋ メニュー .cat-more-panel）。中のボタンは従来の .cat-btn のまま
// （onclick・aria-controls 不変）。ここでは開閉と、選択中のタブがメニューの中にあるときの表示だけを担当する。
(function () {
  var groups = Array.prototype.slice.call(document.querySelectorAll('.cat-more'));
  if (!groups.length) return;
  var all = [];
  groups.forEach(function (wrap) {
    var btn = wrap.querySelector('.cat-more-btn'), panel = wrap.querySelector('.cat-more-panel');
    if (!btn || !panel) return;
    var label = btn.querySelector('.cat-more-label');
    var g = { wrap: wrap, btn: btn, panel: panel };
    function place() {
      // .cat-nav はスマホ幅で横スクロール（overflow）になり、中の絶対配置は切れるため、fixed で置く
      var r = btn.getBoundingClientRect();
      var w = Math.max(r.width, 260);
      panel.style.top = (r.bottom + 4) + 'px';
      panel.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
      panel.style.minWidth = w + 'px';
    }
    g.setOpen = function (open) {
      if (open) all.forEach(function (o) { if (o !== g) o.setOpen(false); });   // 同時に開くのは 1 つ
      panel.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      wrap.classList.toggle('is-open', open);
      if (open) place();
    };
    g.place = place;
    function sync() {
      var cur = panel.querySelector('.cat-btn.active');
      btn.classList.toggle('active', !!cur);
      // いま開いているタブ名をまとまりの名前の下に小さく出す（例：💼 見積 ／ 計算）
      if (label) label.textContent = cur ? cur.textContent.replace(/^\S+\s*/, '').trim() : '';
      panel.querySelectorAll('.cat-btn').forEach(function (b) { b.setAttribute('aria-selected', b.classList.contains('active') ? 'true' : 'false'); });
    }
    btn.addEventListener('click', function () { g.setOpen(panel.hidden); });
    panel.addEventListener('click', function (e) { if (e.target.closest('.cat-btn')) g.setOpen(false); });
    // 選択中の印は switchCategory や他のコードが .active を付け外しするので、クラスの変化を見て追従する
    new MutationObserver(sync).observe(panel, { subtree: true, attributes: true, attributeFilter: ['class'] });
    // switchCategory は全 .cat-btn から active を外すため、まとまりのボタン自身の印も見張って戻す
    new MutationObserver(function () { var on = !!panel.querySelector('.cat-btn.active'); if (btn.classList.contains('active') !== on) btn.classList.toggle('active', on); }).observe(btn, { attributes: true, attributeFilter: ['class'] });
    sync();
    all.push(g);
  });
  document.addEventListener('click', function (e) { all.forEach(function (g) { if (!g.panel.hidden && !g.wrap.contains(e.target)) g.setOpen(false); }); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    all.forEach(function (g) { if (!g.panel.hidden) { g.setOpen(false); g.btn.focus(); } });
  });
  window.addEventListener('resize', function () { all.forEach(function (g) { if (!g.panel.hidden) g.place(); }); });
  window.addEventListener('scroll', function () { all.forEach(function (g) { if (!g.panel.hidden) g.setOpen(false); }); }, { passive: true });

  // スマホ幅：上段のタブ列が横スクロールのとき、右に続きがある間だけ右端に薄いグラデーションを出す（style.css の .cat-nav::after）
  var nav = document.querySelector('.cat-nav');
  if (nav) {
    var edge = function () { nav.classList.toggle('cn-end', nav.scrollLeft + nav.clientWidth >= nav.scrollWidth - 2); };
    nav.addEventListener('scroll', edge, { passive: true }); window.addEventListener('resize', edge); edge();
  }
})();
