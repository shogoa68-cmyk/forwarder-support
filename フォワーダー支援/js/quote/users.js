// ========== 🧑‍💼 チーム管理（ユーザー＆ロール管理） ==========
//
// allowed_emails テーブルでメンバーとロール（admin / member / viewer）を管理する。
//   - 入口：ヘッダーのユーザーエリアの「🧑‍💼 チーム管理」（管理者のみ表示）
//   - 認証：cloud.js の _renderCloudAuth から window.umOnAuth(user) で連携
//   - 保護：RLS ＋ get_my_role() でサーバー側でも制御（UIの出し分けは補助）
//
(function () {
  'use strict';

  const ROLE_LABEL = { admin: '管理者', member: 'メンバー', viewer: '閲覧のみ' };
  const ROLE_ORDER = { admin: 0, member: 1, viewer: 2 };
  const AVATAR_PALETTE = ['#8a6d3b', '#2b7bb0', '#1e7e44', '#9a7bbf', '#b07d5a', '#c0856a', '#5a8a8a', '#a8632e'];

  let _myRole   = null;   // 自分のロール（'admin' | 'member' | 'viewer' | null）
  let _myEmail  = null;
  let _members  = [];     // キャッシュ
  let _profiles = {};     // email -> { display_name, updated_at }
  let _curTab   = 'members';

  function _db() { return window.SupabaseClient || null; }
  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }
  function _toast(msg, type, ms) {
    if (typeof quoteShowToast === 'function') quoteShowToast(msg, type, ms);
  }
  function _avatarColor(email) {
    let h = 0;
    for (let i = 0; i < (email || '').length; i++) h = (h * 31 + email.charCodeAt(i)) >>> 0;
    return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
  }
  function _displayName(email) {
    const p = _profiles[email];
    return (p && p.display_name) || (email ? email.split('@')[0] : '—');
  }

  // ---------- 認証連携（cloud.js から呼ばれる） ----------
  async function umOnAuth(user) {
    _myEmail = user ? (user.email || null) : null;
    const btn = document.getElementById('hdrUserMgrBtn');
    if (!user) {
      _myRole = null;
      window._myMemberNo = null;
      if (btn) btn.hidden = true;
      return;
    }
    const db = _db();
    if (!db) return;
    try {
      const { data, error } = await db.rpc('get_my_role');
      _myRole = error ? null : (data || 'member');
    } catch (e) { _myRole = null; }
    window._myRole = _myRole;
    // 発番ID（仮REF#の先頭2桁）を取得。RLSに依存せず本人のみ取得する RPC。
    try {
      const { data: mn } = await db.rpc('get_my_member_no');
      window._myMemberNo = (mn == null ? null : Number(mn));
    } catch (e) { window._myMemberNo = null; }
    // 発番ID取得後、見積タブが新規（REF空）なら自動採番を再試行
    if (typeof window.maybeAutoFillRef === 'function') window.maybeAutoFillRef();
    // 入口は管理者のみ
    if (btn) btn.hidden = (_myRole !== 'admin');
  }

  // ---------- データ取得 ----------
  async function _loadMembers() {
    const db = _db();
    if (!db) return { error: { message: 'DB接続が未初期化です' } };
    const { data: rows, error } = await db.from('allowed_emails').select('*');
    if (error) return { error };
    // アバター列も取得（未マイグレーションでも名前は読めるようフォールバック）
    let { data: profs, error: pErr } = await db.from('user_profiles')
      .select('email,display_name,updated_at,avatar_color,avatar_emoji');
    if (pErr) { ({ data: profs } = await db.from('user_profiles').select('email,display_name,updated_at')); }
    _profiles = {};
    (profs || []).forEach(p => { if (p.email) _profiles[p.email] = p; });
    _members = (rows || []).map(r => ({
      email: r.email,
      role: r.role || 'member',
      created_at: r.created_at || null,
      member_no: (r.member_no == null ? null : Number(r.member_no)),
    })).sort((a, b) => {
      const ra = ROLE_ORDER[a.role] ?? 9, rb = ROLE_ORDER[b.role] ?? 9;
      if (ra !== rb) return ra - rb;
      return _displayName(a.email).localeCompare(_displayName(b.email), 'ja');
    });
    return { ok: true };
  }

  // ---------- 描画 ----------
  function _memberCard(m) {
    const isSelf  = m.email === _myEmail;
    const prof    = _profiles[m.email];
    const active  = !!(prof && prof.display_name);   // 表示名登録＝ログイン実績あり
    const admin   = _myRole === 'admin';
    const name    = _displayName(m.email);
    const initial = (name || '?').trim().charAt(0).toUpperCase();
    // プロフィールで設定したアバター（色・絵文字）を優先、無ければハッシュ色＋頭文字
    const color   = (prof && prof.avatar_color) || _avatarColor(m.email);
    const avLabel = (prof && prof.avatar_emoji) || initial;
    const added   = m.created_at
      ? new Date(m.created_at).toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })
      : '—';
    const last    = active && prof.updated_at
      ? new Date(prof.updated_at).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
      : '未ログイン';

    const roleCtl = admin
      ? '<select class="um-role um-role--' + m.role + '" ' +
          (isSelf ? 'disabled title="自分のロールは変更できません" ' : 'title="ロールを変更" ') +
          'onchange="umChangeRole(\'' + _esc(m.email) + '\', this.value)">' +
          ['admin', 'member', 'viewer'].map(r =>
            '<option value="' + r + '"' + (r === m.role ? ' selected' : '') + '>' + ROLE_LABEL[r] + '</option>').join('') +
        '</select>'
      : '<span class="um-role-static um-role--' + m.role + '">' +
          '<span class="um-role-dot" style="background:' + color + '"></span>' + ROLE_LABEL[m.role] + '</span>';

    const delBtn = admin
      ? '<button class="um-del" ' + (isSelf ? 'disabled title="自分は削除できません"' : 'title="削除"') +
          ' onclick="umDeleteMember(\'' + _esc(m.email) + '\')">✕</button>'
      : '';

    // 発番IDバッジ：管理者はクリックで任意の番号に変更可。未割当なら「＋採番」。
    const memberNoCtl = (m.member_no != null)
      ? (admin
          ? '<button class="um-memberno um-memberno--edit" title="発番ID（仮REF#の先頭2桁）をクリックで変更" ' +
              'onclick="umEditMemberNo(\'' + _esc(m.email) + '\')">#' + String(m.member_no).padStart(2, '0') + ' ✎</button>'
          : '<span class="um-memberno" title="発番ID（仮REF#の先頭2桁）">#' + String(m.member_no).padStart(2, '0') + '</span>')
      : (admin
          ? '<button class="um-memberno um-memberno--empty" title="発番IDを割り当て" ' +
              'onclick="umEditMemberNo(\'' + _esc(m.email) + '\')">＋採番</button>'
          : '');

    return '<div class="um-card' + (isSelf ? ' is-self' : '') + (active ? '' : ' is-pending') + '">' +
      '<div class="um-avatar" style="background:' + color + '">' + _esc(avLabel) + '</div>' +
      '<div class="um-id">' +
        '<div class="um-name-row"><span class="um-name">' + _esc(name) + '</span>' +
          memberNoCtl +
          (isSelf ? '<span class="um-you">あなた</span>' : '') + '</div>' +
        '<div class="um-email">' + _esc(m.email) + '</div>' +
        '<div class="um-meta"><span>🕒 ' + _esc(last) + '</span><span>追加 ' + added + '</span></div>' +
      '</div>' +
      '<div class="um-actions">' +
        '<span class="um-status um-status--' + (active ? 'active' : 'pending') + '">' +
          '<span class="um-status-dot"></span>' + (active ? '有効' : '招待中') + '</span>' +
        roleCtl + delBtn +
      '</div>' +
    '</div>';
  }

  function _renderMembers(filterText, filterRole) {
    const list = document.getElementById('umMemberList');
    if (!list) return;
    const admin = _myRole === 'admin';
    let rows = _members;
    if (filterText) {
      const q = filterText.toLowerCase();
      rows = rows.filter(m => m.email.toLowerCase().includes(q) || _displayName(m.email).toLowerCase().includes(q));
    }
    if (filterRole) rows = rows.filter(m => m.role === filterRole);

    const invitePanel = document.getElementById('umInvitePanel');
    if (invitePanel && !admin) invitePanel.hidden = true;

    const head = '<div class="um-count">' + _members.length + '人のメンバー' +
      (admin ? '' : ' ・ あなたは<b style="color:#1a5c8a">' + (ROLE_LABEL[_myRole] || 'メンバー') + '</b>です') + '</div>';
    list.innerHTML = head + (rows.length
      ? rows.map(_memberCard).join('')
      : '<div class="um-empty">該当するメンバーがいません</div>');
  }

  // ---------- 操作 ----------
  async function umChangeRole(email, role) {
    const db = _db();
    if (!db) return;
    const { error } = await db.from('allowed_emails').update({ role }).eq('email', email);
    if (error) { _toast('⚠️ ロール変更に失敗：' + error.message, 'warn'); return; }
    const m = _members.find(x => x.email === email);
    if (m) m.role = role;
    _toast('✅ ' + _displayName(email) + ' を「' + (ROLE_LABEL[role] || role) + '」に変更しました', 'success', 2200);
    _applyFilters();
  }

  // 発番ID（member_no）を管理者が任意の番号へ変更（1〜99・チーム内で重複不可）
  async function umEditMemberNo(email) {
    if (_myRole !== 'admin') return;
    const m = _members.find(x => x.email === email);
    const cur = (m && m.member_no != null) ? String(m.member_no) : '';
    const input = prompt(
      '「' + _displayName(email) + '」の発番ID（仮REF#の先頭2桁）を入力\n' +
      '1〜99の数値。チーム内で重複できません。', cur);
    if (input == null) return;                          // キャンセル
    const v = input.trim();
    if (!/^\d{1,2}$/.test(v)) { _toast('⚠️ 1〜99の数値で入力してください', 'warn'); return; }
    const no = parseInt(v, 10);
    if (no < 1 || no > 99) { _toast('⚠️ 1〜99の範囲で入力してください', 'warn'); return; }
    if (_members.some(x => x.email !== email && x.member_no === no)) {
      _toast('⚠️ 発番ID #' + String(no).padStart(2, '0') + ' は既に他のメンバーが使用中です', 'warn'); return;
    }
    const db = _db();
    if (!db) return;
    const { error } = await db.from('allowed_emails').update({ member_no: no }).eq('email', email);
    if (error) { _toast('⚠️ 発番IDの変更に失敗：' + error.message, 'warn'); return; }
    if (m) m.member_no = no;
    if (email === _myEmail) window._myMemberNo = no;     // 自分の番号なら即時反映
    _toast('🔢 ' + _displayName(email) + ' の発番IDを #' + String(no).padStart(2, '0') + ' に変更しました', 'success', 2400);
    _applyFilters();
  }

  async function umDeleteMember(email) {
    if (email === _myEmail) return;
    if (!confirm(_displayName(email) + '（' + email + '）をチームから削除しますか？\nこのユーザーは以降データにアクセスできなくなります。')) return;
    const db = _db();
    if (!db) return;
    const { error } = await db.from('allowed_emails').delete().eq('email', email);
    if (error) { _toast('⚠️ 削除に失敗：' + error.message, 'warn'); return; }
    _members = _members.filter(x => x.email !== email);
    _toast('🗑 ' + _displayName(email) + ' を削除しました', 'success', 2200);
    _applyFilters();
  }

  async function umInvite() {
    const input = document.getElementById('umInviteEmail');
    const roleSel = document.getElementById('umInviteRole');
    const email = (input?.value || '').trim().toLowerCase();
    const role = roleSel?.value || 'member';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { _toast('⚠️ メールアドレスの形式が正しくありません', 'warn'); return; }
    if (_members.some(m => m.email.toLowerCase() === email)) { _toast('⚠️ すでに登録済みのメンバーです', 'warn'); return; }
    const db = _db();
    if (!db) return;
    // 発番ID（member_no）を登録時に固定付与：既存の最大値＋1（一度振ったら不変・削除でズレない）
    const used = _members.map(m => m.member_no).filter(n => typeof n === 'number');
    const nextNo = (used.length ? Math.max(...used) : 0) + 1;
    let { error } = await db.from('allowed_emails').insert({ email, role, member_no: nextNo });
    if (error && /member_no/.test(error.message || '')) {   // 列未作成でも招待は通す
      ({ error } = await db.from('allowed_emails').insert({ email, role }));
    }
    if (error) { _toast('⚠️ 招待に失敗：' + error.message, 'warn'); return; }
    if (input) input.value = '';
    _toast('✉️ ' + email + ' を招待しました（' + (ROLE_LABEL[role] || role) + '）', 'success', 2600);
    await _loadMembers();
    _applyFilters();
  }

  function umToggleInvite() {
    const p = document.getElementById('umInvitePanel');
    if (!p) return;
    p.hidden = !p.hidden;
    if (!p.hidden) document.getElementById('umInviteEmail')?.focus();
  }

  function _applyFilters() {
    const t = (document.getElementById('umSearch')?.value || '').trim();
    const r = document.getElementById('umRoleFilter')?.value || '';
    _renderMembers(t, r);
  }

  function switchUmTab(tab) {
    _curTab = tab;
    document.getElementById('umTabMembers')?.classList.toggle('is-active', tab === 'members');
    document.getElementById('umTabPerms')?.classList.toggle('is-active', tab === 'perms');
    const mp = document.getElementById('umMembersPane');
    const pp = document.getElementById('umPermsPane');
    if (mp) mp.hidden = tab !== 'members';
    if (pp) pp.hidden = tab !== 'perms';
  }

  // ---------- モーダル開閉 ----------
  async function openUserMgr() {
    const ov = document.getElementById('umOverlay');
    if (!ov) return;
    ov.classList.add('open');
    document.getElementById('umModal')?.setAttribute('data-role', _myRole || 'guest');
    // 管理者用UIの出し分け
    const admin = _myRole === 'admin';
    const inviteBtn = document.getElementById('umInviteBtn');
    if (inviteBtn) inviteBtn.style.display = admin ? '' : 'none';
    const sub = document.getElementById('umHeadSub');
    if (sub) sub.textContent = admin ? 'メンバーとロールの管理（管理者）' : 'チームメンバー一覧（閲覧のみ）';
    switchUmTab('members');
    const list = document.getElementById('umMemberList');
    if (list) list.innerHTML = '<div class="um-empty">読み込み中…</div>';
    const invitePanel = document.getElementById('umInvitePanel');
    if (invitePanel) invitePanel.hidden = true;
    const res = await _loadMembers();
    if (res && res.error) {
      if (list) list.innerHTML = '<div class="um-empty">⚠️ 読み込みエラー：' + _esc(res.error.message) + '</div>';
      return;
    }
    _applyFilters();
  }

  function closeUserMgr(ev) {
    if (ev && ev.target && ev.target.id !== 'umOverlay' && ev.type === 'click') return;
    document.getElementById('umOverlay')?.classList.remove('open');
  }

  // プロフィール保存後などに、開いていればメンバー一覧を再取得して再描画
  async function umRefreshIfOpen() {
    const ov = document.getElementById('umOverlay');
    if (!ov || !ov.classList.contains('open')) return;
    await _loadMembers();
    _applyFilters();
  }

  // グローバル公開
  Object.assign(window, {
    umOnAuth, openUserMgr, closeUserMgr, switchUmTab,
    umChangeRole, umEditMemberNo, umDeleteMember, umInvite, umToggleInvite,
    umFilter: _applyFilters, umRefreshIfOpen,
  });
})();
