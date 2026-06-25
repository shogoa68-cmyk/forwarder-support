// ========== プレビュー・CSV (app-preview.js) ==========

  // 消費税率（プレビュー）：標準 10% 固定。
  // 課否は行ごとの「課税」チェック（data-taxed）で制御するモデル。
  // （旧「輸出免税（0%）を適用」全体チェックは廃止。行単位の課税/非課税で表現する）
  const PV_TAX_RATE_DEFAULT = 0.10;
  function getEffectiveTaxRate() {
    return PV_TAX_RATE_DEFAULT;
  }

  // 発行日の当日補完（御見積書 _todayIso と同じ JST 日付）。
  // 御見積書・Excel・TSV で発行日の扱いを統一するために使用。
  function _pvTodayIso() {
    return new Date().toLocaleDateString('sv', { timeZone: 'Asia/Tokyo' }); // "YYYY-MM-DD" JST
  }

  // ========== プレビュー＆エクスポート ==========
  function getQuoteHeader() {
    return {
      ref:        document.getElementById('qf-ref')?.value || '',
      customer:   document.getElementById('qf-customer')?.value || '',
      person:     document.getElementById('qf-person')?.value || '',
      date:       document.getElementById('qf-date')?.value || '',
      validUntil: document.getElementById('qf-valid-until')?.value || '',
      status:     document.getElementById('qf-status')?.value || '下書き中',
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
  // プリセットカード（ブラウザ保存／チーム共有）でも敬称表示に使うため公開
  window.formatPersonWithHonorific = formatPersonWithHonorific;

  // プレビュー上の発行日／有効期限編集 → フォーム(qf-date / qf-valid-until)へ同期
  window.pvSyncDate = function (which, val) {
    var id = which === 'valid' ? 'qf-valid-until' : 'qf-date';
    var el = document.getElementById(id);
    if (!el) return;
    el.value = val;
    el.dispatchEvent(new Event('change', { bubbles: true }));   // 自動保存・有効期限警告などを発火
    // 表計算・御見積書の両入力欄を同期（どちらから編集しても揃える）
    var docId = which === 'valid' ? 'pvDocValid' : 'pvDocDate';
    var docEl = document.getElementById(docId);
    if (docEl && docEl.value !== val) docEl.value = val;
    // 御見積書レイアウト表示中なら、発行日／有効期限の変更を即反映するため再描画
    var box = document.getElementById('previewBox');
    if (box && box.classList.contains('layout-doc') && typeof renderDocPreview === 'function') {
      renderDocPreview();
    }
  };

  /**
   * ファイル名生成: REF_引き合い元_担当.<ext>
   * 入力がある項目だけ使用。すべて空なら "見積もり_YYYYMMDD"
   */
  function isSensitiveOn() {
    return ['pay', 'mk', 'profit'].some(k => {
      const chk = document.querySelector(`.pv-col-chk[data-col="${k}"]`);
      return chk && chk.checked;
    });
  }

  function buildFileName(ext) {
    const hdr   = getQuoteHeader();
    const today = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Tokyo' }).replace(/-/g, '');
    const safe  = s => s.replace(/[\/\\:*?"<>|\t\n\r]/g, '_').replace(/_+/g, '_').trim().slice(0, 40);
    const cond = getConditions();
    const mode = safe(cond.mode || '');
    const parts = [hdr.ref, hdr.customer, mode, hdr.person].map(safe).filter(Boolean);
    const prefix = isSensitiveOn() ? '[社内用]_' : '[客先]_';
    return prefix + (parts.length ? parts.join('_') : '見積もり_' + today) + '.' + ext;
  }

  function collectAllRows() {
    const rows = [];
    document.querySelectorAll('#tableBody tr').forEach(tr => {
      if (tr.dataset.virtual) return;         // サブコングループヘッダー（仮想行）はスキップ
      if (tr.dataset.excluded === '1') return; // 除外グループはスキップ
      if (tr.dataset.type === 'subtotal') {
        const label       = tr.querySelector('.subtotal-label')?.value || '';
        const billingText = tr.querySelector('.subtotal-group-billing')?.textContent?.trim() || '—';
        const subtotalText= tr.querySelector('.subtotal-group-subtotal')?.textContent?.trim() || '—';
        // 利益額は .stp-amt から読む（粗利率の small を含めない）。粗利率は dataset から
        const profitText  = (tr.querySelector('.subtotal-group-profit .stp-amt')
                           || tr.querySelector('.subtotal-group-profit'))?.textContent?.trim() || '—';
        const marginPct   = tr.dataset.marginPct || '';
        rows.push({ _type: 'subtotal', label, billingText, subtotalText, profitText, marginPct });
        return;
      }
      if (tr.dataset.type === 'remark') {
        const text = tr.querySelector('.remark-row-input')?.value || '';
        rows.push({ _type: 'remark', text, internal: tr.dataset.internal === '1' });
        return;
      }
      if (tr.dataset.type === 'internal') return; // 社内メモ行は全出力対象外
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
      const pt     = document.getElementById(`pt-${id}`)?.value || '';
      // 有効期限（vf/vt）はサーチャージ専用。他カテゴリは値が残っていても無視する
      const _isSur = cat === 'surcharge';
      const vf     = _isSur ? (document.getElementById(`vf-${id}`)?.value || '') : '';
      const vt     = _isSur ? (document.getElementById(`vt-${id}`)?.value || '') : '';
      const zc     = document.getElementById(`zc-${id}`)?.value === '1';
      const _hideManual = tr.dataset.hideQuote === '1';   // 手動の見積書非表示
      const _outRange   = tr.dataset.outRange === '1';     // 適用期間外（自動・客先非表示＋合計除外）
      const _ps         = tr.dataset.profitShare === '1';  // PROFIT SHARE（客先非表示・社内利益に計上）
      // 客先出力・小計・PDF/Excel/CSV の除外は _hideQuote 一本で判定する（PROFIT SHARE も客先には出さない）
      const _hideQuote  = _hideManual || _outRange || _ps;
      const _actual     = tr.dataset.actual === '1';   // 実費（金額未確定・合計除外・単価/金額は「実費」表示）
      const _cond       = tr.dataset.cond === '1';     // 都度請求（発生時のみ・金額は表示・合計に加算しない）
      rows.push({ _type: 'data', taxed, cat, name, pq, un, pc, pp, cd, bq, bc, bp, mk, cost, bill, profit, note, sv, pt, vf, vt, zc, _actual, _ps, _cond, _hideQuote, _hideManual, _outRange });
    });
    return rows;
  }

  function collectData() {
    const rows = document.querySelectorAll('#tableBody tr');
    const data = [];
    rows.forEach(tr => {
      if (tr.dataset.virtual) return;          // サブコングループヘッダー（仮想行）はスキップ
      if (tr.dataset.excluded === '1') return;  // 除外グループはスキップ
      if (tr.dataset.hideQuote === '1') return; // 見積書非表示の行はスキップ（合計・CSV から除外）
      if (tr.dataset.outRange === '1') return;  // 適用期間外のサーチャージはスキップ（客先合計・CSV から除外）
      if (tr.dataset.profitShare === '1') return; // PROFIT SHARE は客先出力から除外
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
      const _actual = tr.dataset.actual === '1';   // 実費（金額未確定）
      const _cond   = tr.dataset.cond === '1';     // 都度請求（発生時のみ・合計外）
      data.push({ taxed, cat, name, pq, un, pc, pp, cd, bq, bc, bp, mk, cost, bill, profit, note, sv, _actual, _cond });
    });
    return data;
  }

  function getCatLabel(v) {
    return CATEGORIES.find(c => c.value === v)?.label || '';
  }

  // 出力物（PDF/Excel/TSV）のフッターに刻む「為替の出典 / 取得日時」「作成日」メタ情報
  function getFxAuditMeta() {
    const last = localStorage.getItem(SharedStorage.KEYS.FX_LAST_FETCHED);
    let fxLine;
    if (last) {
      fxLine = `為替出典：open.er-api.com 中値（Mid Rate）（取得日時 ${new Date(last).toLocaleString('ja-JP', {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}）※ 実際の決済レート（TTS等）とは異なる参考値`;
    } else {
      // フォールバック（自動取得未実行）。デフォルト値の確認日を必ず明記し、根拠を追えるようにする（台帳 D）
      const asof = (typeof QuoteApp !== 'undefined' && QuoteApp.fx && QuoteApp.fx.DEFAULT_RATES_ASOF) || '';
      fxLine = `為替出典：手動設定値（自動取得未実行${asof ? ` / 基準レート確認日 ${asof}` : ''}）※ 参考値・実際の決済レート（TTS等）とは異なります`;
    }
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
  const _WARN_HEADER_IDS = ['qf-ref', 'qf-customer', 'qf-person', 'cond-incoterms'];

  // 「このまま出力」でバリデーションをスキップするフラグ
  let _pvBypassed   = false;
  let _pvWarnItems  = [];   // { msg, focusEl }
  let _pvWarnIdx    = 0;
  let _pvWarnSkipFn = null;

  function _clearPreviewHighlights() {
    document.querySelectorAll('#tab-quote-make .quote-warn-field')
      .forEach(el => el.classList.remove('quote-warn-field'));
    document.querySelectorAll('#tableBody tr.row-warn-price')
      .forEach(tr => tr.classList.remove('row-warn-price'));
  }

  function _applyPreviewHighlights(hdr, cond) {
    _clearPreviewHighlights();
    if (!hdr.ref)      document.getElementById('qf-ref')?.classList.add('quote-warn-field');
    if (!hdr.customer) document.getElementById('qf-customer')?.classList.add('quote-warn-field');
    if (!hdr.person)   document.getElementById('qf-person')?.classList.add('quote-warn-field');
    if (cond && !cond.incoterms) document.getElementById('cond-incoterms')?.classList.add('quote-warn-field');
    document.querySelectorAll('#tableBody tr[id^="row-"]').forEach(tr => {
      const nm   = tr.querySelector('[data-field="nm"]');
      const bp   = tr.querySelector('[data-field="bp"]');
      const un   = tr.querySelector('[data-field="un"]');
      const name = (nm?.value || '').trim();
      if (!name) {
        nm?.classList.add('quote-warn-field');
        return;
      }
      const isMemo = ['式','note','memo'].includes(un?.value) || /^[#＃]/.test(name);
      // 0円確認済み（¥0✓）／実費（金額未確定）の行は意図的に単価なし → 警告対象外
      const zc = tr.querySelector('[data-field="zc"]')?.value === '1';
      const ac = tr.querySelector('[data-field="ac"]')?.value === '1';
      if (!isMemo && !zc && !ac && (parseFloat(bp?.value) || 0) === 0) {
        tr.classList.add('row-warn-price');
      }
    });
  }

  // ハイライト済み要素からガイド項目リストを生成
  function _buildWarnItems() {
    const items = [];
    const tryHdr = (id, msg) => {
      const el = document.getElementById(id);
      if (el?.classList.contains('quote-warn-field')) items.push({ msg, focusEl: el });
    };
    tryHdr('qf-ref',         '見積もり番号を入力してください');
    tryHdr('qf-customer',    'お客様名称を入力してください');
    tryHdr('qf-person',      '担当者名を入力してください');
    tryHdr('cond-incoterms', 'インコタームズを選択してください');
    document.querySelectorAll('#tableBody tr.row-warn-price').forEach(tr => {
      const nm = tr.querySelector('[data-field="nm"]');
      const pp = tr.querySelector('[data-field="pp"]'); // pp は編集可能
      const name = (nm?.value || '').trim() || '（名称なし）';
      items.push({ msg: `「${name}」の単価を入力してください`, focusEl: pp });
    });
    document.querySelectorAll('#tableBody tr[id^="row-"] [data-field="nm"].quote-warn-field').forEach((nm, i) => {
      items.push({ msg: `${i + 1} 行目: 項目名が空です`, focusEl: nm });
    });
    // 要調査（後で記入）の行が残っていれば出力前に警告
    document.querySelectorAll('#tableBody tr[data-pending="1"]').forEach(tr => {
      const nm = tr.querySelector('[data-field="nm"]');
      const name = (nm?.value || '').trim() || '（名称なし）';
      items.push({ msg: `🔍 「${name}」は要調査（後で記入）のままです`, focusEl: nm });
    });
    return items;
  }

  // 現在のガイド項目にスクロール＋フォーカス
  function _pvWarnGuideFocusCurrent() {
    const item = _pvWarnItems[_pvWarnIdx];
    if (!item) return;
    document.querySelectorAll('#pvWarnGuideList .pv-wg-item').forEach((li, i) =>
      li.classList.toggle('is-current', i === _pvWarnIdx)
    );
    if (item.focusEl) {
      item.focusEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => { item.focusEl.focus(); if (item.focusEl.select) item.focusEl.select(); }, 280);
    }
  }

  function pvWarnGuideNext() {
    if (!_pvWarnItems.length) return;
    _pvWarnIdx = (_pvWarnIdx + 1) % _pvWarnItems.length;
    _pvWarnGuideFocusCurrent();
  }

  function pvWarnGuideSkip() {
    // pvWarnGuideClose() が _pvWarnSkipFn を null にするため、先に控える
    const skipFn = _pvWarnSkipFn;
    pvWarnGuideClose();
    _clearPreviewHighlights();
    _pvBypassed = true;
    if (typeof skipFn === 'function') skipFn();
  }

  function pvWarnGuideClose() {
    const panel = document.getElementById('pvWarnGuide');
    if (panel) panel.style.display = 'none';
    _pvWarnItems  = [];
    _pvWarnSkipFn = null;
  }

  function _openWarnGuide(skipFn, infoItems = []) {
    _pvWarnItems  = [..._buildWarnItems(), ...infoItems];
    _pvWarnIdx    = 0;
    _pvWarnSkipFn = skipFn;
    if (_pvWarnItems.length === 0) {
      _clearPreviewHighlights();
      pvWarnGuideClose();
      return true;
    }
    const panel = document.getElementById('pvWarnGuide');
    if (!panel) return false;
    const fixableCount = _pvWarnItems.filter(i => i.focusEl).length;
    const title = document.getElementById('pvWarnGuideTitle');
    if (title) title.textContent = fixableCount
      ? `${fixableCount} 箇所の入力が必要です`
      : `${_pvWarnItems.length} 件の確認事項があります`;
    const nextBtn = document.getElementById('pvWarnGuideNextBtn');
    if (nextBtn) nextBtn.style.display = _pvWarnItems.length > 1 ? '' : 'none';
    const list = document.getElementById('pvWarnGuideList');
    if (list) {
      list.innerHTML = _pvWarnItems.map((item, i) =>
        `<li class="pv-wg-item${item.focusEl ? '' : ' pv-wg-item-info'}" data-idx="${i}">` +
          (item.focusEl
            ? `<span class="pv-wg-item-num">${i + 1}</span>`
            : `<span class="pv-wg-item-icon">ℹ</span>`) +
          `<span>${escHtml(item.msg)}</span>` +
        `</li>`
      ).join('');
      list.querySelectorAll('.pv-wg-item').forEach(li =>
        li.addEventListener('click', () => {
          _pvWarnIdx = parseInt(li.dataset.idx);
          _pvWarnGuideFocusCurrent();
        })
      );
    }
    panel.style.display = '';
    _pvWarnGuideFocusCurrent();
    return false;
  }

  // ヘッダーフィールド編集時にハイライトを自動解除（初回のみ登録）
  function initPreviewWarningListeners() {
    _WARN_HEADER_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (!el || el.dataset.pvWarnBound) return;
      el.dataset.pvWarnBound = '1';
      const clear = () => el.classList.remove('quote-warn-field');
      el.addEventListener('input',  clear);
      el.addEventListener('change', clear);
    });
  }

  // 出力（プレビュー／Excel／CSV／PDF）の前に問題箇所を検出するゲート。
  // 警告があればガイドパネルを表示して false を返す（confirm は廃止）。
  // skipFn: 「このまま出力」ボタンで再実行する関数。
  function preOutputValidationGate(label, skipFn) {
    const data = collectData();
    const hdr  = getQuoteHeader();
    const cond = (typeof getConditions === 'function') ? getConditions() : null;

    // fixable フィールドをハイライト（_buildWarnItems が DOM から収集）
    _applyPreviewHighlights(hdr, cond);

    // フォーカス不可の情報系警告
    const infoItems = [];

    if (!data.length) {
      infoItems.push({ msg: '見積もり行が 1 件もありません', focusEl: null });
    } else {
      let mixedCcyCount = 0;
      let totBillJpy = 0, totCostJpy = 0;
      const canConvert = typeof toJPY === 'function';

      data.forEach(d => {
        if (d.pc && d.bc && d.pc !== d.bc) mixedCcyCount++;
        const isMemoRow = (d.un === '式' || d.un === 'note' || d.un === 'memo')
                       || (d.name && /^[#＃].+/.test(d.name.trim()));
        if (!isMemoRow && canConvert) {
          totBillJpy += toJPY(d.bill, d.bc || 'JPY');
          totCostJpy += toJPY(d.cost, d.pc || 'JPY');
        }
      });

      if (mixedCcyCount) {
        infoItems.push({ msg: `支払い通貨と請求通貨が異なる行が ${mixedCcyCount} 件あります（乗せ幅は請求通貨建てで加算）`, focusEl: null });
      }
      if (canConvert && totBillJpy > 0) {
        const gm = SharedCalc.grossMarginPct(totBillJpy, totCostJpy); // 売上ベース粗利率（B）
        if (gm < 20 || gm > 40) {
          const dir = gm < 20 ? '低め' : '高め';
          infoItems.push({ msg: `粗利率 ${gm.toFixed(1)}% — 目安（20〜40%）より${dir}です`, focusEl: null });
        }
      }
      const hasNonJpy = data.some(d => (d.pc && d.pc !== 'JPY') || (d.bc && d.bc !== 'JPY'));
      if (hasNonJpy && isFxStale()) {
        infoItems.push({ msg: '為替レートが 24 時間以上前の値です。FX パネルから「🔄 今すぐ取得」を推奨', focusEl: null });
      }
    }

    return _openWarnGuide(skipFn, infoItems);
  }

  // サーチャージ有効期限バッジ（vf/vt → 小さいバッジ HTML、両方空なら ''）
  function _pvValidityBadge(vf, vt) {
    if (!vf && !vt) return '';
    const fmt = d => d ? d.replace(/-/g, '/') : '';
    const range = (vf && vt) ? fmt(vf) + '〜' + fmt(vt)
                : vf          ? fmt(vf)          // 開始日のみ：末尾「〜」なし
                :               '〜' + fmt(vt);
    return ` <span class="pv-validity">${escHtml(range)}</span>`;
  }

  function openPreview() {
    try {
    const allRows = collectAllRows()
      .filter(r => r._type !== 'data' || !r.zc);                          // 0円確認済み行を除外
    // 適用期間外の行は除外せず残し、_hideQuote 経由で「社内モード＝グレー表示／客先モード＝非表示・合計除外」に統一
    const data = allRows.filter(r => r._type === 'data');
    if (!data.length) { alert('行がありません。'); return; }
    if (!_pvBypassed && !preOutputValidationGate('プレビュー表示', openPreview)) return;
    _pvBypassed = false;
    const hdr = getQuoteHeader();
    let totCost = 0, totBill = 0, totMk = 0;
    // 見積書非表示・適用期間外（いずれも _hideQuote）の行は合計に含めない
    // 除外パターンの行は collectAllRows() が data-excluded='1' でフィルタ済みのため除外不要
    data.forEach(d => { if (d._hideQuote || d._actual || d._cond) return; totCost += d.cost; totBill += d.bill; totMk += d.mk; });
    const totPr = totBill - totCost;
    const ccyGroups = {}; // billing 通貨別集計: { JPY: {sub,tax,mk}, USD: {...} }
    let totCostJpy = 0;

    const metaEl = document.getElementById('pvMeta');
    const metaHTML = [
      hdr.ref      ? `<div class="pv-meta-item"><span class="lbl">見積もり番号</span><span class="val">${escHtml(hdr.ref)}</span></div>` : '',
      hdr.customer ? `<div class="pv-meta-item"><span class="lbl">お客様</span><span class="val">${escHtml(hdr.customer)}</span></div>` : '',
      hdr.person   ? `<div class="pv-meta-item"><span class="lbl">担当</span><span class="val">${escHtml(formatPersonWithHonorific(hdr.person))}</span></div>` : '',
      `<div class="pv-meta-item pv-meta-edit"><span class="lbl">発行日</span><input type="date" class="pv-meta-date" value="${escHtml(hdr.date)}" onchange="pvSyncDate('date', this.value)" title="フォームの発行日と同期します" /></div>`,
      `<div class="pv-meta-item pv-meta-edit"><span class="lbl">有効期限</span><input type="date" class="pv-meta-date" value="${escHtml(hdr.validUntil)}" onchange="pvSyncDate('valid', this.value)" title="フォームの有効期限と同期します" /></div>`,
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

    let totSub = 0, totTax = 0, totJpy = 0, hasNonJpyBill = false, hasNonJpyCost = false;

    // ===== サブコン別グループ（1社以上）およびパターン別サブグループ =====
    // 揺らぎ吸収：境界判定・小計集約・エイリアス参照は正規化キーで、表示は元の綴りで行う
    const _scNorm  = d => (subconNormKey(d.sv) || '（サブコン未設定）');
    const _scLabel = d => ((d.sv || '').trim() || '（サブコン未設定）');
    const _ptNorm  = d => (d.pt || '').trim();
    const _scActive = (() => { const ks = new Set(data.map(_scNorm)); return ks.size >= 1; })();
    // 仕入合計・粗利率は内部指標。利益列が表示されているとき（＝社内モード）のみラベルに併記
    const _scShowInternal = (typeof getPreviewVisibility === 'function') ? (getPreviewVisibility().profit !== false) : true;
    const _seq = [];
    if (_scActive) {
      const toJ = (a, c) => (c && c !== 'JPY' && typeof toJPY === 'function') ? toJPY(a, c) : a;

      // サブコンごとのパターン種類数を事前集計（2種類以上あればパターン小計を出す）
      const scPatternSets = {};
      allRows.filter(d => d._type === 'data').forEach(d => {
        const k = _scNorm(d);
        if (!scPatternSets[k]) scPatternSets[k] = new Set();
        scPatternSets[k].add(_ptNorm(d));
      });

      let ck = null, clabel = null, cc = 0, cb = 0, cm = false, has = false, gi = -1;
      let pk = null, plabel = null, pc = 0, pb = 0, pm = false, phas = false, _ptActive = false;

      const pushPat = () => {
        if (phas) _seq.push({ _type: 'pattern-subtotal', label: plabel, cost: pc, bill: pb, mixed: pm, gi });
        pc = 0; pb = 0; pm = false; phas = false;
      };
      const pushSub = () => {
        if (_ptActive && phas) pushPat();
        if (has) _seq.push({ _type: 'subcon-subtotal', label: clabel, normKey: ck, cost: cc, bill: cb, mixed: cm, gi });
      };

      allRows.forEach(d => {
        if (d._type === 'data') {
          const k = _scNorm(d);
          const p = _ptNorm(d);
          if (has && k !== ck) {
            pushSub();
            cc = 0; cb = 0; cm = false; has = false;
            pk = null; plabel = null; phas = false;
          }
          if (!has) {
            ck = k; clabel = _scLabel(d); gi++;
            _ptActive = scPatternSets[k].size >= 2 ||
                        (scPatternSets[k].size === 1 && !scPatternSets[k].has(''));
            _seq.push({ _type: 'subcon-header', label: clabel, normKey: ck, gi });
          }
          // パターン境界でサブグループヘッダー挿入
          if (_ptActive && p !== pk) {
            if (phas) pushPat();
            pk = p; plabel = p || '（パターン未設定）';
            _seq.push({ _type: 'pattern-header', label: plabel, gi });
            phas = true;
          }
          d._gi = gi;
          if (!d._hideQuote && !d._actual && !d._cond) {
            const jc = toJ(d.cost, d.pc || 'JPY');
            const jb = toJ(d.bill, d.bc || 'JPY');
            cc += jc; cb += jb;
            if (_ptActive) { pc += jc; pb += jb; }
            if ((d.pc && d.pc !== 'JPY') || (d.bc && d.bc !== 'JPY')) { cm = true; if (_ptActive) pm = true; }
          }
          has = true;
        }
        _seq.push(d);
      });
      pushSub();
    } else {
      _seq.push(...allRows);
    }

    _seq.forEach(d => {
      if (d._type === 'remark') {
        if (d.internal) return; // 社内メモは見積書プレビューに出力しない
        html += `<tr class="pv-table-remark-row">
          <td colspan="17" class="pv-remark-cell">💬 ${escHtml(d.text)}</td>
        </tr>`;
        return;
      }
      if (d._type === 'subcon-header') {
        // 各サブコンブロックの先頭に見出し帯を出し、どのサブコンの明細かを明示する
        const _aliasH = (typeof getSubconAliases === 'function' ? getSubconAliases()[d.normKey] : '') || '';
        const _dispH  = _aliasH || d.label;
        html += `<tr class="pv-subcon-header pv-grp-c${d.gi % 4}">
          <td colspan="17" class="pv-sch-cell">${escHtml(_dispH)}</td>
        </tr>`;
        return;
      }
      if (d._type === 'subcon-subtotal') {
        const m = d.bill > 0 ? ((d.bill - d.cost) / d.bill * 100) : null;
        const mark = d.mixed ? '※' : '';
        const sellTxt = '¥' + fmtMoney(Math.round(d.bill)) + mark;
        const costTxt = '¥' + fmtMoney(Math.round(d.cost)) + mark;
        const prAmt   = Math.round(d.bill - d.cost);
        const prCls   = prAmt > 0 ? 'pv-pos' : prAmt < 0 ? 'pv-neg' : 'pv-zero';
        const marginTxt = m === null ? '—' : (m.toFixed(1) + '%');
        const internalBits = _scShowInternal
          ? `<span class="pv-scs-cost">仕入合計 ${costTxt}</span>` +
            `<span class="pv-scs-margin${(m !== null && m < 0) ? ' pv-neg' : ''}">粗利率 ${marginTxt}</span>`
          : '';
        // サブコン名は見出し行に表示済みのため、小計行では繰り返さず「小計」のみ
        // 色・右揃えは quote.css のキャッシュに依存しないよう、描画側でインライン指定（最優先）
        const _scStyle = 'background:#ead29a;border-top:2px solid #c69a44;border-bottom:2px solid #c69a44;';
        html += `<tr class="pv-subcon-subtotal pv-grp-c${(d.gi ?? 0) % 4}">
          <td colspan="12" class="pv-scs-label" style="${_scStyle}text-align:right !important;">↳ 小計${internalBits}</td>
          <td class="pv-num pv-subtotal" style="${_scStyle}">${sellTxt}</td>
          <td data-ft-col="jpy-conv" class="pv-jpy" style="${_scStyle}"></td>
          <td data-ft-col="tax-col" style="${_scStyle}"></td>
          <td data-ft-col="profit" class="pv-num ${prCls}" style="${_scStyle}">¥${fmtMoney(prAmt)}</td>
          <td data-ft-col="note" style="${_scStyle}"></td>
        </tr>`;
        return;
      }
      if (d._type === 'pattern-header') {
        html += `<tr class="pv-pattern-header pv-grp-c${d.gi % 4}">
          <td colspan="17" class="pv-ph-cell">📋 ${escHtml(d.label)}</td>
        </tr>`;
        return;
      }
      if (d._type === 'pattern-subtotal') {
        const prAmt = Math.round(d.bill - d.cost);
        const prCls = prAmt > 0 ? 'pv-pos' : prAmt < 0 ? 'pv-neg' : 'pv-zero';
        const mark = d.mixed ? '※' : '';
        const sellTxt = '¥' + fmtMoney(Math.round(d.bill)) + mark;
        const _ptStyle = 'background:#f0e8d8;border-top:1px dashed #c69a44;';
        html += `<tr class="pv-pattern-subtotal pv-grp-c${(d.gi ?? 0) % 4}">
          <td colspan="12" class="pv-pts-label" style="${_ptStyle}text-align:right !important;">↳ ${escHtml(d.label)} 小計</td>
          <td class="pv-num" style="${_ptStyle}">${sellTxt}</td>
          <td data-ft-col="jpy-conv" style="${_ptStyle}"></td>
          <td data-ft-col="tax-col" style="${_ptStyle}"></td>
          <td data-ft-col="profit" class="pv-num ${prCls}" style="${_ptStyle}">¥${fmtMoney(prAmt)}</td>
          <td data-ft-col="note" style="${_ptStyle}"></td>
        </tr>`;
        return;
      }
      if (d._type === 'subtotal') {
        // 小計セパレーター。先頭ラベルは cat+sv+name+pay(5)+bill(3)+mk = 12 列ぶん
        // col 13-16 に data-ft-col を付与し、applyPreviewCustomize の列連動に対応
        const sepPc = d.profitText.startsWith('-') ? 'pv-neg' : (d.profitText === '—' || d.profitText === '0') ? 'pv-zero' : 'pv-pos';
        // 粗利率は利益列に併記（内部指標。利益列が非表示の客先モードでは列ごと隠れる）
        const sepMargin = d.marginPct ? `<small class="tot-margin${parseFloat(d.marginPct) < 0 ? ' pv-neg' : ''}">粗利 ${escHtml(d.marginPct)}%</small>` : '';
        html += `<tr class="pv-subtotal-sep">
          <td colspan="12" class="pv-subtotal-sep-label">━━ ${escHtml(d.label || '小計')}</td>
          <td class="pv-num pv-subtotal">${escHtml(d.subtotalText)}</td>
          <td data-ft-col="jpy-conv" class="pv-jpy"></td>
          <td data-ft-col="tax-col" class="pv-num pv-tax-cell"></td>
          <td data-ft-col="profit" class="pv-pr ${sepPc} pv-num">${escHtml(d.profitText)}${sepMargin}</td>
          <td data-ft-col="note"></td>
        </tr>`;
        return;
      }
      const pc      = d.profit > 0 ? 'pv-pos' : d.profit < 0 ? 'pv-neg' : 'pv-zero';
      const nameCls = d.taxed ? 'pv-name pv-taxed' : 'pv-name';
      const sub     = (d.bq || 0) * (d.bp || 0);
      const jpyAmt  = (typeof toJPY === 'function') ? Math.ceil(toJPY(sub, d.bc)) : sub;
      const taxAmt  = (d.taxed && !d._actual) ? sub * taxRate : 0;
      // 見積書非表示・実費の行は合計に一切含めない（実費は行は出すが金額未確定のため除外）
      if (!d._hideQuote && !d._actual && !d._cond) {
        totSub += sub;
        totTax += taxAmt;
        totJpy += jpyAmt;
        if (d.bc && d.bc !== 'JPY') hasNonJpyBill = true;
        if (d.pc && d.pc !== 'JPY') hasNonJpyCost = true;
        const ccy = d.bc || 'JPY';
        if (!ccyGroups[ccy]) ccyGroups[ccy] = { sub: 0, tax: 0, mk: 0 };
        // JPY 建ては行ごと ceil で積み上げ（合計行を税ベース totJpy と一致させ小数を出さない）
        ccyGroups[ccy].sub += (ccy === 'JPY' ? Math.ceil(sub) : sub);
        ccyGroups[ccy].tax += taxAmt;
        ccyGroups[ccy].mk  += (d.mk || 0);
        totCostJpy += (typeof toJPY === 'function') ? SharedCalc.jpyRound(toJPY(d.cost, d.pc || 'JPY')) : ((!d.pc || d.pc === 'JPY') ? d.cost : 0);
      }
      // 金額系セルは fmtMoney（3桁カンマ）、数量は fmtRaw のまま。docs/バグ台帳.md E
      const jpyCellText = (d.bc && d.bc !== 'JPY') ? fmtMoney(jpyAmt) : '—';
      const taxCellText = d.taxed ? fmtMoney(taxAmt) : '';
      const isNonJpyBc = d.bc && d.bc !== 'JPY';
      const isNonJpyPc = d.pc && d.pc !== 'JPY';
      const subJpyHint = (isNonJpyBc && sub && typeof toJPY === 'function')
        ? `<small class="pv-jpy-hint">(≈¥${fmtMoney(jpyAmt)})</small>` : '';
      const profitJpy = (isNonJpyBc || isNonJpyPc) && typeof toJPY === 'function'
        ? Math.ceil(toJPY(sub, d.bc || 'JPY') - toJPY(d.cost, d.pc || 'JPY')) : null;
      const prJpyHint = profitJpy !== null
        ? `<small class="pv-jpy-hint">(≈¥${fmtMoney(profitJpy)})</small>` : '';
      const _hqCls = d._hideQuote ? ' pv-row-hidden-quote' : '';
      const _hqBadge = d._ps
        ? '<span class="pv-hq-badge pv-ps-badge" title="PROFIT SHARE（代理店収益）。客先見積もりには出さず、社内利益にのみ計上します">🤝 PROFIT SHARE</span> '
        : d._outRange
        ? '<span class="pv-hq-badge pv-oor-badge" title="サーチャージの適用期間が見積もり提示日（有効期限）の範囲外のため、客先見積もり・PDF・Excel・CSV・合計から自動的に除外されます">📅 適用期間外</span> '
        : (d._hideManual ? '<span class="pv-hq-badge" title="この行は見積書（PDF・Excel・CSV・客先プレビュー）に出力されません">🚫見積書非表示</span> ' : '');
      // 実費行：単価・金額は「実費」表示（金額未確定・別途精算）。CD/乗せ幅/円換算/税は空、利益は —
      const _ac      = d._actual;
      const _acTxt   = '<span class="pv-actual-txt">実費</span>';
      const ppCell   = _ac ? _acTxt : fmtMoney(d.pp);
      const cdCell   = _ac ? '' : fmtMoney(d.cd);
      const bpCell   = _ac ? _acTxt : fmtMoney(d.bp);
      const mkCell   = _ac ? '' : fmtMoney(d.mk);
      const subCell  = _ac ? _acTxt : (fmtMoney(sub) + subJpyHint);
      const jpyCell2 = _ac ? '' : jpyCellText;
      const taxCell2 = _ac ? '' : taxCellText;
      const prCell   = _ac ? '—' : (fmtMoney(d.profit) + prJpyHint);
      // 都度請求（発生時のみ）：客先にも金額は出すが合計外。客先向け注記を付ける
      const _condNote = d._cond ? '<span class="pv-cond-note">（発生時のみ）</span>' : '';
      html += `<tr class="${(d._gi != null ? 'pv-grp-row pv-grp-c' + (d._gi % 4) : '')}${_hqCls}${_ac ? ' pv-row-actual' : ''}${d._cond ? ' pv-row-cond' : ''}">
        <td class="pv-name" style="font-size:11px;">${escHtml(getCatLabel(d.cat))}</td>
        <td class="pv-name">${escHtml(d.sv)}</td>
        <td class="${nameCls}">${_hqBadge}${escHtml(d.name)}${_condNote}${_pvValidityBadge(d.vf, d.vt)}</td>
        <td class="pv-num">${fmtRaw(d.pq)}</td><td>${escHtml(d.un || '')}</td><td>${escHtml(d.pc)}</td>
        <td class="pv-num">${ppCell}</td>
        <td class="pv-cd pv-num">${cdCell}</td>
        <td class="pv-num">${fmtRaw(d.bq)}</td><td>${escHtml(d.bc)}</td>
        <td class="pv-num">${bpCell}</td>
        <td class="pv-num">${mkCell}</td>
        <td class="pv-num pv-subtotal">${subCell}</td>
        <td class="pv-jpy">${jpyCell2}</td>
        <td class="pv-num pv-tax-cell" data-sub="${_ac ? 0 : sub}" data-ccy="${d.bc || 'JPY'}" data-taxed="${(d.taxed && !_ac) ? 1 : 0}">${taxCell2}</td>
        <td class="pv-pr ${pc} pv-num">${prCell}</td>
        <td class="pv-name">${escHtml(d.note)}</td>
      </tr>`;
    });

    const totPc = totPr > 0 ? 'pv-pos' : totPr < 0 ? 'pv-neg' : 'pv-zero';
    // 通貨別合計行を生成（JPY が先頭、以降アルファベット順）
    const ccyKeys = Object.keys(ccyGroups).sort((a, b) =>
      a === 'JPY' ? -1 : b === 'JPY' ? 1 : a.localeCompare(b));
    const isMultiCcy = ccyKeys.length > 1;
    // 請求 or 仕入のどちらかに外貨があれば JPY 換算ベースの集計を権威値とする。
    // （請求は単一 JPY でも仕入が外貨だと native 利益は未換算原価を引いて誤るため・docs/バグ台帳）
    const hasAnyFx  = hasNonJpyBill || hasNonJpyCost;
    const pureNative = !isMultiCcy && !hasAnyFx;
    const _tfootRow = (ccy, g, extraCls, showMk, prText, prCls) => {
      const taxText    = g.tax > 0 ? fmtMoney(g.tax) : '—';
      const jpyConvText = (ccy !== '≈JPY' && ccy !== 'JPY' && typeof toJPY === 'function')
        ? '≈' + fmtMoney(Math.ceil(toJPY(g.sub, ccy))) : '';
      return `<tr class="pv-total${extraCls}">
        <td colspan="3">合計（${escHtml(ccy)}）</td>
        <td data-ft-col="pay"></td>
        <td data-ft-col="unit"></td>
        <td data-ft-col="pay"></td>
        <td data-ft-col="pay"></td>
        <td data-ft-col="pay"></td>
        <td data-ft-col="bill"></td>
        <td data-ft-col="bill" class="pv-ccy-badge">${escHtml(ccy)}</td>
        <td data-ft-col="bill"></td>
        <td data-ft-col="mk" class="pv-num">${showMk ? fmtMoney(g.mk) : ''}</td>
        <td class="pv-num pv-subtotal">${fmtMoney(g.sub)}${jpyConvText ? `<span class="pv-jpy-inline">(${jpyConvText})</span>` : ''}</td>
        <td data-ft-col="jpy-conv" class="pv-jpy">${jpyConvText}</td>
        <td data-ft-col="tax-col" data-ccy="${escHtml(ccy)}" class="pv-num pv-tax-total">${taxText}</td>
        <td data-ft-col="profit" class="pv-num ${prCls}">${prText}</td>
        <td data-ft-col="note"></td>
      </tr>`;
    };
    let tfootHtml = '</tbody><tfoot>';
    ccyKeys.forEach(ccy => {
      const g      = ccyGroups[ccy];
      // 純単一通貨（請求・仕入とも同一通貨）のときだけ native 利益/乗せ幅を表示。
      // FX を含む場合は per-ccy 行では利益を出さず、≈JPY グランド合計行を権威値とする。
      tfootHtml += _tfootRow(
        ccy, g,
        isMultiCcy ? ' pv-total-ccy' : '',
        pureNative,
        pureNative ? fmtMoney(totPr) : '',
        pureNative ? `pv-pr ${totPc}` : ''
      );
    });
    if (isMultiCcy || hasAnyFx) {
      // 行ごとに丸めた JPY 換算の積み上げ（totJpy）をそのまま使用。
      // 通貨グループ和から再計算すると御見積書（行ごと丸め）と数円ズレるため統一（docs/バグ台帳）。
      const grandJpy   = totJpy;
      const grandTax   = ccyGroups['JPY']?.tax || 0;
      const grandMkJpy = Math.ceil(ccyKeys.reduce((s, c) =>
        s + (typeof toJPY === 'function' ? toJPY(ccyGroups[c].mk, c) : (c === 'JPY' ? ccyGroups[c].mk : 0)), 0));
      const grandPrJpy = totJpy - totCostJpy;
      const grandPcCls = grandPrJpy > 0 ? 'pv-pos' : grandPrJpy < 0 ? 'pv-neg' : 'pv-zero';
      tfootHtml += _tfootRow(
        '≈JPY', { sub: grandJpy, tax: grandTax, mk: grandMkJpy },
        ' pv-grand-total', true,
        fmtMoney(grandPrJpy), `pv-pr ${grandPcCls}`
      );
    }
    html += tfootHtml + '</tfoot></table>';

    document.getElementById('previewTableWrap').innerHTML = html;

    const cond = getConditions();
    // 航路：1件以上の登録があれば航路ごとに via・キャリア・サービス名を含めて表示、なければ従来通り POL/POD を分けて表示
    const routeFields = (cond.routes && cond.routes.length >= 1)
      ? cond.routes.map((r, i) => ({
          lbl: cond.routes.length === 1 ? '航路' : `航路${i + 1}`,
          val: [[r.pol, r.via, r.pod].filter(Boolean).join(' → '),
                [r.carrier, r.service ? `(${r.service})` : ''].filter(Boolean).join(' '),
                r.tt ? `T/T: ${r.tt}` : ''
               ].filter(Boolean).join('　'),
        }))
      : [
          { lbl: '積み地（POL）',   val: cond.pol },
          { lbl: '揚げ地（POD）',   val: cond.pod },
        ];
    const condFields = [
      ...routeFields,
      { lbl: cond.direction === 'export' ? '集荷地' : '発地', val: cond.origin },
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
        { lbl: '総CBM',          val: totalCBM.toFixed(3) + ' CBM' },
        { lbl: '総重量',         val: totalKg.toLocaleString('ja-JP') + ' kg' },
        { lbl: '総個数',         val: totalPcs.toLocaleString('ja-JP') + ' pcs' },
        { lbl: 'RT（海上）',     val: rt.toFixed(3) + ' R/T' },
        { lbl: 'CW（航空）',     val: SharedCalc.fmtCw(cw) + ' kg' },
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

    // 作業範囲（客先向けにも出力）
    const scopeText = (document.getElementById('qf-scope')?.value || '').trim();
    const pvScope = document.getElementById('pvScopeBox');
    if (pvScope) {
      if (scopeText) {
        pvScope.style.display = 'block';
        pvScope.innerHTML = `<strong>🛠️ 作業範囲</strong>${escHtml(scopeText)}`;
      } else {
        pvScope.style.display = 'none';
      }
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
      // 実際に使用した非JPY通貨のレートを一覧表示
      const usedNonJpy = ccyKeys.filter(c => c !== 'JPY' && c !== '≈JPY');
      const ratesLine = usedNonJpy.length
        ? '換算レート（参考）: ' + usedNonJpy.map(c =>
            `1 ${c} = ${typeof _fxRates !== 'undefined' ? _fxRates[c] : (typeof toJPY === 'function' ? toJPY(1, c) : '—')} JPY`
          ).join('　/　')
        : '';
      pvAudit.innerHTML =
        (ratesLine ? `<div class="pv-audit-line pv-audit-rates">${escHtml(ratesLine)}</div>` : '') +
        '<div class="pv-audit-line">' + escHtml(m.fxLine) + '</div>' +
        '<div class="pv-audit-line">' + escHtml(m.created) + '</div>' +
        (m.hasFresh ? '' : '<div class="pv-audit-warn">⚠️ 為替を自動取得していません。手動値またはデフォルト値で表示中</div>');
    }
    // 税計算用に合計小計をセット。行ごと丸めの JPY 積み上げ（totJpy）を常に基準にして
    // 小数・通貨混在加算を排除し、御見積書・サマリと一致させる（docs/バグ台帳）。
    // 単一通貨 JPY でも単価が乗せ幅等で小数を持ち得るため、totSub ではなく totJpy を使う。
    const pvTotSub = document.getElementById('pvTotalSubtotal');
    if (pvTotSub) pvTotSub.dataset.raw = String(totJpy);
    // pvWasVisible を各セクション要素に記録する（applyPreviewCustomize の「戻す」判定に使用）
    // ここで表示中（display !== 'none'）のセクションを '1' としてマーク
    ['pvMeta','pvCondBox','pvCargoBox','pvScopeBox','pvRemarkBox','pvTaxBox'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.dataset.pvWasVisible = (el.style.display !== 'none') ? '1' : '0';
    });
    document.getElementById('previewOverlay').classList.add('open');
    // 消費税は標準 10% 固定・課否は行ごとの「課税」チェックで制御（全体の輸出免税0%は廃止）
    updatePreviewTax();
    // Apply saved customization
    initPreviewCustomize();
    applyPreviewCustomize();
    // レイアウト（表計算 / 見積書）を適用
    applyPreviewLayout();
    // Hook up change listeners (attach only once via flag)
    if (!document.getElementById('pvCustomizeWrap')?.dataset.listenerSet) {
      document.querySelectorAll('.pv-col-chk, .pv-sec-chk').forEach(chk => {
        chk.addEventListener('change', applyPreviewCustomize);
      });
      const wrap = document.getElementById('pvCustomizeWrap');
      if (wrap) wrap.dataset.listenerSet = '1';
    }
    // 1画面フィット：レンダリング確定後に縮小調整＋リサイズ追従（初回のみバインド）
    scheduleFitPreview();
    if (!window.__pvFitResizeBound) {
      window.addEventListener('resize', fitPreviewToScreen);
      window.__pvFitResizeBound = true;
    }
    } catch (err) {
      _pvBypassed = false;
      console.error('[openPreview] エラー:', err);
      alert('プレビュー表示中にエラーが発生しました。\n' + err.message);
    }
  }

  // ========== プレビュー消費税計算（標準10%・課否は行ごと）==========
  function updatePreviewTax() {
    const totalSub  = parseFloat(document.getElementById('pvTotalSubtotal')?.dataset.raw || '0');
    const rate = getEffectiveTaxRate();
    // 行ごとの消費税セルを更新（課税行のみ計算・通貨別集計）
    let totTaxJpy = 0;
    const perCcyTax = {};
    document.querySelectorAll('#previewTable .pv-tax-cell').forEach(td => {
      const sub   = parseFloat(td.dataset.sub) || 0;
      const taxed = td.dataset.taxed === '1';
      const ccy   = td.dataset.ccy || 'JPY';
      if (!taxed) { td.textContent = ''; return; }
      // 行単位で切り上げ（E-5: JPY行は ceil、外貨行はそのまま）
      const amt = (ccy === 'JPY') ? Math.ceil(sub * rate) : sub * rate;
      perCcyTax[ccy] = (perCcyTax[ccy] || 0) + amt;
      totTaxJpy += (ccy === 'JPY') ? amt : 0;
      td.textContent = fmtMoney(amt);
    });
    // 合計行の消費税セル（通貨別）
    document.querySelectorAll('#previewTable .pv-tax-total[data-ccy]').forEach(td => {
      const ccy = td.dataset.ccy;
      if (ccy === '≈JPY') {
        td.textContent = totTaxJpy > 0 ? fmtMoney(Math.ceil(totTaxJpy)) : '—';
      } else {
        const t = perCcyTax[ccy] || 0;
        td.textContent = t > 0 ? fmtMoney(t) : '—';
      }
    });
    // 底部サマリ（消費税額・税込合計）JPY換算ベース。行単位ceil済みのため再丸め不要（E-5）
    const tax   = totTaxJpy;
    const total = Math.round(totalSub) + tax;
    const taxEl   = document.getElementById('pvTaxAmount');
    const totalEl = document.getElementById('pvTaxTotal');
    if (taxEl)   taxEl.textContent   = fmtMoney(tax);
    if (totalEl) totalEl.textContent = fmtMoney(total);
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
        table.querySelectorAll(`thead tr th:nth-child(${ci + 1}), tbody tr:not(.pv-subtotal-sep):not(.pv-subcon-subtotal):not(.pv-subcon-header):not(.pv-pattern-header):not(.pv-pattern-subtotal):not(.pv-table-remark-row) td:nth-child(${ci + 1})`).forEach(cell => {
          cell.style.display = show ? '' : 'none';
        });
      });
      // tfoot・tbody の colspan 行（合計行・小計セパレーター等）は
      // nth-child ではなく data-ft-col で制御（colspan で列位置がずれるため）
      table.querySelectorAll(`tfoot td[data-ft-col="${chk.dataset.col}"], tbody td[data-ft-col="${chk.dataset.col}"]`).forEach(cell => {
        cell.style.display = show ? '' : 'none';
      });
      // サブコン小計ラベル内の内部指標（仕入合計・粗利率）は利益列に連動して表示/非表示
      if (chk.dataset.col === 'profit') {
        table.querySelectorAll('.pv-scs-cost, .pv-scs-margin').forEach(el => {
          el.style.display = show ? '' : 'none';
        });
      }
    });

    // ▼ 小計ラベル（colspan）行の桁ずれ補正
    //   列を隠すと colspan 数と実表示列数がずれ金額セルが「小計」列からはみ出す。
    //   表示中の先頭列数に colspan を合わせ、金額を小計列に揃える。
    const _isOn = (col) => {
      const c = document.querySelector(`.pv-col-chk[data-col="${col}"]`);
      return !c || c.checked;
    };
    const _leadingVisible =
      (_isOn('cat') ? 1 : 0) +
      (_isOn('sv') ? 1 : 0) +
      1 /* 項目名は常時表示 */ +
      (_isOn('pay') ? 4 : 0) +
      (_isOn('unit') ? 1 : 0) +
      (_isOn('bill') ? 3 : 0) +
      (_isOn('mk') ? 1 : 0);
    table.querySelectorAll('.pv-scs-label, .pv-subtotal-sep-label, .pv-pts-label').forEach(td => {
      td.colSpan = Math.max(1, _leadingVisible);
    });
    const _leadHead = 1 /* 項目名 */ + (_isOn('cat') ? 1 : 0) + (_isOn('sv') ? 1 : 0);
    table.querySelectorAll('tfoot tr.pv-total > td:first-child').forEach(td => {
      td.colSpan = Math.max(1, _leadHead);
    });

    // セクション表示切り替え
    const secMap = {
      meta:   'pvMeta',
      cond:   'pvCondBox',
      cargo:  'pvCargoBox',
      scope:  'pvScopeBox',
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

    // 社内/客先モードバナー・透かし更新
    const wrap = document.getElementById('previewTableWrap');
    const sensitive = isSensitiveOn();
    wrap?.classList.toggle('has-sensitive', sensitive);
    updateModeBanner(sensitive);

    // 列・セクションの表示切替で高さが変わるため、1画面フィットを再計算
    if (typeof fitPreviewToScreen === 'function') scheduleFitPreview();
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

  function updateModeBanner(sensitive) {
    const banner = document.getElementById('pvModeBanner');
    if (!banner) return;
    if (sensitive == null) sensitive = isSensitiveOn();
    if (sensitive) {
      banner.className = 'pv-mode-banner pv-mode-internal';
      banner.textContent = '社内用モード（原価・乗せ幅・利益列が含まれています）— 客先への送付には使用しないでください';
    } else {
      banner.className = 'pv-mode-banner pv-mode-client';
      banner.textContent = '客先提示用モード（機密列は非表示）';
    }
  }

  function sensitiveColumnsGate(label) {
    if (!isSensitiveOn()) return true;
    return confirm(
      `⚠️ ${label}：原価・乗せ幅・利益列が含まれています。\n\n` +
      `客先への送付には使用しないでください。\n` +
      `社内用として出力しますか？`
    );
  }

  function _clientNoteGate() {
    const hasNote = collectData().some(d => d.note && d.note.trim());
    if (!hasNote) return true;
    return confirm(
      '📝 備考欄に内容が入力されています。\n\n' +
      '原価・社内情報が含まれていないか確認してください。\n\n' +
      'このまま客先用として出力しますか？'
    );
  }

  function _withClientColumns(fn) {
    const saved = {};
    document.querySelectorAll('.pv-col-chk').forEach(chk => { saved[chk.dataset.col] = chk.checked; });
    ['pay', 'mk', 'profit'].forEach(k => {
      const chk = document.querySelector(`.pv-col-chk[data-col="${k}"]`);
      if (chk) chk.checked = false;
    });
    applyPreviewCustomize();
    try { fn(); }
    finally {
      document.querySelectorAll('.pv-col-chk').forEach(chk => {
        if (chk.dataset.col in saved) chk.checked = saved[chk.dataset.col];
      });
      applyPreviewCustomize();
    }
  }

  function exportExcelAsClient() {
    if (!_clientNoteGate()) return;
    _withClientColumns(() => exportExcel());
  }

  function exportPDFAsClient() {
    if (!_clientNoteGate()) return;
    _withClientColumns(() => {
      if (!_pvBypassed && !preOutputValidationGate('客先用 PDF 出力', exportPDFAsClient)) return;
      _pvBypassed = false;
      window.print();
    });
  }

  // 表計算レイアウトで内部スクロール化しうるセクション（テーブル＋補助セクション）
  function _pvScrollableEls() {
    return ['previewTableWrap', 'pvRemarkBox', 'pvCargoBox']
      .map(id => document.getElementById(id)).filter(Boolean);
  }
  function _pvResetScrollAreas() {
    _pvScrollableEls().forEach(el => { el.style.maxHeight = ''; el.style.overflowY = ''; });
  }

  function closePreview()  {
    const box = document.getElementById('previewBox');
    if (box) box.style.zoom = '';           // 縮小フィットをリセット（次回開く時に再計算）
    _pvResetScrollAreas();                  // 内部スクロール設定もリセット
    document.getElementById('previewOverlay').classList.remove('open');
  }

  // ========== プレビューを1画面に収める ==========
  // モーダル(#previewBox)が縦スクロールせず1画面に収まるよう自動調整する。
  // レイアウトごとに収め方を変える（ユーザー要望）:
  //   ・御見積書(doc): 横幅基準でフィット（通常は等倍＝元サイズ）。高さは縮小せず
  //        ページ送り＋オーバーレイ縦スクロールで対応（読みやすさ優先）。
  //   ・表計算(table): モーダルは原寸（横幅含む）のまま、情報量が多い時は内部スクロール。
  //        テーブルを主役とし、まずリマーク・貨物ボックスを内部スクロール化して余白を
  //        確保（テーブル領域がリマーク量で圧迫されないように）、それでも溢れる分だけ
  //        最後にテーブル自身を内部スクロールさせる。
  // どちらも収まらない極端なケースは overlay 側の overflow-y:auto にフォールバック。
  const PV_FIT_MIN_ZOOM = 0.4;
  const PV_FIT_MIN_TABLE_H = 220; // 表計算: テーブルスクロール領域の最小高さ(px)
  function fitPreviewToScreen() {
    const overlay = document.getElementById('previewOverlay');
    const box = document.getElementById('previewBox');
    if (!overlay || !box || !overlay.classList.contains('open')) return;
    // いったん全リセットして自然サイズを測る（zoom / 内部スクロール適用中の測定誤差を避ける）
    box.style.zoom = '';
    _pvResetScrollAreas();
    // 親 #tab-quote-make に zoom（大/中/小スケール）が掛かっていても、overlay と box は
    // 同じ座標系（同じ zoom 配下）にあるため、overlay.clientHeight との比で正しく算出できる。
    // overlay は position:fixed inset:0 なので clientHeight＝可視ビューポート高さ（ローカル CSS px）。
    const pad = 60; // overlay の上下パディング合計（CSS: padding 30px 20px）
    const avail = overlay.clientHeight - pad;
    if (avail <= 0) return;

    if (box.classList.contains('layout-doc')) {
      // 御見積書: 横幅基準でフィット（高さでは縮小しない＝読みやすさ優先）。
      // 1ページ(A4)が画面高さより高くても、ページ送り＋オーバーレイの縦スクロールで対応する。
      // 通常幅のモニターでは等倍（元のサイズ）で表示され、極端に狭い時だけ横幅に合わせて縮小。
      const naturalW = box.offsetWidth;
      const availW = overlay.clientWidth - 40; // overlay 左右パディング合計（CSS: padding 30px 20px）
      if (!naturalW || availW <= 0) { box.style.zoom = ''; return; }
      const z = availW / naturalW;
      if (z >= 1) { box.style.zoom = ''; return; } // 収まっている → 等倍
      box.style.zoom = String(Math.max(PV_FIT_MIN_ZOOM, z));
      return;
    }

    // 表計算: テーブルを主役に内部スクロール化（モーダルは1画面・原寸を維持）
    const tableWrap = document.getElementById('previewTableWrap');
    if (!tableWrap) return;
    let overflow = box.offsetHeight - avail;
    if (overflow <= 0) return; // すでに収まっている → そのまま

    // (1) 補助セクション（リマーク→貨物）を先に縮めて余白を確保（各々の最小高さまで）
    const flexSecs = [
      { el: document.getElementById('pvRemarkBox'), min: 120 },
      { el: document.getElementById('pvCargoBox'),  min: 100 },
    ];
    for (const s of flexSecs) {
      if (overflow <= 0) break;
      if (!s.el || s.el.style.display === 'none') continue;
      const h = s.el.offsetHeight;
      const reducible = Math.max(0, h - s.min);
      if (reducible <= 0) continue;
      const cut = Math.min(overflow, reducible);
      s.el.style.maxHeight = (h - cut) + 'px';
      s.el.style.overflowY = 'auto';
      overflow -= cut;
    }

    // (2) まだ溢れる分だけテーブル自身を内部スクロール（最小高さは確保）
    if (overflow > 0) {
      const tH = tableWrap.offsetHeight;
      const target = Math.max(PV_FIT_MIN_TABLE_H, tH - overflow);
      tableWrap.style.maxHeight = target + 'px';
      tableWrap.style.overflowY = 'auto';
    }
  }
  window.fitPreviewToScreen = fitPreviewToScreen;
  // レイアウト/カスタマイズ/ページ送り後に高さが変わるため、複数タイミングで再フィット
  function scheduleFitPreview() {
    requestAnimationFrame(fitPreviewToScreen);
    setTimeout(fitPreviewToScreen, 130); // 御見積書(doc)の非同期レンダリング後の保険
  }

  // ========== プレビューのレイアウト切替（表計算 / 御見積書フォーマット） ==========
  function overlayClick(e) { if (e.target === document.getElementById('previewOverlay')) closePreview(); }
  let _pvLayout = (function () {
    try { return localStorage.getItem('pvLayout_v1') === 'table' ? 'table' : 'doc'; }
    catch (_) { return 'doc'; }
  })();
  // A4 縦（96dpi 換算）: 210×297mm ≈ 794×1123px
  const A4_W = 794, A4_H = 1123;
  let _docPage = 0, _docPages = 1;

  function applyPreviewLayout() {
    const box = document.getElementById('previewBox');
    if (!box) return;
    box.classList.toggle('layout-doc', _pvLayout === 'doc');
    document.querySelectorAll('.pv-layout-btn').forEach(b =>
      b.classList.toggle('is-on', b.dataset.pvl === _pvLayout));
    const h2 = box.querySelector('h2');
    if (h2) h2.textContent = _pvLayout === 'doc' ? '📋 プレビュー（御見積書フォーマット）' : '📋 プレビュー（表計算形式）';
    if (_pvLayout === 'doc') {
      // 御見積書用 発行日／有効期限 入力欄を現在のフォーム値で同期
      const hdr = getQuoteHeader();
      const dEl = document.getElementById('pvDocDate');
      const vEl = document.getElementById('pvDocValid');
      if (dEl) dEl.value = hdr.date || '';
      if (vEl) vEl.value = hdr.validUntil || '';
      renderDocPreview();
    }
  }
  function setPreviewLayout(mode) {
    _pvLayout = (mode === 'doc') ? 'doc' : 'table';
    try { localStorage.setItem('pvLayout_v1', _pvLayout); } catch (_) {}
    _docPage = 0;
    applyPreviewLayout();
    scheduleFitPreview(); // レイアウト切替で高さが変わるため再フィット
  }
  window.setPreviewLayout = setPreviewLayout;

  // 御見積書を A4 ページに分割してプレビュー（複数ページ時はページ送りを表示）
  function renderDocPreview() {
    const wrap = document.getElementById('previewDocWrap');
    if (!wrap || typeof buildQuoteDocHTML !== 'function') return;
    wrap.innerHTML =
      '<div class="qd-pager" id="qdPager" style="display:none;">' +
        '<button class="qd-pg-btn" id="qdPrevPg" type="button">‹ 前のページ</button>' +
        '<span class="qd-pg-ind" id="qdPgInd">1 / 1</span>' +
        '<button class="qd-pg-btn" id="qdNextPg" type="button">次のページ ›</button>' +
      '</div>' +
      '<div class="qd-viewport" id="qdViewport">' +
        '<div class="qd-doc-scroll" id="qdDocScroll">' + buildQuoteDocHTML() + '</div>' +
      '</div>';
    const prev = wrap.querySelector('#qdPrevPg');
    const next = wrap.querySelector('#qdNextPg');
    if (prev) prev.onclick = () => { _docPage = Math.max(0, _docPage - 1); applyDocPage(); };
    if (next) next.onclick = () => { _docPage = Math.min(_docPages - 1, _docPage + 1); applyDocPage(); };
    // レンダリング後に高さを測ってページ数を算出
    const measure = () => {
      const page = wrap.querySelector('.qd-page');
      const h = page ? page.scrollHeight : 0;
      if (!h) return; // まだレイアウト未確定
      _docPages = Math.max(1, Math.ceil(h / A4_H));
      if (_docPage > _docPages - 1) _docPage = _docPages - 1;
      const pager = wrap.querySelector('#qdPager');
      if (pager) pager.style.display = _docPages > 1 ? 'flex' : 'none';
      applyDocPage();
      fitPreviewToScreen(); // ページ数・ページャ確定後に1画面へフィット
    };
    requestAnimationFrame(measure);
    setTimeout(measure, 80); // rAF が走らない環境向けの保険
  }
  function applyDocPage() {
    const wrap = document.getElementById('previewDocWrap');
    if (!wrap) return;
    const scroll = wrap.querySelector('#qdDocScroll');
    if (scroll) scroll.style.transform = 'translateY(' + (-_docPage * A4_H) + 'px)';
    const ind = wrap.querySelector('#qdPgInd');
    if (ind) ind.textContent = (_docPage + 1) + ' / ' + _docPages;
    const prev = wrap.querySelector('#qdPrevPg');
    const next = wrap.querySelector('#qdNextPg');
    if (prev) prev.disabled = _docPage <= 0;
    if (next) next.disabled = _docPage >= _docPages - 1;
  }

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
    { hdr: '項目名',   fn: d => d.name + (d._cond ? '（発生時のみ）' : ''), pvGroup: null,     role: 'name'   },
    { hdr: '数量',     fn: d => fmtRaw(d.pq),          pvGroup: 'pay',    role: 'pq'     },
    { hdr: '単位',     fn: d => d.un || '',            pvGroup: 'unit',   role: 'un'     },
    { hdr: '通貨',     fn: d => d.pc,                  pvGroup: 'pay',    role: 'pc'     },
    { hdr: '単価',     fn: d => d._actual ? '実費' : fmtRaw(d.pp), pvGroup: 'pay',    role: 'pp'     },
    { hdr: 'CD',       fn: d => d._actual ? '' : fmtRaw(d.cd),     pvGroup: 'pay',    role: 'cd'     },
    { hdr: '数量',     fn: d => fmtRaw(d.bq),          pvGroup: 'bill',   role: 'bq'     },
    { hdr: '通貨',     fn: d => d.bc,                  pvGroup: 'bill',   role: 'bc'     },
    { hdr: '単価',     fn: d => d._actual ? '実費' : fmtRaw(d.bp), pvGroup: 'bill',   role: 'bp'     },
    { hdr: '乗せ幅',       fn: d => d._actual ? '' : fmtRaw(d.mk),     pvGroup: 'mk',       role: 'mk'     },
    { hdr: '円換算(JPY)', fn: d => { if (d._actual) return '実費'; const s = (d.bq||0)*(d.bp||0); return (d.bc && d.bc !== 'JPY') ? fmtRaw(typeof toJPY === 'function' ? Math.ceil(toJPY(s, d.bc)) : s) : '—'; }, pvGroup: 'jpy-conv', role: 'jpyConv' },
    { hdr: '利益',         fn: d => d._actual ? '—' : fmtRaw(d.profit), pvGroup: 'profit',   role: 'profit' },
    { hdr: '備考',         fn: d => d.note,                pvGroup: 'note',     role: 'note'   },
  ];

  function copyTSV() {
    const data = collectData();
    if (!data.length) return;
    if (!_pvBypassed && !preOutputValidationGate('クリップボードコピー', copyTSV)) return;
    _pvBypassed = false;
    if (!sensitiveColumnsGate('クリップボードコピー')) return;
    const hdr = getQuoteHeader();
    let totCost = 0, totBill = 0, totMk = 0;
    data.forEach(d => { if (d._actual || d._cond) return; totCost += d.cost; totBill += d.bill; totMk += d.mk; });
    const totPr = totBill - totCost;
    const vis = getPreviewVisibility();
    const visCols = TSV_COL_DEFS.filter(c => !c.pvGroup || vis[c.pvGroup]);
    const idxOf = role => visCols.findIndex(c => c.role === role);

    const lines = [];
    if (hdr.ref || hdr.customer || hdr.person || hdr.date || hdr.validUntil) {
      if (hdr.ref)        lines.push(`見積もり番号\t${hdr.ref}`);
      if (hdr.customer)   lines.push(`お客様\t${hdr.customer}`);
      if (hdr.person)     lines.push(`担当\t${formatPersonWithHonorific(hdr.person)}`);
      lines.push(`発行日\t${hdr.date || _pvTodayIso()}`);
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
    const scopeTextTsv = (document.getElementById('qf-scope')?.value || '').trim();
    if (scopeTextTsv) {
      lines.push('');
      lines.push('【作業範囲】');
      scopeTextTsv.split('\n').forEach(l => { if (l.trim()) lines.push(l); });
    }
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
    if (!_pvBypassed && !preOutputValidationGate('PDF 出力（印刷）', exportPDF)) return;
    _pvBypassed = false;
    if (!sensitiveColumnsGate('PDF 出力')) return;
    // 見積書レイアウトは、埋め込みプレビュー環境でも確実に印刷できるよう
    // 独立した印刷ウィンドウに書き出して印刷する（アプリDOM/競合CSSの影響を排除）。
    if (_pvLayout === 'doc') { printDocStandalone(); return; }
    window.print();
  }

  // 御見積書を独立ウィンドウに書き出して印刷（環境非依存）。
  // ポップアップがブロックされた場合は従来の window.print() にフォールバック。
  function _docViewportUnlock() {
    // qd-doc-scroll の translateY と qd-viewport の overflow を一時解除して全ページを可視化
    const scroll = document.getElementById('qdDocScroll');
    const vp     = document.getElementById('qdViewport');
    const saved  = { transform: scroll?.style.transform, height: vp?.style.height, overflow: vp?.style.overflow };
    if (scroll) scroll.style.transform = 'none';
    if (vp) { vp.style.height = 'auto'; vp.style.overflow = 'visible'; }
    return saved;
  }
  function _docViewportRestore(saved) {
    const scroll = document.getElementById('qdDocScroll');
    const vp     = document.getElementById('qdViewport');
    if (scroll) scroll.style.transform = saved.transform ?? '';
    if (vp) { vp.style.height = saved.height ?? ''; vp.style.overflow = saved.overflow ?? ''; }
  }

  // beforeprint/afterprint で doc-layout 印刷時に viewport 制約を JS レベルで解除
  // （CSS :has() が効かない環境やポップアップブロック時のフォールバック対策）
  let _beforePrintSaved = null;
  window.addEventListener('beforeprint', function () {
    if (_pvLayout !== 'doc') return;
    _beforePrintSaved = _docViewportUnlock();
  });
  window.addEventListener('afterprint', function () {
    if (_beforePrintSaved) { _docViewportRestore(_beforePrintSaved); _beforePrintSaved = null; }
  });

  function printDocStandalone() {
    if (typeof buildQuoteDocHTML !== 'function') { window.print(); return; }
    const docHtml = buildQuoteDocHTML();
    const w = window.open('', '_blank', 'width=900,height=1100');
    if (!w) {
      // ポップアップ不可（サンドボックス等）→ ビューポート制約をJSで解除してその場印刷
      if (window.quoteShowToast) quoteShowToast('ポップアップがブロックされました。印刷ダイアログをそのままお使いください。備考など全ページが出力されます。', 'warn');
      window.print();
      return;
    }
    // 現在ページの CSS（リンク＋インライン）を引き継ぎ、.qd-* スタイルを適用
    let head = '';
    document.querySelectorAll('link[rel="stylesheet"]').forEach(el => {
      const href = el.href; if (href) head += '<link rel="stylesheet" href="' + href + '">';
    });
    document.querySelectorAll('style').forEach(el => { head += '<style>' + el.textContent + '</style>'; });
    const printCss =
      '<style>' +
      '@page{size:A4 portrait;margin:14mm;}' +
      'html,body{margin:0;padding:0;background:#fff;}' +
      '.qd-doc-print-host{display:flex;justify-content:center;padding:16px;}' +
      '.qd-doc-print-host .qd-page{box-shadow:none!important;width:100%!important;max-width:794px;min-height:auto!important;margin:0 auto!important;}' +
      '@media print{.qd-doc-print-host{padding:0;}.qd-doc-print-host .qd-page{max-width:none;padding:0!important;}}' +
      '</style>';
    w.document.open();
    w.document.write(
      '<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>御見積書</title>' +
      head + printCss +
      '</head><body><div class="qd-doc-print-host">' + docHtml + '</div></body></html>'
    );
    w.document.close();
    w.focus();
    // フォント・レイアウト確定後に印刷ダイアログを開く
    const fire = () => { try { w.focus(); w.print(); } catch (e) {} };
    if (w.document.fonts && w.document.fonts.ready) {
      w.document.fonts.ready.then(() => setTimeout(fire, 250));
    } else {
      setTimeout(fire, 600);
    }
  }
  window.printDocStandalone = printDocStandalone;

  // ========== Excel 出力（SheetJS） ==========
  // 各列定義に pvGroup を付け、プレビュー表示カスタマイズに連動して列を絞り込む
  // pvGroup: null は常時表示（名前/課税/小計）
  const XLSX_COL_DEFS = [
    { hdr: 'カテゴリ',     fn: d => getCatLabel(d.cat),    pvGroup: 'cat',    role: 'cat'    },
    { hdr: 'サブコン',     fn: d => d.sv || '',            pvGroup: 'sv',     role: 'sv'     },
    { hdr: '項目名',       fn: d => d.name + (d._cond ? '（発生時のみ）' : ''), pvGroup: null,     role: 'name'   },
    { hdr: '課税',         fn: d => d.taxed ? '*' : '',   pvGroup: null,     role: 'tax'    },
    { hdr: '数量(原価)',   fn: d => d.pq,                  pvGroup: 'pay',    role: 'pq'     },
    { hdr: '単位',         fn: d => d.un || '',            pvGroup: 'unit',   role: 'un'     },
    { hdr: '通貨(原価)',   fn: d => d.pc,                  pvGroup: 'pay',    role: 'pc'     },
    { hdr: '単価(原価)',   fn: d => d._actual ? '実費' : d.pp, pvGroup: 'pay',    role: 'pp'     },
    { hdr: 'CD',           fn: d => d._actual ? '' : d.cd, pvGroup: 'pay',    role: 'cd'     },
    { hdr: '数量(請求)',   fn: d => d.bq,                  pvGroup: 'bill',   role: 'bq'     },
    { hdr: '通貨(請求)',   fn: d => d.bc,                  pvGroup: 'bill',   role: 'bc'     },
    { hdr: '単価(請求)',   fn: d => d._actual ? '実費' : d.bp, pvGroup: 'bill',   role: 'bp'     },
    { hdr: '乗せ幅',       fn: d => d._actual ? '' : d.mk, pvGroup: 'mk',     role: 'mk'     },
    { hdr: '小計',         fn: d => d._actual ? '実費' : (d.bq || 0) * (d.bp || 0), pvGroup: null,      role: 'sub'     },
    { hdr: '円換算(JPY)', fn: d => { if (d._actual) return '実費'; const s = (d.bq||0)*(d.bp||0); return (d.bc && d.bc !== 'JPY') ? (typeof toJPY === 'function' ? Math.ceil(toJPY(s, d.bc)) : '') : ''; }, pvGroup: 'jpy-conv', role: 'jpyConv' },
    { hdr: '消費税',       fn: d => (d.taxed && !d._actual) ? (d.bq||0)*(d.bp||0)*getEffectiveTaxRate() : '', pvGroup: 'tax-col', role: 'taxAmt' },
    { hdr: '利益',         fn: d => d._actual ? '—' : d.profit, pvGroup: 'profit', role: 'profit' },
    { hdr: '備考',         fn: d => d.note,                pvGroup: 'note',   role: 'note'   },
  ];

  function _buildCcySummaryAoA(allRows, taxRate) {
    const ccyData = {};
    allRows.forEach(d => {
      if (d._type !== 'data') return;
      const bc  = d.bc || 'JPY';
      const sub = (d.bq || 0) * (d.bp || 0);
      if (!ccyData[bc]) ccyData[bc] = { sub: 0, taxedSub: 0, exemptSub: 0 };
      ccyData[bc].sub += sub;
      if (d.taxed) ccyData[bc].taxedSub += sub;
      else         ccyData[bc].exemptSub += sub;
    });
    const ccyKeys = Object.keys(ccyData).sort((a, b) => a === 'JPY' ? -1 : b === 'JPY' ? 1 : a.localeCompare(b));
    const hasMixed = ccyKeys.some(c => ccyData[c].taxedSub > 0 && ccyData[c].exemptSub > 0);
    if (ccyKeys.length <= 1 && !hasMixed) return [];
    const rows = [
      [],
      ['■ 通貨別内訳'],
      ['通貨', '小計', 'うち課税', 'うち免税', `消費税額（${Math.round(taxRate * 100)}%）`, '円換算（JPY）'],
    ];
    ccyKeys.forEach(ccy => {
      const g = ccyData[ccy];
      if (!g.sub) return;
      // 外貨建ては輸出免税が原則のため消費税は JPY 行のみ計算
      const taxAmt = (ccy === 'JPY') ? Math.ceil(g.taxedSub * taxRate) : 0;
      const jpySub = (typeof toJPY === 'function' && ccy !== 'JPY') ? Math.ceil(toJPY(g.sub, ccy)) : '';
      rows.push([
        ccy,
        g.sub,
        g.taxedSub || '',
        g.exemptSub || '',
        taxAmt || '',
        jpySub,
      ]);
    });
    return rows;
  }

  function exportExcel() {
    if (typeof XLSX === 'undefined') {
      alert('SheetJSライブラリが読み込まれていません。ページを再読み込みしてください。');
      return;
    }
    if (!_pvBypassed && !preOutputValidationGate('Excel 出力', exportExcel)) return;
    _pvBypassed = false;
    if (!sensitiveColumnsGate('Excel 出力')) return;
    const allRows = collectAllRows().filter(r => !r._hideQuote);  // 見積書非表示の行は出力しない
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
    if (hdr.ref)        aoaRows.push(['見積もり番号', hdr.ref]);
    if (hdr.customer)   aoaRows.push(['お客様', hdr.customer]);
    if (hdr.person)     aoaRows.push(['担当', formatPersonWithHonorific(hdr.person)]);
    aoaRows.push(['発行日', hdr.date || _pvTodayIso()]);
    if (hdr.validUntil) aoaRows.push(['有効期限', hdr.validUntil]);
    // 引き合い条件（POL/POD/インコタームズ/輸送モード/コンテナ/貨物名）
    const cExcel = getConditions();
    const routePairs = (cExcel.routes && cExcel.routes.length >= 1)
      ? cExcel.routes.map((r, i) => [
          cExcel.routes.length === 1 ? '航路' : `航路${i + 1}`,
          [[r.pol, r.via, r.pod].filter(Boolean).join(' → '),
           [r.carrier, r.service ? `(${r.service})` : ''].filter(Boolean).join(' '),
           r.tt ? `T/T: ${r.tt}` : ''
          ].filter(Boolean).join('　'),
        ])
      : [['POL（積み地）', cExcel.pol], ['POD（揚げ地）', cExcel.pod]];
    const condPairs = [
      ...routePairs,
      ['インコタームズ', cExcel.incoterms], ['輸送モード', cExcel.mode],
      ['コンテナ', cExcel.container], ['貨物名', cExcel.cargo],
    ].filter(([, v]) => v);
    if (condPairs.length) condPairs.forEach(([k, v]) => aoaRows.push([k, v]));
    if (aoaRows.length) aoaRows.push([]);

    // 列ヘッダ
    aoaRows.push(visCols.map(c => c.hdr));

    let totSub = 0, totJpyConv = 0, totTaxAmt = 0, totProfit = 0;
    let totTaxAmtJpy = 0, totProfitJpy = 0;
    let hasFxRows = false;
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
      const sub     = (d.bq || 0) * (d.bp || 0);
      const cost    = (d.pq || 0) * (d.pp || 0);
      const jpy     = typeof toJPY === 'function' ? Math.ceil(toJPY(sub, d.bc))  : sub;
      const costJpy = typeof toJPY === 'function' ? Math.ceil(toJPY(cost, d.pc)) : cost;
      const taxAmt  = (d.taxed && !d._actual) ? sub * getEffectiveTaxRate() : 0;
      if (!d._actual && !d._cond) {             // 実費・都度請求は合計に含めない
        totSub        += sub;
        totJpyConv    += jpy;
        totTaxAmt     += taxAmt;
        // 外貨建ては輸出免税が原則のため JPY 行のみ税計算
        totTaxAmtJpy  += (d.bc === 'JPY' && d.taxed) ? Math.ceil(jpy * getEffectiveTaxRate()) : 0;
        totProfit     += d.profit;
        totProfitJpy  += jpy - costJpy;
        if (d.bc && d.bc !== 'JPY') hasFxRows = true;
      }
      aoaRows.push(visCols.map(c => c.fn(d)));
    });
    // 合計行（外貨混在時は JPY 換算ベースで集計）
    aoaRows.push([]);
    const totalRow = visCols.map(() => '');
    totalRow[0] = hasFxRows ? '合　計（≈JPY換算）' : '合　計';
    if (idxSub     >= 0) totalRow[idxSub]     = hasFxRows ? totJpyConv              : totSub;
    if (idxJpyConv >= 0) totalRow[idxJpyConv] = hasFxRows ? totJpyConv              : '';
    if (idxTaxAmt  >= 0) totalRow[idxTaxAmt]  = hasFxRows ? totTaxAmtJpy            : totTaxAmt;
    if (idxProfit  >= 0) totalRow[idxProfit]  = hasFxRows ? Math.ceil(totProfitJpy) : totProfit;
    aoaRows.push(totalRow);

    // 通貨別内訳サマリー
    const ccySummary = _buildCcySummaryAoA(allRows, getEffectiveTaxRate());
    ccySummary.forEach(r => aoaRows.push(r));

    // 作業範囲
    const scopeTextXls = (document.getElementById('qf-scope')?.value || '').trim();
    if (scopeTextXls) {
      aoaRows.push([]);
      aoaRows.push(['【作業範囲】']);
      scopeTextXls.split('\n').forEach(line => { if (line.trim()) aoaRows.push([line]); });
    }
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
    // 列幅を実際のセル内容から動的計算（最小4・最大60文字）
    const colWidths = [];
    aoaRows.forEach(row => {
      if (!Array.isArray(row)) return;
      row.forEach((cell, ci) => {
        const len = cell == null ? 0 : String(cell).length;
        colWidths[ci] = Math.min(60, Math.max(colWidths[ci] || 4, len));
      });
    });
    ws['!cols'] = colWidths.map(w => ({ wch: w || 4 }));
    const wb   = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '見積もり');
    XLSX.writeFile(wb, buildFileName('xlsx'));
    quoteShowToast('📊 Excelファイルを出力しました', 'success');
  }

  // CSV列定義（key: collectData()の行データキー、hdr: ヘッダ文字列。sv を cat 直後に配置）
  const CSV_COL_DEFS = [
    { key: 'cat',    hdr: 'カテゴリ',       fn: d => d.cat },
    { key: 'sv',     hdr: 'サブコン',       fn: d => d.sv || '' },
    { key: 'name',   hdr: '項目名',         fn: d => d.name + (d._cond ? '（発生時のみ）' : '') },
    { key: 'pq',     hdr: '数量',           fn: d => fmtRaw(d.pq) },
    { key: 'un',     hdr: '単位',           fn: d => d.un || '' },
    { key: 'pc',     hdr: '通貨',           fn: d => d.pc },
    { key: 'pp',     hdr: '単価',           fn: d => d._actual ? '実費' : fmtRaw(d.pp) },
    { key: 'cd',     hdr: 'CD',             fn: d => d._actual ? '' : fmtRaw(d.cd) },
    { key: 'bq',     hdr: '数量(請求)',     fn: d => fmtRaw(d.bq) },
    { key: 'bc',     hdr: '通貨(請求)',     fn: d => d.bc },
    { key: 'bp',     hdr: '単価(請求)',     fn: d => d._actual ? '実費' : fmtRaw(d.bp) },
    { key: 'mk',     hdr: '乗せ幅',         fn: d => d._actual ? '' : fmtRaw(d.mk) },
    { key: 'sub',    hdr: '小計',           fn: d => d._actual ? '実費' : fmtRaw((d.bq||0)*(d.bp||0)) },
    { key: 'profit', hdr: '利益',           fn: d => d._actual ? '—' : fmtRaw(d.profit) },
    { key: 'note',   hdr: '備考',           fn: d => d.note },
  ];

  function downloadCSV() {
    const data = collectData();
    if (!data.length) { alert('行がありません。'); return; }
    if (!_pvBypassed && !preOutputValidationGate('CSV ダウンロード', downloadCSV)) return;
    _pvBypassed = false;
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

  // ========== プリセット比較 ==========

  function _extractPresetStats(presetData) {
    const data = migrateRowCells(presetData);
    const rows = (data.rows || []).filter(r => r._type === 'data');
    let totBillJpy = 0, totCostJpy = 0, totMk = 0, taxedBillJpy = 0;
    const byCategory = {};
    const rowItems = [];

    rows.forEach(r => {
      const cells = r.cells || [];
      // DOM 順: [0]=row-select-chk, [1]=cat, [2]=sv, [3]=tx, [4]=nm,
      //         [5]=pq, [6]=un, [7]=pc, [8]=pp, [9]=cd(ro),
      //         [10]=bq(ro), [11]=bc, [12]=bp(ro), [13]=mk, [14]=nt
      const cat   = cells[1] || '';
      const sv    = cells[2] || '';
      const taxed = !!cells[3];
      const name  = cells[4] || '';
      const pq    = parseFloat(cells[5]) || 0;
      const pc    = cells[7] || 'JPY';
      const pp    = parseFloat(cells[8]) || 0;
      const bq    = parseFloat(cells[10]) || 0;
      const bc    = cells[11] || 'JPY';
      const bp    = parseFloat(cells[12]) || 0;
      const mk    = parseFloat(cells[13]) || 0;

      const billOrig = bq * bp;
      const costOrig = pq * pp;
      const conv = (amt, ccy) =>
        (typeof toJPY === 'function') ? toJPY(amt, ccy) : (ccy === 'JPY' ? amt : 0);

      const billJpy = conv(billOrig, bc);
      const costJpy = conv(costOrig, pc);

      totBillJpy += billJpy;
      totCostJpy += costJpy;
      totMk      += conv(mk, bc);
      if (taxed) taxedBillJpy += billJpy;

      if (!byCategory[cat]) byCategory[cat] = 0;
      byCategory[cat] += billJpy;

      rowItems.push({ name, cat, sv, bc, billJpy, costJpy });
    });

    const totProfit  = totBillJpy - totCostJpy;
    const profitRate = SharedCalc.grossMarginPct(totBillJpy, totCostJpy); // 売上ベース粗利率（B）
    return { totBillJpy, totCostJpy, totProfit, totMk, profitRate, taxedBillJpy, byCategory, rowItems };
  }

  function openCompare() {
    const presets = getPresets();
    const listEl  = document.getElementById('cmpPresetList');
    const resultEl = document.getElementById('cmpResult');
    if (!listEl) return;

    if (!presets.length) {
      listEl.innerHTML = '<p class="cmp-empty-msg">保存済みプリセットがありません。先にプリセットを保存してください。</p>';
    } else {
      listEl.innerHTML = presets.map((p, i) =>
        `<label class="cmp-preset-item" id="cmpItem-${i}">
          <input type="checkbox" class="cmp-chk" value="${i}" onchange="toggleCmpItem(this)">
          ${escHtml(p.name || `プリセット ${i+1}`)}
        </label>`
      ).join('');
    }
    if (resultEl) resultEl.innerHTML = '';
    const printBtn = document.getElementById('cmpPrintBtn');
    if (printBtn) printBtn.style.display = 'none';
    document.getElementById('compareOverlay').classList.add('open');
  }

  function toggleCmpItem(chk) {
    const checked = document.querySelectorAll('.cmp-chk:checked');
    if (checked.length > 4) { chk.checked = false; return; }
    const label = chk.closest('label');
    if (label) label.classList.toggle('checked', chk.checked);
  }

  function closeCompare() {
    document.getElementById('compareOverlay').classList.remove('open');
  }

  function runCompare() {
    const presets  = getPresets();
    const selected = [...document.querySelectorAll('.cmp-chk:checked')].map(c => parseInt(c.value, 10));
    if (selected.length < 2) {
      alert('比較するプリセットを 2 件以上選択してください。');
      return;
    }

    const items = selected.map(i => ({
      name:  presets[i].name || `プリセット ${i+1}`,
      stats: _extractPresetStats(presets[i].data),
    }));

    const fmtJpy = n => Math.round(n).toLocaleString('ja-JP');
    const fmtPct = (n, bill) => bill > 0 ? n.toFixed(1) + '%' : '—';
    const profitStyle = n => n < 0 ? 'color:#c0392b;font-weight:700;' : 'color:#1a7a1a;font-weight:700;';
    const diffFmt = d => (d > 0 ? '+' : '') + fmtJpy(Math.round(d));
    const diffStyle = d => d > 0 ? 'color:#c0392b;' : d < 0 ? 'color:#1a7a1a;' : 'color:#aaa;';

    const is2 = items.length === 2;
    const colCount = items.length + (is2 ? 1 : 0); // +1 for diff column

    // サマリーテーブル
    const summaryHead = `<tr><th></th>${items.map(it => `<th>${escHtml(it.name)}</th>`).join('')}${is2 ? '<th>差分</th>' : ''}</tr>`;
    const sRow = (label, vals, dVal, cls = '') => {
      const diffCell = is2 ? `<td class="cmp-num" style="${diffStyle(dVal)}">${dVal !== 0 ? diffFmt(dVal) : '—'}</td>` : '';
      return `<tr class="${cls}"><td>${escHtml(label)}</td>${vals.map(v => `<td class="cmp-num">${v}</td>`).join('')}${diffCell}</tr>`;
    };

    const d = is2 ? (v => items[0].stats[v] - items[1].stats[v]) : () => 0;

    let html = `<table class="cmp-table"><thead>${summaryHead}</thead><tbody>`;
    html += `<tr class="cmp-row-section"><td colspan="${colCount+1}">■ 集計（全額 JPY 換算）</td></tr>`;
    html += sRow('売上合計 (JPY)', items.map(it => fmtJpy(it.stats.totBillJpy)), d('totBillJpy'));
    html += sRow('原価合計 (JPY)', items.map(it => fmtJpy(it.stats.totCostJpy)), d('totCostJpy'));
    html += `<tr><td>利益 (JPY)</td>${items.map(it =>
      `<td class="cmp-num" style="${profitStyle(it.stats.totProfit)}">${fmtJpy(it.stats.totProfit)}</td>`
    ).join('')}${is2 ? `<td class="cmp-num" style="${diffStyle(d('totProfit'))}">${d('totProfit') !== 0 ? diffFmt(d('totProfit')) : '—'}</td>` : ''}</tr>`;
    html += `<tr><td>利益率</td>${items.map(it =>
      `<td class="cmp-num" style="${profitStyle(it.stats.totProfit)}">${fmtPct(it.stats.profitRate, it.stats.totBillJpy)}</td>`
    ).join('')}${is2 ? `<td></td>` : ''}</tr>`;
    html += sRow('乗せ幅合計 (JPY)', items.map(it => fmtJpy(it.stats.totMk)), d('totMk'));
    html += `</tbody></table>`;

    // 2プリセット選択時: 行別差分テーブル
    if (is2) {
      const rowsA = items[0].stats.rowItems;
      const rowsB = items[1].stats.rowItems;
      const usedB = new Set();
      const pairs = [];
      rowsA.forEach(ra => {
        const bIdx = rowsB.findIndex((rb, i) => !usedB.has(i) && rb.name === ra.name && rb.cat === ra.cat);
        if (bIdx >= 0) { pairs.push({ a: ra, b: rowsB[bIdx] }); usedB.add(bIdx); }
        else pairs.push({ a: ra, b: null });
      });
      rowsB.forEach((rb, i) => { if (!usedB.has(i)) pairs.push({ a: null, b: rb }); });

      html += `<div class="cmp-section-head">■ 行別比較（売上 JPY換算）</div>
      <table class="cmp-detail-table">
        <thead><tr>
          <th>カテゴリ</th><th>項目名</th>
          <th>${escHtml(items[0].name)}</th>
          <th>${escHtml(items[1].name)}</th>
          <th>差分</th>
        </tr></thead><tbody>`;

      const allCats = new Set();
      items.forEach(it => Object.keys(it.stats.byCategory).forEach(c => allCats.add(c)));
      const catOrder = CATEGORIES.map(c => c.value).filter(v => v && allCats.has(v));
      [...allCats].forEach(c => { if (!catOrder.includes(c)) catOrder.push(c); });

      catOrder.forEach(cat => {
        const catPairs = pairs.filter(p => ((p.a || p.b).cat) === cat);
        if (!catPairs.length) return;
        html += `<tr class="cmp-detail-cat-head"><td colspan="5">${escHtml(getCatLabel(cat) || cat || '(未設定)')}</td></tr>`;
        catPairs.forEach(({ a, b }) => {
          const billA = a ? a.billJpy : null;
          const billB = b ? b.billJpy : null;
          const diff  = (billA ?? 0) - (billB ?? 0);
          const name  = (a || b).name;
          const onlyA = a && !b;
          const onlyB = !a && b;
          const rowCls = onlyA ? 'cmp-row-only-a' : onlyB ? 'cmp-row-only-b' : diff !== 0 ? 'cmp-row-changed' : '';
          const dText  = onlyA ? '(削除)' : onlyB ? '(追加)' : diff !== 0 ? diffFmt(diff) : '—';
          html += `<tr class="${rowCls}">
            <td></td>
            <td>${escHtml(name)}</td>
            <td class="cmp-num">${billA !== null ? fmtJpy(billA) : '—'}</td>
            <td class="cmp-num">${billB !== null ? fmtJpy(billB) : '—'}</td>
            <td class="cmp-num" style="${onlyA || onlyB ? '' : diffStyle(diff)}">${dText}</td>
          </tr>`;
        });
      });
      // カテゴリ未設定の行も含める
      pairs.filter(p => !((p.a || p.b).cat)).forEach(({ a, b }) => {
        const billA = a ? a.billJpy : null;
        const billB = b ? b.billJpy : null;
        const diff  = (billA ?? 0) - (billB ?? 0);
        const name  = (a || b).name;
        const onlyA = a && !b;
        const onlyB = !a && b;
        const rowCls = onlyA ? 'cmp-row-only-a' : onlyB ? 'cmp-row-only-b' : diff !== 0 ? 'cmp-row-changed' : '';
        const dText  = onlyA ? '(削除)' : onlyB ? '(追加)' : diff !== 0 ? diffFmt(diff) : '—';
        html += `<tr class="${rowCls}">
          <td>—</td>
          <td>${escHtml(name)}</td>
          <td class="cmp-num">${billA !== null ? fmtJpy(billA) : '—'}</td>
          <td class="cmp-num">${billB !== null ? fmtJpy(billB) : '—'}</td>
          <td class="cmp-num" style="${onlyA || onlyB ? '' : diffStyle(diff)}">${dText}</td>
        </tr>`;
      });

      const totDiff = Math.round(items[0].stats.totBillJpy - items[1].stats.totBillJpy);
      html += `</tbody><tfoot><tr>
        <td colspan="2" style="text-align:right;font-weight:700;">合計 (JPY)</td>
        <td class="cmp-num">${fmtJpy(items[0].stats.totBillJpy)}</td>
        <td class="cmp-num">${fmtJpy(items[1].stats.totBillJpy)}</td>
        <td class="cmp-num" style="${diffStyle(totDiff)}">${totDiff !== 0 ? diffFmt(totDiff) : '—'}</td>
      </tr></tfoot></table>`;
    } else {
      // 3-4プリセット: カテゴリ別内訳のみ
      const allCats = new Set();
      items.forEach(it => Object.keys(it.stats.byCategory).forEach(c => allCats.add(c)));
      const catOrder = CATEGORIES.map(c => c.value).filter(v => v && allCats.has(v));
      [...allCats].forEach(c => { if (!catOrder.includes(c)) catOrder.push(c); });
      if (catOrder.length) {
        html += `<table class="cmp-table"><thead>${`<tr><th></th>${items.map(it => `<th>${escHtml(it.name)}</th>`).join('')}</tr>`}</thead><tbody>`;
        html += `<tr class="cmp-row-section"><td colspan="${items.length+1}">■ カテゴリ別売上内訳 (JPY)</td></tr>`;
        catOrder.forEach(cat => {
          const label = getCatLabel(cat) || cat || '(未設定)';
          html += `<tr class="cmp-row-cat"><td>${escHtml(label)}</td>${items.map(it => `<td class="cmp-num">${fmtJpy(it.stats.byCategory[cat] || 0)}</td>`).join('')}</tr>`;
        });
        html += '</tbody></table>';
      }
    }

    const resultEl = document.getElementById('cmpResult');
    if (resultEl) resultEl.innerHTML = html;
    const printBtn = document.getElementById('cmpPrintBtn');
    if (printBtn) printBtn.style.display = '';
  }
