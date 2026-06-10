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
  // プレビュー
  let _cpId        = null;   // プレビュー中のプリセット ID
  let _cpRows      = [];     // プレビュー中の行データ（v3形式）
  let _cpFullName  = '';     // プレビュー中のプリセット名
  // メンバープロフィール（email → display_name）
  let _profileMap  = {};     // { 'email': 'name', ... }

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
      _refreshStorageInfo();
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

  // ---------- プロフィール（email → 表示名）----------
  async function _loadProfiles() {
    const c = _getClient();
    if (!c) return;
    const { data } = await c.from('user_profiles').select('email,display_name');
    if (data) data.forEach(r => { if (r.email && r.display_name) _profileMap[r.email] = r.display_name; });
  }

  function _nameFor(email) {
    if (!email) return '—';
    return _profileMap[email] || email.split('@')[0];
  }

  // ---------- 一覧 ----------
  async function cloudListPresets() {
    const c = _getClient();
    const wrap = document.getElementById('cloudPresetListWrap');
    if (!c || !_cloudUser) return;
    if (wrap) wrap.innerHTML = '<div class="preset-empty">読み込み中…</div>';
    await _loadProfiles();
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
      const updWho = _nameFor(r.owner_email);
      const crtWho = _nameFor(r.created_by);
      const idAttr = encodeURIComponent(r.id);
      const opts = CLOUD_STATUSES.map(st =>
        '<option value="' + st + '"' + (st === status ? ' selected' : '') + '>' + st + '</option>').join('');

      // 貿易・輸送条件チップ
      const condChips = [];
      if (r.incoterms)      condChips.push('<span class="cloud-tag cloud-tag-inco">' + escHtml(r.incoterms.split('（')[0]) + '</span>');
      if (r.transport_mode) condChips.push('<span class="cloud-tag cloud-tag-mode">' + escHtml(r.transport_mode) + '</span>');
      if (r.pol || r.pod) {
        const route = [r.pol, r.pod].filter(Boolean).map(escHtml).join(' → ');
        condChips.push('<span class="cloud-tag cloud-tag-route">📍 ' + route + '</span>');
      }
      if (r.carrier) condChips.push('<span class="cloud-tag cloud-tag-carrier">🚢 ' + escHtml(r.carrier) + '</span>');

      // 顧客・担当者
      const custParts = [];
      if (r.customer) custParts.push('<span class="cloud-cust">👤 ' + escHtml(r.customer) + '</span>');
      if (r.person)   custParts.push('<span class="cloud-person">🧑‍💼 ' + escHtml(r.person) + '</span>');

      return '' +
        '<div class="cloud-card">' +
          '<div class="cloud-card-row1">' +
            '<select class="cloud-status-sel cloud-status--' + _statusClass(status) + '" ' +
                    'title="ステータスを変更" onchange="cloudSetStatus(\'' + idAttr + '\', this.value)">' + opts + '</select>' +
            '<span class="cloud-card-name" title="' + escHtml(r.name) + '">' + escHtml(r.name) + '</span>' +
            '<button class="btn-preset-preview" onclick="cloudPreviewPreset(\'' + idAttr + '\')" title="内容をプレビュー">プレビュー</button>' +
            '<button class="btn-preset-load" onclick="cloudLoadPreset(\'' + idAttr + '\')">読込</button>' +
            '<button class="btn-preset-del"  onclick="cloudDeletePreset(\'' + idAttr + '\')" title="削除（全員から消えます）">✕</button>' +
          '</div>' +
          (condChips.length
            ? '<div class="cloud-card-cond">' + condChips.join('') + '</div>'
            : '') +
          '<div class="cloud-card-row2">' +
            (custParts.length ? '<span class="cloud-card-meta">' + custParts.join('') + '</span>' : '') +
            '<span class="cloud-card-who" title="作成：' + escHtml(crtWho || '—') + ' / 最終更新：' + escHtml(updWho || '—') + '">' +
              '✏️ ' + escHtml(updWho || '—') + '・' + ts + '</span>' +
          '</div>' +
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
    // 複数航路（z2-routes-data）対応：単一フィールドが空なら航路配列から収集
    let pol     = (f['z2Pol']     || '').trim() || null;
    let pod     = (f['z2Pod']     || '').trim() || null;
    let carrier = (f['z2Carrier'] || '').trim() || null;
    if (!pol && !pod && !carrier) {
      try {
        const rts = JSON.parse(f['z2-routes-data'] || '[]');
        if (Array.isArray(rts) && rts.length) {
          pol     = rts.map(r => r.pol).filter(Boolean).join(', ')     || null;
          pod     = rts.map(r => r.pod).filter(Boolean).join(', ')     || null;
          carrier = rts.map(r => r.carrier).filter(Boolean).join(', ') || null;
        }
      } catch(e) {}
    }

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
  // ---------- 簡易プレビュー ----------

  function _cpKV(k, v) {
    return `<div class="cp-kv"><span class="cp-kv-k">${escHtml(k)}</span><span class="cp-kv-v">${escHtml(String(v || ''))}</span></div>`;
  }

  function _cpRenderCondInfo(fields) {
    if (!fields || !Object.keys(fields).length) {
      return '<div class="cp-cond-empty">引き合い条件情報なし</div>';
    }
    const f = fields;
    const condRows = [];

    const dir = f['cond-direction'];
    if (dir) condRows.push(_cpKV('方向', dir === 'export' ? '輸出' : dir === 'import' ? '輸入' : dir));
    if (f['cond-incoterms']) condRows.push(_cpKV('インコタームズ', f['cond-incoterms']));
    if (f['cond-mode'])      condRows.push(_cpKV('輸送モード', f['cond-mode']));
    const ins = f['cond-insurance-on'] === 'true' || f['cond-insurance-on'] === true;
    if (ins) condRows.push(_cpKV('保険', '付保あり'));

    const z1On = f['cond-zone1-on'] === 'true' || f['cond-zone1-on'] === true;
    if (z1On) {
      const z1 = [f['z1Place'], f['z1Country']].filter(Boolean).join(', ');
      if (z1) condRows.push(_cpKV('出発地', z1));
    }
    // 複数航路（z2-routes-data）対応。なければ単一フィールドにフォールバック
    const routeEntries = [];
    try {
      const rts = JSON.parse(f['z2-routes-data'] || '[]');
      if (Array.isArray(rts) && rts.length) rts.forEach(r => routeEntries.push(r));
    } catch(e) {}
    if (routeEntries.length) {
      routeEntries.forEach((r, i) => {
        const leg  = [r.pol, r.pod].filter(Boolean).join(' → ');
        const line = [r.carrier, leg].filter(Boolean).join('  ');
        if (line) condRows.push(_cpKV(i === 0 ? '航路' : '　', line));
      });
    } else {
      if (f['z2Pol'] || f['z2Pod']) {
        condRows.push(_cpKV('POL → POD', [f['z2Pol'] || '—', f['z2Pod'] || '—'].join(' → ')));
      }
      if (f['z2Carrier']) condRows.push(_cpKV('キャリア', f['z2Carrier']));
    }
    const z3On = f['cond-zone3-on'] === 'true' || f['cond-zone3-on'] === true;
    if (z3On) {
      const z3 = [f['z3Place'], f['z3Country']].filter(Boolean).join(', ');
      if (z3) condRows.push(_cpKV('到着地', z3));
    }

    const cargoRows = [];
    if (f['cond-cargo']) cargoRows.push(_cpKV('品名', f['cond-cargo']));
    if (f['cond-hs'])    cargoRows.push(_cpKV('HSコード', f['cond-hs']));
    const basicRate = f['cond-hs-basic'];
    const prefRate  = f['cond-hs-pref'];
    if (basicRate || prefRate) {
      const rates = [basicRate ? '基本 ' + basicRate : '', prefRate ? '特恵 ' + prefRate : ''].filter(Boolean).join(' / ');
      cargoRows.push(_cpKV('関税率', rates));
    }
    if (f['cond-hazmat']) cargoRows.push(_cpKV('危険品', f['cond-hazmat']));

    const volRows = [];
    try {
      const containers = JSON.parse(f['cond-container-data'] || '[]');
      if (Array.isArray(containers) && containers.length) {
        volRows.push(_cpKV('コンテナ', containers.map(c => `${c.type} × ${c.count}`).join(', ')));
      }
    } catch(e) {}
    try {
      const packings = JSON.parse(f['cond-packing-data'] || '[]');
      if (Array.isArray(packings) && packings.length) {
        const lines = packings.map(p => {
          const dims = [p.l, p.w, p.h].filter(Boolean).join('×');
          return [p.pkg, p.qty ? p.qty + '個' : '', dims ? dims + 'cm' : '', p.kg ? p.kg + 'kg' : ''].filter(Boolean).join(' ');
        }).filter(Boolean);
        if (lines.length) volRows.push(_cpKV('梱包', lines.join(' / ')));
      }
    } catch(e) {}

    let html = '';
    if (condRows.length) html += `<div class="cp-cond-section"><div class="cp-cond-section-title">貿易条件・輸送</div><div class="cp-cond-rows">${condRows.join('')}</div></div>`;
    if (cargoRows.length) html += `<div class="cp-cond-section"><div class="cp-cond-section-title">貨物情報</div><div class="cp-cond-rows">${cargoRows.join('')}</div></div>`;
    if (volRows.length)   html += `<div class="cp-cond-section"><div class="cp-cond-section-title">物量</div><div class="cp-cond-rows">${volRows.join('')}</div></div>`;
    return html || '<div class="cp-cond-empty">引き合い条件情報なし</div>';
  }

  const _CAT_LABEL = (() => {
    const cats = (window.QuoteApp?.data?.CATEGORIES) || [];
    const m = {};
    cats.forEach(c => { m[c.value] = c.label; });
    return m;
  });

  async function cloudPreviewPreset(rawId) {
    const c = _getClient();
    if (!c) return;
    const id = decodeURIComponent(rawId);
    const { data, error } = await c
      .from(_table())
      .select('id,name,data,incoterms,transport_mode,pol,pod,carrier,customer,person,status,updated_at')
      .eq('id', id).single();
    if (error || !data) { quoteShowToast('⚠️ 取得失敗', 'warn'); return; }

    _cpId = id;
    _cpFullName = data.name || '（無題）';
    const rawData = data.data;
    // マイグレーション（グローバル関数として公開されていないため簡易版を行う）
    const rows = (rawData?.rows || []).map(r => {
      if (!r) return null;
      if (r._type) return r;
      return { _type: 'data', cells: Array.isArray(r) ? r : [] };
    }).filter(Boolean);
    _cpRows = rows;

    // メタ情報（ステータス・顧客・担当・更新日）
    const metaParts = [];
    const validUntil = rawData?.fields?.['qf-valid-until'];
    if (validUntil && new Date(validUntil) < new Date(new Date().toDateString())) {
      metaParts.push(`<span class="cp-expired-warn">⚠️ 有効期限切れ（${escHtml(validUntil)}）</span>`);
    }
    if (data.status) metaParts.push(`<span class="cp-status-badge cp-status--${_statusClass(data.status)}">${escHtml(data.status)}</span>`);
    if (data.customer) metaParts.push(`👤 ${escHtml(data.customer)}`);
    if (data.person)   metaParts.push(`🧑‍💼 ${escHtml(data.person)}`);
    if (data.updated_at) {
      const dt = new Date(data.updated_at).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      metaParts.push(`更新: ${dt}`);
    }

    document.getElementById('cpTitle').textContent = _cpFullName;
    document.getElementById('cpMeta').innerHTML = metaParts.join(' · ');

    // 引き合い条件セクション
    const condEl = document.getElementById('cpCondInfo');
    if (condEl) condEl.innerHTML = _cpRenderCondInfo(rawData?.fields || {});

    _cpRenderTable(rows);
    _cpUpdateSelCount();
    document.getElementById('cloudPreviewModal').style.display = 'flex';
    cpSwitchRightPane('summary');
    _loadAttachments(_cpId);
  }

  function _cpRenderTable(rows) {
    const catLabel = _CAT_LABEL();
    const tbody = document.getElementById('cpTableBody');
    if (!tbody) return;
    const dataRows = rows.filter(r => r._type === 'data' && r.cells?.length);
    if (!dataRows.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#9bb;padding:16px;">行データがありません</td></tr>';
      return;
    }
    // サブコン単位でグループ化（順序維持）
    const groups = [];
    const groupMap = {};
    dataRows.forEach((r, i) => {
      const sv = (r.cells[2] || '').trim() || '（サブコン未設定）';
      if (!groupMap[sv]) {
        groupMap[sv] = { sv, rows: [] };
        groups.push(groupMap[sv]);
      }
      groupMap[sv].rows.push({ row: r, idx: i });
    });

    tbody.innerHTML = groups.map(g => {
      const svEsc = escHtml(g.sv);
      const gId = 'cpg-' + g.sv.replace(/[^a-z0-9]/gi, '_');
      const header = `<tr class="cp-group-head">
        <td><input type="checkbox" class="cp-group-chk" data-group="${escHtml(g.sv)}" checked onchange="cpToggleGroup(this,'${escHtml(g.sv)}')" title="このサブコンを一括選択"></td>
        <td colspan="5" class="cp-group-label">🏢 ${svEsc} <span class="cp-group-cnt">${g.rows.length}行</span></td>
      </tr>`;
      const rowHtml = g.rows.map(({ row, idx }) => {
        const cells = row.cells;
        const cat = cells[1] || '';
        const nm  = cells[4] || '';
        const bq  = cells[7] || '';
        const un  = cells[6] || '';
        const pp  = cells[10] || '';
        const bp  = cells[11] || '';
        const nt  = cells[14] || '';
        const catLbl = catLabel[cat] || cat;
        const price = (pp && bp) ? `${pp} ${escHtml(bp)}` : (pp || '—');
        const qty   = (bq && un) ? `${bq} ${escHtml(un)}` : (bq || un || '—');
        return `<tr class="cp-row cp-row-in-group" data-sv="${escHtml(g.sv)}" data-idx="${idx}">
          <td><input type="checkbox" class="cp-chk" checked onchange="cpUpdateSelCount()"></td>
          <td class="cp-cat">${escHtml(catLbl)}</td>
          <td class="cp-nm">${escHtml(nm)}</td>
          <td class="cp-qty">${qty}</td>
          <td class="cp-price">${price}</td>
          <td class="cp-nt">${escHtml(nt)}</td>
        </tr>`;
      }).join('');
      return header + rowHtml;
    }).join('');
  }

  function cpToggleGroup(chk, sv) {
    document.querySelectorAll(`#cpTableBody .cp-row[data-sv="${sv.replace(/"/g, '\\"')}"] .cp-chk`).forEach(c => {
      c.checked = chk.checked;
    });
    _cpUpdateSelCount();
  }

  function cpToggleAll(chk) {
    document.querySelectorAll('#cpTableBody .cp-chk, #cpTableBody .cp-group-chk').forEach(c => { c.checked = chk.checked; });
    _cpUpdateSelCount();
  }

  function _cpUpdateSelCount() {
    const total = document.querySelectorAll('#cpTableBody .cp-chk').length;
    const sel   = document.querySelectorAll('#cpTableBody .cp-chk:checked').length;
    const el = document.getElementById('cpSelCount');
    if (el) el.textContent = `${sel} / ${total} 行選択中`;
    const allChk = document.getElementById('cpSelectAll');
    if (allChk) allChk.checked = sel > 0 && sel === total;
    // グループチェックボックスの indeterminate 更新
    document.querySelectorAll('#cpTableBody .cp-group-chk').forEach(gChk => {
      const sv = gChk.dataset.group;
      const rows = document.querySelectorAll(`#cpTableBody .cp-row[data-sv="${sv.replace(/"/g, '\\"')}"] .cp-chk`);
      const chked = [...rows].filter(c => c.checked).length;
      gChk.indeterminate = chked > 0 && chked < rows.length;
      if (!gChk.indeterminate) gChk.checked = chked === rows.length;
    });
  }

  function closeCloudPreview(e) {
    if (e && e.target.id !== 'cloudPreviewModal') return;
    document.getElementById('cloudPreviewModal').style.display = 'none';
    _cpId = null; _cpRows = [];
  }

  function cloudImportSelectedRows() {
    const dataRows = _cpRows.filter(r => r._type === 'data' && r.cells?.length);
    const chks = [...document.querySelectorAll('#cpTableBody .cp-row .cp-chk')];
    const selected = dataRows.filter((_, i) => chks[i]?.checked);
    if (!selected.length) { quoteShowToast('⚠️ 行を選択してください', 'warn'); return; }
    if (typeof window.appendQuoteRows !== 'function') {
      quoteShowToast('⚠️ 行追加関数が未ロードです', 'warn'); return;
    }
    const n = window.appendQuoteRows(selected);
    document.getElementById('cloudPreviewModal').style.display = 'none';
    quoteShowToast(`✅ ${n} 行を見積テーブルに追加しました`, 'success', 3500);
  }

  function cloudPreviewLoadFull() {
    if (!_cpId) return;
    document.getElementById('cloudPreviewModal').style.display = 'none';
    cloudLoadPreset(_cpId);
  }

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
      // user_profiles テーブルにも反映（チーム全員の一覧表示に使用）
      _profileMap[_cloudUser.email] = name;
      await c.from('user_profiles').upsert(
        { email: _cloudUser.email, display_name: name, updated_at: new Date().toISOString() },
        { onConflict: 'email' }
      );
      quoteShowToast('✅ 作業者名「' + name + '」を登録しました', 'success', 3000);
    }
  }

  // ================================================================
  // ========== 📦 ストレージ使用量表示 ==========
  // ================================================================

  async function _refreshStorageInfo() {
    const el = document.getElementById('cloudStorageInfo');
    if (!el) return;
    const c = _getClient();
    if (!c || !_cloudUser) { el.textContent = ''; return; }
    const { data } = await c.from('quote_attachments').select('file_size');
    const totalBytes = (data || []).reduce((s, r) => s + (r.file_size || 0), 0);
    const fmt = totalBytes < 1024 * 1024
      ? (totalBytes / 1024).toFixed(0) + ' KB'
      : (totalBytes / (1024 * 1024)).toFixed(1) + ' MB';
    el.textContent = `📦 添付合計 ${fmt}`;
  }

  // ================================================================
  // ========== 💬 案件チャット ==========
  // ================================================================

  function cpSwitchRightPane(name) {
    ['summary', 'chat'].forEach(n => {
      const tab  = document.getElementById('cpRTab_' + n);
      const pane = document.getElementById('cpPane_' + n);
      const active = n === name;
      if (tab)  tab.classList.toggle('cp-rtab--active', active);
      if (pane) pane.style.display = active ? '' : 'none';
    });
    if (name === 'chat') _loadComments(_cpId);
  }

  async function _loadComments(presetId) {
    const c    = _getClient();
    const wrap = document.getElementById('cpChatList');
    if (!wrap) return;
    if (!c || !_cloudUser) {
      wrap.innerHTML = '<span class="cp-chat-login">ログインするとコメントを表示できます</span>';
      return;
    }
    wrap.innerHTML = '<span class="cp-chat-loading">読み込み中…</span>';
    const { data, error } = await c
      .from('quote_comments')
      .select('id,body,created_by,created_at')
      .eq('preset_id', presetId)
      .order('created_at', { ascending: true });
    if (error) { wrap.innerHTML = '<span class="cp-chat-err">⚠️ 取得失敗</span>'; return; }
    _renderComments(data || []);
    wrap.scrollTop = wrap.scrollHeight;
  }

  function _renderComments(rows) {
    const wrap = document.getElementById('cpChatList');
    if (!wrap) return;
    if (!rows.length) {
      wrap.innerHTML = '<span class="cp-chat-empty">まだコメントはありません</span>';
      return;
    }
    wrap.innerHTML = rows.map(r => {
      const isMine = _cloudUser && r.created_by === _cloudUser.email;
      const name = escHtml(_nameFor(r.created_by));
      const dt   = new Date(r.created_at).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      return `<div class="cp-chat-item${isMine ? ' cp-chat-item--mine' : ''}">
        <div class="cp-chat-meta">${name} · ${dt}</div>
        <div class="cp-chat-body">${escHtml(r.body)}</div>
      </div>`;
    }).join('');
  }

  async function cpPostComment() {
    const c = _getClient();
    if (!c || !_cloudUser) { quoteShowToast('⚠️ ログインが必要です', 'warn'); return; }
    if (!_cpId) return;
    const input = document.getElementById('cpChatInput');
    const body  = input?.value.trim();
    if (!body) return;
    const btn = document.querySelector('.cp-chat-send');
    if (btn) btn.disabled = true;
    try {
      const { error } = await c.from('quote_comments').insert({
        preset_id:  _cpId,
        body,
        created_by: _cloudUser.email,
      });
      if (error) throw error;
      if (input) input.value = '';
      await _loadComments(_cpId);
    } catch(e) {
      quoteShowToast('⚠️ 送信失敗：' + (e.message || e), 'warn', 5000);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ================================================================
  // ========== 📎 添付ファイル管理 ==========
  // ================================================================

  const _ATTACH_BUCKET = () => window.CLOUD_CONFIG?.attachmentBucket || 'quote-attachments';
  const _ATTACH_MAX_W  = 1920;   // 画像リサイズ上限（px）
  const _ATTACH_QUALITY = 0.82;  // JPEG 圧縮品質

  // 画像をクライアント側で圧縮（非画像はそのまま返す）
  function _compressImage(file) {
    return new Promise(resolve => {
      if (!file.type.startsWith('image/')) { resolve(file); return; }
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, _ATTACH_MAX_W / img.width);
        const canvas = document.createElement('canvas');
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          blob => resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })),
          'image/jpeg', _ATTACH_QUALITY
        );
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  // 添付ファイル一覧を取得してレンダリング
  async function _loadAttachments(presetId) {
    const c = _getClient();
    if (!c || !presetId) return;
    const wrap = document.getElementById('cpAttachList');
    if (!wrap) return;
    wrap.innerHTML = '<span class="cp-attach-loading">読み込み中…</span>';
    const { data, error } = await c
      .from('quote_attachments')
      .select('id,file_name,file_size,mime_type,storage_path,uploaded_by,created_at')
      .eq('preset_id', presetId)
      .order('created_at', { ascending: false });
    if (error) { wrap.innerHTML = '<span class="cp-attach-err">⚠️ 取得失敗</span>'; return; }
    _renderAttachments(data || []);
  }

  function _renderAttachments(rows) {
    const wrap = document.getElementById('cpAttachList');
    if (!wrap) return;
    if (!rows.length) { wrap.innerHTML = '<span class="cp-attach-empty">添付ファイルなし</span>'; return; }
    wrap.innerHTML = rows.map(r => {
      const kb   = r.file_size ? (r.file_size / 1024).toFixed(0) + ' KB' : '';
      const icon = (r.mime_type || '').startsWith('image/') ? '🖼' : '📄';
      const idEnc = encodeURIComponent(r.id);
      const pathEnc = encodeURIComponent(r.storage_path);
      return `<div class="cp-attach-item">
        <span class="cp-attach-icon">${icon}</span>
        <span class="cp-attach-name" title="${escHtml(r.file_name)}">${escHtml(r.file_name)}</span>
        <span class="cp-attach-size">${escHtml(kb)}</span>
        <button class="cp-attach-dl"  onclick="cpDownloadAttachment('${pathEnc}')" title="ダウンロード">⬇</button>
        <button class="cp-attach-del" onclick="cpDeleteAttachment('${idEnc}','${pathEnc}')" title="削除">✕</button>
      </div>`;
    }).join('');
  }

  // ファイル選択後にアップロード
  async function cpUploadAttachment(input) {
    const c = _getClient();
    if (!c || !_cloudUser) { quoteShowToast('⚠️ ログインが必要です', 'warn'); return; }
    if (!_cpId) { quoteShowToast('⚠️ 先にプレビューで案件を開いてください', 'warn'); return; }
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';

    const btn = document.getElementById('cpAttachUploadBtn');
    if (btn) { btn.disabled = true; btn.textContent = '圧縮・送信中…'; }
    try {
      const compressed = await _compressImage(file);
      const path = `${_cpId}/${Date.now()}_${compressed.name.replace(/[^\w.\-]/g, '_')}`;
      const { error: upErr } = await c.storage.from(_ATTACH_BUCKET()).upload(path, compressed, { upsert: false });
      if (upErr) throw upErr;
      const { error: dbErr } = await c.from('quote_attachments').insert({
        preset_id:    _cpId,
        storage_path: path,
        file_name:    file.name,
        file_size:    compressed.size,
        mime_type:    compressed.type,
        uploaded_by:  _cloudUser.email,
      });
      if (dbErr) throw dbErr;
      quoteShowToast('📎 添付しました', 'success', 2500);
      _loadAttachments(_cpId);
      _refreshStorageInfo();
    } catch(e) {
      quoteShowToast('⚠️ アップロード失敗：' + (e.message || e), 'warn', 5000);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '📎 ファイルを添付'; }
    }
  }

  // ダウンロード（署名付き URL を 60 秒発行）
  async function cpDownloadAttachment(rawPath) {
    const c = _getClient();
    if (!c) return;
    const path = decodeURIComponent(rawPath);
    const { data, error } = await c.storage.from(_ATTACH_BUCKET()).createSignedUrl(path, 60);
    if (error || !data?.signedUrl) { quoteShowToast('⚠️ URL 取得失敗', 'warn'); return; }
    const a = document.createElement('a');
    a.href = data.signedUrl;
    a.download = path.split('/').pop();
    a.click();
  }

  // 削除
  async function cpDeleteAttachment(rawId, rawPath) {
    if (!confirm('この添付ファイルを削除しますか？')) return;
    const c = _getClient();
    if (!c) return;
    const id   = decodeURIComponent(rawId);
    const path = decodeURIComponent(rawPath);
    const { error: stErr } = await c.storage.from(_ATTACH_BUCKET()).remove([path]);
    if (stErr) { quoteShowToast('⚠️ Storage 削除失敗：' + stErr.message, 'warn'); return; }
    const { error: dbErr } = await c.from('quote_attachments').delete().eq('id', id);
    if (dbErr) { quoteShowToast('⚠️ DB 削除失敗：' + dbErr.message, 'warn'); return; }
    quoteShowToast('✅ 削除しました', 'success', 2000);
    _loadAttachments(_cpId);
    _refreshStorageInfo();
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
  window.cloudPreviewPreset    = cloudPreviewPreset;
  window.closeCloudPreview     = closeCloudPreview;
  window.cloudImportSelectedRows = cloudImportSelectedRows;
  window.cloudPreviewLoadFull  = cloudPreviewLoadFull;
  window.cpToggleAll           = cpToggleAll;
  window.cpToggleGroup         = cpToggleGroup;
  window.cpUpdateSelCount      = _cpUpdateSelCount;
  window.cpUploadAttachment    = cpUploadAttachment;
  window.cpDownloadAttachment  = cpDownloadAttachment;
  window.cpDeleteAttachment    = cpDeleteAttachment;
  window.cpSwitchRightPane     = cpSwitchRightPane;
  window.cpPostComment         = cpPostComment;

  // supabase-js は <head> で defer 読み込みのため DOMContentLoaded を待つ
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initCloud);
  } else {
    _initCloud();
  }
