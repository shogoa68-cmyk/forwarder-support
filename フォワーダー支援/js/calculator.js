// ================================================================
//  計算ツール関連関数
//  依存: なし（スタンドアロン）
// ================================================================

// ================================================================
//  荷姿・段積みフィールドの注入（全 calc-multi-row へ動的追加）
// ================================================================

const PACKING_OPTIONS = [
  { v: '',                  l: '— 未指定 —' },
  { v: 'ダンボール',        l: '📦 ダンボール' },
  { v: '木箱',              l: '📦 木箱' },
  { v: '木枠（クレート）',  l: '📦 木枠（クレート）' },
  { v: 'パレット積み',      l: '🔲 パレット積み' },
  { v: 'ドラム缶',          l: '🛢 ドラム缶' },
  { v: '袋（バッグ）',      l: '👜 袋（バッグ）' },
  { v: '鋼材・コイル',      l: '🔩 鋼材・コイル' },
  { v: 'バラ積み',          l: '📤 バラ積み' },
  { v: 'その他',            l: '🔧 その他' }
];

// セクション別に除外する荷姿（パレタイズに不適切なもの等）
const PACKING_EXCLUDE_BY_SECTION = {
  // パレタイズ：パレット上にパレットは積まない／バラ積みはパレット化と矛盾
  pal: ['パレット積み', 'バラ積み']
};

function _buildPackingFieldHtml(section) {
  const excluded = new Set(PACKING_EXCLUDE_BY_SECTION[section] || []);
  const opts = PACKING_OPTIONS.filter(o => !excluded.has(o.v));
  return '<div class="calc-field" data-aux="packing">'
    + '<span class="calc-label">荷姿</span>'
    + '<select class="calc-select" data-key="packing">'
    +   opts.map(o => `<option value="${o.v}">${o.l}</option>`).join('')
    + '</select>'
    + '</div>';
}

function _buildStackFieldHtml() {
  return '<div class="calc-field" data-aux="stack">'
    + '<span class="calc-label">段積み</span>'
    + '<select class="calc-select" data-key="stack">'
    +   '<option value="ok">⬆ 可</option>'
    +   '<option value="ng">⛔ 不可</option>'
    + '</select>'
    + '</div>';
}

function _getSectionPrefix(row) {
  const wrap = row.closest('[id$="-rows-wrap"]');
  if (!wrap) return '';
  return wrap.id.replace('-rows-wrap', '');
}

function injectAuxCalcFields(row) {
  if (!row || row.dataset._auxInjected === '1') return;
  if (row.querySelector('[data-key="packing"]')) { row.dataset._auxInjected = '1'; return; }
  const anchor = row.querySelector('[data-key="qty"], [data-key="total"]')?.closest('.calc-field');
  if (!anchor) return;
  const section = _getSectionPrefix(row);
  const tmp = document.createElement('div');
  tmp.innerHTML = _buildPackingFieldHtml(section) + _buildStackFieldHtml();
  while (tmp.firstChild) anchor.parentNode.insertBefore(tmp.firstChild, anchor);
  row.dataset._auxInjected = '1';
}

function injectAllAuxCalcFields() {
  document.querySelectorAll('.calc-multi-row').forEach(injectAuxCalcFields);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectAllAuxCalcFields);
  } else {
    injectAllAuxCalcFields();
  }
}

// 行から荷姿・段積み・寸法ラベルを取得
function getRowMeta(row, unit) {
  const packing = row.querySelector('[data-key="packing"]')?.value || '';
  const stack   = row.querySelector('[data-key="stack"]')?.value || 'ok';
  return { packing, stack, stackLabel: stack === 'ng' ? '段積み不可' : '段積み可' };
}

// 単位変換係数を取得（選択された unit から target unit への倍率）
// 例：選択=cm, target=mm → 10　／　選択=in, target=cm → 2.54
const _UNIT_TO_MM = { cm: 10, mm: 1, in: 25.4, m: 1000 };
function getUnitConversion(selectId, targetUnit) {
  const unit = document.getElementById(selectId)?.value || targetUnit;
  const from = _UNIT_TO_MM[unit];
  const to   = _UNIT_TO_MM[targetUnit];
  if (!from || !to) return { unit: targetUnit, factor: 1 };
  return { unit, factor: from / to };
}

// 結果表示用の入力情報サマリー文字列（例：60×40×30cm / 5kg / ダンボール / 段積み可 × 10個）
function formatRowInputSummary(parts) {
  return parts.filter(Boolean).join(' / ');
}

// 単品モード用の「入力情報」エコーブロック
function renderInputEcho(text) {
  return '<div class="calc-input-echo">📥 入力：' + text + '</div>';
}

// ================================================================
//  計算結果ヘルパー
// ================================================================

function appendCalcResult(id, html, summary) {
  const container = document.getElementById(id);
  container.style.display = 'block';
  const n = container.querySelectorAll('.calc-history-entry').length + 1;
  const entry = document.createElement('div');
  entry.className = 'calc-history-entry';
  entry.innerHTML = `<div class="calc-history-header">
      <span class="calc-history-num">#${n}</span>
      <span class="calc-history-summary">${summary||''}</span>
      <button class="btn-copy-result" onclick="copyCalcResult(this)" title="整形テキストをコピー">📋 コピー</button>
      <button class="btn-send-to-quote" onclick="sendCalcResultToQuote(this)" title="見積もりタブの「特記事項・補足（自由入力）」へ追記">📝 見積もりへ</button>
      <button class="calc-history-close" onclick="const e=this.closest('.calc-history-entry'),c=e.parentElement;e.remove();if(!c.querySelector('.calc-history-entry'))c.style.display='none'">×</button>
    </div>${html}`;
  container.insertBefore(entry, container.firstChild);
}
function clearCalcResult(id) {
  const el = document.getElementById(id);
  el.innerHTML = ''; el.style.display = 'none';
}

// 計算結果エントリから整形テキストを生成（copyCalcResult と sendCalcResultToQuote で共有）
function formatCalcResultAsText(entry) {
  const num     = entry.querySelector('.calc-history-num')?.textContent?.trim() || '';
  const summary = entry.querySelector('.calc-history-summary')?.textContent?.trim() || '';
  const lines   = [`【計算結果 ${num}】`];
  if (summary) lines.push(`入力: ${summary}`);
  // 入力情報エコー（単品モード）— summary と重複しない場合のみ追加
  entry.querySelectorAll('.calc-input-echo').forEach(el => {
    const t = el.textContent.trim().replace(/^📥\s*入力：?\s*/, '');
    if (t && t !== summary) lines.push(`入力: ${t}`);
  });
  // 複数行モードの行ラベル＋直後の calc-item ペアを構造化して並べる
  const rowLabels = entry.querySelectorAll('.calc-row-label');
  if (rowLabels.length > 0) {
    rowLabels.forEach(rl => {
      lines.push(`▼ ${rl.textContent.trim()}`);
      // 同じ親内の calc-item を子要素として収集
      const container = rl.parentElement;
      if (container) {
        container.querySelectorAll('.calc-item').forEach(item => {
          const lbl = item.querySelector('.calc-item-label')?.textContent?.trim();
          const val = item.querySelector('.calc-item-value')?.textContent?.trim();
          if (lbl && val) lines.push(`　・${lbl}: ${val}`);
        });
      }
    });
    // 合計行（calc-row-label の親に含まれない最終 calc-item）も拾う
    const seen = new Set();
    entry.querySelectorAll('.calc-row-label').forEach(rl => {
      rl.parentElement?.querySelectorAll('.calc-item').forEach(i => seen.add(i));
    });
    entry.querySelectorAll('.calc-item').forEach(item => {
      if (seen.has(item)) return;
      const lbl = item.querySelector('.calc-item-label')?.textContent?.trim();
      const val = item.querySelector('.calc-item-value')?.textContent?.trim();
      if (lbl && val) lines.push(`・${lbl}: ${val}`);
    });
  } else {
    // 単品モード：従来通り全 calc-item を順に
    entry.querySelectorAll('.calc-item').forEach(item => {
      const lbl = item.querySelector('.calc-item-label')?.textContent?.trim();
      const val = item.querySelector('.calc-item-value')?.textContent?.trim();
      if (lbl && val) lines.push(`・${lbl}: ${val}`);
    });
  }
  // テーブル形式（保険料・関税計算など）
  entry.querySelectorAll('tr').forEach(tr => {
    const tds = tr.querySelectorAll('td');
    if (tds.length >= 2) {
      const lbl = tds[0]?.textContent?.trim();
      const val = tds[1]?.textContent?.trim();
      if (lbl && val) lines.push(`・${lbl}: ${val}`);
    }
  });
  return lines.join('\n');
}

function copyCalcResult(btn) {
  const entry = btn.closest('.calc-history-entry');
  const text = formatCalcResultAsText(entry);
  const orig = btn.textContent;
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = '✅ コピー完了';
    btn.style.cssText += 'border-color:#5a8a52;color:#3a5c36;';
    setTimeout(() => { btn.textContent = orig; btn.style.borderColor = ''; btn.style.color = ''; }, 1800);
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    btn.textContent = '✅ コピー完了';
    setTimeout(() => { btn.textContent = orig; }, 1800);
  });
}

// 計算結果を見積もりタブの「特記事項・補足（自由入力）」へ追記し、タブ切替してスクロール
function sendCalcResultToQuote(btn) {
  const entry = btn.closest('.calc-history-entry');
  const text  = formatCalcResultAsText(entry);

  // 見積もりタブを表示状態にする（switchCategory が初回 sub-tab を click して initQuoteTab を呼ぶ）
  const quoteCatBtn = document.querySelector('.cat-btn-featured');
  if (quoteCatBtn && typeof switchCategory === 'function') {
    switchCategory('quote', quoteCatBtn);
  }

  // textarea へ追記（既存内容を残し、空行区切りで末尾追加）
  const ta = document.getElementById('condFreeText');
  if (!ta) {
    // フォールバック：見積もりタブが描画されていない極稀ケース
    if (typeof quoteShowToast === 'function') {
      quoteShowToast('⚠️ 自由入力欄が見つかりません', 'warn');
    } else {
      alert('自由入力欄が見つかりません');
    }
    return;
  }
  const sep = ta.value.trim() ? '\n\n' : '';
  ta.value = ta.value + sep + text;
  // 自動保存・文字数カウントなどの監視に通知
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  ta.dispatchEvent(new Event('change', { bubbles: true }));

  // 自由入力欄へスクロール＋ハイライト
  const section = document.getElementById('section-free') || ta;
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  ta.classList.add('flash-reflect');
  setTimeout(() => ta.classList.remove('flash-reflect'), 1200);

  // フィードバック表示
  const orig = btn.textContent;
  btn.textContent = '✅ 追記しました';
  btn.style.cssText += 'border-color:#5a8a52;color:#3a5c36;';
  setTimeout(() => { btn.textContent = orig; btn.style.borderColor = ''; btn.style.color = ''; }, 1800);
  if (typeof quoteShowToast === 'function') {
    quoteShowToast('📝 自由入力欄へ計算結果を追記しました', 'success');
  }
}

// ================================================================
//  複数行管理ユーティリティ
// ================================================================

function addCalcRow(prefix) {
  const wrap = document.getElementById(prefix + '-rows-wrap');
  const rows = wrap.querySelectorAll('.calc-multi-row');
  const tpl  = rows[0].cloneNode(true);
  // 入力値をリセット
  tpl.querySelectorAll('input[type="number"]').forEach(inp => {
    const key = inp.dataset.key;
    if (key === 'qty' || key === 'layers') { inp.value = '1'; }
    else { inp.value = ''; }
  });
  // 荷姿・段積みのセレクトを既定値へ戻す
  tpl.querySelectorAll('select[data-key]').forEach(sel => {
    const key = sel.dataset.key;
    if (key === 'packing') sel.value = '';
    else if (key === 'stack') sel.value = 'ok';
  });
  // 削除ボタンを表示
  const del = tpl.querySelector('.btn-row-del');
  if (del) del.style.display = '';
  wrap.appendChild(tpl);
  updateRowNums(wrap);
  // 追加した行にフォーカス
  const first = tpl.querySelector('input[type="number"]');
  if (first) first.focus();
}

function removeCalcRow(btn) {
  const row  = btn.closest('.calc-multi-row');
  const wrap = row.parentElement;
  if (wrap.querySelectorAll('.calc-multi-row').length <= 1) return;
  row.remove();
  updateRowNums(wrap);
}

function updateRowNums(wrap) {
  const rows = wrap.querySelectorAll('.calc-multi-row');
  rows.forEach((row, i) => {
    const numEl = row.querySelector('.row-num');
    if (numEl) numEl.textContent = i + 1;
    const del = row.querySelector('.btn-row-del');
    if (del) del.style.display = rows.length > 1 ? '' : 'none';
  });
}

// ================================================================
//  航空 CW 計算
// ================================================================

function calcAirCW() {
  const { unit, factor } = getUnitConversion('air-unit', 'cm');
  const wrap = document.getElementById('air-rows-wrap');
  const rows = wrap.querySelectorAll('.calc-multi-row');
  const results = [];
  for (const row of rows) {
    const lInput = parseFloat(row.querySelector('[data-key="l"]').value);
    const wInput = parseFloat(row.querySelector('[data-key="w"]').value);
    const hInput = parseFloat(row.querySelector('[data-key="h"]').value);
    const weight = parseFloat(row.querySelector('[data-key="weight"]').value);
    const qty    = parseInt(row.querySelector('[data-key="qty"]').value) || 1;
    if ([lInput,wInput,hInput,weight].some(isNaN)) continue;
    const meta  = getRowMeta(row);
    // cm 換算で計算式に投入（IATA 基準は cm ベース）
    const l = lInput * factor, w = wInput * factor, h = hInput * factor;
    const volW1 = (l*w*h) / 6000;
    const cw1   = Math.max(volW1, weight);
    results.push({ l, w, h, lInput, wInput, hInput, weight, qty, volW1, cw1, cwTot: cw1*qty, tag: weight>=volW1?'W':'V', ...meta });
  }
  if (results.length === 0) { alert('すべての値を入力してください'); return; }

  if (results.length === 1) {
    const r   = results[0];
    const tag = r.weight >= r.volW1 ? '実重量適用（W）' : '容積重量適用（V）';
    const inputLine = formatRowInputSummary([
      `${r.lInput}×${r.wInput}×${r.hInput}${unit}`,
      `${r.weight}kg`,
      r.packing,
      r.stackLabel,
      `× ${r.qty}個`
    ]);
    appendCalcResult('air-result',
      renderInputEcho(inputLine) +
      `<div class="calc-row">
      <div class="calc-item"><div class="calc-item-label">容積重量 (1個)</div><div class="calc-item-value">${r.volW1.toFixed(2)} kg</div></div>
      <div class="calc-item"><div class="calc-item-label">実重量 (1個)</div><div class="calc-item-value">${r.weight.toFixed(2)} kg</div></div>
      <div class="calc-item hl"><div class="calc-item-label">CW (1個) ／ ${tag}</div><div class="calc-item-value">${r.cw1.toFixed(2)} kg</div></div>
      ${r.qty>1?`<div class="calc-item hl"><div class="calc-item-label">CW 合計 (×${r.qty}個)</div><div class="calc-item-value">${r.cwTot.toFixed(2)} kg</div></div>`:''}
    </div>`,
      inputLine);
  } else {
    const totalCW  = results.reduce((s, r) => s + r.cwTot, 0);
    const totalQty = results.reduce((s, r) => s + r.qty,   0);
    const rowsHtml = results.map((r, i) => {
      const lbl = formatRowInputSummary([
        `${r.lInput}×${r.wInput}×${r.hInput}${unit}`, `${r.weight}kg`, r.packing, r.stackLabel, `× ${r.qty}個`
      ]);
      return `
      <div style="margin-bottom:8px;">
        <div class="calc-row-label">行${i+1}　${lbl}</div>
        <div class="calc-row">
          <div class="calc-item"><div class="calc-item-label">CW (1個)</div><div class="calc-item-value">${r.cw1.toFixed(2)} kg <span class="calc-note">(${r.tag})</span></div></div>
          <div class="calc-item hl"><div class="calc-item-label">CW 小計</div><div class="calc-item-value">${r.cwTot.toFixed(2)} kg</div></div>
        </div>
      </div>`;
    }).join('');
    appendCalcResult('air-result',
      rowsHtml + `<div style="margin-top:10px;padding-top:10px;border-top:2px solid var(--accent);">
        <div class="calc-row">
          <div class="calc-item hl" style="flex:1;"><div class="calc-item-label">CW 合計（全${totalQty}個 / ${results.length}品目）</div><div class="calc-item-value">${totalCW.toFixed(2)} kg</div></div>
        </div></div>`,
      `${results.length}品目 / CW合計 ${totalCW.toFixed(2)} kg`);
  }
}

// ================================================================
//  LCL RT 計算
// ================================================================

function calcLclRT() {
  const { unit, factor } = getUnitConversion('lcl-unit', 'cm');
  const wrap = document.getElementById('lcl-rows-wrap');
  const rows = wrap.querySelectorAll('.calc-multi-row');
  const results = [];
  for (const row of rows) {
    const lInput = parseFloat(row.querySelector('[data-key="l"]').value);
    const wInput = parseFloat(row.querySelector('[data-key="w"]').value);
    const hInput = parseFloat(row.querySelector('[data-key="h"]').value);
    const weight = parseFloat(row.querySelector('[data-key="weight"]').value);
    const qty    = parseInt(row.querySelector('[data-key="qty"]').value) || 1;
    if ([lInput,wInput,hInput,weight].some(isNaN)) continue;
    const meta  = getRowMeta(row);
    // cm 換算で計算式に投入（CBM = L*W*H[cm] / 1e6）
    const l = lInput * factor, w = wInput * factor, h = hInput * factor;
    const cbm1  = (l*w*h) / 1e6;
    const wTon1 = weight / 1000;
    const rt1   = Math.max(cbm1, wTon1);
    results.push({ l, w, h, lInput, wInput, hInput, weight, qty, cbm1, wTon1, rt1,
      cbmTot: cbm1*qty, wTonTot: wTon1*qty, rtTot: rt1*qty,
      tag: wTon1>=cbm1?'W':'M', ...meta });
  }
  if (results.length === 0) { alert('すべての値を入力してください'); return; }

  if (results.length === 1) {
    const r   = results[0];
    const tag = r.wTon1 >= r.cbm1 ? 'W（実重量トン）適用' : 'M（容積）適用';
    const inputLine = formatRowInputSummary([
      `${r.lInput}×${r.wInput}×${r.hInput}${unit}`, `${r.weight}kg`, r.packing, r.stackLabel, `× ${r.qty}個`
    ]);
    appendCalcResult('lcl-result',
      renderInputEcho(inputLine) +
      `<div class="calc-row">
      <div class="calc-item"><div class="calc-item-label">CBM (1個)</div><div class="calc-item-value">${r.cbm1.toFixed(4)} CBM</div></div>
      <div class="calc-item"><div class="calc-item-label">W (1個)</div><div class="calc-item-value">${r.wTon1.toFixed(4)} ton</div></div>
      <div class="calc-item hl"><div class="calc-item-label">RT (1個) ／ ${tag}</div><div class="calc-item-value">${r.rt1.toFixed(4)} RT</div></div>
      ${r.qty>1?`<div class="calc-item"><div class="calc-item-label">CBM 合計 (×${r.qty}個)</div><div class="calc-item-value">${r.cbmTot.toFixed(4)} CBM</div></div>
      <div class="calc-item"><div class="calc-item-label">W 合計</div><div class="calc-item-value">${r.wTonTot.toFixed(4)} ton</div></div>
      <div class="calc-item hl"><div class="calc-item-label">RT 合計</div><div class="calc-item-value">${r.rtTot.toFixed(4)} RT</div></div>`:''}
    </div>`,
      inputLine);
  } else {
    const totalCBM  = results.reduce((s, r) => s + r.cbmTot,  0);
    const totalWTon = results.reduce((s, r) => s + r.wTonTot, 0);
    const totalRT   = Math.max(totalCBM, totalWTon);
    const totalQty  = results.reduce((s, r) => s + r.qty,     0);
    const rowsHtml  = results.map((r, i) => {
      const lbl = formatRowInputSummary([
        `${r.lInput}×${r.wInput}×${r.hInput}${unit}`, `${r.weight}kg`, r.packing, r.stackLabel, `× ${r.qty}個`
      ]);
      return `
      <div style="margin-bottom:8px;">
        <div class="calc-row-label">行${i+1}　${lbl}</div>
        <div class="calc-row">
          <div class="calc-item"><div class="calc-item-label">CBM 小計</div><div class="calc-item-value">${r.cbmTot.toFixed(4)} CBM</div></div>
          <div class="calc-item"><div class="calc-item-label">W 小計</div><div class="calc-item-value">${r.wTonTot.toFixed(4)} ton</div></div>
          <div class="calc-item hl"><div class="calc-item-label">RT 小計</div><div class="calc-item-value">${r.rtTot.toFixed(4)} RT <span class="calc-note">(${r.tag})</span></div></div>
        </div>
      </div>`;
    }).join('');
    const totTag = totalWTon >= totalCBM ? 'W適用' : 'M適用';
    appendCalcResult('lcl-result',
      rowsHtml + `<div style="margin-top:10px;padding-top:10px;border-top:2px solid var(--accent);">
        <div class="calc-row">
          <div class="calc-item"><div class="calc-item-label">CBM 合計</div><div class="calc-item-value">${totalCBM.toFixed(4)} CBM</div></div>
          <div class="calc-item"><div class="calc-item-label">W 合計</div><div class="calc-item-value">${totalWTon.toFixed(4)} ton</div></div>
          <div class="calc-item hl" style="flex:1;"><div class="calc-item-label">RT 合計（全${totalQty}個 / ${totTag}）</div><div class="calc-item-value">${totalRT.toFixed(4)} RT</div></div>
        </div></div>`,
      `${results.length}品目 / RT合計 ${totalRT.toFixed(4)} RT`);
  }
}

// ================================================================
//  CBM・才数計算
// ================================================================

function calcCBMSai() {
  const unit = document.getElementById('cbm-unit').value;
  const F    = {cm:0.01, mm:0.001, in:0.0254, m:1}[unit];
  const Fcm  = {cm:1, mm:0.1, in:2.54, m:100}[unit];
  const wrap = document.getElementById('cbm-rows-wrap');
  const rows = wrap.querySelectorAll('.calc-multi-row');
  const results = [];
  for (const row of rows) {
    const l   = parseFloat(row.querySelector('[data-key="l"]').value);
    const w   = parseFloat(row.querySelector('[data-key="w"]').value);
    const h   = parseFloat(row.querySelector('[data-key="h"]').value);
    const qty = parseInt(row.querySelector('[data-key="qty"]').value) || 1;
    if ([l,w,h].some(isNaN)) continue;
    const meta = getRowMeta(row);
    const cbm1 = l*F * w*F * h*F;
    const sai1 = (l*Fcm * w*Fcm * h*Fcm) / 27826.5;
    results.push({ l, w, h, qty, cbm1, sai1, cbmTot: cbm1*qty, saiTot: sai1*qty, ...meta });
  }
  if (results.length === 0) { alert('寸法を入力してください'); return; }

  const TRUCKS = [{name:'軽バン',cap:40},{name:'2tトラック',cap:120},{name:'4tトラック',cap:250},{name:'10tトラック',cap:580}];

  if (results.length === 1) {
    const r = results[0];
    const truckHtml = TRUCKS.map(t =>
      '<div class="calc-item"><div class="calc-item-label">'+t.name+'（〜'+t.cap+'才）</div><div class="calc-item-value">'+Math.ceil(r.saiTot/t.cap)+' 台</div></div>'
    ).join('');
    const inputLine = formatRowInputSummary([
      `${r.l}×${r.w}×${r.h}${unit}`, r.packing, r.stackLabel, `× ${r.qty}個`
    ]);
    appendCalcResult('cbm-result',
      renderInputEcho(inputLine) +
      '<div class="calc-row">'
      + '<div class="calc-item hl"><div class="calc-item-label">CBM（1個）</div><div class="calc-item-value">'+r.cbm1.toFixed(4)+' CBM</div></div>'
      + '<div class="calc-item hl"><div class="calc-item-label">才数（1個）</div><div class="calc-item-value">'+r.sai1.toFixed(2)+' 才</div></div>'
      + (r.qty>1
          ? '<div class="calc-item hl"><div class="calc-item-label">CBM 合計（×'+r.qty+'個）</div><div class="calc-item-value">'+r.cbmTot.toFixed(4)+' CBM</div></div>'
          + '<div class="calc-item hl"><div class="calc-item-label">才数 合計</div><div class="calc-item-value">'+r.saiTot.toFixed(2)+' 才</div></div>' : '')
      + '</div>'
      + '<div style="margin-top:12px;font-size:12px;color:var(--text-md);font-weight:600;">🚛 トラック積載台数目安（合計才数 '+r.saiTot.toFixed(1)+' 才）</div>'
      + '<div class="calc-row" style="margin-top:6px;">'+truckHtml+'</div>',
      inputLine);
  } else {
    const totalCBM = results.reduce((s, r) => s + r.cbmTot, 0);
    const totalSai = results.reduce((s, r) => s + r.saiTot, 0);
    const totalQty = results.reduce((s, r) => s + r.qty,    0);
    const rowsHtml = results.map((r, i) => {
      const lbl = formatRowInputSummary([
        `${r.l}×${r.w}×${r.h}${unit}`, r.packing, r.stackLabel, `× ${r.qty}個`
      ]);
      return `
      <div style="margin-bottom:8px;">
        <div class="calc-row-label">行${i+1}　${lbl}</div>
        <div class="calc-row">
          <div class="calc-item hl"><div class="calc-item-label">CBM 小計</div><div class="calc-item-value">${r.cbmTot.toFixed(4)} CBM</div></div>
          <div class="calc-item hl"><div class="calc-item-label">才数 小計</div><div class="calc-item-value">${r.saiTot.toFixed(2)} 才</div></div>
        </div>
      </div>`;
    }).join('');
    const truckHtml = TRUCKS.map(t =>
      '<div class="calc-item"><div class="calc-item-label">'+t.name+'（〜'+t.cap+'才）</div><div class="calc-item-value">'+Math.ceil(totalSai/t.cap)+' 台</div></div>'
    ).join('');
    appendCalcResult('cbm-result',
      rowsHtml
      + `<div style="margin-top:10px;padding-top:10px;border-top:2px solid var(--accent);">
          <div class="calc-row">
            <div class="calc-item hl" style="flex:1;"><div class="calc-item-label">CBM 合計（全${totalQty}個 / ${results.length}品目）</div><div class="calc-item-value">${totalCBM.toFixed(4)} CBM</div></div>
            <div class="calc-item hl" style="flex:1;"><div class="calc-item-label">才数 合計</div><div class="calc-item-value">${totalSai.toFixed(2)} 才</div></div>
          </div></div>`
      + `<div style="margin-top:12px;font-size:12px;color:var(--text-md);font-weight:600;">🚛 トラック積載台数目安（合計才数 ${totalSai.toFixed(1)} 才）</div>`
      + `<div class="calc-row" style="margin-top:6px;">${truckHtml}</div>`,
      `${results.length}品目 / CBM合計 ${totalCBM.toFixed(4)}`);
  }
}

function calcCBM() { calcCBMSai(); }

// ================================================================
//  パレタイズ計算
// ================================================================

function togglePalCustom() {
  document.getElementById('pal-custom-wrap').style.display =
    document.getElementById('pal-size').value === 'custom' ? 'flex' : 'none';
}

function calcPalletize() {
  const { unit, factor } = getUnitConversion('pal-unit', 'mm');
  const sv = document.getElementById('pal-size').value;
  // 標準パレットサイズは mm 固定。カスタム入力のみ単位変換を適用。
  const SIZES = {'1100x1100':[1100,1100],'1200x1000':[1200,1000],'1200x800':[1200,800],'1219x1016':[1219,1016]};
  let pw, pd, pwDisp, pdDisp, palUnit;
  if (SIZES[sv]) {
    [pw,pd] = SIZES[sv];
    pwDisp = pw; pdDisp = pd; palUnit = 'mm';
  } else {
    const pwInput = parseFloat(document.getElementById('pal-pw').value);
    const pdInput = parseFloat(document.getElementById('pal-pd').value);
    if (isNaN(pwInput)||isNaN(pdInput)) { alert('パレットサイズを入力してください'); return; }
    pw = pwInput * factor; pd = pdInput * factor;
    pwDisp = pwInput; pdDisp = pdInput; palUnit = unit;
  }
  const lay  = parseInt(document.getElementById('pal-layers').value) || 1;
  const wrap = document.getElementById('pal-rows-wrap');
  const rows = wrap.querySelectorAll('.calc-multi-row');
  const results = [];
  for (const row of rows) {
    const blInput = parseFloat(row.querySelector('[data-key="l"]').value);
    const bwInput = parseFloat(row.querySelector('[data-key="w"]').value);
    const bhInput = parseFloat(row.querySelector('[data-key="h"]').value);
    const tot = parseInt(row.querySelector('[data-key="total"]').value) || 0;
    if ([blInput,bwInput,bhInput].some(isNaN)) continue;
    const meta = getRowMeta(row);
    // mm 換算で計算式に投入
    const bl = blInput * factor, bw = bwInput * factor, bh = bhInput * factor;
    const o1 = {cols:Math.floor(pw/bl),rows:Math.floor(pd/bw)};
    const o2 = {cols:Math.floor(pw/bw),rows:Math.floor(pd/bl)};
    const p1 = o1.cols*o1.rows, p2 = o2.cols*o2.rows;
    const best     = p1>=p2 ? o1 : o2;
    const perPer1L = Math.max(p1,p2);
    // 段積み不可なら 1 段固定
    const effLay   = meta.stack === 'ng' ? 1 : lay;
    const perPallet = perPer1L * effLay;
    const pNeeded   = (tot > 0 && perPallet > 0) ? Math.ceil(tot/perPallet) : null;
    results.push({ bl, bw, bh, blInput, bwInput, bhInput, tot, best, perPer1L, perPallet, pNeeded, effLay, ...meta });
  }
  if (results.length === 0) { alert('箱の寸法を入力してください'); return; }

  if (results.length === 1) {
    const r = results[0];
    const inputLine = formatRowInputSummary([
      `箱 ${r.blInput}×${r.bwInput}×${r.bhInput}${unit}`,
      `パレット ${pwDisp}×${pdDisp}${palUnit}`,
      `${r.effLay}段${r.stack==='ng'?'（段積み不可で 1 段固定）':''}`,
      r.packing,
      r.tot>0?`総 ${r.tot}個`:''
    ]);
    appendCalcResult('pal-result',
      renderInputEcho(inputLine) +
      `<div class="calc-row">
      <div class="calc-item"><div class="calc-item-label">パレットサイズ</div><div class="calc-item-value">${pwDisp}×${pdDisp} ${palUnit}</div></div>
      <div class="calc-item hl"><div class="calc-item-label">1段あたり</div><div class="calc-item-value">${r.perPer1L} 個 <span class="calc-note">(${r.best.cols}列×${r.best.rows}行)</span></div></div>
      <div class="calc-item hl"><div class="calc-item-label">1パレット合計（${r.effLay}段）</div><div class="calc-item-value">${r.perPallet} 個</div></div>
      <div class="calc-item"><div class="calc-item-label">積載後高さ（箱のみ）</div><div class="calc-item-value">${(r.bh*r.effLay).toLocaleString()} mm</div></div>
      ${r.pNeeded!==null?`<div class="calc-item hl"><div class="calc-item-label">必要パレット数（${r.tot}個）</div><div class="calc-item-value">${r.pNeeded} パレット</div></div>`:''}
    </div>`,
    inputLine);
  } else {
    let totalPallets = 0;
    const rowsHtml = results.map((r, i) => {
      if (r.pNeeded !== null) totalPallets += r.pNeeded;
      const lbl = formatRowInputSummary([
        `箱${r.blInput}×${r.bwInput}×${r.bhInput}${unit}`,
        r.packing,
        r.stack==='ng'?'段積み不可':'',
        r.tot>0?`総${r.tot}個`:''
      ]);
      return `<div style="margin-bottom:8px;">
        <div class="calc-row-label">品種${i+1}　${lbl}</div>
        <div class="calc-row">
          <div class="calc-item hl"><div class="calc-item-label">1パレット（${r.effLay}段）</div><div class="calc-item-value">${r.perPallet} 個 <span class="calc-note">(${r.best.cols}×${r.best.rows}行)</span></div></div>
          ${r.pNeeded!==null?`<div class="calc-item hl"><div class="calc-item-label">必要パレット数</div><div class="calc-item-value">${r.pNeeded} パレット</div></div>`:''}
        </div>
      </div>`;
    }).join('');
    const totalHtml = totalPallets > 0
      ? `<div style="margin-top:10px;padding-top:10px;border-top:2px solid var(--accent);">
          <div class="calc-row">
            <div class="calc-item hl" style="flex:1;"><div class="calc-item-label">合計パレット数（全${results.length}品種）</div><div class="calc-item-value">${totalPallets} パレット</div></div>
          </div></div>` : '';
    appendCalcResult('pal-result', rowsHtml + totalHtml,
      `${results.length}品種 / パレット${pwDisp}×${pdDisp}${palUnit} ${lay}段${totalPallets>0?' / 合計'+totalPallets+'パレット':''}`);
  }
}

// ================================================================
//  バンニング計算 + SVG断面図
// ================================================================

function calcVanning() {
  const { unit, factor } = getUnitConversion('van-unit', 'cm');
  const CONT = {
    '20ft':{l:589,w:235,h:239,maxPay:28000,label:'20ft Dry'},
    '40ft':{l:1203,w:235,h:239,maxPay:26500,label:'40ft Dry'},
    '40hc':{l:1203,w:235,h:269,maxPay:26500,label:'40ft HC'},
  };
  const globalNoStack = document.getElementById('van-no-stack').checked;
  const PERMS   = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];

  // 行データを収集（段積み可否は per-row）。cm 換算で計算式に投入
  const wrap    = document.getElementById('van-rows-wrap');
  const rowEls  = wrap.querySelectorAll('.calc-multi-row');
  const cargo   = [];
  for (const row of rowEls) {
    const blInput = parseFloat(row.querySelector('[data-key="l"]').value);
    const bwInput = parseFloat(row.querySelector('[data-key="w"]').value);
    const bhInput = parseFloat(row.querySelector('[data-key="h"]').value);
    const bkg     = parseFloat(row.querySelector('[data-key="weight"]').value) || 0;
    const qty     = parseInt(row.querySelector('[data-key="qty"]').value) || 0;
    if ([blInput,bwInput,bhInput].some(isNaN)) continue;
    const meta = getRowMeta(row);
    const rowNoStack = globalNoStack || meta.stack === 'ng';
    const bl = blInput * factor, bw = bwInput * factor, bh = bhInput * factor;
    cargo.push({ bl, bw, bh, blInput, bwInput, bhInput, bkg, qty, rowNoStack, ...meta });
  }
  if (cargo.length === 0) { alert('貨物の寸法を入力してください'); return; }

  // ── 単品モード（従来動作 + SVG）──────────────────────────
  if (cargo.length === 1) {
    const { bl, bw, bh, blInput, bwInput, bhInput, bkg, qty, rowNoStack, packing, stackLabel } = cargo[0];
    const dims = [bl,bw,bh];
    const cCBM = (bl*bw*bh)/1e6;

    const contRows = Object.entries(CONT).map(([key,c]) => {
      const contCBM = (c.l*c.w*c.h)/1e6;
      let maxPer = 0;
      PERMS.forEach(p => {
        const vLayers = rowNoStack ? Math.min(1, Math.floor(c.h/dims[p[2]])) : Math.floor(c.h/dims[p[2]]);
        const q = Math.floor(c.l/dims[p[0]])*Math.floor(c.w/dims[p[1]])*vLayers;
        if (q>maxPer) maxPer=q;
      });
      const need    = qty>0 ? Math.ceil(qty/maxPer) : null;
      const used    = Math.min(maxPer, qty||maxPer);
      const util    = (cCBM*used/contCBM*100).toFixed(1);
      const totalKg = bkg>0&&qty>0 ? qty*bkg : bkg>0 ? maxPer*bkg : null;
      const overW   = totalKg && need && totalKg > c.maxPay*need;
      return {key,c,maxPer,contCBM,need,util,totalKg,overW};
    });

    let rec;
    if (qty>0) {
      const ok = contRows.filter(r=>!r.overW);
      rec = (ok.length?ok:contRows).reduce((b,r)=>r.need<b.need?r:b);
    } else {
      rec = contRows.reduce((b,r)=>parseFloat(r.util)>parseFloat(b.util)?r:b);
    }

    const cardsHtml = contRows.map(r => {
      const isRec = r.key===rec.key;
      const badge = isRec ? '<span style="background:#d4edda;color:#155724;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;margin-left:6px;">✅ 推奨</span>' : '';
      const main  = r.need ? `${r.need} 本必要` : `最大 ${r.maxPer.toLocaleString()} 個/本`;
      const kgLine= r.totalKg ? `概算 ${r.totalKg.toLocaleString()} kg／上限 ${(r.c.maxPay*(r.need||1)).toLocaleString()} kg` : '';
      const warn  = r.overW ? ' <span style="color:#e53e3e;font-size:10px;">⚠️ 重量超過</span>' : '';
      return `<div class="calc-item ${isRec?'hl':''}">
        <div class="calc-item-label">${r.c.label}${badge}</div>
        <div class="calc-item-value" style="font-size:14px;">${main}${warn}</div>
        <div style="font-size:11px;color:#718096;margin-top:3px;">CBM使用率 ${r.util}%　${kgLine}</div>
      </div>`;
    }).join('');

    const svgHtml = Object.entries(CONT).map(([key,c]) => buildContainerSVG(key, c, [bl,bw,bh], rowNoStack, rec.key)).join('');
    const inputLine = formatRowInputSummary([
      `${blInput}×${bwInput}×${bhInput}${unit}`,
      `${bkg}kg`,
      packing,
      rowNoStack ? '段積み不可' : stackLabel,
      qty>0 ? `× ${qty}個` : ''
    ]);
    appendCalcResult('van-result',
      renderInputEcho(inputLine) +
      `<div class="calc-row">${cardsHtml}</div>
      <p style="font-size:11px;color:#718096;margin-top:10px;">※ ダンネージなしの理論値。実際の積み付けは現場でご確認ください。</p>
      <div style="margin-top:12px;font-size:11px;font-weight:700;color:var(--text-md);">📐 コンテナ断面図（端面ビュー）</div>
      <p style="font-size:11px;color:var(--text-lt);margin-top:2px;margin-bottom:6px;">幅方向・高さ方向に貨物がどう並ぶかを示します。破線＝ドア有効高さ。</p>
      <div class="container-svg-wrap">${svgHtml}</div>`,
      inputLine);
    return;
  }

  // ── 複数品種モード（CBM/重量ベース推定）──────────────────
  // 品種ごとに per-container 最大数も計算して内訳に使う（段積み可否は行単位）
  let totalCBM = 0, totalKg = 0, totalQty = 0;
  const cargoDetail = cargo.map(({ bl, bw, bh, blInput, bwInput, bhInput, bkg, qty, rowNoStack, packing, stackLabel }) => {
    const cCBM = (bl*bw*bh)/1e6;
    const dims = [bl,bw,bh];
    // 各コンテナタイプの最大積載数（行ごとの段積み可否を反映）
    const maxPerCont = {};
    Object.entries(CONT).forEach(([key, c]) => {
      let maxPer = 0;
      PERMS.forEach(p => {
        const vLayers = rowNoStack ? Math.min(1, Math.floor(c.h/dims[p[2]])) : Math.floor(c.h/dims[p[2]]);
        const q = Math.floor(c.l/dims[p[0]])*Math.floor(c.w/dims[p[1]])*vLayers;
        if (q>maxPer) maxPer=q;
      });
      maxPerCont[key] = maxPer;
    });
    const subtotalCBM = cCBM * (qty || 1);
    const subtotalKg  = bkg * (qty || 1);
    totalCBM += subtotalCBM;
    totalKg  += subtotalKg;
    totalQty += (qty || 1);
    return { bl, bw, bh, blInput, bwInput, bhInput, bkg, qty, cCBM, subtotalCBM, subtotalKg, maxPerCont, rowNoStack, packing, stackLabel };
  });

  // 品種別内訳HTML
  const detailHtml = cargoDetail.map((r, i) => {
    const lbl = formatRowInputSummary([
      `${r.blInput}×${r.bwInput}×${r.bhInput}${unit}`,
      r.bkg>0?`${r.bkg}kg`:'',
      r.packing,
      r.rowNoStack?'段積み不可':'',
      `× ${r.qty}個`
    ]);
    return `
    <div style="margin-bottom:6px;">
      <div class="calc-row-label">品種${i+1}　${lbl}</div>
      <div class="calc-row">
        <div class="calc-item"><div class="calc-item-label">小計 CBM</div><div class="calc-item-value">${r.subtotalCBM.toFixed(4)} CBM</div></div>
        ${r.subtotalKg>0?`<div class="calc-item"><div class="calc-item-label">小計 重量</div><div class="calc-item-value">${r.subtotalKg.toLocaleString()} kg</div></div>`:''}
      </div>
    </div>`;
  }).join('');

  // コンテナ比較（CBM 充填ベース。段積み不可行は「床面積 × コンテナ高さ」で空間占有を概算）
  const contRows = Object.entries(CONT).map(([key, c]) => {
    const contCBM = (c.l*c.w*c.h)/1e6;
    let effectiveCBM = 0;
    cargoDetail.forEach(r => {
      if (!r.rowNoStack) {
        effectiveCBM += r.subtotalCBM;
      } else {
        // 段積み不可：最も小さい辺を立てた向きで床面積を最大化、残り 2 辺の積を床面積とする
        const dims = [r.bl, r.bw, r.bh].slice().sort((a, b) => a - b);
        const floorAreaM2 = (dims[1] * dims[2]) / 1e4; // cm² → m²
        effectiveCBM += floorAreaM2 * (c.h / 100) * (r.qty || 1);
      }
    });
    const need    = Math.ceil(effectiveCBM / contCBM);
    const util    = (totalCBM / (contCBM * need) * 100).toFixed(1);
    const overW   = totalKg > 0 && totalKg > c.maxPay * need;
    return { key, c, need, util, totalKg, overW, contCBM, effectiveCBM };
  });

  const ok  = contRows.filter(r => !r.overW);
  const rec = (ok.length ? ok : contRows).reduce((b, r) => r.need < b.need ? r : b);

  const cardsHtml = contRows.map(r => {
    const isRec = r.key===rec.key;
    const badge = isRec ? '<span style="background:#d4edda;color:#155724;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;margin-left:6px;">✅ 推奨</span>' : '';
    const kgLine= totalKg>0 ? `概算 ${totalKg.toLocaleString()} kg／上限 ${(r.c.maxPay*r.need).toLocaleString()} kg` : '';
    const warn  = r.overW ? ' <span style="color:#e53e3e;font-size:10px;">⚠️ 重量超過</span>' : '';
    return `<div class="calc-item ${isRec?'hl':''}">
      <div class="calc-item-label">${r.c.label}${badge}</div>
      <div class="calc-item-value" style="font-size:14px;">${r.need} 本必要${warn}</div>
      <div style="font-size:11px;color:#718096;margin-top:3px;">CBM充填率 ${r.util}%　${kgLine}</div>
    </div>`;
  }).join('');

  const noStackCount = cargoDetail.filter(r => r.rowNoStack).length;
  const stackNote = noStackCount > 0
    ? `<p style="font-size:11px;color:#b45309;margin-top:6px;">⚠️ 段積み不可の品種が ${noStackCount} 件あります（床面積占有を簡易補正）。</p>`
    : '';

  appendCalcResult('van-result',
    `<div style="margin-bottom:10px;">
      <div style="font-size:11px;font-weight:700;color:var(--text-md);margin-bottom:6px;">📦 品種別内訳（合計 ${totalCBM.toFixed(4)} CBM${totalKg>0?' / '+totalKg.toLocaleString()+' kg':''}）</div>
      ${detailHtml}
    </div>
    <div class="calc-row">${cardsHtml}</div>
    ${stackNote}
    <p style="font-size:11px;color:#718096;margin-top:10px;">※ CBMベースの理論値。混載バンニングは積み合わせ次第で変わります。実際の積み付けは現場でご確認ください。</p>`,
    `${cargo.length}品種 / 合計${totalCBM.toFixed(3)}CBM${globalNoStack?' / 全行段積み不可':noStackCount>0?' / 一部段積み不可':''}`);
}

// コンテナ端面断面図SVGを生成
function buildContainerSVG(key, cont, dims, noStack, recKey) {
  const SVG_W = 170, SVG_H = 140;
  const PAD_L = 14, PAD_T = 10, PAD_R = 24, PAD_B = 12;

  const contW_cm = cont.w; // 内寸幅 (cm)
  const contH_cm = cont.h; // 内寸高 (cm)

  const drawW = SVG_W - PAD_L - PAD_R;
  const drawH = SVG_H - PAD_T - PAD_B;
  const scale  = Math.min(drawW / contW_cm, drawH / contH_cm);

  const dispW  = contW_cm * scale;
  const dispH  = contH_cm * scale;
  const ox     = PAD_L + (drawW - dispW) / 2;
  const oy     = PAD_T + (drawH - dispH) / 2;

  // 最良の向き（幅×高さ方向の収納数最大）を探す
  const PERMS = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
  let bestPerm = PERMS[0], bestFace = 0;
  PERMS.forEach(p => {
    const cols = Math.floor(contW_cm / dims[p[1]]);
    const rows = noStack ? Math.min(1, Math.floor(contH_cm / dims[p[2]])) : Math.floor(contH_cm / dims[p[2]]);
    if (cols * rows > bestFace) { bestFace = cols * rows; bestPerm = p; }
  });

  const boxW_cm = dims[bestPerm[1]];
  const boxH_cm = dims[bestPerm[2]];
  const cols    = Math.floor(contW_cm / boxW_cm);
  const rows    = noStack ? Math.min(1, Math.floor(contH_cm / boxH_cm)) : Math.floor(contH_cm / boxH_cm);
  const dispBW  = boxW_cm * scale;
  const dispBH  = boxH_cm * scale;

  // ドア有効高さ (cm): 20/40ft標準=228, HC=256
  const doorH_cm  = key === '40hc' ? 256 : 228;
  const dispDoorY = oy + dispH - doorH_cm * scale;
  const overDoor  = (boxH_cm * rows) > doorH_cm;

  // 貨物ボックスを描画（最大40個で打ち止め）
  let boxes = '', count = 0;
  for (let r = 0; r < rows && count < 40; r++) {
    for (let c = 0; c < cols && count < 40; c++) {
      const bx = ox + c * dispBW;
      const by = oy + dispH - (r + 1) * dispBH;
      boxes += `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}"
        width="${(dispBW - 0.6).toFixed(1)}" height="${(dispBH - 0.6).toFixed(1)}"
        fill="#7bb8d4" stroke="#4a88a8" stroke-width="0.6" opacity="0.82"/>`;
      count++;
    }
  }

  const isRec      = key === recKey;
  const framCol    = isRec ? '#3a7a32' : '#9a8a78';
  const bgCol      = isRec ? '#eaf4e8' : '#f8f4ef';
  const doorColor  = overDoor ? '#e53e3e' : '#a0a0a0';
  const recBadge   = isRec ? ' ✅' : '';

  return `<div class="container-svg-item">
    <svg width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}"
         style="border:1.5px solid ${framCol};border-radius:6px;background:${bgCol};">
      <!-- コンテナ輪郭 -->
      <rect x="${ox.toFixed(1)}" y="${oy.toFixed(1)}"
            width="${dispW.toFixed(1)}" height="${dispH.toFixed(1)}"
            fill="none" stroke="${framCol}" stroke-width="1.5"/>
      <!-- 貨物ボックス -->
      ${boxes}
      <!-- ドア有効高さ ライン -->
      <line x1="${ox.toFixed(1)}" y1="${dispDoorY.toFixed(1)}"
            x2="${(ox+dispW).toFixed(1)}" y2="${dispDoorY.toFixed(1)}"
            stroke="${doorColor}" stroke-width="1.0" stroke-dasharray="3,2"/>
      <text x="${(ox+dispW+2).toFixed(1)}" y="${(dispDoorY+4).toFixed(1)}"
            font-size="7" fill="${doorColor}">ドア</text>
      ${overDoor ? `<text x="${(ox+dispW/2).toFixed(1)}" y="${(oy+dispH+9).toFixed(1)}"
            font-size="7.5" fill="#e53e3e" text-anchor="middle" font-weight="bold">⚠ ドア高超過</text>` : ''}
      <!-- 幅寸法ラベル -->
      <text x="${(ox+dispW/2).toFixed(1)}" y="${(oy-2).toFixed(1)}"
            font-size="7" fill="#666" text-anchor="middle">${contW_cm}cm</text>
      <!-- 高さ寸法ラベル -->
      <text x="${(ox-3).toFixed(1)}" y="${(oy+dispH/2).toFixed(1)}"
            font-size="7" fill="#666" text-anchor="middle"
            transform="rotate(-90,${(ox-3).toFixed(1)},${(oy+dispH/2).toFixed(1)})">${contH_cm}cm</text>
    </svg>
    <div class="container-svg-label">${cont.label}${recBadge}</div>
    <div class="container-svg-sub">${cols}列×${rows}段 (端面${cols*rows}個/層)</div>
  </div>`;
}

// ================================================================
//  レート換算
// ================================================================
const RATE_CURRENCIES = {
  JPY:{name:'日本円',          flag:'🇯🇵', dec:0},
  USD:{name:'米ドル',          flag:'🇺🇸', dec:2},
  EUR:{name:'ユーロ',          flag:'🇪🇺', dec:2},
  GBP:{name:'英ポンド',        flag:'🇬🇧', dec:2},
  CNY:{name:'中国人民元',      flag:'🇨🇳', dec:2},
  HKD:{name:'香港ドル',        flag:'🇭🇰', dec:2},
  SGD:{name:'シンガポールドル',flag:'🇸🇬', dec:2},
  KRW:{name:'韓国ウォン',      flag:'🇰🇷', dec:0},
  THB:{name:'タイバーツ',      flag:'🇹🇭', dec:2},
};
// fetchRates: SharedFX に委譲（見積支援と共通）
async function fetchRates(base) {
  return SharedFX.fetchRates(base);
}

function fmtAmt(v, dec) {
  return v.toLocaleString('ja-JP', {minimumFractionDigits: dec, maximumFractionDigits: dec});
}
function fmtRate(r, dec) {
  if (dec === 0) return r.toFixed(2);
  if (r < 0.001) return r.toFixed(6);
  if (r < 0.1)   return r.toFixed(4);
  return r.toFixed(4);
}

async function calcRate() {
  const from   = document.getElementById('rate-from').value;
  const amount = parseFloat(document.getElementById('rate-amount').value);
  if (isNaN(amount) || amount <= 0) { alert('金額を入力してください'); return; }

  const status = document.getElementById('rate-status');
  status.textContent = '⏳ レートを取得中...';

  try {
    const rates = await fetchRates(from);
    const ts    = new Date().toLocaleString('ja-JP');
    status.innerHTML = `✅ レート取得完了 <span style="color:#a0aec0;">${ts}</span>`;

    const fromInfo = RATE_CURRENCIES[from];
    const targets  = Object.entries(RATE_CURRENCIES).filter(([code]) => code !== from);
    const cards    = targets.map(([code, info]) => {
      const rate      = rates[code];
      const converted = amount * rate;
      return `<div class="calc-item hl" style="min-width:170px;">
        <div class="calc-item-label">${info.flag} ${code}　${info.name}</div>
        <div class="calc-item-value">${fmtAmt(converted, info.dec)}</div>
        <div style="font-size:11px;color:#718096;margin-top:3px;">1 ${from} = ${fmtRate(rate, info.dec)} ${code}</div>
      </div>`;
    }).join('');

    appendCalcResult('rate-result',
      `<div class="calc-row">${cards}</div>`,
      `${fmtAmt(amount, fromInfo.dec)} ${fromInfo.flag} ${from}`);
  } catch(e) {
    status.textContent = '❌ レート取得に失敗しました。ネットワーク環境を確認してください。';
  }
}

// ================================================================
//  保険料計算
// ================================================================
function calcInsurance() {
  const fob     = parseFloat(document.getElementById('ins-fob').value) || 0;
  const freight = parseFloat(document.getElementById('ins-freight').value) || 0;
  const rate    = parseFloat(document.getElementById('ins-rate').value) || 0;
  if (fob <= 0) { alert('FOB金額を入力してください'); return; }
  if (rate <= 0) { alert('保険料率を入力してください'); return; }

  const insurable = Math.ceil((fob + freight) * 1.10);  // 保険価額
  const premium   = Math.ceil(insurable * (rate / 100)); // 保険料
  const cif       = fob + freight + premium;             // CIF概算

  const fmt = v => v.toLocaleString('ja-JP');
  const rows = [
    ['FOB金額', `¥${fmt(fob)}`],
    ['運賃', `¥${fmt(freight)}`],
    ['保険価額', `¥${fmt(insurable)}`, '（FOB＋運賃）× 1.10'],
    ['保険料率', `${rate}%`],
    ['保険料', `¥${fmt(premium)}`, '保険価額 × 保険料率'],
    ['CIF概算', `¥${fmt(cif)}`, 'FOB＋運賃＋保険料'],
  ];
  const tableRows = rows.map(([lbl,val,note]) =>
    `<tr><td style="padding:5px 10px;color:#4a5568;width:140px;">${lbl}</td>
         <td style="padding:5px 10px;font-weight:600;text-align:right;">${val}</td>
         <td style="padding:5px 10px;font-size:11px;color:#718096;">${note||''}</td></tr>`
  ).join('');
  appendCalcResult('ins-result',
    `<table style="width:100%;border-collapse:collapse;">${tableRows}</table>`,
    `FOB ¥${fmt(fob)} / 運賃 ¥${fmt(freight)} / 料率 ${rate}% → 保険料 ¥${fmt(premium)}`
  );
}

// ================================================================
//  関税・消費税計算
// ================================================================
function calcDuty() {
  const cifRaw   = parseFloat(document.getElementById('duty-cif').value)   || 0;
  const hs       = document.getElementById('duty-hs').value.trim();
  const dutyRate = parseFloat(document.getElementById('duty-rate').value)  || 0;
  const extraRate= parseFloat(document.getElementById('duty-extra').value) || 0;
  if (cifRaw <= 0) { alert('課税価格（CIF）を入力してください'); return; }

  // 課税価格: 1,000円未満切り捨て
  const cifBase = Math.floor(cifRaw / 1000) * 1000;

  // 関税: 課税価格 × 関税率（100円未満切り捨て）
  const duty    = Math.floor(cifBase * (dutyRate / 100) / 100) * 100;
  const extra   = Math.floor(cifBase * (extraRate / 100) / 100) * 100;
  const totalDuty = duty + extra;

  // 消費税の課税標準: 課税価格 + 関税（1,000円未満切り捨て）
  const consTaxBase = Math.floor((cifBase + totalDuty) / 1000) * 1000;
  // 消費税: 課税標準 × 10%（100円未満切り捨て）
  const consTax     = Math.floor(consTaxBase * 0.10 / 100) * 100;
  // 地方消費税: 消費税 × 22/78（100円未満切り捨て）
  const localTax    = Math.floor(consTax * (22/78) / 100) * 100;
  const totalTax    = totalDuty + consTax + localTax;
  const totalCost   = cifRaw + totalTax;

  const fmt = v => v.toLocaleString('ja-JP');
  const pct = (r) => r > 0 ? ` (${r}%)` : ' (0%)';
  const hsNote = hs ? ` ／ HSコード: ${hs}` : '';

  const rows = [
    ['課税価格（1000円未満切捨）', `¥${fmt(cifBase)}`, ''],
    ['関税'+pct(dutyRate), `¥${fmt(duty)}`, ''],
    ['追加関税'+pct(extraRate), `¥${fmt(extra)}`, extra===0?'—':''],
    ['関税合計', `¥${fmt(totalDuty)}`, ''],
    ['消費税課税標準', `¥${fmt(consTaxBase)}`, '（課税価格＋関税合計）1000円未満切捨'],
    ['消費税（10%）', `¥${fmt(consTax)}`, '100円未満切捨'],
    ['地方消費税（消費税×22/78）', `¥${fmt(localTax)}`, '100円未満切捨'],
    ['▶ 税金合計', `¥${fmt(totalTax)}`, '関税＋消費税＋地方消費税'],
    ['▶ 輸入総コスト概算', `¥${fmt(totalCost)}`, 'CIF（入力値）＋税金合計'],
  ];
  const tableRows = rows.map(([lbl,val,note], i) => {
    const highlight = i >= 7 ? 'background:#f0fff4;font-weight:700;' : '';
    return `<tr style="${highlight}">
      <td style="padding:5px 10px;color:#4a5568;width:210px;">${lbl}</td>
      <td style="padding:5px 10px;font-weight:600;text-align:right;">${val}</td>
      <td style="padding:5px 10px;font-size:11px;color:#718096;">${note}</td></tr>`;
  }).join('');

  appendCalcResult('duty-result',
    `<table style="width:100%;border-collapse:collapse;">${tableRows}</table>`,
    `CIF ¥${fmt(cifRaw)} / 関税${dutyRate}%${hsNote} → 税合計 ¥${fmt(totalTax)}`
  );
}
