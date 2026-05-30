// ========== 引き合い条件・ゾーン (app-conditions.js) ==========

  // ========== 引き合い条件 ==========



  function clearConditions() {
    if (!confirm('貨物情報・引き合い条件をクリアしますか？')) return;
    ['z2Carrier','z2Pol','z2Pod','cond-origin','cond-dest','cond-cargo','cond-hs','cond-hs-basic','cond-hs-pref','cond-hs-pref-note',
     'cond-packing','cond-packing-preset','condFreeText',
     'cond-origin-country','cond-dest-country','z1Place','z1Country','z3Place','z3Country',
     'cond-container-count']
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    ['cond-incoterms','cond-mode','cond-container-type','cond-hazmat']
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    // コンテナ・荷姿・航路の複数エントリもクリア
    _containerEntries = [];
    _packingEntries = [];
    _routeEntries = [];
    if (typeof _renderContainerEntries === 'function') _renderContainerEntries();
    if (typeof _renderPackingEntries === 'function') _renderPackingEntries();
    if (typeof _renderRouteEntries === 'function') _renderRouteEntries();
    if (typeof syncHazmatPanel === 'function') syncHazmatPanel();
    const _crp = document.getElementById('calcResultsPanel');
    if (_crp) _crp.style.display = 'none';
  }

  function getConditions() {
    const g = id => document.getElementById(id)?.value.trim() || '';
    const _isFcl = _currentTransport !== 'air' && _currentSeaSub !== 'lcl';
    // コンテナ：複数エントリ対応（未登録なら単体エディタ値にフォールバック）
    let container = '';
    if (_isFcl) {
      if (_containerEntries.length) {
        container = _containerEntries.map(e => `${e.type} × ${e.count}`).join('、');
      } else {
        const ctype  = g('cond-container-type');
        const ccount = g('cond-container-count');
        container = ctype && ccount ? `${ctype} × ${ccount}` : (ctype || '');
      }
    }
    // 荷姿：明細（荷姿×個数）対応。未登録なら空
    const packing = _packingEntries.length
      ? _packingEntries.filter(e => e.pkg).map(e => `${e.pkg}×${e.qty||1}`).join('、')
      : '';
    // ゾーンビルダーから積み地・揚げ地・発地・仕向地を取得
    // 航路：複数登録があれば先頭航路を代表 POL/POD に（無ければ単体入力欄）
    const _r0 = (_routeEntries && _routeEntries.length) ? _routeEntries[0] : null;
    const pol    = _r0 ? _r0.pol : g('z2Pol');
    const pod    = _r0 ? _r0.pod : g('z2Pod');
    const z1p    = g('z1Place');   const z1c = g('z1Country');
    const z3p    = g('z3Place');   const z3c = g('z3Country');
    const origin = [z1p, z1c].filter(Boolean).join(', ');
    const dest   = [z3p, z3c].filter(Boolean).join(', ');
    return {
      pol, pod, origin, dest,
      incoterms: g('cond-incoterms'), mode: g('cond-mode'), container,
      cargo: g('cond-cargo'), hsCode: g('cond-hs'),
      hsBasic: g('cond-hs-basic'), hsPref: g('cond-hs-pref'), hsPrefNote: g('cond-hs-pref-note'),
      weight: (_lastCargoMetrics.kg > 0 ? `${_lastCargoMetrics.kg.toLocaleString()} kg` : ''),
      volume: (_lastCargoMetrics.cbm > 0 ? `${_lastCargoMetrics.cbm.toFixed(3)} CBM` : ''), packing: packing, hazmat: g('cond-hazmat'),
      free: g('condFreeText'),
      direction: _currentDirection || '',   // 'export' | 'import' | ''
    };
  }

  // ========== データ保存・読み込み（localStorage）==========
  // autoSaveTimer / autoSaveEnabled はapp-constants.jsで宣言済み

  function toggleAutoSave(on) {
    autoSaveEnabled = on;
    if (on) { saveData(true); showSaveStatus('自動保存 ON'); }
    else    { showSaveStatus('自動保存 OFF'); }
    localStorage.setItem('autoSaveEnabled', on ? '1' : '0');
  }

  function scheduleAutoSave() {
    if (!autoSaveEnabled) return;
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => saveData(true), 2000);
  }

  // ========== Undo / Redo（スナップショット履歴） ==========
  const _UNDO_MAX = 50;
  const _undoStack = [];
  const _redoStack = [];
  let   _lastSnapshot = null;     // 最後に確定したスナップショット（JSON 文字列）
  let   _snapshotTimer = null;
  let   _historyApplying = false; // applySnapshot 実行中はスナップショット採取を抑止

  function _currentSnapshot() {
    try {
      const data = gatherAllData();
      // 履歴比較から ts を除外（毎回更新されるので等価判定が常に false になる）
      delete data.ts;
      return JSON.stringify(data);
    } catch(_) { return null; }
  }

  // 現在の状態を確定スナップショットとして記録。前回と異なれば履歴に push。
  function snapshotNow() {
    if (_historyApplying) return;
    const cur = _currentSnapshot();
    if (cur === null) return;
    if (_lastSnapshot !== null && _lastSnapshot !== cur) {
      _undoStack.push(_lastSnapshot);
      if (_undoStack.length > _UNDO_MAX) _undoStack.shift();
      _redoStack.length = 0; // 新しい操作で redo はクリア
      _updateHistoryButtonsUI();
    }
    _lastSnapshot = cur;
  }

  function scheduleSnapshot() {
    if (_historyApplying) return;
    clearTimeout(_snapshotTimer);
    _snapshotTimer = setTimeout(snapshotNow, 500);
  }

  // チェックボックスを含む cells 配列を tr に適用するヘルパー
  function _applyCells(tr, cells) {
    tr.querySelectorAll('input, select, textarea').forEach((el, j) => {
      if (cells[j] === undefined) return;
      // 旧形式では checkbox 値が文字列 "on" で保存されていた。boolean true と "on" 両方を受け入れる
      if (el.type === 'checkbox') el.checked = cells[j] === true || cells[j] === 'on';
      else el.value = cells[j];
    });
  }

  // 行復元後の再計算・スタイル適用ヘルパー
  function _afterRestoreRows(trs, fields) {
    trs.forEach(tr => {
      const nm = tr.querySelector('[data-field="nm"]');
      if (!nm) return;
      const rowId = nm.id.replace('nm-', '');
      checkUnfilled(rowId);
      onCatChange(rowId);
      // onPay() は bc（請求通貨）を pc（仕入通貨）で上書きするため、
      // _applyCells で復元した bc を退避・復元して pc≠bc の設定を保持する
      const bcEl = tr.querySelector('[data-field="bc"]');
      const savedBc = bcEl?.value;
      onPay(parseInt(rowId));
      if (bcEl && savedBc !== undefined) {
        bcEl.value = savedBc;
        // pc≠bc のとき onPay が設定した bpEl.dataset.base（pc 建て pp）を
        // savedBc 建てに換算し直して bp 表示を正しく再計算する
        const pc = tr.querySelector('[data-field="pc"]')?.value;
        if (pc && savedBc && pc !== savedBc && typeof toJPY === 'function') {
          const bpEl = tr.querySelector('[data-field="bp"]');
          const ppVal = parseFloat(tr.querySelector('[data-field="pp"]')?.value) || 0;
          const mkVal = parseFloat(tr.querySelector('[data-field="mk"]')?.value) || 0;
          const ppJpy  = toJPY(ppVal, pc);
          const ppInBc = savedBc === 'JPY' ? ppJpy : ppJpy / toJPY(1, savedBc);
          if (bpEl) { bpEl.dataset.base = ppInBc; bpEl.value = ppInBc + mkVal; }
        }
        if (typeof calc === 'function') calc(parseInt(rowId));
      }
      // tx は _applyCells で positional に復元済み。fields ID は非連番になり得るため使わない
      const txEl = tr.querySelector('[data-field="tx"]');
      if (txEl?.checked) tr.classList.add('taxed');
      else tr.classList.remove('taxed');
    });
  }

  /**
   * JSON 読み込み後に JS 変数ベースの UI 状態（輸送モード・方向・ゾーン・保険）を
   * hidden input の値から復元してボタン・カードの表示を同期する。
   * fields は gatherAllData() で保存した fields オブジェクト。
   */
  function _restoreUiState(fields) {
    if (!fields) return;

    // 輸送モード（cond-mode の値から判定して setTransport を呼ぶ）
    const modeVal = (document.getElementById('cond-mode')?.value || '').trim();
    if      (modeVal === '海上（FCL）') setTransport('fcl');
    else if (modeVal === '海上（LCL）') setTransport('lcl');
    else if (modeVal.startsWith('航空')) setTransport('air');

    // 輸出/輸入方向
    const dir = fields['cond-direction'] || '';
    if (dir === 'export' || dir === 'import') setDirection(dir);

    // Zone 1 ON/OFF（現在値と異なる場合のみトグル）
    const wantZ1 = fields['cond-zone1-on'] === 'true' || fields['cond-zone1-on'] === true;
    if (wantZ1 !== _zone1On) toggleZone(1);

    // Zone 3 ON/OFF
    const wantZ3 = fields['cond-zone3-on'] === 'true' || fields['cond-zone3-on'] === true;
    if (wantZ3 !== _zone3On) toggleZone(3);

    // 保険付保（insuranceOn は constants.js スコープ変数）
    const wantIns = fields['cond-insurance-on'] === 'true' || fields['cond-insurance-on'] === true;
    if (wantIns !== insuranceOn) toggleInsurance();

    // ゾーン ON 後、チェック済みのピース行のサブコン欄を表示
    [['piece-pickup','sc-pickup'], ['piece-wh-origin','sc-wh-origin'], ['piece-customs-e','sc-customs-e'],
     ['piece-customs-i','sc-customs-i'], ['piece-wh-dest','sc-wh-dest'], ['piece-deliver','sc-deliver']
    ].forEach(([cbId, areaId]) => {
      const cb   = document.getElementById(cbId);
      const area = document.getElementById(areaId);
      if (cb && area) area.style.display = cb.checked ? 'flex' : 'none';
    });
  }

  /**
   * テーブルを再構築（通常行・小計行・リマーク行を順序通り復元）。
   * v3 形式の rows 配列を受け取り、各行をタイプに応じて挿入する。
   */
  function _rebuildTable(data) {
    document.getElementById('tableBody').innerHTML = '';
    rowCount = 0;
    const regularTrs = [];
    (data.rows || []).forEach(row => {
      const tbody = document.getElementById('tableBody');
      if (row && row._type === 'subtotal') {
        insertSubtotalRow(null);
        const tr = tbody.lastElementChild;
        const lbl = tr?.querySelector('.subtotal-label');
        if (lbl) lbl.value = row.label || '';
        return;
      }
      if (row && row._type === 'remark') {
        insertRemarkRow(null);
        const tr = tbody.lastElementChild;
        const inp = tr?.querySelector('.remark-row-input');
        if (inp) inp.value = row.text || '';
        return;
      }
      // 通常行（v3 オブジェクト or 旧配列）
      const cells = Array.isArray(row) ? row : (row?.cells || []);
      addRow();
      const tr = tbody.lastElementChild;
      _applyCells(tr, cells);
      regularTrs.push(tr);
    });
    _afterRestoreRows(regularTrs, data.fields);
  }

  // プリセット読み込み時に空値で上書きしないヘッダー項目
  const _HEADER_FIELD_IDS = ['qf-ref','qf-customer','qf-person','qf-date','qf-valid-until','qf-memo'];

  // データを画面に適用（restoreAutoSave と同等。トースト・restoreBar 操作なし）
  function _applyQuoteData(data, { keepHeaderIfEmpty = false } = {}) {
    if (!data) return;
    data = migrateRowCells(data);
    Object.entries(data.fields || {}).forEach(([id, val]) => {
      // ヘッダー項目（仮REF/顧客名/担当者等）はプリセット側が空でも現在値を消さない
      if (keepHeaderIfEmpty && _HEADER_FIELD_IDS.includes(id) && !val) return;
      const el = document.getElementById(id);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = val;
      else el.value = val;
    });
    _rebuildTable(data);
    _restoreUiState(data.fields);
    if (typeof updateTotals === 'function') updateTotals();
    if (typeof updateRouteModeIcon === 'function') updateRouteModeIcon();
    if (typeof syncHazmatPanel === 'function') syncHazmatPanel();
    if (typeof syncMultiEntryFields === 'function') syncMultiEntryFields();
    if (typeof window.updateSectionSummaries === 'function') window.updateSectionSummaries();
    if (typeof window.renderQuoteMilestones === 'function') window.renderQuoteMilestones();
  }

  function quoteUndo() {
    snapshotNow(); // 入力途中の保留分を確定
    if (!_undoStack.length) {
      quoteShowToast('ℹ️ これ以上戻せません', 'info', 1500);
      return;
    }
    const prev = _undoStack.pop();
    if (_lastSnapshot !== null) _redoStack.push(_lastSnapshot);
    if (_redoStack.length > _UNDO_MAX) _redoStack.shift();
    _historyApplying = true;
    try {
      const data = JSON.parse(prev);
      _applyQuoteData(data);
    } catch(e) { /* ignore */ }
    _lastSnapshot = prev;
    // DOM 変更で発火する mutation/input は無視するため、少し遅らせて解除
    setTimeout(() => { _historyApplying = false; }, 150);
    _updateHistoryButtonsUI();
    quoteShowToast('↶ 元に戻しました', 'info', 1200);
  }

  function quoteRedo() {
    if (!_redoStack.length) {
      quoteShowToast('ℹ️ やり直す変更がありません', 'info', 1500);
      return;
    }
    const next = _redoStack.pop();
    if (_lastSnapshot !== null) _undoStack.push(_lastSnapshot);
    if (_undoStack.length > _UNDO_MAX) _undoStack.shift();
    _historyApplying = true;
    try {
      const data = JSON.parse(next);
      _applyQuoteData(data);
    } catch(e) { /* ignore */ }
    _lastSnapshot = next;
    setTimeout(() => { _historyApplying = false; }, 150);
    _updateHistoryButtonsUI();
    quoteShowToast('↷ やり直しました', 'info', 1200);
  }

  function _updateHistoryButtonsUI() {
    const u = document.getElementById('btnQuoteUndo');
    const r = document.getElementById('btnQuoteRedo');
    if (u) u.disabled = _undoStack.length === 0;
    if (r) r.disabled = _redoStack.length === 0;
  }

  // 見積タブ表示時に初期化（initQuoteState から呼ぶ）
  function initQuoteHistory() {
    _undoStack.length = 0;
    _redoStack.length = 0;
    _lastSnapshot = _currentSnapshot();
    _updateHistoryButtonsUI();
    // input/change（タイピング・選択変更）に対するデバウンス収録
    const root = document.getElementById('tab-quote-make') || document;
    root.addEventListener('input',  scheduleSnapshot);
    root.addEventListener('change', scheduleSnapshot);
    // テーブル行の追加・削除・ドラッグ並び替え・ソートを検出
    const tbody = document.getElementById('tableBody');
    if (tbody && typeof MutationObserver !== 'undefined') {
      new MutationObserver(scheduleSnapshot).observe(tbody, { childList: true });
    }
  }

  function gatherAllData() {
    // フォーム値
    const fields = {};
    document.querySelectorAll('input[id], select[id], textarea[id]').forEach(el => {
      if (['csvFileInput','importFileInput','rowPatternImportFile','autoSaveChk','tabAddChk'].includes(el.id)) return;
      fields[el.id] = el.type === 'checkbox' ? el.checked : el.value;
    });
    // テーブル行（通常行 / 小計行 / リマーク行をすべて保存）
    const rows = [];
    document.querySelectorAll('#tableBody tr').forEach(tr => {
      if (tr.dataset.type === 'subtotal') {
        rows.push({ _type: 'subtotal', label: tr.querySelector('.subtotal-label')?.value || '' });
        return;
      }
      if (tr.dataset.type === 'remark') {
        rows.push({ _type: 'remark', text: tr.querySelector('.remark-row-input')?.value || '' });
        return;
      }
      const cells = [];
      tr.querySelectorAll('input, select, textarea').forEach(el =>
        cells.push(el.type === 'checkbox' ? el.checked : el.value)
      );
      rows.push({ _type: 'data', cells });
    });
    // _rowFormat: v3 = 小計行・リマーク行を含む型付きオブジェクト配列
    return { fields, rows, ts: new Date().toISOString(), _rowFormat: 'v3-mixed-rows' };
  }

  /**
   * 旧形式を v3 に変換。
   * v1: rows が配列の配列、sv が末尾（index 14）
   * v2: rows が配列の配列、sv が index 2
   * v3: rows が {_type, ...} オブジェクトの配列（小計・リマーク含む）
   */
  function migrateRowCells(data) {
    if (!data) return data;
    if (data._rowFormat === 'v3-mixed-rows') return data;
    if (!Array.isArray(data.rows)) return data;
    const isV2 = data._rowFormat === 'v2-sv-after-cat';
    data.rows = data.rows.map(row => {
      // 既にオブジェクト形式（部分的に v3 移行済み）
      if (row && typeof row === 'object' && !Array.isArray(row)) return row;
      let cells = Array.isArray(row) ? row.slice() : [];
      if (!isV2 && cells.length === 15) {
        // v1→v2: sv を末尾から index 2 へ
        const sv = cells[14];
        cells.splice(14, 1);
        cells.splice(2, 0, sv);
      }
      return { _type: 'data', cells };
    });
    data._rowFormat = 'v3-mixed-rows';
    return data;
  }

  function saveData(silent = false) {
    try {
      localStorage.setItem('quoteData', JSON.stringify(gatherAllData()));
      if (!silent) {
        showSaveStatus('✅ 保存しました ' + new Date().toLocaleTimeString('ja-JP', {hour:'2-digit',minute:'2-digit'}));
        quoteShowToast('💾 データを保存しました', 'success');
      }
    } catch(e) { showSaveStatus('⚠️ 保存失敗: ' + e.message); }
  }

  /** 自動保存データをページロード時に復元 */
  function restoreAutoSave() {
    const raw = localStorage.getItem('quoteData');
    if (!raw) return;
    let data;
    try { data = JSON.parse(raw); } catch(e) { return; }
    data = migrateRowCells(data);
    // フォーム復元
    Object.entries(data.fields || {}).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = val;
      else el.value = val;
    });
    // テーブル行復元（通常行・小計行・リマーク行を含む）
    _rebuildTable(data);
    _restoreUiState(data.fields);
    updateTotals();
    updateRouteModeIcon();
    if (typeof syncHazmatPanel === 'function') syncHazmatPanel();
    if (typeof syncMultiEntryFields === 'function') syncMultiEntryFields();
    if (typeof window.updateSectionSummaries === 'function') window.updateSectionSummaries();
    if (typeof window.renderQuoteMilestones === 'function') window.renderQuoteMilestones();
    dismissRestoreBar();
    const ts = data.ts ? new Date(data.ts).toLocaleString('ja-JP') : '';
    quoteShowToast('↩ 自動保存データを復元しました' + (ts ? '（' + ts + '）' : ''), 'success', 3500);
  }

  function dismissRestoreBar() {
    const bar = document.getElementById('autosave-restore-bar');
    if (bar) bar.classList.remove('show');
  }

  function loadData() {
    const raw = localStorage.getItem('quoteData');
    if (!raw) { alert('保存データが見つかりません。'); return; }
    let data;
    try { data = JSON.parse(raw); } catch(e) { alert('データの読み込みに失敗しました。'); return; }
    data = migrateRowCells(data);
    const ts = data.ts ? new Date(data.ts).toLocaleString('ja-JP') : '不明';
    if (!confirm(`保存日時: ${ts}\n\n現在のデータを上書きして読み込みますか？`)) return;
    // フォーム復元
    Object.entries(data.fields || {}).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = val;
      else el.value = val;
    });
    // テーブル行復元（通常行・小計行・リマーク行を含む）
    _rebuildTable(data);
    _restoreUiState(data.fields);
    updateTotals();
    updateRouteModeIcon();
    showSaveStatus('📂 読み込みました');
  }

  function clearSavedData() {
    if (!confirm('保存データを削除しますか？\n（現在の画面の内容は変わりません）')) return;
    localStorage.removeItem('quoteData');
    showSaveStatus('🗑️ 保存データ削除');
  }

  function showSaveStatus(msg) {
    const el = document.getElementById('saveStatus');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 3500);
  }

  // ========== ゾーン構成プリセット適用 ==========
  function _getFirstScValue(areaId) {
    const area = document.getElementById(areaId);
    if (!area) return '';
    return area.querySelector('.sc-input')?.value?.trim() || '';
  }

  function _buildZonePresetItems() {
    const items = [];

    // Zone ① 出発地側
    if (_zone1On) {
      const def1 = document.getElementById('z1DefaultSc')?.value?.trim() || '';
      if (document.getElementById('piece-pickup')?.checked) {
        items.push({ cat: 'domestic',  name: '国内集荷・陸送費',        note: '集荷先〜輸出港',       sv: _getFirstScValue('sc-pickup')    || def1 });
      }
      if (document.getElementById('piece-wh-origin')?.checked) {
        items.push({ cat: 'domestic',  name: '倉庫/梱包/バンニング費',  note: '輸出前作業',           sv: _getFirstScValue('sc-wh-origin')  || def1 });
      }
      if (document.getElementById('piece-customs-e')?.checked) {
        items.push({ cat: 'customs-export',   name: '輸出通関費',              note: '通関手数料・書類作成', sv: _getFirstScValue('sc-customs-e')  || def1 });
      }
      items.push({ cat: 'domestic',    name: '港湾諸費用（輸出）',      note: 'THC・ドキュメント費等', sv: '' });
    }

    // Zone ② 幹線輸送（常に追加）。複数航路が登録されていれば各航路ごとに行を生成
    const routes = (_routeEntries && _routeEntries.length) ? _routeEntries : [{
      carrier: document.getElementById('z2Carrier')?.value?.trim() || '',
      pol:     document.getElementById('z2Pol')?.value?.trim()     || '',
      pod:     document.getElementById('z2Pod')?.value?.trim()     || '',
    }];
    const multiRoute = routes.length > 1;
    routes.forEach((r, idx) => {
      const polpod = [r.pol, r.pod].filter(Boolean).join(' → ') || 'ポート〜ポート';
      const tag = multiRoute ? `【${r.carrier || '航路' + (idx + 1)}】 ` : '';
      items.push({ cat: 'ocean',     name: tag + '海上運賃',       note: polpod,           sv: r.carrier });
      items.push({ cat: 'surcharge', name: tag + 'サーチャージ類', note: 'BAF/CAF/PSS 等', sv: r.carrier });
    });

    // Zone ③ 到着地側
    if (_zone3On) {
      const def3 = document.getElementById('z3DefaultSc')?.value?.trim() || '';
      items.push({ cat: 'overseas',  name: '仕向港費用',              note: 'D/O・THC等',           sv: '' });
      if (document.getElementById('piece-customs-i')?.checked) {
        items.push({ cat: 'customs-import',   name: '輸入通関費',              note: '通関手数料・書類作成', sv: _getFirstScValue('sc-customs-i') || def3 });
      }
      if (document.getElementById('piece-wh-dest')?.checked) {
        items.push({ cat: 'overseas',  name: '倉庫/デバン費',           note: '輸入後作業',           sv: _getFirstScValue('sc-wh-dest')   || def3 });
      }
      if (document.getElementById('piece-deliver')?.checked) {
        items.push({ cat: 'domestic',  name: '国内配送費（着地）',      note: '港〜最終納入地',       sv: _getFirstScValue('sc-deliver')   || def3 });
      }
    }

    return items;
  }

  function applyZoneBasedPreset() {
    const items = _buildZonePresetItems();
    if (!items.length) {
      quoteShowToast('⚠️ プリセット項目がありません。ゾーン設定を確認してください。', 'warn');
      return;
    }

    const existing = document.querySelectorAll('#tableBody tr').length;
    if (existing > 0) {
      if (!confirm(`テーブルに ${existing} 行あります。末尾に ${items.length} 行を追記しますか？\n（置換したい場合は一旦リセットしてから再実行してください）`)) return;
    }

    let lastCur = 'JPY';
    const lastSelect = document.querySelector('#tableBody tr:last-child [id^="pc-"]');
    if (lastSelect) lastCur = lastSelect.value || 'JPY';

    const tbody = document.getElementById('tableBody');
    items.forEach(item => {
      rowCount++;
      const id = rowCount;
      const tr = document.createElement('tr');
      tr.id = 'row-' + id;
      tr.replaceChildren(buildRowHTML(id, item.cat, lastCur));
      tbody.appendChild(tr);
      const nmEl = document.getElementById('nm-'  + id); if (nmEl) nmEl.value = item.name;
      const ntEl = document.getElementById('nt-'  + id); if (ntEl) ntEl.value = item.note || '';
      const svEl = document.getElementById('sv-'  + id); if (svEl) svEl.value = item.sv   || '';
      if (typeof onCatChange === 'function') onCatChange(id);
      if (typeof onPay       === 'function') onPay(id);
      if (typeof initDrag    === 'function') initDrag(tr);
    });

    updateTotals();
    quoteShowToast('✅ ゾーン構成プリセット適用完了（' + items.length + '行）', 'success');
  }

  // ========== 方向・輸送モード プライマリセレクター ==========

  // 現在の選択状態を保持
  let _currentDirection = '';  // 'export' | 'import' | ''
  let _currentTransport = '';  // 'sea' | 'air' | ''
  let _currentSeaSub    = 'fcl'; // 'fcl' | 'lcl'

  // ---- スコープ拡張オプション状態 ----
  // ---- ゾーンビルダー状態 ----
  let _zone1On          = false; // Zone ① ON/OFF
  let _zone3On          = false; // Zone ③ ON/OFF
  let _whOriginOn       = false; // 🏬 出発地側 倉庫/梱包/バンニング
  let _whDestOn         = false; // 🏬 到着地側 倉庫/デバン
  // ---- 後方互換 (他関数が参照) ----
  let _pickupFromOrigin = false;
  let _deliverToDest    = false;
  let _packingService   = false; // 廃止（_whOriginOnに統合）
  let _customsExport    = false;
  let _customsImport    = false;

  // =========================================================
  // ゾーンビルダー関数群
  // =========================================================

  /** Zone ①/③ ON/OFF トグル */
  function _resetZonePieces(piecesId) {
    document.querySelectorAll('#' + piecesId + ' input[type=checkbox]').forEach(cb => {
      cb.checked = false;
      cb.disabled = true;
    });
    document.querySelectorAll('#' + piecesId + ' .piece-subcon-area').forEach(area => {
      area.style.display = 'none';
      const entries = area.querySelectorAll('.sc-entry');
      entries.forEach((e, i) => { if (i > 0) e.remove(); });
      const inp = area.querySelector('.sc-input');
      if (inp) { inp.value = ''; delete inp.dataset.auto; }
    });
    const dsc = document.querySelector('#' + piecesId + ' .zone-default-input');
    if (dsc) { dsc.value = ''; dsc.disabled = true; }
  }

  function toggleZone(n) {
    if (n === 1) {
      _zone1On = !_zone1On;
      const z1hidEl = document.getElementById('cond-zone1-on');
      if (z1hidEl) z1hidEl.value = _zone1On;
      const card = document.getElementById('zone1Card');
      const btn  = document.getElementById('zone1Btn');
      card?.classList.toggle('zone-off', !_zone1On);
      if (btn) {
        btn.textContent = _zone1On ? 'ON（有効）' : 'OFF（無効）';
        btn.title = _zone1On ? 'クリックすると出発地側ゾーンを無効にします' : 'クリックすると出発地側ゾーンを有効にします';
        btn.classList.toggle('on', _zone1On);
      }
      if (_zone1On) {
        document.querySelectorAll('#zone1Pieces input[type=checkbox]').forEach(cb => { cb.disabled = false; });
        const dsc1 = document.getElementById('z1DefaultSc');
        if (dsc1) dsc1.disabled = false;
        ['z1Place','z1Country'].forEach(id => { const el = document.getElementById(id); if (el) el.disabled = false; });
      } else {
        _resetZonePieces('zone1Pieces');
        ['z1Place','z1Country'].forEach(id => { const el = document.getElementById(id); if (el) el.disabled = true; });
      }
    } else if (n === 3) {
      _zone3On = !_zone3On;
      const z3hidEl = document.getElementById('cond-zone3-on');
      if (z3hidEl) z3hidEl.value = _zone3On;
      const card = document.getElementById('zone3Card');
      const btn  = document.getElementById('zone3Btn');
      card?.classList.toggle('zone-off', !_zone3On);
      if (btn) {
        btn.textContent = _zone3On ? 'ON（有効）' : 'OFF（無効）';
        btn.title = _zone3On ? 'クリックすると到着地側ゾーンを無効にします' : 'クリックすると到着地側ゾーンを有効にします';
        btn.classList.toggle('on', _zone3On);
      }
      if (_zone3On) {
        document.querySelectorAll('#zone3Pieces input[type=checkbox]').forEach(cb => { cb.disabled = false; });
        const dsc3 = document.getElementById('z3DefaultSc');
        if (dsc3) dsc3.disabled = false;
        ['z3Place','z3Country'].forEach(id => { const el = document.getElementById(id); if (el) el.disabled = false; });
      } else {
        _resetZonePieces('zone3Pieces');
        ['z3Place','z3Country'].forEach(id => { const el = document.getElementById(id); if (el) el.disabled = true; });
      }
    }
    applyZoneState();
    if (typeof window.renderQuoteMilestones === 'function') window.renderQuoteMilestones();
  }

  /** インコタームズ選択時のヒント表示（index.html の onchange="showIncotermsHint()" から呼ばれる） */
  function showIncotermsHint(val) {
    const el = document.getElementById('cond-incoterms-hint');
    if (!el) return;
    if (!val) { el.textContent = ''; el.style.display = 'none'; return; }
    const code = (val || '').replace(/（.*）$/, '').trim();
    const entry = (typeof INCO_DATA !== 'undefined') ? INCO_DATA.find(d => d.code === code) : null;
    if (entry) {
      el.textContent = entry.note;
      el.style.display = '';  // CSS の display:none を解除して表示
    } else {
      el.textContent = '';
      el.style.display = 'none';
    }
  }

  /** 危険品・特殊貨物 区分選択 → 追加入力パネル出し分け */
  function onHazmatChange(val) {
    const detail = document.getElementById('hazmatDetail');
    if (!detail) return;
    const panels = detail.querySelectorAll('.hazmat-panel');
    let matched = null;
    panels.forEach(p => {
      const on = (p.dataset.hazmatPanel === val);
      p.hidden = !on;
      if (on) matched = p;
    });
    // 一般貨物 or 未選択 → パネル全体を隠す
    detail.hidden = !matched;
    // パネル種別で配色を切替
    detail.classList.toggle('is-cold',  val === '温度管理品（冷蔵）' || val === '温度管理品（冷凍）');
    detail.classList.toggle('is-heavy', val === '重量物・大型貨物');
    detail.classList.toggle('is-other', val === 'その他（特記事項参照）');
  }

  /** 起動時・データ復元後に危険品パネルの表示状態を同期 */
  function syncHazmatPanel() {
    const sel = document.getElementById('cond-hazmat');
    if (sel) onHazmatChange(sel.value);
  }

  // ========== コンテナ／荷姿 複数エントリ管理 ==========
  // 「入力 → 追加 → 行追加」を繰り返して複数のコンテナ種類・荷姿を登録できる
  let _containerEntries = [];   // [{ type:"20'GP", count:2 }, ...]
  let _packingEntries   = [];   // ["カートン", "パレット", ...]

  function _renderContainerEntries() {
    const list = document.getElementById('containerEntryList');
    const data = document.getElementById('cond-container-data');
    if (data) data.value = JSON.stringify(_containerEntries);
    if (!list) return;
    if (!_containerEntries.length) {
      list.innerHTML = '<span class="me-empty">未登録 — 種類と本数を選んで「＋ 追加」（複数サイズ可）</span>';
      return;
    }
    list.innerHTML = _containerEntries.map((e, i) =>
      `<span class="me-chip"><span class="me-chip-text">${_escMulti(e.type)} <b>× ${e.count}</b></span>`
      + `<button type="button" class="me-chip-del" onclick="removeContainerEntry(${i})" title="削除">×</button></span>`
    ).join('');
  }

  function addContainerEntry() {
    const tEl = document.getElementById('cond-container-type');
    const cEl = document.getElementById('cond-container-count');
    const type = (tEl?.value || '').trim();
    const count = parseInt(cEl?.value, 10) || 1;
    if (!type) { if (typeof quoteShowToast==='function') quoteShowToast('⚠️ コンテナ種類を選択してください', 'warn', 1800); tEl?.focus(); return; }
    const existing = _containerEntries.find(e => e.type === type);
    if (existing) existing.count += count;
    else _containerEntries.push({ type, count });
    _renderContainerEntries();
    if (typeof window.renderQuoteCargoInfo === 'function') window.renderQuoteCargoInfo();
    // エディタをリセット（次の入力へ）
    if (tEl) tEl.value = '';
    if (cEl) cEl.value = '1';
    tEl?.focus();
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
    if (typeof scheduleSnapshot === 'function') scheduleSnapshot();
  }

  function removeContainerEntry(i) {
    _containerEntries.splice(i, 1);
    _renderContainerEntries();
    if (typeof window.renderQuoteCargoInfo === 'function') window.renderQuoteCargoInfo();
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
    if (typeof scheduleSnapshot === 'function') scheduleSnapshot();
  }

  function _renderPackingEntries() {
    const body = document.getElementById('cargoDetailBody');
    const data = document.getElementById('cond-packing-data');
    if (data) data.value = JSON.stringify(_packingEntries);
    // datalist（荷姿候補）を用意
    const dl = document.getElementById('packingOptions');
    if (dl && !dl.dataset.filled) {
      const list = (typeof window.getPackingList === 'function')
        ? window.getPackingList()
        : ['カートン','パレット','ドラム缶','袋（バッグ）','木箱','バルク'];
      dl.innerHTML = list.map(p => `<option value="${_escMulti(p)}"></option>`).join('');
      dl.dataset.filled = '1';
    }
    if (!body) return;
    if (!_packingEntries.length) {
      body.innerHTML = '<tr class="cargo-detail-empty"><td colspan="9">「＋ 荷姿を追加」で明細を登録（荷姿ごとに個数・サイズ・重量・段積みを管理）</td></tr>';
      _updatePackingTotals();
      return;
    }
    body.innerHTML = _packingEntries.map((e, i) => {
      const cbm = _rowCbm(e);
      return `<tr>
        <td class="cd-pkg"><input type="text" list="packingOptions" value="${_escMulti(e.pkg||'')}" placeholder="カートン等" oninput="updatePackingRow(${i},'pkg',this.value)" /></td>
        <td class="cd-qty"><input type="number" min="0" step="1" value="${e.qty??1}" oninput="updatePackingRow(${i},'qty',this.value)" /></td>
        <td class="cd-dim"><input type="number" min="0" step="0.1" value="${e.l||''}" placeholder="0" oninput="updatePackingRow(${i},'l',this.value)" /></td>
        <td class="cd-dim"><input type="number" min="0" step="0.1" value="${e.w||''}" placeholder="0" oninput="updatePackingRow(${i},'w',this.value)" /></td>
        <td class="cd-dim"><input type="number" min="0" step="0.1" value="${e.h||''}" placeholder="0" oninput="updatePackingRow(${i},'h',this.value)" /></td>
        <td class="cd-cbm" id="cdCbm-${i}">${cbm.toFixed(3)}</td>
        <td class="cd-kg"><input type="number" min="0" step="0.1" value="${e.kg||''}" placeholder="0" oninput="updatePackingRow(${i},'kg',this.value)" /></td>
        <td class="cd-stack">
          <select onchange="updatePackingRow(${i},'stack',this.value)">
            <option value="可"${e.stack==='可'?' selected':''}>可</option>
            <option value="不可"${e.stack==='不可'?' selected':''}>不可</option>
          </select>
        </td>
        <td class="cd-del"><button type="button" class="me-chip-del" onclick="removePackingRow(${i})" title="この行を削除">×</button></td>
      </tr>`;
    }).join('');
    _updatePackingTotals();
  }

  function _rowCbm(e) {
    const l = parseFloat(e.l) || 0, w = parseFloat(e.w) || 0, h = parseFloat(e.h) || 0;
    const q = parseInt(e.qty, 10) || 0;
    return (l * w * h / 1000000) * q; // cm³ → m³
  }

  function _updatePackingTotals() {
    let totQty = 0, totCbm = 0, totKg = 0, totVolWt = 0;
    _packingEntries.forEach(e => {
      const q = parseInt(e.qty, 10) || 0;
      totQty += q;
      totCbm += _rowCbm(e);
      totKg  += (parseFloat(e.kg) || 0) * q;   // 重量は1個あたり × 個数
      // 容積重量(kg) = 長さ×幅×高さ(cm) ÷ 6000 × 個数（航空 CW 用）
      const l = parseFloat(e.l) || 0, w = parseFloat(e.w) || 0, h = parseFloat(e.h) || 0;
      totVolWt += (l * w * h / 6000) * q;
    });
    // R/T = max(CBM, 重量t)  ／  CW = max(実重量, 容積重量)
    const rt = Math.max(totCbm, totKg / 1000);
    const cw = Math.max(totKg, totVolWt);

    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setText('cdTotQty', totQty.toLocaleString());
    setText('cdTotCbm', totCbm > 0 ? totCbm.toFixed(3) + ' CBM' : '0.000');
    setText('cdTotKg',  totKg > 0 ? totKg.toLocaleString() + ' kg' : '0');
    setText('cdTotRt',  rt.toFixed(3));
    setText('cdTotCw',  Math.round(cw).toLocaleString());

    // 重量・容積（概算）欄は廃止。明細合計を直接保持してプレビュー等で参照
    // hidden に R/T・CW も保持（プレビュー等で参照可能に）
    _lastCargoMetrics = { cbm: totCbm, kg: totKg, rt, cw, qty: totQty };
    if (typeof window.renderQuoteCargoInfo === 'function') window.renderQuoteCargoInfo();
  }
  let _lastCargoMetrics = { cbm: 0, kg: 0, rt: 0, cw: 0, qty: 0 };
  // 物量情報を見積サマリ等から参照できるよう公開
  window.getCargoMetrics = function () {
    return Object.assign({}, _lastCargoMetrics, {
      container: (_containerEntries && _containerEntries.length)
        ? _containerEntries.map(e => `${e.type}×${e.count}`).join('・') : '',
      packingCount: (_packingEntries && _packingEntries.length)
        ? _packingEntries.filter(e => e.pkg).length : 0,
    });
  };

  function updatePackingRow(i, key, val) {
    if (!_packingEntries[i]) return;
    _packingEntries[i][key] = val;
    if (document.getElementById('cond-packing-data')) {
      document.getElementById('cond-packing-data').value = JSON.stringify(_packingEntries);
    }
    // CBM セルとフッターのみ更新（フォーカスを維持するため全再描画しない）
    if (['qty','l','w','h'].includes(key)) {
      const cell = document.getElementById('cdCbm-' + i);
      if (cell) cell.textContent = _rowCbm(_packingEntries[i]).toFixed(3);
    }
    _updatePackingTotals();
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
    if (typeof scheduleSnapshot === 'function') scheduleSnapshot();
  }

  function addPackingRow() {
    _packingEntries.push({ pkg:'', qty:1, l:'', w:'', h:'', kg:'', stack:'可' });
    _renderPackingEntries();
    // 追加した行の荷姿入力にフォーカス
    const body = document.getElementById('cargoDetailBody');
    const last = body?.querySelector('tr:last-child .cd-pkg input');
    last?.focus();
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
    if (typeof scheduleSnapshot === 'function') scheduleSnapshot();
  }

  function removePackingRow(i) {
    _packingEntries.splice(i, 1);
    _renderPackingEntries();
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
    if (typeof scheduleSnapshot === 'function') scheduleSnapshot();
  }

  // hidden input（cond-container-data / cond-packing-data）から配列を復元して再描画
  function syncMultiEntryFields() {
    const cData = document.getElementById('cond-container-data');
    try { _containerEntries = (cData && cData.value) ? JSON.parse(cData.value) : []; }
    catch(e) { _containerEntries = []; }
    if (!Array.isArray(_containerEntries)) _containerEntries = [];
    const pData = document.getElementById('cond-packing-data');
    try { _packingEntries = (pData && pData.value) ? JSON.parse(pData.value) : []; }
    catch(e) { _packingEntries = []; }
    if (!Array.isArray(_packingEntries)) _packingEntries = [];
    // 旧形式（文字列配列）→ 明細オブジェクトへ移行
    _packingEntries = _packingEntries.map(e =>
      (typeof e === 'string') ? { pkg: e, qty: 1, l:'', w:'', h:'', kg:'', stack:'可' } : e
    );
    _renderContainerEntries();
    _renderPackingEntries();
    syncRouteEntries();
    if (typeof window.renderQuoteCargoInfo === 'function') window.renderQuoteCargoInfo();
  }

  // ========== 幹線輸送：複数船会社・複数POL/POD 航路 ==========
  let _routeEntries = [];   // [{ carrier, pol, pod }, ...]

  function _renderRouteEntries() {
    const data = document.getElementById('z2-routes-data');
    if (data) data.value = JSON.stringify(_routeEntries);
    const list = document.getElementById('z2RouteList');
    if (!list) return;
    if (!_routeEntries.length) { list.innerHTML = ''; return; }
    list.innerHTML = _routeEntries.map((r, i) => {
      const route = [r.pol, r.pod].filter(Boolean).join(' → ') || 'ポート未設定';
      return `<span class="z2-route-chip">`
        + `<span class="z2-route-carrier">${_escMulti(r.carrier || '—')}</span>`
        + `<span class="z2-route-leg">${_escMulti(route)}</span>`
        + `<button type="button" class="me-chip-del" onclick="removeRouteEntry(${i})" title="削除">×</button></span>`;
    }).join('');
    if (typeof window.renderQuoteCarrierLinks === 'function') window.renderQuoteCarrierLinks();
  }

  function addRouteEntry() {
    const carrier = (document.getElementById('z2Carrier')?.value || '').trim();
    const pol = (document.getElementById('z2Pol')?.value || '').trim();
    const pod = (document.getElementById('z2Pod')?.value || '').trim();
    if (!carrier && !pol && !pod) {
      if (typeof quoteShowToast==='function') quoteShowToast('⚠️ キャリアまたはPOL/PODを入力してください', 'warn', 1800);
      return;
    }
    _routeEntries.push({ carrier, pol, pod });
    _renderRouteEntries();
    // エディタをクリアして次の航路入力へ
    ['z2Carrier','z2Pol','z2Pod'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    if (typeof onZ2CarrierChange === 'function') onZ2CarrierChange();
    document.getElementById('z2Carrier')?.focus();
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
    if (typeof scheduleSnapshot === 'function') scheduleSnapshot();
  }

  function removeRouteEntry(i) {
    _routeEntries.splice(i, 1);
    _renderRouteEntries();
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
    if (typeof scheduleSnapshot === 'function') scheduleSnapshot();
  }
  // 復元用
  function syncRouteEntries() {
    const data = document.getElementById('z2-routes-data');
    try { _routeEntries = (data && data.value) ? JSON.parse(data.value) : []; }
    catch(e) { _routeEntries = []; }
    if (!Array.isArray(_routeEntries)) _routeEntries = [];
    _renderRouteEntries();
  }

  function _escMulti(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /** ゾーンカードのピース状態を読み取り、ルート図に反映 */
  function applyZoneState() {
    const z1 = _zone1On;
    const z3 = _zone3On;

    _pickupFromOrigin = z1 && !!(document.getElementById('piece-pickup')?.checked);
    _whOriginOn       = z1 && !!(document.getElementById('piece-wh-origin')?.checked);
    _customsExport    = z1 && !!(document.getElementById('piece-customs-e')?.checked);

    _customsImport    = z3 && !!(document.getElementById('piece-customs-i')?.checked);
    _whDestOn         = z3 && !!(document.getElementById('piece-wh-dest')?.checked);
    _deliverToDest    = z3 && !!(document.getElementById('piece-deliver')?.checked);
  }

  /** ピースチェック時にサブコン入力欄を表示/非表示 */
  function onPieceCheck(cb, areaId) {
    const area = document.getElementById(areaId);
    if (!area) return;
    area.style.display = cb.checked ? 'flex' : 'none';
    if (cb.checked) {
      const piecesParent = cb.closest('.zone-pieces');
      if (piecesParent) {
        const defVal = piecesParent.querySelector('.zone-default-input')?.value?.trim() || '';
        const inp = area.querySelector('.sc-input');
        if (inp && !inp.value && defVal) { inp.value = defVal; inp.dataset.auto = '1'; }
      }
    } else {
      const entries = area.querySelectorAll('.sc-entry');
      entries.forEach((e, i) => { if (i > 0) e.remove(); });
      const inp = area.querySelector('.sc-input');
      if (inp) { inp.value = ''; delete inp.dataset.auto; }
    }
  }

  /** サブコン行を追加（＋ボタン） */
  function addScEntry(areaId) {
    const area = document.getElementById(areaId);
    if (!area) return;
    const entry = document.createElement('div');
    entry.className = 'sc-entry';
    entry.innerHTML =
      '<input type="text" class="sc-input" placeholder="サブコン">' +
      '<button class="sc-del-btn" type="button" onclick="this.parentElement.remove()">－</button>';
    area.appendChild(entry);
    entry.querySelector('.sc-input').focus();
  }

  function onZonePiecesInput(e, zone) {
    if (e.target.classList.contains('sc-input')) delete e.target.dataset.auto;
  }

  function applyDefaultSubcon(zone, val) {
    const piecesId = zone === 1 ? 'zone1Pieces' : 'zone3Pieces';
    document.querySelectorAll('#' + piecesId + ' .piece-subcon-area').forEach(area => {
      const inp = area.querySelector('.sc-input');
      if (!inp) return;
      if (!inp.dataset.auto || inp.dataset.auto === '1') {
        inp.value = val;
        inp.dataset.auto = val ? '1' : '';
      }
    });
    if (typeof window.renderQuoteMilestones === 'function') window.renderQuoteMilestones();
  }

  /** 方向・輸送モードに応じてゾーンカードのラベルを更新 */
  function _applyZoneLabels() {
    const dir = _currentDirection;
    const isExport = (dir === 'export');
    document.getElementById('zone1Subcon').textContent = isExport ? '日本協力会社' : '現地代理店';
    document.getElementById('zone3Subcon').textContent = isExport ? '現地代理店'   : '日本協力会社';
  }

  /** 輸出/輸入トグル */
  function setDirection(dir) {
    _currentDirection = dir;
    const dirEl = document.getElementById('cond-direction');
    if (dirEl) dirEl.value = dir;
    document.querySelectorAll('#dirBtns .cond-prim-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.dir === dir)
    );
    _applyZoneLabels();
    applyZoneState();
    if (typeof window.renderQuoteMilestones === 'function') window.renderQuoteMilestones();
  }

  // 輸送モード状態を外部へ公開（マイルストーン表示用）
  window.getTransportState = function () {
    return {
      transport: _currentTransport, seaSub: _currentSeaSub, direction: _currentDirection,
      zone1On: _zone1On, zone3On: _zone3On,
    };
  };

  /** バンニングシミュレーション（計算タブ）へジャンプ */
  function openBanningCalc() {
    const calcTab = document.querySelector('[data-tab="calc"]');
    if (calcTab) calcTab.click();
    setTimeout(() => {
      const el = document.getElementById('van-rows-wrap');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 200);
  }

  /** Sea / Air プライマリトグル */
  function setTransport(transport) {
    // transport: 'fcl' | 'lcl' | 'air'
    if (transport === 'fcl' || transport === 'lcl') {
      _currentTransport = 'sea';
      _currentSeaSub = transport;
    } else {
      _currentTransport = 'air';
    }
    document.querySelectorAll('#seaAirBtns .cond-prim-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.transport === transport)
    );
    // cond-mode select を同期して updateRouteModeIcon を呼ぶ
    _syncModeSelect();
    updateRouteModeIcon();
    _applyZoneLabels();
    _refreshCarrierDatalist();
    if (typeof applyCargoFieldOrder === 'function') applyCargoFieldOrder();
    if (typeof window.renderQuoteMilestones === 'function') window.renderQuoteMilestones();
  }

  /** FCL / LCL サブトグル（後方互換用：内部状態のみ更新） */
  function setSeaSub(sub) {
    _currentSeaSub = sub;
    _syncModeSelect();
    updateRouteModeIcon();
    _applyZoneLabels();
    _refreshCarrierDatalist();
    if (typeof applyCargoFieldOrder === 'function') applyCargoFieldOrder();
    if (typeof window.renderQuoteMilestones === 'function') window.renderQuoteMilestones();
  }

  /** ボタン状態を内部 cond-mode select に同期 */
  function _syncModeSelect() {
    const sel = document.getElementById('cond-mode');
    if (!sel) return;
    if (_currentTransport === 'sea') {
      sel.value = _currentSeaSub === 'lcl' ? '海上（LCL）' : '海上（FCL）';
    } else if (_currentTransport === 'air') {
      sel.value = '航空（AIR）';
    } else {
      sel.value = '';
    }
  }

  /** 現在の輸送モードに対応するキャリアマップを返す */
  function _carrierMapForMode() {
    if (_currentTransport === 'air') return (typeof CARRIERS_AIR !== 'undefined') ? CARRIERS_AIR : {};
    if (_currentSeaSub === 'lcl')    return (typeof CARRIERS_LCL !== 'undefined') ? CARRIERS_LCL : {};
    return (typeof CARRIERS !== 'undefined') ? CARRIERS : {};
  }

  /** 現在の輸送モードに対応するリンク定義を返す */
  function _linkDefsForMode() {
    const defs = (typeof CARRIER_LINK_DEFS !== 'undefined') ? CARRIER_LINK_DEFS : {};
    if (_currentTransport === 'air') return defs.air || [];
    if (_currentSeaSub === 'lcl')    return defs.lcl || [];
    return defs.fcl || [];
  }

  /** URL 値を解決する（関数 or 文字列 or null） */
  function _resolveCarrierUrl(v) {
    if (!v) return null;
    return typeof v === 'function' ? v() : v;
  }

  /** carriers-dl datalist をモードに合わせて再生成 */
  function _refreshCarrierDatalist() {
    const dl = document.getElementById('carriers-dl');
    if (!dl) return;
    const map = _carrierMapForMode();
    dl.innerHTML = Object.keys(map).map(k => `<option value="${k}">`).join('');

    // z2 アイコン・プレースホルダーもモードに合わせて更新
    const icon  = document.getElementById('z2ModeIcon');
    const input = document.getElementById('z2Carrier');
    if (_currentTransport === 'air') {
      if (icon)  icon.textContent  = '✈️';
      if (input) input.placeholder = '航空会社名（例：JAL Cargo）';
    } else if (_currentSeaSub === 'lcl') {
      if (icon)  icon.textContent  = '🚢';
      if (input) input.placeholder = 'NVOCC名（例：近鉄エクスプレス）';
    } else {
      if (icon)  icon.textContent  = '🚢';
      if (input) input.placeholder = 'キャリア名（例：ONE）';
    }

    // 入力値がリセット後の候補と一致しなければパネルを閉じる
    onZ2CarrierChange();
  }

  /** z2Carrier 入力時：一致するキャリアのリンクパネルを表示 */
  function onZ2CarrierChange() {
    const panel = document.getElementById('z2CarrierLinks');
    const done = () => {
      if (typeof window.renderQuoteCarrierLinks === 'function') window.renderQuoteCarrierLinks();
      if (typeof window.renderQuoteMilestones === 'function') window.renderQuoteMilestones();
    };
    if (!panel) { done(); return; }
    const val  = (document.getElementById('z2Carrier')?.value || '').trim();
    const map  = _carrierMapForMode();
    const defs = _linkDefsForMode();
    const c    = map[val];
    if (!c) { panel.style.display = 'none'; panel.innerHTML = ''; done(); return; }

    const links = defs
      .map(d => ({
        label: d.label,
        url:   _resolveCarrierUrl(c[d.key]),
        title: (d.noteKey && c[d.noteKey]) ? c[d.noteKey] : d.label,
      }))
      .filter(l => l.url);

    if (!links.length) { panel.style.display = 'none'; panel.innerHTML = ''; done(); return; }

    const icon = c.icon || '';
    panel.innerHTML =
      `<span class="carrier-links-name">${icon} ${val}</span>` +
      links.map(l =>
        `<a class="carrier-link-chip" href="${l.url}" target="_blank" rel="noopener" title="${l.title}">${l.label}</a>`
      ).join('');
    panel.style.display = 'flex';
    done();
  }

  // 幹線輸送（z2）の選択キャリアごとのリンク情報を返す共通ヘルパー
  // （登録航路＋現在の入力欄のキャリアを対象）。マイルストーン表示などで利用。
  window.getCarrierLinkData = function () {
    const map  = _carrierMapForMode();
    const defs = _linkDefsForMode();
    const names = [];
    if (_routeEntries && _routeEntries.length) {
      _routeEntries.forEach(r => { if (r.carrier && !names.includes(r.carrier)) names.push(r.carrier); });
    }
    const cur = (document.getElementById('z2Carrier')?.value || '').trim();
    if (cur && !names.includes(cur)) names.push(cur);
    return names.map(name => {
      const c = map[name];
      if (!c) return { name, icon: '', links: [] };
      const links = defs
        .map(d => ({ label: d.label, url: _resolveCarrierUrl(c[d.key]), title: (d.noteKey && c[d.noteKey]) ? c[d.noteKey] : d.label }))
        .filter(l => l.url);
      return { name, icon: c.icon || '', links };
    });
  };

  // 選択中の全キャリアのリンクはマイルストーンの「幹線輸送」モジュール内に
  // 統合表示するようになったため、独立パネルは非表示にする（重複回避）。
  window.renderQuoteCarrierLinks = function () {
    const el = document.getElementById('qspCarrierLinks');
    if (!el) return;
    el.style.display = 'none';
    el.innerHTML = '';
  };
  window._renderQuoteCarrierLinksLegacy = function () {
    const el = document.getElementById('qspCarrierLinks');
    if (!el) return;
    const map  = _carrierMapForMode();
    const defs = _linkDefsForMode();
    // 対象キャリア名を収集（航路登録分を優先、無ければ入力欄）
    const names = [];
    if (_routeEntries && _routeEntries.length) {
      _routeEntries.forEach(r => { if (r.carrier && !names.includes(r.carrier)) names.push(r.carrier); });
    }
    const cur = (document.getElementById('z2Carrier')?.value || '').trim();
    if (cur && !names.includes(cur)) names.push(cur);

    const blocks = names.map(name => {
      const c = map[name];
      if (!c) return '';
      const links = defs
        .map(d => ({ label: d.label, url: _resolveCarrierUrl(c[d.key]), title: (d.noteKey && c[d.noteKey]) ? c[d.noteKey] : d.label }))
        .filter(l => l.url);
      if (!links.length) return '';
      return `<div class="qsp-cl-block">`
        + `<div class="qsp-cl-name">${c.icon || '🚢'} ${name}</div>`
        + `<div class="qsp-cl-chips">`
        + links.map(l => `<a class="qsp-cl-chip" href="${l.url}" target="_blank" rel="noopener" title="${l.title}">${l.label}</a>`).join('')
        + `</div></div>`;
    }).filter(Boolean);

    if (!blocks.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = 'block';
    el.innerHTML = '<div class="qsp-section-label">🚢 船会社リンク</div>' + blocks.join('');
  };

