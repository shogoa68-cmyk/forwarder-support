// ========== プレビュー・CSV (app-preview.js) ==========

  // ========== プレビュー＆エクスポート ==========
  function getQuoteHeader() {
    return {
      ref:      document.getElementById('qf-ref')?.value || '',
      customer: document.getElementById('qf-customer')?.value || '',
      person:   document.getElementById('qf-person')?.value || '',
    };
  }

  /**
   * ファイル名生成: REF_引き合い元_担当.<ext>
   * 入力がある項目だけ使用。すべて空なら "見積もり_YYYYMMDD"
   */
  function buildFileName(ext) {
    const hdr   = getQuoteHeader();
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const safe  = s => s.replace(/[\/\\:*?"<>|\t\n\r]/g, '_').replace(/_+/g, '_').trim().slice(0, 40);
    const parts = [hdr.ref, hdr.customer, hdr.person].map(safe).filter(Boolean);
    return (parts.length ? parts.join('_') : '見積もり_' + today) + '.' + ext;
  }

  function collectAllRows() {
    const rows = [];
    document.querySelectorAll('#tableBody tr').forEach(tr => {
      if (tr.dataset.type === 'subtotal') {
        const label       = tr.querySelector('.subtotal-label')?.value || '';
        const billingText = tr.querySelector('.subtotal-group-billing')?.textContent?.trim() || '—';
        const subtotalText= tr.querySelector('.subtotal-group-subtotal')?.textContent?.trim() || '—';
        const profitText  = tr.querySelector('.subtotal-group-profit')?.textContent?.trim() || '—';
        rows.push({ _type: 'subtotal', label, billingText, subtotalText, profitText });
        return;
      }
      const id     = tr.id.replace('row-', '');
      const taxed  = document.getElementById(`tx-${id}`)?.checked || false;
      const cat    = document.getElementById(`cat-${id}`)?.value || '';
      const name   = document.getElementById(`nm-${id}`)?.value || '';
      const pq     = val(`pq-${id}`);
      const un     = document.getElementById(`un-${id}`)?.value || '';
      const pc     = document.getElementById(`pc-${id}`)?.value || '';
      const pp     = val(`pp-${id}`);
      const cd     = val(`cd-${id}`);
      const bq     = val(`bq-${id}`);
      const bc     = document.getElementById(`bc-${id}`)?.value || '';
      const bp     = val(`bp-${id}`);
      const mk     = val(`mk-${id}`);
      const cost   = pq * pp;
      const bill   = bq * bp;
      const profit = bill - cost;
      const note   = document.getElementById(`nt-${id}`)?.value || '';
      const sv     = document.getElementById(`sv-${id}`)?.value || '';
      rows.push({ _type: 'data', taxed, cat, name, pq, un, pc, pp, cd, bq, bc, bp, mk, cost, bill, profit, note, sv });
    });
    return rows;
  }

  function collectData() {
    const rows = document.querySelectorAll('#tableBody tr');
    const data = [];
    rows.forEach(tr => {
      if (tr.dataset.type === 'subtotal') return; // 小計行スキップ
      const id     = tr.id.replace('row-', '');
      const taxed  = document.getElementById(`tx-${id}`)?.checked || false;
      const cat    = document.getElementById(`cat-${id}`)?.value || '';
      const name   = document.getElementById(`nm-${id}`)?.value || '';
      const pq     = val(`pq-${id}`);
      const un     = document.getElementById(`un-${id}`)?.value || '';
      const pc     = document.getElementById(`pc-${id}`)?.value || '';
      const pp     = val(`pp-${id}`);
      const cd     = val(`cd-${id}`);
      const bq     = val(`bq-${id}`);
      const bc     = document.getElementById(`bc-${id}`)?.value || '';
      const bp     = val(`bp-${id}`);
      const mk     = val(`mk-${id}`);
      const cost   = pq * pp;
      const bill   = bq * bp;
      const profit = bill - cost;
      const note   = document.getElementById(`nt-${id}`)?.value || '';
      const sv     = document.getElementById(`sv-${id}`)?.value || '';
      data.push({ taxed, cat, name, pq, un, pc, pp, cd, bq, bc, bp, mk, cost, bill, profit, note, sv });
    });
    return data;
  }

  function getCatLabel(v) {
    return CATEGORIES.find(c => c.value === v)?.label || '';
  }

  function openPreview() {
    try {
    const allRows = collectAllRows();
    const data = allRows.filter(r => r._type === 'data');
    if (!data.length) { alert('行がありません。'); return; }
    const hdr = getQuoteHeader();
    let totCost = 0, totBill = 0, totMk = 0;
    data.forEach(d => { totCost += d.cost; totBill += d.bill; totMk += d.mk; });
    const totPr = totBill - totCost;

    const metaEl = document.getElementById('pvMeta');
    const metaHTML = [
      hdr.ref      ? `<div class="pv-meta-item"><span class="lbl">仮 REF #</span><span class="val">${escHtml(hdr.ref)}</span></div>` : '',
      hdr.customer ? `<div class="pv-meta-item"><span class="lbl">引き合い元</span><span class="val">${escHtml(hdr.customer)}</span></div>` : '',
      hdr.person   ? `<div class="pv-meta-item"><span class="lbl">担当</span><span class="val">${escHtml(hdr.person)}</span></div>` : '',
    ].join('');
    metaEl.innerHTML = metaHTML;
    metaEl.style.display = metaHTML ? 'flex' : 'none';

    let html = `<table id="previewTable">
      <thead><tr>
        <th>カテゴリ</th><th>項目名</th>
        <th class="ph-pay">数量</th><th class="ph-pay">単位</th><th class="ph-pay">通貨</th>
        <th class="ph-pay">単価</th><th class="ph-pay" style="color:#ccc;">CD</th>
        <th class="ph-bill">数量</th><th class="ph-bill">通貨</th><th class="ph-bill">単価</th>
        <th class="ph-profit">乗せ幅</th><th class="ph-profit">小計</th><th class="ph-profit">利益</th><th class="ph-profit">備考</th><th>サブコン</th>
      </tr></thead><tbody>`;

    let totSub = 0;
    allRows.forEach(d => {
      if (d._type === 'subtotal') {
        // 小計行セパレーター
        const sepPc = d.profitText.startsWith('-') ? 'pv-neg' : (d.profitText === '—' || d.profitText === '0') ? 'pv-zero' : 'pv-pos';
        html += `<tr class="pv-subtotal-sep">
          <td colspan="11" class="pv-subtotal-sep-label">━━ ${escHtml(d.label || '小計')}</td>
          <td class="pv-num pv-subtotal">${escHtml(d.subtotalText)}</td>
          <td class="pv-pr ${sepPc} pv-num">${escHtml(d.profitText)}</td>
          <td colspan="2"></td>
        </tr>`;
        return;
      }
      const pc      = d.profit > 0 ? 'pv-pos' : d.profit < 0 ? 'pv-neg' : 'pv-zero';
      const nameCls = d.taxed ? 'pv-name pv-taxed' : 'pv-name';
      const sub     = (d.bq || 0) * (d.bp || 0);
      totSub += sub;
      html += `<tr>
        <td class="pv-name" style="font-size:11px;">${escHtml(getCatLabel(d.cat))}</td>
        <td class="${nameCls}">${escHtml(d.name)}</td>
        <td class="pv-num">${fmtRaw(d.pq)}</td><td>${escHtml(d.un || '')}</td><td>${escHtml(d.pc)}</td>
        <td class="pv-num">${fmtRaw(d.pp)}</td>
        <td class="pv-cd pv-num">${fmtRaw(d.cd)}</td>
        <td class="pv-num">${fmtRaw(d.bq)}</td><td>${escHtml(d.bc)}</td>
        <td class="pv-num">${fmtRaw(d.bp)}</td>
        <td class="pv-num">${fmtRaw(d.mk)}</td>
        <td class="pv-num pv-subtotal">${fmtRaw(sub)}</td>
        <td class="pv-pr ${pc} pv-num">${fmtRaw(d.profit)}</td>
        <td class="pv-name">${escHtml(d.note)}</td>
        <td class="pv-name">${escHtml(d.sv)}</td>
      </tr>`;
    });

    const totPc = totPr > 0 ? 'pv-pos' : totPr < 0 ? 'pv-neg' : 'pv-zero';
    html += `</tbody><tfoot><tr class="pv-total">
      <td colspan="2" style="text-align:right;">合　計</td>
      <td colspan="4">—</td><td style="background:#e8e8e8;color:#aaa;">—</td>
      <td colspan="2">—</td><td class="pv-num">—</td>
      <td class="pv-num">${fmtRaw(totMk)}</td>
      <td class="pv-num pv-subtotal">${fmtRaw(totSub)}</td>
      <td class="pv-pr ${totPc} pv-num">${fmtRaw(totPr)}</td>
      <td></td><td></td>
    </tr></tfoot></table>`;

    document.getElementById('previewTableWrap').innerHTML = html;

    const cond = getConditions();
    const condFields = [
      { lbl: '積み地（POL）',   val: cond.pol },
      { lbl: '揚げ地（POD）',   val: cond.pod },
      { lbl: '発地',            val: cond.origin },
      { lbl: '仕向地',          val: cond.dest },
      { lbl: 'インコタームズ',  val: cond.incoterms },
      { lbl: '輸送モード',      val: cond.mode },
      { lbl: 'コンテナ',        val: cond.container },
      { lbl: '貨物名',          val: cond.cargo },
      { lbl: '重量',            val: cond.weight },
      { lbl: '容積',            val: cond.volume },
      { lbl: '荷姿',            val: cond.packing },
      { lbl: '危険品',          val: cond.hazmat },
    ].filter(f => f.val);

    const pvCond = document.getElementById('pvCondBox');
    if (condFields.length || cond.free) {
      let condHtml = condFields.map(f =>
        `<div class="pv-cond-item"><span class="pv-cond-lbl">${escHtml(f.lbl)}：</span><span class="pv-cond-val">${escHtml(f.val)}</span></div>`
      ).join('');
      pvCond.innerHTML = `<strong>🚢 引き合い条件</strong><div class="pv-cond-grid">${condHtml}</div>`;
      if (cond.free) pvCond.innerHTML += `<div class="pv-cond-free">${escHtml(cond.free)}</div>`;
      pvCond.style.display = 'block';
    } else {
      pvCond.style.display = 'none';
    }

    // 貨物ボリューム情報（サイズ計算結果がある場合）
    const pvCargo = document.getElementById('pvCargoBox');
    if (_lastCalcResult) {
      const { totalCBM, totalKg, totalPcs, rt, cw } = _lastCalcResult;
      const cargoItems = [
        { lbl: '総CBM',          val: totalCBM.toFixed(4) + ' CBM' },
        { lbl: '総重量',         val: totalKg.toLocaleString('ja-JP') + ' kg' },
        { lbl: '総個数',         val: totalPcs.toLocaleString('ja-JP') + ' pcs' },
        { lbl: 'RT（海上）',     val: rt.toFixed(4) + ' R/T' },
        { lbl: 'CW（航空）',     val: cw.toLocaleString('ja-JP') + ' kg' },
        { lbl: 'コンテナ目安',   val: suggestContainers(totalCBM, totalKg) },
      ].filter(f => f.val && f.val !== '— ');
      const gridHtml = cargoItems.map(f =>
        `<div class="pv-cargo-item"><span class="pv-cargo-lbl">${f.lbl}：</span><span class="pv-cargo-val">${escHtml(f.val)}</span></div>`
      ).join('');
      pvCargo.innerHTML = `<strong>📐 貨物ボリューム情報（サイズ計算結果）</strong><div class="pv-cargo-grid">${gridHtml}</div>`;
      pvCargo.style.display = 'block';
    } else {
      pvCargo.style.display = 'none';
    }

    const remarkText = getRemarkText();
    const pvRemark = document.getElementById('pvRemarkBox');
    if (remarkText) {
      pvRemark.style.display = 'block';
      pvRemark.innerHTML = `<strong>📝 条件・リマーク</strong>${escHtml(remarkText)}`;
    } else {
      pvRemark.style.display = 'none';
    }
    // 税計算用に合計小計をセット
    const pvTotSub = document.getElementById('pvTotalSubtotal');
    if (pvTotSub) pvTotSub.dataset.raw = String(totSub);
    document.getElementById('previewOverlay').classList.add('open');
    updatePreviewTax();
    // Apply saved customization
    initPreviewCustomize();
    applyPreviewCustomize();
    // Hook up change listeners (attach only once via flag)
    if (!document.getElementById('pvCustomizeWrap')?.dataset.listenerSet) {
      document.querySelectorAll('.pv-col-chk, .pv-sec-chk').forEach(chk => {
        chk.addEventListener('change', applyPreviewCustomize);
      });
      const wrap = document.getElementById('pvCustomizeWrap');
      if (wrap) wrap.dataset.listenerSet = '1';
    }
    } catch (err) {
      console.error('[openPreview] エラー:', err);
      alert('プレビュー表示中にエラーが発生しました。\n' + err.message);
    }
  }

  // ========== プレビュー消費税計算 ==========
  function updatePreviewTax() {
    const taxRateEl = document.getElementById('pvTaxRate');
    const totalSub  = parseFloat(document.getElementById('pvTotalSubtotal')?.dataset.raw || '0');
    if (!taxRateEl) return;
    const rate = parseFloat(taxRateEl.value) / 100 || 0;
    const tax  = totalSub * rate;
    const total = totalSub + tax;
    const taxEl   = document.getElementById('pvTaxAmount');
    const totalEl = document.getElementById('pvTaxTotal');
    if (taxEl)   taxEl.textContent   = rate > 0 ? fmt(tax)   : '—';
    if (totalEl) totalEl.textContent = rate > 0 ? fmt(total) : '—';
  }

  // ========== プレビュー 表示カスタマイズ ==========
  const PV_CUSTOMIZE_KEY = 'pvCustomize_v1';

  function applyPreviewCustomize() {
    const table = document.getElementById('previewTable');
    if (!table) return;

    // 列表示切り替え
    // pay列: col index 2,3,4,5,6  (pq, un, pc, pp, cd) → th/td index 3-7
    // bill列: index 7,8,9 → th/td index 8-10
    // cat: index 0
    // mk: index 10
    // profit: index 12
    // note: index 13
    // sv: index 14
    const colMap = {
      cat:    [0],
      pay:    [2, 3, 4, 5, 6],
      bill:   [7, 8, 9],
      mk:     [10],
      profit: [12],
      note:   [13],
      sv:     [14],
    };

    document.querySelectorAll('.pv-col-chk').forEach(chk => {
      const indices = colMap[chk.dataset.col] || [];
      const show = chk.checked;
      indices.forEach(ci => {
        table.querySelectorAll(`tr th:nth-child(${ci + 1}), tr td:nth-child(${ci + 1})`).forEach(cell => {
          cell.style.display = show ? '' : 'none';
        });
      });
    });

    // セクション表示切り替え
    const secMap = {
      meta:   'pvMeta',
      cond:   'pvCondBox',
      cargo:  'pvCargoBox',
      remark: 'pvRemarkBox',
      tax:    'pvTaxBox',
    };
    document.querySelectorAll('.pv-sec-chk').forEach(chk => {
      const el = document.getElementById(secMap[chk.dataset.sec]);
      if (!el) return;
      // Only hide if currently shown (don't override display:none from data absence)
      if (!chk.checked) {
        el.dataset.pvHidden = '1';
        el.style.display = 'none';
      } else {
        delete el.dataset.pvHidden;
        // restore only if it was hidden by us (not by data absence)
        if (el.dataset.pvWasVisible === '1') el.style.display = '';
      }
    });

    // save settings
    const settings = {};
    document.querySelectorAll('.pv-col-chk, .pv-sec-chk').forEach(chk => {
      settings[chk.dataset.col || chk.dataset.sec] = chk.checked;
    });
    localStorage.setItem(PV_CUSTOMIZE_KEY, JSON.stringify(settings));
  }

  function initPreviewCustomize() {
    const saved = localStorage.getItem(PV_CUSTOMIZE_KEY);
    if (!saved) return;
    try {
      const settings = JSON.parse(saved);
      document.querySelectorAll('.pv-col-chk, .pv-sec-chk').forEach(chk => {
        const key = chk.dataset.col || chk.dataset.sec;
        if (key in settings) chk.checked = settings[key];
      });
    } catch (_) { /* ignore */ }
  }

  function closePreview()  { document.getElementById('previewOverlay').classList.remove('open'); }
  function overlayClick(e) { if (e.target === document.getElementById('previewOverlay')) closePreview(); }

  function copyTSV() {
    const data = collectData();
    if (!data.length) return;
    const hdr = getQuoteHeader();
    let totCost = 0, totBill = 0, totMk = 0;
    data.forEach(d => { totCost += d.cost; totBill += d.bill; totMk += d.mk; });
    const totPr = totBill - totCost;
    const lines = [];
    if (hdr.ref || hdr.customer || hdr.person) {
      if (hdr.ref)      lines.push(`仮REF#\t${hdr.ref}`);
      if (hdr.customer) lines.push(`引き合い元\t${hdr.customer}`);
      if (hdr.person)   lines.push(`担当\t${hdr.person}`);
      lines.push('');
    }
    lines.push(['カテゴリ','項目名','数量','通貨','単価','CD','数量','通貨','単価','乗せ幅','利益','備考'].join('\t'));
    data.forEach(d => lines.push([
      getCatLabel(d.cat), d.name, fmtRaw(d.pq), d.pc, fmtRaw(d.pp), fmtRaw(d.cd),
      fmtRaw(d.bq), d.bc, fmtRaw(d.bp), fmtRaw(d.mk), fmtRaw(d.profit), d.note
    ].join('\t')));
    lines.push(['合計','','','','','—','','','',fmtRaw(totMk),fmtRaw(totPr),''].join('\t'));
    const remarkText = getRemarkText();
    if (remarkText) {
      lines.push('');
      lines.push('【条件・リマーク】');
      remarkText.split('\n').forEach(l => { if (l.trim()) lines.push(l); });
    }
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      const msg = document.getElementById('copyMsg');
      msg.classList.add('show');
      setTimeout(() => msg.classList.remove('show'), 2500);
      showToast('📋 クリップボードにコピーしました！', 'success');
    }).catch(() => { alert('コピーに失敗しました。'); showToast('⚠️ コピーに失敗しました', 'error'); });
  }

  // ========== PDF 出力 ==========
  function exportPDF() {
    // @media print CSS がプレビュー以外を非表示にする
    window.print();
  }

  // ========== Excel 出力（SheetJS） ==========
  function exportExcel() {
    if (typeof XLSX === 'undefined') {
      alert('SheetJSライブラリが読み込まれていません。ページを再読み込みしてください。');
      return;
    }
    const allRows = collectAllRows();
    const data = allRows.filter(r => r._type === 'data');
    if (!data.length) { alert('行がありません。'); return; }
    const hdr = getQuoteHeader();

    const aoaRows = [];
    // ヘッダ情報
    if (hdr.ref)      aoaRows.push(['仮 REF #', hdr.ref]);
    if (hdr.customer) aoaRows.push(['引き合い元', hdr.customer]);
    if (hdr.person)   aoaRows.push(['担当', hdr.person]);
    if (aoaRows.length) aoaRows.push([]);

    // 列ヘッダ
    aoaRows.push([
      'カテゴリ', '項目名', '課税',
      '数量(原価)', '通貨(原価)', '単価(原価)',
      'CD',
      '数量(請求)', '通貨(請求)', '単価(請求)',
      '乗せ幅', '小計', '利益', '備考', 'サブコン'
    ]);

    let totSub = 0, totProfit = 0;
    allRows.forEach(d => {
      if (d._type === 'subtotal') {
        // 小計セパレーター行
        aoaRows.push([
          `━━ ${d.label || '小計'}`, '', '', '', '', '', '', '', '', '',
          '', d.subtotalText, d.profitText, '', ''
        ]);
        return;
      }
      const sub = (d.bq || 0) * (d.bp || 0);
      totSub    += sub;
      totProfit += d.profit;
      aoaRows.push([
        getCatLabel(d.cat),
        d.name,
        d.taxed ? '●' : '',
        d.pq, d.pc, d.pp,
        d.cd,
        d.bq, d.bc, d.bp,
        d.mk,
        sub,
        d.profit,
        d.note,
        d.sv
      ]);
    });
    // 合計行
    aoaRows.push([]);
    aoaRows.push(['合　計', '', '', '', '', '', '', '', '', '', '', totSub, totProfit, '', '']);

    // 条件・リマーク
    const remarkText = getRemarkText?.() || '';
    if (remarkText) {
      aoaRows.push([]);
      aoaRows.push(['【条件・リマーク】']);
      remarkText.split('\n').forEach(line => { if (line.trim()) aoaRows.push([line]); });
    }

    const ws   = XLSX.utils.aoa_to_sheet(aoaRows);
    const wb   = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '見積もり');
    XLSX.writeFile(wb, buildFileName('xlsx'));
    showToast('📊 Excelファイルを出力しました', 'success');
  }

  // CSV列定義（key: collectData()の行データキー、hdr: ヘッダ文字列）
  const CSV_COL_DEFS = [
    { key: 'cat',    hdr: 'カテゴリ(raw)',  fn: d => d.cat },
    { key: 'name',   hdr: '項目名',         fn: d => d.name },
    { key: 'pq',     hdr: '数量',           fn: d => fmtRaw(d.pq) },
    { key: 'un',     hdr: '単位',           fn: d => d.un || '' },
    { key: 'pc',     hdr: '通貨',           fn: d => d.pc },
    { key: 'pp',     hdr: '単価',           fn: d => fmtRaw(d.pp) },
    { key: 'cd',     hdr: 'CD',             fn: d => fmtRaw(d.cd) },
    { key: 'bq',     hdr: '数量(請求)',     fn: d => fmtRaw(d.bq) },
    { key: 'bc',     hdr: '通貨(請求)',     fn: d => d.bc },
    { key: 'bp',     hdr: '単価(請求)',     fn: d => fmtRaw(d.bp) },
    { key: 'mk',     hdr: '乗せ幅',         fn: d => fmtRaw(d.mk) },
    { key: 'sub',    hdr: '小計',           fn: d => fmtRaw((d.bq||0)*(d.bp||0)) },
    { key: 'profit', hdr: '利益',           fn: d => fmtRaw(d.profit) },
    { key: 'note',   hdr: '備考',           fn: d => d.note },
    { key: 'sv',     hdr: 'サブコン',       fn: d => d.sv },
  ];

  function downloadCSV() {
    const data = collectData();
    if (!data.length) { alert('行がありません。'); return; }
    document.getElementById('csvColModal').classList.add('open');
  }

  function closeCsvColModal() {
    document.getElementById('csvColModal').classList.remove('open');
  }

  // CSV列プリセット
  // client: 客先提示用（カテゴリ・項目名・単位・請求数量・請求通貨・請求単価・小計・備考）
  // internal: 社内管理用（全列）
  const CSV_PRESET_COLS = {
    client:   ['cat', 'name', 'un', 'bq', 'bc', 'bp', 'sub', 'note'],
    internal: ['cat', 'name', 'pq', 'un', 'pc', 'pp', 'cd', 'bq', 'bc', 'bp', 'mk', 'sub', 'profit', 'note', 'sv'],
  };

  function applyCsvPreset(presetKey) {
    const cols = CSV_PRESET_COLS[presetKey];
    if (!cols) return;
    document.querySelectorAll('.csv-col-chk').forEach(chk => {
      chk.checked = cols.includes(chk.dataset.col);
    });
  }

  function toggleAllCsvCols() {
    const chks = document.querySelectorAll('.csv-col-chk');
    const allChecked = [...chks].every(c => c.checked);
    chks.forEach(c => c.checked = !allChecked);
  }

  function doDownloadCSV() {
    const data = collectData();
    if (!data.length) { closeCsvColModal(); alert('行がありません。'); return; }
    const selected = [...document.querySelectorAll('.csv-col-chk:checked')].map(c => c.dataset.col);
    if (!selected.length) { alert('1列以上を選択してください。'); return; }
    const cols = CSV_COL_DEFS.filter(c => selected.includes(c.key));
    const headerRow = cols.map(c => csvEsc(c.hdr)).join(',');
    const dataRows  = data.map(d => cols.map(c => csvEsc(c.fn(d))).join(','));
    const BOM  = '﻿';
    const blob = new Blob([BOM + [headerRow, ...dataRows].join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = buildFileName('csv');
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
    closeCsvColModal();
  }

  // ========== CSV読み込み ==========
  function toggleCsvZone() {
    const zone = document.getElementById('csvDropZone');
    const msg  = document.getElementById('csvMsg');
    zone.style.display = zone.style.display === 'block' ? 'none' : 'block';
    msg.className = ''; msg.textContent = '';
  }
  function onDragOver(e)  { e.preventDefault(); document.getElementById('csvDropZone').classList.add('active'); }
  function onDragLeave()  { document.getElementById('csvDropZone').classList.remove('active'); }
  function onDrop(e) {
    e.preventDefault();
    document.getElementById('csvDropZone').classList.remove('active');
    const file = e.dataTransfer.files[0];
    if (file) parseCSVFile(file);
  }
  function loadCSV(e) {
    const file = e.target.files[0];
    if (file) parseCSVFile(file);
    e.target.value = '';
  }

  function parseCSVFile(file) {
    if (!file.name.endsWith('.csv')) {
      showCsvMsg('error', '⚠️ CSVファイル（.csv）を選択してください'); return;
    }
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        let text = ev.target.result.replace(/^﻿/, '');
        const rows = parseCSVText(text);
        if (!rows.length) { showCsvMsg('error', '⚠️ データが見つかりませんでした'); return; }
        let dataRows = rows;
        if (rows[0][0] && isNaN(parseFloat(rows[0][0]))) dataRows = rows.slice(1);
        dataRows = dataRows.filter(r => r[0] && r[0] !== '合計' && !r[0].startsWith('カテゴリ'));
        if (!dataRows.length) { showCsvMsg('error', '⚠️ 有効なデータ行がありませんでした'); return; }

        // 先頭列がカテゴリのraw値なら新フォーマット
        const isNewFmt = CAT_VALUES.includes(dataRows[0][0]);
        const off = isNewFmt ? 1 : 0;
        let added = 0;
        dataRows.forEach(cols => {
          rowCount++;
          const id = rowCount;
          const tr = document.createElement('tr');
          tr.id = `row-${id}`;
          tr.replaceChildren(buildRowHTML(id));
          document.getElementById('tableBody').appendChild(tr);
          initDrag(tr);

          const cat     = isNewFmt ? (cols[0] || '') : '';
          const rawName = cols[0 + off] || '';
          const taxed   = rawName.startsWith('*');
          const name    = taxed ? rawName.slice(1) : rawName;
          const pq = parseFloat(cols[1 + off]) || 1;
          const pc = cols[2 + off] || 'JPY';
          const pp = parseFloat(cols[3 + off]) || 0;
          const mk = parseFloat(cols[8 + off]) || 0;
          const nt = cols[10 + off] || '';

          document.getElementById(`nm-${id}`).value = name;
          document.getElementById(`pq-${id}`).value = pq;
          document.getElementById(`pp-${id}`).value = pp;
          document.getElementById(`mk-${id}`).value = mk;
          document.getElementById(`nt-${id}`).value = nt;
          const pcEl = document.getElementById(`pc-${id}`);
          if (pcEl && CURRENCIES.includes(pc)) pcEl.value = pc;
          if (cat && CAT_VALUES.includes(cat)) {
            document.getElementById(`cat-${id}`).value = cat;
            onCatChange(id);
          }
          if (taxed) { document.getElementById(`tx-${id}`).checked = true; toggleTax(id); }
          checkUnfilled(id);
          onPay(id);
          added++;
        });
        showCsvMsg('success', `✅ ${added}行を読み込みました！`);
      } catch (err) {
        showCsvMsg('error', `⚠️ 読み込みエラー：${err.message}`);
      }
    };
    reader.readAsText(file, 'UTF-8');
  }

  function parseCSVText(text) {
    const rows = [];
    text.split(/\r?\n/).forEach(line => {
      if (!line.trim()) return;
      const cols = [];
      let cur = '', inQ = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQ) {
          if (c === '"' && line[i+1] === '"') { cur += '"'; i++; }
          else if (c === '"') { inQ = false; }
          else cur += c;
        } else {
          if (c === '"') inQ = true;
          else if (c === ',') { cols.push(cur); cur = ''; }
          else cur += c;
        }
      }
      cols.push(cur);
      rows.push(cols);
    });
    return rows;
  }

  function showCsvMsg(type, text) {
    const el = document.getElementById('csvMsg');
    el.className = type; el.textContent = text;
    setTimeout(() => { el.className = ''; el.textContent = ''; }, 4000);
  }
