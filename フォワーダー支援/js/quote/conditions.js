// ========== 引き合い条件・ゾーン (app-conditions.js) ==========

  // ========== 引き合い条件 ==========



  function clearConditions() {
    if (!confirm('貨物情報・引き合い条件をクリアしますか？')) return;
    ['cond-pol','cond-pod','cond-origin','cond-dest','cond-cargo',
     'cond-weight','cond-volume','cond-packing','cond-packing-preset','condFreeText',
     'cond-origin-country','cond-dest-country','z1Place','z1Country','z3Place','z3Country',
     'cond-container-count']
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    ['cond-incoterms','cond-mode','cond-container-type','cond-hazmat']
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    document.getElementById('calcResultsPanel').style.display = 'none';
  }

  function getConditions() {
    const g = id => document.getElementById(id)?.value.trim() || '';
    const ctype  = g('cond-container-type');
    const ccount = g('cond-container-count');
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

  // データを画面に適用（restoreAutoSave と同等。トースト・restoreBar 操作なし）
  function _applyQuoteData(data) {
    if (!data) return;
    Object.entries(data.fields || {}).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = val;
      else el.value = val;
    });
    document.getElementById('tableBody').innerHTML = '';
    rowCount = 0;
    (data.rows || []).forEach(() => addRow());
    const trs = document.querySelectorAll('#tableBody tr');
    (data.rows || []).forEach((cells, i) => {
      if (!trs[i]) return;
      trs[i].querySelectorAll('input, select, textarea').forEach((el, j) => {
        if (cells[j] !== undefined) el.value = cells[j];
      });
    });
    trs.forEach(tr => {
      const nm = tr.querySelector('[data-field="nm"]');
      if (!nm) return;
      const rowId = nm.id.replace('nm-', '');
      checkUnfilled(rowId);
      onCatChange(rowId);
      onPay(parseInt(rowId));
    });
    if (typeof updateTotals === 'function') updateTotals();
    if (typeof updateRouteModeIcon === 'function') updateRouteModeIcon();
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
      if (['csvFileInput','importFileInput','autoSaveChk','tabAddChk'].includes(el.id)) return;
      fields[el.id] = el.type === 'checkbox' ? el.checked : el.value;
    });
    // テーブル行
    const rows = [];
    document.querySelectorAll('#tableBody tr').forEach(tr => {
      if (tr.dataset.type === 'subtotal') return; // 小計行はスキップ
      const cells = [];
      tr.querySelectorAll('input, select, textarea').forEach(el => cells.push(el.value));
      rows.push(cells);
    });
    return { fields, rows, ts: new Date().toISOString() };
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
    // フォーム復元
    Object.entries(data.fields || {}).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = val;
      else el.value = val;
    });
    // テーブル行復元
    document.getElementById('tableBody').innerHTML = '';
    rowCount = 0;
    (data.rows || []).forEach(() => addRow());
    const trs = document.querySelectorAll('#tableBody tr');
    (data.rows || []).forEach((cells, i) => {
      if (!trs[i]) return;
      trs[i].querySelectorAll('input, select, textarea').forEach((el, j) => {
        if (cells[j] !== undefined) el.value = cells[j];
      });
    });
    // グレーアウト・カテゴリ色・計算を全行更新（値セット後に再適用）
    trs.forEach(tr => {
      const nm = tr.querySelector('[data-field="nm"]');
      if (!nm) return;
      const rowId = nm.id.replace('nm-', '');
      checkUnfilled(rowId);
      onCatChange(rowId);
      onPay(parseInt(rowId));
    });
    updateTotals();
    updateRouteModeIcon();
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
    const ts = data.ts ? new Date(data.ts).toLocaleString('ja-JP') : '不明';
    if (!confirm(`保存日時: ${ts}\n\n現在のデータを上書きして読み込みますか？`)) return;
    // フォーム復元
    Object.entries(data.fields || {}).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = val;
      else el.value = val;
    });
    // テーブル行復元
    document.getElementById('tableBody').innerHTML = '';
    rowCount = 0;
    (data.rows || []).forEach(() => addRow());
    const trs = document.querySelectorAll('#tableBody tr');
    (data.rows || []).forEach((cells, i) => {
      if (!trs[i]) return;
      trs[i].querySelectorAll('input, select, textarea').forEach((el, j) => {
        if (cells[j] !== undefined) el.value = cells[j];
      });
    });
    // グレーアウト状態を更新
    trs.forEach(tr => {
      const nm = tr.querySelector('[data-field="nm"]');
      if (nm) checkUnfilled(nm.id.replace('nm-', ''));
    });
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
        items.push({ cat: 'customs',   name: '輸出通関費',              note: '通関手数料・書類作成', sv: _getFirstScValue('sc-customs-e')  || def1 });
      }
      items.push({ cat: 'domestic',    name: '港湾諸費用（輸出）',      note: 'THC・ドキュメント費等', sv: '' });
    }

    // Zone ② 幹線輸送（常に追加）
    const carrier = document.getElementById('z2Carrier')?.value?.trim() || '';
    const pol     = document.getElementById('z2Pol')?.value?.trim()     || '';
    const pod     = document.getElementById('z2Pod')?.value?.trim()     || '';
    const polpod  = [pol, pod].filter(Boolean).join(' → ') || 'ポート〜ポート';
    items.push({ cat: 'ocean',     name: '海上運賃',       note: polpod,           sv: carrier });
    items.push({ cat: 'surcharge', name: 'サーチャージ類', note: 'BAF/CAF/PSS 等', sv: carrier });

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

