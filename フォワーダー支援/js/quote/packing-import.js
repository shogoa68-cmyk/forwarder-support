// ================================================================
//  📋 貼り付けで一括登録（荷姿・貨物明細）
//  お客様から提供される表組みの物量情報（パッキングリスト等）を
//  Excelからコピーしたタブ区切りテキストとして貼り付け → 列マッピング
//  → レビュー → 荷姿・貨物明細（cargoDetailTable）へ一括追加する。
//  ・各ソース行＝梱包1個として qty:1 で取り込む（無理なグルーピングはしない）
//  ・重量列は G/W（総重量）を優先して自動マッピング（運賃計算はグロス基準）
//  ・列の意味はキーワードでヘッダー行を自動推定し、選択式で修正可能
//  依存（window 経由）：addPackingRowsBulk, quoteShowToast
// ================================================================
(function () {
  'use strict';

  const FIELD_OPTIONS = [
    { v: '',    label: '（無視）' },
    { v: 'pkg', label: '荷姿／品名' },
    { v: 'qty', label: '個数' },
    { v: 'lwh', label: '寸法 L×W×H（結合セル）' },
    { v: 'l',   label: '長さ(L) cm' },
    { v: 'w',   label: '幅(W) cm' },
    { v: 'h',   label: '高さ(H) cm' },
    { v: 'kg',  label: '重量 kg（G/W推奨）' },
  ];

  // ヘッダー行の列見出しからフィールドを推定するキーワード（先頭一致優先）
  const HEADER_RULES = [
    { field: 'lwh', re: /L\s*[×xX*]\s*W\s*[×xX*]\s*H|寸法/ },
    { field: 'kg',  re: /G\.?\s*\/?\s*W|Gross/i },
    { field: 'l',   re: /^L$|Length|長さ/i },
    { field: 'w',   re: /^W$|Width|幅/i },
    { field: 'h',   re: /^H$|Height|高さ/i },
    { field: 'pkg', re: /P\s*\/?\s*Style|Style|荷姿|品名|Item/i },
    { field: 'qty', re: /^Qty$|数量|個数/i },
  ];

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function _num(s) {
    if (s == null) return null;
    const m = String(s).replace(/[,，\s]/g, '').match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }
  function _splitLine(line) {
    return (line.indexOf('\t') !== -1 ? line.split('\t') : line.split(/\s{2,}/)).map(s => s.trim());
  }
  function _splitLwh(s) {
    const parts = String(s).split(/[×xX*]/).map(_num).filter(v => v != null);
    return { l: parts[0] != null ? parts[0] : '', w: parts[1] != null ? parts[1] : '', h: parts[2] != null ? parts[2] : '' };
  }
  function _rowCbm(e) {
    const l = parseFloat(e.l) || 0, w = parseFloat(e.w) || 0, h = parseFloat(e.h) || 0, q = parseInt(e.qty, 10) || 0;
    return (l * w * h / 1000000) * q;
  }

  let _lines = [];      // 貼り付けテキストを行→セル配列に分解したもの
  let _headerIdx = -1;  // ヘッダーとして扱う行のインデックス（-1なら全行データ扱い）
  let _colMap = [];     // 列インデックス → フィールド名
  let _entries = [];    // レビュー中の荷姿明細候補（{pkg,qty,l,w,h,kg,stack,_checked}）

  function openPackingImport() {
    document.getElementById('packingImportModal')?.classList.add('open');
    setTimeout(() => document.getElementById('pkiText')?.focus(), 60);
  }
  function closePackingImport() {
    document.getElementById('packingImportModal')?.classList.remove('open');
  }

  function pkiParse() {
    const text = document.getElementById('pkiText')?.value || '';
    if (!text.trim()) { if (window.quoteShowToast) quoteShowToast('⚠️ 表データを貼り付けてください', 'warn'); return; }
    _lines = text.replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/\s+$/, '')).filter(l => l.trim()).map(_splitLine);
    if (!_lines.length) return;

    // ヘッダー行検出：先頭5行のうち、キーワード一致が最多（2以上）の行を採用
    let bestIdx = -1, bestScore = 1;
    for (let i = 0; i < Math.min(_lines.length, 5); i++) {
      const score = _lines[i].filter(c => HEADER_RULES.some(r => r.re.test(c))).length;
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
    _headerIdx = bestIdx;

    const colCount = Math.max(..._lines.map(r => r.length));
    _colMap = new Array(colCount).fill('');
    if (_headerIdx >= 0) {
      _lines[_headerIdx].forEach((cell, i) => {
        const rule = HEADER_RULES.find(r => r.re.test(cell));
        if (rule) _colMap[i] = rule.field;
      });
    }
    _renderMapping();
    _rebuildEntries();
  }

  function _headerLabel(i) {
    if (_headerIdx >= 0 && _lines[_headerIdx][i]) return _lines[_headerIdx][i];
    return '列' + (i + 1);
  }

  function _renderMapping() {
    const wrap = document.getElementById('pkiMapWrap');
    if (!wrap) return;
    const optHtml = sel => FIELD_OPTIONS.map(o => `<option value="${o.v}"${o.v === sel ? ' selected' : ''}>${o.label}</option>`).join('');
    let html = '<div class="pki-map-hint">📌 各列が何のデータか確認してください（キーワードから自動推定・修正可）</div>';
    html += '<table class="pki-map-table"><thead><tr>';
    _colMap.forEach((f, i) => html += `<th>${_esc(_headerLabel(i))}</th>`);
    html += '</tr></thead><tbody><tr>';
    _colMap.forEach((f, i) => html += `<td><select onchange="pkiOnColMapChange(${i},this.value)">${optHtml(f)}</select></td>`);
    html += '</tr></tbody></table>';
    wrap.innerHTML = html;
  }

  function pkiOnColMapChange(i, val) {
    _colMap[i] = val;
    _rebuildEntries();
  }

  function _rebuildEntries() {
    const dataLines = _lines.filter((_, i) => i !== _headerIdx);
    _entries = dataLines.map(row => {
      const e = { pkg: '', qty: 1, l: '', w: '', h: '', kg: '', stack: '可', _checked: true };
      let any = false;
      _colMap.forEach((field, i) => {
        if (!field) return;
        const raw = (row[i] || '').trim();
        if (!raw) return;
        if (field === 'lwh') {
          const d = _splitLwh(raw);
          if (d.l !== '') { e.l = d.l; any = true; }
          if (d.w !== '') { e.w = d.w; any = true; }
          if (d.h !== '') { e.h = d.h; any = true; }
        } else if (field === 'qty') {
          const n = _num(raw); if (n != null) { e.qty = n; any = true; }
        } else if (field === 'pkg') {
          e.pkg = raw; any = true;
        } else {
          const n = _num(raw); if (n != null) { e[field] = n; any = true; }
        }
      });
      return any ? e : null;
    }).filter(Boolean);
    _renderPreview();
  }

  function _renderPreview() {
    const wrap = document.getElementById('pkiReviewWrap');
    const actions = document.getElementById('pkiActions');
    if (!wrap) return;
    if (!_entries.length) {
      wrap.innerHTML = '<div class="preset-empty">データ行を抽出できませんでした。列の割り当てを確認してください。</div>';
      if (actions) actions.hidden = true;
      return;
    }
    let html = '<table class="pki-table"><thead><tr>' +
      '<th><input type="checkbox" checked onchange="pkiToggleAll(this.checked)"></th>' +
      '<th>荷姿</th><th>個数</th><th>長さ<span>cm</span></th><th>幅<span>cm</span></th><th>高さ<span>cm</span></th><th>CBM</th><th>重量<span>kg／個</span></th><th>段積み</th>' +
      '</tr></thead><tbody>';
    _entries.forEach((e, i) => {
      html += `<tr>` +
        `<td><input type="checkbox" ${e._checked ? 'checked' : ''} onchange="pkiToggleEntry(${i},this.checked)"></td>` +
        `<td><input type="text" class="pki-in" value="${_esc(e.pkg)}" placeholder="カートン等" oninput="pkiUpdateEntry(${i},'pkg',this.value)"></td>` +
        `<td><input type="number" class="pki-in" min="0" step="1" value="${e.qty}" oninput="pkiUpdateEntry(${i},'qty',this.value)"></td>` +
        `<td><input type="number" class="pki-in" min="0" step="0.1" value="${e.l}" oninput="pkiUpdateEntry(${i},'l',this.value)"></td>` +
        `<td><input type="number" class="pki-in" min="0" step="0.1" value="${e.w}" oninput="pkiUpdateEntry(${i},'w',this.value)"></td>` +
        `<td><input type="number" class="pki-in" min="0" step="0.1" value="${e.h}" oninput="pkiUpdateEntry(${i},'h',this.value)"></td>` +
        `<td class="pki-cbm" id="pkiCbm-${i}">${_rowCbm(e).toFixed(3)}</td>` +
        `<td><input type="number" class="pki-in" min="0" step="0.1" value="${e.kg}" oninput="pkiUpdateEntry(${i},'kg',this.value)"></td>` +
        `<td><select onchange="pkiUpdateEntry(${i},'stack',this.value)">` +
        `<option value="可"${e.stack === '可' ? ' selected' : ''}>可</option>` +
        `<option value="不可"${e.stack === '不可' ? ' selected' : ''}>不可</option>` +
        `</select></td>` +
        `</tr>`;
    });
    html += '</tbody></table>';
    html += '<p class="pki-hint">💡 各行＝梱包1個として登録されます（個数は既定1）。重量はG/W（総重量）推奨。Case No.・M³等は個別に取り込まれません。</p>';
    wrap.innerHTML = html;
    if (actions) actions.hidden = false;
  }

  function pkiToggleAll(on) {
    _entries.forEach(e => { e._checked = on; });
    _renderPreview();
  }
  function pkiToggleEntry(i, on) {
    if (_entries[i]) _entries[i]._checked = on;
  }
  function pkiUpdateEntry(i, key, val) {
    if (!_entries[i]) return;
    _entries[i][key] = val;
    if (['l', 'w', 'h', 'qty'].includes(key)) {
      const cell = document.getElementById('pkiCbm-' + i);
      if (cell) cell.textContent = _rowCbm(_entries[i]).toFixed(3);
    }
  }

  function pkiInsertRows() {
    const checked = _entries.filter(e => e._checked).map(e => ({
      pkg: e.pkg || '', qty: parseInt(e.qty, 10) || 1, l: e.l || '', w: e.w || '', h: e.h || '', kg: e.kg || '', stack: e.stack || '可',
    }));
    if (!checked.length) { if (window.quoteShowToast) quoteShowToast('⚠️ 追加する行にチェックを入れてください', 'warn'); return; }
    if (typeof window.addPackingRowsBulk !== 'function') return;
    const n = window.addPackingRowsBulk(checked);
    _lines = []; _headerIdx = -1; _colMap = []; _entries = [];
    const t = document.getElementById('pkiText'); if (t) t.value = '';
    const mw = document.getElementById('pkiMapWrap'); if (mw) mw.innerHTML = '';
    const rw = document.getElementById('pkiReviewWrap'); if (rw) rw.innerHTML = '';
    const ac = document.getElementById('pkiActions'); if (ac) ac.hidden = true;
    closePackingImport();
    if (window.quoteShowToast) quoteShowToast('📋 ' + n + ' 件の荷姿明細を追加しました', 'success');
  }

  Object.assign(window, {
    openPackingImport, closePackingImport, pkiParse, pkiOnColMapChange, pkiToggleAll, pkiToggleEntry, pkiUpdateEntry, pkiInsertRows,
  });
})();
