/* announcements.js — 📢 管理者からメンバーへの「お知らせ」
 *
 *   ・表示：ヘッダーの下に「お知らせバー」（#annBar）。表示期間内のお知らせを、重要なものから並べる。
 *           メンバーは ✕ で閉じられる（端末に記憶。管理者が内容を直すと、閉じた人にも再び出る）。
 *   ・管理：チーム管理（🧑‍💼）の「お知らせ」タブ（管理者のみ）。投稿・編集・終了・削除。
 *   ・保存：Supabase の announcements テーブル（docs/sql/announcements.sql）。閲覧＝チームメンバー全員／書き込み＝管理者のみ（RLS）。
 *           SQL が未実行でもアプリは動く（お知らせが出ず、管理画面に案内が出るだけ）。
 *   ・呼び出し：users.js の umOnAuth（ログイン／ログアウト時）から annOnAuth(user)。
 */
(function () {
  'use strict';

  const LV = {
    info:        { label: 'お知らせ',     ic: '📢' },
    important:   { label: '重要',         ic: '❗' },
    maintenance: { label: 'メンテナンス', ic: '🛠️' },
  };
  const LV_ORDER = { important: 0, maintenance: 1, info: 2 };
  const DISMISS_KEY = 'annDismissed_v1';    // { お知らせid: updated_at }（内容を直すと updated_at が変わり、再び出る）
  const SEEN_KEY = 'annSeen_v1';            // { お知らせid: updated_at }（新着のトーストを 1 回だけ出すため）

  let _rows = [];
  let _user = null;
  let _admin = false;
  let _tableMissing = false;
  let _showClosed = false;
  let _editId = null;
  let _loadedAt = 0;
  let _first = true;

  const $ = id => document.getElementById(id);
  const db = () => window.SupabaseClient || null;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m, t, ms) => { if (typeof quoteShowToast === 'function') quoteShowToast(m, t, ms); };
  function readMap(k) { try { return JSON.parse(localStorage.getItem(k) || '{}') || {}; } catch (e) { return {}; } }
  function writeMap(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso); if (isNaN(d)) return '';
    return d.getFullYear() + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0');
  }
  function fmtDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso); if (isNaN(d)) return '';
    return fmtDate(iso) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  // 本文：改行はそのまま・http(s) のアドレスだけリンクにする（それ以外の HTML は出さない）
  function linkify(text) {
    const s = String(text == null ? '' : text);
    let out = '', last = 0, m;
    const re = /https?:\/\/[^\s<>"'）)]+/g;
    while ((m = re.exec(s))) {
      out += esc(s.slice(last, m.index));
      out += '<a href="' + esc(m[0]) + '" target="_blank" rel="noopener noreferrer">' + esc(m[0]) + '</a>';
      last = m.index + m[0].length;
    }
    return out + esc(s.slice(last));
  }

  // ---------- 状態 ----------
  function statusOf(r, now) {
    now = now || Date.now();
    if (new Date(r.starts_at).getTime() > now) return 'scheduled';
    if (r.ends_at && new Date(r.ends_at).getTime() <= now) return 'ended';
    return 'active';
  }
  function activeRows() {
    const now = Date.now();
    return _rows.filter(r => statusOf(r, now) === 'active')
      .sort((a, b) => (LV_ORDER[a.level] - LV_ORDER[b.level]) || (String(b.starts_at) < String(a.starts_at) ? -1 : 1));
  }
  const isClosed = r => readMap(DISMISS_KEY)[r.id] === r.updated_at;

  // ---------- 読み込み ----------
  async function load(fromAction) {
    const client = db();
    if (!client || !_user) return;
    _loadedAt = Date.now();
    let res;
    try { res = await client.from('announcements').select('*').order('starts_at', { ascending: false }).limit(100); }
    catch (e) { res = { error: e }; }
    if (res.error) {
      const m = String(res.error.message || '') + ' ' + String(res.error.code || '');
      _tableMissing = /42P01|PGRST205|does not exist|schema cache/i.test(m);
      _rows = [];
    } else {
      _tableMissing = false;
      _rows = res.data || [];
    }
    renderBar();
    if (_first) { _first = false; notifyNew(false); } else notifyNew(true);
    // 管理画面を開いている間の自動更新で、入力途中の文章を消さない（投稿・編集・削除の直後は必ず描き直す）
    if ($('umAnnPane') && !$('umAnnPane').hidden && (fromAction === true || !formDirty())) renderAdmin();
  }
  function formDirty() {
    const t = $('annFTitle'), b = $('annFBody');
    return !!((t && t.value.trim()) || (b && b.value.trim()));
  }

  // 新しく出たお知らせを、ページを開いたまま見ている人にも気づかせる（トースト・1 つのお知らせにつき 1 回）
  function notifyNew(silentFirst) {
    const seen = readMap(SEEN_KEY);
    const fresh = activeRows().filter(r => seen[r.id] !== r.updated_at && !isClosed(r));
    activeRows().forEach(r => { seen[r.id] = r.updated_at; });
    writeMap(SEEN_KEY, seen);
    if (silentFirst && fresh.length) toast('📢 新しいお知らせがあります（' + fresh.length + '件）。画面上部をご覧ください', 'info', 6000);
  }

  // ---------- お知らせバー ----------
  function ensureBar() {
    let bar = $('annBar');
    if (bar) return bar;
    bar = document.createElement('div');
    bar.id = 'annBar';
    bar.className = 'ann-bar';
    bar.hidden = true;
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', '管理者からのお知らせ');
    const header = document.querySelector('.app > .header');
    if (header && header.parentNode) header.parentNode.insertBefore(bar, header.nextSibling);
    else document.body.insertBefore(bar, document.body.firstChild);
    bar.addEventListener('click', onBarClick);
    return bar;
  }
  function renderBar() {
    const bar = ensureBar();
    if (!_user) { bar.hidden = true; bar.innerHTML = ''; return; }
    const act = activeRows();
    const shown = act.filter(r => _showClosed || !isClosed(r));
    const closedN = act.filter(isClosed).length;
    if (!shown.length && !closedN) { bar.hidden = true; bar.innerHTML = ''; return; }
    bar.hidden = false;
    bar.innerHTML = shown.map(r => {
      const lv = LV[r.level] || LV.info;
      return '<div class="ann-item ann-lv-' + esc(r.level) + '" data-id="' + esc(r.id) + '" role="note">' +
        '<span class="ann-ic" aria-hidden="true">' + lv.ic + '</span>' +
        '<div class="ann-main">' +
          '<div class="ann-head"><span class="ann-tag">' + esc(lv.label) + '</span><b class="ann-title">' + esc(r.title) + '</b>' +
            '<small class="ann-meta">' + esc(fmtDate(r.starts_at)) + '</small></div>' +
          (r.body ? '<div class="ann-body">' + linkify(r.body) + '</div>' : '') +
        '</div>' +
        '<button type="button" class="ann-x" data-act="close" aria-label="このお知らせを閉じる" title="閉じる（管理者が内容を直すと、また表示されます）">✕</button>' +
      '</div>';
    }).join('') +
    (closedN ? '<button type="button" class="ann-toggle" data-act="toggle">' +
      (_showClosed ? '閉じたお知らせを隠す' : '閉じたお知らせ ' + closedN + ' 件を表示') + '</button>' : '');
  }
  function onBarClick(e) {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    if (t.dataset.act === 'toggle') { _showClosed = !_showClosed; renderBar(); return; }
    if (t.dataset.act === 'close') {
      const item = t.closest('.ann-item');
      const r = _rows.find(x => x.id === (item && item.dataset.id));
      if (!r) return;
      const map = readMap(DISMISS_KEY); map[r.id] = r.updated_at; writeMap(DISMISS_KEY, map);
      renderBar();
    }
  }

  // ---------- 管理（チーム管理の「お知らせ」タブ・管理者のみ） ----------
  function toLocalInput(iso) {
    if (!iso) return '';
    const d = new Date(iso); if (isNaN(d)) return '';
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function fromLocalInput(v) {
    if (!v) return null;
    const d = new Date(v); return isNaN(d) ? null : d.toISOString();
  }
  function renderAdmin() {
    const pane = $('umAnnPane');
    if (!pane) return;
    if (!_admin) { pane.innerHTML = '<div class="um-empty">お知らせの投稿は管理者のみ行えます。</div>'; return; }
    if (_tableMissing) {
      pane.innerHTML = '<div class="ann-admin"><div class="um-empty">⚠️ お知らせの保存先（announcements テーブル）がまだありません。<br>' +
        'Supabase の SQL Editor で <code>docs/sql/announcements.sql</code> を実行してください。</div></div>';
      return;
    }
    const editing = _rows.find(r => r.id === _editId) || null;
    const lvOpts = Object.keys(LV).map(k => '<option value="' + k + '"' + (editing && editing.level === k ? ' selected' : '') + '>' + LV[k].ic + ' ' + LV[k].label + '</option>').join('');
    const now = Date.now();
    const list = _rows.map(r => {
      const st = statusOf(r, now), lv = LV[r.level] || LV.info;
      const stLabel = st === 'active' ? '表示中' : st === 'scheduled' ? '予約' : '終了';
      const period = fmtDateTime(r.starts_at) + ' 〜 ' + (r.ends_at ? fmtDateTime(r.ends_at) : '（終了日なし）');
      return '<div class="ann-row ann-row--' + st + '" data-id="' + esc(r.id) + '">' +
        '<div class="ann-row-main"><span class="ann-st ann-st--' + st + '">' + stLabel + '</span>' +
          '<span class="ann-tag ann-lv-' + esc(r.level) + '">' + esc(lv.label) + '</span><b>' + esc(r.title) + '</b>' +
          '<div class="ann-row-sub">' + esc(period) + '</div></div>' +
        '<div class="ann-row-btns">' +
          '<button type="button" class="um-btn-sm" data-act="edit">編集</button>' +
          (st !== 'ended' ? '<button type="button" class="um-btn-sm" data-act="end" title="いまの時刻で表示を終了します">終了にする</button>' : '') +
          '<button type="button" class="um-btn-sm um-btn-danger" data-act="del">削除</button>' +
        '</div></div>';
    }).join('');
    pane.innerHTML = '<div class="ann-admin">' +
      '<p class="ann-lead">全メンバーの画面の上部に表示されます。メンバーは ✕ で閉じられますが、内容を直して保存すると、閉じた人にも再び表示されます。</p>' +
      '<div class="ann-form">' +
        '<div class="ann-form-title">' + (editing ? '✏️ お知らせを編集' : '＋ 新しいお知らせ') + '</div>' +
        '<input id="annFTitle" class="ann-in" maxlength="80" placeholder="見出し（例：11/20 22:00〜 メンテナンスのお知らせ）" value="' + esc(editing ? editing.title : '') + '">' +
        '<textarea id="annFBody" class="ann-in" rows="4" maxlength="2000" placeholder="本文（任意・URL はリンクになります）">' + esc(editing ? editing.body || '' : '') + '</textarea>' +
        '<div class="ann-form-row">' +
          '<label>種類 <select id="annFLevel" class="ann-in">' + lvOpts + '</select></label>' +
          '<label>表示開始 <input id="annFStart" type="datetime-local" class="ann-in" value="' + esc(toLocalInput(editing ? editing.starts_at : new Date().toISOString())) + '"></label>' +
          '<label>表示終了（空＝終了させるまで） <input id="annFEnd" type="datetime-local" class="ann-in" value="' + esc(editing ? toLocalInput(editing.ends_at) : '') + '"></label>' +
        '</div>' +
        '<div class="ann-form-btns">' +
          '<button type="button" class="um-invite-send" data-act="save">' + (editing ? '更新する' : '投稿する') + '</button>' +
          (editing ? '<button type="button" class="um-btn-sm" data-act="cancel">編集をやめる</button>' : '') +
        '</div>' +
      '</div>' +
      '<div class="ann-list-title">投稿済み（' + _rows.length + '件）</div>' +
      (list || '<div class="um-empty">まだお知らせはありません</div>') +
    '</div>';
  }
  async function save() {
    const title = ($('annFTitle').value || '').trim();
    const body = ($('annFBody').value || '').trim();
    const level = $('annFLevel').value;
    const starts = fromLocalInput($('annFStart').value) || new Date().toISOString();
    const ends = fromLocalInput($('annFEnd').value);
    if (!title) { toast('⚠️ 見出しを入力してください', 'warn'); $('annFTitle').focus(); return; }
    if (ends && new Date(ends) <= new Date(starts)) { toast('⚠️ 表示終了は、表示開始より後にしてください', 'warn'); return; }
    const client = db(); if (!client) return;
    const row = { title, body: body || null, level, starts_at: starts, ends_at: ends };
    const res = _editId
      ? await client.from('announcements').update(row).eq('id', _editId).select('id')
      : await client.from('announcements').insert(row).select('id');
    if (res.error) { toast('⚠️ 保存できませんでした：' + res.error.message, 'warn', 7000); return; }
    if (_editId && !(res.data && res.data.length)) { toast('🔒 更新する権限がありません（管理者のみ）', 'warn', 5000); return; }
    toast(_editId ? '✅ お知らせを更新しました' : '✅ お知らせを投稿しました', 'success', 3000);
    _editId = null;
    await load(true);
  }
  async function adminAction(act, id) {
    const client = db(); if (!client) return;
    const r = _rows.find(x => x.id === id);
    if (act === 'edit') { _editId = id; renderAdmin(); const t = $('annFTitle'); if (t) t.scrollIntoView({ block: 'nearest' }); return; }
    if (act === 'cancel') { _editId = null; renderAdmin(); return; }
    if (act === 'save') { save(); return; }
    if (!r) return;
    if (act === 'end') {
      const res = await client.from('announcements').update({ ends_at: new Date().toISOString() }).eq('id', id).select('id');
      if (res.error || !(res.data && res.data.length)) { toast('⚠️ 終了できませんでした' + (res.error ? '：' + res.error.message : ''), 'warn', 6000); return; }
      toast('✅ 表示を終了しました', 'success', 2500);
      await load(true);
    } else if (act === 'del') {
      const ok = typeof uiConfirm === 'function'
        ? await uiConfirm({ title: 'このお知らせを削除しますか？', lines: ['「' + r.title + '」を削除します。'], irreversible: '削除すると元に戻せません。表示を止めるだけなら「終了にする」を使ってください。', okLabel: '削除する', danger: true })
        : true;
      if (!ok) return;
      const res = await client.from('announcements').delete().eq('id', id).select('id');
      if (res.error || !(res.data && res.data.length)) { toast('⚠️ 削除できませんでした' + (res.error ? '：' + res.error.message : ''), 'warn', 6000); return; }
      if (_editId === id) _editId = null;
      toast('🗑 削除しました', 'success', 2500);
      await load(true);
    }
  }
  function bindAdmin() {
    const pane = $('umAnnPane');
    if (!pane || pane.dataset.bound) return;
    pane.dataset.bound = '1';
    pane.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b || !pane.contains(b)) return;
      const row = b.closest('.ann-row');
      adminAction(b.dataset.act, row ? row.dataset.id : null);
    });
  }

  // チーム管理のタブを開いたとき（users.js の switchUmTab から）
  function annAdminOpen() { bindAdmin(); renderAdmin(); if (_user && Date.now() - _loadedAt > 5000) load(); }

  // ---------- ログイン連携（users.js の umOnAuth から） ----------
  function annOnAuth(user) {
    _user = user || null;
    _admin = !!(user && window._myRole === 'admin');
    const tab = $('umTabAnn'); if (tab) tab.hidden = !_admin;
    if (!user) { _rows = []; _first = true; _editId = null; renderBar(); return; }
    load();
  }

  // 開いたままの画面にも反映：画面に戻ったとき（5 分以上あいていれば）と 10 分ごと
  window.addEventListener('focus', () => { if (_user && Date.now() - _loadedAt > 5 * 60 * 1000) load(); });
  setInterval(() => { if (_user && !document.hidden) load(); }, 10 * 60 * 1000);

  window.annOnAuth = annOnAuth;
  window.annAdminOpen = annAdminOpen;
  window.annReload = () => load(true);
})();
