// ========== 🔖 BOOKMARK（チーム共有ブックマーク） ==========

let _bmRows          = [];
let _bmTypeFilter    = '';
let _bmCarrierFilter = '';
let _bmFnFilter      = '';

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
             onclick="bmSetType(${JSON.stringify(t.key)})">${t.label}</button>`
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
    `<button class="bm-chip${!_bmCarrierFilter ? ' is-active' : ''}" onclick="bmSetCarrier('')">すべて</button>` +
    carriers.map(c =>
      `<button class="bm-chip${_bmCarrierFilter === c ? ' is-active' : ''}"
               onclick="bmSetCarrier(${JSON.stringify(c)})">${escHtml(c)}</button>`
    ).join('');
}

function _bmRenderFnChips() {
  const el = document.getElementById('bmFnChips');
  if (!el) return;
  const fns = [...new Set(_bmRows.map(r => r.function).filter(Boolean))].sort();
  el.innerHTML =
    `<button class="bm-chip${!_bmFnFilter ? ' is-active' : ''}" onclick="bmSetFn('')">すべての機能</button>` +
    fns.map(f =>
      `<button class="bm-chip bm-chip-fn${_bmFnFilter === f ? ' is-active' : ''}"
               onclick="bmSetFn(${JSON.stringify(f)})">${escHtml(f)}</button>`
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
function openAddBmModal() {
  const modal = document.getElementById('bmAddModal');
  if (!modal) return;
  ['bmFormLabel', 'bmFormUrl', 'bmFormCarrier', 'bmFormNote'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const typeEl = document.getElementById('bmFormType');
  const fnEl   = document.getElementById('bmFormFunction');
  if (typeEl) typeEl.value = 'FCL';
  if (fnEl)   fnEl.value   = '';
  // datalist を既存データから補完
  const dl = document.getElementById('bmCarrierDatalist');
  if (dl) {
    const carriers = [...new Set(_bmRows.map(r => r.carrier).filter(Boolean))].sort();
    dl.innerHTML = carriers.map(c => `<option value="${escHtml(c)}">`).join('');
  }
  modal.classList.add('open');
  document.getElementById('bmFormLabel')?.focus();
}

function closeAddBmModal(e) {
  if (e && e.target.id !== 'bmAddModal') return;
  document.getElementById('bmAddModal')?.classList.remove('open');
}

async function saveBm() {
  const db = window.SupabaseClient;
  if (!db) return;
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
  const { error } = await db.from('bookmarks').insert({
    label, url,
    carrier_type: type,
    carrier,
    function: fn,
    note,
    created_by: sd?.session?.user?.email || null,
  });

  if (btn) { btn.disabled = false; btn.textContent = '保存'; }

  if (error) {
    quoteShowToast('⚠️ 保存エラー：' + error.message, 'warn', 6000);
    return;
  }
  quoteShowToast('✅ ブックマークを追加しました', 'success', 3000);
  document.getElementById('bmAddModal')?.classList.remove('open');
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
}

// ---------- window 公開 ----------
window.initBookmarkTab = initBookmarkTab;
window.bmSetType       = bmSetType;
window.bmSetCarrier    = bmSetCarrier;
window.bmSetFn         = bmSetFn;
window.openAddBmModal  = openAddBmModal;
window.closeAddBmModal = closeAddBmModal;
window.saveBm          = saveBm;
window.bmDelete        = bmDelete;
