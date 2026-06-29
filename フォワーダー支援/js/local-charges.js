// 諸チャージ管理・見積引用モジュール
(function () {
  'use strict';

  const TABLE      = 'local_charges';
  const LOC_KEY    = 'localCharges_v1';
  const ATTACH_KEY = 'lcAttachments_v1';
  const LC_BUCKET  = 'local-charge-files';   // Supabase Storage バケット（チーム共有添付）

  const LC_CATS = [
    { value: '',               label: '— カテゴリ —' },
    { value: 'export-local',   label: '📤 輸出ローカルチャージ' },
    { value: 'import-local',   label: '📥 輸入ローカルチャージ' },
    { value: 'domestic',       label: '🏠 国内作業' },
    { value: 'customs-export', label: '🛃 通関諸費用（輸出）' },
    { value: 'customs-import', label: '🛃 通関諸費用（輸入）' },
    { value: 'ocean',          label: '🚢 海上運賃' },
    { value: 'surcharge',      label: '⚡ サーチャージ' },
    { value: 'overseas',       label: '🌏 海外作業' },
    { value: 'other',          label: '📋 その他' },
  ];
  const LC_CURRENCIES = ['JPY', 'USD', 'EUR', 'CNY', 'SGD', 'HKD', 'GBP', 'AUD'];
  const LC_UNITS      = ['', '式', 'B/L', 'CNTR', '20ft', '40ft', 'R/T', 'CBM', 'kg', 'TON', 'pcs', 'shipment', 'DAY'];

  let _dir         = 'export';
  let _charges     = [];
  let _editId      = null;
  let _pickDir     = 'export';
  // 案3 グループ表示：'carrier'（船会社別）| 'cat'（カテゴリ別）| 'none'（グループなし）
  let _groupMode = (() => { try { return localStorage.getItem('lcGroupMode_v1') || 'carrier'; } catch (e) { return 'carrier'; } })();
  const _collapsedGroups = new Set();
  // 添付ファイル状態: null=変更なし, false=削除, {name,type,dataUrl}=新規
  let _pendingAttach  = null;
  // フォームを開いたときの既存添付（表示用）
  let _currentAttach  = null;

  // === Supabase / localStorage ===

  function _c()    { return typeof window.cloudGetClient   === 'function' ? window.cloudGetClient()   : null; }
  function _me()   { const u = typeof window.cloudCurrentUser === 'function' ? window.cloudCurrentUser() : null; return u ? (u.email || '') : ''; }
  function _cloud(){ return !!_c() && !!_me(); }

  function _getLocal(dir) {
    try {
      const all = JSON.parse(localStorage.getItem(LOC_KEY) || '[]');
      return all.filter(c => c.direction === dir);
    } catch (e) { return []; }
  }
  function _saveLocal(all) { localStorage.setItem(LOC_KEY, JSON.stringify(all)); }

  // === 添付ファイル（lcAttachments_v1） ===

  function _loadAttachStore()        { try { return JSON.parse(localStorage.getItem(ATTACH_KEY) || '{}'); } catch(e) { return {}; } }
  function _getAttach(id)            { return id ? (_loadAttachStore()[id] || null) : null; }
  function _persistAttach(id, obj)   {
    const a = _loadAttachStore();
    if (obj) a[id] = obj; else delete a[id];
    localStorage.setItem(ATTACH_KEY, JSON.stringify(a));
  }

  function _readFile(file, cb) {
    const MAX = 5 * 1024 * 1024;
    if (file.size > MAX) {
      alert('ファイルサイズが5MBを超えています（' + (file.size / 1024 / 1024).toFixed(1) + 'MB）。\n5MB以下のファイルを選択してください。');
      return;
    }
    const reader = new FileReader();
    reader.onload = ev => cb({ name: file.name, type: file.type, dataUrl: ev.target.result });
    reader.readAsDataURL(file);
  }

  // === 添付ファイル（Supabase Storage：チーム共有） ===

  // チャージの添付情報を返す（クラウド優先→ローカル）。{name, path}=クラウド / {name, dataUrl}=ローカル / null
  function _lcAttachInfo(ch) {
    if (ch && ch.attachment_path) return { name: ch.attachment_name || 'ファイル', path: ch.attachment_path };
    const loc = _getAttach(ch && ch.id);
    if (loc) return { name: loc.name, dataUrl: loc.dataUrl };
    return null;
  }

  async function _lcSignedUrl(path) {
    const c = _c();
    if (!c || !path) return null;
    const { data, error } = await c.storage.from(LC_BUCKET).createSignedUrl(path, 60 * 60);
    if (error) { alert('ファイルの取得に失敗しました: ' + error.message); return null; }
    return data?.signedUrl || null;
  }

  async function _lcOpenSignedPath(path) {
    const url = await _lcSignedUrl(path);
    if (url) window.open(url, '_blank', 'noopener');
  }

  // dataUrl から Blob を生成して Storage にアップロードし、保存パスを返す
  async function _lcUploadAttach(chargeId, fileObj) {
    const c = _c();
    const blob = await (await fetch(fileObj.dataUrl)).blob();
    const safe = String(fileObj.name || 'file').replace(/[^\w.\-]+/g, '_');
    const path = `${chargeId}/${Date.now()}_${safe}`;
    const { error } = await c.storage.from(LC_BUCKET)
      .upload(path, blob, { contentType: fileObj.type || 'application/octet-stream', upsert: true });
    if (error) throw error;
    return path;
  }

  async function _lcRemoveStorage(path) {
    const c = _c();
    if (c && path) { try { await c.storage.from(LC_BUCKET).remove([path]); } catch (e) {} }
  }

  // 一覧の 📎 ボタン（クラウド添付）クリック → 署名URLで開く
  window.lcDownloadAttach = function (el) {
    const path = el?.dataset?.lcPath;
    if (path) _lcOpenSignedPath(path);
  };

  function _lcUpdateAttachUI() {
    // 表示すべき添付を決定
    const disp = (_pendingAttach !== null)
      ? (_pendingAttach || null)   // false → null
      : _currentAttach;

    const emptyEl  = document.getElementById('lcAttachEmpty');
    const selEl    = document.getElementById('lcAttachSelected');
    const nameEl   = document.getElementById('lcAttachFileName');

    if (!emptyEl || !selEl) return;

    if (disp) {
      emptyEl.style.display = 'none';
      selEl.style.display   = '';
      if (nameEl) {
        nameEl.textContent = disp.name;
        if (disp.dataUrl) {
          // 新規選択 or ローカル保存済み → 直接ダウンロード
          nameEl.href     = disp.dataUrl;
          nameEl.download  = disp.name;
          nameEl.onclick   = null;
        } else if (disp.path) {
          // クラウド保存済み → クリックで署名URLを発行して開く
          nameEl.href = '#';
          nameEl.removeAttribute('download');
          nameEl.onclick = ev => { ev.preventDefault(); _lcOpenSignedPath(disp.path); };
        }
      }
    } else {
      emptyEl.style.display = '';
      selEl.style.display   = 'none';
      // ファイル input をリセット
      const fi = document.getElementById('lc_file');
      if (fi) fi.value = '';
    }
  }

  async function _load(dir) {
    const c = _c();
    if (c) {
      const { data, error } = await c.from(TABLE)
        .select('*').eq('direction', dir)
        .order('name');
      if (!error) { _charges = data || []; return; }
    }
    _charges = _getLocal(dir);
  }

  async function _upsert(row) {
    const c = _c();
    if (c) {
      const me = _me();
      const payload = { ...row, updated_by: me };
      if (!row.id) { delete payload.id; payload.created_by = me; }
      const { data, error } = row.id
        ? await c.from(TABLE).update(payload).eq('id', row.id).select().single()
        : await c.from(TABLE).insert(payload).select().single();
      if (error) throw error;
      return data;
    }
    const all = JSON.parse(localStorage.getItem(LOC_KEY) || '[]');
    if (row.id) {
      const idx = all.findIndex(r => r.id === row.id);
      if (idx >= 0) all[idx] = { ...row, updated_at: new Date().toISOString() };
    } else {
      all.unshift({ ...row, id: crypto.randomUUID?.() || Date.now().toString(36), created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    }
    _saveLocal(all);
    return row;
  }

  async function _del(id) {
    const c = _c();
    if (c) { await c.from(TABLE).delete().eq('id', id); return; }
    const all = JSON.parse(localStorage.getItem(LOC_KEY) || '[]');
    _saveLocal(all.filter(r => r.id !== id));
  }

  // === ヘルパー ===

  function _esc(s)     { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function _ea(s)      { return String(s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  function _fmtDate(d) { return d ? String(d).slice(0,10) : ''; }
  function _fmtAmt(a, cur) {
    if (a == null || a === '') return '—';
    const n = Number(a);
    if (isNaN(n)) return '—';
    return (cur === 'JPY' ? '¥' : (cur + ' ')) + n.toLocaleString('ja-JP');
  }

  // ゆらぎ検出用正規化
  function _lcNormalize(s) {
    return String(s || '')
      .replace(/[（(][^）)]*[）)]/g, '')
      .replace(/[\s　・ー―\-\/\\\.]+/g, '')
      .toLowerCase()
      .replace(/[ａ-ｚＡ-Ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/[ァ-ン]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
  }

  // 名称 datalist を現在ロード済みチャージ名で更新
  function _lcRefreshNameList() {
    const dl = document.getElementById('lcNameList');
    if (!dl) return;
    const names = [...new Set(_charges.map(c => c.name).filter(Boolean))].sort();
    dl.innerHTML = names.map(n => `<option value="${_esc(n)}"></option>`).join('');
  }

  // === クラウド状態表示 ===

  function _updateCloudStatus() {
    const e = document.getElementById('lcCloudStatus');
    if (!e) return;
    if (_cloud()) {
      e.textContent = '☁️ ' + _me();
      e.className = 'lc-cloud-on';
    } else {
      e.textContent = '💾 ローカル';
      e.className = 'lc-cloud-off';
    }
  }

  // === タブ ===

  async function lcSetDir(dir) {
    _dir = dir;
    document.querySelectorAll('.lc-dir-btn').forEach(b => b.classList.remove('is-active'));
    document.getElementById('lcDirBtn-' + dir)?.classList.add('is-active');
    await _load(dir);
    lcRender();
    lcRenderVariants();
    _lcFetchCarrierBms();
  }

  // === 一覧レンダリング ===

  function lcRender() {
    const list = document.getElementById('lcList');
    if (!list) return;

    const q   = (document.getElementById('lcFilterText')?.value   || '').toLowerCase();
    const pt  = (document.getElementById('lcFilterPort')?.value   || '').toLowerCase();
    const cr  = (document.getElementById('lcFilterCarrier')?.value|| '').toLowerCase();

    const filtered = _charges.filter(c => {
      if (q  && !(c.name||'').toLowerCase().includes(q) && !(c.note||'').toLowerCase().includes(q)
             && !(c.full_name||'').toLowerCase().includes(q) && !(c.description||'').toLowerCase().includes(q)) return false;
      if (pt && !(c.pol||c.port||'').toLowerCase().includes(pt) && !(c.pod||'').toLowerCase().includes(pt)) return false;
      if (cr && !(c.carrier||'').toLowerCase().includes(cr)) return false;
      return true;
    });

    _lcRefreshNameList();

    if (!filtered.length) {
      list.innerHTML = '<p class="lc-empty">該当するチャージがありません。<br><button class="lc-add-btn-inline" onclick="lcOpenForm(null)">＋ 新規登録</button></p>';
      return;
    }

    const catMap = Object.fromEntries(LC_CATS.map(c => [c.value, c.label]));

    // === グループ化（案3：船会社／カテゴリ別アコーディオン） ===
    const mode = _groupMode; // 'carrier' | 'cat' | 'none'
    const groups = new Map(); // key -> { label, items, catSet }
    const NO_CARRIER = '（船会社指定なし）';
    filtered.forEach(c => {
      let key, label;
      if (mode === 'cat')       { key = c.cat || 'other'; label = catMap[key] || 'その他'; }
      else if (mode === 'none') { key = '__all__'; label = ''; }
      else                      { key = (c.carrier && c.carrier.trim()) || NO_CARRIER; label = key; }
      if (!groups.has(key)) groups.set(key, { label, items: [], catSet: new Set() });
      const g = groups.get(key);
      g.items.push(c);
      if (c.cat) g.catSet.add(c.cat);
    });

    let h = '';
    let gi = 0;
    groups.forEach((g, key) => {
      const gid = 'lcg-' + (gi++);
      const rowsHtml = g.items.map(c => _lcRowHtml(c, catMap, mode)).join('');
      const warn = g.items.filter(c => { const s = _lcStatus(c); return s.key === 'red' || s.key === 'amber'; }).length;
      const collapsed = _collapsedGroups.has(key) ? ' is-collapsed' : '';

      if (mode === 'none') { h += `<div class="lc-acc lc-acc--flat">${rowsHtml}</div>`; return; }

      const catBadges = [...g.catSet].slice(0, 4)
        .map(cv => `<span class="lc-cat-badge lc-cat-${cv}">${_esc((catMap[cv] || cv).replace(/^[^\s]+\s/, ''))}</span>`).join('');
      const icon = mode === 'cat' ? '' : '🚢 ';
      const warnChip = warn > 0 ? `<span class="lc-acc-warn">⚠ 要確認 ${warn}</span>` : '';
      const bmStrip = (mode === 'carrier') ? _lcGroupBmHtml(key) : '';

      h += `<div class="lc-acc${collapsed}" data-gkey="${_ea(key)}" id="${gid}">` +
             `<div class="lc-acc-h" onclick="lcToggleGroup(this)" role="button" tabindex="0" aria-expanded="${collapsed ? 'false' : 'true'}">` +
               `<span class="lc-acc-tw">▾</span>` +
               `<span class="lc-acc-name">${icon}${_esc(g.label)}</span>` +
               `<span class="lc-acc-count">${g.items.length}件</span>` +
               warnChip +
               `<span class="lc-acc-sp"></span>` +
               `<span class="lc-acc-cats">${catBadges}</span>` +
             `</div>` +
             bmStrip +
             `<div class="lc-acc-rows">${rowsHtml}</div>` +
           `</div>`;
    });

    list.innerHTML = h;
    _lcRenderCarrierBmSection();
  }

  // チャージ1件の状態（緑=有効 / 橙=期限間近 / 赤=期限切れ / 青=適用前）
  function _lcStatus(c) {
    const today    = new Date().toISOString().slice(0, 10);
    const warnDate = new Date(); warnDate.setDate(warnDate.getDate() + 30);
    const warnStr  = warnDate.toISOString().slice(0, 10);
    if (c.valid_to   && c.valid_to   < today)    return { key: 'red',    badge: '<span class="lc-exp-badge lc-exp-badge--red">期限切れ</span>' };
    if (c.valid_from && c.valid_from > today)    return { key: 'future', badge: '<span class="lc-exp-badge lc-exp-badge--future">適用前</span>' };
    if (c.valid_to   && c.valid_to   <= warnStr) return { key: 'amber',  badge: `<span class="lc-exp-badge lc-exp-badge--amber">～${_fmtDate(c.valid_to)}</span>` };
    return { key: 'green', badge: '' };
  }

  // チャージ1件の行 HTML（状態アクセントバー＋名称＋カテゴリ＋ルート＋金額＋操作）
  function _lcRowHtml(c, catMap, mode) {
    const st  = _lcStatus(c);
    const pol = c.pol || c.port || '';
    const pod = c.pod || '';
    const srcHtml = c.source
      ? (c.source.startsWith('http')
          ? ` <a class="lc-source-icon" href="${_ea(c.source)}" target="_blank" rel="noopener" title="${_ea(c.source)}">🔗</a>`
          : ` <span class="lc-source-icon" title="${_ea(c.source)}">📄</span>`)
      : '';
    const att = _lcAttachInfo(c);
    const attHtml = att
      ? (att.dataUrl
          ? `<a class="lc-attach-tbl-btn" href="${att.dataUrl}" download="${_ea(att.name)}" target="_blank" title="添付: ${_ea(att.name)}">📎</a>`
          : `<button class="lc-attach-tbl-btn" data-lc-path="${_ea(att.path)}" onclick="lcDownloadAttach(this)" title="添付: ${_ea(att.name)}">📎</button>`)
      : '';
    const routeHtml = (pol || pod)
      ? `<span class="lc-route-chip">${_esc(pol || '—')}${pod ? `<span class="lc-route-arr">→</span>${_esc(pod)}` : ''}</span>`
      : '<span class="lc-route-none">—</span>';
    const catChip = (mode === 'cat') ? '' :
      `<span class="lc-cat-badge lc-cat-${c.cat || 'other'}">${_esc((catMap[c.cat] || c.cat || '—').replace(/^[^\s]+\s/, ''))}</span>`;
    const amtUnit = c.unit ? `<span class="lc-r-unit">/ ${_esc(c.unit)}</span>` : '';

    return `<div class="lc-row lc-row--${st.key}">` +
             `<span class="lc-row-bar"></span>` +
             `<div class="lc-row-main">` +
               `<div class="lc-row-nm">${_esc(c.name)}${srcHtml}${st.badge}</div>` +
               (c.full_name ? `<div class="lc-row-sub">${_esc(c.full_name)}</div>` : '') +
             `</div>` +
             `<div class="lc-row-cat">${catChip}</div>` +
             `<div class="lc-row-route">${routeHtml}</div>` +
             `<div class="lc-row-amt">${_fmtAmt(c.amount, c.currency)}${amtUnit}</div>` +
             `<div class="lc-row-ops">` +
               attHtml +
               `<button class="lc-edit-btn" onclick="event.stopPropagation();lcOpenForm('${c.id}')" title="編集">✏️</button>` +
               `<button class="lc-del-btn"  onclick="event.stopPropagation();lcDeleteCharge('${c.id}')" title="削除">🗑️</button>` +
             `</div>` +
           `</div>`;
  }

  // === 登録フォーム ===

  function lcOpenForm(id) {
    _editId = id || null;
    const charge = id ? _charges.find(c => c.id === id) : null;
    const modal  = document.getElementById('lcFormModal');
    if (!modal) return;

    document.getElementById('lcFormTitle').textContent = charge ? 'チャージを編集' : '新規チャージ登録';

    const set = (elId, val) => { const e = document.getElementById(elId); if (e) e.value = val || ''; };
    set('lc_name',        charge?.name        || '');
    set('lc_full_name',   charge?.full_name   || '');
    const descEl = document.getElementById('lc_description');
    if (descEl) descEl.value = charge?.description || '';
    set('lc_cat',        charge?.cat        || (_dir === 'export' ? 'export-local' : 'import-local'));
    set('lc_amount',     charge?.amount     ?? '');
    set('lc_currency',   charge?.currency   || 'JPY');
    set('lc_unit',       charge?.unit       || '');
    set('lc_pol',        charge?.pol  || charge?.port || '');
    set('lc_pod',        charge?.pod        || '');
    set('lc_carrier',    charge?.carrier    || '');
    set('lc_valid_from', charge?.valid_from ? _fmtDate(charge.valid_from) : '');
    set('lc_valid_to',   charge?.valid_to   ? _fmtDate(charge.valid_to)   : '');
    set('lc_source',     charge?.source     || '');
    set('lc_note',       charge?.note       || '');

    // 添付ファイル状態を初期化（クラウド添付優先→ローカル）
    _pendingAttach = null;
    _currentAttach = _lcAttachInfo(charge);
    _lcUpdateAttachUI();

    // ドラッグ&ドロップ・ペーストを添付エリアに設定（1回だけ）
    const zone = document.getElementById('lcAttachZone');
    if (zone && !zone.dataset.lcDndReady) {
      zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('lc-dragover'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('lc-dragover'));
      zone.addEventListener('drop', e => {
        e.preventDefault(); zone.classList.remove('lc-dragover');
        const f = e.dataTransfer.files[0];
        if (f) _readFile(f, obj => { _pendingAttach = obj; _lcUpdateAttachUI(); });
      });
      // フォーム表示中のペースト（スクショ・ファイル）を添付として取り込む
      document.addEventListener('paste', e => {
        if (!document.getElementById('lcFormModal')?.classList.contains('open')) return;
        const f = [...(e.clipboardData?.items || [])]
          .map(it => it.kind === 'file' ? it.getAsFile() : null)
          .find(Boolean);
        if (f) { e.preventDefault(); _readFile(f, obj => { _pendingAttach = obj; _lcUpdateAttachUI(); }); }
      });
      zone.dataset.lcDndReady = '1';
    }

    modal.classList.add('open');
    document.getElementById('lc_name')?.focus();
  }

  function lcCloseForm() {
    document.getElementById('lcFormModal')?.classList.remove('open');
    _editId        = null;
    _pendingAttach = null;
    _currentAttach = null;
  }

  // フォーム入力を1レコード分の row に組み立て（必須チェック込み・不正なら null）
  function _lcCollectRow() {
    const g = id => document.getElementById(id)?.value?.trim() || '';
    const name    = g('lc_name');
    const carrier = g('lc_carrier');
    if (!carrier) { alert('船会社（キャリアー）は必須です'); document.getElementById('lc_carrier')?.focus(); return null; }
    if (!name)    { alert('名称は必須です'); document.getElementById('lc_name')?.focus(); return null; }

    const row = {
      id:          _editId || undefined,
      direction:   _dir,
      name,
      full_name:   g('lc_full_name'),
      description: (document.getElementById('lc_description')?.value || '').trim(),
      cat:         g('lc_cat'),
      amount:      document.getElementById('lc_amount')?.value !== '' ? Number(document.getElementById('lc_amount').value) : null,
      currency:    g('lc_currency') || 'JPY',
      unit:        g('lc_unit'),
      pol:         g('lc_pol'),
      pod:         g('lc_pod'),
      carrier:     g('lc_carrier'),
      valid_from:  g('lc_valid_from') || null,
      valid_to:    g('lc_valid_to')   || null,
      source:      g('lc_source'),
      note:        g('lc_note'),
    };
    if (!row.id) delete row.id;
    return row;
  }

  // row を保存（クラウド/ローカル）＋添付反映＋一覧再描画。savedId を返す
  async function _lcPersistRow(row) {
    const c       = _c();
    const saved   = await _upsert(row);
    const savedId = saved?.id || row.id || _editId;

    // 添付ファイル（_pendingAttach: null=変更なし / false=削除 / object=新規）
    if (_pendingAttach !== null && savedId) {
      if (c && _me()) {
        // クラウド: Supabase Storage に保存し、行の attachment_path/_name を更新
        const oldPath = saved?.attachment_path || row.attachment_path || null;
        try {
          if (_pendingAttach === false) {
            await _lcRemoveStorage(oldPath);
            await c.from(TABLE).update({ attachment_path: null, attachment_name: null }).eq('id', savedId);
          } else {
            const path = await _lcUploadAttach(savedId, _pendingAttach);
            await c.from(TABLE).update({ attachment_path: path, attachment_name: _pendingAttach.name }).eq('id', savedId);
            if (oldPath && oldPath !== path) await _lcRemoveStorage(oldPath);
          }
        } catch (e) {
          alert('チャージは保存しましたが、添付ファイルのアップロードに失敗しました。\n'
            + (e?.message || e)
            + '\n（Storage バケット未作成の可能性。docs/supabase-local-charges-storage.sql を実行してください）');
        }
      } else {
        // ローカル: localStorage（このブラウザのみ）
        try { _persistAttach(savedId, _pendingAttach || null); }
        catch (e) { alert('チャージは保存しましたが、添付ファイルの保存に失敗しました（ブラウザ保存の容量超過の可能性）。\n' + (e?.message || e)); }
      }
    }

    await _load(_dir);
    lcRender();
    lcRenderVariants();
    _lcFetchCarrierBms();
    return savedId;
  }

  function _lcFooterBtns() {
    return document.querySelectorAll('#lcFormModal .lc-modal-footer button');
  }

  async function lcSaveCharge() {
    const row = _lcCollectRow();
    if (!row) return;
    const btns = _lcFooterBtns();
    btns.forEach(b => b.disabled = true);
    try {
      await _lcPersistRow(row);
      lcCloseForm();
    } catch (e) {
      alert('保存に失敗しました: ' + e.message);
    } finally {
      btns.forEach(b => b.disabled = false);
    }
  }

  // 保存後にモーダルを閉じず、共通項目を残して続けて入力できるようにする
  async function lcSaveAndContinue() {
    const row = _lcCollectRow();
    if (!row) return;
    const btns = _lcFooterBtns();
    btns.forEach(b => b.disabled = true);
    try {
      await _lcPersistRow(row);
      // 続けて新規入力: 入力済みの値はテンプレとして残し、新規レコード扱いにする
      _editId = null;
      const titleEl = document.getElementById('lcFormTitle');
      if (titleEl) titleEl.textContent = '新規チャージ登録（続けて入力）';
      if (typeof window.quoteShowToast === 'function') {
        quoteShowToast(`✅ 「${row.name}」を保存。続けて入力できます`, 'success');
      }
      // 行ごとに変わりやすい「金額」へフォーカスして選択（名称等はテンプレとして残す）
      const amtEl = document.getElementById('lc_amount');
      if (amtEl) { amtEl.focus(); amtEl.select?.(); }
    } catch (e) {
      alert('保存に失敗しました: ' + e.message);
    } finally {
      btns.forEach(b => b.disabled = false);
    }
  }

  async function lcDeleteCharge(id) {
    const charge = _charges.find(c => c.id === id);
    if (!confirm(`「${charge?.name || id}」を削除しますか？`)) return;
    // 添付ファイルも後始末（クラウド Storage / ローカル localStorage）
    if (charge?.attachment_path) await _lcRemoveStorage(charge.attachment_path);
    if (_getAttach(id)) { try { _persistAttach(id, null); } catch (e) {} }
    await _del(id);
    await _load(_dir);
    lcRender();
    lcRenderVariants();
    _lcFetchCarrierBms();
  }

  // === ゆらぎ是正 ===

  window.lcToggleVariants = function () {
    const p = document.getElementById('lcVariantPanel');
    if (!p) return;
    p.hidden = !p.hidden;
    if (!p.hidden) lcRenderVariants();
  };

  function lcRenderVariants() {
    const panel = document.getElementById('lcVariantPanel');
    if (!panel || panel.hidden) return;

    // 名称を頻度集計してから正規化キーでグループ化
    const freq = new Map();
    _charges.forEach(c => {
      if (!c.name) return;
      freq.set(c.name, (freq.get(c.name) || 0) + 1);
    });
    const normGroups = new Map();
    freq.forEach((cnt, name) => {
      const k = _lcNormalize(name);
      if (!k) return;
      if (!normGroups.has(k)) normGroups.set(k, []);
      normGroups.get(k).push({ name, cnt });
    });
    const groups = [...normGroups.values()]
      .filter(arr => arr.length > 1)
      .map(arr => arr.sort((a, b) => b.cnt - a.cnt))
      .sort((a, b) => b.length - a.length);

    if (!groups.length) {
      panel.innerHTML = '<p class="lc-var-empty">ゆらぎは検出されませんでした。</p>';
      return;
    }

    let h = `<div class="lc-var-header">
      <span class="lc-var-title">🔀 ゆらぎ検出 — ${groups.length} グループ</span>
      <span class="lc-var-hint">出現数が最多の表記を代表として「→ 統一」で一括リネームできます。不可逆操作です。</span>
    </div>`;

    groups.forEach(arr => {
      const canon = arr[0].name; // 最多件数が代表
      h += `<div class="lc-var-group">`;
      arr.forEach(({ name, cnt }, i) => {
        if (i === 0) {
          h += `<span class="lc-var-chip lc-var-chip--canon">${_esc(name)} <span class="lc-var-chip-cnt">×${cnt}</span> 代表</span>`;
        } else {
          h += `<span class="lc-var-chip">` +
               `${_esc(name)} <span class="lc-var-chip-cnt">×${cnt}</span>` +
               `<button class="lc-var-unify-btn" onclick="lcRenameVariant(${JSON.stringify(name)},${JSON.stringify(canon)})">→ 統一</button>` +
               `</span>`;
        }
      });
      h += `</div>`;
    });

    panel.innerHTML = h;
  }

  window.lcRenameVariant = async function (fromName, toName) {
    if (!confirm(`「${fromName}」を「${toName}」に統一しますか？\nこの操作は元に戻せません。`)) return;
    const c = _c();
    if (c) {
      const { error } = await c.from(TABLE)
        .update({ name: toName })
        .eq('name', fromName)
        .eq('direction', _dir);
      if (error) { alert('更新に失敗しました: ' + error.message); return; }
    } else {
      const all = JSON.parse(localStorage.getItem(LOC_KEY) || '[]');
      all.forEach(r => { if (r.name === fromName && r.direction === _dir) r.name = toName; });
      _saveLocal(all);
    }
    await _load(_dir);
    lcRender();
    lcRenderVariants();
    if (typeof window.quoteShowToast === 'function') window.quoteShowToast(`✅ 「${fromName}」→「${toName}」に統一しました`, 'success');
  };

  // === 見積ピッカー ===

  let _pickerCharges = [];
  let _selected      = new Set();

  async function lcOpenPicker() {
    const qDir = typeof window._currentDirection !== 'undefined'
      ? (window._currentDirection === 'import' ? 'import' : 'export')
      : 'export';
    _pickDir  = qDir;
    _selected = new Set();

    const modal = document.getElementById('lcPickerModal');
    if (!modal) return;
    modal.classList.add('open');

    document.querySelectorAll('.lc-pick-dir-btn').forEach(b => b.classList.remove('is-active'));
    document.getElementById('lcPickDir-' + _pickDir)?.classList.add('is-active');

    await _loadPickerCharges();
    lcPickerRender();
  }

  async function _loadPickerCharges() {
    const c = _c();
    if (c) {
      const { data, error } = await c.from(TABLE)
        .select('*').eq('direction', _pickDir).order('name');
      if (!error) { _pickerCharges = data || []; return; }
    }
    _pickerCharges = _getLocal(_pickDir);
  }

  async function lcPickerDir(dir) {
    _pickDir  = dir;
    _selected = new Set();
    document.querySelectorAll('.lc-pick-dir-btn').forEach(b => b.classList.remove('is-active'));
    document.getElementById('lcPickDir-' + dir)?.classList.add('is-active');
    await _loadPickerCharges();
    lcPickerRender();
  }

  function lcPickerRender() {
    const list = document.getElementById('lcPickerList');
    if (!list) return;

    const q  = (document.getElementById('lcPickText')?.value   || '').toLowerCase();
    const pt = (document.getElementById('lcPickPort')?.value   || '').toLowerCase();
    const cr = (document.getElementById('lcPickCarrier')?.value|| '').toLowerCase();

    const filtered = _pickerCharges.filter(c => {
      if (q  && !(c.name||'').toLowerCase().includes(q) && !(c.note||'').toLowerCase().includes(q)
             && !(c.full_name||'').toLowerCase().includes(q) && !(c.description||'').toLowerCase().includes(q)) return false;
      if (pt && !(c.pol||c.port||'').toLowerCase().includes(pt) && !(c.pod||'').toLowerCase().includes(pt)) return false;
      if (cr && !(c.carrier||'').toLowerCase().includes(cr)) return false;
      return true;
    });

    if (!filtered.length) { list.innerHTML = '<p class="lc-empty">該当なし</p>'; _updatePickCount(); return; }

    let h = '';
    filtered.forEach(c => {
      const chk = _selected.has(c.id) ? 'checked' : '';
      h += `<label class="lc-pick-row${_selected.has(c.id) ? ' selected' : ''}">` +
           `<input type="checkbox" class="lc-pick-chk" value="${c.id}" ${chk} onchange="lcPickToggle('${c.id}')">` +
           `<span class="lc-pick-name">${_esc(c.name)}${c.full_name ? `<span class="lc-pick-fullname">${_esc(c.full_name)}</span>` : ''}</span>` +
           `<span class="lc-pick-meta">${_esc([(c.pol||c.port), c.pod, c.carrier].filter(Boolean).join(' / ') || '')}${c.description ? `<span class="lc-pick-desc">${_esc(c.description.slice(0, 60))}${c.description.length > 60 ? '…' : ''}</span>` : ''}</span>` +
           `<span class="lc-pick-amt">${_fmtAmt(c.amount, c.currency)}${c.unit ? ' / ' + _esc(c.unit) : ''}</span>` +
           `</label>`;
    });
    list.innerHTML = h;
    _updatePickCount();
  }

  function lcPickToggle(id) {
    _selected.has(id) ? _selected.delete(id) : _selected.add(id);
    const chk = document.querySelector(`.lc-pick-chk[value="${id}"]`);
    chk?.closest('.lc-pick-row')?.classList.toggle('selected', _selected.has(id));
    _updatePickCount();
  }

  function _updatePickCount() {
    const el = document.getElementById('lcPickCountMsg');
    if (el) el.textContent = _selected.size ? `${_selected.size}件選択中` : '未選択';
    const btn = document.getElementById('lcPickInsertBtn');
    if (btn) btn.disabled = !_selected.size;
  }

  function lcInsertSelected() {
    if (!_selected.size) return;
    const toInsert = _pickerCharges.filter(c => _selected.has(c.id));
    if (typeof window.addChargeRows === 'function') {
      window.addChargeRows(toInsert.map(c => ({
        name:     c.name,
        cat:      c.cat,
        amount:   c.amount,
        currency: c.currency,
        unit:     c.unit,
        sv:       c.carrier || '',
        note:     c.note,
      })));
    }
    lcClosePicker();
  }

  function lcClosePicker() {
    document.getElementById('lcPickerModal')?.classList.remove('open');
    _selected = new Set();
  }

  // === 右カラム 諸チャージパネル ===

  let _railCharges = [];
  let _railSelIds  = new Set();
  let _railDir     = 'export';

  async function loadChargesRail() {
    const wrap = document.getElementById('lcRailListWrap');
    if (!wrap) return;
    const cond = typeof window.getConditions === 'function' ? window.getConditions() : {};
    _railDir = (cond.direction === 'import') ? 'import' : 'export';
    document.getElementById('lcRailDirBtn-export')?.classList.toggle('is-active', _railDir === 'export');
    document.getElementById('lcRailDirBtn-import')?.classList.toggle('is-active', _railDir === 'import');
    wrap.innerHTML = '<div class="lc-rail-empty">読み込み中…</div>';
    const c = _c();
    if (c) {
      const { data, error } = await c.from(TABLE).select('*').eq('direction', _railDir).order('cat,name');
      _railCharges = error ? [] : (data || []);
    } else {
      _railCharges = _getLocal(_railDir);
    }
    _railSelIds = new Set();
    lcRailFilter();
  }

  function lcRailFilter() {
    const q = (document.getElementById('lcRailSearch')?.value || '').toLowerCase();
    const filtered = !q ? _railCharges : _railCharges.filter(c =>
      (c.name||'').toLowerCase().includes(q) ||
      (c.full_name||'').toLowerCase().includes(q) ||
      (c.carrier||'').toLowerCase().includes(q) ||
      (c.note||'').toLowerCase().includes(q)
    );
    _renderRailList(filtered);
  }

  function _renderRailList(list) {
    const wrap = document.getElementById('lcRailListWrap');
    if (!wrap) return;
    if (!list.length) {
      wrap.innerHTML = '<div class="lc-rail-empty">' +
        (document.getElementById('lcRailSearch')?.value ? '該当なし' : 'チャージが登録されていません') +
        '</div>';
      _updateRailCount();
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const warnDate = new Date(); warnDate.setDate(warnDate.getDate() + 30);
    const warnStr = warnDate.toISOString().slice(0, 10);
    wrap.innerHTML = list.map(c => {
      const isExpired  = c.valid_to && c.valid_to < today;
      const isExpiring = !isExpired && c.valid_to && c.valid_to <= warnStr;
      const cls = isExpired ? ' lc-rail-expired' : isExpiring ? ' lc-rail-expiring' : '';
      const selCls = _railSelIds.has(c.id) ? ' lc-rail-card--sel' : '';
      const badge = isExpired
        ? '<span class="lc-exp-badge lc-exp-badge--red">期限切れ</span>'
        : isExpiring
          ? `<span class="lc-exp-badge lc-exp-badge--amber">～${c.valid_to}</span>`
          : '';
      const chk = _railSelIds.has(c.id) ? 'checked' : '';
      const meta = [c.carrier, c.pol||c.port, c.pod].filter(Boolean).join(' / ');
      const descTitle = c.description ? ` title="${String(c.description).replace(/"/g,'&quot;')}"` : '';
      const periodLabel = c.valid_from ? (c.valid_from + (c.valid_to ? '～'+c.valid_to : '～')) : '';
      return `<label class="lc-rail-card${cls}${selCls}"${descTitle}>` +
             `<input type="checkbox" class="lc-rail-chk" value="${_ea(c.id)}" ${chk} onchange="lcRailToggle('${_ea(c.id)}')">` +
             `<div class="lc-rail-info">` +
             `<div class="lc-rail-name">${_esc(c.name)}${badge}</div>` +
             (meta ? `<div class="lc-rail-meta">${_esc(meta)}</div>` : '') +
             `</div>` +
             `<div class="lc-rail-amt">${_fmtAmt(c.amount, c.currency)}${c.unit ? ' /'+_esc(c.unit) : ''}` +
             (periodLabel ? `<div class="lc-rail-period">${_esc(periodLabel)}</div>` : '') +
             `</div>` +
             `</label>`;
    }).join('');
    _updateRailCount();
  }

  function _updateRailCount() {
    const el  = document.getElementById('lcRailSelCount');
    if (el) el.textContent = _railSelIds.size ? _railSelIds.size + '件選択中' : '未選択';
    const btn = document.getElementById('lcRailInsertBtn');
    if (btn) btn.disabled = !_railSelIds.size;
  }

  function lcRailDir(dir) {
    _railDir = dir;
    loadChargesRail();
  }

  function lcRailToggle(id) {
    _railSelIds.has(id) ? _railSelIds.delete(id) : _railSelIds.add(id);
    const chk = document.querySelector(`.lc-rail-chk[value="${id}"]`);
    chk?.closest('.lc-rail-card')?.classList.toggle('lc-rail-card--sel', _railSelIds.has(id));
    _updateRailCount();
  }

  function lcRailInsert() {
    if (!_railSelIds.size) return;
    const toInsert = _railCharges.filter(c => _railSelIds.has(c.id));
    if (typeof window.addChargeRows === 'function') {
      window.addChargeRows(toInsert.map(c => ({
        name: c.name, cat: c.cat,
        amount: c.amount, currency: c.currency, unit: c.unit,
        sv: c.carrier || '', note: c.note,
      })));
      _railSelIds = new Set();
      lcRailFilter();
      if (typeof window.quoteShowToast === 'function') quoteShowToast(`✅ ${toInsert.length}件を見積に挿入しました`, 'success');
    }
  }

  // === サーチャージ変更通知 ===

  function lcOpenNotice() {
    const modal = document.getElementById('lcNoticeModal');
    if (!modal) return;
    // 選択中があれば選択分、なければサーチャージカテゴリのみ
    const items = (_railSelIds.size > 0
      ? _railCharges.filter(c => _railSelIds.has(c.id))
      : _railCharges.filter(c => c.cat === 'surcharge')
    ).filter(c => c.name);

    const dirLabel = _railDir === 'import' ? '輸入' : '輸出';
    const vFroms = items.filter(c => c.valid_from).map(c => c.valid_from).sort();
    const effectiveDate = vFroms[0]
      ? new Date(vFroms[0]).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })
      : '○年○月○日';

    document.getElementById('lcNoticeSubject').value =
      `【${dirLabel}】サーチャージ改定のご案内（${effectiveDate}適用）`;

    const lines = items.length
      ? items.map(c => {
          const amt = c.amount != null
            ? _fmtAmt(c.amount, c.currency) + (c.unit ? '／' + c.unit : '')
            : '改定後料率別途ご案内';
          const period = c.valid_from ? `  （${c.valid_from}${c.valid_to ? '～'+c.valid_to : '～'}）` : '';
          return `　• ${c.name}：${amt}${period}`;
        }).join('\n')
      : '　（右カラムでチャージを選択してください）';

    document.getElementById('lcNoticeBody').value =
      `拝啓　時下益々のご清栄のこととお慶び申し上げます。\n` +
      `平素より格別のご高配を賜り、厚く御礼申し上げます。\n\n` +
      `さて、下記の通りサーチャージ改定のご案内を申し上げます。\n\n` +
      `■ 改定内容\n${lines}\n\n` +
      `■ 適用日　${effectiveDate}\n\n` +
      `※ 詳細につきましては、別途担当者よりご案内いたします。\n` +
      `今後とも何卒よろしくお願い申し上げます。\n\n` +
      `　　　　　　　　　　　　　　　　　　　　　　　　敬具`;

    modal.classList.add('open');
  }

  function lcCloseNotice() {
    document.getElementById('lcNoticeModal')?.classList.remove('open');
  }

  async function lcCopyNotice() {
    const text = document.getElementById('lcNoticeBody')?.value || '';
    try { await navigator.clipboard.writeText(text); }
    catch (e) { document.getElementById('lcNoticeBody')?.select(); document.execCommand('copy'); }
    if (typeof window.quoteShowToast === 'function') quoteShowToast('📋 本文をコピーしました', 'success');
    lcCloseNotice();
  }

  async function lcCopyNoticeSubject() {
    const text = document.getElementById('lcNoticeSubject')?.value || '';
    try { await navigator.clipboard.writeText(text); }
    catch (e) {}
    if (typeof window.quoteShowToast === 'function') quoteShowToast('📋 件名をコピーしました', 'success');
  }

  // === initLocalChargesTab ===

  window.initLocalChargesTab = async function () {
    _updateCloudStatus();
    const gsel = document.getElementById('lcGroupMode');
    if (gsel) gsel.value = _groupMode;
    lcSetDir('export');
  };

  // === ブックマーク連携（carrier link chips） ===

  let _lcBmCache   = {};   // { carrier: [{id, label, url, function, note}] }
  let _lcBmLastKey = '';   // 重複フェッチ防止

  async function _lcFetchCarrierBms() {
    const carriers = [...new Set(_charges.map(c => c.carrier).filter(Boolean))].sort();
    const key = carriers.join('\0');
    if (key === _lcBmLastKey) { lcRender(); return; }

    if (!carriers.length) {
      _lcBmCache = {};
      _lcBmLastKey = key;
      lcRender();
      return;
    }

    const db = window.SupabaseClient;
    if (db) {
      const { data: sd } = await db.auth.getSession().catch(() => ({ data: {} }));
      if (sd?.session) {
        const { data } = await db
          .from('bookmarks')
          .select('id, label, url, carrier, function, note')
          .in('carrier', carriers)
          .not('url', 'is', null);
        const cache = {};
        carriers.forEach(c => { cache[c] = []; });
        (data || []).forEach(bm => { if (cache[bm.carrier]) cache[bm.carrier].push(bm); });
        _lcBmCache = cache;
      }
    } else {
      const cache = {};
      carriers.forEach(c => { cache[c] = []; });
      _lcBmCache = cache;
    }
    _lcBmLastKey = key;
    lcRender();
  }

  function _lcBmChipClass(fn) {
    if (!fn) return '';
    if (fn.includes('輸出')) return 'lc-bm-chip--export';
    if (fn.includes('輸入')) return 'lc-bm-chip--import';
    if (fn.includes('お知らせ')) return 'lc-bm-chip--notice';
    return '';
  }

  function _lcRenderCarrierBmSection() {
    const el = document.getElementById('lcCarrierBmSection');
    if (!el) return;
    // 船会社グループ表示のときはグループ見出しにチップを統合するため独立セクションは隠す
    if (_groupMode === 'carrier') { el.hidden = true; return; }

    const carriers = [...new Set(_charges.map(c => c.carrier).filter(Boolean))].sort();
    if (!carriers.length) { el.hidden = true; return; }

    const hasDb = !!(window.SupabaseClient);
    let h = '';

    carriers.forEach(carrier => {
      const bms = _lcBmCache[carrier] || [];
      h += `<div class="lc-bm-carrier-row">` +
           `<span class="lc-bm-carrier-name">${_esc(carrier)}</span>` +
           `<span class="lc-bm-chips">`;
      bms.forEach(bm => {
        const cls   = _lcBmChipClass(bm.function);
        const title = _ea([bm.function, bm.note].filter(Boolean).join(' — '));
        h += `<a class="lc-bm-chip${cls ? ' ' + cls : ''}" href="${_ea(bm.url)}" target="_blank" rel="noopener" title="${title}">${_esc(bm.label)}</a>`;
      });
      if (hasDb) {
        h += `<button class="lc-bm-add-chip" data-lc-carrier="${_ea(carrier)}"` +
             ` onclick="openAddBmModal({carrier:this.dataset.lcCarrier,type:'FCL'})"` +
             ` title="${_ea(carrier)}のブックマークを追加">＋</button>`;
      }
      h += `</span></div>`;
    });

    el.innerHTML = h;
    el.hidden = false;
  }

  window.lcRefreshBmChips = function () {
    _lcBmLastKey = '';
    _lcFetchCarrierBms();
  };

  // 船会社グループ見出し直下のブックマークリンクチップ帯（案3統合）
  function _lcGroupBmHtml(carrier) {
    const NO_CARRIER = '（船会社指定なし）';
    if (!carrier || carrier === NO_CARRIER) return '';
    const bms   = _lcBmCache[carrier] || [];
    const hasDb = !!(window.SupabaseClient);
    if (!bms.length && !hasDb) return '';
    let chips = bms.map(bm => {
      const cls   = _lcBmChipClass(bm.function);
      const title = _ea([bm.function, bm.note].filter(Boolean).join(' — '));
      return `<a class="lc-bm-chip${cls ? ' ' + cls : ''}" href="${_ea(bm.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="${title}">${_esc(bm.label)}</a>`;
    }).join('');
    if (hasDb) {
      chips += `<button class="lc-bm-add-chip" data-lc-carrier="${_ea(carrier)}"` +
               ` onclick="event.stopPropagation();openAddBmModal({carrier:this.dataset.lcCarrier,type:'FCL'})"` +
               ` title="${_ea(carrier)}のブックマークを追加">＋</button>`;
    }
    return `<div class="lc-acc-bm"><span class="lc-acc-bm-ic">🔖</span><span class="lc-bm-chips">${chips}</span></div>`;
  }

  window.lcSetGroupMode = function (mode) {
    _groupMode = mode;
    try { localStorage.setItem('lcGroupMode_v1', mode); } catch (e) {}
    const sel = document.getElementById('lcGroupMode');
    if (sel && sel.value !== mode) sel.value = mode;
    lcRender();
  };
  window.lcToggleGroup = function (headerEl) {
    const acc = headerEl?.closest?.('.lc-acc');
    if (!acc) return;
    const key = acc.getAttribute('data-gkey');
    const nowCollapsed = acc.classList.toggle('is-collapsed');
    if (key) { if (nowCollapsed) _collapsedGroups.add(key); else _collapsedGroups.delete(key); }
    const hh = acc.querySelector('.lc-acc-h');
    if (hh) hh.setAttribute('aria-expanded', nowCollapsed ? 'false' : 'true');
  };

  // === 添付ファイル操作（グローバル関数） ===

  window.lcHandleFileChange = function(input) {
    const f = input?.files?.[0];
    if (!f) return;
    _readFile(f, obj => { _pendingAttach = obj; _lcUpdateAttachUI(); });
  };

  window.lcClearAttach = function() {
    _pendingAttach = false;
    _lcUpdateAttachUI();
  };

  // === 公開 API ===
  window.lcSetDir         = lcSetDir;
  window.lcRender         = lcRender;
  window.lcOpenForm       = lcOpenForm;
  window.lcCloseForm      = lcCloseForm;
  window.lcSaveCharge     = lcSaveCharge;
  window.lcSaveAndContinue = lcSaveAndContinue;
  window.lcDeleteCharge   = lcDeleteCharge;
  window.lcRenderVariants = lcRenderVariants;
  window.lcOpenPicker     = lcOpenPicker;
  window.lcPickerDir      = lcPickerDir;
  window.lcPickerRender   = lcPickerRender;
  window.lcPickToggle     = lcPickToggle;
  window.lcInsertSelected = lcInsertSelected;
  window.lcClosePicker    = lcClosePicker;

  window.loadChargesRail    = loadChargesRail;
  window.lcRailFilter       = lcRailFilter;
  window.lcRailDir          = lcRailDir;
  window.lcRailToggle       = lcRailToggle;
  window.lcRailInsert       = lcRailInsert;
  window.lcOpenNotice       = lcOpenNotice;
  window.lcCloseNotice      = lcCloseNotice;
  window.lcCopyNotice       = lcCopyNotice;
  window.lcCopyNoticeSubject = lcCopyNoticeSubject;

  window.lcInitFormSelects = function () {
    const catSel = document.getElementById('lc_cat');
    if (catSel && !catSel.children.length) {
      catSel.innerHTML = LC_CATS.map(c => `<option value="${c.value}">${_esc(c.label)}</option>`).join('');
    }
    const curSel = document.getElementById('lc_currency');
    if (curSel && !curSel.children.length) {
      curSel.innerHTML = LC_CURRENCIES.map(c => `<option value="${c}">${c}</option>`).join('');
    }
    // 単位は自由入力（datalist で従来プリセットを候補表示）
    const unitList = document.getElementById('lcUnitList');
    if (unitList && !unitList.children.length) {
      unitList.innerHTML = LC_UNITS.filter(Boolean).map(u => `<option value="${u}"></option>`).join('');
    }
  };

})();
