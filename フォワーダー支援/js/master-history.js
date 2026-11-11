// 🕘 マスターの変更履歴（読み取り専用）
// 設計思想：docs/設計思想-共同で育てる知識.md（③改ざん耐性 ④透明性）・案：docs/マスター履歴-設計案.md
//
// 表 master_history（docs/sql/master-history.sql）を読んで「いつ・誰が・何を・どう変えたか」を一覧する。
//   ・書き込みは一切しない（履歴は DB のトリガーだけが追記する）
//   ・SQL を実行していない環境では、案内を出すだけ（他の機能には影響しない）
//   ・入口：①マスター管理の絞り込みの行の「🕘 履歴」 ②マスターの詳細ポップアップの「🕘 この名前の履歴」
//   ・stats.js は変更しない（画面の出来上がりを見て、入口のボタンを足す）
(function () {
  'use strict';

  const PAGE = 50;
  const FIELD_LABEL = { customer: 'お客様', sv: 'サブコン', nm: '品名', port: '港', un: '単位', carrier: 'キャリア' };
  const TABLE_LABEL = {
    master_votes: 'マスター登録', synonym_groups: '別名', master_details: '詳細',
    master_attachments: '添付', master_requests: '申請', alias_rules: '是正ルール',
  };
  const ACTION = {
    INSERT: { cls: 'ins', label: '追加' }, UPDATE: { cls: 'upd', label: '変更' },
    DELETE: { cls: 'del', label: '削除' }, BASELINE: { cls: 'base', label: '出発点' },
  };
  // 詳細（master_details.details）の項目名。ここに無い項目は、項目名のまま出す
  const DETAIL_KEY = {
    kana: 'ふりがな', enName: '英語名', dealType: '取引形態', via: '経由する同業者', group: '所属グループ',
    country: '国', svTypes: 'サブコン種別', areas: '得意エリア', contacts: '担当者', website: 'ウェブサイト',
    tags: 'タグ', memo: 'メモ', defaultUnit: '既定の単位', defaultCat: '既定のカテゴリ', phone: '電話', address: '所在地',
  };
  const DEAL_LABEL = { ship: '荷主', fwd: '同業者', agent: '海外代理店', other: 'その他' };

  const st = { field: 'all', action: 'all', q: '', who: '', base: false, rows: [], more: false, loading: false, err: '' };

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const likeEsc = (s) => String(s).replace(/[\\%_]/g, (c) => '\\' + c);

  function whoName(email) {
    if (!email) return '不明';
    if (String(email).indexOf('system:') === 0) return String(email) === 'system:baseline' ? 'システム（出発点の記録）' : 'システム（DB から直接）';
    return typeof window.quoteDisplayName === 'function' ? window.quoteDisplayName(email) : String(email).split('@')[0];
  }
  function fmtTime(ts) {
    const d = new Date(ts);
    if (isNaN(d)) return esc(ts);
    return d.toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  // ---------- 値の見せ方 ----------
  function fmtVal(key, v) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '（空）';
    if (key === 'dealType') return DEAL_LABEL[v] || String(v);
    if (key === 'country') return typeof window.countryLabel === 'function' ? window.countryLabel(v) : String(v);
    if (key === 'contacts' && Array.isArray(v)) return '担当者 ' + v.length + ' 名' + (v.length ? '（' + v.map((c) => c && c.name).filter(Boolean).join('、') + '）' : '');
    if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join('、');
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }
  const clip = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);
  const same = (a, b) => JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b);

  const line = (cls, html) => `<div class="mh-line mh-${cls}">${html}</div>`;
  const change = (name, o, n) =>
    line('chg', `<span class="mh-k">${esc(name)}</span><span class="mh-old">${esc(clip(o, 120))}</span><span class="mh-arrow">→</span><span class="mh-new">${esc(clip(n, 120))}</span>`);

  // 1 件の履歴を「何が起きたか」の文と、変更の中身の行にする
  function describe(h) {
    const o = h.old_data || {}, n = h.new_data || {};
    const snap = h.new_data || h.old_data || {};
    const lines = [];
    let title = '';
    switch (h.source_table) {
      case 'master_votes':
        title = h.action === 'INSERT' ? 'マスターに登録' : h.action === 'DELETE' ? 'マスターから解除' : h.action === 'BASELINE' ? 'マスターとして登録済み' : 'マスターの登録を更新';
        break;
      case 'synonym_groups': {
        const oa = Array.isArray(o.aliases) ? o.aliases : [], na = Array.isArray(n.aliases) ? n.aliases : [];
        if (h.action === 'INSERT') { title = '別名グループを作成'; na.forEach((a) => lines.push(line('add', '＋ 別名：' + esc(a)))); }
        else if (h.action === 'DELETE') { title = '別名グループを削除'; oa.forEach((a) => lines.push(line('del', '－ 別名：' + esc(a)))); }
        else if (h.action === 'BASELINE') { title = '別名つきで登録済み'; na.forEach((a) => lines.push(line('add', '別名：' + esc(a)))); }
        else {
          title = '別名を変更';
          if (o.canonical !== n.canonical) lines.push(change('代表名', o.canonical || '', n.canonical || ''));
          na.filter((a) => oa.indexOf(a) < 0).forEach((a) => lines.push(line('add', '＋ 別名：' + esc(a))));
          oa.filter((a) => na.indexOf(a) < 0).forEach((a) => lines.push(line('del', '－ 別名：' + esc(a))));
        }
        break;
      }
      case 'master_details': {
        const od = o.details || {}, nd = n.details || {};
        if (h.action === 'INSERT' || h.action === 'BASELINE') {
          title = h.action === 'INSERT' ? '詳細を登録' : '詳細つきで登録済み';
          Object.keys(nd).filter((k) => !same(nd[k], '')).forEach((k) => lines.push(line('add', `<span class="mh-k">${esc(DETAIL_KEY[k] || k)}</span>${esc(clip(fmtVal(k, nd[k]), 120))}`)));
        } else if (h.action === 'DELETE') {
          title = '詳細を削除';
          Object.keys(od).filter((k) => !same(od[k], '')).forEach((k) => lines.push(line('del', `<span class="mh-k">${esc(DETAIL_KEY[k] || k)}</span>${esc(clip(fmtVal(k, od[k]), 120))}`)));
        } else {
          title = '詳細を変更';
          Object.keys(Object.assign({}, od, nd)).forEach((k) => { if (!same(od[k], nd[k])) lines.push(change(DETAIL_KEY[k] || k, fmtVal(k, od[k]), fmtVal(k, nd[k]))); });
        }
        break;
      }
      case 'master_attachments':
        title = h.action === 'INSERT' ? '添付を追加' : h.action === 'DELETE' ? '添付を削除' : h.action === 'BASELINE' ? '添付つきで登録済み' : '添付を更新';
        if (snap.file_name) lines.push(line(h.action === 'DELETE' ? 'del' : 'add', '📎 ' + esc(snap.file_name)));
        break;
      case 'master_requests': {
        const kind = snap.alias_of ? '別名（' + snap.alias_of + '）の追加' : 'マスター登録';
        if (h.action === 'INSERT') title = kind + 'を申請';
        else if (h.action === 'DELETE') title = kind + 'の申請を取り下げ・削除';
        else if (h.action === 'BASELINE') title = kind + 'の申請（' + (n.status || '') + '）';
        else {
          const s = { approved: '承認', rejected: '却下', pending: '申請中に戻す' }[n.status] || '更新';
          title = kind + 'の申請を' + s;
          if (n.decided_by) lines.push(line('chg', '判断した人：' + esc(whoName(n.decided_by))));
        }
        if (snap.requested_by) lines.push(line('chg', '申請した人：' + esc(whoName(snap.requested_by))));
        break;
      }
      case 'alias_rules':
        title = { INSERT: '是正ルールを追加', DELETE: '是正ルールを削除', UPDATE: '是正ルールを変更', BASELINE: '是正ルール（登録済み）' }[h.action] || '是正ルール';
        if (snap.from_value != null) lines.push(line(h.action === 'DELETE' ? 'del' : 'chg', esc(snap.from_value) + ' → ' + esc(snap.to_value)));
        break;
      default:
        title = TABLE_LABEL[h.source_table] || h.source_table;
    }
    return { title, lines };
  }

  // ---------- 取得 ----------
  async function fetchPage(reset) {
    const db = window.SupabaseClient;
    if (!db) { st.err = 'DB への接続がまだ準備できていません。ログインしてから開き直してください。'; return; }
    st.loading = true; st.err = '';
    render();
    let q = db.from('master_history').select('*').order('id', { ascending: false }).limit(PAGE + 1);
    if (st.field !== 'all') q = q.eq('field', st.field);
    if (st.action !== 'all') q = q.eq('action', st.action);
    else if (!st.base) q = q.neq('action', 'BASELINE');
    if (st.q.trim()) q = q.ilike('value', '%' + likeEsc(st.q.trim()) + '%');
    if (st.who.trim()) q = q.ilike('changed_by', '%' + likeEsc(st.who.trim()) + '%');
    if (!reset && st.rows.length) q = q.lt('id', st.rows[st.rows.length - 1].id);
    const { data, error } = await q;
    st.loading = false;
    if (error) {
      const m = String(error.message || '');
      st.err = /master_history|does not exist|schema cache|42P01|PGRST205/i.test(m) ? 'NOSQL' : m;
      if (reset) st.rows = [];
      st.more = false;
      render();
      return;
    }
    const rows = data || [];
    st.more = rows.length > PAGE;
    const page = rows.slice(0, PAGE);
    st.rows = reset ? page : st.rows.concat(page);
    render();
  }

  // ---------- 画面 ----------
  function modal() { return document.getElementById('mhModal'); }

  function itemHtml(h, i) {
    const a = ACTION[h.action] || { cls: '', label: h.action || '' };
    const d = describe(h);
    const isMarker = h.action === 'BASELINE' && !h.row_id;
    const name = h.value || (isMarker ? '（' + (TABLE_LABEL[h.source_table] || h.source_table) + '）' : '（名前なし）');
    const raw = JSON.stringify({ 操作: h.action, 表: h.source_table, 変更前: h.old_data, 変更後: h.new_data }, null, 1);
    return `<div class="mh-item">
      <div class="mh-row1">
        <span class="mh-act mh-act-${a.cls}">${esc(a.label)}</span>
        ${h.field ? `<span class="mh-field">${esc(FIELD_LABEL[h.field] || h.field)}</span>` : ''}
        <button type="button" class="mh-name" data-i="${i}" title="この名前の経緯だけを見る">${esc(name)}</button>
        <span class="mh-what">${esc(isMarker ? '出発点を記録（' + (h.new_data && h.new_data.baseline_rows != null ? h.new_data.baseline_rows + ' 件' : '') + '）' : d.title)}</span>
        <span class="mh-tbl">${esc(TABLE_LABEL[h.source_table] || h.source_table)}</span>
      </div>
      <div class="mh-row2"><span class="mh-who">${esc(whoName(h.changed_by))}</span><span class="mh-when">${fmtTime(h.changed_at)}</span></div>
      ${d.lines.length ? `<div class="mh-body">${d.lines.join('')}</div>` : ''}
      ${isMarker ? '' : `<details class="mh-raw"><summary>元の記録を見る</summary><pre>${esc(clip(raw, 4000))}</pre></details>`}
    </div>`;
  }

  function render() {
    const m = modal(); if (!m) return;
    const list = m.querySelector('#mhList'), foot = m.querySelector('#mhFoot');
    if (st.err === 'NOSQL') {
      list.innerHTML = '<div class="mh-empty">🕘 変更履歴の機能は、まだ有効になっていません。<br><small>管理者が Supabase の SQL Editor で <code>docs/sql/master-history.sql</code> を実行すると、この日以降のマスターの変更が自動で記録されます。</small></div>';
      foot.innerHTML = ''; return;
    }
    if (st.err) { list.innerHTML = '<div class="mh-empty">⚠️ 読み込めませんでした：' + esc(st.err) + '</div>'; foot.innerHTML = ''; return; }
    if (st.loading && !st.rows.length) { list.innerHTML = '<div class="mh-empty">読み込み中…</div>'; foot.innerHTML = ''; return; }
    if (!st.rows.length) {
      list.innerHTML = '<div class="mh-empty">条件に合う履歴はありません。<br><small>履歴は、記録の機能を有効にした日から残ります（それ以前の変更は「出発点」として現在の内容だけが残ります）。</small></div>';
      foot.innerHTML = ''; return;
    }
    list.innerHTML = st.rows.map(itemHtml).join('');
    foot.innerHTML = `<span class="mh-count">${st.rows.length} 件を表示${st.more ? '（さらに古い履歴があります）' : ''}</span>` +
      (st.more ? `<button type="button" class="mh-more" data-act="more"${st.loading ? ' disabled' : ''}>${st.loading ? '読み込み中…' : 'もっと見る'}</button>` : '');
  }

  function build() {
    const fieldOpts = '<option value="all">すべての種別</option>' + Object.keys(FIELD_LABEL).map((k) => `<option value="${k}">${FIELD_LABEL[k]}</option>`).join('');
    const actOpts = '<option value="all">すべての操作</option>' + ['INSERT', 'UPDATE', 'DELETE', 'BASELINE'].map((k) => `<option value="${k}">${ACTION[k].label}</option>`).join('');
    const el = document.createElement('div');
    el.id = 'mhModal'; el.className = 'md-modal-overlay mh-overlay';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'マスターの変更履歴');
    el.innerHTML = `<div class="md-modal mh-box">
      <div class="md-modal-head"><h3>🕘 マスターの変更履歴</h3><button type="button" class="md-modal-close" data-act="close" title="閉じる（Esc）">✕</button></div>
      <div class="mh-note">読み取り専用です。履歴は追記のみで、書き換え・削除はできません。誰が・いつ・何を変えたかをチーム全員で確認できます。</div>
      <div class="mh-filters">
        <select id="mhField" aria-label="種別">${fieldOpts}</select>
        <select id="mhAction" aria-label="操作">${actOpts}</select>
        <input id="mhQ" type="search" placeholder="名前で絞り込み（例：会社名・品名）" aria-label="名前で絞り込み" autocomplete="off">
        <input id="mhWho" type="search" placeholder="変更した人（メール）" aria-label="変更した人" autocomplete="off">
        <label class="mh-base"><input id="mhBase" type="checkbox"> 出発点（記録を始めた時点の内容）も表示</label>
      </div>
      <div class="md-modal-body mh-list" id="mhList"></div>
      <div class="mh-foot" id="mhFoot"></div>
    </div>`;
    document.body.appendChild(el);

    let timer = 0;
    const reload = () => { fetchPage(true); };
    el.addEventListener('click', (e) => {
      if (e.target === el) return close();
      const t = e.target.closest('[data-act],.mh-name'); if (!t) return;
      if (t.dataset.act === 'close') close();
      else if (t.dataset.act === 'more') fetchPage(false);
      else if (t.classList.contains('mh-name')) {
        const h = st.rows[+t.dataset.i]; if (!h || !h.value) return;
        st.q = h.value; if (h.field) st.field = h.field;
        sync(); reload();
      }
    });
    el.querySelector('#mhField').addEventListener('change', (e) => { st.field = e.target.value; reload(); });
    el.querySelector('#mhAction').addEventListener('change', (e) => { st.action = e.target.value; reload(); });
    el.querySelector('#mhBase').addEventListener('change', (e) => { st.base = e.target.checked; reload(); });
    const typed = (id, key) => el.querySelector(id).addEventListener('input', (e) => {
      st[key] = e.target.value;
      if (e.isComposing) return;   // 日本語の変換中は読み込まない
      clearTimeout(timer); timer = setTimeout(reload, 350);
    });
    typed('#mhQ', 'q'); typed('#mhWho', 'who');
    el.addEventListener('compositionend', () => { clearTimeout(timer); timer = setTimeout(reload, 150); });
    return el;
  }

  function sync() {
    const m = modal(); if (!m) return;
    m.querySelector('#mhField').value = st.field; m.querySelector('#mhAction').value = st.action;
    m.querySelector('#mhQ').value = st.q; m.querySelector('#mhWho').value = st.who; m.querySelector('#mhBase').checked = st.base;
  }

  function close() {
    const m = modal(); if (m) m.remove();
    document.body.classList.remove('mh-open');
  }

  // opts = { field, value }：その名前の経緯だけを開く
  window.mhOpen = function (opts) {
    opts = opts || {};
    close();
    Object.assign(st, { field: opts.field || 'all', action: 'all', q: opts.value || '', who: '', base: false, rows: [], more: false, err: '' });
    build(); sync();
    document.body.classList.add('mh-open');
    fetchPage(true);
  };
  window.mhClose = close;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal()) { e.stopPropagation(); close(); } }, true);

  // ---------- 入口のボタン ----------
  // ①マスター管理：絞り込みチップの行の末尾（画面を描き直すたびに付け直す）
  function addEntry() {
    const pane = document.getElementById('statsPane-master'); if (!pane) return;
    const chips = pane.querySelector('.master-filter-chips');
    if (!chips || chips.querySelector('.mh-open-btn')) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'mh-open-btn';
    b.title = 'マスターの追加・変更・削除の履歴を見る（読み取り専用）';
    b.textContent = '🕘 履歴';
    b.addEventListener('click', () => window.mhOpen({}));
    chips.appendChild(b);
  }
  let scheduled = false;
  function schedule() { if (scheduled) return; scheduled = true; requestAnimationFrame(() => { scheduled = false; addEntry(); }); }
  function watch() {
    const pane = document.getElementById('statsPane-master'); if (!pane) return;
    new MutationObserver(schedule).observe(pane, { childList: true, subtree: true });
    addEntry();
  }

  // ②マスターの詳細ポップアップ：その名前の履歴（ポップアップを開く関数を包んで、開いた名前を覚える）
  function wrapDetail() {
    const orig = window.statsToggleMasterDetail;
    if (typeof orig !== 'function' || orig.__mh) return;
    const wrapped = function (field, value) {
      const r = orig.apply(this, arguments);
      try {
        const head = document.querySelector('#mdDetailModal .md-modal-head');
        if (head && !head.querySelector('.mh-detail-btn')) {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'mh-detail-btn';
          b.textContent = '🕘 この名前の履歴';
          b.title = 'この名前の追加・変更・削除の経緯を見る（読み取り専用）';
          b.addEventListener('click', () => window.mhOpen({ field, value }));
          head.insertBefore(b, head.querySelector('.md-modal-close'));
        }
      } catch (e) { /* 入口のボタンが付かなくても、詳細ポップアップ自体には影響しない */ }
      return r;
    };
    wrapped.__mh = true;
    window.statsToggleMasterDetail = wrapped;
  }

  function init() { watch(); wrapDetail(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.addEventListener('load', wrapDetail);
})();
