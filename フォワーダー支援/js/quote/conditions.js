// ========== 引き合い条件・ゾーン (app-conditions.js) ==========

  // ========== 引き合い条件 ==========



  function clearConditions() {
    if (!confirm('貨物情報・引き合い条件をクリアしますか？')) return;
    ['z2Carrier','z2Service','z2Pol','z2Via','z2Pod','z2Tt','cond-origin','cond-dest','cond-cargo','cond-hs','cond-hs-basic','cond-hs-pref','cond-hs-pref-note',
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
    // 航路：複数登録があれば先頭の有効航路を代表 POL/POD に（無ければ単体入力欄）
    const _activeRoutes = _routeEntries.filter(r => r.enabled !== false);
    const _r0 = _activeRoutes.length ? _activeRoutes[0] : (_routeEntries.length ? _routeEntries[0] : null);
    const pol    = _r0 ? _r0.pol : g('z2Pol');
    const pod    = _r0 ? _r0.pod : g('z2Pod');
    const z1p    = g('z1Place');   const z1c = g('z1Country');
    const z3p    = g('z3Place');   const z3c = g('z3Country');
    const origin = [z1p, z1c].filter(Boolean).join(', ');
    const dest   = [z3p, z3c].filter(Boolean).join(', ');
    // 複数航路：有効（enabled）航路のみ返す
    const routes = _activeRoutes.slice();
    return {
      pol, pod, origin, dest, routes,
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
  // 保存セルの正準フィールド順（DOM の視覚的な列順とは独立に固定）。
  // cells[0] = 選択チェック（.row-select-chk）、cells[1..] = 下記の順。
  // 既存の保存データ（localStorage / JSON / クラウド）との互換のため、この順序は変更しないこと。
  // ※ 列の見た目の並び替えは row-tpl / thead 側だけで行い、ここは触らない。
  // 末尾の vf/vt（サーチャージ有効期限：開始/終了）は後方追加。既存保存データには無いが
  // _applyCells が undefined セルをスキップするため互換。順序は末尾以外変更しないこと。
  const ROW_CELL_FIELDS = ['cat','sv','tx','nm','pq','un','bq','pc','bc','pp','bp','cd','mk','nt','zc','vf','vt','ac','pt','ps','co'];

  function _applyCells(tr, cells) {
    // cells[0] = 選択チェック、cells[1..] = ROW_CELL_FIELDS 順（DOM 列順に依存しない）
    const sel = tr.querySelector('.row-select-chk');
    if (sel && cells[0] !== undefined) sel.checked = cells[0] === true || cells[0] === 'on';
    ROW_CELL_FIELDS.forEach((f, i) => {
      const v = cells[i + 1];
      if (v === undefined) return;
      const el = tr.querySelector(`[data-field="${f}"]`);
      if (!el) return;
      // 旧形式では checkbox 値が文字列 "on" で保存されていた。boolean true と "on" 両方を受け入れる
      if (el.type === 'checkbox') el.checked = v === true || v === 'on';
      else el.value = v;
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
  function _checkValidUntil() {
    const el = document.getElementById('qf-valid-until');
    if (!el || !el.value) { el?.classList.remove('qf-expired'); return; }
    const expired = new Date(el.value) < new Date(new Date().toDateString());
    el.classList.toggle('qf-expired', expired);
  }

  function _addDaysToValidUntil(n) {
    const el = document.getElementById('qf-valid-until');
    if (!el) return;
    const base = el.value ? new Date(el.value + 'T00:00:00') : new Date();
    base.setDate(base.getDate() + n);
    el.value = base.toLocaleDateString('sv', { timeZone: 'Asia/Tokyo' }); // "YYYY-MM-DD" JST
    _checkValidUntil();
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
  }

  window.checkValidUntilWarning = _checkValidUntil;
  window.addDaysToValidUntil    = _addDaysToValidUntil;

  function _restoreUiState(fields) {
    if (!fields) return;

    // 輸送モード（cond-mode の値から判定して setTransport を呼ぶ）
    const modeVal = (document.getElementById('cond-mode')?.value || '').trim();
    if      (modeVal === '海上（FCL）') setTransport('fcl');
    else if (modeVal === '海上（LCL）') setTransport('lcl');
    else if (modeVal.startsWith('航空')) setTransport('air');
    else if (modeVal === '国内手配のみ') setTransport('domestic');

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
    _checkValidUntil();
    if (typeof renderRefUrlLinks === 'function') renderRefUrlLinks(); // 参照URLをリンク表示へ
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
        insertRemarkRow(null, { internal: row.internal });
        const tr = tbody.lastElementChild;
        const inp = tr?.querySelector('.remark-row-input');
        if (inp) inp.value = row.text || '';
        return;
      }
      if (row && row._type === 'internal') {
        insertInternalRow(null, { noFocus: true });
        const tr = tbody.lastElementChild;
        const inp = tr?.querySelector('.internal-row-input');
        if (inp) inp.value = row.text || '';
        return;
      }
      // 通常行（v3 オブジェクト or 旧配列）
      const cells = Array.isArray(row) ? row : (row?.cells || []);
      addRow();
      const tr = tbody.lastElementChild;
      _applyCells(tr, cells);
      // コンテナ連動フラグを復元
      if (row.cntLink) {
        tr.dataset.cntLink = '1';
        const btn = tr.querySelector('.cnt-link-btn');
        if (btn) { btn.classList.add('is-linked'); btn.title = '連動中（クリックで解除）'; }
      }
      // 見積書非表示フラグを復元
      if (row.hideQuote) {
        tr.dataset.hideQuote = '1';
        tr.classList.add('row-hidden-quote');
        const hb = tr.querySelector('.row-hidequote-btn');
        if (hb) { hb.classList.add('is-on'); hb.textContent = '🚫'; hb.title = '見積書で非表示中（クリックで出力に戻す）'; }
      }
      // 要調査（後で記入）フラグを復元
      if (row.pending) {
        tr.dataset.pending = '1';
        tr.classList.add('row-pending');
        const pb = tr.querySelector('.row-pending-btn');
        if (pb) { pb.classList.add('is-on'); pb.title = '要調査（後で記入）中。最新情報を調べたらクリックで解除。'; }
      }
      // 入力完了マークを復元
      if (row.done) {
        tr.dataset.done = '1';
        tr.classList.add('row-input-done');
        const db = tr.querySelector('.row-done-btn');
        if (db) { db.classList.add('is-on'); db.title = '入力完了（クリックで解除）'; }
      }
      // 港ペア（子グループキー）を復元
      // 旧データの港ペアはパターンへ統合（パターン未設定時のみ移行）
      if (row.portPair) { const ptEl = tr.querySelector('[data-field="pt"]'); if (ptEl && !ptEl.value) ptEl.value = row.portPair; }
      regularTrs.push(tr);
    });
    _afterRestoreRows(regularTrs, data.fields);
    if (typeof renderSubconGroups === 'function') renderSubconGroups();
    if (typeof updatePendingCounter === 'function') updatePendingCounter();
  }

  // プリセット読み込み時に空値で上書きしないヘッダー項目
  const _HEADER_FIELD_IDS = ['qf-ref','qf-customer','qf-person','qf-date','qf-valid-until','qf-memo','qf-status'];

  // データを画面に適用（restoreAutoSave と同等。トースト・restoreBar 操作なし）
  function _applyQuoteData(data, { keepHeaderIfEmpty = false } = {}) {
    if (!data) return;
    data = migrateRowCells(data);
    // サブコン別小計の客先用表示名を復元（_rebuildTable → renderSubconGroups より前にセット）
    if (typeof setSubconAliases === 'function') setSubconAliases(data.subconAliases || {});
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
    // 保存時の為替レートを復元（スナップショット）
    if (data.fxSnapshot?.rates && Object.keys(data.fxSnapshot.rates).length) {
      _fxRates = { ...DEFAULT_FX_RATES, ...data.fxSnapshot.rates };
      saveFxRates();
      if (data.fxSnapshot.ts) localStorage.setItem(SharedStorage.KEYS.FX_LAST_FETCHED, data.fxSnapshot.ts);
    }
    if (typeof updateTotals === 'function') updateTotals();
    if (typeof updateRouteModeIcon === 'function') updateRouteModeIcon();
    if (typeof syncHazmatPanel === 'function') syncHazmatPanel();
    if (typeof syncMultiEntryFields === 'function') syncMultiEntryFields();
    if (typeof window.updateSectionSummaries === 'function') window.updateSectionSummaries();
    _triggerCarrierBmFetch();
    if (typeof window.renderQuoteMilestones === 'function') window.renderQuoteMilestones();
    if (typeof window.updateRemarkChar === 'function') window.updateRemarkChar();
    if (typeof window.updateQuoteStatusUI === 'function') window.updateQuoteStatusUI();
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
      new MutationObserver(() => { if (!_inGroupRender) scheduleSnapshot(); })
        .observe(tbody, { childList: true });
    }
  }

  // ===== 参照URL：貼り付けたURLを自動リンク化（複数可・改行/空白区切り） =====
  const _ruEsc = s => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function _ruExtract(text) {
    if (!text) return [];
    const out = [], seen = new Set();
    const re = /https?:\/\/[^\s<>"'）)】」]+/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const u = m[0].replace(/[.,;:!?！？）)、。]+$/, ''); // 末尾の句読点・閉じ括弧は除外
      if (u && !seen.has(u)) { seen.add(u); out.push(u); }
    }
    return out;
  }
  function _ruShort(u) {
    try {
      const p = new URL(u);
      let s = p.hostname.replace(/^www\./, '') + (p.pathname && p.pathname !== '/' ? p.pathname : '');
      return s.length > 48 ? s.slice(0, 47) + '…' : s;
    } catch (_) { return u.length > 48 ? u.slice(0, 47) + '…' : u; }
  }
  // テキストエリアの内容から URL を抽出し、リンク表示（view）へ切り替える。
  // URL が無ければ編集用テキストエリアのまま。
  window.renderRefUrlLinks = function () {
    const ta = document.getElementById('qf-refurl');
    const view = document.getElementById('qf-refurl-view');
    if (!ta || !view) return;
    const links = _ruExtract(ta.value);
    const wrap = view.querySelector('.qf-refurl-links');
    if (!links.length) { view.hidden = true; ta.hidden = false; return; }
    if (wrap) {
      wrap.innerHTML = links.map(u =>
        '<a class="qf-refurl-link" href="' + _ruEsc(u) + '" target="_blank" rel="noopener noreferrer" title="' +
        _ruEsc(u) + '">🔗 ' + _ruEsc(_ruShort(u)) + '</a>'
      ).join('');
    }
    ta.hidden = true;
    view.hidden = false;
  };
  // リンク表示から編集モード（テキストエリア）へ戻す
  window.editRefUrl = function () {
    const ta = document.getElementById('qf-refurl');
    const view = document.getElementById('qf-refurl-view');
    if (!ta || !view) return;
    view.hidden = true;
    ta.hidden = false;
    ta.focus();
  };

  // ===== 貨物セクション：関連知識・他法令 =====
  // 知識タブ（カテゴリ cat の サブタブ tabId）へジャンプし、任意で anchorId へスクロール
  window.gotoRef = function (cat, tabId, anchorId) {
    try {
      document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
      const catBtn = document.querySelector(`.cat-btn[onclick*="switchCategory('${cat}'"]`);
      if (catBtn) catBtn.classList.add('active');
      document.querySelectorAll('.sub-nav').forEach(s => s.classList.remove('active'));
      document.getElementById('sub-' + cat)?.classList.add('active');
      if (typeof switchTab === 'function') switchTab(tabId);
      const sub = document.getElementById('sub-' + cat);
      if (sub) {
        sub.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        const tb = sub.querySelector(`.tab-btn[onclick*="switchTab('${tabId}'"]`);
        if (tb) tb.classList.add('active');
      }
      setTimeout(() => {
        const el = anchorId ? document.getElementById(anchorId) : document.getElementById('tab-' + tabId);
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 70);
    } catch (e) { /* no-op */ }
  };

  // 輸入 他法令（関税法以外）11法令の要約。詳細は「🔒 貿易管理令・他法令」タブ。
  const _IMPORT_OTHER_LAWS = [
    { n: '食品衛生法',            o: '厚労省 検疫所',         t: '食品・添加物・容器包装・おもちゃ等。輸入届出が必要' },
    { n: '植物防疫法',            o: '農水省 植物防疫所',     t: '植物・種子・木材・果実等。検査・消毒・輸入禁止品に注意' },
    { n: '家畜伝染病予防法',      o: '農水省 動物検疫所',     t: '畜産物・肉製品・乳製品等。動物検疫・輸入禁止地域あり' },
    { n: '薬機法（医薬品医療機器等法）', o: '厚労省',          t: '医薬品・医薬部外品・化粧品・医療機器。薬監証明等' },
    { n: '電気用品安全法（PSE）', o: '経産省',                t: '電気用品。PSEマーク・技術基準適合が必要' },
    { n: '電波法（技適）',        o: '総務省',                t: '無線機能を持つ機器。技術基準適合証明（技適マーク）' },
    { n: '消費生活用製品安全法（PSC）', o: '経産省',          t: '特定製品（乳幼児用ベッド・ライター等）。PSCマーク' },
    { n: '化審法',                o: '経産省・厚労省・環境省', t: '化学物質。新規化学物質の届出・規制対象に注意' },
    { n: '毒物及び劇物取締法',    o: '厚労省',                t: '毒物・劇物。登録・表示・取扱の規制' },
    { n: 'ワシントン条約（CITES）', o: '経産省・環境省',      t: '絶滅危惧種・象牙・革製品等。輸出入許可（CITES許可書）' },
    { n: '外為法 輸入承認（IQ等）', o: '経産省',              t: '輸入割当・事前確認品目。輸入承認・確認が必要' },
  ];
  window.toggleCargoLawPanel = function () {
    const p = document.getElementById('cargoLawPanel');
    const btn = document.querySelector('.cargo-ref-chip--law');
    if (!p) return;
    if (!p.hidden) { p.hidden = true; if (btn) btn.classList.remove('is-on'); return; }
    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    p.innerHTML =
      '<div class="cargo-law-head">📥 輸入通関 ― 他法令（関税法以外の規制）<span class="cargo-law-note">品目により許可・承認・確認が必要。通関前に要確認</span></div>' +
      '<table class="cargo-law-table"><thead><tr><th>法令</th><th>管轄</th><th>対象・ポイント</th></tr></thead><tbody>' +
      _IMPORT_OTHER_LAWS.map(l =>
        `<tr><td class="cargo-law-n">${esc(l.n)}</td><td class="cargo-law-o">${esc(l.o)}</td><td class="cargo-law-t">${esc(l.t)}</td></tr>`
      ).join('') +
      '</tbody></table>' +
      '<div class="cargo-law-foot"><button type="button" class="cargo-law-more" onclick="gotoRef(\'docs\',\'regs\',\'regs-import-other-laws\')">詳しい一覧（管轄・手続き・通関影響）を他法令タブで開く ↗</button></div>';
    p.hidden = false;
    if (btn) btn.classList.add('is-on');
  };

  // ===== 📝 メモのポップアウト（全画面・サイズ可変）=====
  // #qf-memo と #qf-memo-pop を双方向同期。ポップアウト側の編集も元欄の input を発火させ自動保存に乗せる。
  let _memoPopEscHandler = null;
  window.openMemoPopout = function () {
    const src = document.getElementById('qf-memo');
    const pop = document.getElementById('qf-memo-pop');
    const ov  = document.getElementById('qfMemoPopout');
    if (!src || !pop || !ov) return;
    pop.value = src.value;
    ov.hidden = false;
    // ポップアウトでの入力を元欄へ反映（input を発火 → 既存の自動保存リスナーが拾う）
    pop.oninput = () => {
      src.value = pop.value;
      src.dispatchEvent(new Event('input', { bubbles: true }));
    };
    _memoPopEscHandler = (e) => { if (e.key === 'Escape') { e.stopPropagation(); window.closeMemoPopout(); } };
    document.addEventListener('keydown', _memoPopEscHandler, true);
    setTimeout(() => { pop.focus(); }, 30);
  };
  window.closeMemoPopout = function () {
    const src = document.getElementById('qf-memo');
    const pop = document.getElementById('qf-memo-pop');
    const ov  = document.getElementById('qfMemoPopout');
    if (!ov) return;
    if (src && pop) {                       // 念のため最終同期
      src.value = pop.value;
      src.dispatchEvent(new Event('input', { bubbles: true }));
    }
    ov.hidden = true;
    if (_memoPopEscHandler) { document.removeEventListener('keydown', _memoPopEscHandler, true); _memoPopEscHandler = null; }
    if (src) src.focus();
  };

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
      if (tr.dataset.virtual) return; // サブコングループヘッダー（仮想行）はスキップ
      if (tr.dataset.type === 'subtotal') {
        rows.push({ _type: 'subtotal', label: tr.querySelector('.subtotal-label')?.value || '' });
        return;
      }
      if (tr.dataset.type === 'remark') {
        rows.push({ _type: 'remark', text: tr.querySelector('.remark-row-input')?.value || '', internal: tr.dataset.internal === '1' });
        return;
      }
      if (tr.dataset.type === 'internal') {
        rows.push({ _type: 'internal', text: tr.querySelector('.internal-row-input')?.value || '' });
        return;
      }
      const cells = [ tr.querySelector('.row-select-chk')?.checked ?? false ];
      ROW_CELL_FIELDS.forEach(f => {
        const el = tr.querySelector(`[data-field="${f}"]`);
        cells.push(el ? (el.type === 'checkbox' ? el.checked : el.value) : '');
      });
      const rowObj = { _type: 'data', cells };
      if (tr.dataset.cntLink === '1') rowObj.cntLink = true;
      if (tr.dataset.hideQuote === '1') rowObj.hideQuote = true;
      if (tr.dataset.pending === '1') rowObj.pending = true;          // 要調査（後で記入）
      if (tr.dataset.done === '1') rowObj.done = true;                // 入力完了マーク
      if (tr.dataset.portPair) rowObj.portPair = tr.dataset.portPair; // 港ペア（子グループ）
      rows.push(rowObj);
    });
    // _rowFormat: v3 = 小計行・リマーク行を含む型付きオブジェクト配列
    return { fields, rows, ts: new Date().toISOString(), _rowFormat: 'v3-mixed-rows',
             subconAliases: (typeof getSubconAliases === 'function' ? getSubconAliases() : {}),
             fxSnapshot: { rates: { ..._fxRates }, ts: localStorage.getItem(SharedStorage.KEYS.FX_LAST_FETCHED) || null } };
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
    } catch(e) {
      if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
        showSaveStatus('⚠️ 保存失敗: ストレージ容量不足');
        quoteShowToast('⚠️ ストレージ容量が上限に達しました。古いプリセットを削除するか、JSONファイルに書き出してください', 'warn', 7000);
      } else {
        showSaveStatus('⚠️ 保存失敗: ' + e.message);
      }
    }
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
    // 保存時の為替レートを復元（スナップショット）
    if (data.fxSnapshot?.rates && Object.keys(data.fxSnapshot.rates).length) {
      _fxRates = { ...DEFAULT_FX_RATES, ...data.fxSnapshot.rates };
      saveFxRates();
      if (data.fxSnapshot.ts) localStorage.setItem(SharedStorage.KEYS.FX_LAST_FETCHED, data.fxSnapshot.ts);
    }
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
    // 保存時の為替レートを復元（スナップショット）
    if (data.fxSnapshot?.rates && Object.keys(data.fxSnapshot.rates).length) {
      _fxRates = { ...DEFAULT_FX_RATES, ...data.fxSnapshot.rates };
      saveFxRates();
      if (data.fxSnapshot.ts) localStorage.setItem(SharedStorage.KEYS.FX_LAST_FETCHED, data.fxSnapshot.ts);
    }
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

    // Zone ① 出発地側 — サブコン単位で空行1行
    if (_zone1On) {
      const def1 = document.getElementById('z1DefaultSc')?.value?.trim() || '';
      const seen1 = new Set();
      const addZ1 = (sv) => {
        if (!seen1.has(sv)) { seen1.add(sv); items.push({ cat: 'domestic', name: '', note: '', sv }); }
      };
      if (document.getElementById('piece-pickup')?.checked)    addZ1(_getFirstScValue('sc-pickup')    || def1);
      if (document.getElementById('piece-wh-origin')?.checked) addZ1(_getFirstScValue('sc-wh-origin')  || def1);
      if (document.getElementById('piece-customs-e')?.checked) addZ1(_getFirstScValue('sc-customs-e')  || def1);
      addZ1(def1); // 港湾諸費用（常時）を def1 グループに含める
    }

    // Zone ② 幹線輸送 — 有効（enabled）航路のみ carrier 単位で空行1行
    const _z2Active = _routeEntries.filter(r => r.enabled !== false);
    const routes = _z2Active.length ? _z2Active : _routeEntries.length ? [] : [{
      carrier: document.getElementById('z2Carrier')?.value?.trim() || '',
      pol:     document.getElementById('z2Pol')?.value?.trim()     || '',
      pod:     document.getElementById('z2Pod')?.value?.trim()     || '',
    }];
    routes.forEach(r => {
      // 港ペア（POL → (Via) → POD）を行に付与し、サブコン(キャリア)配下で子グループ化する
      const pp = [r.pol, r.via, r.pod].map(s => (s || '').trim()).filter(Boolean).join(' → ');
      items.push({ cat: 'ocean', name: '', note: '', sv: r.carrier, pp });
    });

    // Zone ③ 到着地側 — サブコン単位で空行1行
    if (_zone3On) {
      const def3 = document.getElementById('z3DefaultSc')?.value?.trim() || '';
      const seen3 = new Set();
      const addZ3 = (sv) => {
        if (!seen3.has(sv)) { seen3.add(sv); items.push({ cat: 'overseas', name: '', note: '', sv }); }
      };
      addZ3(def3); // 仕向港費用（常時）を def3 グループに含める
      if (document.getElementById('piece-customs-i')?.checked) addZ3(_getFirstScValue('sc-customs-i') || def3);
      if (document.getElementById('piece-wh-dest')?.checked)   addZ3(_getFirstScValue('sc-wh-dest')   || def3);
      if (document.getElementById('piece-deliver')?.checked)   addZ3(_getFirstScValue('sc-deliver')   || def3);
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
      if (!confirm(`テーブルに ${existing} 行あります。末尾にサブコン/航路別の空行 ${items.length} 行を追記しますか？\n（置換したい場合は一旦リセットしてから再実行してください）`)) return;
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
      if (item.pp) { const ptEl = document.getElementById('pt-' + id); if (ptEl) ptEl.value = item.pp; }  // 航路名をパターン（サブコン内の入れ子キー）に
      tbody.appendChild(tr);
      const nmEl = document.getElementById('nm-'  + id); if (nmEl) nmEl.value = item.name;
      const ntEl = document.getElementById('nt-'  + id); if (ntEl) ntEl.value = item.note || '';
      const svEl = document.getElementById('sv-'  + id); if (svEl) svEl.value = item.sv   || '';
      if (typeof onCatChange === 'function') onCatChange(id);
      if (typeof onPay       === 'function') onPay(id);
      if (typeof initDrag    === 'function') initDrag(tr);
    });

    if (typeof renderSubconGroups === 'function') renderSubconGroups();  // 航路＝パターンの入れ子グループを描画
    updateTotals();
    quoteShowToast('✅ ゾーン構成プリセット適用完了（サブコン/航路別 ' + items.length + '行）', 'success');
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
    // 区分チップUIの点灯状態を同期（チップは #cond-hazmat を駆動するファサード。
    //   ユーザー操作・データ復元の両方が onHazmatChange を通るため、ここで一元管理する）
    document.querySelectorAll('#hazChips .haz-chip').forEach(chip => {
      const on = chip.dataset.hazValue === val;
      chip.classList.toggle('is-on', on);
      chip.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  /** 区分チップ → #cond-hazmat セレクトを駆動（保存/復元・プレビュー・PDF は従来どおりセレクト値を読む） */
  window.setHazmatChip = function (val) {
    const sel = document.getElementById('cond-hazmat');
    if (!sel) return;
    sel.value = val;
    // change を発火：inline onchange の onHazmatChange（パネル＋チップ同期）と
    //   見積タブの自動保存リスナーを両方通す
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  };

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
    const data = document.getElementById('cond-container-data');
    if (data) data.value = JSON.stringify(_containerEntries);
    // チップUIに反映：各チップの本数入力とアクティブ状態を _containerEntries から復元
    document.querySelectorAll('.cc-chip').forEach(chip => {
      const e = _containerEntries.find(x => x.type === chip.dataset.ctype);
      const input = chip.querySelector('.cc-count');
      const n = e ? e.count : 0;
      if (input && document.activeElement !== input) input.value = n > 0 ? n : '';
      chip.classList.toggle('is-active', n > 0);
    });
    // 旧リストUI（存在すれば後方互換で更新）
    const list = document.getElementById('containerEntryList');
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

  // チップの本数入力（0以下で解除）。データ形は従来どおり _containerEntries=[{type,count}]
  window.setContainerChip = function (type, raw) {
    const n = Math.max(0, parseInt(raw, 10) || 0);
    const idx = _containerEntries.findIndex(e => e.type === type);
    if (n <= 0) { if (idx >= 0) _containerEntries.splice(idx, 1); }
    else if (idx >= 0) _containerEntries[idx].count = n;
    else _containerEntries.push({ type, count: n });
    // hidden データ更新＋アクティブ状態反映（入力中のフィールドは触らない）
    const data = document.getElementById('cond-container-data');
    if (data) data.value = JSON.stringify(_containerEntries);
    document.querySelectorAll('.cc-chip').forEach(chip => {
      const e = _containerEntries.find(x => x.type === chip.dataset.ctype);
      chip.classList.toggle('is-active', !!(e && e.count > 0));
    });
    if (typeof window.renderQuoteCargoInfo === 'function') window.renderQuoteCargoInfo();
    if (typeof window.updateSectionSummaries === 'function') window.updateSectionSummaries();
    _syncContainerLinkedRows();
    _refreshContainerUnitSuggestions();
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
  };
  window.bumpContainerChip = function (btn, delta) {
    const chip = btn.closest('.cc-chip');
    const input = chip.querySelector('.cc-count');
    const n = Math.max(0, (parseInt(input.value, 10) || 0) + delta);
    input.value = n > 0 ? n : '';
    window.setContainerChip(chip.dataset.ctype, n);
  };

  // ========== コンテナ本数 → 見積行数量 連動（FCL） ==========
  function _syncContainerLinkedRows() {
    if (_currentSeaSub !== 'fcl') return;
    const total = _containerEntries.reduce((s, e) => s + (e.count || 0), 0);
    if (!total) return;
    let updated = 0;
    document.querySelectorAll('#tableBody tr[data-cnt-link="1"]').forEach(tr => {
      const id = tr.id.replace('row-', '');
      const pqEl = document.getElementById(`pq-${id}`);
      if (!pqEl) return;
      // 単位がコンテナタイプと一致すればそのタイプの本数、それ以外は合計本数
      const unit = document.getElementById(`un-${id}`)?.value?.trim() || '';
      const matched = _containerEntries.find(e => e.type === unit);
      const qty = matched ? matched.count : total;
      if (pqEl.value == qty) return;
      pqEl.value = qty;
      pqEl.dispatchEvent(new Event('input', { bubbles: true }));
      updated++;
    });
    if (updated && typeof scheduleAutoSave === 'function') scheduleAutoSave();
  }

  // unit-list datalist にアクティブなコンテナタイプ名を追加
  function _refreshContainerUnitSuggestions() {
    const dl = document.getElementById('unit-list');
    if (!dl) return;
    // 既存のコンテナ由来 option を削除
    dl.querySelectorAll('option[data-cnt-type]').forEach(o => o.remove());
    // 本数が設定されているタイプを追加
    _containerEntries.forEach(e => {
      if (!e.type || !e.count) return;
      const opt = document.createElement('option');
      opt.value = e.type;
      opt.dataset.cntType = '1';
      dl.appendChild(opt);
    });
  }

  window.toggleCntLink = function (btn) {
    const tr = btn.closest('tr');
    if (!tr) return;
    const linked = tr.dataset.cntLink === '1';
    if (linked) {
      delete tr.dataset.cntLink;
      btn.classList.remove('is-linked');
      btn.title = 'コンテナ本数に数量を連動（FCL）';
    } else {
      tr.dataset.cntLink = '1';
      btn.classList.add('is-linked');
      btn.title = '連動中（クリックで解除）';
      _syncContainerLinkedRows();
    }
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
  };

  // ===== コンテナ カテゴリ（ドライ／特殊）・サブ（RF／OT・FR）・追加仕様 =====
  function _setCatUI(cat) {
    document.querySelectorAll('.cc-cat-tab').forEach(b => b.classList.toggle('is-on', b.dataset.cat === cat));
    const dry = document.getElementById('ccPaneDry');
    const sp  = document.getElementById('ccPaneSpecial');
    if (dry) dry.hidden = cat !== 'dry';
    if (sp)  sp.hidden  = cat !== 'special';
  }
  function _setSubUI(sub) {
    document.querySelectorAll('.cc-sub-tab').forEach(b => b.classList.toggle('is-on', b.dataset.sub === sub));
    const rf = document.getElementById('ccPaneRf');
    const ot = document.getElementById('ccPaneOtfr');
    if (rf) rf.hidden = sub !== 'rf';
    if (ot) ot.hidden = sub !== 'otfr';
  }
  window.setContainerCat = function (cat) { _setCatUI(cat); updateContainerSpec(); };
  window.setContainerSub = function (sub) {
    _setSubUI(sub);
    if (sub === 'otfr' && typeof window.recalcOverGauge === 'function') window.recalcOverGauge(); // 行を用意＋再計算
    else updateContainerSpec();
  };
  window.setRfVent = function (v) {
    document.querySelectorAll('#cc-rf-vent .cc-seg-btn').forEach(b => b.classList.toggle('is-on', b.dataset.val === v));
    updateContainerSpec();
  };
  // 追加仕様（RF温度帯・換気／OT・FR はみ出し寸法）を hidden #cond-container-spec に保存。
  // コンテナ本体データ（cond-container-data）の形は変えない（互換維持）。
  // OT/FR 用：基準コンテナの内寸（cm）。はみ出し ＝ max(0, 貨物実寸 − 内寸)
  const OTFR_INNER = {
    "20'OT（オープントップ）": { l: 589,  w: 235, h: 230 },
    "40'OT（オープントップ）": { l: 1203, w: 235, h: 230 },
    "20'FR（フラットラック）": { l: 585,  w: 244, h: null }, // フラットは高さ制限なし
    "40'FR（フラットラック）": { l: 1203, w: 244, h: null },
  };
  // 1行ぶん（貨物実寸 L×W×H ＋ 個数 ＋ 判定）の HTML。積載先コンテナは全行共通(#cc-og-ref)
  function _ogRowHTML(item) {
    item = item || {};
    const v = x => (x == null || x === '') ? '' : x;
    const qty = (item.qty == null || item.qty === '') ? '1' : item.qty;
    return `<div class="cc-og-row" data-og-row>
      <div class="cc-dims">
        <input type="number" class="cc-dim og-l" min="0" step="1" placeholder="長さ" inputmode="numeric" value="${v(item.l)}" oninput="recalcOverGauge()" /><span class="cc-dim-x">×</span>
        <input type="number" class="cc-dim og-w" min="0" step="1" placeholder="幅" inputmode="numeric" value="${v(item.w)}" oninput="recalcOverGauge()" /><span class="cc-dim-x">×</span>
        <input type="number" class="cc-dim og-h" min="0" step="1" placeholder="高さ" inputmode="numeric" value="${v(item.h)}" oninput="recalcOverGauge()" /><span class="cc-dim-unit">cm</span>
      </div>
      <input type="number" class="cc-dim og-qty" min="1" step="1" value="${v(qty)}" inputmode="numeric" title="個数" oninput="recalcOverGauge()" />
      <span class="cc-og-rowresult" data-state="empty">—</span>
      <button type="button" class="cc-og-del" onclick="removeOverGaugeRow(this)" title="このサイズを削除" aria-label="削除">✕</button>
    </div>`;
  }
  window.addOverGaugeRow = function (item) {
    const list = document.getElementById('ccOgList');
    if (!list) return;
    list.insertAdjacentHTML('beforeend', _ogRowHTML(item && item.l !== undefined ? item : {}));
    recalcOverGauge();
    const last = list.querySelector('[data-og-row]:last-child .og-l');
    if (last) last.focus();
  };
  window.removeOverGaugeRow = function (btn) {
    const row = btn?.closest('[data-og-row]');
    if (row) row.remove();
    recalcOverGauge();
  };
  function _ensureOgRows() {
    const list = document.getElementById('ccOgList');
    if (list && !list.querySelector('[data-og-row]')) list.insertAdjacentHTML('beforeend', _ogRowHTML({}));
  }
  window._ensureOgRows = _ensureOgRows;
  // 各レーンへピースを振り分けて最長レーンの長さを返す（Longest-Processing-Time 近似）
  function _packLaneLen(lengths, lanes) {
    const n = Math.max(1, lanes);
    const totals = new Array(n).fill(0);
    lengths.slice().sort((a, b) => b - a).forEach(len => {
      let mi = 0;
      for (let i = 1; i < n; i++) if (totals[i] < totals[mi]) mi = i;
      totals[mi] += len;
    });
    return Math.max.apply(null, totals);
  }
  // 1本の積載先コンテナに複数サイズを積む簡易シミュレーション（幅方向に複数列＝2列等を考慮）。
  // 列数ぶんのレーンへピースを振り分け、最長レーン長さを内寸長さと比較。幅・高さは断面判定。
  window.recalcOverGauge = function () {
    _ensureOgRows();
    const ref = document.getElementById('cc-og-ref')?.value || "20'OT（オープントップ）";
    const inner = OTFR_INNER[ref] || OTFR_INNER["20'OT（オープントップ）"];
    const colMode = document.getElementById('cc-og-cols')?.value || 'auto';
    const over = (cargo, lim) => (cargo != null && lim != null && cargo > lim) ? +(cargo - lim).toFixed(1) : 0;
    const rows = Array.from(document.querySelectorAll('#ccOgList [data-og-row]'));
    let anyInput = false, totalQty = 0, widthOver = false, heightOver = false, maxW = 0;
    const lengths = [];   // 個数ぶん展開した各ピースの長さ
    rows.forEach(row => {
      const num = sel => { const v = parseFloat(row.querySelector(sel)?.value); return Number.isFinite(v) ? v : null; };
      const cl = num('.og-l'), cw = num('.og-w'), ch = num('.og-h');
      let qty = parseInt(row.querySelector('.og-qty')?.value, 10);
      if (!Number.isFinite(qty) || qty < 1) qty = 1;
      const res = row.querySelector('.cc-og-rowresult');
      if (cl == null && cw == null && ch == null) { if (res) { res.dataset.state = 'empty'; res.innerHTML = '—'; } return; }
      anyInput = true;
      totalQty += qty;
      if (cw != null && cw > maxW) maxW = cw;
      if (cl != null) for (let i = 0; i < qty; i++) lengths.push(cl);
      const ogW = over(cw, inner.w), ogH = over(ch, inner.h);
      if (res) {
        const parts = [];
        if (ogW > 0) { parts.push(`幅 <b>+${ogW}</b>`); widthOver = true; }
        if (inner.h != null && ogH > 0) { parts.push(`高さ <b>+${ogH}</b>`); heightOver = true; }
        if (parts.length) { res.dataset.state = 'over'; res.innerHTML = '⚠️ ' + parts.join(' / ') + ' cm超過'; }
        else { res.dataset.state = 'fit'; res.innerHTML = (inner.h == null) ? '✅ 幅OK（FR高さ制限なし）' : '✅ 幅・高さOK'; }
      }
    });
    // 幅方向に入る最大列数（最大幅基準）。列指定が幅を超える場合はキャップして警告
    const maxColsByWidth = (maxW > 0) ? Math.max(1, Math.floor(inner.w / maxW)) : null;
    let effCols, colCapped = false;
    if (colMode === 'auto') {
      effCols = maxColsByWidth || 1;
    } else {
      const req = parseInt(colMode, 10) || 1;
      if (maxColsByWidth != null && req > maxColsByWidth) { effCols = maxColsByWidth; colCapped = true; }
      else effCols = req;
    }
    const requiredLen = +_packLaneLen(lengths, effCols).toFixed(1);
    const sim = document.getElementById('ccOgSim');
    if (sim) {
      if (!anyInput) {
        sim.dataset.state = 'empty';
        sim.innerHTML = '📦 貨物サイズを入力すると、1本に積めるかシミュレーションします（幅方向の列数を選べます）';
      } else {
        const remain = +(inner.l - requiredLen).toFixed(1);
        const lenOver = requiredLen > inner.l;
        const refShort = ref.replace(/（.*$/, '');
        const colTxt = effCols + '列' + (colMode === 'auto' ? '（自動）' : '');
        let head, state;
        if (lenOver) { state = 'over'; head = `⚠️ 1本に積みきれません（${colTxt}でも 長さ <b>+${+(requiredLen - inner.l).toFixed(1)}cm</b> 超過）`; }
        else { state = 'fit'; head = `✅ 1本（${refShort}・${colTxt}）に積載可能（残り長さ <b>${remain}cm</b>）`; }
        const xtra = [];
        if (colCapped) xtra.push(`幅方向は最大${maxColsByWidth}列まで（指定列数は入りません）`);
        if (widthOver) xtra.push('幅が内寸を超えるサイズあり');
        if (heightOver) xtra.push('高さが内寸を超えるサイズあり');
        if (xtra.length) { if (widthOver || heightOver) state = 'over'; head += `<br>⚠️ ${xtra.join(' ／ ')}`; }
        sim.dataset.state = state;
        sim.innerHTML = head + `<small>必要長さ ${requiredLen}cm ／ 内寸長さ ${inner.l}cm　・　計${totalQty}個・幅方向${effCols}列で配置　※実機・本船制限・固縛は別途要確認</small>`;
      }
    }
    updateContainerSpec();
  };
  window.updateContainerSpec = function () {
    const cat  = document.querySelector('.cc-cat-tab.is-on')?.dataset.cat || 'dry';
    const sub  = document.querySelector('.cc-sub-tab.is-on')?.dataset.sub || 'rf';
    const vent = document.querySelector('#cc-rf-vent .cc-seg-btn.is-on')?.dataset.val || '無';
    const gv = id => (document.getElementById(id)?.value || '').trim();
    // OT/FR：積載先コンテナ（全行共通）＋各サイズ（実寸×個数）から一列積みを集計
    const over = (cargo, lim) => (cargo != null && lim != null && cargo > lim) ? +(cargo - lim).toFixed(1) : 0;
    const n = x => { const v = parseFloat(x); return Number.isFinite(v) ? v : null; };
    const ogRef = document.getElementById('cc-og-ref')?.value || "20'OT（オープントップ）";
    const ogCols = document.getElementById('cc-og-cols')?.value || 'auto';
    const inner = OTFR_INNER[ogRef] || OTFR_INNER["20'OT（オープントップ）"];
    const ogItems = [];
    let totalQty = 0, maxW = 0;
    const lengths = [];
    document.querySelectorAll('#ccOgList [data-og-row]').forEach(row => {
      const rv = sel => (row.querySelector(sel)?.value || '').trim();
      const l = rv('.og-l'), w = rv('.og-w'), h = rv('.og-h');
      if (!l && !w && !h) return;   // 空行は保存しない
      let qty = parseInt(rv('.og-qty'), 10); if (!Number.isFinite(qty) || qty < 1) qty = 1;
      totalQty += qty;
      if (n(w) != null && n(w) > maxW) maxW = n(w);
      if (n(l) != null) for (let i = 0; i < qty; i++) lengths.push(n(l));
      ogItems.push({
        l, w, h, qty: String(qty),
        ogW: String(over(n(w), inner.w) || ''),
        ogH: String(inner.h == null ? '' : (over(n(h), inner.h) || '')),
      });
    });
    // 幅方向の列数を考慮した必要長さ（最長レーン）
    const maxColsByWidth = (maxW > 0) ? Math.max(1, Math.floor(inner.w / maxW)) : null;
    let effCols;
    if (ogCols === 'auto') effCols = maxColsByWidth || 1;
    else { const req = parseInt(ogCols, 10) || 1; effCols = (maxColsByWidth != null) ? Math.min(req, maxColsByWidth) : req; }
    const requiredLen = +_packLaneLen(lengths, effCols).toFixed(1);
    const first = ogItems[0] || {};
    const spec = {
      cat, sub,
      rfTemp: gv('cc-rf-temp'),
      rfVent: vent,
      ogRef,                       // 積載先コンテナ（全サイズ共通）
      ogCols,                      // 幅方向の列数モード（auto/1/2/3）
      ogItems,                     // [{l,w,h,qty,ogW,ogH}]
      // 積載シミュレーション結果のサマリ（列数考慮）
      ogSim: { cols: effCols, requiredLen: String(requiredLen || ''), innerLen: inner.l, totalQty, fits: requiredLen <= inner.l },
      // 後方互換：先頭サイズを従来フィールドにもミラー
      cargoL: first.l || '', cargoW: first.w || '', cargoH: first.h || '',
      ogL: '', ogW: first.ogW || '', ogH: first.ogH || '',
    };
    const el = document.getElementById('cond-container-spec');
    if (el) el.value = JSON.stringify(spec);
    if (typeof window.renderQuoteCargoInfo === 'function') window.renderQuoteCargoInfo();
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
  };
  // 復元：仕様入力欄を埋め、カテゴリ／サブの表示を選択（保存値→無ければ本数から推定）
  function _applyContainerView() {
    let spec = {};
    try { spec = JSON.parse(document.getElementById('cond-container-spec')?.value || '{}') || {}; } catch (e) { spec = {}; }
    const setV = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    setV('cc-rf-temp', spec.rfTemp);
    // OT/FR：積載先コンテナ（全行共通）を復元。旧データ（行ごと ref）は先頭サイズの ref を採用
    const sharedRef = spec.ogRef
      || (Array.isArray(spec.ogItems) && spec.ogItems[0] && spec.ogItems[0].ref)
      || "20'OT（オープントップ）";
    if (document.getElementById('cc-og-ref')) document.getElementById('cc-og-ref').value = sharedRef;
    // 幅方向の列数モードを復元（旧データに無ければ自動）
    if (document.getElementById('cc-og-cols')) document.getElementById('cc-og-cols').value = spec.ogCols || 'auto';
    // 貨物サイズ（複数）を復元。旧形式（単一 cargoL/W/H）は1行に変換
    let ogItems = Array.isArray(spec.ogItems) ? spec.ogItems.slice() : [];
    if (!ogItems.length && (spec.cargoL || spec.cargoW || spec.cargoH)) {
      ogItems = [{ l: spec.cargoL || '', w: spec.cargoW || '', h: spec.cargoH || '', qty: '1' }];
    }
    const ogList = document.getElementById('ccOgList');
    if (ogList) {
      ogList.innerHTML = ogItems.map(it => _ogRowHTML(it)).join('');
      _ensureOgRows();   // 0件なら空行を1つ用意
    }
    document.querySelectorAll('#cc-rf-vent .cc-seg-btn').forEach(b =>
      b.classList.toggle('is-on', b.dataset.val === (spec.rfVent || '無')));
    const SPECIAL = ["20'RF（冷凍）","40'RF（冷凍）","20'OT（オープントップ）","40'OT（オープントップ）","20'FR（フラットラック）","40'FR（フラットラック）"];
    const OTFR = ["20'OT（オープントップ）","40'OT（オープントップ）","20'FR（フラットラック）","40'FR（フラットラック）"];
    const hasSpecial = _containerEntries.some(e => SPECIAL.includes(e.type) && e.count > 0);
    const hasOtfr = _containerEntries.some(e => OTFR.includes(e.type) && e.count > 0);
    _setCatUI(spec.cat || (hasSpecial ? 'special' : 'dry'));
    _setSubUI(spec.sub || (hasOtfr ? 'otfr' : 'rf'));
    if (typeof window.recalcOverGauge === 'function') window.recalcOverGauge();
  }
  window._applyContainerView = _applyContainerView;

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
    // R/T・CW は SharedCalc に一本化（docs/バグ台帳.md F）。
    // CW は 0.5kg 切上（IATA）で全画面統一。以前はこの主入口だけ丸めていなかった。
    const rt = SharedCalc.lclRt(totCbm, totKg);
    const cw = SharedCalc.airChargeableWeight(totKg, totVolWt);

    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setText('cdTotQty', totQty.toLocaleString());
    setText('cdTotCbm', totCbm > 0 ? totCbm.toFixed(3) + ' CBM' : '0.000');
    setText('cdTotKg',  totKg > 0 ? totKg.toLocaleString() + ' kg' : '0');
    setText('cdTotRt',  rt.toFixed(3));
    setText('cdTotCw',  SharedCalc.fmtCw(cw));  // 0.5kg 精度を保つ（Math.round だと 12.5→13）
    setText('cdTotCbmReflect', totCbm > 0 ? totCbm.toFixed(3) : '0.000');

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
    if (typeof _applyContainerView === 'function') _applyContainerView();
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
      const on = r.enabled !== false;
      const parts = [];
      if (r.pol) parts.push(_escMulti(r.pol));
      if (r.via) parts.push('<span class="z2-route-via">via:' + _escMulti(r.via) + '</span>');
      if (r.pod) parts.push(_escMulti(r.pod));
      const route = parts.length ? parts.join(' → ') : 'ポート未設定';
      return `<span class="z2-route-chip${on ? '' : ' z2-route-chip--off'}">`
        + `<button type="button" class="z2-route-toggle" onclick="toggleRouteEntry(${i})" title="${on ? '無効にする（一時停止）' : '有効にする'}">${on ? '✓' : '—'}</button>`
        + `<span class="z2-route-carrier">${_escMulti(r.carrier || '—')}</span>`
        + (r.service ? `<span class="z2-route-service">${_escMulti(r.service)}</span>` : '')
        + `<span class="z2-route-leg">${route}</span>`
        + (r.tt ? `<span class="z2-route-tt" title="Transit Time（所要日数）">⏱️ ${_escMulti(r.tt)}</span>` : '')
        + `<button type="button" class="z2-route-edit" onclick="editRouteEntry(${i})" title="編集（フォームに書き戻す）">✎</button>`
        + `<button type="button" class="me-chip-del" onclick="removeRouteEntry(${i})" title="削除">×</button></span>`;
    }).join('');
    if (typeof window.renderQuoteCarrierLinks === 'function') window.renderQuoteCarrierLinks();
    // パターン入力の候補（ptSuggestions）に航路（POL→via→POD）を供給：表記揺れ防止
    const dl = document.getElementById('ptSuggestions');
    if (dl) {
      const seen = new Set(), opts = [];
      _routeEntries.forEach(r => {
        const s = [r.pol, r.via, r.pod].map(x => (x || '').trim()).filter(Boolean).join(' → ');
        if (s && !seen.has(s)) { seen.add(s); opts.push(s); }
      });
      dl.innerHTML = opts.map(s => `<option value="${_escMulti(s)}"></option>`).join('');
    }
  }

  function addRouteEntry() {
    const carrier = (document.getElementById('z2Carrier')?.value || '').trim();
    const service = (document.getElementById('z2Service')?.value || '').trim();
    const pol = (document.getElementById('z2Pol')?.value || '').trim();
    const via = (document.getElementById('z2Via')?.value || '').trim();
    const pod = (document.getElementById('z2Pod')?.value || '').trim();
    const tt  = (document.getElementById('z2Tt')?.value || '').trim();
    if (!carrier && !pol && !pod) {
      if (typeof quoteShowToast==='function') quoteShowToast('⚠️ キャリアまたはPOL/PODを入力してください', 'warn', 1800);
      return;
    }
    _routeEntries.push({ carrier, service, pol, via, pod, tt, enabled: true });
    _renderRouteEntries();
    // キャリア・サービス名・T/T をクリアして次の入力へ（POL/POD は同じ航路に別キャリアを追加できるよう保持）
    const carrierEl = document.getElementById('z2Carrier');
    if (carrierEl) { carrierEl.value = ''; }
    const serviceEl = document.getElementById('z2Service');
    if (serviceEl) { serviceEl.value = ''; }
    const ttEl = document.getElementById('z2Tt');
    if (ttEl) { ttEl.value = ''; }
    if (typeof onZ2CarrierChange === 'function') onZ2CarrierChange();
    document.getElementById('z2Carrier')?.focus();
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
    if (typeof scheduleSnapshot === 'function') scheduleSnapshot();
    _triggerCarrierBmFetch();
  }

  function removeRouteEntry(i) {
    _routeEntries.splice(i, 1);
    _renderRouteEntries();
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
    if (typeof scheduleSnapshot === 'function') scheduleSnapshot();
    _triggerCarrierBmFetch();
  }
  function toggleRouteEntry(i) {
    if (!_routeEntries[i]) return;
    _routeEntries[i] = Object.assign({}, _routeEntries[i], { enabled: _routeEntries[i].enabled === false });
    _renderRouteEntries();
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
    if (typeof scheduleSnapshot === 'function') scheduleSnapshot();
  }
  function editRouteEntry(i) {
    const r = _routeEntries[i];
    if (!r) return;
    // フォームへ書き戻し
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    set('z2Carrier', r.carrier);
    set('z2Service', r.service);
    set('z2Pol', r.pol);
    set('z2Via', r.via);
    set('z2Pod', r.pod);
    set('z2Tt', r.tt);
    // エントリを削除して再描画
    _routeEntries.splice(i, 1);
    _renderRouteEntries();
    if (typeof onZ2CarrierChange === 'function') onZ2CarrierChange();
    document.getElementById('z2Carrier')?.focus();
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
    if (typeof scheduleSnapshot === 'function') scheduleSnapshot();
  }
  window.toggleRouteEntry = toggleRouteEntry;
  window.editRouteEntry   = editRouteEntry;
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
    _triggerCarrierBmFetch();
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
    // transport: 'fcl' | 'lcl' | 'air' | 'domestic'
    if (transport === 'fcl' || transport === 'lcl') {
      _currentTransport = 'sea';
      _currentSeaSub = transport;
    } else if (transport === 'domestic') {
      _currentTransport = 'domestic';   // 国内手配のみ（国際輸送なし・記録用）
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
    } else if (_currentTransport === 'domestic') {
      sel.value = '国内手配のみ';
    } else {
      sel.value = '';
    }
    sel.dispatchEvent(new Event('change'));
  }

  /** 現在の輸送モードに対応するキャリアマップを返す */
  function _carrierMapForMode() {
    if (_currentTransport === 'domestic') return {};   // 国内手配のみは船社/航空会社なし
    if (_currentTransport === 'air') return (typeof CARRIERS_AIR !== 'undefined') ? CARRIERS_AIR : {};
    if (_currentSeaSub === 'lcl')    return (typeof CARRIERS_LCL !== 'undefined') ? CARRIERS_LCL : {};
    return (typeof CARRIERS !== 'undefined') ? CARRIERS : {};
  }

  /** 現在の輸送モードに対応するリンク定義を返す */
  function _linkDefsForMode() {
    const defs = (typeof CARRIER_LINK_DEFS !== 'undefined') ? CARRIER_LINK_DEFS : {};
    if (_currentTransport === 'domestic') return [];   // 国内手配のみはキャリアリンクなし
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
  // A-1: z2 キャリア名を収集して QSP 用ブックマームを非同期フェッチ
  function _triggerCarrierBmFetch() {
    if (typeof window.fetchCarrierBmsForQSP !== 'function') return;
    const names = [];
    // z2: 幹線キャリア（有効航路のみ）
    if (_routeEntries && _routeEntries.length) {
      _routeEntries.filter(r => r.enabled !== false).forEach(r => { if (r.carrier && !names.includes(r.carrier)) names.push(r.carrier); });
    }
    const cur = (document.getElementById('z2Carrier')?.value || '').trim();
    if (cur && !names.includes(cur)) names.push(cur);
    // z1/z3: デフォルトサブコン
    const sc1 = (document.getElementById('z1DefaultSc')?.value || '').trim();
    if (sc1 && !names.includes(sc1)) names.push(sc1);
    const sc3 = (document.getElementById('z3DefaultSc')?.value || '').trim();
    if (sc3 && !names.includes(sc3)) names.push(sc3);
    if (names.length) window.fetchCarrierBmsForQSP(names);
  }

  function onZ2CarrierChange() {
    const panel = document.getElementById('z2CarrierLinks');
    const done = () => {
      _triggerCarrierBmFetch();
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
      _routeEntries.filter(r => r.enabled !== false).forEach(r => { if (r.carrier && !names.includes(r.carrier)) names.push(r.carrier); });
    }
    const cur = (document.getElementById('z2Carrier')?.value || '').trim();
    if (cur && !names.includes(cur)) names.push(cur);
    const bmCache = window._qspBmCache || {};
    // 全面クラウド移行（フェーズ3）：内蔵DBの静的リンクは廃止し、クラウドの
    // ブックマーク（内蔵リンクをシード済み＋ユーザー追加）のみを唯一の真実として表示。
    // 各チップは bmId 経由で編集可能。icon のみ内蔵DBから流用。
    return names.map(name => {
      const c = map[name];
      const links = (bmCache[name] || []).filter(bm => bm.url).map(bm => ({
        label: bm.label, url: bm.url, title: bm.note || bm.label, isUserBm: true,
        bmId: bm.id, carrier: name, type: bm.carrier_type, fn: bm.function, note: bm.note,
      }));
      return { name, icon: c?.icon || '', links };
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
    // 対象キャリア名を収集（有効航路のみ）
    const names = [];
    if (_routeEntries && _routeEntries.length) {
      _routeEntries.filter(r => r.enabled !== false).forEach(r => { if (r.carrier && !names.includes(r.carrier)) names.push(r.carrier); });
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



// 選択した行オブジェクト配列を現在のテーブル末尾に追加する
window.appendQuoteRows = function(rowObjects) {
  if (!rowObjects || !rowObjects.length) return 0;
  const data = migrateRowCells({ rows: rowObjects, _rowFormat: 'v3-mixed-rows' });
  const tbody = document.getElementById('tableBody');
  if (!tbody) return 0;
  const regularTrs = [];
  data.rows.forEach(row => {
    if (!row) return;
    if (row._type === 'subtotal') {
      insertSubtotalRow(null);
      const tr = tbody.lastElementChild;
      const lbl = tr?.querySelector('.subtotal-label');
      if (lbl) lbl.value = row.label || '';
      return;
    }
    if (row._type === 'remark') {
      insertRemarkRow(null, { internal: row.internal });
      const tr = tbody.lastElementChild;
      const inp = tr?.querySelector('.remark-row-input');
      if (inp) inp.value = row.text || '';
      return;
    }
    if (row._type === 'internal') {
      insertInternalRow(null, { noFocus: true });
      const tr = tbody.lastElementChild;
      const inp = tr?.querySelector('.internal-row-input');
      if (inp) inp.value = row.text || '';
      return;
    }
    const cells = row.cells || [];
    addRow();
    const tr = tbody.lastElementChild;
    _applyCells(tr, cells);
    regularTrs.push(tr);
  });
  _afterRestoreRows(regularTrs, {});
  if (typeof calcLiveUpdate === 'function') calcLiveUpdate();
  return data.rows.length;
};

// ---------- 物量計算結果を見積テーブルに反映 ----------
// key: 'rt' → 単位 RT の行、'cw' → 単位 KG の行、'cbm' → 単位 M3/CBM の行
window.reflectToQuote = function(key) {
  const m = _lastCargoMetrics;
  if (!m || (m.rt === 0 && m.cw === 0 && m.cbm === 0)) {
    if (typeof quoteShowToast === 'function') quoteShowToast('先に物量情報を入力してください', 'warn');
    return;
  }
  const round3 = v => String(Math.round(v * 1000) / 1000);
  const config = {
    rt:  { value: m.rt,  label: 'R/T',  fmt: round3,  units: ['RT', 'R/T'] },
    cw:  { value: m.cw,  label: 'CW',   fmt: String,   units: ['KG', 'CW'] },
    cbm: { value: m.cbm, label: 'CBM',  fmt: round3,  units: ['M3', 'CBM', 'M³'] },
  };
  const cfg = config[key];
  if (!cfg || !cfg.value) {
    if (typeof quoteShowToast === 'function') quoteShowToast('反映する値がありません', 'warn');
    return;
  }
  const displayVal  = cfg.fmt(cfg.value);
  const targetsUpper = cfg.units.map(u => u.toUpperCase());
  let count = 0;
  document.querySelectorAll('#tableBody tr[id^="row-"]').forEach(tr => {
    const id = tr.id.replace('row-', '');
    const unEl = document.getElementById('un-' + id);
    if (!unEl || !targetsUpper.includes((unEl.value || '').trim().toUpperCase())) return;
    const pqEl = document.getElementById('pq-' + id);
    if (pqEl) {
      pqEl.value = displayVal;
      if (typeof onPay === 'function') onPay(parseInt(id, 10));
    } else {
      const bqEl = document.getElementById('bq-' + id);
      if (bqEl) bqEl.value = displayVal;
    }
    count++;
  });
  if (typeof quoteShowToast === 'function') {
    if (count === 0)
      quoteShowToast('単位「' + cfg.units.join(' / ') + '」の行が見つかりませんでした', 'warn', 3000);
    else {
      if (typeof calcLiveUpdate === 'function') calcLiveUpdate();
      quoteShowToast(cfg.label + ' (' + displayVal + ') を ' + count + ' 行に反映しました', 'success', 3000);
    }
  }
};
