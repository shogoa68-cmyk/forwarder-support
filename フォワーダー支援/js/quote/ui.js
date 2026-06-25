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
    { label: '💵 PREPAID限定',     text: 'お見積りはPREPAID限定の料金です。' },
    { label: '📐 単価見積もり',     text: '単価見積もりとなります。' },
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

  // ----- 共有プリセット（Supabase） -----
  let _sharedRemarkPresets = []; // { id, label, text, use_count, created_by, created_at }

  async function loadSharedRemarkPresets() {
    const c = window.quoteCloudClient && window.quoteCloudClient();
    if (!c) return;
    const { data, error } = await c
      .from('remark_presets')
      .select('id, label, text, use_count, created_by, created_at')
      .order('use_count', { ascending: false });
    if (!error && data) {
      _sharedRemarkPresets = data;
      renderRemarkPresets();
    }
  }

  async function addSharedRemarkPreset() {
    const c = window.quoteCloudClient && window.quoteCloudClient();
    const user = window.quoteCloudUser && window.quoteCloudUser();
    if (!c || !user) { quoteShowToast('⚠️ ログインが必要です', 'warn'); return; }
    const label = prompt('共有プリセットのラベル名を入力してください（例：📄 特別条件）');
    if (!label || !label.trim()) return;
    const text = prompt('共有プリセットの本文を入力してください');
    if (!text || !text.trim()) return;
    const { data, error } = await c
      .from('remark_presets')
      .insert({ label: label.trim(), text: text.trim(), use_count: 0, created_by: user.email })
      .select().single();
    if (error) { quoteShowToast('⚠️ 追加に失敗しました：' + error.message, 'warn'); return; }
    _sharedRemarkPresets.push(data);
    renderRemarkPresets();
    quoteShowToast(`✅ 「${label.trim()}」を共有プリセットに追加しました`, 'success');
  }

  async function deleteSharedRemarkPreset(id, label) {
    if (!confirm(`「${label}」を削除しますか？`)) return;
    const c = window.quoteCloudClient && window.quoteCloudClient();
    if (!c) return;
    const { error } = await c.from('remark_presets').delete().eq('id', id);
    if (error) { quoteShowToast('⚠️ 削除に失敗しました：' + error.message, 'warn'); return; }
    _sharedRemarkPresets = _sharedRemarkPresets.filter(p => p.id !== id);
    renderRemarkPresets();
    quoteShowToast(`🗑️ 「${label}」を削除しました`, 'info');
  }

  async function _incrementSharedRemarkUseCount(id) {
    const c = window.quoteCloudClient && window.quoteCloudClient();
    if (!c) return;
    const p = _sharedRemarkPresets.find(x => x.id === id);
    if (!p) return;
    const newCount = (p.use_count || 0) + 1;
    const { error } = await c.from('remark_presets').update({ use_count: newCount }).eq('id', id);
    if (!error) {
      p.use_count = newCount;
      if (newCount >= 5) renderRemarkPresets(); // 昇格時に再描画
    }
  }

  // 全プリセット = 固定 + チーム人気（use_count>=5）+ チーム共有 + 個人定義
  function getAllRemarkPresets() {
    const promoted = _sharedRemarkPresets.filter(p => p.use_count >= 5).map(p => ({ ...p, _promoted: true, _shared: true }));
    const shared   = _sharedRemarkPresets.filter(p => p.use_count < 5).map(p => ({ ...p, _shared: true }));
    return [...PRESETS, ...promoted, ...shared, ...getUserRemarkPresets().map(p => ({ ...p, _user: true }))];
  }

  function initRemarks() {
    renderRemarkPresets();
    document.getElementById('remarkTextarea').addEventListener('input', updateRemarkChar);
    updateRemarkChar();
    loadSharedRemarkPresets();
  }

  function renderRemarkPresets() {
    const wrap = document.getElementById('presetBtns');
    if (!wrap) return;
    wrap.innerHTML = '';
    const all = getAllRemarkPresets();
    const isLoggedIn = !!(window.quoteCloudUser && window.quoteCloudUser());

    function addTierLabel(text) {
      const d = document.createElement('div');
      d.className = 'preset-tier-label';
      d.textContent = text;
      wrap.appendChild(d);
    }

    function makeBtn(p, idx) {
      const btn = document.createElement('button');
      let cls = 'preset-btn';
      if (p._promoted) cls += ' preset-btn-promoted';
      else if (p._shared) cls += ' preset-btn-shared';
      else if (p._user) cls += ' preset-btn-user';
      btn.className = cls;
      btn.dataset.index = idx;
      btn.title = p.text;
      const lbl = document.createElement('span');
      lbl.textContent = p.label;
      btn.appendChild(lbl);
      if (p._user) {
        const x = document.createElement('span');
        x.className = 'preset-btn-del'; x.textContent = '✕';
        x.title = 'このプリセットを削除';
        x.onclick = (e) => { e.stopPropagation(); deleteUserRemarkPreset(p.label); };
        btn.appendChild(x);
      } else if (p._shared) {
        const x = document.createElement('span');
        x.className = 'preset-btn-del'; x.textContent = '✕';
        x.title = 'このプリセットを削除';
        const pid = p.id, plabel = p.label;
        x.onclick = (e) => { e.stopPropagation(); deleteSharedRemarkPreset(pid, plabel); };
        btn.appendChild(x);
      }
      btn.onclick = () => togglePreset(idx, btn);
      return btn;
    }

    let idx = 0;

    // ① 標準
    for (const p of PRESETS) wrap.appendChild(makeBtn(p, idx++));

    // ② チーム人気 ⭐
    const promotedItems = _sharedRemarkPresets.filter(p => p.use_count >= 5);
    if (promotedItems.length) {
      addTierLabel('チーム人気 ⭐');
      for (const p of promotedItems) wrap.appendChild(makeBtn({ ...p, _promoted: true, _shared: true }, idx++));
    }

    // ③ チーム共有 ☁️
    const sharedItems = _sharedRemarkPresets.filter(p => p.use_count < 5);
    if (sharedItems.length || isLoggedIn) {
      addTierLabel('チーム共有 ☁️');
      for (const p of sharedItems) wrap.appendChild(makeBtn({ ...p, _shared: true }, idx++));
      if (isLoggedIn) {
        const ab = document.createElement('button');
        ab.className = 'preset-btn preset-btn-add';
        ab.textContent = '☁️ 共有に追加';
        ab.onclick = () => addSharedRemarkPreset();
        wrap.appendChild(ab);
      }
    }

    // ④ 個人
    addTierLabel('個人');
    for (const p of getUserRemarkPresets()) wrap.appendChild(makeBtn({ ...p, _user: true }, idx++));
    const pb = document.createElement('button');
    pb.className = 'preset-btn preset-btn-add';
    pb.textContent = '＋ 個人に追加';
    pb.onclick = () => addUserRemarkPreset();
    wrap.appendChild(pb);
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
    const preset = all[i];
    const text = preset?.text;
    if (!text) return;
    if (btn.classList.contains('active')) {
      ta.value = ta.value.split('\n').filter(l => l.trim() !== text.trim()).join('\n').replace(/^\n+|\n+$/g, '');
      btn.classList.remove('active');
    } else {
      const cur = ta.value.trim();
      ta.value = cur ? cur + '\n' + text : text;
      btn.classList.add('active');
      if (preset._shared && preset.id) _incrementSharedRemarkUseCount(preset.id);
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
  window.updateRemarkChar = updateRemarkChar;
  window.loadSharedRemarkPresets = loadSharedRemarkPresets;

  function getRemarkText() {
    return document.getElementById('remarkTextarea')?.value.trim() || '';
  }

  function csvEsc(v) {
    const s = String(v == null ? '' : v);
    // 数式インジェクション対策（E-4）: 非数値で = + @ | 始まりの値に ' プレフィックス
    const safe = /^[=+@|]/.test(s) && isNaN(parseFloat(s)) ? "'" + s : s;
    return (safe.includes(',') || safe.includes('"') || safe.includes('\n') || safe.includes('\r'))
      ? '"' + safe.replace(/"/g, '""') + '"' : safe;
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
    // indexOf が -1 の通貨（order 外）は末尾へ（E-11: -1 の引き算で誤ソートを防ぐ）
    const pos = c => { const i = order.indexOf(c); return i === -1 ? Infinity : i; };
    const list = [...used].sort((a, b) => pos(a) - pos(b));
    if (!list.length) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
    bar.style.display = 'flex';
    const auto = (typeof _fxAutoMode !== 'undefined' && _fxAutoMode);
    bar.innerHTML = '<span class="fx-bar-icon">💱 換算レート</span>'
      + list.map(c => {
          const r = (typeof _fxRates !== 'undefined' && _fxRates[c]) ? _fxRates[c] : null;
          return `<span class="fx-bar-rate"><b>1 ${c}</b> = ${r ? r.toLocaleString() : '—'} 円</span>`;
        }).join('')
      + `<span class="fx-bar-src">${auto ? '🔄 自動取得' : '✎ 手動'}</span>`;
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
    const v = parseFloat(val);
    if (v > 0) {
      _fxRates[cur] = v;
      saveFxRates();
      updateTotals();
      // 通知なし（FBにより削除）
    }
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

  // 「カテゴリ一括設定」セレクトを最新カテゴリで再構築（先頭はプレースホルダ）
  function refreshBulkCatSelect() {
    const sel = document.getElementById('bulkCatSet');
    if (!sel) return;
    const userCats = getUserCategories();
    let html = '<option value="__none__">🏷️ カテゴリ一括設定…</option>';
    html += CATEGORIES.map(c => `<option value="${c.value}">${c.label}</option>`).join('');
    if (userCats.length) {
      html += '<option value="" disabled>──────────</option>';
      html += userCats.map(c => `<option value="${c.value}">${c.label}</option>`).join('');
    }
    sel.innerHTML = html;
    sel.value = '__none__';
  }

  // 選択（チェック）行のカテゴリを一括設定。選択は維持し、続けてサブコン設定も可能にする
  function applyBulkCategorySet(sel) {
    if (!sel || sel.value === '__none__') return;
    const checkboxes = document.querySelectorAll('.row-select-chk:checked');
    if (!checkboxes.length) {
      quoteShowToast('⚠️ 設定したい行のチェックボックスにチェックを入れてください', 'warn', 3000);
      sel.value = '__none__';
      return;
    }
    const newCat = sel.value;
    let count = 0;
    checkboxes.forEach(chk => {
      const tr = chk.closest('tr');
      if (!tr || tr.dataset.type === 'subtotal' || tr.dataset.type === 'remark') return;
      const id = tr.id.replace('row-', '');
      const catSel = document.getElementById(`cat-${id}`);
      if (!catSel) return;
      catSel.value = newCat;
      if (typeof onCatChange === 'function') onCatChange(id);
      count++;
    });
    sel.value = '__none__';   // プレースホルダへ戻す（選択行は維持）
    const catLabel = getAllCategories().find(c => c.value === newCat)?.label || '— カテゴリ —';
    quoteShowToast(`🏷️ ${count}行のカテゴリを「${catLabel}」に設定しました`, 'success');
  }

  // 「通貨一括設定」セレクトを CURRENCIES で構築
  function _refreshBulkCurrencySelect() {
    const sel = document.getElementById('bulkCurrencySet');
    if (!sel) return;
    sel.innerHTML = '<option value="__none__">💱 通貨一括設定…</option>'
      + CURRENCIES.map(c => `<option value="${c}">${c}</option>`).join('');
    sel.value = '__none__';
  }

  // 選択（チェック）行の請求通貨（bc）を一括設定。選択は維持
  function applyBulkCurrencySet(sel) {
    if (!sel || sel.value === '__none__') return;
    const checkboxes = document.querySelectorAll('.row-select-chk:checked');
    if (!checkboxes.length) {
      quoteShowToast('⚠️ 設定したい行のチェックボックスにチェックを入れてください', 'warn', 3000);
      sel.value = '__none__';
      return;
    }
    const newCurrency = sel.value;
    let count = 0;
    checkboxes.forEach(chk => {
      const tr = chk.closest('tr');
      if (!tr || tr.dataset.type === 'subtotal' || tr.dataset.type === 'remark') return;
      const id = tr.id.replace('row-', '');
      const bcEl = document.getElementById(`bc-${id}`);
      if (!bcEl) return;
      bcEl.value = newCurrency;
      bcEl.dispatchEvent(new Event('change', { bubbles: true }));
      count++;
    });
    sel.value = '__none__';
    quoteShowToast(`💱 ${count}行の通貨を「${newCurrency}」に設定しました`, 'success');
  }

  // 選択（チェック）行の単位（un）を一括設定。選択は維持
  function applyBulkUnitSet() {
    const inp = document.getElementById('bulkUnitSet');
    const newUnit = inp ? inp.value.trim() : '';
    if (!newUnit) return;
    const checkboxes = document.querySelectorAll('.row-select-chk:checked');
    if (!checkboxes.length) {
      quoteShowToast('⚠️ 設定したい行のチェックボックスにチェックを入れてください', 'warn', 3000);
      return;
    }
    let count = 0;
    checkboxes.forEach(chk => {
      const tr = chk.closest('tr');
      if (!tr || tr.dataset.type === 'subtotal' || tr.dataset.type === 'remark') return;
      const id = tr.id.replace('row-', '');
      const unEl = document.getElementById(`un-${id}`);
      if (!unEl) return;
      unEl.value = newUnit;
      unEl.dispatchEvent(new Event('change', { bubbles: true }));
      count++;
    });
    if (inp) inp.value = '';
    quoteShowToast(`📐 ${count}行の単位を「${newUnit}」に設定しました`, 'success');
  }

  // 選択（チェック）行のサブコンを一括設定（空欄ならクリア）。選択は維持
  function applyBulkSubcon() {
    const inp = document.getElementById('bulkSubconSet');
    if (!inp) return;
    const val = inp.value.trim();
    const checkboxes = document.querySelectorAll('.row-select-chk:checked');
    if (!checkboxes.length) {
      quoteShowToast('⚠️ 設定したい行のチェックボックスにチェックを入れてください', 'warn', 3000);
      return;
    }
    let count = 0;
    checkboxes.forEach(chk => {
      const tr = chk.closest('tr');
      if (!tr || tr.dataset.type === 'subtotal' || tr.dataset.type === 'remark') return;
      const id = tr.id.replace('row-', '');
      const svInp = document.getElementById(`sv-${id}`);
      if (!svInp) return;
      svInp.value = val;
      svInp.dispatchEvent(new Event('input', { bubbles: true }));   // 自動保存・サマリ更新を発火
      count++;
    });
    inp.value = '';
    quoteShowToast(`👷 ${count}行のサブコンを${val ? '「' + val + '」に' : 'クリアに'}設定しました`, 'success');
  }

  // 選択（チェック）行のパターンを一括設定。選択は維持
  function applyBulkPattern() {
    const inp = document.getElementById('bulkPatternSet');
    if (!inp) return;
    const val = inp.value.trim();
    const checkboxes = document.querySelectorAll('.row-select-chk:checked');
    if (!checkboxes.length) {
      quoteShowToast('⚠️ 設定したい行のチェックボックスにチェックを入れてください', 'warn', 3000);
      return;
    }
    let count = 0;
    checkboxes.forEach(chk => {
      const tr = chk.closest('tr');
      if (!tr || tr.dataset.type === 'subtotal' || tr.dataset.type === 'remark') return;
      const id = tr.id.replace('row-', '');
      const ptInp = document.getElementById(`pt-${id}`);
      if (!ptInp) return;
      ptInp.value = val;
      ptInp.dispatchEvent(new Event('input', { bubbles: true }));
      ptInp.dispatchEvent(new Event('change', { bubbles: true }));
      count++;
    });
    inp.value = '';
    quoteShowToast(`📋 ${count}行のパターンを${val ? '「' + val + '」に' : 'クリアに'}設定しました`, 'success');
  }

  // 選択（チェック）行の乗せ幅（mk）を一括設定。選択は維持
  function applyBulkMarkupSet() {
    const inp = document.getElementById('bulkMarkupSet');
    const raw = inp ? inp.value.trim() : '';
    if (raw === '') return;
    const num = Number(raw);
    if (!isFinite(num) || num < 0) {
      quoteShowToast('⚠️ 乗せ幅は 0 以上の数値で入力してください', 'warn', 3000);
      return;
    }
    const checkboxes = document.querySelectorAll('.row-select-chk:checked');
    if (!checkboxes.length) {
      quoteShowToast('⚠️ 設定したい行のチェックボックスにチェックを入れてください', 'warn', 3000);
      return;
    }
    let count = 0;
    checkboxes.forEach(chk => {
      const tr = chk.closest('tr');
      if (!tr || tr.dataset.type) return;   // データ行のみ（小計・リマーク・社内メモは除外）
      const id = tr.id.replace('row-', '');
      const mkEl = document.getElementById(`mk-${id}`);
      if (!mkEl) return;
      mkEl.value = num;
      mkEl.dispatchEvent(new Event('input', { bubbles: true }));  // calc(id) 再計算＋自動保存を発火
      count++;
    });
    if (inp) inp.value = '';
    if (typeof updateTotals === 'function') updateTotals();
    quoteShowToast(`＋ ${count}行の乗せ幅を「${num}」に設定しました`, 'success');
  }

  // ========== 一括コピー機能 ==========
  // position: 'below'（末尾選択行の直後）| 'above'（先頭選択行の直前）
  function copySelectedRows(position) {
    const pos = position || 'below';
    const checkboxes = document.querySelectorAll('.row-select-chk:checked');
    if (!checkboxes.length) {
      quoteShowToast('⚠️ コピーしたい行のチェックボックスにチェックを入れてください', 'warn', 3000);
      return;
    }
    const tbody = document.getElementById('tableBody');
    // querySelectorAll は document order を返すので、元の並びを保持
    // 小計行・リマーク行はコピー対象外（型混同を防止）（E-7）
    const srcRows = Array.from(checkboxes).map(chk => chk.closest('tr')).filter(tr => tr && !tr.dataset.type);
    if (!srcRows.length) {
      quoteShowToast('⚠️ 小計行・リマーク行はコピーできません。通常行を選択してください', 'warn', 3000);
      return;
    }
    // above: 先頭選択行の直前に固定挿入（順序保持）
    // below: 末尾選択行の直後に anchor を更新しながら順番に追加
    let anchor = pos === 'above' ? srcRows[0] : srcRows[srcRows.length - 1];
    const insertRow = (newTr) => {
      if (pos === 'above') {
        tbody.insertBefore(newTr, anchor);
        anchor = newTr.nextSibling; // 次も同じ位置（元先頭行）の直前へ
      } else {
        if (anchor.nextSibling) tbody.insertBefore(newTr, anchor.nextSibling);
        else tbody.appendChild(newTr);
        anchor = newTr;
      }
    };
    srcRows.forEach(srcTr => {
      rowCount++;
      const newId = rowCount;
      const srcId = srcTr.id.replace('row-', '');
      // 元行の値を読み取る
      const srcInputs = srcTr.querySelectorAll('input, select, textarea');
      const cells = Array.from(srcInputs).map(el => el.value);
      const newTr = document.createElement('tr');
      newTr.id = `row-${newId}`;
      newTr.replaceChildren(buildRowHTML(newId,
        document.getElementById(`cat-${srcId}`)?.value || '',
        document.getElementById(`pc-${srcId}`)?.value  || 'JPY'));
      insertRow(newTr);
      // 値を復元
      newTr.querySelectorAll('input, select, textarea').forEach((el, j) => {
        if (cells[j] !== undefined) el.value = cells[j];
      });
      initDrag(newTr);
      checkUnfilled(newId);
      onCatChange(newId);
      onPay(newId);
      // 課税チェックの状態をコピー（checkbox は .value では複製されないため明示的に）。
      // toggleTax で「*」付与・taxed クラス・消費税再計算の副作用も再適用する。
      const srcTx = document.getElementById(`tx-${srcId}`);
      const dstTx = document.getElementById(`tx-${newId}`);
      if (srcTx && dstTx) {
        dstTx.checked = srcTx.checked;
        if (dstTx.checked) toggleTax(newId);
      }
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
    quoteShowToast(`📋 ${srcRows.length}行を選択行の${pos === 'above' ? '上' : '下'}にコピーしました`, 'success');
    window.refreshRowSelectionMode?.();
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
    window.refreshRowSelectionMode?.();
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
    _legacyAddCalcRow();  // 旧サイズ計算行（#calcBody が無ければ何もしない）
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
    { icon:'🗂️', label:'管理番号入力セクションへ',  sub:'見積番号 / お客様 / 担当',     action:() => scrollToSection('section-ref')   },
    { icon:'🚢', label:'引き合い条件・貨物情報セクションへ', sub:'ルート・貨物名・CBM・CW 自動計算', action:() => scrollToSection('section-cond') },
    { icon:'💴', label:'見積もり表セクションへ',      sub:'費用行の入力・集計',              action:() => scrollToSection('section-table') },
    { icon:'📝', label:'条件・リマークセクションへ',  sub:'プリセット文を挿入',             action:() => scrollToSection('section-remark')},
    { icon:'➕', label:'行を追加',                    sub:'見積もり表に新しい行を末尾に追加', action:() => { addRow(); quoteShowToast('✅ 行を追加しました', 'success'); } },
    { icon:'📋', label:'選択行を下にコピー (Ctrl+D)',    sub:'チェック行を選択行の直後にコピー。未選択時はフォーカス行を複製', action:() => {
      const checked = document.querySelectorAll('.row-select-chk:checked');
      if (checked.length) { copySelectedRows('below'); return; }
      const tr = document.activeElement?.closest('#tableBody tr');
      if (tr && tr.id.startsWith('row-')) {
        duplicateRow(tr.id.replace('row-', ''));
        quoteShowToast('📋 行を複製しました', 'success');
      } else {
        quoteShowToast('⚠️ 行にフォーカスを当てるかチェックを入れてから実行してください', 'warn', 2500);
      }
    }},
    { icon:'📋', label:'選択行を上にコピー (Ctrl+Shift+D)', sub:'チェック行を選択行の直前にコピー', action:() => copySelectedRows('above') },
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

  // 数式セル（#tableBody/#calcBody 内の数値入力）か判定
  function _isFormulaCell(el) {
    return el && el.tagName === 'INPUT' && !el.readOnly
      && el.closest && el.closest('#tableBody, #calcBody');
  }

  // 式を評価して数値に確定（プレーン数値の直打ちも許容）
  function _evalAndShow(expr) {
    let result = safeEvalExpr(expr);
    if (result === null) {
      const n = Number(String(expr).trim());
      if (expr !== '' && isFinite(n)) result = n;
    }
    return result;
  }

  // Excel ライク数式モードへ移行（= を押した瞬間だけ number → text に一時変換）
  function enterFormulaMode(el, seed) {
    if (el.dataset.formulaMode === '1') return;
    el.dataset.formulaMode = '1';
    el.dataset.prevValue = el.value;
    // type 切替で同期的に発火し得る“偽の blur(focusout)”を無視させるため、
    // 切替の前にガードフラグを立てておく。
    el.dataset.formulaJustEntered = '1';
    el.type = 'text';                 // 演算子を受け付けるため一時的に text 化
    el.classList.add('formula-editing');
    el.value = (seed != null ? seed : '=');
    // type 切替でブラウザがフォーカスを外すことがあるため、明示的に取り戻す。
    try { el.focus(); } catch (_) {}
    try { el.setSelectionRange(el.value.length, el.value.length); } catch (_) {}
    // 偽 blur が来なかったブラウザではフラグが残らないよう次フレームで自動解除。
    setTimeout(function () { delete el.dataset.formulaJustEntered; }, 0);
  }

  // 数式モードを抜けて number に戻す（commit=true なら評価結果を確定）
  function exitFormulaMode(el, commit) {
    if (el.dataset.formulaMode !== '1') return;
    const expr = el.value.replace(/^=/, '').trim();
    const prev = el.dataset.prevValue || '';
    el.classList.remove('formula-editing');
    delete el.dataset.formulaMode;
    delete el.dataset.prevValue;
    el.type = 'number';
    if (!commit) { el.value = prev; return; }
    const result = _evalAndShow(expr);
    if (result !== null) {
      el.value = parseFloat(result.toFixed(6));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      if (/[+\-*/]/.test(expr)) {
        quoteShowToast('🧮 ' + expr + ' = ' + result.toLocaleString('ja-JP', {maximumFractionDigits:4}), 'info');
      }
    } else {
      el.value = prev;   // 評価不能なら元の値に復帰
    }
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

    // Excel ライク直打ち数式：number セルで "=" を押すと数式モードに入る。
    // <input type="number"> は "=" や "*" "/" を受け付けず value が空になるため、
    // keydown で "=" を捕捉してそのセルだけ一時的に text 化し、演算子を入力可能にする。
    // Enter / フォーカス離脱で評価 → 数値に確定し number へ戻す（Esc で取消）。
    root.addEventListener('keydown', function(e) {
      const el = e.target;
      if (!_isFormulaCell(el)) return;
      if (el.dataset.formulaMode === '1') {
        if (e.key === 'Enter')  { e.preventDefault(); exitFormulaMode(el, true);  }
        else if (e.key === 'Escape') { e.preventDefault(); exitFormulaMode(el, false); }
        return;
      }
      if (e.key === '=' && el.type === 'number') {
        e.preventDefault();
        enterFormulaMode(el, '=');
      }
    });
    // フォーカスが外れたら確定（Tab・クリック移動など）。
    // ただし type 切替直後にブラウザが出す“偽の blur”では確定しない。
    // 次のイベントループで本当にフォーカスが外れているか（activeElement）で判定する。
    root.addEventListener('focusout', function(e) {
      const el = e.target;
      if (!_isFormulaCell(el) || el.dataset.formulaMode !== '1') return;
      if (el.dataset.formulaJustEntered === '1') {
        // 数式モード突入直後の偽 blur。1回だけ無視してフォーカスを戻す。
        delete el.dataset.formulaJustEntered;
        if (document.activeElement !== el) { try { el.focus(); } catch (_) {} }
        return;
      }
      setTimeout(function() {
        if (el.dataset.formulaMode !== '1') return;
        if (document.activeElement === el) return;   // まだフォーカスあり＝偽 blur
        exitFormulaMode(el, true);
      }, 0);
    });
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
    return '一時保存_' + new Date().toLocaleDateString('sv', { timeZone: 'Asia/Tokyo' }).replace(/-/g, '');
  }

  // ========== 仮REF# 自動採番（発番ID2桁 ＋ YYMMDD ＋ 連番3桁） ==========
  // 連番は端末ローカル（localStorage）で日次リセット。発番IDはチーム内で一意のためチーム全体で重複しない。
  const REF_SEQ_KEY = 'refSeq_v1';
  function _refTodayYmd() {
    const iso = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Tokyo' }); // "YYYY-MM-DD" JST
    return iso.slice(2).replace(/-/g, ''); // "YYMMDD"
  }
  function _nextRefSeq(ymd) {
    let st = {};
    try { st = JSON.parse(localStorage.getItem(REF_SEQ_KEY) || '{}'); } catch (e) {}
    if (st.date !== ymd) st = { date: ymd, seq: 0 };   // 日付が変わったらリセット
    st.seq = (st.seq || 0) + 1;
    try { localStorage.setItem(REF_SEQ_KEY, JSON.stringify(st)); } catch (e) {}
    return st.seq;
  }
  // 11桁（ID2＋YYMMDD＋連番3）を区切り表示に整形：05-260612-001
  function _formatRef(raw) {
    if (!raw || raw.length < 11) return raw;
    return raw.slice(0, 2) + '-' + raw.slice(2, 8) + '-' + raw.slice(8);
  }
  function generateQuoteRefValue() {
    const no = window._myMemberNo;
    if (no == null) return null;                       // 発番ID未取得（未ログイン or 未登録）
    const id2 = String(no).padStart(2, '0');
    const ymd = _refTodayYmd();
    const seq = String(_nextRefSeq(ymd)).padStart(3, '0');
    return _formatRef(id2 + ymd + seq);                // 例：05-2606100-02
  }
  function _setRefValue(val) {
    const el = document.getElementById('qf-ref');
    if (!el) return;
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));   // 自動保存・サマリ更新を発火
    if (typeof window.updateQuoteRefEmpty === 'function') window.updateQuoteRefEmpty();
  }
  // ボタン：明示採番（既存値があれば上書き確認）
  function fillQuoteRef() {
    const el = document.getElementById('qf-ref');
    if (!el) return;
    if (window._myMemberNo == null) {
      quoteShowToast('⚠️ 発番IDが未取得です。ログイン、または管理者にメンバー登録（採番）を依頼してください', 'warn', 5500);
      return;
    }
    if (el.value.trim() && !confirm('現在の見積もり番号「' + el.value.trim() + '」を自動採番で上書きしますか？')) return;
    const v = generateQuoteRefValue();
    if (v) { _setRefValue(v); quoteShowToast('🔢 見積もり番号 ' + v + ' を採番しました', 'success'); }
  }
  // 新規（REFが空）のときだけ自動採番。発番ID未取得時は何もしない（取得時に再試行される）
  function maybeAutoFillRef() {
    const el = document.getElementById('qf-ref');
    if (!el || el.value.trim()) return;
    if (window._myMemberNo == null) return;
    const v = generateQuoteRefValue();
    if (v) _setRefValue(v);
  }
  window.fillQuoteRef     = fillQuoteRef;
  window.maybeAutoFillRef = maybeAutoFillRef;

  function openPresetMgr(mode) {
    // mode: 'browser'（ブラウザ保存）／'cloud'（チーム共有）。既定は browser。
    if (mode !== 'cloud') mode = 'browser';
    renderPresetList();
    const modal = document.getElementById('presetMgrModal');
    modal.classList.add('open');
    modal.dataset.mode = mode;
    // セクションの表示切替（独立した2画面として見せる）
    const browserSec = document.getElementById('presetBrowserSection');
    const cloudSec   = document.getElementById('cloudShareSection');
    if (browserSec) browserSec.style.display = (mode === 'cloud') ? 'none' : '';
    if (cloudSec)   cloudSec.style.display   = (mode === 'cloud') ? '' : 'none';
    // ☁️ チーム共有セクションの認証状態・一覧を反映（cloud.js）
    if (mode === 'cloud' && typeof cloudOnPresetMgrOpen === 'function') cloudOnPresetMgrOpen();
    // 名前欄：読込中のプリセット名を優先（コピー元の上書きを防ぐ）。未読込なら自動生成
    const input = document.getElementById('presetNameInput');
    if (input) {
      const loadedName = (document.getElementById('currentQuoteName')?.dataset.name || '').trim();
      input.value = loadedName || _buildDefaultPresetName();
    }
    if (mode === 'browser') setTimeout(() => { input?.focus(); input?.select(); }, 50);
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
        '⚠️ ブラウザ保存は最大 50 件です。不要なものを削除するか同名で上書きしてください。チーム全員で残すなら「☁️ チーム共有」もご利用ください',
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

  function duplicateLocalPreset(idx) {
    const presets = getPresets();
    const src = presets[idx];
    if (!src) return;
    const newData = JSON.parse(JSON.stringify(src.data || {}));
    if (!newData.fields) newData.fields = {};
    const srcRef = (newData.fields['qf-ref'] || '').trim();
    newData.copiedFrom = { name: src.name, ref: srcRef };
    // 発番ID取得済みなら新REF#をコピー時点で採番（未取得の場合はコピー元番号を保持）
    const newRef = typeof generateQuoteRefValue === 'function' ? generateQuoteRefValue() : null;
    if (newRef) newData.fields['qf-ref'] = newRef;
    let baseName = src.name + ' のコピー';
    let copyName = baseName;
    let n = 2;
    while (presets.some(p => p.name === copyName)) copyName = baseName + '_' + (n++);
    presets.unshift({ name: copyName, ts: new Date().toISOString(), data: newData });
    savePresetsToStorage(presets);
    renderPresetList();
    quoteShowToast('📋 「' + src.name + '」をコピーしました → 「' + copyName + '」', 'success', 3500);
  }

  // 案件ステータス（qf-status）→ ドット色
  const _PRESET_STATUS_DOT = { '下書き中':'#9c8e78', '提出済み':'#3f6a8c', '提示済み':'#3f6a8c', 'ヨコヨコ提示':'#0f9488', '受注':'#1e7e44', '失注':'#c0392b', '保留':'#b8860b', '辞退':'#6b21a8' };
  // プリセットの data.fields から一覧表示用メタを派生
  function _presetMeta(p) {
    const f = (p.data && p.data.fields) || {};
    let pol = (f['z2Pol'] || '').trim(), pod = (f['z2Pod'] || '').trim(), carrier = (f['z2Carrier'] || '').trim();
    // 複数航路（z2-routes-data）を POL/POD ペアの配列として保持
    let routes = [];
    try {
      const rts = JSON.parse(f['z2-routes-data'] || '[]');
      if (Array.isArray(rts)) {
        routes = rts.map(r => ({
          pol:     (r.pol     || '').trim(),
          pod:     (r.pod     || '').trim(),
          via:     (r.via     || '').trim(),
          carrier: (r.carrier || '').trim(),
        })).filter(r => r.pol || r.pod);
      }
    } catch (e) {}
    // 単一フィールドが未設定なら航路配列からフラット文字列を補完（DB列・検索用に従来通り維持）
    if (!pol && !pod && !carrier && routes.length) {
      pol     = routes.map(r => r.pol).filter(Boolean).join(', ');
      pod     = routes.map(r => r.pod).filter(Boolean).join(', ');
      carrier = routes.map(r => r.carrier).filter(Boolean).join(', ');
    }
    return {
      ref:       (f['qf-ref']         || '').trim(),
      customer:  (f['qf-customer']    || '').trim(),
      person:    (f['qf-person']      || '').trim(),
      incoterms: (f['cond-incoterms'] || '').trim(),
      mode:      (f['cond-mode']      || '').trim(),
      pol, pod, carrier, routes,
      status:    (f['qf-status']      || '').trim(),
      received:  (f['qf-received']    || '').trim(),
      due:       (f['qf-due']         || '').trim(),
      subcons:   (window.quoteExtractSubcons ? window.quoteExtractSubcons(p.data) : []),
      memo:      (f['qf-memo']        || '').trim().split('\n')[0].trim(),
    };
  }
  // チーム共有カードでも同じ表示にするため公開
  window.quotePresetMeta = _presetMeta;

  // ===== 進捗バー（プリセット管理モーダル） =====
  // ROW_CELL_FIELDS: ['cat','sv','tx','nm','pq','un','bq','pc','bc','pp','bp','cd','mk','nt']
  // cells[0]=checkbox, cells[2]=sv, cells[10]=pp, cells[13]=mk
  function _calcQuoteProgress(data) {
    var f  = (data && data.fields) || {};
    var dr = (data && Array.isArray(data.rows))
      ? data.rows.filter(function(r) { return r && r._type === 'data' && Array.isArray(r.cells); })
      : [];
    // Step1: 貿易条件＋輸送モード
    var s1 = Boolean((f['cond-incoterms'] || '').trim() && (f['cond-mode'] || '').trim());
    // Step2: 貨物情報（品名 or ルート）
    var cargo = (f['cond-cargo'] || '').trim();
    var hasRoute = Boolean((f['z2Pol'] || '').trim() || (f['z2Pod'] || '').trim());
    if (!hasRoute) { try { hasRoute = JSON.parse(f['z2-routes-data'] || '[]').length > 0; } catch(e) {} }
    var s2 = Boolean(cargo || hasRoute);
    // Step3: 仕入＝サブコン別の埋まり具合（サブ進捗）。sv ごとに pp>0 があれば「入力済み」
    var subs = {};
    dr.forEach(function(r) {
      var sv = (r.cells[2] || '').trim();
      if (!sv) return;
      if (!(sv in subs)) subs[sv] = false;
      if (parseFloat(r.cells[10]) > 0) subs[sv] = true;
    });
    var names = Object.keys(subs);
    var total = names.length;
    var filled = names.filter(function(n) { return subs[n]; }).length;
    var anyPp = dr.some(function(r) { return parseFloat(r.cells[10]) > 0; });
    var frac = total > 0 ? (filled / total) : (anyPp ? 1 : 0);   // 仕入のサブ進捗（0〜1）
    var s3 = total > 0 ? (filled === total) : anyPp;
    // Step4: のせ幅（mk>0 の行が1行以上）
    var s4 = dr.some(function(r) { return parseFloat(r.cells[13]) > 0; });
    // Step5: 出力済み（ステータス）
    var st = (f['qf-status'] || '').trim();
    var s5 = st === '提出済み' || st === '受注';
    return { steps: [s1, s2, s3, s4, s5], purchase: { total: total, filled: filled, frac: frac, names: names, subs: subs } };
  }

  var _QP_LABELS = ['条件', '貨物', '仕入', '利益', '出力'];
  var _QP_TITLES = ['貿易条件・輸送モード設定', '貨物情報入力', 'サブコン仕入れ値入力', 'のせ幅・売値設定', '見積書出力済み'];

  // 仕入ステップ：サブコンがあれば社数ぶんのセル＋「2/3」を表示（多いほど工数大が一目で分かる）
  function _purchaseStepHtml(pu) {
    if (!pu.total) {
      var ok = pu.frac >= 1;
      return '<span class="qp-step' + (ok ? ' qp-done' : '') + '" title="サブコン仕入れ値入力">仕入</span>';
    }
    var MAX = 6;
    var shown = pu.names.slice(0, MAX);
    var cells = shown.map(function(n) {
      var done = pu.subs[n];
      return '<span class="qp-sub' + (done ? ' is-done' : '') + '" title="' + escHtml(n) + '：' + (done ? '入力済み' : '未入力') + '"></span>';
    }).join('');
    var more = pu.names.length - shown.length;
    var allDone = pu.filled === pu.total;
    return '<span class="qp-step qp-step--sub' + (allDone ? ' qp-done' : '') +
        '" title="仕入：' + pu.filled + '/' + pu.total + ' 社入力済み（サブコン数が多いほど工数大）">' +
      '<span class="qp-sub-label">仕入 ' + pu.filled + '/' + pu.total + '</span>' +
      '<span class="qp-sub-cells">' + cells + (more > 0 ? '<span class="qp-sub-more">+' + more + '</span>' : '') + '</span>' +
    '</span>';
  }

  function _progressBarHtml(data) {
    var pr = _calcQuoteProgress(data);
    var steps = pr.steps, pu = pr.purchase;
    var doneFloat = (steps[0] ? 1 : 0) + (steps[1] ? 1 : 0) + pu.frac + (steps[3] ? 1 : 0) + (steps[4] ? 1 : 0);
    var pct  = Math.round(doneFloat / 5 * 100);
    var doneN = steps.filter(Boolean).length;
    var dots = steps.map(function(ok, i) {
      if (i === 2) return _purchaseStepHtml(pu);
      return '<span class="qp-step' + (ok ? ' qp-done' : '') + '" title="' + _QP_TITLES[i] + '">' + _QP_LABELS[i] + '</span>';
    }).join('');
    return '<div class="quote-progress" title="進捗 ' + doneN + '/5 (' + pct + '%)">' +
      '<div class="qp-bar"><div class="qp-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="qp-steps">' + dots + '</div>' +
    '</div>';
  }
  window.quoteProgressBarHtml = _progressBarHtml;

  // 航路表示の整形：複数航路は POL ごとにまとめて「POL → POD / POD …」を行単位で表示。
  // 1本・未設定はフラットな pol/pod にフォールバック。両モーダル（ブラウザ保存／チーム共有）で共用。
  function _routeGroups(meta) {
    const legs = (meta && Array.isArray(meta.routes)) ? meta.routes : [];
    if (legs.length >= 1) {
      const groups = [], idx = {};
      legs.forEach(lg => {
        const pol = (lg.pol || '').trim(), pod = (lg.pod || '').trim(), via = (lg.via || '').trim();
        if (!pol && !pod) return;
        if (!(pol in idx)) { idx[pol] = groups.length; groups.push({ pol, pods: [] }); }
        const key = pod + '|' + via;
        if (pod && !groups[idx[pol]].pods.some(p => (p.pod + '|' + p.via) === key)) groups[idx[pol]].pods.push({ pod, via });
      });
      if (groups.length) return groups;
    }
    const pol = ((meta && meta.pol) || '').trim(), pod = ((meta && meta.pod) || '').trim();
    if (!pol && !pod) return [];
    return [{ pol, pods: pod ? [{ pod, via: '' }] : [] }];
  }
  function quoteRouteHtml(meta, arrowClass) {
    const groups = _routeGroups(meta);
    if (!groups.length) return '';
    const arrow = '<span class="' + (arrowClass || 'preset-kv-arrow') + '">→</span>';
    const MAXP = 6;   // 1 グループあたりの POD 表示上限（超過は +N）
    return groups.map(g => {
      const shown = g.pods.slice(0, MAXP), more = g.pods.length - shown.length;
      const pods = shown.map(p =>
        (p.via ? '<span class="route-via" title="経由地（トランシップ等）">⚓経由 ' + escHtml(p.via) + '</span> ' + arrow + ' ' : '')
        + escHtml(p.pod)
      ).join(' <span class="route-sep">/</span> ')
                 + (more > 0 ? ' <span class="route-more">他' + more + '</span>' : '');
      const polH = g.pol ? escHtml(g.pol) : '';
      const body = (polH && pods) ? (polH + ' ' + arrow + ' ' + pods) : (polH || pods);
      return '<div class="route-line">' + body + '</div>';
    }).join('');
  }
  window.quoteRouteHtml = quoteRouteHtml;

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
      const m = _presetMeta(p);

      const route = quoteRouteHtml(m, 'preset-kv-arrow');
      const condHtml =
        (m.incoterms ? '<span class="preset-tag preset-tag-inco">' + escHtml(m.incoterms.split('（')[0]) + '</span>' : '') +
        (m.mode      ? '<span class="preset-tag preset-tag-mode">' + escHtml(m.mode) + '</span>' : '');
      const personH = m.person && (window.formatPersonWithHonorific ? window.formatPersonWithHonorific(m.person) : m.person);
      const custDd = [m.customer && escHtml(m.customer), personH && escHtml(personH)].filter(Boolean).join('・');
      const titleText = m.ref || p.name;   // カード見出しは仮REF#のみ（顧客/担当は下に別掲）

      const subShown = m.subcons.slice(0, 4);
      const subMore  = m.subcons.length - subShown.length;
      const subHtml = subShown.map(s =>
        '<span class="preset-sc-item">' +
          (s.role ? '<span class="preset-sc-role">' + escHtml(s.role) + '</span>' : '') +
          '<span class="preset-sc-name">' + escHtml(s.name) + '</span>' +
        '</span>').join('') + (subMore > 0 ? '<span class="preset-sc-more">+' + subMore + '</span>' : '');

      const statusHtml = m.status
        ? '<span class="preset-status"><span class="preset-status-dot" style="background:' +
            (_PRESET_STATUS_DOT[m.status] || '#9c8e78') + '"></span>' + escHtml(m.status) + '</span>'
        : '';

      const cf = p.data && p.data.copiedFrom;
      const cfLabel = cf ? escHtml(cf.name || '不明') + (cf.ref ? ' <span class="preset-cf-ref">(' + escHtml(cf.ref) + ')</span>' : '') : '';
      const copiedFromHtml = cf
        ? '<div class="preset-copied-from">📋 コピー元：<span class="preset-cf-name">' + cfLabel + '</span></div>'
        : '';

      return '<div class="preset-list-item preset-item-rich' + (isLoaded ? ' preset-list-item--loaded' : '') + '">' +
        '<div class="preset-rich-row1">' +
          statusHtml +
          '<span class="preset-list-name" title="' + escHtml(p.name) + '">' + escHtml(titleText) + '</span>' +
          '<button class="btn-ref-copy" data-ref="' + escHtml(titleText) + '" onclick="copyRefNumber(this.dataset.ref,this)" title="管理番号をコピー（&quot;番号&quot;形式）"><svg class="icon-copy" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="1" width="9" height="9" rx="1.5"/><rect x="1" y="4" width="9" height="9" rx="1.5"/></svg></button>' +
          (isLoaded ? '<span class="preset-loaded-badge">編集中</span>' : '') +
        '</div>' +
        _progressBarHtml(p.data) +
        '<dl class="preset-rich-kv">' +
          (route    ? '<dt>ルート</dt><dd>' + route + '</dd>' : '') +
          (condHtml ? '<dt>条件</dt><dd class="preset-rich-tags">' + condHtml + '</dd>' : '') +
          (m.carrier ? '<dt>幹線</dt><dd>🚢 ' + escHtml(m.carrier) + '</dd>' : '') +
          (subHtml  ? '<dt>サブコン</dt><dd class="preset-rich-sub">' + subHtml + '</dd>' : '') +
          (custDd   ? '<dt>お客様 / 担当</dt><dd>' + custDd + '</dd>' : '') +
        '</dl>' +
        copiedFromHtml +
        '<div class="preset-rich-foot">' +
          '<span class="preset-list-ts">' + (ts ? '💾 ' + ts : '') + '</span>' +
          '<div class="preset-rich-acts">' +
            '<button class="btn-preset-load" onclick="loadPreset(' + i + ')">読み込む</button>' +
            '<button class="btn-preset-copy" onclick="duplicateLocalPreset(' + i + ')" title="コピーして新規案件を作成">📋 コピー</button>' +
            '<button class="btn-preset-del"  onclick="deletePreset(' + i + ')" title="削除">✕</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  // ========== 行パターン（チェック行を保存・読込／Supabase チーム共有） ==========
  const ROW_PATTERN_KEY = 'quoteRowPatterns_v1';   // ← 旧localStorage（移行取り込み用に参照のみ）
  let _rowPatterns = [];                            // クラウドキャッシュ（id 付き）

  function _rpClient() { return (window.quoteCloudClient && window.quoteCloudClient()) || window.SupabaseClient || null; }
  function _rpUserEmail() {
    const u = window.quoteCloudUser && window.quoteCloudUser();
    return u ? (u.email || null) : null;
  }
  function _rpName(email) { return window.quoteDisplayName ? window.quoteDisplayName(email) : (email || '—'); }

  // クラウドから行パターンを取得してキャッシュ＋再描画
  async function loadRowPatternsFromCloud() {
    const wrap = document.getElementById('rowPatternListWrap');
    const db = _rpClient();
    if (!db || !_rpUserEmail()) {
      _rowPatterns = [];
      if (wrap) wrap.innerHTML = '<div class="preset-empty">☁️ ログインするとチームの保存パターンを利用できます<br><small style="color:#bbb;">ツールバーの「☁️ チーム共有」からログイン</small></div>';
      return;
    }
    if (wrap) wrap.innerHTML = '<div class="preset-empty">読み込み中…</div>';
    if (window.quoteLoadProfiles) { try { await window.quoteLoadProfiles(); } catch (e) {} }
    const { data, error } = await db.from('row_patterns').select('*').order('updated_at', { ascending: false });
    if (error) {
      if (wrap) wrap.innerHTML = '<div class="preset-empty">⚠️ 読み込みエラー：' + escHtml(error.message) + '</div>';
      return;
    }
    _rowPatterns = data || [];
    renderRowPatternList();
  }

  // チェック済み行のデータを抽出（通常行・リマーク行・小計行を含む）
  function _gatherCheckedRowsData() {
    const out = [];
    document.querySelectorAll('#tableBody tr .row-select-chk:checked').forEach(chk => {
      const tr = chk.closest('tr');
      if (!tr) return;
      if (tr.dataset.type === 'remark') {
        out.push({ _type: 'remark', text: tr.querySelector('.remark-row-input')?.value || '', internal: tr.dataset.internal === '1' });
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
    const inp = document.getElementById('rowPatternNameInput');
    if (inp && !inp.value) {
      const d = new Date();
      const pad = n => String(n).padStart(2, '0');
      inp.value = `パターン_${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
    }
    document.getElementById('rowPatternModal').classList.add('open');
    loadRowPatternsFromCloud();
    setTimeout(() => inp?.focus(), 50);
  }
  function closeRowPatternMgr() { document.getElementById('rowPatternModal').classList.remove('open'); }

  async function saveRowPatternFromChecked() {
    const rows = _gatherCheckedRowsData();
    if (!rows.length) {
      quoteShowToast('⚠️ 保存する行のチェックボックスを選択してください', 'warn', 3000);
      return;
    }
    const nameInp = document.getElementById('rowPatternNameInput');
    const noteInp = document.getElementById('rowPatternNoteInput');
    const name = (nameInp?.value || '').trim();
    if (!name) {
      quoteShowToast('⚠️ パターン名を入力してください', 'warn');
      nameInp?.focus();
      return;
    }
    const note = (noteInp?.value || '').trim();
    const db = _rpClient();
    const email = _rpUserEmail();
    if (!db || !email) { quoteShowToast('⚠️ チーム共有にはログインが必要です', 'warn', 3500); return; }

    // 同名は上書き、無ければ新規（チーム全員で共有）
    const exist = _rowPatterns.find(p => p.name === name);
    let res;
    if (exist) {
      if (!confirm(`「${name}」を上書きしますか？（チーム全員に反映されます）`)) return;
      res = await db.from('row_patterns')
        .update({ rows, note, updated_by: email, updated_at: new Date().toISOString() })
        .eq('id', exist.id);
    } else {
      res = await db.from('row_patterns')
        .insert({ name, rows, note, created_by: email, updated_by: email });
    }
    if (res.error) { quoteShowToast('⚠️ 保存に失敗：' + res.error.message, 'warn', 6000); return; }
    if (nameInp) nameInp.value = '';
    if (noteInp) noteInp.value = '';
    await loadRowPatternsFromCloud();
    quoteShowToast(`💾 行パターン「${name}」を保存（${rows.length}行・チーム共有）`, 'success');
  }

  // 行データ配列を現在のテーブルに挿入（挿入位置セレクトを尊重）。posLabel を返す。
  function _insertPatternRows(patternRows) {
    const pos = document.getElementById('rowPatternInsertPos')?.value || 'end';
    const tbody = document.getElementById('tableBody');
    let anchor = null;
    let posLabel = '末尾';
    if (pos === 'selected') {
      const checked = document.querySelectorAll('#tableBody tr .row-select-chk:checked');
      if (!checked.length) {
        quoteShowToast('⚠️ 挿入位置「選択行の下」が選ばれていますがチェック行がありません。末尾に追加します', 'warn', 3500);
      } else {
        const lastTr = checked[checked.length - 1].closest('tr');
        anchor = lastTr?.nextSibling || null;
        posLabel = '選択行の下';
      }
    } else if (pos === 'top') {
      anchor = tbody.querySelector('tr') || null;
      posLabel = '先頭';
    }

    (patternRows || []).forEach(rd => {
      if (rd._type === 'remark') {
        insertRemarkRow(null, { noFocus: true, internal: rd.internal });
        const allTrs = document.querySelectorAll('#tableBody tr');
        const tr = allTrs[allTrs.length - 1];
        if (!tr) return;
        if (anchor) tbody.insertBefore(tr, anchor);
        const inp = tr.querySelector('.remark-row-input');
        if (inp) inp.value = rd.text || '';
        return;
      }
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
      addRow();
      const trs = document.querySelectorAll('#tableBody tr');
      const tr = trs[trs.length - 1];
      if (!tr) return;
      if (anchor) tbody.insertBefore(tr, anchor);
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
    if (typeof updateSubtotalRows === 'function') updateSubtotalRows();
    updateTotals();
    return posLabel;
  }

  // 行データ配列を指定 <tr> の直前に挿入（ドラッグ＆ドロップ用）。anchorTr=null で末尾。
  function _insertPatternRowsAt(patternRows, anchorTr) {
    const tbody = document.getElementById('tableBody');
    if (!tbody) return;
    (patternRows || []).forEach(rd => {
      if (rd._type === 'remark') {
        insertRemarkRow(null, { noFocus: true, internal: rd.internal });
        const allTrs = document.querySelectorAll('#tableBody tr');
        const tr = allTrs[allTrs.length - 1];
        if (!tr) return;
        if (anchorTr) tbody.insertBefore(tr, anchorTr);
        const inp = tr.querySelector('.remark-row-input');
        if (inp) inp.value = rd.text || '';
        return;
      }
      if (rd._type === 'subtotal') {
        insertSubtotalRow(null);
        const allTrs = document.querySelectorAll('#tableBody tr');
        const tr = allTrs[allTrs.length - 1];
        if (!tr) return;
        if (anchorTr) tbody.insertBefore(tr, anchorTr);
        const lbl = tr.querySelector('.subtotal-label');
        if (lbl) lbl.value = rd.label || '';
        updateSubtotalRows();
        return;
      }
      addRow();
      const trs = document.querySelectorAll('#tableBody tr');
      const tr = trs[trs.length - 1];
      if (!tr) return;
      if (anchorTr) tbody.insertBefore(tr, anchorTr);
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
    if (typeof updateSubtotalRows === 'function') updateSubtotalRows();
    updateTotals();
    if (typeof renderSubconGroups === 'function') renderSubconGroups();
  }
  window._insertPatternRows   = _insertPatternRows;
  window._insertPatternRowsAt = _insertPatternRowsAt;

  function loadRowPattern(id) {
    const p = _rowPatterns.find(x => x.id === id);
    if (!p) return;
    const posLabel = _insertPatternRows(p.rows);
    closeRowPatternMgr();
    quoteShowToast(`📂 「${p.name}」の ${p.rows.length} 行を${posLabel}に挿入しました`, 'success');
  }

  async function deleteRowPattern(id) {
    const p = _rowPatterns.find(x => x.id === id);
    if (!p) return;
    if (!confirm(`行パターン「${p.name}」を削除しますか？（チーム全員から削除されます）`)) return;
    const db = _rpClient();
    if (!db) return;
    const { error } = await db.from('row_patterns').delete().eq('id', p.id);
    if (error) { quoteShowToast('⚠️ 削除に失敗：' + error.message, 'warn', 6000); return; }
    await loadRowPatternsFromCloud();
    quoteShowToast(`🗑️ 「${p.name}」を削除しました`, 'info');
  }

  // ===== 行パターン：ファイルへの書き出し（クラウドキャッシュから） =====
  window.exportRowPatterns = function() {
    const patterns = _rowPatterns;
    if (!patterns.length) {
      quoteShowToast('⚠️ 保存済みの行パターンがありません', 'warn');
      return;
    }
    const payload = {
      _type:      'rowPatterns',
      _version:   2,
      _app:       'フォワーダー支援ツール',
      exportedAt: new Date().toISOString(),
      patterns:   patterns.map(p => ({ name: p.name, note: p.note || '', rows: p.rows || [], links: p.links || [] })),
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

  // ===== 行パターン：ファイルからの読み込み（クラウドへ取り込み） =====
  window.importRowPatternsFile = function(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    if (!file.name.endsWith('.json')) {
      quoteShowToast('⚠️ .json ファイルを選択してください', 'error');
      return;
    }
    const db = _rpClient();
    const email = _rpUserEmail();
    if (!db || !email) { quoteShowToast('⚠️ 取り込みにはログインが必要です', 'warn', 3500); return; }
    const reader = new FileReader();
    reader.onload = async function(e) {
      let data;
      try { data = JSON.parse(e.target.result); }
      catch(err) { quoteShowToast('⚠️ ファイルの解析に失敗しました: ' + err.message, 'error'); return; }
      if (data._type !== 'rowPatterns' || !Array.isArray(data.patterns)) {
        quoteShowToast('⚠️ 行パターンのファイルではありません', 'error');
        return;
      }
      const incoming = data.patterns.filter(p => p && p.name && Array.isArray(p.rows));
      if (!incoming.length) { quoteShowToast('ℹ️ 有効なパターンが含まれていません', 'info'); return; }
      const existNames = new Set(_rowPatterns.map(p => p.name));
      const dup = incoming.filter(p => existNames.has(p.name));
      if (!confirm(`${incoming.length} 件をチーム共有に取り込みます。` +
          (dup.length ? `\n▲ 同名 ${dup.length} 件は上書きされます。` : '') + '\n\n続けますか？')) return;
      let ok = 0;
      for (const p of incoming) {
        const exist = _rowPatterns.find(x => x.name === p.name);
        const res = exist
          ? await db.from('row_patterns').update({ rows: p.rows, note: p.note || '', updated_by: email, updated_at: new Date().toISOString() }).eq('id', exist.id)
          : await db.from('row_patterns').insert({ name: p.name, rows: p.rows, note: p.note || '', created_by: email, updated_by: email });
        if (!res.error) ok++;
      }
      await loadRowPatternsFromCloud();
      quoteShowToast(`📥 ${ok} 件の行パターンを取り込みました`, 'success');
    };
    reader.readAsText(file, 'utf-8');
  };

  // 行パターン内の1行を一覧用ラベルに整形（種別アイコン＋カテゴリ＋名称＋単価）
  function _rpRowLabel(rd) {
    if (!rd) return '';
    if (rd._type === 'remark')
      return '<span class="rp-row-ic">📝</span><span class="rp-row-nm">' +
        (escHtml(rd.text) || '<i class="rp-row-empty">（空のリマーク）</i>') + '</span>';
    if (rd._type === 'subtotal')
      return '<span class="rp-row-ic">Σ</span><span class="rp-row-nm">' +
        (escHtml(rd.label) || '小計') + '</span>';
    const cats = (typeof getAllCategories === 'function') ? getAllCategories() : [];
    const catLbl = (cats.find(c => c.value === rd.cat) || {}).label || '';
    const catH = catLbl ? '<span class="rp-row-cat">' + escHtml(catLbl) + '</span>' : '';
    const nmH  = '<span class="rp-row-nm">' +
      (escHtml(rd.name) || '<i class="rp-row-empty">（名称なし）</i>') + '</span>';
    const price = rd.bp || rd.pp;
    const cur   = rd.bp ? (rd.bc || '') : (rd.pc || '');
    const prH   = price ? '<span class="rp-row-price">' + escHtml(cur) + ' ' + escHtml(price) + '</span>' : '';
    return catH + nmH + prH;
  }

  // 全選択トグル（同じカード内の明細チェックを一括）
  function rpToggleAllRows(allChk) {
    const card = allChk.closest('.rp-card');
    if (!card) return;
    card.querySelectorAll('.rp-row-chk').forEach(c => { c.checked = allChk.checked; });
  }
  window.rpToggleAllRows = rpToggleAllRows;

  // 選択した明細だけを挿入（挿入位置セレクトを尊重）
  function insertSelectedPatternRows(id) {
    const p = _rowPatterns.find(x => x.id === id);
    if (!p) return;
    const sel  = (window.CSS && CSS.escape) ? CSS.escape(id) : id;
    const card = document.querySelector('.rp-card[data-pid="' + sel + '"]');
    if (!card) return;
    const idxs = Array.from(card.querySelectorAll('.rp-row-chk:checked'))
      .map(c => parseInt(c.dataset.idx, 10));
    if (!idxs.length) { quoteShowToast('⚠️ 挿入する明細を1つ以上選択してください', 'warn', 3000); return; }
    const subset = idxs.map(i => p.rows[i]).filter(Boolean);
    const posLabel = _insertPatternRows(subset);
    closeRowPatternMgr();
    quoteShowToast(`📂 「${p.name}」から ${subset.length} 行を${posLabel}に挿入しました`, 'success');
  }
  window.insertSelectedPatternRows = insertSelectedPatternRows;

  // ===== 行パターン：編集（名前・メモ・参照URL・明細） =====
  let _rpEdit = null;   // 編集中の作業オブジェクト { id, name, note, links:[{label,url}], rows:[] }

  function _rpLinkHost(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url; }
  }

  function openRowPatternEdit(id) {
    const p = _rowPatterns.find(x => x.id === id);
    if (!p) return;
    _rpEdit = {
      id:    p.id,
      name:  p.name || '',
      note:  p.note || '',
      links: Array.isArray(p.links) ? p.links.map(l => ({ label: l.label || '', url: l.url || '' })) : [],
      rows:  Array.isArray(p.rows)  ? p.rows.map(r => Object.assign({}, r)) : [],
    };
    const nm = document.getElementById('rpEditName'); if (nm) nm.value = _rpEdit.name;
    const nt = document.getElementById('rpEditNote'); if (nt) nt.value = _rpEdit.note;
    _rpEditRenderLinks();
    _rpEditRenderRows();
    document.getElementById('rpEditOverlay')?.classList.add('open');
  }
  function closeRowPatternEdit() {
    document.getElementById('rpEditOverlay')?.classList.remove('open');
    _rpEdit = null;
  }

  function rpEditAddLink()      { if (_rpEdit) { _rpEdit.links.push({ label: '', url: '' }); _rpEditRenderLinks(); } }
  function rpEditRemoveLink(i)  { if (_rpEdit) { _rpEdit.links.splice(i, 1); _rpEditRenderLinks(); } }
  function rpEditSetLink(i, key, val) { if (_rpEdit && _rpEdit.links[i]) _rpEdit.links[i][key] = val; }
  function _rpEditRenderLinks() {
    const box = document.getElementById('rpEditLinks');
    if (!box || !_rpEdit) return;
    if (!_rpEdit.links.length) {
      box.innerHTML = '<div class="rp-edit-empty">URL未登録。「＋ URLを追加」で参照元を登録できます</div>';
      return;
    }
    box.innerHTML = _rpEdit.links.map((l, i) =>
      '<div class="rp-edit-link-row">' +
        '<input type="text" class="rp-edit-link-label" placeholder="ラベル（例：料率表）" value="' + escHtml(l.label) + '" oninput="rpEditSetLink(' + i + ',\'label\',this.value)">' +
        '<input type="url" class="rp-edit-link-url" placeholder="https://…" value="' + escHtml(l.url) + '" oninput="rpEditSetLink(' + i + ',\'url\',this.value)">' +
        '<button type="button" class="btn-preset-del" onclick="rpEditRemoveLink(' + i + ')" title="このURLを削除">✕</button>' +
      '</div>').join('');
  }

  function rpEditDeleteRow(i) { if (_rpEdit) { _rpEdit.rows.splice(i, 1); _rpEditRenderRows(); } }
  function rpEditMoveRow(i, dir) {
    if (!_rpEdit) return;
    const j = i + dir;
    if (j < 0 || j >= _rpEdit.rows.length) return;
    const t = _rpEdit.rows[i]; _rpEdit.rows[i] = _rpEdit.rows[j]; _rpEdit.rows[j] = t;
    _rpEditRenderRows();
  }
  // セル値の更新（再描画しない＝入力フォーカスを保持）
  function rpEditSetCell(i, key, val) { if (_rpEdit && _rpEdit.rows[i]) _rpEdit.rows[i][key] = val; }
  // 明細を新規追加（費用行／リマーク／小計）
  function rpEditAddRow(type) {
    if (!_rpEdit) return;
    let row;
    if (type === 'remark')        row = { _type: 'remark', text: '', internal: false };
    else if (type === 'subtotal') row = { _type: 'subtotal', label: '' };
    else row = { _type: 'data', cat: '', name: '', taxed: false, pq: '', un: '',
                 pc: 'JPY', pp: '', bq: '', bc: 'JPY', bp: '', mk: '', note: '', sv: '' };
    _rpEdit.rows.push(row);
    _rpEditRenderRows();
    const box = document.getElementById('rpEditRows');
    box?.querySelector('.rp-edit-row:last-child .rp-er-name')?.focus();
  }

  // 1明細ぶんのインライン編集UI
  function _rpEditRowEditor(rd, i, last) {
    const acts =
      '<span class="rp-er-acts">' +
        '<button type="button" onclick="rpEditMoveRow(' + i + ',-1)" title="上へ"' + (i === 0 ? ' disabled' : '') + '>▲</button>' +
        '<button type="button" onclick="rpEditMoveRow(' + i + ',1)" title="下へ"' + (i === last ? ' disabled' : '') + '>▼</button>' +
        '<button type="button" class="btn-preset-del" onclick="rpEditDeleteRow(' + i + ')" title="この明細を削除">✕</button>' +
      '</span>';
    if (rd._type === 'remark') {
      return '<div class="rp-edit-row rp-er--remark">' +
        '<span class="rp-er-ic">📝</span>' +
        '<input type="text" class="rp-er-name" placeholder="リマーク文" value="' + escHtml(rd.text || '') + '" oninput="rpEditSetCell(' + i + ',\'text\',this.value)">' +
        '<label class="rp-er-chk" title="社内用（客先出力に含めない）"><input type="checkbox"' + (rd.internal ? ' checked' : '') + ' onchange="rpEditSetCell(' + i + ',\'internal\',this.checked)">社内</label>' +
        acts +
      '</div>';
    }
    if (rd._type === 'subtotal') {
      return '<div class="rp-edit-row rp-er--subtotal">' +
        '<span class="rp-er-ic">Σ</span>' +
        '<input type="text" class="rp-er-name" placeholder="小計ラベル" value="' + escHtml(rd.label || '') + '" oninput="rpEditSetCell(' + i + ',\'label\',this.value)">' +
        acts +
      '</div>';
    }
    // data 行：カテゴリ・品目名・単位・課税／仕入(単価・通貨)・売上(単価・通貨)・備考
    return '<div class="rp-edit-row rp-er--data">' +
      '<div class="rp-er-l1">' +
        '<select class="rp-er-cat" onchange="rpEditSetCell(' + i + ',\'cat\',this.value)">' + catOpts(rd.cat || '') + '</select>' +
        '<input type="text" class="rp-er-name" placeholder="品目名" value="' + escHtml(rd.name || '') + '" oninput="rpEditSetCell(' + i + ',\'name\',this.value)">' +
        '<select class="rp-er-unit" title="単位" onchange="rpEditSetCell(' + i + ',\'un\',this.value)">' + unitOpts(rd.un || '') + '</select>' +
        '<label class="rp-er-chk" title="課税対象"><input type="checkbox"' + (rd.taxed ? ' checked' : '') + ' onchange="rpEditSetCell(' + i + ',\'taxed\',this.checked)">税</label>' +
        acts +
      '</div>' +
      '<div class="rp-er-l2">' +
        '<span class="rp-er-grp rp-er-grp--cost">仕</span>' +
        '<input type="text" inputmode="decimal" class="rp-er-num" placeholder="単価" value="' + escHtml(rd.pp || '') + '" oninput="rpEditSetCell(' + i + ',\'pp\',this.value)">' +
        '<select class="rp-er-cur" onchange="rpEditSetCell(' + i + ',\'pc\',this.value)">' + curOpts(rd.pc || 'JPY') + '</select>' +
        '<span class="rp-er-grp rp-er-grp--sell">売</span>' +
        '<input type="text" inputmode="decimal" class="rp-er-num" placeholder="単価" value="' + escHtml(rd.bp || '') + '" oninput="rpEditSetCell(' + i + ',\'bp\',this.value)">' +
        '<select class="rp-er-cur" onchange="rpEditSetCell(' + i + ',\'bc\',this.value)">' + curOpts(rd.bc || 'JPY') + '</select>' +
        '<input type="text" class="rp-er-note" placeholder="備考" value="' + escHtml(rd.note || '') + '" oninput="rpEditSetCell(' + i + ',\'note\',this.value)">' +
      '</div>' +
    '</div>';
  }
  function _rpEditRenderRows() {
    const box = document.getElementById('rpEditRows');
    const cnt = document.getElementById('rpEditRowCount');
    if (!box || !_rpEdit) return;
    if (cnt) cnt.textContent = _rpEdit.rows.length + '行';
    if (!_rpEdit.rows.length) {
      box.innerHTML = '<div class="rp-edit-empty">明細がありません。下のボタンで追加してください（保存には最低1行必要）</div>';
      return;
    }
    const last = _rpEdit.rows.length - 1;
    box.innerHTML = _rpEdit.rows.map((rd, i) => _rpEditRowEditor(rd, i, last)).join('');
  }

  async function saveRowPatternEdit() {
    if (!_rpEdit) return;
    const name = (document.getElementById('rpEditName')?.value || '').trim();
    const note = (document.getElementById('rpEditNote')?.value || '').trim();
    if (!name) { quoteShowToast('⚠️ パターン名を入力してください', 'warn'); return; }
    if (!_rpEdit.rows.length) { quoteShowToast('⚠️ 明細が0行です。最低1行は残してください', 'warn', 3500); return; }
    if (_rowPatterns.find(p => p.name === name && p.id !== _rpEdit.id)) {
      quoteShowToast('⚠️ 同名のパターンが既にあります。別名にしてください', 'warn', 3500); return;
    }
    // URL整理：URL空は除外、危険スキームは除外、スキーム無しは https:// 補完
    const links = _rpEdit.links
      .map(l => ({ label: (l.label || '').trim(), url: (l.url || '').trim() }))
      .filter(l => l.url && !/^\s*(javascript|data|vbscript):/i.test(l.url))
      .map(l => ({ label: l.label, url: /^https?:\/\//i.test(l.url) ? l.url : 'https://' + l.url }));
    const db = _rpClient();
    const email = _rpUserEmail();
    if (!db || !email) { quoteShowToast('⚠️ チーム共有にはログインが必要です', 'warn', 3500); return; }
    const base = { name, note, rows: _rpEdit.rows, updated_by: email, updated_at: new Date().toISOString() };
    let { error } = await db.from('row_patterns').update(Object.assign({ links }, base)).eq('id', _rpEdit.id);
    if (error && /links/.test(error.message || '')) {   // links 列が未マイグレーションでも保存は通す
      ({ error } = await db.from('row_patterns').update(base).eq('id', _rpEdit.id));
      if (!error) quoteShowToast('💾 保存しました（URLは links 列の追加SQL適用後に保存できます）', 'warn', 5500);
    }
    if (error) { quoteShowToast('⚠️ 保存に失敗：' + error.message, 'warn', 6000); return; }
    closeRowPatternEdit();
    await loadRowPatternsFromCloud();
    quoteShowToast(`✅ 「${name}」を更新しました（チームに反映）`, 'success');
  }

  function renderRowPatternList() {
    const wrap = document.getElementById('rowPatternListWrap');
    if (!wrap) return;
    if (!_rowPatterns.length) {
      wrap.innerHTML = '<div class="preset-empty">保存済みの行パターンはありません<br><small style="color:#bbb;">行をチェックして上のフォームから保存できます</small></div>';
      return;
    }
    wrap.innerHTML = _rowPatterns.map(p => {
      const ts = p.updated_at
        ? new Date(p.updated_at).toLocaleString('ja-JP', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })
        : '';
      const who = _rpName(p.updated_by || p.created_by);
      const n = (p.rows && p.rows.length) || 0;
      const noteHtml = p.note
        ? '<div class="rp-note"><span class="rp-note-lbl">📝 メモ</span>' + escHtml(p.note) + '</div>'
        : '';
      const rowsHtml = (p.rows || []).map((rd, i) =>
        '<label class="rp-row-item">' +
          '<input type="checkbox" class="rp-row-chk" data-idx="' + i + '" checked>' +
          _rpRowLabel(rd) +
        '</label>').join('');
      const detailHtml = n
        ? '<details class="rp-detail">' +
            '<summary class="rp-detail-sum">📋 明細を選んで挿入</summary>' +
            '<div class="rp-detail-tools">' +
              '<label class="rp-allsel"><input type="checkbox" class="rp-row-allchk" checked onchange="rpToggleAllRows(this)"> すべて</label>' +
              '<button class="btn-preset-load rp-ins-sel" onclick="insertSelectedPatternRows(\'' + p.id + '\')">選択行を挿入</button>' +
            '</div>' +
            '<div class="rp-row-list">' + rowsHtml + '</div>' +
          '</details>'
        : '';
      const links = Array.isArray(p.links) ? p.links.filter(l => l && l.url && /^https?:\/\//i.test(l.url)) : [];
      const linksHtml = links.length
        ? '<div class="rp-links">' + links.map(l =>
            '<a class="rp-link-chip" href="' + escHtml(l.url) + '" target="_blank" rel="noopener noreferrer" title="' + escHtml(l.url) + '">🔗 ' +
              escHtml(l.label || _rpLinkHost(l.url)) + '</a>').join('') + '</div>'
        : '';
      return '<div class="rp-card" data-pid="' + escHtml(p.id) + '">' +
        '<div class="rp-head">' +
          '<span class="rp-name" title="' + escHtml(p.name) + '">' + escHtml(p.name) + '</span>' +
          '<span class="rp-rowcount">' + n + '行</span>' +
          '<button class="btn-preset-load" onclick="loadRowPattern(\'' + p.id + '\')" title="全' + n + '行を挿入">＋ 全挿入</button>' +
          '<button class="btn-preset-edit" onclick="openRowPatternEdit(\'' + p.id + '\')" title="編集（名前・メモ・URL・明細）">✎</button>' +
          '<button class="btn-preset-del"  onclick="deleteRowPattern(\'' + p.id + '\')" title="削除（チーム全員から消えます）">✕</button>' +
        '</div>' +
        noteHtml +
        linksHtml +
        detailHtml +
        '<div class="rp-meta">✏️ ' + escHtml(who) + '・最終更新 ' + ts + '</div>' +
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
      _rowFormat: base._rowFormat,
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
        _legacyAddCalcRow();
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
    // 1) Esc: 優先度順に1つだけ閉じる（電卓 > fb/compare > 見積内モーダル）
    if (e.key === 'Escape') {
      const calcW = document.getElementById('calcWidget');
      if (calcW?.classList.contains('open')) { closeCalcWidget(); return; }
      if (document.getElementById('fbOverlay')?.classList.contains('open')) { closeFeedback(); return; }
      if (document.getElementById('compareOverlay')?.classList.contains('open')) { closeCompare(); return; }
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
    // Ctrl+D → 選択行を下にコピー / 未選択はフォーカス行を複製
    // Ctrl+Shift+D → 選択行を上にコピー
    if (ctrl && !e.altKey && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      if (e.shiftKey) {
        copySelectedRows('above');
      } else {
        const checked = document.querySelectorAll('.row-select-chk:checked');
        if (checked.length) {
          copySelectedRows('below');
        } else {
          const tr = document.activeElement?.closest('#tableBody tr');
          if (tr && tr.id.startsWith('row-')) {
            duplicateRow(tr.id.replace('row-', ''));
            quoteShowToast('📋 行を複製しました', 'success');
          }
        }
      }
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
    // Escape → 見積タブ内のモーダルをすべて閉じる（電卓・fb は上の優先度ブロックで処理済み）
    if (e.key === 'Escape') {
      if (document.getElementById('cmdPalette')?.classList.contains('open'))     { closeCmdPalette(); return; }
      if (document.getElementById('rpEditOverlay')?.classList.contains('open'))   { closeRowPatternEdit(); return; }
      if (document.getElementById('rowPatternModal')?.classList.contains('open')) { closeRowPatternMgr(); return; }
      if (document.getElementById('presetMgrModal')?.classList.contains('open')) { closePresetMgr(); return; }
      if (document.getElementById('previewOverlay')?.classList.contains('open')) { closePreview(); return; }
      // 行選択モード中なら全選択解除
      if (document.querySelector('#tableBody .row-select-chk:checked')) {
        window.clearRowSelection?.(); return;
      }
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
      const subconHTML = subcon
        ? `<div class="qsp-ms-subcon" title="サブコン">👷 ${escapeHtml(subcon)}</div>` : '';
      // ※ キャリア／サブコンのリンクチップは右カラム「🔖 ブックマーク」タブへ分離（renderQuoteBookmarkRail）
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
    // キャリア／サブコンのリンクチップは右カラム「🔖 ブックマーク」タブに分離表示
    if (typeof window.renderQuoteBookmarkRail === 'function') window.renderQuoteBookmarkRail();
  };

  // ===== 案件連動ブックマーク（右カラム「🔖 ブックマーク」タブ）=====
  // 輸送タブのマイルストーンから分離。現在の案件に関係するキャリア（z2 幹線）と
  // 出発地側/到着地側のデフォルトサブコン（z1/z3）のリンクチップを集約表示する。
  // 全面クラウド移行（フェーズ3）：内蔵リンク／ユーザーBM の区別を撤廃し、すべて
  // チーム共有ブックマーク（1セット）として表示。各チップは ✎ で編集可（編集は
  // クラウドへ反映＋履歴記録）。＋＝新規追加。表示にはログイン＋シード実行が前提。
  window.renderQuoteBookmarkRail = function () {
    const wrap = document.getElementById('bmRailChips');
    if (!wrap) return;
    const st = (typeof window.getTransportState === 'function') ? window.getTransportState() : null;
    const bmCache = window._qspBmCache || {};
    const blocks = [];

    // 1チップ（リンク＋✎編集）。✎ は既存ブックマークを編集モードで開く。
    const railChip = (o) => {
      const data = encodeURIComponent(JSON.stringify({
        id: o.id, label: o.label, url: o.url, type: o.type, carrier: o.carrier, fn: o.fn, note: o.note,
      }));
      return `<span class="qsp-ms-cl-chip-wrap">`
        + `<a class="qsp-ms-cl-chip qsp-ms-cl-chip--user" href="${escapeHtml(o.url)}" target="_blank" rel="noopener" title="${escapeHtml(o.title || o.label)}">${escapeHtml(o.label)}</a>`
        + `<button class="qsp-chip-edit-btn" data-bm="${data}" onclick="openAddBmModal(JSON.parse(decodeURIComponent(this.dataset.bm)))" title="このブックマークを編集">✎</button>`
        + `</span>`;
    };
    const addChip = (carrier) =>
      `<button class="qsp-bm-new-chip" data-bm-carrier="${escapeHtml(carrier)}" onclick="openAddBmModal({carrier:this.dataset.bmCarrier})" title="${escapeHtml(carrier)} のブックマークを追加">＋</button>`;
    const carrierBlock = (icon, name, chipsHtml) =>
      `<div class="qsp-ms-carrier"><div class="qsp-ms-carrier-name">${icon} ${escapeHtml(name)}</div><div class="qsp-ms-cl-chips">${chipsHtml}</div></div>`;

    // z1/z3 サブコン（クラウドBMのみ・編集可＋追加）
    const subconBlock = (subcon) => {
      if (!subcon) return '';
      const chips = (bmCache[subcon] || []).filter(b => b.url).map(b => railChip({
        id: b.id, label: b.label, url: b.url, title: b.note || b.label,
        type: b.carrier_type, carrier: subcon, fn: b.function, note: b.note,
      })).join('') + addChip(subcon);
      return carrierBlock('👷', subcon, chips);
    };

    // ① 出発地側サブコン
    if (st && st.zone1On) {
      const sc1 = (document.getElementById('z1DefaultSc')?.value || '').trim();
      if (sc1) blocks.push(subconBlock(sc1));
    }
    // ② 幹線輸送キャリア（すべてクラウドBM・編集可＋追加）
    if (typeof window.getCarrierLinkData === 'function') {
      window.getCarrierLinkData().filter(cd => cd.name).forEach(cd => {
        const chips = cd.links.map(l => railChip({
          id: l.bmId, label: l.label, url: l.url, title: l.title,
          type: l.type, carrier: cd.name, fn: l.fn, note: l.note,
        })).join('') + addChip(cd.name);
        blocks.push(carrierBlock(cd.icon || '🚢', cd.name, chips));
      });
    }
    // ③ 到着地側サブコン
    if (st && st.zone3On) {
      const sc3 = (document.getElementById('z3DefaultSc')?.value || '').trim();
      if (sc3) blocks.push(subconBlock(sc3));
    }

    if (!blocks.length) {
      wrap.innerHTML = '<div class="bm-rail-empty">「貿易条件・輸送モード」で輸送モードとキャリア／サブコンを設定すると、関連するリンクがここに表示されます。<br><br>※ リンクはチーム共有ブックマークから表示します（ログイン必須）。初回は「🔖 BOOKMARK」タブの「🌱 内蔵リンク取込」で内蔵リンクを取り込んでください。</div>';
      return;
    }
    wrap.innerHTML = blocks.join('');
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
    // [ラベル, 値, reflectKey(省略可)]
    const rows = [];
    if (m.container) rows.push(['コンテナ', m.container]);
    if (m.qty > 0)   rows.push(['総個数', m.qty.toLocaleString() + ' 個']);
    if (m.cbm > 0)   rows.push(['総容積', m.cbm.toFixed(3) + ' CBM', 'cbm']);
    if (m.kg > 0)    rows.push(['総重量', Math.round(m.kg).toLocaleString() + ' kg']);
    if (m.rt > 0)    rows.push(['R/T', m.rt.toFixed(3), 'rt']);
    if (m.cw > 0)    rows.push(['CW', SharedCalc.fmtCw(m.cw) + ' kg', 'cw']);
    if (!rows.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = 'block';
    el.innerHTML = '<div class="qsp-section-label">📦 物量情報</div>'
      + rows.map(([k, v, rk]) => {
          const btn = rk
            ? `<button class="qsp-reflect-btn" onclick="reflectToQuote('${rk}')" title="${rk.toUpperCase()} 単位の行に数量を反映">→見積</button>`
            : '';
          return `<div class="qsp-cargo-row"><span class="qsp-cargo-k">${k}</span><span class="qsp-cargo-v">${v}${btn}</span></div>`;
        }).join('');
  };

  // ===== 見積サマリパネル =====
  window.updateQuoteSummary = function updateQuoteSummary() {
    const panel = document.getElementById('qspFin');
    if (!panel) return;

    const rows = document.querySelectorAll('#tableBody tr:not([data-type="subtotal"])');
    const activeRows = Array.from(rows).filter(tr => {
      // 見積書非表示・適用期間外・実費・PROFIT SHARE・都度請求 の行は客先サマリ（合計・粗利）に含めない
      if (tr.dataset.hideQuote === '1' || tr.dataset.outRange === '1' || tr.dataset.actual === '1' || tr.dataset.profitShare === '1' || tr.dataset.cond === '1') return false;
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
    const taxRate = 0.10; // 標準10%固定。課否は行ごとの「課税」チェックで制御

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

    // PROFIT SHARE（代理店収益）：客先サマリ外で社内利益に計上
    let psBillJPY = 0, psCostJPY = 0;
    document.querySelectorAll('#tableBody tr[data-profit-share="1"]').forEach(tr => {
      const id = tr.id.replace('row-', '');
      const pc = document.getElementById(`pc-${id}`)?.value || 'JPY';
      const bc = document.getElementById(`bc-${id}`)?.value || 'JPY';
      const bq = parseFloat(document.getElementById(`bq-${id}`)?.value) || 0;
      const bp = parseFloat(document.getElementById(`bp-${id}`)?.value) || 0;
      const pq = parseFloat(document.getElementById(`pq-${id}`)?.value) || 0;
      const pp = parseFloat(document.getElementById(`pp-${id}`)?.value) || 0;
      psBillJPY += SharedCalc.jpyRound(toJPY(bq * bp, bc));
      psCostJPY += SharedCalc.jpyRound(toJPY(pq * pp, pc));
    });
    const hasPs = psBillJPY || psCostJPY;
    const internalProfit = profit + (psBillJPY - psCostJPY);
    const internalMk = SharedCalc.grossMarginPct(totalBillJPY + psBillJPY, totalCostJPY + psCostJPY);
    const psLines = hasPs
      ? `<div class="qsp-section-label">🤝 社内利益（PROFIT SHARE 込み）</div>
         <div class="qsp-total-row"><span>代理店収益</span><span>¥${fmtJPY(psBillJPY)}</span></div>
         <div class="qsp-profit-row ${internalProfit >= 0 ? 'qsp-profit-pos' : 'qsp-profit-neg'}"><span>社内利益</span><span>¥${fmtJPY(internalProfit)}</span></div>
         <div class="qsp-markup-row"><span>社内粗利率</span><span>${internalMk.toFixed(1)}%</span></div>`
      : '';

    const curLines = Object.entries(billByCur)
      .filter(([, v]) => v)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cur, amt]) =>
        `<div class="qsp-currency-row"><span class="qsp-cur">${cur}</span><span class="qsp-amount">${cur === 'JPY' ? fmtJPY(amt) : fmt(amt)}</span></div>`
      ).join('');

    const taxAmt = Math.ceil(taxAmtJPY);
    const taxLabel = '消費税（10%）';

    panel.innerHTML = `
      <div class="qsp-row-count">${activeRows.length} 費用項目</div>
      <div class="qsp-section-label">通貨別請求小計</div>
      ${curLines}
      <div class="qsp-section-label">合計（JPY 換算）</div>
      <div class="qsp-total-row"><span>仕入合計</span><span>¥${fmtJPY(totalCostJPY)}</span></div>
      <div class="qsp-total-row"><span>売上合計</span><span>¥${fmtJPY(totalBillJPY)}</span></div>
      <div class="qsp-profit-row ${profCls}"><span>利益</span><span>¥${fmtJPY(profit)}</span></div>
      <div class="qsp-markup-row"><span>粗利率</span><span>${mkPct.toFixed(1)}%</span></div>
      ${psLines}
      <div class="qsp-section-label">消費税</div>
      <div class="qsp-tax-row"><span>課税合計</span><span>¥${fmtJPY(taxableJPY)}</span></div>
      <div class="qsp-tax-row"><span>免税合計</span><span>¥${fmtJPY(exemptJPY)}</span></div>
      <div class="qsp-tax-row qsp-tax-amt"><span>${taxLabel}</span><span>¥${fmtJPY(taxAmt)}</span></div>
      ${hasFx ? '<p class="qsp-fx-note">※ 外貨は現在の参照レートで換算（概算）</p>' : ''}
    `;
    if (typeof window.renderQuoteSectionDigest === 'function') window.renderQuoteSectionDigest();
  };

  // Phase 2b：DOMContentLoaded ではなく initQuoteUI() として呼び出すように変更
  // ===== 列の表示/非表示トグル =====
  const COL_VIS_KEY = 'quoteColVis_v1';
  const COL_NAMES = ['catsv', 'profit', 'note'];

  function toggleColVis(col, visible) {
    const table = document.getElementById('quoteTable');
    if (!table) return;
    table.classList.toggle(`hide-${col}`, !visible);
    const saved = _loadColVis();
    saved[col] = visible;
    localStorage.setItem(COL_VIS_KEY, JSON.stringify(saved));
  }

  function _loadColVis() {
    try { return JSON.parse(localStorage.getItem(COL_VIS_KEY) || '{}'); }
    catch (e) { return {}; }
  }

  function initColVis() {
    const saved = _loadColVis();
    COL_NAMES.forEach(col => {
      const visible = saved[col] !== false; // デフォルト表示
      const chk = document.getElementById(`colVisChk${col.charAt(0).toUpperCase() + col.slice(1)}`);
      if (chk) chk.checked = visible;
      if (!visible) toggleColVis(col, false);
    });
  }
  window.toggleColVis = toggleColVis;

  function initQuoteUI() {
    restoreCargoFieldOrder();
    initCargoSort();
    renderPackingPreset();
    initColVis();
    restoreLayoutScale();      // 大/中/小 スケールを復元
    refreshBulkCatSelect();    // 「選択行 → カテゴリ一括変更」セレクトを初期構築
    _refreshBulkCurrencySelect(); // 「選択行 → 通貨一括変更」セレクトを初期構築
    // 単位一括設定はフリーテキスト入力（unit-list datalist でサジェスト）
    initQuoteViewMode();       // STEP A: 客先/社内モード復元
    initQuoteSectionCollapse(); // 上部セクションの折り畳み状態を復元
    // 見積サマリ：保存済みタブを復元（既定は要約）
    let _savedTab = 'digest';
    try { _savedTab = localStorage.getItem('quoteSummaryTab_v1') || 'digest'; } catch(e) {}
    if (typeof window.qspSetTab === 'function') window.qspSetTab(_savedTab);
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
    updateQuoteStatusUI();
    window.updateQuoteSummary();
    // ⚙設定ドロップダウンは外側クリックで閉じる（ネイティブ <details> は外側クリックで閉じないため）
    document.addEventListener('click', function (e) {
      const gear = document.getElementById('cmdbarGear');
      if (gear && gear.open && !gear.contains(e.target)) gear.open = false;
    });
  }

  // ========== フローティング電卓 ==========
  // グローバル関数はスクリプト評価時に定義（HTML の onclick から呼ばれるため）
  // DOM アクセスは DOMContentLoaded 後に実行（電卓 HTML は </body> 直前のため）
  {
    let _calcExpr = '', _calcPrev = null, _justEvaled = false;
    const SAFE_RE = /^[0-9+\-*/.() ]+$/;
    function _calcDisp(v)    { const el = document.getElementById('calcDisplay'); if (el) el.textContent = v; }
    function _calcSub(v)     { const el = document.getElementById('calcSub');     if (el) el.textContent = v; }
    window.calcKey = function(k) {
      if (k === 'C')  { _calcExpr = ''; _calcPrev = null; _justEvaled = false; _calcDisp('0'); _calcSub(''); return; }
      if (k === '←') { _justEvaled = false; _calcExpr = _calcExpr.slice(0, -1); _calcDisp(_calcExpr || '0'); return; }
      if (k === '±') {
        if (_calcExpr && _calcExpr !== '0') {
          _calcExpr = _calcExpr.startsWith('-') ? _calcExpr.slice(1) : '-' + _calcExpr;
          _calcDisp(_calcExpr);
        }
        return;
      }
      if (k === '=') {
        try {
          const safe = _calcExpr.replace(/×/g,'*').replace(/÷/g,'/').replace(/−/g,'-');
          if (!SAFE_RE.test(safe)) { _calcDisp('エラー'); _calcExpr = ''; _justEvaled = false; return; }
          const r = parseFloat(Function('"use strict"; return (' + safe + ')')().toFixed(10));
          _calcSub(_calcExpr + ' =');
          _calcExpr = String(r);
          _calcDisp(r.toLocaleString());
          _calcPrev = r;
          _justEvaled = true;
        } catch { _calcDisp('エラー'); _calcExpr = ''; _calcSub(''); _justEvaled = false; }
        return;
      }
      if (k === '%') {
        try {
          const safe = _calcExpr.replace(/×/g,'*').replace(/÷/g,'/').replace(/−/g,'-');
          if (!SAFE_RE.test(safe)) { _calcDisp('エラー'); _calcExpr = ''; return; }
          const r = parseFloat((Function('"use strict"; return (' + safe + ')')() / 100).toFixed(10));
          _calcExpr = String(r); _calcDisp(r.toLocaleString()); _calcPrev = r; _justEvaled = false;
        } catch { _calcDisp('エラー'); _calcExpr = ''; }
        return;
      }
      // E-14: = の直後に数字を押した場合は新規入力として扱う
      if (_justEvaled && /[0-9.]/.test(k)) {
        _calcExpr = k; _calcPrev = null; _justEvaled = false; _calcDisp(_calcExpr);
        return;
      }
      _justEvaled = false;
      if (_calcPrev !== null && /[0-9.]/.test(k) && /[+\-×÷−]$/.test(_calcExpr)) _calcPrev = null;
      _calcExpr += k;
      _calcDisp(_calcExpr);
    };
    window.toggleCalcWidget = function() {
      const w = document.getElementById('calcWidget');
      if (w) w.classList.toggle('open');
    };
    window.closeCalcWidget = function() {
      const w = document.getElementById('calcWidget');
      if (w) w.classList.remove('open');
    };
    // R-3: 見積タブが非アクティブのときはキー入力を受け付けない（タブ横取り防止）
    // R-4: Esc は上位の main keydown handler で優先処理するためここでは除外
    document.addEventListener('keydown', function(e) {
      const w = document.getElementById('calcWidget');
      if (!w || !w.classList.contains('open')) return;
      const quoteTab = document.getElementById('tab-quote-make');
      if (!quoteTab || !quoteTab.classList.contains('active')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' ||
                 ae.tagName === 'SELECT' || ae.isContentEditable)) return;
      const k = e.key;
      let mapped = null;
      if (/^[0-9]$/.test(k))               mapped = k;
      else if (k === '.')                   mapped = '.';
      else if (k === '+')                   mapped = '+';
      else if (k === '-')                   mapped = '−';
      else if (k === '*')                   mapped = '×';
      else if (k === '/')                   mapped = '÷';
      else if (k === '%')                   mapped = '%';
      else if (k === 'Enter' || k === '=') mapped = '=';
      else if (k === 'Backspace')           mapped = '←';
      else if (k === 'Delete' || k === 'c' || k === 'C') mapped = 'C';
      // Escape は main handler で処理。ここでは何もしない。
      if (mapped === null) return;
      e.preventDefault();
      window.calcKey(mapped);
    });
    // R-5: ドラッグ時に画面外に出ないようにクランプ
    document.addEventListener('DOMContentLoaded', function() {
      const w = document.getElementById('calcWidget');
      const handle = document.getElementById('calcHandle');
      if (!w || !handle) return;
      let sx = 0, sy = 0, ox = 0, oy = 0, drag = false;
      handle.addEventListener('mousedown', e => {
        if (e.target.classList.contains('calc-x')) return;
        drag = true; sx = e.clientX; sy = e.clientY;
        const r = w.getBoundingClientRect(); ox = r.left; oy = r.top;
        e.preventDefault();
      });
      document.addEventListener('mousemove', e => {
        if (!drag) return;
        const maxL = window.innerWidth  - w.offsetWidth;
        const maxT = window.innerHeight - w.offsetHeight;
        const newL = Math.max(0, Math.min(maxL, ox + e.clientX - sx));
        const newT = Math.max(0, Math.min(maxT, oy + e.clientY - sy));
        w.style.left = newL + 'px';
        w.style.top  = newT + 'px';
        w.style.right = 'auto'; w.style.bottom = 'auto';
      });
      document.addEventListener('mouseup', () => { drag = false; });
    });
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

  // ===== セクション折りたたみは廃止（見積サマリのジャンプ機能で代替） =====
  // 全セクションを常時展開。ヘッダークリック／ダイジェストからの呼び出しは
  // 「そのセクションへスクロール」のみ行う（畳まない）。
  window.QUOTE_ALL_SECTIONS = ['section-ref', 'section-cond', 'section-cargo', 'section-volume', 'section-scope', 'section-remark', 'section-table'];
  window.toggleQuoteSection = function(id) {
    const sec = document.getElementById(id);
    if (!sec) return;
    sec.classList.remove('collapsed');   // 念のため常に展開
    sec.scrollIntoView({ block: 'start' });
  };
  // 旧名のエイリアス（下部3セクションの onclick 互換）
  window.toggleQuoteBottomAccordion = window.toggleQuoteSection;

  // 折り畳み時のヘッダー要約を更新
  function updateSectionSummaries() {
    // 管理番号
    const g = id => (document.getElementById(id)?.value || '').trim();
    const refParts = [g('qf-ref'), g('qf-customer'), g('qf-person') && (g('qf-person') + ' 様')].filter(Boolean);
    const sumRef = document.getElementById('sumRef');
    const statusLabel = g('qf-status') || '下書き中';
    if (sumRef) sumRef.textContent = (refParts.length ? '— ' + refParts.join(' / ') : '— 未入力') + '　[' + statusLabel + ']';

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
    // ※ コンテナ要約は「物量情報」側にのみ表示（貿易条件には出さない）
    const sumCond = document.getElementById('sumCond');
    if (sumCond) sumCond.textContent = condParts.length ? '— ' + condParts.join(' / ') : '— 未入力';

    // 貨物情報
    const cargoParts = [];
    if (cargo) cargoParts.push(cargo);
    const hs = g('cond-hs'); if (hs) cargoParts.push('HS ' + hs);
    const hazmat = g('cond-hazmat'); if (hazmat && hazmat !== 'なし（一般貨物）') cargoParts.push(hazmat);
    const sumCargo = document.getElementById('sumCargo');
    if (sumCargo) sumCargo.textContent = cargoParts.length ? '— ' + cargoParts.join(' / ') : '— 未入力';

    // 物量情報（サイズ・GW・CBM・R/T・CW）
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
    // 自動計算メトリクス（GW・CBM・R/T・CW）
    const _m = (typeof window.getCargoMetrics === 'function') ? window.getCargoMetrics() : null;
    const metParts = [];
    if (_m) {
      if (_m.cbm > 0) metParts.push('CBM ' + _m.cbm.toFixed(3));
      if (_m.kg  > 0) metParts.push('GW ' + Math.round(_m.kg).toLocaleString() + 'kg');
      if (_m.rt  > 0) metParts.push('R/T ' + _m.rt.toFixed(3));
      if (_m.cw  > 0 && typeof SharedCalc !== 'undefined') metParts.push('CW ' + SharedCalc.fmtCw(_m.cw) + 'kg');
    }
    const sumVolume = document.getElementById('sumVolume');
    if (sumVolume) sumVolume.textContent = volParts.length ? '— ' + volParts.join(' / ') : '— 未入力';
    // ダイジェスト用：サイズ行＋メトリクス行を改行で（renderQuoteSectionDigest が参照）
    window._volDigest = {
      size: volParts.join(' / '),
      metrics: metParts.join(' / '),
    };
    if (typeof window.renderQuoteSectionDigest === 'function') window.renderQuoteSectionDigest();
  }
  window.updateSectionSummaries = updateSectionSummaries;

  // ===== 見積サマリ：各入力セクションのダイジェスト =====
  // アコーディオンで各セクションが畳まれていても、右パネルで全体を一望できるようにする。
  // クリックでそのセクションを展開（アコーディオン）してスクロール。
  window.renderQuoteSectionDigest = function() {
    // 下部3セクションの要約を計算（ヘッダー要約スパンにも反映）
    const rowsCount = document.querySelectorAll('#tableBody tr [data-field="nm"]').length;
    const totSell = (document.getElementById('tot-subtotal')?.textContent || '').trim();
    const tableSum = rowsCount ? (rowsCount + '項目' + (totSell && totSell !== '—' ? ' / 売 ' + totSell : '')) : '';
    const remarkRaw = ((typeof getRemarkText === 'function' ? getRemarkText() : '') || '').trim();
    // 先頭3行までをプレビュー表示（残りは … で省略）
    const preview3 = (txt) => {
      if (!txt) return '';
      const lines = txt.split(/\r?\n/).map(s => s.trim()).filter(s => s.length);
      const head = lines.slice(0, 3).join('\n');
      return lines.length > 3 ? head + '\n…' : head;
    };
    const remarkSum = preview3(remarkRaw);
    const setSum = (id, t) => { const e = document.getElementById(id); if (e) e.textContent = t ? '— ' + t : '— 未入力'; };
    setSum('sumTable', tableSum); setSum('sumRemark', remarkSum);
    if (typeof window.updateQspTabBadges === 'function') window.updateQspTabBadges();

    const el = document.getElementById('qspSectionDigest');
    if (!el) return;
    const getSpan = id => (document.getElementById(id)?.textContent || '').replace(/^—\s*/, '').trim();
    // 物量情報：サイズ行＋メトリクス行（GW・CBM・R/T・CW）を改行で
    const vd = window._volDigest || {};
    const volText = [vd.size, vd.metrics].filter(Boolean).join('\n');
    const scopeSum = preview3((document.getElementById('qf-scope')?.value || '').trim());
    const rows = [
      ['section-ref',    '🗂️', '管理番号',     getSpan('sumRef')],
      ['section-cond',   '🚢', '貿易条件',     getSpan('sumCond')],
      ['section-cargo',  '📦', '貨物情報',     getSpan('sumCargo')],
      ['section-volume', '📊', '物量情報',     volText],
      ['section-scope',  '🛠️', '作業範囲',     scopeSum],
      ['section-remark', '📑', '全体リマーク', remarkSum],
      ['section-table',  '📋', '費用テーブル', tableSum],
    ];
    let html = rows.map(function(r) {
      const id = r[0], icon = r[1], label = r[2];
      const empty = !r[3] || r[3] === '未入力';
      const txt = empty ? '未入力' : r[3];
      const open = !document.getElementById(id)?.classList.contains('collapsed');
      return '<button type="button" class="qsp-dig-row' + (open ? ' is-open' : '') + (empty ? ' is-empty' : '') +
        '" onclick="window.openQuoteSectionFromDigest(\'' + id + '\')">' +
        '<span class="qsp-dig-name">' + icon + ' ' + label + '</span>' +
        '<span class="qsp-dig-sum">' + escapeHtml(txt).replace(/\n/g, '<br>') + '</span></button>';
    }).join('');
    // 費用テーブル内のサブコン別／サブコン×パターン別グループへのジャンプ
    const groups = _collectTableGroups();
    window._qspTableGroups = groups;
    if (groups.length) {
      html += '<div class="qsp-dig-subjumps">' + groups.map(function(g, i) {
        return '<button type="button" class="qsp-dig-subjump' + (g.level ? ' is-pattern' : ' is-subcon') +
          '" onclick="window.jumpToTableGroupIdx(' + i + ')" title="このグループへ移動">' +
          escapeHtml(g.label) + '</button>';
      }).join('') + '</div>';
    }
    el.innerHTML = html;
  };
  // 費用テーブルのサブコン／パターン見出し行を収集（ジャンプ用）
  function _collectTableGroups() {
    const out = [];
    document.querySelectorAll('#tableBody tr.subcon-group-header, #tableBody tr.subcon-subgroup-header.is-pattern')
      .forEach(function(tr) {
        if (tr.classList.contains('subcon-group-header')) {
          out.push({ level: 0, sv: tr.dataset.svKey || '', pt: '',
                     label: (tr.querySelector('.subcon-group-label')?.textContent || '').trim() });
        } else {
          out.push({ level: 1, sv: tr.dataset.svKey || '', pt: tr.dataset.ptKey || '',
                     label: '↳ ' + (tr.querySelector('.subcon-subgroup-leg')?.textContent || '').trim() });
        }
      });
    return out;
  }
  window.jumpToTableGroupIdx = function(i) {
    const g = (window._qspTableGroups || [])[i];
    if (!g) return;
    const sec = document.getElementById('section-table');
    if (sec && sec.classList.contains('collapsed') && typeof toggleQuoteSection === 'function') toggleQuoteSection('section-table');
    const sel = g.pt ? '#tableBody tr.subcon-subgroup-header.is-pattern' : '#tableBody tr.subcon-group-header';
    let target = null;
    document.querySelectorAll(sel).forEach(function(tr) {
      if (target) return;
      if (g.pt) { if ((tr.dataset.svKey || '') === g.sv && (tr.dataset.ptKey || '') === g.pt) target = tr; }
      else      { if ((tr.dataset.svKey || '') === g.sv) target = tr; }
    });
    if (!target) return;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.classList.add('grp-flash');
    setTimeout(function() { target.classList.remove('grp-flash'); }, 1200);
  };
  window.openQuoteSectionFromDigest = function(id) {
    const sec = document.getElementById(id);
    if (!sec) return;
    if (sec.classList.contains('collapsed') && typeof toggleQuoteSection === 'function') toggleQuoteSection(id);
    sec.scrollIntoView({ block: 'start' });
  };

  // ===== 見積サマリ：タブ切替（要約／輸送／金額／チャット） =====
  window.QSP_TABS = ['digest', 'flow', 'fin', 'chat'];
  window.qspSetTab = function(tab) {
    if (!window.QSP_TABS.includes(tab)) tab = 'digest';
    window.QSP_TABS.forEach(t => {
      const pane = document.getElementById('qspPane-' + t);
      const btn  = document.getElementById('qspTabBtn-' + t);
      const on = (t === tab);
      if (pane) pane.classList.toggle('is-active', on);
      if (btn)  { btn.classList.toggle('is-active', on); btn.setAttribute('aria-selected', on ? 'true' : 'false'); }
    });
    if (tab === 'chat' && typeof window.qspLoadChat === 'function') window.qspLoadChat();
    try { localStorage.setItem('quoteSummaryTab_v1', tab); } catch(e) {}
  };
  window.updateQspTabBadges = function() {
    // 金額タブ：費用項目数
    const rows = document.querySelectorAll('#tableBody tr [data-field="nm"]').length;
    const finBtn = document.getElementById('qspTabBtn-fin');
    if (finBtn) finBtn.innerHTML = '💰 金額' + (rows ? ' <span class="qsp-tab-badge">' + rows + '</span>' : '');
    // 輸送タブ：作業範囲が出ていれば●
    const hasFlow = document.getElementById('qspMilestones') && document.getElementById('qspMilestones').style.display !== 'none';
    const flowBtn = document.getElementById('qspTabBtn-flow');
    if (flowBtn) flowBtn.innerHTML = '🚚 輸送' + (hasFlow ? ' <span class="qsp-tab-dot"></span>' : '');
  };

  // 起動時に保存済みの折り畳み状態を復元
  function initQuoteSectionCollapse() {
    // 折りたたみは廃止：全セクションを常時展開（見積サマリのジャンプ機能で代替）
    const _all = window.QUOTE_ALL_SECTIONS || ['section-ref','section-cond','section-cargo','section-volume','section-table','section-remark'];
    _all.forEach(id => document.getElementById(id)?.classList.remove('collapsed'));
    try { localStorage.removeItem('quoteSectionCollapse_v1'); } catch(e) {}
    updateSectionSummaries();
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

  // ===== ステータスボタン =====
  function setQuoteStatus(status) {
    const hidden = document.getElementById('qf-status');
    if (hidden) {
      hidden.value = status;
      // change イベントをバブリングさせて auto-save をトリガー
      hidden.dispatchEvent(new Event('change', { bubbles: true }));
    }
    updateQuoteStatusUI();
    if (typeof window.updateSectionSummaries === 'function') window.updateSectionSummaries();
  }
  function updateQuoteStatusUI() {
    const status = document.getElementById('qf-status')?.value || '下書き中';
    document.querySelectorAll('#qf-status-btns .qf-status-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.status === status);
    });
  }
  window.setQuoteStatus = setQuoteStatus;
  window.updateQuoteStatusUI = updateQuoteStatusUI;

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
    if (typeof initSimilarQuotes === 'function') initSimilarQuotes();
    if (typeof initScenarios    === 'function') initScenarios();
    maybeAutoFillRef();          // 新規（REF空）なら仮REF#を自動採番
    // 初回はダッシュボード（ページ1）を表示。以降のタブ切替では現在ページを維持
    if (typeof window.qpShowDashboard === 'function') window.qpShowDashboard();
  };

  // 管理番号を "番号" 形式でクリップボードにコピー
  window.copyRefNumber = function(ref, btn) {
    const text = '”' + ref + '”'; // “番号”（二重引用符）
    navigator.clipboard.writeText(text).then(() => {
      if (btn) {
        const origHtml = btn.innerHTML;
        btn.innerHTML = '✅';
        btn.classList.add('copied');
        setTimeout(() => { btn.innerHTML = origHtml; btn.classList.remove('copied'); }, 1500);
      }
      if (typeof quoteShowToast === 'function') quoteShowToast('コピーしました：' + text, 'success', 2000);
    }).catch(() => {
      if (typeof quoteShowToast === 'function') quoteShowToast('⚠️ コピーに失敗しました', 'warn', 2000);
    });
  };
