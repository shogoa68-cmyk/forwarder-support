// 諸チャージ管理・見積引用モジュール
(function () {
  'use strict';

  const TABLE      = 'local_charges';
  const LOC_KEY    = 'localCharges_v1';
  const ATTACH_KEY = 'lcAttachments_v1';

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
        nameEl.href        = disp.dataUrl;
        nameEl.download    = disp.name;
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

    let h = '<table class="lc-table"><thead><tr>' +
            '<th>名称</th><th>カテゴリ</th><th>積み港</th><th>揚げ港</th><th>船会社</th>' +
            '<th class="lc-num-col">金額</th><th>単位</th><th>適用期間</th><th>更新 / 作業者</th><th></th>' +
            '</tr></thead><tbody>';

    filtered.forEach(c => {
      const today    = new Date().toISOString().slice(0, 10);
      const warnDate = new Date(); warnDate.setDate(warnDate.getDate() + 30);
      const warnStr  = warnDate.toISOString().slice(0, 10);
      const isNotYet  = c.valid_from && c.valid_from > today;
      const isExpired = c.valid_to && c.valid_to < today;
      const isExpiring = !isExpired && c.valid_to && c.valid_to <= warnStr;
      const rowCls = isExpired ? 'lc-expired' : isExpiring ? 'lc-expiring' : isNotYet ? 'lc-future' : '';
      const pol = c.pol || c.port || '—';
      const pod = c.pod || '—';
      const descTitle = c.description ? ` title="${String(c.description).replace(/"/g,'&quot;')}"` : '';
      const actor = (c.updated_by || c.created_by || '').split('@')[0];

      const expiryBadge = isExpired
        ? '<span class="lc-exp-badge lc-exp-badge--red">期限切れ</span>'
        : isExpiring
          ? `<span class="lc-exp-badge lc-exp-badge--amber">～${c.valid_to}</span>`
          : '';

      // 参照元アイコン（URLは外部リンク、それ以外はツールチップ）
      const srcHtml = c.source
        ? (c.source.startsWith('http')
            ? ` <a class="lc-source-icon" href="${_ea(c.source)}" target="_blank" rel="noopener" title="${_ea(c.source)}">🔗</a>`
            : ` <span class="lc-source-icon" title="${_ea(c.source)}">📄</span>`)
        : '';

      const periodStr = c.valid_from || c.valid_to
        ? (c.valid_from ? _fmtDate(c.valid_from) : '—') + ' ～ ' + (c.valid_to ? _fmtDate(c.valid_to) : '')
        : '—';
      h += `<tr class="${rowCls}">` +
           `<td class="lc-name"${descTitle}>${_esc(c.name)}${srcHtml}${expiryBadge}` +
           (c.full_name ? `<div class="lc-name-sub">${_esc(c.full_name)}</div>` : '') +
           `</td>` +
           `<td class="lc-cat"><span class="lc-cat-badge lc-cat-${c.cat || 'other'}">${_esc(catMap[c.cat] || c.cat || '—')}</span></td>` +
           `<td>${_esc(pol)}</td>` +
           `<td>${_esc(pod)}</td>` +
           `<td>${_esc(c.carrier || '—')}</td>` +
           `<td class="lc-num-col">${_fmtAmt(c.amount, c.currency)}</td>` +
           `<td>${_esc(c.unit || '—')}</td>` +
           `<td class="lc-date">${periodStr}</td>` +
           `<td class="lc-date">${c.updated_at ? _fmtDate(c.updated_at) : '—'}` +
           (actor ? `<div class="lc-updated-by">${_esc(actor)}</div>` : '') +
           `</td>` +
           `<td class="lc-ops">` +
           (_getAttach(c.id) ? `<a class="lc-attach-tbl-btn" href="${_getAttach(c.id).dataUrl}" download="${_ea(_getAttach(c.id).name)}" target="_blank" title="添付: ${_ea(_getAttach(c.id).name)}">📎</a>` : '') +
           `<button class="lc-edit-btn" onclick="lcOpenForm('${c.id}')" title="編集">✏️</button>` +
           `<button class="lc-del-btn"  onclick="lcDeleteCharge('${c.id}')" title="削除">🗑️</button>` +
           `</td></tr>`;
    });
    list.innerHTML = h + '</tbody></table>';
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

    // 添付ファイル状態を初期化
    _pendingAttach = null;
    _currentAttach = _getAttach(charge?.id || null);
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

  async function lcSaveCharge() {
    const g = id => document.getElementById(id)?.value?.trim() || '';
    const name    = g('lc_name');
    const carrier = g('lc_carrier');
    if (!name)    { alert('名称は必須です'); return; }
    if (!carrier) { alert('船会社（キャリアー）は必須です'); document.getElementById('lc_carrier')?.focus(); return; }

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

    const btn = document.querySelector('#lcFormModal .lc-save-btn');
    if (btn) btn.disabled = true;
    try {
      const saved   = await _upsert(row);
      const savedId = saved?.id || row.id || _editId;
      // 添付ファイルを保存・削除（null=変更なし、false=削除、object=新規）
      if (_pendingAttach !== null && savedId) {
        _persistAttach(savedId, _pendingAttach || null);
      }
      lcCloseForm();
      await _load(_dir);
      lcRender();
      lcRenderVariants();
    } catch (e) {
      alert('保存に失敗しました: ' + e.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function lcDeleteCharge(id) {
    const charge = _charges.find(c => c.id === id);
    if (!confirm(`「${charge?.name || id}」を削除しますか？`)) return;
    await _del(id);
    await _load(_dir);
    lcRender();
    lcRenderVariants();
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
    lcSetDir('export');
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
    const unitSel = document.getElementById('lc_unit');
    if (unitSel && !unitSel.children.length) {
      unitSel.innerHTML = LC_UNITS.map(u => `<option value="${u}">${u || '（単位なし）'}</option>`).join('');
    }
  };

})();
