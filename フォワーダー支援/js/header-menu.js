// ヘッダーを「☰ メニュー」と「アバター（アカウント）」の 2 つのアイコンにまとめる（2026-11・全テーマ共通）。
// 既存のボタン・リンク（id／onclick／機能）は変えず、要素ごと移すだけ（cloud.js・users.js・feedback.js は id で操作し続ける）。
//  ☰ ＝ご意見・ご要望（不具合報告・アイデア・改修予定）＋表示（デザイン切替）
//  アバター ＝名前（押すとプロフィール編集）・チーム管理・ログアウト
// ログインしていない間は、従来どおり「Google でログイン」ボタンを出す。
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var panels = [];

  function closeAll(except) {
    panels.forEach(function (p) {
      if (p.panel === except) return;
      p.panel.hidden = true; p.btn.setAttribute('aria-expanded', 'false');
    });
  }
  function makeMenu(id, btnHtml, title) {
    var wrap = document.createElement('div'); wrap.className = 'hdr-menu'; wrap.id = id;
    var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'hdr-icon-btn'; btn.id = id + 'Btn';
    btn.setAttribute('aria-haspopup', 'true'); btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('title', title); btn.setAttribute('aria-label', title);
    btn.innerHTML = btnHtml;
    var panel = document.createElement('div'); panel.className = 'hdr-panel'; panel.id = id + 'Panel'; panel.hidden = true;
    wrap.appendChild(btn); wrap.appendChild(panel);
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = panel.hidden; closeAll(panel);
      panel.hidden = !open; btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) place(panel);
    });
    // パネル内の項目を押したら閉じる（入力欄は無いので常に閉じてよい）
    panel.addEventListener('click', function () { closeAll(null); });
    panels.push({ panel: panel, btn: btn });
    return { wrap: wrap, btn: btn, panel: panel };
  }
  // パネルは既定でボタンの右端にそろえるが、ヘッダーが折り返してボタンが左側にあるとき（タブレット幅）は
  // 画面の左へはみ出して切れるため、左端にそろえ直す（スマホ幅は CSS で画面いっぱいに固定表示）
  function place(panel) {
    panel.style.left = ''; panel.style.right = '';
    if (window.innerWidth <= 600) return;
    var r = panel.getBoundingClientRect();
    if (r.left < 8) { panel.style.right = 'auto'; panel.style.left = '0'; }
  }
  function label(text) { var p = document.createElement('p'); p.className = 'hdr-panel-label'; p.textContent = text; return p; }

  function build() {
    var header = document.querySelector('.header'); if (!header || $('hdrMenu')) return;
    var auth = header.querySelector('.header-auth');

    // ☰ メニュー
    var links = {
      roadmap: header.querySelector(':scope > a.hdr-roadmap:not(.hdr-bugreports):not(.hdr-ideas):not(.hdr-design)'),
      bug: $('hdrBugReportsBtn'), idea: $('hdrIdeasBtn'), design: $('hdrDesignBtn'),
    };
    var m = makeMenu('hdrMenu', '<span aria-hidden="true">☰</span>', 'メニュー（不具合報告・アイデア・改修予定・デザイン）');
    m.panel.appendChild(label('ご意見・ご要望'));
    [links.bug, links.idea, links.roadmap].forEach(function (a) { if (a) m.panel.appendChild(a); });
    m.panel.appendChild(label('表示'));
    if (links.design) m.panel.appendChild(links.design);
    header.insertBefore(m.wrap, auth || null);

    // アカウント（ログイン中だけ出る #hdrCloudUser の中身を組み替える）
    var user = $('hdrCloudUser'); if (!user) return;
    var prof = user.querySelector('.hdr-cloud-prof'), avatar = $('hdrCloudAvatar'), mgr = $('hdrUserMgrBtn'), out = $('hdrCloudLogout');
    var a = makeMenu('hdrAcct', '', 'アカウント（名前・チーム管理・ログアウト）');
    a.btn.classList.add('is-acct');
    if (avatar) a.btn.appendChild(avatar);
    if (prof) { prof.classList.add('hdr-acct-who'); a.panel.appendChild(prof); }
    if (mgr) a.panel.appendChild(mgr);
    if (out) a.panel.appendChild(out);
    user.appendChild(a.wrap);
  }

  function init() {
    build();
    document.addEventListener('click', function (e) { if (!e.target.closest || !e.target.closest('.hdr-menu')) closeAll(null); });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var open = panels.filter(function (p) { return !p.panel.hidden; })[0];
      if (open) { closeAll(null); open.btn.focus(); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
