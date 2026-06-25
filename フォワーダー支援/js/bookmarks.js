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
  const seedBtn = document.getElementById('bmSeedBtn');
  if (seedBtn) seedBtn.hidden = !user;
  const histBtn = document.getElementById('bmHistBtn');
  if (histBtn) histBtn.hidden = !user;

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
    { key: 'AIR',     label: 'AIR 航空' },
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

// ---------- リスト描画（案C：キャリアタイル） ----------
// キャリアごとにタイル化し、リンクを機能アイコン付きピルで内側に配置。
// ヘッダーのクリックで折りたたみ、ピルのホバーで ✎/🗑、末尾の破線ピルでその会社へ追加。
const _BM_PALETTE = ['#2b7bb0','#0a7d4f','#9c5a3c','#1f7d8c','#264a8a','#6f5aa0','#a85a78','#3d6b8a','#7a5c2e','#4a7c59'];
const _bmColorMap = new Map();
let   _bmColorSeq = 0;
function _bmCarrierColor(name) {
  if (!name || name === '汎用') return '#7a6a52';
  if (!_bmColorMap.has(name)) { _bmColorMap.set(name, _BM_PALETTE[_bmColorSeq % _BM_PALETTE.length]); _bmColorSeq++; }
  return _bmColorMap.get(name);
}
function _bmCarrierAbbr(name) {
  if (!name || name === '汎用') return '汎用';
  const ascii = /^[\x00-\x7F]+$/.test(name);
  if (ascii) { const a = name.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase(); return a || name.slice(0, 3).toUpperCase(); }
  return name.slice(0, 3);
}
const _BM_TYPE_SUB = { FCL: 'FCL 船会社', LCL: 'LCL キャリア', general: '汎用' };
const _BM_FN_ICON = {
  'スケジュール':'📅','航路':'🛣️','コンテナ追跡':'📍','CY OPEN/CUT':'🗓️',
  'ローカルチャージ（輸出）':'💴','ローカルチャージ（輸入）':'💴',
  '輸出サーチャージ':'⚡','輸入サーチャージ':'⚡','ブッキング':'📦',
  'レート':'💱','書類':'📄','お知らせ':'📣',
};
function _bmFnIcon(fn) { return _BM_FN_ICON[fn] || '🔗'; }

const _bmCollapsed = new Set();
function _bmToggleTile(name) {
  if (_bmCollapsed.has(name)) _bmCollapsed.delete(name); else _bmCollapsed.add(name);
  _bmApply();
}

function _bmRenderList(rows) {
  const wrap = document.getElementById('bmListWrap');
  if (!wrap) return;
  if (!rows.length) {
    wrap.innerHTML = '<div class="bm-empty">該当するブックマークはありません</div>';
    return;
  }
  // キャリアでグループ化（carrier 空は「汎用」）
  const groups = {};
  rows.forEach(r => { const key = r.carrier || '汎用'; (groups[key] = groups[key] || []).push(r); });
  const names = Object.keys(groups).sort((a, b) => {
    if ((a === '汎用') !== (b === '汎用')) return a === '汎用' ? 1 : -1;
    return a.localeCompare(b, 'ja');
  });

  wrap.innerHTML = names.map(name => {
    const cc    = _bmCarrierColor(name);
    const isCol = _bmCollapsed.has(name);
    const list  = groups[name];
    const type  = list[0].carrier_type || (name === '汎用' ? 'general' : 'FCL');
    const sub   = _BM_TYPE_SUB[type] || '';
    const pills = list.map(r => {
      const ic   = _bmFnIcon(r.function);
      const txt  = escHtml(r.label || r.function || 'リンク');
      const open = r.url
        ? `<a class="bm-pill" href="${escHtml(r.url)}" target="_blank" rel="noopener" title="${escHtml(r.label || '')}">`
        : `<span class="bm-pill bm-pill-nourl" title="${escHtml(r.label || '')}">`;
      const close = r.url ? '</a>' : '</span>';
      return open
        + `<span class="bm-pill-ic">${ic}</span>${txt}`
        + `<span class="bm-pill-edit" onclick="event.preventDefault();event.stopPropagation();bmEdit('${escHtml(r.id)}')" title="編集">✎</span>`
        + `<span class="bm-pill-del" onclick="event.preventDefault();event.stopPropagation();bmDelete('${escHtml(r.id)}')" title="削除">🗑</span>`
        + close;
    }).join('');
    return `<div class="bm-tile${isCol ? ' collapsed' : ''}" style="--cc:${cc}">
      <div class="bm-thead" data-bm-tile="${escHtml(name)}">
        <div class="bm-tlogo">${escHtml(_bmCarrierAbbr(name))}</div>
        <div class="bm-tmeta"><div class="bm-tname">${escHtml(name)}</div><div class="bm-tsub">${escHtml(sub)}</div></div>
        <span class="bm-tcount">${list.length}</span>
        <span class="bm-ttog">${isCol ? '▸' : '▾'}</span>
      </div>
      <div class="bm-tbody">
        ${pills}
        <span class="bm-pill bm-pill-add" data-bm-add="${name === '汎用' ? '' : escHtml(name)}" data-bm-type="${escHtml(type)}">＋ 追加</span>
      </div>
    </div>`;
  }).join('');
}

// タイルヘッダー折りたたみ／追加ピルはイベント委譲で処理（動的なキャリア名のクオート問題を回避）
if (!window._bmTileDelegated) {
  window._bmTileDelegated = true;
  document.addEventListener('click', e => {
    const add = e.target.closest('#bmListWrap .bm-pill-add');
    if (add) { openAddBmModal({ carrier: add.dataset.bmAdd || '', type: add.dataset.bmType || 'FCL' }); return; }
    const head = e.target.closest('#bmListWrap .bm-thead');
    if (head && head.dataset.bmTile != null) { _bmToggleTile(head.dataset.bmTile); }
  });
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
  // 機能は任意。編集は既存値、追加はチップラベルから推測。いずれも未取得なら「未分類」を初期選択。
  if (fnEl)      fnEl.value      = isEdit ? (p.fn || '未分類') : (p.fn ? (_inferBmFunction(p.fn) || '未分類') : '未分類');
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
  // 機能カテゴリは任意。未選択は「未分類」で登録し、後から整理できるようにする。
  const fnVal = fn || '未分類';

  const btn = document.getElementById('bmSaveBtn');
  if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }

  const { data: sd } = await db.auth.getSession();
  let error;
  if (id) {
    // 編集（UPDATE）。.select() を付けて「実際に更新された行」を取得する。
    // RLS の UPDATE ポリシーが無い等で 0 行更新の場合、Supabase は error=null を返すため、
    // ここで行数を検査し「成功」と誤表示せず警告を出す。
    const res = await db.from('bookmarks').update({
      label, url, carrier_type: type, carrier, function: fnVal, note,
    }).eq('id', id).select();
    error = res.error;
    if (!error && (!res.data || res.data.length === 0)) {
      if (btn) { btn.disabled = false; btn.textContent = '保存'; }
      quoteShowToast('⚠️ 更新されませんでした（権限不足の可能性）。管理者に bookmarks の UPDATE ポリシーをご確認ください', 'warn', 8000);
      return;
    }
  } else {
    // 新規（INSERT）
    ({ error } = await db.from('bookmarks').insert({
      label, url, carrier_type: type, carrier, function: fnVal, note,
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

// ---------- 内蔵船会社リンクのシード（全面クラウド移行・フェーズ2） ----------
// data/carriers.js の内蔵DB（FCL/LCL/AIR）＋ CARRIER_LINK_DEFS を、
// 見積タブのチップと同じ変換（getCarrierLinkData 相当）で bookmarks 行へ展開する。
// 既存行（同 carrier + url）はスキップするので、重複投入しても安全（冪等）。
function _buildCarrierSeedRows() {
  const rows = [];
  // ラベル先頭の絵文字・記号を除去（'🗓 スケジュール' → 'スケジュール'）
  const clean = (s) => String(s || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
  // 文字列 or 関数 or null を URL に解決（conditions.js の _resolveCarrierUrl と同等）
  const resolve = (v) => {
    if (!v) return null;
    try { return typeof v === 'function' ? v() : v; } catch (e) { return null; }
  };
  const defs = (typeof CARRIER_LINK_DEFS !== 'undefined') ? CARRIER_LINK_DEFS : {};
  const sets = [
    { type: 'FCL', db: (typeof CARRIERS     !== 'undefined') ? CARRIERS     : null, defs: defs.fcl || [] },
    { type: 'LCL', db: (typeof CARRIERS_LCL !== 'undefined') ? CARRIERS_LCL : null, defs: defs.lcl || [] },
    { type: 'AIR', db: (typeof CARRIERS_AIR !== 'undefined') ? CARRIERS_AIR : null, defs: defs.air || [] },
  ];
  sets.forEach(({ type, db, defs }) => {
    if (!db) return;
    Object.keys(db).forEach((name) => {
      const c = db[name];
      defs.forEach((d) => {
        const url = resolve(c[d.key]);
        if (!url || typeof url !== 'string' || !/^https?:/i.test(url)) return;
        const cl = clean(d.label);
        // 機能カテゴリは編集モーダルの <select> 固定値に合わせる。推測できないものは「その他」
        const fn = _inferBmFunction(d.label) || 'その他';
        const note = (d.noteKey && c[d.noteKey]) ? c[d.noteKey] : null;
        rows.push({ label: `${name} ${cl}`.trim(), url, carrier_type: type, carrier: name, function: fn, note });
      });
    });
  });
  return rows;
}

async function seedCarrierBookmarks() {
  const db = window.SupabaseClient;
  if (!db) { quoteShowToast('⚠️ DB接続が未初期化です', 'warn'); return; }
  const { data: sd } = await db.auth.getSession();
  const email = sd?.session?.user?.email;
  if (!email) { quoteShowToast('⚠️ 取り込みにはログインが必要です', 'warn'); return; }

  const btn = document.getElementById('bmSeedBtn');
  if (btn) { btn.disabled = true; btn.textContent = '取り込み中…'; }
  const restore = () => { if (btn) { btn.disabled = false; btn.textContent = '🌱 内蔵リンク取込'; } };

  // 最新の既存行で重複判定（carrier + url）
  const { data: existing, error: e0 } = await db.from('bookmarks').select('carrier,url');
  if (e0) { quoteShowToast('⚠️ 既存取得エラー：' + e0.message, 'warn', 6000); restore(); return; }
  const seen = new Set((existing || []).map((r) => (r.carrier || '') + ' ' + (r.url || '')));

  const all = _buildCarrierSeedRows();
  const within = new Set();
  const fresh = [];
  all.forEach((r) => {
    const k = (r.carrier || '') + ' ' + (r.url || '');
    if (seen.has(k) || within.has(k)) return;
    within.add(k);
    fresh.push(r);
  });

  if (!fresh.length) {
    quoteShowToast('✅ すべて取り込み済みです（新規リンクなし）', 'info', 4000);
    restore();
    return;
  }
  const ok = confirm(
    `内蔵の船会社リンク ${all.length} 件のうち、未登録の ${fresh.length} 件をチーム共有ブックマークに取り込みます。\n` +
    `（既存と重複する ${all.length - fresh.length} 件はスキップ）\n\n取り込みますか？`
  );
  if (!ok) { restore(); return; }

  const payload = fresh.map((r) => ({ ...r, created_by: email }));
  let inserted = 0, failed = 0;
  for (let i = 0; i < payload.length; i += 100) {
    const chunk = payload.slice(i, i + 100);
    const { error } = await db.from('bookmarks').insert(chunk);
    if (error) { failed += chunk.length; } else { inserted += chunk.length; }
  }
  restore();
  quoteShowToast(
    `🌱 取り込み完了：${inserted} 件を追加${failed ? `（失敗 ${failed} 件）` : ''}`,
    failed ? 'warn' : 'success', 6000
  );
  _bmLoad();
}

// ---------- 変更履歴ビュー（フェーズ4） ----------
// bookmark_history（フェーズ1の自動記録トリガー）を新しい順に表示。
const _BM_HIST_FIELDS = [
  { k: 'label',        n: 'ラベル' },
  { k: 'url',          n: 'URL' },
  { k: 'carrier',      n: '会社名' },
  { k: 'carrier_type', n: '種別' },
  { k: 'function',     n: '機能' },
  { k: 'note',         n: 'メモ' },
];

function _bmFmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d)) return escHtml(String(ts));
  return d.toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function _bmHistDiff(oldData, newData) {
  const o = oldData || {}, n = newData || {};
  const parts = [];
  _BM_HIST_FIELDS.forEach(({ k, n: name }) => {
    const ov = o[k] == null ? '' : String(o[k]);
    const nv = n[k] == null ? '' : String(n[k]);
    if (ov === nv) return;
    parts.push(
      `<div class="bm-hist-field"><span class="bm-hist-fname">${name}</span>` +
      `<span class="bm-hist-old">${ov ? escHtml(ov) : '（空）'}</span>` +
      `<span class="bm-hist-arrow">→</span>` +
      `<span class="bm-hist-new">${nv ? escHtml(nv) : '（空）'}</span></div>`
    );
  });
  return parts.join('');
}

async function openBmHistory() {
  const modal = document.getElementById('bmHistModal');
  const list  = document.getElementById('bmHistList');
  if (!modal || !list) return;
  modal.classList.add('open');
  list.innerHTML = '<div class="bm-empty">読み込み中…</div>';

  const db = window.SupabaseClient;
  if (!db) { list.innerHTML = '<div class="bm-empty">⚠️ DB接続が未初期化です</div>'; return; }
  const { data, error } = await db
    .from('bookmark_history')
    .select('*')
    .order('changed_at', { ascending: false })
    .limit(200);
  if (error) {
    list.innerHTML = '<div class="bm-empty">⚠️ 取得エラー：' + escHtml(error.message) +
      '<br><small>（履歴テーブル未作成の場合は docs/sql/bookmarks-migration.sql を実行してください）</small></div>';
    return;
  }
  if (!data || !data.length) {
    list.innerHTML = '<div class="bm-empty">変更履歴はまだありません</div>';
    return;
  }

  const ACT = {
    INSERT: { cls: 'ins', label: '追加' },
    UPDATE: { cls: 'upd', label: '更新' },
    DELETE: { cls: 'del', label: '削除' },
  };
  list.innerHTML = data.map((h) => {
    const a = ACT[h.action] || { cls: '', label: h.action || '' };
    const snap = h.new_data || h.old_data || {};
    const title = snap.label || '(無題)';
    const meta = [snap.carrier, snap.function].filter(Boolean).join('・');
    let body = '';
    if (h.action === 'UPDATE') {
      body = _bmHistDiff(h.old_data, h.new_data) || '<div class="bm-hist-field bm-hist-nodiff">（表示対象の変更なし）</div>';
    } else if (h.action === 'INSERT') {
      body = snap.url ? `<div class="bm-hist-field"><span class="bm-hist-new">${escHtml(snap.url)}</span></div>` : '';
    } else if (h.action === 'DELETE') {
      body = snap.url ? `<div class="bm-hist-field"><span class="bm-hist-old">${escHtml(snap.url)}</span></div>` : '';
    }
    return `<div class="bm-hist-item">
      <div class="bm-hist-row1">
        <span class="bm-hist-act bm-hist-act-${a.cls}">${a.label}</span>
        <span class="bm-hist-title">${escHtml(title)}</span>
        ${meta ? `<span class="bm-hist-meta">${escHtml(meta)}</span>` : ''}
      </div>
      <div class="bm-hist-row2">
        <span class="bm-hist-who">${escHtml(h.changed_by || '不明')}</span>
        <span class="bm-hist-when">${_bmFmtTime(h.changed_at)}</span>
      </div>
      ${body ? `<div class="bm-hist-body">${body}</div>` : ''}
    </div>`;
  }).join('');
}

function closeBmHistory(e) {
  if (e && e.target.id !== 'bmHistModal') return;
  document.getElementById('bmHistModal')?.classList.remove('open');
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
    .select('id, label, url, carrier, carrier_type, function, note')
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
window.seedCarrierBookmarks = seedCarrierBookmarks;
window.openBmHistory   = openBmHistory;
window.closeBmHistory  = closeBmHistory;
