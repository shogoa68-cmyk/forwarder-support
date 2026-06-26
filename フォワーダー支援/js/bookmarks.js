// ========== 🔖 BOOKMARK（チーム共有ブックマーク） ==========

let _bmRows          = [];
let _bmTypeFilter    = '';
let _bmCarrierFilter = '';
let _bmFnFilter      = '';

// リンク確認（人による「確認済み」記録）
let _bmVerif   = {};   // { bookmark_id: [{ checked_by, checked_at }] }
let _bmProfile = {};   // { email: display_name }
let _bmMyEmail = '';

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
  const dedupBtn = document.getElementById('bmDedupBtn');
  if (dedupBtn) dedupBtn.hidden = !user;

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

  // リンク確認記録＋表示名を取得（テーブル未作成でもエラーは握りつぶして 0 件扱い）
  _bmMyEmail = user.email || '';
  const [vRes, pRes] = await Promise.all([
    db.from('bookmark_verifications').select('bookmark_id, checked_by, checked_at'),
    db.from('user_profiles').select('email, display_name'),
  ]);
  _bmVerif = {};
  (vRes.data || []).forEach(v => { (_bmVerif[v.bookmark_id] = _bmVerif[v.bookmark_id] || []).push(v); });
  _bmProfile = {};
  (pRes.data || []).forEach(p => { if (p.display_name) _bmProfile[p.email] = p.display_name; });

  _bmRenderTypeChips();
  _bmApply();
}

function _bmNameFor(email) {
  if (!email) return '不明';
  return _bmProfile[email] || email.split('@')[0];
}
function _bmVfmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
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
const _BM_TYPE_SUB = { FCL: 'FCL 船会社', LCL: 'LCL キャリア', AIR: 'AIR 航空', general: '汎用' };
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
    // キャリアタイルは種別をドロップダウン化（選ぶとそのキャリアの全リンクを一括再設定）。
    // 「汎用」グループ（会社名なし）は静的ラベルのまま。
    const typeMeta = name === '汎用'
      ? `<div class="bm-tsub">${escHtml(sub)}</div>`
      : `<select class="bm-tsub bm-ttype" data-bm-carrier="${escHtml(name)}" onclick="event.stopPropagation()" title="このキャリアの全リンクの種別を変更">`
        + ['FCL', 'LCL', 'AIR', 'general'].map(tv =>
            `<option value="${tv}"${tv === type ? ' selected' : ''}>${escHtml(_BM_TYPE_SUB[tv] || tv)}</option>`
          ).join('')
        + `</select>`;
    const pills = list.map(r => {
      const ic   = _bmFnIcon(r.function);
      const txt  = escHtml(r.label || r.function || 'リンク');
      const lbl  = escHtml(r.label || '');
      const open = r.url
        ? `<a class="bm-pill" href="${escHtml(r.url)}" target="_blank" rel="noopener" title="${lbl}">`
        : `<span class="bm-pill bm-pill-nourl" title="${lbl}">`;
      const close = r.url ? '</a>' : '</span>';
      // メモ有りピルには 💬 マーカー（ホバーで装飾ツールチップ／body 直付け）
      const noteMark = r.note
        ? `<span class="bm-pill-note bm-tip" data-tip="${escHtml(r.note)}">💬</span>`
        : '';
      // リンク確認バッジ（✓＋確認人数）。クリックで自分の確認を追加/取消、ホバーで確認者一覧
      const vlist  = _bmVerif[r.id] || [];
      const vcount = vlist.length;
      const mine   = vlist.some(v => v.checked_by === _bmMyEmail);
      const vcls   = vcount === 0 ? 'bm-verify-0' : (vcount >= 2 ? 'bm-verify-2' : 'bm-verify-1');
      const vtip   = vcount
        ? vlist.map(v => `✓ ${_bmNameFor(v.checked_by)}（${_bmVfmtDate(v.checked_at)}）`).join('\n')
          + '\n\n' + (mine ? 'クリックで自分の確認を取消' : 'クリックで「確認済み」に追加')
        : 'まだ確認されていません\nクリックで「確認済み」にできます';
      const verifyBadge = `<span class="bm-verify ${vcls}${mine ? ' bm-verify-mine' : ''} bm-tip" data-tip="${escHtml(vtip)}" onclick="event.preventDefault();event.stopPropagation();bmToggleVerify('${escHtml(r.id)}')">✓${vcount || ''}</span>`;
      return open
        + `<span class="bm-pill-ic">${ic}</span>${txt}${verifyBadge}${noteMark}`
        + `<span class="bm-pill-edit" onclick="event.preventDefault();event.stopPropagation();bmEdit('${escHtml(r.id)}')" title="編集">✎</span>`
        + `<span class="bm-pill-del" onclick="event.preventDefault();event.stopPropagation();bmDelete('${escHtml(r.id)}')" title="削除">🗑</span>`
        + close;
    }).join('');
    return `<div class="bm-tile${isCol ? ' collapsed' : ''}" style="--cc:${cc}">
      <div class="bm-thead" data-bm-tile="${escHtml(name)}">
        <div class="bm-tlogo">${escHtml(_bmCarrierAbbr(name))}</div>
        <div class="bm-tmeta"><div class="bm-tname">${escHtml(name)}</div>${typeMeta}</div>
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
  // タイル見出しの種別ドロップダウン変更 → そのキャリアの全リンクを一括再設定
  document.addEventListener('change', e => {
    const sel = e.target.closest('#bmListWrap .bm-ttype');
    if (sel) bmRetypeCarrier(sel.dataset.bmCarrier, sel.value);
  });
}

// メモのホバーツールチップ。タイルは overflow:hidden のため body 直付けで切れないようにし、
// ホバー即・装飾付きで表示する（ネイティブ title の遅延を回避）。
function _bmNoteTipEl() {
  let t = document.getElementById('bmNoteTip');
  if (!t) {
    t = document.createElement('div');
    t.id = 'bmNoteTip';
    t.className = 'bm-note-tip';
    document.body.appendChild(t);
  }
  return t;
}
function _bmShowNoteTip(target) {
  const note = target.dataset.tip;
  if (!note) return;
  const t = _bmNoteTipEl();
  t.textContent = note;
  t.style.display = 'block';
  const r  = target.getBoundingClientRect();
  const tw = t.offsetWidth, th = t.offsetHeight;
  let left = r.left + r.width / 2 - tw / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
  let top = r.top - th - 8;
  if (top < 8) top = r.bottom + 8;   // 上に入らなければ下に出す
  t.style.left = left + 'px';
  t.style.top  = top  + 'px';
}
function _bmHideNoteTip() {
  const t = document.getElementById('bmNoteTip');
  if (t) t.style.display = 'none';
}
if (!window._bmNoteTipDelegated) {
  window._bmNoteTipDelegated = true;
  document.addEventListener('mouseover', e => {
    const m = e.target.closest('#bmListWrap .bm-tip');
    if (m) _bmShowNoteTip(m);
  });
  document.addEventListener('mouseout', e => {
    if (e.target.closest('#bmListWrap .bm-tip')) _bmHideNoteTip();
  });
  document.addEventListener('scroll', _bmHideNoteTip, true);
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
  // 会社名は任意だが、見積タブのチップ連動メリットを常に示して入力を促す（方針B）
  if (carrierNote) carrierNote.style.display = '';
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
    // URL を変更した場合、過去の「確認済み」記録は無効化（リンク先が変わったため）
    if (!error) {
      const oldRow = _bmRows.find(r => r.id === id);
      if (oldRow && (oldRow.url || '') !== (url || '')) {
        await db.from('bookmark_verifications').delete().eq('bookmark_id', id);
      }
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

// タイル見出しから、そのキャリアの全ブックマークの種別（carrier_type）を一括変更する。
// 誤った種別（例：LCL キャリアを FCL に設定）を後から戻せるようにするための機能。
async function bmRetypeCarrier(carrier, newType) {
  const db = window.SupabaseClient;
  if (!db || !carrier) return;
  const targets = _bmRows.filter(r => (r.carrier || '') === carrier);
  if (!targets.length) return;
  if (targets[0].carrier_type === newType) return;   // 変化なし
  const labelMap = { FCL: 'FCL 船会社', LCL: 'LCL キャリア', AIR: 'AIR 航空', general: '汎用' };
  if (!confirm(`「${carrier}」の ${targets.length} 件すべての種別を「${labelMap[newType] || newType}」に変更しますか？`)) {
    _bmApply();   // キャンセル時はドロップダウンの表示を元に戻す
    return;
  }
  const { data, error } = await db.from('bookmarks')
    .update({ carrier_type: newType }).eq('carrier', carrier).select();
  if (error) {
    quoteShowToast('⚠️ 種別の変更に失敗：' + error.message, 'warn', 6000);
    _bmApply();
    return;
  }
  if (!data || !data.length) {
    quoteShowToast('⚠️ 変更されませんでした（権限不足の可能性）', 'warn', 7000);
    _bmApply();
    return;
  }
  _bmRows.forEach(r => { if ((r.carrier || '') === carrier) r.carrier_type = newType; });
  quoteShowToast(`✅ 「${carrier}」の種別を変更しました（${data.length}件）`, 'success', 3000);
  _bmApply();
  if (typeof window.lcRefreshBmChips === 'function') window.lcRefreshBmChips();
}

// リンク確認バッジのクリック：自分の「確認済み」を追加 / 取消する。
async function bmToggleVerify(id) {
  const db = window.SupabaseClient;
  if (!db) return;
  if (!_bmMyEmail) { quoteShowToast('⚠️ 記録にはログインが必要です', 'warn'); return; }
  const list    = _bmVerif[id] || [];
  const mineIdx = list.findIndex(v => v.checked_by === _bmMyEmail);
  if (mineIdx >= 0) {
    // 取消
    const { error } = await db.from('bookmark_verifications')
      .delete().eq('bookmark_id', id).eq('checked_by', _bmMyEmail);
    if (error) { quoteShowToast('⚠️ 取消に失敗：' + error.message, 'warn', 6000); return; }
    list.splice(mineIdx, 1);
    _bmVerif[id] = list;
    quoteShowToast('確認を取り消しました', 'info', 2000);
  } else {
    // 追加
    const { data, error } = await db.from('bookmark_verifications')
      .insert({ bookmark_id: id, checked_by: _bmMyEmail }).select();
    if (error) {
      const msg = /bookmark_verifications|does not exist|relation/.test(error.message)
        ? '⚠️ 確認テーブル未作成です（docs/sql/bookmarks-verifications.sql を実行してください）'
        : '⚠️ 記録に失敗：' + error.message;
      quoteShowToast(msg, 'warn', 7000);
      return;
    }
    list.push((data && data[0]) || { bookmark_id: id, checked_by: _bmMyEmail, checked_at: new Date().toISOString() });
    _bmVerif[id] = list;
    quoteShowToast('✅ 「確認済み」に記録しました', 'success', 2500);
  }
  _bmHideNoteTip();
  _bmApply();
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

// ---------- 重複の統合・削除 ----------
// 同じキャリア＋URL（URL が無い場合はキャリア＋ラベル）を重複とみなしてグループ化し、
// 「1件を残して他を統合・削除」できるようにする。誤って二重登録した場合の整理用。
let _bmDupGroups = [];

function _bmDupKey(r) {
  const c = r.carrier || '';
  return r.url ? c + ' U:' + r.url.trim() : c + ' L:' + (r.label || '');
}

function _bmFindDuplicates() {
  const map = new Map();
  _bmRows.forEach(r => {
    const k = _bmDupKey(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  });
  return [...map.values()].filter(g => g.length > 1);
}

// 残す1件の既定（情報量が多い＝メモ有り・機能が未分類でない・ラベル有り。同点は作成が古い方）
function _bmKeeperId(group) {
  const score = r => (r.note ? 2 : 0) + (r.function && r.function !== '未分類' ? 1 : 0) + (r.label ? 1 : 0);
  let best = group[0];
  group.forEach(r => {
    const s = score(r), bs = score(best);
    if (s > bs || (s === bs && (r.created_at || '') < (best.created_at || ''))) best = r;
  });
  return best.id;
}

function openBmDedup() {
  const modal = document.getElementById('bmDedupModal');
  const list  = document.getElementById('bmDedupList');
  if (!modal || !list) return;
  modal.classList.add('open');
  _bmDupGroups = _bmFindDuplicates();
  if (!_bmDupGroups.length) {
    list.innerHTML = '<div class="bm-empty">重複は見つかりませんでした 🎉</div>';
    return;
  }
  list.innerHTML = _bmDupGroups.map((g, idx) => {
    const keepId  = _bmKeeperId(g);
    const carrier = g[0].carrier || '汎用';
    const head = g[0].url
      ? `<a href="${escHtml(g[0].url)}" target="_blank" rel="noopener">${escHtml(g[0].url)}</a>`
      : `<span>${escHtml(g[0].label || '(無題)')}</span>`;
    const rows = g.map(r => `
      <label class="bm-dup-item">
        <input type="radio" name="dedup-${idx}" value="${escHtml(r.id)}"${r.id === keepId ? ' checked' : ''}>
        <span class="bm-dup-fn">${escHtml(r.function || '未分類')}</span>
        <span class="bm-dup-label">${escHtml(r.label || '(無題)')}</span>
        ${r.note ? `<span class="bm-dup-note" title="${escHtml(r.note)}">💬</span>` : ''}
      </label>`).join('');
    return `<div class="bm-dup-group">
      <div class="bm-dup-head"><span class="bm-dup-carrier">${escHtml(carrier)}</span> ${head} <span class="bm-dup-count">${g.length}件</span></div>
      <div class="bm-dup-hint">残す1件を選択：</div>
      ${rows}
      <button class="bm-dup-merge" onclick="bmDedupMerge(${idx})">選択を残して他を統合・削除</button>
    </div>`;
  }).join('');
}

async function bmDedupMerge(idx) {
  const group = _bmDupGroups[idx];
  if (!group) return;
  const db = window.SupabaseClient;
  if (!db) return;
  const sel    = document.querySelector(`input[name="dedup-${idx}"]:checked`);
  const keepId = sel ? sel.value : _bmKeeperId(group);
  const keeper = group.find(r => r.id === keepId);
  const others = group.filter(r => r.id !== keepId);
  if (!keeper || !others.length) return;
  if (!confirm(`重複 ${others.length} 件を削除し、1件（${keeper.label || '(無題)'}）に統合します。よろしいですか？`)) return;

  // 統合：keeper の空フィールドを others から補完
  const patch = {};
  if (!keeper.note)                                       { const x = others.find(o => o.note); if (x) patch.note = x.note; }
  if (!keeper.function || keeper.function === '未分類')   { const x = others.find(o => o.function && o.function !== '未分類'); if (x) patch.function = x.function; }
  if (!keeper.url)                                        { const x = others.find(o => o.url); if (x) patch.url = x.url; }
  if (!keeper.label)                                      { const x = others.find(o => o.label); if (x) patch.label = x.label; }
  if (Object.keys(patch).length) {
    const { error } = await db.from('bookmarks').update(patch).eq('id', keepId).select();
    if (error) { quoteShowToast('⚠️ 統合(更新)に失敗：' + error.message, 'warn', 6000); return; }
    Object.assign(keeper, patch);
  }

  // 重複削除
  const ids = others.map(o => o.id);
  const { error: delErr } = await db.from('bookmarks').delete().in('id', ids);
  if (delErr) { quoteShowToast('⚠️ 削除に失敗：' + delErr.message, 'warn', 6000); return; }
  _bmRows = _bmRows.filter(r => !ids.includes(r.id));
  quoteShowToast(`✅ ${ids.length}件を統合・削除しました`, 'success', 3000);
  _bmApply();
  if (typeof window.lcRefreshBmChips === 'function') window.lcRefreshBmChips();
  openBmDedup();   // 残りの重複を再表示
}

function closeBmDedup(e) {
  if (e && e.target.id !== 'bmDedupModal') return;
  document.getElementById('bmDedupModal')?.classList.remove('open');
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
window.bmToggleVerify  = bmToggleVerify;
window.seedCarrierBookmarks = seedCarrierBookmarks;
window.openBmHistory   = openBmHistory;
window.closeBmHistory  = closeBmHistory;
window.openBmDedup     = openBmDedup;
window.closeBmDedup    = closeBmDedup;
window.bmDedupMerge    = bmDedupMerge;
