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

  // 案件ステータス定義（順序＝表示順、key は DB 保存値）
  const CLOUD_STATUSES = ['下書き中', '提示済み', '受注', '失注'];
  const CLOUD_STATUS_DEFAULT = '下書き中';

  // 一覧キャッシュ＋絞り込み状態（フェーズ1：クライアント側フィルタ）
  let _cloudRows = [];          // 取得した全件
  let _cloudSearch = '';        // 検索語（名前・顧客・担当）
  let _cloudStatusFilter = '';  // '' = すべて
  // 詳細検索フィルター
  let _cloudFilterMode    = '';
  let _cloudFilterInco    = '';
  let _cloudFilterPol     = '';
  let _cloudFilterPod     = '';
  let _cloudFilterCarrier = '';
  let _cloudAdvOpen       = false;

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
  function _cloudDisplayName(u) {
    if (!u) return '';
    const m = u.user_metadata || {};
    // display_name（登録済みカスタム名）を優先、なければ Google の表示名
    return m.display_name || m.full_name || m.name || m.user_name || u.email || 'ログイン中';
  }
  function _renderCloudAuth() {
    const stateEl   = document.getElementById('cloudAuthState');
    const hint      = document.getElementById('cloudLoginHint');
    const body      = document.getElementById('cloudShareBody');
    // ヘッダー右上ウィジェット
    const hdrWrap   = document.getElementById('cloudHeaderAuth');
    const hdrLogin  = document.getElementById('hdrCloudLogin');
    const hdrUser   = document.getElementById('hdrCloudUser');
    const hdrName   = document.getElementById('hdrCloudName');
    const hdrAvatar = document.getElementById('hdrCloudAvatar');

    const configured = cloudIsConfigured();
    // 未設定ならヘッダーウィジェットごと隠す
    if (hdrWrap) hdrWrap.hidden = !configured;

    if (!stateEl) return;

    if (!configured) {
      stateEl.textContent = '未設定';
      stateEl.classList.remove('is-on');
      if (hint) hint.style.display = 'none';
      if (body) body.style.display = 'none';
      return;
    }
    if (_cloudUser) {
      const name = _cloudDisplayName(_cloudUser);
      stateEl.textContent = '✅ ' + (_cloudUser.email || 'ログイン中');
      stateEl.classList.add('is-on');
      if (hint) hint.style.display = 'none';
      if (body) body.style.display = '';
      // ヘッダー：ユーザー名表示
      if (hdrLogin) hdrLogin.style.display = 'none';
      if (hdrUser)  hdrUser.style.display  = '';
      if (hdrName)  hdrName.textContent = name;
      if (hdrAvatar) {
        const initial = (name || '?').trim().charAt(0).toUpperCase();
        const av = (_cloudUser.user_metadata || {}).avatar_url;
        if (av) { hdrAvatar.style.backgroundImage = `url("${av}")`; hdrAvatar.textContent = ''; hdrAvatar.classList.add('has-img'); }
        else    { hdrAvatar.style.backgroundImage = ''; hdrAvatar.textContent = initial; hdrAvatar.classList.remove('has-img'); }
      }
      // 作業者フィールドが空なら自動入力
      const assigneeEl = document.getElementById('qf-assignee');
      if (assigneeEl && !assigneeEl.value.trim()) assigneeEl.value = name;
      // 登録ボタンを表示（ログイン中のみ）
      const saveBtn = document.getElementById('qfAssigneeSave');
      if (saveBtn) saveBtn.hidden = false;
      // FB受信一覧タブを表示
      if (typeof refreshFbAdminTab === 'function') refreshFbAdminTab(_cloudUser);
    } else {
      stateEl.textContent = '未ログイン';
      stateEl.classList.remove('is-on');
      if (hint) hint.style.display = '';
      if (body) body.style.display = 'none';
      // ヘッダー：ログインボタン表示
      if (hdrLogin) hdrLogin.style.display = '';
      if (hdrUser)  hdrUser.style.display  = 'none';
      // 登録ボタンを隠す
      const saveBtn = document.getElementById('qfAssigneeSave');
      if (saveBtn) saveBtn.hidden = true;
      // FB受信一覧タブを隠す
      if (typeof refreshFbAdminTab === 'function') refreshFbAdminTab(null);
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
      .select('id,name,status,customer,person,owner_email,created_by,updated_at,incoterms,transport_mode,pol,pod,carrier')
      .order('updated_at', { ascending: false });
    if (error) {
      if (wrap) wrap.innerHTML =
        '<div class="preset-empty">⚠️ 取得に失敗：' + escHtml(error.message) +
        '<br><small>許可リスト（allowed_emails）に登録されていない可能性があります</small></div>';
      return;
    }
    _cloudRows = data || [];
    _renderStatusChips();
    _renderAdvancedFilters();
    _applyCloudFilter();
  }

  // 検索語・ステータス・詳細フィルターで絞り込んで描画
  function _applyCloudFilter() {
    const q   = _cloudSearch.trim().toLowerCase();
    const pol = _cloudFilterPol.trim().toLowerCase();
    const pod = _cloudFilterPod.trim().toLowerCase();
    const car = _cloudFilterCarrier.trim().toLowerCase();
    const rows = _cloudRows.filter(r => {
      if (_cloudStatusFilter && (r.status || CLOUD_STATUS_DEFAULT) !== _cloudStatusFilter) return false;
      if (_cloudFilterMode    && r.transport_mode !== _cloudFilterMode)  return false;
      if (_cloudFilterInco    && r.incoterms       !== _cloudFilterInco) return false;
      if (pol && !(r.pol     || '').toLowerCase().includes(pol)) return false;
      if (pod && !(r.pod     || '').toLowerCase().includes(pod)) return false;
      if (car && !(r.carrier || '').toLowerCase().includes(car)) return false;
      if (!q) return true;
      const hay = [r.name, r.customer, r.person, r.owner_email].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
    _renderCloudList(rows);
  }

  // 詳細検索ドロップダウンをロード済みデータから生成
  function _renderAdvancedFilters() {
    const unique = (key) => [...new Set(_cloudRows.map(r => r[key]).filter(Boolean))].sort();
    const modes  = unique('transport_mode');
    const incos  = unique('incoterms');
    const modeEl = document.getElementById('cloudFilterMode');
    const incoEl = document.getElementById('cloudFilterInco');
    if (modeEl) {
      modeEl.innerHTML = '<option value="">輸送モード：すべて</option>' +
        modes.map(v => '<option value="' + escHtml(v) + '"' + (_cloudFilterMode === v ? ' selected' : '') + '>' + escHtml(v) + '</option>').join('');
    }
    if (incoEl) {
      incoEl.innerHTML = '<option value="">インコタームズ：すべて</option>' +
        incos.map(v => '<option value="' + escHtml(v) + '"' + (_cloudFilterInco === v ? ' selected' : '') + '>' + escHtml(v) + '</option>').join('');
    }
    // クリアボタン表示制御
    const hasAdv = _cloudFilterMode || _cloudFilterInco || _cloudFilterPol || _cloudFilterPod || _cloudFilterCarrier;
    const clearBtn = document.getElementById('cloudAdvClearBtn');
    if (clearBtn) clearBtn.hidden = !hasAdv;
  }

  function toggleCloudAdvSearch() {
    _cloudAdvOpen = !_cloudAdvOpen;
    const body    = document.getElementById('cloudAdvBody');
    const chevron = document.getElementById('cloudAdvChevron');
    if (body)    body.hidden = !_cloudAdvOpen;
    if (chevron) chevron.textContent = _cloudAdvOpen ? '▼' : '▶';
  }

  function cloudFilterAdvanced() {
    _cloudFilterMode    = document.getElementById('cloudFilterMode')?.value    || '';
    _cloudFilterInco    = document.getElementById('cloudFilterInco')?.value    || '';
    _cloudFilterPol     = document.getElementById('cloudFilterPol')?.value     || '';
    _cloudFilterPod     = document.getElementById('cloudFilterPod')?.value     || '';
    _cloudFilterCarrier = document.getElementById('cloudFilterCarrier')?.value || '';
    const hasAdv = _cloudFilterMode || _cloudFilterInco || _cloudFilterPol || _cloudFilterPod || _cloudFilterCarrier;
    const clearBtn = document.getElementById('cloudAdvClearBtn');
    if (clearBtn) clearBtn.hidden = !hasAdv;
    _applyCloudFilter();
  }

  function clearCloudAdvSearch() {
    _cloudFilterMode = _cloudFilterInco = _cloudFilterPol = _cloudFilterPod = _cloudFilterCarrier = '';
    ['cloudFilterMode','cloudFilterInco','cloudFilterPol','cloudFilterPod','cloudFilterCarrier'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const clearBtn = document.getElementById('cloudAdvClearBtn');
    if (clearBtn) clearBtn.hidden = true;
    _applyCloudFilter();
  }

  // ステータス絞り込みチップ（件数バッジ付き）
  function _renderStatusChips() {
    const box = document.getElementById('cloudStatusChips');
    if (!box) return;
    const count = st => _cloudRows.filter(r => (r.status || CLOUD_STATUS_DEFAULT) === st).length;
    const chip = (val, label, n) =>
      '<button type="button" class="cloud-chip' + (_cloudStatusFilter === val ? ' is-active' : '') +
      (val ? ' cloud-chip--' + _statusClass(val) : '') +
      '" onclick="cloudFilterStatus(\'' + val + '\')">' + escHtml(label) +
      '<span class="cloud-chip-n">' + n + '</span></button>';
    let html = chip('', 'すべて', _cloudRows.length);
    html += CLOUD_STATUSES.map(st => chip(st, st, count(st))).join('');
    box.innerHTML = html;
  }

  function _statusClass(st) {
    return { '下書き中':'draft', '提示済み':'sent', '受注':'won', '失注':'lost' }[st] || 'draft';
  }

  function _renderCloudList(rows) {
    const wrap = document.getElementById('cloudPresetListWrap');
    if (!wrap) return;
    if (!_cloudRows.length) {
      wrap.innerHTML = '<div class="preset-empty">共有プリセットはまだありません<br>'
        + '<small style="color:#9bb;">下のフォームから保存できます</small></div>';
      return;
    }
    if (!rows.length) {
      wrap.innerHTML = '<div class="preset-empty">条件に合う案件がありません<br>'
        + '<small style="color:#9bb;">検索語・ステータスを変えてください</small></div>';
      return;
    }
    wrap.innerHTML = rows.map(r => {
      const ts = r.updated_at
        ? new Date(r.updated_at).toLocaleString('ja-JP',
            { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })
        : '';
      const status = r.status || CLOUD_STATUS_DEFAULT;
      const updWho = r.owner_email ? r.owner_email.split('@')[0] : '';
      const crtWho = r.created_by  ? r.created_by.split('@')[0]  : '';
      const idAttr = encodeURIComponent(r.id);
      const meta = [];
      if (r.customer) meta.push('👤 ' + escHtml(r.customer));
      if (r.person)   meta.push('🧑‍💼 ' + escHtml(r.person));
      const tags = [];
      if (r.transport_mode) tags.push(escHtml(r.transport_mode));
      if (r.incoterms)      tags.push(escHtml(r.incoterms));
      if (r.pol)            tags.push('📦 ' + escHtml(r.pol));
      if (r.pod)            tags.push('🏁 ' + escHtml(r.pod));
      if (r.carrier)        tags.push('🚢 ' + escHtml(r.carrier));
      const opts = CLOUD_STATUSES.map(st =>
        '<option value="' + st + '"' + (st === status ? ' selected' : '') + '>' + st + '</option>').join('');
      return '' +
        '<div class="cloud-card">' +
          '<div class="cloud-card-row1">' +
            '<select class="cloud-status-sel cloud-status--' + _statusClass(status) + '" ' +
                    'title="ステータスを変更" onchange="cloudSetStatus(\'' + idAttr + '\', this.value)">' + opts + '</select>' +
            '<span class="cloud-card-name" title="' + escHtml(r.name) + '">' + escHtml(r.name) + '</span>' +
            '<button class="btn-preset-load" onclick="cloudLoadPreset(\'' + idAttr + '\')">読込</button>' +
            '<button class="btn-preset-del"  onclick="cloudDeletePreset(\'' + idAttr + '\')" title="削除（全員から消えます）">✕</button>' +
          '</div>' +
          '<div class="cloud-card-row2">' +
            (meta.length ? '<span class="cloud-card-meta">' + meta.join('　') + '</span>' : '') +
            '<span class="cloud-card-who" title="作成：' + escHtml(crtWho || '—') + ' / 最終更新：' + escHtml(updWho || '—') + '">' +
              '✏️ ' + escHtml(updWho || '—') + '・' + ts + '</span>' +
          '</div>' +
          (tags.length ? '<div class="cloud-card-tags">' + tags.map(t => '<span class="cloud-tag">' + t + '</span>').join('') + '</div>' : '') +
        '</div>';
    }).join('');
  }

  // 検索ボックス入力
  function cloudSearchInput(val) {
    _cloudSearch = val || '';
    _applyCloudFilter();
  }

  // ステータス絞り込み切替
  function cloudFilterStatus(val) {
    _cloudStatusFilter = (val === _cloudStatusFilter) ? '' : val;  // 同じものを再クリックで解除
    _renderStatusChips();
    _applyCloudFilter();
  }

  // 行のステータス変更
  async function cloudSetStatus(rawId, status) {
    const c = _getClient();
    if (!c) return;
    const id = decodeURIComponent(rawId);
    const { error } = await c.from(_table())
      .update({ status, owner_email: _cloudUser.email, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) { quoteShowToast('⚠️ ステータス更新に失敗：' + error.message, 'warn'); return; }
    // ローカルキャッシュも更新して即時反映
    const row = _cloudRows.find(r => r.id === id);
    if (row) { row.status = status; row.owner_email = _cloudUser.email; row.updated_at = new Date().toISOString(); }
    _renderStatusChips();
    _applyCloudFilter();
    quoteShowToast('🔖 ステータスを「' + status + '」に変更しました', 'success');
  }

  // ---------- 保存（同名は上書き） ----------
  async function cloudSaveCurrent() {
    const c = _getClient();
    if (!c || !_cloudUser) { quoteShowToast('⚠️ 先に Google でログインしてください', 'warn'); return; }
    // 保存名は管理番号(＋顧客名・担当者)から自動生成（ローカル一時保存と同じ _buildDefaultPresetName）
    const name = (typeof _buildDefaultPresetName === 'function')
      ? _buildDefaultPresetName()
      : ('一時保存_' + new Date().toISOString().slice(0, 10).replace(/-/g, ''));

    const data = gatherAllData();
    // 検索・一覧用の主要項目を data から昇格（顧客名・担当者）
    const f = (data && data.fields) || {};
    const customer       = (f['qf-customer']    || '').trim() || null;
    const person         = (f['qf-person']      || '').trim() || null;
    const incoterms      = (f['cond-incoterms'] || '').trim() || null;
    const transport_mode = (f['cond-mode']       || '').trim() || null;
    const pol            = (f['z2Pol']           || '').trim() || null;
    const pod            = (f['z2Pod']           || '').trim() || null;
    const carrier        = (f['z2Carrier']       || '').trim() || null;

    // 同名チェック → 上書き or 新規
    const { data: existing, error: selErr } = await c
      .from(_table()).select('id').eq('name', name).limit(1);
    if (selErr) { quoteShowToast('⚠️ 確認に失敗：' + selErr.message, 'warn', 5000); return; }

    let resp;
    if (existing && existing.length) {
      if (!confirm('共有プリセット「' + name + '」が既にあります。上書きしますか？')) return;
      // 上書き時はステータス・作成者は維持（中身と顧客/担当・最終更新者のみ更新）
      resp = await c.from(_table())
        .update({ data, customer, person, incoterms, transport_mode, pol, pod, carrier,
                  owner_email: _cloudUser.email, updated_at: new Date().toISOString() })
        .eq('id', existing[0].id);
    } else {
      resp = await c.from(_table())
        .insert({
          name, data, customer, person, incoterms, transport_mode, pol, pod, carrier,
          status: CLOUD_STATUS_DEFAULT,
          owner_email: _cloudUser.email,
          created_by:  _cloudUser.email,
        });
    }
    if (resp.error) { quoteShowToast('⚠️ 保存に失敗：' + resp.error.message, 'warn', 5000); return; }

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

  // ---------- 作業者名の登録 ----------
  async function saveAssigneeName() {
    const name = (document.getElementById('qf-assignee')?.value || '').trim();
    if (!name) { quoteShowToast('⚠️ 作業者名を入力してください', 'warn'); return; }
    const c = _getClient();
    if (!c || !_cloudUser) { quoteShowToast('⚠️ ログインが必要です', 'warn'); return; }
    const btn = document.getElementById('qfAssigneeSave');
    if (btn) { btn.disabled = true; btn.textContent = '登録中…'; }
    const { error } = await c.auth.updateUser({ data: { display_name: name } });
    if (btn) { btn.disabled = false; btn.textContent = '登録'; }
    if (error) {
      quoteShowToast('⚠️ 登録に失敗しました：' + error.message, 'warn', 5000);
    } else {
      // ローカルのユーザーオブジェクトも更新
      if (_cloudUser.user_metadata) _cloudUser.user_metadata.display_name = name;
      quoteShowToast('✅ 作業者名「' + name + '」を登録しました', 'success', 3000);
    }
  }

  // ---------- window 公開（onclick 用） ----------
  window.saveAssigneeName    = saveAssigneeName;
  window.cloudLogin          = cloudLogin;
  window.cloudLogout         = cloudLogout;
  window.cloudSaveCurrent    = cloudSaveCurrent;
  window.cloudLoadPreset     = cloudLoadPreset;
  window.cloudDeletePreset   = cloudDeletePreset;
  window.cloudListPresets    = cloudListPresets;
  window.cloudOnPresetMgrOpen = cloudOnPresetMgrOpen;
  window.cloudSearchInput      = cloudSearchInput;
  window.cloudFilterStatus     = cloudFilterStatus;
  window.cloudSetStatus        = cloudSetStatus;
  window.toggleCloudAdvSearch  = toggleCloudAdvSearch;
  window.cloudFilterAdvanced   = cloudFilterAdvanced;
  window.clearCloudAdvSearch   = clearCloudAdvSearch;

  // supabase-js は <head> で defer 読み込みのため DOMContentLoaded を待つ
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initCloud);
  } else {
    _initCloud();
  }
