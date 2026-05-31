// ========== UI・共通 (app-ui.js) ==========

  // ========== リマーク欄 ==========
  const PRESETS = [
    { label: '📅 有効期限',        text: '本見積もりの有効期限は発行日より30日間とします。' },
    { label: '💱 為替変動',        text: '外貨建て料金は見積もり時の為替レートを基準としており、船積み時のレートにより変動します。' },
    { label: '⛽ 燃油サーチャージ', text: '燃油サーチャージ（BAF/FAF）は市況により変動します。適用時点のレートを別途申し受けます。' },
    { label: '🚢 スペース確保',     text: '船腹・航空スペースの確保は保証できません。手配状況により変更となる場合があります。' },
    { label: '📦 重量・容積',      text: '運賃はW/Mの高い方を適用します（海上：1CBM＝1,000kg、航空：1CBM＝167kg）。' },
    { label: '🛃 通関費用',        text: '通関費用・関税・消費税等は本見積もりに含まれておりません。' },
    { label: '🛡️ 貨物保険',       text: '貨物保険料は含まれておりません。付保をご希望の場合は別途ご相談ください。' },
    { label: '⚓ 港湾混雑',        text: '港湾混雑・ストライキ・天災等による遅延・追加費用は含まれておりません。' },
    { label: '☣️ 危険品',         text: '危険品・温度管理貨物・特殊貨物については別途ご相談ください。条件が異なります。' },
    { label: '🔄 条件変更',        text: '貨物の内容・数量・仕向地等に変更が生じた場合は再見積となります。' },
    { label: '📋 書類締切',        text: 'B/L・AWB等の書類提出締め切りは船会社・航空会社の指定期日に従います。遅延の場合は追加費用が発生します。' },
    { label: '🏦 支払条件',        text: '支払いは請求書発行後30日以内とします。期日を超過した場合、法定利率（民法所定）による遅延損害金が発生します。（※社内標準条件に書き換えてからご使用ください）' },
  ];


  // ----- ユーザー定義プリセット（localStorage） -----
  const USER_REMARK_PRESETS_KEY = 'quoteRemarkUserPresets_v1';
  function getUserRemarkPresets() {
    try { return JSON.parse(localStorage.getItem(USER_REMARK_PRESETS_KEY) || '[]'); }
    catch(e) { return []; }
  }
  function saveUserRemarkPresets(arr) {
    localStorage.setItem(USER_REMARK_PRESETS_KEY, JSON.stringify(arr));
  }

  // 全プリセット = 固定 + ユーザー定義
  function getAllRemarkPresets() {
    return [...PRESETS, ...getUserRemarkPresets().map(p => ({ ...p, _user: true }))];
  }

  function initRemarks() {
    renderRemarkPresets();
    document.getElementById('remarkTextarea').addEventListener('input', updateRemarkChar);
    updateRemarkChar();
  }

  function renderRemarkPresets() {
    const wrap = document.getElementById('presetBtns');
    if (!wrap) return;
    wrap.innerHTML = '';
    const all = getAllRemarkPresets();
    all.forEach((p, i) => {
      const btn = document.createElement('button');
      btn.className = 'preset-btn' + (p._user ? ' preset-btn-user' : '');
      btn.dataset.index = i;
      btn.title = p.text;
      const lbl = document.createElement('span');
      lbl.textContent = p.label;
      btn.appendChild(lbl);
      // ユーザー定義は削除ボタン付き
      if (p._user) {
        const xBtn = document.createElement('span');
        xBtn.className = 'preset-btn-del';
        xBtn.textContent = '✕';
        xBtn.title = 'このプリセットを削除';
        xBtn.onclick = (e) => {
          e.stopPropagation();
          deleteUserRemarkPreset(p.label);
        };
        btn.appendChild(xBtn);
      }
      btn.onclick = () => togglePreset(i, btn);
      wrap.appendChild(btn);
    });
    // 「＋ プリセットを追加」ボタン
    const addBtn = document.createElement('button');
    addBtn.className = 'preset-btn preset-btn-add';
    addBtn.textContent = '＋ プリセットを追加';
    addBtn.onclick = () => addUserRemarkPreset();
    wrap.appendChild(addBtn);
  }

  function addUserRemarkPreset() {
    const label = prompt('プリセットのラベル名を入力してください（例：📄 特別条件）');
    if (!label || !label.trim()) return;
    const text = prompt('プリセットの本文を入力してください');
    if (!text || !text.trim()) return;
    const arr = getUserRemarkPresets();
    if (arr.some(p => p.label === label.trim())) {
      quoteShowToast('⚠️ 同名のラベルが既にあります', 'warn');
      return;
    }
    arr.push({ label: label.trim(), text: text.trim() });
    saveUserRemarkPresets(arr);
    renderRemarkPresets();
    quoteShowToast(`✅ 「${label.trim()}」を追加しました`, 'success');
  }

  function deleteUserRemarkPreset(label) {
    if (!confirm(`「${label}」を削除しますか？`)) return;
    const arr = getUserRemarkPresets().filter(p => p.label !== label);
    saveUserRemarkPresets(arr);
    renderRemarkPresets();
    quoteShowToast(`🗑️ 「${label}」を削除しました`, 'info');
  }

  function togglePreset(i, btn) {
    const ta = document.getElementById('remarkTextarea');
    const all = getAllRemarkPresets();
    const text = all[i]?.text;
    if (!text) return;
    if (btn.classList.contains('active')) {
      ta.value = ta.value.split('\n').filter(l => l.trim() !== text.trim()).join('\n').replace(/^\n+|\n+$/g, '');
      btn.classList.remove('active');
    } else {
      const cur = ta.value.trim();
      ta.value = cur ? cur + '\n' + text : text;
      btn.classList.add('active');
    }
    updateRemarkChar();
  }

  function clearRemark() {
    const ta = document.getElementById('remarkTextarea');
    const prev = ta.value;
    ta.value = '';
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    updateRemarkChar();
    quoteShowToast('リマーク欄をクリアしました', 'info', 4000);
  }

  function updateRemarkChar() {
    document.getElementById('remarkChar').textContent =
      `${document.getElementById('remarkTextarea').value.length}文字`;
  }


  function getRemarkText() {
    return document.getElementById('remarkTextarea')?.value.trim() || '';
  }

  function csvEsc(v) {
    const s = String(v == null ? '' : v);
    return (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r'))
      ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function fmtRaw(n) {
    if (isNaN(n) || n === null) return '';
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
  }

  // 画面表示用の金額フォーマッタ（3桁カンマ区切り）。docs/バグ台帳.md E
  //   - 金額セル（小計・利益・単価・JPY換算・税額・乗せ幅・合計）に使う。
  //   - 数量は対象外（fmtRaw のまま）。
  //   - CSV/TSV エクスポートには使わない（カンマが区切りと衝突するため fmtRaw を維持）。
  //   - 空/NaN は fmtRaw と同じく空文字（'—' は呼び出し側の判断に委ねる）。
  function fmtMoney(n) {
    if (n === null || n === undefined || isNaN(n)) return '';
    return Number(n).toLocaleString('ja-JP', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ========== テーブル上部 為替レートバー ==========
  // JPY換算に使われている非JPY通貨のレートをコンパクト表示
  window.renderQuoteFxBar = function() {
    const bar = document.getElementById('quoteFxBar');
    if (!bar) return;
    // テーブル内で使用中の通貨を収集
    const used = new Set();
    document.querySelectorAll('#tableBody tr').forEach(tr => {
      const id = tr.id.replace('row-', '');
      const pc = document.getElementById(`pc-${id}`)?.value;
      const bc = document.getElementById(`bc-${id}`)?.value;
      if (pc && pc !== 'JPY') used.add(pc);
      if (bc && bc !== 'JPY') used.add(bc);
    });
    const order = ['USD','EUR','GBP','CNY'];
    const list = [...used].sort((a,b)=>order.indexOf(a)-order.indexOf(b));
    if (!list.length) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
    bar.style.display = 'flex';
    const auto = (typeof _fxAutoMode !== 'undefined' && _fxAutoMode);
    bar.innerHTML = '<span class="fx-bar-icon">💱 換算レート</span>'
      + list.map(c => {
          const r = (typeof _fxRates !== 'undefined' && _fxRates[c]) ? _fxRates[c] : null;
          return `<span class="fx-bar-rate"><b>1 ${c}</b> = ${r ? r.toLocaleString() : '—'} 円</span>`;
        }).join('')
      + `<span class="fx-bar-src">${auto ? '🔄 自動取得' : '✎ 手動'}</span>`
      + `<button type="button" class="fx-bar-edit" onclick="document.getElementById('fxRateDetails').open=true; renderFxPanel(); document.getElementById('fxRateDetails').scrollIntoView({block:'center',behavior:'smooth'});" title="為替レートを編集">設定</button>`;
  };

  // ========== 為替レートパネル ==========
  function renderFxPanel() {
    const grid = document.getElementById('fxRateGrid');
    if (!grid) return;
    // 自動/手動モードのトグルを更新
    const autoChk = document.getElementById('fxAutoModeChk');
    if (autoChk) autoChk.checked = _fxAutoMode;
    // 最終取得日時を更新
    const lastFetched = localStorage.getItem(SharedStorage.KEYS.FX_LAST_FETCHED);
    const lastEl = document.getElementById('fxLastFetched');
    if (lastEl) {
      lastEl.textContent = lastFetched
        ? '最終取得: ' + new Date(lastFetched).toLocaleString('ja-JP', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })
        : '未取得（デフォルト値）';
    }
    // レート入力グリッドを再描画（USD/EUR/GBP/CNY のみ表示）
    const displayCurs = (typeof FX_DISPLAY_CURRENCIES !== 'undefined' && FX_DISPLAY_CURRENCIES.length)
      ? FX_DISPLAY_CURRENCIES
      : CURRENCIES.filter(c => c !== 'JPY');
    grid.innerHTML = displayCurs.map(cur => `
      <div class="fx-rate-item">
        <label class="fx-rate-lbl">${cur} =</label>
        <input type="number" class="fx-rate-inp" data-cur="${cur}"
               min="0" step="0.01" value="${_fxRates[cur] || ''}"
               placeholder="レート"
               oninput="updateFxRate('${cur}', this.value)" />
        <span class="fx-rate-unit">JPY</span>
      </div>`).join('');
  }

  function updateFxRate(cur, val) {
    const trimmed = (val == null ? '' : String(val)).trim();
    if (trimmed === '') {
      // 空欄にしたらデフォルトレートへ戻す（表示と計算の食い違いを防ぐ。docs/バグ台帳.md の N）
      if (DEFAULT_FX_RATES[cur] != null) _fxRates[cur] = DEFAULT_FX_RATES[cur];
      saveFxRates();
      updateTotals();
      if (typeof renderFxPanel === 'function') renderFxPanel(); // 欄にデフォルト値を再表示
      return;
    }
    const v = parseFloat(trimmed);
    if (v > 0) {
      _fxRates[cur] = v;
      saveFxRates();
      updateTotals();
    }
    // 0・負値・非数は無視（不正レートで合計を壊さない）
  }

  async function doFetchFxRates() {
    const btn = document.getElementById('fxFetchBtn');
    if (btn) { btn.disabled = true; btn.textContent = '取得中…'; }
    const ok = await fetchAutoFxRates();
    renderFxPanel();
    updateTotals();
    if (btn) { btn.disabled = false; btn.textContent = '🔄 今すぐ取得'; }
    quoteShowToast(ok ? '✅ 為替レートを更新しました' : '⚠️ 取得失敗。デフォルト値を使用します', ok ? 'success' : 'warn', 3000);
  }

  function onFxAutoModeChange(checked) {
    setFxAutoMode(checked);
    if (checked) {
      doFetchFxRates();
    }
  }

  // ========== カスタムカテゴリ管理 ==========
  // カテゴリ色セット（5色ローテーション）
  const USER_CAT_CLASSES = ['cat-user-a','cat-user-b','cat-user-c','cat-user-d','cat-user-e'];

  function renderUserCatPanel() {
    const cats = getUserCategories();
    const list = document.getElementById('userCatList');
    if (!list) return;
    if (!cats.length) {
      list.innerHTML = '<span style="color:#aaa;font-size:12px;">カスタムカテゴリなし</span>';
      return;
    }
    list.innerHTML = cats.map(c =>
      `<span class="user-cat-chip ${c.cls || ''}">${escHtml(c.label)}
         <button class="user-cat-del" onclick="doDeleteUserCat('${c.value}')" title="削除">✕</button>
       </span>`
    ).join('');
  }

  function doAddUserCat() {
    const input = document.getElementById('newCatInput');
    const label = input?.value.trim();
    if (!label) { quoteShowToast('⚠️ カテゴリ名を入力してください', 'warn'); return; }
    const cats = getUserCategories();
    if (cats.some(c => c.label === label)) { quoteShowToast('⚠️ 同名のカテゴリが既にあります', 'warn'); return; }
    const cls = USER_CAT_CLASSES[cats.length % USER_CAT_CLASSES.length];
    const value = 'user-' + Date.now();
    cats.push({ value, label, cls });
    saveUserCategories(cats);
    if (input) input.value = '';
    renderUserCatPanel();
    refreshAllCategoryDropdowns();
    quoteShowToast(`✅ カテゴリ「${label}」を追加しました`, 'success');
  }

  function doDeleteUserCat(value) {
    const cats = getUserCategories();
    const cat = cats.find(c => c.value === value);
    if (!cat) return;
    if (!confirm(`「${cat.label}」を削除しますか？\n（このカテゴリが設定されている行は「未設定」になります）`)) return;
    saveUserCategories(cats.filter(c => c.value !== value));
    renderUserCatPanel();
    refreshAllCategoryDropdowns();
    quoteShowToast(`🗑️ 「${cat.label}」を削除しました`, 'info');
  }

  function refreshAllCategoryDropdowns() {
    document.querySelectorAll('#tableBody tr').forEach(tr => {
      const id = tr.id.replace('row-', '');
      const sel = document.getElementById(`cat-${id}`);
      if (!sel) return;
      const curVal = sel.value;
      sel.innerHTML = catOpts(curVal);
    });
    refreshBulkCatSelect();
  }

  // 「選択行 → カテゴリ一括変更」用セレクトを最新カテゴリで再構築
  function refreshBulkCatSelect() {
    const sel = document.getElementById('bulkCatSelect');
    if (!sel) return;
    const curVal = sel.value;
    const userCats = getUserCategories();
    let html = '<option value="__none__">— カテゴリを選択 —</option>';
    // 既定カテゴリ（先頭の「— カテゴリ —」= 未設定 を含む）
    html += CATEGORIES.map(c =>
      `<option value="${c.value}"${c.value === curVal ? ' selected' : ''}>${c.label}</option>`
    ).join('');
    if (userCats.length) {
      html += '<option value="" disabled>──────────</option>';
      html += userCats.map(c =>
        `<option value="${c.value}"${c.value === curVal ? ' selected' : ''}>${c.label}</option>`
      ).join('');
    }
    sel.innerHTML = html;
  }

  // bulkCatSelect で選んだカテゴリの行をすべてチェック（小計行を除く）
  function selectByCategory() {
    const sel = document.getElementById('bulkCatSelect');
    if (!sel) return;
    if (sel.value === '__none__') {
      quoteShowToast('⚠️ 対象カテゴリを選んでください', 'warn', 3000);
      return;
    }
    const target = sel.value;
    let matched = 0;
    let totalChkRows = 0;
    document.querySelectorAll('#tableBody tr').forEach(tr => {
      if (tr.dataset.type === 'subtotal' || tr.dataset.type === 'remark') return;
      const chk = tr.querySelector('.row-select-chk');
      if (!chk) return;
      totalChkRows++;
      const id = tr.id.replace('row-', '');
      const cat = document.getElementById(`cat-${id}`)?.value || '';
      if (cat === target) {
        chk.checked = true;
        matched++;
      } else {
        chk.checked = false;
      }
    });
    // ヘッダー全選択チェックは「すべての対象行が一致したとき」のみ ON
    const allChk = document.getElementById('selectAllChk');
    if (allChk) allChk.checked = matched > 0 && matched === totalChkRows;
    const catLabel = getAllCategories().find(c => c.value === target)?.label || '— カテゴリ —';
    if (matched === 0) {
      quoteShowToast(`ℹ️ 「${catLabel}」の行はありません`, 'info', 3000);
    } else {
      quoteShowToast(`✅ 「${catLabel}」の ${matched} 行を選択しました`, 'success');
    }
  }

  // チェック済み行のカテゴリを一括変更
  function applyBulkCategory() {
    const sel = document.getElementById('bulkCatSelect');
    if (!sel) return;
    if (sel.value === '__none__') {
      quoteShowToast('⚠️ 適用するカテゴリを選んでください', 'warn', 3000);
      return;
    }
    const checkboxes = document.querySelectorAll('.row-select-chk:checked');
    if (!checkboxes.length) {
      quoteShowToast('⚠️ カテゴリを変更したい行のチェックボックスにチェックを入れてください', 'warn', 3000);
      return;
    }
    const newCat = sel.value;
    let count = 0;
    checkboxes.forEach(chk => {
      const tr = chk.closest('tr');
      if (!tr) return;
      const id = tr.id.replace('row-', '');
      const catSel = document.getElementById(`cat-${id}`);
      if (!catSel) return;
      catSel.value = newCat;
      if (typeof onCatChange === 'function') onCatChange(id);
      count++;
    });
    // 元行のチェックを外し、全選択もリセット、セレクトもプレースホルダへ戻す
    checkboxes.forEach(chk => { chk.checked = false; });
    const allChk = document.getElementById('selectAllChk');
    if (allChk) allChk.checked = false;
    sel.value = '__none__';
    const catLabel = getAllCategories().find(c => c.value === newCat)?.label || '— カテゴリ —';
    quoteShowToast(`🏷️ ${count}行のカテゴリを「${catLabel}」に変更しました`, 'success');
  }

  // ========== 一括コピー機能 ==========
  function copySelectedRows() {
    const checkboxes = document.querySelectorAll('.row-select-chk:checked');
    if (!checkboxes.length) {
      quoteShowToast('⚠️ コピーしたい行のチェックボックスにチェックを入れてください', 'warn', 3000);
      return;
    }
    const tbody = document.getElementById('tableBody');
    // querySelectorAll は document order を返すので、元の並びを保持
    const srcRows = Array.from(checkboxes).map(chk => chk.closest('tr')).filter(Boolean);
    // 最後の選択行の直後を起点に、新行を順番に追加していく（anchor を更新して並び順を保持）
    let anchor = srcRows[srcRows.length - 1];
    srcRows.forEach(srcTr => {
      rowCount++;
      const newId = rowCount;
      const srcId = srcTr.id.replace('row-', '');
      // 元行の値を読み取る
      const srcInputs = srcTr.querySelectorAll('input, select, textarea');
      const cells = Array.from(srcInputs).map(el => el.value);
      const newTr = document.createElement('tr');
      newTr.id = `row-${newId}`;
      const srcCat = document.getElementById(`cat-${srcId}`)?.value || '';
      const srcCur = document.getElementById(`pc-${srcId}`)?.value  || 'JPY';
      newTr.replaceChildren(buildRowHTML(newId, srcCat, srcCur));
      // anchor の直後に挿入し、anchor を新行に更新（次の新行はさらにその後ろ）
      if (anchor.nextSibling) tbody.insertBefore(newTr, anchor.nextSibling);
      else tbody.appendChild(newTr);
      anchor = newTr;
      // 値を復元
      newTr.querySelectorAll('input, select, textarea').forEach((el, j) => {
        if (cells[j] !== undefined) el.value = cells[j];
      });
      initDrag(newTr);
      checkUnfilled(newId);
      onCatChange(newId);
      onPay(newId);
      // チェックを外す
      const chk = newTr.querySelector('.row-select-chk');
      if (chk) chk.checked = false;
    });
    // 元行のチェックも外す
    checkboxes.forEach(chk => { chk.checked = false; });
    // ヘッダーの全選択チェックをリセット
    const allChk = document.getElementById('selectAllChk');
    if (allChk) allChk.checked = false;
    updateTotals();
    quoteShowToast(`📋 ${srcRows.length}行をコピーしました`, 'success');
  }

  // ========== 選択行削除 ==========
  function deleteSelectedRows() {
    const checkboxes = document.querySelectorAll('.row-select-chk:checked');
    if (!checkboxes.length) {
      quoteShowToast('⚠️ 削除したい行のチェックボックスにチェックを入れてください', 'warn', 3000);
      return;
    }
    const rows = Array.from(checkboxes).map(chk => chk.closest('tr')).filter(Boolean);
    rows.forEach(tr => tr.remove());
    const allChk = document.getElementById('selectAllChk');
    if (allChk) allChk.checked = false;
    updateTotals();
    quoteShowToast(`🗑️ ${rows.length}行を削除しました`, 'info');
  }

  // ========== 全選択トグル ==========
  function toggleSelectAll(checked) {
    document.querySelectorAll('.row-select-chk').forEach(chk => {
      chk.checked = checked;
    });
  }

  // ========== 初期化 ==========
  // Phase 2b：トップレベル即時実行 → initQuoteState() に集約し initQuoteTab() から呼ぶ
  function initQuoteState() {
    initRemarks();
    addCalcRow();  // サイズ計算：初期行
    addRow();      // 見積もり：初期行
    initFormulaInputs();    // フォーミュラ評価初期化
    // 自動保存の復元
    const savedAutoSave = localStorage.getItem('autoSaveEnabled');
    if (savedAutoSave === '1') {
      autoSaveEnabled = true;
      const chk = document.getElementById('autoSaveChk');
      if (chk) chk.checked = true;
    }
    // Tabで行追加 設定の復元（デフォルト ON）
    const savedTabAdd = localStorage.getItem('tabAddEnabled');
    if (savedTabAdd === '0') {
      tabAddEnabled = false;
      const chk = document.getElementById('tabAddChk');
      if (chk) chk.checked = false;
    }
    // 自動保存データがある場合、復元バナーを表示
    if (localStorage.getItem('quoteData')) {
      const bar = document.getElementById('autosave-restore-bar');
      if (bar) setTimeout(() => bar.classList.add('show'), 600);
    }
    // carriers-dl datalist をモードに合わせて初期化（conditions.js）
    if (typeof _refreshCarrierDatalist === 'function') _refreshCarrierDatalist();
    // カスタムカテゴリパネルを描画
    renderUserCatPanel();
    // 為替レート：自動モードなら起動時に取得
    if (_fxAutoMode) {
      fetchAutoFxRates().then(ok => {
        if (ok) updateTotals();
      });
    }
    // Undo/Redo 履歴の初期化（初期スナップショットを採取し input/mutation 監視を開始）
    if (typeof initQuoteHistory === 'function') initQuoteHistory();
  }

  // ========== トースト通知 ==========
  function quoteShowToast(msg, type = 'info', duration = 2800) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    container.appendChild(el);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => el.classList.add('visible'));
    });
    setTimeout(() => {
      el.classList.remove('visible');
      setTimeout(() => el.remove(), 320);
    }, duration);
  }

  // ========== コマンドパレット ==========
  const CMD_LIST = [
    { icon:'🗂️', label:'管理番号入力セクションへ',  sub:'REF # / 引き合い元 / 担当',     action:() => scrollToSection('section-ref')   },
    { icon:'🚢', label:'引き合い条件・貨物情報セクションへ', sub:'ルート・貨物名・CBM・CW 自動計算', action:() => scrollToSection('section-cond') },
    { icon:'💴', label:'見積もり表セクションへ',      sub:'費用行の入力・集計',              action:() => scrollToSection('section-table') },
    { icon:'📋', label:'特記事項セクションへ',        sub:'フリーテキスト欄',               action:() => scrollToSection('section-free')  },
    { icon:'📝', label:'条件・リマークセクションへ',  sub:'プリセット文を挿入',             action:() => scrollToSection('section-remark')},
    { icon:'➕', label:'行を追加',                    sub:'見積もり表に新しい行を末尾に追加', action:() => { addRow(); quoteShowToast('✅ 行を追加しました', 'success'); } },
    { icon:'📋', label:'現在行を複製 (Ctrl+D)',        sub:'フォーカス中の行を直下に複製',     action:() => {
      const tr = document.activeElement?.closest('#tableBody tr');
      if (tr && tr.id.startsWith('row-')) {
        duplicateRow(tr.id.replace('row-', ''));
        quoteShowToast('✅ 行を複製しました', 'success');
      } else {
        quoteShowToast('⚠️ 行にフォーカスを当ててから実行してください', 'warn', 2500);
      }
    }},
    { icon:'↕️', label:'カテゴリ順に並び替え',        sub:'カテゴリ種別でソート',            action:() => { sortByCategory(); quoteShowToast('✅ ソートしました', 'success'); } },
    { icon:'👁️', label:'プレビューを開く',            sub:'印刷・コピー用のプレビュー',      action: openPreview },
    { icon:'🗂️', label:'プリセット/一時保存',         sub:'入力パターンの保存・呼び出し・一時退避', action: openPresetMgr },
    { icon:'⬇',  label:'CSV ダウンロード',            sub:'見積もり行をCSVファイルとして保存', action: downloadCSV },
    { icon:'🔀', label:'カテゴリ順にソート',          sub:'カテゴリ種別でテーブルを並び替え', action: sortByCategory },
    { icon:'🗑️', label:'全行リセット',               sub:'見積もり表の全行を削除してリセット', action: resetAll },
  ];
  let _cmdActiveIdx = -1;
  let _cmdFiltered  = CMD_LIST;

  function openCmdPalette() {
    const pal = document.getElementById('cmdPalette');
    pal.classList.add('open');
    const inp = document.getElementById('cmdInput');
    inp.value = '';
    _cmdFiltered = CMD_LIST;
    _cmdActiveIdx = 0;
    renderCmdList();
    setTimeout(() => inp.focus(), 40);
  }

  function closeCmdPalette() {
    document.getElementById('cmdPalette').classList.remove('open');
    _cmdActiveIdx = -1;
  }

  function filterCmd() {
    const q = document.getElementById('cmdInput').value.toLowerCase().trim();
    _cmdFiltered = q
      ? CMD_LIST.filter(c =>
          c.label.toLowerCase().includes(q) ||
          (c.sub || '').toLowerCase().includes(q))
      : CMD_LIST;
    _cmdActiveIdx = _cmdFiltered.length ? 0 : -1;
    renderCmdList();
  }

  function renderCmdList() {
    const el = document.getElementById('cmdList');
    if (!_cmdFiltered.length) {
      el.innerHTML = '<div class="cmd-empty">コマンドが見つかりません</div>';
      return;
    }
    el.innerHTML = _cmdFiltered.map((c, i) => `
      <div class="cmd-item${i === _cmdActiveIdx ? ' active' : ''}"
           onclick="execCmdByFiltered(${i})">
        <span class="cmd-icon">${c.icon}</span>
        <div style="flex:1">
          <div class="cmd-label">${c.label}</div>
          ${c.sub ? `<div class="cmd-sub">${escHtml(c.sub)}</div>` : ''}
        </div>
      </div>`).join('');
  }

  function execCmdByFiltered(idx) {
    if (_cmdFiltered[idx]) {
      _cmdFiltered[idx].action();
      closeCmdPalette();
    }
  }

  function cmdKeydown(e) {
    const len = _cmdFiltered.length;
    if (!len) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      _cmdActiveIdx = (_cmdActiveIdx + 1) % len;
      renderCmdList();
      document.querySelectorAll('#cmdList .cmd-item')[_cmdActiveIdx]
        ?.scrollIntoView({ block:'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      _cmdActiveIdx = (_cmdActiveIdx - 1 + len) % len;
      renderCmdList();
      document.querySelectorAll('#cmdList .cmd-item')[_cmdActiveIdx]
        ?.scrollIntoView({ block:'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      execCmdByFiltered(_cmdActiveIdx);
    } else if (e.key === 'Escape') {
      closeCmdPalette();
    }
  }

  function scrollToSection(sectionId) {
    const el = document.getElementById(sectionId);
    if (!el) return;
    el.scrollIntoView({ behavior:'smooth', block:'start' });
    const prev = el.style.outline;
    el.style.transition = 'outline .2s';
    el.style.outline = '2px solid #3498db';
    setTimeout(() => { el.style.outline = prev || ''; }, 1400);
  }

  // ========== フォーミュラ評価（ペースト時に計算式を自動評価） ==========
  function safeEvalExpr(expr) {
    try {
      const clean = String(expr).replace(/[^0-9+\-*/.() ]/g, '').trim();
      if (!clean || !/[+\-*/]/.test(clean)) return null;
      // eslint-disable-next-line no-new-func
      const result = Function('"use strict"; return (' + clean + ')')();
      return (typeof result === 'number' && isFinite(result)) ? result : null;
    } catch(e) { return null; }
  }

  function initFormulaInputs() {
    // Phase 2b：document 全体ではなく見積タブ内に限定
    const root = document.getElementById('tab-quote-make') || document;
    root.addEventListener('paste', function(e) {
      const el = e.target;
      if (el.type !== 'number') return;
      if (!el.closest('#tableBody, #calcBody')) return;
      const text = (e.clipboardData || window.clipboardData).getData('text').trim();
      const result = safeEvalExpr(text);
      if (result !== null) {
        e.preventDefault();
        el.value = parseFloat(result.toFixed(6));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        quoteShowToast('🧮 ' + text + ' = ' + result.toLocaleString('ja-JP', {maximumFractionDigits:4}), 'info');
      }
    });
    // blur 時にも数式評価（直打ちした "=1+2" 形式に対応）
    root.addEventListener('blur', function(e) {
      const el = e.target;
      if (el.type !== 'number') return;
      if (!el.closest('#tableBody, #calcBody')) return;
      const text = (el.value || '').trim();
      if (!text.startsWith('=')) return;
      const result = safeEvalExpr(text.slice(1));
      if (result !== null) {
        el.value = parseFloat(result.toFixed(6));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        quoteShowToast('🧮 ' + text + ' = ' + result.toLocaleString('ja-JP', {maximumFractionDigits:4}), 'info');
      }
    }, true);
  }

  // ========== 処理済みマーク（廃止：done-btn を撤去）==========
  // 旧 toggleDone は呼び出しゼロのため削除。インポート時に旧データ
  // (doneStates) は無視される。

  // ========== プリセット管理 ==========
  const PRESET_KEY = 'quotePresets_v1';

  // 管理番号入力欄からデフォルトプリセット名を作る
  function _buildDefaultPresetName() {
    const ref      = (document.getElementById('qf-ref')?.value      || '').trim();
    const customer = (document.getElementById('qf-customer')?.value || '').trim();
    const person   = (document.getElementById('qf-person')?.value   || '').trim();
    const parts = [ref, customer, person].filter(Boolean);
    if (parts.length) return parts.join('_');
    // 全部空なら日付ベース
    return '一時保存_' + new Date().toISOString().slice(0,10).replace(/-/g, '');
  }

  function openPresetMgr() {
    renderPresetList();
    document.getElementById('presetMgrModal').classList.add('open');
    // 名前欄を管理番号入力欄から常に自動生成（管理番号の入力情報を優先反映）
    const input = document.getElementById('presetNameInput');
    if (input) {
      input.value = _buildDefaultPresetName();
    }
    setTimeout(() => { input?.focus(); input?.select(); }, 50);
  }

  function closePresetMgr() {
    document.getElementById('presetMgrModal').classList.remove('open');
  }

  function getPresets() {
    try { return JSON.parse(localStorage.getItem(PRESET_KEY) || '[]'); }
    catch(e) { return []; }
  }

  function savePresetsToStorage(presets) {
    localStorage.setItem(PRESET_KEY, JSON.stringify(presets));
  }

  function savePreset() {
    let name = document.getElementById('presetNameInput')?.value.trim();
    if (!name) {
      // 名前空なら自動生成
      name = _buildDefaultPresetName();
    }
    const presets = getPresets();
    const data    = gatherAllData();
    // 同名プリセットの確認 → 上書き
    const existingIdx = presets.findIndex(p => p.name === name);
    if (existingIdx >= 0) {
      if (!confirm(`「${name}」が既にあります。上書き保存しますか？`)) return;
      presets[existingIdx] = { name, data, ts: new Date().toISOString() };
      savePresetsToStorage(presets);
      document.getElementById('presetNameInput').value = '';
      renderPresetList();
      setCurrentQuoteName(name);
      quoteShowToast(`💾 「${name}」を上書き保存しました`, 'success');
      return;
    }
    if (presets.length >= 50) {
      quoteShowToast(
        '⚠️ プリセットは最大 50 件です。同名上書きするか、ツールバー「📤 出力」で JSON ファイルとして書き出してください（長期保管・チーム共有向け）',
        'warning', 6000
      );
      return;
    }
    presets.unshift({ name, data, ts: new Date().toISOString() });
    savePresetsToStorage(presets);
    document.getElementById('presetNameInput').value = '';
    renderPresetList();
    setCurrentQuoteName(name);
    quoteShowToast(`💾 「${name}」を保存しました`, 'success');
  }

  function loadPreset(idx) {
    const presets = getPresets();
    const preset  = presets[idx];
    if (!preset) return;
    // _applyQuoteData でフォーム復元・行再構築（v3 mixed-rows 対応）・合計更新を一括処理
    // keepHeaderIfEmpty=true: 仮REF/顧客名/担当者が空のプリセットでも現在入力値を消さない
    _applyQuoteData(preset.data, { keepHeaderIfEmpty: true });
    calcLiveUpdate();
    closePresetMgr();
    setCurrentQuoteName(preset.name);
    quoteShowToast('📂 「' + preset.name + '」を読み込みました（Ctrl+Z で元に戻せます）', 'success');
  }

  // 保存ツールバーの「編集中の見積名」表示を更新
  function setCurrentQuoteName(name) {
    const el = document.getElementById('currentQuoteName');
    if (!el) return;
    el.textContent = name ? '📝 ' + name : '📝 新規見積';
    el.dataset.name = name || '';
  }

  function deletePreset(idx) {
    const presets = getPresets();
    const name    = presets[idx]?.name || '';
    if (!confirm('「' + name + '」を削除しますか？')) return;
    presets.splice(idx, 1);
    savePresetsToStorage(presets);
    renderPresetList();
    quoteShowToast('🗑️ 「' + name + '」を削除しました', 'info');
  }

  function renderPresetList() {
    const presets = getPresets();
    const wrap    = document.getElementById('presetListWrap');
    if (!wrap) return;
    if (!presets.length) {
      wrap.innerHTML = '<div class="preset-empty">保存済みのプリセットはありません<br><small style="color:#bbb;">上のフォームから保存できます</small></div>';
      return;
    }
    // 現在読み込み中のプリセット名（ツールバーの dataset.name から取得）
    const loadedName = (document.getElementById('currentQuoteName')?.dataset.name || '').trim();
    wrap.innerHTML = presets.map((p, i) => {
      const ts = p.ts
        ? new Date(p.ts).toLocaleString('ja-JP', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })
        : '';
      const isLoaded = loadedName && p.name === loadedName;
      return '<div class="preset-list-item' + (isLoaded ? ' preset-list-item--loaded' : '') + '">' +
        (isLoaded ? '<span class="preset-loaded-badge">編集中</span>' : '') +
        '<span class="preset-list-name">' + escHtml(p.name) + '</span>' +
        '<span class="preset-list-ts">'   + ts + '</span>' +
        '<button class="btn-preset-load" onclick="loadPreset(' + i + ')">読み込む</button>' +
        '<button class="btn-preset-del"  onclick="deletePreset(' + i + ')" title="削除">✕</button>' +
        '</div>';
    }).join('');
  }

  // ========== 行パターン（チェック行を一時保存・読込） ==========
  const ROW_PATTERN_KEY = 'quoteRowPatterns_v1';
  const ROW_PATTERN_MAX = 20;

  function getRowPatterns()      { return SharedStorage.getJSON(ROW_PATTERN_KEY, []); }
  function setRowPatterns(arr)   { SharedStorage.setJSON(ROW_PATTERN_KEY, arr); }

  // チェック済み行のデータを抽出（通常行・リマーク行・小計行を含む）
  function _gatherCheckedRowsData() {
    const out = [];
    document.querySelectorAll('#tableBody tr .row-select-chk:checked').forEach(chk => {
      const tr = chk.closest('tr');
      if (!tr) return;
      if (tr.dataset.type === 'remark') {
        out.push({ _type: 'remark', text: tr.querySelector('.remark-row-input')?.value || '' });
        return;
      }
      if (tr.dataset.type === 'subtotal') {
        out.push({ _type: 'subtotal', label: tr.querySelector('.subtotal-label')?.value || '' });
        return;
      }
      const id = tr.id.replace('row-', '');
      const g = sid => document.getElementById(sid + '-' + id);
      out.push({
        _type: 'data',
        cat:   g('cat')?.value || '',
        name:  g('nm')?.value || '',
        taxed: g('tx')?.checked || false,
        pq:    g('pq')?.value || '',
        un:    g('un')?.value || '',
        pc:    g('pc')?.value || 'JPY',
        pp:    g('pp')?.value || '',
        bq:    g('bq')?.value || '',
        bc:    g('bc')?.value || 'JPY',
        bp:    g('bp')?.value || '',
        mk:    g('mk')?.value || '',
        note:  g('nt')?.value || '',
        sv:    g('sv')?.value || '',
      });
    });
    return out;
  }

  function openRowPatternMgr() {
    renderRowPatternList();
    const inp = document.getElementById('rowPatternNameInput');
    if (inp && !inp.value) {
      const d = new Date();
      const pad = n => String(n).padStart(2, '0');
      inp.value = `パターン_${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
    }
    document.getElementById('rowPatternModal').classList.add('open');
    setTimeout(() => inp?.focus(), 50);
  }
  function closeRowPatternMgr() { document.getElementById('rowPatternModal').classList.remove('open'); }

  function saveRowPatternFromChecked() {
    const rows = _gatherCheckedRowsData();
    if (!rows.length) {
      quoteShowToast('⚠️ 保存する行のチェックボックスを選択してください', 'warn', 3000);
      return;
    }
    const nameInp = document.getElementById('rowPatternNameInput');
    const name = (nameInp?.value || '').trim();
    if (!name) {
      quoteShowToast('⚠️ パターン名を入力してください', 'warn');
      nameInp?.focus();
      return;
    }
    const patterns = getRowPatterns();
    const entry = { name, ts: new Date().toISOString(), rows };
    const idx = patterns.findIndex(p => p.name === name);
    if (idx >= 0) {
      if (!confirm(`「${name}」を上書きしますか？`)) return;
      patterns[idx] = entry;
    } else {
      patterns.unshift(entry);
      if (patterns.length > ROW_PATTERN_MAX) patterns.length = ROW_PATTERN_MAX;
    }
    setRowPatterns(patterns);
    if (nameInp) nameInp.value = '';
    renderRowPatternList();
    quoteShowToast(`💾 行パターン「${name}」を保存（${rows.length}行）`, 'success');
  }

  function loadRowPattern(idx) {
    const patterns = getRowPatterns();
    const p = patterns[idx];
    if (!p) return;

    // 挿入位置を決定（モーダルの select 値を読む）
    const pos = document.getElementById('rowPatternInsertPos')?.value || 'end';
    const tbody = document.getElementById('tableBody');
    let anchor = null;       // null = 末尾 append。それ以外なら anchor の直前に挿入
    let posLabel = '末尾';
    if (pos === 'selected') {
      const checked = document.querySelectorAll('#tableBody tr .row-select-chk:checked');
      if (!checked.length) {
        quoteShowToast('⚠️ 挿入位置「選択行の下」が選ばれていますがチェック行がありません。末尾に追加します', 'warn', 3500);
      } else {
        const lastTr = checked[checked.length - 1].closest('tr');
        anchor = lastTr?.nextSibling || null;  // null なら結果的に末尾追加と同じ
        posLabel = '選択行の下';
      }
    } else if (pos === 'top') {
      anchor = tbody.querySelector('tr') || null;  // 先頭行の直前へ
      posLabel = '先頭';
    }

    // confirm を廃止。Ctrl+Z で元に戻せるため安全。

    p.rows.forEach(rd => {
      // リマーク行
      if (rd._type === 'remark') {
        insertRemarkRow(null, { noFocus: true });
        const allTrs = document.querySelectorAll('#tableBody tr');
        const tr = allTrs[allTrs.length - 1];
        if (!tr) return;
        if (anchor) tbody.insertBefore(tr, anchor);
        const inp = tr.querySelector('.remark-row-input');
        if (inp) inp.value = rd.text || '';
        return;
      }
      // 小計行
      if (rd._type === 'subtotal') {
        insertSubtotalRow(null);
        const allTrs = document.querySelectorAll('#tableBody tr');
        const tr = allTrs[allTrs.length - 1];
        if (!tr) return;
        if (anchor) tbody.insertBefore(tr, anchor);
        const lbl = tr.querySelector('.subtotal-label');
        if (lbl) lbl.value = rd.label || '';
        updateSubtotalRows();
        return;
      }
      // 通常行（_type === 'data' または後方互換で _type なし）
      // 末尾に追加してから anchor の直前に移動（addRow を流用）
      addRow();
      const trs = document.querySelectorAll('#tableBody tr');
      const tr = trs[trs.length - 1];
      if (!tr) return;
      if (anchor) tbody.insertBefore(tr, anchor);
      // anchor は元 DOM ノードを保持し続けるので、次回も同じ前に挿入 → 元順序保持
      const id = tr.id.replace('row-', '');
      const set = (sid, val, kind) => {
        const el = document.getElementById(sid + '-' + id);
        if (!el) return;
        if (kind === 'check') el.checked = !!val;
        else el.value = val ?? '';
      };
      set('cat', rd.cat);
      set('nm',  rd.name);
      set('tx',  rd.taxed, 'check');
      set('pq',  rd.pq);
      set('un',  rd.un);
      set('pc',  rd.pc);
      set('pp',  rd.pp);
      set('bq',  rd.bq);
      set('bc',  rd.bc);
      set('bp',  rd.bp);
      set('mk',  rd.mk);
      set('nt',  rd.note);
      set('sv',  rd.sv);
      if (typeof toggleTax === 'function') toggleTax(id);
      checkUnfilled(id);
      onCatChange(id);
      onPay(id);
    });
    // 小計行を含む場合に備えて全体を再計算
    if (typeof updateSubtotalRows === 'function') updateSubtotalRows();
    updateTotals();
    closeRowPatternMgr();
    quoteShowToast(`📂 「${p.name}」の ${p.rows.length} 行を${posLabel}に挿入しました`, 'success');
  }

  function deleteRowPattern(idx) {
    const patterns = getRowPatterns();
    const p = patterns[idx];
    if (!p) return;
    if (!confirm(`行パターン「${p.name}」を削除しますか？`)) return;
    patterns.splice(idx, 1);
    setRowPatterns(patterns);
    renderRowPatternList();
    quoteShowToast(`🗑️ 「${p.name}」を削除しました`, 'info');
  }

  // ===== 行パターン：ファイルへの書き出し =====
  window.exportRowPatterns = function() {
    const patterns = getRowPatterns();
    if (!patterns.length) {
      quoteShowToast('⚠️ 保存済みの行パターンがありません', 'warn');
      return;
    }
    const payload = {
      _type:      'rowPatterns',
      _version:   1,
      _app:       'フォワーダー支援ツール',
      exportedAt: new Date().toISOString(),
      patterns,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    const d    = new Date();
    const pad  = n => String(n).padStart(2, '0');
    a.download = `行パターン_${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}.json`;
    a.click();
    URL.revokeObjectURL(url);
    quoteShowToast(`📤 ${patterns.length} 件の行パターンを書き出しました`, 'success');
  };

  // ===== 行パターン：ファイルからの読み込み =====
  window.importRowPatternsFile = function(event) {
    const file = event.target.files[0];
    event.target.value = ''; // 同じファイルの再選択を許可
    if (!file) return;
    if (!file.name.endsWith('.json')) {
      quoteShowToast('⚠️ .json ファイルを選択してください', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = function(e) {
      let data;
      try { data = JSON.parse(e.target.result); }
      catch(err) {
        quoteShowToast('⚠️ ファイルの解析に失敗しました: ' + err.message, 'error');
        return;
      }
      // ファイル種別チェック
      if (data._type !== 'rowPatterns' || !Array.isArray(data.patterns)) {
        quoteShowToast('⚠️ 行パターンのファイルではありません（_type が一致しません）', 'error');
        return;
      }
      const incoming = data.patterns.filter(p => p && p.name && Array.isArray(p.rows));
      if (!incoming.length) {
        quoteShowToast('ℹ️ ファイルに有効なパターンが含まれていません', 'info');
        return;
      }
      // 既存パターンとの重複チェック
      const existing    = getRowPatterns();
      const duplicates  = incoming.filter(p => existing.some(e => e.name === p.name));
      const newOnes     = incoming.filter(p => !existing.some(e => e.name === p.name));
      let msg = `${incoming.length} 件のパターンを読み込みます。\n`;
      if (duplicates.length) msg += `\n▲ 上書き（同名）: ${duplicates.map(p => '「' + p.name + '」').join('、')}`;
      if (newOnes.length)    msg += `\n＋ 新規追加: ${newOnes.map(p => '「' + p.name + '」').join('、')}`;
      if (!confirm(msg + '\n\n続けますか？')) return;
      // マージ（同名は上書き、新規は先頭へ追加）
      let merged = [...existing];
      incoming.forEach(p => {
        const idx = merged.findIndex(e => e.name === p.name);
        if (idx >= 0) merged[idx] = p;
        else           merged.unshift(p);
      });
      if (merged.length > ROW_PATTERN_MAX) merged = merged.slice(0, ROW_PATTERN_MAX);
      setRowPatterns(merged);
      renderRowPatternList();
      quoteShowToast(`📥 ${incoming.length} 件の行パターンを読み込みました`, 'success');
    };
    reader.readAsText(file, 'utf-8');
  };

  function renderRowPatternList() {
    const patterns = getRowPatterns();
    const wrap = document.getElementById('rowPatternListWrap');
    if (!wrap) return;
    if (!patterns.length) {
      wrap.innerHTML = '<div class="preset-empty">保存済みの行パターンはありません<br><small style="color:#bbb;">行をチェックして上のフォームから保存できます</small></div>';
      return;
    }
    wrap.innerHTML = patterns.map((p, i) => {
      const ts = p.ts
        ? new Date(p.ts).toLocaleString('ja-JP', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })
        : '';
      return '<div class="preset-list-item">' +
        '<span class="preset-list-name">' + escHtml(p.name) +
          ' <small style="color:#999;">(' + p.rows.length + '行)</small></span>' +
        '<span class="preset-list-ts">'   + ts + '</span>' +
        '<button class="btn-preset-load" onclick="loadRowPattern(' + i + ')">読込</button>' +
        '<button class="btn-preset-del"  onclick="deleteRowPattern(' + i + ')" title="削除">✕</button>' +
        '</div>';
    }).join('');
  }

  // ========== ファイル出力・読込 ==========

  function exportToFile() {
    // 基本データ収集
    const base = gatherAllData();

    // calc行データを収集（IDがなくクラスのみのため個別取得）
    const calcRows = [];
    document.querySelectorAll('#calcBody tr').forEach(tr => {
      calcRows.push({
        pcs: tr.querySelector('.calc-pcs')?.value ?? '',
        pkg: tr.querySelector('.calc-pkg')?.value ?? '',
        l:   tr.querySelector('.calc-l')?.value   ?? '',
        w:   tr.querySelector('.calc-w')?.value   ?? '',
        h:   tr.querySelector('.calc-h')?.value   ?? '',
        kg:  tr.querySelector('.calc-kg')?.value  ?? '',
        stack: tr.querySelector('.calc-stack')?.value ?? ''
      });
    });

    // ファイル名生成（REF_引き合い元_担当.json）
    const fname = buildFileName('json');

    const payload = {
      _version: 1,
      _app: 'フォワーダー支援',
      exportedAt: new Date().toISOString(),
      fields: base.fields,
      rows: base.rows,
      calcRows
    };

    // ダウンロード
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = fname;
    a.click();
    URL.revokeObjectURL(url);
    quoteShowToast('📤 ファイルを出力しました: ' + fname, 'success');
  }

  function importFromFile(event) {
    const file = event.target.files[0];
    event.target.value = ''; // 同じファイルの再選択を可能にする
    if (!file) return;
    if (!file.name.endsWith('.json')) {
      quoteShowToast('⚠️ .json ファイルを選択してください', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = function(e) {
      let data;
      try { data = JSON.parse(e.target.result); }
      catch(err) { alert('ファイルの読み込みに失敗しました。\n' + err.message); return; }

      // 既知アプリ名の許可リスト（旧名「見積支援ツール」→現名「フォワーダー支援」の移行に対応）
      const VALID_APP_NAMES = ['見積支援ツール', 'フォワーダー支援', 'フォワーダー支援ツール'];
      if (!data._version || !VALID_APP_NAMES.includes(data._app)) {
        if (!confirm('このファイルは別のアプリから作成された可能性があります。\n続行しますか？')) return;
      }

      const exportedAt = data.exportedAt
        ? new Date(data.exportedAt).toLocaleString('ja-JP')
        : '不明';
      if (!confirm('出力日時: ' + exportedAt + '\n\n現在のデータを上書きして読み込みますか？')) return;

      // 旧形式（sv 末尾）を新形式（sv@2）へ
      if (typeof migrateRowCells === 'function') data = migrateRowCells(data);

      // ---- フォーム復元 ----
      Object.entries(data.fields || {}).forEach(([id, val]) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (el.type === 'checkbox') el.checked = val;
        else el.value = val;
      });

      // ---- 見積テーブル行復元 ----
      // ※ _rebuildTable を使う（v3形式・subtotal/remark行・checkboxに正しく対応）
      if (typeof migrateRowCells === 'function') data = migrateRowCells(data);
      _rebuildTable(data);
      if (typeof _restoreUiState === 'function') _restoreUiState(data.fields);

      // ---- doneボタン状態（廃止）：旧 JSON との互換のため doneStates は読み飛ばす ----

      // ---- calc行復元（旧サイズ計算パネル。無い環境ではスキップ） ----
      if (document.getElementById('calcBody')) {
      document.getElementById('calcBody').innerHTML = '';
      calcRowCount = 0;
      (data.calcRows || []).forEach(row => {
        addCalcRow();
        const tr = document.getElementById('calcBody').lastElementChild;
        if (!tr) return;
        if (row.pcs !== '') tr.querySelector('.calc-pcs').value   = row.pcs;
        if (row.pkg)        tr.querySelector('.calc-pkg').value   = row.pkg;
        if (row.l   !== '') tr.querySelector('.calc-l').value     = row.l;
        if (row.w   !== '') tr.querySelector('.calc-w').value     = row.w;
        if (row.h   !== '') tr.querySelector('.calc-h').value     = row.h;
        if (row.kg  !== '') tr.querySelector('.calc-kg').value    = row.kg;
        if (row.stack)      tr.querySelector('.calc-stack').value = row.stack;
      });
      }

      // ---- グレーアウト状態更新 ----
      document.querySelectorAll('#tableBody tr').forEach(tr => {
        const nm = tr.querySelector('[data-field="nm"]');
        if (nm) checkUnfilled(nm.id.replace('nm-', ''));
      });
      // ---- UI更新 ----
      updateTotals();
      calcLiveUpdate();
      updateRouteModeIcon();
      if (typeof syncHazmatPanel === 'function') syncHazmatPanel();
      if (typeof syncMultiEntryFields === 'function') syncMultiEntryFields();
      if (typeof window.updateSectionSummaries === 'function') window.updateSectionSummaries();
      if (typeof window.renderQuoteMilestones === 'function') window.renderQuoteMilestones();
      quoteShowToast('📥 ファイルを読み込みました', 'success');
      showSaveStatus('📥 ファイル読込完了');
    };
    reader.readAsText(file, 'utf-8');
  }

  // ========== スコーププリセット ダイアログ ==========

  function openScopePresetDlg(scope) {
    _presetPendingScope = scope;
    const presets = SCOPE_PRESETS[scope] || [];
    const scopeLabels = {
      domestic: '🏠 国内のみ',
      export:   '📤 輸出',
      import:   '📥 輸入',
      dtd:      '🌐 Door to Door',
    };
    const title = document.getElementById('scopePresetTitle');
    if (title) title.textContent = '📋 ' + (scopeLabels[scope] || scope) + ' — プリセットを挿入しますか？';

    // プリセット内容リストを生成
    const itemsEl = document.getElementById('scopePresetItems');
    if (itemsEl) {
      itemsEl.innerHTML = presets.map((p, i) =>
        (i + 1) + '. ' + (CATEGORIES.find(c => c.value === p.cat)?.label || p.cat) + ' ／ ' + p.name +
        (p.note ? ' (' + p.note + ')' : '')
      ).join('<br>');
    }

    const modal = document.getElementById('scopePresetModal');
    if (modal) modal.classList.add('open');
  }

  function closeScopePresetDlg() {
    const modal = document.getElementById('scopePresetModal');
    if (modal) modal.classList.remove('open');
    _presetPendingScope = '';
  }

  function applyScopePreset(mode) {
    const scope = _presetPendingScope;
    const presets = SCOPE_PRESETS[scope];
    closeScopePresetDlg();
    if (!presets || presets.length === 0) return;

    if (mode === 'replace') {
      // テーブルをクリアして置換
      document.getElementById('tableBody').innerHTML = '';
      rowCount = 0;
    }

    // 最後の行の通貨を引き継ぐ（追加モード時）
    let lastCur = 'JPY';
    const lastSelect = document.querySelector('#tableBody tr:last-child [id^="pc-"]');
    if (lastSelect) lastCur = lastSelect.value || 'JPY';

    presets.forEach(item => {
      rowCount++;
      const id = rowCount;
      const tbody = document.getElementById('tableBody');
      const tr = document.createElement('tr');
      tr.id = 'row-' + id;
      tr.replaceChildren(buildRowHTML(id, item.cat, lastCur));
      tbody.appendChild(tr);

      // 品名・備考を設定
      const nmEl = document.getElementById('nm-' + id);
      if (nmEl) nmEl.value = item.name;
      const ntEl = document.getElementById('nt-' + id);
      if (ntEl) ntEl.value = item.note || '';

      // カテゴリ変更・計算を初期化
      if (typeof onCatChange === 'function') onCatChange(id);
      if (typeof onPay     === 'function') onPay(id);
      if (typeof initDrag  === 'function') initDrag(tr);
    });

    updateTotals();
    const modeLabel = mode === 'replace' ? '置換' : '追加';
    quoteShowToast('✅ プリセット' + modeLabel + '完了（' + presets.length + '行）', 'success');
  }

  // ========== キーボードショートカット ==========
  // Phase 2c-Step4: フィードバックモーダル (#fbOverlay) はサイト全体スコープなので
  // Esc ハンドラも見積タブガードの外に出して、どのタブからでも閉じられるようにする。
  // Ctrl+K（コマンドパレット）と他モーダル（cmdPalette/presetMgrModal/previewOverlay）
  // は見積タブ専用なので従来通りタブガード配下に残置。
  document.addEventListener('keydown', function(e) {
    // 1) サイト全体 Esc → フィードバック/比較モーダルが開いていたら閉じる（タブ問わず）
    if (e.key === 'Escape' && document.getElementById('fbOverlay')?.classList.contains('open')) {
      closeFeedback();
      return;
    }
    if (e.key === 'Escape' && document.getElementById('compareOverlay')?.classList.contains('open')) {
      closeCompare();
      return;
    }
    // 2) 以下は見積タブ active のときのみ動作
    const quoteTab = document.getElementById('tab-quote-make');
    if (!quoteTab || !quoteTab.classList.contains('active')) return;
    const ctrl = e.ctrlKey || e.metaKey;
    // Ctrl+K / Cmd+K → コマンドパレット
    if (ctrl && e.key === 'k') {
      e.preventDefault();
      const pal = document.getElementById('cmdPalette');
      pal.classList.contains('open') ? closeCmdPalette() : openCmdPalette();
    }
    // Ctrl+S → プリセット保存（クイック保存）
    if (ctrl && !e.shiftKey && !e.altKey && e.key === 's') {
      e.preventDefault();
      if (typeof savePreset === 'function') savePreset();
      return;
    }
    // Ctrl+P → プレビュー
    if (ctrl && !e.shiftKey && !e.altKey && e.key === 'p') {
      e.preventDefault();
      if (typeof openPreview === 'function') openPreview();
      return;
    }
    // Ctrl/Cmd+Z → Undo（Shift で Redo）。Ctrl/Cmd+Y → Redo。
    if (ctrl && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) { if (typeof quoteRedo === 'function') quoteRedo(); }
      else            { if (typeof quoteUndo === 'function') quoteUndo(); }
      return;
    }
    if (ctrl && !e.altKey && !e.shiftKey && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof quoteRedo === 'function') quoteRedo();
      return;
    }
    // Escape → 見積タブ内のモーダルをすべて閉じる
    if (e.key === 'Escape') {
      if (document.getElementById('cmdPalette')?.classList.contains('open'))     closeCmdPalette();
      if (document.getElementById('presetMgrModal')?.classList.contains('open')) closePresetMgr();
      if (document.getElementById('previewOverlay')?.classList.contains('open')) closePreview();
    }
  });

  // ========== 貨物情報フィールド並び替え ==========

  function _cargoModeKey() {
    if (typeof _currentTransport === 'undefined') return 'fcl';
    if (_currentTransport === 'air') return 'air';
    if (_currentSeaSub === 'lcl')    return 'lcl';
    return 'fcl';
  }

  // 貨物情報グリッドの定義（group キーが CARGO_FIELD_ORDER のサブキーに対応）
  const _CARGO_GRIDS = [
    { id: 'cargoCondGrid',  group: 'cargo'  },
    { id: 'volumeCondGrid', group: 'volume' },
  ];

  function _cargoOrderKey(modeKey, group) {
    return `cargoFieldOrder_${group}_${modeKey}_v1`;
  }

  function saveCargoFieldOrder() {
    const modeKey = _cargoModeKey();
    _CARGO_GRIDS.forEach(({ id, group }) => {
      const grid = document.getElementById(id);
      if (!grid) return;
      const order = Array.from(grid.querySelectorAll('.cond-field[data-field-id]'))
        .map(el => el.dataset.fieldId);
      localStorage.setItem(_cargoOrderKey(modeKey, group), JSON.stringify(order));
    });
  }

  function applyCargoFieldOrder(modeKey) {
    modeKey = modeKey || _cargoModeKey();

    // LCL / Air ではサイズ計算 details を自動展開
    const calcDetails = document.querySelector('.cbm-calc-details');
    if (calcDetails && (modeKey === 'lcl' || modeKey === 'air')) {
      calcDetails.open = true;
    }

    _CARGO_GRIDS.forEach(({ id, group }) => {
      const grid = document.getElementById(id);
      if (!grid) return;

      // モード別カスタム保存 → なければ CARGO_FIELD_ORDER デフォルト
      let order = [];
      try { order = JSON.parse(localStorage.getItem(_cargoOrderKey(modeKey, group)) || '[]'); } catch(e) {}
      if (!order.length && typeof CARGO_FIELD_ORDER !== 'undefined') {
        const modeOrder = CARGO_FIELD_ORDER[modeKey] || CARGO_FIELD_ORDER.fcl;
        order = (modeOrder[group] || []).slice();
      }
      if (!order.length) return;

      const fields = {};
      grid.querySelectorAll('.cond-field[data-field-id]').forEach(el => {
        fields[el.dataset.fieldId] = el;
      });
      order.forEach(fid => { if (fields[fid]) grid.appendChild(fields[fid]); });
    });
  }

  function resetCargoFieldOrder() {
    const modeKey = _cargoModeKey();
    _CARGO_GRIDS.forEach(({ group }) => {
      localStorage.removeItem(_cargoOrderKey(modeKey, group));
    });
    applyCargoFieldOrder(modeKey);
    if (typeof quoteShowToast === 'function') quoteShowToast('並び順をリセットしました', 'info', 1800);
  }

  function restoreCargoFieldOrder() {
    applyCargoFieldOrder(_cargoModeKey());
  }

  // グリッド1つ分のドラッグ並び替えを初期化（内部ヘルパー）
  function _initGridSort(gridId) {
    const grid = document.getElementById(gridId);
    if (!grid) return;
    let dragSrc = null;

    grid.querySelectorAll('.cond-field[data-field-id]').forEach(field => {
      const handle = field.querySelector('.cond-sort-handle');

      let _fromHandle = false;
      if (handle) {
        handle.addEventListener('mousedown', () => { _fromHandle = true; });
        document.addEventListener('mouseup', () => { _fromHandle = false; }, { capture: true });
      }

      field.addEventListener('dragstart', e => {
        if (!_fromHandle) { e.preventDefault(); return; }
        _fromHandle = false;
        dragSrc = field;
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => field.classList.add('cond-field-dragging'), 0);
      });
      field.addEventListener('dragend', () => {
        field.classList.remove('cond-field-dragging');
        grid.querySelectorAll('.cond-field').forEach(f => f.classList.remove('cond-field-over'));
        dragSrc = null;
        saveCargoFieldOrder();
      });
      field.addEventListener('dragover', e => {
        if (!dragSrc || dragSrc === field) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        grid.querySelectorAll('.cond-field').forEach(f => f.classList.remove('cond-field-over'));
        field.classList.add('cond-field-over');
      });
      field.addEventListener('dragleave', () => field.classList.remove('cond-field-over'));
      field.addEventListener('drop', e => {
        e.preventDefault();
        if (!dragSrc || dragSrc === field) return;
        const rect = field.getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        if (e.clientX < midX) {
          grid.insertBefore(dragSrc, field);
        } else {
          grid.insertBefore(dragSrc, field.nextSibling);
        }
        field.classList.remove('cond-field-over');
      });
    });
  }

  function initCargoSort() {
    // 並び替え機能は廃止（ドラッグ無効）。順序は CARGO_FIELD_ORDER の既定値で固定。
  }


  // ========== 荷姿カスタムプリセット ==========
  const PACKING_PRESETS_KEY  = 'customPackings_v1';
  const DEFAULT_PACKINGS = ['カートン','パレット','ドラム缶','袋（バッグ）','木箱','スチール缶','バルク','コイル','ロール'];

  function getPackingList() {
    try {
      const saved = JSON.parse(localStorage.getItem(PACKING_PRESETS_KEY) || '[]');
      return [...DEFAULT_PACKINGS, ...saved.filter(p => !DEFAULT_PACKINGS.includes(p))];
    } catch(e) { return DEFAULT_PACKINGS; }
  }
  window.getPackingList = getPackingList;

  function renderPackingPreset() {
    const sel = document.getElementById('cond-packing-preset');
    if (!sel) return;
    const list = getPackingList();
    const cur  = document.getElementById('cond-packing')?.value || '';
    sel.innerHTML = '<option value="">— 荷姿を選択 —</option>' +
      list.map(p => `<option value="${p}"${p===cur?' selected':''}>${p}</option>`).join('') +
      '<option value="__add__">＋ カスタム荷姿を追加...</option>';
  }

  function onPackingPresetChange(sel) {
    const val = sel.value;
    if (val === '__add__') {
      const name = prompt('カスタム荷姿を入力してください');
      if (!name?.trim()) { sel.value = ''; return; }
      const saved = JSON.parse(localStorage.getItem(PACKING_PRESETS_KEY) || '[]');
      if (!saved.includes(name.trim())) {
        saved.push(name.trim());
        localStorage.setItem(PACKING_PRESETS_KEY, JSON.stringify(saved));
      }
      renderPackingPreset();
      const inp = document.getElementById('cond-packing');
      if (inp) inp.value = name.trim();
      sel.value = name.trim();
      quoteShowToast(`✅ 「${name.trim()}」を追加しました`, 'success');
    } else if (val) {
      const inp = document.getElementById('cond-packing');
      if (inp) inp.value = val;
    }
  }


  // ===== レイアウトスケール（大/中/小） =====
  // 大：スマホ向け（小画面で読みやすい大きめ文字）、中：タブレット向け、小：デスクトップ向け（広画面で多くの情報を表示）
  const LAYOUT_SCALE_KEY = 'quoteLayoutScale_v1';
  const LAYOUT_SCALES = {
    lg: { font: 15, label: '大（スマホ）' },
    md: { font: 13, label: '中（タブレット）' },
    sm: { font: 11, label: '小（デスクトップ）' }
  };

  function getQuoteScopeEl() {
    return document.getElementById('tab-quote-make') || document.documentElement;
  }

  // クラス付与とフォントサイズ変数を適用（トースト・保存なし）
  function applyLayoutScale(scale) {
    if (!LAYOUT_SCALES[scale]) scale = 'md';
    const el = getQuoteScopeEl();
    el.classList.remove('scale-sm', 'scale-md', 'scale-lg');
    el.classList.add('scale-' + scale);
    el.style.setProperty('--base-font-size', LAYOUT_SCALES[scale].font + 'px');
    // ボタンの選択状態を反映
    document.querySelectorAll('.layout-scale-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.scale === scale);
    });
  }

  function setLayoutScale(scale) {
    if (!LAYOUT_SCALES[scale]) return;
    applyLayoutScale(scale);
    localStorage.setItem(LAYOUT_SCALE_KEY, scale);
    quoteShowToast(`📐 ${LAYOUT_SCALES[scale].label}`, 'info', 1500);
  }

  function restoreLayoutScale() {
    // 旧 quoteFontSize（px 数値）は破棄してデフォルト md にフォールバック
    const saved = localStorage.getItem(LAYOUT_SCALE_KEY) || 'md';
    applyLayoutScale(saved);
  }

  // 後方互換：古い呼び出し（A-/A+ ボタン由来）を新しい3段階に翻訳
  function changeFontSize(delta) {
    const order = ['sm','md','lg'];
    const cur = localStorage.getItem(LAYOUT_SCALE_KEY) || 'md';
    const i = order.indexOf(cur);
    const next = Math.max(0, Math.min(order.length - 1, i + (delta > 0 ? 1 : -1)));
    setLayoutScale(order[next]);
  }

  // 参照セクション（マイルストーン・物量・船会社リンク）が全て空のとき案内文を表示
  window.updateQuoteRefEmpty = function () {
    const empty = document.getElementById('qspRefEmpty');
    if (!empty) return;
    const ids = ['qspMilestones', 'qspCargoInfo', 'qspCarrierLinks'];
    const anyShown = ids.some(id => {
      const el = document.getElementById(id);
      return el && el.style.display !== 'none' && el.innerHTML.trim();
    });
    empty.style.display = anyShown ? 'none' : '';
  };

  // ===== 輸送モード対応マイルストーン表示 =====
  window.renderQuoteMilestones = function () {
    const el = document.getElementById('qspMilestones');
    if (!el) return;
    const st = (typeof window.getTransportState === 'function') ? window.getTransportState() : null;
    if (!st || !st.transport) { el.style.display = 'none'; el.innerHTML = ''; return; }

    const isAir = st.transport === 'air';
    const isImport = st.direction === 'import';
    const z1On = !!st.zone1On;   // 出発地側
    const z3On = !!st.zone3On;   // 到着地側

    // フルのドアtoドア物流フロー（各ステップに担当ゾーンを割当）
    // z1=出発地側 / z2=幹線（常時）/ z3=到着地側
    let steps, modeLabel;
    if (isAir) {
      modeLabel = '✈️ Air' + (isImport ? '（輸入）' : '（輸出）');
      steps = [
        { l: '集荷',     z: 'z1' },
        { l: '搬入',     z: 'z1' },
        { l: '輸出通関', z: 'z1' },
        { l: '搭載',     z: 'z2' },
        { l: '出発空港', z: 'z2' },
        { l: '到着空港', z: 'z2' },
        { l: '輸入通関', z: 'z3' },
        { l: '搬出',     z: 'z3' },
        { l: '荷渡し',   z: 'z3' },
      ];
    } else {
      const sub = st.seaSub === 'lcl' ? 'LCL' : 'FCL';
      modeLabel = '🚢 Sea ' + sub + (isImport ? '（輸入）' : '（輸出）');
      steps = (st.seaSub === 'lcl')
        ? [
            { l: '集荷',     z: 'z1' },
            { l: 'CFS搬入',  z: 'z1' },
            { l: '輸出通関', z: 'z1' },
            { l: '船積(POL)', z: 'z2' },
            { l: '海上輸送', z: 'z2' },
            { l: '入港(POD)', z: 'z2' },
            { l: 'デバン',   z: 'z3' },
            { l: '輸入通関', z: 'z3' },
            { l: '荷渡し',   z: 'z3' },
          ]
        : [
            { l: '集荷',      z: 'z1' },
            { l: 'バンニング', z: 'z1' },
            { l: '輸出通関',  z: 'z1' },
            { l: '船積(POL)', z: 'z2' },
            { l: '海上輸送',  z: 'z2' },
            { l: '入港(POD)', z: 'z2' },
            { l: '輸入通関',  z: 'z3' },
            { l: 'ドレー',    z: 'z3' },
            { l: '荷渡し',    z: 'z3' },
          ];
    }

    const inScope = z => z === 'z2' || (z === 'z1' && z1On) || (z === 'z3' && z3On);

    // モジュール定義（名称・担当ゾーン）
    const MODS = [
      { z: 'z1', name: '① 出発地側', on: z1On },
      { z: 'z2', name: '② 幹線輸送', on: true },
      { z: 'z3', name: '③ 到着地側', on: z3On },
    ];
    // サブコン情報を収集
    const subconOf = (z) => {
      if (z === 'z1') return (document.getElementById('z1DefaultSc')?.value || '').trim();
      if (z === 'z3') return (document.getElementById('z3DefaultSc')?.value || '').trim();
      if (z === 'z2') {
        // 幹線：登録航路のキャリア、無ければ入力欄
        try {
          const routes = JSON.parse(document.getElementById('z2-routes-data')?.value || '[]');
          const cs = routes.map(r => r.carrier).filter(Boolean);
          if (cs.length) return [...new Set(cs)].join('、');
        } catch (e) {}
        return (document.getElementById('z2Carrier')?.value || '').trim();
      }
      return '';
    };

    let n = 0;
    const modHTML = MODS.filter(m => m.on).map(m => {
      const mySteps = steps.filter(s => s.z === m.z);
      const active = m.on;
      const stepHTML = mySteps.map(s => {
        if (active) n++;
        return `<div class="qsp-ms-step ${active ? 'in-scope' : 'out-scope'}">
            <span class="qsp-ms-dot">${active ? n : '·'}</span>
            <span class="qsp-ms-label">${s.l}</span>
          </div>`;
      }).join('');
      const subcon = subconOf(m.z);
      let subconHTML = subcon
        ? `<div class="qsp-ms-subcon" title="サブコン">👷 ${escapeHtml(subcon)}</div>` : '';
      // 幹線輸送（z2）：入力されたキャリアに応じてリンクチップを表示
      if (m.z === 'z2' && typeof window.getCarrierLinkData === 'function') {
        const carriers = window.getCarrierLinkData().filter(cd => cd.name);
        if (carriers.length) {
          subconHTML = carriers.map(cd => {
            const chips = cd.links.length
              ? `<div class="qsp-ms-cl-chips">` + cd.links.map(l =>
                  `<a class="qsp-ms-cl-chip" href="${l.url}" target="_blank" rel="noopener" title="${escapeHtml(l.title)}">${escapeHtml(l.label)}</a>`
                ).join('') + `</div>`
              : '';
            return `<div class="qsp-ms-carrier">
                <div class="qsp-ms-carrier-name">${cd.icon || '🚢'} ${escapeHtml(cd.name)}</div>
                ${chips}
              </div>`;
          }).join('');
        }
      }
      const statusBadge = active ? '' : '<span class="qsp-mod-off">対象外</span>';
      return `<div class="qsp-mod ${active ? '' : 'is-off'}" data-zone="${m.z}">
          <div class="qsp-mod-head" onclick="filterQuoteByModule('${m.z}')" title="クリックでこのモジュールの費用だけを絞り込み表示（再クリックで解除）">
            <span class="qsp-mod-name">${m.name}</span>
            ${statusBadge}
            <span class="qsp-mod-filter">🔍 絞り込み</span>
          </div>
          <div class="qsp-mod-steps">${stepHTML}</div>
          ${subconHTML}
        </div>`;
    }).join('');

    // 作業範囲のキャプション
    const activeSteps = steps.filter(s => inScope(s.z));
    const scopeText = activeSteps.length
      ? `作業範囲：${activeSteps[0].l} 〜 ${activeSteps[activeSteps.length - 1].l}`
      : '作業範囲：幹線のみ';

    el.style.display = 'block';
    el.innerHTML = `
      <div class="qsp-ms-head"><span class="qsp-ms-mode">${modeLabel}</span></div>
      <div class="qsp-ms-cap-row">${scopeText}</div>
      <div class="qsp-ms-mods">${modHTML}</div>
      <div class="qsp-ms-filter-hint" id="qspMsFilterHint" style="display:none;"></div>`;
    // フィルタ中ならアクティブ表示を復元
    if (window._activeModuleFilter) applyModuleFilterUI(window._activeModuleFilter);
  };

  // ===== モジュール（区間）別フィルタ =====
  // ① 出発地側 / ② 幹線 / ③ 到着地側 に対応するカテゴリ集合
  const MODULE_CATS = {
    z1: ['domestic', 'export-local', 'customs-export', 'insurance', 'other'],
    z2: ['ocean', 'air', 'surcharge'],
    z3: ['import-local', 'overseas', 'customs-import', 'insurance', 'other'],
  };
  const MODULE_LABEL = { z1: '① 出発地側（国内・海外費用）', z2: '② 幹線輸送費用', z3: '③ 到着地側（国内・海外費用）' };
  window._activeModuleFilter = null;

  window.filterQuoteByModule = function (zone) {
    // 同じモジュールを再クリック → 解除
    if (window._activeModuleFilter === zone) { window.clearModuleFilter(); return; }
    window._activeModuleFilter = zone;
    const cats = MODULE_CATS[zone] || [];
    document.querySelectorAll('#tableBody tr').forEach(tr => {
      const type = tr.dataset.type;
      if (type === 'subtotal' || tr.classList.contains('remark-row')) {
        tr.style.display = 'none';   // 絞り込み中は小計・リマーク行を隠す
        return;
      }
      const id = tr.id.replace('row-', '');
      const cat = document.getElementById(`cat-${id}`)?.value || '';
      tr.style.display = cats.includes(cat) ? '' : 'none';
    });
    applyModuleFilterUI(zone);
  };

  window.clearModuleFilter = function () {
    window._activeModuleFilter = null;
    document.querySelectorAll('#tableBody tr').forEach(tr => { tr.style.display = ''; });
    document.querySelectorAll('#qspMilestones .qsp-mod').forEach(s => s.classList.remove('filter-active'));
    const hint = document.getElementById('qspMsFilterHint');
    if (hint) hint.style.display = 'none';
  };

  function applyModuleFilterUI(zone) {
    document.querySelectorAll('#qspMilestones .qsp-mod').forEach(s =>
      s.classList.toggle('filter-active', s.dataset.zone === zone));
    const hint = document.getElementById('qspMsFilterHint');
    if (hint) {
      hint.style.display = 'block';
      hint.innerHTML = `🔍 <b>${MODULE_LABEL[zone]}</b> で絞り込み中 <button type="button" class="qsp-ms-clear" onclick="clearModuleFilter()">✕ 解除</button>`;
    }
  }

  // ===== 物量情報を見積サマリに表示 =====
  window.renderQuoteCargoInfo = function () {
    const el = document.getElementById('qspCargoInfo');
    if (!el) return;
    const m = (typeof window.getCargoMetrics === 'function') ? window.getCargoMetrics() : null;
    if (!m) { el.style.display = 'none'; return; }
    const rows = [];
    if (m.container) rows.push(['コンテナ', m.container]);
    if (m.qty > 0)   rows.push(['総個数', m.qty.toLocaleString() + ' 個']);
    if (m.cbm > 0)   rows.push(['総容積', m.cbm.toFixed(3) + ' CBM']);
    if (m.kg > 0)    rows.push(['総重量', Math.round(m.kg).toLocaleString() + ' kg']);
    if (m.rt > 0)    rows.push(['R/T', m.rt.toFixed(3)]);
    if (m.cw > 0)    rows.push(['CW', SharedCalc.fmtCw(m.cw) + ' kg']);  // 0.5kg 精度を保つ
    if (!rows.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = 'block';
    el.innerHTML = '<div class="qsp-section-label">📦 物量情報</div>'
      + rows.map(([k, v]) => `<div class="qsp-cargo-row"><span class="qsp-cargo-k">${k}</span><span class="qsp-cargo-v">${v}</span></div>`).join('');
  };

  // ===== 見積サマリパネル =====
  window.updateQuoteSummary = function updateQuoteSummary() {
    const panel = document.getElementById('qspFin');
    if (!panel) return;

    const rows = document.querySelectorAll('#tableBody tr:not([data-type="subtotal"])');
    const activeRows = Array.from(rows).filter(tr => {
      const id = tr.id.replace('row-', '');
      return document.getElementById(`nm-${id}`)?.value?.trim();
    });

    if (!activeRows.length) {
      panel.innerHTML = '<p class="qsp-empty">費用項目を入力すると<br>ここにまとめが表示されます</p>';
      return;
    }

    const billByCur = {};
    let totalBillJPY = 0, totalCostJPY = 0;
    let hasFx = false;
    // 消費税集計（外貨建ては輸出免税が原則のため消費税額は JPY のみ）
    let taxableJPY = 0, exemptJPY = 0, taxAmtJPY = 0;
    const taxRate = (document.getElementById('pvExemptChk')?.checked) ? 0 : 0.10;

    activeRows.forEach(tr => {
      const id = tr.id.replace('row-', '');
      const pc = document.getElementById(`pc-${id}`)?.value || 'JPY';
      const bc = document.getElementById(`bc-${id}`)?.value || 'JPY';
      const pq = parseFloat(document.getElementById(`pq-${id}`)?.value) || 0;
      const pp = parseFloat(document.getElementById(`pp-${id}`)?.value) || 0;
      const bq = parseFloat(document.getElementById(`bq-${id}`)?.value) || 0;
      const bp = parseFloat(document.getElementById(`bp-${id}`)?.value) || 0;
      const billing = bq * bp;
      const cost    = pq * pp;
      // 通貨別請求小計：JPY は行ごと丸めで積み上げ（売上合計と一致させる）。外貨は native のまま。
      billByCur[bc] = (billByCur[bc] || 0) + (bc === 'JPY' ? SharedCalc.jpyRound(billing) : billing);
      // JPY換算は行ごとに SharedCalc.jpyRound で丸めてから合計（4経路統一・docs/バグ台帳）
      const billingJPY = SharedCalc.jpyRound(toJPY(billing, bc));
      totalBillJPY += billingJPY;
      totalCostJPY += SharedCalc.jpyRound(toJPY(cost, pc));
      if (bc !== 'JPY' || pc !== 'JPY') hasFx = true;
      // 課税/免税判定（行に taxed クラス）
      if (tr.classList.contains('taxed')) {
        taxableJPY += billingJPY;
        if (bc === 'JPY') taxAmtJPY += billing * taxRate;
      } else {
        exemptJPY += billingJPY;
      }
    });

    const profit = totalBillJPY - totalCostJPY;
    // 粗利率は売上ベースに統一（業界標準 / 他画面と一致）。docs/バグ台帳.md B
    const mkPct  = SharedCalc.grossMarginPct(totalBillJPY, totalCostJPY);
    const fmtJPY = n => Math.round(n).toLocaleString('ja-JP');
    const profCls = profit >= 0 ? 'qsp-profit-pos' : 'qsp-profit-neg';

    const curLines = Object.entries(billByCur)
      .filter(([, v]) => v)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cur, amt]) =>
        `<div class="qsp-currency-row"><span class="qsp-cur">${cur}</span><span class="qsp-amount">${cur === 'JPY' ? fmtJPY(amt) : fmt(amt)}</span></div>`
      ).join('');

    const taxAmt = Math.ceil(taxAmtJPY);
    const taxLabel = taxRate === 0 ? '消費税（免税）' : '消費税（10%）';

    panel.innerHTML = `
      <div class="qsp-row-count">${activeRows.length} 費用項目</div>
      <div class="qsp-section-label">通貨別請求小計</div>
      ${curLines}
      <div class="qsp-section-label">合計（JPY 換算）</div>
      <div class="qsp-total-row"><span>仕入合計</span><span>¥${fmtJPY(totalCostJPY)}</span></div>
      <div class="qsp-total-row"><span>売上合計</span><span>¥${fmtJPY(totalBillJPY)}</span></div>
      <div class="qsp-profit-row ${profCls}"><span>利益</span><span>¥${fmtJPY(profit)}</span></div>
      <div class="qsp-markup-row"><span>粗利率</span><span>${mkPct.toFixed(1)}%</span></div>
      <div class="qsp-section-label">消費税</div>
      <div class="qsp-tax-row"><span>課税合計</span><span>¥${fmtJPY(taxableJPY)}</span></div>
      <div class="qsp-tax-row"><span>免税合計</span><span>¥${fmtJPY(exemptJPY)}</span></div>
      <div class="qsp-tax-row qsp-tax-amt"><span>${taxLabel}</span><span>¥${fmtJPY(taxAmt)}</span></div>
      ${hasFx ? '<p class="qsp-fx-note">※ 外貨は現在の参照レートで換算（概算）</p>' : ''}
    `;
  };

  // Phase 2b：DOMContentLoaded ではなく initQuoteUI() として呼び出すように変更
  function initQuoteUI() {
    restoreCargoFieldOrder();
    initCargoSort();
    renderPackingPreset();
    restoreLayoutScale();      // 大/中/小 スケールを復元
    refreshBulkCatSelect();    // 「選択行 → カテゴリ一括変更」セレクトを初期構築
    initQuoteViewMode();       // STEP A: 客先/社内モード復元
    initQuoteSectionCollapse(); // 上部セクションの折り畳み状態を復元
    initSectionHelpTooltips(); // 各セクションの説明文を ? アイコンのツールチップ化
    if (typeof initPreviewWarningListeners === 'function') initPreviewWarningListeners();
    if (typeof syncHazmatPanel === 'function') syncHazmatPanel(); // 危険品パネルの初期表示
    if (typeof syncMultiEntryFields === 'function') syncMultiEntryFields(); // コンテナ・荷姿の複数エントリ復元
    if (typeof window.renderQuoteMilestones === 'function') window.renderQuoteMilestones();
    if (typeof window.renderQuoteCargoInfo === 'function') window.renderQuoteCargoInfo();
    if (typeof window.renderQuoteCarrierLinks === 'function') window.renderQuoteCarrierLinks();
    // 参照セクションのレンダラをラップし、描画後に必ず空メッセージ判定を走らせる（冪等）
    ['renderQuoteMilestones', 'renderQuoteCargoInfo', 'renderQuoteCarrierLinks'].forEach(fn => {
      const orig = window[fn];
      if (typeof orig === 'function' && !orig.__refEmptyWrapped) {
        const wrapped = function (...args) {
          const r = orig.apply(this, args);
          if (typeof window.updateQuoteRefEmpty === 'function') window.updateQuoteRefEmpty();
          return r;
        };
        wrapped.__refEmptyWrapped = true;
        window[fn] = wrapped;
      }
    });
    if (typeof window.updateQuoteRefEmpty === 'function') window.updateQuoteRefEmpty();
    window.updateQuoteSummary();
  }

  // ===== 案件情報（管理番号入力）を右サマリパネルに常時表示 =====
  function fmtJpDate(iso) {
    if (!iso) return '';
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return iso;
    return `${m[1]}.${m[2]}.${m[3]}`;
  }
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ===== 各セクションの説明文を ? ボタンのホバーツールチップに変換 =====
  function initSectionHelpTooltips() {
    const sections = document.querySelectorAll('#tab-quote-make .condition-section');
    sections.forEach(sec => {
      const h2 = sec.querySelector('h2');
      const desc = sec.querySelector('.section-desc');
      if (!h2 || !desc) return;
      // 既に処理済みならスキップ
      if (sec.querySelector('.section-help-wrap')) return;

      // ? ボタンとラッパを生成
      const wrap = document.createElement('span');
      wrap.className = 'section-help-wrap';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'section-help-btn';
      btn.textContent = '?';
      btn.setAttribute('aria-label', 'このセクションの説明');
      btn.tabIndex = 0;
      // 折り畳みヘッダー内にある場合、クリックがトグルに伝播しないように
      btn.addEventListener('click', (e) => e.stopPropagation());

      // ツールチップ用に説明文を移動
      desc.classList.add('section-desc-tip');

      wrap.appendChild(btn);
      wrap.appendChild(desc);
      h2.appendChild(wrap);
    });
  }

  // ===== STEP A: 客先モード／社内モード 切替 =====
  // customer = 客先提示／画面共有用（支払い・乗せ幅・利益・サブコン非表示）
  // internal = 社内編集用（すべて表示）
  window.setQuoteViewMode = function(mode) {
    if (mode !== 'customer' && mode !== 'internal') mode = 'internal';
    const table = document.getElementById('quoteTable');
    const tab = document.getElementById('tab-quote-make');
    if (!table) return;
    table.classList.toggle('customer-mode', mode === 'customer');
    if (tab) tab.classList.toggle('qvm-customer', mode === 'customer');
    document.querySelectorAll('[data-qvm]').forEach(b => {
      b.classList.toggle('is-on', b.dataset.qvm === mode);
    });
    try { localStorage.setItem('quoteViewMode', mode); } catch(e) {}
    if (typeof quoteShowToast === 'function') {
      quoteShowToast(
        mode === 'customer'
          ? '👤 客先モードに切替 — 仕入・利益・サブコン列を非表示'
          : '🔓 社内モードに切替 — 全列表示',
        'info', 2200
      );
    }
  };

  function initQuoteViewMode() {
    // 社内/客先トグルは撤去したため常に社内モード（全列表示）で固定（初期化時はトースト無し）
    const table = document.getElementById('quoteTable');
    const tab = document.getElementById('tab-quote-make');
    if (table) table.classList.remove('customer-mode');
    if (tab) tab.classList.remove('qvm-customer');
    try { localStorage.setItem('quoteViewMode', 'internal'); } catch (e) {}
  }

  // ===== 見積テーブルより上のセクションの折り畳みトグル =====
  window.toggleQuoteSection = function(id) {
    const sec = document.getElementById(id);
    if (!sec) return;
    const collapsed = sec.classList.toggle('collapsed');
    try {
      const st = JSON.parse(localStorage.getItem('quoteSectionCollapse_v1') || '{}');
      st[id] = collapsed;
      localStorage.setItem('quoteSectionCollapse_v1', JSON.stringify(st));
    } catch(e) {}
    if (collapsed) updateSectionSummaries();
  };

  // 折り畳み時のヘッダー要約を更新
  function updateSectionSummaries() {
    // 管理番号
    const g = id => (document.getElementById(id)?.value || '').trim();
    const refParts = [g('qf-ref'), g('qf-customer'), g('qf-person') && (g('qf-person') + ' 様')].filter(Boolean);
    const sumRef = document.getElementById('sumRef');
    if (sumRef) sumRef.textContent = refParts.length ? '— ' + refParts.join(' / ') : '— 未入力';

    // 引き合い条件
    const condParts = [];
    const inco = g('cond-incoterms'); if (inco) condParts.push(inco);
    if (typeof _currentDirection !== 'undefined' && _currentDirection) {
      condParts.push(_currentDirection === 'export' ? '輸出' : '輸入');
    }
    if (typeof _currentTransport !== 'undefined' && _currentTransport) {
      let m = _currentTransport === 'air' ? 'Air' : 'Sea';
      if (_currentTransport !== 'air' && typeof _currentSeaSub !== 'undefined' && _currentSeaSub) {
        m += ' ' + _currentSeaSub.toUpperCase();
      }
      condParts.push(m);
    }
    const cargo = g('cond-cargo'); if (cargo) condParts.push(cargo);
    // コンテナ要約（hidden data）
    try {
      const cd = JSON.parse(document.getElementById('cond-container-data')?.value || '[]');
      if (cd.length) condParts.push(cd.map(e => `${e.type}×${e.count}`).join('・'));
    } catch(e) {}
    const sumCond = document.getElementById('sumCond');
    if (sumCond) sumCond.textContent = condParts.length ? '— ' + condParts.join(' / ') : '— 未入力';

    // 貨物情報
    const cargoParts = [];
    if (cargo) cargoParts.push(cargo);
    const hs = g('cond-hs'); if (hs) cargoParts.push('HS ' + hs);
    const hazmat = g('cond-hazmat'); if (hazmat && hazmat !== 'なし（一般貨物）') cargoParts.push(hazmat);
    const sumCargo = document.getElementById('sumCargo');
    if (sumCargo) sumCargo.textContent = cargoParts.length ? '— ' + cargoParts.join(' / ') : '— 未入力';

    // 物量情報
    const volParts = [];
    try {
      const cd = JSON.parse(document.getElementById('cond-container-data')?.value || '[]');
      if (cd.length) volParts.push(cd.map(e => `${e.type}×${e.count}`).join('・'));
    } catch(e) {}
    try {
      const pk = JSON.parse(document.getElementById('cond-packing-data')?.value || '[]');
      const named = pk.filter(e => e.pkg);
      if (named.length) volParts.push(named.map(e => `${e.pkg}×${e.qty||1}`).join('・'));
    } catch(e) {}
    const sumVolume = document.getElementById('sumVolume');
    if (sumVolume) sumVolume.textContent = volParts.length ? '— ' + volParts.join(' / ') : '— 未入力';
  }
  window.updateSectionSummaries = updateSectionSummaries;

  // 起動時に保存済みの折り畳み状態を復元
  function initQuoteSectionCollapse() {
    let st = {};
    try { st = JSON.parse(localStorage.getItem('quoteSectionCollapse_v1') || '{}'); } catch(e) {}
    ['section-ref', 'section-cond', 'section-cargo', 'section-volume'].forEach(id => {
      const sec = document.getElementById(id);
      if (sec && st[id]) sec.classList.add('collapsed');
    });
    updateSectionSummaries();

    // 入力完了 → 自動折り畳み：見積もりテーブルへ入ったら、内容のある上部セクションを畳む
    const tableSec = document.getElementById('section-table');
    if (tableSec && !tableSec.dataset.autoCollapseBound) {
      tableSec.dataset.autoCollapseBound = '1';
      tableSec.addEventListener('focusin', () => {
        ['section-ref', 'section-cond', 'section-cargo', 'section-volume'].forEach(id => {
          const sec = document.getElementById(id);
          if (!sec || sec.classList.contains('collapsed')) return;
          // 何か入力があるときだけ自動で畳む
          if (_sectionHasContent(id)) {
            sec.classList.add('collapsed');
            try {
              const s = JSON.parse(localStorage.getItem('quoteSectionCollapse_v1') || '{}');
              s[id] = true;
              localStorage.setItem('quoteSectionCollapse_v1', JSON.stringify(s));
            } catch(e) {}
          }
        });
        updateSectionSummaries();
      });
    }
  }

  // セクションに意味のある入力があるか
  function _sectionHasContent(id) {
    const g = fid => (document.getElementById(fid)?.value || '').trim();
    if (id === 'section-ref') {
      return !!(g('qf-ref') || g('qf-customer') || g('qf-person'));
    }
    if (id === 'section-cond') {
      if (g('cond-incoterms')) return true;
      if (typeof _currentDirection !== 'undefined' && _currentDirection) return true;
      if (typeof _currentTransport !== 'undefined' && _currentTransport) return true;
      return false;
    }
    if (id === 'section-cargo') {
      if (g('cond-cargo') || g('cond-hs')) return true;
      if (g('cond-hazmat') && g('cond-hazmat') !== 'なし（一般貨物）') return true;
      return false;
    }
    if (id === 'section-volume') {
      try { if (JSON.parse(document.getElementById('cond-container-data')?.value || '[]').length) return true; } catch(e) {}
      try { if (JSON.parse(document.getElementById('cond-packing-data')?.value || '[]').length) return true; } catch(e) {}
      return false;
    }
    return false;
  }

  // ===== 行操作ツールバー：詳細操作の折り畳みトグル =====
  window.toggleRowToolsDetail = function(btn) {
    const panel = document.getElementById('rowToolsDetail');
    if (!panel) return;
    const willOpen = panel.hasAttribute('hidden');
    if (willOpen) panel.removeAttribute('hidden');
    else          panel.setAttribute('hidden', '');
    if (btn) btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  };

  // ===== ツールバー ドロップダウンメニュー =====
  window.toggleTbMenu = function(name, ev) {
    if (ev) ev.stopPropagation();
    const menus = document.querySelectorAll('#tab-quote-make .tb-menu');
    menus.forEach(m => {
      const isTarget = m.dataset.tbMenu === name;
      const open = isTarget && !m.classList.contains('is-open');
      m.classList.toggle('is-open', open);
      const btn = m.querySelector('.save-btn-menu');
      if (btn) btn.classList.toggle('is-open', open);
    });
  };

  window.closeTbMenus = function() {
    document.querySelectorAll('#tab-quote-make .tb-menu.is-open').forEach(m => {
      m.classList.remove('is-open');
      const btn = m.querySelector('.save-btn-menu');
      if (btn) btn.classList.remove('is-open');
    });
  };

  // メニュー外クリックで閉じる
  document.addEventListener('click', (ev) => {
    if (!ev.target.closest('#tab-quote-make .tb-menu')) {
      window.closeTbMenus();
    }
  });
  // Escで閉じる
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') window.closeTbMenus();
  });

  // ===== 「このタブの使い方」をメニューから表示 =====
  window.openQuoteTabHelp = function() {
    const el = document.getElementById('quoteTabHelp');
    if (!el) return;
    el.style.display = '';
    el.open = true;
    // スムーズに位置合わせ（スクロール）
    const rect = el.getBoundingClientRect();
    const top = window.scrollY + rect.top - 80;
    window.scrollTo({ top, behavior: 'smooth' });
  };

  // ===== Phase 2b：見積タブ初回表示時の遅延初期化集約 =====
  window.__quoteInitialized = false;
  window.initQuoteTab = function() {
    if (window.__quoteInitialized) return;
    window.__quoteInitialized = true;
    initQuoteState();            // ui.js：リマーク・初期行・自動保存復元・為替自動取得
    initQuoteKeyNav();           // row.js：↑↓キーで行間移動
    initQuoteUI();               // ui.js：貨物フィールド並び替え・フォントサイズ
    if (typeof initQuoteAutoSaveListeners === 'function') {
      initQuoteAutoSaveListeners();  // save.js：input/change の自動保存
    }
  };
