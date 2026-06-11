// ローカルチャージ管理・見積引用モジュール
(function () {
  'use strict';

  const TABLE    = 'local_charges';
  const LOC_KEY  = 'localCharges_v1'; // localStorage fallback

  // quote カテゴリのうちローカルチャージに関連するもの
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

  let _dir     = 'export';  // 現在の方向タブ
  let _charges = [];        // 読み込み済みチャージ一覧
  let _editId  = null;      // 編集中レコードの id（null=新規）
  let _pickDir = 'export';  // ピッカーの方向タブ

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
    // localStorage
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

  // === ローカルチャージタブ ===

  function _esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function _fmtDate(d) { return d ? String(d).slice(0,10) : ''; }
  function _fmtAmt(a, cur) {
    if (a == null || a === '') return '—';
    const n = Number(a);
    if (isNaN(n)) return '—';
    return (cur === 'JPY' ? '¥' : (cur + ' ')) + n.toLocaleString('ja-JP');
  }

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

  async function lcSetDir(dir) {
    _dir = dir;
    document.querySelectorAll('.lc-dir-btn').forEach(b => b.classList.remove('is-active'));
    document.getElementById('lcDirBtn-' + dir)?.classList.add('is-active');
    await _load(dir);
    lcRender();
  }

  function lcRender() {
    const list = document.getElementById('lcList');
    if (!list) return;

    const q   = (document.getElementById('lcFilterText')?.value   || '').toLowerCase();
    const pt  = (document.getElementById('lcFilterPort')?.value   || '').toLowerCase();
    const cr  = (document.getElementById('lcFilterCarrier')?.value|| '').toLowerCase();

    const filtered = _charges.filter(c => {
      if (q  && !(c.name||'').toLowerCase().includes(q)  && !(c.note||'').toLowerCase().includes(q))  return false;
      if (pt && !(c.port||'').toLowerCase().includes(pt))    return false;
      if (cr && !(c.carrier||'').toLowerCase().includes(cr)) return false;
      return true;
    });

    if (!filtered.length) {
      list.innerHTML = '<p class="lc-empty">該当するチャージがありません。<br><button class="lc-add-btn-inline" onclick="lcOpenForm(null)">＋ 新規登録</button></p>';
      return;
    }

    const catMap = Object.fromEntries(LC_CATS.map(c => [c.value, c.label]));

    let h = '<table class="lc-table"><thead><tr>' +
            '<th>名称</th><th>カテゴリ</th><th>港/ターミナル</th><th>船会社</th>' +
            '<th class="lc-num-col">金額</th><th>単位</th><th>適用開始</th><th>更新</th><th></th>' +
            '</tr></thead><tbody>';
    filtered.forEach(c => {
      const today = new Date().toISOString().slice(0, 10);
      const expired = c.valid_from && c.valid_from > today;
      h += `<tr class="${expired ? 'lc-future' : ''}">` +
           `<td class="lc-name">${_esc(c.name)}</td>` +
           `<td class="lc-cat"><span class="lc-cat-badge lc-cat-${c.cat || 'other'}">${_esc(catMap[c.cat] || c.cat || '—')}</span></td>` +
           `<td>${_esc(c.port || '—')}</td>` +
           `<td>${_esc(c.carrier || '—')}</td>` +
           `<td class="lc-num-col">${_fmtAmt(c.amount, c.currency)}</td>` +
           `<td>${_esc(c.unit || '—')}</td>` +
           `<td class="lc-date">${c.valid_from ? _fmtDate(c.valid_from) : '—'}</td>` +
           `<td class="lc-date">${c.updated_at ? _fmtDate(c.updated_at) : '—'}</td>` +
           `<td class="lc-ops">` +
           `<button class="lc-edit-btn" onclick="lcOpenForm('${c.id}')" title="編集">✏️</button>` +
           `<button class="lc-del-btn"  onclick="lcDeleteCharge('${c.id}')" title="削除">🗑️</button>` +
           `</td></tr>`;
    });
    list.innerHTML = h + '</tbody></table>';
  }

  // === 登録フォームモーダル ===

  function lcOpenForm(id) {
    _editId = id || null;
    const charge = id ? _charges.find(c => c.id === id) : null;
    const modal  = document.getElementById('lcFormModal');
    if (!modal) return;

    document.getElementById('lcFormTitle').textContent = charge ? 'チャージを編集' : '新規チャージ登録';

    const set = (elId, val) => { const e = document.getElementById(elId); if (e) e.value = val || ''; };
    set('lc_name',       charge?.name       || '');
    set('lc_cat',        charge?.cat        || (_dir === 'export' ? 'export-local' : 'import-local'));
    set('lc_amount',     charge?.amount     ?? '');
    set('lc_currency',   charge?.currency   || 'JPY');
    set('lc_unit',       charge?.unit       || '');
    set('lc_port',       charge?.port       || '');
    set('lc_carrier',    charge?.carrier    || '');
    set('lc_valid_from', charge?.valid_from ? _fmtDate(charge.valid_from) : '');
    set('lc_note',       charge?.note       || '');

    modal.classList.add('open');
    document.getElementById('lc_name')?.focus();
  }

  function lcCloseForm() {
    document.getElementById('lcFormModal')?.classList.remove('open');
    _editId = null;
  }

  async function lcSaveCharge() {
    const g = id => document.getElementById(id)?.value?.trim() || '';
    const name = g('lc_name');
    if (!name) { alert('名称は必須です'); return; }

    const row = {
      id:         _editId || undefined,
      direction:  _dir,
      name,
      cat:        g('lc_cat'),
      amount:     document.getElementById('lc_amount')?.value !== '' ? Number(document.getElementById('lc_amount').value) : null,
      currency:   g('lc_currency') || 'JPY',
      unit:       g('lc_unit'),
      port:       g('lc_port'),
      carrier:    g('lc_carrier'),
      valid_from: g('lc_valid_from') || null,
      note:       g('lc_note'),
    };
    if (!row.id) delete row.id;

    const btn = document.querySelector('#lcFormModal .lc-save-btn');
    if (btn) btn.disabled = true;
    try {
      await _upsert(row);
      lcCloseForm();
      await _load(_dir);
      lcRender();
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
  }

  // === 見積ピッカーモーダル ===

  let _pickerCharges = []; // ピッカー用キャッシュ
  let _selected      = new Set();

  async function lcOpenPicker() {
    // 現在の引き合い方向を自動選択（輸出/輸入）
    const qDir = typeof window._currentDirection !== 'undefined'
      ? (window._currentDirection === 'import' ? 'import' : 'export')
      : 'export';
    _pickDir  = qDir;
    _selected = new Set();

    const modal = document.getElementById('lcPickerModal');
    if (!modal) return;
    modal.classList.add('open');

    // ピッカー方向ボタンの初期化
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
      if (q  && !(c.name||'').toLowerCase().includes(q)  && !(c.note||'').toLowerCase().includes(q))  return false;
      if (pt && !(c.port||'').toLowerCase().includes(pt))    return false;
      if (cr && !(c.carrier||'').toLowerCase().includes(cr)) return false;
      return true;
    });

    if (!filtered.length) { list.innerHTML = '<p class="lc-empty">該当なし</p>'; _updatePickCount(); return; }

    let h = '';
    filtered.forEach(c => {
      const chk = _selected.has(c.id) ? 'checked' : '';
      h += `<label class="lc-pick-row${_selected.has(c.id) ? ' selected' : ''}">` +
           `<input type="checkbox" class="lc-pick-chk" value="${c.id}" ${chk} onchange="lcPickToggle('${c.id}')">` +
           `<span class="lc-pick-name">${_esc(c.name)}</span>` +
           `<span class="lc-pick-meta">${_esc([c.port, c.carrier].filter(Boolean).join(' / ') || '')}</span>` +
           `<span class="lc-pick-amt">${_fmtAmt(c.amount, c.currency)}${c.unit ? ' / ' + _esc(c.unit) : ''}</span>` +
           `</label>`;
    });
    list.innerHTML = h;
    _updatePickCount();
  }

  function lcPickToggle(id) {
    _selected.has(id) ? _selected.delete(id) : _selected.add(id);
    // チェック状態に合わせて selected クラスをトグル
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

  // === initLocalChargesTab ===

  window.initLocalChargesTab = async function () {
    _updateCloudStatus();
    lcSetDir('export');
  };

  // === 公開 API ===
  window.lcSetDir         = lcSetDir;
  window.lcRender         = lcRender;
  window.lcOpenForm       = lcOpenForm;
  window.lcCloseForm      = lcCloseForm;
  window.lcSaveCharge     = lcSaveCharge;
  window.lcDeleteCharge   = lcDeleteCharge;
  window.lcOpenPicker     = lcOpenPicker;
  window.lcPickerDir      = lcPickerDir;
  window.lcPickerRender   = lcPickerRender;
  window.lcPickToggle     = lcPickToggle;
  window.lcInsertSelected = lcInsertSelected;
  window.lcClosePicker    = lcClosePicker;

  // HTML 要素用: カテゴリ・通貨・単位の <option> を構築して注入
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
