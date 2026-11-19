// ========== 類似見積サジェスト（案C：スコアリング＋インライン検索）==========

let _sqTimer       = null;
let _sqSearchTimer = null;
let _sqPreviewId   = null;
let _sqCollapsed   = false;
let _sqSearchOpen  = false;
let _sqAllResults  = [];  // auto-fetch の全候補
let _sqShowCount   = 5;   // 現在の表示件数

// 🔗 関連付けた案件（コピーではない手動リンク・常に双方向）
let _sqLinks           = [];   // 現在開いている案件の関連リンク一覧（cloudFetchPresetLinks の結果）
let _sqLinkSearchOpen  = false;
let _sqLinkSearchTimer = null;
let _sqLinkResults     = [];   // 直近のリンク検索結果（理由バーで名前を引き当てるため）
let _sqPendingLinkId   = null; // 理由入力待ちの関連付け先ID
let _sqEditNoteFor     = null; // 理由を編集中の linkId

// スコア重み（合計最大 15）
const _SQ_W = { mode: 4, inco: 3, pol: 3, pod: 3, customer: 2 };
const _SQ_MAX = 15;

function initSimilarQuotes() {
  // 2026-11：入力のたびに自動で候補を出す動きはやめ、「類似の案件を探す」を押したときだけ検索する
}

function _sqGetParams() {
  return {
    inco:     (document.getElementById('cond-incoterms')?.value || '').trim(),
    mode:     (document.getElementById('cond-mode')?.value      || '').trim(),
    pol:      (document.getElementById('z2Pol')?.value          || '').trim(),
    pod:      (document.getElementById('z2Pod')?.value          || '').trim(),
    customer: (document.getElementById('qf-customer')?.value    || '').trim(),
  };
}

async function _sqFetch() {
  const panel = document.getElementById('sqPanel');
  if (!panel) return;
  await _sqFetchLinks();
  const loadedId = typeof window.quoteCloudLoadedId === 'function' ? window.quoteCloudLoadedId() : null;
  panel.hidden = false;
  if (!loadedId && !_sqLinks.length && !_sqSearching) { /* 新規案件でも探せるよう入口は常に出す */ }
  _sqRenderPanel();
}

// 状態：入口カード（_sqSearching=false）／検索画面（true）
let _sqSearching = false;
let _sqSearched  = false;                 // 「探す」を押したか（押すまで結果は出さない）
let _sqForm = { q: '', ref: '', pol: '', pod: '', mode: '', st: '' };

function _sqRenderPanel() {
  const panel = document.getElementById('sqPanel');
  if (!panel) return;
  panel.hidden = false;
  panel.classList.toggle('sq-panel--collapsed', false);
  panel.innerHTML = _sqLinksHtml() + (_sqSearching ? _sqSearchHtml() : _sqIntroHtml());
  if (_sqSearching && _sqSearched) _sqListRender(_sqAllResults.slice(0, _sqShowCount), _sqAllResults.length);
}

function _sqIntroHtml() {
  return `<button type="button" class="sq-intro" onclick="sqStartSearch()">
    <span class="sq-intro-ico" aria-hidden="true">🔍</span>
    <b>似ている案件を探す</b>
    <small>過去の案件から、お客様・積み港・揚げ港・モードで探します。見つけた案件はプレビューで中身を確認でき、行を追加できます</small>
  </button>`;
}

function _sqSearchHtml() {
  const f = _sqForm;
  const chip = (cls, key, val, label) =>
    `<button type="button" class="${cls}${f[key] === val ? ' is-on' : ''}" data-${key === 'mode' ? 'mode' : 'status'}="${escHtml(val)}" onclick="${key === 'mode' ? 'sqModeFilter' : 'sqStatusFilter'}(this)">${label}</button>`;
  return `<div class="sq-head"><span class="sq-head-main"><span class="sq-head-title">🔍 似ている案件を探す</span></span>
      <button type="button" class="sq-search-toggle" onclick="sqBackToIntro()" title="閉じる">✕</button></div>
    <div class="sq-search-bar">
      <div class="sq-search-row"><input id="sqSearchText" class="sq-search-input" placeholder="お客様名・見積名" value="${escHtml(f.q)}" oninput="sqFormInput(this)" onkeydown="if(event.key==='Enter'&&!event.isComposing)sqDoSearch()"></div>
      <div class="sq-search-row"><input id="sqSearchRef" class="sq-search-input" placeholder="見積もり番号（例：05-2606100-02）" value="${escHtml(f.ref)}" oninput="sqFormInput(this)" onkeydown="if(event.key==='Enter'&&!event.isComposing)sqDoSearch()"></div>
      <div class="sq-search-row sq-search-row-2col">
        <input id="sqSearchPol" class="sq-search-input" placeholder="POL（積み港）" value="${escHtml(f.pol)}" oninput="sqFormInput(this)" onkeydown="if(event.key==='Enter'&&!event.isComposing)sqDoSearch()">
        <input id="sqSearchPod" class="sq-search-input" placeholder="POD（揚げ港）" value="${escHtml(f.pod)}" oninput="sqFormInput(this)" onkeydown="if(event.key==='Enter'&&!event.isComposing)sqDoSearch()">
      </div>
      <div class="sq-search-row sq-status-row"><span class="sq-search-label">輸送モード</span>
        ${chip('sq-mode-chip', 'mode', '', 'すべて')}${chip('sq-mode-chip', 'mode', '海上（FCL）', 'FCL')}${chip('sq-mode-chip', 'mode', '海上（LCL）', 'LCL')}${chip('sq-mode-chip', 'mode', '航空（AIR）', 'AIR')}
      </div>
      <div class="sq-search-row sq-status-row"><span class="sq-search-label">状態</span>
        ${chip('sq-status-chip', 'st', '', 'すべて')}${chip('sq-status-chip', 'st', '提示済み', '提示済み')}${chip('sq-status-chip', 'st', '受注', '受注')}${chip('sq-status-chip', 'st', '失注', '失注')}
      </div>
      <div class="sq-search-row sq-go-row">
        <button type="button" class="sq-go-btn" onclick="sqDoSearch()">🔍 探す</button>
        <button type="button" class="sq-clear-btn" onclick="sqClearSearch()">条件をクリア</button>
      </div>
    </div>
    <div class="sq-list">${_sqSearched ? '' : '<div class="sq-empty-msg">条件を入れて「探す」を押してください（条件なしでも新しい順に探せます）</div>'}</div>`;
}

// 入口カードを押す：いま開いている見積の条件を初期値に入れて検索画面へ
function sqStartSearch() {
  const p = _sqGetParams();
  _sqForm = { q: p.customer, ref: '', pol: p.pol, pod: p.pod, mode: p.mode, st: '' };
  if (!/^(海上（FCL）|海上（LCL）|航空（AIR）)$/.test(_sqForm.mode)) _sqForm.mode = '';
  _sqSearching = true; _sqSearched = false; _sqAllResults = [];
  _sqRenderPanel();
  document.getElementById('sqSearchText')?.focus();
}
function sqBackToIntro() { _sqSearching = false; _sqSearched = false; _sqRenderPanel(); }
function sqClearSearch() {
  _sqForm = { q: '', ref: '', pol: '', pod: '', mode: '', st: '' };
  _sqSearched = false; _sqAllResults = [];
  _sqRenderPanel();
}
function sqFormInput(el) {
  const m = { sqSearchText: 'q', sqSearchRef: 'ref', sqSearchPol: 'pol', sqSearchPod: 'pod' };
  if (m[el.id]) _sqForm[m[el.id]] = el.value;
}

// 代表名と別名（多すぎると検索条件が長くなるため上限あり）
function _sqVariants(field, v) {
  const list = typeof window.nameVariants === 'function' ? window.nameVariants(field, v) : [v];
  return list.filter(Boolean).slice(0, 6);
}
// 部分一致（従来どおり）に加え、別名・表記ゆれも同じとみなす
function _sqMatch(field, rv, pv) {
  if (!rv || !pv) return false;
  const ci = v => (v || '').toLowerCase();
  if (_sqVariants(field, pv).some(v => ci(rv).includes(ci(v)))) return true;
  return typeof window.nameSame === 'function' && window.nameSame(field, rv, pv);
}

function _sqScore(r, p) {
  let s = 0;
  const ci = v => (v || '').toLowerCase();
  if (p.mode     && ci(r.transport_mode) === ci(p.mode))           s += _SQ_W.mode;
  if (p.inco     && ci(r.incoterms)      === ci(p.inco))           s += _SQ_W.inco;
  if (p.pol      && _sqMatch('port', r.pol, p.pol))                s += _SQ_W.pol;
  if (p.pod      && _sqMatch('port', r.pod, p.pod))                s += _SQ_W.pod;
  if (p.customer && _sqMatch('customer', r.customer, p.customer))  s += _SQ_W.customer;
  return s;
}

// ---- 🔗 関連付けた案件（コピーではない手動リンク・常に双方向）-------------
async function _sqFetchLinks() {
  const id = typeof window.quoteCloudLoadedId === 'function' ? window.quoteCloudLoadedId() : null;
  if (!id || typeof window.cloudFetchPresetLinks !== 'function') { _sqLinks = []; return; }
  _sqLinks = await window.cloudFetchPresetLinks(id);
}

// 位置づけ（基準の案件から見た相手：関連／サブ／メイン）の選択。基準 anchorId は、編集中の案件か、ツリー内の親ノード
function _sqRoleSelectHtml(linkId, anchorId, cur) {
  const opt = (v, label) => `<option value="${v}"${cur === v ? ' selected' : ''}>${label}</option>`;
  return `<select class="sq-link-role" onclick="event.stopPropagation()" title="位置づけを変える（基準の案件から見た相手）" ` +
    `onchange="sqSetLinkRole('${escHtml(linkId)}','${escHtml(anchorId)}',this.value)">` +
    opt('none', '🔗 関連') + opt('sub', '🌱 サブ') + opt('main', '👑 メイン') + `</select>`;
}

// 1 件ぶんのカード（プレビュー・位置づけ・解除・理由）。node＝{linkId, note, preset:{…}} か、ツリーのノード（メタを直接持つ）
function _sqLinkItemHtml(node, anchorId, curRole) {
  const pr = node.preset || node;
  const badge = _sqStatusBadge(pr.status);
  const ref = pr.ref ? `<span class="sq-ref">${escHtml(pr.ref)}</span>` : '';
  const cust = pr.customer ? `<span class="sq-cust">${escHtml(pr.customer)}</span>` : '';
  const editing = _sqEditNoteFor === node.linkId;
  const noteBlock = editing
    ? `<div class="sq-link-note-edit" onclick="event.stopPropagation()">
         <input id="sqLinkNoteInput" class="sq-search-input" value="${escHtml(node.note || '')}" placeholder="関連付けの理由（例：多レグ分割の相方／代替案）"
           onkeydown="if(event.key==='Enter'){event.preventDefault();sqSaveLinkNote('${escHtml(node.linkId)}');}">
         <button type="button" class="sq-links-add-btn" onclick="event.stopPropagation();sqSaveLinkNote('${escHtml(node.linkId)}')">保存</button>
         <button type="button" class="sq-link-note-cancel" onclick="event.stopPropagation();sqCancelEditNote()">✕</button>
       </div>`
    : (node.note
        ? `<div class="sq-link-note" onclick="event.stopPropagation();sqEditLinkNote('${escHtml(node.linkId)}')" title="クリックで理由を編集">📝 ${escHtml(node.note)}</div>`
        : `<button type="button" class="sq-link-note-add" onclick="event.stopPropagation();sqEditLinkNote('${escHtml(node.linkId)}')">＋ 理由を追加</button>`);
  return `<div class="sq-link-item" onclick="sqOpenPreview('${escHtml(pr.id)}')">
      <div class="sq-link-item-top">
        <span class="sq-link-name">${escHtml(pr.name || '（無題）')}</span>${badge}
        ${_sqRoleSelectHtml(node.linkId, anchorId, curRole)}
        <button type="button" class="sq-link-unlink" onclick="event.stopPropagation();sqUnlinkPreset('${escHtml(node.linkId)}')" title="関連付けを解除">✕</button>
      </div>
      <div class="sq-card-sub">${ref}${cust}</div>
      ${noteBlock}
    </div>`;
}

// サブ案件ツリーの 1 ノード（入れ子）。anchorId＝このノードの親（メイン）の案件
function _sqTreeNodeHtml(node, anchorId) {
  const kids = (node.kids && node.kids.length)
    ? `<ul class="sq-link-tree">${node.kids.map(k => _sqTreeNodeHtml(k, node.id)).join('')}</ul>` : '';
  return `<li class="sq-link-tree-node">${_sqLinkItemHtml(node, anchorId, 'sub')}${kids}</li>`;
}
function _sqTreeCount(kids) { return (kids || []).reduce((n, k) => n + 1 + _sqTreeCount(k.kids), 0); }

function _sqLinksHtml() {
  const loadedId = typeof window.quoteCloudLoadedId === 'function' ? window.quoteCloudLoadedId() : null;
  if (!loadedId) return '';
  const parents = _sqLinks.filter(l => l.rel === 'parent');
  const kids    = _sqLinks.filter(l => l.rel === 'child');
  const peers   = _sqLinks.filter(l => l.rel !== 'parent' && l.rel !== 'child');
  const subTotal = kids.reduce((n, l) => n + 1 + _sqTreeCount(l.kids), 0);
  const hier = parents.length || kids.length;
  const group = (title, body) => `<div class="sq-links-group"><div class="sq-links-group-title">${title}</div>${body}</div>`;
  let items = '';
  if (parents.length) {
    items += group('👑 この案件のメイン', parents.map(l => _sqLinkItemHtml(l, loadedId, 'main')).join(''));
  }
  if (kids.length) {
    items += group(`🌳 サブ案件（${subTotal}）`,
      `<ul class="sq-link-tree sq-link-tree--root">${kids.map(l =>
        `<li class="sq-link-tree-node">${_sqLinkItemHtml(l, loadedId, 'sub')}` +
        (l.kids && l.kids.length ? `<ul class="sq-link-tree">${l.kids.map(k => _sqTreeNodeHtml(k, l.otherId)).join('')}</ul>` : '') +
        `</li>`).join('')}</ul>`);
  }
  if (peers.length) {
    const body = peers.map(l => _sqLinkItemHtml(l, loadedId, 'none')).join('');
    items += hier ? group(`🔗 関連案件（${peers.length}）`, body) : body;
  }
  return `<div class="sq-links-section">
    <div class="sq-links-head">
      <span class="sq-links-title">🔗 関連付けた案件${_sqLinks.length ? '（' + _sqLinks.length + '）' : ''}</span>
      <button type="button" class="sq-links-add-btn" onclick="sqToggleLinkSearch()" title="他の案件をこの案件に関連付ける（メイン／サブにもできます）">＋ 関連付け</button>
    </div>
    <div class="sq-link-search-bar" id="sqLinkSearchBar" ${_sqLinkSearchOpen ? '' : 'hidden'}>
      <input id="sqLinkSearchInput" class="sq-search-input" placeholder="見積名・見積もり番号・顧客名で検索" oninput="sqScheduleLinkSearch()">
      <div class="sq-link-search-results" id="sqLinkSearchResults"></div>
    </div>
    <div class="sq-links-list">${items || '<div class="sq-links-empty">関連付けた案件はまだありません</div>'}</div>
  </div>`;
}

// 位置づけ（関連／サブ／メイン）の変更。失敗しても選択肢の見た目を実際の状態に戻すため、描き直す
async function sqSetLinkRole(linkId, anchorId, role) {
  if (typeof window.cloudSetLinkRole === 'function') await window.cloudSetLinkRole(linkId, anchorId, role);
  await _sqFetch();
}

function sqToggleLinkSearch() {
  _sqLinkSearchOpen = !_sqLinkSearchOpen;
  const bar = document.getElementById('sqLinkSearchBar');
  if (bar) bar.hidden = !_sqLinkSearchOpen;
  if (_sqLinkSearchOpen) document.getElementById('sqLinkSearchInput')?.focus();
}

function sqScheduleLinkSearch() {
  clearTimeout(_sqLinkSearchTimer);
  _sqLinkSearchTimer = setTimeout(sqDoLinkSearch, 350);
}

async function sqDoLinkSearch() {
  const q = (document.getElementById('sqLinkSearchInput')?.value || '').trim();
  const box = document.getElementById('sqLinkSearchResults');
  if (!box) return;
  if (!q) { box.innerHTML = ''; return; }
  const db = window.SupabaseClient;
  if (!db) return;
  const { data: sd } = await db.auth.getSession();
  if (!sd?.session?.user) return;
  const loadedId = typeof window.quoteCloudLoadedId === 'function' ? window.quoteCloudLoadedId() : null;
  if (!loadedId) { box.innerHTML = '<div class="sq-empty-msg">先に案件を保存・読み込みしてください</div>'; return; }

  // 検索語に「,」「(」「)」が入っていても or() の区切りと混ざらないよう、二重引用符で包む（"ABC, Inc" で検索が空になる不具合）
  const qq = '"%' + q.replace(/[\\"]/g, '\\$&') + '%"';
  let { data, error } = await db.from('quote_presets')
    .select('id,name,ref,status,customer,updated_at')
    .or(`name.ilike.${qq},customer.ilike.${qq},ref.ilike.${qq}`)
    .order('updated_at', { ascending: false })
    .limit(8);
  if (error && _sqIsMissingRefColumn(error)) {
    ({ data, error } = await db.from('quote_presets')
      .select('id,name,status,customer,updated_at')
      .or(`name.ilike.${qq},customer.ilike.${qq}`)
      .order('updated_at', { ascending: false })
      .limit(8));
  }
  if (error) { box.innerHTML = ''; return; }

  const already = new Set(_sqLinks.map(l => l.otherId));
  const rows = (data || []).filter(r => r.id !== loadedId);
  _sqLinkResults = rows;   // 理由バーで名前を引き当てるため保持
  box.innerHTML = rows.length
    ? rows.map(r => {
        const linked = already.has(r.id);
        const ref = r.ref ? ` <span class="sq-ref">${escHtml(r.ref)}</span>` : '';
        return `<button type="button" class="sq-link-result${linked ? ' is-linked' : ''}" ` +
          `onclick="sqPickLinkResult('${escHtml(r.id)}')" ${linked ? 'disabled' : ''}>` +
          `${escHtml(r.name || '（無題）')}${ref}${linked ? '（関連付け済み）' : ''}</button>`;
      }).join('')
    : '<div class="sq-empty-msg">該当する案件がありません</div>';
}

async function sqPickLinkResult(id) {
  const loadedId = typeof window.quoteCloudLoadedId === 'function' ? window.quoteCloudLoadedId() : null;
  if (!loadedId || typeof window.cloudLinkPresets !== 'function') return;
  // すぐには関連付けず、まず「理由（任意）」を入力できるバーを出す
  _sqPendingLinkId = id;
  _renderLinkReasonBar();
}

function _renderLinkReasonBar() {
  const box = document.getElementById('sqLinkSearchResults');
  if (!box) return;
  const row = _sqLinkResults.find(r => r.id === _sqPendingLinkId);
  const nm = row ? (row.name || '（無題）') : '';
  box.innerHTML =
    '<div class="sq-link-reason">' +
      '<div class="sq-link-reason-target">🔗 「' + escHtml(nm) + '」に関連付け</div>' +
      '<div class="sq-link-roles" role="radiogroup" aria-label="位置づけ">' +
        '<label><input type="radio" name="sqLinkRole" value="none" checked> 🔗 ただ関連付ける</label>' +
        '<label><input type="radio" name="sqLinkRole" value="sub"> 🌱 この案件のサブにする</label>' +
        '<label><input type="radio" name="sqLinkRole" value="main"> 👑 この案件のメインにする</label>' +
      '</div>' +
      '<input id="sqLinkReasonInput" class="sq-search-input" placeholder="関連付けの理由（任意。例：多レグ分割の相方／代替案）" ' +
        'onkeydown="if(event.key===\'Enter\'){event.preventDefault();sqConfirmPendingLink();}">' +
      '<div class="sq-link-reason-acts">' +
        '<button type="button" class="sq-links-add-btn" onclick="sqConfirmPendingLink()">🔗 関連付ける</button>' +
        '<button type="button" class="sq-link-note-cancel" onclick="sqCancelPendingLink()">キャンセル</button>' +
      '</div>' +
    '</div>';
  document.getElementById('sqLinkReasonInput')?.focus();
}

async function sqConfirmPendingLink() {
  const loadedId = typeof window.quoteCloudLoadedId === 'function' ? window.quoteCloudLoadedId() : null;
  const id = _sqPendingLinkId;
  if (!loadedId || !id || typeof window.cloudLinkPresets !== 'function') return;
  const note = (document.getElementById('sqLinkReasonInput')?.value || '').trim();
  const role = (document.querySelector('input[name="sqLinkRole"]:checked') || {}).value || 'none';
  // サブ＝相手を、いま開いている案件のサブに／メイン＝相手を、いま開いている案件のメインに
  const parent = role === 'sub' ? loadedId : (role === 'main' ? id : null);
  const res = await window.cloudLinkPresets(loadedId, id, note, parent ? { parent } : undefined);
  if (res && res.ok) {
    _sqPendingLinkId = null;
    _sqLinkSearchOpen = false;
    await _sqFetch();
  }
}

function sqCancelPendingLink() {
  _sqPendingLinkId = null;
  const box = document.getElementById('sqLinkSearchResults');
  if (box) box.innerHTML = '';
  document.getElementById('sqLinkSearchInput')?.focus();
}

// 既存リンクの理由（note）を編集
function sqEditLinkNote(linkId) {
  _sqEditNoteFor = linkId;
  _sqFetch().then(() => document.getElementById('sqLinkNoteInput')?.focus());
}
function sqCancelEditNote() {
  _sqEditNoteFor = null;
  _sqFetch();
}
async function sqSaveLinkNote(linkId) {
  const note = (document.getElementById('sqLinkNoteInput')?.value || '').trim();
  if (typeof window.cloudUpdateLinkNote === 'function') await window.cloudUpdateLinkNote(linkId, note);
  _sqEditNoteFor = null;
  await _sqFetch();
}

async function sqUnlinkPreset(linkId) {
  if (!confirm('この関連付けを解除しますか？（双方のカードから解除されます）')) return;
  if (typeof window.cloudUnlinkPreset !== 'function') return;
  const ok = await window.cloudUnlinkPreset(linkId);
  if (ok) await _sqFetch();
}

// ---- 開閉 ---------------------------------------------------------------
function sqToggleCollapse() {
  _sqCollapsed = !_sqCollapsed;
  const panel = document.getElementById('sqPanel');
  if (!panel) return;
  panel.classList.toggle('sq-panel--collapsed', _sqCollapsed);
  panel.querySelector('.sq-collapse-arrow').textContent = _sqCollapsed ? '▶' : '▼';
}

function sqToggleSearch() {
  _sqSearchOpen = !_sqSearchOpen;
  const bar = document.querySelector('#sqPanel .sq-search-bar');
  if (bar) bar.hidden = !_sqSearchOpen;
  document.querySelector('#sqPanel .sq-search-toggle')?.classList.toggle('is-on', _sqSearchOpen);
  if (_sqSearchOpen) document.getElementById('sqSearchText')?.focus();
}

// ---- 検索（「探す」を押したときだけ実行）----------------------------------
function sqScheduleSearch() { /* 互換のため残置（自動検索はしない） */ }

async function sqDoSearch() {
  const f = _sqForm;
  const q = f.q.trim(), ref = f.ref.trim(), pol = f.pol.trim(), pod = f.pod.trim();
  const db = window.SupabaseClient;
  if (!db) { quoteShowToast('⚠️ ログインすると探せます', 'warn'); return; }
  const { data: sd } = await db.auth.getSession();
  if (!sd?.session?.user) { quoteShowToast('⚠️ ログインすると探せます', 'warn'); return; }

  const safe = v => v && !/[,()%]/.test(v);
  const build = (withRef) => {
    let dbq = db.from('quote_presets')
      .select((withRef ? 'id,name,ref,' : 'id,name,') + 'status,customer,person,incoterms,transport_mode,pol,pod,carrier,updated_at')
      .order('updated_at', { ascending: false })
      .limit(60);
    if (q) {
      const parts = [`name.ilike.%${q}%`];
      _sqVariants('customer', q).filter(safe).forEach(v => parts.push(`customer.ilike.%${v}%`));
      dbq = dbq.or(parts.join(','));
    }
    if (ref && withRef) dbq = dbq.ilike('ref', `%${ref}%`);
    if (pol) dbq = dbq.or(_sqVariants('port', pol).filter(safe).map(v => `pol.ilike.%${v}%`).join(',') || `pol.ilike.%${pol}%`);
    if (pod) dbq = dbq.or(_sqVariants('port', pod).filter(safe).map(v => `pod.ilike.%${v}%`).join(',') || `pod.ilike.%${pod}%`);
    if (f.st)   dbq = dbq.eq('status', f.st);
    if (f.mode) dbq = dbq.eq('transport_mode', f.mode);
    return dbq;
  };
  let { data, error } = await build(true);
  if (error && _sqIsMissingRefColumn(error)) {
    if (ref) quoteShowToast('⚠️ 見積もり番号での検索はまだ使えません（DB側の設定が必要です）', 'warn', 4000);
    ({ data, error } = await build(false));
  }
  if (error) { quoteShowToast('⚠️ 検索に失敗しました', 'warn'); return; }

  const p = { customer: q, pol, pod, mode: f.mode, inco: '' };
  _sqAllResults = (data || [])
    .map(r => ({ ...r, _score: _sqScore(r, p) }))
    .sort((a, b) => b._score - a._score || new Date(b.updated_at) - new Date(a.updated_at));
  _sqShowCount = 5;
  _sqSearched = true;
  const list = document.querySelector('#sqPanel .sq-list');
  if (list) _sqListRender(_sqAllResults.slice(0, _sqShowCount), _sqAllResults.length);
}

// ref 列が未マイグレーション（Supabase 側で docs/sql/quote-preset-ref.sql 未実行）のときの
// Postgrest エラーを判定する（"column ... ref ... does not exist" 系のメッセージ）
function _sqIsMissingRefColumn(error) {
  return !!(error && /column .*ref.* does not exist/i.test(error.message || ''));
}

function sqStatusFilter(btn) {
  document.querySelectorAll('#sqPanel .sq-status-chip').forEach(b => b.classList.remove('is-on'));
  btn.classList.add('is-on');
  _sqForm.st = btn.dataset.status || '';
}

function sqModeFilter(btn) {
  document.querySelectorAll('#sqPanel .sq-mode-chip').forEach(b => b.classList.remove('is-on'));
  btn.classList.add('is-on');
  _sqForm.mode = btn.dataset.mode || '';
}

function sqLoadMore() {
  _sqShowCount = Math.min(_sqAllResults.length, _sqShowCount + 5);
  _sqListRender(_sqAllResults.slice(0, _sqShowCount), _sqAllResults.length);
}

// ---- 描画 ----------------------------------------------------------------
function _sqRender(rows, panel, p, total) {
  const labels = [];
  if (p.mode)     labels.push(`<b>${escHtml(p.mode)}</b>`);
  if (p.inco)     labels.push(`<b>${escHtml(p.inco.split('（')[0])}</b>`);
  if (p.pol)      labels.push(`<span class="sq-param-port">📦${escHtml(p.pol)}</span>`);
  if (p.pod)      labels.push(`<span class="sq-param-port">🏁${escHtml(p.pod)}</span>`);
  if (p.customer) labels.push(`<span class="sq-param-cust">🏢${escHtml(p.customer)}</span>`);

  panel.hidden = false;
  panel.classList.toggle('sq-panel--collapsed', _sqCollapsed);
  panel.innerHTML =
    _sqLinksHtml() +
    `<div class="sq-head">
       <span class="sq-head-main" onclick="sqToggleCollapse()">
         <span class="sq-head-title">📎 類似の過去見積</span>
         <span class="sq-match-label">${labels.join(' ')}</span>
         <span class="sq-count">${rows.length}/${total}件</span>
         <span class="sq-collapse-arrow">${_sqCollapsed ? '▶' : '▼'}</span>
       </span>
       <button class="sq-search-toggle" onclick="sqToggleSearch()" title="絞り込み検索">🔍</button>
     </div>` +
    `<div class="sq-search-bar" hidden>
       <div class="sq-search-row">
         <input id="sqSearchRef" class="sq-search-input" placeholder="見積もり番号で検索（例：05-2606100-02）" oninput="sqScheduleSearch()">
       </div>
       <div class="sq-search-row">
         <input id="sqSearchText" class="sq-search-input" placeholder="見積名・顧客名で検索" oninput="sqScheduleSearch()">
       </div>
       <div class="sq-search-row sq-search-row-2col">
         <input id="sqSearchPol" class="sq-search-input" placeholder="POL（積み港）" oninput="sqScheduleSearch()">
         <input id="sqSearchPod" class="sq-search-input" placeholder="POD（揚げ港）" oninput="sqScheduleSearch()">
       </div>
       <div class="sq-search-row sq-status-row">
         <span class="sq-search-label">輸送モード</span>
         <button class="sq-mode-chip is-on" data-mode="" onclick="sqModeFilter(this)">すべて</button>
         <button class="sq-mode-chip" data-mode="海上（FCL）" onclick="sqModeFilter(this)">FCL</button>
         <button class="sq-mode-chip" data-mode="海上（LCL）" onclick="sqModeFilter(this)">LCL</button>
         <button class="sq-mode-chip" data-mode="航空（AIR）" onclick="sqModeFilter(this)">AIR</button>
       </div>
       <div class="sq-search-row sq-status-row">
         <span class="sq-search-label">状態</span>
         <button class="sq-status-chip is-on" data-status="" onclick="sqStatusFilter(this)">すべて</button>
         <button class="sq-status-chip" data-status="提示済み" onclick="sqStatusFilter(this)">提示済み</button>
         <button class="sq-status-chip" data-status="受注"   onclick="sqStatusFilter(this)">受注</button>
         <button class="sq-status-chip" data-status="失注"   onclick="sqStatusFilter(this)">失注</button>
       </div>
     </div>` +
    `<div class="sq-list">` +
      rows.map(r => _sqCardHtml(r)).join('') +
      (total > _sqShowCount ? _sqMoreBtn(total - _sqShowCount) : '') +
    `</div>`;
}

function _sqListRender(rows, total) {
  const list = document.querySelector('#sqPanel .sq-list');
  if (!list) return;
  list.innerHTML =
    rows.map(r => _sqCardHtml(r)).join('') +
    (rows.length < total && total === _sqAllResults.length && _sqShowCount < _sqAllResults.length
      ? _sqMoreBtn(_sqAllResults.length - _sqShowCount)
      : '') +
    (rows.length === 0 ? '<div class="sq-empty-msg">条件に合う見積はありません</div>' : '');
}

function _sqMoreBtn(remaining) {
  return `<button class="sq-more-btn" onclick="sqLoadMore()">もっと見る（あと ${remaining} 件）</button>`;
}

function _sqCardHtml(r) {
  const badge  = _sqStatusBadge(r.status);
  const inco   = r.incoterms      ? `<span class="sq-tag sq-tag-inco">${escHtml(r.incoterms.split('（')[0])}</span>` : '';
  const mode   = r.transport_mode ? `<span class="sq-tag sq-tag-mode">${escHtml(r.transport_mode)}</span>`           : '';
  // POL/POD は最初の1港ずつに絞る（複数港が comma 区切りで入っている場合に対応）
  const polShort = (r.pol || '').split(/[,、]/)[0].trim();
  const podShort = (r.pod || '').split(/[,、]/)[0].trim();
  const route  = (polShort || podShort) ? `<span class="sq-route">${escHtml([polShort, podShort].filter(Boolean).join(' → '))}</span>` : '';
  const cust   = r.customer ? `<span class="sq-cust">${escHtml(r.customer)}</span>` : '';
  const ref    = r.ref ? `<span class="sq-ref">${escHtml(r.ref)}</span>` : '';
  const date   = r.updated_at ? new Date(r.updated_at).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' }) : '';
  const score  = r._score != null ? _sqScoreDots(r._score) : '';
  const level  = r._score != null ? (r._score >= _SQ_MAX * 0.6 ? 3 : r._score >= _SQ_MAX * 0.27 ? 2 : 1) : 0;
  const borderCls = level === 3 ? 'sq-card--hi' : level === 2 ? 'sq-card--mid' : '';
  return `<div class="sq-card ${borderCls}" onclick="sqOpenPreview('${escHtml(r.id)}')">
    <div class="sq-card-top">
      <span class="sq-card-name">${escHtml(r.name || '（無題）')}</span>
      ${badge}${score}
    </div>
    <div class="sq-card-sub">${ref}${cust}${route}</div>
    <div class="sq-card-tags">${inco}${mode}</div>
    ${date ? `<div class="sq-card-date">${date}</div>` : ''}
  </div>`;
}

function _sqScoreDots(score) {
  if (!score) return '';
  const level = score >= _SQ_MAX * 0.6 ? 3 : score >= _SQ_MAX * 0.27 ? 2 : 1;
  const cls   = level === 3 ? 'sq-dots-hi' : level === 2 ? 'sq-dots-mid' : 'sq-dots-lo';
  return `<span class="sq-score-dots ${cls}" title="類似度 ${level}/3">${'●'.repeat(level)}${'○'.repeat(3 - level)}</span>`;
}

function _sqStatusBadge(status) {
  const map = { '下書き中': 'draft', '下書き': 'draft', '提示済み': 'sent', '提出済み': 'sent', 'ヨコヨコ提示': 'yoko', '受注': 'won', '失注': 'lost', '保留': 'hold', '辞退': 'declined' };
  const cls = map[status] || 'draft';
  return status ? `<span class="sq-badge sq-badge-${cls}">${escHtml(status)}</span>` : '';
}

// ---- プレビューモーダル --------------------------------------------------
function sqOpenPreview(id) {
  if (typeof window.cloudPreviewPreset === 'function') {
    window.cloudPreviewPreset(encodeURIComponent(id));
    return;
  }
  _sqFallbackPreview(id);
}

async function _sqFallbackPreview(id) {
  const db = window.SupabaseClient;
  if (!db) return;
  const { data, error } = await db.from('quote_presets')
    .select('id,name,ref,status,customer,person,incoterms,transport_mode,pol,pod,carrier,created_by,updated_at')
    .eq('id', id).single();
  if (error || !data) { quoteShowToast('⚠️ 取得失敗', 'warn'); return; }

  _sqPreviewId = data.id;
  document.getElementById('sqPreviewTitle').textContent = data.name || '（無題）';

  const rows = [
    ['見積もり番号',   data.ref],
    ['インコタームズ', data.incoterms],
    ['輸送モード',     data.transport_mode],
    ['POL → POD',     data.pol && data.pod ? `${data.pol} → ${data.pod}` : null],
    ['キャリア',       data.carrier],
    ['顧客',           data.customer],
    ['担当者',         data.person],
    ['ステータス',     data.status],
    ['更新日時',       data.updated_at ? new Date(data.updated_at).toLocaleString('ja-JP') : null],
    ['作成者',         data.created_by],
  ];
  document.getElementById('sqPreviewBody').innerHTML =
    `<table class="sq-preview-table">${rows.filter(([,v]) => v).map(([k,v]) =>
      `<tr><th>${escHtml(k)}</th><td>${escHtml(v)}</td></tr>`).join('')}</table>`;
  document.getElementById('sqPreviewOverlay').hidden = false;
}

function sqClosePreview(e) {
  if (e && e.target.id !== 'sqPreviewOverlay') return;
  document.getElementById('sqPreviewOverlay').hidden = true;
  _sqPreviewId = null;
}

function sqLoadConfirm() {
  if (!_sqPreviewId) return;
  if (!confirm('現在の入力内容が上書きされます。この見積を読み込みますか？')) return;
  document.getElementById('sqPreviewOverlay').hidden = true;
  window.cloudLoadPreset(_sqPreviewId);
}

// ---- window 公開 ---------------------------------------------------------
window.initSimilarQuotes = initSimilarQuotes;
window.sqOpenPreview     = sqOpenPreview;
window.sqClosePreview    = sqClosePreview;
window.sqLoadConfirm     = sqLoadConfirm;
window.sqToggleCollapse  = sqToggleCollapse;
window.sqToggleSearch    = sqToggleSearch;
window.sqScheduleSearch  = sqScheduleSearch;
window.sqDoSearch        = sqDoSearch;
window.sqStartSearch     = sqStartSearch;
window.sqBackToIntro     = sqBackToIntro;
window.sqClearSearch     = sqClearSearch;
window.sqFormInput       = sqFormInput;
window.sqStatusFilter    = sqStatusFilter;
window.sqModeFilter      = sqModeFilter;
window.sqLoadMore        = sqLoadMore;
window.sqOnActivate      = _sqFetch;
window.sqToggleLinkSearch  = sqToggleLinkSearch;
window.sqScheduleLinkSearch = sqScheduleLinkSearch;
window.sqDoLinkSearch     = sqDoLinkSearch;
window.sqPickLinkResult   = sqPickLinkResult;
window.sqUnlinkPreset     = sqUnlinkPreset;
window.sqSetLinkRole      = sqSetLinkRole;
