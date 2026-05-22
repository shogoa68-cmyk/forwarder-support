// ========== 引き合い条件・ゾーン (app-conditions.js) ==========

  // ========== 引き合い条件 ==========



  function clearConditions() {
    if (!confirm('貨物情報・引き合い条件をクリアしますか？')) return;
    // condFreeText（特記事項）は意図的にクリア対象から除外
    ['cond-pol','cond-pod','cond-origin','cond-dest','cond-cargo',
     'cond-weight','cond-volume','cond-packing','cond-packing-preset',
     'condRawInquiry',
     'cond-origin-country','cond-dest-country',
     'z1Place','z1Country','z2Pol','z2Pod','z2Carrier','z3Place','z3Country',
     'cond-container-count']
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    ['cond-incoterms','cond-mode','cond-container-type','cond-hazmat']
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    if (typeof showIncotermsHint === 'function') showIncotermsHint('');
    // JS 状態変数リセット（消費税判定の誤引継ぎを防ぐ）
    _currentDirection = '';
    _currentTransport = '';
    _currentSeaSub = 'fcl';
    // 方向・輸送ボタンの active 解除
    document.querySelectorAll('.cond-prim-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.cond-sub-btn').forEach(b => b.classList.remove('active'));
    // FCL は既定モードなので active を戻す
    document.querySelector('.cond-sub-btn[data-sub="fcl"]')?.classList.add('active');
    // キャリアリンクパネルを更新
    if (typeof onZ2CarrierChange === 'function') onZ2CarrierChange();
    // calcResultsPanel の安全な非表示
    const _panel = document.getElementById('calcResultsPanel');
    if (_panel) _panel.style.display = 'none';
  }

  function getConditions() {
    const g = id => document.getElementById(id)?.value.trim() || '';
    const _isFcl = _currentTransport !== 'air' && _currentSeaSub !== 'lcl';
    const ctype  = _isFcl ? g('cond-container-type') : '';
    const ccount = _isFcl ? g('cond-container-count') : '';
    const container = ctype && ccount ? `${ctype} × ${ccount}` : (ctype || '');
    // ゾーンビルダーから積み地・揚げ地・発地・仕向地を取得
    const pol    = g('z2Pol');
    const pod    = g('z2Pod');
    const z1p    = g('z1Place');   const z1c = g('z1Country');
    const z3p    = g('z3Place');   const z3c = g('z3Country');
    const origin = [z1p, z1c].filter(Boolean).join(', ');
    const dest   = [z3p, z3c].filter(Boolean).join(', ');
    return {
      pol, pod, origin, dest,
      incoterms: g('cond-incoterms'), mode: g('cond-mode'), container,
      cargo: g('cond-cargo'), weight: g('cond-weight'),
      volume: g('cond-volume'), packing: g('cond-packing'), hazmat: g('cond-hazmat'),
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
      if (el.type === 'checkbox') el.checked = cells[j] === true;
      else el.value = cells[j];
    });
  }

  // 行復元後の再計算・スタイル適用ヘルパー
  function _afterRestoreRows(trs) {
    trs.forEach(tr => {
      const nm = tr.querySelector('[data-field="nm"]');
      if (!nm) return;
      const rowId = nm.id.replace('nm-', '');
      checkUnfilled(rowId);
      onCatChange(rowId);
      onPay(rowId);
      // taxed クラスを checked 状態から再適用
      const txEl = tr.querySelector('[data-field="tx"]');
      if (txEl?.checked) tr.classList.add('taxed');
      else tr.classList.remove('taxed');
    });
  }

  // データを画面に適用（restoreAutoSave と同等。トースト・restoreBar 操作なし）
  function _applyQuoteData(data) {
    _rebuildTable(data);
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
    const fields = {};
    document.querySelectorAll('#tab-quote-make input[id], #tab-quote-make select[id], #tab-quote-make textarea[id]').forEach(el => {
      if (['csvFileInput','importFileInput','autoSaveChk','tabAddChk'].includes(el.id)) return;
      fields[el.id] = el.type === 'checkbox' ? el.checked : el.value;
    });
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
    return { fields, rows, ts: new Date().toISOString(), _rowFormat: 'v3-mixed-rows', _direction: _currentDirection };
  }

  /**
   * 旧形式（_rowFormat 未指定）の行データを新形式 (sv@index 2) に変換。
   * 旧 DOM: [chk, cat, tx, nm, pq, un, pc, pp, cd, bq, bc, bp, mk, nt, sv]  (sv at index 14)
   * 新 DOM: [chk, cat, sv, tx, nm, pq, un, pc, pp, cd, bq, bc, bp, mk, nt]  (sv at index 2)
   * cells が 15 要素で _rowFormat 未指定なら、cells[14] を取り出して index 2 に挿入。
   */
  function migrateRowCells(data) {
    if (!data || data._rowFormat === 'v2-sv-after-cat') return data;
    if (!Array.isArray(data.rows)) return data;
    data.rows = data.rows.map(cells => {
      if (!Array.isArray(cells)) return cells;
      if (cells.length !== 15) return cells;  // 旧形式は 15 要素のはず
      const sv = cells[14];
      const out = cells.slice();
      out.splice(14, 1);     // 末尾の sv を除去
      out.splice(2, 0, sv);  // index 2 に挿入
      return out;
    });
    data._rowFormat = 'v2-sv-after-cat';
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
    const ts = data.ts ? new Date(data.ts).toLocaleString('ja-JP') : '';
    _rebuildTable(data);
    if (typeof calcLiveUpdate === 'function') calcLiveUpdate();
    dismissRestoreBar();
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
    const ts = data.ts ? new Date(data.ts).toLocaleString('ja-JP') : '不明';
    if (!confirm(`保存日時: ${ts}\n\n現在のデータを上書きして読み込みますか？`)) return;
    _rebuildTable(data);
    if (typeof calcLiveUpdate === 'function') calcLiveUpdate();
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
        items.push({ cat: 'customs',   name: '輸出通関費',              note: '通関手数料・書類作成', sv: _getFirstScValue('sc-customs-e')  || def1 });
      }
      items.push({ cat: 'export-local', name: '港湾諸費用（輸出）',      note: 'THC・ドキュメント費等', sv: '' });
    }

    // Zone ② 幹線輸送（常に追加）
    const carrier = document.getElementById('z2Carrier')?.value?.trim() || '';
    const pol     = document.getElementById('z2Pol')?.value?.trim()     || '';
    const pod     = document.getElementById('z2Pod')?.value?.trim()     || '';
    const polpod  = [pol, pod].filter(Boolean).join(' → ') || 'ポート〜ポート';
    if (_currentTransport === 'air') {
      items.push({ cat: 'air',       name: '航空運賃',       note: polpod,           sv: carrier });
      items.push({ cat: 'surcharge', name: 'サーチャージ類', note: 'FSC/SSC 等',     sv: carrier });
    } else {
      items.push({ cat: 'ocean',     name: '海上運賃',       note: polpod,           sv: carrier });
      items.push({ cat: 'surcharge', name: 'サーチャージ類', note: 'BAF/CAF/PSS 等', sv: carrier });
    }

    // Zone ③ 到着地側
    if (_zone3On) {
      const def3 = document.getElementById('z3DefaultSc')?.value?.trim() || '';
      items.push({ cat: 'overseas',  name: '仕向港費用',              note: 'D/O・THC等',           sv: '' });
      if (document.getElementById('piece-customs-i')?.checked) {
        items.push({ cat: 'customs',   name: '輸入通関費',              note: '通関手数料・書類作成', sv: _getFirstScValue('sc-customs-i') || def3 });
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
      const card = document.getElementById('zone1Card');
      const btn  = document.getElementById('zone1Btn');
      card?.classList.toggle('zone-off', !_zone1On);
      if (btn) { btn.textContent = _zone1On ? 'ON' : 'OFF'; btn.classList.toggle('on', _zone1On); }
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
      const card = document.getElementById('zone3Card');
      const btn  = document.getElementById('zone3Btn');
      card?.classList.toggle('zone-off', !_zone3On);
      if (btn) { btn.textContent = _zone3On ? 'ON' : 'OFF'; btn.classList.toggle('on', _zone3On); }
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
    document.querySelectorAll('#dirBtns .cond-prim-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.dir === dir)
    );
    _applyZoneLabels();
    applyZoneState();
  }

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
    _currentTransport = transport;
    document.querySelectorAll('#seaAirBtns .cond-prim-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.transport === transport)
    );
    // FCL/LCL サブボタン表示切替
    const fclLcl = document.getElementById('fclLclBtns');
    if (fclLcl) fclLcl.style.display = transport === 'sea' ? '' : 'none';
    // cond-mode select を同期して updateRouteModeIcon を呼ぶ
    _syncModeSelect();
    updateRouteModeIcon();
    _applyZoneLabels();
    _refreshCarrierDatalist();
    if (typeof applyCargoFieldOrder === 'function') applyCargoFieldOrder();
  }

  /** FCL / LCL サブトグル（Seaのとき表示） */
  function setSeaSub(sub) {
    _currentSeaSub = sub;
    document.querySelectorAll('#fclLclBtns .cond-sub-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.sub === sub)
    );
    _syncModeSelect();
    updateRouteModeIcon();
    _applyZoneLabels();
    _refreshCarrierDatalist();
    if (typeof applyCargoFieldOrder === 'function') applyCargoFieldOrder();
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
    if (!panel) return;
    const val  = (document.getElementById('z2Carrier')?.value || '').trim();
    const map  = _carrierMapForMode();
    const defs = _linkDefsForMode();
    const c    = map[val];
    if (!c) { panel.style.display = 'none'; panel.innerHTML = ''; return; }

    const links = defs
      .map(d => ({
        label: d.label,
        url:   _resolveCarrierUrl(c[d.key]),
        title: (d.noteKey && c[d.noteKey]) ? c[d.noteKey] : d.label,
      }))
      .filter(l => l.url);

    if (!links.length) { panel.style.display = 'none'; panel.innerHTML = ''; return; }

    const icon = c.icon || '';
    panel.innerHTML =
      `<span class="carrier-links-name">${icon} ${val}</span>` +
      links.map(l =>
        `<a class="carrier-link-chip" href="${l.url}" target="_blank" rel="noopener" title="${l.title}">${l.label}</a>`
      ).join('');
    panel.style.display = 'flex';
  }

  // ========== インコタームズ ヒント表示 ==========
  function showIncotermsHint(val) {
    const code = (val || '').split('（')[0].trim();
    const hints = {
      'EXW': '売主工場渡し：売主の負担最小。輸出通関・輸送は全て買主手配（※日本の輸出管理上、輸出者が日本法人でなくなるリスクに注意）',
      'FCA': '運送人渡し：売主が指定地点で運送人に引渡し。輸出通関は売主。L/C 決済時は買主が運送人に B/L 発行指示可（Incoterms 2020 追加規定）',
      'CPT': '輸送費込み：売主が指定仕向地まで輸送費負担。ただしリスク移転は最初の運送人引渡し時点（費用負担点とリスク移転点が異なる）',
      'CIP': '輸送費・保険料込み：CPT+保険料。Incoterms 2020 で最低 ICC(A) 付保義務。リスク移転は最初の運送人引渡し時',
      'DAP': '仕向地持込渡し：売主が仕向地まで輸送・費用負担。輸入通関・関税は買主。保険料は買主負担',
      'DPU': '荷卸込み持込渡し：売主が仕向地で荷卸しまで負担（D 条件で唯一、荷卸し義務あり）。保険料は買主負担',
      'DDP': '関税込み持込渡し：売主負担最大。輸入通関・関税も売主。輸入国での登録・許可取得義務が生じる場合あり',
      'FAS': '船側渡し：売主が船積み港の船側まで搬入。輸出通関は売主（海上・内水路専用）',
      'FOB': '本船渡し：本船積込完了まで売主負担。輸出通関は売主（海上・内水路専用）',
      'CFR': '運賃込み：売主が仕向港までの運賃負担。リスク移転は積込時（海上・内水路専用）',
      'CIF': '運賃・保険料込み：CFR+保険料。最低 ICC(C) 保険付保（CPT より保険条件が低い）（海上・内水路専用）',
    };
    const el = document.getElementById('cond-incoterms-hint');
    if (!el) return;
    if (hints[code]) {
      el.textContent = hints[code];
      el.style.display = 'block';
    } else {
      el.textContent = '';
      el.style.display = 'none';
    }
  }

  // ========== テーブル再構築（loadPreset / importFromFile 共用） ==========
  /**
   * data = { fields: {...}, rows: [[...], ...] } を受け取り、
   * フォームフィールド適用 + テーブル全行再構築を行う。
   * subtotalCount / remarkCount もリセットする。
   */
  function _rebuildTable(data) {
    if (!data) return;
    // v3 以外は正規化
    if (data._rowFormat !== 'v3-mixed-rows') {
      data = (typeof migrateRowCells === 'function') ? migrateRowCells(data) : data;
      if (Array.isArray(data.rows)) {
        data = Object.assign({}, data, {
          rows: data.rows.map(r => Array.isArray(r) ? { _type: 'data', cells: r } : r),
          _rowFormat: 'v3-mixed-rows'
        });
      }
    }
    // フォーム復元
    Object.entries(data.fields || {}).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = val;
      else el.value = val;
    });
    // 輸送モード・方向ボタンを cond-mode select から推論して復元
    const _modeVal = document.getElementById('cond-mode')?.value || '';
    if (_modeVal === '航空（AIR）') {
      if (typeof setTransport === 'function') setTransport('air');
    } else if (_modeVal.includes('LCL')) {
      if (typeof setTransport === 'function') setTransport('sea');
      if (typeof setSeaSub === 'function') setSeaSub('lcl');
    } else if (_modeVal.includes('FCL') || _modeVal.includes('海上')) {
      if (typeof setTransport === 'function') setTransport('sea');
      if (typeof setSeaSub === 'function') setSeaSub('fcl');
    }
    if (data._direction && typeof setDirection === 'function') {
      setDirection(data._direction);
    }
    // テーブル再構築
    document.getElementById('tableBody').innerHTML = '';
    rowCount = 0;
    subtotalCount = 0;
    remarkCount = 0;
    let lastRowId = null;
    (data.rows || []).forEach(row => {
      if (!row || typeof row !== 'object') return;
      if (row._type === 'subtotal') {
        insertSubtotalRow(lastRowId);
        const newId = `subtotal-${subtotalCount}`;
        const stRow = document.getElementById(`row-${newId}`);
        if (stRow) {
          const lbl = stRow.querySelector('.subtotal-label');
          if (lbl) lbl.value = row.label || '';
        }
        lastRowId = newId;
      } else if (row._type === 'remark') {
        insertRemarkRow(lastRowId);
        const newId = `remark-${remarkCount}`;
        const rmRow = document.getElementById(`row-${newId}`);
        if (rmRow) {
          const inp = rmRow.querySelector('.remark-row-input');
          if (inp) inp.value = row.text || '';
        }
        lastRowId = newId;
      } else {
        addRow();
        const newId = rowCount;
        const tr = document.getElementById(`row-${newId}`);
        if (tr) _applyCells(tr, row.cells || row);
        lastRowId = String(newId);
      }
    });
    _afterRestoreRows(document.querySelectorAll('#tableBody tr'));
    if (typeof updateTotals === 'function') updateTotals();
    if (typeof updateSubtotalRows === 'function') updateSubtotalRows();
    if (typeof updateRouteModeIcon === 'function') updateRouteModeIcon();
    if (typeof onZ2CarrierChange === 'function') onZ2CarrierChange();
    // インコタームズヒントを復元
    const icEl = document.getElementById('cond-incoterms');
    if (icEl && typeof showIncotermsHint === 'function') showIncotermsHint(icEl.value);
  }

