// ========== 🔖 BOOKMARK（チーム共有ブックマーク） ==========

let _bmRows          = [];
let _bmTypeFilter    = '';
let _bmCarrierFilter = '';
let _bmFnFilter      = '';

// QSP 幹線輸送チップ用キャリアブックマークキャッシュ
window._qspBmCache = {};
let _qspBmLastKey  = '';  // 重複フェッチ防止キー

function initBookmarkTab() {
  _bmRenderTypeChips();
  _bmRenderFnChips();
  _bmLoad();
}

async function _bmLoad() {
  const db   = window.SupabaseClient;
  const wrap = document.getElementById('bmListWrap');
  if (!db) {
    if (wrap) wrap.innerHTML = '<div class="bm-empty">⚠️ DB接続未初期化</div>';
    return;
  }
  if (wrap) wrap.innerHTML = '<div class="bm-empty">読み込み中…</div>';

  const { data: sd } = await db.auth.getSession();
  const user = sd?.session?.user || null;
  const addBtn = document.getElementById('bmAddBtn');
  if (addBtn) addBtn.hidden = !user;

  if (!user) {
    if (wrap) wrap.innerHTML =
      '<div class="bm-empty">チームメンバーとして<a href="#" onclick="cloudLogin();return false;">ログイン</a>するとブックマークを閲覧できます</div>';
    return;
  }

  const { data, error } = await db
    .from('bookmarks')
    .select('*')
    .order('carrier_type')
    .order('carrier',   { nullsFirst: false })
    .order('function')
    .order('created_at', { ascending: false });

  if (error) {
    if (wrap) wrap.innerHTML =
      '<div class="bm-empty">⚠️ 取得エラー：' + escHtml(error.message) + '</div>';
    return;
  }
  _bmRows = data || [];
  _bmRenderTypeChips();
  _bmApply();
}

function _bmApply() {
  let rows = _bmRows;
  if (_bmTypeFilter)    rows = rows.filter(r => r.carrier_type === _bmTypeFilter);
  if (_bmCarrierFilter) rows = rows.filter(r => r.carrier === _bmCarrierFilter);
  if (_bmFnFilter)      rows = rows.filter(r => r.function  === _bmFnFilter);
  _bmRenderCarrierChips();
  _bmRenderFnChips(rows);
  _bmRenderList(rows);
}

// ---------- チップ描画 ----------
function _bmRenderTypeChips() {
  const el = document.getElementById('bmTypeChips');
  if (!el) return;
  const types = [
    { key: '',        label: 'すべて' },
    { key: 'FCL',     label: 'FCL 船会社' },
    { key: 'LCL',     label: 'LCL キャリア' },
    { key: 'general', label: '汎用' },
  ];
  el.innerHTML = types.map(t =>
    `<button class="bm-chip${_bmTypeFilter === t.key ? ' is-active' : ''}"
             onclick='bmSetType(${JSON.stringify(t.key)})'>${t.label}</button>`
  ).join('');
}

function _bmRenderCarrierChips() {
  const el  = document.getElementById('bmCarrierChips');
  const row = document.getElementById('bmCarrierRow');
  if (!el) return;
  if (!_bmTypeFilter || _bmTypeFilter === 'general') {
    if (row) row.hidden = true;
    return;
  }
  const carriers = [...new Set(
    _bmRows.filter(r => r.carrier_type === _bmTypeFilter && r.carrier).map(r => r.carrier)
  )].sort();
  if (!carriers.length) { if (row) row.hidden = true; return; }
  if (row) row.hidden = false;
  el.innerHTML =
    `<button class="bm-chip${!_bmCarrierFilter ? ' is-active' : ''}" onclick='bmSetCarrier("")'>すべて</button>` +
    carriers.map(c =>
      `<button class="bm-chip${_bmCarrierFilter === c ? ' is-active' : ''}"
               onclick='bmSetCarrier(${JSON.stringify(c)})'>${escHtml(c)}</button>`
    ).join('');
}

function _bmRenderFnChips() {
  const el = document.getElementById('bmFnChips');
  if (!el) return;
  const fns = [...new Set(_bmRows.map(r => r.function).filter(Boolean))].sort();
  el.innerHTML =
    `<button class="bm-chip${!_bmFnFilter ? ' is-active' : ''}" onclick='bmSetFn("")'>すべての機能</button>` +
    fns.map(f =>
      `<button class="bm-chip bm-chip-fn${_bmFnFilter === f ? ' is-active' : ''}"
               onclick='bmSetFn(${JSON.stringify(f)})'>${escHtml(f)}</button>`
    ).join('');
}

// ---------- リスト描画 ----------
function _bmRenderList(rows) {
  const wrap = document.getElementById('bmListWrap');
  if (!wrap) return;
  if (!rows.length) {
    wrap.innerHTML = '<div class="bm-empty">該当するブックマークはありません</div>';
    return;
  }
  wrap.innerHTML = rows.map(r => {
    const tags = [
      r.carrier_type && r.carrier_type !== 'general'
        ? `<span class="bm-tag bm-tag-type">${escHtml(r.carrier_type)}</span>` : '',
      r.carrier
        ? `<span class="bm-tag bm-tag-carrier">${escHtml(r.carrier)}</span>` : '',
      r.function
        ? `<span class="bm-tag bm-tag-fn">${escHtml(r.function)}</span>` : '',
    ].filter(Boolean).join('');
    const nameEl = r.url
      ? `<a class="bm-card-name" href="${escHtml(r.url)}" target="_blank" rel="noopener">${escHtml(r.label)}</a>`
      : `<span class="bm-card-name bm-no-url">${escHtml(r.label)}</span>`;
    const noteEl = r.note
      ? `<div class="bm-card-note">${escHtml(r.note)}</div>` : '';
    return `<div class="bm-card">
      <div class="bm-card-row1">
        ${nameEl}
        <button class="bm-edit-btn" onclick="bmEdit('${escHtml(r.id)}')" title="編集">✎</button>
        <button class="bm-del-btn" onclick="bmDelete('${escHtml(r.id)}')" title="削除">🗑</button>
      </div>
      <div class="bm-card-tags">${tags}</div>
      ${noteEl}
    </div>`;
  }).join('');
}

// ---------- フィルター操作 ----------
function bmSetType(type) {
  _bmTypeFilter    = type;
  _bmCarrierFilter = '';
  _bmRenderTypeChips();
  _bmApply();
}

function bmSetCarrier(carrier) {
  _bmCarrierFilter = carrier;
  _bmApply();
}

function bmSetFn(fn) {
  _bmFnFilter = fn;
  _bmApply();
}

// ---------- 追加モーダル ----------
function _inferBmFunction(chipLabel) {
  const t = (chipLabel || '').replace(/\p{Emoji_Presentation}|\p{Emoji}️/gu, '').trim();
  if (t.includes('ローカルチャージ') || t.includes('Local Charge') || t.includes('ローカル')) {
    if (t.includes('輸入') || t.includes('import')) return 'ローカルチャージ（輸入）';
    return 'ローカルチャージ（輸出）';
  }
  if (t.includes('お知らせ') || t.includes('アナウンス') || t.includes('通知')) return 'お知らせ';
  if (t.includes('スケジュール') || t.includes('フライト')) return 'スケジュール';
  if (t.includes('追跡')) return 'コンテナ追跡';
  if (t.includes('CY')) return 'CY OPEN/CUT';
  if (t.includes('輸入')) return '輸入サーチャージ';
  if (t.includes('輸出')) return '輸出サーチャージ';
  if (t.includes('航路')) return '航路';
  if (t.includes('Booking') || t.includes('ブッキング')) return 'ブッキング';
  if (t.includes('料金') || t.includes('レート')) return 'レート';
  if (t.includes('AWB') || t.includes('書類')) return '書類';
  return '';
}

function _inferBmType() {
  const m = document.getElementById('cond-mode')?.value || '';
  if (m.includes('LCL')) return 'LCL';
  if (m.includes('FCL')) return 'FCL';
  if (m.includes('AIR')) return 'general';
  return 'FCL';
}

function openAddBmModal(presetData) {
  const modal = document.getElementById('bmAddModal');
  if (!modal) return;
  const p = presetData || {};
  const isEdit = !!p.id;
  const labelEl   = document.getElementById('bmFormLabel');
  const urlEl     = document.getElementById('bmFormUrl');
  const carrierEl = document.getElementById('bmFormCarrier');
  const noteEl    = document.getElementById('bmFormNote');
  const typeEl    = document.getElementById('bmFormType');
  const fnEl      = document.getElementById('bmFormFunction');
  const idEl      = document.getElementById('bmFormId');
  if (idEl)      idEl.value      = p.id      || '';
  if (labelEl)   labelEl.value   = p.label   || '';
  if (urlEl)     urlEl.value     = p.url     || '';
  if (noteEl)    noteEl.value    = p.note    || '';
  if (typeEl)    typeEl.value    = p.type    || (p.label ? _inferBmType() : 'FCL');
  // 編集モードは既存の function 値をそのまま使用、追加モードはチップラベルから推測
  if (fnEl)      fnEl.value      = isEdit ? (p.fn || '') : (p.fn ? (_inferBmFunction(p.fn) || '') : '');
  // QSP 経由の新規追加時のみ会社名フィールドをロック。編集時は常に編集可能
  const lockCarrier = !isEdit && !!p.carrier;
  if (carrierEl) {
    carrierEl.value    = p.carrier || '';
    carrierEl.readOnly = lockCarrier;
  }
  const carrierRow = document.getElementById('bmCarrierRow');
  const carrierNote = document.getElementById('bmCarrierNote');
  if (carrierRow)  carrierRow.classList.toggle('bm-carrier-locked', lockCarrier);
  if (carrierNote) carrierNote.style.display = lockCarrier ? '' : 'none';
  // モーダルタイトルを切り替え
  const titleEl = document.getElementById('bmModalTitle');
  if (titleEl) titleEl.textContent = isEdit ? '🔖 ブックマークを編集' : '🔖 ブックマークを追加';
  // datalist を既存データから補完（編集可能時のみ）
  if (!lockCarrier) {
    const dl = document.getElementById('bmCarrierDatalist');
    if (dl) {
      const carriers = [...new Set(_bmRows.map(r => r.carrier).filter(Boolean))].sort();
      dl.innerHTML = carriers.map(c => `<option value="${escHtml(c)}">`).join('');
    }
  }
  modal.classList.add('open');
  labelEl?.focus();
}

function closeAddBmModal(e) {
  if (e && e.target.id !== 'bmAddModal') return;
  document.getElementById('bmAddModal')?.classList.remove('open');
}

async function saveBm() {
  const db = window.SupabaseClient;
  if (!db) return;
  const id      = document.getElementById('bmFormId')?.value              || null;
  const label   = document.getElementById('bmFormLabel')?.value.trim();
  const url     = document.getElementById('bmFormUrl')?.value.trim()    || null;
  const type    = document.getElementById('bmFormType')?.value           || 'general';
  const carrier = document.getElementById('bmFormCarrier')?.value.trim() || null;
  const fn      = document.getElementById('bmFormFunction')?.value;
  const note    = document.getElementById('bmFormNote')?.value.trim()   || null;

  if (!label) { quoteShowToast('⚠️ ラベルを入力してください', 'warn'); return; }
  if (!fn)    { quoteShowToast('⚠️ 機能カテゴリを選択してください', 'warn'); return; }

  const btn = document.getElementById('bmSaveBtn');
  if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }

  const { data: sd } = await db.auth.getSession();
  let error;
  if (id) {
    // 編集（UPDATE）
    ({ error } = await db.from('bookmarks').update({
      label, url, carrier_type: type, carrier, function: fn, note,
    }).eq('id', id));
  } else {
    // 新規（INSERT）
    ({ error } = await db.from('bookmarks').insert({
      label, url, carrier_type: type, carrier, function: fn, note,
      created_by: sd?.session?.user?.email || null,
    }));
  }

  if (btn) { btn.disabled = false; btn.textContent = '保存'; }

  if (error) {
    quoteShowToast('⚠️ 保存エラー：' + error.message, 'warn', 6000);
    return;
  }
  quoteShowToast(id ? '✅ 更新しました' : '✅ ブックマークを追加しました', 'success', 3000);
  document.getElementById('bmAddModal')?.classList.remove('open');

  // A-2: ローカルキャッシュを即時更新して QSP チップを同期的に再描画
  if (id) {
    // 編集: キャッシュ内の同 ID エントリを新データで置換
    Object.keys(window._qspBmCache).forEach(name => {
      window._qspBmCache[name] = window._qspBmCache[name].map(b =>
        b.id === id ? { ...b, label, url, carrier, note } : b
      );
    });
  } else if (carrier && url) {
    // 追加: キャリアのキャッシュに即時追記
    if (!Array.isArray(window._qspBmCache[carrier])) window._qspBmCache[carrier] = [];
    const dup = window._qspBmCache[carrier].some(b => b.url === url && b.label === label);
    if (!dup) window._qspBmCache[carrier].push({ id: '_local_' + Date.now(), label, url, carrier, note });
  }
  if (typeof window.renderQuoteMilestones === 'function') window.renderQuoteMilestones();
  if (typeof window.lcRefreshBmChips      === 'function') window.lcRefreshBmChips();

  // A-1: バックグラウンドで Supabase から正確なデータを再同期
  if (carrier && typeof window.fetchCarrierBmsForQSP === 'function') {
    _qspBmLastKey = '';
    const targets = Object.keys(window._qspBmCache).length
      ? Object.keys(window._qspBmCache)
      : [carrier];
    window.fetchCarrierBmsForQSP(targets);
  }
  _bmLoad();
}

async function bmDelete(id) {
  if (!confirm('このブックマークを削除しますか？')) return;
  const db = window.SupabaseClient;
  if (!db) return;
  const { error } = await db.from('bookmarks').delete().eq('id', id);
  if (error) { quoteShowToast('⚠️ 削除エラー：' + error.message, 'warn'); return; }
  quoteShowToast('✅ 削除しました', 'success', 2000);
  _bmRows = _bmRows.filter(r => r.id !== id);
  _bmApply();
  if (typeof window.lcRefreshBmChips === 'function') window.lcRefreshBmChips();
}

function bmEdit(id) {
  const r = _bmRows.find(row => row.id === id);
  if (!r) return;
  openAddBmModal({
    id:      r.id,
    label:   r.label,
    url:     r.url     || '',
    type:    r.carrier_type || 'FCL',
    carrier: r.carrier  || '',
    fn:      r.function || '',
    note:    r.note     || '',
  });
}

// ---------- QSP 用キャリアブックマームフェッチ ----------
window.fetchCarrierBmsForQSP = async function (carrierNames) {
  if (!carrierNames || !carrierNames.length) return;
  const key = [...carrierNames].sort().join('\0');
  if (key === _qspBmLastKey) return;
  _qspBmLastKey = key;

  const db = window.SupabaseClient;
  if (!db) return;
  const { data: sd } = await db.auth.getSession();
  if (!sd?.session) return;

  const { data, error } = await db
    .from('bookmarks')
    .select('id, label, url, carrier, function, note')
    .in('carrier', carrierNames)
    .not('url', 'is', null);
  if (error) return;

  const cache = {};
  carrierNames.forEach(n => { cache[n] = []; });
  (data || []).forEach(bm => {
    if (bm.carrier && Object.prototype.hasOwnProperty.call(cache, bm.carrier)) {
      cache[bm.carrier].push(bm);
    }
  });
  window._qspBmCache = cache;
  if (typeof window.renderQuoteMilestones === 'function') window.renderQuoteMilestones();
};

// ---------- window 公開 ----------
window.initBookmarkTab = initBookmarkTab;
window.bmSetType       = bmSetType;
window.bmSetCarrier    = bmSetCarrier;
window.bmSetFn         = bmSetFn;
window.openAddBmModal  = openAddBmModal;
window.closeAddBmModal = closeAddBmModal;
window.saveBm          = saveBm;
window.bmDelete        = bmDelete;
window.bmEdit          = bmEdit;
