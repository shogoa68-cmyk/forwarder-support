// マスター管理のスマホ版（Design 案A「今日やること」・2026-11・第1〜3回）。
// 〜600px のときだけ、既存の #tab-master（#statsPane-master／#statsPane-alias）の上に薄い表示層を足す。PC は変えない。
// 既存の DOM・id・onclick は残し、CSS（css/master-mobile.css）で出し分ける（統計のスマホ版 js/stats-mobile.js と同じ方針）。
//  ・第1回：今日やること（承認待ち／ゆらぎ／マスター一覧）＋作業画面（承認・却下の理由シート／ゆらぎは既存カードを作業画面に出す）
//  ・第2回：一覧（検索→種別チップ→「絞り込み・並び順」シート／カードは「詳細」と「⋯」だけ／印は 3 つまで）
//  ・第3回：詳細は全画面（CSS のみ・master-tabs.js のタブをそのまま使う）
// 却下の理由は保存しない（確認のための入力のみ・SQL なし）。
(function () {
  'use strict';
  const mq = window.matchMedia('(max-width: 600px)');
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let view = 'home', wtab = 'req', built = false, undoT = null;
  const mobile = () => mq.matches;
  const root = () => $('tab-master');
  const info = () => (typeof window.statsMasterMobileInfo === 'function' ? window.statsMasterMobileInfo() : { approvalOn: false, admin: false, pending: [], mine: [] });
  const drift = () => { try { return window.driftDebug ? window.driftDebug.counts() : { auto: 0, review: 0, human: 0 }; } catch (e) { return { auto: 0, review: 0, human: 0 }; } };

  function build() {
    const r = root(); if (!r || $('mmHome')) return;
    const tabs = r.querySelector('.stats-tabs');
    const bar = document.createElement('div'); bar.id = 'mmBar'; bar.className = 'mm-bar';
    bar.innerHTML = '<button type="button" class="mm-back" id="mmBack">‹ 今日やること</button><b class="mm-cur" id="mmCur"></b><button type="button" class="mm-fix" id="mmFix">是正</button>';
    const home = document.createElement('div'); home.id = 'mmHome'; home.className = 'mm-home';
    const work = document.createElement('div'); work.id = 'mmWork'; work.className = 'mm-work';
    (tabs || r.firstElementChild).after(bar); bar.after(home); home.after(work);
    bar.addEventListener('click', e => { if (e.target.closest('#mmBack')) show('home'); else if (e.target.closest('#mmFix')) { show('alias'); } });
    home.addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go); });
    work.addEventListener('click', onWorkClick);
    built = true;
  }

  function show(v) {
    view = v; const r = root(); if (!r) return;
    r.classList.toggle('mm-on', mobile());
    ['home', 'work', 'list', 'alias'].forEach(k => r.classList.toggle('mm-view-' + k, mobile() && v === k));
    r.classList.toggle('mm-wtab-drift', mobile() && v === 'work' && wtab === 'drift');
    const cur = $('mmCur'); if (cur) cur.textContent = { home: '', work: wtab === 'drift' ? 'ゆらぎ' : '承認待ち', list: 'マスター一覧', alias: 'エイリアス是正' }[v] || '';
    if (mobile() && typeof window.masterSetPane === 'function') {
      if (v === 'alias') window.masterSetPane('alias'); else if (v !== 'home' && !$('statsPane-master').classList.contains('is-active')) window.masterSetPane('master');
    }
    if (v === 'home') renderHome(); if (v === 'work') renderWork();
    if (v === 'work' && wtab === 'drift') openDriftSecs();
    try { window.scrollTo({ top: 0 }); } catch (e) {}
  }
  function go(k) {
    if (k === 'req') { wtab = 'req'; show('work'); } else if (k === 'drift') { wtab = 'drift'; show('work'); } else if (k === 'list') show('list'); else if (k === 'mine') { wtab = 'req'; show('work'); }
  }

  function act(go, icon, title, sub, tone) {
    return '<button type="button" class="mm-act' + (tone ? ' is-' + tone : '') + '" data-go="' + go + '"><span class="mm-ico">' + icon + '</span><span class="mm-body"><b>' + title + '</b><span class="mm-sub">' + sub + '</span></span><span class="mm-chev">›</span></button>';
  }
  function renderHome() {
    const h = $('mmHome'); if (!h) return;
    const i = info(), d = drift(), nd = d.auto + d.review + d.human;
    let s = '<p class="mm-lead">今日やること</p>';
    if (i.approvalOn && i.admin) s += act('req', '📨', '承認待ち ' + i.pending.length + ' 件', i.pending.length ? 'マスター登録・別名の申請を確認します' : '承認待ちの申請はありません', i.pending.length ? 'warn' : '');
    else if (i.approvalOn && i.mine.length) s += '<button type="button" class="mm-myreq" data-go="mine">📨 申請中 ' + i.mine.length + ' 件 ›</button>';
    s += act('drift', '🔍', 'ゆらぎチェック ' + (d.review + d.human) + ' 件', nd ? '表記ゆれの確認が必要です' + (d.auto ? '（自動で別名にできるもの ' + d.auto + ' 件）' : '') : '確認が必要なゆらぎはありません', d.review + d.human ? 'warn' : '');
    s += act('list', '🗂', 'マスター一覧', '検索・絞り込み・詳細の確認');
    h.innerHTML = s;
  }

  // ---- 作業画面（承認待ち／ゆらぎ）----
  function renderWork() {
    const w = $('mmWork'); if (!w) return;
    const i = info(), d = drift();
    const tab = (k, l) => '<button type="button" class="mm-wt' + (wtab === k ? ' is-on' : '') + '" data-wt="' + k + '">' + l + '</button>';
    let s = '<div class="mm-wtabs">' + tab('req', (i.admin ? '承認待ち ' + i.pending.length : '申請中 ' + i.mine.length)) + tab('drift', 'ゆらぎ ' + (d.review + d.human)) + '</div>';
    if (wtab === 'req') {
      const list = i.admin ? i.pending : i.mine;
      if (!list.length) s += '<p class="mm-empty">' + (i.admin ? '承認待ちの申請はありません。' : '申請中のものはありません。') + '</p>';
      s += list.map(r => '<div class="mm-card" data-id="' + esc(r.id) + '"><div class="mm-card-t"><span class="mm-fld">' + esc(r.label) + '</span><b>' + esc(r.value) + '</b></div>' +
        (r.alias_of ? '<div class="mm-card-s">→ 「' + esc(r.alias_of) + '」の別名にする</div>' : '<div class="mm-card-s">マスターへの登録</div>') +
        (i.admin ? '<div class="mm-card-s">申請者：' + esc(r.who) + '</div><div class="mm-card-b"><button type="button" class="mm-btn" data-rej="' + esc(r.id) + '">却下…</button><button type="button" class="mm-btn is-primary" data-ok="' + esc(r.id) + '">承認</button></div>'
          : '<div class="mm-card-b"><button type="button" class="mm-btn" data-cancel="' + esc(r.id) + '">取り消す</button></div>') + '</div>').join('');
    }
    w.innerHTML = s;
    const cur = $('mmCur'); if (cur) cur.textContent = wtab === 'drift' ? 'ゆらぎ' : (i.admin ? '承認待ち' : '申請中');
    root().classList.toggle('mm-wtab-drift', mobile() && view === 'work' && wtab === 'drift');
  }
  function openDriftSecs() { document.querySelectorAll('#driftCard details.drift-sec').forEach(d => { d.open = true; }); }
  function onWorkClick(e) {
    const t = e.target.closest('[data-wt],[data-ok],[data-rej],[data-cancel]'); if (!t) return;
    if (t.dataset.wt) { wtab = t.dataset.wt; renderWork(); if (wtab === 'drift') { if (typeof window.driftRenderCard === 'function') window.driftRenderCard(); openDriftSecs(); } return; }
    if (t.dataset.ok) approve(t.dataset.ok);
    else if (t.dataset.rej) rejectSheet(t.dataset.rej);
    else if (t.dataset.cancel) { Promise.resolve(window.statsCancelRequest(t.dataset.cancel)).then(() => { renderWork(); toast('申請を取り消しました'); }); }
  }
  async function approve(id) {
    const r = info().pending.find(x => x.id === id);
    await window.statsDecideRequest(id, true);
    renderWork(); toast('承認しました' + (r ? '：' + r.value : ''));
  }
  const REASONS = ['金額が違う', '重複している', 'その他'];
  function rejectSheet(id) {
    const r = info().pending.find(x => x.id === id); if (!r) return;
    let sel = '';
    const wrap = sheet('申請を却下しますか？',
      '<p class="mm-sheet-p">' + esc(r.label) + '「' + esc(r.value) + '」（' + esc(r.who) + '）を却下します。</p><p class="mm-sheet-p">理由を選んでください（確認のためのもので、保存はしません）。</p>' +
      '<div class="mm-reasons">' + REASONS.map(x => '<button type="button" class="mm-chip" data-r="' + x + '">' + x + '</button>').join('') + '</div>' +
      '<textarea class="mm-other" rows="2" placeholder="理由を入力" hidden></textarea>' +
      '<div class="mm-sheet-b"><button type="button" class="mm-btn" data-x>やめる</button><button type="button" class="mm-btn is-danger" data-go disabled>却下する</button></div>');
    const ok = wrap.querySelector('[data-go]'), ta = wrap.querySelector('.mm-other');
    const upd = () => { ok.disabled = !sel || (sel === 'その他' && !ta.value.trim()); };
    wrap.addEventListener('click', e => {
      const c = e.target.closest('[data-r]');
      if (c) { sel = c.dataset.r; wrap.querySelectorAll('[data-r]').forEach(b => b.classList.toggle('is-on', b === c)); ta.hidden = sel !== 'その他'; upd(); }
    });
    ta.addEventListener('input', upd);
    ok.addEventListener('click', async () => { closeSheet(); await window.statsDecideRequest(id, false); renderWork(); toast('却下しました'); });
  }

  // ---- 共通：シート・トースト ----
  function sheet(title, html) {
    closeSheet();
    const w = document.createElement('div'); w.className = 'sm-sheet-wrap mm-sheet-wrap'; w.id = 'mmSheet';
    w.innerHTML = '<div class="sm-sheet-bg"></div><div class="sm-sheet" role="dialog" aria-label="' + esc(title) + '"><div class="sm-sheet-head"><b>' + esc(title) + '</b><button type="button" class="sm-btn" data-x aria-label="閉じる">✕</button></div><div class="mm-sheet-body">' + html + '</div></div>';
    document.body.appendChild(w); document.body.classList.add('sm-sheet-open');
    w.addEventListener('click', e => { if (e.target.classList.contains('sm-sheet-bg') || e.target.closest('[data-x]')) closeSheet(); });
    return w;
  }
  function closeSheet() { const w = $('mmSheet'); if (w) w.remove(); document.body.classList.remove('sm-sheet-open'); }
  function toast(msg) {
    const o = document.querySelector('.mm-toast'); if (o) o.remove(); clearTimeout(undoT);
    const t = document.createElement('div'); t.className = 'sm-undo mm-toast'; t.innerHTML = '<span>' + esc(msg) + '</span>';
    document.body.appendChild(t); undoT = setTimeout(() => t.remove(), 4000);
  }

  // ---- 一覧（第 2 回）----
  function decorateList() {
    if (!mobile()) return;
    const p = $('statsPane-master'); if (!p) return;
    // 絞り込み・並び順ボタン（種別チップの次）
    p.querySelectorAll('.mm-fbtn').forEach(x => x.remove());
    const extra = [...p.querySelectorAll('.master-type-chips, .master-sort-chips')];
    const main = p.querySelector('.master-filter-chips:not(.master-type-chips):not(.master-sort-chips)');
    if (main) {
      const on = [];
      extra.forEach(row => row.querySelectorAll('.is-active').forEach(b => { const t = b.textContent.replace(/\d+$/, '').trim(); if (t && t !== 'すべて' && t !== '名前順') on.push(t); }));
      const b = document.createElement('button'); b.type = 'button'; b.className = 'mm-fbtn';
      b.innerHTML = '<span>絞り込み・並び順</span><small>' + esc(on.length ? on.join('・') : '指定なし') + '</small>';
      b.disabled = !extra.length; if (!extra.length) b.hidden = true;
      b.addEventListener('click', () => filterSheet(extra));
      main.after(b);
    }
    // カード：印は 3 つまで・先のお客様は畳む
    p.querySelectorAll('table.master-grid > tbody > tr:not(.master-tag-group-row)').forEach(tr => {
      if (tr.dataset.mmDone) return; tr.dataset.mmDone = '1';
      const nm = tr.querySelector(':scope > td.stats-val'); if (nm) {
        const marks = [...nm.children].filter(c => !c.matches('.master-name-toggle, .ua-star, .master-via-mark') && !/deal/.test(c.className) && !c.classList.contains('md-fold-chip'));
        if (marks.length > 3) { marks.slice(3).forEach(m => m.classList.add('mm-hide')); const mo = document.createElement('span'); mo.className = 'mm-more'; mo.textContent = '他 ' + (marks.length - 3); nm.appendChild(mo); }
      }
      const nest = tr.querySelector(':scope > td.master-nest-cell');
      if (nest) { const n = nest.querySelectorAll('tbody > tr').length; const bt = document.createElement('button'); bt.type = 'button'; bt.className = 'mm-nestbtn'; bt.textContent = '🔗 先のお客様 ' + n + '社を見る ›'; bt.addEventListener('click', () => nest.classList.toggle('mm-nest-open')); nest.prepend(bt); }
    });
  }
  function filterSheet(rows) {
    const h = rows.map(row => {
      const lab = (row.querySelector('.master-type-chips-label') || {}).textContent || '';
      const bs = [...row.querySelectorAll('button')].map(b => '<button type="button" class="mm-chip' + (b.classList.contains('is-active') ? ' is-on' : '') + '" data-i="' + [...row.querySelectorAll('button')].indexOf(b) + '">' + esc(b.textContent) + '</button>').join('');
      return '<div class="mm-fsec"><p class="mm-fl">' + esc(lab.replace(/：$/, '')) + '</p><div class="mm-reasons" data-row="' + rows.indexOf(row) + '">' + bs + '</div></div>';
    }).join('');
    const w = sheet('絞り込み・並び順', h + '<div class="mm-sheet-b"><button type="button" class="mm-btn is-primary" data-x>この条件で見る</button></div>');
    w.addEventListener('click', e => {
      const c = e.target.closest('[data-i]'); if (!c) return;
      const row = rows[+c.parentElement.dataset.row]; const btn = row && row.querySelectorAll('button')[+c.dataset.i];
      if (btn) { closeSheet(); btn.click(); }
    });
  }
  // 「⋯」：行の元ボタンへ委譲する下からのシート
  function moreSheet(btn) {
    const tr = btn.closest('tr'); if (!tr) return;
    const f = tr.dataset.mfield, v = tr.dataset.mvalue;
    const items = [];
    const q = s => tr.querySelector(s);
    if (q('.stats-master-abbrev-add')) items.push(['＋ 別名を追加', () => q('.stats-master-abbrev-add').click()]);
    if (q('.stats-master-merge')) items.push(['他のマスターにまとめる', () => q('.stats-master-merge').click()]);
    if (q('.stats-master-rename')) items.push(['名称を変更', () => q('.stats-master-rename').click()]);
    if (typeof window.statsShowUsage === 'function') items.push(['使用案件の確認', () => window.statsShowUsage(f, v, null, { info: true })]);
    const grp = tr.classList.contains('stats-syn-row');
    if (grp) items.push(['別名をすべて外す…', () => window.statsConfirmRemoveGroup(f, v), 'danger']);
    items.push(['マスターから削除…', () => window.statsMasterRemove(f, v), 'danger']);
    const w = sheet(v, items.map((it, k) => '<button type="button" class="mm-menu' + (it[2] ? ' is-danger' : '') + '" data-k="' + k + '">' + esc(it[0]) + '</button>').join(''));
    w.addEventListener('click', e => { const c = e.target.closest('[data-k]'); if (!c) return; closeSheet(); setTimeout(items[+c.dataset.k][1], 0); });
  }
  document.addEventListener('click', e => {
    if (!mobile()) return;
    const b = e.target.closest && e.target.closest('#statsPane-master .master-ops-more');
    if (b) { e.preventDefault(); e.stopImmediatePropagation(); moreSheet(b); }
  }, true);

  function init() {
    if (!mobile()) return;
    build(); show('home');
  }
  // マスター管理タブを開くたび（initMasterTab）に、スマホ幅なら「今日やること」から入る
  function hook() {
    const it = window.initMasterTab;
    if (typeof it !== 'function' || it.__mm) return false;
    const w = async function () { const r = await it.apply(this, arguments); init(); return r; };
    w.__mm = true; window.initMasterTab = w; return true;
  }
  if (!hook()) window.addEventListener('load', hook);
  // 再描画に追従
  const pane = () => $('statsPane-master');
  function watch() {
    const p = pane(); if (!p) return setTimeout(watch, 500);
    const mo = new MutationObserver(() => { if (mobile() && built) { mo.disconnect(); try { decorateList(); if (view === 'home') renderHome(); } finally { mo.takeRecords(); mo.observe(p, { childList: true }); } } });
    mo.observe(p, { childList: true });
  }
  watch();
  window.addEventListener('load', () => { const o = window.driftRenderCard; if (typeof o === 'function' && !o.__mm) { const w = function () { const r = o.apply(this, arguments); window.mmOnDriftRender(); return r; }; w.__mm = true; window.driftRenderCard = w; } });
  window.mmOnDriftRender = function () { if (mobile() && built) { if (view === 'home') renderHome(); if (view === 'work') { renderWork(); if (wtab === 'drift') openDriftSecs(); } } };
  const onMq = () => { const r = root(); if (!r) return; if (!mobile()) { r.classList.remove('mm-on', 'mm-view-home', 'mm-view-work', 'mm-view-list', 'mm-view-alias', 'mm-wtab-drift'); } else if (built) show(view); };
  (mq.addEventListener ? mq.addEventListener('change', onMq) : mq.addListener(onMq));
  window.mmShow = show;
})();
