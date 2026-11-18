/* cp-carrier-guide.js — 🚢 サイバーポート画面：COLINS に情報が無いときの「船会社のトラッキングへの案内」。
 * 番号（B/L・コンテナ・ブッキング）の頭 4 文字から船会社を推測し、data/carriers.js の `tracking(番号)` で
 * その船会社のトラッキングページへのリンクを作る。推測できないときは、すべての船会社から選べる。
 * 読み取りのみ・外部サイトを新しいタブで開くだけ（サイバーポートへは何も送らない）。
 * 画面（js/cp-test.js）は CpCarrierGuide.html({numbers:[…]}) の結果を差し込むだけ。 */
(function () {
  'use strict';

  // 番号の頭 4 文字（B/L の SCAC コード・コンテナの所有者コード）→ data/carriers.js の船会社名。
  // 確かなものだけを載せる（外れたら案内が間違うため。載っていない船会社は「ほかの船会社」から選べる）。
  var PREFIX = {
    Maersk: ['MAEU', 'MSKU', 'MRKU', 'MRSU', 'MWCU', 'MCPU', 'SUDU'],
    MSC: ['MSCU', 'MEDU', 'MSDU'],
    'CMA CGM': ['CMDU', 'CMAU', 'CGMU'],
    ONE: ['ONEY', 'ONEU', 'NYKU', 'MOLU'],
    'Hapag-Lloyd': ['HLCU', 'HLXU', 'HLBU'],
    Evergreen: ['EGLV', 'EGHU', 'EISU', 'EMCU', 'EITU'],
    COSCO: ['COSU', 'CBHU', 'CSNU'],
    OOCL: ['OOLU', 'OOCU'],
    'Yang Ming': ['YMLU', 'YMMU'],
    HMM: ['HDMU', 'HMMU'],
    ZIM: ['ZIMU', 'ZCSU'],
    'Wan Hai': ['WHLC', 'WHLU'],
    PIL: ['PCIU', 'PILU'],
    SITC: ['SITC', 'SITU'],
    KMTC: ['KMTC', 'KMTU']
  };
  var BY_PREFIX = {};
  Object.keys(PREFIX).forEach(function (name) { PREFIX[name].forEach(function (p) { BY_PREFIX[p] = name; }); });

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function norm(no) { return String(no == null ? '' : no).replace(/[\s　]+/g, '').toUpperCase(); }
  function carriers() { return (typeof CARRIERS !== 'undefined' && CARRIERS) ? CARRIERS : {}; }

  // 番号から船会社名を推測（分からなければ null）
  function guess(no) {
    var n = norm(no);
    if (n.length < 4) return null;
    var name = BY_PREFIX[n.slice(0, 4)];
    return name && carriers()[name] ? name : null;
  }
  // 船会社のトラッキングページ URL（番号があれば、その番号を渡す。番号を URL で受けない船会社は top の画面）
  function urlFor(name, no) {
    var c = carriers()[name]; if (!c) return '';
    try { if (typeof c.tracking === 'function') return String(c.tracking(encodeURIComponent(norm(no)))); } catch (e) { /* 何もしない */ }
    return c.top || '';
  }
  function chip(name, no, primary) {
    var c = carriers()[name]; if (!c) return '';
    var url = urlFor(name, no); if (!url) return '';
    // trackingClipboard：番号を URL で渡せない船会社。開くときに番号をコピーして、貼り付けてもらう
    var copy = c.trackingClipboard ? ' data-cg-copy="' + esc(norm(no)) + '"' : '';
    return '<a class="cpt-guide-chip' + (primary ? ' is-primary' : '') + '" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer"' + copy + '>' +
      (c.icon ? esc(c.icon) + ' ' : '') + esc(name) + (primary ? ' のトラッキングを開く' : '') + (c.trackingClipboard ? ' 📋' : '') + ' ↗</a>';
  }

  // numbers：照会した番号（B/L・コンテナ・ブッキング）。先頭から順に船会社を推測する
  function html(opts) {
    opts = opts || {};
    var nums = (opts.numbers || []).map(norm).filter(Boolean);
    nums = nums.filter(function (n, i) { return nums.indexOf(n) === i; });
    if (!nums.length) return '';
    var main = nums[0], found = [], seen = {};
    nums.forEach(function (n) { var g = guess(n); if (g && !seen[g]) { seen[g] = 1; found.push({ name: g, no: n }); } });
    var all = Object.keys(carriers()).filter(function (k) { return typeof carriers()[k].tracking === 'function'; });
    var rest = all.filter(function (k) { return !seen[k]; });
    var head = '<div class="cpt-guide-h">🔎 COLINS に情報が無いときは、船会社のトラッキングで確認できます</div>';
    var body = found.length
      ? '<div class="cpt-guide-p">番号「' + esc(found[0].no) + '」の頭文字から、船会社を推測しました。</div><div class="cpt-guide-chips">' + found.map(function (f) { return chip(f.name, f.no, true); }).join('') + '</div>'
      : '<div class="cpt-guide-p">番号「' + esc(main) + '」から船会社を推測できませんでした。船会社を選んで、トラッキングページを開いてください（番号をそのまま渡します）。</div>';
    var more = rest.length
      ? '<details class="cpt-guide-more"' + (found.length ? '' : ' open') + '><summary>' + (found.length ? 'ほかの船会社で確認する' : '船会社を選ぶ') + '</summary><div class="cpt-guide-chips">' + rest.map(function (k) { return chip(k, main, false); }).join('') + '</div></details>'
      : '';
    var note = '<div class="cpt-guide-n">※ COLINS は日本の港のターミナル情報です。海外の発着や、ターミナルの更新前は載らないことがあります。船会社のページは新しいタブで開き、アプリには何も送りません。' +
      (found.some(function (f) { return carriers()[f.name].trackingClipboard; }) || (!found.length && all.some(function (k) { return carriers()[k].trackingClipboard; })) ? '「📋」のある船会社は、開くときに番号をコピーします（ページの入力欄に貼り付けてください）。' : '') + '</div>';
    return '<div class="cpt-guide">' + head + body + more + note + '</div>';
  }

  // 本船の動静（COLINS に本船が載っていないとき）：本船名からは船会社を推測できないので、船会社の「本船の動き」のページを一覧から選んでもらう。
  // 本船名を入れていれば、開くときに名前をコピーする（ページの入力欄に貼り付ける）。
  function vesselHtml(opts) {
    opts = opts || {};
    var name = String(opts.name == null ? '' : opts.name).trim().replace(/\s+/g, ' ');
    var all = carriers();
    var keys = Object.keys(all).filter(function (k) { return typeof all[k].vessel === 'function'; });
    if (!keys.length) return '';
    var chips = keys.map(function (k) {
      var c = all[k], url = '';
      try { url = String(c.vessel(encodeURIComponent(name))); } catch (e) { url = ''; }
      if (!url) return '';
      var copy = name ? ' data-cg-copy="' + esc(name) + '"' : '';
      return '<a class="cpt-guide-chip" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer"' + copy + '>' + (c.icon ? esc(c.icon) + ' ' : '') + esc(k) + (name ? ' 📋' : '') + ' ↗</a>';
    }).join('');
    if (!chips) return '';
    return '<div class="cpt-guide"><div class="cpt-guide-h">🔎 COLINS に本船の情報が無いときは、船会社の本船スケジュールで確認できます</div>' +
      '<div class="cpt-guide-p">本船名からは船会社が分からないため、船会社を選んでください' + (name ? '（本船名「' + esc(name) + '」は、開くときにコピーします。ページの検索欄に貼り付けてください）' : '') + '。</div>' +
      '<div class="cpt-guide-chips">' + chips + '</div>' +
      '<div class="cpt-guide-n">※ COLINS は日本の港のターミナル情報です。入港前や、ターミナルの更新前の本船は載らないことがあります。船会社のページは新しいタブで開き、アプリには何も送りません。</div></div>';
  }

  // リンクを押したときの処理：番号をコピーする船会社なら、番号をクリップボードへ（失敗しても、ページは開く）
  function onClick(e) {
    var a = e.target && e.target.closest ? e.target.closest('a[data-cg-copy]') : null;
    if (!a) return;
    var no = a.getAttribute('data-cg-copy');
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(no).then(function () { toast('番号「' + no + '」をコピーしました。開いたページに貼り付けてください'); }, function () {});
    } catch (err) { /* 何もしない */ }
  }
  function toast(msg) { try { if (window.SharedUI && window.SharedUI.showToast) window.SharedUI.showToast(msg); } catch (e) { /* 何もしない */ } }

  window.CpCarrierGuide = { guess: guess, urlFor: urlFor, html: html, vesselHtml: vesselHtml, onClick: onClick, PREFIX: PREFIX };
})();
