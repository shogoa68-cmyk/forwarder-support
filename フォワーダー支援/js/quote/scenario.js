// ========== 単位で数量を一括変更（旧「シナリオ比較」を作り替え） ==========
// 明細行から単位を抽出し、同じ「単位×現在数量」の行をまとめて表示。
// パネルで数値を変更し「一括反映」すると、その単位・数量の行の数量(pq)を
// まとめて書き換える（請求数量 bq へは既存の連動ロジックで自動反映）。
// 数量がバラつく単位は、現在数量ごとに個別の行として表示する。

  let _udCollapsed = false;

  // ---------- 明細から（単位×数量）グループを収集 ----------
  function _udCollect() {
    const map = new Map();   // key: 単位 \x00 数量 → { unit, qty, ids:[] }
    document.querySelectorAll('#tableBody tr[id^="row-"]').forEach(tr => {
      if (tr.dataset.type || tr.dataset.virtual) return;   // リマーク・社内メモ・小計・仮想行は対象外
      const id = tr.id.replace('row-', '');
      const un = (document.getElementById(`un-${id}`)?.value || '').trim();
      if (!un) return;                                     // 単位なしの行は対象外
      const pqEl = document.getElementById(`pq-${id}`);
      if (!pqEl) return;
      const qty = (pqEl.value || '').trim();
      const key = un + '\x00' + qty;
      if (!map.has(key)) map.set(key, { unit: un, qty, ids: [] });
      map.get(key).ids.push(id);
    });
    return Array.from(map.values()).sort((a, b) =>
      a.unit.localeCompare(b.unit, 'ja') || ((parseFloat(a.qty) || 0) - (parseFloat(b.qty) || 0)));
  }

  // ---------- パネル描画 ----------
  function _udRenderPanel() {
    const panel = document.getElementById('scPanel');
    if (!panel) return;
    const groups = _udCollect();

    const listHtml = groups.length
      ? groups.map(g =>
          `<div class="ud-row" data-ids='${JSON.stringify(g.ids)}'>
             <span class="ud-unit" title="${escHtml(g.unit)}">${escHtml(g.unit)}</span>
             <span class="ud-times">×</span>
             <input type="number" class="ud-qty-in" value="${escHtml(g.qty)}" min="0" step="1"
                    title="新しい数量を入力して「一括反映」を押すと、この単位・数量の行をまとめて変更します" />
             <span class="ud-count" title="この単位・数量の行数">${g.ids.length}行</span>
           </div>`
        ).join('')
      : '<p class="ud-empty">単位が設定された明細行がありません。<br>明細行の「単位」欄を入力すると、ここに一覧表示されます。</p>';

    panel.classList.toggle('sc-panel--collapsed', _udCollapsed);
    panel.innerHTML =
      `<div class="sc-head" onclick="scToggleCollapse()" style="cursor:pointer;">
         <span class="sc-head-title">📦 単位で数量を一括変更</span>
         <span class="sc-collapse-arrow">${_udCollapsed ? '▶' : '▼'}</span>
       </div>
       <div class="sc-body">
         <p class="sc-hint">明細行の単位ごとに現在の数量を表示します。数値を変えて<b>「一括反映」</b>すると、その単位・数量の行をまとめて更新します。<br>数量がバラつく単位は、現在の数量ごとに分けて表示されます。</p>
         <div class="ud-list">${listHtml}</div>
         <button class="ud-refresh" type="button" onclick="udRefresh()" title="明細から単位を再取得">🔄 再読み込み</button>
         <button class="sc-open-btn" type="button" onclick="udApplyAll()" ${groups.length ? '' : 'disabled'}>✅ 一括反映</button>
       </div>`;
  }

  // ---------- 操作 ----------
  function scToggleCollapse() { _udCollapsed = !_udCollapsed; _udRenderPanel(); }
  function udRefresh() { _udRenderPanel(); }

  function udApplyAll() {
    const panel = document.getElementById('scPanel');
    if (!panel) return;
    let unitsChanged = 0, rowsChanged = 0;

    panel.querySelectorAll('.ud-row').forEach(rowEl => {
      let ids;
      try { ids = JSON.parse(rowEl.dataset.ids || '[]'); } catch (e) { ids = []; }
      const inp = rowEl.querySelector('.ud-qty-in');
      if (!inp) return;
      const newVal = (inp.value || '').trim();
      if (newVal === '') return;                 // 空欄はスキップ
      let touched = false;
      ids.forEach(id => {
        const pqEl = document.getElementById(`pq-${id}`);
        if (!pqEl) return;
        if ((pqEl.value || '').trim() !== newVal) {
          pqEl.value = newVal;
          // input イベントで既存の oninput（onPay → 請求数量連動・再計算・合計更新・自動保存）を発火
          pqEl.dispatchEvent(new Event('input', { bubbles: true }));
          rowsChanged++; touched = true;
        }
      });
      if (touched) unitsChanged++;
    });

    if (typeof updateTotals === 'function') updateTotals();
    _udRenderPanel();

    if (rowsChanged === 0) {
      if (typeof quoteShowToast === 'function') quoteShowToast('変更はありませんでした', 'info', 2500);
      return;
    }

    // 一括変更後：ユーザーに尋ねて印刷（プレビュー）モーダルを開く
    if (window.confirm(`${unitsChanged}単位・計${rowsChanged}行の数量を一括変更しました。\n印刷プレビューを開きますか？`)) {
      if (typeof openPreview === 'function') openPreview();
      else if (typeof window.openPreview === 'function') window.openPreview();
      else window.print();
    } else if (typeof quoteShowToast === 'function') {
      quoteShowToast(`数量を一括変更しました（${rowsChanged}行）`, 'success', 2500);
    }
  }

  // ---------- 初期化 ----------
  function initScenarios() {
    _udRenderPanel();
    // 明細の追加・削除に追従してパネルを再描画
    const tbody = document.getElementById('tableBody');
    if (tbody && typeof MutationObserver !== 'undefined') {
      let _t = null;
      new MutationObserver(() => {
        clearTimeout(_t);
        _t = setTimeout(() => { if (!_udCollapsed) _udRenderPanel(); }, 300);
      }).observe(tbody, { childList: true });
    }
  }

  // ---------- window 公開 ----------
  window.initScenarios    = initScenarios;
  window.scToggleCollapse = scToggleCollapse;
  window.udRefresh        = udRefresh;
  window.udApplyAll       = udApplyAll;
