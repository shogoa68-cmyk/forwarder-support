// ========== 類似見積サジェスト ==========

let _sqTimer    = null;
let _sqPreviewId = null;

function initSimilarQuotes() {
  document.getElementById('cond-incoterms')?.addEventListener('change', _sqSchedule);
  document.getElementById('cond-mode')?.addEventListener('change', _sqSchedule);
}

function _sqSchedule() {
  clearTimeout(_sqTimer);
  _sqTimer = setTimeout(_sqFetch, 600);
}

async function _sqFetch() {
  const panel = document.getElementById('sqPanel');
  if (!panel) return;

  const inco = (document.getElementById('cond-incoterms')?.value || '').trim();
  const mode = (document.getElementById('cond-mode')?.value || '').trim();

  if (!inco && !mode) { panel.hidden = true; return; }

  const db = window.SupabaseClient;
  if (!db) return;
  const { data: sd } = await db.auth.getSession();
  if (!sd?.session?.user) return;

  const parts = [];
  if (inco) parts.push(`incoterms.eq.${inco}`);
  if (mode) parts.push(`transport_mode.eq.${mode}`);

  let q = db.from('quote_presets')
    .select('id,name,status,customer,person,incoterms,transport_mode,pol,pod,updated_at')
    .order('updated_at', { ascending: false })
    .limit(5);
  q = parts.length === 1 ? q.or(parts[0]) : q.or(parts.join(','));

  const { data, error } = await q;
  if (error) { panel.hidden = true; return; }

  _sqRender(data || [], panel, inco, mode);
}

function _sqRender(rows, panel, inco, mode) {
  const matchLabel = [inco ? `<b>${escHtml(inco.split('（')[0])}</b>` : '', mode ? `<b>${escHtml(mode)}</b>` : ''].filter(Boolean).join(' / ');
  const body = rows.length
    ? rows.map(r => _sqCardHtml(r)).join('')
    : '<div class="sq-empty-msg">該当する過去見積はありません</div>';
  panel.hidden = false;
  panel.innerHTML =
    `<div class="sq-head">📎 類似の過去見積 <span class="sq-match-label">${matchLabel}</span><span class="sq-count">${rows.length}件</span></div>` +
    `<div class="sq-list">${body}</div>`;
}

function _sqCardHtml(r) {
  const badge = _sqStatusBadge(r.status);
  const inco  = r.incoterms     ? `<span class="sq-tag sq-tag-inco">${escHtml(r.incoterms.split('（')[0])}</span>` : '';
  const mode  = r.transport_mode ? `<span class="sq-tag sq-tag-mode">${escHtml(r.transport_mode)}</span>` : '';
  const route = (r.pol && r.pod) ? `<span class="sq-route">${escHtml(r.pol)} → ${escHtml(r.pod)}</span>` : '';
  const cust  = r.customer ? `<span class="sq-cust">${escHtml(r.customer)}</span>` : '';
  const date  = r.updated_at ? new Date(r.updated_at).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' }) : '';
  return `<div class="sq-card" onclick="sqOpenPreview('${escHtml(r.id)}')">
    <div class="sq-card-top">
      <span class="sq-card-name">${escHtml(r.name || '（無題）')}</span>
      ${badge}
    </div>
    <div class="sq-card-sub">${cust}${route}</div>
    <div class="sq-card-tags">${inco}${mode}</div>
    ${date ? `<div class="sq-card-date">${date}</div>` : ''}
  </div>`;
}

function _sqStatusBadge(status) {
  const map = { '下書き': 'draft', '提示済み': 'sent', '受注': 'won', '失注': 'lost', '保留': 'hold' };
  const cls = map[status] || 'draft';
  return status ? `<span class="sq-badge sq-badge-${cls}">${escHtml(status)}</span>` : '';
}

// ---------- プレビューモーダル ----------
// cloudPreviewPreset（行選択・インポート対応）に委譲する。
// 未ロード時は sqPreviewOverlay フォールバックを使用。
function sqOpenPreview(id) {
  if (typeof window.cloudPreviewPreset === 'function') {
    window.cloudPreviewPreset(encodeURIComponent(id));
    return;
  }
  // フォールバック（クラウド未設定環境）
  _sqFallbackPreview(id);
}

async function _sqFallbackPreview(id) {
  const db = window.SupabaseClient;
  if (!db) return;
  const { data, error } = await db
    .from('quote_presets')
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

  const table = rows.filter(([, v]) => v)
    .map(([k, v]) => `<tr><th>${escHtml(k)}</th><td>${escHtml(v)}</td></tr>`).join('');

  document.getElementById('sqPreviewBody').innerHTML =
    `<table class="sq-preview-table">${table}</table>`;
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

// ---------- window 公開 ----------
window.initSimilarQuotes = initSimilarQuotes;
window.sqOpenPreview     = sqOpenPreview;
window.sqClosePreview    = sqClosePreview;
window.sqLoadConfirm     = sqLoadConfirm;
