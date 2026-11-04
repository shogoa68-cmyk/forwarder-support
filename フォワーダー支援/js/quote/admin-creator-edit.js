// ========== 【一時機能】管理者が見積の「作成者」を変更する ==========
// ダッシュボードのカードの作成者（👤）の横に、管理者にだけ ✎ を出し、メンバー一覧から（またはメールを直接入力して）
// 作成者を付け替える。DB 側は管理者専用 RPC quote_admin_set_creator（docs/sql/admin-edit-creator.sql）。
//
// 一時的な措置のため、この機能だけで完結するようにしてある。やめるときは
// docs/sql/admin-edit-creator.sql の「この機能をやめるとき」の手順（このファイルの削除＋参照 3 か所の削除）を行う。
(function () {
  'use strict';

  const isAdmin = () => window._myRole === 'admin';
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const toast = (msg, kind, ms) => { if (typeof window.quoteShowToast === 'function') window.quoteShowToast(msg, kind || 'info', ms || 3000); };
  const nameOf = email => (typeof window.quoteDisplayName === 'function' ? window.quoteDisplayName(email) : email) || email;

  // カードに差し込むボタン（管理者以外は空文字）。cloud.js のカード描画から呼ばれる
  window.adminCreatorEditBtn = function (rawId) {
    if (!isAdmin()) return '';
    return '<button type="button" class="cloud-card-crt-edit" ' +
      'onclick="event.stopPropagation();adminEditCreator(\'' + encodeURIComponent(rawId) + '\')" ' +
      'title="作成者を変更（管理者・一時機能）">✎</button>';
  };

  async function _members(db) {
    const { data } = await db.from('allowed_emails').select('email,role');
    return (data || []).map(r => r.email).filter(Boolean)
      .sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'ja'));
  }

  function _close() { document.getElementById('adminCreatorModal')?.remove(); }

  window.adminEditCreator = async function (encId) {
    if (!isAdmin()) { toast('⚠️ 管理者のみ実行できます', 'warn'); return; }
    const db = (typeof window.quoteCloudClient === 'function') ? window.quoteCloudClient() : null;
    if (!db) { toast('⚠️ クラウドに接続できません', 'warn'); return; }
    const id = decodeURIComponent(encId);
    const { data: cur } = await db.from('quote_presets').select('name,created_by').eq('id', id).maybeSingle();
    const members = await _members(db);
    _close();
    const opts = members.map(m => '<option value="' + esc(m) + '">' + esc(nameOf(m)) + '</option>').join('');
    const wrap = document.createElement('div');
    wrap.id = 'adminCreatorModal';
    wrap.className = 'admin-creator-overlay';
    wrap.innerHTML =
      '<div class="admin-creator-box" role="dialog" aria-label="作成者を変更">' +
        '<div class="admin-creator-title">👤 作成者を変更 <small>管理者・一時機能</small></div>' +
        '<div class="admin-creator-case">' + esc((cur && cur.name) || '') + '</div>' +
        '<div class="admin-creator-now">現在の作成者：' + esc(cur && cur.created_by ? nameOf(cur.created_by) + '（' + cur.created_by + '）' : '（未設定）') + '</div>' +
        '<label class="admin-creator-lbl">新しい作成者（メンバーから選ぶ／メールを直接入力）</label>' +
        '<input type="text" id="adminCreatorInput" list="adminCreatorList" autocomplete="off" placeholder="メールアドレス" value="' + esc((cur && cur.created_by) || '') + '">' +
        '<datalist id="adminCreatorList">' + opts + '</datalist>' +
        '<div class="admin-creator-note">変更するのは作成者だけです（最終更新者・更新日時・編集ロックは変わりません）。</div>' +
        '<div class="admin-creator-actions">' +
          '<button type="button" class="admin-creator-cancel">キャンセル</button>' +
          '<button type="button" class="admin-creator-ok">変更する</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
    const inp = wrap.querySelector('#adminCreatorInput');
    wrap.addEventListener('click', e => { if (e.target === wrap) _close(); });
    wrap.querySelector('.admin-creator-cancel').onclick = _close;
    const submit = async () => {
      const email = (inp.value || '').trim().toLowerCase();
      if (!email || email.indexOf('@') < 1) { toast('⚠️ メールアドレスを入力してください', 'warn'); inp.focus(); return; }
      if (cur && cur.created_by === email) { _close(); return; }
      let res;
      try { res = await db.rpc('quote_admin_set_creator', { p_id: id, p_email: email }); } catch (e) { res = { error: e }; }
      if (res && res.error) {
        toast('⚠️ 変更に失敗しました。docs/sql/admin-edit-creator.sql が未適用の可能性があります。', 'warn', 8000);
        return;
      }
      const r = res && res.data;
      if (r === 'DENIED')   { toast('⚠️ 管理者権限がありません', 'warn'); return; }
      if (r === 'INVALID')  { toast('⚠️ メールアドレスが正しくありません', 'warn'); return; }
      if (r === 'NOTFOUND') { toast('⚠️ 案件が見つかりません', 'warn'); return; }
      _close();
      toast('✅ 作成者を ' + nameOf(email) + ' に変更しました', 'success');
      if (typeof window.cloudListPresets === 'function') window.cloudListPresets(true);   // 一覧を再取得（silent）
    };
    wrap.querySelector('.admin-creator-ok').onclick = submit;
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(); } if (e.key === 'Escape') _close(); });
    inp.focus(); inp.select();
  };

  // ---------- 新規案件を「作成者を指定して」保存する ----------
  // 編集画面の管理番号入力に、管理者で未保存の新規案件のときだけ「作成者を指定して保存」欄を出す。
  // 最初の保存（insert）の直後に cloud.js から adminApplyCreatorToNew が呼ばれ、同じ RPC で作成者を付け替える。
  let _nameToEmail = {};
  let _loaded = false;
  async function _loadMembers() {
    if (_loaded) return;
    const db = (typeof window.quoteCloudClient === 'function') ? window.quoteCloudClient() : null;
    if (!db) return;
    _loaded = true;
    const members = await _members(db);
    _nameToEmail = {};
    const dl = document.getElementById('adminCreatorNewList');
    if (dl) dl.innerHTML = members.map(m => { _nameToEmail[nameOf(m)] = m; return '<option value="' + esc(m) + '" label="' + esc(nameOf(m)) + '"></option>'; }).join('');
  }
  const _newInput = () => document.querySelector('#adminCreatorNew input');
  function _resolve(v) {
    v = (v || '').trim();
    if (!v) return '';
    if (_nameToEmail[v]) return _nameToEmail[v];   // 表示名で入力されたらメールに直す
    return v.toLowerCase();
  }
  function _refresh() {
    const box = document.getElementById('adminCreatorNew');
    if (!box) return;
    const tab = document.getElementById('tab-quote-make');
    const inEditor = !!tab && !tab.classList.contains('qp-dash') && tab.classList.contains('active');
    const show = isAdmin() && inEditor && typeof window.cloudIsUnsavedNew === 'function' && window.cloudIsUnsavedNew();
    if (box.hidden === show) box.hidden = !show;
    if (show) _loadMembers();
  }
  setInterval(_refresh, 1000);   // 一時機能のため、画面の遷移・保存に追従する簡易な方式

  window.adminApplyCreatorToNew = async function (newId) {
    const inp = _newInput();
    const email = _resolve(inp && inp.value);
    if (!email || !isAdmin()) return;
    const db = (typeof window.quoteCloudClient === 'function') ? window.quoteCloudClient() : null;
    if (!db) return;
    let res;
    try { res = await db.rpc('quote_admin_set_creator', { p_id: newId, p_email: email }); } catch (e) { res = { error: e }; }
    if (res && !res.error && res.data === 'OK') {
      toast('✅ 作成者を ' + nameOf(email) + ' に設定しました', 'success');
      if (inp) inp.value = '';
    } else {
      toast('⚠️ 作成者の指定に失敗しました（案件は自分の名義で保存されています）。一覧の ✎ から変更できます', 'warn', 8000);
    }
  };
})();
