// カテゴリナビの「📂 その他」メニュー（カレンダー／本船・航路／Booking/SI／書類・通関／計算／知識・参考）。
// 中のボタンは従来の .cat-btn のまま（onclick・aria-controls 不変）。ここでは開閉と、
// 選択中のカテゴリが中にあるときの「その他」ボタンの表示だけを担当する。
(function () {
  var wrap = document.getElementById('catMore');
  var btn = document.getElementById('catMoreBtn');
  var panel = document.getElementById('catMorePanel');
  if (!wrap || !btn || !panel) return;
  var label = btn.querySelector('.cat-more-label');

  function place() {
    // .cat-nav はスマホ幅で横スクロール（overflow）になり、中の絶対配置は切れるため、fixed で置く
    var r = btn.getBoundingClientRect();
    var w = Math.max(r.width, 200);
    panel.style.top = (r.bottom + 4) + 'px';
    panel.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
    panel.style.minWidth = w + 'px';
  }
  function setOpen(open) {
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    wrap.classList.toggle('is-open', open);
    if (open) place();
  }
  function sync() {
    var cur = panel.querySelector('.cat-btn.active');
    btn.classList.toggle('active', !!cur);
    if (label) label.textContent = cur ? cur.textContent.trim() : 'その他';
    panel.querySelectorAll('.cat-btn').forEach(function (b) { b.setAttribute('aria-selected', b.classList.contains('active') ? 'true' : 'false'); });
  }

  btn.addEventListener('click', function (e) { e.stopPropagation(); setOpen(panel.hidden); });
  panel.addEventListener('click', function (e) { if (e.target.closest('.cat-btn')) setOpen(false); });
  document.addEventListener('click', function (e) { if (!panel.hidden && !wrap.contains(e.target)) setOpen(false); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !panel.hidden) { setOpen(false); btn.focus(); }
  });
  window.addEventListener('resize', function () { if (!panel.hidden) place(); });
  window.addEventListener('scroll', function () { if (!panel.hidden) setOpen(false); }, { passive: true });

  // 選択中の印は switchCategory や他のコードが .active を付け外しするので、クラスの変化を見て追従する
  new MutationObserver(sync).observe(panel, { subtree: true, attributes: true, attributeFilter: ['class'] });
  sync();
})();
