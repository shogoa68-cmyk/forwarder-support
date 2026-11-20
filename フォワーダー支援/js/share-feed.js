// 情報共有 › 💬 新着まとめ（2026-11）
//   チームで共有している情報の「新しいもの」を、1 つの時系列（新しい順・日ごとの見出し）にまとめて見る画面。
//   集めるもの：📢 管理者からのお知らせ（announcements）／📰 ニュース（master_news）／💬 案件の申し送り（quote_comments）
//               ／🗂 顧客カルテ（customer_cases）／📌 取引ルール（customer_rules）。
//   どれも読むだけ（ここから書き込みはしない）。表が無い（SQL 未実行）ものは黙って飛ばす。SQL の追加は不要。
//   通信量を増やしすぎないよう、申し送り・お知らせは件数を絞って取り、60 秒以内の開き直しは読み直さない。
(function () {
  'use strict';
  const _esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const _c = () => (typeof window.cloudGetClient === 'function' ? window.cloudGetClient() : null);
  const _me = () => { const u = typeof window.cloudCurrentUser === 'function' ? window.cloudCurrentUser() : null; return u ? (u.email || '') : ''; };
  const _who = e => (typeof window.cloudNameFor === 'function' ? window.cloudNameFor(e) : (typeof window._nameFor === 'function' ? window._nameFor(e) : String(e || '').split('@')[0]));
  const _norm = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
  const SEEN_KEY = 'shareFeedSeen_v1';
  const COMMENT_LIMIT = 60, ANN_LIMIT = 30, CACHE_MS = 60000;

  const TYPES = {
    ann:     { label: 'お知らせ',   icon: '📢' },
    news:    { label: 'ニュース',   icon: '📰' },
    comment: { label: '申し送り',   icon: '💬' },
    case:    { label: '顧客カルテ', icon: '🗂' },
    rule:    { label: '取引ルール', icon: '📌' },
  };
  const PERIODS = [['7', '7日'], ['30', '30日'], ['90', '90日'], ['all', 'すべて']];

  const st = { type: 'all', period: '30', q: '', shown: 60 };
  let _items = [], _missing = [], _loadedAt = 0, _loading = null, _seenBefore = 0, root = null;

  function _seenGet() { try { return +localStorage.getItem(SEEN_KEY) || 0; } catch (_) { return 0; } }
  function _seenSet(t) { try { localStorage.setItem(SEEN_KEY, String(t)); } catch (_) {} }
  const _t = iso => { const v = new Date(iso).getTime(); return isNaN(v) ? 0 : v; };
  const _missingErr = e => /relation|does not exist|schema cache|not find|PGRST205|42P01|permission denied/i.test(String((e && (e.message || e.code)) || ''));

  // ---- 集める ----
  async function _comments(c) {
    const r = await c.from('quote_comments').select('id,preset_id,body,created_by,created_at').order('created_at', { ascending: false }).limit(COMMENT_LIMIT);
    if (r.error) { if (_missingErr(r.error)) _missing.push('申し送り'); return []; }
    const rows = r.data || [];
    // 案件名：ダッシュボードで読み込み済みの一覧を使い、足りない分だけ名前を取る
    const known = {};
    (typeof window.cloudGetAllRows === 'function' ? window.cloudGetAllRows() : []).forEach(p => { known[p.id] = p; });
    const need = [...new Set(rows.map(x => x.preset_id).filter(id => id && !known[id]))];
    if (need.length) {
      try { const q = await c.from('quote_presets').select('id,name,customer').in('id', need); (q.data || []).forEach(p => { known[p.id] = p; }); } catch (_) {}
    }
    return rows.map(x => {
      const p = known[x.preset_id] || {};
      const caseName = (typeof window.quotePresetMeta === 'function' && p.data ? (window.quotePresetMeta(p.data) || {}).memo : '') || p.name || '（案件）';
      return { type: 'comment', id: 'c:' + x.id, at: x.created_at, who: x.created_by, title: x.body, sub: [caseName, p.customer].filter(Boolean).join(' ・ '), presetId: x.preset_id };
    });
  }
  async function _anns(c) {
    const r = await c.from('announcements').select('*').order('starts_at', { ascending: false }).limit(ANN_LIMIT);
    if (r.error) { if (_missingErr(r.error)) _missing.push('お知らせ'); return []; }
    const now = Date.now();
    return (r.data || []).filter(a => _t(a.starts_at) <= now).map(a => ({
      type: 'ann', id: 'a:' + a.id, at: a.starts_at, who: a.created_by, title: a.title || '', body: a.body || '',
      sub: (a.ends_at && _t(a.ends_at) <= now) ? '表示は終了しました' : (a.kind === 'important' ? '❗ 重要' : a.kind === 'maintenance' ? '🛠️ メンテナンス' : ''),
      important: a.kind === 'important',
    }));
  }
  async function _news() {
    if (typeof window.mnLoad !== 'function') return [];
    await window.mnLoad(true);
    if (window.mnIsMissing && window.mnIsMissing()) { _missing.push('ニュース'); return []; }
    const K = window.MN_KINDS || {};
    return (window.mnAll ? window.mnAll() : []).map(n => ({
      type: 'news', id: 'n:' + n.id, at: n.created_at || n.news_date, who: n.created_by, title: n.title, body: n.body || '',
      sub: ((K[n.kind] || {}).icon || '📰') + ' ' + ((K[n.kind] || {}).label || '') + '　' + String(n.news_date || '').replace(/-/g, '/'),
      company: n.name, field: n.field,
    }));
  }
  async function _cases() {
    if (typeof window.ccLoad !== 'function') return [];
    await window.ccLoad(true);
    if (window.ccIsMissing && window.ccIsMissing()) { _missing.push('顧客カルテ'); return []; }
    const K = window.CC_KINDS || {};
    return (window.ccAll ? window.ccAll() : []).map(x => ({
      type: 'case', id: 'k:' + x.id, at: x.created_at || x.occurred_on, who: x.created_by, title: x.title,
      body: [x.situation, x.improvement ? '次回：' + x.improvement : ''].filter(Boolean).join('\n'),
      sub: ((K[x.kind] || {}).icon || '📌') + ' ' + ((K[x.kind] || {}).label || '') + (x.status === 'resolved' ? '　✓ 解決済み' : '　未解決'),
      company: x.customer, field: 'customer', open: x.status !== 'resolved',
    }));
  }
  async function _rules() {
    if (typeof window.crLoad !== 'function') return [];
    await window.crLoad(true);
    if (window.crIsMissing && window.crIsMissing()) { _missing.push('取引ルール'); return []; }
    const L = window.CR_LEVELS || {};
    return (window.crAll ? window.crAll() : []).filter(r => r.status !== 'retired').map(r => ({
      type: 'rule', id: 'r:' + r.id, at: r.created_at, who: r.created_by, title: r.body, body: r.reason || '',
      sub: ((L[r.level] || {}).icon || '📝') + ' ' + ((L[r.level] || {}).label || 'メモ') + (r.contact ? '　担当：' + r.contact : ''),
      company: r.customer, field: 'customer', important: r.level === 'strict',
    }));
  }

  async function load(force) {
    if (!force && _loadedAt && Date.now() - _loadedAt < CACHE_MS) return;
    if (_loading) return _loading;
    _loading = (async () => {
      const c = _c(); _missing = [];
      const safe = p => p.catch(() => []);
      const parts = await Promise.all([c ? safe(_anns(c)) : [], safe(_news()), c ? safe(_comments(c)) : [], safe(_cases()), safe(_rules())]);
      _items = [].concat(...parts).filter(x => x.at).sort((a, b) => _t(b.at) - _t(a.at));
      _loadedAt = Date.now(); _loading = null;
    })();
    return _loading;
  }

  // ---- 表示 ----
  function _inPeriod(x) { if (st.period === 'all') return true; return _t(x.at) >= Date.now() - (+st.period) * 86400000; }
  function filtered() {
    const q = _norm(st.q).split(/\s+/).filter(Boolean);
    return _items.filter(x => (st.type === 'all' || x.type === st.type) && _inPeriod(x) &&
      (!q.length || q.every(w => _norm([x.title, x.body, x.sub, x.company, _who(x.who)].join(' ')).includes(w))));
  }
  function dayLabel(iso) {
    const d = new Date(iso), t = new Date(); t.setHours(0, 0, 0, 0);
    const d0 = new Date(d); d0.setHours(0, 0, 0, 0);
    const diff = Math.round((t - d0) / 86400000);
    if (diff === 0) return '今日'; if (diff === 1) return '昨日';
    const w = '日月火水木金土'[d.getDay()];
    return (d.getFullYear() !== t.getFullYear() ? d.getFullYear() + '/' : '') + (d.getMonth() + 1) + '/' + d.getDate() + '（' + w + '）';
  }
  const hm = iso => { const d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

  function itemHtml(x) {
    const T = TYPES[x.type];
    const isNew = _seenBefore && _t(x.at) > _seenBefore && x.who !== _me();
    const target = x.type === 'comment' ? `<button type="button" class="sf-open" data-sf="case" data-id="${_esc(x.presetId)}">💼 案件を開く</button>`
      : x.company ? `<button type="button" class="sf-open" data-sf="master" data-f="${_esc(x.field || 'customer')}" data-name="${_esc(x.company)}">${x.field === 'sv' ? '🤝' : '🏢'} ${_esc(x.company)}</button>` : '';
    return `<li class="sf-item sf-t-${x.type}${x.important ? ' is-imp' : ''}${isNew ? ' is-new' : ''}">
      <span class="sf-ico" aria-hidden="true">${T.icon}</span>
      <div class="sf-card">
        <div class="sf-head"><span class="sf-type">${T.label}</span>${isNew ? '<span class="sf-new">新着</span>' : ''}${x.sub ? `<span class="sf-sub">${_esc(x.sub)}</span>` : ''}<span class="sf-time">${hm(x.at)}</span></div>
        <div class="sf-title">${_esc(x.title)}</div>
        ${x.body ? `<div class="sf-body">${_esc(x.body)}</div>` : ''}
        <div class="sf-foot">${x.who ? `<span class="sf-who">${_esc(_who(x.who))}</span>` : '<span></span>'}${target}</div>
      </div></li>`;
  }
  function listHtml() {
    const list = filtered();
    const base = _items.filter(_inPeriod);
    const cnt = t => base.filter(x => t === 'all' || x.type === t).length;
    const chips = ['all'].concat(Object.keys(TYPES)).map(t => `<button type="button" class="sf-chip${st.type === t ? ' is-on' : ''}" data-sf="type" data-v="${t}">${t === 'all' ? 'すべて' : TYPES[t].icon + ' ' + TYPES[t].label} <b>${cnt(t)}</b></button>`).join('');
    const per = PERIODS.map(([v, l]) => `<option value="${v}"${st.period === v ? ' selected' : ''}>${l}</option>`).join('');
    const newN = _seenBefore ? base.filter(x => _t(x.at) > _seenBefore && x.who !== _me()).length : 0;
    let h = `<div class="sf-tools"><span class="sf-chips">${chips}</span>
      <label class="sf-per">期間 <select data-sf="period">${per}</select></label>
      <input type="search" class="sf-q" placeholder="言葉で探す（会社名・内容・名前）" value="${_esc(st.q)}"></div>`;
    if (newN) h += `<div class="sf-newbar">前に開いたときから <b>${newN} 件</b> の新着があります（ほかのメンバーの書き込み）</div>`;
    if (!list.length) return h + `<div class="sf-empty">${_items.length ? 'この条件に合う新着はありません。期間を広げるか、絞り込みを外してください。' : 'まだ共有された情報はありません。'}</div>`;
    let cur = '', out = '';
    list.slice(0, st.shown).forEach(x => { const d = dayLabel(x.at); if (d !== cur) { cur = d; out += `<li class="sf-day">${_esc(d)}</li>`; } out += itemHtml(x); });
    h += `<ul class="sf-timeline">${out}</ul>`;
    if (list.length > st.shown) h += `<button type="button" class="sf-more" data-sf="more">さらに表示（残り ${list.length - st.shown} 件）</button>`;
    return h;
  }
  const LINKS = `<details class="sf-places"><summary>✏️ 書き込む場所</summary><div class="share-links">
      <button type="button" class="share-link" onclick="switchCategory('news', document.querySelector('.cat-btn[aria-controls=tab-news]'))"><b>📰 ニュースの投稿</b><span>お客様・サブコンの新しい情報を投稿</span></button>
      <button type="button" class="share-link" onclick="switchCategory('quote', document.querySelector('.cat-btn[aria-controls=tab-quote-make]'))"><b>💬 案件の申し送り</b><span>見積の一覧で、案件カードの「申し送り」から</span></button>
      <button type="button" class="share-link" onclick="switchCategory('master', document.querySelector('.cat-btn[aria-controls=tab-master]'))"><b>🗂 顧客カルテ・📌 取引ルール</b><span>マスター管理の、お客様の詳細から</span></button>
      <button type="button" class="share-link" onclick="switchCategory('bookmark', document.querySelector('.cat-btn[aria-controls=tab-bookmark]'))"><b>🔖 リンク集</b><span>船会社・サブコンのよく使うリンク</span></button>
      <button type="button" class="share-link" onclick="switchCategory('bugreports')"><b>🐞 不具合報告・💡 アイデア</b><span>アプリへの要望や困りごと</span></button>
    </div></details>`;

  function paintList() { const el = root && root.querySelector('.sf-list'); if (el) el.innerHTML = listHtml(); }
  function paint() {
    if (!root) return;
    let body;
    if (!_me()) body = '<div class="sf-empty">ログインすると、チームで共有している情報の新着を見られます。</div>';
    else body = '<div class="sf-list">' + listHtml() + '</div>' + (_missing.length ? `<p class="sf-note">準備がまだのため表示していないもの：${_esc(_missing.join('・'))}（Supabase で SQL を実行すると出ます）</p>` : '');
    root.innerHTML = `<div class="sf-hd"><div><h2 class="share-title">💬 情報共有 — 新着まとめ</h2>
        <p class="share-lead">お知らせ・ニュース・案件の申し送り・顧客カルテ・取引ルールの新しいものを、時間の順にまとめて見られます。</p></div>
        <button type="button" class="sf-reload" data-sf="reload" title="読み直す">↻ 更新</button></div>` + body + LINKS;
  }

  function onClick(e) {
    const b = e.target.closest('[data-sf]'); if (!b || !root.contains(b)) return;
    const a = b.dataset.sf;
    if (a === 'type') { st.type = b.dataset.v; st.shown = 60; paintList(); }
    else if (a === 'more') { st.shown += 60; paintList(); }
    else if (a === 'reload') { b.disabled = true; load(true).then(paint); }
    else if (a === 'master') { if (typeof window.statsJumpToMaster === 'function') window.statsJumpToMaster(b.dataset.f, b.dataset.name, true); }
    else if (a === 'case') {
      const id = b.dataset.id; if (!id) return;
      const btn = document.querySelector('.cat-btn[aria-controls="tab-quote-make"]');
      if (typeof window.switchCategory === 'function') window.switchCategory('quote', btn);
      setTimeout(() => { if (typeof window.cloudLoadPreset === 'function') window.cloudLoadPreset(encodeURIComponent(id)); }, 0);
    }
  }
  function onInput(e) {
    if (e.target.matches('.sf-q')) { st.q = e.target.value; st.shown = 60; const pos = e.target.selectionStart; paintList(); const q = root.querySelector('.sf-q'); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (_) {} } }
  }
  function onChange(e) { if (e.target.matches('[data-sf="period"]')) { st.period = e.target.value; st.shown = 60; paintList(); } }

  window.initShareTab = async function () {
    root = document.getElementById('sfRoot'); if (!root) return;
    if (!root._sfBound) { root.addEventListener('click', onClick); root.addEventListener('input', onInput); root.addEventListener('change', onChange); root._sfBound = true; }
    if (!_me()) { paint(); return; }
    if (!_seenBefore) _seenBefore = _seenGet();
    if (!_items.length) root.innerHTML = '<div class="sf-empty">読み込み中…</div>' + LINKS;
    await load(false);
    paint();
    _seenSet(Date.now());   // 次に開いたとき、ここから後の書き込みを「新着」にする
  };
  window.shareFeedReload = () => load(true).then(paint);
})();
