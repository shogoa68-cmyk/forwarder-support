// ========== ☁️ チーム共有（Supabase クラウド連携） ==========
//
// 見積プリセットを複数ユーザー間で共有するためのモジュール。
//   - 認証：Google ログイン（Supabase Auth / OAuth）
//   - 保護：RLS（allowed_emails に登録されたメンバーのみ読み書き可）
//   - 保存先：quote_presets テーブル（{ id, name, data(jsonb), owner_email, updated_at }）
//
// 既存のローカル保存（localStorage 'quotePresets_v1'）はそのまま併存。
// クラウド側はプリセット管理モーダル内の「☁️ チーム共有」セクションで操作する。
//
// 依存（全てグローバル関数）：
//   supabase.createClient        … supabase-js（<head> で defer ロード）
//   gatherAllData / _applyQuoteData / calcLiveUpdate / setCurrentQuoteName
//   closePresetMgr / quoteShowToast / escHtml

  let _sbClient   = null;   // Supabase クライアント（遅延生成）
  let _cloudUser  = null;   // ログイン中ユーザー（null = 未ログイン）
  let _cloudInited = false;

  // 設定が実値で埋まっているか（プレースホルダのままなら false）
  function cloudIsConfigured() {
    const c = window.CLOUD_CONFIG;
    return !!(c && c.url && c.publishableKey
              && !/YOUR_|xxxx/i.test(c.url)
              && !/YOUR_|xxxx/i.test(c.publishableKey));
  }

  function _getClient() {
    if (_sbClient) return _sbClient;
    if (!cloudIsConfigured()) return null;
    if (typeof supabase === 'undefined' || !supabase.createClient) {
      console.warn('[cloud] supabase-js が未ロードです');
      return null;
    }
    _sbClient = supabase.createClient(
      window.CLOUD_CONFIG.url,
      window.CLOUD_CONFIG.publishableKey
    );
    return _sbClient;
  }

  function _table() { return window.CLOUD_CONFIG.table || 'quote_presets'; }

  // ---------- 認証 ----------
  async function cloudLogin() {
    const c = _getClient();
    if (!c) { quoteShowToast('⚠️ クラウド共有の設定が未完了です', 'warn'); return; }
    // 現在のページ（ハッシュを除く）へ戻す。Supabase の Redirect URLs に登録済みであること。
    const redirectTo = window.location.href.split('#')[0];
    const { error } = await c.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
    if (error) {
      quoteShowToast('⚠️ ログイン開始に失敗しました：' + error.message, 'warn', 5000);
    }
  }

  async function cloudLogout() {
    const c = _getClient();
    if (!c) return;
    await c.auth.signOut();   // onAuthStateChange が UI を更新する
  }

  // ---------- 認証 UI 反映 ----------
  function _renderCloudAuth() {
    const stateEl   = document.getElementById('cloudAuthState');
    const loginBtn  = document.getElementById('btnCloudLogin');
    const logoutBtn = document.getElementById('btnCloudLogout');
    const body      = document.getElementById('cloudShareBody');
    if (!stateEl) return;

    if (!cloudIsConfigured()) {
      stateEl.textContent = '未設定';
      stateEl.classList.remove('is-on');
      if (loginBtn)  loginBtn.style.display  = 'none';
      if (logoutBtn) logoutBtn.style.display = 'none';
      if (body)      body.style.display      = 'none';
      return;
    }
    if (_cloudUser) {
      stateEl.textContent = '✅ ' + (_cloudUser.email || 'ログイン中');
      stateEl.classList.add('is-on');
      if (loginBtn)  loginBtn.style.display  = 'none';
      if (logoutBtn) logoutBtn.style.display = '';
      if (body)      body.style.display      = '';
    } else {
      stateEl.textContent = '未ログイン';
      stateEl.classList.remove('is-on');
      if (loginBtn)  loginBtn.style.display  = '';
      if (logoutBtn) logoutBtn.style.display = 'none';
      if (body)      body.style.display      = 'none';
    }
  }

  // ---------- 一覧 ----------
  async function cloudListPresets() {
    const c = _getClient();
    const wrap = document.getElementById('cloudPresetListWrap');
    if (!c || !_cloudUser) return;
    if (wrap) wrap.innerHTML = '<div class="preset-empty">読み込み中…</div>';
    const { data, error } = await c
      .from(_table())
      .select('id,name,owner_email,updated_at')
      .order('updated_at', { ascending: false });
    if (error) {
      if (wrap) wrap.innerHTML =
        '<div class="preset-empty">⚠️ 取得に失敗：' + escHtml(error.message) +
        '<br><small>許可リスト（allowed_emails）に登録されていない可能性があります</small></div>';
      return;
    }
    _renderCloudList(data || []);
  }

  function _renderCloudList(rows) {
    const wrap = document.getElementById('cloudPresetListWrap');
    if (!wrap) return;
    if (!rows.length) {
      wrap.innerHTML = '<div class="preset-empty">共有プリセットはまだありません<br>'
        + '<small style="color:#9bb;">下のフォームから保存できます</small></div>';
      return;
    }
    wrap.innerHTML = rows.map(r => {
      const ts = r.updated_at
        ? new Date(r.updated_at).toLocaleString('ja-JP',
            { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })
        : '';
      const who = r.owner_email ? r.owner_email.split('@')[0] : '';
      const idAttr = encodeURIComponent(r.id);
      return '<div class="preset-list-item">' +
        '<span class="preset-list-name">' + escHtml(r.name) + '</span>' +
        (who ? '<span class="cloud-list-owner" title="' + escHtml(r.owner_email) + '">' + escHtml(who) + '</span>' : '') +
        '<span class="preset-list-ts">' + ts + '</span>' +
        '<button class="btn-preset-load" onclick="cloudLoadPreset(\'' + idAttr + '\')">読込</button>' +
        '<button class="btn-preset-del"  onclick="cloudDeletePreset(\'' + idAttr + '\')" title="削除（全員から消えます）">✕</button>' +
        '</div>';
    }).join('');
  }

  // ---------- 保存（同名は上書き） ----------
  async function cloudSaveCurrent() {
    const c = _getClient();
    if (!c || !_cloudUser) { quoteShowToast('⚠️ 先に Google でログインしてください', 'warn'); return; }
    const inp = document.getElementById('cloudPresetNameInput');
    const name = (inp && inp.value || '').trim();
    if (!name) { quoteShowToast('⚠️ 共有プリセット名を入力してください', 'warn'); if (inp) inp.focus(); return; }

    const data = gatherAllData();

    // 同名チェック → 上書き or 新規
    const { data: existing, error: selErr } = await c
      .from(_table()).select('id').eq('name', name).limit(1);
    if (selErr) { quoteShowToast('⚠️ 確認に失敗：' + selErr.message, 'warn', 5000); return; }

    let resp;
    if (existing && existing.length) {
      if (!confirm('共有プリセット「' + name + '」が既にあります。上書きしますか？')) return;
      resp = await c.from(_table())
        .update({ data, owner_email: _cloudUser.email, updated_at: new Date().toISOString() })
        .eq('id', existing[0].id);
    } else {
      resp = await c.from(_table())
        .insert({ name, data, owner_email: _cloudUser.email });
    }
    if (resp.error) { quoteShowToast('⚠️ 保存に失敗：' + resp.error.message, 'warn', 5000); return; }

    if (inp) inp.value = '';
    quoteShowToast('☁️ 「' + name + '」をチーム共有に保存しました', 'success');
    cloudListPresets();
  }

  // ---------- 読込 ----------
  async function cloudLoadPreset(rawId) {
    const c = _getClient();
    if (!c) return;
    const id = decodeURIComponent(rawId);
    const { data, error } = await c
      .from(_table()).select('name,data').eq('id', id).single();
    if (error || !data) { quoteShowToast('⚠️ 読み込みに失敗しました', 'warn'); return; }

    // ローカルの loadPreset と同じ復元処理
    _applyQuoteData(data.data, { keepHeaderIfEmpty: true });
    if (typeof calcLiveUpdate === 'function') calcLiveUpdate();
    if (typeof setCurrentQuoteName === 'function') setCurrentQuoteName(data.name);
    if (typeof closePresetMgr === 'function') closePresetMgr();
    quoteShowToast('📂 共有「' + data.name + '」を読み込みました（Ctrl+Z で戻せます）', 'success');
  }

  // ---------- 削除 ----------
  async function cloudDeletePreset(rawId) {
    const c = _getClient();
    if (!c) return;
    if (!confirm('この共有プリセットを削除しますか？\n（チーム全員から消えます）')) return;
    const id = decodeURIComponent(rawId);
    const { error } = await c.from(_table()).delete().eq('id', id);
    if (error) { quoteShowToast('⚠️ 削除に失敗：' + error.message, 'warn'); return; }
    quoteShowToast('🗑️ 共有プリセットを削除しました', 'info');
    cloudListPresets();
  }

  // プリセット管理モーダルが開かれたとき ui.js の openPresetMgr から呼ばれる
  function cloudOnPresetMgrOpen() {
    _renderCloudAuth();
    if (_cloudUser) cloudListPresets();
  }

  // OAuth リダイレクトで戻ってきた際の認証エラーを拾って画面に出す。
  // Supabase は失敗時に ?error=... と #error=... の両方を付けて戻すことがある。
  function _surfaceOAuthError() {
    const parse = str => {
      const out = {};
      (str || '').replace(/^[?#]/, '').split('&').forEach(kv => {
        const [k, v] = kv.split('=');
        if (k) out[decodeURIComponent(k)] = decodeURIComponent((v || '').replace(/\+/g, ' '));
      });
      return out;
    };
    const q = parse(window.location.search);
    const h = parse(window.location.hash);
    const err  = q.error || h.error;
    if (!err) return;
    const desc = q.error_description || h.error_description || err;
    quoteShowToast('⚠️ ログインに失敗しました：' + desc, 'warn', 8000);
    console.error('[cloud] OAuth error:', q, h);
    // URL からエラーを掃除（履歴を汚さない・リロードで再表示しない）
    if (window.history && window.history.replaceState) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }

  // ---------- 初期化 ----------
  function _initCloud() {
    if (_cloudInited) return;
    _cloudInited = true;
    _surfaceOAuthError();
    const c = _getClient();
    if (!c) { _renderCloudAuth(); return; }

    // 既存セッション復元（OAuth リダイレクト直後もここで拾える）
    c.auth.getSession().then(({ data }) => {
      _cloudUser = (data && data.session && data.session.user) || null;
      _renderCloudAuth();
    });

    // ログイン状態変化を監視
    c.auth.onAuthStateChange((_event, session) => {
      _cloudUser = (session && session.user) || null;
      _renderCloudAuth();
      const modal = document.getElementById('presetMgrModal');
      if (_cloudUser && modal && modal.classList.contains('open')) cloudListPresets();
    });
  }

  // ---------- window 公開（onclick 用） ----------
  window.cloudLogin          = cloudLogin;
  window.cloudLogout         = cloudLogout;
  window.cloudSaveCurrent    = cloudSaveCurrent;
  window.cloudLoadPreset     = cloudLoadPreset;
  window.cloudDeletePreset   = cloudDeletePreset;
  window.cloudListPresets    = cloudListPresets;
  window.cloudOnPresetMgrOpen = cloudOnPresetMgrOpen;

  // supabase-js は <head> で defer 読み込みのため DOMContentLoaded を待つ
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initCloud);
  } else {
    _initCloud();
  }
