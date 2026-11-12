/* org-teams.js — 🏢 組織とチーム（名簿の整理・ダッシュボードの絞り込み）
 *
 *   ・位置づけ：データの「見える範囲」は変えない（メンバー全員が全案件を見られる）。組織・チームは、
 *     メンバーの所属を整理し、案件を「誰の所属の案件か」で絞り込むためのもの。
 *       組織＝1 人が属するのは 1 つ ／ チーム＝組織の中に作る・1 人が複数に属してよい（同じ組織のチームだけ）
 *   ・読み込み：ログイン時（users.js の umOnAuth から otOnAuth）に 4 つの表を読み、window.orgDir に持つ。
 *   ・管理：チーム管理（🧑‍💼）の「🏢 組織・チーム」タブ（管理者のみ編集）。組織・チームの追加／名前変更／削除と、
 *     メンバーごとの所属（組織・チーム）の割り当て。
 *   ・使う側：cloud.js のダッシュボードの「全体／組織／チーム／自分」（orgDir.scopeMatch）。
 *   ・保存：docs/sql/org-teams.sql（organizations／teams／org_members／team_members）。未実行でもアプリは動く
 *     （orgDir.available()＝false → 「組織」「チーム」の絞り込みは出ない）。
 */
(function () {
  'use strict';

  let _avail = false;
  let _orgs = [];            // [{id, name}]
  let _teams = [];           // [{id, org_id, name}]
  let _orgOf = {};           // email(小文字) → org_id
  let _teamIdsOf = {};       // email(小文字) → [team_id]
  let _members = [];         // 管理画面用：[{email, name, role}]
  let _isAdmin = false;
  let _me = '';
  let _loadedAt = 0;

  const $ = id => document.getElementById(id);
  const db = () => window.SupabaseClient || null;
  const lc = s => String(s || '').trim().toLowerCase();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m, t, ms) => { if (typeof quoteShowToast === 'function') quoteShowToast(m, t, ms); };
  const byName = (a, b) => String(a.name).localeCompare(String(b.name), 'ja');

  // ---------- 読み込み ----------
  async function load() {
    const c = db();
    if (!c || !_me) return;
    _loadedAt = Date.now();
    try {
      const [o, t, om, tm] = await Promise.all([
        c.from('organizations').select('id,name').order('created_at', { ascending: true }),
        c.from('teams').select('id,org_id,name').order('created_at', { ascending: true }),
        c.from('org_members').select('email,org_id').limit(5000),
        c.from('team_members').select('team_id,email').limit(10000),
      ]);
      if (o.error || t.error || om.error || tm.error) throw (o.error || t.error || om.error || tm.error);
      _orgs = o.data || []; _teams = t.data || [];
      _orgOf = {}; _teamIdsOf = {};
      (om.data || []).forEach(r => { _orgOf[lc(r.email)] = r.org_id; });
      (tm.data || []).forEach(r => { const k = lc(r.email); (_teamIdsOf[k] = _teamIdsOf[k] || []).push(r.team_id); });
      _avail = true;
    } catch (e) {            // 表が無い（SQL 未実行）・権限なし：機能を出さない
      _avail = false; _orgs = []; _teams = []; _orgOf = {}; _teamIdsOf = {};
    }
    document.dispatchEvent(new CustomEvent('orgdir:loaded'));
    if ($('umOrgPane') && !$('umOrgPane').hidden) renderAdmin();
  }

  // ---------- 他の画面から使う窓口 ----------
  const memberEmailsOfOrg = orgId => Object.keys(_orgOf).filter(e => _orgOf[e] === orgId);
  const memberEmailsOfTeam = teamId => Object.keys(_teamIdsOf).filter(e => _teamIdsOf[e].includes(teamId));
  const myOrgId = () => _orgOf[_me] || '';
  const myTeamIds = () => (_teamIdsOf[_me] || []).slice();

  // 案件（作成者のメール）が、指定の範囲に入るか。scope＝'all'／'org'／'team'／'mine'、sel＝選んだ組織・チームの id（空＝自分の所属）
  function scopeMatch(creatorEmail, scope, sel) {
    const e = lc(creatorEmail);
    if (scope === 'all' || !scope) return true;
    if (scope === 'mine') return !!e && e === _me;
    if (!_avail) return true;
    if (scope === 'org') { const id = sel || myOrgId(); return !!id && _orgOf[e] === id; }
    if (scope === 'team') {
      const ids = sel ? [sel] : myTeamIds();
      return ids.length > 0 && (_teamIdsOf[e] || []).some(t => ids.includes(t));
    }
    return true;
  }

  window.orgDir = {
    available: () => _avail,
    orgs: () => _orgs.slice().sort(byName),
    teams: () => _teams.slice().sort(byName),
    orgName: id => (_orgs.find(o => o.id === id) || {}).name || '',
    teamName: id => (_teams.find(t => t.id === id) || {}).name || '',
    orgOf: email => _orgOf[lc(email)] || '',
    teamsOf: email => (_teamIdsOf[lc(email)] || []).slice(),
    myOrgId, myTeamIds,
    membersOfOrg: memberEmailsOfOrg, membersOfTeam: memberEmailsOfTeam,
    scopeMatch,
    reload: load,
  };

  // ---------- 管理画面（チーム管理の「組織・チーム」タブ） ----------
  function memberLabel(m) { return m.name && m.name !== m.email ? m.name : m.email.split('@')[0]; }

  function renderAdmin() {
    const pane = $('umOrgPane');
    if (!pane) return;
    if (!_avail) {
      pane.innerHTML = '<div class="ot-admin"><div class="um-empty">⚠️ 組織・チームの保存先がまだありません。<br>' +
        'Supabase の SQL Editor で <code>docs/sql/org-teams.sql</code> を実行してください。</div></div>';
      return;
    }
    const ro = !_isAdmin ? ' disabled' : '';
    const orgsHtml = _orgs.slice().sort(byName).map(o => {
      const teams = _teams.filter(t => t.org_id === o.id).sort(byName);
      const n = memberEmailsOfOrg(o.id).length;
      return '<section class="ot-org" data-org="' + esc(o.id) + '">' +
        '<div class="ot-org-head">🏢 <input class="ot-in ot-org-name" data-act="rename-org" value="' + esc(o.name) + '" maxlength="40" aria-label="組織名"' + ro + '>' +
          '<span class="ot-n">' + n + '人</span>' +
          (_isAdmin ? '<button type="button" class="um-btn-sm um-btn-danger" data-act="del-org">削除</button>' : '') + '</div>' +
        '<div class="ot-teams">' + (teams.map(t =>
          '<span class="ot-team" data-team="' + esc(t.id) + '">👥 <input class="ot-in ot-team-name" data-act="rename-team" value="' + esc(t.name) + '" maxlength="40" aria-label="チーム名"' + ro + '>' +
            '<span class="ot-n">' + memberEmailsOfTeam(t.id).length + '人</span>' +
            (_isAdmin ? '<button type="button" class="ot-x" data-act="del-team" title="このチームを削除" aria-label="このチームを削除">✕</button>' : '') + '</span>').join('') ||
          '<span class="ot-dim">チームはまだありません</span>') +
        (_isAdmin ? '<span class="ot-add"><input class="ot-in" placeholder="チーム名" maxlength="40" data-newteam="' + esc(o.id) + '" aria-label="新しいチーム名"><button type="button" class="um-btn-sm" data-act="add-team">＋ チーム</button></span>' : '') +
        '</div></section>';
    }).join('');

    const rows = _members.map(m => {
      const k = lc(m.email), oid = _orgOf[k] || '';
      const orgOpts = '<option value="">（未所属）</option>' + _orgs.slice().sort(byName).map(o => '<option value="' + esc(o.id) + '"' + (o.id === oid ? ' selected' : '') + '>' + esc(o.name) + '</option>').join('');
      const myTeams = _teams.filter(t => t.org_id === oid).sort(byName);
      const on = _teamIdsOf[k] || [];
      const chips = oid ? (myTeams.map(t => '<button type="button" class="ot-chip' + (on.includes(t.id) ? ' is-on' : '') + '" data-act="toggle-team" data-team="' + esc(t.id) + '" aria-pressed="' + on.includes(t.id) + '"' + ro + '>' + esc(t.name) + '</button>').join('') || '<span class="ot-dim">この組織にチームはありません</span>') : '<span class="ot-dim">先に組織を選んでください</span>';
      return '<tr data-email="' + esc(m.email) + '"><td class="ot-who"><b>' + esc(memberLabel(m)) + '</b><small>' + esc(m.email) + '</small></td>' +
        '<td><select class="ot-in" data-act="set-org" aria-label="所属する組織"' + ro + '>' + orgOpts + '</select></td><td class="ot-chips">' + chips + '</td></tr>';
    }).join('');

    pane.innerHTML = '<div class="ot-admin">' +
      '<p class="ot-lead">組織とチームは、メンバーの所属を整理し、ダッシュボードで案件を「全体／組織／チーム／自分」に絞り込むためのものです。案件の見える範囲は変わりません（メンバー全員が全案件を見られます）。</p>' +
      '<div class="ot-sec-title">組織とチーム' + (_isAdmin ? '<span class="ot-add"><input id="otNewOrg" class="ot-in" placeholder="新しい組織名" maxlength="40" aria-label="新しい組織名"><button type="button" class="um-btn-sm" data-act="add-org">＋ 組織</button></span>' : '') + '</div>' +
      (orgsHtml || '<div class="um-empty">組織がまだありません</div>') +
      '<div class="ot-sec-title">メンバーの所属</div>' +
      '<table class="ot-table"><thead><tr><th>メンバー</th><th>組織</th><th>チーム（複数可）</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="3" class="um-empty">メンバーがいません</td></tr>') + '</tbody></table></div>';
  }

  async function openAdmin() {
    bindAdmin();
    const pane = $('umOrgPane');
    if (pane && !pane.innerHTML) pane.innerHTML = '<div class="um-empty">読み込み中…</div>';
    try { if (typeof window.umLoadMembers === 'function') _members = await window.umLoadMembers(); } catch (e) { _members = []; }
    await load();
    renderAdmin();
  }

  async function run(p, okMsg) {
    const r = await p;
    if (r && r.error) { toast('⚠️ 保存できませんでした：' + r.error.message, 'warn', 7000); return false; }
    if (okMsg) toast(okMsg, 'success', 2200);
    await load();
    return true;
  }

  async function onAct(el) {
    const c = db(); if (!c || !_isAdmin) return;
    const act = el.dataset.act;
    const orgEl = el.closest('[data-org]'), teamEl = el.closest('[data-team]'), tr = el.closest('tr[data-email]');
    if (act === 'add-org') {
      const inp = $('otNewOrg'), name = (inp.value || '').trim();
      if (!name) { toast('⚠️ 組織名を入力してください', 'warn'); inp.focus(); return; }
      await run(c.from('organizations').insert({ name }), '✅ 組織「' + name + '」を追加しました');
    } else if (act === 'add-team') {
      const oid = orgEl.dataset.org, inp = orgEl.querySelector('[data-newteam]'), name = (inp.value || '').trim();
      if (!name) { toast('⚠️ チーム名を入力してください', 'warn'); inp.focus(); return; }
      await run(c.from('teams').insert({ org_id: oid, name }), '✅ チーム「' + name + '」を追加しました');
    } else if (act === 'del-org') {
      const o = _orgs.find(x => x.id === orgEl.dataset.org); if (!o) return;
      const ok = await uiConfirm({ title: '組織「' + o.name + '」を削除しますか？', lines: ['この組織のチームも削除され、所属していたメンバーは「未所属」になります。', '案件そのものは消えません。'], irreversible: '削除すると元に戻せません。', okLabel: '削除する', danger: true });
      if (ok) await run(c.from('organizations').delete().eq('id', o.id), '🗑 削除しました');
    } else if (act === 'del-team') {
      const t = _teams.find(x => x.id === teamEl.dataset.team); if (!t) return;
      const ok = await uiConfirm({ title: 'チーム「' + t.name + '」を削除しますか？', lines: ['このチームへの所属が外れます。案件そのものは消えません。'], irreversible: '削除すると元に戻せません。', okLabel: '削除する', danger: true });
      if (ok) await run(c.from('teams').delete().eq('id', t.id), '🗑 削除しました');
    } else if (act === 'toggle-team') {
      const email = lc(tr.dataset.email), tid = el.dataset.team, on = (_teamIdsOf[email] || []).includes(tid);
      await run(on ? c.from('team_members').delete().eq('team_id', tid).eq('email', email) : c.from('team_members').insert({ team_id: tid, email }));
    }
  }

  async function onChange(el) {
    const c = db(); if (!c || !_isAdmin) return;
    const act = el.dataset.act;
    if (act === 'set-org') {
      const tr = el.closest('tr[data-email]'), email = lc(tr.dataset.email), oid = el.value;
      // 組織を変えたら、前の組織のチームへの所属は外す（チームは同じ組織の中だけ）
      const old = (_teamIdsOf[email] || []).filter(tid => (_teams.find(t => t.id === tid) || {}).org_id !== oid);
      if (old.length) { const r = await c.from('team_members').delete().eq('email', email).in('team_id', old); if (r.error) { toast('⚠️ チームの所属を外せませんでした：' + r.error.message, 'warn', 7000); return; } }
      await run(oid ? c.from('org_members').upsert({ email, org_id: oid }, { onConflict: 'email' }) : c.from('org_members').delete().eq('email', email));
    } else if (act === 'rename-org' || act === 'rename-team') {
      const isOrg = act === 'rename-org', box = el.closest(isOrg ? '[data-org]' : '[data-team]');
      const id = isOrg ? box.dataset.org : box.dataset.team, name = (el.value || '').trim();
      const cur = isOrg ? _orgs.find(o => o.id === id) : _teams.find(t => t.id === id);
      if (!name) { el.value = cur ? cur.name : ''; toast('⚠️ 名前を空にはできません', 'warn'); return; }
      if (cur && cur.name === name) return;
      const ok = await run(c.from(isOrg ? 'organizations' : 'teams').update({ name }).eq('id', id), '✅ 名前を変更しました');
      if (!ok && cur) el.value = cur.name;
    }
  }

  function bindAdmin() {
    const pane = $('umOrgPane');
    if (!pane || pane.dataset.bound) return;
    pane.dataset.bound = '1';
    pane.addEventListener('click', e => { const b = e.target.closest('button[data-act]'); if (b && pane.contains(b)) onAct(b); });
    pane.addEventListener('change', e => { const t = e.target; if (t && t.dataset && t.dataset.act && t.tagName !== 'BUTTON') onChange(t); });
    pane.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || !e.target.matches('input')) return;
      if (e.target.id === 'otNewOrg') { const b = pane.querySelector('[data-act="add-org"]'); if (b) onAct(b); }
      else if (e.target.dataset.newteam) { const b = e.target.parentElement.querySelector('[data-act="add-team"]'); if (b) onAct(b); }
      else if (e.target.dataset.act && e.target.dataset.act.indexOf('rename') === 0) e.target.blur();
    });
  }

  // ---------- ログイン連携（users.js の umOnAuth から） ----------
  function otOnAuth(user) {
    _me = user ? lc(user.email) : '';
    _isAdmin = !!(user && window._myRole === 'admin');
    if (!user) { _avail = false; _orgs = []; _teams = []; _orgOf = {}; _teamIdsOf = {}; document.dispatchEvent(new CustomEvent('orgdir:loaded')); return; }
    load();
  }
  window.addEventListener('focus', () => { if (_me && Date.now() - _loadedAt > 10 * 60 * 1000) load(); });

  window.otOnAuth = otOnAuth;
  window.otAdminOpen = openAdmin;
})();
