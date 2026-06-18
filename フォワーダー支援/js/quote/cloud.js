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
  const CLOUD_STATUSES = ['下書き中', '提出済み', '受注', '失注', '辞退', '保留'];
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
  // ダッシュボード：並び替え・表示形式
  let _cloudSort = 'updated';   // updated|status|who|person|customer
  let _cloudView = 'card';      // card|list
  // プレビュー
  let _cpId        = null;   // プレビュー中のプリセット ID
  let _cpRows      = [];     // プレビュー中の行データ（v3形式）
  let _cpFullName  = '';     // プレビュー中のプリセット名
  // メンバープロフィール（email → display_name / avatar）
  let _profileMap  = {};     // { 'email': 'name', ... }（後方互換）
  let _profileAv   = {};     // { 'email': { color, emoji }, ... }
  // 同時編集（フェーズ1：保存競合検知）用にロード中の案件を追跡
  let _loadedCloudId = null;
  let _loadedCloudTs = null;
  // プロフィール編集（アバター）の選択肢
  const PROFILE_COLORS = ['#8a6d3b','#2b7bb0','#1e7e44','#9a7bbf','#b07d5a','#c0856a','#5a8a8a','#a8632e','#c0392b','#b8860b'];
  const PROFILE_EMOJIS = ['','🚚','🚢','✈️','📦','🛃','🌏','💼','📋','🧑‍💼','⭐','🔥','🍀','🐱','🐶','🌸','🎯','😀'];
  function _avatarHashColor(email) {
    let h = 0; const s = email || '';
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return PROFILE_COLORS[h % PROFILE_COLORS.length];
  }
  // アバター描画情報（プロフィール優先・無ければハッシュ色＋頭文字）
  function _avatarFor(email, name) {
    const p = _profileAv[email] || {};
    const color = p.color || _avatarHashColor(email || '');
    const initial = (name || email || '?').trim().charAt(0).toUpperCase();
    return { color, label: p.emoji || initial, emoji: p.emoji || '' };
  }
  window.quoteAvatarFor = _avatarFor;

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
    if (typeof _renderQpdAuth === 'function') _renderQpdAuth();   // ダッシュボードのログイン出し分けも同期
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
      // ログイン後に共有リマークプリセットをロード
      if (typeof window.loadSharedRemarkPresets === 'function') window.loadSharedRemarkPresets();
      // ヘッダー：ユーザー名表示
      if (hdrLogin) hdrLogin.style.display = 'none';
      if (hdrUser)  hdrUser.style.display  = '';
      if (hdrName)  hdrName.textContent = name;
      if (hdrAvatar) {
        const prof = _profileAv[_cloudUser.email] || {};
        const av = (_cloudUser.user_metadata || {}).avatar_url;
        if (prof.color || prof.emoji) {           // 本人が設定したアバターを最優先
          const a = _avatarFor(_cloudUser.email, name);
          hdrAvatar.style.backgroundImage = ''; hdrAvatar.style.backgroundColor = a.color;
          hdrAvatar.textContent = a.label; hdrAvatar.classList.remove('has-img');
        } else if (av) {
          hdrAvatar.style.backgroundImage = `url("${av}")`; hdrAvatar.style.backgroundColor = '';
          hdrAvatar.textContent = ''; hdrAvatar.classList.add('has-img');
        } else {
          const a = _avatarFor(_cloudUser.email, name);
          hdrAvatar.style.backgroundImage = ''; hdrAvatar.style.backgroundColor = a.color;
          hdrAvatar.textContent = a.label; hdrAvatar.classList.remove('has-img');
        }
      }
      // FB受信一覧タブを表示
      if (typeof refreshFbAdminTab === 'function') refreshFbAdminTab(_cloudUser);
      // チーム管理：ロール取得＆入口の出し分け
      if (typeof window.umOnAuth === 'function') window.umOnAuth(_cloudUser);
    } else {
      stateEl.textContent = '未ログイン';
      stateEl.classList.remove('is-on');
      if (hint) hint.style.display = '';
      if (body) body.style.display = 'none';
      // ヘッダー：ログインボタン表示
      if (hdrLogin) hdrLogin.style.display = '';
      if (hdrUser)  hdrUser.style.display  = 'none';
      // FB受信一覧タブを隠す
      if (typeof refreshFbAdminTab === 'function') refreshFbAdminTab(null);
      // チーム管理：入口を隠す
      if (typeof window.umOnAuth === 'function') window.umOnAuth(null);
    }
  }

  // ---------- プロフィール（email → 表示名）----------
  async function _loadProfiles() {
    const c = _getClient();
    if (!c) return;
    let { data, error } = await c.from('user_profiles').select('email,display_name,avatar_color,avatar_emoji');
    if (error) { ({ data } = await c.from('user_profiles').select('email,display_name')); }  // avatar列が未作成でも名前は読む
    if (data) data.forEach(r => {
      if (!r.email) return;
      if (r.display_name) _profileMap[r.email] = r.display_name;
      _profileAv[r.email] = { color: r.avatar_color || '', emoji: r.avatar_emoji || '' };
    });
  }

  function _nameFor(email) {
    if (!email) return '—';
    return _profileMap[email] || email.split('@')[0];
  }

  // ---------- 一覧 ----------
  async function cloudListPresets(silent) {
    const c = _getClient();
    const wrap = document.getElementById('cloudPresetListWrap');
    if (!c || !_cloudUser) return;
    if (wrap && !silent) wrap.innerHTML = '<div class="preset-empty">読み込み中…</div>';
    await _loadProfiles();
    // locked_by/locked_at（編集ロック）も取得。列が未マイグレーションなら従来列にフォールバック。
    let { data, error } = await c
      .from(_table())
      .select('id,name,status,customer,person,owner_email,created_by,updated_at,incoterms,transport_mode,pol,pod,carrier,data,locked_by,locked_at')
      .order('updated_at', { ascending: false });
    if (error) {
      ({ data, error } = await c
        .from(_table())
        .select('id,name,status,customer,person,owner_email,created_by,updated_at,incoterms,transport_mode,pol,pod,carrier,data')
        .order('updated_at', { ascending: false }));
    }
    if (error) {
      if (wrap) wrap.innerHTML =
        '<div class="preset-empty">⚠️ 取得に失敗：' + escHtml(error.message) +
        '<br><small>許可リスト（allowed_emails）に登録されていない可能性があります</small></div>';
      return;
    }
    _cloudRows = data || [];
    _renderStatusChips();
    _renderQpdStats();
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
      if (_cloudStatusFilter && (_normalizeStatus(r.status) || CLOUD_STATUS_DEFAULT) !== _normalizeStatus(_cloudStatusFilter)) return false;
      if (_cloudFilterMode    && r.transport_mode !== _cloudFilterMode)  return false;
      if (_cloudFilterInco    && r.incoterms       !== _cloudFilterInco) return false;
      if (pol && !(r.pol     || '').toLowerCase().includes(pol)) return false;
      if (pod && !(r.pod     || '').toLowerCase().includes(pod)) return false;
      if (car && !(r.carrier || '').toLowerCase().includes(car)) return false;
      if (!q) return true;
      const hay = [r.name, r.customer, r.person, r.owner_email].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
    _renderCloudList(_sortCloudRows(rows));
  }

  // ダッシュボードの並び替え
  const _STATUS_ORDER = { '下書き中': 0, '提出済み': 1, '受注': 2, '失注': 3, '辞退': 4, '保留': 5 };
  function _sortCloudRows(rows) {
    const s = _cloudSort || 'updated';
    const upd = e => e.updated_at || '';
    const who = e => _nameFor(e.owner_email) || '';
    const r = rows.slice();
    if (s === 'due') {
      const dueOf = e => { const mm = (window.quotePresetMeta && e.data) ? window.quotePresetMeta({ data: e.data }) : null; return (mm && mm.due) || '9999-12-31'; };
      r.forEach(e => { e.__due = dueOf(e); });
      r.sort((a, b) => a.__due.localeCompare(b.__due) || upd(b).localeCompare(upd(a)));   // 期限が近い順（未設定は最後）
    }
    else if (s === 'status')   r.sort((a, b) => (_STATUS_ORDER[a.status] ?? 9) - (_STATUS_ORDER[b.status] ?? 9) || upd(b).localeCompare(upd(a)));
    else if (s === 'who')      r.sort((a, b) => who(a).localeCompare(who(b), 'ja') || upd(b).localeCompare(upd(a)));
    else if (s === 'person')   r.sort((a, b) => (a.person   || '').localeCompare(b.person   || '', 'ja') || upd(b).localeCompare(upd(a)));
    else if (s === 'customer') r.sort((a, b) => (a.customer || '').localeCompare(b.customer || '', 'ja') || upd(b).localeCompare(upd(a)));
    else                       r.sort((a, b) => upd(b).localeCompare(upd(a)));   // updated（既定）
    return r;
  }

  // 詳細検索ドロップダウンをロード済みデータから生成（モーダル＋ダッシュボード両方）
  function _renderAdvancedFilters() {
    const unique = (key) => [...new Set(_cloudRows.map(r => r[key]).filter(Boolean))].sort();
    const modes  = unique('transport_mode');
    const incos  = unique('incoterms');
    const fill = (el, head, list, cur) => {
      if (!el) return;
      el.innerHTML = '<option value="">' + head + '</option>' +
        list.map(v => '<option value="' + escHtml(v) + '"' + (cur === v ? ' selected' : '') + '>' + escHtml(v) + '</option>').join('');
    };
    fill(document.getElementById('cloudFilterMode'), '輸送モード：すべて', modes, _cloudFilterMode);
    fill(document.getElementById('cloudFilterInco'), 'インコタームズ：すべて', incos, _cloudFilterInco);
    fill(document.getElementById('qpdFilterMode'),   '輸送モード：すべて', modes, _cloudFilterMode);
    fill(document.getElementById('qpdFilterInco'),   'インコタームズ：すべて', incos, _cloudFilterInco);
    // ダッシュボード側のテキスト系も現在値へ同期
    const setv = (id, v) => { const e = document.getElementById(id); if (e && e.value !== v) e.value = v; };
    setv('qpdFilterPol', _cloudFilterPol); setv('qpdFilterPod', _cloudFilterPod); setv('qpdFilterCarrier', _cloudFilterCarrier);
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
    const count = st => _cloudRows.filter(r => _normalizeStatus(r.status || CLOUD_STATUS_DEFAULT) === _normalizeStatus(st)).length;
    const chip = (val, label, n) =>
      '<button type="button" class="cloud-chip' + (_cloudStatusFilter === val ? ' is-active' : '') +
      (val ? ' cloud-chip--' + _statusClass(val) : '') +
      '" onclick="cloudFilterStatus(\'' + val + '\')">' + escHtml(label) +
      '<span class="cloud-chip-n">' + n + '</span></button>';
    let html = chip('', 'すべて', _cloudRows.length);
    html += CLOUD_STATUSES.map(st => chip(st, st, count(st))).join('');
    box.innerHTML = html;
  }

  // 旧値「提示済み」→「提出済み」に正規化（DB 移行前の既存データ対応）
  function _normalizeStatus(st) {
    return st === '提示済み' ? '提出済み' : (st || '');
  }
  function _statusClass(st) {
    return { '下書き中':'draft', '提出済み':'sent', '提示済み':'sent', '受注':'won', '失注':'lost', '辞退':'declined', '保留':'hold' }[st] || 'draft';
  }

  // 依頼受信日・提出期限から経過日／残り日数バッジを生成（ダッシュボード優先度表示）
  function _todayStart() { var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime(); }
  function _dueBadge(dueStr) {
    if (!dueStr) return '';
    var d = new Date(dueStr); if (isNaN(d.getTime())) return '';
    var days = Math.round((d.getTime() - _todayStart()) / 86400000);
    var lvl, txt;
    if (days < 0)       { lvl = 'over';  txt = '締切超過 ' + (-days) + '日'; }
    else if (days === 0){ lvl = 'today'; txt = '締切 本日'; }
    else if (days <= 2) { lvl = 'soon';  txt = '締切まで ' + days + '日'; }
    else                { lvl = 'ok';    txt = '締切まで ' + days + '日'; }
    return '<span class="cloud-due cloud-due--' + lvl + '" title="提出期限：' + escHtml(dueStr) + '">⏰ ' + txt + '</span>';
  }
  function _receivedBadge(recvStr) {
    if (!recvStr) return '';
    var d = new Date(recvStr); if (isNaN(d.getTime())) return '';
    var days = Math.floor((_todayStart() - d.getTime()) / 86400000);
    if (days < 0) return '';
    return '<span class="cloud-recv" title="依頼受信日：' + escHtml(recvStr) + '">📥 受信から ' + days + '日</span>';
  }

  // 役割ラベル＝費用行のカテゴリ（CATEGORIES の value → 短縮ラベル）
  const _SUBCON_ROLE = {
    'domestic':'国内作業', 'export-local':'輸出ローカル', 'ocean':'海上', 'air':'航空',
    'surcharge':'サーチャージ', 'import-local':'輸入ローカル', 'overseas':'海外作業',
    'customs-export':'通関(輸出)', 'customs-import':'通関(輸入)', 'insurance':'保険', 'other':'その他',
  };
  // 見積データ（gatherAllData 形式）の費用行から、サブコン名ごとに役割（カテゴリ）を1つ割り当てて配列化
  function _extractSubcons(data) {
    const rows = (data && data.rows) || [];
    const order = [], map = {};
    rows.forEach(r => {
      if (!r || r._type !== 'data' || !Array.isArray(r.cells)) return;
      const cat = (r.cells[1] || '').trim();   // ROW_CELL_FIELDS[0] = 'cat'
      const sv  = (r.cells[2] || '').trim();   // ROW_CELL_FIELDS[1] = 'sv'（サブコン）
      if (!sv) return;
      if (!map[sv]) { map[sv] = { name: sv, role: _SUBCON_ROLE[cat] || '' }; order.push(sv); }
      else if (!map[sv].role && _SUBCON_ROLE[cat]) map[sv].role = _SUBCON_ROLE[cat];
    });
    return order.map(k => map[k]);
  }
  // ブラウザ保存（ui.js renderPresetList）からも共通利用する
  window.quoteExtractSubcons = _extractSubcons;

  function _renderCloudList(rows) {
    // チーム共有モーダルの一覧と、ダッシュボードの一覧の両方へ描画
    const wraps = [document.getElementById('cloudPresetListWrap'), document.getElementById('qpdListWrap')].filter(Boolean);
    if (!wraps.length) return;
    let html;
    if (!_cloudRows.length) {
      html = '<div class="preset-empty">共有案件はまだありません<br>'
        + '<small style="color:#9bb;">「🆕 新規見積を作成」から保存できます</small></div>';
      wraps.forEach(w => w.innerHTML = html);
      return;
    }
    if (!rows.length) {
      html = '<div class="preset-empty">条件に合う案件がありません<br>'
        + '<small style="color:#9bb;">検索語・ステータスを変えてください</small></div>';
      wraps.forEach(w => w.innerHTML = html);
      return;
    }
    const cardsHtml = rows.map(r => {
      const ts = r.updated_at
        ? new Date(r.updated_at).toLocaleString('ja-JP',
            { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })
        : '';
      const status = r.status || CLOUD_STATUS_DEFAULT;
      const updWho = _nameFor(r.owner_email);
      const crtWho = _nameFor(r.created_by);
      const idAttr = encodeURIComponent(r.id);
      const lockedBy = _lockedByOther(r);   // 他メンバーが編集ロック中なら そのemail

      // 表示はブラウザ保存（renderPresetList）と同じく案件 data から算出する
      const m = (window.quotePresetMeta && r.data) ? window.quotePresetMeta({ data: r.data }) : null;
      const pol     = m ? m.pol       : r.pol;
      const pod     = m ? m.pod       : r.pod;
      const carrier = m ? m.carrier   : r.carrier;
      const inco    = m ? m.incoterms : r.incoterms;
      const mode    = m ? m.mode      : r.transport_mode;
      const customer = m ? m.customer : r.customer;
      const person   = m ? m.person   : r.person;
      const subcons  = (m && Array.isArray(m.subcons)) ? m.subcons : (Array.isArray(r.subcons) ? r.subcons : []);

      const routeMeta = m || { pol, pod, routes: [] };
      const route = (window.quoteRouteHtml)
        ? window.quoteRouteHtml(routeMeta, 'cloud-kv-arrow')
        : ((pol || pod) ? [pol, pod].filter(Boolean).map(escHtml).join(' <span class="cloud-kv-arrow">→</span> ') : '');
      const condHtml =
        (inco ? '<span class="cloud-tag cloud-tag-inco">' + escHtml(String(inco).split('（')[0]) + '</span>' : '') +
        (mode ? '<span class="cloud-tag cloud-tag-mode">' + escHtml(mode) + '</span>' : '');
      const personH = person && (window.formatPersonWithHonorific ? window.formatPersonWithHonorific(person) : person);
      const custDd = [customer && escHtml(customer), personH && escHtml(personH)].filter(Boolean).join('・');
      const titleText = (m && m.ref) ? m.ref : r.name;   // 見出しは仮REF#のみ（顧客/担当は下に別掲）
      const memoLine  = (m && m.memo) ? m.memo : '';
      const dueBadge  = _dueBadge(m && m.due);
      const recvBadge = _receivedBadge(m && m.received);
      const prioRow   = (dueBadge || recvBadge) ? '<div class="cloud-card-prio">' + dueBadge + recvBadge + '</div>' : '';

      // サブコン（役割ラベル付き・5件目以降は +N）
      const subShown = subcons.slice(0, 4);
      const subMore  = subcons.length - subShown.length;
      const subHtml = subShown.map(s =>
        '<span class="cloud-sc-item">' +
          (s.role ? '<span class="cloud-sc-role">' + escHtml(s.role) + '</span>' : '') +
          '<span class="cloud-sc-name">' + escHtml(s.name) + '</span>' +
        '</span>').join('') + (subMore > 0 ? '<span class="cloud-sc-more">+' + subMore + '</span>' : '');

      // ステータスは静的バッジ（ブラウザ保存と同じく編集不可）
      const statusBadge = '<span class="cloud-status-badge cloud-status--' + _statusClass(status) + '">' + escHtml(status) + '</span>';

      // 同時編集（Presence）：他メンバーが開いていれば「作業中」を名前入りで表示
      const others = _presenceOthers(r.id);
      const editBadge = others.length
        ? '<div class="cloud-card-editing" title="他のメンバーがこの案件を開いています">' +
            '<span class="cloud-editing-dot"></span>' +
            '<span class="cloud-editing-text">🔒 <b>' + escHtml(others.join('、')) + '</b> さんが作業中です</span>' +
          '</div>'
        : '';

      var progressHtml = (window.quoteProgressBarHtml && r.data) ? window.quoteProgressBarHtml(r.data) : '';
      const cf = r.data && r.data.copiedFrom;
      const origId = cf && cf.id;
      const origExists = origId && _cloudRows.some(row => row.id === origId);
      const cfRefBadge = (cf && cf.ref) ? ' <span class="preset-cf-ref">(' + escHtml(cf.ref) + ')</span>' : '';
      const copiedFromHtml = cf
        ? '<div class="cloud-copied-from">📋 コピー元：<span class="cloud-cf-name">' + escHtml(cf.name || '不明') + cfRefBadge + '</span>' +
          (origExists ? ' <button class="btn-cf-preview" onclick="cloudPreviewPreset(\'' + encodeURIComponent(origId) + '\')" title="コピー元をプレビュー">プレビュー</button>' : '') +
          '</div>'
        : '';
      return '' +
        '<div class="cloud-card cloud-card-labeled' + (others.length ? ' is-editing' : '') + '">' +
          '<div class="cloud-card-row1">' +
            statusBadge +
            '<span class="cloud-card-name" title="' + escHtml(r.name) + '">' + escHtml(titleText) + '</span>' +
            '<button class="btn-ref-copy" data-ref="' + escHtml(titleText) + '" onclick="copyRefNumber(this.dataset.ref,this)" title="管理番号をコピー（&quot;番号&quot;形式）"><svg class="icon-copy" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="1" width="9" height="9" rx="1.5"/><rect x="1" y="4" width="9" height="9" rx="1.5"/></svg></button>' +
          '</div>' +
          prioRow +
          (memoLine ? '<div class="cloud-card-memo" title="' + escHtml(memoLine) + '">' + escHtml(memoLine) + '</div>' : '') +
          editBadge +
          progressHtml +
          '<dl class="cloud-kv">' +
            (route    ? '<dt>ルート</dt><dd>' + route + '</dd>' : '') +
            (condHtml ? '<dt>条件</dt><dd class="cloud-kv-tags">' + condHtml + '</dd>' : '') +
            (carrier  ? '<dt>幹線</dt><dd>🚢 ' + escHtml(carrier) + '</dd>' : '') +
            (subHtml  ? '<dt>サブコン</dt><dd class="cloud-kv-sub">' + subHtml + '</dd>' : '') +
            (custDd   ? '<dt>お客様 / 担当</dt><dd>' + custDd + '</dd>' : '') +
          '</dl>' +
          copiedFromHtml +
          '<div class="cloud-card-foot">' +
            '<span class="cloud-card-who" title="作成：' + escHtml(crtWho || '—') + ' / 最終更新：' + escHtml(updWho || '—') + '">' +
              '✏️ ' + escHtml(updWho || '—') + '・' + ts + '</span>' +
            '<div class="cloud-card-acts">' +
              '<button class="btn-preset-preview" onclick="cloudPreviewPreset(\'' + idAttr + '\')" title="内容をプレビュー">プレビュー</button>' +
              '<button class="btn-preset-load" onclick="cloudLoadPreset(\'' + idAttr + '\')">読込</button>' +
              '<button class="btn-preset-copy" onclick="cloudDuplicatePreset(\'' + idAttr + '\')" title="コピーして新規案件を作成">📋 コピー</button>' +
              (lockedBy
                ? '<button class="btn-preset-del is-locked" disabled title="' + escHtml(_nameFor(lockedBy)) + ' さんが作業中のため削除できません">🔒</button>'
                : '<button class="btn-preset-del"  onclick="cloudDeletePreset(\'' + idAttr + '\')" title="削除（全員から消えます）">✕</button>') +
            '</div>' +
          '</div>' +
        '</div>';
    }).join('');
    // モーダルは常にカード、ダッシュボードはカード/リスト切替
    const modalWrap = document.getElementById('cloudPresetListWrap');
    const dashWrap  = document.getElementById('qpdListWrap');
    if (modalWrap) modalWrap.innerHTML = cardsHtml;
    if (dashWrap) {
      const listMode = _cloudView === 'list';
      dashWrap.classList.toggle('qpd-list--rows', listMode);
      dashWrap.innerHTML = listMode
        ? ('<div class="qpd-rows-head"><span>状態</span><span>見積番号</span><span>お客様 / 担当</span><span>作業者</span><span>更新</span><span></span></div>'
            + rows.map(_cloudListRow).join(''))
        : cardsHtml;
    }
  }

  // ダッシュボード：リスト（行）表示の1行
  function _cloudListRow(r) {
    const m = (window.quotePresetMeta && r.data) ? window.quotePresetMeta({ data: r.data }) : null;
    const title  = (m && m.ref) ? m.ref : r.name;
    const status = r.status || CLOUD_STATUS_DEFAULT;
    const cust   = (m ? m.customer : r.customer) || '';
    const person = (m ? m.person : r.person) || '';
    const who    = _nameFor(r.owner_email) || '—';
    const ts     = r.updated_at ? new Date(r.updated_at).toLocaleString('ja-JP', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }) : '';
    const idAttr = encodeURIComponent(r.id);
    const lockedBy = _lockedByOther(r);
    return '<div class="qpd-row" onclick="cloudLoadPreset(\'' + idAttr + '\')" title="クリックで開く">' +
      '<span class="qpd-row-status cloud-status-badge cloud-status--' + _statusClass(status) + '">' + escHtml(status) + '</span>' +
      '<span class="qpd-row-title">' + escHtml(title) + '</span>' +
      '<span class="qpd-row-cust">' + escHtml(cust) + (person ? ' <small>/ ' + escHtml(person) + '</small>' : '') + '</span>' +
      '<span class="qpd-row-who">' + escHtml(who) + '</span>' +
      '<span class="qpd-row-ts">' + ts + '</span>' +
      '<span class="qpd-row-acts" onclick="event.stopPropagation()">' +
        '<button class="qpd-row-btn" onclick="cloudPreviewPreset(\'' + idAttr + '\')" title="プレビュー">👁</button>' +
        '<button class="qpd-row-btn" onclick="cloudDuplicatePreset(\'' + idAttr + '\')" title="コピーして新規案件を作成">📋</button>' +
        (lockedBy
          ? '<button class="qpd-row-btn is-locked" disabled title="' + escHtml(_nameFor(lockedBy)) + ' さんが作業中">🔒</button>'
          : '<button class="qpd-row-btn" onclick="cloudDeletePreset(\'' + idAttr + '\')" title="削除">✕</button>') +
      '</span>' +
    '</div>';
  }

  // ダッシュボードの統計カード（ステータス別件数・クリックで絞り込み）
  function _renderQpdStats() {
    const box = document.getElementById('qpdStats');
    if (!box) return;
    const count = st => _cloudRows.filter(r => _normalizeStatus(r.status || CLOUD_STATUS_DEFAULT) === _normalizeStatus(st)).length;
    const card = (val, label, n, cls) =>
      '<button type="button" class="qpd-stat' + (_cloudStatusFilter === val ? ' is-active' : '') +
        (cls ? ' qpd-stat--' + cls : '') + '" onclick="cloudFilterStatus(\'' + val + '\')">' +
        '<span class="qpd-stat-n">' + n + '</span><span class="qpd-stat-l">' + escHtml(label) + '</span></button>';
    let html = card('', '全体', _cloudRows.length, 'all');
    html += CLOUD_STATUSES.map(st => card(st, st, count(st), _statusClass(st))).join('');
    box.innerHTML = html;
  }

  // ---------- Presence（同時編集の可視化／フェーズ2） ----------
  let _presenceCh  = null;
  let _presence    = {};     // presetId -> [{ email, name }]
  let _myEditingId = null;

  // ---------- 非アクティブ自動解放 ----------
  const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000; // 5分
  const INACTIVITY_RECOVERY_KEY = 'cloudEditRecovery_v1';
  let _inactivityTimer = null;

  function _releaseOnInactivity() {
    if (!_myEditingId) return;
    // 入力中データをブラウザに保存
    try {
      if (typeof gatherAllData === 'function') {
        const snapshot = gatherAllData();
        localStorage.setItem(INACTIVITY_RECOVERY_KEY, JSON.stringify({
          data: snapshot,
          savedAt: Date.now(),
          presetId: _myEditingId,
        }));
      }
    } catch (e) {}
    _setEditing(null);
    quoteShowToast(
      '⏱️ 未操作状態が続いたため閲覧モードに戻りました。入力データはブラウザに保存済みです（プリセット保存ボタンで復元できます）。',
      'warn', 8000
    );
  }

  function _resetInactivityTimer() {
    if (!_myEditingId) return;
    clearTimeout(_inactivityTimer);
    _inactivityTimer = setTimeout(_releaseOnInactivity, INACTIVITY_TIMEOUT_MS);
  }

  function _startInactivityWatch() {
    clearTimeout(_inactivityTimer);
    _inactivityTimer = setTimeout(_releaseOnInactivity, INACTIVITY_TIMEOUT_MS);
    ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll', 'input', 'change'].forEach(evt =>
      document.addEventListener(evt, _onUserActivity, { passive: true })
    );
  }

  function _stopInactivityWatch() {
    clearTimeout(_inactivityTimer);
    _inactivityTimer = null;
    ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll', 'input', 'change'].forEach(evt =>
      document.removeEventListener(evt, _onUserActivity)
    );
  }

  function _onUserActivity() {
    if (_myEditingId) _resetInactivityTimer();
    else _stopInactivityWatch();
  }

  function _presenceOthers(presetId) {
    const arr = _presence[presetId] || [];
    const me = _cloudUser && _cloudUser.email;
    return arr.filter(u => u.email !== me).map(u => u.name);
  }
  function _rebuildPresence() {
    _presence = {};
    if (!_presenceCh) return;
    let state = {};
    try { state = _presenceCh.presenceState() || {}; } catch (e) { return; }
    Object.values(state).forEach(metas => (metas || []).forEach(mt => {
      if (!mt || !mt.presetId) return;
      (_presence[mt.presetId] = _presence[mt.presetId] || []).push({ email: mt.email, name: mt.name });
    }));
    const modal = document.getElementById('presetMgrModal');
    if (modal && modal.classList.contains('open')) {
      _applyCloudFilter();                 // Presence ラベルを即時反映（キャッシュ描画）
      _scheduleLockRefresh();              // ロック列(locked_by/at)を裏で再取得し🔒を最新化
    }
  }
  // 誰かが編集開始/終了したら、共有一覧のロック状態を静かに再取得して反映（デバウンス）
  let _lockRefreshT = null;
  function _scheduleLockRefresh() {
    if (_lockRefreshT) return;
    _lockRefreshT = setTimeout(() => {
      _lockRefreshT = null;
      const m = document.getElementById('presetMgrModal');
      if (m && m.classList.contains('open') && document.visibilityState !== 'hidden') {
        cloudListPresets(true);   // silent（「読み込み中」を出さず差し替え）
      }
    }, 1000);
  }
  function _trackEditing() {
    if (!_presenceCh || !_cloudUser) return;
    try {
      _presenceCh.track({
        email: _cloudUser.email,
        name: _cloudDisplayName(_cloudUser),
        presetId: _myEditingId || null,
        at: Date.now(),
      });
    } catch (e) {}
  }
  function _setEditing(presetId) {
    _myEditingId = presetId || null;
    _trackEditing();
    if (_myEditingId) _startInactivityWatch();
    else _stopInactivityWatch();
  }
  function _initPresence() {
    const c = _getClient();
    if (!c || !_cloudUser || _presenceCh) return;
    try {
      _presenceCh = c.channel('quote-presence', { config: { presence: { key: _cloudUser.email } } });
      _presenceCh
        .on('presence', { event: 'sync' }, _rebuildPresence)
        .subscribe(st => { if (st === 'SUBSCRIBED') _trackEditing(); });
    } catch (e) { _presenceCh = null; }
  }
  function _teardownPresence() {
    _stopInactivityWatch();
    if (_presenceCh) { try { _presenceCh.untrack(); _getClient() && _getClient().removeChannel(_presenceCh); } catch (e) {} }
    _presenceCh = null; _presence = {}; _myEditingId = null;
    _dropLock();
  }

  // ---------- 編集ロック（サーバ側 RLS で削除＋上書きを拒否） ----------
  const LOCK_STALE_MS     = 90 * 1000;       // RLS と一致：90秒でフリー化（閉じ忘れ対策）
  const LOCK_HEARTBEAT_MS = 30 * 1000;       // 保持中は30秒ごとに更新
  let _lockHeldId = null;                     // 自分がロック保持中の案件id
  let _lockTimer  = null;

  async function _acquireLock(id) {
    const c = _getClient();
    if (!c || !id) return null;
    try {
      const { data, error } = await c.rpc('quote_acquire_lock', { p_id: String(id) });
      return error ? null : data;   // null=RPC未適用（ロック機能オフ＝従来挙動）／'OK'／他者email／'DENIED'/'NOTFOUND'
    } catch (e) { return null; }
  }
  async function _releaseLock(id) {
    const c = _getClient();
    if (!c || !id) return;
    try { await c.rpc('quote_release_lock', { p_id: String(id) }); } catch (e) {}
  }
  function _stopLockHeartbeat() { if (_lockTimer) { clearInterval(_lockTimer); _lockTimer = null; } }
  function _startLockHeartbeat(id) {
    _stopLockHeartbeat();
    _lockTimer = setInterval(() => { if (_lockHeldId === id) _acquireLock(id); }, LOCK_HEARTBEAT_MS);
  }
  // 案件のロックを取得。{ok:true}=取得 ／ {ok:true,unmanaged:true}=ロック未適用 ／ {ok:false,by:email}=他者保持中
  async function _takeLock(id) {
    if (_lockHeldId && _lockHeldId !== id) { await _releaseLock(_lockHeldId); _lockHeldId = null; _stopLockHeartbeat(); }
    const r = await _acquireLock(id);
    if (r === 'OK')               { _lockHeldId = id; _startLockHeartbeat(id); return { ok: true }; }
    if (r === null || r === 'NOTFOUND' || r === 'DENIED') { _lockHeldId = null; _stopLockHeartbeat(); return { ok: true, unmanaged: true }; }
    _lockHeldId = null; _stopLockHeartbeat();
    return { ok: false, by: r };
  }
  function _dropLock() {
    _stopLockHeartbeat();
    if (_lockHeldId) { const id = _lockHeldId; _lockHeldId = null; _releaseLock(id); }
  }
  // 案件行が「他メンバーにロックされている（90秒以内）」か
  function _lockedByOther(row) {
    if (!row || !row.locked_by || !row.locked_at) return null;
    const fresh = (Date.now() - new Date(row.locked_at).getTime()) < LOCK_STALE_MS;
    const me = _cloudUser && _cloudUser.email;
    return (fresh && row.locked_by !== me) ? row.locked_by : null;
  }

  // ========== 作業モード（閲覧／編集）：開く=閲覧、編集でロック取得、保存=作業終了で解放 ==========
  let _shareMode = 'edit';   // 'edit'（新規・自分が編集中）| 'view'（共有案件を閲覧中・読み取り専用）

  function _applyShareMode(mode) {
    _shareMode = mode;
    const main = document.querySelector('#tab-quote-make .quote-main');
    if (main) main.inert = (mode === 'view');   // 閲覧中はフォーム全体を操作不可（マウス・キーボード）
    const tab = document.getElementById('tab-quote-make');
    if (tab) tab.classList.toggle('qmode-view', mode === 'view');
    const banner = document.getElementById('qmBanner');
    if (banner) {
      if (mode === 'view') {
        banner.hidden = false;
        banner.className = 'qm-banner qm-banner-view';
        banner.textContent = '🔒 閲覧モード — 編集するには「✏️ 編集」';
      } else if (_lockHeldId) {
        banner.hidden = false;
        banner.className = 'qm-banner qm-banner-edit';
        banner.textContent = '✏️ 編集中（あなたが作業中）';
      } else {
        banner.hidden = true;
      }
    }
    _updateModeButtons();
  }
  function _updateModeButtons() {
    const view = _shareMode === 'view';
    // 右下ドックの1ボタンをモード連動で切替（閲覧＝編集／編集＝保存）
    const dock = document.getElementById('qadMode');
    if (dock) {
      dock.disabled = false;
      if (view) { dock.textContent = '✏️ 編集'; dock.classList.remove('qad-save'); dock.classList.add('qad-edit'); }
      else      { dock.textContent = '💾 保存'; dock.classList.remove('qad-edit'); dock.classList.add('qad-save'); }
    }
  }
  // 右下ドックのアクション：閲覧中→編集開始（ロック取得）／編集中→保存して作業終了
  function qpDockAction() {
    if (_shareMode === 'view') quoteModeEdit();
    else quoteModeSaveDone();
  }

  // 共有案件を閲覧で開いた状態から「編集」開始＝ロック取得＋作業中（Presence）
  async function quoteModeEdit() {
    if (!_loadedCloudId) { quoteShowToast('ℹ️ 先にチーム共有から案件を開いてください', 'info', 3000); return; }
    const lock = await _takeLock(_loadedCloudId);
    if (!lock.ok) {
      quoteShowToast('🔒 ' + _nameFor(lock.by) + ' さんが作業中のため編集できません', 'warn', 6000);
      return;
    }
    _setEditing(_loadedCloudId);     // Presence：あなたが作業中
    _applyShareMode('edit');
    _resetQuoteDirty();              // 編集開始直後は未保存なし
    quoteShowToast('✏️ 編集を開始しました（あなたが作業中・他メンバーは削除/上書き不可）', 'success', 3500);
  }

  // 保存して作業終了：クラウド保存 → ロック解放 → 閲覧モードへ（cloudSaveCurrent 内で解放）
  async function quoteModeSaveDone() {
    if (_shareMode === 'view') {
      quoteShowToast('🔒 閲覧中です。編集するには「✏️ 編集」を押してください', 'warn', 4000);
      return;
    }
    await cloudSaveCurrent();
  }

  // 入力を空にして新規案件（保持ロックは解放）
  function quoteModeNew() {
    if (!confirm('入力中の内容を破棄して新規案件を作成しますか？\n（未保存の変更は失われます）')) return;
    _exitShareEditing();
    _clearQuoteForm();
    _loadedCloudId = null; _loadedCloudTs = null;
    if (typeof setCurrentQuoteName === 'function') setCurrentQuoteName('');
    _applyShareMode('edit');
    quoteShowToast('🆕 新規案件を作成しました', 'success');
  }
  // 入力中の内容をクリア（保持ロックは解放）
  function quoteModeClear() {
    if (!confirm('入力中の内容をクリアしますか？')) return;
    _exitShareEditing();
    _clearQuoteForm();
    _loadedCloudId = null; _loadedCloudTs = null;
    if (typeof setCurrentQuoteName === 'function') setCurrentQuoteName('');
    _applyShareMode('edit');
    _resetQuoteDirty();
    quoteShowToast('🧹 入力をクリアしました', 'info');
  }
  // 作業中状態の解除（Presence untrack 相当 + ロック解放）
  function _exitShareEditing() {
    _setEditing(null);   // Presence：どの案件も作業中でない
    _dropLock();
  }
  // フォーム全消去：既存の復元経路に「空データ」を流して安全にクリア（多重エントリ状態も同期）
  function _clearQuoteForm() {
    if (typeof _applyQuoteData !== 'function') return;
    const SKIP = ['rowInsertPos','rowPatternInsertPos','bulkCatSet','bulkSubconSet','selectAllChk'];
    const emptyFields = {};
    // フォーム本体（.quote-main）配下のみ対象。ツールバー/コマンドバーは除外
    document.querySelectorAll('#tab-quote-make .quote-main input[id], #tab-quote-make .quote-main select[id], #tab-quote-make .quote-main textarea[id]').forEach(el => {
      if (SKIP.includes(el.id) || el.closest('.quote-cmdbar')) return;
      emptyFields[el.id] = (el.type === 'checkbox') ? false : '';
    });
    _applyQuoteData({ fields: emptyFields, rows: [], _rowFormat: 'v3-mixed-rows' });
    if (typeof addRow === 'function') addRow();   // 空の入力行を1行用意
  }

  // ========== ページ切替（ダッシュボード／エディタ） ==========
  // 未保存検知：編集モード中のユーザー入力で dirty=true、保存/読込/新規でクリア
  var _quoteDirty = false;
  function _markQuoteDirty() { if (_shareMode === 'edit') _quoteDirty = true; }
  function _resetQuoteDirty() { setTimeout(function () { _quoteDirty = false; }, 0); }
  // 「ダッシュボードに戻る」：未保存があれば確認
  function qpBackToDashboard() {
    if (_quoteDirty && _shareMode === 'edit') {
      if (!confirm('⚠️ 保存していない変更があります。\nダッシュボードに戻りますか？\n\n（保存する場合はキャンセルして「💾 保存」を押してください。未保存のまま別の案件を開くと失われます）')) return;
    }
    qpShowDashboard();
  }
  function qpShowDashboard() {
    document.getElementById('tab-quote-make')?.classList.add('qp-dash');
    document.body.classList.add('qp-dash-active');
    _renderQpdAuth();
    if (_cloudUser) cloudListPresets(true);   // 一覧・統計を最新化（silent）
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function qpShowEditor() {
    document.getElementById('tab-quote-make')?.classList.remove('qp-dash');
    document.body.classList.remove('qp-dash-active');
  }
  // ダッシュボードのログイン有無で表示を出し分け
  function _renderQpdAuth() {
    const login = document.getElementById('qpdLogin');
    const main  = document.getElementById('qpdMain');
    if (login) login.hidden = !!_cloudUser;
    if (main)  main.hidden  = !_cloudUser;
  }
  // 新規見積（ダッシュボード or 未ログインの「ログインせず作成」から）→ エディタへ
  function qpNewQuote() {
    _exitShareEditing();
    _clearQuoteForm();
    _loadedCloudId = null; _loadedCloudTs = null;
    if (typeof setCurrentQuoteName === 'function') setCurrentQuoteName('');
    _applyShareMode('edit');
    qpShowEditor();
    qfRenderAttachments();
    _resetQuoteDirty();
    quoteShowToast('🆕 新規見積を作成します', 'success', 2500);
  }

  // ---------- ダッシュボード：詳細検索・並び替え・表示切替 ----------
  function qpdToggleAdv() {
    const body = document.getElementById('qpdAdv');
    const tgl  = document.getElementById('qpdAdvToggle');
    if (!body) return;
    body.hidden = !body.hidden;
    if (tgl) tgl.textContent = body.hidden ? '🔎 詳細検索 ▶' : '🔎 詳細検索 ▼';
  }
  function qpdApplyAdv() {
    _cloudFilterMode    = document.getElementById('qpdFilterMode')?.value    || '';
    _cloudFilterInco    = document.getElementById('qpdFilterInco')?.value    || '';
    _cloudFilterPol     = document.getElementById('qpdFilterPol')?.value     || '';
    _cloudFilterPod     = document.getElementById('qpdFilterPod')?.value     || '';
    _cloudFilterCarrier = document.getElementById('qpdFilterCarrier')?.value || '';
    _applyCloudFilter();
  }
  function qpdClearAdv() {
    _cloudFilterMode = _cloudFilterInco = _cloudFilterPol = _cloudFilterPod = _cloudFilterCarrier = '';
    ['qpdFilterMode','qpdFilterInco','qpdFilterPol','qpdFilterPod','qpdFilterCarrier'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
    _applyCloudFilter();
  }
  function qpdSetSort(v) { _cloudSort = v || 'updated'; _applyCloudFilter(); }
  function qpdSetView(v) {
    _cloudView = (v === 'list') ? 'list' : 'card';
    const c = document.getElementById('qpdViewCard'), l = document.getElementById('qpdViewList');
    if (c) c.classList.toggle('is-active', _cloudView === 'card');
    if (l) l.classList.toggle('is-active', _cloudView === 'list');
    _applyCloudFilter();
  }

  // ========== 添付ファイル：管理番号入力セクションの📎フィールド ==========
  // 既存の添付テーブル(quote_attachments: storage_path/file_name/file_size/mime_type)と
  // バケット(_ATTACH_BUCKET)・画像圧縮(_compressImage)を共用する。
  var ATT_TTL_DAYS = 14;      // 14日で自動削除（実削除は pg_cron）。UIは残日数を表示
  var ATT_QUOTA_MB = 1024;    // ストレージ目安（無料枠1GB。プランに応じて調整）
  async function qfAttachUpload(files) {
    files = Array.prototype.slice.call(files || []);
    if (!files.length) return;
    var c = _getClient();
    if (!c || !_cloudUser) { quoteShowToast('⚠️ 添付にはログインが必要です', 'warn', 4000); return; }
    if (!_loadedCloudId)   { quoteShowToast('⚠️ 先に案件を保存してから添付してください（💾 保存）', 'warn', 5500); return; }
    var id = _loadedCloudId, okN = 0;
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      if (file.size > 25 * 1024 * 1024) { quoteShowToast('⚠️ ' + file.name + ' は25MB超のため添付不可', 'warn', 5000); continue; }
      var src = await _compressImage(file);   // 画像は圧縮、その他はそのまま
      // Storage キーは ASCII 安全のみ（日本語/全角は Invalid key）。表示名は file_name に原文保持
      var nm = src.name || 'file';
      var dot = nm.lastIndexOf('.');
      var ext = dot >= 0 ? nm.slice(dot).replace(/[^A-Za-z0-9.]/g, '') : '';
      var base = (dot >= 0 ? nm.slice(0, dot) : nm).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_{2,}/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'file';
      var path = id + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '_' + base + ext;
      var up = await c.storage.from(_ATTACH_BUCKET()).upload(path, src, { contentType: src.type || undefined, upsert: false });
      if (up.error) { quoteShowToast('⚠️ アップロード失敗：' + up.error.message, 'warn', 6000); continue; }
      var ins = await c.from('quote_attachments').insert({ preset_id: id, storage_path: path, file_name: file.name, file_size: src.size, mime_type: src.type || null, uploaded_by: _cloudUser.email });
      if (ins.error) { quoteShowToast('⚠️ 記録失敗：' + ins.error.message, 'warn', 6000); try { await c.storage.from(_ATTACH_BUCKET()).remove([path]); } catch (e) {} continue; }
      okN++;
    }
    if (okN) quoteShowToast('📎 ' + okN + ' 件を添付しました', 'success', 2500);
    qfRenderAttachments();
  }
  async function qfRenderAttachments() {
    var wrap = document.getElementById('qfAttachList');
    if (!wrap) return;
    var c = _getClient();
    if (!c || !_cloudUser) { wrap.innerHTML = '<div class="qf-attach-empty">ログインすると添付の保存・閲覧ができます</div>'; return; }
    if (!_loadedCloudId)   { wrap.innerHTML = '<div class="qf-attach-empty">案件を保存すると添付できます（💾 保存）</div>'; return; }
    var res = await c.from('quote_attachments').select('id,file_name,file_size,mime_type,storage_path,uploaded_by,created_at').eq('preset_id', _loadedCloudId).order('created_at', { ascending: false });
    if (res.error) { wrap.innerHTML = '<div class="qf-attach-empty">⚠️ 取得失敗：' + escHtml(res.error.message) + '</div>'; return; }
    var now = Date.now();
    var data = (res.data || []).filter(function (a) {
      return !a.created_at || (now - new Date(a.created_at).getTime()) < ATT_TTL_DAYS * 86400000;
    });
    qfRenderStorageMeter();
    if (!data.length) { wrap.innerHTML = '<div class="qf-attach-empty">添付はまだありません</div>'; return; }
    wrap.innerHTML = data.map(function (a) {
      var who = _nameFor(a.uploaded_by);
      var ts = a.created_at ? new Date(a.created_at).toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' }) : '';
      var sz = a.file_size ? (a.file_size > 1048576 ? (a.file_size / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(a.file_size / 1024)) + 'KB') : '';
      var icon = /pdf/i.test(a.mime_type || '') ? '📄' : (/image/i.test(a.mime_type || '') ? '🖼️' : '📎');
      var left = a.created_at ? Math.max(0, Math.ceil(ATT_TTL_DAYS - (now - new Date(a.created_at).getTime()) / 86400000)) : ATT_TTL_DAYS;
      var dayCls = left <= 3 ? ' is-soon' : '';
      return '<div class="qf-attach-item">' +
        '<button type="button" class="qf-att-open" onclick="qfAttachOpen(\'' + encodeURIComponent(a.storage_path) + '\')" title="開く／ダウンロード">' + icon + ' ' + escHtml(a.file_name) + '</button>' +
        '<span class="qf-att-meta">' + (sz ? sz + ' · ' : '') + escHtml(who) + ' · ' + ts + '</span>' +
        '<span class="qf-att-ttl' + dayCls + '" title="アップロードから14日で自動削除">あと' + left + '日</span>' +
        '<button type="button" class="qf-att-del" onclick="qfAttachDelete(\'' + a.id + '\',\'' + encodeURIComponent(a.storage_path) + '\')" title="削除">✕</button>' +
      '</div>';
    }).join('');
  }
  // ストレージ残量インジケーター（チーム全体の添付合計 ÷ 目安容量）
  async function qfRenderStorageMeter() {
    var box = document.getElementById('qfAttachMeter');
    if (!box) return;
    var c = _getClient();
    if (!c || !_cloudUser) { box.innerHTML = ''; return; }
    var now = Date.now();
    var res = await c.from('quote_attachments').select('file_size,created_at');
    if (res.error) { box.innerHTML = ''; return; }
    var usedBytes = (res.data || []).reduce(function (s, a) {
      if (a.created_at && (now - new Date(a.created_at).getTime()) >= ATT_TTL_DAYS * 86400000) return s;  // 期限切れは除外
      return s + (a.file_size || 0);
    }, 0);
    var usedMb = usedBytes / 1048576;
    var pct = Math.min(100, Math.round(usedMb / ATT_QUOTA_MB * 1000) / 10);
    var lvl = pct >= 90 ? ' is-full' : (pct >= 70 ? ' is-warn' : '');
    box.innerHTML =
      '<div class="qf-meter-row"><span>📦 ストレージ</span>' +
        '<span class="qf-meter-num">' + (usedMb < 10 ? usedMb.toFixed(1) : Math.round(usedMb)) + ' / ' + ATT_QUOTA_MB + ' MB（' + pct + '%）</span></div>' +
      '<div class="qf-meter-bar"><div class="qf-meter-fill' + lvl + '" style="width:' + pct + '%"></div></div>';
  }
  async function qfAttachOpen(rawPath) {
    var c = _getClient(); if (!c) return;
    var res = await c.storage.from(_ATTACH_BUCKET()).createSignedUrl(decodeURIComponent(rawPath), 120);
    if (res.error || !res.data) { quoteShowToast('⚠️ リンク作成に失敗しました', 'warn'); return; }
    window.open(res.data.signedUrl, '_blank', 'noopener');
  }
  async function qfAttachDelete(attId, rawPath) {
    if (!confirm('この添付ファイルを削除しますか？（チーム全員から消えます）')) return;
    var c = _getClient(); if (!c) return;
    var del = await c.from('quote_attachments').delete().eq('id', attId);
    if (del.error) { quoteShowToast('⚠️ 削除に失敗：' + del.error.message, 'warn', 6000); return; }
    try { await c.storage.from(_ATTACH_BUCKET()).remove([decodeURIComponent(rawPath)]); } catch (e) {}
    quoteShowToast('🗑️ 添付を削除しました', 'info', 2200);
    qfRenderAttachments();
  }

  // 検索ボックス入力
  function cloudSearchInput(val) {
    _cloudSearch = val || '';
    const clr = document.getElementById('qpdSearchClear');
    if (clr) clr.hidden = !_cloudSearch;
    _applyCloudFilter();
  }

  function qpdClearSearch() {
    _cloudSearch = '';
    const inp = document.getElementById('qpdSearch');
    if (inp) inp.value = '';
    const clr = document.getElementById('qpdSearchClear');
    if (clr) clr.hidden = true;
    _applyCloudFilter();
  }

  // ステータス絞り込み切替
  function cloudFilterStatus(val) {
    _cloudStatusFilter = (val === _cloudStatusFilter) ? '' : val;  // 同じものを再クリックで解除
    _renderStatusChips();
    _renderQpdStats();
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
    // 保存名：読込中の案件名を優先（コピー元と名前が被っても混同しない）。未ロードなら自動生成
    const _loadedDisplayName = (document.getElementById('currentQuoteName')?.dataset.name || '').trim();
    const name = _loadedDisplayName
      || ((typeof _buildDefaultPresetName === 'function')
          ? _buildDefaultPresetName()
          : ('一時保存_' + new Date().toISOString().slice(0, 10).replace(/-/g, '')));

    const data = gatherAllData();
    const subcons = _extractSubcons(data);
    // 検索・一覧用の主要項目を data から昇格（顧客名・担当者）
    const f = (data && data.fields) || {};
    const customer       = (f['qf-customer']    || '').trim() || null;
    const person         = (f['qf-person']      || '').trim() || null;
    const incoterms      = (f['cond-incoterms'] || '').trim() || null;
    const transport_mode = (f['cond-mode']       || '').trim() || null;
    const status         = (f['qf-status']      || '').trim() || CLOUD_STATUS_DEFAULT;
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

    // ロード済みIDがある場合はID直接更新（コピー元と名前が被っても安全）。なければ同名チェック
    let existingId = _loadedCloudId || null;
    if (!existingId) {
      const { data: byName, error: selErr } = await c
        .from(_table()).select('id').eq('name', name).limit(1);
      if (selErr) { quoteShowToast('⚠️ 確認に失敗：' + selErr.message, 'warn', 5000); return; }
      if (byName && byName.length) existingId = byName[0].id;
    }

    let resp;
    if (existingId) {
      const exId = existingId;
      // フェーズ1：競合検知 — 自分がロードした後に他者が更新していないか
      let confirmed = false;
      if (exId === _loadedCloudId && _loadedCloudTs) {
        const { data: cur } = await c.from(_table())
          .select('updated_at,owner_email').eq('id', exId).single();
        if (cur && cur.updated_at && cur.updated_at !== _loadedCloudTs) {
          const who  = _nameFor(cur.owner_email);
          const when = new Date(cur.updated_at).toLocaleString('ja-JP',
            { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
          if (!confirm('⚠️ あなたが読み込んだ後に ' + who + ' さんが ' + when +
                       ' に更新しています。\nこのまま保存すると相手の変更を上書きします。続けますか？')) return;
          confirmed = true;   // 競合確認＝上書き合意とみなす
        }
      }
      // ロードしていない同名レコード（既存別案件）を上書きする場合のみ確認
      if (!confirmed && exId !== _loadedCloudId && !confirm('共有プリセット「' + name + '」が既にあります。上書きしますか？')) return;
      const nowIso = new Date().toISOString();
      // 上書き時は作成者は維持（ステータスはフォームの qf-status 値で更新）
      resp = await c.from(_table())
        .update({ data, subcons, status, customer, person, incoterms, transport_mode, pol, pod, carrier,
                  owner_email: _cloudUser.email, updated_at: nowIso })
        .eq('id', exId)
        .select('id');
      // 編集ロックで拒否されると エラー無しで 0 行（RLS）。他メンバー編集中＝上書き不可。
      if (!resp.error && (!resp.data || !resp.data.length)) {
        quoteShowToast('🔒 他メンバーが編集中のため上書き保存できません（読込し直すと最新になります）', 'warn', 6500);
        return;
      }
      if (!resp.error) { _loadedCloudId = exId; _loadedCloudTs = nowIso; }  // 自分の保存を基準時刻に更新
    } else {
      resp = await c.from(_table())
        .insert({
          name, data, subcons, status, customer, person, incoterms, transport_mode, pol, pod, carrier,
          owner_email: _cloudUser.email,
          created_by:  _cloudUser.email,
        })
        .select('id,updated_at').single();
      if (!resp.error && resp.data) {   // 新規作成：競合検知の基準にも採用
        _loadedCloudId = resp.data.id;
        _loadedCloudTs = resp.data.updated_at || new Date().toISOString();
      }
    }
    if (resp.error) { quoteShowToast('⚠️ 保存に失敗：' + resp.error.message, 'warn', 5000); return; }

    // 保存＝作業終了：ロックと Presence（作業中）を解放し、閲覧モードへ移行
    const savedId = existingId || (resp.data && resp.data.id);
    if (savedId) { _loadedCloudId = savedId; }
    _exitShareEditing();          // Presence untrack + ロック解放
    _applyShareMode('view');      // 閲覧モードへ（他メンバーが編集可能に）
    qfRenderAttachments();        // 保存後は添付フィールドが使える（preset_id 確定）
    _resetQuoteDirty();           // 保存済み＝未保存なし

    quoteShowToast('💾 「' + name + '」を保存して作業終了しました', 'success', 3500);
    cloudListPresets();
    // 保存後の遷移はユーザーに選ばせる（OK＝ダッシュボードへ／キャンセル＝この見積に留まる）
    setTimeout(() => {
      if (confirm('💾 保存しました。\n📊 ダッシュボードに戻りますか？\n（キャンセル＝この見積を表示したまま）')) {
        qpShowDashboard();
      }
    }, 150);
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
      if (Array.isArray(rts) && rts.length) rts.filter(r => r.enabled !== false).forEach(r => routeEntries.push(r));
    } catch(e) {}
    if (routeEntries.length) {
      routeEntries.forEach((r, i) => {
        const leg  = [r.pol, r.via, r.pod].filter(Boolean).join(' → ');
        const line = [[r.carrier, r.service ? `(${r.service})` : ''].filter(Boolean).join(' '), leg].filter(Boolean).join('  ');
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

  // 数値パース／通貨つき金額表示（JPYは¥、非JPYは通貨コード併記）
  function _cpNum(v) { const n = parseFloat(String(v == null ? '' : v).replace(/[, ]/g, '')); return isFinite(n) ? n : null; }
  function _cpMoney(v, ccy) {
    const n = _cpNum(v);
    if (n == null) return '—';
    const cur = (ccy || 'JPY').trim() || 'JPY';
    return cur === 'JPY' ? '¥' + Math.round(n).toLocaleString('ja-JP')
                         : cur + ' ' + n.toLocaleString('ja-JP', { maximumFractionDigits: 2 });
  }
  // 行の粗利率（売上ベース）。通貨が異なる場合は JPY 換算（為替未取得なら null）
  function _cpMarginPct(pp, pc, pq, bp, bc, bq) {
    const ppN = _cpNum(pp), bpN = _cpNum(bp);
    if (ppN == null || bpN == null) return null;
    const pqN = (_cpNum(pq) > 0) ? _cpNum(pq) : 1;
    const bqN = (_cpNum(bq) > 0) ? _cpNum(bq) : 1;
    let cost = ppN * pqN, bill = bpN * bqN;
    if ((pc || 'JPY') !== (bc || 'JPY')) {
      if (typeof toJPY !== 'function') return null;
      cost = toJPY(cost, pc || 'JPY'); bill = toJPY(bill, bc || 'JPY');
      if (!isFinite(cost) || !isFinite(bill)) return null;
    }
    if (!window.SharedCalc || bill <= 0) return null;
    return SharedCalc.grossMarginPct(bill, cost);
  }

  function _cpRenderTable(rows) {
    const catLabel = _CAT_LABEL();
    const tbody = document.getElementById('cpTableBody');
    if (!tbody) return;
    const dataRows = rows.filter(r => r._type === 'data' && r.cells?.length);
    if (!dataRows.length) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#9bb;padding:16px;">行データがありません</td></tr>';
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
        <td colspan="8" class="cp-group-label">🏢 ${svEsc} <span class="cp-group-cnt">${g.rows.length}行</span></td>
      </tr>`;
      const rowHtml = g.rows.map(({ row, idx }) => {
        const cells = row.cells;
        const cat = cells[1] || '';
        const nm  = cells[4] || '';
        const pq  = cells[5] || '';
        const un  = cells[6] || '';
        const bq  = cells[7] || '';
        const pc  = cells[8] || 'JPY';
        const bc  = cells[9] || 'JPY';
        const pp  = cells[10] || '';   // 仕入単価
        const bp  = cells[11] || '';   // 売単価（= 仕入 + 載せ幅）
        const mk  = cells[13] || '';   // 載せ幅
        const nt  = cells[14] || '';
        const catLbl = catLabel[cat] || cat;
        const qty    = (bq && un) ? `${escHtml(bq)} ${escHtml(un)}` : escHtml(bq || un || '—');
        const mPct   = _cpMarginPct(pp, pc, pq, bp, bc, bq);
        const mCls   = mPct == null ? '' : (mPct > 0 ? 'cp-margin-pos' : mPct < 0 ? 'cp-margin-neg' : '');
        const mCell  = mPct == null ? '—' : mPct.toFixed(1) + '%';
        return `<tr class="cp-row cp-row-in-group" data-sv="${escHtml(g.sv)}" data-idx="${idx}">
          <td><input type="checkbox" class="cp-chk" checked onchange="cpUpdateSelCount()"></td>
          <td class="cp-cat">${escHtml(catLbl)}</td>
          <td class="cp-nm">${escHtml(nm)}</td>
          <td class="cp-qty">${qty}</td>
          <td class="cp-price cp-pp">${_cpMoney(pp, pc)}</td>
          <td class="cp-price cp-mk">${_cpNum(mk) ? _cpMoney(mk, bc) : '—'}</td>
          <td class="cp-price cp-bp">${_cpMoney(bp, bc)}</td>
          <td class="cp-price cp-margin ${mCls}">${mCell}</td>
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
      .from(_table()).select('name,data,updated_at').eq('id', id).single();
    if (error || !data) { quoteShowToast('⚠️ 読み込みに失敗しました', 'warn'); return; }

    // 直前に自分が別案件を編集中だったら解放してから開く
    _exitShareEditing();

    // 競合検知の基準として、ロードした案件 id と更新時刻を記録
    _loadedCloudId = id;
    _loadedCloudTs = data.updated_at || null;

    // チャットタブが開いていれば即時更新
    if (document.getElementById('qspPane-chat')?.classList.contains('is-active')) {
      _loadQspComments();
    }

    // 復元処理（開く＝閲覧モード：ロックも Presence も取得しない）
    _applyQuoteData(data.data, { keepHeaderIfEmpty: true });
    if (typeof calcLiveUpdate === 'function') calcLiveUpdate();
    if (typeof setCurrentQuoteName === 'function') setCurrentQuoteName(data.name);
    if (typeof closePresetMgr === 'function') closePresetMgr();
    _applyShareMode('view');   // 読み取り専用。編集するには「✏️ 編集」
    qpShowEditor();            // ダッシュボードからエディタ画面へ
    qfRenderAttachments();     // この案件の添付一覧を表示
    _resetQuoteDirty();        // 読込直後は未保存なし
    const lk = _cloudRows.find(r => r.id === id);
    const by = lk ? _lockedByOther(lk) : null;
    if (by) {
      quoteShowToast('📂 共有「' + data.name + '」を開きました（閲覧）。🔒 ' + _nameFor(by) + ' さんが作業中です', 'warn', 6000);
    } else {
      quoteShowToast('📂 共有「' + data.name + '」を開きました（閲覧モード）。編集するには「✏️ 編集」', 'success', 4500);
    }
  }

  // ---------- 削除 ----------
  async function cloudDeletePreset(rawId) {
    const c = _getClient();
    if (!c) return;
    const id = decodeURIComponent(rawId);
    const row = _cloudRows.find(r => r.id === id);
    const label = row && row.name ? '「' + row.name + '」' : '';
    // 同時編集の警告（Presence）：編集中なら強めの確認に切替
    const others = _presenceOthers(id);
    if (others.length) {
      if (!confirm('🚫 ' + others.join('、') + ' さんがこの案件' + label +
          'を編集中です。\n削除するとその作業が失われます。本当に削除しますか？')) return;
    } else {
      if (!confirm('この共有プリセット' + label + 'を削除しますか？\n（チーム全員から消えます）')) return;
    }
    const { data: del, error } = await c.from(_table()).delete().eq('id', id).select('id');
    if (error) { quoteShowToast('⚠️ 削除に失敗：' + error.message, 'warn'); return; }
    // 編集ロックで拒否されると エラー無しで 0 行（RLS）
    if (!del || !del.length) {
      quoteShowToast('🔒 他メンバーが編集中のため削除できません（ロック解除後に再試行してください）', 'warn', 6500);
      cloudListPresets();
      return;
    }
    if (_lockHeldId === id) _dropLock();
    quoteShowToast('🗑️ 共有プリセットを削除しました', 'info');
    cloudListPresets();
  }

  // ---------- コピー ----------
  async function cloudDuplicatePreset(rawId) {
    const c = _getClient();
    if (!c || !_cloudUser) { quoteShowToast('⚠️ ログインが必要です', 'warn'); return; }
    const id = decodeURIComponent(rawId);
    const src = _cloudRows.find(r => r.id === id);
    if (!src || !src.data) { quoteShowToast('⚠️ コピー元が見つかりません', 'warn'); return; }
    const newData = JSON.parse(JSON.stringify(src.data));
    if (!newData.fields) newData.fields = {};
    const srcRef = (newData.fields['qf-ref'] || '').trim();
    newData.copiedFrom = { id: src.id, name: src.name, ref: srcRef };
    // 発番ID取得済みなら新REF#をコピー時点で採番（未取得の場合はコピー元番号を保持）
    const newRef = typeof generateQuoteRefValue === 'function' ? generateQuoteRefValue() : null;
    if (newRef) newData.fields['qf-ref'] = newRef;
    const existingNames = _cloudRows.map(r => r.name);
    let baseName = src.name + ' のコピー';
    let copyName = baseName;
    let n = 2;
    while (existingNames.includes(copyName)) copyName = baseName + '_' + (n++);
    const f = newData.fields || {};
    const customer       = (f['qf-customer']    || '').trim() || null;
    const person         = (f['qf-person']      || '').trim() || null;
    const incoterms      = (f['cond-incoterms'] || '').trim() || null;
    const transport_mode = (f['cond-mode']       || '').trim() || null;
    let pol = (f['z2Pol'] || '').trim() || null;
    let pod = (f['z2Pod'] || '').trim() || null;
    let carrier = (f['z2Carrier'] || '').trim() || null;
    try {
      const rts = JSON.parse(f['z2-routes-data'] || '[]');
      if (Array.isArray(rts) && rts.length) {
        if (!pol) pol = rts.map(r => r.pol).filter(Boolean).join(', ') || null;
        if (!pod) pod = rts.map(r => r.pod).filter(Boolean).join(', ') || null;
        if (!carrier) carrier = rts.map(r => r.carrier).filter(Boolean).join(', ') || null;
      }
    } catch(e) {}
    const subcons = _extractSubcons(newData);
    const { error } = await c.from(_table()).insert({
      name: copyName, data: newData, subcons, status: CLOUD_STATUS_DEFAULT,
      customer, person, incoterms, transport_mode, pol, pod, carrier,
      owner_email: _cloudUser.email, created_by: _cloudUser.email,
    });
    if (error) { quoteShowToast('⚠️ コピーに失敗：' + error.message, 'warn', 5000); return; }
    quoteShowToast('📋 「' + src.name + '」をコピーしました → 「' + copyName + '」', 'success', 3500);
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
    // 初期モード（新規＝編集可）。ボタン状態を整える
    _applyShareMode('edit');
    // 未保存検知：編集中のユーザー入力で dirty フラグを立てる
    var _qtab = document.getElementById('tab-quote-make');
    if (_qtab) { _qtab.addEventListener('input', _markQuoteDirty); _qtab.addEventListener('change', _markQuoteDirty); }
    // タブを閉じる/離れる時はロックを即時解放（best-effort。失敗しても90秒で自動失効）
    window.addEventListener('pagehide', () => { if (_lockHeldId) _dropLock(); });
    window.addEventListener('beforeunload', () => { if (_lockHeldId) _dropLock(); });
    const c = _getClient();
    if (!c) { _renderCloudAuth(); return; }

    // 既存セッション復元（OAuth リダイレクト直後もここで拾える）
    c.auth.getSession().then(({ data }) => {
      _cloudUser = (data && data.session && data.session.user) || null;
      _renderCloudAuth();
      if (_cloudUser) {
        _loadProfiles().then(_renderCloudAuth); _initPresence();
        if (document.body.classList.contains('qp-dash-active')) cloudListPresets(true);
      }
    });

    // ログイン状態変化を監視
    c.auth.onAuthStateChange((_event, session) => {
      _cloudUser = (session && session.user) || null;
      _renderCloudAuth();
      if (_cloudUser) {
        _loadProfiles().then(_renderCloudAuth);   // 自分のアバター/名前を反映
        _initPresence();
        const modal = document.getElementById('presetMgrModal');
        if (modal && modal.classList.contains('open')) cloudListPresets();
        if (document.body.classList.contains('qp-dash-active')) cloudListPresets(true);
      } else {
        _teardownPresence();
      }
    });
  }

  // ---------- プロフィール編集（表示名＋アバター） ----------
  let _profEditColor = '';
  let _profEditEmoji = '';
  function openProfileEdit() {
    if (!_cloudUser) { quoteShowToast('⚠️ ログインが必要です', 'warn'); return; }
    const email = _cloudUser.email;
    const cur = _profileAv[email] || {};
    _profEditColor = cur.color || _avatarHashColor(email);
    _profEditEmoji = cur.emoji || '';
    const nameInp = document.getElementById('profNameInput');
    if (nameInp) nameInp.value = _cloudDisplayName(_cloudUser);
    const idEl = document.getElementById('profMemberNo');
    if (idEl) idEl.textContent = (window._myMemberNo != null) ? String(window._myMemberNo).padStart(2, '0') : '未割当';
    const emojiInp = document.getElementById('profEmojiInput');
    if (emojiInp) emojiInp.value = _profEditEmoji;
    const colWrap = document.getElementById('profColors');
    if (colWrap) colWrap.innerHTML = PROFILE_COLORS.map(c =>
      '<button type="button" class="prof-color' + (c === _profEditColor ? ' is-sel' : '') +
      '" style="background:' + c + '" data-c="' + c + '" onclick="profPickColor(\'' + c + '\')"></button>').join('');
    const emWrap = document.getElementById('profEmojis');
    if (emWrap) emWrap.innerHTML = PROFILE_EMOJIS.map(e =>
      '<button type="button" class="prof-emoji' + (e === _profEditEmoji ? ' is-sel' : '') +
      '" data-e="' + e + '" onclick="profPickEmoji(\'' + e + '\')">' + (e || '頭文字') + '</button>').join('');
    profUpdatePreview();
    document.getElementById('profOverlay').classList.add('open');
  }
  function closeProfileEdit(ev) {
    if (ev && ev.target && ev.target.id !== 'profOverlay' && ev.type === 'click') return;
    document.getElementById('profOverlay') && document.getElementById('profOverlay').classList.remove('open');
  }
  function profPickColor(c) {
    _profEditColor = c;
    document.querySelectorAll('#profColors .prof-color').forEach(b => b.classList.toggle('is-sel', b.dataset.c === c));
    profUpdatePreview();
  }
  function profPickEmoji(e) {
    _profEditEmoji = e;
    const inp = document.getElementById('profEmojiInput'); if (inp) inp.value = e;
    document.querySelectorAll('#profEmojis .prof-emoji').forEach(b => b.classList.toggle('is-sel', b.dataset.e === e));
    profUpdatePreview();
  }
  function profUpdatePreview() {
    const name = (document.getElementById('profNameInput') || {}).value || '';
    const emojiInp = ((document.getElementById('profEmojiInput') || {}).value || '').trim();
    const emoji = emojiInp || _profEditEmoji;
    const initial = (name.trim() || (_cloudUser && _cloudUser.email) || '?').trim().charAt(0).toUpperCase();
    const av = document.getElementById('profPreviewAv');
    const nm = document.getElementById('profPreviewName');
    if (av) { av.style.background = _profEditColor; av.textContent = emoji || initial; }
    if (nm) nm.textContent = name.trim() || '（名前未設定）';
  }
  async function saveProfile() {
    if (!_cloudUser) return;
    const c = _getClient(); if (!c) return;
    const name = ((document.getElementById('profNameInput') || {}).value || '').trim();
    if (!name) { quoteShowToast('⚠️ 表示名を入力してください', 'warn'); return; }
    const emojiInp = ((document.getElementById('profEmojiInput') || {}).value || '').trim();
    const emoji = emojiInp || _profEditEmoji || '';
    const color = _profEditColor || _avatarHashColor(_cloudUser.email);
    const saveBtn = document.querySelector('#profModal .prof-save');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '保存中…'; }
    // 表示名は auth にも反映（既存仕様）
    await c.auth.updateUser({ data: { display_name: name } });
    if (_cloudUser.user_metadata) _cloudUser.user_metadata.display_name = name;
    const { error } = await c.from('user_profiles').upsert(
      { email: _cloudUser.email, display_name: name, avatar_color: color, avatar_emoji: emoji,
        updated_at: new Date().toISOString() }, { onConflict: 'email' });
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '保存'; }
    if (error) {
      // avatar 列が未作成のときは表示名だけ保存（フォールバック）
      await c.from('user_profiles').upsert(
        { email: _cloudUser.email, display_name: name, updated_at: new Date().toISOString() },
        { onConflict: 'email' });
      quoteShowToast('✅ 表示名を保存しました（アバター列が未作成のため色/絵文字は未保存）', 'warn', 6000);
    } else {
      quoteShowToast('✅ プロフィールを保存しました', 'success');
    }
    _profileMap[_cloudUser.email] = name;
    _profileAv[_cloudUser.email] = { color, emoji };
    _renderCloudAuth();
    _trackEditing();   // Presence の表示名も更新
    const modal = document.getElementById('presetMgrModal');
    if (modal && modal.classList.contains('open')) _applyCloudFilter();
    if (typeof window.umRefreshIfOpen === 'function') window.umRefreshIfOpen();
    closeProfileEdit();
  }

  // ================================================================
  // ========== 💬 見積サマリパネル チャット ==========
  // ================================================================

  async function _loadQspComments() {
    const wrap = document.getElementById('qspChatList');
    if (!wrap) return;
    const c = _getClient();
    if (!c || !_cloudUser) {
      wrap.innerHTML = '<span class="cp-chat-login">ログインするとコメントを表示できます</span>';
      return;
    }
    if (!_loadedCloudId) {
      wrap.innerHTML = '<span class="cp-chat-login">チーム共有から案件を開くとチャットが表示されます</span>';
      return;
    }
    wrap.innerHTML = '<span class="cp-chat-loading">読み込み中…</span>';
    const { data, error } = await c
      .from('quote_comments')
      .select('id,body,created_by,created_at')
      .eq('preset_id', _loadedCloudId)
      .order('created_at', { ascending: true });
    if (error) {
      console.error('[cloud] quote_comments fetch error:', error);
      wrap.innerHTML = '<span class="cp-chat-err">⚠️ 取得失敗：' + escHtml(error.message || String(error)) + '</span>';
      return;
    }
    _renderQspComments(data || []);
    wrap.scrollTop = wrap.scrollHeight;
  }

  function _renderQspComments(rows) {
    const wrap = document.getElementById('qspChatList');
    if (!wrap) return;
    if (!rows.length) { wrap.innerHTML = '<span class="cp-chat-empty">まだコメントはありません</span>'; return; }
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

  async function qspPostComment() {
    const c = _getClient();
    if (!c || !_cloudUser) { quoteShowToast('⚠️ ログインが必要です', 'warn'); return; }
    if (!_loadedCloudId) { quoteShowToast('⚠️ チーム共有から案件を開いてください', 'warn'); return; }
    const input = document.getElementById('qspChatInput');
    const body  = input?.value.trim();
    if (!body) return;
    const btn = document.querySelector('#qspPane-chat .cp-chat-send');
    if (btn) btn.disabled = true;
    try {
      const { error } = await c.from('quote_comments').insert({
        preset_id:  _loadedCloudId,
        body,
        created_by: _cloudUser.email,
      });
      if (error) throw error;
      if (input) input.value = '';
      await _loadQspComments();
    } catch(e) {
      quoteShowToast('⚠️ 送信失敗：' + (e.message || e), 'warn', 5000);
    } finally {
      if (btn) btn.disabled = false;
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
    if (error) {
      console.error('[cloud] quote_comments fetch error:', error);
      wrap.innerHTML = '<span class="cp-chat-err">⚠️ 取得失敗：' + escHtml(error.message || String(error)) + '</span>';
      return;
    }
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
  window.openProfileEdit     = openProfileEdit;
  window.closeProfileEdit    = closeProfileEdit;
  window.profPickColor       = profPickColor;
  window.profPickEmoji       = profPickEmoji;
  window.profUpdatePreview   = profUpdatePreview;
  window.saveProfile         = saveProfile;
  window.cloudLogin          = cloudLogin;
  window.cloudLogout         = cloudLogout;
  window.cloudSaveCurrent    = cloudSaveCurrent;
  window.cloudLoadPreset      = cloudLoadPreset;
  window.cloudDeletePreset    = cloudDeletePreset;
  window.cloudDuplicatePreset = cloudDuplicatePreset;
  window.cloudListPresets    = cloudListPresets;
  window.cloudGetAllRows     = () => (_cloudRows || []).slice();
  window.cloudGetClient      = _getClient;
  window.cloudCurrentUser    = () => _cloudUser;
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
  window.qspPostComment        = qspPostComment;
  window.qspLoadChat           = _loadQspComments;
  // 作業モード（閲覧／編集）操作
  window.quoteModeEdit     = quoteModeEdit;
  window.quoteModeSaveDone = quoteModeSaveDone;
  window.quoteModeNew      = quoteModeNew;
  window.quoteModeClear    = quoteModeClear;
  // ページ切替（ダッシュボード／エディタ）
  window.qpShowDashboard   = qpShowDashboard;
  window.qpBackToDashboard = qpBackToDashboard;
  window.qpShowEditor      = qpShowEditor;
  window.qpNewQuote        = qpNewQuote;
  window.qpDockAction      = qpDockAction;
  // ダッシュボード：詳細検索・並び替え・表示切替
  window.qpdToggleAdv   = qpdToggleAdv;
  window.qpdApplyAdv    = qpdApplyAdv;
  window.qpdClearAdv    = qpdClearAdv;
  window.qpdClearSearch = qpdClearSearch;
  window.qpdSetSort     = qpdSetSort;
  window.qpdSetView     = qpdSetView;
  // 添付ファイル
  window.qfAttachUpload     = qfAttachUpload;
  window.qfAttachOpen       = qfAttachOpen;
  window.qfAttachDelete     = qfAttachDelete;
  window.qfRenderAttachments = qfRenderAttachments;

  // ---------- 他モジュール（行パターン等）からのログイン情報参照用 ----------
  window.quoteCloudUser   = function () { return _cloudUser; };
  window.quoteCloudClient = function () { return _getClient(); };
  window.quoteDisplayName = function (email) { return (email && _profileMap[email]) || email || '—'; };
  window.quoteLoadProfiles = _loadProfiles;

  // supabase-js は <head> で defer 読み込みのため DOMContentLoaded を待つ
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initCloud);
  } else {
    _initCloud();
  }
