// ========== プレビュー・CSV (app-preview.js) ==========

  // 消費税率（プレビュー）：基本 10%。
  // 「輸出免税（0%）を適用」チェックボックス（#pvExemptChk）を手動でオンにした場合のみ 0% に切替。
  const PV_TAX_RATE_DEFAULT = 0.10;
  function getEffectiveTaxRate() {
    const chk = document.getElementById('pvExemptChk');
    return (chk && chk.checked) ? 0 : PV_TAX_RATE_DEFAULT;
  }

  // ========== プレビュー＆エクスポート ==========
  function getQuoteHeader() {
    return {
      ref:        document.getElementById('qf-ref')?.value || '',
      customer:   document.getElementById('qf-customer')?.value || '',
      person:     document.getElementById('qf-person')?.value || '',
      date:       document.getElementById('qf-date')?.value || '',
      validUntil: document.getElementById('qf-valid-until')?.value || '',
    };
  }

  // 担当者名に敬称（既定：様）を付与。既に様/さん/御中/殿 等が付いていれば追加しない。
  // ファイル名生成には敬称を付けない（buildFileName は raw を使用）。
  // スペース（半角/全角）を含む場合は「会社名＋氏名」とみなし、最後のトークンの後ろに「様」を付ける。
  function formatPersonWithHonorific(name) {
    const n = (name || '').trim();
    if (!n) return '';
    if (/(様|さま|サマ|さん|御中|殿|先生|社長|部長|課長|主任|Mr\.|Ms\.|Mrs\.|Dear)\s*$/i.test(n)) return n;
    if (/[\s　]/.test(n)) {
      const tokens = n.split(/[\s　]+/);
      const last = tokens.pop();
      return tokens.join(' ') + ' ' + last + ' 様';
    }
    return n + ' 様';
  }

  /**
   * ファイル名生成: REF_引き合い元_担当.<ext>
   * 入力がある項目だけ使用。すべて空なら "見積もり_YYYYMMDD"
   */
  function buildFileName(ext) {
    const hdr   = getQuoteHeader();
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const safe  = s => s.replace(/[\/\\:*?"<>|\t\n\r]/g, '_').replace(/_+/g, '_').trim().slice(0, 40);
    const cond = getConditions();
    const mode = safe(cond.mode || '');
    const parts = [hdr.ref, hdr.customer, mode, hdr.person].map(safe).filter(Boolean);
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
      if (tr.dataset.type === 'remark') {
        const text = tr.querySelector('.remark-row-input')?.value || '';
        rows.push({ _type: 'remark', text });
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

  // 出力物（PDF/Excel/TSV）のフッターに刻む「為替の出典 / 取得日時」「作成日」メタ情報
  function getFxAuditMeta() {
    const last = localStorage.getItem(SharedStorage.KEYS.FX_LAST_FETCHED);
    const fxLine = last
      ? `為替出典：open.er-api.com 中値（Mid Rate）（取得日時 ${new Date(last).toLocaleString('ja-JP', {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}）※ 実際の決済レート（TTS等）とは異なる参考値`
      : `為替出典：手動設定値（自動取得未実行）`;
    const created = `作成日：${new Date().toLocaleString('ja-JP', {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}`;
    return { fxLine, created, hasFresh: !!last };
  }

  // 為替キャッシュが 24h 超過しているか
  function isFxStale() {
    const last = localStorage.getItem(SharedStorage.KEYS.FX_LAST_FETCHED);
    if (!last) return true;
    const ageMs = Date.now() - new Date(last).getTime();
    return ageMs > 24 * 60 * 60 * 1000;
  }

  // ========== 出力前バリデーション ==========
  // 出力（プレビュー／Excel／CSV／PDF）の前に、よくあるミス／忘れを検出して
  // 「3 件警告がありますが出力しますか？」と確認するゲート。
  // 戻り値：true = 続行、false = キャンセル
  function preOutputValidationGate(label) {
    const data = collectData();
    const hdr  = getQuoteHeader();
    const warnings = [];

    if (!hdr.ref)      warnings.push('「仮 REF #」が未入力です');
    if (!hdr.customer) warnings.push('「引き合い元名称」が未入力です');
    if (!hdr.person)   warnings.push('「担当」が未入力です');

    const cond = (typeof getConditions === 'function') ? getConditions() : null;
    if (cond && !cond.incoterms) warnings.push('インコタームズが選択されていません');

    if (!data.length) {
      warnings.push('見積もり行が 1 件もありません');
    } else {
      // 行レベルチェック
      let zeroPriceCount = 0, mixedCcyCount = 0, emptyNameCount = 0;
      data.forEach(d => {
        if (!d.name || !d.name.trim()) emptyNameCount++;
        // 名前あり・かつ請求単価ゼロ（ただし「式」「note」単位や明示メモ行は除外）
        const isMemoRow = (d.un === '式' || d.un === 'note' || d.un === 'memo')
                       || (d.name && /^[#＃].+/.test(d.name.trim()));
        if (d.name && d.name.trim() && !isMemoRow && (!d.bp || d.bp === 0) && (!d.bq || d.bq === 0)) {
          zeroPriceCount++;
        }
        if (d.pc && d.bc && d.pc !== d.bc) mixedCcyCount++;
      });
      if (emptyNameCount)  warnings.push(`項目名が空の行が ${emptyNameCount} 件あります`);
      if (zeroPriceCount)  warnings.push(`請求単価がゼロの行が ${zeroPriceCount} 件あります`);
      if (mixedCcyCount)   warnings.push(`支払い通貨と請求通貨が異なる行が ${mixedCcyCount} 件あります（乗せ幅は請求通貨建てで加算される点に注意）`);
      // 為替キャッシュ鮮度チェック（多通貨が絡む案件のみ）
      const hasNonJpy = data.some(d => (d.pc && d.pc !== 'JPY') || (d.bc && d.bc !== 'JPY'));
      if (hasNonJpy && isFxStale()) {
        warnings.push('為替レートが 24 時間以上前の値です。FX パネルから「🔄 今すぐ取得」を推奨');
      }
    }

    if (!warnings.length) return true;

    const msg = `⚠️ ${label}前に ${warnings.length} 件の確認事項があります：\n\n`
      + warnings.map((w, i) => `${i+1}. ${w}`).join('\n')
      + '\n\nこのまま出力しますか？';
    return confirm(msg);
  }

  function openPreview() {
    try {
    const allRows = collectAllRows();
    const data = allRows.filter(r => r._type === 'data');
    if (!data.length) { alert('行がありません。'); return; }
    if (!preOutputValidationGate('プレビュー表示')) return;
    const hdr = getQuoteHeader();
    let totCost = 0, totBill = 0, totMk = 0;
    data.forEach(d => { totCost += d.cost; totBill += d.bill; totMk += d.mk; });
    const totPr = totBill - totCost;

    const metaEl = document.getElementById('pvMeta');
    const metaHTML = [
      hdr.ref      ? `<div class="pv-meta-item"><span class="lbl">仮 REF #</span><span class="val">${escHtml(hdr.ref)}</span></div>` : '',
      hdr.customer ? `<div class="pv-meta-item"><span class="lbl">引き合い元</span><span class="val">${escHtml(hdr.customer)}</span></div>` : '',
      hdr.person   ? `<div class="pv-meta-item"><span class="lbl">担当</span><span class="val">${escHtml(formatPersonWithHonorific(hdr.person))}</span></div>` : '',
    ].join('');
    metaEl.innerHTML = metaHTML;
    metaEl.style.display = metaHTML ? 'flex' : 'none';

    const taxRate = getEffectiveTaxRate();

    let html = `<table id="previewTable">
      <thead><tr>
        <th>カテゴリ</th><th>サブコン</th><th>項目名</th>
        <th class="ph-pay">数量</th><th class="ph-pay">単位</th><th class="ph-pay">通貨</th>
        <th class="ph-pay">単価</th><th class="ph-pay" style="color:#ccc;">CD</th>
        <th class="ph-bill">数量</th><th class="ph-bill">通貨</th><th class="ph-bill">単価</th>
        <th class="ph-profit">乗せ幅</th><th class="ph-profit">小計</th><th class="ph-jpy">円換算</th><th class="ph-profit">消費税</th><th class="ph-profit">利益</th><th class="ph-profit">備考</th>
      </tr></thead><tbody>`;

    let totSub = 0, totTax = 0, totJpy = 0;
    allRows.forEach(d => {
      if (d._type === 'remark') {
        html += `<tr class="pv-table-remark-row">
          <td colspan="17" class="pv-remark-cell">💬 ${escHtml(d.text)}</td>
        </tr>`;
        return;
      }
      if (d._type === 'subtotal') {
        // 小計セパレーター。先頭ラベルは cat+sv+name+pay(5)+bill(3)+mk = 12 列ぶん
        const sepPc = d.profitText.startsWith('-') ? 'pv-neg' : (d.profitText === '—' || d.profitText === '0') ? 'pv-zero' : 'pv-pos';
        html += `<tr class="pv-subtotal-sep">
          <td colspan="12" class="pv-subtotal-sep-label">━━ ${escHtml(d.label || '小計')}</td>
          <td class="pv-num pv-subtotal">${escHtml(d.subtotalText)}</td>
          <td class="pv-jpy"></td>
          <td class="pv-num pv-tax-cell"></td>
          <td class="pv-pr ${sepPc} pv-num">${escHtml(d.profitText)}</td>
          <td></td>
        </tr>`;
        return;
      }
      const pc      = d.profit > 0 ? 'pv-pos' : d.profit < 0 ? 'pv-neg' : 'pv-zero';
      const nameCls = d.taxed ? 'pv-name pv-taxed' : 'pv-name';
      const sub     = (d.bq || 0) * (d.bp || 0);
      const jpyAmt  = (typeof toJPY === 'function') ? Math.ceil(toJPY(sub, d.bc)) : sub;
      const taxAmt  = d.taxed ? sub * taxRate : 0;
      totSub += sub;
      totTax += taxAmt;
      totJpy += jpyAmt;
      const jpyCellText = (d.bc && d.bc !== 'JPY') ? fmtRaw(jpyAmt) : '—';
      const taxCellText = d.taxed ? fmtRaw(taxAmt) : '';
      html += `<tr>
        <td class="pv-name" style="font-size:11px;">${escHtml(getCatLabel(d.cat))}</td>
        <td class="pv-name">${escHtml(d.sv)}</td>
        <td class="${nameCls}">${escHtml(d.name)}</td>
        <td class="pv-num">${fmtRaw(d.pq)}</td><td>${escHtml(d.un || '')}</td><td>${escHtml(d.pc)}</td>
        <td class="pv-num">${fmtRaw(d.pp)}</td>
        <td class="pv-cd pv-num">${fmtRaw(d.cd)}</td>
        <td class="pv-num">${fmtRaw(d.bq)}</td><td>${escHtml(d.bc)}</td>
        <td class="pv-num">${fmtRaw(d.bp)}</td>
        <td class="pv-num">${fmtRaw(d.mk)}</td>
        <td class="pv-num pv-subtotal">${fmtRaw(sub)}</td>
        <td class="pv-jpy">${jpyCellText}</td>
        <td class="pv-num pv-tax-cell" data-sub="${sub}" data-taxed="${d.taxed ? 1 : 0}">${taxCellText}</td>
        <td class="pv-pr ${pc} pv-num">${fmtRaw(d.profit)}</td>
        <td class="pv-name">${escHtml(d.note)}</td>
      </tr>`;
    });

    const totPc = totPr > 0 ? 'pv-pos' : totPr < 0 ? 'pv-neg' : 'pv-zero';
    const totTaxText = fmtRaw(totTax);
    // 合計行：cat+sv+name = colspan 3 を「合計」ラベルに割当て
    // data-ft-col: applyPreviewCustomize() が tfoot を別制御するための識別属性
    // （tfoot は colspan セルを持つため tr td:nth-child(n) での列制御が不可）
    html += `</tbody><tfoot><tr class="pv-total">
      <td colspan="3" style="text-align:right;">合　計</td>
      <td colspan="4">—</td><td data-ft-col="pay" style="background:#e8e8e8;color:#aaa;">—</td>
      <td colspan="2" data-ft-col="bill">—</td><td data-ft-col="bill" class="pv-num">—</td>
      <td data-ft-col="mk" class="pv-num">${fmtRaw(totMk)}</td>
      <td class="pv-num pv-subtotal">${fmtRaw(totSub)}</td>
      <td data-ft-col="tax-col" class="pv-num pv-tax-total">${totTaxText}</td>
      <td data-ft-col="profit" class="pv-pr ${totPc} pv-num">${fmtRaw(totPr)}</td>
      <td data-ft-col="note"></td>
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
      { lbl: 'HSコード',        val: cond.hsCode },
      { lbl: '関税率（基本）',   val: cond.hsBasic },
      { lbl: '協定税率',        val: cond.hsPref },
      { lbl: '協定税率 備考',   val: cond.hsPrefNote },
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
    // 監査メタ：為替出典・取得日時・作成日（プレビュー底部）
    const pvAudit = document.getElementById('pvAuditMeta');
    if (pvAudit) {
      const m = getFxAuditMeta();
      pvAudit.innerHTML =
        '<div class="pv-audit-line">' + escHtml(m.fxLine) + '</div>' +
        '<div class="pv-audit-line">' + escHtml(m.created) + '</div>' +
        (m.hasFresh ? '' : '<div class="pv-audit-warn">⚠️ 為替を自動取得していません。手動値またはデフォルト値で表示中</div>');
    }
    // 税計算用に合計小計をセット
    const pvTotSub = document.getElementById('pvTotalSubtotal');
    if (pvTotSub) pvTotSub.dataset.raw = String(totSub);
    // pvWasVisible を各セクション要素に記録する（applyPreviewCustomize の「戻す」判定に使用）
    // ここで表示中（display !== 'none'）のセクションを '1' としてマーク
    ['pvMeta','pvCondBox','pvCargoBox','pvRemarkBox','pvTaxBox'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.dataset.pvWasVisible = (el.style.display !== 'none') ? '1' : '0';
    });
    document.getElementById('previewOverlay').classList.add('open');
    // 輸出免税チェックボックス：常にリセット（デフォルト=オフ）してリスナー登録
    const exemptChk = document.getElementById('pvExemptChk');
    if (exemptChk) {
      exemptChk.checked = false;
      if (!exemptChk.dataset.listenerSet) {
        exemptChk.addEventListener('change', updatePreviewTax);
        exemptChk.dataset.listenerSet = '1';
      }
    }
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

  // ========== プレビュー消費税計算（10% / 輸出免税 0%）==========
  function updatePreviewTax() {
    const totalSub  = parseFloat(document.getElementById('pvTotalSubtotal')?.dataset.raw || '0');
    const rate = getEffectiveTaxRate();
    const isExempt = rate === 0;
    // ラベルテキストをチェックボックス状態に合わせて更新
    const rateLbl = document.getElementById('pvTaxRateLabel');
    if (rateLbl) rateLbl.textContent = isExempt ? '0%（輸出免税）' : '10%（標準）';
    // 行ごとの消費税セルを更新（課税行のみ計算）
    let totTax = 0;
    document.querySelectorAll('#previewTable .pv-tax-cell').forEach(td => {
      const sub   = parseFloat(td.dataset.sub) || 0;
      const taxed = td.dataset.taxed === '1';
      if (!taxed) { td.textContent = ''; return; }
      const amt = sub * rate;
      totTax += amt;
      td.textContent = fmtRaw(amt);
    });
    // 合計行の消費税セル
    const totTaxEl = document.querySelector('#previewTable .pv-tax-total');
    if (totTaxEl) totTaxEl.textContent = fmtRaw(totTax);
    // 底部サマリ（消費税額・税込合計）
    // ※ totalSub（全行合計）ではなく、課税行のみを集計した totTax を使う
    const tax   = totTax;
    const total = totalSub + tax;
    const taxEl   = document.getElementById('pvTaxAmount');
    const totalEl = document.getElementById('pvTaxTotal');
    if (taxEl)   taxEl.textContent   = fmt(tax);
    if (totalEl) totalEl.textContent = fmt(total);
  }

  // ========== プレビュー 表示カスタマイズ ==========
  const PV_CUSTOMIZE_KEY = 'pvCustomize_v1';

  function applyPreviewCustomize() {
    const table = document.getElementById('previewTable');
    if (!table) return;

    // 列表示切り替え。sv（サブコン）を cat 直後に移動した新レイアウト：
    // index 構成: 0:cat 1:sv 2:name 3:pq 4:un 5:pc 6:pp 7:cd 8:bq 9:bc 10:bp 11:mk 12:sub 13:jpy-conv 14:tax 15:profit 16:note
    const colMap = {
      cat:        [0],
      sv:         [1],            // サブコン（カテゴリの直後）
      pay:        [3, 5, 6, 7],   // pq / pc / pp / cd
      unit:       [4],            // un を pay から分離して独立トグル
      bill:       [8, 9, 10],
      mk:         [11],
      'jpy-conv': [13],           // 円換算列
      'tax-col':  [14],           // 消費税列
      profit:     [15],
      note:       [16],
    };

    document.querySelectorAll('.pv-col-chk').forEach(chk => {
      const indices = colMap[chk.dataset.col] || [];
      const show = chk.checked;
      // thead/tbody は nth-child で制御（1セル=1列のため位置が一致）
      indices.forEach(ci => {
        table.querySelectorAll(`thead tr th:nth-child(${ci + 1}), tbody tr td:nth-child(${ci + 1})`).forEach(cell => {
          cell.style.display = show ? '' : 'none';
        });
      });
      // tfoot は colspan セルを持つため nth-child 位置がずれる → data-ft-col で別制御
      table.querySelectorAll(`tfoot td[data-ft-col="${chk.dataset.col}"]`).forEach(cell => {
        cell.style.display = show ? '' : 'none';
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

    // テーブル内リマーク行の表示切り替え
    const remarkRowChk = document.querySelector('.pv-sec-chk[data-sec="table-remark"]');
    if (remarkRowChk && table) {
      table.querySelectorAll('.pv-table-remark-row').forEach(tr => {
        tr.style.display = remarkRowChk.checked ? '' : 'none';
      });
    }

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

  // ========== プレビュー表示カスタマイズ → 出力書類への連動 ==========
  // 現在の pv-col-chk 状態をオブジェクトで取得（チェックボックスが無ければ既定値 true）
  function getPreviewVisibility() {
    const def = { cat: true, pay: true, unit: true, bill: true, mk: true, 'jpy-conv': true, profit: true, note: true, sv: true, 'tax-col': true };
    document.querySelectorAll('.pv-col-chk').forEach(chk => {
      const k = chk.dataset.col;
      if (k && k in def) def[k] = chk.checked;
    });
    return def;
  }
  // PV グループ → CSV/TSV/Excel の列キー集合（unit は pay から独立トグル）
  const PV_GROUP_TO_KEYS = {
    cat:       ['cat'],
    pay:       ['pq', 'pc', 'pp', 'cd'],
    unit:      ['un'],
    bill:      ['bq', 'bc', 'bp'],
    mk:        ['mk'],
    'jpy-conv':['jpyConv'],
    profit:    ['profit'],
    note:      ['note'],
    sv:        ['sv'],
  };
  function getVisibleKeysFromPreview() {
    const vis = getPreviewVisibility();
    // 'name' と 'sub' は常時表示（プレビューでもトグル対象外）
    const visKeys = new Set(['name', 'sub']);
    Object.keys(PV_GROUP_TO_KEYS).forEach(g => {
      if (vis[g]) PV_GROUP_TO_KEYS[g].forEach(k => visKeys.add(k));
    });
    return visKeys;
  }
  // CSV モーダルのチェックボックスをプレビュー設定に同期
  function syncCsvColsToPreview() {
    const visKeys = getVisibleKeysFromPreview();
    document.querySelectorAll('.csv-col-chk').forEach(chk => {
      chk.checked = visKeys.has(chk.dataset.col);
    });
  }

  // TSV 列定義（プレビュー表示カスタマイズに連動。sv をカテゴリ直後に配置）
  const TSV_COL_DEFS = [
    { hdr: 'カテゴリ', fn: d => getCatLabel(d.cat),    pvGroup: 'cat',    role: 'cat'    },
    { hdr: 'サブコン', fn: d => d.sv || '',            pvGroup: 'sv',     role: 'sv'     },
    { hdr: '項目名',   fn: d => d.name,                pvGroup: null,     role: 'name'   },
    { hdr: '数量',     fn: d => fmtRaw(d.pq),          pvGroup: 'pay',    role: 'pq'     },
    { hdr: '単位',     fn: d => d.un || '',            pvGroup: 'unit',   role: 'un'     },
    { hdr: '通貨',     fn: d => d.pc,                  pvGroup: 'pay',    role: 'pc'     },
    { hdr: '単価',     fn: d => fmtRaw(d.pp),          pvGroup: 'pay',    role: 'pp'     },
    { hdr: 'CD',       fn: d => fmtRaw(d.cd),          pvGroup: 'pay',    role: 'cd'     },
    { hdr: '数量',     fn: d => fmtRaw(d.bq),          pvGroup: 'bill',   role: 'bq'     },
    { hdr: '通貨',     fn: d => d.bc,                  pvGroup: 'bill',   role: 'bc'     },
    { hdr: '単価',     fn: d => fmtRaw(d.bp),          pvGroup: 'bill',   role: 'bp'     },
    { hdr: '乗せ幅',       fn: d => fmtRaw(d.mk),          pvGroup: 'mk',       role: 'mk'     },
    { hdr: '円換算(JPY)', fn: d => { const s = (d.bq||0)*(d.bp||0); return (d.bc && d.bc !== 'JPY') ? fmtRaw(typeof toJPY === 'function' ? Math.ceil(toJPY(s, d.bc)) : s) : '—'; }, pvGroup: 'jpy-conv', role: 'jpyConv' },
    { hdr: '利益',         fn: d => fmtRaw(d.profit),      pvGroup: 'profit',   role: 'profit' },
    { hdr: '備考',         fn: d => d.note,                pvGroup: 'note',     role: 'note'   },
  ];

  function copyTSV() {
    const data = collectData();
    if (!data.length) return;
    if (!preOutputValidationGate('クリップボードコピー')) return;
    const hdr = getQuoteHeader();
    let totCost = 0, totBill = 0, totMk = 0;
    data.forEach(d => { totCost += d.cost; totBill += d.bill; totMk += d.mk; });
    const totPr = totBill - totCost;
    const vis = getPreviewVisibility();
    const visCols = TSV_COL_DEFS.filter(c => !c.pvGroup || vis[c.pvGroup]);
    const idxOf = role => visCols.findIndex(c => c.role === role);

    const lines = [];
    if (hdr.ref || hdr.customer || hdr.person || hdr.date || hdr.validUntil) {
      if (hdr.ref)        lines.push(`仮REF#\t${hdr.ref}`);
      if (hdr.customer)   lines.push(`引き合い元\t${hdr.customer}`);
      if (hdr.person)     lines.push(`担当\t${formatPersonWithHonorific(hdr.person)}`);
      if (hdr.date)       lines.push(`発行日\t${hdr.date}`);
      if (hdr.validUntil) lines.push(`有効期限\t${hdr.validUntil}`);
      lines.push('');
    }
    // ヘッダ行
    lines.push(visCols.map(c => c.hdr).join('\t'));
    // データ行
    data.forEach(d => lines.push(visCols.map(c => c.fn(d)).join('\t')));
    // 合計行（先頭セルに「合計」、利益／乗せ幅列に値、CD/通貨は「—」または空）
    const totalRow = visCols.map(c => {
      if (c.role === 'cat')    return '合計';
      if (c.role === 'cd')     return '—';
      if (c.role === 'mk')     return fmtRaw(totMk);
      if (c.role === 'profit') return fmtRaw(totPr);
      return '';
    });
    lines.push(totalRow.join('\t'));
    const remarkText = getRemarkText();
    if (remarkText) {
      lines.push('');
      lines.push('【条件・リマーク】');
      remarkText.split('\n').forEach(l => { if (l.trim()) lines.push(l); });
    }
    // 監査メタ：為替出典・取得日時・作成日
    const meta = getFxAuditMeta();
    lines.push('');
    lines.push(meta.fxLine);
    lines.push(meta.created);
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      const msg = document.getElementById('copyMsg');
      msg.classList.add('show');
      setTimeout(() => msg.classList.remove('show'), 2500);
      quoteShowToast('📋 クリップボードにコピーしました！', 'success');
    }).catch(() => { alert('コピーに失敗しました。'); quoteShowToast('⚠️ コピーに失敗しました', 'error'); });
  }

  // ========== PDF 出力 ==========
  function exportPDF() {
    if (!preOutputValidationGate('PDF 出力（印刷）')) return;
    // @media print CSS がプレビュー以外を非表示にする
    window.print();
  }

  // ========== Excel 出力（SheetJS） ==========
  // 各列定義に pvGroup を付け、プレビュー表示カスタマイズに連動して列を絞り込む
  // pvGroup: null は常時表示（名前/課税/小計）
  const XLSX_COL_DEFS = [
    { hdr: 'カテゴリ',     fn: d => getCatLabel(d.cat),    pvGroup: 'cat',    role: 'cat'    },
    { hdr: 'サブコン',     fn: d => d.sv || '',            pvGroup: 'sv',     role: 'sv'     },
    { hdr: '項目名',       fn: d => d.name,                pvGroup: null,     role: 'name'   },
    { hdr: '課税',         fn: d => d.taxed ? '*' : '',   pvGroup: null,     role: 'tax'    },
    { hdr: '数量(原価)',   fn: d => d.pq,                  pvGroup: 'pay',    role: 'pq'     },
    { hdr: '単位',         fn: d => d.un || '',            pvGroup: 'unit',   role: 'un'     },
    { hdr: '通貨(原価)',   fn: d => d.pc,                  pvGroup: 'pay',    role: 'pc'     },
    { hdr: '単価(原価)',   fn: d => d.pp,                  pvGroup: 'pay',    role: 'pp'     },
    { hdr: 'CD',           fn: d => d.cd,                  pvGroup: 'pay',    role: 'cd'     },
    { hdr: '数量(請求)',   fn: d => d.bq,                  pvGroup: 'bill',   role: 'bq'     },
    { hdr: '通貨(請求)',   fn: d => d.bc,                  pvGroup: 'bill',   role: 'bc'     },
    { hdr: '単価(請求)',   fn: d => d.bp,                  pvGroup: 'bill',   role: 'bp'     },
    { hdr: '乗せ幅',       fn: d => d.mk,                  pvGroup: 'mk',     role: 'mk'     },
    { hdr: '小計',         fn: d => (d.bq || 0) * (d.bp || 0), pvGroup: null,      role: 'sub'     },
    { hdr: '円換算(JPY)', fn: d => { const s = (d.bq||0)*(d.bp||0); return (d.bc && d.bc !== 'JPY') ? (typeof toJPY === 'function' ? Math.ceil(toJPY(s, d.bc)) : '') : ''; }, pvGroup: 'jpy-conv', role: 'jpyConv' },
    { hdr: '消費税',       fn: d => d.taxed ? (d.bq||0)*(d.bp||0)*getEffectiveTaxRate() : '', pvGroup: 'tax-col', role: 'taxAmt' },
    { hdr: '利益',         fn: d => d.profit,              pvGroup: 'profit', role: 'profit' },
    { hdr: '備考',         fn: d => d.note,                pvGroup: 'note',   role: 'note'   },
  ];

  function exportExcel() {
    if (typeof XLSX === 'undefined') {
      alert('SheetJSライブラリが読み込まれていません。ページを再読み込みしてください。');
      return;
    }
    if (!preOutputValidationGate('Excel 出力')) return;
    const allRows = collectAllRows();
    const data = allRows.filter(r => r._type === 'data');
    if (!data.length) { alert('行がありません。'); return; }
    const hdr = getQuoteHeader();
    const vis = getPreviewVisibility();
    // プレビュー表示カスタマイズで非表示にしたグループの列を除外
    const visCols = XLSX_COL_DEFS.filter(c => !c.pvGroup || vis[c.pvGroup]);
    const idxOf = role => visCols.findIndex(c => c.role === role);
    const idxSub     = idxOf('sub');
    const idxJpyConv = idxOf('jpyConv');
    const idxTaxAmt  = idxOf('taxAmt');
    const idxProfit  = idxOf('profit');

    const aoaRows = [];
    if (hdr.ref)        aoaRows.push(['仮 REF #', hdr.ref]);
    if (hdr.customer)   aoaRows.push(['引き合い元', hdr.customer]);
    if (hdr.person)     aoaRows.push(['担当', formatPersonWithHonorific(hdr.person)]);
    if (hdr.date)       aoaRows.push(['発行日', hdr.date]);
    if (hdr.validUntil) aoaRows.push(['有効期限', hdr.validUntil]);
    // 引き合い条件（POL/POD/インコタームズ/輸送モード/コンテナ/貨物名）
    const cExcel = getConditions();
    const condPairs = [
      ['POL（積み地）', cExcel.pol], ['POD（揚げ地）', cExcel.pod],
      ['インコタームズ', cExcel.incoterms], ['輸送モード', cExcel.mode],
      ['コンテナ', cExcel.container], ['貨物名', cExcel.cargo],
    ].filter(([, v]) => v);
    if (condPairs.length) condPairs.forEach(([k, v]) => aoaRows.push([k, v]));
    if (aoaRows.length) aoaRows.push([]);

    // 列ヘッダ
    aoaRows.push(visCols.map(c => c.hdr));

    let totSub = 0, totJpyConv = 0, totTaxAmt = 0, totProfit = 0;
    allRows.forEach(d => {
      if (d._type === 'remark') {
        if (d.text) {
          const row = visCols.map(() => '');
          row[0] = `💬 ${d.text}`;
          aoaRows.push(row);
        }
        return;
      }
      if (d._type === 'subtotal') {
        const row = visCols.map(() => '');
        row[0] = `━━ ${d.label || '小計'}`;
        if (idxSub    >= 0) row[idxSub]    = d.subtotalText;
        if (idxProfit >= 0) row[idxProfit] = d.profitText;
        aoaRows.push(row);
        return;
      }
      const sub    = (d.bq || 0) * (d.bp || 0);
      const jpy    = (typeof toJPY === 'function') ? Math.ceil(toJPY(sub, d.bc)) : sub;
      const taxAmt = d.taxed ? sub * getEffectiveTaxRate() : 0;
      totSub     += sub;
      totJpyConv += jpy;
      totTaxAmt  += taxAmt;
      totProfit  += d.profit;
      aoaRows.push(visCols.map(c => c.fn(d)));
    });
    // 合計行
    aoaRows.push([]);
    const totalRow = visCols.map(() => '');
    totalRow[0] = '合　計';
    if (idxSub     >= 0) totalRow[idxSub]     = totSub;
    if (idxJpyConv >= 0) totalRow[idxJpyConv] = totJpyConv;
    if (idxTaxAmt  >= 0) totalRow[idxTaxAmt]  = totTaxAmt;
    if (idxProfit  >= 0) totalRow[idxProfit]  = totProfit;
    aoaRows.push(totalRow);

    // 条件・リマーク
    const remarkText = getRemarkText?.() || '';
    if (remarkText) {
      aoaRows.push([]);
      aoaRows.push(['【条件・リマーク】']);
      remarkText.split('\n').forEach(line => { if (line.trim()) aoaRows.push([line]); });
    }
    // 監査メタ：為替出典・取得日時・作成日（最下段）
    const xMeta = getFxAuditMeta();
    aoaRows.push([]);
    aoaRows.push([xMeta.fxLine]);
    aoaRows.push([xMeta.created]);

    const ws   = XLSX.utils.aoa_to_sheet(aoaRows);
    // 列幅設定（SheetJS CE版対応: wch = 文字数基準の列幅）
    ws['!cols'] = [
      {wch:12},{wch:10},{wch:22},{wch:5},{wch:7},{wch:6},{wch:9},{wch:5},
      {wch:6},{wch:6},{wch:9},{wch:8},{wch:11},{wch:10},{wch:8},{wch:9},{wch:9},{wch:24}
    ];
    const wb   = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '見積もり');
    XLSX.writeFile(wb, buildFileName('xlsx'));
    quoteShowToast('📊 Excelファイルを出力しました', 'success');
  }

  // CSV列定義（key: collectData()の行データキー、hdr: ヘッダ文字列。sv を cat 直後に配置）
  const CSV_COL_DEFS = [
    { key: 'cat',    hdr: 'カテゴリ',       fn: d => getCatLabel(d.cat) },
    { key: 'sv',     hdr: 'サブコン',       fn: d => d.sv || '' },
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
  ];

  function downloadCSV() {
    const data = collectData();
    if (!data.length) { alert('行がありません。'); return; }
    if (!preOutputValidationGate('CSV ダウンロード')) return;
    // プレビューの表示カスタマイズを CSV モーダルへ反映（モーダル内で再編集可）
    syncCsvColsToPreview();
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

        // 先頭列がカテゴリのraw値なら新フォーマット（cat, sv, name, pq, un, pc, pp, cd, bq, bc, bp, mk, sub, profit, note）
        // 旧フォーマット（name, pq, pc, pp, ...）は off=0 で扱う
        const isNewFmt = CAT_VALUES.includes(dataRows[0][0]);
        let added = 0;
        dataRows.forEach(cols => {
          rowCount++;
          const id = rowCount;
          const tr = document.createElement('tr');
          tr.id = `row-${id}`;
          tr.replaceChildren(buildRowHTML(id));
          document.getElementById('tableBody').appendChild(tr);
          initDrag(tr);

          let cat, sv, rawName, pq, un, pc, pp, bq, bc, bp, mk, nt;
          if (isNewFmt) {
            // 新フォーマット: col0=cat, col1=sv, col2=name, col3=pq, col4=un, col5=pc, col6=pp,
            //                  col7=cd, col8=bq, col9=bc, col10=bp, col11=mk, col12=sub, col13=profit, col14=note
            cat     = cols[0] || '';
            sv      = cols[1] || '';
            rawName = cols[2] || '';
            pq      = parseFloat(cols[3]) || 1;
            un      = cols[4] || '';
            pc      = cols[5] || 'JPY';
            pp      = parseFloat(cols[6]) || 0;
            bq      = parseFloat(cols[8]) || null;
            bc      = cols[9] || '';
            bp      = parseFloat(cols[10]) || null;
            mk      = parseFloat(cols[11]) || 0;
            nt      = cols[14] || '';
          } else {
            // 旧フォーマット: col0=name, col1=pq, col2=pc, col3=pp, col4=mk, col5=note
            cat     = '';
            sv      = '';
            rawName = cols[0] || '';
            pq      = parseFloat(cols[1]) || 1;
            un      = '';
            pc      = cols[2] || 'JPY';
            pp      = parseFloat(cols[3]) || 0;
            bq      = null;
            bc      = '';
            bp      = null;
            mk      = parseFloat(cols[4]) || 0;
            nt      = cols[5] || '';
          }
          const taxed = rawName.startsWith('*');
          const name  = taxed ? rawName.slice(1) : rawName;

          document.getElementById(`nm-${id}`).value = name;
          document.getElementById(`pq-${id}`).value = pq;
          document.getElementById(`pp-${id}`).value = pp;
          document.getElementById(`mk-${id}`).value = mk;
          document.getElementById(`nt-${id}`).value = nt;
          if (sv) document.getElementById(`sv-${id}`).value = sv;
          if (un) document.getElementById(`un-${id}`).value = un;
          const pcEl = document.getElementById(`pc-${id}`);
          if (pcEl && CURRENCIES.includes(pc)) pcEl.value = pc;
          if (cat && CAT_VALUES.includes(cat)) {
            document.getElementById(`cat-${id}`).value = cat;
            onCatChange(id);
          }
          if (taxed) { document.getElementById(`tx-${id}`).checked = true; toggleTax(id); }
          // 請求側フィールドを先に onPay で計算してから、CSV の値で上書き
          onPay(id);
          if (bq !== null) {
            const bqEl = document.getElementById(`bq-${id}`);
            if (bqEl) bqEl.value = bq;
          }
          if (bc && CURRENCIES.includes(bc)) {
            const bcEl = document.getElementById(`bc-${id}`);
            if (bcEl) bcEl.value = bc;
          }
          if (bp !== null) {
            const bpEl = document.getElementById(`bp-${id}`);
            if (bpEl) bpEl.value = bp;
          }
          checkUnfilled(id);
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
