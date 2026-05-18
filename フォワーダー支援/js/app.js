// ================================================================
//  アプリケーション本体
//  依存（この順でロードすること）:
//    1. data/carriers.js   → CARRIERS, VESSEL_PORTALS, BOOKING_URLS
//    2. data/incoterms.js  → INCO_STAGES, INCO_DATA
//    3. js/calculator.js   → 計算関数
// ================================================================

// ================================================================
//  共通ユーティリティ
//
//  Phase 2c-Step2: 旧 copyToClipboard / showToast / #clipboard-toast は
//  呼び出し元ゼロの dead code だったため削除。
//  クリップボードコピーは calculator.js 内で navigator.clipboard を直接使用、
//  トースト表示はサイト全体スコープの quoteShowToast()（js/quote/ui.js）で統一。
// ================================================================

// タブ切り替え
function switchCategory(cat, btn) {
  // カテゴリーボタンのアクティブ切替
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  // サブナビの表示切替
  document.querySelectorAll('.sub-nav').forEach(s => s.classList.remove('active'));
  document.getElementById('sub-' + cat).classList.add('active');
  // カテゴリー最初のタブへ自動切替
  const firstBtn = document.querySelector('#sub-' + cat + ' .tab-btn');
  if (firstBtn) firstBtn.click();
}

function switchTab(tabId, btn) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + tabId).classList.add('active');
  btn.classList.add('active');
  // Phase 2b：見積タブ(新版)が初めて表示されたタイミングで遅延初期化
  if (tabId === 'quote-make' && typeof window.initQuoteTab === 'function') {
    window.initQuoteTab();
  }
}

// セレクトボックスを船会社リストで初期化
function populateSelect(id) {
  const sel = document.getElementById(id);
  if (!sel) return;
  sel.innerHTML = '<option value="">— 船会社を選択 —</option>' +
    Object.keys(CARRIERS).map(n => `<option value="${n}">${n}</option>`).join('');
}

// result-box に URL をセット
function showResult(boxId, urlId, linkId, url) {
  document.getElementById(urlId).textContent = url;
  document.getElementById(linkId).href = url;
  document.getElementById(boxId).classList.add('show');
}

// URL未登録時のフォールバック
function openTopFallback(carrier, featureName) {
  alert(`${carrier} の${featureName}URLは未登録です。\nトップページを開きます。`);
  window.open(CARRIERS[carrier].top, '_blank');
}

// ================================================================
//  Tab 1: コンテナ追跡
// ================================================================
document.getElementById('ql-carrier').addEventListener('change', updateQL);
document.getElementById('ql-number').addEventListener('input', updateQL);
document.getElementById('ql-number').addEventListener('keydown', e => { if (e.key === 'Enter') quickLookup(); });

function updateQL() {
  const carrier = document.getElementById('ql-carrier').value;
  const num     = document.getElementById('ql-number').value.trim();
  if (carrier && num) {
    const url = CARRIERS[carrier].tracking(encodeURIComponent(num));
    showResult('ql-result', 'ql-url', 'ql-link', url);
  } else {
    document.getElementById('ql-result').classList.remove('show');
  }
}

function quickLookup() {
  const carrier = document.getElementById('ql-carrier').value;
  const num     = document.getElementById('ql-number').value.trim();
  if (!carrier) { alert('船会社を選択してください'); return; }
  if (!num)     { alert('コンテナ番号またはB/L番号を入力してください'); return; }
  const info = CARRIERS[carrier];
  if (info.trackingDisabled) {
    alert(carrier + ' のトラッキングURLは現在調査中です。しばらくお待ちください。');
    return;
  }
  saveTrackingHistory(carrier, num);
  if (info.trackingClipboard) {
    const relayUrl = 'relay.html?carrier=' + encodeURIComponent(carrier)
      + '&num=' + encodeURIComponent(num)
      + '&url=' + encodeURIComponent(info.tracking(num))
      + '&icon=' + encodeURIComponent(info.icon);
    window.open(relayUrl, '_blank');
    return;
  }
  window.open(info.tracking(encodeURIComponent(num)), '_blank');
}


function buildCarrierGrid() {
  const grid = document.getElementById('carrier-grid');
  for (const [name, info] of Object.entries(CARRIERS)) {
    const card = document.createElement('div');
    let badge = '';
    if (info.trackingVerified)  badge = '<div class="verified-badge">✅ 追跡確認済</div>';
    if (info.trackingClipboard) badge = '<div class="clipboard-badge">📋 番号コピー→貼付</div>';
    if (info.trackingDisabled)  badge = '<div class="disabled-badge">🚧 URL調査中</div>';
    card.className = 'carrier-card' + (info.trackingDisabled ? ' tracking-disabled' : '');
    card.innerHTML = `<div class="name">${name}</div><div class="domain">${info.domain}</div>${badge}`;
    card.onclick = () => {
      if (info.trackingDisabled) return;
      const num = document.getElementById('ql-number').value.trim();
      if (info.trackingClipboard) {
        if (!num) { window.open(info.top, '_blank'); return; }
        const relayUrl = 'relay.html?carrier=' + encodeURIComponent(name)
          + '&num=' + encodeURIComponent(num)
          + '&url=' + encodeURIComponent(info.tracking(num))
          + '&icon=' + encodeURIComponent(info.icon);
        window.open(relayUrl, '_blank');
        return;
      }
      window.open(num ? info.tracking(encodeURIComponent(num)) : info.top, '_blank');
    };
    grid.appendChild(card);
  }
}

// ================================================================
//  Tab 2: 本船動静
// ================================================================
function buildVesselGrid() {
  // 国内動静ポータル
  const portalGrid = document.getElementById('vessel-portal-grid');
  for (const p of VESSEL_PORTALS) {
    const btn = document.createElement('a');
    btn.href = p.url;
    btn.target = '_blank';
    btn.rel = 'noopener noreferrer';
    btn.style.cssText = 'display:inline-flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:14px 20px;background:#fff;border:1px solid #d9cfc2;border-radius:9px;text-decoration:none;color:#3d2e1e;font-weight:600;font-size:13px;min-width:160px;transition:background 0.15s;';
    btn.onmouseover = () => { btn.style.background = '#f0e8d8'; btn.style.borderColor = '#6b5a42'; };
    btn.onmouseout  = () => { btn.style.background = '#fff'; btn.style.borderColor = '#d9cfc2'; };
    const noteHtml = p.note ? `<span style="font-size:11px;font-weight:400;color:#5a6e42;background:#eaedd8;border-radius:4px;padding:2px 6px;margin-top:2px;">${p.note}</span>` : '';
    btn.innerHTML = `<span>${p.name}</span><span style="font-size:11px;font-weight:400;color:#7d6b56;">${p.desc}</span>${noteHtml}`;
    portalGrid.appendChild(btn);
  }

  // VSS移行済み船会社の直接リンクカード
  const vssGrid = document.getElementById('vss-carrier-grid');
  if (vssGrid && typeof VSS_CARRIERS !== 'undefined') {
    for (const v of VSS_CARRIERS) {
      const info = CARRIERS[v.name] || {};
      const card = document.createElement('div');
      card.className = 'carrier-card';
      const domain = info.domain || 'vessel-schedule-service.com';
      card.innerHTML = `<div class="name">${v.name}</div><div class="domain">${domain}</div><div class="vss-badge">VSS ↗</div>`;
      card.onclick = () => window.open(v.url, '_blank', 'noopener');
      vssGrid.appendChild(card);
    }
  }

  // 船会社別サービス航路グリッド
  const routeCarrierGrid = document.getElementById('route-carrier-grid');
  if (routeCarrierGrid) {
    for (const [name, info] of Object.entries(CARRIERS)) {
      const card = document.createElement('div');
      const hasUrl = !!info.routePage;
      let badge = '';
      if (!hasUrl) badge = '<div class="disabled-badge">未登録</div>';
      card.className = 'carrier-card' + (!hasUrl ? ' tracking-disabled' : '');
      card.innerHTML = `<div class="name">${name}</div><div class="domain">${info.domain}</div>${badge}`;
      if (hasUrl) card.onclick = () => window.open(info.routePage, '_blank');
      routeCarrierGrid.appendChild(card);
    }
  }

  // CY OPEN/CUTグリッド
  const cycutGrid = document.getElementById('cycut-grid');
  for (const [name, info] of Object.entries(CARRIERS)) {
    const card = document.createElement('div');
    const hasUrl = !!info.cycut;
    let badge = '';
    if (!hasUrl) badge = '<div class="disabled-badge">未登録</div>';
    const noteInfo = info.cycutNote ? `<div style="font-size:10px;color:#744210;background:#fefcbf;border-radius:3px;padding:1px 5px;margin-top:3px;line-height:1.4;">${info.cycutNote}</div>` : '';
    card.className = 'carrier-card' + (!hasUrl ? ' tracking-disabled' : '');
    card.innerHTML = `<div class="name">${name}</div><div class="domain">${info.domain}</div>${noteInfo}${badge}`;
    if (hasUrl) {
      card.onclick = () => window.open(info.cycut, '_blank');
    }
    cycutGrid.appendChild(card);
  }

  // 船会社グリッド
  const grid = document.getElementById('vessel-grid');
  for (const [name, info] of Object.entries(CARRIERS)) {
    const card = document.createElement('div');
    const hasUrl = !!info.vessel;
    let badge = '';
    if (!hasUrl) badge = '<div class="disabled-badge">該当ページなし</div>';
    card.className = 'carrier-card' + (!hasUrl ? ' tracking-disabled' : '');
    card.innerHTML = `<div class="name">${name}</div><div class="domain">${info.domain}</div>${badge}`;
    if (hasUrl) {
      card.onclick = () => window.open(info.vessel(), '_blank');
    }
    grid.appendChild(card);
  }
}

// ================================================================
//  サービス航路: Notionから航路記事を取得して表示
// ================================================================
async function loadRouteArticles() {
  const container = document.getElementById('route-articles');
  if (!container) return;
  try {
    const res = await fetch('/.netlify/functions/routes');
    if (!res.ok) throw new Error('fetch failed');
    const pages = await res.json();
    if (!Array.isArray(pages) || pages.length === 0) {
      container.innerHTML = '<div style="color:var(--text-lt);font-size:13px;padding:8px 0;">航路記事はまだありません。</div>';
      return;
    }
    container.innerHTML = pages.map(p => `
      <a class="route-card" href="${p.publicUrl}" target="_blank" rel="noopener noreferrer">
        <div class="route-card-title">🗺️ ${p.title}</div>
        <div class="route-card-meta">${p.createdAt ? new Date(p.createdAt).toLocaleDateString('ja-JP') : ''}</div>
      </a>
    `).join('');
  } catch (e) {
    container.innerHTML = '<div style="color:#b04040;font-size:13px;padding:8px 0;">⚠️ 記事の読み込みに失敗しました。</div>';
  }
}

// ================================================================
//  Tab 3: 航路・運賃
// ================================================================
function schedLookup() {
  const carrier = document.getElementById('sched-carrier').value;
  const pol     = document.getElementById('sched-pol').value.trim();
  const pod     = document.getElementById('sched-pod').value.trim();
  if (!carrier) { alert('船会社を選択してください'); return; }
  const fn = CARRIERS[carrier].schedule;
  if (!fn) { openTopFallback(carrier, '航路検索'); return; }
  const url = fn(encodeURIComponent(pol), encodeURIComponent(pod));
  showResult('sched-result', 'sched-url', 'sched-link', url);
  window.open(url, '_blank');
}

function buildSurchargeGrids() {
  const defs = [
    { id: 'surcharge-import-grid', key: 'surchargeImport', label: '輸入サーチャージ' },
    { id: 'surcharge-export-grid', key: 'surchargeExport', label: '輸出サーチャージ' },
    { id: 'surcharge-other-grid',  key: 'surchargeOther',  label: 'その他サーチャージ' },
  ];
  for (const def of defs) {
    const grid = document.getElementById(def.id);
    if (!grid) continue;
    for (const [name, info] of Object.entries(CARRIERS)) {
      const card = document.createElement('div');
      const hasUrl = !!info[def.key];
      let badge = '';
      if (!hasUrl) badge = '<div class="disabled-badge">未登録</div>';
      const noteKey = def.key + 'Note';
      const noteInfo = info[noteKey] ? `<div style="font-size:10px;color:#744210;background:#fefcbf;border-radius:3px;padding:1px 5px;margin-top:3px;line-height:1.4;">${info[noteKey]}</div>` : '';
      card.className = 'carrier-card' + (!hasUrl ? ' tracking-disabled' : '');
      card.innerHTML = `<div class="name">${name}</div><div class="domain">${info.domain}</div>${noteInfo}${badge}`;
      if (hasUrl) card.onclick = () => window.open(typeof info[def.key] === 'function' ? info[def.key]() : info[def.key], '_blank');
      grid.appendChild(card);
    }
  }
}

// ================================================================
//  Tab: インコタームズ
//  (INCO_STAGES, INCO_DATA は data/incoterms.js から読み込む)
// ================================================================
function buildIncotermsTab() {
  // ステージボタン生成
  ['export','import'].forEach(group => {
    const container = document.getElementById('inco-stages-' + group);
    INCO_STAGES.filter(s => s.group === group).forEach(stage => {
      const btn = document.createElement('button');
      btn.className = 'inco-stage-btn';
      btn.dataset.key = stage.key;
      btn.textContent = stage.label;
      btn.onclick = () => btn.classList.toggle('selected');
      container.appendChild(btn);
    });
  });

  // 一覧表生成
  const table = document.getElementById('inco-table');
  const stageLabels = ['梱包','陸送↑','輸出通関','本船積込','運賃','保険','陸送↓','輸入通関','関税'];

  // ヘッダー
  const thead = table.createTHead();
  const tr1 = thead.insertRow();
  [
    { text:'条件', span:1, cls:'' },
    { text:'正式名称', span:1, cls:'' },
    { text:'← 輸出側の作業 →', span:6, cls:'stage-group-ex' },
    { text:'← 輸入側の作業 →', span:3, cls:'stage-group-im' },
    { text:'輸送', span:1, cls:'' },
  ].forEach(h => {
    const th = document.createElement('th');
    th.textContent = h.text;
    th.colSpan = h.span;
    if (h.cls) th.className = h.cls;
    tr1.appendChild(th);
  });
  const tr2 = thead.insertRow();
  ['','', ...stageLabels, ''].forEach((lbl, i) => {
    const th = document.createElement('th');
    th.textContent = lbl;
    if (i >= 2 && i <= 7) th.className = 'stage-group-ex';
    if (i >= 8 && i <= 10) th.className = 'stage-group-im';
    tr2.appendChild(th);
  });

  // データ行
  const tbody = table.createTBody();
  INCO_DATA.forEach(inc => {
    const row = tbody.insertRow();
    // 条件コード
    const codeTd = row.insertCell(); codeTd.className = 'code-cell'; codeTd.textContent = inc.code;
    // 正式名称
    const nameTd = row.insertCell(); nameTd.className = 'name-cell'; nameTd.textContent = inc.name;
    // 各ステージ
    inc.seller.forEach(v => {
      const td = row.insertCell();
      td.className = v ? 'seller' : 'buyer';
      td.textContent = v ? '売' : '買';
    });
    // 輸送モード
    const modeTd = row.insertCell();
    modeTd.className = 'mode-cell';
    modeTd.innerHTML = inc.mode === 'sea'
      ? '<span class="inco-mode-tag sea">海上のみ</span>'
      : '<span class="inco-mode-tag all">全輸送</span>';
  });
}

function judgeIncoterms() {
  const selected = {};
  document.querySelectorAll('.inco-stage-btn').forEach(btn => {
    selected[btn.dataset.key] = btn.classList.contains('selected') ? 1 : 0;
  });
  const userVec = INCO_STAGES.map(s => selected[s.key]);

  const matches = INCO_DATA.filter(inc =>
    inc.seller.every((v, i) => v === userVec[i])
  );

  const resultDiv = document.getElementById('inco-result');
  if (matches.length === 0) {
    resultDiv.innerHTML = '<p style="color:var(--text-lt);font-size:13px;padding:10px 0;">一致するインコタームズが見つかりませんでした。<br>作業の組み合わせを確認してください。</p>';
    return;
  }

  const cards = matches.map(inc => `
    <div class="inco-result-card">
      <div class="inco-result-code">${inc.code}</div>
      <div class="inco-result-name">${inc.name}</div>
      <div class="inco-result-note">${inc.note}</div>
      <span class="inco-mode-tag ${inc.mode}">${inc.mode === 'sea' ? '海上輸送専用' : '全輸送モード対応'}</span>
    </div>
  `).join('');

  resultDiv.innerHTML = `
    <p style="font-size:12px;font-weight:700;color:var(--accent-dk);margin-bottom:8px;">
      該当するインコタームズ（${matches.length}件）
    </p>
    <div class="inco-results-wrap">${cards}</div>
  `;
}

function resetIncoterms() {
  document.querySelectorAll('.inco-stage-btn').forEach(btn => btn.classList.remove('selected'));
  document.getElementById('inco-result').innerHTML = '';
}

// ================================================================
//  Tab 4: 書類（輸入申請 / 輸出申請）
// ================================================================
function buildBldoGrids() {
  const defs = [
    { id: 'bldo-import-grid', dataFn: info => info.do_, label: '輸入申請' },
    { id: 'bldo-export-grid', dataFn: info => info.bl,  label: '輸出申請' },
  ];
  for (const def of defs) {
    const grid = document.getElementById(def.id);
    if (!grid) continue;
    for (const [name, info] of Object.entries(CARRIERS)) {
      const card = document.createElement('div');
      const data = def.dataFn(info);
      const hasUrl = !!(data && data.url);
      let badge = '';
      if (!hasUrl) badge = '<div class="disabled-badge">未登録</div>';
      const noteInfo = (data && data.note) ? `<div style="font-size:10px;color:#744210;background:#fefcbf;border-radius:3px;padding:1px 5px;margin-top:3px;line-height:1.4;">${data.note}</div>` : '';
      card.className = 'carrier-card' + (!hasUrl ? ' tracking-disabled' : '');
      card.innerHTML = `<div class="name">${name}</div><div class="domain">${info.domain}</div>${noteInfo}${badge}`;
      if (hasUrl) card.onclick = () => window.open(data.url, '_blank');
      grid.appendChild(card);
    }
  }
}

// ================================================================
//  Tab 4: BL/DO 手続き
// ================================================================
let currentProcType = 'bl';

function setProcType(type) {
  currentProcType = type;
  document.getElementById('proc-bl-btn').classList.toggle('active', type === 'bl');
  document.getElementById('proc-do-btn').classList.toggle('active', type === 'do');
  document.getElementById('proc-result').innerHTML = '';
  document.getElementById('proc-carrier').value = '';
}

function procLookup() {
  const carrier = document.getElementById('proc-carrier').value;
  if (!carrier) { alert('船会社を選択してください'); return; }

  const data      = currentProcType === 'bl' ? CARRIERS[carrier].bl : CARRIERS[carrier].do_;
  const typeLabel = currentProcType === 'bl' ? 'BL発行依頼' : 'DO発行依頼';
  const hasUrl    = !!data.url;
  const hasSteps  = data.steps && data.steps.length > 0;

  const stepsHtml = hasSteps
    ? `<ol class="guidance-steps">${data.steps.map(s => `<li>${s}</li>`).join('')}</ol>`
    : `<p style="color:#a0aec0;font-size:13px;padding:8px 0;">📌 手順・ガイダンス未登録です。代理店または担当者に直接ご確認ください。</p>`;

  document.getElementById('proc-result').innerHTML = `
    <div class="guidance-card">
      <div class="guidance-header">
        <span class="guidance-title">${CARRIERS[carrier].icon} ${carrier} — ${typeLabel}</span>
        ${hasUrl
          ? `<span class="badge-ok">✅ 手順書あり</span>`
          : `<span class="badge-na">⚠️ 案内ページ未登録</span>`}
      </div>
      ${hasUrl ? `<p style="margin-bottom:12px;"><a class="btn-open" href="${data.url}" target="_blank">手順書を開く ↗</a></p>` : ''}
      ${stepsHtml}
    </div>`;
}

// ================================================================
//  Tab 5: BL記載事項
// ================================================================
function buildBlRulesGrid() {
  const grid = document.getElementById('blrules-grid');
  grid.innerHTML = Object.entries(CARRIERS).map(([name, info]) => `
    <div class="blrules-card">
      <div class="blrules-carrier">${name}</div>
      ${info.blrules
        ? `<a class="blrules-link" href="${info.blrules}" target="_blank">📄 案内ページ ↗</a>`
        : `<span class="blrules-na">未登録</span>`}
    </div>`).join('');
}

// ================================================================
//  Tab 6: フリータイム
// ================================================================
function freetimeLookup() {
  const carrier = document.getElementById('ft-carrier').value;
  const num     = document.getElementById('ft-number').value.trim();
  if (!carrier) { alert('船会社を選択してください'); return; }
  if (!num)     { alert('コンテナ番号を入力してください'); return; }
  const fn = CARRIERS[carrier].freetime;
  if (!fn) { openTopFallback(carrier, 'フリータイム検索'); return; }
  const url = fn(encodeURIComponent(num));
  showResult('ft-result', 'ft-url', 'ft-link', url);
  window.open(url, '_blank');
}

// ================================================================
//  初期化
// ================================================================
['ql-carrier', 'sched-carrier',
 'surcharge-carrier', 'ft-carrier'].forEach(populateSelect);

buildCarrierGrid();
buildVesselGrid();
buildSurchargeGrids();
buildBldoGrids();
buildIncotermsTab();
loadRouteArticles();
buildBlRulesGrid();

// ================================================================
//  追跡番号 履歴スタック
// ================================================================
const TRACK_HIST_KEY = SharedStorage.KEYS.TRACKING_HISTORY;
const TRACK_HIST_MAX = 5;

function loadTrackingHistory() {
  return SharedStorage.getJSON(TRACK_HIST_KEY, []) || [];
}
function saveTrackingHistory(carrier, num) {
  let hist = loadTrackingHistory();
  hist = hist.filter(h => !(h.carrier === carrier && h.num === num));
  hist.unshift({ carrier, num, ts: new Date().toLocaleDateString('ja-JP') });
  hist = hist.slice(0, TRACK_HIST_MAX);
  SharedStorage.setJSON(TRACK_HIST_KEY, hist);
  renderTrackingHistory();
}
function deleteTrackingHistory(idx) {
  const hist = loadTrackingHistory();
  hist.splice(idx, 1);
  SharedStorage.setJSON(TRACK_HIST_KEY, hist);
  renderTrackingHistory();
}
function renderTrackingHistory() {
  const wrap = document.getElementById('track-history-wrap');
  if (!wrap) return;
  const hist = loadTrackingHistory();
  if (hist.length === 0) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  const list = document.getElementById('track-history-list');
  list.innerHTML = hist.map((h, i) => `
    <div class="track-history-item" onclick="applyTrackingHistory(${i})">
      <span class="track-history-num">${h.num}</span>
      <span class="track-history-carr">${h.carrier}</span>
      <span class="track-history-date">${h.ts}</span>
      <button class="track-history-del" onclick="event.stopPropagation();deleteTrackingHistory(${i})" title="削除">×</button>
    </div>`).join('');
}
function applyTrackingHistory(idx) {
  const hist = loadTrackingHistory();
  const h = hist[idx];
  if (!h) return;
  document.getElementById('ql-carrier').value = h.carrier;
  document.getElementById('ql-number').value  = h.num;
  quickLookup();
}
renderTrackingHistory();

// ================================================================
//  e-Booking グリッド
//  (BOOKING_URLS は data/carriers.js から読み込む)
// ================================================================
function buildBookingGrid() {
  const grid = document.getElementById('booking-grid');
  if (!grid) return;
  Object.entries(BOOKING_URLS).forEach(([name, info]) => {
    const carrier = CARRIERS[name] || {};
    const hasUrl = !!info.url;
    const card = document.createElement('div');
    card.className = 'carrier-card' + (hasUrl ? '' : ' tracking-disabled');
    card.innerHTML = '<div class="name">' + name + '</div>'
      + '<div class="domain">' + (carrier.domain || '') + '</div>'
      + '<div style="font-size:10px;color:' + (hasUrl ? 'var(--text-md)' : '#e53e3e') + ';margin-top:4px;">' + info.note + '</div>'
      + (!hasUrl ? '<div class="disabled-badge">未登録</div>' : '');
    if (hasUrl) card.onclick = () => window.open(info.url, '_blank');
    grid.appendChild(card);
  });
}
buildBookingGrid();

// ================================================================
//  最終更新日の表示
// ================================================================
(function() {
  const el = document.getElementById('last-updated');
  if (!el) return;
  const d = new Date(document.lastModified);
  if (isNaN(d.getTime())) return;
  el.textContent = d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric' });
})();

// ================================================================
//  セクション別フィードバック
//
//  Phase 2c-Step6（2026-05-18）: フィードバック構造を統合
//  - 旧 .section-fb アコーディオン UI / postToGoogleForm 経由送信 を廃止
//  - 旧 #feedback-overlay モーダル系関数（HTML 不在で完全な dead code）削除
//  - 各カードの末尾に .fb-section-btn を注入し、サイト全体スコープの
//    openFeedback(label) （js/quote/save.js）でモーダルを起動
//  - 見積タブ（#tab-quote-make）は HTML にハードコード済みなのでスキップ
// ================================================================
const SECTION_FB_TAB_NAMES = {
  'tracking':    'コンテナ追跡',
  'vessel':      '本船動静',
  'cycut':       'CY OPEN/CUT',
  'route':       'サービス航路',
  'surcharge':   'サーチャージ',
  'bldo':        '書類',
  'blrules':     'BL記載事項',
  'freetime':    'フリータイム',
  'incoterms':   'インコタームズ',
  'sizes':       '種類・サイズ',
  'insurance':   '海上貨物保険',
  'blclause':    'BL約款',
  'regs':        '貿易管理令・他法令',
  'booking-tab': 'Booking',
  'si':          'S/I',
  'filing':      'ファイリングルール',
  'calc':        '計算（サイズ）',
  'rate':        '計算（お金）',
};

function getSectionName(titleEl) {
  // テキストノードのみを連結して、絵文字・記号を除去
  let text = Array.from(titleEl.childNodes)
    .filter(n => n.nodeType === Node.TEXT_NODE)
    .map(n => n.textContent)
    .join('')
    .trim();
  // 先頭の絵文字・記号・空白を除去
  text = text.replace(/^[ -\s]*/, '').trim();  // ASCII記号除去
  // Unicodeの絵文字を除去
  text = text.replace(/[\u{1F300}-\u{1FFFF}\u{2600}-\u{27BF}]/gu, '').trim();
  // 連続空白を整理
  text = text.replace(/\s+/g, ' ').trim();
  return text || titleEl.textContent.trim().slice(0, 30);
}

function initSectionFeedbacks() {
  document.querySelectorAll('.tab-content .card').forEach(card => {
    const titleEl = card.querySelector('.section-title');
    if (!titleEl) return;
    // 既に .fb-section-btn が置かれているセクション（見積タブ）はスキップ
    if (card.querySelector('.fb-section-btn')) return;
    const tabEl = card.closest('.tab-content');
    if (!tabEl) return;

    const tabKey = tabEl.id.replace(/^tab-/, '');
    const tabName = SECTION_FB_TAB_NAMES[tabKey] || tabKey;
    const sectionName = getSectionName(titleEl);
    const label = sectionName ? `${tabName} › ${sectionName}` : tabName;

    const esc = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    card.insertAdjacentHTML('beforeend', `
      <div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border);text-align:left;">
        <button class="fb-section-btn" onclick="openFeedback('${esc(label)}')">💬 このセクションへのフィードバック</button>
      </div>
    `);
  });
}

document.addEventListener('DOMContentLoaded', initSectionFeedbacks);

