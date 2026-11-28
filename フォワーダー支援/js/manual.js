// ============================================================
// 📘 マニュアル（画面）— データは data/manual.js（scripts/build-manual.js が docs/マニュアル/*.md から作る）
//   ・目次（まとまり別）・検索・章の本文・「この画面を開く」・「▶ 練習する」（js/trainer.js）
//   ・window.manualOpen(id)／manualSearch(q, n)／manualForTab(tabId)／manualChapters()
// ============================================================
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const data = () => window.MANUAL || { chapters: [], missing: [], updated: '' };
  const chapters = () => data().chapters || [];
  const byId = (id) => chapters().find((c) => c.id === id) || null;
  let _cur = '', _q = '', _built = false;

  // ---------- 検索（日本語は区切りが無いので 2 文字ずつの一致で数える） ----------
  function norm(s) {
    return String(s || '').normalize('NFKC').toLowerCase()
      .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
      .replace(/[\s　、。・,.!?！？「」『』（）()［］\[\]:：]/g, ' ');
  }
  function grams(t) {
    const out = [];
    norm(t).split(/\s+/).filter(Boolean).forEach((w) => {
      if (w.length < 2) { out.push(w); return; }
      for (let i = 0; i < w.length - 1; i++) out.push(w.slice(i, i + 2));
    });
    return out;
  }
  function search(q, n) {
    const g = grams(q); if (!g.length) return [];
    const scored = chapters().map((c) => {
      const t = norm(c.title), b = norm(c.text);
      let s = 0;
      g.forEach((x) => { if (t.includes(x)) s += 4; let i = 0, k = 0; while ((i = b.indexOf(x, i)) >= 0 && k < 6) { s += 1; k++; i += x.length; } });
      return { c, s: s / Math.sqrt(g.length) };
    }).filter((x) => x.s >= 1.5).sort((a, b) => b.s - a.s);
    return scored.slice(0, n || 5).map((x) => x.c);
  }
  function forTab(tabId) {
    if (!tabId) return null;
    return chapters().find((c) => c.open === tabId) || chapters().find((c) => (c.covers || []).includes(tabId)) || null;
  }

  // ---------- 画面 ----------
  function tocHtml() {
    const groups = [];
    chapters().forEach((c) => { let g = groups.find((x) => x.name === c.group); if (!g) groups.push(g = { name: c.group, items: [] }); g.items.push(c); });
    const hit = _q ? new Set(search(_q, 99).map((c) => c.id)) : null;
    return groups.map((g) => {
      const items = g.items.filter((c) => !hit || hit.has(c.id));
      if (!items.length) return '';
      return '<div class="man-toc-grp"><p class="man-toc-h">' + esc(g.name) + '</p>' + items.map((c) =>
        '<button type="button" class="man-toc-item' + (c.id === _cur ? ' is-on' : '') + '" data-man="' + esc(c.id) + '" aria-current="' + (c.id === _cur ? 'page' : 'false') + '">' +
        '<span>' + esc(c.title) + '</span>' + (c.review ? '<i class="man-dot" title="アプリが変わったあと、まだ見直していない章です"></i>' : '') + '</button>').join('') + '</div>';
    }).join('') || '<p class="man-none">「' + esc(_q) + '」に当てはまる章はありません。<br><button type="button" class="man-btn" data-man-ask="1">🎓 AI トレーナーに聞く</button></p>';
  }
  function lessonBtns(c) {
    return (c.lessons || []).map((L) => '<button type="button" class="man-btn man-btn-pri" data-lesson="' + esc(L.id) + '">▶ 練習する：' + esc(L.title) + '</button>').join('');
  }
  function chapterHtml(c) {
    const meta = '<p class="man-meta">' + (c.level ? '<span class="man-lv">' + esc(c.level) + '</span>' : '') + '<span>最終見直し ' + esc(c.updated) + '</span></p>';
    const review = c.review ? '<div class="man-review" role="note">🔄 この章に関係する画面が最近変わりました。説明と違う所があれば、右下の ❓ → 🐞 から教えてください（順次、見直します）。</div>' : '';
    const acts = '<div class="man-acts">' + (c.open ? '<button type="button" class="man-btn" data-man-open="' + esc(c.open) + '">↗ この画面を開く</button>' : '') + '<button type="button" class="man-btn" data-man-ask="1">🎓 この章について質問する</button></div>';
    let body = c.html;
    (c.lessons || []).forEach((L) => {
      body = body.replace('<div class="man-lesson-slot" data-lesson="' + L.id + '"></div>',
        '<div class="man-lesson"><p class="man-lesson-h">🎓 練習：' + esc(L.title) + '（' + L.steps.length + ' 歩）</p><p>実際の画面に印を付けて、1 歩ずつ案内します。いつでも「やめる」で終われます。</p>' +
        '<button type="button" class="man-btn man-btn-pri" data-lesson="' + esc(L.id) + '">▶ 練習を始める</button></div>');
    });
    return '<article class="man-ch" data-ch="' + esc(c.id) + '"><h2>' + esc(c.title) + '</h2>' + meta + review + acts + '<div class="man-body">' + body + '</div>' +
      navHtml(c) + '</article>';
  }
  function navHtml(c) {
    const list = chapters(), i = list.indexOf(c);
    const pv = list[i - 1], nx = list[i + 1];
    return '<div class="man-pn">' + (pv ? '<button type="button" class="man-btn" data-man="' + esc(pv.id) + '">← ' + esc(pv.title) + '</button>' : '<span></span>') +
      (nx ? '<button type="button" class="man-btn" data-man="' + esc(nx.id) + '">' + esc(nx.title) + ' →</button>' : '') + '</div>';
  }
  function homeHtml() {
    const d = data();
    const first = chapters().find((c) => (c.lessons || []).length);
    const cards = chapters().map((c) => '<button type="button" class="man-card" data-man="' + esc(c.id) + '"><b>' + esc(c.title) + '</b><span>' + esc(c.group) + (c.level ? '・' + esc(c.level) : '') + '</span></button>').join('');
    const missing = (d.missing || []).length ? '<p class="man-missing">説明を準備中の画面：' + d.missing.map((m) => esc(m.label)).join('、') + '</p>' : '';
    return '<article class="man-ch man-home"><h2>📘 マニュアル</h2><p class="man-meta"><span>最終更新 ' + esc(d.updated || '—') + '</span><span>アプリの改修に合わせて、順次見直しています</span></p>' +
      '<div class="man-welcome"><p class="man-welcome-h">はじめての方へ</p><p>まずは「はじめに」を読んで、見積を 1 件作る練習をしてみましょう。分からない言葉や操作は、AI トレーナーに聞けます。</p><div class="man-acts">' +
      '<button type="button" class="man-btn" data-man="' + esc((chapters()[0] || {}).id || '') + '">📖 はじめにを読む</button>' +
      (first ? '<button type="button" class="man-btn man-btn-pri" data-lesson="' + esc(first.lessons[0].id) + '">▶ ' + esc(first.lessons[0].title) + '</button>' : '') +
      '<button type="button" class="man-btn" data-man-ask="1">🎓 AI トレーナーに聞く</button></div></div>' +
      '<div class="man-cards">' + cards + '</div>' + missing + '</article>';
  }
  function render() {
    const root = $('manRoot'); if (!root) return;
    if (!_built) {
      root.innerHTML = '<aside class="man-side"><input type="search" id="manSearch" class="man-search" placeholder="🔍 マニュアルを検索（例：保存・PDF・別名）" aria-label="マニュアルを検索" autocomplete="off"><nav class="man-toc" id="manToc" aria-label="マニュアルの目次"></nav></aside><main class="man-main" id="manMain" tabindex="-1"></main>';
      _built = true;
      $('manSearch').addEventListener('input', (e) => { _q = e.target.value.trim(); $('manToc').innerHTML = tocHtml(); });
      $('manSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const r = search(_q, 1)[0]; if (r) show(r.id); } });
      root.addEventListener('click', onClick);
    }
    $('manToc').innerHTML = tocHtml();
    const c = byId(_cur);
    $('manMain').innerHTML = c ? chapterHtml(c) : homeHtml();
    const on = $('manToc').querySelector('.is-on');
    if (on && window.matchMedia && matchMedia('(max-width: 760px)').matches) { const t = $('manToc'); t.scrollLeft = Math.max(0, on.offsetLeft - 12); }
  }
  function show(id) { _cur = byId(id) ? id : ''; render(); const m = $('manMain'); if (m) { m.scrollTop = 0; const r = document.getElementById('tab-manual'); if (r && r.getBoundingClientRect().top < 0) window.scrollTo({ top: window.scrollY + r.getBoundingClientRect().top - 80 }); } }
  function openTab(tab) {
    const b = document.querySelector('.cat-btn[aria-controls="' + tab + '"]');
    if (b) b.click();
  }
  function onClick(e) {
    const t = e.target.closest('[data-man],[data-man-open],[data-lesson],[data-man-ask]'); if (!t) return;
    e.preventDefault();
    if (t.dataset.lesson) { if (window.trainerStartLesson) window.trainerStartLesson(t.dataset.lesson); return; }
    if (t.dataset.manOpen) { openTab(t.dataset.manOpen); return; }
    if (t.dataset.manAsk) { if (window.trainerOpen) window.trainerOpen('ask', _cur ? { chapter: _cur } : null); return; }
    if (t.dataset.man != null) show(t.dataset.man);
  }

  // 別の画面から：マニュアルの画面を開いて、その章を出す
  function manualOpen(id) {
    if (id) _cur = byId(id) ? id : _cur;
    const tab = document.getElementById('tab-manual');
    if (!tab || !tab.classList.contains('active')) openTab('tab-manual');
    render();
  }
  window.initManualTab = function () { render(); };
  window.manualOpen = manualOpen;
  window.manualSearch = search;
  window.manualForTab = forTab;
  window.manualChapters = chapters;
  window.manualLesson = function (id) { for (const c of chapters()) for (const L of (c.lessons || [])) if (L.id === id) return Object.assign({ chapter: c.id }, L); return null; };
  // 本文の中のリンク（[文字](#manual:id)）はトレーナーの答えなど、マニュアルの画面の外でも効かせる
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a.man-link'); if (!a || e.defaultPrevented) return;
    if (a.closest('#manRoot')) return;
    e.preventDefault(); manualOpen(a.dataset.man);
  });
})();
