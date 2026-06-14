// ========== 類似見積サジェスト（案C：スコアリング＋インライン検索）==========

let _sqTimer       = null;
let _sqSearchTimer = null;
let _sqPreviewId   = null;
let _sqCollapsed   = false;
let _sqSearchOpen  = false;
let _sqAllResults  = [];  // auto-fetch の全候補
let _sqShowCount   = 5;   // 現在の表示件数

// スコア重み（合計最大 15）
const _SQ_W = { mode: 4, inco: 3, pol: 3, pod: 3, customer: 2 };
const _SQ_MAX = 15;

function initSimilarQuotes() {
  ['cond-incoterms', 'cond-mode'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', _sqSchedule);
  });
  ['z2Pol', 'z2Pod', 'qf-customer'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', _sqSchedule);
  });
}

function _sqSchedule() {
  clearTimeout(_sqTimer);
  _sqTimer = setTimeout(_sqFetch, 700);
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

  const p = _sqGetParams();
  if (!p.inco && !p.mode && !p.pol && !p.pod && !p.customer) {
    panel.hidden = true;
    return;
  }

  const db = window.SupabaseClient;
  if (!db) return;
  const { data: sd } = await db.auth.getSession();
  if (!sd?.session?.user) return;

  // 全条件 OR で広めに取得（最大 25 件）
  const orParts = [];
  if (p.inco)     orParts.push(`incoterms.eq.${p.inco}`);
  if (p.mode)     orParts.push(`transport_mode.eq.${p.mode}`);
  if (p.pol)      orParts.push(`pol.ilike.%${p.pol}%`);
  if (p.pod)      orParts.push(`pod.ilike.%${p.pod}%`);
  if (p.customer) orParts.push(`customer.ilike.%${p.customer}%`);

  const { data, error } = await db.from('quote_presets')
    .select('id,name,status,customer,person,incoterms,transport_mode,pol,pod,carrier,updated_at')
    .or(orParts.join(','))
    .order('updated_at', { ascending: false })
    .limit(25);

  if (error) { panel.hidden = true; return; }

  // クライアント側スコアリング → スコア降順 → updated_at 降順
  _sqAllResults = (data || [])
    .map(r => ({ ...r, _score: _sqScore(r, p) }))
    .filter(r => r._score > 0)
    .sort((a, b) => b._score - a._score || new Date(b.updated_at) - new Date(a.updated_at));

  _sqShowCount  = 5;
  _sqSearchOpen = false;
  _sqRender(_sqAllResults.slice(0, _sqShowCount), panel, p, _sqAllResults.length);
}

function _sqScore(r, p) {
  let s = 0;
  const ci = v => (v || '').toLowerCase();
  if (p.mode     && ci(r.transport_mode) === ci(p.mode))           s += _SQ_W.mode;
  if (p.inco     && ci(r.incoterms)      === ci(p.inco))           s += _SQ_W.inco;
  if (p.pol      && ci(r.pol  || '').includes(ci(p.pol)))          s += _SQ_W.pol;
  if (p.pod      && ci(r.pod  || '').includes(ci(p.pod)))          s += _SQ_W.pod;
  if (p.customer && ci(r.customer || '').includes(ci(p.customer))) s += _SQ_W.customer;
  return s;
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

// ---- インライン検索 -------------------------------------------------------
function sqScheduleSearch() {
  clearTimeout(_sqSearchTimer);
  _sqSearchTimer = setTimeout(sqDoSearch, 400);
}

async function sqDoSearch() {
  const q   = (document.getElementById('sqSearchText')?.value || '').trim();
  const pol = (document.getElementById('sqSearchPol')?.value  || '').trim();
  const pod = (document.getElementById('sqSearchPod')?.value  || '').trim();
  const st  = document.querySelector('#sqPanel .sq-status-chip.is-on')?.dataset.status || '';

  // 何も入力なければ auto 結果を表示
  if (!q && !pol && !pod && !st) {
    _sqListRender(_sqAllResults.slice(0, _sqShowCount), _sqAllResults.length);
    return;
  }

  const db = window.SupabaseClient;
  if (!db) return;
  const { data: sd } = await db.auth.getSession();
  if (!sd?.session?.user) return;

  let dbq = db.from('quote_presets')
    .select('id,name,status,customer,person,incoterms,transport_mode,pol,pod,carrier,updated_at')
    .order('updated_at', { ascending: false })
    .limit(20);

  if (q)   dbq = dbq.or(`name.ilike.%${q}%,customer.ilike.%${q}%`);
  if (pol) dbq = dbq.ilike('pol', `%${pol}%`);
  if (pod) dbq = dbq.ilike('pod', `%${pod}%`);
  if (st)  dbq = dbq.eq('status', st);

  const { data, error } = await dbq;
  if (error) return;

  // auto-params でスコアも付与（参考表示）
  const p = _sqGetParams();
  const rows = (data || []).map(r => ({ ...r, _score: _sqScore(r, p) }));
  _sqListRender(rows, rows.length);
}

function sqStatusFilter(btn) {
  document.querySelectorAll('#sqPanel .sq-status-chip').forEach(b => b.classList.remove('is-on'));
  btn.classList.add('is-on');
  sqDoSearch();
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
         <input id="sqSearchText" class="sq-search-input" placeholder="見積名・顧客名で検索" oninput="sqScheduleSearch()">
       </div>
       <div class="sq-search-row sq-search-row-2col">
         <input id="sqSearchPol" class="sq-search-input" placeholder="POL（積み港）" oninput="sqScheduleSearch()">
         <input id="sqSearchPod" class="sq-search-input" placeholder="POD（揚げ港）" oninput="sqScheduleSearch()">
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
  const route  = (r.pol || r.pod) ? `<span class="sq-route">${escHtml([r.pol, r.pod].filter(Boolean).join(' → '))}</span>` : '';
  const cust   = r.customer ? `<span class="sq-cust">${escHtml(r.customer)}</span>` : '';
  const date   = r.updated_at ? new Date(r.updated_at).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' }) : '';
  const score  = r._score != null ? _sqScoreDots(r._score) : '';
  return `<div class="sq-card" onclick="sqOpenPreview('${escHtml(r.id)}')">
    <div class="sq-card-top">
      <span class="sq-card-name">${escHtml(r.name || '（無題）')}</span>
      ${badge}${score}
    </div>
    <div class="sq-card-sub">${cust}${route}</div>
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
  const map = { '下書き中': 'draft', '下書き': 'draft', '提示済み': 'sent', '提出済み': 'sent', '受注': 'won', '失注': 'lost', '保留': 'hold', '辞退': 'declined' };
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
    .select('id,name,status,customer,person,incoterms,transport_mode,pol,pod,carrier,created_by,updated_at')
    .eq('id', id).single();
  if (error || !data) { quoteShowToast('⚠️ 取得失敗', 'warn'); return; }

  _sqPreviewId = data.id;
  document.getElementById('sqPreviewTitle').textContent = data.name || '（無題）';

  const rows = [
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
window.sqStatusFilter    = sqStatusFilter;
window.sqLoadMore        = sqLoadMore;
