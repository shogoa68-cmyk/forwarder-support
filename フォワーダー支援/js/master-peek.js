// 会社の「ちょい見せ」（2026-11）
//   情報共有（新着まとめ・ニュースの投稿）で会社名を押したとき、マスター管理へ飛ぶ前に、その場で小さな窓に
//   同じ会社のニュース／顧客カルテ／取引ルールの新しいもの（5 件まで）を出す。
//   もっと見たいときは［マスターの詳細で見る］で、マスター管理の詳細を該当のタブ（ニュース・顧客カルテ・取引ルール）で開く。
//   読むだけ（データは mnAll／ccAll／crAll の読み込み済みのもの）。PC は押した場所の近く、スマホ幅は下から出るシート。
(function () {
  'use strict';
  const _esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const LIMIT = 5;
  const _canon = (f, v) => { v = String(v || '').trim(); return v && typeof window.nameCanon === 'function' ? (window.nameCanon(f, v) || v) : v; };
  const _same = (f, a, b) => { const x = _canon(f, a), y = _canon(f, b); return !!x && x.toLowerCase() === y.toLowerCase(); };
  const _ymd = d => String(d || '').slice(0, 10).replace(/-/g, '/');
  const KIND = {
    news:  { label: 'ニュース',   icon: '📰', tab: 'news' },
    case:  { label: '顧客カルテ', icon: '🗂', tab: 'cases' },
    rule:  { label: '取引ルール', icon: '📌', tab: 'rules' },
  };

  function listOf(kind, field, name) {
    if (kind === 'news') {
      const K = window.MN_KINDS || {};
      return (window.mnAll ? window.mnAll() : []).filter(n => (n.field || 'customer') === field && _same(field, n.name, name)).map(n => ({
        date: n.news_date, title: n.title, body: n.body, tag: ((K[n.kind] || {}).icon || '📰') + ' ' + ((K[n.kind] || {}).label || ''), url: n.url,
      }));
    }
    if (kind === 'case') {
      const K = window.CC_KINDS || {};
      return (window.ccAll ? window.ccAll() : []).filter(x => _same('customer', x.customer, name)).map(x => ({
        date: x.occurred_on, title: x.title, body: [x.situation, x.improvement ? '次回：' + x.improvement : ''].filter(Boolean).join('\n'),
        tag: ((K[x.kind] || {}).icon || '📌') + ' ' + ((K[x.kind] || {}).label || '') + (x.status === 'resolved' ? '・解決済み' : '・未解決'), warn: x.status !== 'resolved',
      }));
    }
    if (kind === 'rule') {
      const L = window.CR_LEVELS || {};
      const rank = { strict: 0, check: 1 };
      return (window.crAll ? window.crAll() : []).filter(r => r.status !== 'retired' && _same('customer', r.customer, name))
        .sort((a, b) => (rank[a.level] ?? 2) - (rank[b.level] ?? 2) || String(b.created_at).localeCompare(String(a.created_at)))
        .map(r => ({ date: r.created_at, title: r.body, body: r.reason || '', tag: ((L[r.level] || {}).icon || '📝') + ' ' + ((L[r.level] || {}).label || 'メモ') + (r.contact ? '・担当：' + r.contact : ''), warn: r.level === 'strict' }));
    }
    return [];
  }

  let pop = null, anchor = null;
  function close() { if (pop) { pop.remove(); pop = null; } document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', close); window.removeEventListener('scroll', onScroll); if (anchor && anchor.focus) try { anchor.focus({ preventScroll: true }); } catch (_) {} anchor = null; }
  function outside(e) { if (pop && !pop.contains(e.target) && e.target !== anchor) close(); }
  function onScroll() { if (window.innerWidth > 600) close(); }
  function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }

  // kind：'news'｜'case'｜'rule'、field：'customer'｜'sv'
  window.masterPeek = function (kind, field, name, el) {
    if (pop) { const same = pop.dataset.key === kind + '|' + field + '|' + name; close(); if (same) return; }
    const K = KIND[kind] || KIND.news;
    const all = listOf(kind, field, name);
    const items = all.slice(0, LIMIT);
    const fl = field === 'sv' ? '🤝 サブコン' : '🏢 お客様';
    const rows = items.map(x => `<li class="mpk-item${x.warn ? ' is-warn' : ''}"><div class="mpk-meta"><span>${_esc(x.tag)}</span><span>${_esc(_ymd(x.date))}</span></div>
      <div class="mpk-title">${_esc(x.title)}</div>${x.body ? `<div class="mpk-body">${_esc(x.body)}</div>` : ''}${x.url && /^https?:\/\//i.test(x.url) ? `<a class="mpk-link" href="${_esc(x.url)}" target="_blank" rel="noopener">参考リンク ↗</a>` : ''}</li>`).join('');
    pop = document.createElement('div');
    pop.className = 'mpk-pop'; pop.dataset.key = kind + '|' + field + '|' + name;
    pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', name + 'の' + K.label);
    pop.innerHTML = `<div class="mpk-hd"><div><span class="mpk-field">${fl}</span><b class="mpk-name">${_esc(name)}</b></div><button type="button" class="mpk-x" aria-label="閉じる">✕</button></div>
      <div class="mpk-sub">${K.icon} ${K.label}${all.length ? `（${all.length} 件${all.length > LIMIT ? '・新しい ' + LIMIT + ' 件を表示' : ''}）` : ''}</div>
      ${rows ? `<ul class="mpk-list">${rows}</ul>` : `<div class="mpk-empty">この会社の${K.label}はまだありません。</div>`}
      <div class="mpk-ft"><button type="button" class="mpk-go">マスターの詳細で見る（${K.label}）›</button></div>`;
    document.body.appendChild(pop);
    anchor = el || null;
    pop.querySelector('.mpk-x').addEventListener('click', close);
    pop.querySelector('.mpk-go').addEventListener('click', () => {
      close();
      if (typeof window.statsJumpToMaster === 'function') window.statsJumpToMaster(field, name, K.tab);
    });
    // 位置：スマホ幅は CSS で下のシート。PC は押した場所の下（入らなければ上）
    if (el && window.innerWidth > 600) {
      const r = el.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
      let left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
      let top = r.bottom + 6; if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
      pop.style.left = left + 'px'; pop.style.top = top + 'px';
    }
    setTimeout(() => { document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', onKey, true); window.addEventListener('resize', close); window.addEventListener('scroll', onScroll); }, 0);
    try { pop.querySelector('.mpk-go').focus({ preventScroll: true }); } catch (_) {}
  };
  window.masterPeekClose = close;
})();
