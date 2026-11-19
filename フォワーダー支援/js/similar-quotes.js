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
let _sqBusy      = false;                 // 検索中
let _sqSearched  = false;                 // 「探す」を押したか（押すまで結果は出さない）
let _sqForm = { q: '', ref: '', pol: '', pod: '', mode: '', st: '' };

function _sqRenderPanel() {
  const panel = document.getElementById('sqPanel');
  if (!panel) return;
  panel.hidden = false;
  panel.classList.toggle('sq-panel--collapsed', false);
  const loadedId = typeof window.quoteCloudLoadedId === 'function' ? window.quoteCloudLoadedId() : null;
  // 「関連付けた案件」の箱は保存済みの案件を開いているときだけ（従来どおり）。箱と検索の箱のあいだに 8px の帯
  const linksHtml = loadedId ? `<div class="sq-box sq-box--links">${_sqLinksHtml()}</div><div class="sq-divider" aria-hidden="true"></div>` : '';
  panel.innerHTML = `<div class="sq-scroll">${linksHtml}<div class="sq-box sq-box--search">${_sqSearching ? _sqSearchHtml() : _sqIntroHtml()}</div></div>` +
    (_sqSearching ? _sqActionsHtml('sq-actions--phone') : '');
  if (_sqSearching) _sqRenderResults();
}

// 探す側の条件（空の条件は一致の札を出さず、分母も減らす）：お客様・POL・POD・モードは検索欄、貿易条件はいまの見積から
function _sqSearchSide() {
  const f = _sqForm, cur = _sqGetParams();
  return { customer: f.q.trim(), pol: f.pol.trim(), pod: f.pod.trim(), mode: f.mode, inco: cur.inco };
}
const _SQ_LABEL = { customer: 'お客様', pol: 'POL', pod: 'POD', mode: 'モード', inco: '貿易条件' };
const _SQ_ORDER = ['customer', 'pol', 'pod', 'mode', 'inco'];
// 5 つの条件のどれが一致したか（比べ方は _sqScore と同じ）
function _sqHits(r, p) {
  const ci = v => (v || '').toLowerCase();
  const used = {}, hit = {};
  used.customer = !!p.customer; hit.customer = used.customer && _sqMatch('customer', r.customer, p.customer);
  used.pol = !!p.pol;           hit.pol = used.pol && _sqMatch('port', r.pol, p.pol);
  used.pod = !!p.pod;           hit.pod = used.pod && _sqMatch('port', r.pod, p.pod);
  used.mode = !!p.mode;         hit.mode = used.mode && ci(r.transport_mode) === ci(p.mode);
  used.inco = !!p.inco;         hit.inco = used.inco && ci(r.incoterms) === ci(p.inco);
  return { used, hit };
}

function _sqIntroHtml() {
  const p = _sqGetParams();
  const has = !!(p.customer || p.pol || p.pod || p.mode);
  const modeShort = (p.mode || '').replace(/^海上（|^航空（|）$/g, '');
  const chips = [];
  if (p.customer) chips.push(`<span>🏢 ${escHtml(p.customer)}</span>`);
  if (p.pol)      chips.push(`<span>📦 ${escHtml(p.pol)}</span>`);
  if (p.pod)      chips.push(`<span>🏁 ${escHtml(p.pod)}</span>`);
  if (p.mode)     chips.push(`<span>${escHtml(modeShort || p.mode)}</span>`);
  const shortcut = has
    ? `<div class="sq-cond">${chips.join('')}</div>
       <button type="button" class="sq-quick-btn" onclick="sqQuickSearch()">⚡ この見積の条件で探す</button>`
    : `<div class="sq-short-none">この見積にはまだ条件（お客様・港・モード）がありません。上のカードから、条件を入れて探せます。</div>`;
  return `<div class="sq-sh"><b>🔍 似ている案件を探す</b><small>過去の案件から</small></div>
    <button type="button" class="sq-intro" onclick="sqStartSearch()">
      <span class="sq-intro-ico" aria-hidden="true">🔍</span>
      <span class="sq-intro-body"><b>似ている案件を探す</b>
        <small>過去の案件から、お客様・積み港・揚げ港・モードで探します。見つけた案件はプレビューで中身を確認でき、行を追加できます</small></span>
      <span class="sq-intro-go" aria-hidden="true">›</span>
    </button>
    <div class="sq-short">${shortcut}</div>`;
}

function _sqActionsHtml(cls) {
  return `<div class="sq-actions ${cls || ''}">
    <button type="button" class="sq-go-btn" id="${cls ? 'sqGoBtnP' : 'sqGoBtn'}" onclick="sqDoSearch()"${_sqBusy ? ' disabled' : ''}>🔍 探す</button>
    <button type="button" class="sq-clear-btn" onclick="sqClearSearch()">${cls ? 'クリア' : '条件をクリア'}</button>
  </div>`;
}

function _sqSearchHtml() {
  const f = _sqForm;
  const chip = (cls, key, val, label) =>
    `<button type="button" class="${cls}${f[key] === val ? ' is-on' : ''}" data-${key === 'mode' ? 'mode' : 'status'}="${escHtml(val)}" onclick="${key === 'mode' ? 'sqModeFilter' : 'sqStatusFilter'}(this)">${label}</button>`;
  const enter = `onkeydown="if(event.key==='Enter'&&!event.isComposing)sqDoSearch()"`;
  const field = (id, label, ph, val) =>
    `<div class="sq-f"><label class="sq-f-lbl" for="${id}">${label}</label>` +
    `<input id="${id}" class="sq-search-input" placeholder="${ph}" value="${escHtml(val)}" oninput="sqFormInput(this)" ${enter}></div>`;
  const moreOpen = !!(f.ref || f.st);
  return `<div class="sq-sh sq-sh--search"><button type="button" class="sq-back-btn" onclick="sqBackToIntro()" title="入口へ戻る">‹ 戻る</button><b>似ている案件を探す</b></div>
    <div class="sq-search-bar">
      ${field('sqSearchText', 'お客様・見積名', 'お客様名・見積名', f.q)}
      <div class="sq-g2">
        ${field('sqSearchPol', '積み港 POL', 'POL（積み港）', f.pol)}
        ${field('sqSearchPod', '揚げ港 POD', 'POD（揚げ港）', f.pod)}
      </div>
      <div class="sq-f"><span class="sq-f-lbl">輸送モード</span><div class="sq-chips">
        ${chip('sq-mode-chip', 'mode', '', 'すべて')}${chip('sq-mode-chip', 'mode', '海上（FCL）', 'FCL')}${chip('sq-mode-chip', 'mode', '海上（LCL）', 'LCL')}${chip('sq-mode-chip', 'mode', '航空（AIR）', 'AIR')}
      </div></div>
      <button type="button" class="sq-more-toggle" aria-expanded="${moreOpen}" onclick="sqToggleMoreCond(this)">さらに条件（状態・見積もり番号） <span class="sq-more-arrow">${moreOpen ? '▴' : '▾'}</span></button>
      <div class="sq-more-cond"${moreOpen ? '' : ' hidden'}>
        <div class="sq-f"><span class="sq-f-lbl">状態</span><div class="sq-chips">
          ${chip('sq-status-chip', 'st', '', 'すべて')}${chip('sq-status-chip', 'st', '提示済み', '提示済み')}${chip('sq-status-chip', 'st', '受注', '受注')}${chip('sq-status-chip', 'st', '失注', '失注')}
        </div></div>
        ${field('sqSearchRef', '見積もり番号', '例：05-2606100-02', f.ref)}
      </div>
      ${_sqActionsHtml('')}
    </div>
    <div class="sq-results" id="sqResults" aria-live="polite"></div>`;
}

function sqToggleMoreCond(btn) {
  const box = document.querySelector('#sqPanel .sq-more-cond');
  if (!box) return;
  box.hidden = !box.hidden;
  btn.setAttribute('aria-expanded', String(!box.hidden));
  const arr = btn.querySelector('.sq-more-arrow'); if (arr) arr.textContent = box.hidden ? '▾' : '▴';
}

// 結果エリア：探す前／検索中／結果／該当なし
function _sqRenderResults() {
  const box = document.getElementById('sqResults');
  if (!box) return;
  if (_sqBusy) {
    box.innerHTML = '<div class="sq-count"><b>探しています…</b></div>' + '<div class="sq-sk"></div>'.repeat(3);
    return;
  }
  if (!_sqSearched) {
    box.innerHTML = `<div class="sq-state"><span class="sq-state-ico" aria-hidden="true">🗂</span><b>条件を確かめて［探す］を押してください</b>
      <small>条件が空でも探せます（新しい順）。<br>Enter キーでも探せます。</small></div>`;
    return;
  }
  if (!_sqAllResults.length) {
    box.innerHTML = `<div class="sq-state"><span class="sq-state-ico" aria-hidden="true">🔎</span><b>該当する案件はありません</b>
      <small>条件を減らすと見つかることがあります。<br>例：お客様名を消す・モードを「すべて」に。</small>
      <button type="button" class="sq-retry-btn" onclick="sqRetryClear()">条件をクリアしてもう一度</button></div>`;
    return;
  }
  const shown = _sqAllResults.slice(0, _sqShowCount), total = _sqAllResults.length;
  box.innerHTML = `<div class="sq-count"><b>${total} 件</b>が見つかりました<span class="sq-count-r">似ている順</span></div>` +
    `<div class="sq-list">${shown.map(r => _sqCardHtml(r)).join('')}${total > _sqShowCount ? _sqMoreBtn(total - _sqShowCount) : ''}</div>`;
}
function sqRetryClear() { sqClearSearch(); sqDoSearch(); }

// 近道：いまの見積の条件で検索画面を開き、すぐ結果まで出す
function sqQuickSearch() {
  sqStartSearch();
  sqDoSearch();
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
      <span class="sq-links-title"><b>🔗 関連付けた案件${_sqLinks.length ? '（' + _sqLinks.length + '）' : ''}</b><small>手で結んだ案件</small></span>
      <button type="button" class="sq-links-add-btn" onclick="sqToggleLinkSearch()" title="他の案件をこの案件に関連付ける（メイン／サブにもできます）">＋ 関連付け</button>
    </div>
    <div class="sq-link-search-bar" id="sqLinkSearchBar" ${_sqLinkSearchOpen ? '' : 'hidden'}>
      <input id="sqLinkSearchInput" class="sq-search-input" placeholder="見積名・見積もり番号・顧客名で検索" oninput="sqScheduleLinkSearch()">
      <div class="sq-link-search-results" id="sqLinkSearchResults"></div>
    </div>
    <div class="sq-links-list">${items || '<div class="sq-links-empty">まだありません。多レグの相方や代替案を［＋ 関連付け］で結べます。</div>'}</div>
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
  if (_sqBusy) return;
  const db = window.SupabaseClient;
  if (!db) { quoteShowToast('⚠️ ログインすると探せます', 'warn'); return; }
  const { data: sd } = await db.auth.getSession();
  if (!sd?.session?.user) { quoteShowToast('⚠️ ログインすると探せます', 'warn'); return; }
  _sqBusy = true; _sqSetBusyUi(true); _sqRenderResults();
  try { await _sqRunSearch(db, f, q, ref, pol, pod); }
  finally { _sqBusy = false; _sqSetBusyUi(false); _sqRenderResults(); }
}
function _sqSetBusyUi(b) {
  document.querySelectorAll('#sqPanel .sq-go-btn').forEach(x => { x.disabled = b; });
}
async function _sqRunSearch(db, f, q, ref, pol, pod) {
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

  const p = _sqSearchSide();
  _sqAllResults = (data || [])
    .map(r => ({ ...r, _score: _sqScore(r, p), _side: p }))
    .sort((a, b) => b._score - a._score || new Date(b.updated_at) - new Date(a.updated_at));
  _sqShowCount = 5;
  _sqSearched = true;
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
  _sqRenderResults();
}

// ---- 描画 ----------------------------------------------------------------
function _sqMoreBtn(remaining) {
  return `<button type="button" class="sq-more-btn" onclick="sqLoadMore()">もっと見る（あと ${remaining} 件） ▾</button>`;
}

function _sqCardHtml(r) {
  const badge  = _sqStatusBadge(r.status);
  const polShort = (r.pol || '').split(/[,、]/)[0].trim();
  const podShort = (r.pod || '').split(/[,、]/)[0].trim();
  const route  = (polShort || podShort) ? escHtml([polShort, podShort].filter(Boolean).join(' → ')) : '';
  const incoShort = r.incoterms ? escHtml(r.incoterms.split('（')[0]) : '';
  const l3 = [route, r.transport_mode ? escHtml(r.transport_mode) : '', incoShort].filter(Boolean).join('<i aria-hidden="true">・</i>');
  const ref    = r.ref ? `<span class="sq-ref">${escHtml(r.ref)}</span>` : '';
  const date   = r.updated_at ? new Date(r.updated_at).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' }) : '';
  // 一致の札（探す側の条件が空の条件は出さず、分母も減らす）
  let lv = '', match = '';
  if (r._side) {
    const { used, hit } = _sqHits(r, r._side);
    const keys = _SQ_ORDER.filter(k => used[k]);
    if (keys.length) {
      const n = keys.filter(k => hit[k]).length;
      lv = `<span class="sq-lv">${n}/${keys.length} 一致</span>`;
      const ordered = keys.filter(k => hit[k]).concat(keys.filter(k => !hit[k]));
      match = `<div class="sq-match">${ordered.map(k => hit[k]
        ? `<span class="sq-m is-hit">✓ ${_SQ_LABEL[k]}</span>` : `<span class="sq-m">${_SQ_LABEL[k]}</span>`).join('')}</div>`;
    }
  }
  const idq = escHtml(r.id);
  return `<div class="sq-card" role="button" tabindex="0" onclick="sqOpenPreview('${idq}')"
      onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();sqOpenPreview('${idq}')}">
    <div class="sq-card-top">
      <span class="sq-card-name" title="${escHtml(r.name || '（無題）')}">${escHtml(r.name || '（無題）')}</span>${lv}<span class="sq-card-go" aria-hidden="true">›</span>
    </div>
    ${r.customer ? `<div class="sq-card-cust">${escHtml(r.customer)}</div>` : ''}
    ${l3 ? `<div class="sq-card-l3">${l3}</div>` : ''}
    ${match}
    <div class="sq-card-l4">${badge}${ref}${date ? `<span class="sq-card-date">${date}</span>` : ''}</div>
  </div>`;
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
window.sqQuickSearch     = sqQuickSearch;
window.sqRetryClear      = sqRetryClear;
window.sqToggleMoreCond  = sqToggleMoreCond;
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
