// ========== 行管理 (app-row.js) ==========

  // ========== カテゴリ変更 ==========
  function onCatChange(id) {
    const tr = document.getElementById(`row-${id}`);
    const cat = document.getElementById(`cat-${id}`)?.value;
    // cat-* クラスを全削除
    tr.className = tr.className.split(' ').filter(c => !c.startsWith('cat-')).join(' ').trim();
    if (cat) {
      const catObj = getAllCategories().find(c => c.value === cat);
      if (catObj?.cls) tr.classList.add(catObj.cls);
    }
  }

  // ========== 未入力グレーアウト ==========
  function checkUnfilled(id) {
    const tr = document.getElementById(`row-${id}`);
    const nm = document.getElementById(`nm-${id}`);
    if (!tr || !nm) return;
    nm.value.trim() === ''
      ? tr.classList.add('row-unfilled')
      : tr.classList.remove('row-unfilled');
  }

  // ========== ドラッグ＆ドロップ ==========
  function initDrag(tr) {
    // tr は常に draggable="true"。ハンドル以外からのドラッグは dragstart で防ぐ
    tr.setAttribute('draggable', 'true');
    const handle = tr.querySelector('.drag-handle');

    // dragstart の e.target は tr 自身になるため、mousedown でフラグを立てる
    let _dragFromHandle = false;
    if (handle) {
      handle.addEventListener('mousedown', () => { _dragFromHandle = true; });
      document.addEventListener('mouseup', () => { _dragFromHandle = false; }, { capture: true });
    }

    tr.addEventListener('dragstart', e => {
      // ハンドルを掴んでいない場合はドラッグ無効
      if (!handle || !_dragFromHandle) {
        e.preventDefault(); return;
      }
      _dragFromHandle = false;
      dragSrcRow = tr;
      // 多選択ドラッグ：掴んだ行がチェック済みなら、チェックされている全行をまとめて移動
      const myChk = tr.querySelector('.row-select-chk');
      if (myChk?.checked) {
        const selected = Array.from(
          document.querySelectorAll('#tableBody tr .row-select-chk:checked')
        ).map(c => c.closest('tr')).filter(Boolean);
        dragSrcRows = selected.length > 1 ? selected : [tr];
      } else {
        dragSrcRows = [tr];
      }
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', tr.id);
      const movingRows = dragSrcRows;
      setTimeout(() => movingRows.forEach(r => r.classList.add('dragging')), 0);
    });
    tr.addEventListener('dragend', () => {
      (dragSrcRows || [tr]).forEach(r => r.classList.remove('dragging'));
      document.querySelectorAll('#tableBody tr').forEach(r =>
        r.classList.remove('drag-over-top', 'drag-over-bottom'));
      dragSrcRow = null;
      dragSrcRows = null;
      updateTotals();
    });
    tr.addEventListener('dragover', e => {
      if (!dragSrcRows || !dragSrcRows.length) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      // ドラッグ中の行群の上には挿入インジケータを出さない
      if (dragSrcRows.includes(tr)) return;
      const mid = tr.getBoundingClientRect().top + tr.getBoundingClientRect().height / 2;
      document.querySelectorAll('#tableBody tr').forEach(r =>
        r.classList.remove('drag-over-top', 'drag-over-bottom'));
      tr.classList.add(e.clientY < mid ? 'drag-over-top' : 'drag-over-bottom');
    });
    tr.addEventListener('dragleave', () =>
      tr.classList.remove('drag-over-top', 'drag-over-bottom'));
    tr.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      if (!dragSrcRows || !dragSrcRows.length || dragSrcRows.includes(tr)) return;
      const mid = tr.getBoundingClientRect().top + tr.getBoundingClientRect().height / 2;
      const tbody = document.getElementById('tableBody');
      const insertBefore = e.clientY < mid ? tr : tr.nextSibling;
      // document 順で挿入することで元の並びを保持
      dragSrcRows.forEach(srcTr => {
        tbody.insertBefore(srcTr, insertBefore);
      });
      tr.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    // ▲▼ ボタンによる行移動
    const upBtn   = tr.querySelector('.row-move-up');
    const downBtn = tr.querySelector('.row-move-down');
    if (upBtn)   upBtn.addEventListener('click',  () => moveRow(tr, -1));
    if (downBtn) downBtn.addEventListener('click', () => moveRow(tr, +1));
  }

  function moveRow(tr, dir) {
    const tbody = document.getElementById('tableBody');
    if (dir < 0) {
      const prev = tr.previousElementSibling;
      if (prev) tbody.insertBefore(tr, prev);
    } else {
      const next = tr.nextElementSibling;
      if (next) tbody.insertBefore(next, tr);
    }
    updateTotals();
  }

  // ========== 十字キー（↑↓）移動 ==========
  // Phase 2b：DOMContentLoaded ではなく initQuoteKeyNav() として呼び出すように変更
  function initQuoteKeyNav() {
    document.getElementById('tableBody').addEventListener('keydown', e => {
      // Ctrl+D: 現在行を複製して直下に挿入
      if (e.ctrlKey && e.key === 'd') {
        const tr = e.target.closest('tr');
        if (!tr || !tr.id.startsWith('row-')) return;
        e.preventDefault();
        const col   = e.target.dataset.col;
        const newId = duplicateRow(tr.id.replace('row-', ''));
        setTimeout(() => {
          const target = col
            ? document.querySelector(`#row-${newId} [data-col="${col}"]`)
            : document.getElementById(`nm-${newId}`);
          if (target) { target.focus(); if (target.select) target.select(); }
        }, 0);
        return;
      }

      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      const el  = e.target;
      const col = el.dataset.col;
      if (col === undefined) return;
      e.preventDefault();
      const tr    = el.closest('tr');
      const rows  = Array.from(document.querySelectorAll('#tableBody tr'));
      const idx   = rows.indexOf(tr);
      const next  = e.key === 'ArrowUp' ? idx - 1 : idx + 1;
      if (next >= 0 && next < rows.length) {
        const nextEl = rows[next].querySelector(`[data-col="${col}"]`);
        if (nextEl) {
          nextEl.focus();
          if (nextEl.type === 'text' || nextEl.type === 'number') nextEl.select();
        }
      } else if (e.key === 'ArrowDown' && next === rows.length) {
        const newId = addRowAfter(tr.id.replace('row-', ''));
        setTimeout(() => {
          document.querySelector(`#row-${newId} [data-col="${col}"]`)?.focus();
        }, 0);
      }
    });
  }

  // ========== 行操作 ==========
  // Tabで行追加するかどうか（tabAddEnabledはapp-constants.jsで宣言済み）
  function toggleTabAdd(on) {
    tabAddEnabled = !!on;
    localStorage.setItem('tabAddEnabled', on ? '1' : '0');
    showSaveStatus('Tabで行追加: ' + (on ? 'ON' : 'OFF'));
  }
  function noteKeydown(e, id) {
    if (e.key === 'Tab' && !e.shiftKey && tabAddEnabled) {
      e.preventDefault();
      const newId = addRowAfter(id);
      setTimeout(() => document.getElementById(`nm-${newId}`)?.focus(), 0);
    }
  }

  function addRowAfter(afterId) {
    rowCount++;
    const id = rowCount;
    const tr = document.createElement('tr');
    tr.id = `row-${id}`;
    // 継承元の行からカテゴリ・通貨・サブコンを取得
    const srcCat = document.getElementById(`cat-${afterId}`)?.value || '';
    const srcCur = document.getElementById(`pc-${afterId}`)?.value  || 'JPY';
    const srcSv  = document.getElementById(`sv-${afterId}`)?.value  || '';
    tr.replaceChildren(buildRowHTML(id, srcCat, srcCur, srcSv));
    tr.classList.add('row-unfilled');
    const refRow = document.getElementById(`row-${afterId}`);
    if (refRow?.nextSibling) refRow.parentNode.insertBefore(tr, refRow.nextSibling);
    else if (refRow)         refRow.parentNode.appendChild(tr);
    else                     document.getElementById('tableBody').appendChild(tr);
    initDrag(tr);
    onCatChange(id);  // カテゴリ色を適用
    onPay(id);
    return id;
  }

  function addRow() {
    rowCount++;
    const id = rowCount;
    // 末尾行からカテゴリ・通貨・サブコンを継承
    const rows = document.querySelectorAll('#tableBody tr');
    const lastRow = rows.length ? rows[rows.length - 1] : null;
    const lastId  = lastRow ? lastRow.id.replace('row-', '') : null;
    const srcCat  = lastId ? (document.getElementById(`cat-${lastId}`)?.value || '') : '';
    const srcCur  = lastId ? (document.getElementById(`pc-${lastId}`)?.value  || 'JPY') : 'JPY';
    const srcSv   = lastId ? (document.getElementById(`sv-${lastId}`)?.value  || '')    : '';
    const tr = document.createElement('tr');
    tr.id = `row-${id}`;
    tr.replaceChildren(buildRowHTML(id, srcCat, srcCur, srcSv));
    tr.classList.add('row-unfilled');
    document.getElementById('tableBody').appendChild(tr);
    initDrag(tr);
    onCatChange(id);  // カテゴリ色を適用
    onPay(id);
  }

  // ========== 行複製（Ctrl+D） ==========
  function duplicateRow(srcId) {
    const newId = addRowAfter(srcId);

    // テキスト・数値フィールドをコピー
    ['nm','pq','un','pp','mk','nt','sv'].forEach(f => {
      const srcEl = document.getElementById(`${f}-${srcId}`);
      const dstEl = document.getElementById(`${f}-${newId}`);
      if (srcEl && dstEl) dstEl.value = srcEl.value;
    });

    // セレクトをコピー（請求通貨 bc を含む）
    ['cat','pc','bc'].forEach(f => {
      const srcEl = document.getElementById(`${f}-${srcId}`);
      const dstEl = document.getElementById(`${f}-${newId}`);
      if (srcEl && dstEl) dstEl.value = srcEl.value;
    });

    // チェックボックスをコピー
    const srcTx = document.getElementById(`tx-${srcId}`);
    const dstTx = document.getElementById(`tx-${newId}`);
    if (srcTx && dstTx) dstTx.checked = srcTx.checked;

    // 再計算・色・状態の更新
    onCatChange(newId);
    if (dstTx?.checked) toggleTax(newId);
    checkUnfilled(newId);
    onPay(newId);

    return newId;
  }

  // ========== カテゴリー順ソート ==========
  function sortBy(type) {
    const tbody = document.getElementById('tableBody');
    const rows  = Array.from(tbody.querySelectorAll('tr'));
    if (rows.length < 2) return;
    const getId = tr => tr.id.replace('row-', '');
    const catOrder = cat => { const i = CAT_VALUES.indexOf(cat); return i === -1 ? 999 : i; };

    rows.sort((a, b) => {
      const idA = getId(a), idB = getId(b);
      switch (type) {
        case 'category': {
          const cA = document.getElementById(`cat-${idA}`)?.value || '';
          const cB = document.getElementById(`cat-${idB}`)?.value || '';
          return catOrder(cA) - catOrder(cB);
        }
        case 'currency': {
          const cA = document.getElementById(`pc-${idA}`)?.value || '';
          const cB = document.getElementById(`pc-${idB}`)?.value || '';
          return cA.localeCompare(cB);
        }
        case 'unit': {
          const uA = document.getElementById(`un-${idA}`)?.value.trim() || '';
          const uB = document.getElementById(`un-${idB}`)?.value.trim() || '';
          if (!uA && !uB) return 0;
          if (!uA) return 1;
          if (!uB) return -1;
          return uA.localeCompare(uB, 'ja');
        }
        case 'tax': {
          const tA = document.getElementById(`tx-${idA}`)?.checked ? 0 : 1;
          const tB = document.getElementById(`tx-${idB}`)?.checked ? 0 : 1;
          return tA - tB;
        }
        case 'subcon': {
          const sA = document.getElementById(`sv-${idA}`)?.value.trim() || '';
          const sB = document.getElementById(`sv-${idB}`)?.value.trim() || '';
          if (!sA && !sB) return 0;
          if (!sA) return 1;
          if (!sB) return -1;
          return sA.localeCompare(sB, 'ja');
        }
        default: return 0;
      }
    });
    rows.forEach(r => tbody.appendChild(r));
    updateTotals();
  }

  function sortByCategory() { sortBy('category'); }

  function buildRowHTML(id, initCat = '', initCur = 'JPY', initSv = '') {
    const tpl  = document.getElementById('row-tpl');
    const frag = tpl.content.cloneNode(true);
    const q    = f => frag.querySelector(`[data-field="${f}"]`);

    // IDs
    ['cat','tx','nm','pq','un','pc','pp','cd','bq','bc','bp','mk','st','pr','nt','sv']
      .forEach(f => { q(f).id = `${f}-${id}`; });

    // Select options & initial values
    q('cat').innerHTML = catOpts(initCat);
    q('pc').innerHTML  = curOpts(initCur);
    q('bc').innerHTML  = curOpts('JPY');
    if (initSv) q('sv').value = initSv;

    // Event handlers
    q('cat').onchange  = () => onCatChange(id);
    q('tx').onchange   = () => toggleTax(id);
    q('tx').onkeydown  = e  => { if (e.key === 'Enter') { e.preventDefault(); e.target.checked = !e.target.checked; toggleTax(id); } };
    q('nm').oninput    = () => checkUnfilled(id);
    q('pq').oninput    = () => onPay(id);
    q('pc').onchange   = () => onPay(id);
    q('pp').oninput    = () => onPay(id);
    q('mk').oninput    = () => calc(id);
    q('nt').onkeydown  = e  => noteKeydown(e, id);
    q('del').onclick   = () => delRow(id);
    q('ins').onclick   = () => addRowAfter(id);
    q('subins').onclick = () => insertSubtotalRow(id);
    q('remins').onclick = () => insertRemarkRow(id);

    return frag;
  }

  function toggleTax(id) {
    const tr = document.getElementById(`row-${id}`);
    const nm = document.getElementById(`nm-${id}`);
    if (!tr || !nm) return;
    const checked = document.getElementById(`tx-${id}`)?.checked;
    if (checked) {
      tr.classList.add('taxed');
      if (!nm.value.startsWith('*')) nm.value = '*' + nm.value;
    } else {
      tr.classList.remove('taxed');
      if (nm.value.startsWith('*')) nm.value = nm.value.slice(1);
    }
  }

  // ========== 計算 ==========
  function onPay(id) {
    const pq = val(`pq-${id}`);
    const pc = document.getElementById(`pc-${id}`)?.value;
    const pp = val(`pp-${id}`);
    const mk = val(`mk-${id}`);
    const bqEl = document.getElementById(`bq-${id}`);
    const bcEl = document.getElementById(`bc-${id}`);
    const bpEl = document.getElementById(`bp-${id}`);
    if (bqEl) bqEl.value = pq;
    if (bcEl) bcEl.value = pc;
    if (bpEl) { bpEl.dataset.base = pp; bpEl.value = pp + mk; }
    calc(id);
  }

  function calc(id) {
    const pq = val(`pq-${id}`);
    const pp = val(`pp-${id}`);
    const bq = val(`bq-${id}`);
    const mk = val(`mk-${id}`);
    const bpEl = document.getElementById(`bp-${id}`);
    if (bpEl) bpEl.value = (parseFloat(bpEl.dataset.base) || 0) + mk;
    const bp = val(`bp-${id}`);
    const subtotal = bq * bp;             // 行の請求小計（数量 × 単価）
    const profit   = subtotal - pq * pp;  // 行の利益（小計 - 支払い合計）
    // 小計セル
    const st = document.getElementById(`st-${id}`);
    if (st) {
      st.textContent = subtotal ? fmt(subtotal) : '—';
      st.className   = 'subtotal-cell' + (subtotal ? ' subtotal-has-value' : '');
    }
    // 利益セル
    const pr = document.getElementById(`pr-${id}`);
    pr.textContent = fmt(profit);
    pr.className   = `profit-cell ${pClass(profit)}`;
    updateTotals();
  }

  function pClass(p) {
    return p > 0 ? 'profit-pos' : p < 0 ? 'profit-neg' : 'profit-zero';
  }

  function val(id) {
    return parseFloat(document.getElementById(id)?.value) || 0;
  }

  function updateTotals() {
    const rows = document.querySelectorAll('#tableBody tr');
    if (!rows.length) {
      ['tot-cost','tot-billing','tot-markup','tot-subtotal','tot-profit'].forEach(id =>
        document.getElementById(id).textContent = '—');
      document.getElementById('tot-profit').className = 'profit-cell profit-zero';
      const jpyRow = document.getElementById('tot-jpy-row');
      if (jpyRow) jpyRow.style.display = 'none';
      return;
    }
    let totCost = 0, totBill = 0, totMk = 0, totSub = 0;
    let totCostJPY = 0, totBillJPY = 0, totSubJPY = 0;
    let hasFx = false;
    rows.forEach(tr => {
      if (tr.dataset.type === 'subtotal') return; // 小計行をスキップ
      const id  = tr.id.replace('row-', '');
      const pc  = document.getElementById(`pc-${id}`)?.value || 'JPY';
      const bc  = document.getElementById(`bc-${id}`)?.value || 'JPY';
      const pq  = val(`pq-${id}`);
      const pp  = val(`pp-${id}`);
      const bq  = val(`bq-${id}`);
      const bp  = val(`bp-${id}`);
      const cost = pq * pp;
      const sub  = bq * bp;
      totCost += cost;
      totBill += sub;
      totSub  += sub;
      totMk   += val(`mk-${id}`);
      // JPY換算
      totCostJPY += toJPY(cost, pc);
      totBillJPY += toJPY(sub, bc);
      totSubJPY  += toJPY(sub, bc);
      if (pc !== 'JPY' || bc !== 'JPY') hasFx = true;
    });
    const totPr    = totBill - totCost;
    const totPrJPY = totBillJPY - totCostJPY;
    document.getElementById('tot-cost').textContent     = fmt(totCost);
    document.getElementById('tot-billing').textContent  = fmt(totBill);
    document.getElementById('tot-markup').textContent   = fmt(totMk);
    document.getElementById('tot-subtotal').textContent = fmt(totSub);
    const pEl = document.getElementById('tot-profit');
    pEl.textContent = fmt(totPr);
    pEl.className   = `profit-cell ${pClass(totPr)}`;
    // JPY換算行（外貨が含まれる場合のみ表示）
    const jpyRow = document.getElementById('tot-jpy-row');
    if (jpyRow) {
      jpyRow.style.display = hasFx ? '' : 'none';
      if (hasFx) {
        document.getElementById('tot-cost-jpy').textContent     = '≈ ¥' + fmt(totCostJPY);
        document.getElementById('tot-billing-jpy').textContent  = '≈ ¥' + fmt(totBillJPY);
        document.getElementById('tot-subtotal-jpy').textContent = '≈ ¥' + fmt(totSubJPY);
        const prjEl = document.getElementById('tot-profit-jpy');
        prjEl.textContent = '≈ ¥' + fmt(totPrJPY);
        prjEl.className   = `profit-cell ${pClass(totPrJPY)}`;
      }
    }
    updateSubtotalRows();
  }

  // ========== 小計行 ==========
  let subtotalCount = 0;
  let remarkCount   = 0;

  // 小計行ドラッグ初期化（通常行の initDrag と同じロジック）
  function initSubtotalDrag(tr) {
    tr.setAttribute('draggable', 'true');
    const handle = tr.querySelector('.drag-handle');
    let _dragFromHandle = false;
    if (handle) {
      handle.addEventListener('mousedown', () => { _dragFromHandle = true; });
      document.addEventListener('mouseup', () => { _dragFromHandle = false; }, { capture: true });
    }
    tr.addEventListener('dragstart', e => {
      if (!handle || !_dragFromHandle) { e.preventDefault(); return; }
      _dragFromHandle = false;
      dragSrcRow = tr;
      // 小計行はチェックボックスを持たない → 常に単一行ドラッグ
      dragSrcRows = [tr];
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', tr.id);
      setTimeout(() => tr.classList.add('dragging'), 0);
    });
    tr.addEventListener('dragend', () => {
      (dragSrcRows || [tr]).forEach(r => r.classList.remove('dragging'));
      document.querySelectorAll('#tableBody tr').forEach(r =>
        r.classList.remove('drag-over-top', 'drag-over-bottom'));
      dragSrcRow = null;
      dragSrcRows = null;
      updateTotals();
    });
    tr.addEventListener('dragover', e => {
      if (!dragSrcRows || !dragSrcRows.length) return;
      e.preventDefault(); e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      if (dragSrcRows.includes(tr)) return;
      const mid = tr.getBoundingClientRect().top + tr.getBoundingClientRect().height / 2;
      document.querySelectorAll('#tableBody tr').forEach(r =>
        r.classList.remove('drag-over-top', 'drag-over-bottom'));
      tr.classList.add(e.clientY < mid ? 'drag-over-top' : 'drag-over-bottom');
    });
    tr.addEventListener('dragleave', () =>
      tr.classList.remove('drag-over-top', 'drag-over-bottom'));
    tr.addEventListener('drop', e => {
      e.preventDefault(); e.stopPropagation();
      if (!dragSrcRows || !dragSrcRows.length || dragSrcRows.includes(tr)) return;
      const mid = tr.getBoundingClientRect().top + tr.getBoundingClientRect().height / 2;
      const tbody = document.getElementById('tableBody');
      const insertBefore = e.clientY < mid ? tr : tr.nextSibling;
      dragSrcRows.forEach(srcTr => {
        tbody.insertBefore(srcTr, insertBefore);
      });
      tr.classList.remove('drag-over-top', 'drag-over-bottom');
    });
    const upBtn   = tr.querySelector('.subtotal-move-up');
    const downBtn = tr.querySelector('.subtotal-move-down');
    if (upBtn)   upBtn.addEventListener('click',  () => moveRow(tr, -1));
    if (downBtn) downBtn.addEventListener('click', () => moveRow(tr, +1));
  }

  /**
   * 小計行を挿入する。
   * afterId が指定された場合はその行の直後に、省略時は末尾に追加。
   */
  function insertSubtotalRow(afterId) {
    subtotalCount++;
    const id = `subtotal-${subtotalCount}`;
    const tr = document.createElement('tr');
    tr.id = `row-${id}`;
    tr.dataset.type = 'subtotal';
    tr.className = 'subtotal-row';
    // 19 列構成（tfoot の合計行と同じ列レイアウト）。
    // 行アクションは左端へ統一（regular row のアクションセル位置に合わせる）。
    tr.innerHTML = `
      <td class="subtotal-del-cell action-cell">
        <input type="checkbox" class="row-select-chk" tabindex="-1" title="この行を選択（パターン保存用）" style="width:13px;height:13px;cursor:pointer;margin:0 2px 0 0;vertical-align:middle;" />
        <button type="button" class="subtotal-del-btn" onclick="removeSubtotalRow('${id}')" title="この小計行を削除">✕</button>
      </td>
      <td class="subtotal-drag-cell">
        <span class="drag-handle" title="ドラッグして並び替え">⠿</span>
      </td>
      <td class="handle-cell">
        <button type="button" class="row-move-btn subtotal-move-up"   tabindex="-1" title="上に移動">▲</button>
        <button type="button" class="row-move-btn subtotal-move-down" tabindex="-1" title="下に移動">▼</button>
      </td>
      <td></td>
      <td></td>
      <td colspan="4" class="subtotal-label-cell">
        <span class="subtotal-marker">━━ 小計</span>
        <input type="text" class="subtotal-label" placeholder="グループ名（任意）" oninput="updateSubtotalRows()" />
      </td>
      <td colspan="5" class="subtotal-dash">—</td>
      <td class="subtotal-group-billing">—</td>
      <td class="subtotal-dash">—</td>
      <td class="subtotal-group-subtotal subtotal-cell">—</td>
      <td class="subtotal-group-profit profit-cell profit-zero">—</td>
      <td></td>
    `;
    const tbody = document.getElementById('tableBody');
    if (afterId) {
      const afterRow = document.getElementById(`row-${afterId}`);
      if (afterRow?.nextSibling) tbody.insertBefore(tr, afterRow.nextSibling);
      else if (afterRow)         tbody.appendChild(tr);
      else                       tbody.appendChild(tr);
    } else {
      tbody.appendChild(tr);
    }
    initSubtotalDrag(tr);
    updateSubtotalRows();
  }

  function removeSubtotalRow(id) {
    document.getElementById(`row-${id}`)?.remove();
    updateSubtotalRows();
    updateTotals();
  }

  // ========== リマーク行 ==========
  function insertRemarkRow(afterId, opts) {
    remarkCount++;
    const id = `remark-${remarkCount}`;
    const tr = document.createElement('tr');
    tr.id = `row-${id}`;
    tr.dataset.type = 'remark';
    tr.className = 'remark-row';
    tr.innerHTML = `
      <td class="action-cell">
        <input type="checkbox" class="row-select-chk" tabindex="-1" title="この行を選択（パターン保存用）" style="width:13px;height:13px;cursor:pointer;margin:0 2px 0 0;vertical-align:middle;" />
        <button type="button" class="remark-del-btn" onclick="removeRemarkRow('${id}')" title="このリマーク行を削除">✕</button>
      </td>
      <td class="remark-drag-cell">
        <span class="drag-handle" title="ドラッグして並び替え">⠿</span>
      </td>
      <td class="handle-cell">
        <button type="button" class="row-move-btn subtotal-move-up"   tabindex="-1" title="上に移動">▲</button>
        <button type="button" class="row-move-btn subtotal-move-down" tabindex="-1" title="下に移動">▼</button>
      </td>
      <td colspan="16" class="remark-row-cell">
        <span class="remark-row-marker">💬 リマーク</span>
        <input type="text" class="remark-row-input" placeholder="テーブル内コメント・注記を入力" />
      </td>
    `;
    const tbody = document.getElementById('tableBody');
    if (afterId) {
      const afterRow = document.getElementById(`row-${afterId}`);
      if (afterRow?.nextSibling) tbody.insertBefore(tr, afterRow.nextSibling);
      else if (afterRow)         tbody.appendChild(tr);
      else                       tbody.appendChild(tr);
    } else {
      tbody.appendChild(tr);
    }
    initSubtotalDrag(tr);
    if (!opts?.noFocus) tr.querySelector('.remark-row-input')?.focus();
  }

  function removeRemarkRow(id) {
    document.getElementById(`row-${id}`)?.remove();
  }

  function updateSubtotalRows() {
    const tbody = document.getElementById('tableBody');
    const allRows = Array.from(tbody.querySelectorAll('tr'));
    // 通貨は混在し得るため、JPY 換算で集計する（_fxRates 経由）
    // ただし単一通貨グループは原通貨のまま表示する
    let groupBillJPY = 0;     // JPY 換算後の請求合計
    let groupCostJPY = 0;     // JPY 換算後の支払い合計
    let groupBillRaw = 0;     // 原通貨の請求合計（単一通貨グループ用）
    let groupCostRaw = 0;     // 原通貨の支払い合計（単一通貨グループ用）
    let groupBillCurrencies = new Set();  // 請求通貨セット（単一通貨判定用）
    let groupCostCurrencies = new Set();  // 支払い通貨セット
    allRows.forEach(tr => {
      if (tr.dataset.type === 'subtotal') {
        const billingEl  = tr.querySelector('.subtotal-group-billing');
        const subtotalEl = tr.querySelector('.subtotal-group-subtotal');
        const profitEl   = tr.querySelector('.subtotal-group-profit');
        const mixedBill = groupBillCurrencies.size > 1;
        const mixedCost = groupCostCurrencies.size > 1;
        const mixed = mixedBill || mixedCost;
        // 単一請求通貨なら原通貨で表示、混在なら JPY 換算
        const billCur = (!mixedBill && groupBillCurrencies.size === 1)
          ? [...groupBillCurrencies][0] : null;
        const billAmt  = billCur ? groupBillRaw : groupBillJPY;
        const costAmt  = (!mixedCost && groupCostCurrencies.size === 1)
          ? groupCostRaw : groupCostJPY;
        const profit   = billAmt - costAmt;
        const prefix   = mixed ? '≈ ' : '';
        const curSuffix = (billCur && billCur !== 'JPY') ? ' ' + billCur : '';

        if (billingEl) {
          billingEl.textContent = billAmt ? prefix + fmt(billAmt) + curSuffix : '—';
          billingEl.title = mixed ? '多通貨を JPY に換算して合計（FX パネルのレート使用）' : '';
        }
        if (subtotalEl) {
          subtotalEl.textContent = billAmt ? prefix + fmt(billAmt) + curSuffix : '—';
          subtotalEl.className   = 'subtotal-group-subtotal subtotal-cell' + (billAmt ? ' subtotal-has-value' : '');
          subtotalEl.title = mixed ? '多通貨を JPY に換算して合計（FX パネルのレート使用）' : '';
        }
        if (profitEl) {
          profitEl.textContent = (billAmt || costAmt) ? prefix + fmt(profit) + curSuffix : '—';
          profitEl.className   = `subtotal-group-profit profit-cell ${pClass(profit)}`;
          profitEl.title = mixed ? '多通貨を JPY に換算して合計（FX パネルのレート使用）' : '';
        }
        groupBillJPY = 0; groupCostJPY = 0;
        groupBillRaw = 0; groupCostRaw = 0;
        groupBillCurrencies = new Set(); groupCostCurrencies = new Set();
      } else {
        const id = tr.id.replace('row-', '');
        const bq = val(`bq-${id}`);
        const bp = val(`bp-${id}`);
        const pq = val(`pq-${id}`);
        const pp = val(`pp-${id}`);
        const bc = document.getElementById(`bc-${id}`)?.value || 'JPY';
        const pc = document.getElementById(`pc-${id}`)?.value || 'JPY';
        const billRaw = bq * bp;
        const costRaw = pq * pp;
        groupBillJPY += toJPY(billRaw, bc);
        groupCostJPY += toJPY(costRaw, pc);
        groupBillRaw += billRaw;
        groupCostRaw += costRaw;
        if (billRaw && bc) groupBillCurrencies.add(bc);
        if (costRaw && pc) groupCostCurrencies.add(pc);
      }
    });
  }

  function delRow(id) {
    document.getElementById(`row-${id}`)?.remove();
    updateTotals();
  }

  // 未入力行（row-unfilled）を一括削除
  function deleteEmptyRows() {
    const empties = document.querySelectorAll('#tableBody tr.row-unfilled');
    if (!empties.length) {
      quoteShowToast('🧹 未入力行はありません', 'success', 2500);
      return;
    }
    empties.forEach(tr => tr.remove());
    updateTotals();
    quoteShowToast(`🧹 未入力行を ${empties.length} 件削除しました`, 'success');
  }

  function resetAll() {
    document.getElementById('tableBody').innerHTML = '';
    rowCount = 0;
    updateTotals();
    quoteShowToast('🗑️ 全行をリセットしました（Ctrl+Z で元に戻せます）', 'info', 4000);
  }
